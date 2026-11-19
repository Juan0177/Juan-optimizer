import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDatabase, useTeam } from '@genshin-optimizer/gi/db-ui'
import {
  type RotationTemplate,
  templatesForTeam,
} from '@genshin-optimizer/gi/ui'
import { giTokens } from '@genshin-optimizer/gi/theme'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import { alpha, Box, ButtonBase, Typography } from '@mui/material'
import { type ReactNode, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import { TemplateCards } from './RotationTemplates'
import { focusSx, hairline, quickSx, tokens, type } from './ui'

/** Whether this tab has moved from the start screen to manual attack entry. */
export function useManualStart(teamId: string, kqm: boolean) {
  const database = useDatabase()
  const document =
    useTeam(teamId)?.rotationDocuments?.[kqm ? 'kqm' : 'inventory']
  const chooseManual = useCallback(() => {
    database.teams.setRotationField(
      kqm ? `${teamId}_kqm` : teamId,
      'Manual',
      '1'
    )
  }, [database, kqm, teamId])
  return { manual: document?.Manual === '1', chooseManual }
}

/** The tiles' picture area (shorter on phones, where the tiles stack) */
const PREVIEW_HEIGHT = { xs: 92, sm: 112 }

/**
 * The rotation before it has anything in it: two ways to start, each a tile with a small picture
 * of what it gives (a written line of the team's actions; the members' attack rows). Writing opens
 * the writer; adding attacks shows the members' attack lists (remembered). Under them, the built-in
 * templates for the team's main DPS (one opens in the writer). `footer`: Import.
 */
export function TeamOptimizeStart({
  members,
  onWrite,
  onTemplate,
  onManual,
  footer,
  disabled,
}: {
  members: CharacterKey[]
  onWrite: () => void
  onTemplate: (template: RotationTemplate) => void
  onManual: () => void
  footer?: ReactNode
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const templates = useMemo(() => templatesForTeam(members), [members])
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: { xs: 2.5, sm: 5 },
      }}
    >
      <Typography
        component="h3"
        sx={{
          ...type.step,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          mb: 2.5,
        }}
      >
        {t('teamOpt.start.heading', 'Set up the rotation')}
        <InfoTooltipInline
          title={t(
            'teamOpt.start.info',
            'Write rotation: type it the way players do ("Bennett E Q -> …"); the attacks, hits and timing come from each kit. Add attacks: pick each member’s talents and hits by hand.'
          )}
        />
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
          },
          gap: 1.5,
          width: '100%',
          maxWidth: 620,
        }}
      >
        <Tile
          main
          label={t('teamOpt.start.write', 'Write rotation')}
          onClick={onWrite}
          disabled={disabled}
        >
          <WrittenLine members={members} />
        </Tile>
        <Tile
          label={t('teamOpt.start.manual', 'Add attacks')}
          onClick={onManual}
          disabled={disabled}
        >
          <AttackRows members={members} />
        </Tile>
      </Box>
      {!disabled && (
        <TemplateCards
          templates={templates}
          team={members}
          onPick={onTemplate}
        />
      )}
      {footer && <Box sx={{ mt: 2 }}>{footer}</Box>}
    </Box>
  )
}

function Tile({
  main,
  label,
  onClick,
  disabled,
  children,
}: {
  main?: boolean
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  const gold = giTokens.gold
  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      focusRipple
      aria-label={label}
      sx={{
        ...quickSx,
        ...focusSx,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        overflow: 'hidden',
        textAlign: 'left',
        borderRadius: tokens.radius.inset,
        bgcolor: tokens.inset,
        border: hairline,
        borderColor: main ? alpha(gold, 0.4) : tokens.hairline,
        '&:hover': {
          bgcolor: alpha(giTokens.parchment, 0.025),
          borderColor: main ? alpha(gold, 0.75) : tokens.hairlineStrong,
        },
        '&:hover .tile-arrow': { color: main ? gold : 'text.primary' },
        '&.Mui-disabled': { opacity: 0.5 },
      }}
    >
      <Box
        aria-hidden
        sx={{
          height: PREVIEW_HEIGHT,
          display: 'grid',
          placeItems: 'center',
          px: 2,
          borderBottom: hairline,
        }}
      >
        {children}
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2,
          py: 1.5,
        }}
      >
        <Typography sx={{ ...type.title, flexGrow: 1 }}>{label}</Typography>
        <ArrowForwardRoundedIcon
          className="tile-arrow"
          sx={{
            ...quickSx,
            fontSize: 18,
            color: main ? gold : 'text.secondary',
          }}
        />
      </Box>
    </ButtonBase>
  )
}

/** A key of the written rotation (E, Q, N3, CA) */
function Key({ children }: { children: string }) {
  return (
    <Box
      component="span"
      sx={{
        height: 24,
        minWidth: 24,
        px: 0.75,
        display: 'inline-grid',
        placeItems: 'center',
        borderRadius: 1,
        border: `1px solid ${tokens.hairlineStrong}`,
        bgcolor: tokens.panel,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 12,
        fontWeight: 600,
        color: 'text.primary',
        lineHeight: 1,
      }}
    >
      {children}
    </Box>
  )
}

/** "Support E Q → Main N3 CA", with the team's own faces, and the writer's caret */
function WrittenLine({ members }: { members: CharacterKey[] }) {
  const [main, support] = members
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      {support && (
        <>
          <MemberAvatar characterKey={support} size={24} />
          <Key>E</Key>
          <Key>Q</Key>
          <ArrowForwardRoundedIcon
            sx={{ fontSize: 14, color: 'text.secondary', mx: 0.5 }}
          />
        </>
      )}
      {main && <MemberAvatar characterKey={main} size={24} />}
      {!support && <Key>E</Key>}
      <Key>N3</Key>
      <Key>CA</Key>
      <Box
        component="span"
        sx={{
          width: 2,
          height: 18,
          ml: 0.25,
          borderRadius: 1,
          bgcolor: giTokens.gold,
        }}
      />
    </Box>
  )
}

/** The members' attack rows, each with its add button */
function AttackRows({ members }: { members: CharacterKey[] }) {
  return (
    <Box
      sx={{
        width: '100%',
        maxWidth: 210,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
      }}
    >
      {members.slice(0, 3).map((k, i) => (
        <Box key={k} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MemberAvatar characterKey={k} size={20} />
          <Box
            sx={{
              height: 6,
              borderRadius: 3,
              width: `${[46, 34, 40][i]}%`,
              bgcolor: alpha(giTokens.parchment, 0.14),
            }}
          />
          <Box
            sx={{
              height: 6,
              borderRadius: 3,
              width: `${[16, 22, 12][i]}%`,
              bgcolor: alpha(giTokens.parchment, 0.07),
            }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <Box
            sx={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              border: `1px solid ${tokens.hairlineStrong}`,
              color: 'text.secondary',
              '& svg': { fontSize: 13 },
            }}
          >
            <AddRoundedIcon />
          </Box>
        </Box>
      ))}
    </Box>
  )
}
