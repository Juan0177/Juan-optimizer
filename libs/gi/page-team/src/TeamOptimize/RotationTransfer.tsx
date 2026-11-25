import { useBoolState } from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  downloadJson,
  InfoTooltipInline,
  ModalWrapper,
} from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamRotation } from '@genshin-optimizer/gi/db'
import { parseTeamRotation, teamRotationExport } from '@genshin-optimizer/gi/db'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import { CharacterName } from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import FileDownloadIcon from '@mui/icons-material/FileDownload'
import FileUploadIcon from '@mui/icons-material/FileUpload'
import {
  Alert,
  alpha,
  Box,
  Button,
  CardContent,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import { focusSx, quickSx, tokens, type } from './ui'

/**
 * Export (to the clipboard) and import (pasted) the team's whole rotation as one JSON: every
 * member's attacks, the rotation time and who is on the field
 */
const transferBtnSx = {
  height: 28,
  minWidth: 0,
  px: 1.125,
  borderRadius: 0,
  border: 'none',
  fontSize: 12.5,
  fontWeight: 550,
  color: 'text.secondary',
  whiteSpace: 'nowrap',
  ...quickSx,
  ...focusSx,
  '&.Mui-focusVisible, &:focus-visible': { outlineOffset: -2 },
  '&:hover': {
    color: 'text.primary',
    bgcolor: alpha(giTokens.parchment, 0.06),
  },
  '& .MuiButton-startIcon': { mr: 0.5 },
  '& .MuiButton-startIcon svg': { fontSize: 15 },
} as const

export function RotationTransfer({
  members,
  teamOpt,
  onImport,
  hasWrittenRotation,
  disabled,
  importOnly,
}: {
  members: TeamOptMember[]
  teamOpt: TeamOpt
  onImport: (rotation: TeamRotation) => void
  hasWrittenRotation: boolean
  disabled?: boolean
  /** Only the import, as a quiet text link (the empty rotation's start screen) */
  importOnly?: boolean
}) {
  const { t } = useTranslation('page_team')
  const keys = members.map((m) => m.characterKey)
  const hasAttacks = keys.some((k) => teamOpt.attacks[k]?.length)
  // the export button's short-lived note: copied, or why not
  const [note, setNote] = useState<string>()
  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(undefined), 1800)
    return () => clearTimeout(timer)
  }, [note])
  const [show, onShow, onHide] = useBoolState()

  // (the attacks as they were when copying failed: gone once they change, or the tab does)
  const [downloadFallback, setDownloadFallback] = useState<string>()
  useEffect(() => setDownloadFallback(undefined), [teamOpt])
  const copy = async () => {
    const json = JSON.stringify(teamRotationExport(teamOpt, keys))
    try {
      await navigator.clipboard.writeText(json)
      setDownloadFallback(undefined)
      setNote(t('teamOpt.transfer.copied', 'Rotation copied as JSON'))
    } catch {
      setDownloadFallback(json)
    }
  }

  const importModal = show && (
    <ImportModal
      members={members}
      onClose={onHide}
      onImport={onImport}
      hasWrittenRotation={hasWrittenRotation}
    />
  )
  if (importOnly)
    return (
      <>
        <Button
          size="small"
          variant="text"
          color="inherit"
          disableElevation
          startIcon={<FileDownloadIcon />}
          onClick={onShow}
          disabled={disabled}
          sx={{
            ...quickSx,
            ...focusSx,
            color: 'text.secondary',
            bgcolor: 'transparent',
            border: 'none',
            boxShadow: 'none',
            fontWeight: 500,
            px: 1,
            '& .MuiButton-startIcon': { mr: 0.5 },
            '& .MuiButton-startIcon svg': { fontSize: 16 },
            '&:hover': {
              color: 'text.primary',
              bgcolor: 'transparent',
              boxShadow: 'none',
            },
          }}
        >
          {t('teamOpt.start.import', 'Import a rotation')}
        </Button>
        {importModal}
      </>
    )
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        flexWrap: 'wrap',
      }}
    >
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 30,
          borderRadius: tokens.radius.control,
          border: `1px solid ${tokens.hairlineStrong}`,
          bgcolor: alpha(giTokens.parchment, 0.02),
          overflow: 'hidden',
        }}
      >
        <Tooltip
          open={!!note}
          title={note ?? ''}
          placement="top"
          disableHoverListener
          disableFocusListener
          disableTouchListener
        >
          <span style={{ display: 'inline-flex' }}>
            <Button
              size="small"
              variant="text"
              color="inherit"
              startIcon={<FileUploadIcon />}
              onClick={copy}
              disabled={disabled || !hasAttacks}
              sx={transferBtnSx}
            >
              {t('teamOpt.transfer.exportAttacks', 'Export attacks')}
            </Button>
          </span>
        </Tooltip>
        <Box
          aria-hidden
          sx={{ width: '1px', height: 16, bgcolor: tokens.hairlineStrong }}
        />
        <Button
          size="small"
          variant="text"
          color="inherit"
          startIcon={<FileDownloadIcon />}
          onClick={onShow}
          disabled={disabled}
          sx={transferBtnSx}
        >
          {t('teamOpt.transfer.importAttacks', 'Import attacks')}
        </Button>
      </Box>
      {downloadFallback && (
        <Alert
          severity="info"
          action={
            <>
              <Button
                onClick={() => {
                  downloadJson('stellar-attacks.json', downloadFallback)
                  setDownloadFallback(undefined)
                }}
              >
                {t('teamOpt.transfer.download', 'Download JSON')}
              </Button>
              <IconButton
                size="small"
                color="inherit"
                aria-label={t('teamOpt.editor.close', 'Close')}
                onClick={() => setDownloadFallback(undefined)}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </>
          }
        >
          {t(
            'teamOpt.transfer.noClipboard',
            'Could not copy the attacks to the clipboard.'
          )}
        </Alert>
      )}
      {importModal}
    </Box>
  )
}

function ImportModal({
  members,
  onClose,
  onImport,
  hasWrittenRotation,
}: {
  members: TeamOptMember[]
  onClose: () => void
  onImport: (rotation: TeamRotation) => void
  hasWrittenRotation: boolean
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const [text, setText] = useState('')
  const rotation = useMemo(
    () => (text.trim() ? parseTeamRotation(text) : undefined),
    [text]
  )
  const keys = members.map((m) => m.characterKey)
  const inTeam = rotation ? keys.filter((k) => rotation.attacks[k]?.length) : []
  const skipped = rotation
    ? (Object.keys(rotation.attacks) as CharacterKey[]).filter(
        (k) => !keys.includes(k)
      )
    : []
  const usable = !!rotation && (inTeam.length > 0 || !!rotation.rotationTime)
  const names = (list: CharacterKey[]) =>
    list.map((k, i) => (
      <span key={k}>
        {i > 0 && ', '}
        <CharacterName characterKey={k} gender={gender} />
      </span>
    ))

  return (
    <ModalWrapper open onClose={onClose}>
      <CardThemed>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <Typography
            component="h2"
            sx={{
              ...type.title,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            {t('teamOpt.transfer.title', 'Import a team rotation')}
            <InfoTooltipInline
              title={t(
                'teamOpt.transfer.attackDesc',
                'Paste attack JSON to update the matching members, rotation time, and on-field member. Use Export Team to share the editable written rotations.'
              )}
            />
          </Typography>
          <TextField
            fullWidth
            multiline
            rows={4}
            autoFocus
            label={t('teamOpt.transfer.label', 'Rotation JSON')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            error={!!text.trim() && !rotation}
            helperText={
              text.trim() && !rotation
                ? t(
                    'teamOpt.transfer.invalid',
                    'This is not a team rotation export.'
                  )
                : undefined
            }
          />
          {rotation && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
              }}
            >
              {inTeam.map((k) => (
                <Box
                  key={k}
                  sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <MemberAvatar characterKey={k} size={22} />
                  <Typography variant="body2" sx={{ flexGrow: 1 }}>
                    <CharacterName characterKey={k} gender={gender} />
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('teamOpt.transfer.attacks', {
                      defaultValue: '{{count}} attacks',
                      count: rotation.attacks[k]?.length ?? 0,
                    })}
                  </Typography>
                </Box>
              ))}
              {!!rotation.rotationTime && (
                <Typography variant="body2" color="text.secondary">
                  {t('teamOpt.transfer.time', {
                    defaultValue: 'Rotation time: {{time}} s',
                    time: rotation.rotationTime,
                  })}
                </Typography>
              )}
              {!!skipped.length && (
                <Typography variant="body2" color="warning.main">
                  {t('teamOpt.transfer.skipped', 'Not in this team, skipped:')}{' '}
                  {names(skipped)}
                </Typography>
              )}
            </Box>
          )}
          {hasWrittenRotation && usable && (
            <Alert severity="info">
              {t(
                'teamOpt.transfer.switchSource',
                'This tab will calculate from the imported attacks. The written rotation stays available in the writer for you to reapply.'
              )}
            </Alert>
          )}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button variant="text" color="inherit" onClick={onClose}>
              {t('teamOpt.transfer.cancel', 'Cancel')}
            </Button>
            <Button
              variant="contained"
              startIcon={<FileDownloadIcon />}
              disabled={!usable}
              sx={usable ? giCtaSx : undefined}
              onClick={() => {
                if (!rotation) return
                onImport(rotation)
                onClose()
              }}
            >
              {hasWrittenRotation
                ? t('teamOpt.transfer.useImported', 'Use imported attacks')
                : t('teamOpt.transfer.import', 'Import')}
            </Button>
          </Box>
        </CardContent>
      </CardThemed>
    </ModalWrapper>
  )
}
