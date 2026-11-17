import {
  DBCachedStorage,
  getAppStorage,
} from '@genshin-optimizer/common/database'
import { Alert, Snackbar, Tooltip } from '@mui/material'
import { useEffect, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'

const noop = () => () => undefined

/**
 * Shown while the data cannot be saved (the browser's database refused a save: it is tried again
 * until it works). Leaving the page meanwhile asks first: the changes not saved would be lost.
 */
export function SaveErrorNotice() {
  const { t } = useTranslation('common')
  const storage = getAppStorage()
  const cached = storage instanceof DBCachedStorage ? storage : undefined
  const error = useSyncExternalStore(
    cached ? (onChange) => cached.follow(onChange) : noop,
    () => cached?.error
  )
  useEffect(() => {
    if (!error) return
    const warn = (event: BeforeUnloadEvent) => {
      if (!cached?.unsaved) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [error, cached])
  if (!error) return null
  return (
    <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
      <Tooltip
        title={error instanceof Error ? error.message : String(error)}
        placement="top"
      >
        <Alert severity="error" variant="filled">
          {t('storage.notSaved', 'Changes not saved yet: retrying')}
        </Alert>
      </Tooltip>
    </Snackbar>
  )
}
