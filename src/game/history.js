import { Rng, seedFromString } from '../lib/rng'

/** L'albo d'oro ha un passato (G5): la lega esisteva già prima del
 *  mister. Le stagioni di prima le scrive il seed — stesso seed,
 *  stessa storia — e pesano il blasone: i grandi vincono spesso,
 *  ma non sempre. */
export const PAST_SEASONS = 24

/** Pesca pesata: il peso cresce col potenza, il blasone conta. */
const weightedPick = (rng, items, power) => {
  if (!items.length) return null
  const weights = items.map((x) => Math.max(1, Math.round(Math.pow(Math.max(1, x.weight) / 100, power) * 1000)))
  let sum = 0
  for (const w of weights) sum += w
  let roll = rng.int(1, sum)
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return items[i].id
  }
  return items[items.length - 1].id
}

/** Genera l'albo pre-carriera: titoli per serie e Coppe di Bellandi,
 *  tutti deterministici dal seed. I titoli pesano il blasone alla
 *  quarta; la coppa è più democratica e guarda tutti e quaranta. */
export function generateAlbo(seed, clubs) {
  const rng = new Rng(seedFromString(seed + ':albo'))
  const byLeague = {}
  for (const c of clubs) {
    byLeague[c.leagueId] = byLeague[c.leagueId] || []
    byLeague[c.leagueId].push(c)
  }
  const titles = {}
  const cups = {}
  for (let s = 0; s < PAST_SEASONS; s++) {
    for (const lid of Object.keys(byLeague)) {
      const champ = weightedPick(rng, byLeague[lid].map((c) => ({ id: c.id, weight: c.reputation })), 4)
      if (!champ) continue
      titles[lid] = titles[lid] || {}
      titles[lid][champ] = (titles[lid][champ] || 0) + 1
    }
    const cup = weightedPick(rng, clubs.map((c) => ({ id: c.id, weight: c.reputation })), 2)
    if (cup) cups[cup] = (cups[cup] || 0) + 1
  }
  return { seasons: PAST_SEASONS, titles, cups }
}

/** Il capitolo di giugno: l'albo si aggiorna coi campioni veri. */
export function alboAfterSeason(albo, championPairs, cupWinnerId) {
  const base = albo || { seasons: 0, titles: {}, cups: {} }
  const titles = {}
  for (const lid of Object.keys(base.titles || {})) titles[lid] = { ...(base.titles[lid] || {}) }
  const cups = { ...(base.cups || {}) }
  for (const [lid, clubId] of championPairs || []) {
    if (!lid || !clubId) continue
    titles[lid] = titles[lid] || {}
    titles[lid][clubId] = (titles[lid][clubId] || 0) + 1
  }
  if (cupWinnerId) cups[cupWinnerId] = (cups[cupWinnerId] || 0) + 1
  return { seasons: base.seasons, titles, cups }
}

/** Conti combinati per la UI: passato del seed più stagioni giocate. */
export function alboTotals(albo, history) {
  const base = albo || { titles: {}, cups: {} }
  const titles = {}
  for (const lid of Object.keys(base.titles || {})) titles[lid] = { ...(base.titles[lid] || {}) }
  const cups = { ...(base.cups || {}) }
  for (const h of history || []) {
    for (const ch of h.champions || []) {
      if (!ch.leagueId || !ch.clubId) continue
      titles[ch.leagueId] = titles[ch.leagueId] || {}
      titles[ch.leagueId][ch.clubId] = (titles[ch.leagueId][ch.clubId] || 0) + 1
    }
    if (h.cup && h.cup.clubId) cups[h.cup.clubId] = (cups[h.cup.clubId] || 0) + 1
  }
  return { titles, cups }
}

/** Il capocannoniere di una serie (G5): i gol veri della stagione,
 *  contati prima che le statistiche si azzerino. */
export function seasonTopScorer(players, clubs, leagueId) {
  const ids = new Set(clubs.filter((c) => c.leagueId === leagueId).map((c) => c.id))
  const nameOf = {}
  for (const c of clubs) nameOf[c.id] = c.name
  const list = players.filter((p) => ids.has(p.clubId) && !p.youth && p.goals > 0)
  if (!list.length) return null
  list.sort((a, b) => b.goals - a.goals || b.ovr - a.ovr)
  const p = list[0]
  return { id: p.id, name: p.name, clubName: nameOf[p.clubId] || '', goals: p.goals }
}
