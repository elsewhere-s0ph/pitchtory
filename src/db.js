



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

  const careerId = await db.careers.add({
    seed,
    seedText: seedText || null,
    coachName: coachName || 'Mister',
    clubId,
    season: universe.season,
    settings: { matchDuration },
    universeVersion: UNIVERSE_VERSION,
    scouts: { level: 1, focus: null },
    trophies: [],
    createdAt: new Date().toISOString(),
  })

  await db.transaction('rw', db.clubs, db.players, db.fixtures, async () => {
    await db.clubs.bulkAdd(universe.clubs.map((c) => ({ key: careerId + ':' + c.id, careerId, ...c })))
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
  })

  return careerId
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
  const userClubRow = clubById[career.clubId]
  const userLeague = LEAGUES.find((l) => l.id === (userClubRow && userClubRow.leagueId)) || LEAGUES[0]
  const standings = standingsByLeague[userLeague.id]
  const champion = standings[0]

  const summary = {
    season: career.season,
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

  // Prima dell'estate si chiude la Coppa: se il mister è ancora dentro,
  // qui decide tutto in simulazione (il bottone di fine stagione appare
  // solo quando non ha più partite da giocare).
  const cupWinnerId = await closeCup(careerId, career, clubs, players)
  const cupWinnerName = cupWinnerId && clubById[cupWinnerId] ? clubById[cupWinnerId].name : null
  summary.cupWinner = cupWinnerName
  summary.userCupWinner = cupWinnerId === career.clubId

  const baseSeed = career.seed + ':' + career.season + ':'

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

    await db.careers.update(careerId, {
      season: career.season + 1,
      trophies: [
        ...(career.trophies || []),
        ...LEAGUES.map((l) => {
          const ch = standingsByLeague[l.id][0]
          return { season: career.season, competition: l.name, championId: ch.clubId, championName: ch.name }
        }),
        ...(cupWinnerId ? [{ season: career.season, competition: CUP_NAME, championId: cupWinnerId, championName: cupWinnerName }] : []),
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
