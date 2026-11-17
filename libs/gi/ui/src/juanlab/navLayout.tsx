// juanlab: posizione della barra di navigazione, scelta nelle impostazioni: in alto (come Stellar Optimizer) o
// laterale (menu fisso a sinistra, solo su schermi larghi; sul telefono resta il menu a scomparsa).
// La scelta resta nel browser.
import ViewSidebarIcon from '@mui/icons-material/ViewSidebar'
import WebAssetIcon from '@mui/icons-material/WebAsset'
import { ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

export type NavLayout = 'top' | 'side'
/** Larghezza della barra laterale, in px */
export const SIDEBAR_WIDTH = 232

const KEY = 'juanlab-nav-layout'
const EVENT = 'juanlab-nav-layout'

export function getNavLayout(): NavLayout {
  try {
    return localStorage.getItem(KEY) === 'side' ? 'side' : 'top'
  } catch {
    return 'top'
  }
}
export function setNavLayout(layout: NavLayout) {
  try {
    localStorage.setItem(KEY, layout)
  } catch {
    // senza localStorage la scelta vale solo fino al ricaricamento
  }
  window.dispatchEvent(new Event(EVENT))
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}
export function useNavLayout(): NavLayout {
  return useSyncExternalStore(subscribe, getNavLayout, () => 'top')
}

/** Scelta della barra nelle impostazioni */
export function NavLayoutToggle() {
  const { t } = useTranslation('juanlab')
  const layout = useNavLayout()
  return (
    <>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {t('nav.title')}
      </Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        value={layout}
        onChange={(_e, next: NavLayout | null) => next && setNavLayout(next)}
        aria-label={t('nav.title')}
      >
        <ToggleButton value="top" sx={{ gap: 1 }}>
          <WebAssetIcon fontSize="small" />
          {t('nav.top')}
        </ToggleButton>
        <ToggleButton value="side" sx={{ gap: 1 }}>
          <ViewSidebarIcon fontSize="small" sx={{ transform: 'scaleX(-1)' }} />
          {t('nav.side')}
        </ToggleButton>
      </ToggleButtonGroup>
    </>
  )
}
