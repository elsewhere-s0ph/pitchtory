
import { useState } from 'react'
import { generateUniverse, LEAGUES } from '../game/universe'
import { createCareer } from '../db'
import { newSeed, seedFromString } from '../lib/rng'

const DURATIONS = {
  short: 'Compressa (1-2 min)',
  normal: 'Rilassata (5-6 min)',
  long: 'Cronaca estesa (7-8 min)',
}

export default function SetupScreen({ onStart, onBack }) {
  const [coachName, setCoachName] = useState('')
  const [seedText, setSeedText] = useState('ELEVEN-CASA')
  // Il default della home sopravvive alle sessioni: ogni nuovo mister
  // parte dalla durata scelta l'ultima volta.
  const [duration, setDuration] = useState(() => {
    const v = window.localStorage.getItem('pitchtory-default-duration')
    return v === 'short' || v === 'long' || v === 'normal' ? v : 'normal'
  })
  const [seed, setSeed] = useState(null)
  const [universe, setUniverse] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [leagueId, setLeagueId] = useState(LEAGUES[0].id)

  function generate() {
    const s = seedText.trim() ? seedFromString(seedText.trim()) : newSeed()
    setSeed(s)
    setUniverse(generateUniverse(s))
    setSelectedId(null)
  }

  async function start() {
    if (!selectedId || saving) return
    setSaving(true)
    // La durata scelta qui diventa il default della prossima carriera.
    window.localStorage.setItem('pitchtory-default-duration', duration)
    const id = await createCareer({
      seed,
      seedText: seedText.trim() || null,
      coachName: coachName.trim() || 'Mister',
      clubId: selectedId,
      matchDuration: duration,
    })
    onStart(id)
  }

  return (
    <main className="min-h-screen bg-pitch-950 p-4 text-slate-100 max-w-5xl mx-auto sm:p-8">
      <div className="pointer-events-none fixed left-1/2 top-0 h-44 w-[28rem] -translate-x-1/2 rounded-full bg-flood-400/10 blur-3xl" />
      <header className="mb-8">
        {onBack && (
          <button onClick={onBack} className="mb-3 text-xs text-slate-400 hover:text-slate-200">← Torna alla home</button>
        )}
        <p className="scoreboard text-[10px] tracking-[0.35em] text-flood-400">Little Elsewhere</p>
        <h1 className="scoreboard text-4xl font-semibold tracking-wide text-flood-300">Pitchtory</h1>
        <p className="text-sm text-slate-400">Build your own legacy — nuova carriera</p>
      </header>

      {!universe ? (
        <div className="max-w-md animate-fade-up space-y-4 rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-6">
          <div>
            <label className="mb-1 block text-xs text-slate-400">Nome dell'allenatore</label>
            <input
              value={coachName}
              onChange={(e) => setCoachName(e.target.value)}
              placeholder="Mister"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm transition focus:border-flood-400 focus:outline-none focus:shadow-[0_0_16px_rgba(239,191,78,0.15)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Seed — condividilo per far giocare lo stesso universo</label>
            <input
              value={seedText}
              onChange={(e) => setSeedText(e.target.value)}
              placeholder="es. ELEVEN-CASA"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm transition focus:border-flood-400 focus:outline-none focus:shadow-[0_0_16px_rgba(239,191,78,0.15)]"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-slate-400">Durata partita (cambiabile dopo nelle opzioni)</label>
            <select
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm transition focus:border-flood-400 focus:outline-none focus:shadow-[0_0_16px_rgba(239,191,78,0.15)]"
            >
              {Object.entries(DURATIONS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <button
            onClick={generate}
            className="w-full rounded-lg bg-teal-500 py-2.5 text-sm font-semibold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:bg-teal-400 hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98]"
          >
            Genera universo
          </button>
        </div>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Scegli il tuo club · {universe.season}</h2>
            <button onClick={() => setUniverse(null)} className="text-xs text-slate-400 hover:text-slate-200">
              Cambia seed
            </button>
          </div>
          <div className="mb-4 flex gap-2">
            {LEAGUES.map((l) => (
              <button
                key={l.id}
                onClick={() => { setLeagueId(l.id); setSelectedId(null) }}
                className={'flex-1 rounded-lg border px-3 py-2 text-xs font-semibold transition ' + (leagueId === l.id ? 'border-teal-500 bg-teal-500/10 text-teal-300' : 'border-slate-700 text-slate-400 hover:border-teal-500/60 hover:text-slate-200')}
              >
                {l.name}
                <span className="ml-1 font-normal text-slate-500">{l.tier === 1 ? '· massima serie' : '· serie cadetta'}</span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {universe.clubs.filter((c) => c.leagueId === leagueId).map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={'text-left rounded-xl border p-4 transition hover:-translate-y-0.5 hover:border-teal-500 ' + (c.id === selectedId ? 'border-teal-500 bg-pitch-900 shadow-[0_0_24px_rgba(47,181,110,0.2)]' : 'border-slate-800 bg-pitch-900/40')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{c.name}</span>
                  <span className="flex shrink-0 gap-1">
                    <span className="h-3 w-3 rounded-full border border-slate-700" style={{ background: c.colors.primary }} />
                    <span className="h-3 w-3 rounded-full border border-slate-700" style={{ background: c.colors.secondary }} />
                  </span>
                </div>
                <p className="text-xs text-slate-400">{c.city} · fondato {c.founded} · {c.nickname}</p>
                <p className="text-xs text-slate-400">{c.stadium.name}</p>
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="rounded bg-slate-800 px-2 py-0.5">Rep {c.reputation}</span>
                  <span className="rounded bg-slate-800 px-2 py-0.5">Media {c.avgOvr}</span>
                  <span className="rounded bg-slate-800 px-2 py-0.5">Budget {(c.budget / 1e6)}M</span>
                </div>
              </button>
            ))}
          </div>
          <div className="sticky bottom-4 mt-6 flex items-center justify-between gap-3 rounded-xl border border-teal-500/40 bg-pitch-900/95 p-4 shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur">
            <p className="text-sm text-slate-300">
              {selectedId ? 'Hai scelto: ' + universe.clubs.find((c) => c.id === selectedId).name : 'Seleziona un club per iniziare'}
            </p>
            <button
              onClick={start}
              disabled={!selectedId || saving}
              className="rounded-lg bg-teal-500 px-5 py-2 text-sm font-semibold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:bg-teal-400 hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98] disabled:opacity-40"
            >
              {saving ? 'Creo la carriera…' : 'Inizia carriera'}
            </button>
          </div>
        </>
      )}
    </main>
  )
}
