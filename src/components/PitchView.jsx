import { useEffect, useRef, useState } from 'react'
import { PITCH_W, PITCH_H } from '../game/visual'

const USER_FILL = '#2fb56e'
const OPP_FILL = '#e0a83c'
const LINE = '#2e6b47'
const GOLD = '#e8b34e'
const FULL_VB = [-2, -2, PITCH_W + 4, PITCH_H + 4]

/** Il tipo di QTE dal testo del prompt: serve a scegliere zona e zoom. */
function qteKindOf(prompt) {
  const p = (prompt || '').toLowerCase()
  if (p.includes('rigore')) return 'pen'
  if (p.includes('uno contro uno')) return 'one'
  if (p.includes('contropiede')) return 'counter'
  if (p.includes('punizione')) return 'freekick'
  if (p.includes('corner')) return 'corner'
  return 'other'
}

/** Il campo vivo (V1.1 + V1.2 + V1.3): 22 pallini e la palla disegnati dal
 *  regista. Un requestAnimationFrame interpola il minuto tra i tick
 *  del gioco: il copione resta quello del seed, il movimento è solo
 *  presentazione. V1.2: i cartellini fanno lampeggiare il pallino del
 *  colpevole (giallo o rosso) e il marcatore si accende d’oro. V1.3: i
 *  QTE si guardano — la zona si accende in avvicinamento del momento
 *  chiave e il rigore si vede dal dischetto, con uno zoom morbido. Nei
 *  QTE il minuto si ferma, e il campo si ferma con lui. */
export default function PitchView({ director, minute, events, homeForm, awayForm, userSide, qte, nextQte }) {
  const [hidden, setHidden] = useState(false)
  const svgRef = useRef(null)
  const zoneRef = useRef(null)
  const ballRef = useRef(null)
  const haloRef = useRef(null)
  const dotRefs = useRef([])
  const ringRef = useRef(null)
  const shoutRef = useRef(null)
  const anim = useRef({ dm: 0, seen: 0, until: 0, dur: 1, color: GOLD, isGoal: false, blink: null })
  const vb = useRef(FULL_VB.slice())
  const spotCache = useRef({ minute: -1, x: 52.5, y: 34 })
  const live = useRef({})
  live.current = { director, minute, events, homeForm, awayForm, userSide, qte, nextQte }

  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    /** Il pallino torna del colore della sua squadra. */
    const restoreDot = (idx) => {
      if (idx === null || idx === undefined || idx < 0) return
      const el = dotRefs.current[idx]
      if (el) {
        el.setAttribute('fill', idx < 11 ? USER_FILL : OPP_FILL)
        el.setAttribute('r', '1.5')
      }
    }
    /** Dallo slot nell'undici all'indice del pallino sul campo. */
    const dotIndexFor = (b) => {
      if (b.side === 'home') return userSide === 'home' ? b.dot : 11 + b.dot
      return userSide === 'home' ? 11 + b.dot : b.dot
    }
    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - prev) / 1000)
      prev = now
      // Performance mobile: a scheda nascosta il campo non costa nulla.
      if (typeof document !== 'undefined' && document.hidden) return
      const a = anim.current
      const p = live.current
      if (!p.director || !ballRef.current) return
      const target = Math.min(95.9, Math.max(0, p.minute || 0))
      // Salti grandi (salta al risultato): si atterra subito.
      a.dm = Math.abs(target - a.dm) > 2.5 ? target : a.dm + (target - a.dm) * Math.min(1, dt * 3.2)
      for (const e of p.events || []) {
        if ((e.type === 'goal' || e.type === 'chance') && e.minute > a.seen && e.minute <= a.dm) {
          a.dur = e.type === 'goal' ? 1900 : 1100
          a.until = now + a.dur
          a.color = e.type === 'goal' ? GOLD : '#cbd5e1'
          a.isGoal = e.type === 'goal'
        }
      }
      // V1.2: i lampeggii del regista — cartellini e marcatori.
      for (const b of p.director.marks || []) {
        if (b.minute > a.seen && b.minute <= a.dm && b.dot >= 0 && b.dot < 11) {
          if (b.kind === 'card' || b.kind === 'red') {
            restoreDot(a.blink ? a.blink.dot : -1)
            a.blink = { until: now + 1500, color: b.kind === 'red' ? '#ef4444' : '#eab308', dot: dotIndexFor(b) }
          } else if (b.kind === 'goal') {
            restoreDot(a.blink ? a.blink.dot : -1)
            a.blink = { until: now + (a.isGoal ? a.dur : 1200), color: GOLD, dot: dotIndexFor(b) }
          }
        }
      }
      a.seen = a.dm
      const fr = p.director.frameAt(a.dm, p.homeForm, p.awayForm)
      const setPt = (el, x, y) => {
        el.setAttribute('cx', x.toFixed(2))
        el.setAttribute('cy', y.toFixed(2))
      }
      setPt(ballRef.current, fr.ball.x, fr.ball.y)
      if (haloRef.current) setPt(haloRef.current, fr.ball.x, fr.ball.y)
      const teams = p.userSide === 'home' ? [fr.home, fr.away] : [fr.away, fr.home]
      teams.forEach((list, ti) => {
        list.forEach((pt, i) => {
          const el = dotRefs.current[ti * 11 + i]
          if (el) setPt(el, pt.x, pt.y)
        })
      })
      // Il pallino che lampeggia: cartellino giallo/rosso o marcatore oro.
      if (a.blink) {
        const el = dotRefs.current[a.blink.dot]
        if (now < a.blink.until) {
          if (el) {
            el.setAttribute('fill', a.blink.color)
            el.setAttribute('r', (1.5 + Math.abs(Math.sin(now / 110)) * 0.9).toFixed(2))
          }
        } else {
          restoreDot(a.blink.dot)
          a.blink = null
        }
      }
      if (ringRef.current) {
        if (now < a.until) {
          const k = 1 - (a.until - now) / a.dur
          setPt(ringRef.current, fr.ball.x, fr.ball.y)
          ringRef.current.setAttribute('r', (3 + k * 13).toFixed(2))
          ringRef.current.setAttribute('opacity', (0.5 * (1 - k)).toFixed(3))
          ringRef.current.setAttribute('stroke', a.color)
        } else {
          ringRef.current.setAttribute('opacity', '0')
        }
      }
      if (shoutRef.current) {
        if (a.isGoal && now < a.until) {
          const k = 1 - (a.until - now) / a.dur
          shoutRef.current.setAttribute('x', Math.min(93, Math.max(12, fr.ball.x)).toFixed(2))
          shoutRef.current.setAttribute('y', Math.max(6, fr.ball.y - 4).toFixed(2))
          shoutRef.current.setAttribute('opacity', (1 - k).toFixed(3))
        } else {
          shoutRef.current.setAttribute('opacity', '0')
        }
      }
      // V1.3: la zona del QTE si accende in avvicinamento, e il rigore
      // si guarda dal dischetto — zoom morbido sull area della porta.
      const activeQte = p.qte || (p.nextQte && a.dm > p.nextQte.minute - 2.2 ? p.nextQte : null)
      let zx = null
      let zy = null
      let zk = 0
      let zoomPen = false
      if (activeQte) {
        const qm = Math.min(activeQte.minute, 95.9)
        if (spotCache.current.minute !== qm) {
          const qfr = p.director.frameAt(qm, p.homeForm, p.awayForm)
          spotCache.current = { minute: qm, x: qfr.ball.x, y: qfr.ball.y }
        }
        zx = spotCache.current.x
        zy = spotCache.current.y
        zk = p.qte ? 1 : Math.min(1, Math.max(0, 1 - (activeQte.minute - a.dm) / 2.2))
        zoomPen = qteKindOf(activeQte.prompt) === 'pen'
      }
      let vbTarget = FULL_VB
      if (zoomPen && zx !== null) {
        const prompt = (activeQte.prompt || '').toLowerCase()
        const defensive = prompt.includes('difend') || prompt.includes('fermare')
        const gx = defensive
          ? (p.userSide === 'home' ? 0 : PITCH_W)
          : (p.userSide === 'home' ? PITCH_W : 0)
        const cx = Math.min(89, Math.max(16, (gx + zx) / 2))
        const cy = Math.min(53, Math.max(15, (PITCH_H / 2 + zy) / 2))
        vbTarget = [cx - 19, cy - 15, 38, 30]
      }
      for (let i = 0; i < 4; i++) vb.current[i] += (vbTarget[i] - vb.current[i]) * Math.min(1, dt * 4)
      if (svgRef.current) svgRef.current.setAttribute('viewBox', vb.current.map((v) => v.toFixed(2)).join(' '))
      if (zoneRef.current) {
        if (zx !== null && zk > 0) {
          zoneRef.current.setAttribute('cx', zx.toFixed(2))
          zoneRef.current.setAttribute('cy', zy.toFixed(2))
          zoneRef.current.setAttribute('opacity', (zk * (0.3 + 0.18 * Math.sin(now / 170))).toFixed(3))
        } else {
          zoneRef.current.setAttribute('opacity', '0')
        }
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-slate-500">Il campo vivo</p>
        <button
          onClick={() => setHidden((h) => !h)}
          className="text-[10px] text-slate-400 transition hover:text-teal-300"
        >
          {hidden ? 'mostra il campo' : 'nascondi il campo'}
        </button>
      </div>
      {!hidden && (
        <div className="mt-1 overflow-hidden rounded-xl border border-pitch-700/60 bg-pitch-950">
          <svg
            ref={svgRef}
            viewBox={'-2 -2 ' + (PITCH_W + 4) + ' ' + (PITCH_H + 4)}
            className="block w-full"
          >
            <rect x="0" y="0" width={PITCH_W} height={PITCH_H} fill="#081a10" />
            {[0, 2, 4].map((i) => (
              <rect key={'s' + i} x={i * (PITCH_W / 6)} y="0" width={PITCH_W / 6} height={PITCH_H} fill="#0a2013" />
            ))}
            <g stroke={LINE} strokeOpacity="0.75" strokeWidth="0.4" fill="none">
              <rect x="0.3" y="0.3" width={PITCH_W - 0.6} height={PITCH_H - 0.6} />
              <line x1={PITCH_W / 2} y1="0" x2={PITCH_W / 2} y2={PITCH_H} />
              <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r="9.15" />
              <rect x="0.3" y="13.85" width="16.2" height="40.3" />
              <rect x="0.3" y="24.85" width="5.5" height="18.3" />
              <rect x={PITCH_W - 16.5} y="13.85" width="16.2" height="40.3" />
              <rect x={PITCH_W - 5.8} y="24.85" width="5.5" height="18.3" />
            </g>
            <circle cx="11" cy={PITCH_H / 2} r="0.5" fill={LINE} />
            <circle cx={PITCH_W - 11} cy={PITCH_H / 2} r="0.5" fill={LINE} />
            <rect x="0" y="30.34" width="1.4" height="7.32" fill="#64748b" />
            <rect x={PITCH_W - 1.4} y="30.34" width="1.4" height="7.32" fill="#64748b" />
            <circle ref={zoneRef} r="7" fill={GOLD} opacity="0" />
            <circle ref={ringRef} r="3" fill="none" strokeWidth="0.8" opacity="0" />
            {Array.from({ length: 22 }).map((_, i) => (
              <circle
                key={'d' + i}
                cx="-5"
                cy="-5"
                r="1.5"
                fill={i < 11 ? USER_FILL : OPP_FILL}
                ref={(el) => {
                  dotRefs.current[i] = el
                }}
              />
            ))}
            <circle ref={haloRef} cx="-5" cy="-5" r="2.4" fill="#f4f7f5" opacity="0.25" />
            <circle ref={ballRef} cx="-5" cy="-5" r="1.1" fill="#f4f7f5" />
            <text ref={shoutRef} fontSize="3.4" fontWeight="700" fill={GOLD} textAnchor="middle" opacity="0">
              GOL!
            </text>
          </svg>
        </div>
      )}
    </div>
  )
}
