




import Dexie from 'dexie'
import { generateUniverse, playerValue, LEAGUES } from './game/universe'
import { generateSchedule } from './game/schedule'
import { computeStandings } from './game/standings'
import { seasonGrowth } from './game/progression'
import { deriveOvr, migrateAttrs, rollAttrsForOvr, growAttrs, declineAttrs } from './game/attributes'
import { aiTransferDeals } from './game/market'
import { assignLeagueAbilities, abilityValueBonus } from './game/abilities'
import { Rng, seedFromString } from './lib/rng'
import { simulateMatch, matchSeed, matchSeedNumber, teamStrength } from './game/engine'
import { DEFAULT_TACTICS } from './game/tactics'
import { matchdayGate, wagesPerRound, expansionInfo, penaltyPoints, federationMail, makeSponsorOffers, bestSponsorOffer, sponsorBonus } from './game/finance'
import { managerNameFor, sackProb, offerChance, applyProb } from './game/jobs'
import { SCOUT_REPORT_COST } from './game/scouting'
import { seasonTopScorer } from './game/history'

const PERSONALITIES = ['Leader', 'Professionista', 'Temperamentale', 'Sognatore', 'Grintoso', 'Pacato']
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/**
 * Database locale (IndexedDB via Dexie). Tutto client-side.
 * Una riga per club/calciatore/partita, indicizzata per careerId:
 * il mercato (F4) può interrogare l'intera lega senza caricare tutto.
 */
export const db = new Dexie('pitchtory')

db.version(1).stores({
  careers: '++id, createdAt',
  clubs: 'key, careerId',
  players: 'key, careerId, clubId',
  fixtures: 'key, careerId',
})

/** Versione dell'universo (G1.1: la Coppa si gioca a sedici, infrasettimanale).
 * Le carriere nate prima hanno un formato di Coppa diverso: si riparte da zero. */
export const UNIVERSE_VERSION = 3

/** Sale per il calendario di ogni lega: stessa carriera, stesse sorti. */
const LEAGUE_SCHED_SALT = { c: 0, a: 0x1eaf }

/** Coppa Nazionale Trofeo Bellandi (G1.1): sedici società a eliminazione
 * diretta — le prime 8 di ogni serie dalla seconda stagione, mentre
 * all'esordio del mondo quindici estratte a sorte più quella del mister.
 * Quattro turni infrasettimanali giocati tra le giornate di campionato,
 * con la finale che arriva sempre prima della 38ª. Qui i pari non
 * esistono: chi passa lo decide il seed. */
export const CUP_NAME = 'Coppa Nazionale Trofeo Bellandi'
export const CUP_ROUNDS = { 1: 'Ottavi', 2: 'Quarti', 3: 'Semifinale', 4: 'Finale' }
const CUP_LEAGUE_ID = 'b'
const CUP_MAX_ROUND = 4
/** I turni di Coppa vivono a mezza giornata: 8,5 sta tra l'8ª e la 9ª. */
const CUP_ROUND_NUMBER = { 1: 8.5, 2: 16.5, 3: 24.5, 4: 32.5 }

async function addCupRound(careerId, round, pairs) {
  await db.fixtures.bulkAdd(pairs.map(([home, away], i) => ({
    key: careerId + ':' + CUP_LEAGUE_ID + round + 'm' + i,
    careerId,
    leagueId: CUP_LEAGUE_ID,
    type: 'cup',
    round,
    number: CUP_ROUND_NUMBER[round],
    leg: 1,
    homeId: home.id,
    awayId: away.id,
    played: false,
    homeGoals: null,
    awayGoals: null,
    winnerId: null,
  })))
}

/** Turno 1: chi partecipa lo decide chi chiama (le prime 8 di ogni serie
 * a fine stagione, o il sorteggio d'esordio), gli accoppiamenti li decide
 * il seed. */
export async function createCupFirstRound(careerId, qualifiers, seed, season) {
  const rng = new Rng(seedFromString(seed + ':cup:' + season))
  const pool = rng.shuffle(qualifiers.slice())
  const pairs = []
  for (let i = 0; i + 1 < pool.length; i += 2) {
    pairs.push(rng.chance(0.5) ? [pool[i], pool[i + 1]] : [pool[i + 1], pool[i]])
  }
  await addCupRound(careerId, 1, pairs)
}

/** Turno successivo: quando l'ultimo incontro del turno è finito, i
 * vincitori si accoppiano a bracket (chi esce dalla i-esima aspetta chi
 * esce dalla successiva). */
export async function createNextCupRound(careerId) {
  const cupFx = await db.fixtures.where('careerId').equals(careerId).filter((f) => f.leagueId === CUP_LEAGUE_ID).toArray()
  if (!cupFx.length) return
  const maxRound = Math.max(...cupFx.map((f) => f.round))
  if (maxRound >= CUP_MAX_ROUND) return
  const current = cupFx.filter((f) => f.round === maxRound)
  if (current.some((f) => !f.played)) return
  const winners = current.slice().sort((a, b) => (a.key < b.key ? -1 : 1)).map((f) => f.winnerId)
  const pairs = []
  for (let i = 0; i + 1 < winners.length; i += 2) {
    pairs.push([{ id: winners[i] }, { id: winners[i + 1] }])
  }
  if (pairs.length) await addCupRound(careerId, maxRound + 1, pairs)
}

/** Rigori: la Coppa non ammette pari, e il destino è nel seed. */
export function cupShootout(career, fixture, homeClub, awayClub, playersByClub) {
  const rng = new Rng((matchSeedNumber(career.seed, fixture.key + '#' + career.season) ^ 0x9e2d) >>> 0)
  const sh = teamStrength(homeClub, playersByClub[homeClub.id] || [])
  const sa = teamStrength(awayClub, playersByClub[awayClub.id] || [])
  const pHome = clamp(0.5 + (sh - sa) * 0.05, 0.3, 0.7)
  const winner = rng.float() < pHome ? homeClub : awayClub
  return {
    winnerId: winner.id,
    event: { minute: 94, type: 'pen', text: 'Rigori: passa il ' + winner.name + '. Il Trofeo Bellandi non guarda in faccia nessuno' },
  }
}

/** Chiude la Coppa a stagione finita (eliminato o no, qui si decide tutto
 * in simulazione). Ritorna l'id del club che alza il trofeo, o null. */
async function closeCup(careerId, career, clubs, players) {
  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]))
  const playersByClub = {}
  for (const p of players) (playersByClub[p.clubId] = playersByClub[p.clubId] || []).push(p)
  for (let guard = 0; guard < 20; guard++) {
    const cupFx = await db.fixtures.where('careerId').equals(careerId).filter((f) => f.leagueId === CUP_LEAGUE_ID).toArray()
    if (!cupFx.length) return null
    const maxRound = Math.max(...cupFx.map((f) => f.round))
    const current = cupFx.filter((f) => f.round === maxRound)
    if (current.every((f) => f.played)) {
      if (maxRound >= CUP_MAX_ROUND) return current[0].winnerId
      await createNextCupRound(careerId)
      continue
    }
    for (const f of current.filter((x) => !x.played)) {
      const sim = simulateMatch(clubById[f.homeId], clubById[f.awayId], playersByClub, matchSeed(career.seed, f.key + '#' + career.season))
      const winnerId = sim.homeGoals === sim.awayGoals
        ? cupShootout(career, f, clubById[f.homeId], clubById[f.awayId], playersByClub).winnerId
        : sim.homeGoals > sim.awayGoals ? f.homeId : f.awayId
      await db.fixtures.update(f.key, { played: true, homeGoals: sim.homeGoals, awayGoals: sim.awayGoals, winnerId })
      await applyAiMatchday(f, sim.events, players)
    }
  }
  return null
}

/** Squalifiche (G1): espulsione = una giornata di stop, quinta
 * ammonizione = una giornata e il contatore riparte. Vale per chiunque
 * scenda in campo, QTE o simulazione che sia. I turni di Coppa vivono a
 * mezza giornata (8,5): il floor riporta gli stop su numeri interi —
 * una rossa in Coppa salta la giornata di campionato dopo. */
async function writeSuspensions(fixture, events, byId) {
  const reds = new Set(events.filter((e) => e.type === 'red' && e.playerId).map((e) => e.playerId))
  const yellows = {}
  for (const e of events) if (e.type === 'card' && e.playerId) yellows[e.playerId] = (yellows[e.playerId] || 0) + 1
  for (const id of new Set([...reds, ...Object.keys(yellows)])) {
    const p = byId.get(id)
    if (!p || !p.key) continue
    const tot = (p.cards || 0) + (yellows[id] || 0)
    const red = reds.has(id)
    if (red || tot >= 5) {
      await db.players.update(p.key, { bannedUntil: Math.floor(fixture.number) + 1, cards: red ? tot : tot - 5 })
    } else {
      await db.players.update(p.key, { cards: tot })
    }
  }
}

/** Calendari di tutte le leghe: una riga per partita, chiave unica per lega. */
function buildLeagueFixtures(careerId, clubs, scheduleSeed) {
  const rows = []
  for (const league of LEAGUES) {
    const ids = clubs.filter((c) => c.leagueId === league.id).map((c) => c.id)
    if (ids.length < 2) continue
    const schedule = generateSchedule(ids, new Rng((scheduleSeed ^ (LEAGUE_SCHED_SALT[league.id] || 0)) >>> 0))
    for (const md of schedule) {
      md.matches.forEach((m, i) => {
        rows.push({
          key: careerId + ':' + league.id + 'g' + md.number + 'm' + i,
          careerId,
          leagueId: league.id,
          number: md.number,
          leg: md.leg,
          homeId: m.homeId,
          awayId: m.awayId,
          played: false,
          homeGoals: null,
          awayGoals: null,
        })
      })
    }
  }
  return rows
}

/** Crea una carriera: universo + calendario + morale, tutto deterministico dal seed. */
export async function createCareer({ seed, seedText, coachName, clubId, matchDuration = 'normal' }) {
  const universe = generateUniverse(seed)
  const moraleRng = new Rng((seed ^ 0x4b1d) >>> 0)
  // Sponsor d'esordio (G3.1): il pool per il mister, la firma per gli AI.
  const financeInit = {
    season: universe.season,
    settled: [],
    rounds: [],
    mails: [],
    sponsor: null,
    sponsorPool: makeSponsorOffers(seed, universe.season, universe.clubs.find((c) => c.id === clubId), null),
  }

  const careerId = await db.careers.add({
    seed,
    seedText: seedText || null,
    coachName: coachName || 'Mister',
    clubId,
    season: universe.season,
    settings: { matchDuration },
    tactics: { ...DEFAULT_TACTICS },
    finance: financeInit,
    universeVersion: UNIVERSE_VERSION,
    scouts: { level: 1, focus: null },
    scouted: [],
    trophies: [],
    history: [],
    createdAt: new Date().toISOString(),
  })

  // NB: anche careers va nello scope della transazione: la finance degli
  // sponsor tocca quella tabella e Dexie, senza, fa abortire tutta la
  // creazione (stesso inciampo della fine stagione, v0.8.1).
  await db.transaction('rw', db.careers, db.clubs, db.players, db.fixtures, async () => {
    await db.clubs.bulkAdd(universe.clubs.map((c) => ({ key: careerId + ':' + c.id, careerId, manager: c.id === clubId ? null : managerNameFor(seed, c.id, 0), ...c })))
    await db.players.bulkAdd(universe.players.map((p) => ({
      key: careerId + ':' + p.id,
      careerId,
      morale: moraleRng.int(62, 82),
      personality: moraleRng.pick(PERSONALITIES),
      apps: 0,
      minutes: 0,
      goals: 0,
      injuredUntil: null,
      ...p,
    })))
    await db.fixtures.bulkAdd(buildLeagueFixtures(careerId, universe.clubs, (seed ^ 0x5ced) >>> 0))
    // Coppa d'esordio: la società del mister più quindici estratte a sorte
    // tra tutte le altre — il tabellone d'apertura si merita un debuttante.
    const cupRng = new Rng(seedFromString(seed + ':cup:qual:' + universe.season))
    const cupPool = universe.clubs.filter((c) => c.id !== clubId)
    const cupDrawn = []
    while (cupDrawn.length < 15 && cupPool.length) cupDrawn.push(cupPool.splice(cupRng.int(0, cupPool.length - 1), 1)[0])
    await createCupFirstRound(careerId, [universe.clubs.find((c) => c.id === clubId), ...cupDrawn], seed, universe.season)
    // I club AI firmano da soli: la base è denaro d'inizio stagione,
    // subito in cassa. Il mister invece sceglie dal suo pool.
    const aiSponsors = {}
    for (const c of universe.clubs) {
      if (c.id === clubId) continue
      const deal = bestSponsorOffer(makeSponsorOffers(seed, universe.season, c, null))
      if (!deal) continue
      aiSponsors[c.id] = deal
      await db.clubs.update(careerId + ':' + c.id, { budget: c.budget + deal.base })
    }
    financeInit.aiSponsors = aiSponsors
    await db.careers.update(careerId, { finance: financeInit })
  })

  return careerId
}

/** I trofei del mister (G5): la bacheca della lega raccoglie tutto,
 *  ma la vetrina sua conta solo quello che ha vinto lui. Le voci
 *  vecchie non hanno il timbro: si guardano per club, e pazienza
 *  per i titoli vinti con una maglia che nel frattempo è cambiata. */
export function userTrophies(career) {
  const clubId = career && career.clubId
  return ((career && career.trophies) || []).filter((t) =>
    t && (t.user === undefined ? !!clubId && t.championId === clubId : t.user),
  )
}

/**
 * Carica una carriera completa. Le righe conservano key e careerId.
 * Migrazione lazy (v0.9): chi non ha gli attributi in scala 1-20 li riceve
 * qui, deterministici dal seed e centrati sull'OVR attuale — la carriera
 * continua identica a come l'hai lasciata.
 */
export async function loadCareer(id) {
  const career = await db.careers.get(id)
  if (career && career.universeVersion !== UNIVERSE_VERSION) {
    throw new Error('Carriera nata con un universo precedente (Coppa a 32 dopo la 38ª): creane una nuova.')
  }
  const [clubs, players, fixtures] = await Promise.all([
    db.clubs.where('careerId').equals(id).toArray(),
    db.players.where('careerId').equals(id).toArray(),
    db.fixtures.where('careerId').equals(id).toArray(),
  ])

  const stale = (p) => !p.attributes || Object.values(p.attributes).some((v) => v > 20)
  const toMigrate = players.filter(stale)
  if (toMigrate.length) {
    await db.transaction('rw', db.players, async () => {
      for (const p of toMigrate) {
        const rng = new Rng(seedFromString(career.seed + ':' + p.id + ':attrs'))
        p.attributes = p.attributes
          ? migrateAttrs(p.attributes, p.role, p.ovr)
          : rollAttrsForOvr(rng, p.ovr, p.role)
        if (p.key) await db.players.update(p.key, { attributes: p.attributes })
      }
    })
  }

  // Migrazione lazy (v0.11): chi non ha le abilità speciali (F5) le riceve
  // qui, deterministicamente dal seed — stessa lega, stessi campioni.
  // E le abilità si pagano: il valore di mercato si aggiusta.
  const noAbilities = players.filter((p) => !Array.isArray(p.abilities))
  if (noAbilities.length) {
    const abilityMap = assignLeagueAbilities(career.seed, players)
    await db.transaction('rw', db.players, async () => {
      for (const p of noAbilities) {
        p.abilities = abilityMap[p.id] || []
        if (p.key) {
          const base = playerValue(p.ovr, p.age, p.potential)
          const value = Math.max(30000, Math.round((base * (1 + abilityValueBonus(p.abilities))) / 10000) * 10000)
          p.value = value
          await db.players.update(p.key, { abilities: p.abilities, value })
        }
      }
    })
  }

  // Migrazione lazy (v0.11): l'osservatorio della carriera (F5).
  if (!career.scouts) {
    career.scouts = { level: 1, focus: null }
    await db.careers.update(id, { scouts: career.scouts })
  }

  // Migrazione lazy (G2): la lavagnetta della carriera. Chi non ha
  // tattiche salvate parte dal classico equilibrato — la carriera
  // continua identica a come l'hai lasciata.
  if (!career.tactics) {
    career.tactics = { ...DEFAULT_TACTICS }
    await db.careers.update(id, { tactics: career.tactics })
  }

  // Migrazione lazy (G3): il registro della cassa. Chi non ce l'ha parte
  // da zero conti, e la stagione in corso non cambia di una virgola.
  if (!career.finance || career.finance.season !== career.season) {
    career.finance = { season: career.season, settled: [], rounds: [], mails: [] }
    await db.careers.update(id, { finance: career.finance })
  }
  // Migrazione lazy (G3.1): chi non ha ancora gli sponsor della stagione
  // li cerca adesso — pool per il mister, firma immediata per i club AI.
  // Le carriere in corsa sopravvivono: la base si incassa al primo giro.
  if (!career.finance.sponsorPool) {
    const userClubEntry = clubs.find((c) => c.id === career.clubId) || null
    career.finance.sponsorPool = makeSponsorOffers(career.seed, career.season, userClubEntry, null)
    const aiSponsors = {}
    await db.transaction('rw', db.clubs, async () => {
      for (const c of clubs) {
        if (c.id === career.clubId || !c.key) continue
        const deal = bestSponsorOffer(makeSponsorOffers(career.seed, career.season, c, null))
        if (!deal) continue
        aiSponsors[c.id] = deal
        await db.clubs.update(c.key, { budget: c.budget + deal.base })
      }
    })
    career.finance.aiSponsors = aiSponsors
    career.finance.sponsor = career.finance.sponsor || null
    await db.careers.update(id, { finance: career.finance })
  }

  // Migrazione lazy (G5.1): il mercato delle panchine. Ogni club AI ha il
  // suo mister dal seed; la panchina del club del mister resta senza nome,
  // perché là siede l'utente.
  if (!career.jobs) {
    career.jobs = { offers: [], applied: [], invited: [], notices: [] }
    await db.careers.update(id, { jobs: career.jobs })
  }
  // G4: il cassetto dei report sugli avversari (Occhi sui Grandi).
  if (!career.scouted) {
    career.scouted = []
    await db.careers.update(id, { scouted: career.scouted })
  }
  // L'albo d'oro nasce vuoto (v0.22.2): nessun passato inventato.
  // Le carriere nate prima si portano dietro l'albo scritto dal seed:
  // si butta, conta solo la storia giocata sul campo.
  if (career.albo) {
    career.albo = null
    await db.careers.update(id, { albo: null })
  }
  // Migrazione lazy (G5): la storia delle stagioni giocate. Le
  // carriere nate prima di G5 la ricostruiscono dai trofei già
  // registrati: campioni e Coppe si salvano, i capocannonieri no.
  if (!Array.isArray(career.history)) {
    const nameToId = {}
    for (const l of LEAGUES) nameToId[l.name] = l.id
    career.history = (career.trophies || []).reduce((acc, t) => {
      if (!t || !t.championId) return acc
      let entry = acc.find((x) => x.season === t.season)
      if (!entry) {
        entry = { season: t.season, champions: [], cup: null, scorers: [], user: null }
        acc.push(entry)
      }
      if (t.competition === CUP_NAME) {
        entry.cup = { clubId: t.championId, name: t.championName }
      } else {
        entry.champions.push({ leagueId: nameToId[t.competition] || null, leagueName: t.competition, clubId: t.championId, name: t.championName })
      }
      return acc
    }, [])
    await db.careers.update(id, { history: career.history })
  }
  const noManager = clubs.filter((c) => c.id !== career.clubId && typeof c.manager !== 'string')
  if (noManager.length) {
    await db.transaction('rw', db.clubs, async () => {
      for (const c of noManager) {
        if (!c.key) continue
        await db.clubs.update(c.key, { manager: managerNameFor(career.seed, c.id, 0) })
      }
    })
  }

  return { career, clubs, players, fixtures }
}

export async function listCareers() {
  const all = await db.careers.orderBy('createdAt').reverse().toArray()
  // L'universo nuovo non adotta le carriere nate prima: si riparte da zero
  // (con il benestare del mister, che le usava solo per le prove).
  const stale = all.filter((c) => c.universeVersion !== UNIVERSE_VERSION)
  if (stale.length) {
    for (const c of stale) await deleteCareer(c.id)
    return all.filter((c) => c.universeVersion === UNIVERSE_VERSION)
  }
  return all
}

export async function updateCareerSettings(id, settings) {
  await db.careers.update(id, { settings })
}

/** La lavagnetta del mister (G2): modulo, mentalità, pressing e linea. */
export async function setTactics(careerId, tactics) {
  const career = await db.careers.get(careerId)
  if (!career) return
  const next = { ...DEFAULT_TACTICS, ...(career.tactics || {}), ...tactics }
  await db.careers.update(careerId, { tactics: next })
  return next
}

/** L'undici scelto dal mister (G2.1): undici id allineati agli slot del
 *  modulo, null dove decide lo staff. Chi non è più della rosa, chi è
 *  in infermeria e chi è squalificato lo ignora il motore: la lavagnetta
 *  non costringe mai a giocare in dieci. */
export async function setLineup(careerId, lineup) {
  const career = await db.careers.get(careerId)
  if (!career) return
  await db.careers.update(careerId, { lineup: lineup || null })
  return lineup || null
}

/** La giornata paga (G3): biglietti a chi ospita, stipendi a tutti —
 *  lo sponsor si firma a inizio stagione e la base si incassa lì (G3.1).
 *  Idempotente sul registro della stagione: la stessa giornata non si
 *  incassa due volte, nemmeno per sbaglio. */
export async function settleRound(careerId, number) {
  const { career, clubs, players, fixtures } = await loadCareer(careerId)
  let fin = career.finance || { season: career.season, settled: [], rounds: [], mails: [] }
  if (fin.season !== career.season) fin = { season: career.season, settled: [], rounds: [], mails: [] }
  if ((fin.settled || []).includes(number)) return
  fin.settled = [...(fin.settled || []), number]

  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]))
  const playersByClub = {}
  for (const p of players) (playersByClub[p.clubId] = playersByClub[p.clubId] || []).push(p)

  // Posizione in classifica e forma: conti sulle partite già giocate.
  const byLeague = {}
  for (const l of LEAGUES) {
    byLeague[l.id] = computeStandings(clubs, fixtures, l.id).map((row, i) => [row.clubId, i + 1])
  }
  const positionOf = (clubId) => {
    for (const m of Object.values(byLeague)) {
      const hit = m.find(([cid]) => cid === clubId)
      if (hit) return hit[1]
    }
    return 10
  }
  const formOf = (clubId) => {
    const played = fixtures
      .filter((f) => f.played && (f.homeId === clubId || f.awayId === clubId) && f.number < number)
      .sort((a, b) => a.number - b.number)
      .slice(-5)
    const wins = played.filter((f) => (f.homeId === clubId ? f.homeGoals > f.awayGoals : f.awayGoals > f.homeGoals)).length
    const losses = played.filter((f) => (f.homeId === clubId ? f.homeGoals < f.awayGoals : f.awayGoals < f.homeGoals)).length
    return { wins, losses }
  }

  const deltas = {}
  const row = { n: number, attendance: 0, tickets: 0, upkeep: 0, wages: 0 }
  const isLeagueRound = Number.isInteger(number)

  for (const f of fixtures.filter((x) => x.number === number && x.played)) {
    const home = clubById[f.homeId]
    if (!home) continue
    const rng = new Rng((matchSeedNumber(career.seed, f.key + '#' + career.season) ^ 0xfeed) >>> 0)
    const gate = matchdayGate(home, clubById[f.awayId], positionOf(home.id), formOf(home.id), rng, f.type === 'cup')
    deltas[home.key] = (deltas[home.key] || 0) + gate.net
    if (home.id === career.clubId) {
      row.attendance = gate.attendance
      row.tickets = gate.tickets
      row.upkeep = gate.upkeep
    }
  }
  if (isLeagueRound) {
    for (const c of clubs) {
      const wages = wagesPerRound(playersByClub[c.id])
      deltas[c.key] = (deltas[c.key] || 0) - wages
      if (c.id === career.clubId) {
        row.wages = wages
      }
    }
  }

  const balances = {}
  await db.transaction('rw', db.careers, db.clubs, db.players, async () => {
    for (const c of clubs) {
      const d = deltas[c.key] || 0
      if (!d) continue
      const balance = c.budget + d
      balances[c.id] = balance
      if (c.key) await db.clubs.update(c.key, { budget: balance })
    }
    // Il rosa della cassa lo sente chi gioca nel club del mister.
    const userBalance = balances[career.clubId]
    if (userBalance !== undefined && userBalance < 0) {
      const userClubEntry = clubs.find((c) => c.id === career.clubId)
      const list = (playersByClub[career.clubId] || []).filter((p) => !p.youth)
      for (const p of list) {
        if (!p.key) continue
        const morale = clamp(p.morale - 2, 20, 99)
        if (morale !== p.morale) await db.players.update(p.key, { morale })
      }
      const already = (fin.mails || []).some((m) => m.kind === 'rosso')
      if (!already) {
        fin.mails = [
          ...(fin.mails || []),
          federationMail(career.coachName, userClubEntry ? userClubEntry.name : 'club', userBalance, career.season, number),
        ]
      }
    }
    fin.rounds = [...(fin.rounds || []), row]
    await db.careers.update(careerId, { finance: fin })
  })

  // Panchine a rischio (G5.1): ogni giornata guarda chi scotta. I club
  // esonerano in corsa, le panchine restano libere e il telefono del
  // mister squilla. Tutto dal seed: le sedie traballano in modo
  // deterministico, come ogni altra disgrazia di questo campionato.
  if (isLeagueRound) {
    const jobs = career.jobs || { offers: [], applied: [], invited: [], notices: [] }
    const jrng = new Rng(seedFromString(career.seed + ':jobs:' + career.season + ':' + number))
    const clubUpdates = []
    const notices = [...(jobs.notices || [])]
    const newOffers = []
    let userSacked = false
    const userClubEntry = clubs.find((c) => c.id === career.clubId) || null
    const trophies = userTrophies(career).length
    for (const c of clubs) {
      if (c.id === career.clubId) {
        // La sedia del mister scotta solo se la classifica va davvero male.
        if (number >= 12) {
          const pos = positionOf(c.id)
          const form = formOf(c.id)
          if (jrng.chance(sackProb(c, pos, form, true))) {
            userSacked = true
            clubUpdates.push({ key: c.key, patch: { manager: managerNameFor(career.seed, c.id, (c.hires || 0) + 1), hires: (c.hires || 0) + 1 } })
            notices.push({ round: number, kind: 'esonero', text: 'ESONERO — La dirigenza del ' + c.name + ' ringrazia per il lavoro e comunica la rescissione: la sedia scottava da troppo. Le valigie sono davanti alla porta.' })
          }
        }
        continue
      }
      if (!c.manager) {
        // Panchina libera: dopo due giornate il club assume chi trova.
        if ((c.sackRound || 0) <= number - 2 && jrng.chance(0.45)) {
          clubUpdates.push({ key: c.key, patch: { manager: managerNameFor(career.seed, c.id, (c.hires || 0) + 1), hires: (c.hires || 0) + 1, sackRound: null } })
          notices.push({ round: number, kind: 'assunzione', text: 'Il ' + c.name + ' ha trovato un nuovo mister: la panchina è di nuovo occupata.' })
        }
        continue
      }
      if (number < 10) continue
      const pos = positionOf(c.id)
      const form = formOf(c.id)
      if (!jrng.chance(sackProb(c, pos, form, false))) continue
      clubUpdates.push({ key: c.key, patch: { manager: null, sackRound: number } })
      notices.push({ round: number, kind: 'esonero', text: 'Il ' + c.name + ' ha esonerato ' + c.manager + ': la classifica non perdona e la panchina paga il conto.' })
      const chance = userClubEntry ? offerChance(c, userClubEntry, trophies) : offerChance(c, null, trophies)
      if (jrng.chance(chance)) {
        newOffers.push({
          clubId: c.id,
          round: number,
          text: userClubEntry
            ? 'Il ' + c.name + ' ha licenziato e ha il tuo numero: cercano un mister che sappia il fatto suo, anche a stagione in corso.'
            : 'Il ' + c.name + ' ha chiamato proprio te: panchina libera, stipendio vero, squadra arrabbiata.',
        })
      }
    }
    const willHire = new Set(clubUpdates.filter((u) => u.patch.manager).map((u) => u.key))
    const offersNow = [
      ...(jobs.offers || []).filter((o) => {
        const target = clubs.find((c) => c.id === o.clubId)
        return target && !target.manager && !willHire.has(target.key)
      }),
      ...newOffers,
    ]
    await db.transaction('rw', db.careers, db.clubs, async () => {
      for (const u of clubUpdates) await db.clubs.update(u.key, u.patch)
      await db.careers.update(careerId, {
        jobs: { offers: offersNow, applied: (jobs.applied || []), invited: (jobs.invited || []), notices: notices.slice(-40) },
      })
      if (userSacked) {
        await db.careers.update(careerId, {
          clubId: null,
          sacked: { season: career.season, round: number, clubId: userClubEntry ? userClubEntry.id : null, clubName: userClubEntry ? userClubEntry.name : '' },
        })
      }
    })
  }
}

/** Amplia lo stadio (G3): a scaglioni, a soldi sonanti. Quanti lavori si
 *  possano fare lo decide la struttura (livello stadio nelle facilities). */
export async function expandStadium(careerId) {
  const career = await db.careers.get(careerId)
  if (!career) throw new Error('Carriera non trovata')
  const club = await db.clubs.get(careerId + ':' + career.clubId)
  if (!club) throw new Error('Club non trovato')
  const info = expansionInfo(club)
  if (!info.canDo) throw new Error('La struttura non regge altri lavori: serve uno stadio di livello superiore')
  if (club.budget < info.cost) throw new Error('Cassa insufficiente: servono ' + info.cost / 1000000 + 'M')
  const fin = career.finance || { season: career.season, settled: [], rounds: [], mails: [] }
  await db.transaction('rw', db.careers, db.clubs, async () => {
    await db.clubs.update(club.key, {
      budget: club.budget - info.cost,
      expansions: info.done + 1,
      stadium: { ...club.stadium, capacity: info.nextCapacity },
    })
    await db.careers.update(careerId, { finance: { ...fin, expansions: (fin.expansions || 0) + info.cost } })
  })
  return info
}

/** Prestito secco (G3): il giocatore si trasferisce fino a fine stagione,
 *  poi torna a casa sua. Niente proprietà: niente vendita. */
export async function loanPlayer(careerId, playerKey, fromClubKey, toClubKey, fee) {
  await db.transaction('rw', db.players, db.clubs, async () => {
    const [p, from, to] = await Promise.all([
      db.players.get(playerKey),
      db.clubs.get(fromClubKey),
      db.clubs.get(toClubKey),
    ])
    if (!p || !from || !to) throw new Error('Prestito non valido')
    if (to.budget < fee) throw new Error('Cassa insufficiente')
    if (p.loanFrom) throw new Error('Già in prestito: i prestiti dei prestiti non esistono')
    await db.players.update(playerKey, { clubId: to.id, loanFrom: from.id })
    await db.clubs.update(fromClubKey, { budget: from.budget + fee })
    await db.clubs.update(toClubKey, { budget: to.budget - fee })
    const all = await db.players.where('careerId').equals(careerId).toArray()
    for (const club of [from, to]) {
      const seniors = all.filter((x) => x.clubId === club.id && !x.youth)
      const avg = seniors.length ? Math.round(seniors.reduce((s, x) => s + x.ovr, 0) / seniors.length) : club.avgOvr
      await db.clubs.update(club.key, { avgOvr: avg })
    }
  })
}

/** Firma lo sponsor della stagione (G3.1): la base finisce subito in
 *  cassa, il bonus arriva solo se l'obiettivo si riesce. Una firma a
 *  stagione: una faccia sola sul petto. */
export async function signSponsor(careerId, offerIndex) {
  const career = await db.careers.get(careerId)
  if (!career) throw new Error('Carriera non trovata')
  const fin = career.finance
  if (!fin || fin.season !== career.season) throw new Error('Nessuna trattativa aperta per questa stagione')
  if (fin.sponsor) throw new Error('Lo sponsor è già firmato: una faccia sola sul petto')
  const deal = (fin.sponsorPool || [])[offerIndex]
  if (!deal) throw new Error("Offerta non trovata: l'agente ha già riattaccato")
  await db.transaction('rw', db.careers, db.clubs, async () => {
    const club = await db.clubs.get(careerId + ':' + career.clubId)
    if (!club) throw new Error('Club non trovato')
    await db.clubs.update(club.key, { budget: club.budget + deal.base })
    await db.careers.update(careerId, { finance: { ...fin, sponsor: deal } })
  })
  return deal
}

/** Candidatura (G5.1): il mister bussa a una porta senza padrone. La
 *  risposta arriva subito — i presidenti non dormono, e nella stessa
 *  stagione non cambiano idea due volte. */
export async function applyForJob(careerId, clubId) {
  const { career, clubs } = await loadCareer(careerId)
  const club = clubs.find((c) => c.id === clubId)
  if (!club) throw new Error('Club non trovato')
  if (club.id === career.clubId) throw new Error('Quella panchina è già tua, mister')
  if (club.manager) throw new Error('Panchina occupata: qualcuno è stato più veloce')
  const jobs = career.jobs || { offers: [], applied: [], invited: [], notices: [] }
  if ((jobs.applied || []).includes(clubId)) {
    return { ok: false, reason: 'Hanno già il tuo curriculum: la risposta era no. I presidenti cambiano idea, ma non subito.' }
  }
  const userClubEntry = clubs.find((c) => c.id === career.clubId) || null
  const trophies = userTrophies(career).length
  const rng = new Rng(seedFromString(career.seed + ':apply:' + career.season + ':' + clubId))
  const hit = rng.chance(applyProb(club, userClubEntry, trophies, !career.clubId))
  const applied = [...(jobs.applied || []), clubId]
  const invited = hit ? [...(jobs.invited || []), clubId] : [...(jobs.invited || [])]
  const notices = [...(jobs.notices || [])]
  if (hit) {
    notices.push({ round: null, kind: 'invito', text: 'Il ' + club.name + ' ha sfogliato il tuo curriculum e vuole incontrarti: la panchina è tua, se la prendi.' })
  } else {
    notices.push({ round: null, kind: 'rifiuto', text: 'Il ' + club.name + ' ringrazia: cercano un profilo diverso. Il calcio è crudele anche con i curriculum.' })
  }
  await db.careers.update(careerId, { jobs: { offers: (jobs.offers || []), applied, invited, notices: notices.slice(-40) } })
  return { ok: hit, reason: hit ? null : 'Il club ringrazia, ma dice di no: cercano un profilo diverso.' }
}

/** Firma la nuova panchina (G5.1): si lascia il club attuale (che assume
 *  subito un nome nuovo) e si prende la sedia libera. Lo sponsor si
 *  rinegozia col club che arriva: la base l'ha già incassata lui. */
export async function takeJob(careerId, clubId) {
  const { career, clubs } = await loadCareer(careerId)
  const club = clubs.find((c) => c.id === clubId)
  if (!club) throw new Error('Club non trovato')
  if (club.manager) throw new Error('Panchina occupata: sei stato lento, mister')
  const jobs = career.jobs || { offers: [], applied: [], invited: [], notices: [] }
  const oldClub = clubs.find((c) => c.id === career.clubId) || null
  const notices = [...(jobs.notices || []), { round: null, kind: 'ingaggio', text: 'Il ' + club.name + ' ti aspetta allo studio: panchina tua, sedia calda, stipendio vero.' }]
  const fin = career.finance || {}
  const aiSponsors = { ...(fin.aiSponsors || {}) }
  delete aiSponsors[club.id]
  await db.transaction('rw', db.careers, db.clubs, async () => {
    if (oldClub && oldClub.key) {
      await db.clubs.update(oldClub.key, { manager: managerNameFor(career.seed, oldClub.id, (oldClub.hires || 0) + 1), hires: (oldClub.hires || 0) + 1 })
    }
    if (club.key) await db.clubs.update(club.key, { sackRound: null })
    await db.careers.update(careerId, {
      clubId: club.id,
      sacked: null,
      jobs: {
        offers: (jobs.offers || []).filter((o) => o.clubId !== club.id),
        applied: (jobs.applied || []),
        invited: (jobs.invited || []).filter((x) => x !== club.id),
        notices: notices.slice(-40),
      },
      finance: { ...fin, sponsor: null, sponsorPool: makeSponsorOffers(career.seed, career.season, club, null), aiSponsors },
    })
  })
}

/** Rifiuta una offerta di lavoro (G5.1): il telefono richiamerà, con altri. */
export async function declineOffer(careerId, clubId) {
  const career = await db.careers.get(careerId)
  if (!career) return
  const jobs = career.jobs || { offers: [], applied: [], invited: [], notices: [] }
  await db.careers.update(careerId, { jobs: { ...jobs, offers: (jobs.offers || []).filter((o) => o.clubId !== clubId) } })
}

export async function deleteCareer(id) {
  await db.transaction('rw', db.careers, db.clubs, db.players, db.fixtures, async () => {
    await db.careers.delete(id)
    await Promise.all([db.clubs, db.players, db.fixtures].map((t) => t.where('careerId').equals(id).delete()))
  })
}

/** Scrive i risultati di una o più partite giocate. */
export async function saveFixtureResults(results) {
  await db.transaction('rw', db.fixtures, async () => {
    for (const r of results) {
      await db.fixtures.update(r.key, { played: true, homeGoals: r.homeGoals, awayGoals: r.awayGoals, winnerId: r.winnerId !== undefined ? r.winnerId : null })
    }
  })
}

/**
 * Post-partita della squadra dell'utente: morale (+5/-5/+1, +2 ai marcatori),
 * statistiche stagionali (presenze, minuti, gol) e infortuni di entrambe
 * le squadre (injuredUntil = giornate di stop, inclusa quella corrente).
 */
export async function applyPostMatch(careerId, fixture, result, userClubId, userPlayers, allPlayers) {
  const isHome = fixture.homeId === userClubId
  const userSide = isHome ? 'home' : 'away'
  const userGoals = isHome ? result.homeGoals : result.awayGoals
  const oppGoals = isHome ? result.awayGoals : result.homeGoals
  let delta = userGoals > oppGoals ? 5 : userGoals < oppGoals ? -5 : 1
  // La Coppa non conosce i pareggi: i rigori contano come vittoria o sconfitta.
  if (fixture.type === 'cup' && userGoals === oppGoals) {
    delta = result.cupWinnerId === userClubId ? 3 : -2
  }

  const goalCounts = {}
  for (const e of result.events) {
    if (e.type === 'goal' && e.side === userSide && e.playerId) {
      goalCounts[e.playerId] = (goalCounts[e.playerId] || 0) + 1
    }
  }
  const minutes = result.minutesPlayed || {}
  const byId = new Map((allPlayers || []).map((p) => [p.id, p]))
  const injuries = result.events.filter((e) => e.type === 'injury' && e.playerId && e.weeks)

  await db.transaction('rw', db.players, async () => {
    for (const p of userPlayers) {
      const min = minutes[p.id] || 0
      let morale = clamp(p.morale + delta, 20, 99)
      if (goalCounts[p.id]) morale = clamp(morale + 2 * goalCounts[p.id], 20, 99)
      const updates = { morale }
      if (min > 0) {
        updates.apps = (p.apps || 0) + 1
        updates.minutes = (p.minutes || 0) + min
        updates.goals = (p.goals || 0) + (goalCounts[p.id] || 0)
      }
      if (p.key) await db.players.update(p.key, updates)
    }
    for (const e of injuries) {
      const p = byId.get(e.playerId)
      if (p && p.key) await db.players.update(p.key, { injuredUntil: Math.floor(fixture.number) + e.weeks })
    }
    await writeSuspensions(fixture, result.events, byId)
  })
}

/** Partite simulate in background: la lega si infortuna e si squalifica quanto te. */
export async function applyAiMatchday(fixture, events, allPlayers) {
  const byId = new Map((allPlayers || []).map((p) => [p.id, p]))
  const injuries = events.filter((e) => e.type === 'injury' && e.playerId && e.weeks)
  const cardsOrReds = events.some((e) => e.playerId && (e.type === 'card' || e.type === 'red'))
  if (!injuries.length && !cardsOrReds) return
  await db.transaction('rw', db.players, async () => {
    for (const e of injuries) {
      const p = byId.get(e.playerId)
      if (p && p.key) await db.players.update(p.key, { injuredUntil: Math.floor(fixture.number) + e.weeks })
    }
    await writeSuspensions(fixture, events, byId)
  })
}

/**
 * Trasferisce un giocatore tra due club (F4): budget aggiustato, contratto
 * nuovo per chi arriva, media OVR ricalcolata per entrambe le squadre.
 * Attenzione a non chiamarla con budget insufficienti: il mercato è già
 * abbastanza crudele senza errori di contabilità.
 */
export async function transferPlayer(careerId, playerKey, fromClubKey, toClubKey, fee, contractUntil) {
  await db.transaction('rw', db.players, db.clubs, async () => {
    const [p, from, to] = await Promise.all([
      db.players.get(playerKey),
      db.clubs.get(fromClubKey),
      db.clubs.get(toClubKey),
    ])
    if (!p || !from || !to) throw new Error('Trasferimento non valido')
    if (to.budget < fee) throw new Error('Budget insufficiente')
    await db.players.update(playerKey, { clubId: to.id, contractUntil })
    await db.clubs.update(fromClubKey, { budget: from.budget + fee })
    await db.clubs.update(toClubKey, { budget: to.budget - fee })
    const all = await db.players.where('careerId').equals(careerId).toArray()
    for (const club of [from, to]) {
      const seniors = all.filter((x) => x.clubId === club.id && !x.youth)
      const avg = seniors.length ? Math.round(seniors.reduce((s, x) => s + x.ovr, 0) / seniors.length) : club.avgOvr
      await db.clubs.update(club.key, { avgOvr: avg })
    }
  })
}

/** Costo per portare l'osservatorio al livello indicato (2 → 5). */
export const SCOUT_UPGRADE_COST = { 2: 2000000, 3: 4000000, 4: 8000000, 5: 15000000 }

/**
 * Potenzia la rete di osservatori (F5): il budget paga, e la Primavera
 * si rilegge più precisa. Deterministico: stesso livello, stesse letture.
 */
export async function upgradeScouts(careerId) {
  await db.transaction('rw', db.careers, db.clubs, async () => {
    const career = await db.careers.get(careerId)
    const club = await db.clubs.get(careerId + ':' + career.clubId)
    const level = (career.scouts && career.scouts.level) || 1
    if (level >= 5) throw new Error('Osservatorio già al massimo')
    const cost = SCOUT_UPGRADE_COST[level + 1]
    if (club.budget < cost) throw new Error('Budget insufficiente: servono ' + cost / 1000000 + 'M')
    await db.clubs.update(club.key, { budget: club.budget - cost })
    await db.careers.update(careerId, { scouts: { ...(career.scouts || { level: 1, focus: null }), level: level + 1 } })
  })
}

/** Sposta il focus degli osservatori: gratis, ma la rilettura cambia. */
export async function setScoutFocus(careerId, focus) {
  const career = await db.careers.get(careerId)
  if (!career) return
  await db.careers.update(careerId, { scouts: { ...(career.scouts || { level: 1, focus: null }), focus: focus || null } })
}

/** Occhi sui Grandi (G4): report su un senior avversario. Costo fisso,
 *  verità permanente: OVR, attributi e abilità di un uomo, per sempre. */
export async function scoutPlayer(careerId, playerId) {
  await db.transaction('rw', db.careers, db.clubs, db.players, async () => {
    const career = await db.careers.get(careerId)
    if (!career) throw new Error('Carriera non trovata')
    const player = await db.players.get(careerId + ':' + playerId)
    if (!player) throw new Error('Giocatore non trovato')
    if (player.clubId === career.clubId) throw new Error('Quello è già della tua squadra: i tuoi li vedi gratis')
    if ((career.scouted || []).includes(playerId)) throw new Error('Report già nel cassetto: la verità non si paga due volte')
    const club = await db.clubs.get(careerId + ':' + career.clubId)
    if (!club || club.budget < SCOUT_REPORT_COST) throw new Error('Cassa insufficiente: il report costa ' + SCOUT_REPORT_COST / 1000 + 'k')
    await db.clubs.update(club.key, { budget: club.budget - SCOUT_REPORT_COST })
    await db.careers.update(careerId, { scouted: [...(career.scouted || []), playerId] })
  })
}


/**
 * Chiude la stagione: assegna il titolo, fa crescere (o invecchiare) i
 * giocatori attributo per attributo, lascia che la lega si rinforzi sul
 * mercato, promuove i Primavera che compiono 19 anni, azzera le
 * statistiche, guarisce gli infortuni e genera il calendario nuovo.
 * Deterministica dal seed: stessa carriera, stesso futuro.
 * Ritorna il riepilogo per la schermata di fine stagione.
 */
export async function endSeason(careerId) {
  const { career, clubs, players, fixtures } = await loadCareer(careerId)
  const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]))

  // Classifica per lega (G1): il titolo è della tua serie, la Piramide
  // però guarda tutte.
  const standingsByLeague = {}
  for (const l of LEAGUES) standingsByLeague[l.id] = computeStandings(clubs, fixtures, l.id)

  // La Federazione fa i conti (G3): chi chiude in rosso perde punti —
  // un punto ogni 1,5M di debito, massimo 15 — sulla classifica finale.
  const deductions = {}
  for (const c of clubs) {
    const pts = penaltyPoints(c.budget)
    if (pts > 0) deductions[c.id] = pts
  }
  for (const l of LEAGUES) {
    const rows = standingsByLeague[l.id]
    rows.forEach((rw) => {
      const dp = deductions[rw.clubId] || 0
      if (dp) rw.pts -= dp
    })
    rows.sort(
      (x, y) =>
        y.pts - x.pts ||
        (y.gf - y.ga) - (x.gf - x.ga) ||
        y.gf - x.gf ||
        x.name.localeCompare(y.name),
    )
  }
  // Senza panchina a fine stagione (G5.1): qualche disperato chiama
  // sempre. Il club in maggiore difficoltà apre lo studio e la
  // carriera continua — il calcio non aspetta i sentimenti.
  let summerJobName = null
  if (!career.clubId) {
    const desperate = []
    for (const l of LEAGUES) {
      const rows = standingsByLeague[l.id] || []
      rows.forEach((rw, i) => { if (i >= 12) desperate.push(rw.clubId) })
    }
    const jrng = new Rng(seedFromString(career.seed + ':summerjob:' + career.season))
    const pool = desperate.length ? desperate : clubs.map((c) => c.id)
    const chosenId = jrng.pick(pool)
    career.clubId = chosenId
    const chosen = clubById[chosenId]
    summerJobName = chosen ? chosen.name : 'il club'
    career.finance = career.finance ? { ...career.finance, sponsor: null } : { season: career.season, settled: [], rounds: [], mails: [] }
    if (chosen && chosen.key) await db.clubs.update(chosen.key, { sackRound: null, manager: null })
  }
  const userClubRow = clubById[career.clubId]
  const userLeague = LEAGUES.find((l) => l.id === (userClubRow && userClubRow.leagueId)) || LEAGUES[0]
  const standings = standingsByLeague[userLeague.id]
  const champion = standings[0]

  const summary = {
    season: career.season,
    summerJob: summerJobName,
    userLeagueName: userLeague.name,
    champion: champion.name,
    userPosition: standings.findIndex((r) => r.clubId === career.clubId) + 1,
    userChampion: champion.clubId === career.clubId,
    promoted: [],
    relegated: [],
    userPromoted: false,
    userRelegated: false,
    progressed: [],
    declined: [],
  }

  summary.deductions = Object.entries(deductions)
    .map(([cid, pts]) => ({ name: (clubById[cid] || {}).name || cid, points: pts, balance: (clubById[cid] || {}).budget || 0 }))
    .sort((a, b) => b.points - a.points)
  summary.userDeduction = deductions[career.clubId] || 0
  // I conti della stagione (G3): il registro della cassa parla.
  const finRounds = (career.finance && career.finance.rounds) || []
  summary.finance = {
    tickets: finRounds.reduce((s, x) => s + (x.tickets || 0), 0),
    sponsorBase: (career.finance && career.finance.sponsor) ? career.finance.sponsor.base : 0,
    upkeep: finRounds.reduce((s, x) => s + (x.upkeep || 0), 0),
    wages: finRounds.reduce((s, x) => s + (x.wages || 0), 0),
    expansions: (career.finance && career.finance.expansions) || 0,
    endBalance: userClubRow ? userClubRow.budget : 0,
  }

  // Prima dell'estate si chiude la Coppa: se il mister è ancora dentro,
  // qui decide tutto in simulazione (il bottone di fine stagione appare
  // solo quando non ha più partite da giocare).
  const cupWinnerId = await closeCup(careerId, career, clubs, players)
  const cupWinnerName = cupWinnerId && clubById[cupWinnerId] ? clubById[cupWinnerId].name : null
  summary.cupWinner = cupWinnerName
  summary.userCupWinner = cupWinnerId === career.clubId

  // G5: i capocannonieri della stagione, contati prima che le
  // statistiche si azzerino — a giugno la storia vuole i nomi.
  const scorersByLeague = {}
  for (const l of LEAGUES) scorersByLeague[l.id] = seasonTopScorer(players, clubs, l.id)

  const baseSeed = career.seed + ':' + career.season + ':'

  // I risultati valgono oro (G3.1): chi li ha messi in bacheca a giugno
  // trova più sponsor alla porta. Posizioni e trofei contati sulla
  // classifica finale, penalità comprese.
  const promotedIds = new Set(((standingsByLeague[LEAGUES[1].id] || []).slice(0, 2)).map((r) => r.clubId))
  const sponsorSeasonCtx = {}
  for (const l of LEAGUES) {
    ;(standingsByLeague[l.id] || []).forEach((rw, i) => {
      sponsorSeasonCtx[rw.clubId] = {
        position: i + 1,
        champion: i === 0,
        cupWinner: rw.clubId === cupWinnerId,
        promoted: promotedIds.has(rw.clubId),
      }
    })
  }

  // Statistiche sintetiche per i club AI, così anche la lega evolves:
  // i titolari giocano, le riserve rosicchiano, gli altri guardano.
  for (const c of clubs) {
    if (c.id === career.clubId) continue
    const rng = new Rng(seedFromString(baseSeed + 'ai:' + c.id))
    const seniors = players
      .filter((p) => p.clubId === c.id && !p.youth)
      .sort((a, b) => b.ovr - a.ovr)
    seniors.forEach((p, i) => {
      const minutes = i < 11 ? rng.int(1800, 2700) : i < 16 ? rng.int(300, 1200) : rng.int(0, 300)
      p.minutes = minutes
      p.apps = Math.round(minutes / 85)
    })
  }

  // NB: clubs serve dentro la transazione (media OVR e budget): ometterlo
  // dallo scope fa fallire tutta la transazione su Dexie.
  await db.transaction('rw', db.careers, db.clubs, db.players, db.fixtures, async () => {
    // I prestiti tornano a casa (G3): fine stagione, si restituisce la merce.
    for (const p of players) {
      if (p.loanFrom && p.loanFrom !== p.clubId && p.key) {
        p.clubId = p.loanFrom
        await db.players.update(p.key, { clubId: p.loanFrom, loanFrom: null })
      }
    }
    for (const p of players) {
      const club = clubById[p.clubId]
      const youthLevel = (club && club.facilities && club.facilities.youthLevel) || 1
      const rng = new Rng(seedFromString(baseSeed + p.id))
      const growth = seasonGrowth(rng, p, youthLevel)
      const age = p.age + 1
      const target = growth > 0 ? Math.min(p.ovr + growth, p.potential) : p.ovr + growth
      let ovr = target
      let attributes = p.attributes
      if (attributes) {
        attributes = growth > 0
          ? growAttrs(attributes, p.role, target, rng)
          : growth < 0
            ? declineAttrs(attributes, p.role, target, rng)
            : attributes
        ovr = deriveOvr(attributes, p.role)
      }
      const updates = {
        ovr,
        age,
        attributes,
        youth: p.youth && age < 19,
        value: Math.max(30000, Math.round((playerValue(ovr, age, p.potential) * (1 + abilityValueBonus(p.abilities))) / 10000) * 10000),
        apps: 0,
        minutes: 0,
        goals: 0,
        injuredUntil: null,
        bannedUntil: null,
        cards: 0,
      }
      if (p.clubId === career.clubId && growth !== 0) {
        const entry = { name: p.name, from: p.ovr, to: ovr, youth: p.youth }
        if (growth > 0) summary.progressed.push(entry)
        else summary.declined.push(entry)
      }
      p.ovr = ovr
      p.attributes = attributes
      if (p.key) await db.players.update(p.key, updates)
    }

    // Il mercato estivo della lega: anche i club AI si rinforzano, tra loro.
    const byClubNow = {}
    for (const p of players) (byClubNow[p.clubId] = byClubNow[p.clubId] || []).push(p)
    const aiClubs = clubs.filter((c) => c.id !== career.clubId)
    const budgets = Object.fromEntries(clubs.map((c) => [c.id, c.budget]))
    for (const deal of aiTransferDeals(career.seed, career.season, aiClubs, byClubNow)) {
      if ((budgets[deal.toId] || 0) < deal.fee) continue
      const p = players.find((x) => x.key === deal.playerKey)
      if (!p || !p.key || p.clubId !== deal.fromId) continue
      budgets[deal.fromId] += deal.fee
      budgets[deal.toId] -= deal.fee
      p.clubId = deal.toId
      await db.players.update(p.key, { clubId: deal.toId, contractUntil: deal.contractUntil })
    }
    // Gli sponsor pagano i bonus (G3.1): gli obiettivi si contano sulla
    // classifica appena chiusa, penalità comprese. Il sogno di giugno si
    // incassa qui.
    const seasonDeals = { ...((career.finance && career.finance.aiSponsors) || {}) }
    if (career.finance && career.finance.sponsor) seasonDeals[career.clubId] = career.finance.sponsor
    for (const c of clubs) {
      const deal = seasonDeals[c.id]
      if (!deal) continue
      const bonus = sponsorBonus(deal, sponsorSeasonCtx[c.id] || {})
      if (bonus) {
        budgets[c.id] += bonus
        if (c.id === career.clubId) {
          summary.finance.sponsorBonus = bonus
          summary.finance.endBalance = (summary.finance.endBalance || 0) + bonus
        }
      }
    }

    for (const c of clubs) {
      if (c.budget !== budgets[c.id] && c.key) await db.clubs.update(c.key, { budget: budgets[c.id] })
    }

    // Media OVR aggiornata per ogni club (i Primavera promossi a 19 anni
    // contano già come senior).
    for (const c of clubs) {
      const list = players.filter((p) => p.clubId === c.id && !(p.youth && p.age + 1 < 19))
      const avg = list.length ? Math.round(list.reduce((s, p) => s + p.ovr, 0) / list.length) : c.avgOvr
      if (c.key) await db.clubs.update(c.key, { avgOvr: avg })
    }

    // La Piramide (G1): due su dalla cadetta, due giù dalla massima. I club
    // cambiano serie e i soldi li seguono — in una direzione o nell'altra.
    const topLeague = LEAGUES[0]
    const bottomLeague = LEAGUES[1]
    const relegatedRows = (standingsByLeague[topLeague.id] || []).slice(-2)
    const promotedRows = (standingsByLeague[bottomLeague.id] || []).slice(0, 2)
    const swapRng = new Rng(seedFromString(baseSeed + 'promotions'))
    for (const row of promotedRows) {
      const c = clubById[row.clubId]
      if (!c) continue
      c.leagueId = topLeague.id
      const budget = (budgets[row.clubId] || 0) + swapRng.int(6, 12) * 1e6
      budgets[row.clubId] = budget
      summary.promoted.push(c.name)
      if (row.clubId === career.clubId) summary.userPromoted = true
      if (c.key) {
        await db.clubs.update(c.key, {
          leagueId: topLeague.id,
          reputation: clamp(c.reputation + 6, 30, 95),
          budget,
        })
      }
    }
    for (const row of relegatedRows) {
      const c = clubById[row.clubId]
      if (!c) continue
      c.leagueId = bottomLeague.id
      const budget = Math.max(500000, Math.round((budgets[row.clubId] || 0) * 0.7))
      budgets[row.clubId] = budget
      summary.relegated.push(c.name)
      if (row.clubId === career.clubId) summary.userRelegated = true
      if (c.key) {
        await db.clubs.update(c.key, {
          leagueId: bottomLeague.id,
          reputation: clamp(c.reputation - 6, 30, 95),
          budget,
        })
      }
    }

    // Sponsor della stagione che viene (G3.1): serie e blasone sono
    // già quelli nuovi — un promosso riceve offerte da promosso. Il
    // pool resta del mister, i club AI firmano e incassano la base.
    const nextFinance = {
      season: career.season + 1,
      settled: [],
      rounds: [],
      mails: [],
      sponsor: null,
      sponsorPool: makeSponsorOffers(career.seed, career.season + 1, clubById[career.clubId], sponsorSeasonCtx[career.clubId] || null),
    }
    const nextAiSponsors = {}
    for (const c of clubs) {
      if (c.id === career.clubId) continue
      const deal = bestSponsorOffer(makeSponsorOffers(career.seed, career.season + 1, c, sponsorSeasonCtx[c.id] || null))
      if (!deal) continue
      nextAiSponsors[c.id] = deal
      budgets[c.id] += deal.base
    }
    nextFinance.aiSponsors = nextAiSponsors
    for (const c of clubs) {
      if (c.budget !== budgets[c.id] && c.key) await db.clubs.update(c.key, { budget: budgets[c.id] })
    }

    await db.careers.update(careerId, {
      season: career.season + 1,
      clubId: career.clubId,
      sacked: null,
      jobs: { offers: [], applied: [], invited: [], notices: (((career.jobs || {}).notices) || []).slice(-40) },
      finance: nextFinance,
      trophies: [
        ...(career.trophies || []),
        ...LEAGUES.map((l) => {
          const ch = standingsByLeague[l.id][0]
          return { season: career.season, competition: l.name, championId: ch.clubId, championName: ch.name, user: ch.clubId === career.clubId }
        }),
        ...(cupWinnerId ? [{ season: career.season, competition: CUP_NAME, championId: cupWinnerId, championName: cupWinnerName, user: cupWinnerId === career.clubId }] : []),
      ],
      history: [
        ...(career.history || []),
        {
          season: career.season,
          champions: LEAGUES.map((l) => {
            const ch = standingsByLeague[l.id][0]
            return { leagueId: l.id, leagueName: l.name, clubId: ch.clubId, name: ch.name }
          }),
          cup: cupWinnerId ? { clubId: cupWinnerId, name: cupWinnerName } : null,
          scorers: LEAGUES.map((l) => ({ leagueId: l.id, leagueName: l.name, scorer: scorersByLeague[l.id] })),
          user: {
            clubId: career.clubId,
            leagueName: userLeague.name,
            position: summary.userPosition,
            champion: summary.userChampion,
            cupWinner: summary.userCupWinner,
            promoted: summary.userPromoted,
            relegated: summary.userRelegated,
          },
        },
      ],
    })

    await db.fixtures.where('careerId').equals(careerId).delete()
    await db.fixtures.bulkAdd(buildLeagueFixtures(careerId, clubs, (career.seed ^ (0x5ced + career.season)) >>> 0))
  })

  // Nuova stagione, nuova Coppa: le prime 8 di ogni serie della stagione
  // appena chiusa si guadagnano il posto a tavolino.
  const cupQualifiersNext = [
    ...(standingsByLeague[LEAGUES[0].id] || []).slice(0, 8),
    ...(standingsByLeague[LEAGUES[1].id] || []).slice(0, 8),
  ].map((r) => clubById[r.clubId]).filter(Boolean)
  await createCupFirstRound(careerId, cupQualifiersNext, career.seed, career.season + 1)

  const weight = (x) => Math.abs(x.to - x.from)
  summary.progressed.sort((a, b) => weight(b) - weight(a))
  summary.declined.sort((a, b) => weight(b) - weight(a))
  return summary
}

const stripKeys = ({ key, careerId, ...rest }) => rest

/** Esporta la carriera in JSON (condivisibile, riportabile su un altro device). */
export async function exportCareer(id) {
  const { career, clubs, players, fixtures } = await loadCareer(id)
  const meta = { ...career }
  delete meta.id
  return JSON.stringify({
    app: 'pitchtory',
    format: 1,
    career: meta,
    clubs: clubs.map(stripKeys),
    players: players.map(stripKeys),
    fixtures: fixtures.map(stripKeys),
  })
}

/** Importa una carriera esportata. Ritorna l'id della nuova carriera. */
export async function importCareer(json) {
  const data = JSON.parse(json)
  if (data.app !== 'pitchtory' || data.format !== 1) throw new Error('File di carriera non riconosciuto')
  const careerId = await db.careers.add({ ...data.career, imported: true })
  await db.transaction('rw', db.clubs, db.players, db.fixtures, async () => {
    await db.clubs.bulkAdd(data.clubs.map((c) => ({ ...c, key: careerId + ':' + c.id, careerId })))
    await db.players.bulkAdd(data.players.map((p) => ({ ...p, key: careerId + ':' + p.id, careerId })))
    await db.fixtures.bulkAdd(data.fixtures.map((f, i) => ({ ...f, key: careerId + ':i' + i, careerId })))
  })
  return careerId
}
