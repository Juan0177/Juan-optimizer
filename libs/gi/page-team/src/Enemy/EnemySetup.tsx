import { useBoolState } from '@genshin-optimizer/common/react-util'
import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { Team } from '@genshin-optimizer/gi/db'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type { FightEstimate, FightTeam } from '@genshin-optimizer/gi/ui'
import {
  appliedStygianPreset,
  enemyFight,
  enemyHpOf,
  FIGHT_LIMIT,
  FightBreakdown,
  formatDuration,
  MOONGECKO_BOSS,
  stygianDifficulties,
  stygianFightModelled,
  stygianPhaseName,
  teamDps,
} from '@genshin-optimizer/gi/ui'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Tooltip,
  Typography,
} from '@mui/material'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  tokens,
  type,
} from '../TeamOptimize/ui'
import { EnemyDialog } from './EnemyDialog'
import { EnemyHeadline, levelOf, ResGrid } from './EnemyPanel'
import { useEnemyTeam, useSetEnemy } from './enemyScope'
import { formatHp } from './hp'
import { MoongeckoSettings, StartEnergySetting } from './MoongeckoSettings'

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
  const setEnemy = useSetEnemy(teamId)
  const team = useEnemyTeam(teamId)
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
              'The builds are made for this enemy: its level and RES (a Stygian Onslaught boss sets them at once); its HP says how long they take to defeat it. It is the team’s, shared with Team optimize, KQM theorycrafting and the members’ own pages.'
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
      {/* one column (KQM's setup, beside the members); a wide panel (Team optimize's): the enemy,
          its figures and its RES side by side */}
      <Box sx={{ px: 1.5, py: 1.5, containerType: 'inline-size' }}>
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            '@container (min-width: 860px)': {
              gridTemplateColumns:
                'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.25fr)',
              columnGap: 3,
              alignItems: 'start',
            },
          }}
        >
          <Box sx={{ display: 'grid', gap: 1.5, minWidth: 0 }}>
            <EnemyHeadline team={team} large hideHp hideRes />
            {stygian && (
              /* its difficulty, at once */
              <Segmented
                size="small"
                value={stygian.difficulty}
                onChange={(key) =>
                  setEnemy((team) => {
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
          </Box>
          <EnemyFigures
            team={team}
            fight={fight}
            onEdit={disabled ? undefined : onOpen}
          />
          {/* its RES, all eight */}
          <ResGrid team={team} />
        </Box>
        {/* a boss's: how the fight starts, and how the team plays the Moongecko where its fight
            cannot tell (whether it can be frozen: in Edit) */}
        {stygian && (
          <Box
            sx={{
              display: 'grid',
              gap: 1.25,
              pt: 1.5,
              mt: 1.5,
              borderTop: `1px solid ${giTokens.hairline}`,
            }}
          >
            <StartEnergySetting
              teamId={teamId}
              team={team}
              disabled={disabled}
            />
            {stygian.boss.id === MOONGECKO_BOSS && (
              <MoongeckoSettings
                teamId={teamId}
                team={team}
                fight={fight}
                disabled={disabled}
              />
            )}
          </Box>
        )}
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
    if (part.key === 'anchors')
      return part.broken
        ? t('enemy.anchorsLine', {
            defaultValue: '{{count}} Anchors, each ward ≈ {{time}}',
            count: part.count,
            time: formatDuration(t, part.seconds),
          })
        : t('enemy.anchorsKeptLine', {
            defaultValue: '{{count}} Anchors, wards not broken in time',
            count: part.count,
          })
    if (part.key === 'sweeper')
      return t('enemy.sweeperLine', {
        defaultValue: '{{count}} Sweeper Modes, stopped {{time}}',
        count: part.count,
        time: formatDuration(t, part.stopped),
      })
    if (part.key === 'sculptures')
      return t('enemy.sculpturesLine', {
        defaultValue:
          '{{interrupted}} of {{count}} sculptings turned to statues',
        count: part.count,
        interrupted: part.interrupted,
      })
    if (part.key === 'coffins')
      return t('enemy.coffinsLine', {
        defaultValue: '{{broken}} of {{count}} Ice Coffins broken',
        count: part.count,
        broken: part.broken,
      })
    if (part.key === 'electroWards')
      return part.broken
        ? t('enemy.electroWardsLine', {
            defaultValue: '{{count}} wards broken, ≈ {{time}} each',
            count: part.broken,
            time: formatDuration(t, part.seconds),
          })
        : t('enemy.electroWardsKeptLine', 'Its Electro Ward never broken')
    if (part.key === 'countermeasures')
      return part.seconds !== undefined
        ? t('enemy.countermeasuresLine', {
            defaultValue: 'Its shield breaks at {{time}}',
            time: formatDuration(t, part.seconds),
          })
        : t('enemy.countermeasuresKeptLine', 'Its shield never breaks')
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
function EnemyFigures({
  team,
  fight,
  onEdit,
}: {
  team: Team
  fight?: FightTeam
  /** Opens its editor (no HP yet: "Set its HP" does) */
  onEdit?: () => void
}) {
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
        {hp === undefined && onEdit ? (
          <ButtonBase
            onClick={onEdit}
            sx={{
              ...meta,
              color: 'text.primary',
              fontWeight: 600,
              textDecoration: 'underline',
              textUnderlineOffset: 3,
              textDecorationColor: alpha(giTokens.parchment, 0.4),
              borderRadius: tokens.radius.control,
              ...quickSx,
              ...focusSx,
              '&:hover': { textDecorationColor: 'currentColor' },
            }}
          >
            {t('enemy.setHp', 'Set its HP')}
          </ButtonBase>
        ) : (
          <Typography noWrap sx={meta}>
            {hp === undefined ? t('enemy.hpNotSet', 'Not set') : formatHp(hp)}
          </Typography>
        )}
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
