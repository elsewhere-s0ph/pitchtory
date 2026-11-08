import { useEffect, useState } from 'react'
import { listCareers, deleteCareer, importCareer, db } from '../db'
import crest from '../assets/crest.svg'
import pkg from '../../package.json'

const DURATIONS = {
  short: 'Compressa (1-2 min)',
  normal: 'Rilassata (5-6 min)',
  long: 'Cronaca estesa (7-8 min)',
}

/** La guida della casa: ironia consentita, retorica no. */
const HELP_TABS = [
  {
    id: 'gioco',
    label: 'Il gioco',
    body: [
      "Pitchtory è un football manager da tasca: una lega fittizia, due serie, una coppa e trentotto giornate da cardiologo. Nessun account, nessun server: la carriera vive sul tuo dispositivo e non chiede il permesso a nessuno.",
      "Ogni carriera nasce da un seed: stesso seed, stesso universo, stesso futuro. Condividilo e chi vuoi giocherà il tuo stesso mondo — le discussioni su chi lo interpreta meglio restano affare vostro.",
      "Si vince facendo punti e alzando trofei. Si sopravvive facendo quadrare i conti. Il resto è cronaca.",
    ],
  },
  {
    id: 'partite',
    label: 'Partite & QTE',
    body: [
      "Le tue partite si giocano in diretta, minuto per minuto, alla velocità che scegli: compressa, rilassata o cronaca estesa. Il salto al risultato esiste, ma sappi che ti perdi i momenti belli.",
      "Nei momenti che contano arrivano i QTE: rigori, uno contro uno, punizioni, corner della verità. Tre opzioni, dieci secondi: allo scadere sceglie il mister prudente che è in te. Gli esiti sono precomputati nel seed — ricaricare non cambia niente, e questo è il patto.",
      "Massimo tre cambi a partita. La mentalità si cambia col punteggio in mano, e quando qualcuno si infortuna il pannello cambi si apre da solo: entri tu, o lascia scegliere allo staff.",
    ],
  },
  {
    id: 'lavagnetta',
    label: 'Lavagnetta',
    body: [
      "La forza non è una media: è l'undici che scende in campo. Sei moduli con slot per ruolo, e chi gioca fuori posizione rende come un idraulico alle prese con un obelisco.",
      "Mentalità, pressing e linea difensiva muovono i gol attesi: la barricata toglie occasioni, il pressing aggressivo brucia condizione e ammonizioni. L'undici lo scrivi tu, slot per slot — lo staff sistema solo chi manca all'appello.",
    ],
  },
  {
    id: 'mercato',
    label: 'Mercato & cassa',
    body: [
      "Il mercato apre due volte l'anno: estate e infrasettimana d'inverno. Ogni club ha il suo prezzo e ogni offerta una risposta: sotto l'ottanta per cento del richiesto, nemmeno alzano la cornetta.",
      "I prestiti sono secchi: chiedi, paghi una fee, e a fine stagione il giocatore torna a casa sua. La roba degli altri non si vende.",
      "La cassa respira a ogni giornata: biglietti a chi ospita, sponsor e stipendi a tutti. Gli stipendi sono a stagione, in trentotto rate; lo sponsor si firma a inizio stagione — base alla firma, bonus solo se l'obiettivo arriva.",
    ],
  },
  {
    id: 'piramide',
    label: 'Piramide & Coppa',
    body: [
      "Due serie: Divisione d'Onore e Campionato dell'Abnegazione. Due salgono, due scendono, e il blasone segue la direzione.",
      "La Coppa Nazionale Trofeo Bellandi la giocano in sedici: quattro turni infrasettimanali, niente pari. Ai rigori si decidono le cose — e i rigori li giochi tu, QTE dal dischetto.",
      "Squalifiche per tutti: espulsione, una giornata di stop; quinta ammonizione, una giornata e il contatore riparte.",
    ],
  },
  {
    id: 'faq',
    label: 'FAQ',
    qa: [
      { q: 'Posso giocare offline?', a: 'Sì: installata la PWA (banner Aggiorna e Installa, su iPhone e iPad Condividi → Aggiungi a Home), il gioco parte anche senza rete.' },
      { q: 'Dove finiscono i miei dati?', a: 'Nel database del tuo browser (IndexedDB). Nessun cloud, nessun account: fate amicizia.' },
      { q: 'E se pulisco la cache?', a: 'Le carriere se ne vanno con lei. Esportale da Opzioni prima dei lavori: il file JSON si riporta su qualsiasi dispositivo.' },
      { q: 'Posso cambiare club a metà carriera?', a: 'Sì: le panchine scottano in corsa. Un club che esonera il suo mister può chiamarti — e dal tab Panchina puoi candidarti tu alle panchine libere. Occhio però: anche la tua sedia può traballare, se i risultati non arrivano.' },
      { q: 'Possono esistere due mondi uguali?', a: 'Sì, con lo stesso seed. Il seed è il tuo angolo di universo: custodiscilo.' },
      { q: 'Perché la versione cambia?', a: 'Ogni tappa della roadmap diventa una build. In Opzioni leggi la versione: è il modo più rapido di sapere che cosa sta girando.' },
    ],
  },
]

/** Riga di una carriera salvata: entra, o chiudi i conti. */
function CareerRow({ c, onEnter, onDelete }) {
  return (
    <li className="flex items-center gap-2 rounded-lg border border-slate-700 bg-pitch-900/40 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-200">{c.clubName || 'Carriera senza nome'}</p>
        <p className="text-xs text-slate-400">Stagione {c.season} · mister {c.coachName}</p>
      </div>
      <button onClick={() => onEnter(c)} className="shrink-0 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-semibold text-pitch-950 hover:bg-teal-400">Entra</button>
      <button onClick={() => onDelete(c)} className="shrink-0 rounded-lg border border-red-500/50 px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10">Elimina</button>
    </li>
  )
}

/** Home: lo stadio di notte, prima del fischio d'inizio. */
export default function HomeScreen({ onStart, onNewCareer }) {
  const [careers, setCareers] = useState(null)
  const [panel, setPanel] = useState(null)
  const [helpTab, setHelpTab] = useState('gioco')
  const [notice, setNotice] = useState(null)
  const [defaultDuration, setDefaultDuration] = useState('normal')

  useEffect(() => {
    let alive = true
    listCareers()
      .then(async (list) => {
        const enriched = await Promise.all(list.map(async (c) => {
          let clubName = null
          try {
            const clubs = await db.clubs.where('careerId').equals(c.id).toArray()
            const club = clubs.find((x) => x.id === c.clubId)
            if (club) clubName = club.name
          } catch (err) { clubName = null }
          return { ...c, clubName }
        }))
        enriched.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || (b.id - a.id))
        if (alive) setCareers(enriched)
      })
      .catch(() => { if (alive) setCareers([]) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const v = window.localStorage.getItem('pitchtory-default-duration')
    if (v === 'short' || v === 'long' || v === 'normal') setDefaultDuration(v)
  }, [])

  async function handleImport(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      const id = await importCareer(await file.text())
      onStart(id)
    } catch (err) {
      setNotice({ ok: false, text: 'Import fallito: ' + (err && err.message ? err.message : 'errore') })
    }
    e.target.value = ''
  }

  async function handleDeleteCareer(c) {
    const label = c.clubName || 'questa carriera'
    if (!window.confirm('Eliminare definitivamente ' + label + '?')) return
    await deleteCareer(c.id)
    setNotice({ ok: true, text: 'Carriera eliminata. Il campo resta, i ricordi pure.' })
    const list = await listCareers()
    const enriched = await Promise.all(list.map(async (x) => {
      let clubName = null
      try {
        const clubs = await db.clubs.where('careerId').equals(x.id).toArray()
        const club = clubs.find((y) => y.id === x.clubId)
        if (club) clubName = club.name
      } catch (err) { clubName = null }
      return { ...x, clubName }
    }))
    enriched.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || (b.id - a.id))
    setCareers(enriched)
  }

  function enterCareer(c) {
    setPanel(null)
    onStart(c.id)
  }

  function changeDefaultDuration(v) {
    setDefaultDuration(v)
    try { window.localStorage.setItem('pitchtory-default-duration', v) } catch (err) { /* il browser decide */ }
  }

  if (!careers) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-pitch-950">
        <p className="scoreboard text-2xl text-flood-400">Pitchtory</p>
        <p className="animate-urgent text-[10px] uppercase tracking-[0.35em] text-slate-500">Si entra in campo…</p>
      </main>
    )
  }

  const last = careers[0]
  const activeHelp = HELP_TABS.find((t) => t.id === helpTab) || HELP_TABS[0]
  const trophiesLabel = (c) => (Array.isArray(c.trophies) && c.trophies.length ? ' · ' + c.trophies.length + (c.trophies.length === 1 ? ' trofeo' : ' trofei') : '')

  return (
    <main className="relative min-h-screen overflow-hidden bg-pitch-950 text-slate-100">
      <div className="pointer-events-none absolute -top-28 left-1/2 h-64 w-[30rem] -translate-x-1/2 rounded-full bg-flood-400/10 blur-3xl" />
      <div className="relative mx-auto max-w-md px-4 pb-10 pt-10 sm:pt-16">
        <header className="text-center">
          <img src={crest} alt="Stemma di Pitchtory" className="mx-auto h-36 w-36 drop-shadow-[0_0_28px_rgba(239,191,78,0.25)]" />
          <h1 className="scoreboard mt-3 text-4xl font-semibold tracking-wide text-flood-300">Pitchtory</h1>
          <p className="text-[10px] uppercase tracking-[0.35em] text-flood-400">Build your own legacy</p>
          <p className="mt-2 text-sm text-slate-400">Il football manager da tasca, tutto sul tuo dispositivo.</p>
        </header>

        <div className="mt-8 space-y-3">
          {last ? (
            <button
              onClick={() => enterCareer(last)}
              className="w-full rounded-xl border border-teal-500/50 bg-teal-500/10 p-4 text-left transition hover:border-teal-400 hover:shadow-[0_0_24px_rgba(47,181,110,0.2)] active:scale-[0.99]"
            >
              <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-teal-300">Continua</p>
              <p className="scoreboard mt-1 text-lg font-semibold">{last.clubName || 'La tua carriera'}</p>
              <p className="text-xs text-slate-400">Stagione {last.season} · mister {last.coachName}{trophiesLabel(last)}</p>
            </button>
          ) : (
            <p className="rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-4 text-center text-sm text-slate-400">
              Nessuna carriera sul device. Il campo è tutto tuo.
            </p>
          )}

          {last ? (
            <div className="grid grid-cols-2 gap-3">
              <button onClick={onNewCareer} className="rounded-xl border border-pitch-600 px-4 py-2.5 text-sm font-semibold text-pitch-200 transition hover:border-teal-400">Nuova carriera</button>
              <label className="cursor-pointer rounded-xl border border-pitch-600 px-4 py-2.5 text-center text-sm font-semibold text-pitch-200 transition hover:border-teal-400">
                Importa carriera
                <input type="file" accept="application/json" className="hidden" onChange={handleImport} />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <button
                onClick={onNewCareer}
                className="w-full rounded-xl bg-teal-500 px-4 py-3 text-sm font-semibold text-pitch-950 shadow-[0_0_20px_rgba(47,181,110,0.25)] transition hover:bg-teal-400 hover:shadow-[0_0_28px_rgba(47,181,110,0.35)] active:scale-[0.98]"
              >Nuova carriera</button>
              <label className="block w-full cursor-pointer rounded-xl border border-pitch-600 px-4 py-2.5 text-center text-sm font-semibold text-pitch-200 transition hover:border-teal-400">
                Importa carriera
                <input type="file" accept="application/json" className="hidden" onChange={handleImport} />
              </label>
            </div>
          )}

          {last && (
            <button onClick={() => setPanel('careers')} className="w-full text-center text-[11px] text-slate-400 hover:text-slate-200">
              Cambia carriera — {careers.length} {careers.length === 1 ? 'salvata' : 'salvate'}
            </button>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button onClick={() => setPanel('help')} className="rounded-xl border border-pitch-600 px-4 py-2.5 text-sm font-semibold text-pitch-200 transition hover:border-flood-400">Aiuto &amp; FAQ</button>
            <button onClick={() => setPanel('settings')} className="rounded-xl border border-pitch-600 px-4 py-2.5 text-sm font-semibold text-pitch-200 transition hover:border-flood-400">Impostazioni</button>
          </div>

          {notice && (
            <p className={'rounded-xl border p-3 text-sm ' + (notice.ok ? 'border-teal-500/40 bg-teal-500/10 text-teal-200' : 'border-red-400/30 bg-red-400/10 text-red-200')}>
              {notice.text}
            </p>
          )}
        </div>

        <footer className="mt-10 text-center text-[10px] leading-relaxed text-slate-500">
          <p>Pitchtory v{pkg.version} · Little Elsewhere</p>
          <p className="mt-1">Nessun account, nessun server: la carriera vive qui.</p>
        </footer>
      </div>

      {panel && (
        <div className="fixed inset-0 z-20 overflow-y-auto bg-pitch-950/95 p-4 backdrop-blur-sm sm:p-8">
          <div className="mx-auto max-w-md animate-fade-up space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="scoreboard text-lg font-semibold text-flood-300">
                {panel === 'help' ? 'Aiuto & FAQ' : panel === 'settings' ? 'Impostazioni' : 'Le tue carriere'}
              </h2>
              <button onClick={() => setPanel(null)} className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-teal-500">Chiudi</button>
            </div>

            {panel === 'help' && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {HELP_TABS.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setHelpTab(t.id)}
                      className={'rounded-lg px-2.5 py-1 text-xs font-semibold ' + (helpTab === t.id ? 'bg-teal-400/15 text-teal-200' : 'bg-slate-800 text-slate-400')}
                    >{t.label}</button>
                  ))}
                </div>
                <div className="rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-4 text-sm leading-relaxed text-slate-300">
                  {activeHelp.body && activeHelp.body.map((p, i) => (
                    <p key={i} className={i ? 'mt-3' : ''}>{p}</p>
                  ))}
                  {activeHelp.qa && activeHelp.qa.map((x, i) => (
                    <div key={i} className={i ? 'mt-3' : ''}>
                      <p className="font-semibold text-slate-200">{x.q}</p>
                      <p className="mt-1 text-slate-400">{x.a}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {panel === 'careers' && (
              <div className="rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-4">
                {careers.length ? (
                  <ul className="space-y-2">
                    {careers.map((c) => (
                      <CareerRow key={c.id} c={c} onEnter={enterCareer} onDelete={handleDeleteCareer} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-slate-500">Nessuna carriera: il campo è libero.</p>
                )}
                <p className="mt-3 text-[11px] text-slate-500">L’ultima giocata resta in cima alla lista, come i ricordi.</p>
              </div>
            )}

            {panel === 'settings' && (
              <>
                <div className="rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Durata partita predefinita</h3>
                  <select
                    value={defaultDuration}
                    onChange={(e) => changeDefaultDuration(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm focus:border-flood-400 focus:outline-none"
                  >
                    {Object.entries(DURATIONS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                  <p className="mt-2 text-[11px] text-slate-500">Vale per le nuove carriere. Quella in corso si cambia dal tab Opzioni, come sempre.</p>
                </div>
                <div className="rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Le tue carriere</h3>
                  {careers.length ? (
                    <ul className="space-y-2">
                      {careers.map((c) => (
                        <CareerRow key={c.id} c={c} onEnter={enterCareer} onDelete={handleDeleteCareer} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-slate-500">Nessuna: il campo è libero.</p>
                  )}
                </div>
                <div className="rounded-xl border border-pitch-700/60 bg-pitch-900/50 p-4">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Installa la PWA</h3>
                  <p className="text-xs leading-relaxed text-slate-400">
                    Il banner in alto propone Aggiorna e Installa quando il browser lo permette. Su iPhone e iPad si installa da Condividi → Aggiungi a Home: una volta sul telefono, funziona anche senza rete.
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  )
}
