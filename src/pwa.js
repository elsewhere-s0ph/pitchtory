/** Registrazione del service worker, solo in build (mai in dev).
 * Aggiornamento controllato: quando arriva una versione nuova lo segnaliamo
 * alla UI, che mostra il banner Aggiorna — mai skipWaiting silenzioso. */
export function registerServiceWorker(onUpdateReady) {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return Promise.resolve(null)
  return navigator.serviceWorker
    .register('/sw.js')
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) onUpdateReady()
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing
        if (!incoming) return
        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) onUpdateReady()
        })
      })
      return reg
    })
    .catch(() => null)
}
