import { useEffect, useState } from 'react'
import { registerServiceWorker } from '../pwa'

/** Banner PWA: aggiornamento controllato (mai skipWaiting silenzioso),
 * installazione da beforeinstallprompt, suggerimento iOS/iPadOS una volta sola. */
export default function PwaBanner() {
  const [updateReady, setUpdateReady] = useState(false)
  const [installEvent, setInstallEvent] = useState(null)
  const [showIosHint, setShowIosHint] = useState(false)

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true

    registerServiceWorker(() => setUpdateReady(true))

    const onBeforeInstall = (e) => {
      e.preventDefault()
      if (!standalone) setInstallEvent(e)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    const ios =
      /iphone|ipad|ipod/i.test(window.navigator.userAgent) ||
      (window.navigator.maxTouchPoints > 1 && /macintosh/i.test(window.navigator.userAgent))
    if (ios && !standalone && !window.localStorage.getItem('pitchtory-ios-hint')) {
      setShowIosHint(true)
      window.localStorage.setItem('pitchtory-ios-hint', '1')
    }

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  function handleUpdate() {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.waiting) reg.waiting.postMessage('skip-waiting')
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true })
  }

  async function handleInstall() {
    if (!installEvent) return
    installEvent.prompt()
    const { outcome } = await installEvent.userChoice
    if (outcome === 'accepted') setInstallEvent(null)
  }

  if (!updateReady && !installEvent && !showIosHint) return null

  return (
    <div className="animate-fade-up fixed inset-x-3 top-3 z-[70] mx-auto max-w-md rounded-xl border border-flood-400/50 bg-pitch-900/95 p-3 shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur">
      {updateReady && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-pitch-100">
            C'è una versione nuova di Pitchtory, come un gennaio di mercato.
          </p>
          <button
            onClick={handleUpdate}
            className="shrink-0 rounded-lg bg-teal-500 px-3 py-1.5 text-xs font-bold text-pitch-950 transition hover:bg-teal-400 active:scale-[0.98]"
          >
            Aggiorna
          </button>
        </div>
      )}
      {!updateReady && installEvent && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-pitch-100">Installa Pitchtory: la carriera sul telefono, anche offline.</p>
          <button
            onClick={handleInstall}
            className="shrink-0 rounded-lg bg-flood-400 px-3 py-1.5 text-xs font-bold text-pitch-950 transition hover:bg-flood-300 active:scale-[0.98]"
          >
            Installa
          </button>
        </div>
      )}
      {!updateReady && !installEvent && showIosHint && (
        <p className="text-xs text-pitch-200">
          iPhone/iPad: per installare, <b>Condividi</b> → <b>Aggiungi a Home</b>. La carriera vive sul dispositivo, come sempre.
        </p>
      )}
    </div>
  )
}
