import { useBoolState } from '@genshin-optimizer/common/react-util'
import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { Team } from '@genshin-optimizer/gi/db'
import { useDatabase, useTeam } from '@genshin-optimizer/gi/db-ui'
import type { FightEstimate, FightTeam } from '@genshin-optimizer/gi/ui'
import {
  appliedStygianPreset,
  enemyFight,
  enemyHpOf,
  FIGHT_LIMIT,
  FightBreakdown,
  formatDuration,
  stygianDifficulties,
  stygianFightModelled,
  stygianPhaseName,
  teamDps,
} from '@genshin-optimizer/gi/ui'
import { Box, Button, Tooltip, Typography } from '@mui/material'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { hairline, insetSx, numSx, Segmented, type } from '../TeamOptimize/ui'
import { EnemyDialog } from './EnemyDialog'
import { EnemyHeadline, levelOf, ResGrid } from './EnemyPanel'
import { formatHp } from './hp'

const compact = (digits: number) =>
  new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumSignificantDigits: digits,
  })

/**
 * The enemy as a part of a setup (KQM theorycrafting's): what the builds are made against (a
 * Stygian boss, or an enemy set by hand: its HP and RES), how long they take to defeat it, and its
 * editor
 */
export function EnemySetup({
  teamId,
  fight,
  disabled,
}: {
  teamId: string
  /** The builds in the fight (their DPS, applications): how long they take */
  fight?: FightTeam
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const team = useTeam(teamId)
  const [open, onOpen, onClose] = useBoolState()
  if (!team) return null
  const stygian = appliedStygianPreset(team)
  return (
    <Box sx={{ ...insetSx, overflow: 'hidden', minWidth: 0, height: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 1.5,
          pr: 1,
          py: 0.75,
          minHeight: 48,
          borderBottom: hairline,
        }}
      >
        <Typography
          component="h3"
          sx={{
            ...type.title,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            flexGrow: 1,
          }}
        >
          {t('enemy.title', 'Enemy')}
          <InfoTooltipInline
            title={t(
              'enemy.setupTip',
              'The builds are made for this enemy: its level and RES (a Stygian Onslaught boss sets them at once); its HP says how long they take to defeat it. It is the team’s, shared with Team optimize and the members’ own pages.'
            )}
          />
        </Typography>
        <Button
          size="small"
          color="inherit"
          variant="outlined"
          onClick={onOpen}
          disabled={disabled}
        >
          {stygian ? t('enemy.change', 'Change') : t('enemy.edit', 'Edit')}
        </Button>
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, px: 1.5, py: 1.5 }}>
        <EnemyHeadline team={team} large hideHp hideRes />
        {stygian && (
          /* its difficulty, at once */
          <Segmented
            size="small"
            value={stygian.difficulty}
            onChange={(key) =>
              database.teams.set(teamId, (team) => {
                team.enemyOverride.enemyLevel = levelOf(key)
              })
            }
            aria-label={t('enemy.difficulty', 'Difficulty')}
            options={stygianDifficulties.map((d) => ({
              value: d.key,
              label:
                d.key === 'fearless'
                  ? t('enemy.fearless', {
                      defaultValue: 'Fearless · Lv. {{level}}',
                      level: d.level,
                    })
                  : t('enemy.dire', {
                      defaultValue: 'Dire · Lv. {{level}}',
                      level: d.level,
                    }),
            }))}
          />
        )}
        <EnemyFigures team={team} fight={fight} />
        {/* its RES, all eight */}
        <ResGrid team={team} />
      </Box>
      <EnemyDialog teamId={teamId} open={open} onClose={onClose} />
    </Box>
  )
}

/** What a boss's mechanics come to in its fight, in a few words (its breakdown: the tooltip's) */
function mechanicsLine(t: TFunction, estimate: FightEstimate) {
  for (const part of estimate.parts) {
    if (part.key === 'valiant')
      return t('enemy.valiantLine', {
        defaultValue: '{{count}} Valiant Assaults, ≈ {{time}} each',
        count: part.count,
        time: formatDuration(t, part.seconds),
      })
    if (part.key === 'horns')
      return part.count
        ? t('enemy.hornsLine', {
            defaultValue: 'Its horns broken {{count}} times',
            count: part.count,
          })
        : t('enemy.hornsKeptLine', 'Its horns never broken')
  }
  const phase = estimate.parts.find((p) => p.key === 'phase')
  return phase?.key === 'phase'
    ? t('enemy.phaseLine', {
        defaultValue: 'At its {{phase}} RES',
        phase: stygianPhaseName(t, phase.phase),
      })
    : ''
}

/**
 * The setup's two figures: the enemy's HP, and about how long the builds take to defeat it (its
 * breakdown in the tooltip)
 */
function EnemyFigures({ team, fight }: { team: Team; fight?: FightTeam }) {
  const { t } = useTranslation('page_team')
  const preset = appliedStygianPreset(team)
  const hp = enemyHpOf(team)
  const estimate =
    hp !== undefined && fight ? enemyFight(team, fight) : undefined
  const none = { ...type.figure, color: 'text.disabled' }
  const meta = { ...type.label, fontWeight: 400, ...numSx }
  // what the time is worked out from
  const from =
    hp === undefined
      ? t('enemy.needsHp', 'Needs its HP')
      : !fight || !estimate
        ? t('enemy.afterRun', 'Once there are builds for it')
        : !preset
          ? t('enemy.atDps', {
              defaultValue: 'At {{dps}} team DPS',
              dps: compact(3).format(teamDps(fight)),
            })
          : stygianFightModelled(preset.boss.id)
            ? mechanicsLine(t, estimate)
            : t('enemy.hpOverDps', 'Its HP ÷ the team’s DPS')
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      }}
    >
      <Box sx={{ minWidth: 0, pr: 1.5 }}>
        <Typography sx={type.label}>{t('enemy.hpLabel', 'HP')}</Typography>
        <Typography sx={hp === undefined ? none : type.figure}>
          {hp === undefined ? '–' : compact(3).format(hp)}
        </Typography>
        <Typography noWrap sx={meta}>
          {hp === undefined ? t('enemy.hpNotSet', 'Not set') : formatHp(hp)}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0, pl: 1.5, borderLeft: hairline }}>
        <Typography sx={type.label}>
          {t('enemy.timeToDefeat', 'Time to defeat')}
        </Typography>
        <Tooltip
          arrow
          title={
            estimate && hp !== undefined ? (
              <FightBreakdown estimate={estimate} hp={hp} custom={!preset} />
            ) : (
              ''
            )
          }
        >
          <Typography
            component="div"
            sx={{
              ...(estimate ? type.figure : none),
              cursor: estimate ? 'help' : undefined,
              width: 'fit-content',
            }}
          >
            {estimate ? (
              <>
                <Box
                  component="span"
                  sx={{ color: 'text.secondary', fontWeight: 500, mr: 0.5 }}
                >
                  {estimate.seconds !== undefined ? '≈' : '>'}
                </Box>
                {formatDuration(t, estimate.seconds ?? FIGHT_LIMIT)}
              </>
            ) : (
              '–'
            )}
          </Typography>
        </Tooltip>
        <Typography noWrap sx={meta}>
          {from}
        </Typography>
      </Box>
    </Box>
  )
}
