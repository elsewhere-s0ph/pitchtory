/**
 * Campo Vivo (V1.1): la telecronaca che si vede. Il regista prende il
 * copione di buildMatch e lo trasforma in movimento: la palla viaggia
 * per zone di possesso, i 22 pallini tengono il modulo e il blocco
 * sale e scende con la palla. Puro e deterministico dal seed: stessa
 * partita, stesso movimento — ricaricare non cambia niente, come i QTE.
 *
 * Regola di ferro: la coreografia serve la cronaca, non la sostituisce.
 * Le azioni da gol si costruiscono (possesso che sale, pallone in area)
 * e il tiro parte solo dall'area: niente schegge da centrocampo.
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

/** Il pallone non teletrasporta: da un punto all'altro con uno o due
 *  appoggi, così il possesso sembra giocato e non disegnato. */
function buildPath(rng, from, to) {
  const pts = [{ x: from.x, y: from.y }]
  const legs = rng.int(1, 2)
  for (let i = 1; i <= legs; i++) {
    const u = i / (legs + 1)
    pts.push({
      x: from.x + (to.x - from.x) * u + rng.float() * 14 - 7,
      y: from.y + (to.y - from.y) * u + rng.float() * 16 - 8,
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

/** Il regista: dal copione (eventi del match, base più scelte live)
 *  ai frame. I gol e le occasioni sono appuntamenti sacri: il possesso
 *  arriva puntuale al loro minuto, nella zona giusta del campo. */
export function makePitchDirector({ seedNumber, events }) {
  const rng = new Rng((seedNumber ^ 0x51ce) >>> 0)
  const hot = {}
  for (const e of events || []) {
    if (e.type === 'goal' || e.type === 'chance') hot[e.minute] = e
  }
  const marks = Object.keys(hot).map(Number).sort((a, b) => a - b)

  const segments = []
  let t = 0
  let pos = { x: CX, y: CY }
  let side = rng.chance(0.54) ? 'home' : 'away'
  let mi = 0
  while (t < 96) {
    const mark = mi < marks.length ? marks[mi] : null
    if (mark !== null && mark <= t + 3.5) {
      // Possesso guidato all'evento: la squadra dell'evento ha palla e
      // la porta dove dice la cronaca, esattamente al suo minuto.
      const e = hot[mark]
      side = e.side
      const to = Math.min(95.9, Math.max(t + 1, mark))
      const dir = side === 'home' ? 1 : -1
      const target =
        e.type === 'goal'
          ? { x: CX + dir * (CX - 1.2), y: CY + rng.float() * 8 - 4 }
          : { x: CX + dir * (CX - rng.float() * 12 - 5), y: CY + rng.float() * 26 - 13 }
      segments.push({ from: t, to, side, path: buildPath(rng, pos, target) })
      pos = target
      mi++
      t = to
      continue
    }
    // Possesso libero: si viaggia nella propria metà, con sbirciate.
    const to = Math.min(95.9, t + rng.int(1, 3))
    const adv = rng.float() * 30 - 10
    const target = {
      x: side === 'home' ? clamp(CX + adv, 10, PITCH_W - 20) : clamp(CX - adv, 20, PITCH_W - 10),
      y: rng.float() * (PITCH_H - 20) + 10,
    }
    segments.push({ from: t, to, side, path: buildPath(rng, pos, target) })
    pos = target
    if (rng.chance(0.45)) side = side === 'home' ? 'away' : 'home'
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

  return {
    /** Il frame al minuto (anche frazionario): palla, 22 pallini, possesso. */
    frameAt(minute, homeForm, awayForm) {
      const m = clamp(minute, 0, 95.9)
      let seg = segments[segments.length - 1]
      for (const s of segments) {
        if (m >= s.from && m < s.to) {
          seg = s
          break
        }
      }
      const u = (m - seg.from) / Math.max(0.001, seg.to - seg.from)
      const ball = pointAlong(seg.path, u)
      return {
        ball,
        home: teamFrame(homeForm, ball, 'home', m),
        away: teamFrame(awayForm, ball, 'away', m),
        possession: seg.side,
      }
    },
  }
}
