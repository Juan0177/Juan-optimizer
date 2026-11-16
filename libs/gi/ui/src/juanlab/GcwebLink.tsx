// juanlab: impostazione del collegamento a gc-web (nella finestra d'import) e pulsante "Invia a gc-web"
// (nella scheda del personaggio). Il pulsante compare solo con il collegamento attivo.
import { CardThemed } from '@genshin-optimizer/common/ui'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import {
  CharacterContext,
  useDatabase,
  useDBMeta,
} from '@genshin-optimizer/gi/db-ui'
import { Send } from '@mui/icons-material'
import {
  Box,
  Button,
  CardContent,
  Checkbox,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import {
  artifactsToPayload,
  DEFAULT_GCWEB_URL,
  gcwebLink,
  saveGcwebSettings,
  useGcwebSettings,
} from './gcweb'

export function GcwebSettingsBox() {
  const { t } = useTranslation('juanlab')
  const settings = useGcwebSettings()
  return (
    <CardThemed sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
          {t('gcweb.title')}
        </Typography>
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={settings.enabled}
                onChange={(e) =>
                  saveGcwebSettings({ enabled: e.target.checked })
                }
              />
            }
            label={t('gcweb.enable')}
          />
          <TextField
            size="small"
            label={t('gcweb.urlLabel')}
            defaultValue={settings.url}
            onBlur={(e) =>
              saveGcwebSettings({
                url: e.target.value.trim() || DEFAULT_GCWEB_URL,
              })
            }
            sx={{ flex: '1 1 16em' }}
          />
        </Box>
        <Typography
          variant="caption"
          sx={{ display: 'block', mt: 1, color: 'text.secondary' }}
        >
          {t('gcweb.hint')}
        </Typography>
      </CardContent>
    </CardThemed>
  )
}

export function SendToGcwebButton() {
  const { t } = useTranslation(['juanlab', 'charNames_gen'])
  const settings = useGcwebSettings()
  const database = useDatabase()
  const { gender } = useDBMeta()
  const { character } = useContext(CharacterContext)
  if (!settings.enabled || !character) return null
  const send = () => {
    const artifacts = allArtifactSlotKeys
      .map((slot) => character.equippedArtifacts[slot])
      .map((id) => (id ? database.arts.get(id) : undefined))
      .filter((a) => !!a)
    if (!artifacts.length) {
      window.alert(t('gcweb.noArtifacts'))
      return
    }
    const payload = artifactsToPayload(
      character.key,
      gender,
      character.key,
      artifacts
    )
    window.open(gcwebLink(settings.url, payload), '_blank', 'noopener')
  }
  return (
    <Button
      color="info"
      onClick={send}
      startIcon={<Send />}
      title={t('gcweb.sendTitle')}
    >
      {t('gcweb.send')}
    </Button>
  )
}
