
/**
 * Classifica calcolata dalle partite giocate (nessuna tabella dedicata:
 * una fonte di verità sola, i risultati sulle fixture). Con leagueId filtra
 * per singola serie della Piramide (G1).
 */
export function computeStandings(clubs, fixtures, leagueId) {
  const pool = leagueId ? clubs.filter((c) => c.leagueId === leagueId) : clubs
  const rows = new Map(
    pool.map((c) => [c.id, { clubId: c.id, name: c.name, played: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]),
  )
  for (const f of fixtures.filter((x) => x.played && (!leagueId || x.leagueId === leagueId))) {
    const h = rows.get(f.homeId)
    const a = rows.get(f.awayId)
    if (!h || !a) continue
    h.played++
    a.played++
    h.gf += f.homeGoals
    h.ga += f.awayGoals
    a.gf += f.awayGoals
    a.ga += f.homeGoals
    if (f.homeGoals > f.awayGoals) {
      h.w++
      h.pts += 3
      a.l++
    } else if (f.homeGoals < f.awayGoals) {
      a.w++
      a.pts += 3
      h.l++
    } else {
      h.d++
      a.d++
      h.pts++
      a.pts++
    }
  }
  return [...rows.values()].sort(
    (x, y) =>
      y.pts - x.pts ||
      y.gf - y.ga - (x.gf - x.ga) ||
      y.gf - x.gf ||
      x.name.localeCompare(y.name),
  )
}
