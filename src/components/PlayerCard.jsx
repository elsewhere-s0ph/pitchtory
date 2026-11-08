import { OVR_WEIGHTS, ATTR_LABELS } from '../game/attributes'
import { scoutedPotential } from '../game/scouting'
import { ABILITIES, RARITY_LABEL } from '../game/abilities'

const ROLE_LABELS = { GK: 'Portiere', DF: 'Difensore', MF: 'Centrocampista', FW: 'Attaccante' }

function fmtMoney(v) {
  if (v >= 1e6) return (v / 1e6).toFixed(1).replace('.', ',') + 'M'
  if (v >= 1e3) return Math.round(v / 1e3) + 'k'
  return String(v)
}

function barColor(v) {
  if (v >= 16) return 'bg-teal-400'
  if (v >= 12) return 'bg-teal-600'
  if (v >= 8) return 'bg-amber-600'
  return 'bg-red-500'
}

function AttrRow({ label, value }) {
  return (
    <li className="flex items-center gap-3">
      <span className="w-24 shrink-0 text-xs text-slate-400">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded bg-slate-800">
        <span className={'block h-1.5 rounded ' + barColor(value)} style={{ width: (value / 20) * 100 + '%' }} />
      </span>
      <span className="w-6 shrink-0 text-right text-xs font-semibold tabular-nums">{value}</span>
    </li>
  )
}

/** Scheda giocatore: attributi 1-20, contratto, statistiche di stagione,
 * stima del potenziale per la Primavera. Si apre tappando un nome in Rosa. */
export default function PlayerCard({ player, scouts, round, onClose }) {
  const attrs = player.attributes || {}
  const w = OVR_WEIGHTS[player.role] || OVR_WEIGHTS.MF
  const keys = [...Object.keys(w), ...(player.role === 'GK' ? ['speed'] : [])].filter(
    (k, i, a) => a.indexOf(k) === i,
  )
  const injured = player.injuredUntil && round <= player.injuredUntil
  const moraleColor = player.morale >= 75 ? 'bg-emerald-500' : player.morale >= 55 ? 'bg-amber-500' : 'bg-red-500'
  const expiring = player.contractUntil <= new Date().getFullYear() + 1

  return (
    <div
      className="fixed inset-0 z-30 overflow-y-auto bg-pitch-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="animate-fade-up mx-auto mt-6 max-w-sm rounded-2xl border border-pitch-700 bg-pitch-900 p-5 shadow-[0_0_40px_rgba(239,191,78,0.06),0_10px_40px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.25em] text-teal-400">
              {ROLE_LABELS[player.role]} · {player.age} anni{player.youth ? ' · Primavera' : ''}
            </p>
            <h2 className="scoreboard truncate text-2xl font-semibold">{player.name}</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {player.personality} · piede {player.foot || 'destro'}
            </p>
          </div>
          <div className="shrink-0 text-center">
            <p className="text-4xl font-bold tabular-nums text-flood-300">{player.ovr}</p>
            <p className="text-[10px] uppercase text-slate-500">Overall</p>
          </div>
        </div>

        <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-slate-300">
          <li>Valore: <b>{fmtMoney(player.value)}</b></li>
          <li>Stipendio: <b>{fmtMoney(player.wage)}</b> <span className="text-slate-500">a stagione</span></li>
          <li>
            Contratto: <b>fino al {player.contractUntil}</b>
            {expiring && <span className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] text-amber-400">Scade</span>}
          </li>
          <li className="flex items-center gap-1.5">
            Morale: <span className={'inline-block h-2 w-2 rounded-full ' + moraleColor} /> <b>{player.morale}</b>
          </li>
          <li>Presenze: <b>{player.apps || 0}</b></li>
          <li>Gol: <b>{player.goals || 0}</b></li>
          <li>Minuti: <b>{player.minutes || 0}</b></li>
          {injured && (
            <li className="col-span-2 text-red-400">
              Infortunato: fuori fino alla giornata <b>{player.injuredUntil}</b>
            </li>
          )}
        </ul>

        {player.youth && (
          <p className="mt-3 rounded-lg border border-slate-800 bg-pitch-950/60 px-3 py-2 text-xs text-slate-400">
            Potenziale stimato dai tuoi osservatori: <b className="text-teal-300">~{scoutedPotential(player, scouts)}</b>
            — non tutti i giovani diventano campioni.
          </p>
        )}

        {Array.isArray(player.abilities) && player.abilities.length > 0 && (
          <div className="mt-3">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Abilità speciali</h3>
            <div className="flex flex-wrap gap-1.5">
              {player.abilities.map((id) => {
                const a = ABILITIES[id]
                if (!a) return null
                const tone = a.rarity === 'leggendaria'
                  ? 'border-flood-400/60 bg-flood-400/10 text-flood-300 shadow-[0_0_12px_rgba(239,191,78,0.25)]'
                  : a.rarity === 'rara'
                    ? 'border-teal-400/40 bg-teal-400/10 text-teal-300'
                    : 'border-slate-600 bg-slate-800 text-slate-300'
                return (
                  <span key={id} title={a.desc} className={'rounded border px-2 py-0.5 text-xs ' + tone}>
                    {a.name} · {RARITY_LABEL[a.rarity]}
                  </span>
                )
              })}
            </div>
          </div>
        )}

        <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Attributi</h3>
        <ul className="space-y-1.5">
          {keys.map((k) => (
            <AttrRow key={k} label={ATTR_LABELS[k] || k} value={attrs[k] || 0} />
          ))}
        </ul>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg border border-slate-700 py-2 text-sm text-slate-300 hover:border-teal-500"
        >
          Chiudi
        </button>
      </div>
    </div>
  )
}
