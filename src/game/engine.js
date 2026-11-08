

/**
 * Motore partita (F3). I gol seguono una distribuzione di Poisson guidata
 * dalla differenza di forza tra le squadre (miglior XI + morale + fattore casa).
 * Deterministico dal seed della partita. I chiamanti filtrano gli infortunati
 * prima di passare le rose.
 *
 * Momenti chiave (QTE): nelle partite dell'utente si generano 1-2 momenti
 * decisivi scelti da un pool di 7 (rigore, uno contro uno col portiere,
 * contropiede a favore, punizione dal limite, corner finale a favore,
 * contropiede subito, corner da difendere nel finale). L'esito di OGNI
 * opzione è precomputato deterministicamente da (seed partita, momento,
 * scelta): lo stesso QTE dà sempre lo stesso esito, quindi non si può
 * "ritirare il dado" ricaricando la pagina.
 *
 * Sostituzioni: la UI live chiama subImpact() quando entra un fresco.
 * L'impatto (gol, assist, occasione o nulla) è deterministico da
 * (seed partita, giocatore, minuto del cambio): niente reroll.
 *
 * Infortuni: probabilità bassa per squadra, gravità nel seed. La UI li
 * traduce in cambio obbligato (o in dieci uomini se i cambi sono finiti);
 * il post-partita scrive quante giornate il giocatore resta fuori.
 */
import { Rng } from '../lib/rng'
import { hasAbility } from './abilities'
import { bestXIFor, bestFormationFor, teamStrengthFor, formationEdge, aiTactics, xgMultiplier, cardsMultiplier } from './tactics'

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** Seed numerico deterministico di una partita. */
export function matchSeedNumber(careerSeed, fixtureKey) {
  return (((careerSeed >>> 0) ^ hashString(fixtureKey)) >>> 0)
}

/** RNG deterministico per una partita (partite simulate in background). */
export function matchSeed(careerSeed, fixtureKey) {
  return new Rng(matchSeedNumber(careerSeed, fixtureKey))
}

/** Miglior XI (senior) per OVR. Sopravvive per i vecchi richiami: la
 *  schierata vera passa da bestXIFor, modulo alla mano (G2). */
export function bestXI(squad) {
  return squad.filter((p) => !p.youth).sort((a, b) => b.ovr - a.ovr).slice(0, 11)
}

/** Forza squadra (compat): quella del miglior modulo possibile per la
 *  rosa. Da G2 la forza è dell'undici schierato, dazio di ruolo incluso. */
export function teamStrength(club, squad) {
  return teamStrengthFor(club, squad, bestFormationFor(club, squad))
}

/** Poisson (Knuth): gol attesi → gol segnati. */
function poisson(rng, lambda) {
  const L = Math.exp(-lambda)
  let k = 0
  let p = 1
  do {
    k++
    p *= rng.float()
  } while (p > L)
  return k - 1
}

function weightedPick(rng, items, weightFn) {
  const weights = items.map(weightFn)
  const total = weights.reduce((a, b) => a + b, 0) || 1
  let roll = rng.float() * total
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return items[i]
  }
  return items[items.length - 1]
}

const ROLE_GOAL_WEIGHT = { GK: 0.03, DF: 1, MF: 4, FW: 10 }

function pickScorer(rng, squad) {
  return weightedPick(rng, squad, (p) => {
    let w = ROLE_GOAL_WEIGHT[p.role] * (p.ovr / 70)
    if (hasAbility(p, 'bomber')) w *= 1.7
    if (hasAbility(p, 'fuoriclasse')) w *= 2
    return w
  })
}

/** Chi serve il gol: Regista e Fuoriclasse pesano il doppio (F5). */
function pickAssist(rng, squad) {
  const makers = squad.filter((p) => hasAbility(p, 'regista') || hasAbility(p, 'fuoriclasse'))
  if (makers.length && rng.chance(0.5)) return rng.pick(makers)
  return pickScorer(rng, squad)
}

function pickByRole(rng, squad, role) {
  const pool = squad.filter((p) => p.role === role)
  return pool.length ? rng.pick(pool) : rng.pick(squad)
}

/** Compagno di manovra diverso dal portatore (mai un portiere). */
function pickMate(rng, squad, exceptId) {
  const pool = squad.filter((p) => p.id !== exceptId && p.role !== 'GK')
  return pool.length ? rng.pick(pool) : squad[0]
}

/** RNG dell'esito di una singola scelta di QTE. */
function outcomeRng(seedNumber, momentId, choiceId) {
  return new Rng((seedNumber ^ hashString(momentId + ':' + choiceId)) >>> 0)
}

/**
 * Costruisce una partita. Con keyMoments attivo genera anche i momenti QTE
 * per la squadra dell'utente (1-2 per partita, da un pool di 7 tipi).
 * La cronaca base è identica a prescindere: i momenti chiave aggiungono
 * gol ed eventi sopra di essa.
 */
export function buildMatch(homeClub, awayClub, playersByClubId, rng, { keyMoments = false, seedNumber = 0, userClubId = null, homeTactics = null, awayTactics = null } = {}) {
  const homeSquad = (playersByClubId[homeClub.id] || []).filter((p) => !p.youth)
  const awaySquad = (playersByClubId[awayClub.id] || []).filter((p) => !p.youth)

  // G2 — Banco e Lavagnetta: chi non porta le tattiche se le scrive da
  // solo (modulo che valorizza la rosa, stile stabile nel club, mente
  // e cuore dal rapporto di forza). Matchup tra moduli e tattiche
  // spostano i gol attesi: la lavagnetta conta, eccome.
  const homeForm = (homeTactics && homeTactics.formation) || bestFormationFor(homeClub, homeSquad)
  const awayForm = (awayTactics && awayTactics.formation) || bestFormationFor(awayClub, awaySquad)
  const shBase = teamStrengthFor(homeClub, homeSquad, homeForm)
  const saBase = teamStrengthFor(awayClub, awaySquad, awayForm)
  const hT = homeTactics || aiTactics(homeClub, homeSquad, saBase, true)
  const aT = awayTactics || aiTactics(awayClub, awaySquad, shBase, false)
  const modsH = xgMultiplier(hT)
  const modsA = xgMultiplier(aT)
  const edge = formationEdge(hT.formation, aT.formation)
  const sh = shBase + 2.5 // vantaggio campo
  const sa = saBase
  const xgH = clamp((1.3 + (sh - sa) * 0.05) * (1 + edge.edgeH) * modsH.own * modsA.opp, 0.12, 4.5)
  const xgA = clamp((1.05 + (sa - sh) * 0.05) * (1 + edge.edgeA) * modsA.own * modsH.opp, 0.12, 4.5)
  const goalsH = Math.min(poisson(rng, xgH), 7)
  const goalsA = Math.min(poisson(rng, xgA), 7)

  // Gli undici scesi in campo: da qui in poi marcatori, ammonizioni,
  // infortuni e momenti chiave riguardano solo chi è davvero in campo.
  const homeXI = bestXIFor(hT.formation, homeSquad)
  const awayXI = bestXIFor(aT.formation, awaySquad)

  const events = []

  const addGoal = (side, club, squad) => {
    const scorer = pickScorer(rng, squad)
    const assist = rng.chance(0.45) ? pickAssist(rng, squad) : null
    const assistTxt = assist && assist.id !== scorer.id ? ' su assist di ' + assist.name : ''
    events.push({
      minute: rng.int(2, 92),
      side,
      type: 'goal',
      playerId: scorer.id,
      text: 'GOL! ' + scorer.name + assistTxt + ' (' + club.name + ')',
    })
  }
  for (let i = 0; i < goalsH; i++) addGoal('home', homeClub, homeXI)
  for (let i = 0; i < goalsA; i++) addGoal('away', awayClub, awayXI)

  const missCount = rng.int(2, 5)
  for (let i = 0; i < missCount; i++) {
    const side = rng.chance(0.5) ? 'home' : 'away'
    const squad = side === 'home' ? homeXI : awayXI
    const attacker = pickScorer(rng, squad)
    const variant = rng.int(0, 2)
    const text =
      variant === 0
        ? attacker.name + ' colpisce il palo!'
        : variant === 1
          ? 'Gran parata del portiere su ' + attacker.name
          : attacker.name + ' calcia alto da posizione invitante'
    events.push({ minute: rng.int(2, 92), side, type: 'chance', playerId: attacker.id, text })
  }

  // Ammonizioni: chi preme aggressivo parla di più con l'arbitro.
  const cardsH = cardsMultiplier(hT)
  const cardsA = cardsMultiplier(aT)
  const cardCount = Math.max(0, Math.round(rng.int(1, 5) * (cardsH + cardsA) / 2))
  for (let i = 0; i < cardCount; i++) {
    const side = rng.float() * (cardsH + cardsA) < cardsH ? 'home' : 'away'
    const squad = side === 'home' ? homeXI : awayXI
    if (!squad.length) continue
    const player = rng.pick(squad)
    events.push({ minute: rng.int(10, 92), side, type: 'card', playerId: player.id, text: player.name + ' ammonito' })
  }
  if (rng.chance(0.06)) {
    const side = rng.chance(0.5) ? 'home' : 'away'
    const squad = side === 'home' ? homeXI : awayXI
    if (squad.length) {
      const player = rng.pick(squad)
      events.push({ minute: rng.int(25, 90), side, type: 'red', playerId: player.id, text: 'ESPULSO: ' + player.name + '!' })
    }
  }

  // Infortuni in partita: probabilità bassa per squadra, gravità variabile.
  // Tutto nel seed: stessa partita, stessi infortuni.
  for (const side of ['home', 'away']) {
    if (rng.chance(0.16)) {
      const squad = side === 'home' ? homeXI : awayXI
      if (!squad.length) continue
      const player = rng.pick(squad)
      const weeks = rng.chance(0.7) ? rng.int(1, 2) : rng.int(3, 5)
      events.push({
        minute: rng.int(5, 88),
        side,
        type: 'injury',
        playerId: player.id,
        weeks,
        text: 'Infortunio: ' + player.name + ' si accascia senza contatto ed esce zoppicando. Circa ' + weeks + ' giornate fuori',
      })
    }
  }

  const moments = []
  if (keyMoments && userClubId) {
    const userIsHome = homeClub.id === userClubId
    const userClub = userIsHome ? homeClub : awayClub
    const oppClub = userIsHome ? awayClub : homeClub
    const userSquad = userIsHome ? homeXI : awayXI
    const oppSquad = userIsHome ? awayXI : homeXI
    const userSide = userIsHome ? 'home' : 'away'
    // Risultato (solo cronaca base) della squadra utente al minuto indicato.
    const baseDiffAt = (min) =>
      events
        .filter((e) => e.type === 'goal' && e.minute < min)
        .reduce((d, e) => d + (e.side === userSide ? 1 : -1), 0)

    const minuteFor = {
      penalty: () => rng.int(12, 85),
      oneonone: () => rng.int(5, 90),
      counterFor: () => rng.int(10, 88),
      freekick: () => rng.int(8, 90),
      corner: () => rng.int(78, 92),
      counter: () => rng.int(18, 88),
      cornerAgainst: () => rng.int(75, 92),
    }
    const pool = ['penalty', 'oneonone', 'counterFor', 'freekick', 'corner', 'counter', 'cornerAgainst']
    const count = rng.int(1, 2)
    const picked = []
    for (const kind of rng.shuffle(pool)) {
      if (picked.length >= count) break
      const minute = minuteFor[kind]()
      // Il corner da difendere ha senso solo con un risultato da proteggere.
      if (kind === 'cornerAgainst' && baseDiffAt(minute) < 0) continue
      picked.push({ kind, minute })
    }
    picked.forEach((p, i) => {
      moments.push(makeMoment(rng, p.kind, p.minute, i, seedNumber, userClub, oppClub, userSquad, oppSquad))
    })
  }

  events.sort((a, b) => a.minute - b.minute)
  return { baseEvents: events, keyMoments: moments, homeTactics: hT, awayTactics: aT, homeXI, awayXI }
}

/** Simulazione completa senza interazione (partite AI e "salta al risultato"). */
export function simulateMatch(homeClub, awayClub, playersByClubId, rng) {
  const { baseEvents } = buildMatch(homeClub, awayClub, playersByClubId, rng)
  return {
    homeGoals: baseEvents.filter((e) => e.type === 'goal' && e.side === 'home').length,
    awayGoals: baseEvents.filter((e) => e.type === 'goal' && e.side === 'away').length,
    events: baseEvents,
  }
}

/**
 * Impatto di una sostituzione, deterministico da (seed partita, giocatore
 * che entra, minuto del cambio): 13% gol del fresco, 13% assist (gol di un
 * compagno), 12% occasione pericolosa. Altrimenti nulla: il cambio è solo
 * fatica fresca, e va già bene così.
 */
export function subImpact(seedNumber, inPlayer, subMinute, squad) {
  const rng = outcomeRng(seedNumber, 'sub:' + inPlayer.id + ':' + subMinute)
  const at = Math.min(subMinute + rng.int(2, 15), 92)
  const roll = rng.float()
  const goalP = hasAbility(inPlayer, 'bomber') || hasAbility(inPlayer, 'fuoriclasse') ? 0.18 : 0.13
  if (roll < goalP) {
    return {
      minute: at,
      type: 'goal',
      playerId: inPlayer.id,
      text: 'GOL! Appena entrato e già decisivo: ' + inPlayer.name + ' segna al primo pallone che tocca',
    }
  }
  if (roll < goalP + 0.13) {
    const scorer = pickScorer(rng, squad.filter((p) => p.id !== inPlayer.id))
    return {
      minute: at,
      type: 'goal',
      playerId: scorer.id,
      text: 'GOL! ' + scorer.name + ' buca la difesa su lancio del freschissimo ' + inPlayer.name,
    }
  }
  if (roll < 0.38) {
    return {
      minute: at,
      type: 'chance',
      playerId: inPlayer.id,
      text: 'Conclusione velenosa di ' + inPlayer.name + ' appena entrato: alto di poco',
    }
  }
  return null
}

/* ---------------- Momenti chiave (QTE) ---------------- */

function makeMoment(rng, kind, minute, idx, seedNumber, userClub, oppClub, userSquad, oppSquad) {
  const id = 'm' + idx
  const rollOutcome = (choiceId, fn) => {
    const orng = outcomeRng(seedNumber, id, choiceId)
    return fn(orng)
  }

  if (kind === 'penalty') {
    const cold = userSquad.filter((p) => hasAbility(p, 'ghiaccio'))
    const shooter = cold.length ? rng.pick(cold) : pickScorer(rng, userSquad)
    const ice = hasAbility(shooter, 'ghiaccio') ? 0.15 : 0
    const defs = [
      { id: 'incrocio', label: "Secco all'incrocio", hint: 'Freddo e cattivo', prudent: false, goalP: Math.min(0.95, 0.72 + ice), postP: 0.1 },
      { id: 'cucchiaio', label: 'Cucchiaio', hint: 'Fegato… o umiliazione', prudent: false, goalP: Math.min(0.95, 0.76 + ice), postP: 0.02 },
      { id: 'tiratore', label: 'Lascia decidere a lui', hint: 'La scelta prudente', prudent: true, goalP: Math.min(0.95, 0.68 + ice), postP: 0.06 },
    ]
    const options = defs.map((d) =>
      rollOutcome(d.id, (orng) => {
        const roll = orng.float()
        if (roll < d.goalP) {
          return { ...d, outcome: { goal: 1, goalAgainst: 0, card: false, playerId: shooter.id, text: 'GOL! ' + shooter.name + ' trasforma il rigore (' + d.label + ')' } }
        }
        if (roll < d.goalP + d.postP) {
          return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: 'Rigore: PALO! ' + shooter.name + ' prova il colpo ' + d.label + ' ma la sfera sfiora lo specchio' } }
        }
        return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: 'Parato! Il portiere vola sul rigore di ' + shooter.name + ' (' + d.label + ')' } }
      }),
    )
    return {
      id,
      kind,
      side: 'for',
      minute,
      prompt: 'RIGORE per il ' + userClub.name + '! Sul dischetto va ' + shooter.name + (ice ? ' — Ghiaccio nelle vene: per lui è una formalità' : '') + '. Come lo vuoi?',
      options,
    }
  }

  if (kind === 'oneonone') {
    const striker = pickScorer(rng, userSquad)
    const mate = pickMate(rng, userSquad, striker.id)
    const defs = [
      { id: 'primaintenzione', label: 'Tira di prima', hint: 'Concludi prima che lo spazio si chiuda', prudent: false, goalP: 0.62, midP: 0.26 },
      { id: 'scarta', label: 'Scarta il portiere', hint: 'Fegato: saltalo e deposita', prudent: false, goalP: 0.74, midP: 0.18 },
      { id: 'parallelo', label: 'Passa al compagno in parallelo', hint: 'La scelta prudente', prudent: true, goalP: 0.66, midP: 0.28 },
    ]
    const options = defs.map((d) =>
      rollOutcome(d.id, (orng) => {
        const roll = orng.float()
        if (roll < d.goalP) {
          if (d.id === 'parallelo') {
            return { ...d, outcome: { goal: 1, goalAgainst: 0, card: false, playerId: mate.id, text: 'GOL! ' + striker.name + ' serve il parallelo perfetto e ' + mate.name + ' insacchina a porta vuota' } }
          }
          if (d.id === 'scarta') {
            return { ...d, outcome: { goal: 1, goalAgainst: 0, card: false, playerId: striker.id, text: 'GOL! ' + striker.name + ' scarta il portiere e la deposita in rete con calma olimpica' } }
          }
          return { ...d, outcome: { goal: 1, goalAgainst: 0, card: false, playerId: striker.id, text: 'GOL! ' + striker.name + ' conclude di prima e beffa il portiere sul primo palo' } }
        }
        if (roll < d.goalP + d.midP) {
          const txt =
            d.id === 'parallelo'
              ? 'Chiusura disperata sul parallelo di ' + striker.name + ': rinvio e via'
              : d.id === 'scarta'
                ? 'Il portiere legge il tentativo di scarto e blocca tutto: che uscita'
                : 'Gran parata! Il portiere devia la conclusione di prima di ' + striker.name
          return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: txt } }
        }
        const txt =
          d.id === 'parallelo'
            ? 'Fuorigioco: la bandierina annulla il parallelo di ' + striker.name
            : d.id === 'scarta'
              ? 'Il portiere esce e anticipa ' + striker.name + ' di un soffio: palla persa'
              : striker.name + ' calcia alto da posizione invitante: occasione bruciata'
        return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: txt } }
      }),
    )
    return {
      id,
      kind,
      side: 'for',
      minute,
      prompt: 'Lancio perfetto: ' + striker.name + ' resta solo davanti al portiere! Che fai?',
      options,
    }
  }

  if (kind === 'counterFor') {
    const sprinters = userSquad.filter((p) => hasAbility(p, 'falcata'))
    const carrier = sprinters.length ? rng.pick(sprinters) : pickScorer(rng, userSquad)
    const boost = hasAbility(carrier, 'falcata') ? 0.08 : 0
    const mate = pickMate(rng, userSquad, carrier.id)
    const defs = [
      { id: 'verticalizza', label: 'Verticalizza subito', hint: 'Filtrante, senza pensare', prudent: false, goalP: 0.58 + boost, midP: 0.27, lostP: 0.15 },
      { id: 'scatto', label: 'Protagonismo: il portatore scatta', hint: 'Va fino in fondo da solo', prudent: false, goalP: 0.5 + boost, midP: 0.32, lostP: 0.18 },
      { id: 'smarcato', label: 'Prolunga per lo smarcato', hint: 'La scelta prudente', prudent: true, goalP: 0.54 + boost, midP: 0.36, lostP: 0.1 },
    ]
    const options = defs.map((d) =>
      rollOutcome(d.id, (orng) => {
        const roll = orng.float()
        if (roll < d.goalP) {
          const scorer = d.id === 'scatto' ? carrier : mate
          const txt =
            d.id === 'verticalizza'
              ? 'GOL! Filtrante perfetta di ' + carrier.name + ': ' + mate.name + ' arriva davanti al portiere e non sbaglia'
              : d.id === 'scatto'
                ? "GOL! " + carrier.name + " parte, scarta l'ultimo difensore e batte il portiere"
                : 'GOL! ' + carrier.name + ' prolunga per ' + mate.name + ': controllo e botta secca'
          return { ...d, outcome: { goal: 1, goalAgainst: 0, card: false, playerId: scorer.id, text: txt } }
        }
        if (roll < d.goalP + d.midP) {
          const txt =
            d.id === 'verticalizza'
              ? 'La filtrante è troppo lunga: se ne accorge il portiere, che esce e blocca'
              : d.id === 'scatto'
                ? 'Gran parata sul tentativo solitario di ' + carrier.name
                : 'Il portiere anticipa ' + mate.name + ' sul prolungamento: azione morta'
          return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: txt } }
        }
        const txt =
          d.id === 'verticalizza'
            ? 'Fuorigioco: la verticale di ' + carrier.name + ' arriva un battito prima'
            : d.id === 'scatto'
              ? 'Il difensore recupera sullo scatto di ' + carrier.name + ': contropiede sprecato'
              : 'Il prolungamento di ' + carrier.name + ' è tagliato dal rientrante'
        return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: txt } }
      }),
    )
    return {
      id,
      kind,
      side: 'for',
      minute,
      prompt: 'Palla recuperata alta: CONTROPIDE per il ' + userClub.name + ', tre contro due' + (boost ? ' — e ' + carrier.name + ' ha la Falcata' : '') + '! Come la concludi?',
      options,
    }
  }

  if (kind === 'freekick') {
    const specialists = userSquad.filter((p) => hasAbility(p, 'specialista'))
    const taker = specialists.length ? rng.pick(specialists) : pickByRole(rng, userSquad, 'MF')
    const spec = hasAbility(taker, 'specialista') ? 0.18 : 0
    const header = pickByRole(rng, userSquad, 'FW')
    const defs = [
      { id: 'diretto', label: "Tiro diretto all'angolino", hint: 'Colpo da campione… o da dilettante', prudent: false, goalP: 0.26 + spec, midP: 0.62, lostP: 0.12 },
      { id: 'cross', label: 'Cross in area', hint: 'Palla alta per il colpo di testa', prudent: false, goalP: 0.2 + (spec ? 0.06 : 0), midP: 0.72, lostP: 0.08 },
      { id: 'corto', label: 'Batte corto e rigioca', hint: 'La scelta prudente', prudent: true, goalP: 0.1 + (spec ? 0.04 : 0), midP: 0.78, lostP: 0.12 },
    ]
    const options = defs.map((d) =>
      rollOutcome(d.id, (orng) => {
        const roll = orng.float()
        if (roll < d.goalP) {
          const txt =
            d.id === 'diretto'
              ? "GOL! " + taker.name + " piega la barriera e la mette all'angolino, come disegnato in lavagna"
              : d.id === 'cross'
                ? 'GOL! Cross perfetto di ' + taker.name + ' e incornata chirurgica di ' + header.name
                : "GOL! Giocata a due e stoccata: " + taker.name + " riceve indietro e infila l'angolino dal limite"
          const scorer = d.id === 'cross' ? header : taker
          return { ...d, outcome: { goal: 1, goalAgainst: 0, card: false, playerId: scorer.id, text: txt } }
        }
        if (roll < d.goalP + d.midP) {
          const txt =
            d.id === 'diretto'
              ? 'Muro! La barriera respinge il tiro di ' + taker.name
              : d.id === 'cross'
                ? 'Cross di ' + taker.name + ' respinto dalla difesa: secondo pallone innocuo'
                : "Punizione corta: " + taker.name + " tiene palla e fa ripartire l'azione"
          return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: txt } }
        }
        const txt =
          d.id === 'diretto'
            ? 'Alto di poco: ' + taker.name + ' la spedisce sopra la traversa'
            : d.id === 'cross'
              ? 'Fuorigioco in area: ' + header.name + ' era partito un attimo prima'
              : 'Punizione corta rubata: pericolo chiuso sul limite, ma che spavento'
        return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: txt } }
      }),
    )
    return {
      id,
      kind,
      side: 'for',
      minute,
      prompt: 'Punizione dal limite per il ' + userClub.name + '. Sulla palla ' + taker.name + (spec ? ', Specialista di punizioni' : '') + ': come la vuoi?',
      options,
    }
  }

  if (kind === 'counter') {
    const wallCut = userSquad.some((p) => hasAbility(p, 'muro')) ? 0.08 : 0
    const defender = pickByRole(rng, userSquad, 'DF')
    const mid = pickByRole(rng, userSquad, 'MF')
    const oppScorer = pickScorer(rng, oppSquad)
    const defs = [
      { id: 'fallo', label: 'Fallo tattico', hint: 'Fermalo, accetta il rischio cartellino', prudent: true },
      { id: 'tutti', label: 'Tutti dietro', hint: 'Difendere in inferiorità numerica', prudent: false },
      { id: 'pressing', label: 'Pressing per recuperare', hint: 'Rischio tutto', prudent: false },
    ]
    const options = defs.map((d) =>
      rollOutcome(d.id, (orng) => {
        const roll = orng.float()
        if (d.id === 'fallo') {
          const card = roll < 0.45
          return {
            ...d,
            outcome: {
              goal: 0,
              goalAgainst: 0,
              card,
              playerId: defender.id,
              text: card
                ? 'Fallo tattico di ' + defender.name + ': ammonito! Ma il contropiede muore lì'
                : 'Fallo tattico di ' + defender.name + ': contropiede annientato, solo un colpo di fischietto',
            },
          }
        }
        if (d.id === 'tutti') {
          const concede = roll < 0.36 - wallCut
          return {
            ...d,
            outcome: concede
              ? { goal: 0, goalAgainst: 1, card: false, playerId: oppScorer.id, text: 'Il 3 contro 2 diventa 3 contro 1: ' + oppScorer.name + ' non sbaglia. Dolore' }
              : { goal: 0, goalAgainst: 0, card: false, text: 'Difesa compatta: il contropiede muore tra le linee' },
          }
        }
        if (roll < 0.32) {
          return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: mid.name + ' intercetta con piglio da mastino: che cuore, ripartenza!' } }
        }
        if (roll < 0.87 - wallCut) {
          return { ...d, outcome: { goal: 0, goalAgainst: 1, card: false, playerId: oppScorer.id, text: 'Il pressing fallisce: passaggio filtrante e ' + oppScorer.name + ' insacchina. Beffa' } }
        }
        return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: 'Contrasto roccioso di ' + mid.name + ': rimessa laterale, si respira' } }
      }),
    )
    return {
      id,
      kind,
      side: 'against',
      minute,
      prompt: 'Palla persa a centrocampo: CONTROPIDE avversario, 3 contro 2. Che fai?',
      options,
    }
  }

  if (kind === 'cornerAgainst') {
    const wallFactor = userSquad.some((p) => hasAbility(p, 'muro')) ? 0.7 : 1
    const oppScorer = pickScorer(rng, oppSquad)
    const ourScorer = pickScorer(rng, userSquad)
    const keeper = pickByRole(rng, userSquad, 'GK')
    const defs = [
      { id: 'muro', label: 'Tutti dietro, muro davanti alla porta', hint: 'La scelta prudente', prudent: true, concedeP: 0.09 * wallFactor, penP: 0, counterGoalP: 0 },
      { id: 'uscite', label: 'Uscite aggressive sugli incroci', hint: 'Il portiere va a prendere la palla', prudent: false, concedeP: 0.13 * wallFactor, penP: 0.04 * wallFactor, counterGoalP: 0 },
      { id: 'riparti', label: 'Anticipa e riparti veloce', hint: 'Vinci il primo pallone e vai a chiuderla', prudent: false, concedeP: 0.1 * wallFactor, penP: 0, counterGoalP: 0.16 },
    ]
    const options = defs.map((d) =>
      rollOutcome(d.id, (orng) => {
        const roll = orng.float()
        if (d.counterGoalP && roll < d.counterGoalP) {
          return { ...d, outcome: { goal: 1, goalAgainst: 0, card: false, playerId: ourScorer.id, text: 'GOL! Respinta secca e via in tre: ' + ourScorer.name + ' insacchina la ripartenza che vale la partita' } }
        }
        if (roll < d.counterGoalP + d.penP) {
          return { ...d, outcome: { goal: 0, goalAgainst: 1, card: false, playerId: oppScorer.id, text: 'Fallo in area sul corner: rigore per loro. Dagli undici metri non sbagliano. Dolore' } }
        }
        if (roll < d.counterGoalP + d.penP + d.concedeP) {
          return { ...d, outcome: { goal: 0, goalAgainst: 1, card: false, playerId: oppScorer.id, text: 'Colpo di testa di ' + oppScorer.name + ' dal corner: il risultato salta' } }
        }
        const txt =
          d.id === 'uscite'
            ? keeper.name + ' esce e blocca tutto tra le mani: presa da manuale'
            : d.id === 'riparti'
              ? 'Primo pallone anticipato e respinta lunga: pericolo scampato'
              : 'Respinta rabbiosa dalla linea: nessun danno, si riparte'
        return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: txt } }
      }),
    )
    return {
      id,
      kind,
      side: 'against',
      minute,
      prompt: "Corner per gli avversari al " + minute + "' e il risultato va protetto. Come lo difendi?",
      options,
    }
  }

  // corner (finale a favore)
  const falchi = userSquad.filter((p) => hasAbility(p, 'falco'))
  const header = falchi.length ? rng.pick(falchi) : pickByRole(rng, userSquad, 'DF')
  const hawk = hasAbility(header, 'falco') ? 0.12 : 0
  const oppScorer = pickScorer(rng, oppSquad)
  const defs = [
    { id: 'tutti', label: 'Tutti in area, anche il portiere', hint: 'Il tutto per tutto', prudent: false, goalP: 0.32 + hawk, counterP: 0.12 },
    { id: 'mastini', label: 'Solo i mastini', hint: 'Equilibrio', prudent: true, goalP: 0.24 + hawk, counterP: 0.06 },
    { id: 'corto', label: 'Riparto corto', hint: 'Minimizza il rischio', prudent: false, goalP: 0.15 + hawk, counterP: 0.02 },
  ]
  const options = defs.map((d) =>
    rollOutcome(d.id, (orng) => {
      const roll = orng.float()
      if (roll < d.goalP) {
        return { ...d, outcome: { goal: 1, goalAgainst: 0, card: false, playerId: header.id, text: 'GOL! Cross teso e incornata perfetta di ' + header.name + ": l'area esplode!" } }
      }
      if (roll < d.goalP + d.counterP) {
        return { ...d, outcome: { goal: 0, goalAgainst: 1, card: false, playerId: oppScorer.id, text: 'Corner respinto lungo e contropiede a rete: ' + oppScorer.name + ' insacchina nel silenzio più totale' } }
      }
      return { ...d, outcome: { goal: 0, goalAgainst: 0, card: false, text: 'Corner battuto e respinto: nessun danno, si riparte' } }
    }),
  )
  return {
    id,
    kind: 'corner',
    side: 'for',
    minute,
    prompt: 'Ultima occasione: corner per il ' + userClub.name + " al " + minute + (hawk ? " — e in area sale il Falco aereo " + header.name : "") + "'. Come lo approcci?",
    options,
  }
}
