// juanlab: riquadri della home del fork (introduzione, import da UID, crediti)
import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import { DatabaseContext } from '@genshin-optimizer/gi/db-ui'
import {
  DISCORD_COLOR,
  DISCORD_COLOR_DARK,
  DISCORD_INVITE,
  DiscordIcon,
  decodeAccount,
  decodePayload,
  enkaToGood,
  fetchAvatarStore,
  GCWEB_PARAM,
  getGcwebSettings,
  getImportSource,
  ImportSourceToggle,
  isAccountLink,
  isUid,
  payloadToGood,
  UploadCard,
} from '@genshin-optimizer/gi/ui'
import { CloudDownload, Favorite } from '@mui/icons-material'
import {
  Alert,
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
import { useContext, useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'

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
        {/* juanlab: il server Discord (aiuto, build, novità) */}
        <Box
          sx={{
            mt: 2,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 1.5,
            rowGap: 1,
          }}
        >
          <Button
            variant="contained"
            href={DISCORD_INVITE}
            target="_blank"
            rel="noreferrer"
            startIcon={<DiscordIcon />}
            sx={{
              bgcolor: DISCORD_COLOR,
              color: '#fff',
              textTransform: 'none',
              fontWeight: 600,
              '&:hover': { bgcolor: DISCORD_COLOR_DARK },
            }}
          >
            {t('home.discord')}
          </Button>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('home.discordHint')}
          </Typography>
        </Box>
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
  const [source, setSource] = useState(getImportSource)
  const clean = uid.replace(/\D/g, '')
  return (
    <CardThemed id="juanlab-import-uid">
      <CardHeader
        title={<Typography variant="h5">{t('home.importTitle')}</Typography>}
        avatar={<CloudDownload fontSize="large" />}
      />
      <Divider />
      <CardContent>
        <Box sx={{ mb: 1 }}>
          <ImportSourceToggle value={source} onChange={setSource} />
        </Box>
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
            inputProps={{ inputMode: 'numeric', maxLength: 10 }}
            sx={{ flex: '1 1 14em' }}
          />
          <Button
            type="submit"
            color="info"
            disabled={!isUid(clean)}
            startIcon={<CloudDownload />}
            sx={{ alignSelf: 'flex-start', height: 40 }}
          >
            {t(
              source === 'akasha'
                ? 'home.importButtonAkasha'
                : 'home.importButton'
            )}
          </Button>
        </Box>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t(source === 'akasha' ? 'home.importHintAkasha' : 'home.importHint')}
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
            i18nKey="home.creditsStellar"
            components={{
              stellar: ext('https://github.com/s-naveen/stellar-optimizer'),
              agpl: ext('https://www.gnu.org/licenses/agpl-3.0.html'),
              code: ext('https://github.com/Juan0177/Juan-optimizer'),
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

type Incoming =
  | { kind: 'off' | 'bad' }
  | { kind: 'ok'; json: string; label: string; warning: string }

/** Link arrivato da gc-web (#/?gcweb=...): una build, o tutti i personaggi dell'account del server privato
 *  (link "z.", compresso). Con il collegamento attivo apre l'import con l'anteprima, altrimenti avvisa e non legge
 *  nulla. Il parametro viene tolto dall'indirizzo subito. */
export function GcwebIncoming() {
  const { t } = useTranslation('juanlab')
  const { databases, database } = useContext(DatabaseContext)
  const index = Math.max(0, databases.indexOf(database))
  const [params, setParams] = useSearchParams()
  const [incoming, setIncoming] = useState<Incoming | null>(null)
  const raw = params.get(GCWEB_PARAM)
  useEffect(() => {
    if (raw === null) return
    setParams({}, { replace: true })
    if (!getGcwebSettings().enabled) {
      setIncoming({ kind: 'off' })
      return
    }
    const read = async (): Promise<Incoming> => {
      if (isAccountLink(raw)) {
        const account = await decodeAccount(raw)
        const { good, skipped } = enkaToGood(
          {
            playerInfo: { nickname: account.nickname },
            avatarInfoList: account.avatarInfoList,
          },
          await fetchAvatarStore()
        )
        if (!good.characters.length) throw new Error('empty')
        return {
          kind: 'ok',
          json: JSON.stringify({
            ...good,
            source: 'Juan-optimizer (gc-web)',
          }),
          label: t('gcweb.accountLabel', {
            name: account.nickname || '?',
            uid: account.uid ?? '?',
            count: good.characters.length,
          }),
          warning: skipped.length
            ? t('gcweb.accountSkipped', { count: skipped.length })
            : '',
        }
      }
      const payload = decodePayload(raw)
      const { good, skipped } = payloadToGood(
        payload,
        (key) => !!database.chars.get(key)
      )
      if (!good.artifacts.length) throw new Error('empty')
      return {
        kind: 'ok',
        json: JSON.stringify(good),
        label: t('gcweb.incomingLabel', {
          name: payload.name || payload.character?.name || '',
        }),
        warning: skipped ? t('gcweb.skipped', { count: skipped }) : '',
      }
    }
    // Niente annullamento: togliere il parametro qui sopra rilancia l'effetto, e la lettura deve arrivare comunque.
    read().then(setIncoming, () => setIncoming({ kind: 'bad' }))
  }, [raw, setParams, database, t])
  if (!incoming) return null
  const close = () => setIncoming(null)
  if (incoming.kind !== 'ok')
    return (
      <Alert
        severity={incoming.kind === 'off' ? 'info' : 'error'}
        onClose={close}
        sx={{ my: 1 }}
      >
        {t(incoming.kind === 'off' ? 'gcweb.incomingOff' : 'gcweb.incomingBad')}
      </Alert>
    )
  return (
    <ModalWrapper open onClose={close}>
      <Box>
        {incoming.warning && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {incoming.warning}
          </Alert>
        )}
        <UploadCard
          index={index}
          initialData={{ json: incoming.json, label: incoming.label }}
          onReplace={close}
        />
      </Box>
    </ModalWrapper>
  )
}
