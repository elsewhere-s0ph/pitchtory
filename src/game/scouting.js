import { Rng, seedFromString } from '../lib/rng'

/**
 * Osservatori (F5): il potenziale vero non si vede mai, si vede la stima
 * della tua rete. Più l'osservatorio è alto, più la lettura è precisa; il
 * focus su un ruolo toglie altri due punti di errore. Deterministica per
 * (giocatore, livello, focus): la stima non "balla" a ogni schermata, ma
 * ogni potenziamento rilegge tutta la Primavera.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

/** Livello valido dalla config osservatori (o numero legacy). */
function scoutLevel(scouts) {
  if (typeof scouts === 'number') return clamp(Math.round(scouts), 1, 5)
  return clamp(Math.round(scouts && scouts.level ? scouts.level : 1), 1, 5)
}

/** Errore di lettura: livello 1 → ±10, livello 5 → ±2; il focus toglie 2. */
export function scoutError(scouts) {
  const err = [10, 8, 6, 4, 2][scoutLevel(scouts) - 1]
  const focus = scouts && typeof scouts === 'object' ? scouts.focus : null
  return focus ? Math.max(1, err - 2) : err
}

/** Potenziale stimato: sempre plausibile (mai sotto l'ovr attuale). */
export function scoutedPotential(player, scouts) {
  const level = scoutLevel(scouts)
  const focus = (scouts && typeof scouts === 'object' && scouts.focus) || 'no'
  const rng = new Rng(seedFromString(String(player.id) + ':s' + level + ':' + focus))
  const err = scoutError(scouts)
  return clamp(player.potential + rng.int(-err, err), player.ovr, 99)
}

/**
 * Occhi sui Grandi (G4): gli osservatori leggono anche i seniori degli
 * altri club — da lontano, col binocolo della rete. Senza report l'OVR
 * del mercato è una stima; il report dice la verità, che non si scorda.
 */

/** Costo di un report su un singolo avversario: la verità si paga. */
export const SCOUT_REPORT_COST = 100000

/** Errore di lettura sui seniori: si vedono giocare ogni settimana, e
 *  quindi si leggono meglio della Primavera — ma la verità non è gratis. */
export function seniorScoutError(scouts) {
  const err = [8, 6, 4, 3, 2][scoutLevel(scouts) - 1]
  const focus = scouts && typeof scouts === 'object' ? scouts.focus : null
  return focus ? Math.max(1, err - 1) : err
}

/** OVR stimato di un senior avversario: deterministico per (giocatore,
 *  livello, focus) come le letture della Primavera — potenziare la rete
 *  rilegge tutti, il report no. */
export function scoutedOvr(player, scouts) {
  const level = scoutLevel(scouts)
  const focus = (scouts && typeof scouts === 'object' && scouts.focus) || 'no'
  const err = seniorScoutError(scouts)
  const rng = new Rng(seedFromString(String(player.id) + ':g4ovr:' + level + ':' + focus))
  return clamp(player.ovr + rng.int(-err, err), 40, 99)
}

/** Attributi stimati (G4): le barre della scheda avversaria prima del
 *  report. Deterministici per (giocatore, livello): il tavolo non balla. */
export function scoutedAttrs(player, scouts) {
  const level = scoutLevel(scouts)
  const rng = new Rng(seedFromString(String(player.id) + ':g4attr:' + level))
  const err = [2, 2, 1, 1, 1][level - 1]
  const real = player.attributes || {}
  const out = {}
  for (const k of Object.keys(real)) out[k] = clamp(real[k] + rng.int(-err, err), 1, 20)
  return out
}
