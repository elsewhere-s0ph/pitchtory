/**
 * Panchine a rischio (G5.1): la parte di Mercato degli Allenatori che
 * non poteva aspettare giugno. I club esonerano in corsa, le panchine
 * restano libere, il telefono del mister squilla. Tutto deterministico:
 * le sedie che scottano scottano dal seed, come tutto il resto.
 */
import { Rng, seedFromString } from '../lib/rng'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Nomi per i mister AI: panchina di scuola vecchia, niente agenti. */
const MANAGER_FIRST = ['Aldo', 'Beppe', 'Carlo', 'Dario', 'Enzo', 'Fabrizio', 'Gigi', 'Leonardo', 'Marco', 'Nando', 'Otello', 'Pietro', 'Rino', 'Sandro', 'Teodoro', 'Vittorio']
const MANAGER_LAST = ['Bonanno', 'Calcagno', 'Doria', 'Errani', 'Falsini', 'Grieco', 'Lombardi', 'Marrone', 'Nardelli', 'Oliva', 'Pellegrini', 'Rizzo', 'Sartori', 'Tarozzi', 'Vismara', 'Zaccaria', 'Barberis', 'Cortese']

/** Nome del mister di un club: lo stesso seed dà lo stesso uomo. La
 *  variante n serve a non resuscitare l'esonero di ieri. */
export function managerNameFor(seed, clubId, n) {
  const rng = new Rng(seedFromString(seed + ':manager:' + clubId + ':' + (n || 0)))
  return rng.pick(MANAGER_FIRST) + ' ' + rng.pick(MANAGER_LAST)
}

/** Posizione attesa dal blasone: la scala che usano gli sponsor. */
export function expectedPos(club) {
  return clamp(Math.round(21 - (club.reputation || 50) * 0.22), 1, 19)
}

/** Quanto scotta la sedia (per la UI): il gap dalla posizione attesa e
 *  le sconfitte recenti dicono se tenere le valigie pronte. */
export function seatHeat(club, position, form) {
  const gap = (position || 10) - expectedPos(club)
  const losses = (form && form.losses) || 0
  const heat = gap + losses
  const label = heat <= 1 ? 'poltrona comoda' : heat <= 3 ? 'sedia che scotta' : heat <= 5 ? 'brace viva' : 'fuoco addosso'
  return { gap, label }
}

/** Probabilità di esonero per giornata: i club guardano classifica e
 *  forma, non i sentimenti. Il mister ha soglie più alte: la sua sedia
 *  scotta solo quando è davvero brace. */
export function sackProb(club, position, form, isUser) {
  const exp = expectedPos(club)
  const gap = (position || 10) - exp
  const losses = (form && form.losses) || 0
  if (isUser) {
    if ((position || 10) < 14 || gap < 3) return 0
    return clamp((gap - 2) * 0.006 + losses * 0.005, 0, 0.05)
  }
  if (gap < 3 || (position || 10) < 8) return 0
  return clamp((gap - 2) * 0.01 + Math.max(0, (position || 10) - 12) * 0.008 + losses * 0.006, 0, 0.09)
}

/** Chance che un club appena rimasto senza mister chiami il vostro. */
export function offerChance(club, userClub, trophies) {
  const rep = club.reputation || 50
  if (!userClub) return clamp(0.35 + rep / 400, 0.2, 0.8)
  const urep = userClub.reputation || 50
  const base = urep >= rep ? 0.16 : 0.07
  return clamp(base + Math.min(trophies || 0, 5) * 0.03, 0.02, 0.4)
}

/** Chance che una candidatura venga accolta: blasone, trofei e un
 *  pizzico di fortuna, come in tutti i colloqui di lavoro. */
export function applyProb(club, userClub, trophies, unemployed) {
  const rep = club.reputation || 50
  const urep = userClub ? userClub.reputation : 50
  let p = 0.45 + Math.min(trophies || 0, 6) * 0.05 + (urep - rep) * 0.004
  if (unemployed) p -= 0.05
  return clamp(p, 0.05, 0.92)
}
