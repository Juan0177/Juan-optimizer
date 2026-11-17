import { stopAppStorage } from '@genshin-optimizer/common/database'
import { isDev } from '@genshin-optimizer/common/util'
import { markDecorativeImages } from '@genshin-optimizer/gi/ui' // juanlab: WCAG, icone decorative
import { reloadOnce, startUpdateCheck } from './app/updateCheck'
import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './app/App'
import NewTab from './app/NewTab'
import StorageError from './app/StorageError'
import { openStorage } from './app/storage'
import './index.css'

// After a redeploy, a cached page may request chunks that no longer exist. Reload once to pick
// up the new version instead of showing the error screen (Vite's recommended handling).
window.addEventListener('vite:preloadError', (event) => {
  const key = 'go-preload-reload'
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () =>
  setTimeout(() => sessionStorage.removeItem('go-preload-reload'), 10000)
)
// Cache the site in the browser so repeat visits are instant (see public/sw.js). Production only.
if ('serviceWorker' in navigator && !isDev && location.protocol === 'https:') {
  // A new deploy's worker took over (it dropped the old cache): reload onto the new build
  const hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) reloadOnce('worker')
  })
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  })
}
if (!isDev) startUpdateCheck()
markDecorativeImages() // juanlab
let mode: 'main' | 'newtab' = 'main'
let root = createRoot(document.getElementById('root') as HTMLElement)
// The data are read before the app starts (the loading screen shows until then): from IndexedDB,
// moved there from localStorage the first time
openStorage().then(
  () => {
    if (mode !== 'main') return
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    )
  },
  (error: unknown) => {
    console.error(error)
    if (mode !== 'main') return
    root.render(
      <React.StrictMode>
        <StorageError error={error} />
      </React.StrictMode>
    )
  }
)

// Detect a storage event, and unmount the main page to show a newTab event.
function handleStorage(this: Window, event: StorageEvent) {
  if (event.key !== 'GONewTabDetection') return
  if (mode === 'newtab') return
  mode = 'newtab'
  this.document.title = 'ERROR'
  // the new tab has the data now: this one saves what it changed so far, and nothing after
  void stopAppStorage()
  root.unmount()
  root = createRoot(document.getElementById('root') as HTMLElement)
  root.render(
    <React.StrictMode>
      <NewTab />
    </React.StrictMode>
  )
}
window.addEventListener('storage', handleStorage)
