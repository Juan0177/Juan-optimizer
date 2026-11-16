import '@fontsource/roboto/300.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import ReactGA from 'react-ga4'
import App from './app/App'
import NewTab from './app/NewTab'
import './index.css'

// juanlab: se la pagina era aperta durante un deploy, i file del deploy precedente non esistono piu
// (import dinamico in 404): si ricarica una volta invece di mostrare la schermata di errore
window.addEventListener('vite:preloadError', (event) => {
  const key = 'juanlab-reloaded-after-deploy'
  if (sessionStorage.getItem(key)) return
  sessionStorage.setItem(key, '1')
  event.preventDefault()
  window.location.reload()
})
window.addEventListener('load', () =>
  setTimeout(
    () => sessionStorage.removeItem('juanlab-reloaded-after-deploy'),
    10000
  )
)

ReactGA.initialize(process.env.NX_GA_TRACKINGID as any, {
  testMode: true, // juanlab: niente Google Analytics nel fork (era: isDev)
})
let mode: 'main' | 'newtab' = 'main'
let root = createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Detect a storage event, and unmount the main page to show a newTab event.
function handleStorage(this: Window, event: StorageEvent) {
  if (event.key !== 'GONewTabDetection') return
  if (mode === 'newtab') return
  mode = 'newtab'
  this.document.title = 'ERROR'
  root.unmount()
  root = createRoot(document.getElementById('root') as HTMLElement)
  root.render(
    <React.StrictMode>
      <NewTab />
    </React.StrictMode>
  )
}
window.addEventListener('storage', handleStorage)
