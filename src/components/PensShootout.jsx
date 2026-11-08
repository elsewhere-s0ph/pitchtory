import { useEffect, useMemo, useState } from 'react'
import { Rng } from '../lib/rng'
import { hasAbility } from '../game/abilities'

/**
 * Rigori della Coppa Nazionale Trofeo Bellandi: chi guarda gioca.
 * I tiri della propria squadra sono QTE dal dischetto: tre piazzamenti
 * estratti a ogni giro da un pool di dieci, con esiti (gol, parata, palo
 * o fuori) scritti nel seed della partita. I tiri avversari si difendono
 * da portieri: scegli la direzione del tuffo, se è quella del tiratore
 * il rigore è parato — a meno che non lo sbagli lui da solo.
 * Deterministico come tutto il resto: stessa partita, stessa scelta,
 * stesso dischetto.
 */

const ZONE_LABELS = {
  AD: "angolo alto a destra",
  AS: "angolo alto a sinistra",
  BD: "angolo basso a destra",
  BS: "angolo basso a sinistra",
  C: "al centro",
}

/** Dieci modi di calciare dal dischetto, zone e rischi diversi. */
const PLACEMENTS = [
  { id: "cucchiaio", label: "Cucchiaio", hint: "Palla lenta al centro: umilia chi resta in mezzo... se resta in mezzo", zone: "C", post: 0.02, out: 0.10 },
  { id: "centrale-forte", label: "Forte al centro", hint: "Il portiere che si tuffa lo rende un gol facile", zone: "C", post: 0.02, out: 0.04 },
  { id: "alto-dx-forte", label: "Forte nell\'angolo alto a destra", hint: "Il classico che spacca la rete... o la traversa", zone: "AD", post: 0.09, out: 0.15 },
  { id: "alto-sx-forte", label: "Forte nell\'angolo alto a sinistra", hint: "Il classico che spacca la rete... o la traversa", zone: "AS", post: 0.09, out: 0.15 },
  { id: "incrocio-dx", label: "Subito sotto l\'incrocio a destra", hint: "O capolavoro o tabellone pubblicitario", zone: "AD", post: 0.14, out: 0.22 },
  { id: "incrocio-sx", label: "Subito sotto l\'incrocio a sinistra", hint: "O capolavoro o tabellone pubblicitario", zone: "AS", post: 0.14, out: 0.22 },
  { id: "basso-dx-piazzato", label: "Piazzato all\'angolo basso a destra", hint: "Poco elegantissimo, molto efficiente", zone: "BD", post: 0.03, out: 0.05 },
  { id: "basso-sx-piazzato", label: "Piazzato all\'angolo basso a sinistra", hint: "Poco elegantissimo, molto efficiente", zone: "BS", post: 0.03, out: 0.05 },
  { id: "basso-dx-forte", label: "Forte all\'angolo basso a destra", hint: "Raso al suolo e prepotente, ma i portieri vivono lì", zone: "BD", post: 0.06, out: 0.14 },
  { id: "basso-sx-forte", label: "Forte all\'angolo basso a sinistra", hint: "Raso al suolo e prepotente, ma i portieri vivono lì", zone: "BS", post: 0.06, out: 0.14 },
]

const DIVE_ZONES = [
  { zone: "AD", label: "Volo in alto a destra" },
  { zone: "AS", label: "Volo in alto a sinistra" },
  { zone: "BD", label: "Tuffo in basso a destra" },
  { zone: "BS", label: "Tuffo in basso a sinistra" },
  { zone: "C", label: "Resta al centro" },
]

const RESULT_LABEL = { goal: "GOL", save: "PARATO", post: "PALO", out: "FUORI" }

function hash(seedNumber, a, b) {
  return (seedNumber ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0
}

/** Il tuffo naturale di un portiere AI: i bassi si scelgono più degli alti. */
function weightedZone(rng) {
  const r = rng.float()
  if (r < 0.22) return "AD"
  if (r < 0.44) return "AS"
  if (r < 0.70) return "BD"
  if (r < 0.96) return "BS"
  return "C"
}

/** Palo e fuori: chi ha Ghiaccio nelle vene sbaglia molto meno. */
function missChances(shooter, pl) {
  let f = 1
  if (hasAbility(shooter, "ghiaccio")) f *= 0.45
  if (shooter.ovr >= 78) f *= 0.7
  else if (shooter.ovr <= 58) f *= 1.5
  return { post: Math.min(0.3, pl.post * f), out: Math.min(0.35, pl.out * f) }
}

/** Quanto il portiere legge il tiro: OVR alto legge più spesso, Muro di Gomma pure. */
function guessProb(gk) {
  let p = 0.14 + (gk && gk.ovr ? (gk.ovr - 58) * 0.003 : 0)
  if (gk && hasAbility(gk, "muro")) p += 0.04
  return Math.max(0.08, Math.min(0.32, p))
}

/** Ordine dei tiratori: prima i non-portieri per ghiaccio e OVR, il portiere sempre per ultimo. */
function kickOrder(list) {
  const gkLast = (a, b) => (a.role === "GK" ? 1 : 0) - (b.role === "GK" ? 1 : 0)
  const bySkill = (a, b) => {
    const ga = hasAbility(a, "ghiaccio") ? 1 : 0
    const gb = hasAbility(b, "ghiaccio") ? 1 : 0
    return gb - ga || b.ovr - a.ovr || (a.id < b.id ? -1 : 1)
  }
  return (list || []).slice().sort((a, b) => gkLast(a, b) || bySkill(a, b))
}

/** Tiro della propria squadra: esito da (seed, numero tiro, piazzamento). */
function resolveUserKick(seedNumber, kickNo, pl, shooter, gk) {
  const plIndex = PLACEMENTS.indexOf(pl)
  const baseZone = weightedZone(new Rng(hash(seedNumber, kickNo, 7)))
  const rng = new Rng(hash(seedNumber, kickNo, 100 + plIndex))
  const guessed = rng.float() < guessProb(gk)
  const gkZone = guessed ? pl.zone : baseZone
  const mc = missChances(shooter, pl)
  const r = rng.float()
  if (r < mc.post) return { result: "post", gkZone }
  if (r < mc.post + mc.out) return { result: "out", gkZone }
  return { result: gkZone === pl.zone ? "save" : "goal", gkZone }
}

/** Tiro della squadra AI: il piazzamento è nel seed, la parata nella direzione scelta. */
function resolveOppKick(seedNumber, kickNo, diveZone, shooter) {
  const pl = new Rng(hash(seedNumber, kickNo, 500)).pick(PLACEMENTS)
  const mc = missChances(shooter, pl)
  const rng = new Rng(hash(seedNumber, kickNo, 600))
  const r = rng.float()
  if (r < mc.post) return { result: "post", zone: pl.zone }
  if (r < mc.post + mc.out) return { result: "out", zone: pl.zone }
  return { result: pl.zone === diveZone ? "save" : "goal", zone: pl.zone }
}

export default function PensShootout({
  seedNumber,
  userIsHome,
  userClub,
  oppClub,
  userTakers,
  oppTakers,
  userGk,
  oppGk,
  auto,
  onComplete,
}) {
  const userOrder = kickOrder(userTakers)
  const oppOrder = kickOrder(oppTakers)
  const userSide = userIsHome ? "home" : "away"
  const oppSide = userIsHome ? "away" : "home"
  const [kicks, setKicks] = useState([])

  const sideGoals = (side) => kicks.filter((k) => k.side === side && k.result === "goal").length
  const sideTaken = (side) => kicks.filter((k) => k.side === side).length
  const hs = sideGoals("home")
  const as = sideGoals("away")
  const hTaken = sideTaken("home")
  const aTaken = sideTaken("away")
  const nextSide = hTaken <= aTaken ? "home" : "away"

  /** Vittoria matematica nei primi 5 tiri, poi morte improvvisa. */
  const winner = useMemo(() => {
    if (hTaken <= 5 && aTaken <= 5) {
      if (hs > as + (5 - aTaken)) return "home"
      if (as > hs + (5 - hTaken)) return "away"
      return null
    }
    if (hTaken === aTaken && hs !== as) return hs > as ? "home" : "away"
    if (hTaken >= 35) return hs >= as ? "home" : "away"
    return null
  }, [hs, as, hTaken, aTaken])

  const userKickNo = sideTaken(userSide) + 1
  const oppKickNo = sideTaken(oppSide) + 1
  const userTurn = !winner && nextSide === userSide
  const oppTurn = !winner && nextSide !== userSide
  const userTaker = userOrder.length ? userOrder[(userKickNo - 1) % userOrder.length] : null
  const oppTaker = oppOrder.length ? oppOrder[(oppKickNo - 1) % oppOrder.length] : null
  const options = useMemo(
    () => (userTurn ? new Rng(hash(seedNumber, userKickNo, 77)).shuffle(PLACEMENTS.slice()).slice(0, 3) : []),
    [seedNumber, userTurn, userKickNo],
  )

  function kickForUser(pl) {
    const res = resolveUserKick(seedNumber, userKickNo, pl, userTaker, oppGk)
    setKicks((ks) => [...ks, { side: userSide, taker: userTaker, result: res.result, zone: pl.zone }])
  }

  function kickForOpp(diveZone) {
    const res = resolveOppKick(seedNumber, oppKickNo, diveZone, oppTaker)
    setKicks((ks) => [...ks, { side: oppSide, taker: oppTaker, result: res.result, zone: res.zone, diveZone }])
  }

  function kickText(k) {
    const name = k.taker ? k.taker.name : "Il tiratore"
    const zone = ZONE_LABELS[k.zone] || "in porta"
    if (k.result === "goal") return name + " la mette " + zone + ": dal dischetto non sbaglia"
    if (k.result === "save") return name + " la mette " + zone + ": il portiere stava lì, parata"
    if (k.result === "post") return name + " dal dischetto trova il palo: che rumore"
    return name + " la spara fuori: lo specchio resta intatto"
  }

  /** Conclusione: eventi per la cronaca e verdetto per il database. */
  function finish(w) {
    const winnerClub = w === "home" ? (userIsHome ? userClub : oppClub) : (userIsHome ? oppClub : userClub)
    const events = kicks.map((k, i) => ({
      minute: 91 + i,
      type: "pen",
      side: k.side,
      playerId: k.taker ? k.taker.id : undefined,
      text: kickText(k),
    }))
    events.push({
      minute: 91 + kicks.length,
      type: "pen",
      text: "Rigori " + hs + "-" + as + ": passa il " + winnerClub.name + ". Il Trofeo Bellandi non guarda in faccia nessuno",
    })
    onComplete({ cupWinnerId: winnerClub.id, homePens: hs, awayPens: as, events })
  }

  // Modalità salta: i rigori si tirano da soli, deterministici.
  useEffect(() => {
    if (!auto || winner) return
    const id = setTimeout(() => {
      if (nextSide === userSide) {
        const best = options.slice().sort((a, b) => a.post + a.out - (b.post + b.out))[0]
        kickForUser(best)
      } else {
        const dive = weightedZone(new Rng(hash(seedNumber, oppKickNo, 999)))
        kickForOpp(dive)
      }
    }, 650)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, kicks, winner])

  // Verdetto: un respiro e si torna in spogliatoio.
  useEffect(() => {
    if (!winner) return
    const id = setTimeout(() => finish(winner), 1100)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winner])

  const homeName = userIsHome ? userClub.name : oppClub.name
  const awayName = userIsHome ? oppClub.name : userClub.name

  function dots(side) {
    const taken = kicks.filter((k) => k.side === side)
    const total = Math.max(5, taken.length + (side === nextSide && !winner ? 1 : 0))
    const cells = []
    for (let i = 0; i < total; i++) {
      const k = taken[i]
      cells.push(
        <span
          key={i}
          title={k ? (k.taker ? k.taker.name : "") + ": " + RESULT_LABEL[k.result] : "Da calciare"}
          className={'inline-block h-3 w-3 rounded-full border ' + (!k ? 'border-slate-600 bg-slate-800' : k.result === 'goal' ? 'border-teal-400 bg-teal-500' : 'border-red-500 bg-red-500/60')}
        />,
      )
    }
    return cells
  }

  return (
    <div className="mt-6">
      <p className="scoreboard text-center text-sm tracking-[0.3em] text-flood-300">RIGORI</p>
      <div className="scoreboard mt-3 flex items-center justify-between gap-2 text-base font-semibold">
        <span className="min-w-0 flex-1 truncate text-right">{homeName}</span>
        <span className="shrink-0 rounded-lg border border-pitch-700 bg-pitch-800/80 px-4 py-1 text-2xl tabular-nums tracking-widest text-flood-300">{hs}-{as}</span>
        <span className="min-w-0 flex-1 truncate">{awayName}</span>
      </div>
      <div className="mt-3 flex justify-center gap-10">
        <div className="flex gap-1.5">{dots("home")}</div>
        <div className="flex gap-1.5">{dots("away")}</div>
      </div>

      {userTurn && userTaker && (
        <div className="mt-5 rounded-xl border-2 border-flood-400/60 bg-pitch-900 p-4 shadow-[0_0_28px_rgba(239,191,78,0.12)]">
          <p className="text-sm font-semibold text-amber-400">
            Dal dischetto: {userTaker.name}
            {hasAbility(userTaker, "ghiaccio") && <span className="ml-1 text-amber-300" title="Ghiaccio nelle vene: sbaglia molto meno">✦</span>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Scegli come la calcia — davanti c\'è {oppGk ? oppGk.name : "il portiere avversario"}</p>
          <div className="mt-2 space-y-2">
            {options.map((pl) => (
              <button
                key={pl.id}
                onClick={() => kickForUser(pl)}
                className="w-full rounded-lg border border-slate-700 px-3 py-2.5 text-left transition hover:border-amber-500 hover:bg-amber-500/5 active:scale-[0.99]"
              >
                <span className="text-sm font-semibold">{pl.label}</span>
                <span className="ml-2 text-xs text-slate-400">{pl.hint}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {oppTurn && oppTaker && (
        <div className="mt-5 rounded-xl border-2 border-teal-500/50 bg-pitch-900 p-4">
          <p className="text-sm font-semibold text-teal-300">
            Sul dischetto: {oppTaker.name} — tra i pali c\'è {userGk ? userGk.name : "il tuo portiere"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">Scegli il tuffo: stessa direzione del tiro, parata</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {DIVE_ZONES.map((d) => (
              <button
                key={d.zone}
                onClick={() => kickForOpp(d.zone)}
                className="rounded-lg border border-slate-700 px-3 py-2.5 text-left text-sm font-semibold transition hover:border-teal-400 hover:bg-teal-500/5 active:scale-[0.99]"
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {winner && (
        <div className="mt-6 text-center">
          <p className="scoreboard animate-goal-flash inline-block rounded-lg px-4 text-xl text-flood-300">
            Rigori: {hs}-{as} — passa il {winner === "home" ? homeName : awayName}
          </p>
        </div>
      )}

      <ul className="mt-5 space-y-2">
        {kicks.slice().reverse().map((k, i) => (
          <li key={i} className="animate-slide-in rounded-lg border border-flood-400/40 bg-flood-400/5 px-3 py-2 text-sm text-flood-200">
            <span className="mr-2 text-xs text-slate-500">{91 + (kicks.length - 1 - i)}'</span>
            {kickText(k)}
          </li>
        ))}
      </ul>
    </div>
  )
}