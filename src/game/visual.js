/**
 * Campo Vivo (V1.1 + V1.2): la telecronaca che si vede. Il regista prende
 * il copione di buildMatch e lo trasforma in movimento: la palla viaggia
 * per zone di possesso, i 22 pallini tengono il modulo e il blocco sale
 * e scende con la palla. Puro e deterministico dal seed: stessa partita,
 * stesso movimento — ricaricare non cambia niente, come i QTE.
 *
 * V1.2 — il regista degli eventi: ogni gol ha la sua azione costruita
 * (possesso che sale, cambio di gioco, pallone in area, tiro SOLO
 * dall'area o sul limite, palla in rete al minuto esatto della
 * cronaca), i contropiedi dei QTE corrono, i rigori si vedono dal
 * dischetto, le occasioni muoiono con la parata, i cartellini fanno
 * lampeggiare il pallino del colpevole e il marcatore si accende d'oro.
 *
 * Regola di ferro: la coreografia serve la cronaca, non la sostituisce.
 */
import { Rng } from '../lib/rng'
import { FORMATIONS } from './tactics'

/** Il campo si misura in metri: 105 per 68, la casa attacca a destra. */
export const PITCH_W = 105
export const PITCH_H = 68
const CX = PITCH_W / 2
const CY = PITCH_H / 2

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const ease = (t) => t * t * (3 - 2 * t)

/** x di partenza per reparto (frazione di campo, attacco a destra),
 *  quanto ogni reparto segue il pallone e i suoi limiti. Il portiere
 *  segue quasi per niente: qualcuno deve restare sulla porta. */
const ROLE_X = { GK: 0.045, DF: 0.19, MF: 0.44, FW: 0.7 }
const ROLE_SHIFT = { GK: 0.02, DF: 0.13, MF: 0.16, FW: 0.17 }
const ROLE_RANGE = {
  GK: [0.03, 0.08],
  DF: [0.08, 0.58],
  MF: [0.22, 0.8],
  FW: [0.42, 0.94],
}

const baseCache = {}

/** Posizioni base degli 11 slot di un modulo. Nel 4-2-3-1 i due mediani
 *  stanno sotto e i tre sopra; le altre linee restano compatte. */
export function basePositions(formId) {
  if (baseCache[formId]) return baseCache[formId]
  const form = FORMATIONS[formId] || FORMATIONS['442']
  const byRole = { GK: [], DF: [], MF: [], FW: [] }
  form.slots.forEach((r, i) => byRole[r].push(i))
  const out = new Array(form.slots.length)
  for (const role of ['GK', 'DF', 'MF', 'FW']) {
    const idxs = byRole[role]
    idxs.forEach((slotIdx, k) => {
      const y = (PITCH_H * (k + 1)) / (idxs.length + 1)
      let x = ROLE_X[role]
      if (formId === '4231' && role === 'MF') x = k < 2 ? 0.36 : 0.52
      out[slotIdx] = { x, y }
    })
  }
  baseCache[formId] = out
  return out
}

/** Il pallone non teletrasporta (possesso libero): da un punto
 *  all'altro con uno o due appoggi, così il gioco sembra giocato. */
function buildPath(rng, from, to) {
  const pts = [{ x: from.x, y: from.y }]
  const legs = rng.int(1, 2)
  // Lo scarto dei tocchi scala con la lunghezza del passaggio: sui
  // passaggi corti la palla non zigzaga più senza motivo.
  const dx = to.x - from.x
  const dy = to.y - from.y
  const leg = Math.sqrt(dx * dx + dy * dy) / (legs + 1)
  const jx = Math.min(7, leg * 0.35)
  const jy = Math.min(8, leg * 0.4)
  for (let i = 1; i <= legs; i++) {
    const u = i / (legs + 1)
    pts.push({
      x: from.x + dx * u + rng.float() * jx * 2 - jx,
      y: from.y + dy * u + rng.float() * jy * 2 - jy,
    })
  }
  pts.push({ x: to.x, y: to.y })
  return pts
}

function pointAlong(path, u) {
  const legs = path.length - 1
  const scaled = clamp(u, 0, 1) * legs
  const i = Math.min(legs - 1, Math.floor(scaled))
  const t = ease(scaled - i)
  const a = path[i]
  const b = path[i + 1]
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function carrierFor(rng, side, x) {
  const dir = side === 'home' ? 1 : -1
  const xf = dir === 1 ? x / PITCH_W : 1 - x / PITCH_W
  let role = 'MF'
  if (xf > 0.68) role = 'FW'
  else if (xf < 0.3) role = rng.chance(0.6) ? 'DF' : 'MF'
  return { role, k: rng.int(0, 1) }
}

function carrierApprox(side, c, rawX, rawY) {
  const dir = side === 'home' ? 1 : -1
  const shift = clamp(((rawX - CX) * dir) / CX, -1, 1)
  const range = ROLE_RANGE[c.role] || ROLE_RANGE.MF
  const xf = clamp(ROLE_X[c.role] + shift * (ROLE_SHIFT[c.role] || 0.1), range[0], range[1])
  return { x: dir === 1 ? xf * PITCH_W : PITCH_W - xf * PITCH_W, y: clamp(rawY, 6, PITCH_H - 6) }
}

function resolveSlot(formId, c) {
  if (!c) return -1
  const slots = (FORMATIONS[formId] || FORMATIONS['442']).slots
  let n = 0
  for (let i = 0; i < slots.length; i++) {
    if (slots[i] === c.role) {
      if (n === c.k) return i
      n++
    }
  }
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i] === c.role) return i
  }
  return -1
}

/** x a N metri dalla linea di porta attaccata (negativo = dentro la rete). */
function attackX(dir, meters) {
  return CX + dir * (CX - meters)
}

/** Finestre di coreografia in minuti di partita: quanto tempo ha la
 *  squadra per costruire l'azione prima dell'evento. Il contropiede
 *  corre, il rigore si prepara in fretta, il gol costruito respira. */
const CHOREO_WINDOW = {
  goal: 4,
  chance: 3,
  'goal-counter': 2.2,
  'chance-counter': 2.2,
  pen: 1.8,
  cross: 2.6,
  freekick: 2.2,
  'chance-post': 2.4,
  'chance-save': 2.4,
  'chance-high': 2.4,
}

/** Che coreografia merita l'evento: il tipo lo dice il copione, il
 *  testo dice se è un rigore, un pallone dal bandierino o una
 *  punizione; il badge qte segnala i colpi rapidi. */
function choreoKind(e) {
  const txt = e.text || ''
  if (txt.indexOf('rigore') >= 0 || txt.indexOf('Rigore') >= 0) return 'pen'
  if (
    txt.indexOf('corner') >= 0 ||
    txt.indexOf('Corner') >= 0 ||
    txt.indexOf('incornata') >= 0 ||
    txt.indexOf('colpo di testa') >= 0 ||
    txt.indexOf('cross') >= 0 ||
    txt.indexOf('Cross') >= 0
  ) {
    return 'cross'
  }
  if (txt.indexOf('punizione') >= 0 || txt.indexOf('Punizione') >= 0 || txt.indexOf('barriera') >= 0) return 'freekick'
  if (e.type === 'chance') {
    // Le occasioni si coreografano secondo l’esito scritto in cronaca:
    // palo, parata o tiro alto hanno ognuno il loro frame visibile.
    if (txt.indexOf('palo') >= 0 || txt.indexOf('Palo') >= 0) return 'chance-post'
    if (txt.indexOf('parata') >= 0 || txt.indexOf('Parata') >= 0) return 'chance-save'
    if (txt.indexOf('alto') >= 0 || txt.indexOf('Alto') >= 0) return 'chance-high'
    return 'chance'
  }
  if (e.qte) return e.type === 'goal' ? 'goal-counter' : 'chance-counter'
  return e.type === 'goal' ? 'goal' : 'chance'
}

/** I waypoint della coreografia. Il tiro parte SOLO dall'area o sul
 *  suo limite (mai da centrocampo), la rete sta dietro la linea e una
 *  parata muore lontano dalla porta. Il lato lo suggerisce il seed, il
 *  resto lo detta l'evento: porta e reparto arrivano dal copione. */
function choreograph(rng, kind, isGoal, side, fromPt) {
  const dir = side === 'home' ? 1 : -1
  const at = (meters, y) => ({ x: attackX(dir, meters), y: clamp(y, 2, PITCH_H - 2) })
  const flank = rng.chance(0.5) ? 1 : -1
  const pts = [{ x: fromPt.x, y: fromPt.y }]
  const finale = isGoal
    ? at(-1.3, CY + rng.float() * 5.5 - 2.75)
    : at(rng.float() * 10 + 22, CY + flank * (rng.float() * 14 + 10))

  if (kind === 'pen') {
    // Dal dischetto non si discute: la palla ci arriva, ci resta su,
    // poi entra (o muore parata). La rete arriva al minuto esatto.
    const spot = at(11, CY)
    pts.push(spot, spot, spot, finale)
    return pts
  }
  if (kind === 'freekick') {
    // Palla sul limite dell'area, un respiro di attesa, poi il tiro.
    const spot = at(rng.float() * 4 + 17, CY + flank * (rng.float() * 10 + 4))
    pts.push(at(rng.float() * 8 + 34, CY + rng.float() * 18 - 9), spot, spot, finale)
    return pts
  }
  if (kind === 'chance-post' || kind === 'chance-save' || kind === 'chance-high' || kind === 'chance') {
    // L’esito si vede: costruzione, tiro dall’area e il punto chiave
    // che cade sul minuto esatto della cronaca — palo, parata o alto.
    const shot = at(rng.float() * 9 + 5.5, CY + rng.float() * 17 - 8.5)
    pts.push(at(rng.float() * 10 + 42, CY + rng.float() * 22 - 11))
    pts.push(at(rng.float() * 8 + 26, CY + flank * (rng.float() * 10 + 8)))
    pts.push(shot)
    if (kind === 'chance-post') {
      pts.push({ x: attackX(dir, 0.2), y: CY + (flank === 1 ? -3.5 : 3.5) })
    } else if (kind === 'chance-save') {
      pts.push(at(1.2, CY + rng.float() * 5 - 2.5))
    } else if (kind === 'chance-high') {
      pts.push({ x: attackX(dir, -1.5), y: CY + flank * (rng.float() * 2.5 + 4.2) })
    } else {
      pts.push(finale)
    }
    return pts
  }
  // Il punto del tiro: dentro l'area o sul limite, sempre.
  const shot = at(rng.float() * 9 + 5.5, CY + rng.float() * 17 - 8.5)
  if (kind === 'cross') {
    // Dal bandierino (o dalla fondina) arriva il pallone, poi il colpo
    // di testa in area: la geometria del corner, senza inventarsi niente.
    pts.push(at(rng.float() * 8 + 36, CY + rng.float() * 16 - 8))
    pts.push(at(1.5, flank === 1 ? 3 : PITCH_H - 3))
    pts.push(shot, finale)
    return pts
  }
  if (kind === 'goal-counter' || kind === 'chance-counter') {
    // Contropiede: il recupero avviene vicino a dove la palla si trova
    // davvero (un respiro indietro, non un salto a centrocampo), poi si
    // corre in verticale, due tocchi soltanto.
    const pm = CX - dir * (fromPt.x - CX)
    const m1 = clamp(pm + rng.float() * 10 + 4, 26, 62)
    const m2 = clamp(m1 - rng.float() * 12 - 12, 18, m1 - 8)
    pts.push(at(m1, clamp(fromPt.y + rng.float() * 12 - 6, 8, PITCH_H - 8)))
    pts.push(at(m2, CY + flank * (rng.float() * 8 + 6)))
    pts.push(shot, finale)
    return pts
  }
  // Azione costruita: possesso che sale, cambio di gioco, apertura sul
  // lato, pallone in area. Come disegnata in lavagna.
  pts.push(at(rng.float() * 10 + 42, CY + rng.float() * 22 - 11))
  pts.push(at(rng.float() * 8 + 30, CY + flank * (rng.float() * 10 + 12)))
  pts.push(at(rng.float() * 8 + 20, CY + flank * (rng.float() * 6 + 3)))
  pts.push(shot, finale)
  return pts
}

/** Il regista: dal copione (eventi del match, base più scelte live)
 *  ai frame. Gli undici servono ai lampeggii: il pallino del colpevole
 *  o del marcatore è quello dello slot giusto, non uno a caso. */
export function makePitchDirector({ seedNumber, events, homeXI, awayXI }) {
  const rng = new Rng((seedNumber ^ 0x51ce) >>> 0)

  // Gli appuntamenti sacri: gol e occasioni, col loro minuto esatto.
  const hot = {}
  for (const e of events || []) {
    if (e.type === 'goal' || e.type === 'chance') hot[e.minute] = e
  }
  const appointments = Object.keys(hot).map(Number).sort((a, b) => a - b)

  // I lampeggii: cartellini gialli e rossi sul pallino del colpevole,
  // alone oro sul marcatore. Mai un dado: lo slot lo dice l'undici.
  const blinks = []
  const dotOf = (e) => {
    const list = e.side === 'home' ? homeXI : awayXI
    if (!list || !list.length) return -1
    const i = list.findIndex((p) => p.id === e.playerId)
    return i >= 0 && i < 11 ? i : -1
  }
  for (const e of events || []) {
    if (e.type === 'card' || e.type === 'red' || e.type === 'goal') {
      blinks.push({ minute: e.minute, kind: e.type, side: e.side, dot: dotOf(e) })
    }
  }

  const segments = []
  let t = 0
  let pos = { x: CX, y: CY }
  let side = rng.chance(0.54) ? 'home' : 'away'
  let ai = 0
  let cur = null
  // Fasi di possesso: la palla resta a una squadra per qualche tocco,
  // il cambio palla è un evento e non un dado che rulla ogni minuto.
  let phaseLeft = rng.int(2, 4)
  // Il tempo deve sempre avanzare: meglio un ultimo possesso corto
  // che una serata congelata sul 95esimo.
  let guard = 0
  while (t < 95.3 && guard++ < 600) {
    const m = ai < appointments.length ? appointments[ai] : null
    if (m !== null && m - t <= 7) {
      const e = hot[m]
      const kind = choreoKind(e)
      // La squadra dell'evento prepara l'azione con la palla ai piedi.
      side = e.side
      const from = Math.max(t + 0.05, m - (CHOREO_WINDOW[kind] || 3))
      if (from > t + 0.2) {
        const xf = 0.42 + rng.float() * 0.3
        const wx = side === 'home' ? xf * PITCH_W : PITCH_W - xf * PITCH_W
        const wc = carrierFor(rng, side, wx)
        const waitTarget = carrierApprox(side, wc, wx, rng.float() * (PITCH_H - 20) + 10)
        segments.push({ from: t, to: from, side, mode: 'carry', carrier: wc, prev: cur, path: buildPath(rng, pos, waitTarget) })
        pos = waitTarget
        cur = { side, carrier: wc }
      }
      const ch = choreograph(rng, kind, e.type === 'goal', side, pos)
      segments.push({ from, to: m, side, path: ch })
      pos = ch[ch.length - 1]
      cur = null
      if (e.type === 'goal') {
        // Esultanza: la palla resta in rete, poi calcio d'inizio al
        // centro — senza mai invadere il minuto dell'evento dopo.
        const next = appointments[ai + 1]
        const koTo = Math.min(95.3, m + 1, next !== undefined ? next - 0.8 : 95.3)
        if (koTo > m + 0.2) {
          segments.push({
            from: m,
            to: koTo,
            side: e.side,
            path: [
              { x: pos.x, y: pos.y },
              { x: pos.x, y: pos.y },
              { x: CX, y: CY },
            ],
          })
          pos = { x: CX, y: CY }
          side = e.side === 'home' ? 'away' : 'home'
          t = koTo
        } else {
          t = m
        }
      } else {
        const next2 = appointments[ai + 1]
        const deadTo = Math.min(95.3, m + 0.5, next2 !== undefined ? next2 - 0.8 : 95.3)
        if (deadTo > m + 0.15) {
          const dc = carrierFor(rng, e.side, pos.x)
          const dTarget = carrierApprox(e.side, dc, pos.x + (e.side === 'home' ? -6 : 6), pos.y)
          segments.push({ from: m, to: deadTo, side: e.side, mode: 'carry', carrier: dc, prev: null, path: [pos, dTarget] })
          pos = dTarget
          cur = { side: e.side, carrier: dc }
          t = deadTo
        } else {
          t = m
        }
      }
      ai++
      continue
    }
    // Possesso libero: la squadra in possesso spinge verso la porta
    // avversaria a tocchi corti; arrivata in profondità si riorganizza
    // e riparte indietro. Niente più punti casuali su tutto il campo.
    let to = Math.min(95.3, t + rng.int(1, 3))
    if (m !== null) to = Math.min(to, Math.max(t + 0.3, m - 7.2))
    const fdir = side === 'home' ? 1 : -1
    const deep = fdir === 1 ? pos.x > PITCH_W - 28 : pos.x < 28
    const step = deep ? -(rng.float() * 16 + 6) : rng.float() * 18 - 3
    const lateral = rng.float() * 22 - 11
    const rawX = clamp(pos.x + fdir * step, 8, PITCH_W - 8)
    const rawY = clamp(pos.y + lateral + (CY - pos.y) * 0.12, 6, PITCH_H - 6)
    let flip = false
    if (to - t >= 0.5) {
      phaseLeft -= 1
      if (phaseLeft <= 0 || rng.chance(0.15)) {
        flip = true
        phaseLeft = rng.int(2, 4)
      }
    }
    const newSide = flip ? (side === 'home' ? 'away' : 'home') : side
    const nc = carrierFor(rng, newSide, rawX)
    const target = carrierApprox(newSide, nc, rawX, rawY)
    segments.push({ from: t, to, side: newSide, mode: 'carry', carrier: nc, prev: cur, path: buildPath(rng, pos, target) })
    pos = target
    cur = { side: newSide, carrier: nc }
    side = newSide
    t = to
  }

  /** Il blocco squadra: tiene il modulo, segue la palla, respira.
   *  Quando difende in profondità si stringe anche in larghezza. */
  const teamFrame = (formId, ball, sideKey, minute) => {
    const form = FORMATIONS[formId] || FORMATIONS['442']
    const base = basePositions(formId)
    const dir = sideKey === 'home' ? 1 : -1
    const shift = clamp(((ball.x - CX) * dir) / CX, -1, 1)
    return base.map((b, i) => {
      const role = form.slots[i]
      const range = ROLE_RANGE[role] || ROLE_RANGE.MF
      const xf = clamp(b.x + shift * (ROLE_SHIFT[role] || 0.1), range[0], range[1])
      const squeeze = 1 - 0.16 * Math.max(0, -shift)
      const wx = Math.sin(minute * (0.32 + (i % 5) * 0.06) + i * 2.13) * 1.5
      const wy = Math.cos(minute * (0.27 + (i % 4) * 0.08) + i * 1.71) * 2.1
      return {
        x: dir === 1 ? xf * PITCH_W + wx : PITCH_W - xf * PITCH_W - wx,
        y: clamp(CY + (b.y - CY) * squeeze + wy, 3, PITCH_H - 3),
      }
    })
  }

  // Il transito del passaggio dura circa 7 secondi qualunque sia la
  // durata del segmento: la palla lascia il pallino del passatore e
  // arriva sul pallino del ricevente, poi ci resta incollata.
  const transitEnd = (seg) => Math.min(0.55, 0.2 + 0.12 / Math.max(0.05, seg.to - seg.from))
  const carryPoint = (seg, u, home, away, cIdx, pIdx) => {
    const te = transitEnd(seg)
    const list = seg.side === 'home' ? home : away
    const prevList = seg.prev && seg.prev.side === 'home' ? home : away
    const b = cIdx >= 0 && list[cIdx] ? list[cIdx] : null
    const a = pIdx >= 0 && prevList[pIdx] ? prevList[pIdx] : null
    if (u < 0.2) return a || pointAlong(seg.path, u)
    if (u < te) {
      const k = ease((u - 0.2) / (te - 0.2))
      if (a && b) return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }
      if (b) {
        const sp = pointAlong(seg.path, 0.2)
        return { x: sp.x + (b.x - sp.x) * k, y: sp.y + (b.y - sp.y) * k }
      }
    }
    return b || pointAlong(seg.path, u)
  }
  // Dove si trova davvero la palla alla FINE di un segmento: per i
  // segmenti di possesso e il pallino del portatore, per gli altri
  // lultimo punto del percorso. Serve a saldare i confini: il primo
  // punto del percorso successivo diventa questo, e nessun confine
  // teletrasporta piu la palla.
  const endBallOf = (seg, homeForm, awayForm) => {
    let ball = pointAlong(seg.path, 1)
    let home = teamFrame(homeForm, ball, 'home', seg.to)
    let away = teamFrame(awayForm, ball, 'away', seg.to)
    if (seg.mode === 'carry') {
      const cIdx = resolveSlot(seg.side === 'home' ? homeForm : awayForm, seg.carrier)
      for (let it = 0; it < 2; it++) {
        const cl = seg.side === 'home' ? home : away
        if (cIdx >= 0 && cl[cIdx]) ball = cl[cIdx]
        home = teamFrame(homeForm, ball, 'home', seg.to)
        away = teamFrame(awayForm, ball, 'away', seg.to)
      }
    }
    return ball
  }

  return {
    /** I lampeggii del regista, per il proiezionista. */
    marks: blinks,
    /** Il frame al minuto (anche frazionario): palla, 22 pallini, possesso. */
    frameAt(minute, homeForm, awayForm) {
      const m = clamp(minute, 0, 95.9)
      // L’ultimo segmento iniziato vince: nessun buco tra i segmenti,
      // la palla non salta mai da un punto all’altro senza motivo.
      let idx = 0
      for (let i = 0; i < segments.length; i++) {
        if (m >= segments[i].from) idx = i
        else break
      }
      const seg = segments[idx]
      const u = (m - seg.from) / Math.max(0.001, seg.to - seg.from)
      // Continuità garantita: il primo punto del percorso diventa il
      // punto in cui la palla si trova davvero alla fine del segmento
      // precedente. Anche il confine possesso→azione è un passaggio.
      if (idx > 0) {
        const prevEnd = endBallOf(segments[idx - 1], homeForm, awayForm)
        if (prevEnd) seg.path[0] = prevEnd
      }
      let ball = pointAlong(seg.path, u)
      let home = teamFrame(homeForm, ball, 'home', m)
      let away = teamFrame(awayForm, ball, 'away', m)
      const te = transitEnd(seg)
      if (seg.mode === 'carry') {
        const cIdx = resolveSlot(seg.side === 'home' ? homeForm : awayForm, seg.carrier)
        const pIdx = seg.prev && seg.prev.carrier ? resolveSlot(seg.prev.side === 'home' ? homeForm : awayForm, seg.prev.carrier) : -1
        for (let it = 0; it < 2; it++) {
          ball = carryPoint(seg, u, home, away, cIdx, pIdx)
          home = teamFrame(homeForm, ball, 'home', m)
          away = teamFrame(awayForm, ball, 'away', m)
        }
        if (u < 0.2 && pIdx >= 0) {
          const pl = seg.prev.side === 'home' ? home : away
          if (pl[pIdx]) ball = pl[pIdx]
        } else if (u >= te && cIdx >= 0) {
          const cl = seg.side === 'home' ? home : away
          if (cl[cIdx]) ball = cl[cIdx]
        }
      }
      const possession = seg.prev && seg.prev.side !== seg.side && u < 0.25 ? seg.prev.side : seg.side
      let carrier = null
      if (seg.mode === 'carry') {
        if (u >= te) {
          const s2 = resolveSlot(seg.side === 'home' ? homeForm : awayForm, seg.carrier)
          if (s2 >= 0) carrier = { side: seg.side, slot: s2 }
        } else if (u < 0.2 && seg.prev && seg.prev.carrier) {
          const s2 = resolveSlot(seg.prev.side === 'home' ? homeForm : awayForm, seg.prev.carrier)
          if (s2 >= 0) carrier = { side: seg.prev.side, slot: s2 }
        }
      }
      return {
        ball,
        home,
        away,
        possession,
        carrier,
      }
    },
  }
}
