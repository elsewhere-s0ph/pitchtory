import { useEffect, useRef, useState } from 'react'
import { PITCH_W, PITCH_H } from '../game/visual'

const USER_FILL = '#2fb56e'
const OPP_FILL = '#e0a83c'
const LINE = '#2e6b47'

/** Il campo vivo (V1.1): 22 pallini e la palla disegnati dal regista.
 *  Un requestAnimationFrame interpola il minuto tra i tick del gioco:
 *  il copione resta quello del seed, il movimento è solo presentazione.
 *  Nei QTE il minuto si ferma, e il campo si ferma con lui. */
export default function PitchView({ director, minute, events, homeForm, awayForm, userSide }) {
  const [hidden, setHidden] = useState(false)
  const ballRef = useRef(null)
  const haloRef = useRef(null)
  const dotRefs = useRef([])
  const ringRef = useRef(null)
  const shoutRef = useRef(null)
  const anim = useRef({ dm: 0, seen: 0, until: 0, dur: 1, color: '#e8b34e', isGoal: false })
  const live = useRef({})
  live.current = { director, minute, events, homeForm, awayForm, userSide }

  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    const tick = (now) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(0.1, (now - prev) / 1000)
      prev = now
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
          a.color = e.type === 'goal' ? '#e8b34e' : '#cbd5e1'
          a.isGoal = e.type === 'goal'
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
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
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
          <svg viewBox={'-2 -2 ' + (PITCH_W + 4) + ' ' + (PITCH_H + 4)} className="block w-full">
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
            <text ref={shoutRef} fontSize="3.4" fontWeight="700" fill="#e8b34e" textAnchor="middle" opacity="0">
              GOL!
            </text>
          </svg>
        </div>
      )}
    </div>
  )
}
