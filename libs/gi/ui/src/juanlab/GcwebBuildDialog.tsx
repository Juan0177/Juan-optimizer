// juanlab: da una build (KQM o TC) ai 5 manufatti per gc-web. Il pulsante apre l'anteprima dei pezzi generati
// (gcwebArtifacts.ts) con il confronto obiettivo / generato, poi "Invia a gc-web" apre il link come il pulsante
// della scheda del personaggio. Con il collegamento spento il pulsante resta visibile ma disattivato, con
// l'indicazione di dove attivarlo. Niente viene scritto: né database, né squadra, né risultati KQM.
import type {
  ArtifactSlotKey,
  CharacterKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import SendIcon from '@mui/icons-material/Send'
import type { SxProps, Theme } from '@mui/material'
import {
  Alert,
  Box,
  Button,
  Dialog,
  IconButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import { Suspense, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { artifactStatName } from '../util/statName'
import { gcwebLink, genResultToPayload, useGcwebSettings } from './gcweb'
import type { GenInput, GenResult } from './gcwebArtifacts'
import { generateArtifacts } from './gcwebArtifacts'

const hairline = `1px solid ${giTokens.hairline}`
const numSx = { fontVariantNumeric: 'tabular-nums' } as const
const labelSx = { fontSize: 12.5, fontWeight: 500, color: 'text.secondary' }
const insetSx = {
  bgcolor: giTokens.panelDark,
  borderRadius: 1,
  border: hairline,
} as const

const isPercent = (key: SubstatKey) => key.endsWith('_')
/** A substat value as the game shows it: percent stats with one decimal, flat ones whole */
function formatValue(
  key: SubstatKey,
  value: number,
  language?: string,
  signed = false
) {
  const digits = isPercent(key) ? 1 : 0
  const text = new Intl.NumberFormat(language || 'en', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(value)
  return isPercent(key) ? `${text}%` : text
}

/**
 * "Artifacts for gc-web": previews the 5 artifacts made from a build and sends them to gc-web. `input`
 * is read when the preview opens. With the gc-web link off it is shown disabled, its description
 * saying where to turn the link on.
 */
export function GcwebBuildButton({
  input,
  characterKey,
  gender,
  name,
  compact = false,
  sx,
}: {
  /** The build as the generator's input (`genInputFromKqm` / `genInputFromTc`) */
  input: () => GenInput
  characterKey: CharacterKey
  gender: 'F' | 'M'
  /** The build's name in gc-web (its CharacterBuilder build): "KQM <character>", the TC build's name */
  name: string
  /** Only the icon (its name as aria-label and tooltip), for card footers */
  compact?: boolean
  sx?: SxProps<Theme>
}) {
  const { t } = useTranslation(['juanlab', 'charNames_gen'])
  const settings = useGcwebSettings()
  const [open, setOpen] = useState(false)
  // (the character's name, sent apart from the build's)
  const characterName = t(
    `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
  )
  const hintId = useId()
  const off = !settings.enabled
  const label = t('gcwebBuild.button', 'Artifacts for gc-web')
  const hint = off
    ? t(
        'gcwebBuild.off',
        'Turn on the gc-web link in Settings → Database → Upload, under “Link to gc-web”.'
      )
    : t(
        'gcwebBuild.buttonTitle',
        'Make 5 artifacts with this build, preview them and send them to gc-web'
      )
  // (aria-disabled, not disabled: it stays focusable, so the hint is reachable by keyboard too)
  const common = {
    'aria-disabled': off || undefined,
    'aria-describedby': hintId,
    onClick: () => {
      if (!off) setOpen(true)
    },
  }
  const offSx = off
    ? {
        color: 'text.disabled',
        cursor: 'not-allowed',
        borderColor: giTokens.hairlineStrong,
      }
    : {}
  return (
    <>
      <Tooltip arrow describeChild title={hint}>
        {compact ? (
          <IconButton
            {...common}
            size="small"
            color={off ? 'default' : 'info'}
            aria-label={label}
            sx={[offSx, ...(Array.isArray(sx) ? sx : [sx])]}
          >
            <SendIcon />
          </IconButton>
        ) : (
          <Button
            {...common}
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<SendIcon />}
            sx={[offSx, ...(Array.isArray(sx) ? sx : [sx])]}
          >
            {label}
          </Button>
        )}
      </Tooltip>
      <Box component="span" id={hintId} sx={visuallyHidden}>
        {hint}
      </Box>
      {open && (
        <GcwebBuildDialog
          input={input}
          characterKey={characterKey}
          gender={gender}
          names={{ build: name, character: characterName }}
          url={settings.url}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

function GcwebBuildDialog({
  input: makeInput,
  characterKey,
  gender,
  names,
  url,
  onClose,
}: {
  input: () => GenInput
  characterKey: CharacterKey
  gender: 'F' | 'M'
  names: { build: string; character: string }
  url: string
  onClose: () => void
}) {
  const { t } = useTranslation('juanlab')
  const titleId = useId()
  const [copied, setCopied] = useState<'done' | 'failed'>()
  // (once, when the preview opens: the generator is deterministic and quick)
  const [made] = useState(() => {
    try {
      const input = makeInput()
      const result = generateArtifacts(input)
      const link = gcwebLink(
        url,
        genResultToPayload(characterKey, gender, names, result)
      )
      return { input, result, link }
    } catch (error) {
      return { error: String((error as Error)?.message ?? error) }
    }
  })
  const link = 'link' in made ? made.link : undefined
  const send = () => {
    if (link) window.open(link, '_blank', 'noopener')
  }
  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied('done')
    } catch {
      setCopied('failed')
    }
  }
  return (
    <Dialog
      open
      onClose={onClose}
      aria-labelledby={titleId}
      fullWidth
      maxWidth="lg"
      PaperProps={{ sx: { backgroundImage: 'none' } }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: { xs: 1.5, sm: 2.5 },
          py: 1.25,
          minHeight: 60,
          borderBottom: hairline,
        }}
      >
        <Typography
          id={titleId}
          component="h2"
          sx={{ fontSize: 17, fontWeight: 650, flexGrow: 1, minWidth: 0 }}
        >
          {t('gcwebBuild.title', '5 artifacts for gc-web')}
        </Typography>
        <IconButton
          onClick={onClose}
          aria-label={t('gcwebBuild.close', 'Close')}
          sx={{ mr: -1 }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <Box
        sx={{
          px: { xs: 1.5, sm: 2.5 },
          py: 2,
          maxHeight: { xs: 'calc(100dvh - 160px)', sm: '72vh' },
          overflowY: 'auto',
        }}
      >
        {'error' in made ? (
          <Alert severity="error">
            {t('gcwebBuild.error', {
              defaultValue: 'These artifacts could not be made: {{error}}',
              error: made.error,
            })}
          </Alert>
        ) : (
          <Suspense
            fallback={<Skeleton variant="rounded" sx={{ height: 360 }} />}
          >
            <GcwebBuildPreview input={made.input} result={made.result} />
          </Suspense>
        )}
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          gap: 1,
          px: { xs: 1.5, sm: 2.5 },
          py: 1.5,
          borderTop: hairline,
        }}
      >
        <Typography
          role="status"
          sx={{
            ...labelSx,
            mr: 'auto',
            color: copied === 'failed' ? 'error.main' : 'text.secondary',
          }}
        >
          {copied === 'done'
            ? t('gcwebBuild.copied', 'Link copied')
            : copied === 'failed'
              ? t('gcwebBuild.copyFailed', 'The link could not be copied')
              : ''}
        </Typography>
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<ContentCopyIcon />}
          disabled={!link}
          onClick={copy}
        >
          {t('gcwebBuild.copy', 'Copy link')}
        </Button>
        <Button
          variant="contained"
          startIcon={<SendIcon />}
          disabled={!link}
          onClick={send}
          sx={[{ px: 2.25 }, !!link && giCtaSx]}
        >
          {t('gcwebBuild.send', 'Send to gc-web')}
        </Button>
      </Box>
    </Dialog>
  )
}

/** The 5 generated pieces, then target / generated / Δ for the substats the build uses */
export function GcwebBuildPreview({
  input,
  result,
}: {
  input: GenInput
  result: GenResult
}) {
  const { t, i18n } = useTranslation([
    'juanlab',
    'artifact',
    'artifactNames_gen',
  ])
  const language = i18n?.language
  const compareId = useId()
  const raised = (slotKey: ArtifactSlotKey) =>
    result.fillerRaised.filter((f) => f.slotKey === slotKey).map((f) => f.key)
  const used = (Object.keys(result.gaps) as SubstatKey[]).filter((key) =>
    input.used.includes(key)
  )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box
        component="ul"
        sx={{
          listStyle: 'none',
          m: 0,
          p: 0,
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(3, minmax(0, 1fr))',
            lg: 'repeat(5, minmax(0, 1fr))',
          },
        }}
      >
        {result.pieces.map((piece) => {
          const slot = t(`artifact:slotName.${piece.slotKey}`)
          const above = raised(piece.slotKey)
          return (
            <Box
              component="li"
              key={piece.slotKey}
              sx={{ ...insetSx, p: 1.5, minWidth: 0 }}
            >
              <Typography
                component="h3"
                sx={{ fontSize: 15, fontWeight: 650 }}
                noWrap
              >
                {slot}
              </Typography>
              <Typography sx={labelSx}>
                {t(`artifactNames_gen:${piece.setKey}`)}
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 1,
                  mt: 0.75,
                  pb: 0.75,
                  borderBottom: hairline,
                }}
              >
                <Typography
                  data-testid="main"
                  sx={{ fontSize: 14, fontWeight: 600 }}
                >
                  {artifactStatName(piece.mainStatKey)}
                </Typography>
                <Typography sx={{ ...labelSx, ...numSx, whiteSpace: 'nowrap' }}>
                  {`${piece.rarity}★ +${piece.level}`}
                </Typography>
              </Box>
              <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
                {piece.substats.map((sub) => (
                  <Box
                    component="li"
                    key={sub.key}
                    sx={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: 1,
                      py: 0.5,
                      fontSize: 13.5,
                    }}
                  >
                    <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                      {artifactStatName(sub.key)}
                    </Box>
                    <Box component="span" sx={{ ...numSx, fontWeight: 600 }}>
                      {formatValue(sub.key, sub.value, language)}
                    </Box>
                    <Box
                      component="span"
                      sx={{
                        ...labelSx,
                        ...numSx,
                        minWidth: '4.5em',
                        textAlign: 'right',
                      }}
                    >
                      {t('gcwebBuild.rolls', {
                        count: sub.rolls.length,
                        defaultValue: '{{count}} rolls',
                        defaultValue_one: '{{count}} roll',
                      })}
                    </Box>
                  </Box>
                ))}
              </Box>
              {!!above.length && (
                <Typography sx={{ ...labelSx, mt: 0.5 }}>
                  {t('gcwebBuild.raised', {
                    defaultValue: 'Rolls above the minimum: {{stats}}',
                    stats: above.map((key) => artifactStatName(key)).join(', '),
                  })}
                </Typography>
              )}
            </Box>
          )
        })}
      </Box>
      <Box sx={{ ...insetSx, p: 1.5, maxWidth: 560 }}>
        <RollsHeading id={compareId} />
        <Table size="small" aria-labelledby={compareId}>
          <TableHead>
            <TableRow>
              <TableCell sx={labelSx}>
                {t('gcwebBuild.colStat', 'Substat')}
              </TableCell>
              <TableCell align="right" sx={labelSx}>
                {t('gcwebBuild.colTarget', 'Target')}
              </TableCell>
              <TableCell align="right" sx={labelSx}>
                {t('gcwebBuild.colGenerated', 'Generated')}
              </TableCell>
              <TableCell align="right" sx={labelSx}>
                <span aria-hidden="true">Δ</span>
                <Box component="span" sx={visuallyHidden}>
                  {t('gcwebBuild.colDelta', 'Difference')}
                </Box>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {used.map((key) => (
              <TableRow key={key}>
                <TableCell component="th" scope="row">
                  {artifactStatName(key)}
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  {formatValue(key, input.targets[key] ?? 0, language)}
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  {formatValue(key, result.totals[key] ?? 0, language)}
                </TableCell>
                <TableCell align="right" sx={numSx}>
                  {formatValue(key, result.gaps[key] ?? 0, language, true)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  )
}

/** The comparison's title and its ⓘ: where the pieces' extra rolls go */
function RollsHeading({ id }: { id: string }) {
  const { t } = useTranslation('juanlab')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
      <Typography id={id} component="h3" sx={{ fontSize: 15, fontWeight: 650 }}>
        {t('gcwebBuild.compare', 'Compared with the build')}
      </Typography>
      <Tooltip
        arrow
        describeChild
        title={t(
          'gcwebBuild.compareInfo',
          'Only the substats the build uses. Each piece has the rolls the server gives it (9 for a 5★ +20, 8 for a 4★ +16): the rolls beyond the build’s go to substats the build does not use, at their lowest value.'
        )}
      >
        <IconButton
          size="small"
          aria-label={t('gcwebBuild.compareInfoLabel', 'About the rolls')}
          sx={{ color: 'text.secondary' }}
        >
          <InfoOutlinedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>
  )
}
