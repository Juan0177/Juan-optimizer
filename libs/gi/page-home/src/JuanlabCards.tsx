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
import type { ReactElement } from 'react'
import { useContext, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

// link esterni dei testi tradotti: <go>…</go>, <enka>…</enka>, ecc.
const ext = (href: string): ReactElement => (
  <Link href={href} target="_blank" rel="noreferrer" />
)

export function IntroCard() {
  const { t } = useTranslation('juanlab')
  return (
    <CardThemed>
      <CardContent>
        <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 1 }}>
          Juan-optimizer
        </Typography>
        <Typography>
          <Trans
            t={t}
            i18nKey="home.intro"
            components={{
              gi: ext('https://genshin.hoyoverse.com/'),
              juanlab: ext('https://juan0177.github.io/JuanLab/'),
            }}
          />
        </Typography>
      </CardContent>
    </CardThemed>
  )
}

export function ImportUidCard() {
  const { t } = useTranslation('juanlab')
  const { databases, database } = useContext(DatabaseContext)
  const index = Math.max(0, databases.indexOf(database))
  const [uid, setUid] = useState('')
  const [open, setOpen] = useState('')
  const clean = uid.replace(/\D/g, '')
  return (
    <CardThemed>
      <CardHeader
        title={<Typography variant="h5">{t('home.importTitle')}</Typography>}
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
            label={t('import.uidLabel')}
            value={uid}
            onChange={(e) => setUid(e.target.value)}
            error={!!uid && !isUid(clean)}
            helperText={uid && !isUid(clean) ? t('home.uidDigits') : ' '}
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
            {t('home.importButton')}
          </Button>
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('home.importHint')}
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
  const { t } = useTranslation('juanlab')
  const GO = 'https://github.com/frzyc/genshin-optimizer'
  return (
    <CardThemed>
      <CardHeader
        title={<Typography variant="h5">{t('home.creditsTitle')}</Typography>}
        avatar={<Favorite fontSize="large" />}
      />
      <Divider />
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography>
          <Trans
            t={t}
            i18nKey="home.credits1"
            components={{
              go: ext(GO),
              frzyc: ext('https://github.com/frzyc'),
              contrib: ext(`${GO}/graphs/contributors`),
              mit: ext(`${GO}/blob/master/LICENSE`),
              site: ext('https://frzyc.github.io/genshin-optimizer/'),
            }}
          />
        </Typography>
        <Typography>
          <Trans
            t={t}
            i18nKey="home.credits2"
            components={{
              enka: ext('https://enka.network/'),
              juanlab: ext('https://juan0177.github.io/JuanLab/'),
              code: ext('https://github.com/Juan0177/Juan-optimizer'),
            }}
          />
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('home.credits3')}
        </Typography>
      </CardContent>
    </CardThemed>
  )
}
