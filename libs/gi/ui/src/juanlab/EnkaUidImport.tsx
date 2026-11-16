// juanlab: campo UID nella scheda di import. Legge la vetrina da Enka.network oppure tutte le build salvate su
// Akasha (tramite il Worker di JuanLab), le converte in GOOD e le passa all'import di Genshin Optimizer, che mostra
// l'anteprima prima di salvare. La fonte scelta resta salvata nel browser.
import { CardThemed } from '@genshin-optimizer/common/ui'
import { CloudDownload } from '@mui/icons-material'
import {
  Alert,
  Box,
  Button,
  CardContent,
  CircularProgress,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AkashaError, akashaToGood, fetchAkasha } from './akashaToGood'
import type { EnkaSkipped } from './enkaToGood'
import {
  EnkaError,
  enkaToGood,
  fetchAvatarStore,
  fetchEnka,
} from './enkaToGood'

export const isUid = (uid: string) => /^\d{9,10}$/.test(uid)

export type ImportSource = 'enka' | 'akasha'
const SOURCE_KEY = 'juanlab-import-source'
export function getImportSource(): ImportSource {
  try {
    return localStorage.getItem(SOURCE_KEY) === 'akasha' ? 'akasha' : 'enka'
  } catch {
    return 'enka'
  }
}
export function saveImportSource(source: ImportSource) {
  try {
    localStorage.setItem(SOURCE_KEY, source)
  } catch {
    // senza localStorage resta Enka
  }
}

/** Scelta tra Enka (vetrina attuale) e Akasha (tutte le build salvate). */
export function ImportSourceToggle({
  value,
  onChange,
}: {
  value: ImportSource
  onChange: (source: ImportSource) => void
}) {
  const { t } = useTranslation('juanlab')
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      onChange={(_e, next: ImportSource | null) => {
        if (!next) return
        saveImportSource(next)
        onChange(next)
      }}
      aria-label={t('import.sourceLabel')}
      sx={{ flexWrap: 'wrap' }}
    >
      <ToggleButton value="enka" sx={{ textTransform: 'none' }}>
        {t('import.sourceEnka')}
      </ToggleButton>
      <ToggleButton value="akasha" sx={{ textTransform: 'none' }}>
        {t('import.sourceAkasha')}
      </ToggleButton>
    </ToggleButtonGroup>
  )
}

const ext = (href: string) => (
  // biome-ignore lint/a11y/useAnchorContent: il testo del link arriva dalla traduzione
  <a href={href} target="_blank" rel="noreferrer" />
)

export function EnkaUidImport({
  onData,
  initialUid = '',
}: {
  onData: (json: string, label: string) => void
  initialUid?: string
}) {
  const { t } = useTranslation('juanlab')
  const [uid, setUid] = useState(initialUid)
  const [source, setSource] = useState<ImportSource>(getImportSource)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [msg, setMsg] = useState<{
    kind: 'success' | 'error' | 'warning'
    text: string
  }>()

  const skippedText = useCallback(
    (skipped: EnkaSkipped[]) => {
      const SKIP = {
        char: 'import.skippedChar',
        weapon: 'import.skippedWeapon',
        artifact: 'import.skippedArtifact',
      } as const
      const list = [
        ...new Set(skipped.map((s) => t(SKIP[s.kind], { id: s.id }))),
      ]
      return list.length ? t('import.skipped', { list: list.join(', ') }) : ''
    },
    [t]
  )

  const load = useCallback(
    async (value: string, from: ImportSource) => {
      const clean = value.replace(/\D/g, '')
      if (!isUid(clean)) {
        setMsg({ kind: 'error', text: t('import.uidInvalid') })
        return
      }
      setLoading(true)
      setMsg(undefined)
      setProgress('')
      onData('', '') // l'anteprima di un import precedente non resta importabile
      try {
        if (from === 'akasha') {
          const [data, store] = await Promise.all([
            fetchAkasha(clean, (done, total) =>
              setProgress(t('import.akashaProgress', { done, total }))
            ),
            fetchAvatarStore(),
          ])
          if (!data.builds.length) {
            setMsg({ kind: 'error', text: t('import.akashaEmpty') })
            return
          }
          const res = akashaToGood(data, store)
          onData(JSON.stringify(res.good), t('import.akashaOf', { uid: clean }))
          const skipped = skippedText(res.skipped)
          setMsg({
            kind: skipped ? 'warning' : 'success',
            text: [
              t('import.akashaLoaded', {
                count: res.imported.length,
                builds: res.builds,
              }),
              skipped,
            ]
              .filter(Boolean)
              .join(' '),
          })
          return
        }
        const [data, store] = await Promise.all([
          fetchEnka(clean),
          fetchAvatarStore(),
        ])
        if (!data.avatarInfoList?.length) {
          setMsg({ kind: 'error', text: t('import.empty') })
          return
        }
        const res = enkaToGood(data, store)
        const who = res.nickname ? `${res.nickname} (${clean})` : clean
        onData(JSON.stringify(res.good), t('import.showcaseOf', { who }))
        const skipped = skippedText(res.skipped)
        setMsg({
          kind: skipped ? 'warning' : 'success',
          text: [t('import.loaded', { count: res.imported.length }), skipped]
            .filter(Boolean)
            .join(' '),
        })
      } catch (e) {
        setMsg({
          kind: 'error',
          text:
            e instanceof AkashaError
              ? t(
                  [
                    `import.akashaErrors.${e.status}`,
                    'import.akashaErrors.other',
                  ],
                  { status: e.status }
                )
              : e instanceof EnkaError
                ? t([`import.errors.${e.status}`, 'import.errors.other'], {
                    status: e.status,
                  })
                : t(
                    from === 'akasha'
                      ? 'import.akashaNetwork'
                      : 'import.network'
                  ),
        })
      } finally {
        setLoading(false)
        setProgress('')
      }
    },
    [onData, t, skippedText]
  )

  // dalla home: l'UID arriva gia scritto e si carica subito, con la fonte scelta li
  const started = useRef(false)
  useEffect(() => {
    if (initialUid && !started.current) {
      started.current = true
      load(initialUid, getImportSource())
    }
  }, [initialUid, load])

  return (
    <CardThemed sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
          {t('import.title')}
        </Typography>
        <Box sx={{ mb: 1 }}>
          <ImportSourceToggle value={source} onChange={setSource} />
        </Box>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault()
            load(uid, source)
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
            i18nKey={source === 'akasha' ? 'import.hintAkasha' : 'import.hint'}
            components={{
              enka: ext('https://enka.network/'),
              akasha: ext('https://akasha.cv/'),
            }}
          />
        </Typography>
        {progress && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            {progress}
          </Typography>
        )}
        {msg && (
          <Alert severity={msg.kind} sx={{ mt: 1 }}>
            {msg.text}
          </Alert>
        )}
      </CardContent>
    </CardThemed>
  )
}
