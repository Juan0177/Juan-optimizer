// juanlab: campo UID nella scheda di import. Legge la vetrina da Enka.network (tramite il Worker di JuanLab),
// la converte in GOOD e la passa all'import di Genshin Optimizer, che mostra l'anteprima prima di salvare.
import { CardThemed } from '@genshin-optimizer/common/ui'
import { CloudDownload } from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  CardContent,
  CircularProgress,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  EnkaError,
  enkaToGood,
  fetchAvatarStore,
  fetchEnka,
} from './enkaToGood'

export const isUid = (uid: string) => /^\d{9,10}$/.test(uid)

export function EnkaUidImport({
  onData,
  initialUid = '',
}: {
  onData: (json: string, label: string) => void
  initialUid?: string
}) {
  const { t } = useTranslation('juanlab')
  const [uid, setUid] = useState(initialUid)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{
    kind: 'success' | 'error' | 'warning'
    text: string
  }>()

  const load = useCallback(
    async (value: string) => {
      const clean = value.replace(/\D/g, '')
      if (!isUid(clean)) {
        setMsg({ kind: 'error', text: t('import.uidInvalid') })
        return
      }
      setLoading(true)
      setMsg(undefined)
      onData('', '') // l'anteprima di una vetrina precedente non resta importabile
      try {
        const [data, store] = await Promise.all([
          fetchEnka(clean),
          fetchAvatarStore(),
        ])
        if (!data.avatarInfoList?.length) {
          setMsg({
            kind: 'error',
            text: t('import.empty'),
          })
          return
        }
        const res = enkaToGood(data, store)
        const who = res.nickname ? `${res.nickname} (${clean})` : clean
        onData(JSON.stringify(res.good), t('import.showcaseOf', { who }))
        const SKIP = {
          char: 'import.skippedChar',
          weapon: 'import.skippedWeapon',
          artifact: 'import.skippedArtifact',
        } as const
        const list = res.skipped.map((s) => t(SKIP[s.kind], { id: s.id }))
        setMsg({
          kind: list.length ? 'warning' : 'success',
          text: [
            t('import.loaded', { count: res.imported.length }),
            list.length ? t('import.skipped', { list: list.join(', ') }) : '',
          ]
            .filter(Boolean)
            .join(' '),
        })
      } catch (e) {
        setMsg({
          kind: 'error',
          text:
            e instanceof EnkaError
              ? t([`import.errors.${e.status}`, 'import.errors.other'], {
                  status: e.status,
                })
              : t('import.network'),
        })
      } finally {
        setLoading(false)
      }
    },
    [onData, t]
  )

  // dalla home: l'UID arriva gia scritto e si carica subito
  const started = useRef(false)
  useEffect(() => {
    if (initialUid && !started.current) {
      started.current = true
      load(initialUid)
    }
  }, [initialUid, load])

  return (
    <CardThemed sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
          {t('import.title')}
        </Typography>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault()
            load(uid)
          }}
          sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}
        >
          <TextField
            size="small"
            label={t('import.uidLabel')}
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            slotProps={{
              htmlInput: { inputMode: 'numeric', maxLength: 10 },
            }}
            sx={{ flex: '1 1 12em' }}
          />
          <Button
            type="submit"
            color="info"
            disabled={loading || !isUid(uid.replace(/\D/g, ''))}
            startIcon={
              loading ? <CircularProgress size="1em" /> : <CloudDownload />
            }
          >
            {t('import.load')}
          </Button>
        </Box>
        <Typography
          variant="caption"
          sx={{ display: 'block', mt: 1, color: 'text.secondary' }}
        >
          <Trans
            t={t}
            i18nKey="import.hint"
            components={{
              enka: (
                // biome-ignore lint/a11y/useAnchorContent: il testo del link arriva dalla traduzione
                <a
                  href="https://enka.network/"
                  target="_blank"
                  rel="noreferrer"
                />
              ),
            }}
          />
        </Typography>
        {msg && (
          <Alert severity={msg.kind} sx={{ mt: 1 }}>
            {msg.text}
          </Alert>
        )}
      </CardContent>
    </CardThemed>
  )
}
