import { useMemo, useState } from 'react'
import { askingPrice, respondToOffer, aiBidFor, boughtContract } from '../game/market'
import { transferPlayer, loanPlayer, scoutPlayer } from '../db'
import { loanDeal, MAX_LOANS_IN } from '../game/finance'
import { scoutedOvr, SCOUT_REPORT_COST } from '../game/scouting'
import { ABILITIES } from '../game/abilities'
import PlayerCard from './PlayerCard'

const ROLES = ['Tutti', 'GK', 'DF', 'MF', 'FW']
const ROLE_BADGE = { GK: 'P', DF: 'D', MF: 'C', FW: 'A' }
const SORTS = [
  { id: 'ovr', label: 'OVR' },
  { id: 'price', label: 'Prezzo' },
  { id: 'age', label: 'Età' },
]

function fmtMoney(v) {
  if (v >= 1000000) {
    const m = v / 1000000
    const s = m % 1 === 0 ? String(m) : m.toFixed(1).replace('.', ',')
    return '€' + s + 'M'
  }
  return '€' + Math.round(v / 1000) + 'k'
}

function fmtMillions(v) {
  return (v / 1000000).toFixed(2).replace('.', ',') + ' M€'
}

function parseMillions(str) {
  const n = parseFloat(String(str).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function ovrClass(ovr) {
  if (ovr >= 80) return 'bg-flood-400/15 text-flood-300'
  if (ovr >= 70) return 'bg-pitch-700 text-pitch-100'
  return 'bg-pitch-800 text-pitch-300'
}

function Pill({ children, tone }) {
  const cls = tone === 'red' ? 'bg-red-500/10 text-red-300' : 'bg-pitch-800 text-pitch-300'
  return <span className={'rounded px-1.5 py-0.5 text-[10px] font-semibold ' + cls}>{children}</span>
}

function MarketRow({ p, club, asking, injured, onOpen, scouts, scouted }) {
  // Occhi sui Grandi (G4): senza report l'OVR è una lettura a occhio della
  // rete — la tilde è la firma dell'osservatorio, non del giocatore.
  const est = !scouted.has(p.id)
  const ovr = est ? scoutedOvr(p, scouts) : p.ovr
  return (
    <li className="border-b border-pitch-800/60 last:border-0">
      <button onClick={onOpen} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-pitch-800/50">
        <span
          className={'w-8 shrink-0 rounded py-0.5 text-center text-xs font-bold ' + ovrClass(ovr)}
          title={est ? 'Stima dei tuoi osservatori: il report dice la verità' : null}
        >{est ? '~' + ovr : ovr}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-pitch-100">{p.name}</span>
          <span className="block truncate text-[10px] text-pitch-400">{club ? club.name : ''}</span>
        </span>
        {injured ? <Pill tone="red">Infort.</Pill> : null}
        <Pill>{ROLE_BADGE[p.role] || p.role}</Pill>
        <span className="w-7 text-right text-xs text-pitch-300">{p.age}a</span>
        <span className="w-14 text-right text-xs font-semibold text-teal-300">{fmtMoney(asking)}</span>
      </button>
    </li>
  )
}

function SellRow({ p, onOpen, disabled }) {
  return (
    <li className="border-b border-pitch-800/60 last:border-0">
      <button onClick={onOpen} disabled={disabled} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-pitch-800/50 disabled:opacity-50">
        <span className={'w-8 shrink-0 rounded py-0.5 text-center text-xs font-bold ' + ovrClass(p.ovr)}>{p.ovr}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-pitch-100">{p.name}</span>
          <span className="block text-[10px] text-pitch-400">{"Valore " + fmtMoney(p.value)}</span>
        </span>
        <Pill>{ROLE_BADGE[p.role] || p.role}</Pill>
        <span className="w-7 text-right text-xs text-pitch-300">{p.age}a</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-teal-300">Vendi</span>
      </button>
    </li>
  )
}

export default function TransferMarket({ career, userClub, clubs, players, next, onDone }) {
  const [mode, setMode] = useState('buy')
  const [role, setRole] = useState('Tutti')
  const [sort, setSort] = useState('ovr')
  const [query, setQuery] = useState('')
  const [sheet, setSheet] = useState(null)
  const [offerInput, setOfferInput] = useState('')
  const [response, setResponse] = useState(null)
  const [bid, setBid] = useState(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)
  const [loanResult, setLoanResult] = useState(null)
  const [cardOpen, setCardOpen] = useState(false)

  const clubById = useMemo(() => Object.fromEntries(clubs.map((c) => [c.id, c])), [clubs])
  const scouted = useMemo(() => new Set(career.scouted || []), [career.scouted])
  const playersByClub = useMemo(() => {
    const m = {}
    for (const p of players) (m[p.clubId] = m[p.clubId] || []).push(p)
    return m
  }, [players])
  const seniorsByClub = useMemo(() => {
    const m = {}
    for (const entry of Object.entries(playersByClub)) m[entry[0]] = entry[1].filter((p) => !p.youth).length
    return m
  }, [playersByClub])
  const askingById = useMemo(() => {
    const m = {}
    for (const p of players) {
      if (p.youth || p.clubId === userClub.id) continue
      m[p.id] = askingPrice(p, playersByClub[p.clubId] || [], career.season)
    }
    return m
  }, [players, playersByClub, career.season, userClub.id])

  const userSeniors = seniorsByClub[userClub.id] || 0
  const marketWindow = next ? (next.number === 1 ? 'estivo' : next.number === 20 ? 'invernale' : null) : null
  const currentRound = next ? next.number : 39
  const loansIn = players.filter((p) => p.clubId === userClub.id && p.loanFrom && p.loanFrom !== userClub.id).length
  const isBuyDisabled = userSeniors >= 30 || userClub.budget < 0
  const isSellDisabled = userSeniors <= 16

  const buyList = useMemo(() => {
    let list = players.filter((p) => p.clubId !== userClub.id && !p.youth)
    if (role !== 'Tutti') list = list.filter((p) => p.role === role)
    const q = query.trim().toLowerCase()
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q))
    const keyOf = (p) => (sort === 'ovr' ? (scouted.has(p.id) ? p.ovr : scoutedOvr(p, career.scouts)) : sort === 'price' ? askingById[p.id] || 0 : -p.age)
    return list.slice().sort((a, b) => keyOf(b) - keyOf(a)).slice(0, 60)
  }, [players, userClub.id, role, query, sort, askingById, scouted, career.scouts])

  const sellList = useMemo(
    () => players.filter((p) => p.clubId === userClub.id && !p.youth).slice().sort((a, b) => b.ovr - a.ovr),
    [players, userClub.id],
  )

  function closeSheet() {
    setSheet(null)
    setResponse(null)
    setBid(null)
    setOfferInput('')
    setLoanResult(null)
    setCardOpen(false)
  }

  function openBuy(p) {
    setMode('buy')
    setSheet(p)
    setOfferInput(((askingById[p.id] || 0) / 1000000).toFixed(2).replace('.', ','))
    setResponse(null)
    setBid(null)
    setLoanResult(null)
  }

  function openSell(p) {
    setMode('sell')
    setSheet(p)
    setBid(null)
    setResponse(null)
  }

  function propose() {
    if (!sheet) return
    const offer = Math.round(parseMillions(offerInput) * 1000000)
    const asking = askingById[sheet.id] || 0
    setResponse(respondToOffer(offer, asking, seniorsByClub[sheet.clubId] || 0))
  }

  async function completeBuy(fee) {
    if (!sheet || busy) return
    setBusy(true)
    try {
      const contractUntil = boughtContract(career.seed, career.season, sheet)
      await transferPlayer(career.id, sheet.key, clubById[sheet.clubId].key, userClub.key, fee, contractUntil)
      setNotice({ ok: true, text: 'Acquisto chiuso: ' + sheet.name + ' per ' + fmtMillions(fee) + '.' })
      closeSheet()
      await onDone()
    } catch (err) {
      setResponse({ status: 'rejected', message: 'Non se ne fa nulla: ' + (err && err.message ? err.message : 'errore') })
    } finally {
      setBusy(false)
    }
  }

  /** Occhi sui Grandi (G4): si manda la rete su un uomo solo. La verità
   *  si paga una volta e non si scorda più — il foglio resta aperto, che
   *  la si legga subito è il minimo, considerando il prezzo. */
  async function scout() {
    if (!sheet || busy) return
    setBusy(true)
    try {
      await scoutPlayer(career.id, sheet.id)
      setNotice({ ok: true, text: 'Report nel cassetto: ' + sheet.name + ' letto per bene — OVR, attributi e abilità, la verità.' })
      await onDone()
    } catch (err) {
      setNotice({ ok: false, text: 'Niente report: ' + (err && err.message ? err.message : 'errore') })
    } finally {
      setBusy(false)
    }
  }

  function askLoan() {
    if (!sheet) return
    const ownerSquad = playersByClub[sheet.clubId] || []
    setLoanResult(loanDeal(career.seed, career.season, sheet, ownerSquad))
  }

  async function completeLoan() {
    if (!sheet || !loanResult || !loanResult.ok || busy) return
    setBusy(true)
    try {
      await loanPlayer(career.id, sheet.key, clubById[sheet.clubId].key, userClub.key, loanResult.fee)
      setNotice({ ok: true, text: 'Prestito chiuso: ' + sheet.name + ' arriva fino a fine stagione. Trattalo bene, non è tuo.' })
      closeSheet()
      await onDone()
    } catch (err) {
      setNotice({ ok: false, text: 'Prestito fallito: ' + (err && err.message ? err.message : 'errore') })
    } finally {
      setBusy(false)
    }
  }

  function askBid() {
    if (!sheet) return
    const buyerClubs = clubs.filter((c) => c.id !== userClub.id)
    const b = aiBidFor(career.seed, career.season, sheet, buyerClubs, playersByClub)
    setBid(b || 'none')
  }

  async function acceptBid() {
    if (!sheet || !bid || bid === 'none' || busy) return
    setBusy(true)
    try {
      await transferPlayer(career.id, sheet.key, userClub.key, bid.club.key, bid.fee, boughtContract(career.seed, career.season, sheet))
      setNotice({ ok: true, text: sheet.name + ' lascia il club: ' + fmtMillions(bid.fee) + ' da ' + bid.club.name + '.' })
      closeSheet()
      await onDone()
    } catch (err) {
      setNotice({ ok: false, text: 'Vendita fallita: ' + (err && err.message ? err.message : 'errore') })
    } finally {
      setBusy(false)
    }
  }

  const sheetClub = sheet ? clubById[sheet.clubId] : null
  const offerValue = Math.round(parseMillions(offerInput) * 1000000)
  const overBudget = offerValue > userClub.budget

  if (!marketWindow) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <div className="rounded-2xl border border-pitch-700 bg-pitch-900 p-6 text-center">
          <p className="scoreboard text-lg font-semibold tracking-wider text-pitch-100">Mercato chiuso</p>
          <p className="mt-2 text-sm leading-relaxed text-pitch-400">
            Si riapre in estate, prima della giornata 1, e d'inverno, tra la 19ª e la 20ª.
            Il calcio ai liquori si beve solo a finestre aperte.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-md space-y-3">
      {notice ? (
        <div className={'flex items-start justify-between gap-2 rounded-xl border p-3 text-sm ' + (notice.ok ? 'border-teal-400/30 bg-teal-400/10 text-teal-200' : 'border-red-400/30 bg-red-400/10 text-red-200')}>
          <span>{notice.text}</span>
          <button onClick={() => setNotice(null)} className="shrink-0 text-pitch-400 hover:text-pitch-200">✕</button>
        </div>
      ) : null}

      <div className="rounded-2xl border border-teal-400/30 bg-teal-400/5 p-3">
        <p className="text-sm font-semibold text-teal-200">
          Mercato {marketWindow} aperto: si chiude giocando la giornata {next.number}.
        </p>
        <p className="mt-1 text-xs text-pitch-300">
          Cassa: <span className="font-semibold text-teal-300">{fmtMoney(userClub.budget)}</span>
          {' · '}Rosa: {userSeniors}/30 senior
        </p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setMode('buy')}
          className={'flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ' + (mode === 'buy' ? 'border-teal-400/50 bg-teal-400/10 text-teal-200' : 'border-pitch-700 bg-pitch-900 text-pitch-300')}
        >Compra</button>
        <button
          onClick={() => setMode('sell')}
          className={'flex-1 rounded-xl border px-3 py-2 text-sm font-semibold ' + (mode === 'sell' ? 'border-teal-400/50 bg-teal-400/10 text-teal-200' : 'border-pitch-700 bg-pitch-900 text-pitch-300')}
        >Vendi</button>
      </div>

      {mode === 'buy' ? (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {ROLES.map((r) => (
              <button
                key={r}
                onClick={() => setRole(r)}
                className={'rounded-lg px-2.5 py-1 text-xs font-semibold ' + (role === r ? 'bg-teal-400/15 text-teal-200' : 'bg-pitch-800 text-pitch-400')}
              >{r === 'Tutti' ? 'Tutti' : ROLE_BADGE[r]}</button>
            ))}
            <span className="flex-1" />
            {SORTS.map((s) => (
              <button
                key={s.id}
                onClick={() => setSort(s.id)}
                className={'rounded-lg px-2.5 py-1 text-xs ' + (sort === s.id ? 'bg-pitch-700 text-pitch-100' : 'bg-pitch-800 text-pitch-400')}
              >{s.label}</button>
            ))}
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca un nome..."
            className="w-full rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2 text-sm text-pitch-100 transition placeholder:text-pitch-500 focus:border-flood-400 focus:outline-none focus:shadow-[0_0_16px_rgba(239,191,78,0.15)]"
          />
          {isBuyDisabled ? (
            <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              {userClub.budget < 0
                ? 'Mercato bloccato dalla Federazione: la cassa è in rosso. Vendi, o aspetta gli incassi delle giornate.'
                : 'Rosa completa: 30 senior. Prima di comprare, vendi qualcuno.'}
            </p>
          ) : null}
          <ul className="overflow-hidden rounded-2xl border border-pitch-700 bg-pitch-900">
            {buyList.map((p) => (
              <MarketRow
                key={p.id}
                p={p}
                scouts={career.scouts}
                scouted={scouted}
                club={clubById[p.clubId]}
                asking={askingById[p.id] || 0}
                injured={!!p.injuredUntil && p.injuredUntil >= currentRound}
                onOpen={() => openBuy(p)}
              />
            ))}
            {buyList.length === 0 ? (
              <li className="p-4 text-center text-sm text-pitch-400">Nessun giocatore con questi filtri.</li>
            ) : null}
          </ul>
          <p className="text-center text-[10px] text-pitch-500">Prime 60 richieste per ordinamento. La Primavera non si tocca: cresce in silenzio.</p>
        </>
      ) : (
        <>
          {isSellDisabled ? (
            <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
              Rosa al limite: 16 senior esatti. Vendi solo dopo aver rafforzato.
            </p>
          ) : null}
          <ul className="overflow-hidden rounded-2xl border border-pitch-700 bg-pitch-900">
            {sellList.map((p) => (
              <SellRow key={p.id} p={p} onOpen={() => openSell(p)} disabled={isSellDisabled || !!p.loanFrom} />
            ))}
          </ul>
          <p className="text-center text-[10px] text-pitch-500">Le offerte arrivano dai club AI a cui manca proprio quel ruolo. Niente regali.</p>
        </>
      )}

      {sheet ? (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-pitch-950/80 p-3 sm:items-center" onClick={closeSheet}>
          <div className="animate-fade-up w-full max-w-md space-y-3 rounded-2xl border border-pitch-700 bg-pitch-900 p-4 shadow-[0_0_40px_rgba(239,191,78,0.06),0_10px_40px_rgba(0,0,0,0.5)]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="scoreboard truncate text-lg font-semibold">{sheet.name}</p>
                <p className="text-xs text-pitch-400">{sheetClub ? sheetClub.name : userClub.name}</p>
              </div>
              <button onClick={closeSheet} className="text-pitch-400 hover:text-pitch-200">✕</button>
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-pitch-800 py-2">
                <p className="text-[10px] uppercase tracking-wide text-pitch-400">Ruolo</p>
                <p className="text-sm font-bold text-pitch-100">{ROLE_BADGE[sheet.role] || sheet.role}</p>
              </div>
              <div className="rounded-xl bg-pitch-800 py-2">
                <p className="text-[10px] uppercase tracking-wide text-pitch-400">Età</p>
                <p className="text-sm font-bold text-pitch-100">{sheet.age}</p>
              </div>
              <div className="rounded-xl bg-pitch-800 py-2">
                <p className="text-[10px] uppercase tracking-wide text-pitch-400">{mode === 'buy' && !scouted.has(sheet.id) ? 'OVR stimato' : 'OVR'}</p>
                <p className="text-sm font-bold text-flood-300">{mode === 'buy' && !scouted.has(sheet.id) ? '~' + scoutedOvr(sheet, career.scouts) : sheet.ovr}</p>
              </div>
            </div>
            <button
              onClick={() => setCardOpen(true)}
              className="w-full rounded-xl border border-pitch-600 px-3 py-2 text-xs font-semibold text-pitch-300 transition hover:border-teal-400 hover:text-teal-200"
            >Apri la scheda{mode === 'buy' && !scouted.has(sheet.id) ? ' — lettura a occhio' : ''}</button>

            {mode === 'buy' ? (
              <div className="space-y-3">
                {mode === 'buy' && !scouted.has(sheet.id) ? (
                  <p className="text-xs text-pitch-400">✦ Abilità: da scoprire — le carte le mostra solo il report.</p>
                ) : Array.isArray(sheet.abilities) && sheet.abilities.length > 0 ? (
                  <p className="text-xs text-flood-300">
                    ✦ Abilità: {sheet.abilities.map((id) => (ABILITIES[id] ? ABILITIES[id].name : id)).join(' · ')}
                  </p>
                ) : null}
                {mode === 'buy' ? (
                  scouted.has(sheet.id) ? (
                    <p className="rounded-xl border border-teal-400/30 bg-teal-400/10 px-3 py-2 text-xs text-teal-200">
                      Report nel cassetto: quello che leggi è la verità, e non si scorda più.
                    </p>
                  ) : (
                    <button
                      onClick={scout}
                      disabled={busy || userClub.budget < SCOUT_REPORT_COST}
                      className="w-full rounded-xl border border-flood-400/40 px-3 py-2 text-xs font-semibold text-flood-300 transition hover:bg-flood-400/10 disabled:opacity-40"
                    >Manda gli osservatori · report {fmtMoney(SCOUT_REPORT_COST)}</button>
                  )
                ) : null}
                <p className="text-sm text-pitch-300">
                  Prezzo richiesto: <span className="font-bold text-teal-300">{fmtMillions(askingById[sheet.id] || 0)}</span>
                  {' · '}Stipendio: {fmtMoney(sheet.wage || 0)}/stagione
                </p>
                {!isBuyDisabled && !sheet.loanFrom && loansIn < MAX_LOANS_IN ? (
                  !loanResult ? (
                    <button
                      onClick={askLoan}
                      disabled={busy}
                      className="w-full rounded-xl border border-pitch-600 px-3 py-2 text-sm font-semibold text-pitch-200 transition hover:border-teal-400"
                    >Chiedi il prestito secco (torna a fine stagione)</button>
                  ) : loanResult.ok ? (
                    <div className="flex gap-2">
                      <button
                        onClick={completeLoan}
                        disabled={busy || loanResult.fee > userClub.budget}
                        className="flex-1 rounded-xl bg-teal-400 px-3 py-2.5 text-sm font-bold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98] disabled:opacity-40"
                      >Conferma il prestito · {fmtMillions(loanResult.fee)}</button>
                      <button onClick={() => setLoanResult(null)} className="flex-1 rounded-xl border border-pitch-700 px-3 py-2.5 text-sm font-semibold text-pitch-300">Annulla</button>
                    </div>
                  ) : (
                    <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{loanResult.reason}</p>
                  )
                ) : null}
                {isBuyDisabled ? (
                  <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
                    Rosa completa: prima di comprare, vendi.
                  </p>
                ) : (
                  <>
                    <label className="block text-xs text-pitch-400">La tua offerta, in milioni (0,01 M€ = 10.000 €)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={offerInput}
                      onChange={(e) => { setOfferInput(e.target.value); setResponse(null) }}
                      className="w-full rounded-xl border border-pitch-700 bg-pitch-950 px-3 py-2 text-sm text-pitch-100 transition focus:border-flood-400 focus:outline-none focus:shadow-[0_0_16px_rgba(239,191,78,0.15)]"
                    />
                    {overBudget ? (
                      <p className="text-xs text-red-300">Sfori il budget: hai {fmtMillions(userClub.budget)}.</p>
                    ) : null}

                    {!response ? (
                      <button
                        onClick={propose}
                        disabled={busy || offerValue <= 0 || overBudget}
                        className="w-full rounded-xl bg-teal-400 px-3 py-2.5 text-sm font-bold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98] disabled:opacity-40"
                      >Proponi l'offerta</button>
                    ) : null}

                    {response && response.status === 'accepted' ? (
                      <div className="space-y-2">
                        <p className="rounded-xl border border-teal-400/30 bg-teal-400/10 p-3 text-sm text-teal-200">
                          Accettata: stringono la mano, ora paga.
                        </p>
                        <button
                          onClick={() => completeBuy(response.fee)}
                          disabled={busy}
                          className="w-full rounded-xl bg-teal-400 px-3 py-2.5 text-sm font-bold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98] disabled:opacity-40"
                        >Completa l'acquisto · {fmtMillions(response.fee)}</button>
                      </div>
                    ) : null}

                    {response && response.status === 'counter' ? (
                      <div className="space-y-2">
                        <p className="rounded-xl border border-pitch-600 bg-pitch-800 p-3 text-sm text-pitch-200">
                          {'Non si muove di un centesimo: ' + fmtMillions(response.counter) + ' e non se ne parla.'}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => completeBuy(response.counter)}
                            disabled={busy || response.counter > userClub.budget}
                            className="flex-1 rounded-xl bg-teal-400 px-3 py-2.5 text-sm font-bold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98] disabled:opacity-40"
                          >{'Paga ' + fmtMillions(response.counter)}</button>
                          <button onClick={closeSheet} className="flex-1 rounded-xl border border-pitch-700 px-3 py-2.5 text-sm font-semibold text-pitch-300">Ritirati</button>
                        </div>
                      </div>
                    ) : null}

                    {response && response.status === 'rejected' ? (
                      <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
                        {response.message} Puoi rilanciare, se il portafoglio regge.
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-pitch-300">
                  Valore di mercato: <span className="font-bold text-teal-300">{fmtMillions(sheet.value)}</span>
                </p>
                {sheet.loanFrom ? (
                  <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
                    In prestito: la roba degli altri non si vende. A fine stagione torna al suo club.
                  </p>
                ) : isSellDisabled ? (
                  <p className="rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">
                    Rosa al limite: 16 senior. Vendi solo dopo aver comprato.
                  </p>
                ) : !bid ? (
                  <button
                    onClick={askBid}
                    disabled={busy}
                    className="w-full rounded-xl bg-teal-400 px-3 py-2.5 text-sm font-bold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98] disabled:opacity-40"
                  >Chiedi offerte al mercato</button>
                ) : bid === 'none' ? (
                  <div className="space-y-2">
                    <p className="rounded-xl border border-pitch-600 bg-pitch-800 p-3 text-sm text-pitch-200">
                      Nessuno interessato: o non serve a nessuno, o i budget della lega sono polvere.
                    </p>
                    <button onClick={closeSheet} className="w-full rounded-xl border border-pitch-700 px-3 py-2.5 text-sm font-semibold text-pitch-300">Chiudi</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="rounded-xl border border-teal-400/30 bg-teal-400/10 p-3 text-sm text-teal-200">
                      {bid.club.name + ' offre ' + fmtMillions(bid.fee) + '.'}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={acceptBid}
                        disabled={busy}
                        className="flex-1 rounded-xl bg-teal-400 px-3 py-2.5 text-sm font-bold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98] disabled:opacity-40"
                      >Accetta l'offerta</button>
                      <button onClick={() => setBid(null)} className="flex-1 rounded-xl border border-pitch-700 px-3 py-2.5 text-sm font-semibold text-pitch-300">Declina</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : null}
      {cardOpen && sheet ? (
        <PlayerCard
          player={sheet}
          scouts={career.scouts}
          round={currentRound}
          reveal={mode === 'sell' || scouted.has(sheet.id)}
          onClose={() => setCardOpen(false)}
        />
      ) : null}
    </div>
  )
}
