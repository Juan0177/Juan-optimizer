import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type { KqmResult, KqmTeamOption } from '@genshin-optimizer/gi/ui'
import { kqmSetsId, kqmTopTeams } from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Divider,
  IconButton,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatGain, formatRateFull } from './format'
import { KqmGearIcons } from './KqmBuildView'
import { MemberAvatar } from './MemberAvatar'
import { FieldLabel, focusSx, numSx, quickSx, tokens, type } from './ui'

/** Rows on the page; all of them (at most `MAX`) in the window */
const SHOWN = 5
const MAX = 50

/** How far a team is from the best: −0.4%; under 0.1%, two decimals (−0.04%) */
function gap(ratio: number) {
  const pct = ratio * 100
  if (Math.abs(pct) >= 0.1 || pct === 0) return formatGain(ratio)
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`
}

const gearId = (
  b: KqmTeamOption['builds'][CharacterKey] | undefined
): string =>
  b ? `${b.weapon.key}@${b.weapon.refinement}|${kqmSetsId(b.sets)}` : ''

/**
 * The run's team, then the best teams that change one member's weapon or sets, at a glance:
 * each member's weapon and sets, the team's DPS, and how far it is from the best. The first few
 * here, all of them (top 50) in a window. Picking one shows that team (as picking its equipment
 * in the inspector).
 */
export function KqmTopTeams({
  result,
  view,
  rotationTime,
  disabled,
  onPick,
}: {
  result: KqmResult
  /** The team shown now (with the equipment picked) */
  view: KqmResult
  rotationTime?: number
  disabled?: boolean
  onPick: (option: KqmTeamOption) => void
}) {
  const { t } = useTranslation('page_team')
  const [open, setOpen] = useState(false)
  const options = useMemo(() => kqmTopTeams(result, MAX), [result])
  if (options.length < 2) return null
  const members = result.optimized
  const current = options.findIndex((o) =>
    members.every((ck) => gearId(o.builds[ck]) === gearId(view.builds[ck]))
  )
  const title = t('teamOpt.kqm.topBuilds', 'Top builds')
  const rows = (count: number, pick: (option: KqmTeamOption) => void) => (
    <TeamRows
      options={options.slice(0, count)}
      members={members}
      current={current}
      rotationTime={rotationTime}
      disabled={disabled}
      onPick={pick}
    />
  )
  return (
    <Box component="section" aria-label={title} sx={{ minWidth: 0 }}>
      <FieldLabel
        tip={t(
          'teamOpt.kqm.topBuildsTip',
          'The best builds, then the best that change one member’s weapon or artifact sets. Pick one to see it.'
        )}
        sx={{ mb: 0.75 }}
      >
        {title}
      </FieldLabel>
      {rows(SHOWN, onPick)}
      {options.length > SHOWN && (
        <Button
          size="small"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          sx={{ mt: 0.5, color: 'text.secondary', textTransform: 'none' }}
        >
          {t('teamOpt.kqm.topBuildsAll', {
            defaultValue: 'Show top {{count}}',
            count: options.length,
          })}
        </Button>
      )}
      {open && (
        <ModalWrapper
          open
          onClose={() => setOpen(false)}
          containerProps={{ maxWidth: 'lg' }}
        >
          <CardThemed>
            <Box role="dialog" aria-label={title}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2.5,
                  pt: 2,
                  pb: 1.5,
                }}
              >
                <Typography component="h2" sx={{ ...type.title, flexGrow: 1 }}>
                  {t('teamOpt.kqm.topBuildsCount', {
                    defaultValue: 'Top {{count}} builds',
                    count: options.length,
                  })}
                </Typography>
                <IconButton
                  onClick={() => setOpen(false)}
                  aria-label={t('teamOpt.editor.close', 'Close')}
                >
                  <CloseIcon />
                </IconButton>
              </Box>
              <Divider />
              <Box sx={{ p: 2, maxHeight: '75vh', overflowY: 'auto' }}>
                {/* (a team picked here is shown on the page) */}
                {rows(options.length, (option) => {
                  onPick(option)
                  setOpen(false)
                })}
              </Box>
            </Box>
          </CardThemed>
        </ModalWrapper>
      )}
    </Box>
  )
}

/**
 * The teams as a table: the members head its columns (their portraits, once), each row their
 * weapons and sets, the team's DPS and how far it is from the best. The member a team changes is in
 * full and outlined; the others, as in the best team, faint. Rows share their columns (a subgrid),
 * so every member's gear lines up down the table.
 */
function TeamRows({
  options,
  members,
  current,
  rotationTime,
  disabled,
  onPick,
}: {
  options: KqmTeamOption[]
  members: CharacterKey[]
  /** The row of the team shown now (−1: none) */
  current: number
  rotationTime?: number
  disabled?: boolean
  onPick: (option: KqmTeamOption) => void
}) {
  const { t } = useTranslation('page_team')
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  // (a phone: smaller icons and gaps, so the table and its DPS column fit without scrolling)
  const icon = narrow ? 22 : 34
  const best = options[0]?.total ?? 0
  const unit = rotationTime
    ? t('teamOpt.kqm.teamDps', 'team DPS')
    : t('teamOpt.kqm.teamDmg', 'team DMG')
  // (the members share the width: each column at least its gear, the rest spread evenly, so the
  // gear sits under its member's portrait across the table, not bunched at the left)
  const columns = `24px repeat(${members.length}, minmax(max-content, 1fr)) auto`
  const rowSx = {
    gridColumn: '1 / -1',
    display: 'grid',
    gridTemplateColumns: 'subgrid',
    alignItems: 'center',
    px: { xs: 0.75, sm: 1.5 },
  } as const
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: columns,
        columnGap: { xs: 0.5, sm: 1.5 },
        border: `1px solid ${tokens.hairlineStrong}`,
        borderRadius: tokens.radius.inset,
        overflowX: 'auto',
        overflowY: 'hidden',
      }}
    >
      {/* the head: the members, once (a picture of the columns: each row's button names its team) */}
      <Box
        aria-hidden
        sx={{
          ...rowSx,
          py: { xs: 0.75, sm: 1 },
          borderBottom: `1px solid ${tokens.hairline}`,
          bgcolor: alpha(theme.palette.text.primary, 0.02),
        }}
      >
        <Typography sx={{ fontSize: 11.5, color: 'text.secondary', ...numSx }}>
          #
        </Typography>
        {members.map((ck) => (
          <Box key={ck} sx={{ display: 'flex', justifyContent: 'center' }}>
            <MemberAvatar characterKey={ck} size={narrow ? icon - 2 : icon} />
          </Box>
        ))}
        <Typography
          sx={{
            fontSize: 11.5,
            color: 'text.secondary',
            textAlign: 'right',
            whiteSpace: 'nowrap',
          }}
        >
          {narrow
            ? rotationTime
              ? t('teamOpt.kqm.dps', 'DPS')
              : t('teamOpt.kqm.dmg', 'DMG')
            : unit}
        </Typography>
      </Box>
      {options.map((option, i) => {
        const selected = i === current
        const value = formatRateFull(option.total, rotationTime)
        return (
          <ButtonBase
            key={
              option.changed
                ? `${option.changed}|${gearId(option.builds[option.changed])}`
                : 'best'
            }
            aria-pressed={selected}
            aria-label={t('teamOpt.kqm.topBuildLabel', {
              defaultValue: 'Rank {{rank}}: {{value}} {{unit}}',
              rank: i + 1,
              value,
              unit,
            })}
            disabled={disabled}
            onClick={() => onPick(option)}
            sx={(theme) => ({
              ...rowSx,
              py: { xs: 0.75, sm: 1 },
              textAlign: 'left',
              borderTop: i ? `1px solid ${tokens.hairline}` : undefined,
              bgcolor: selected
                ? alpha(theme.palette.primary.main, 0.1)
                : 'transparent',
              boxShadow: selected
                ? `inset 2px 0 0 ${theme.palette.primary.main}`
                : undefined,
              ...quickSx,
              ...focusSx,
              '&:hover': {
                bgcolor: selected
                  ? alpha(theme.palette.primary.main, 0.14)
                  : alpha(theme.palette.text.primary, 0.035),
              },
              '&.Mui-disabled': { opacity: 0.6 },
            })}
          >
            <Typography
              sx={{
                fontSize: 12.5,
                fontWeight: 600,
                color: selected ? 'primary.main' : 'text.secondary',
                ...numSx,
              }}
            >
              {i + 1}
            </Typography>
            {members.map((ck) => {
              const build = option.builds[ck]
              const changed = ck === option.changed
              return (
                // (the column spreads; the highlight hugs the member's gear)
                <Box
                  key={ck}
                  sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                  }}
                >
                  {option.changed && !changed ? (
                    // a member as in the best team (#1, above): a quiet dash, so the change stands out
                    <Tooltip
                      arrow
                      title={t('teamOpt.kqm.sameAsBest', 'Same as #1')}
                    >
                      <Box
                        sx={(theme) => ({
                          width: 18,
                          height: 2,
                          my: 1.5,
                          borderRadius: 1,
                          bgcolor: alpha(theme.palette.text.primary, 0.2),
                        })}
                      />
                    </Tooltip>
                  ) : (
                    <Box
                      data-changed={changed || undefined}
                      sx={{
                        display: 'inline-flex',
                        p: { xs: 0.375, sm: 0.625 },
                        borderRadius: tokens.radius.inset,
                        ...quickSx,
                        // the member this team changes, against the best one: lit in gold
                        ...(changed && {
                          bgcolor: alpha(giTokens.gold, 0.16),
                          boxShadow: `inset 0 0 0 1.5px ${alpha(giTokens.gold, 0.9)}, 0 0 0 3px ${alpha(giTokens.gold, 0.1)}, 0 6px 18px ${alpha(giTokens.gold, 0.14)}`,
                        }),
                      }}
                    >
                      {build && (
                        <KqmGearIcons
                          characterKey={ck}
                          build={build}
                          size={icon}
                        />
                      )}
                    </Box>
                  )}
                </Box>
              )
            })}
            <Box sx={{ textAlign: 'right', ...numSx }}>
              <Typography
                sx={{
                  fontSize: { xs: 13, sm: 14.5 },
                  fontWeight: 650,
                  lineHeight: 1.3,
                  whiteSpace: 'nowrap',
                }}
              >
                {value}
              </Typography>
              {i > 0 && (
                <Typography
                  sx={{
                    fontSize: 11.5,
                    lineHeight: 1.3,
                    color: 'text.secondary',
                  }}
                >
                  {gap(option.total / best - 1)}
                </Typography>
              )}
            </Box>
          </ButtonBase>
        )
      })}
    </Box>
  )
}
