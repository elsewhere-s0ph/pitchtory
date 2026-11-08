import { useMemo, useState } from 'react'
import { setTactics } from '../db'
import { FORMATIONS, FORMATION_ORDER, DEFAULT_TACTICS, affinity, bestXIFor, bestFormationFor } from '../game/tactics'

const SLOT_LABELS = { GK: 'Portiere', DF: 'Difesa', MF: 'Centrocampo', FW: 'Attacco' }
const MENTALITIES = [
  { id: 'prudente', label: 'Prudente', hint: 'Pochi rischi, poche gioie' },
  { id: 'equilibrata', label: 'Equilibrata', hint: 'La testa sulle spalle' },
  { id: 'ardita', label: 'Ardita', hint: 'Chi non risica non rosica' },
]
const PRESSINGS = [
  { id: 'basso', label: 'Basso', hint: 'Si aspetta: fiato lungo, poca cattiveria' },
  { id: 'normale', label: 'Normale', hint: 'Il giusto mestiere' },
  { id: 'aggressivo', label: 'Aggressivo', hint: 'Occasioni e carte, polmoni corti' },
]
const LINES = [
  { id: 'bassa', label: 'Bassa', hint: 'Catenaccio: soffoca e segna poco' },
  { id: 'normale', label: 'Normale', hint: 'Né eroi né codardi' },
  { id: 'alta', label: 'Alta', hint: 'Fuorigioco sì, contropiede pure' },
]

function PillGroup({ title, options, value, onPick }) {
  return (
    <div>
      <h3 className="scoreboard mb-2 text-xs font-semibold text-slate-400">{title}</h3>
      <div className="grid grid-cols-3 gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            onClick={() => onPick(o.id)}
            title={o.hint}
            className={'rounded-lg border px-2 py-2 text-xs transition ' + (value === o.id ? 'border-flood-400 bg-flood-400/10 text-flood-200' : 'border-slate-700 text-slate-300 hover:border-flood-400/50')}
          >
            <span className="block font-semibold">{o.label}</span>
            <span className="mt-0.5 block text-[10px] font-normal text-slate-500">{o.hint}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** La Lavagnetta (G2): modulo con slot, tattiche di squadra e l'undici
 *  che ne uscirebbe — dazio di ruolo incluso, suggerimento a fondo pagina. */
export default function TacticsBoard({ career, squad, round, onDone }) {
  const saved = useMemo(() => ({ ...DEFAULT_TACTICS, ...(career.tactics || {}) }), [career])
  const [draft, setDraft] = useState(saved)
  const seniors = useMemo(() => squad.filter((p) => !p.youth), [squad])
  const xi = useMemo(() => bestXIFor(draft.formation, seniors), [draft.formation, seniors])
  const suggest = useMemo(() => bestFormationFor(null, seniors), [seniors])
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

  const set = (k, v) => setDraft((d) => ({ ...d, [k]: v }))
  const repartoAvg = (slot) => {
    const list = xi.filter((p) => p.slot === slot)
    if (!list.length) return 0
    return Math.round(list.reduce((s, p) => s + p.ovr * affinity(p.role, p.slot), 0) / list.length)
  }

  async function save() {
    await setTactics(career.id, draft)
    onDone()
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div className="rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-4">
        <h3 className="scoreboard mb-3 text-xs font-semibold text-slate-400">Modulo</h3>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {FORMATION_ORDER.map((f) => (
            <button
              key={f}
              onClick={() => set('formation', f)}
              className={'rounded-lg border px-2 py-2.5 text-center transition ' + (draft.formation === f ? 'border-flood-400 bg-flood-400/10' : 'border-slate-700 hover:border-flood-400/50')}
            >
              <span className={'block text-sm font-bold ' + (draft.formation === f ? 'text-flood-200' : 'text-slate-200')}>{FORMATIONS[f].name}</span>
              <span className="block text-[10px] text-slate-500">{FORMATIONS[f].label}</span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          Suggerimento della vigilia: per questa rosa il migliore sarebbe il {FORMATIONS[suggest].name}. Ma la lavagnetta è tua.
        </p>
      </div>

      <div className="rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-4">
        <h3 className="scoreboard mb-3 text-xs font-semibold text-slate-400">L'undici che scenderebbe in campo</h3>
        {['FW', 'MF', 'DF', 'GK'].map((r) => (
          <div key={r} className="mb-3 last:mb-0">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{SLOT_LABELS[r]}</p>
            <div className="flex flex-wrap gap-1.5">
              {xi.filter((p) => p.slot === r).map((p) => {
                const out = affinity(p.role, p.slot) < 1
                const injured = p.injuredUntil && round <= p.injuredUntil
                const banned = p.bannedUntil && round <= p.bannedUntil
                return (
                  <span
                    key={p.id}
                    className={'rounded-lg border px-2 py-1 text-xs ' + (out ? 'border-amber-500/50 bg-amber-500/5 text-amber-200' : 'border-slate-700 bg-pitch-900 text-slate-200')}
                    title={out ? 'Fuori ruolo: rende meno' : 'Ruolo naturale'}
                  >
                    {p.name} · {p.ovr}
                    {out ? ' · fuori ruolo' : ''}
                    {injured ? ' · infortunato' : ''}
                    {banned ? ' · squalificato' : ''}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-slate-800 bg-pitch-950/40 p-3 text-center">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Attacco</p>
            <p className="text-lg font-bold text-flood-300">{repartoAvg('FW')}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Centrocampo</p>
            <p className="text-lg font-bold text-flood-300">{repartoAvg('MF')}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Difesa</p>
            <p className="text-lg font-bold text-flood-300">{repartoAvg('DF')}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-4">
        <PillGroup title="Mentalità" options={MENTALITIES} value={draft.mentality} onPick={(v) => set('mentality', v)} />
        <PillGroup title="Pressing" options={PRESSINGS} value={draft.pressing} onPick={(v) => set('pressing', v)} />
        <PillGroup title="Linea difensiva" options={LINES} value={draft.line} onPick={(v) => set('line', v)} />
      </div>

      <button
        onClick={save}
        disabled={!dirty}
        className="w-full rounded-lg bg-teal-500 py-2.5 text-sm font-semibold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:bg-teal-400 hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98] disabled:opacity-40 disabled:shadow-none"
      >
        {dirty ? 'Salva la lavagnetta' : 'La lavagnetta è già legge'}
      </button>
      <p className="text-center text-[10px] text-slate-500">
        Mentalità, pressing e linea spostano i gol attesi; il modulo decide i matchup. Tutto nel seed, niente dadi truccati.
      </p>
    </div>
  )
}
