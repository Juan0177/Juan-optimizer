// juanlab: riquadri della home del fork (introduzione, import da UID, crediti)
import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import { DatabaseContext } from '@genshin-optimizer/gi/db-ui'
import { isUid, UploadCard } from '@genshin-optimizer/gi/ui'
import { CloudDownload, Favorite } from '@mui/icons-material'
import {
  Box,
  Button,
  CardContent,
  CardHeader,
  Divider,
  Link,
  TextField,
  Typography,
} from '@mui/material'
import { useContext, useState } from 'react'

export function IntroCard() {
  return (
    <CardThemed>
      <CardContent>
        <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1 }}>
          Juan-optimizer
        </Typography>
        <Typography>
          Il calcolatore di build di{' '}
          <Link
            href="https://genshin.hoyoverse.com/"
            target="_blank"
            rel="noreferrer"
          >
            <i>Genshin Impact</i>
          </Link>{' '}
          di{' '}
          <Link
            href="https://juan0177.github.io/JuanLab/"
            target="_blank"
            rel="noreferrer"
          >
            JuanLab
          </Link>
          , basato su Genshin Optimizer. Importa i personaggi della tua vetrina
          con l&apos;UID e trova la build migliore con quello che hai.
        </Typography>
      </CardContent>
    </CardThemed>
  )
}

export function ImportUidCard() {
  const { databases, database } = useContext(DatabaseContext)
  const index = Math.max(0, databases.indexOf(database))
  const [uid, setUid] = useState('')
  const [open, setOpen] = useState('')
  const clean = uid.replace(/\D/g, '')
  return (
    <CardThemed>
      <CardHeader
        title={<Typography variant="h5">Importa dalla vetrina</Typography>}
        avatar={<CloudDownload fontSize="large" />}
      />
      <Divider />
      <CardContent>
        <Box
          component="form"
          onSubmit={(e) => {
            e.preventDefault()
            if (isUid(clean)) setOpen(clean)
          }}
          sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1 }}
        >
          <TextField
            size="small"
            label="UID del giocatore"
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            error={!!uid && !isUid(clean)}
            helperText={uid && !isUid(clean) ? '9 o 10 cifre' : ' '}
            slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 10 } }}
            sx={{ flex: '1 1 14em' }}
          />
          <Button
            type="submit"
            color="info"
            disabled={!isUid(clean)}
            startIcon={<CloudDownload />}
            sx={{ alignSelf: 'flex-start', height: 40 }}
          >
            Carica la vetrina
          </Button>
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Carica i personaggi in vetrina con armi e manufatti equipaggiati, nel
          database attuale. Prima di salvare vedi l&apos;anteprima di cosa
          cambia. Nel gioco i dettagli dei personaggi devono essere visibili.
        </Typography>
      </CardContent>
      {open && (
        <ModalWrapper open onClose={() => setOpen('')}>
          <UploadCard
            index={index}
            initialUid={open}
            onReplace={() => setOpen('')}
          />
        </ModalWrapper>
      )}
    </CardThemed>
  )
}

export function CreditsCard() {
  return (
    <CardThemed>
      <CardHeader
        title={<Typography variant="h5">Crediti</Typography>}
        avatar={<Favorite fontSize="large" />}
      />
      <Divider />
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography>
          Juan-optimizer è una copia di{' '}
          <Link
            href="https://github.com/frzyc/genshin-optimizer"
            target="_blank"
            rel="noreferrer"
          >
            Genshin Optimizer
          </Link>{' '}
          di{' '}
          <Link
            href="https://github.com/frzyc"
            target="_blank"
            rel="noreferrer"
          >
            frzyc
          </Link>{' '}
          e di tutti i suoi{' '}
          <Link
            href="https://github.com/frzyc/genshin-optimizer/graphs/contributors"
            target="_blank"
            rel="noreferrer"
          >
            contributori
          </Link>
          , distribuito con licenza{' '}
          <Link
            href="https://github.com/frzyc/genshin-optimizer/blob/master/LICENSE"
            target="_blank"
            rel="noreferrer"
          >
            MIT
          </Link>
          . Calcoli, dati e interfaccia sono il loro lavoro: il sito originale è{' '}
          <Link
            href="https://frzyc.github.io/genshin-optimizer/"
            target="_blank"
            rel="noreferrer"
          >
            frzyc.github.io/genshin-optimizer
          </Link>
          .
        </Typography>
        <Typography>
          Vetrine dei giocatori da{' '}
          <Link href="https://enka.network/" target="_blank" rel="noreferrer">
            Enka.network
          </Link>
          . Questa copia è di{' '}
          <Link
            href="https://juan0177.github.io/JuanLab/"
            target="_blank"
            rel="noreferrer"
          >
            JuanLab
          </Link>{' '}
          (
          <Link
            href="https://github.com/Juan0177/Juan-optimizer"
            target="_blank"
            rel="noreferrer"
          >
            codice
          </Link>
          ) e non è collegata al progetto originale.
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Genshin Impact è un marchio di HoYoverse. Questo sito non è affiliato
          né approvato da HoYoverse.
        </Typography>
      </CardContent>
    </CardThemed>
  )
}
