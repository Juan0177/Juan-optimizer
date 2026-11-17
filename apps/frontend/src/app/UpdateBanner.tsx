import { Alert, Button, Snackbar } from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { newerBuild, newerVersion, onNewerBuild } from './updateCheck'

/**
 * "A newer version is published": shown when the live site moved on while this page was open (or
 * opened from the offline cache). Reload when it suits you; nothing in progress is cut short.
 */
export function UpdateBanner() {
  const { t } = useTranslation('ui')
  const [newer, setNewer] = useState(newerBuild())
  const [version, setVersion] = useState(newerVersion())
  useEffect(
    () =>
      onNewerBuild(() => {
        setNewer(newerBuild())
        setVersion(newerVersion())
      }),
    []
  )
  return (
    <Snackbar
      open={!!newer}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      <Alert
        severity="info"
        variant="filled"
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => window.location.reload()}
          >
            {t('update.reload', 'Reload')}
          </Button>
        }
      >
        {version
          ? t('update.versionOut', {
              defaultValue: 'Juan-optimizer v{{version}} is out.',
              version,
            })
          : t(
              'update.newer',
              'A newer version of Juan-optimizer is published.'
            )}
      </Alert>
    </Snackbar>
  )
}
