import { useMemo, useState } from 'react'
import { setTactics, setLineup } from '../db'
import { FORMATIONS, FORMATION_ORDER, DEFAULT_TACTICS, affinity, lineupXI, remapPicks, bestFormationFor } from '../game/tactics'

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

/** La Lavagnetta (G2): modulo, tattiche di squadra e l'undici — che da
 *  G2.1 si sceglie slot per slot, dazio di ruolo incluso. */
export default function TacticsBoard({ career, squad, round, onDone }) {
  const saved = useMemo(() => ({ ...DEFAULT_TACTICS, ...(career.tactics || {}) }), [career])
  const seniors = useMemo(() => squad.filter((p) => !p.youth), [squad])
  // Chi può davvero scendere in campo questa giornata.
  const fit = useMemo(
    () =>
      seniors.filter(
        (p) => !(p.injuredUntil && round <= p.injuredUntil) && !(p.bannedUntil && round <= p.bannedUntil),
      ),
    [seniors, round],
  )
  const savedPicks = useMemo(
    () =>
      career.lineup && career.lineup.formation === saved.formation && Array.isArray(career.lineup.picks)
        ? career.lineup.picks
        : null,
    [career, saved],
  )
  const [draft, setDraft] = useState(saved)
  const [picks, setPicks] = useState(() => {
    const n = (FORMATIONS[saved.formation] || FORMATIONS['442']).slots.length
    return savedPicks ? savedPicks.slice() : new Array(n).fill(null)
  })
  const [pickSlot, setPickSlot] = useState(null)
  const slots = FORMATIONS[draft.formation].slots
  const xi = useMemo(() => lineupXI(draft.formation, fit, picks), [draft.formation, fit, picks])
  // Il k-esimo giocatore di un reparto nello schieramento corrisponde al
  // k-esimo slot di quel reparto nel modulo (entrambi in ordine).
  const xiBySlotIndex = useMemo(() => {
    const m = {}
    const seen = { GK: 0, DF: 0, MF: 0, FW: 0 }
    for (const p of xi) {
      m[p.slot + ':' + seen[p.slot]] = p
      seen[p.slot] += 1
    }
    return m
  }, [xi])
  const suggest = useMemo(() => bestFormationFor(null, fit), [fit])
  const hasPicks = picks.some((id) => id != null)
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved) ||
    JSON.stringify(picks) !== JSON.stringify(savedPicks || new Array(slots.length).fill(null))

  const set = (k, v) => {
    if (k === 'formation' && v !== draft.formation) {
      setPicks((old) => remapPicks(v, fit, old))
      setPickSlot(null)
    }
    setDraft((d) => ({ ...d, [k]: v }))
  }

  const chooseFor = (i, playerId) => {
    setPicks((old) => {
      const next = old.slice()
      if (playerId == null) {
        next[i] = null
        return next
      }
      const at = next.indexOf(playerId)
      if (at >= 0) next[at] = next[i]
      next[i] = playerId
      return next
    })
    setPickSlot(null)
  }

  const repartoAvg = (slot) => {
    const list = xi.filter((p) => p.slot === slot)
    if (!list.length) return 0
    return Math.round(list.reduce((s, p) => s + p.ovr * affinity(p.role, p.slot), 0) / list.length)
  }

  async function save() {
    await setTactics(career.id, draft)
    await setLineup(career.id, hasPicks ? { formation: draft.formation, picks } : null)
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
        <h3 className="scoreboard mb-2 text-xs font-semibold text-slate-400">L'undici che scende in campo</h3>
        <p className="mb-3 text-[11px] text-slate-500">
          Tocca un nome per decidere chi va in quello slot. Fuori ruolo = dazio: rende meno come squadra e pesa meno quando la partita sceglie i protagonisti.
        </p>
        {['FW', 'MF', 'DF', 'GK'].map((r) => (
          <div key={r} className="mb-3 last:mb-0">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">{SLOT_LABELS[r]}</p>
            <div className="flex flex-wrap gap-1.5">
              {slots.map((s, i) => ({ s, i })).filter((x) => x.s === r).map((x) => {
                const seen = slots.slice(0, x.i).filter((s) => s === r).length
                const p = xiBySlotIndex[r + ':' + seen]
                if (!p) return null
                const aff = affinity(p.role, p.slot)
                const out = aff < 1
                const chosen = picks[x.i] === p.id
                return (
                  <button
                    key={p.id + '-' + x.i}
                    onClick={() => setPickSlot(pickSlot === x.i ? null : x.i)}
                    className={
                      'rounded-lg border px-2 py-1 text-xs transition ' +
                      (pickSlot === x.i
                        ? 'border-teal-400 bg-teal-400/10 text-teal-200'
                        : out
                          ? 'border-amber-500/50 bg-amber-500/5 text-amber-200 hover:border-amber-400'
                          : 'border-slate-700 bg-pitch-900 text-slate-200 hover:border-teal-500/60')
                    }
                    title={out ? 'Fuori ruolo: OVR efficace ' + Math.round(p.ovr * aff) + ' su ' + p.ovr : chosen ? 'Scelto da te: tocca per cambiare' : 'Scelta dello staff: tocca per cambiare'}
                  >
                    {p.name} · {out ? Math.round(p.ovr * aff) + ' su ' + p.ovr + ' · fuori ruolo' : p.ovr}
                    {chosen ? ' ✓' : ''}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        {pickSlot !== null && (
          <div className="mt-2 rounded-lg border border-teal-500/40 bg-pitch-950/60 p-3">
            <p className="text-xs font-semibold text-teal-300">
              Slot {SLOT_LABELS[slots[pickSlot]]}: chi mandi in campo?
            </p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              <button
                onClick={() => chooseFor(pickSlot, null)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-left text-xs text-slate-300 transition hover:border-teal-500"
              >
                Lascia scegliere allo staff
              </button>
              {fit
                .slice()
                .sort(
                  (a, b) =>
                    b.ovr * affinity(b.role, slots[pickSlot]) - a.ovr * affinity(a.role, slots[pickSlot]) ||
                    (a.id < b.id ? -1 : 1),
                )
                .map((p) => {
                  const aff = affinity(p.role, slots[pickSlot])
                  const out = aff < 1
                  const elsewhere = picks.indexOf(p.id) >= 0 && picks[pickSlot] !== p.id
                  return (
                    <button
                      key={p.id}
                      onClick={() => chooseFor(pickSlot, p.id)}
                      className={
                        'rounded-lg border px-3 py-1.5 text-left text-xs transition ' +
                        (picks[pickSlot] === p.id
                          ? 'border-teal-400 bg-teal-400/10 text-teal-200'
                          : 'border-slate-700 text-slate-300 hover:border-teal-500')
                      }
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate">
                          {p.name} · {p.role}
                        </span>
                        <span className={'shrink-0 tabular-nums ' + (out ? 'text-amber-300' : 'text-slate-400')}>
                          {p.ovr}{out ? ' → ' + Math.round(p.ovr * aff) : ''}
                        </span>
                      </span>
                      {elsewhere && <span className="block text-[10px] text-slate-500">Già titolare altrove: si scambiano di slot</span>}
                    </button>
                  )
                })}
            </div>
          </div>
        )}

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
        <p className="mt-2 text-[10px] text-slate-500">
          L'undici salvato vale per ogni partita finché il modulo non cambia; chi manca all'appello (infortunio, squalifica, cessione) torna automatico.
        </p>
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
        Mentalità, pressing e linea spostano i gol attesi; il modulo decide i matchup; l'undici lo scrivi tu, slot per slot. Tutto nel seed, niente dadi truccati.
      </p>
    </div>
  )
}
