import { useEffect, useMemo, useState } from 'react'
import { useCareer } from '../store'
import { buildMatch, matchSeedNumber, subImpact } from '../game/engine'
import { Rng, seedFromString } from '../lib/rng'
import { FORMATIONS, FORMATION_ORDER, DEFAULT_TACTICS, affinity, bestXIFor, lineupXI, remapPicks } from '../game/tactics'
import { hasAbility } from '../game/abilities'
import { LEAGUES } from '../game/universe'
import { CUP_NAME, CUP_ROUNDS, setLineup, setTactics } from '../db'
import PensShootout from './PensShootout'
import PitchView from './PitchView'
import { makePitchDirector } from '../game/visual'

/** Millisecondi per minuto simulato, per durata partita configurata. */
const MS_PER_MINUTE = { short: 800, normal: 3500, long: 4700 }
const FULL_TIME = 93
const QTE_SECONDS = 10
const MAX_SUBS = 3
/** Minuti effettivi di una partita (per statistiche e progressione). */
const MATCH_MINUTES = 90
/** Consumo stamina per minuto simulato, per ruolo. */
const STAMINA_DECAY = { GK: 0.35, DF: 0.75, MF: 0.9, FW: 0.85 }
/** Energia con cui entra un giocatore fresco. */
const FRESH_STAMINA = 97
/** Etichette della mentalità per la lavagnetta in corsa. */
const MENTALITY_LABELS = { prudente: 'Prudente', equilibrata: 'Equilibrata', ardita: 'Ardita' }

function eventClass(e) {
  if (e.type === 'goal') return 'border-flood-400/50 bg-flood-400/10 font-semibold text-flood-200 shadow-[0_0_16px_rgba(239,191,78,0.15)]'
  if (e.type === 'red') return 'border-red-500/40 bg-red-500/10 text-red-300'
  if (e.type === 'injury') return 'border-red-500/30 bg-red-500/5 text-red-200/90'
  if (e.type === 'card') return 'border-amber-500/30 bg-amber-500/5 text-amber-200/80'
  if (e.type === 'pen') return 'border-flood-400/40 bg-flood-400/5 text-flood-200'
  return 'border-slate-800 bg-pitch-900/40 text-slate-300'
}

function staminaColor(v) {
  if (v >= 40) return 'bg-teal-500'
  if (v >= 20) return 'bg-amber-500'
  return 'bg-red-500'
}

function TeamBadge({ club }) {
  return (
    <div className="max-w-[45%]">
      <span
        className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 shadow-[0_0_18px_rgba(244,248,244,0.08)]"
        style={{ background: club.colors.primary }}
      />
      <p className="truncate text-sm font-semibold">{club.name}</p>
    </div>
  )
}

export default function MatchScreen({ fixture, onDone }) {
  const { career, clubs, players } = useCareer()
  const [phase, setPhase] = useState('pre')
  const [minute, setMinute] = useState(0)
  const [resolved, setResolved] = useState({})
  const [qteSeconds, setQteSeconds] = useState(QTE_SECONDS)
  const [subs, setSubs] = useState([])
  const [subEvents, setSubEvents] = useState([])
  const [subsOpen, setSubsOpen] = useState(false)
  const [pickOut, setPickOut] = useState(null)
  const [pickIn, setPickIn] = useState(null)
  const [pensResult, setPensResult] = useState(null)
  const [pensAuto, setPensAuto] = useState(false)
  const [currentFormation, setCurrentFormation] = useState(null)
  const [formChangesOpen, setFormChangesOpen] = useState(false)
  const [forcedOutId, setForcedOutId] = useState(null)
  const [currentMentality, setCurrentMentality] = useState(null)
  const [dismissedIdx, setDismissedIdx] = useState(() => new Set())

  const clubById = useMemo(() => Object.fromEntries(clubs.map((c) => [c.id, c])), [clubs])
  const playersByClub = useMemo(() => {
    const m = {}
    for (const p of players) (m[p.clubId] = m[p.clubId] || []).push(p)
    return m
  }, [players])

  /** Solo chi non è infortunato per questa giornata scende in campo. */
  const fitPlayersByClub = useMemo(() => {
    const m = {}
    for (const [cid, list] of Object.entries(playersByClub)) {
      m[cid] = list.filter(
        (p) => !(p.injuredUntil && fixture.number <= p.injuredUntil) && !(p.bannedUntil && fixture.number <= p.bannedUntil),
      )
    }
    return m
  }, [playersByClub, fixture])

  const userTactics = useMemo(() => ({ ...DEFAULT_TACTICS, ...(career.tactics || {}) }), [career])
  /** Rosa senior della squadra utente: XI titolare e panchina. */
  const userSquad = useMemo(
    () => (fitPlayersByClub[career.clubId] || []).filter((p) => !p.youth),
    [fitPlayersByClub, career],
  )
  /** L'undici scelto in Lavagnetta (G2.1): undici id allineati agli slot
   *  del modulo — valgono finché il modulo è ancora quello. */
  const userPicks = useMemo(
    () =>
      career.lineup && career.lineup.formation === userTactics.formation && Array.isArray(career.lineup.picks)
        ? career.lineup.picks
        : null,
    [career, userTactics],
  )
  const match = useMemo(() => {
    const seedNumber = matchSeedNumber(career.seed, fixture.key + '#' + career.season)
    const rng = new Rng(seedNumber)
    const userIsHome = fixture.homeId === career.clubId
    // G2: la lavagnetta del mister scende in campo con la squadra.
    // G2.1: con anche i nomi, slot per slot, scelti in Lavagnetta.
    const userSquadNow = (fitPlayersByClub[career.clubId] || []).filter((p) => !p.youth)
    const picked = userPicks ? lineupXI(userTactics.formation, userSquadNow, userPicks) : null
    const built = buildMatch(clubById[fixture.homeId], clubById[fixture.awayId], fitPlayersByClub, rng, {
      keyMoments: true,
      seedNumber,
      userClubId: career.clubId,
      homeTactics: userIsHome ? userTactics : null,
      awayTactics: userIsHome ? null : userTactics,
      homeXI: userIsHome ? picked : null,
      awayXI: userIsHome ? null : picked,
    })
    return { ...built, userIsHome, seedNumber }
  }, [career, clubById, fitPlayersByClub, fixture, userTactics, userPicks])

  const activeFormation = currentFormation || userTactics.formation
  const activeMentality = currentMentality || userTactics.mentality
  const xi = useMemo(() => lineupXI(userTactics.formation, userSquad, userPicks), [userTactics, userSquad, userPicks])
  const bench = useMemo(() => userSquad.filter((p) => !xi.some((t) => t.id === p.id)), [userSquad, xi])

  const [stamina, setStamina] = useState(() => Object.fromEntries(xi.map((p) => [p.id, 100])))

  /** Lo slot di chi entra: quello di chi è uscito, per affinità. */
  const slotOfInId = (id) => {
    const s = subs.find((x) => x.inId === id)
    if (s && s.slot) return s.slot
    const p = userSquad.find((x) => x.id === id)
    return (p && p.role) || 'MF'
  }

  /** Chi è in campo al minuto corrente (cambi, infortuni e modulo in corsa). */
  const onPitch = useMemo(() => {
    const outIds = new Set(subs.filter((s) => s.minute <= minute).map((s) => s.outId))
    const inIds = new Set(subs.filter((s) => s.minute <= minute && s.inId).map((s) => s.inId))
    const list = xi.filter((p) => !outIds.has(p.id))
    for (const id of inIds) {
      const p = userSquad.find((x) => x.id === id)
      if (p) list.push({ ...p, slot: slotOfInId(id) })
    }
    // Cambio modulo in corsa (G2): chi è in campo si riassetta sugli slot
    // nuovi — nessuno entra dalla panchina per magia.
    if (currentFormation && currentFormation !== userTactics.formation && list.length) {
      return bestXIFor(currentFormation, list)
    }
    return list
  }, [xi, subs, minute, userSquad, currentFormation, userTactics])

  // Consumo stamina a ogni minuto simulato.
  useEffect(() => {
    if (minute <= 0 || minute > FULL_TIME) return
    setStamina((s) => {
      const next = { ...s }
      for (const p of onPitch) {
        if (next[p.id] === undefined) continue
        let decay = STAMINA_DECAY[p.role] || 0.9
        if (hasAbility(p, 'maratoneta')) decay *= 0.7
        // G2: il pressing aggressivo ce lo portano addosso i polmoni.
        if (userTactics.pressing === 'aggressivo') decay *= 1.25
        else if (userTactics.pressing === 'basso') decay *= 0.85
        next[p.id] = Math.max(0, next[p.id] - decay)
      }
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minute])

  /** Eventi generati dalle scelte QTE (la funzione serve anche al salto). */
  function eventsForResolutions(resMap) {
    const userSide = match.userIsHome ? 'home' : 'away'
    const oppSide = match.userIsHome ? 'away' : 'home'
    return match.keyMoments
      .filter((m) => resMap[m.id] !== undefined)
      .map((m) => {
        const outcome = m.options[resMap[m.id]].outcome
        const ev = { minute: m.minute, text: outcome.text, qte: true }
        if (outcome.goal) return { ...ev, side: userSide, type: 'goal', playerId: outcome.playerId }
        if (outcome.goalAgainst) return { ...ev, side: oppSide, type: 'goal', playerId: outcome.playerId }
        if (outcome.card) return { ...ev, side: userSide, type: 'card', playerId: outcome.playerId }
        return { ...ev, side: userSide, type: 'chance' }
      })
  }
  const momentEvents = useMemo(() => eventsForResolutions(resolved), [match, resolved])

  // G2.2: un gol annullato dalla barricata (mentalità prudente) esce dal
  // copione — dal vivo, dal punteggio e dalla storia della partita.
  const allEvents = useMemo(
    () =>
      [...match.baseEvents.filter((e, i) => !dismissedIdx.has(i)), ...momentEvents, ...subEvents].sort(
        (a, b) => a.minute - b.minute,
      ),
    [match, momentEvents, subEvents, dismissedIdx],
  )

  // Campo Vivo (V1.1 + V1.2): il regista del campo — stesso copione,
  // stesso movimento, e gli undici veri per i lampeggii dei pallini.
  const pitchDirector = useMemo(
    () =>
      makePitchDirector({
        seedNumber: match.seedNumber,
        events: allEvents,
        homeXI: match.homeXI,
        awayXI: match.awayXI,
      }),
    [match, allEvents],
  )

  const pendingMoment = match.keyMoments.find((m) => m.minute <= minute && resolved[m.id] === undefined)
  /** Il prossimo QTE in arrivo: il campo lo preannuncia con la zona che si accende. */
  const upcomingQte = useMemo(
    () => match.keyMoments.find((m) => m.minute > minute && resolved[m.id] === undefined) || null,
    [match, minute, resolved],
  )

  /** Giocatori coinvolti in un momento chiave non ancora risolto: non si cambiano. */
  const locked = useMemo(() => {
    const set = new Set()
    for (const m of match.keyMoments) {
      if (resolved[m.id] !== undefined) continue
      for (const o of m.options) {
        if (o.outcome && o.outcome.playerId) set.add(o.outcome.playerId)
      }
      for (const p of userSquad) {
        if (m.prompt.includes(p.name)) set.add(p.id)
      }
    }
    return set
  }, [match, resolved, userSquad])

  const userSide = match.userIsHome ? 'home' : 'away'
  const subsUsed = subs.filter((s) => s.inId).length
  const subsLeft = MAX_SUBS - subsUsed

  // Avanzamento minuto per minuto, con pausa QTE sui momenti chiave.
  useEffect(() => {
    if (phase !== 'live') return
    if (pendingMoment) {
      setPhase('qte')
      setQteSeconds(QTE_SECONDS)
      setSubsOpen(false)
      return
    }
    if (minute >= FULL_TIME) {
      // La Coppa non ammette pari: se i minuti non bastano, si va ai rigori.
      const hgAll = allEvents.filter((e) => e.type === 'goal' && e.side === 'home').length
      const agAll = allEvents.filter((e) => e.type === 'goal' && e.side === 'away').length
      if (fixture.type === 'cup' && hgAll === agAll) setPhase('pens')
      else setPhase('end')
      return
    }
    const id = setTimeout(() => setMinute((m) => m + 1), MS_PER_MINUTE[career.settings.matchDuration] || 3500)
    return () => clearTimeout(id)
  }, [phase, minute, career, pendingMoment])

  // Infortuni in campo (G2.2): il pannello cambi si apre da solo — il
  // mister sceglie chi entra. Se lo chiude senza decidere, sceglie lo
  // staff per affinità; senza cambi disponibili, si resta in dieci.
  useEffect(() => {
    if (phase !== 'live') return
    const pending = match.baseEvents.find(
      (e) =>
        e.type === 'injury' && e.side === userSide && e.minute <= minute && !subs.some((s) => s.outId === e.playerId),
    )
    if (!pending) return
    const outP = onPitch.find((p) => p.id === pending.playerId)
    const m = pending.minute
    if (!outP || subsUsed >= MAX_SUBS) {
      setSubs((s) => [
        ...s,
        { minute: m, outId: pending.playerId, inId: null, slot: outP ? outP.slot || outP.role : 'MF', forced: true },
      ])
      if (outP) {
        setSubEvents((s) => [
          ...s,
          { minute: m, type: 'sub', sub: true, text: outP.name + ' non può continuare: cambi terminati, si resta in dieci' },
        ])
      }
      return
    }
    // Cambi disponibili: pannello aperto d'ufficio, la scelta è del mister.
    setForcedOutId(outP.id)
    setPickOut(outP)
    setSubsOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, minute, subs])

  // Countdown del QTE: allo scadere vince la prudenza.
  useEffect(() => {
    if (phase !== 'qte') return
    if (qteSeconds <= 0) {
      resolvePrudent()
      return
    }
    const id = setTimeout(() => setQteSeconds((s) => s - 1), 1000)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, qteSeconds])

  function chooseOption(moment, index) {
    setResolved((r) => ({ ...r, [moment.id]: index }))
    setPhase('live')
  }

  function resolvePrudent() {
    const m = match.keyMoments.find((x) => x.minute <= minute && resolved[x.id] === undefined)
    if (!m) {
      setPhase('live')
      return
    }
    const idx = Math.max(0, m.options.findIndex((o) => o.prudent))
    chooseOption(m, idx)
  }

  function skipToEnd() {
    const prudentAll = {}
    for (const m of match.keyMoments) prudentAll[m.id] = Math.max(0, m.options.findIndex((o) => o.prudent))
    setResolved(prudentAll)
    setMinute(FULL_TIME)
    // Salto: il risultato è quello che è; se in Coppa è pari,
    // i rigori si giocano da soli in automatico.
    const all = [
      ...match.baseEvents.filter((e, i) => !dismissedIdx.has(i)),
      ...eventsForResolutions(prudentAll),
      ...subEvents,
    ]
    const hgAll = all.filter((e) => e.type === 'goal' && e.side === 'home').length
    const agAll = all.filter((e) => e.type === 'goal' && e.side === 'away').length
    if (fixture.type === 'cup' && hgAll === agAll) {
      setPensAuto(true)
      setPhase('pens')
    } else {
      setPhase('end')
    }
  }

  /** Effettua un cambio: annuncio in cronaca + eventuale impatto deterministico del fresco. */
  function makeSub() {
    if (!pickOut || !pickIn || subsUsed >= MAX_SUBS) return
    const m = Math.min(Math.max(1, minute), 92)
    const slotRole = pickOut.slot || pickOut.role
    const forced = pickOut.id === forcedOutId
    setSubs((s) => [...s, { minute: m, outId: pickOut.id, inId: pickIn.id, slot: slotRole, forced }])
    setStamina((s) => ({ ...s, [pickIn.id]: FRESH_STAMINA }))
    const evs = [
      {
        minute: m,
        type: 'sub',
        sub: true,
        text:
          (forced ? 'Cambio obbligato per infortunio: esce ' : 'Cambio: esce ') +
          pickOut.name +
          ', entra ' +
          pickIn.name +
          (affinity(pickIn.role, slotRole) < 1 ? ' — fuori ruolo' : ''),
      },
    ]
    const impact = subImpact(match.seedNumber, pickIn, m, onPitch)
    // side: senza questo campo il gol del fresco restava solo in cronaca,
    // invisibile a punteggio, classifica e statistiche del marcatore.
    if (impact) evs.push({ ...impact, side: userSide, sub: true })
    setSubEvents((s) => [...s, ...evs])
    if (forced) setForcedOutId(null)
    setPickOut(null)
    setPickIn(null)
    setSubsOpen(false)
  }

  /** Cambio modulo in corsa (G2): chi è in campo si riassetta sugli slot
   *  nuovi e l'esito del riassetto è nel seed — ogni lavagnetta in corsa
   *  porta un battito di disorganizzazione, o l'idea giusta. */
  function changeFormation(newFormation) {
    if (newFormation === activeFormation || phase !== 'live') return
    const m = Math.min(Math.max(1, minute), 92)
    const oldF = activeFormation
    setCurrentFormation(newFormation)
    setFormChangesOpen(false)
    // La lavagnetta in corsa diventa legge: il modulo provato in partita
    // resta anche per la prossima, con l’undici riassetto sugli slot nuovi.
    // Prima svaniva al fischio finale e la squadra tornava nel modulo vecchio.
    setTactics(career.id, { ...userTactics, formation: newFormation }).catch(() => {})
    if (userPicks) {
      setLineup(career.id, { formation: newFormation, picks: remapPicks(newFormation, userSquad, userPicks) }).catch(() => {})
    }
    const rng = new Rng(seedFromString('formchange:' + match.seedNumber + ':' + m + ':' + newFormation))
    const roll = rng.float()
    const cnt = (f) => {
      const c = { GK: 0, DF: 0, MF: 0, FW: 0 }
      for (const s of FORMATIONS[f].slots) c[s] += 1
      return c
    }
    const moreAttack = cnt(newFormation).FW + 0.4 * cnt(newFormation).MF > cnt(oldF).FW + 0.4 * cnt(oldF).MF
    if (roll < 0.1) {
      setSubEvents((s) => [...s, {
        minute: m,
        type: 'chance',
        side: userSide,
        form: true,
        text: 'La lavagnetta lavora: riassetto sul ' + FORMATIONS[newFormation].name + ' e la prima occasione arriva subito',
      }])
    } else if (roll < 0.18) {
      setSubEvents((s) => [...s, {
        minute: m,
        type: 'chance',
        side: match.userIsHome ? 'away' : 'home',
        form: true,
        text: 'Riassetto sul ' + FORMATIONS[newFormation].name + ': per un battito la squadra resta scoperta. Che spavento',
      }])
    } else {
      setSubEvents((s) => [...s, {
        minute: m,
        type: 'sub',
        form: true,
        text: 'Cambio modulo: ora si gioca sul ' + FORMATIONS[newFormation].name + (moreAttack ? ', più audace' : ', più prudente'),
      }])
    }
  }

  /** Infortunio con pannello ignorato (G2.2): sceglie lo staff per
   *  affinità di slot, come si è sempre fatto. */
  function autoForcedSub() {
    const outP = onPitch.find((p) => p.id === forcedOutId)
    const benchAvail = bench.filter((p) => !subs.some((s) => s.inId === p.id))
    const slotRole = outP && outP.slot ? outP.slot : outP ? outP.role : 'MF'
    const inP =
      benchAvail.slice().sort((a, b) => b.ovr * affinity(b.role, slotRole) - a.ovr * affinity(a.role, slotRole))[0] || null
    const m = Math.min(Math.max(1, minute), 92)
    setSubs((s) => [...s, { minute: m, outId: forcedOutId, inId: inP ? inP.id : null, slot: slotRole, forced: true }])
    if (inP) {
      setStamina((st) => ({ ...st, [inP.id]: FRESH_STAMINA }))
      setSubEvents((s) => [
        ...s,
        {
          minute: m,
          type: 'sub',
          sub: true,
          text: 'Cambio obbligato per infortunio: esce ' + (outP ? outP.name : '') + ', entra ' + inP.name,
        },
      ])
    } else {
      setSubEvents((s) => [
        ...s,
        {
          minute: m,
          type: 'sub',
          sub: true,
          text: (outP ? outP.name : 'Il titolare') + ' non può continuare: si resta in dieci',
        },
      ])
    }
    setForcedOutId(null)
    setPickOut(null)
    setPickIn(null)
    setSubsOpen(false)
  }

  /** Cambio mentalità in corsa (G2.2): difendere un bottino si fa da
   *  prudenti — e se nel copione c'è ancora un gol subito, la barricata
   *  ha una possibilità (una per partita) di toglierlo di mezzo. Da
   *  arditi si rincorre: con il premio dell'azzardo e il rischio delle
   *  spalle scoperte. Tutto deterministico dal seed, come sempre. */
  function changeMentality(newM) {
    if (newM === activeMentality || phase !== 'live') return
    const m = Math.min(Math.max(1, minute), 92)
    const diff = match.userIsHome ? hg - ag : ag - hg
    const oppSide = match.userIsHome ? 'away' : 'home'
    const rng = new Rng(seedFromString('mentchange:' + match.seedNumber + ':' + m + ':' + newM))
    const roll = rng.float()
    const takers = onPitch.filter((p) => p.role !== 'GK')
    const oppXIList = match.userIsHome ? match.awayXI : match.homeXI
    setCurrentMentality(newM)

    if (newM === 'equilibrata') {
      setSubEvents((s) => [...s, { minute: m, type: 'sub', men: true, text: 'Si torna sui binari: palla amministrata, partita gestita' }])
      return
    }
    if (newM === 'prudente') {
      if (diff > 0) {
        const idx = match.baseEvents.findIndex(
          (e) => e.type === 'goal' && e.side === oppSide && e.minute > m,
        )
        if (idx >= 0 && dismissedIdx.size === 0) {
          const saveRng = new Rng(seedFromString('mentsave:' + match.seedNumber + ':' + m))
          const g = match.baseEvents[idx]
          if (saveRng.float() < 0.35) {
            const shooter = players.find((p) => p.id === g.playerId)
            setDismissedIdx((s) => new Set(s).add(idx))
            setSubEvents((s) => [
              ...s,
              {
                minute: g.minute,
                type: 'chance',
                side: oppSide,
                men: true,
                text:
                  'La diga regge: il tiro di ' +
                  (shooter ? shooter.name : 'qualcuno') +
                  ' si ferma addosso alla linea — copione cambiato',
              },
            ])
            return
          }
        }
        if (roll < 0.12) {
          setSubEvents((s) => [...s, { minute: m, type: 'chance', side: userSide, men: true, text: "La barricata si alza: cross chiusi, punizioni sporche, l'orologio gioca con te" }])
        } else {
          setSubEvents((s) => [...s, { minute: m, type: 'sub', men: true, text: 'Si difende con ordine: niente scene, solo punti da portare a casa' }])
        }
      } else if (roll < 0.05) {
        setSubEvents((s) => [...s, { minute: m, type: 'chance', side: oppSide, men: true, text: "Prudenza che non paga: si lascia l'iniziativa e l'area trema" }])
      } else {
        setSubEvents((s) => [...s, { minute: m, type: 'sub', men: true, text: 'Si alza la diga: si riparte con ordine, o si muore di noia' }])
      }
      return
    }
    // Ardita: o si vince la partita, o si perde con stile.
    if (diff < 0) {
      if (roll < 0.14 && takers.length) {
        const scorer = takers[rng.int(0, takers.length - 1)]
        setSubEvents((s) => [...s, { minute: m, type: 'goal', side: userSide, playerId: scorer.id, men: true, text: 'GOL! Azzardo premiato: ' + scorer.name + ' agguanta la rimonta' }])
      } else if (roll < 0.24) {
        const scorer = oppXIList[rng.int(0, oppXIList.length - 1)]
        setSubEvents((s) => [...s, { minute: m, type: 'goal', side: oppSide, playerId: scorer.id, men: true, text: 'Spalle scoperte: il raddoppio della puntata costa il contropiede di ' + scorer.name }])
      } else {
        setSubEvents((s) => [...s, { minute: m, type: 'sub', men: true, text: 'Si rincorre con tutti: ali da terzini, aria di rimonta' }])
      }
    } else if (roll < 0.08 && takers.length) {
      const scorer = takers[rng.int(0, takers.length - 1)]
      setSubEvents((s) => [...s, { minute: m, type: 'goal', side: userSide, playerId: scorer.id, men: true, text: 'GOL! Si raddoppia quando non serve e ' + scorer.name + ' ringrazia' }])
    } else if (roll < 0.2) {
      const scorer = oppXIList[rng.int(0, oppXIList.length - 1)]
      setSubEvents((s) => [...s, { minute: m, type: 'goal', side: oppSide, playerId: scorer.id, men: true, text: 'Azzardo di troppo: spalle scoperte e ' + scorer.name + ' punisce' }])
    } else {
      setSubEvents((s) => [...s, { minute: m, type: 'sub', men: true, text: 'Si spinge avanti con tutto: bello, rischioso, voluto' }])
    }
  }

  /** Minuti giocati: servono alle statistiche stagionali e alla progressione. */
  const minutesPlayed = useMemo(() => {
    const m = {}
    for (const p of xi) m[p.id] = MATCH_MINUTES
    for (const s of subs) {
      if (m[s.outId] !== undefined) m[s.outId] = Math.min(m[s.outId], s.minute)
      if (s.inId && m[s.inId] === undefined) m[s.inId] = MATCH_MINUTES - s.minute
    }
    return m
  }, [xi, subs])

  const eventsVisible = phase === 'pre' ? [] : allEvents.filter((e) => e.minute <= minute)
  const hg = eventsVisible.filter((e) => e.type === 'goal' && e.side === 'home').length
  const ag = eventsVisible.filter((e) => e.type === 'goal' && e.side === 'away').length
  const home = clubById[fixture.homeId]
  const away = clubById[fixture.awayId]
  const benchLeft = bench.filter((p) => !subs.some((s) => s.inId === p.id))

  const finalResult = {
    homeGoals: allEvents.filter((e) => e.type === 'goal' && e.side === 'home').length,
    awayGoals: allEvents.filter((e) => e.type === 'goal' && e.side === 'away').length,
    events: pensResult ? [...allEvents, ...pensResult.events] : allEvents,
    minutesPlayed,
    ...(pensResult ? { cupWinnerId: pensResult.cupWinnerId } : {}),
  }

  /** Rigori (Coppa): tiratori e portieri per la sfida dal dischetto. */
  const userClub = match.userIsHome ? home : away
  const oppClub = match.userIsHome ? away : home
  const oppXI = match.userIsHome ? match.awayXI : match.homeXI
  const userGk = onPitch.find((p) => p.role === 'GK') || xi.find((p) => p.role === 'GK') || onPitch[0]
  const oppGk = oppXI.find((p) => p.role === 'GK') || oppXI[0]

  return (
    <div className="fixed inset-0 z-10 overflow-y-auto bg-pitch-950">
      <div className="mx-auto max-w-2xl p-4 pb-10 sm:p-8">
        <p className="scoreboard text-center text-[10px] tracking-[0.35em] text-flood-400">
          {fixture.type === "cup"
            ? CUP_NAME + " · " + (CUP_ROUNDS[fixture.round] || "Turno " + fixture.round)
            : (LEAGUES.find((l) => l.id === ((clubById[fixture.homeId] || {}).leagueId)) || LEAGUES[0]).name + " · Giornata " + fixture.number}
        </p>

        {phase === 'pre' && (
          <div className="mt-8 space-y-6 text-center">
            <div className="flex items-center justify-center gap-4">
              <TeamBadge club={home} />
              <span className="text-slate-500">vs</span>
              <TeamBadge club={away} />
            </div>
            <p className="text-xs text-slate-500">
              Momenti chiave con 3 opzioni e {QTE_SECONDS} secondi per decidere, fino a {MAX_SUBS} cambi in corsa.
            </p>
            <div className="mx-auto max-w-sm rounded-xl border border-slate-700 bg-pitch-900 p-4 text-left">
              <p className="text-center text-xs text-slate-400">
                Lavagnetta: <span className="font-semibold text-flood-300">{FORMATIONS[userTactics.formation].name}</span> · {userTactics.mentality} · pressing {userTactics.pressing} · linea {userTactics.line}
                {userPicks ? ' · undici scelto da te' : ''}
              </p>
              <div className="mt-3 space-y-1">
                {['FW', 'MF', 'DF', 'GK'].map((r) => (
                  <div key={r} className="flex items-center gap-2">
                    <span className="w-7 text-[10px] font-bold tracking-widest text-slate-500">{r}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{xi.filter((p) => p.slot === r).map((p) => p.name + (affinity(p.role, p.slot) < 1 ? ' *' : '')).join(' · ')}</span>
                  </div>
                ))}
              </div>
              {xi.some((p) => affinity(p.role, p.slot) < 1) && (
                <p className="mt-2 text-center text-[10px] text-amber-300/80">* fuori ruolo: rende meno, e la partita se ne accorge</p>
              )}
              <p className="mt-3 text-center text-xs text-slate-400">Loro si preparano col {FORMATIONS[(match.userIsHome ? match.awayTactics : match.homeTactics).formation].name}</p>
            </div>
            <div className="mx-auto flex max-w-xs flex-col gap-2">
              <button
                onClick={() => setPhase('live')}
                className="rounded-lg bg-teal-500 py-3 text-sm font-semibold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:bg-teal-400 hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98]"
              >
                Fischio d'inizio
              </button>
              <button
                onClick={skipToEnd}
                className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-teal-500"
              >
                Salta al risultato
              </button>
            </div>
          </div>
        )}

        {(phase === 'live' || phase === 'qte') && (
          <div className="mt-6">
            <div className="scoreboard flex items-center justify-between gap-2 text-base font-semibold">
              <span className="min-w-0 flex-1 truncate text-right">{home.name}</span>
              <span key={hg + '-' + ag} className="animate-goal-flash shrink-0 rounded-lg border border-pitch-700 bg-pitch-800/80 px-4 py-1 text-2xl tabular-nums tracking-widest text-flood-300">{hg}-{ag}</span>
              <span className="min-w-0 flex-1 truncate">{away.name}</span>
            </div>
            <p className="mt-1 text-center text-xs text-slate-400">{minute} minuti · recupero incluso{currentMentality ? ' · mentalità: ' + (MENTALITY_LABELS[currentMentality] || currentMentality) : ''}</p>
            <div className="mt-2 h-1 rounded bg-slate-800">
              <div
                className="h-1 rounded bg-teal-500 shadow-[0_0_8px_rgba(47,181,110,0.6)] transition-all"
                style={{ width: (minute / FULL_TIME) * 100 + '%' }}
              />
            </div>

            <PitchView
              director={pitchDirector}
              minute={minute}
              events={allEvents}
              homeForm={match.userIsHome ? activeFormation : match.homeTactics.formation}
              awayForm={match.userIsHome ? match.awayTactics.formation : activeFormation}
              userSide={userSide}
              qte={pendingMoment || null}
              nextQte={upcomingQte}
            />

            {phase === 'live' && subsLeft > 0 && (
              <button
                onClick={() => {
                  if (forcedOutId) {
                    autoForcedSub()
                    return
                  }
                  setSubsOpen((o) => !o)
                  setPickOut(null)
                  setPickIn(null)
                }}
                className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-teal-500"
              >
                {subsOpen ? 'Chiudi pannello cambi' : 'Cambio · ' + subsLeft + ' disponibili'}
              </button>
            )}

            {phase === 'live' && subsOpen && (
              <div className="mt-3 rounded-xl border border-slate-700 bg-pitch-900 p-4">
                {!pickOut ? (
                  <>
                    <p className="text-sm font-semibold">Chi esce?</p>
                    <ul className="mt-2 space-y-1.5">
                      {onPitch.map((p) => {
                        const st = stamina[p.id] === undefined ? 100 : stamina[p.id]
                        const isLocked = locked.has(p.id)
                        return (
                          <li key={p.id}>
                            <button
                              disabled={isLocked}
                              onClick={() => setPickOut(p)}
                              title={isLocked ? 'Coinvolto in un momento chiave in arrivo' : 'Stamina ' + Math.round(st) + '%'}
                              className={
                                'w-full rounded-lg border px-3 py-2 text-left text-sm ' +
                                (isLocked
                                  ? 'cursor-not-allowed border-slate-800 opacity-50'
                                  : 'border-slate-700 hover:border-teal-500')
                              }
                            >
                              <span className="flex items-baseline justify-between gap-2">
                                <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                                <span className="text-xs text-slate-400">{p.role}</span>
                                <span className="text-xs tabular-nums text-slate-400">{Math.round(st)}%</span>
                              </span>
                              <span className="mt-1.5 block h-1 rounded bg-slate-800">
                                <span className={'block h-1 rounded ' + staminaColor(st)} style={{ width: st + '%' }} />
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold">Chi entra al posto di {pickOut.name}{forcedOutId === pickOut.id ? ' — infortunio, si esce per forza' : ''}?</p>
                    <ul className="mt-2 space-y-1.5">
                      {benchLeft.map((p) => (
                        <li key={p.id}>
                          <button
                            onClick={() => setPickIn(p)}
                            className={
                              'w-full rounded-lg border px-3 py-2 text-left text-sm ' +
                              (pickIn && pickIn.id === p.id
                                ? 'border-teal-500 bg-teal-500/10'
                                : 'border-slate-700 hover:border-teal-500')
                            }
                          >
                            <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                            <span className="ml-2 text-xs text-slate-400">{p.role} · OVR {p.ovr}{affinity(p.role, pickOut.slot || pickOut.role) < 1 ? ' · fuori ruolo' : ''}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 flex gap-2">
                      {forcedOutId === pickOut.id ? (
                        <button
                          onClick={autoForcedSub}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-slate-500"
                        >
                          Lo sceglie lo staff
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setPickOut(null)
                            setPickIn(null)
                          }}
                          className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-slate-500"
                        >
                          Indietro
                        </button>
                      )}
                      <button
                        disabled={!pickIn}
                        onClick={makeSub}
                        className="rounded-lg bg-teal-500 px-3 py-2 text-xs font-semibold text-pitch-950 hover:bg-teal-400 disabled:opacity-40"
                      >
                        Conferma cambio
                      </button>
                    </div>
                  </>
                )}
                <div className="mt-4 border-t border-slate-800 pt-3">
                  <button
                    onClick={() => setFormChangesOpen((o) => !o)}
                    className="text-xs font-semibold text-slate-300 transition hover:text-flood-300"
                  >
                    {formChangesOpen ? 'Chiudi la lavagnetta in corsa' : 'Cambio modulo · in campo ora: ' + FORMATIONS[activeFormation].name}
                  </button>
                  {formChangesOpen && (
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {FORMATION_ORDER.filter((f) => f !== activeFormation).map((f) => (
                        <button
                          key={f}
                          onClick={() => changeFormation(f)}
                          className="rounded-lg border border-slate-700 px-2 py-2 text-xs transition hover:border-flood-400 hover:text-flood-300"
                        >
                          <span className="block font-semibold">{FORMATIONS[f].name}</span>
                          <span className="block text-[10px] text-slate-500">{FORMATIONS[f].label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mt-1 text-[10px] text-slate-500">Il riassetto è nel seed: ogni lavagnetta in corsa porta un battito di disorganizzazione — o l'idea giusta.</p>
                </div>
                <div className="mt-3 border-t border-slate-800 pt-3">
                  <p className="text-xs font-semibold text-slate-300">
                    Mentalità · in campo ora: <span className="text-flood-300">{MENTALITY_LABELS[activeMentality] || activeMentality}</span>
                  </p>
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    {['prudente', 'equilibrata', 'ardita'].map((mm) => (
                      <button
                        key={mm}
                        disabled={mm === activeMentality}
                        onClick={() => changeMentality(mm)}
                        className={
                          'rounded-lg border px-2 py-2 text-xs transition disabled:opacity-40 ' +
                          (mm === activeMentality
                            ? 'border-flood-400 bg-flood-400/10 text-flood-200'
                            : 'border-slate-700 text-slate-300 hover:border-flood-400/60')
                        }
                      >
                        <span className="block font-semibold">{MENTALITY_LABELS[mm]}</span>
                        <span className="block text-[10px] text-slate-500">{mm === 'prudente' ? 'Si difende il bottino' : mm === 'ardita' ? 'Si rincorre il gol' : 'Si amministra'}</span>
                      </button>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">Difendere si fa da prudenti, rincorrere da arditi — il resto lo decide il seed.</p>
                </div>
                <p className="mt-2 text-xs text-slate-500">L'orologio continua a correre: il calcio è anche questo.</p>
              </div>
            )}

            {phase === 'qte' && pendingMoment && (
              <div className={'mt-4 rounded-xl border-2 bg-pitch-900 p-4 shadow-[0_0_28px_rgba(239,191,78,0.12)] ' + (qteSeconds <= 3 ? 'animate-urgent border-red-500/70' : 'border-flood-400/60')}>
                <p className="text-sm font-semibold text-amber-400">
                  {pendingMoment.minute}' — {pendingMoment.prompt}
                </p>
                <div className="mt-2 h-1 rounded bg-slate-800">
                  <div
                    className={'h-1 rounded transition-all ' + (qteSeconds <= 3 ? 'bg-red-500' : 'bg-amber-500')}
                    style={{ width: (qteSeconds / QTE_SECONDS) * 100 + '%' }}
                  />
                </div>
                <p className="mt-1 text-right text-xs text-amber-300">{qteSeconds}s</p>
                <div className="mt-2 space-y-2">
                  {pendingMoment.options.map((o, i) => (
                    <button
                      key={o.id}
                      onClick={() => chooseOption(pendingMoment, i)}
                      className="w-full rounded-lg border border-slate-700 px-3 py-2.5 text-left transition hover:border-amber-500 hover:bg-amber-500/5 active:scale-[0.99]"
                    >
                      <span className="text-sm font-semibold">{o.label}</span>
                      <span className="ml-2 text-xs text-slate-400">{o.hint}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">Allo scadere sceglie la prudenza per te.</p>
              </div>
            )}

            <ul className="mt-6 space-y-2">
              {eventsVisible.slice().reverse().map((e, i) => (
                <li key={i} className={'animate-slide-in rounded-lg border px-3 py-2 text-sm ' + eventClass(e)}>
                  <span className="mr-2 text-xs text-slate-500">{e.minute}'</span>
                  {e.qte && <span className="mr-1 rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">QTE</span>}
                  {e.sub && <span className="mr-1 rounded bg-teal-500/20 px-1 text-[10px] text-teal-300">CAMBIO</span>}
                  {e.form && <span className="mr-1 rounded bg-flood-400/20 px-1 text-[10px] text-flood-300">MODULO</span>}
                  {e.men && <span className="mr-1 rounded bg-flood-400/20 px-1 text-[10px] text-flood-300">MENTALITÀ</span>}
                  {e.type === 'pen' && <span className="mr-1 rounded bg-flood-400/20 px-1 text-[10px] text-flood-300">RIG</span>}
                  {e.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase === 'pens' && (
          <PensShootout
            seedNumber={match.seedNumber}
            userIsHome={match.userIsHome}
            userClub={userClub}
            oppClub={oppClub}
            userTakers={onPitch}
            oppTakers={oppXI}
            userGk={userGk}
            oppGk={oppGk}
            auto={pensAuto}
            onComplete={(res) => {
              setPensResult(res)
              setPhase('end')
            }}
          />
        )}

        {phase === 'end' && (
          <div className="mt-8 space-y-6 text-center">
            <p className="scoreboard animate-goal-flash inline-block rounded-lg px-4 text-5xl font-bold tabular-nums tracking-widest text-flood-300">{finalResult.homeGoals}-{finalResult.awayGoals}</p>
            {pensResult && (
              <p className="text-sm text-flood-300">Rigori: {pensResult.homePens}-{pensResult.awayPens} — passa il {(pensResult.cupWinnerId === home.id ? home : away).name}</p>
            )}
            <p className="text-sm text-slate-400">{home.name} — {away.name}</p>
            <ul className="mx-auto max-w-sm space-y-2 text-left">
              {finalResult.events.map((e, i) => (
                <li key={i} className="text-sm">
                  <span className="mr-2 text-xs text-slate-500">{e.minute}'</span>
                  {e.qte && <span className="mr-1 rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">QTE</span>}
                  {e.sub && <span className="mr-1 rounded bg-teal-500/20 px-1 text-[10px] text-teal-300">CAMBIO</span>}
                  {e.form && <span className="mr-1 rounded bg-flood-400/20 px-1 text-[10px] text-flood-300">MODULO</span>}
                  {e.men && <span className="mr-1 rounded bg-flood-400/20 px-1 text-[10px] text-flood-300">MENTALITÀ</span>}
                  {e.type === 'pen' && <span className="mr-1 rounded bg-flood-400/20 px-1 text-[10px] text-flood-300">RIG</span>}
                  {e.text}
                </li>
              ))}
            </ul>
            <button
              onClick={() => onDone(finalResult)}
              className="rounded-lg bg-teal-500 px-6 py-2.5 text-sm font-semibold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:bg-teal-400 hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98]"
            >
              Continua
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
