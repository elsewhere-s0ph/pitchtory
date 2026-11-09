/** La memoria della lega (G5): l'albo d'oro nasce vuoto e si riempie
 *  solo con le stagioni finite davvero. Nessun passato scritto dal
 *  seed: ogni riga dell'albo è un giugno attraversato dal mister. */

/** Conti per la UI: tutto viene dalla storia giocata, stagione per
 *  stagione. Il passato non esiste: esiste solo il presente registrato. */
export function alboTotals(history) {
  const titles = {}
  const cups = {}
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
