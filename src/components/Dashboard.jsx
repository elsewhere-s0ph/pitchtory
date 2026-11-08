



import { useEffect, useMemo, useState } from 'react'
import { useCareer } from '../store'
import { deleteCareer, exportCareer, importCareer, listCareers, saveFixtureResults, applyPostMatch, applyAiMatchday, endSeason, updateCareerSettings, upgradeScouts, setScoutFocus, SCOUT_UPGRADE_COST, CUP_NAME, CUP_ROUNDS, createNextCupRound, cupShootout } from '../db'
import { scoutedPotential, scoutError } from '../game/scouting'
import { computeStandings } from '../game/standings'
import { LEAGUES } from '../game/universe'
import { simulateMatch, matchSeed } from '../game/engine'
import MatchScreen from './MatchScreen'
import PlayerCard from './PlayerCard'
import TransferMarket from './TransferMarket'
import TacticsBoard from './TacticsBoard'
import pkg from '../../package.json'

const ROLE_LABELS = { GK: 'Portieri', DF: 'Difensori', MF: 'Centrocampisti', FW: 'Attaccanti' }
const ROLE_ORDER = ['GK', 'DF', 'MF', 'FW']
const DURATIONS = { short: 'Compressa (1-2 min)', normal: 'Rilassata (5-6 min)', long: 'Cronaca estesa (7-8 min)' }
const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'squad', label: 'Rosa' },
  { id: 'tactics', label: 'Lavagnetta' },
  { id: 'market', label: 'Mercato' },
  { id: 'calendar', label: 'Calendario' },
  { id: 'club', label: 'Club' },
  { id: 'settings', label: 'Opzioni' },
]

function fmtMoney(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + 'M'
  if (v >= 1e3) return Math.round(v / 1e3) + 'k'
  return String(v)
}

function MoraleDot({ value }) {
  const color = value >= 75 ? 'bg-emerald-500' : value >= 55 ? 'bg-amber-500' : 'bg-red-500'
  return <span className={'inline-block h-2.5 w-2.5 rounded-full ' + color} title={'Morale ' + value} />
}

/** Su due righe al telefono (il nome si legge per intero), su una
 * riga al desktop: le statistiche respirano dove c'è spazio. */
function PlayerRow({ p, season, round, onOpen }) {
  const injured = p.injuredUntil && round <= p.injuredUntil
  const banned = p.bannedUntil && round <= p.bannedUntil
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm">
      <span className="w-7 shrink-0 text-center font-bold text-teal-400">{p.ovr}</span>
      <button
        onClick={() => onOpen(p)}
        title="Apri la scheda giocatore"
        className="min-w-0 flex-1 truncate text-left hover:text-teal-300"
      >
        {p.name}
        {Array.isArray(p.abilities) && p.abilities.length > 0 && (
          <span className="ml-1 text-amber-400" title="Ha almeno un abilità speciale: apri la scheda">✦</span>
        )}
      </button>
      <span className="w-12 shrink-0 text-right">
        {banned ? (
          <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400" title={"Squalificato fino alla giornata " + p.bannedUntil}>
            Squal.
          </span>
        ) : injured ? (
          <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400" title={"Fuori fino alla giornata " + p.injuredUntil}>
            Infort.
          </span>
        ) : p.contractUntil <= season + 1 ? (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-400">Scade</span>
        ) : null}
      </span>
      <span className="flex w-full items-center justify-between gap-3 pt-0.5 text-[11px] text-slate-400 sm:w-auto sm:justify-end sm:gap-2">
        <span className="flex items-center gap-1" title="Morale"><MoraleDot value={p.morale} />{p.morale}</span>
        <span title="Presenze e gol">{p.apps || 0} PG · {p.goals || 0} G</span>
        {p.cards ? (
          <span className="text-amber-400" title="Ammonizioni: alla quinta salta una giornata">{p.cards}⚠</span>
        ) : null}
        <span className="hidden sm:inline" title="Carattere">{p.personality}</span>
        <span title="Età">{p.age}a</span>
        <span title="Valore di mercato">{fmtMoney(p.value)}</span>
      </span>
    </li>
  )
}

function SquadList({ list, season, round, onOpen }) {
  return ROLE_ORDER.map((role) => {
    const rows = list.filter((p) => p.role === role).sort((a, b) => b.ovr - a.ovr)
    if (!rows.length) return null
    return (
      <div key={role} className="mb-3">
        <h4 className="mb-1 text-xs uppercase tracking-wider text-slate-400">{ROLE_LABELS[role]}</h4>
        <ul className="divide-y divide-slate-800/60 rounded-xl border border-slate-800 bg-pitch-900/40">
          {rows.map((p) => <PlayerRow key={p.id} p={p} season={season} round={round} onOpen={onOpen} />)}
        </ul>
      </div>
    )
  })
}

function LevelBar({ label, level }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 text-slate-400">{label}</span>
      <span className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={'h-2 w-6 rounded ' + (n <= level ? 'bg-teal-500' : 'bg-pitch-800')} />
        ))}
      </span>
    </div>
  )
}

function Card({ title, children }) {
  return (
    <div className="animate-fade-up rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-4 shadow-[inset_0_1px_0_rgba(244,248,244,0.03)]">
      <h3 className="scoreboard mb-2 text-xs font-semibold text-slate-400">{title}</h3>
      {children}
    </div>
  )
}

function Standings({ rows, userClubId }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-pitch-900/40">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            <th className="px-3 py-2">#</th>
            <th>Squadra</th>
            <th className="px-1 text-center">PG</th>
            <th className="px-1 text-center">V</th>
            <th className="px-1 text-center">N</th>
            <th className="px-1 text-center">P</th>
            <th className="px-1 text-center">GF:GA</th>
            <th className="px-2 text-center">Pt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.clubId} className={r.clubId === userClubId ? 'bg-teal-500/10 text-teal-300' : ''}>
              <td className="px-3 py-1.5 text-xs text-slate-500">{i + 1}</td>
              <td className="max-w-[10rem] truncate px-1 py-1.5">{r.name}</td>
              <td className="px-1 text-center text-xs">{r.played}</td>
              <td className="px-1 text-center text-xs">{r.w}</td>
              <td className="px-1 text-center text-xs">{r.d}</td>
              <td className="px-1 text-center text-xs">{r.l}</td>
              <td className="px-1 text-center text-xs text-slate-400">{r.gf}:{r.ga}</td>
              <td className="px-2 text-center font-bold">{r.pts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Dashboard({ careerId, onNewCareer, onSwitchCareer }) {
  const { career, clubs, players, fixtures, load, refresh } = useCareer()
  const [tab, setTab] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('tab')
    return TABS.some((t) => t.id === q) ? q : 'home'
  })
  const [matchFixture, setMatchFixture] = useState(null)
  const [seasonSummary, setSeasonSummary] = useState(null)
  const [cardPlayer, setCardPlayer] = useState(null)
  const [standingsLeague, setStandingsLeague] = useState(null)

  useEffect(() => {
    load(careerId)
  }, [careerId, load])

  const data = useMemo(() => {
    if (!career) return null
    const clubById = Object.fromEntries(clubs.map((c) => [c.id, c]))
    const userClub = clubById[career.clubId]
    const squad = players.filter((p) => p.clubId === userClub.id)
    const userFixtures = fixtures
      .filter((f) => f.homeId === userClub.id || f.awayId === userClub.id)
      .sort((a, b) => a.number - b.number)
    const playersByClub = {}
    for (const p of players) (playersByClub[p.clubId] = playersByClub[p.clubId] || []).push(p)
    const standingsByLeague = {}
    for (const l of LEAGUES) standingsByLeague[l.id] = computeStandings(clubs, fixtures, l.id)
    return { clubById, userClub, squad, userFixtures, playersByClub, standingsByLeague }
  }, [career, clubs, players, fixtures])

  if (!career || !data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-pitch-950">
        <p className="scoreboard text-2xl text-flood-400">Pitchtory</p>
        <p className="animate-urgent text-[10px] uppercase tracking-[0.35em] text-slate-500">Si entra in campo…</p>
      </main>
    )
  }

  const { clubById, userClub, squad, userFixtures, playersByClub, standingsByLeague } = data
  const seniors = squad.filter((p) => !p.youth)
  const youth = squad.filter((p) => p.youth)
  const avgMorale = squad.length ? Math.round(squad.reduce((s, p) => s + p.morale, 0) / squad.length) : 0
  const wageBill = squad.reduce((s, p) => s + p.wage, 0)
  const next = userFixtures.find((f) => !f.played)
  const round = next ? next.number : 39
  const injuredCount = squad.filter((p) => p.injuredUntil && round <= p.injuredUntil).length
  const bannedCount = squad.filter((p) => p.bannedUntil && round <= p.bannedUntil).length
  const scouts = career.scouts || { level: 1, focus: null }
  const youthRanked = youth
    .slice()
    .sort((a, b) => scoutedPotential(b, scouts) - scoutedPotential(a, scouts))
  const userLeagueId = userClub.leagueId || LEAGUES[0].id
  const userLeagueName = (LEAGUES.find((l) => l.id === userLeagueId) || LEAGUES[0]).name
  const userStandings = standingsByLeague[userLeagueId] || []
  const standings = standingsByLeague[standingsLeague || userLeagueId] || []
  const position = userStandings.findIndex((r) => r.clubId === userClub.id) + 1

  /** Solo i giocatori sani per la giornata indicata. */
  function fitPlayersFor(md) {
    const m = {}
    for (const [cid, list] of Object.entries(playersByClub)) {
      m[cid] = list.filter((p) => !(p.injuredUntil && md <= p.injuredUntil) && !(p.bannedUntil && md <= p.bannedUntil))
    }
    return m
  }

  async function handleMatchEnd(result) {
    const fixture = matchFixture
    if (!fixture) return
    try {
      const isCup = fixture.type === "cup"
      // La Coppa non ammette pari: i rigori li ha già giocati il MatchScreen,
      // qui si firma il verdetto (il cupShootout resta per le partite saltate).
      let finalResult = result
      let cupWinnerId = undefined
      if (isCup && result.homeGoals === result.awayGoals) {
        if (result.cupWinnerId !== undefined) {
          cupWinnerId = result.cupWinnerId
        } else {
          const pens = cupShootout(career, fixture, clubById[fixture.homeId], clubById[fixture.awayId], playersByClub)
          cupWinnerId = pens.winnerId
          finalResult = { ...result, cupWinnerId, events: [...result.events, pens.event] }
        }
      } else if (isCup) {
        cupWinnerId = result.homeGoals > result.awayGoals ? fixture.homeId : fixture.awayId
      }
      const others = fixtures.filter((f) => f.number === fixture.number && f.key !== fixture.key && !f.played)
      const simResults = others.map((f) => {
        const sim = simulateMatch(
          clubById[f.homeId],
          clubById[f.awayId],
          fitPlayersFor(f.number),
          matchSeed(career.seed, f.key + '#' + career.season),
        )
        const tie = sim.homeGoals === sim.awayGoals
        const winnerId = f.type === "cup"
          ? tie
            ? cupShootout(career, f, clubById[f.homeId], clubById[f.awayId], fitPlayersFor(f.number)).winnerId
            : sim.homeGoals > sim.awayGoals ? f.homeId : f.awayId
          : null
        return { f, sim, winnerId }
      })
      await saveFixtureResults([
        { key: fixture.key, homeGoals: result.homeGoals, awayGoals: result.awayGoals, winnerId: cupWinnerId !== undefined ? cupWinnerId : null },
        ...simResults.map((r) => ({ key: r.f.key, homeGoals: r.sim.homeGoals, awayGoals: r.sim.awayGoals, winnerId: r.winnerId })),
      ])
      await applyPostMatch(career.id, fixture, finalResult, userClub.id, squad, players)
      for (const r of simResults) await applyAiMatchday(r.f, r.sim.events, players)
      // Coppa: turno chiuso, si sorteggiano le coppie successive.
      if (isCup) await createNextCupRound(career.id)
      setMatchFixture(null)
      await load(career.id)
    } catch (err) {
      setMatchFixture(null)
      window.alert('Errore nel salvare la partita: ' + err.message)
    }
  }

  async function handleEndSeason() {
    try {
      const summary = await endSeason(career.id)
      await load(career.id)
      setSeasonSummary(summary)
    } catch (err) {
      window.alert('Errore nel chiudere la stagione: ' + err.message)
    }
  }

  async function handleScoutUpgrade() {
    try {
      await upgradeScouts(career.id)
      await load(career.id)
    } catch (err) {
      window.alert(err.message)
    }
  }

  async function handleExport() {
    const json = await exportCareer(career.id)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'pitchtory-' + (career.seedText || career.seed) + '.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      const id = await importCareer(await file.text())
      onSwitchCareer(id)
    } catch (err) {
      window.alert('Import fallito: ' + err.message)
    }
    e.target.value = ''
  }

  async function handleDelete() {
    if (!window.confirm('Eliminare definitivamente questa carriera?')) return
    await deleteCareer(career.id)
    const others = (await listCareers()).filter((c) => c.id !== career.id)
    if (others.length) onSwitchCareer(others[0].id)
    else onNewCareer()
  }

  return (
    <main className="min-h-screen bg-pitch-950 pb-20 text-slate-100">
      <header className="relative overflow-hidden border-b border-pitch-700/50">
        <div className="pointer-events-none absolute -top-20 left-1/2 h-44 w-[28rem] -translate-x-1/2 rounded-full bg-flood-400/10 blur-3xl" />
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 p-4 sm:p-8">
          <div>
            <p className="scoreboard text-[10px] tracking-[0.35em] text-flood-400">Pitchtory · Build your own legacy</p>
            <h1 className="scoreboard mt-1 text-2xl font-semibold">{userClub.name}</h1>
            <p className="text-xs text-slate-400">
              {userLeagueName} · Stagione {career.season} · {career.coachName}
            </p>
          </div>
          <span className="flex shrink-0 gap-1">
            <span className="h-4 w-4 rounded-full border border-slate-700" style={{ background: userClub.colors.primary }} />
            <span className="h-4 w-4 rounded-full border border-slate-700" style={{ background: userClub.colors.secondary }} />
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-5xl p-4 sm:p-8">
        {tab === 'home' && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card title="Prossima partita">
                {next ? (
                  <div className="text-sm">
                    <p className="text-teal-400">{next.type === "cup" ? CUP_NAME + " · " + (CUP_ROUNDS[next.round] || "Turno " + next.round) : "Giornata " + next.number}</p>
                    <p className="mt-1">
                      {next.homeId === userClub.id
                        ? 'In casa contro ' + clubById[next.awayId].name
                        : 'In trasferta a ' + clubById[next.homeId].name}
                    </p>
                    <button
                      onClick={() => setMatchFixture(next)}
                      className="mt-3 w-full rounded-lg bg-teal-500 py-2 text-sm font-semibold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:bg-teal-400 hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98]"
                    >
                      Vai in campo
                    </button>
                  </div>
                ) : (
                  <div className="text-sm">
                    <p className="text-slate-400">Stagione completata: 38 giornate su 38.</p>
                    <button
                      onClick={handleEndSeason}
                      className="mt-3 w-full rounded-lg bg-teal-500 py-2 text-sm font-semibold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:bg-teal-400 hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98]"
                    >
                      Concludi la stagione
                    </button>
                  </div>
                )}
              </Card>
              <Card title="Situazione">
                <ul className="space-y-1 text-sm text-slate-300">
                  <li>Posizione: <b>{position ? position + '° su ' + userStandings.length : '—'}</b></li>
                  <li>Media squadra: <b>{userClub.avgOvr}</b></li>
                  <li>Morale rosa: <b>{avgMorale}</b></li>
                  <li>Infortunati: <b className={injuredCount ? 'text-red-400' : ''}>{injuredCount}</b></li>
                  <li>Squalificati: <b className={bannedCount ? 'text-red-400' : ''}>{bannedCount}</b></li>
                  <li>Budget: <b>{fmtMoney(userClub.budget)}</b></li>
                  <li>Stipendi: <b>{fmtMoney(wageBill)}</b></li>
                </ul>
              </Card>
            </div>
            <h3 className="mb-2 mt-6 text-sm font-semibold">Classifica</h3>
            <div className="mb-2 flex gap-2">
              {LEAGUES.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setStandingsLeague(l.id)}
                  className={'flex-1 rounded-lg border px-3 py-1.5 text-[11px] font-semibold transition ' + ((standingsLeague || userLeagueId) === l.id ? 'border-teal-500 bg-teal-500/10 text-teal-300' : 'border-slate-700 text-slate-400 hover:border-teal-500/60 hover:text-slate-200')}
                >
                  {l.name}
                </button>
              ))}
            </div>
            <Standings rows={standings} userClubId={userClub.id} />
          </>
        )}

        {tab === 'squad' && (
          <div className="animate-fade-up">
            <SquadList list={seniors} season={career.season} round={round} onOpen={setCardPlayer} />
            <h3 className="mb-2 text-sm uppercase tracking-wider text-teal-400">Primavera</h3>
            <SquadList list={youth} season={career.season} round={round} onOpen={setCardPlayer} />
          </div>
        )}

        {tab === 'tactics' && (
          <TacticsBoard
            career={career}
            squad={squad}
            round={round}
            onDone={() => load(career.id)}
          />
        )}

        {tab === 'market' && (
          <TransferMarket
            career={career}
            userClub={userClub}
            clubs={clubs}
            players={players}
            next={next}
            onDone={() => load(career.id)}
          />
        )}

        {tab === 'calendar' && (
          <ul className="animate-fade-up divide-y divide-slate-800/60 rounded-xl border border-slate-800">
            {userFixtures.map((f) => {
              const home = f.homeId === userClub.id
              const opp = clubById[home ? f.awayId : f.homeId].name
              return (
                <li key={f.number} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-10 text-xs text-slate-500" title={f.type === "cup" ? (CUP_ROUNDS[f.round] || "Turno " + f.round) : ""}>{f.type === "cup" ? "Coppa" : "G" + f.number}</span>
                  <span className="flex-1">{(home ? 'vs ' : '@ ') + opp}</span>
                  {f.played ? (
                    <span
                      className={'w-12 text-right font-bold tabular-nums ' + (f.type === 'cup' && f.homeGoals === f.awayGoals ? 'text-flood-300' : '')}
                      title={f.type === 'cup' && f.homeGoals === f.awayGoals && clubById[f.winnerId] ? 'Dopo i rigori: passa il ' + clubById[f.winnerId].name : null}
                    >
                      {home ? f.homeGoals + '-' + f.awayGoals : f.awayGoals + '-' + f.homeGoals}
                    </span>
                  ) : (
                    <span className="w-12 text-right text-xs text-slate-500">{home ? 'Casa' : 'Trasferta'}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}

        {tab === 'club' && (
          <div className="grid animate-fade-up gap-3 sm:grid-cols-2">
            <Card title="Finanze e strutture">
              <ul className="mb-3 space-y-1 text-sm text-slate-300">
                <li>Budget trasferimenti: <b>{fmtMoney(userClub.budget)}</b></li>
                <li>Stipendi rosa: <b>{fmtMoney(wageBill)}</b></li>
                <li>Stadio: <b>{userClub.stadium.name}</b> ({userClub.stadium.capacity.toLocaleString('it-IT')} posti)</li>
              </ul>
              <div className="space-y-1.5">
                <LevelBar label="Stadio" level={userClub.facilities.stadiumLevel} />
                <LevelBar label="Settore giovanile" level={userClub.facilities.youthLevel} />
                <LevelBar label="Staff" level={userClub.facilities.staffLevel} />
              </div>
            </Card>
            <Card title="Osservatori">
              <LevelBar label="Rete di osservatori" level={scouts.level} />
              <p className="mt-2 text-xs text-slate-400">
                Margine di errore sulle stime: ±{scoutError(scouts)} OVR.
                {scouts.focus ? ' Focus su ' + ROLE_LABELS[scouts.focus].toLowerCase() + '.' : ' Nessun focus: si guarda tutto, male.'}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[['GK', 'Portieri'], ['DF', 'Difensori'], ['MF', 'Centrocampisti'], ['FW', 'Attaccanti'], [null, 'Nessuno']].map(([f, l]) => (
                  <button
                    key={l}
                    onClick={() => setScoutFocus(career.id, f).then(refresh)}
                    className={'rounded-lg px-2.5 py-1 text-xs font-semibold ' + ((scouts.focus || null) === f ? 'bg-teal-400/15 text-teal-200' : 'bg-slate-800 text-slate-400')}
                  >{l}</button>
                ))}
              </div>
              {scouts.level >= 5 ? (
                <p className="mt-3 text-xs text-slate-400">Rete al massimo: se non lo vedono loro, non esiste.</p>
              ) : (
                <button
                  onClick={handleScoutUpgrade}
                  disabled={userClub.budget < SCOUT_UPGRADE_COST[scouts.level + 1]}
                  className="mt-3 w-full rounded-lg bg-teal-500 px-3 py-2 text-xs font-semibold text-pitch-950 hover:bg-teal-400 disabled:opacity-40"
                >
                  Potenzia al livello {scouts.level + 1} · {fmtMoney(SCOUT_UPGRADE_COST[scouts.level + 1])}
                </button>
              )}
              <p className="mt-2 text-[10px] text-slate-500">
                Ogni potenziamento rilegge la Primavera: le stime cambiano, la verità no.
              </p>
            </Card>
            <Card title={'Primavera (' + youth.length + ')'}>
              <ul className="space-y-1.5">
                {youthRanked.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    <span className="w-7 shrink-0 text-center font-bold text-teal-400">{p.ovr}</span>
                    <button
                      onClick={() => setCardPlayer(p)}
                      className="min-w-0 flex-1 truncate text-left hover:text-teal-300"
                    >
                      {p.name}
                    </button>
                    <span className="w-8 shrink-0 text-right text-xs text-slate-400">{p.age}a</span>
                    <span
                      className="w-14 shrink-0 text-right text-xs text-teal-400"
                      title="Stima dei tuoi osservatori: rete migliore, lettura più precisa"
                    >
                      ~{scoutedPotential(p, scouts)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-slate-500">
                Il potenziale dei giovani è una stima (~) dei tuoi osservatori: non tutti i giovani diventano campioni.
              </p>
            </Card>
          </div>
        )}

        {tab === 'settings' && (
          <div className="max-w-xl animate-fade-up space-y-6">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Durata partita</h3>
              <select
                value={career.settings.matchDuration}
                onChange={(e) =>
                  updateCareerSettings(career.id, { ...career.settings, matchDuration: e.target.value }).then(refresh)
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none"
              >
                {Object.entries(DURATIONS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={handleExport} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:border-teal-500">
                Esporta carriera
              </button>
              <label className="cursor-pointer rounded-lg border border-slate-700 px-4 py-2 text-sm hover:border-teal-500">
                Importa carriera
                <input type="file" accept="application/json" className="hidden" onChange={handleImport} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={onNewCareer} className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-pitch-950 hover:bg-teal-400">
                Nuova carriera
              </button>
              <button onClick={handleDelete} className="rounded-lg border border-red-500/50 px-4 py-2 text-sm text-red-400 hover:bg-red-500/10">
                Elimina questa carriera
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Pitchtory v{pkg.version} · seed: {career.seedText || career.seed} · tutto sul tuo dispositivo, sempre.
            </p>
          </div>
        )}
      </section>

      <nav className="fixed inset-x-0 bottom-0 border-t border-pitch-700/60 bg-pitch-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={'scoreboard relative flex-1 py-3 text-[11px] font-semibold transition ' + (tab === t.id ? 'text-flood-400' : 'text-slate-500 hover:text-slate-300')}
            >
              {tab === t.id && (
                <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-flood-400/90" />
              )}
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {cardPlayer && (
        <PlayerCard
          player={cardPlayer}
          scouts={scouts}
          round={round}
          onClose={() => setCardPlayer(null)}
        />
      )}

      {matchFixture && <MatchScreen fixture={matchFixture} onDone={handleMatchEnd} />}

      {seasonSummary && (
        <div className="fixed inset-0 z-20 overflow-y-auto bg-pitch-950 p-4 sm:p-8">
          <div className="mx-auto max-w-md animate-fade-up space-y-6">
            <p className="text-center text-xs uppercase tracking-[0.3em] text-teal-400">
              Fine stagione {seasonSummary.season}
            </p>
            <div className="space-y-1 text-center">
              {seasonSummary.userChampion ? (
                <>
                  <h2 className="scoreboard animate-goal-flash inline-block rounded-lg px-3 text-2xl font-bold text-flood-300">Campioni! 🏆</h2>
                  <p className="text-sm text-slate-400">{userClub.name} alza il trofeo: {seasonSummary.userLeagueName}.</p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold">Campione: {seasonSummary.champion}</h2>
                  <p className="text-sm text-slate-400">{seasonSummary.userPosition}° posto per il {userClub.name}.</p>
                </>
              )}
              {seasonSummary.cupWinner && (
                <p className="text-xs text-slate-400">
                  {CUP_NAME}: <b className={seasonSummary.userCupWinner ? "text-flood-300" : ""}>{seasonSummary.cupWinner}</b>
                  {seasonSummary.userCupWinner ? " — la porti a casa tu! 🏆" : ""}
                </p>
              )}
            </div>
            {(seasonSummary.userPromoted || seasonSummary.userRelegated) && (
              <div className={'rounded-xl border p-4 text-center ' + (seasonSummary.userPromoted ? 'border-teal-500/50 bg-teal-500/10' : 'border-red-500/50 bg-red-500/10')}>
                <h2 className="scoreboard text-xl font-bold">{seasonSummary.userPromoted ? 'PROMOZIONE! 🎉' : 'Retrocessione.'}</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {seasonSummary.userPromoted
                    ? userClub.name + ' sale in ' + LEAGUES[0].name + '. I grandi li aspettano al varco.'
                    : userClub.name + ' scende in ' + LEAGUES[1].name + '. Si riparte da qui, mister.'}
                </p>
              </div>
            )}
            {((seasonSummary.promoted && seasonSummary.promoted.length) || (seasonSummary.relegated && seasonSummary.relegated.length)) ? (
              <div className="rounded-xl border border-slate-800 bg-pitch-900/40 p-4">
                <h3 className="mb-2 text-sm font-semibold text-flood-400">La Piramide si muove</h3>
                <p className="text-sm text-teal-300">Promossi: {(seasonSummary.promoted || []).join(' · ')}</p>
                <p className="mt-1 text-sm text-red-300">Retrocessi: {(seasonSummary.relegated || []).join(' · ')}</p>
              </div>
            ) : null}
            <div className="rounded-xl border border-slate-800 bg-pitch-900/40 p-4">
              <h3 className="mb-2 text-sm font-semibold text-teal-400">Chi è cresciuto</h3>
              <ul className="space-y-1 text-sm">
                {seasonSummary.progressed.slice(0, 8).map((x, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate">
                      {x.name}{x.youth ? ' (Primavera)' : ''}
                    </span>
                    <span className="tabular-nums text-teal-300">{x.from} → {x.to}</span>
                  </li>
                ))}
                {!seasonSummary.progressed.length && (
                  <li className="text-slate-500">Nessuno. Il campo insegna solo a chi lo calca, mister.</li>
                )}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-800 bg-pitch-900/40 p-4">
              <h3 className="mb-2 text-sm font-semibold text-red-400">Chi ha pagato dazio</h3>
              <ul className="space-y-1 text-sm">
                {seasonSummary.declined.slice(0, 8).map((x, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate">{x.name}</span>
                    <span className="tabular-nums text-red-300">{x.from} → {x.to}</span>
                  </li>
                ))}
                {!seasonSummary.declined.length && (
                  <li className="text-slate-500">Nessuno: la squadra sta ancora aspettando i trent'anni.</li>
                )}
              </ul>
            </div>
            <button
              onClick={() => setSeasonSummary(null)}
              className="w-full rounded-lg bg-teal-500 py-3 text-sm font-semibold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:bg-teal-400 hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98]"
            >
              Inizia la stagione {seasonSummary.season + 1}
            </button>
          </div>
        </div>
      )}
    </main>
  )
}
