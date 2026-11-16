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
import { enkaToGood, fetchAvatarStore, fetchEnka } from './enkaToGood'

export const isUid = (uid: string) => /^\d{9,10}$/.test(uid)

export function EnkaUidImport({
  onData,
  initialUid = '',
}: {
  onData: (json: string, label: string) => void
  initialUid?: string
}) {
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
        setMsg({ kind: 'error', text: 'Scrivi un UID di 9 o 10 cifre.' })
        return
      }
      setLoading(true)
      setMsg(undefined)
      try {
        const [data, store] = await Promise.all([
          fetchEnka(clean),
          fetchAvatarStore(),
        ])
        if (!data.avatarInfoList?.length) {
          setMsg({
            kind: 'error',
            text: 'La vetrina è vuota oppure i dettagli dei personaggi sono nascosti nelle impostazioni del gioco.',
          })
          return
        }
        const res = enkaToGood(data, store)
        const who = res.nickname ? `${res.nickname} (${clean})` : clean
        onData(JSON.stringify(res.good), `Vetrina di ${who}`)
        setMsg({
          kind: res.skipped.length ? 'warning' : 'success',
          text:
            `${res.imported.length} personaggi in vetrina, con armi e manufatti. Controlla l'anteprima qui sotto e conferma l'import.` +
            (res.skipped.length
              ? ` Non riconosciuti (forse troppo nuovi per questa versione): ${res.skipped.join(', ')}.`
              : ''),
        })
      } catch (e) {
        setMsg({
          kind: 'error',
          text:
            e instanceof Error && e.message
              ? e.message
              : 'Non riesco a leggere la vetrina: controlla la connessione e riprova.',
        })
      } finally {
        setLoading(false)
      }
    },
    [onData]
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
          Importa dalla vetrina (UID)
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
            label="UID del giocatore"
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
            disabled={loading}
            startIcon={
              loading ? <CircularProgress size="1em" /> : <CloudDownload />
            }
          >
            Carica
          </Button>
        </Box>
        <Typography
          variant="caption"
          sx={{ display: 'block', mt: 1, color: 'text.secondary' }}
        >
          Vengono importati i personaggi della vetrina del gioco (con i dettagli
          visibili), con armi e manufatti equipaggiati. Dati da{' '}
          <a href="https://enka.network/" target="_blank" rel="noreferrer">
            Enka.network
          </a>
          .
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
