/**
 * Cassa e Stadio (G3): l'economia del club, pura e deterministica.
 * Ogni partita in casa incassa biglietti secondo capienza, posizione,
 * forma e blasone dell'ospite; ogni giornata di campionato paga gli
 * stipendi a tutti; lo sponsor si firma a inizio stagione (G3.1), con
 * base subito e bonus sugli obiettivi; chi finisce in rosso se la
 * vede con la Federazione, e la Federazione non sorride. Niente tabelle
 * segrete: solo conti della serva e seed.
 */
import { Rng, seedFromString } from '../lib/rng'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Prezzo del biglietto per serie (la Coppa si paga qualcosa in più). */
export const TICKET_PRICE = { c: 14, a: 8 }
export const CUP_TICKET_MULTIPLIER = 1.25
/** Manutenzione dello stadio, per posto, a ogni partita in casa. */
export const UPKEEP_PER_SEAT = 1.5
/** Sponsor e stipendi si contano sulle 38 giornate di campionato. */
export const LEAGUE_ROUNDS = 38

/** Capienza attuale dello stadio (i lavori contano). */
export function capacityOf(club) {
  return (club && club.stadium && club.stadium.capacity) || 0
}

/** Tasso di affluenza: 62% di base, + posizione in classifica, + forma,
 *  + blasone dell'ospite, + un pizzico di rumore dal seed. */
export function attendanceRate(position, form, oppReputation, rng) {
  const pos = position || 10
  const posBonus = clamp((20 - pos) * 0.011, 0, 0.22)
  const formBonus = clamp(((form.wins || 0) - (form.losses || 0)) * 0.02, -0.08, 0.1)
  const oppBonus = clamp(((oppReputation || 55) - 55) / 400, -0.05, 0.12)
  const noise = (rng.float() - 0.5) * 0.06
  return clamp(0.62 + posBonus + formBonus + oppBonus + noise, 0.35, 1)
}

/** Incasso di una partita in casa: biglietti meno manutenzione. */
export function matchdayGate(club, oppClub, position, form, rng, isCup) {
  const capacity = capacityOf(club)
  const rate = attendanceRate(position, form, oppClub ? oppClub.reputation : 55, rng)
  const attendance = Math.round(capacity * rate)
  const price = (TICKET_PRICE[club.leagueId] || 10) * (isCup ? CUP_TICKET_MULTIPLIER : 1)
  const tickets = Math.round(attendance * price)
  const upkeep = Math.round(capacity * UPKEEP_PER_SEAT)
  return { attendance, tickets, upkeep, net: tickets - upkeep }
}

/** Monte ingaggi per giornata: la somma degli stipendi annuali sulle 38. */
export function wagesPerRound(playersOfClub) {
  const seniors = (playersOfClub || []).filter((p) => !p.youth)
  const total = seniors.reduce((s, p) => s + (p.wage || 0), 0)
  return Math.round(total / LEAGUE_ROUNDS)
}

/** Ampliamento dello stadio: scaglioni da 4.000 posti, costi crescenti.
 *  Quanti lavori si possano fare lo dice la struttura: il livello stadio. */
export const EXPANSION_SEATS = 4000

export function expansionInfo(club) {
  const topFlight = club.leagueId !== 'a'
  const done = club.expansions || 0
  const max = (club.facilities && club.facilities.stadiumLevel) || 1
  const cost = topFlight ? 4000000 + done * 2000000 : 1000000 + done * 500000
  return {
    done,
    max,
    canDo: done < max,
    cost,
    seats: EXPANSION_SEATS,
    nextCapacity: capacityOf(club) + EXPANSION_SEATS,
  }
}

/** La Federazione guarda il rosso: un punto ogni 1,5M di debito, max 15. */
export function penaltyPoints(balance) {
  if (balance >= 0) return 0
  return clamp(Math.ceil(-balance / 1500000), 1, 15)
}

/** La lettera della Federazione: cortese, ferrea, senza appello. */
export function federationMail(coachName, clubName, balance, season, round) {
  const debt = -balance
  return {
    kind: 'rosso',
    season,
    round,
    title: 'Comunicato ufficiale — Amministrazione sorvegliata',
    body:
      'Egregio ' + (coachName || 'Mister') + ',\n' +
      'la tesoreria del ' + clubName + ' presenta un passivo di ' + debt.toLocaleString('it-IT') + ' €. Il mercato vi resta chiuso finché la cassa non rientra nel nero, e lo spogliatoio lo sente: finché siete in rosso, il morale di chi scende in campo paga.\n' +
      'Se a fine stagione il passivo sarà ancora aperto, il Comitato Generale detraggerà dalla classifica un punto ogni 1.500.000 € di debito, fino a un massimo di 15.\n' +
      'Non costringeteci a fare i conti in pubblico.\n' +
      'Firmato: la Federazione, che vi vuole bene, ma non fino a questo punto.',
  }
}

/** Prestiti tra club (G3): secco, fino a fine stagione, poi si restituisce.
 *  Il proprietario presta solo se ha avanzo in quel ruolo e il giocatore
 *  non è dei suoi titolari. La risposta è nel seed, come sempre. */
export const LOAN_FEE_RATE = 0.1
export const MAX_LOANS_IN = 2

export function loanDeal(seed, season, p, ownerSquad) {
  const seniors = (ownerSquad || []).filter((x) => !x.youth)
  const roleList = seniors.filter((x) => x.role === p.role).sort((a, b) => b.ovr - a.ovr)
  const surplus = roleList.length >= 4
  const isTop = roleList.slice(0, 2).some((x) => x.id === p.id)
  const avg = seniors.length ? seniors.reduce((s, x) => s + x.ovr, 0) / seniors.length : 60
  const rng = new Rng(seedFromString(seed + ':loan:' + season + ':' + p.id))
  if (!surplus) return { ok: false, reason: 'Rifiutano: in quel ruolo sono già con l acqua alla gola.' }
  if (isTop) return { ok: false, reason: 'Rifiutano: quello lì gioca, non si presta.' }
  if (p.ovr > avg + 4) return { ok: false, reason: 'Rifiutano: costa troppo anche solo in prestito.' }
  if (!rng.chance(0.8)) return { ok: false, reason: 'Rifiutano: il direttore sportivo ha altri piani per lui.' }
  const fee = Math.max(100000, Math.round((p.value * LOAN_FEE_RATE) / 10000) * 10000)
  return { ok: true, fee }
}
/** Sponsor della stagione (G3.1): niente piu fisso per giornata. Ogni
 *  inizio stagione il club cerca chi gli metta la faccia sulla maglia:
 *  un pool di offerte dove contano il blasone e i risultati appena
 *  collezionati. Chi ha vinto riceve piu telefonate; chi e finito in
 *  fondo riceve offerte da fine classifica, con bonus che si possono
 *  davvero promettere. La base si incassa alla firma, il bonus solo
 *  se a fine stagione l obiettivo e arrivato. Tutto nel seed, sempre. */
const SPONSOR_CATEGORIES = [
  "Salumificio", "Caseificio", "Mobilificio", "Conceria", "Cartiera", "Torrefazione",
  "Enoteca", "Autosalone", "Pastificio", "Cantina sociale", "Ferriera", "Falegnameria",
  "Officina meccanica", "Studio tecnico", "Consorzio di credito", "Latteria",
]
const SPONSOR_SUFFIXES = [
  "Fratelli Bonanni", "del Valmerla", "Petrarossa & C.", "di Malveglia", "Dossarese",
  "Cavarnina", "Litornese", "Rivarotonda", "Ostricana", "del Piave", "Bellavista",
  "Alpina", "del Ponte", "Torrese",
]
const SPONSOR_OBJECTIVES = {
  title: { label: "Vittoria del campionato", k: 1.9 },
  top4: { label: "Primi quattro in Divisione d'Onore", k: 0.85 },
  cupwin: { label: "Coppa Nazionale Trofeo Bellandi alzata", k: 1.25 },
  tophalf: { label: "Meta alta della classifica (primi dieci)", k: 0.45 },
  salvezza: { label: "Salvezza raggiunta (diciottesimo posto o meglio)", k: 0.8 },
  promotion: { label: "Promozione in Divisione d'Onore", k: 2.1 },
  none: { label: null, k: 0 },
}

/** Chi puo promettere cosa: il blasone decide con quali obiettivi si
 *  apre la trattativa. Nessuno offre lo scudetto a chi lotta per non
 *  annegare; e in cadetta la salvezza non si vende, perche da lì non
 *  si scende. Lì si vende il sogno della promozione. */
function eligibleObjectives(club) {
  const rep = club.reputation || 40
  if (club.leagueId === 'a') {
    return rep >= 60
      ? [['promotion', 3], ['cupwin', 1], ['tophalf', 2], ['none', 1]]
      : [['promotion', 1], ['tophalf', 3], ['cupwin', 1], ['none', 1]]
  }
  if (rep >= 72) return [['title', 3], ['top4', 3], ['cupwin', 2], ['tophalf', 1], ['none', 1]]
  if (rep >= 60) return [['title', 1], ['top4', 3], ['cupwin', 2], ['tophalf', 3], ['none', 1]]
  return [['salvezza', 3], ['tophalf', 2], ['cupwin', 1], ['none', 2]]
}

function weightedPick(rng, entries) {
  const total = entries.reduce((s, e) => s + e[1], 0)
  let roll = rng.float() * total
  for (const e of entries) {
    roll -= e[1]
    if (roll <= 0) return e[0]
  }
  return entries[entries.length - 1][0]
}

/** Il pool di sponsor della stagione: piu blasone e piu risultati,
 *  piu offerte sul tavolo (da 3 a 8). La base segue la reputazione,
 *  il bonus e un multiplo della base secondo l obiettivo. */
export function makeSponsorOffers(seed, season, club, lastSeason) {
  if (!club) return []
  const rng = new Rng(seedFromString(seed + ':sponsor:' + season + ':' + club.id))
  const rep = club.reputation || 40
  const won = lastSeason || {}
  let count = 3 + Math.floor((rep - 40) / 12)
  if (won.champion) count += 2
  if (won.cupWinner) count += 1
  if (won.promoted) count += 1
  count = Math.max(3, Math.min(8, count))
  const eligible = eligibleObjectives(club)
  const offers = []
  for (let i = 0; i < count; i++) {
    const type = weightedPick(rng, eligible)
    const obj = SPONSOR_OBJECTIVES[type]
    const baseRate = 16000 + rng.float() * 14000
    let base = Math.max(200000, Math.round((rep * baseRate) / 50000) * 50000)
    let bonus = 0
    if (type === 'none') {
      base = Math.round((base * (1.2 + rng.float() * 0.3)) / 50000) * 50000
    } else {
      bonus = Math.max(100000, Math.round((base * obj.k * (0.85 + rng.float() * 0.3)) / 50000) * 50000)
    }
    let name = rng.pick(SPONSOR_CATEGORIES) + ' ' + rng.pick(SPONSOR_SUFFIXES)
    if (offers.some((o) => o.name === name)) name = name + ' — filiale n. ' + (i + 1)
    offers.push({ name, base, bonus, objective: type, objectiveLabel: obj.label })
  }
  return offers
}

/** Il direttore sportivo AI sceglie da solo: la base e certa, il bonus
 *  vale meta — i sogni si scontano del 50 per cento. */
export function bestSponsorOffer(offers) {
  let best = null
  let bestValue = -1
  for (const o of offers || []) {
    const value = (o.base || 0) + (o.bonus || 0) * 0.5
    if (value > bestValue) {
      best = o
      bestValue = value
    }
  }
  return best
}

/** Il bonus maturato: gli obiettivi si contano sulla classifica finale
 *  (penalita comprese: la Federazione non regala nulla agli sponsor). */
export function sponsorBonus(deal, ctx) {
  if (!deal || !deal.objective || deal.objective === 'none' || !ctx) return 0
  const pos = ctx.position || 20
  const hit =
    deal.objective === 'title' ? !!ctx.champion
    : deal.objective === 'top4' ? pos <= 4
    : deal.objective === 'tophalf' ? pos <= 10
    : deal.objective === 'salvezza' ? pos <= 18
    : deal.objective === 'promotion' ? !!ctx.promoted
    : deal.objective === 'cupwin' ? !!ctx.cupWinner
    : false
  return hit ? (deal.bonus || 0) : 0
}
