import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Nota deploy: se un giorno servisse GitHub Pages, aggiungere base: '/football-eleven/'.
// Per Cloudflare Pages la root va bene così.

/** Timbro di build nel service worker: il nome cache cambia a ogni build,
 * mai bumpato a mano (standard studio: __SW_BUILD__ sostituito a build time). */
function swBuildStamp() {
  return {
    name: 'pitchtory-sw-build-stamp',
    writeBundle() {
      try {
        const code = readFileSync('dist/sw.js', 'utf8')
        writeFileSync('dist/sw.js', code.replace('__SW_BUILD__', String(Date.now())))
      } catch (err) {
        // senza sw.js niente timbro: la build non deve mai fallire per questo
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), swBuildStamp()],
})
