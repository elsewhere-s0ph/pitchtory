/**
 * Cassa e Stadio (G3): l'economia del club, pura e deterministica.
 * Ogni partita in casa incassa biglietti secondo capienza, posizione,
 * forma e blasone dell'ospite; ogni giornata di campionato paga gli
 * stipendi a tutti e incassa lo sponsor; chi finisce in rosso se la
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

/** Sponsor: il blasone paga, ogni giornata di campionato. */
export function sponsorPerRound(club) {
  return Math.round((club.reputation || 40) * 260)
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
