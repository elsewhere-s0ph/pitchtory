/**
 * Banco e Lavagnetta (G2): il cuore tattico del gioco, puro e
 * deterministico. Sei moduli con slot per ruolo, il dazio di chi gioca
 * fuori posizione, il matchup tra moduli e le tattiche di squadra
 * (mentalità, pressing, linea difensiva) come moltiplicatori sui gol
 * attesi. L'AI la sua lavagnetta se la scrive da sola: modulo che
 * valorizza la rosa, stile stabile nell'id del club, mente e cuore
 * dal rapporto di forza in campo. Stesso seed, stesse scelte.
 */
import { hasAbility } from './abilities'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** I sei moduli della lavagnetta. */
export const FORMATIONS = {
  '442': { name: '4-4-2', label: 'Il classico', slots: ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'] },
  '433': { name: '4-3-3', label: 'Ardito', slots: ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'] },
  '4231': { name: '4-2-3-1', label: 'Moderno', slots: ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW'] },
  '352': { name: '3-5-2', label: 'Centrocampo', slots: ['GK', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW'] },
  '343': { name: '3-4-3', label: 'Tempesta', slots: ['GK', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'] },
  '532': { name: '5-3-2', label: 'Catenaccio', slots: ['GK', 'DF', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW'] },
}
export const FORMATION_ORDER = ['442', '433', '4231', '352', '343', '532']

/** La lavagnetta di partenza: il classico, testa equilibrata. */
export const DEFAULT_TACTICS = { formation: '442', mentality: 'equilibrata', pressing: 'normale', line: 'normale' }

/** Affinità giocatore→slot: ruolo naturale pieno, adiacente quasi, opposto
 *  caro. Il portiere in porta è sacro; se proprio manca, qualcuno si
 *  immola (mezzo valore: il dramma è garantito). */
const AFFINITY = {
  GK: { GK: 1, DF: 0.5, MF: 0.5, FW: 0.5 },
  DF: { GK: 0, DF: 1, MF: 0.88, FW: 0.72 },
  MF: { GK: 0, DF: 0.88, MF: 1, FW: 0.88 },
  FW: { GK: 0, DF: 0.72, MF: 0.88, FW: 1 },
}

export function affinity(playerRole, slotRole) {
  const row = AFFINITY[playerRole] || AFFINITY.MF
  return row[slotRole] !== undefined ? row[slotRole] : 0
}

const byOvrThenId = (a, b) => b.ovr - a.ovr || (a.id < b.id ? -1 : 1)

/** L'undici per modulo: slot per slot, il migliore disponibile col dazio
 *  di ruolo già nel conto. Deterministico: stessa rosa, stesso schieramento. */
export function bestXIFor(formationId, squad) {
  const slots = (FORMATIONS[formationId] || FORMATIONS[FORMATION_ORDER[0]]).slots
  const avail = squad.filter((p) => !p.youth).slice().sort(byOvrThenId)
  const used = new Set()
  const xi = []
  for (const slot of slots) {
    let best = null
    for (const p of avail) {
      if (used.has(p.id)) continue
      const aff = affinity(p.role, slot)
      const eff = p.ovr * aff
      if (!best || eff > best.eff + 1e-9 || (Math.abs(eff - best.eff) <= 1e-9 && aff > best.aff)) {
        best = { p, eff, aff }
      }
    }
    if (best) {
      used.add(best.p.id)
      xi.push({ ...best.p, slot })
    }
  }
  return xi
}

/** Forza di un undici già schierato (G2.1): riconosce anche le scelte del
 *  mister — dazio di ruolo, morale e leader contano uguale. */
export function strengthOfXI(club, xi) {
  if (!xi || !xi.length) return 40
  let sum = 0
  let morale = 0
  let lead = 0
  for (const p of xi) {
    sum += p.ovr * affinity(p.role, p.slot)
    morale += p.morale
    if (hasAbility(p, 'capitano')) lead += 1
    if (hasAbility(p, 'fuoriclasse')) lead += 1.5
  }
  return (sum / xi.length) * (0.92 + 0.08 * (morale / xi.length / 100)) + lead
}

/** Forza dell'undici schierato: media dell'OVR efficace (fuori ruolo =
 *  dazio), morale di chi è in campo e abilità da leader. */
export function teamStrengthFor(club, squad, formationId) {
  return strengthOfXI(club, bestXIFor(formationId, squad))
}

/** L'undici scelto dal mister (G2.1): le scelte sono undici id allineati
 *  agli slot del modulo, null dove decide lo staff. Chi non c'è più
 *  (ceduto, infermeria, squalifica) torna automatico: la lavagnetta non
 *  costringe mai a giocare in dieci. Deterministica come tutto il resto. */
export function lineupXI(formationId, squad, picks) {
  const slots = (FORMATIONS[formationId] || FORMATIONS[FORMATION_ORDER[0]]).slots
  const avail = squad.filter((p) => !p.youth)
  if (!Array.isArray(picks) || picks.length !== slots.length) return bestXIFor(formationId, squad)
  const byId = new Map(avail.map((p) => [p.id, p]))
  const xi = []
  const used = new Set()
  slots.forEach((slot, i) => {
    const p = picks[i] != null ? byId.get(picks[i]) : null
    if (p && !used.has(p.id)) {
      used.add(p.id)
      xi.push({ ...p, slot })
    } else {
      xi.push(null)
    }
  })
  for (let i = 0; i < xi.length; i++) {
    if (xi[i]) continue
    let best = null
    for (const p of avail) {
      if (used.has(p.id)) continue
      const aff = affinity(p.role, slots[i])
      const eff = p.ovr * aff
      if (!best || eff > best.eff + 1e-9 || (Math.abs(eff - best.eff) <= 1e-9 && aff > best.aff)) {
        best = { p, eff, aff }
      }
    }
    if (best) {
      used.add(best.p.id)
      xi[i] = { ...best.p, slot: slots[i] }
    }
  }
  return xi.filter(Boolean)
}

/** Cambio modulo con i titolari scelti: ognuno resta titolare nello slot
 *  che gli va meglio nel modulo nuovo. Chi non trova posto torna allo
 *  staff — mai pensioni d'ufficio, mai favoritismi. */
export function remapPicks(formationId, squad, picks) {
  const slots = (FORMATIONS[formationId] || FORMATIONS[FORMATION_ORDER[0]]).slots
  if (!Array.isArray(picks)) return new Array(slots.length).fill(null)
  const avail = squad.filter((p) => !p.youth)
  const byId = new Map(avail.map((p) => [p.id, p]))
  const chosen = []
  for (const id of picks) {
    const p = id != null ? byId.get(id) : null
    if (p && !chosen.some((c) => c.id === p.id)) chosen.push(p)
  }
  const bestAff = (p) => {
    let m = 0
    for (const s of slots) m = Math.max(m, affinity(p.role, s))
    return m
  }
  chosen.sort((a, b) => bestAff(b) - bestAff(a) || (a.id < b.id ? -1 : 1))
  const out = new Array(slots.length).fill(null)
  for (const p of chosen) {
    let bi = -1
    let be = -1
    slots.forEach((s, i) => {
      if (out[i] !== null) return
      const eff = p.ovr * affinity(p.role, s)
      if (eff > be + 1e-9) {
        be = eff
        bi = i
      }
    })
    if (bi >= 0) out[bi] = p.id
  }
  return out
}

/** Conteggi per reparto di un modulo. */
export function repartoCounts(formationId) {
  const counts = { GK: 0, DF: 0, MF: 0, FW: 0 }
  const slots = (FORMATIONS[formationId] || FORMATIONS[FORMATION_ORDER[0]]).slots
  for (const s of slots) counts[s] += 1
  return counts
}

/** Matchup tra moduli: attacco contro difesa, e chi la spunta a
 *  centrocampo. Un 5-3-2 toglie palla al 4-3-3, un 3-5-2 soffoca il
 *  4-4-2: niente tabelle segrete, solo conti alla mano. */
export function formationEdge(homeFormation, awayFormation) {
  const ch = repartoCounts(homeFormation)
  const ca = repartoCounts(awayFormation)
  const attack = (c) => c.FW + 0.4 * c.MF
  const defense = (c) => c.DF + 0.5 * c.MF
  const edgeH = clamp((attack(ch) - defense(ca)) * 0.045 + (ch.MF - ca.MF) * 0.02, -0.22, 0.22)
  const edgeA = clamp((attack(ca) - defense(ch)) * 0.045 + (ca.MF - ch.MF) * 0.02, -0.22, 0.22)
  return { edgeH, edgeA }
}

/** Tattiche di squadra: moltiplicatori sui gol fatti (own) e subiti (opp).
 *  La mentalità ardita segna di più e regala di più; il pressing aggressivo
 *  stanca e parla con l'arbitro; la linea alta urla fuorigioco, quella
 *  bassa urla catenaccio. */
export const MENTALITY_MODS = {
  prudente: { own: 0.85, opp: 0.85 },
  equilibrata: { own: 1, opp: 1 },
  ardita: { own: 1.15, opp: 1.18 },
}
export const PRESSING_MODS = {
  basso: { own: 0.95, opp: 0.95, cards: 0.6 },
  normale: { own: 1, opp: 1, cards: 1 },
  aggressivo: { own: 1.06, opp: 1.06, cards: 1.5 },
}
export const LINE_MODS = {
  alta: { own: 1.03, opp: 1.08 },
  normale: { own: 1, opp: 1 },
  bassa: { own: 0.94, opp: 0.88 },
}

export function xgMultiplier(tactics) {
  const t = { ...DEFAULT_TACTICS, ...(tactics || {}) }
  const m = MENTALITY_MODS[t.mentality] || MENTALITY_MODS.equilibrata
  const pr = PRESSING_MODS[t.pressing] || PRESSING_MODS.normale
  const li = LINE_MODS[t.line] || LINE_MODS.normale
  return {
    own: clamp(m.own * pr.own * li.own, 0.55, 1.8),
    opp: clamp(m.opp * pr.opp * li.opp, 0.55, 1.8),
  }
}

/** Quanto parla con l'arbitro chi gioca così (moltiplicatore ammonizioni). */
export function cardsMultiplier(tactics) {
  const t = { ...DEFAULT_TACTICS, ...(tactics || {}) }
  const pr = PRESSING_MODS[t.pressing] || PRESSING_MODS.normale
  return clamp(pr.cards * (t.mentality === 'ardita' ? 1.2 : 1), 0.4, 2.2)
}

/** Il miglior modulo per una rosa: quello che schiera meglio (AI e consigli). */
export function bestFormationFor(club, squad) {
  let best = FORMATION_ORDER[0]
  let bestScore = -1
  for (const f of FORMATION_ORDER) {
    const s = teamStrengthFor(club, squad, f)
    if (s > bestScore + 1e-9) {
      bestScore = s
      best = f
    }
  }
  return best
}

/** Stili dell'allenatore AI: stabili per club, nell'id. Soglie sul
 *  rapporto di forza: quando azzardarsi e quando barricarsi. */
const AI_STYLES = [
  { name: 'cauto', hi: 6, lo: -1 },
  { name: 'equilibrato', hi: 4, lo: -3 },
  { name: 'temerario', hi: 1.5, lo: -6 },
]

/** La lavagnetta dell'AI, deterministica: modulo che valorizza la rosa,
 *  stile dell'allenatore, mente e cuore dal rapporto di forza in campo. */
export function aiTactics(club, squad, oppStrength, isHome) {
  const formation = bestFormationFor(club, squad)
  const own = teamStrengthFor(club, squad, formation)
  const style = AI_STYLES[hashString(club.id) % AI_STYLES.length]
  const diff = own + (isHome ? 2.5 : 0) - (oppStrength || own)
  let mentality = 'equilibrata'
  if (diff > style.hi) mentality = 'ardita'
  else if (diff < style.lo) mentality = 'prudente'
  let pressing = 'normale'
  let line = 'normale'
  if (style.name === 'cauto') {
    pressing = mentality === 'ardita' ? 'normale' : 'basso'
    line = mentality === 'ardita' ? 'normale' : 'bassa'
  } else if (style.name === 'temerario') {
    pressing = mentality === 'prudente' ? 'normale' : 'aggressivo'
    line = mentality === 'prudente' ? 'normale' : 'alta'
  } else {
    line = mentality === 'ardita' ? 'alta' : mentality === 'prudente' ? 'bassa' : 'normale'
  }
  return { formation, mentality, pressing, line }
}