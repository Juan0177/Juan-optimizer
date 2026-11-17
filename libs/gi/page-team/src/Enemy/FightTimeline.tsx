import { stygianBossIcons } from '@genshin-optimizer/gi/assets'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type {
  FightEnemy,
  FightEvent,
  FightSegment,
  FightTeam,
} from '@genshin-optimizer/gi/ui'
import {
  appliedStygianPreset,
  enemyFight,
  enemyHpOf,
  FIGHT_LIMIT,
  formatDuration,
  formatFightTime,
  stygianBossName,
  stygianPhaseName,
} from '@genshin-optimizer/gi/ui'
import type { Theme } from '@mui/material'
import { alpha, Box, Tooltip, Typography, useTheme } from '@mui/material'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { hairline, insetSx, numSx, tokens, type } from '../TeamOptimize/ui'

/** A state's colour: its RES's (shielded: water, horns: fire, a weak carapace: rock) */
function stateColor(theme: Theme, state: FightSegment['state']) {
  switch (state) {
    case 'shielded':
    case 'enhanced':
    case 'rage':
    case 'geohuman':
      return theme.palette.hydro.main
    case 'horns':
    case 'molten':
      return theme.palette.pyro.main
    case 'dullCarapace':
    case 'weakened':
    case 'stunned':
      return theme.palette.geo.main
    default:
      return alpha(giTokens.parchment, 0.32)
  }
}

/** Time marks: a step giving at most ~8 of them */
function marks(end: number) {
  const step = [15, 30, 60, 120, 300].find((s) => end / s <= 8) ?? 300
  const out: number[] = []
  for (let t = 0; t <= end + 0.01; t += step) out.push(t)
  return out
}

const compact = (digits: number) =>
  new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumSignificantDigits: digits,
  })

/**
 * The fight against the enemy, over time: its HP and, a Stygian Onslaught boss's, its state (its
 * phases; the Emperor's horns), with the moments its mechanics take HP off at once. An enemy set
 * by hand: its HP going down at the team's DPS. Its HP unknown: nothing
 */
export function FightTimeline({
  enemy,
  team,
}: {
  enemy: FightEnemy
  team?: FightTeam
}) {
  const { t } = useTranslation(['page_team', 'stygian'])
  const theme = useTheme()
  const preset = appliedStygianPreset(enemy)
  const estimate = useMemo(
    () => (team ? enemyFight(enemy, team) : undefined),
    [enemy, team]
  )
  const hp = enemyHpOf(enemy)
  if (!estimate || hp === undefined) return null
  const { segments, events } = estimate.timeline
  const end = Math.max(
    1,
    estimate.seconds ?? segments[segments.length - 1]?.end ?? FIGHT_LIMIT
  )
  const x = (s: number) => `${(Math.min(s, end) / end) * 100}%`
  // the HP line: each stretch, then each moment's drop
  const points: [number, number][] = []
  for (const seg of segments) {
    points.push([seg.start, seg.hpStart], [seg.end, seg.hpEnd])
    const event = events.find((e) => Math.abs(e.t - seg.end) < 1e-6)
    if (event) points.push([event.t, Math.max(0, seg.hpEnd - event.hp)])
  }
  const W = 1000
  const H = 100
  const path = points
    .map(
      ([s, hp], i) =>
        `${i ? 'L' : 'M'}${((Math.min(s, end) / end) * W).toFixed(2)},${((1 - hp) * H).toFixed(2)}`
    )
    .join(' ')
  const area = `${path} L${((Math.min(points[points.length - 1]?.[0] ?? 0, end) / end) * W).toFixed(2)},${H} L0,${H} Z`
  const states = [...new Set(segments.map((s) => s.state))]
  const stateName = (state: FightSegment['state']) =>
    state === 'horns'
      ? t('enemy.fight.hornsState', 'Horns on (+150% RES)')
      : state === 'shielded' && preset?.boss.id === 1013061
        ? t('enemy.fight.valiantAssault', 'Valiant Assault (shielded)')
        : stygianPhaseName(t, state)
  const eventName = (e: FightEvent) =>
    e.kind === 'backlash'
      ? t('enemy.fight.backlashAt', {
          defaultValue: 'Backlash: −{{hp}}% of its HP',
          hp: (e.hp * 100).toFixed(1),
        })
      : t('enemy.fight.hornsBreakAt', {
          defaultValue: 'Horns broken: −{{hp}}% of its HP',
          hp: (e.hp * 100).toFixed(1),
        })
  const icon = preset && stygianBossIcons[preset.boss.id]
  return (
    <Box
      component="section"
      aria-label={t('enemy.fight.title', 'Fight timeline')}
      sx={{ ...insetSx, p: { xs: 1.5, sm: 2 }, display: 'grid', gap: 1.5 }}
    >
      {/* the boss, and how long */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1.25,
        }}
      >
        {icon && (
          <Box
            component="img"
            src={icon}
            alt=""
            aria-hidden
            sx={{ width: 36, height: 36, borderRadius: 1.5, flexShrink: 0 }}
          />
        )}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography component="h3" sx={type.title}>
            {t('enemy.fight.title', 'Fight timeline')}
          </Typography>
          <Typography sx={{ ...type.label, ...numSx }}>
            {preset
              ? [
                  stygianBossName(t, preset.boss.id),
                  preset.difficulty === 'fearless'
                    ? t('enemy.fearlessShort', {
                        defaultValue: 'Fearless, Lv. {{level}}',
                        level: enemy.enemyOverride.enemyLevel,
                      })
                    : t('enemy.direShort', {
                        defaultValue: 'Dire, Lv. {{level}}',
                        level: enemy.enemyOverride.enemyLevel,
                      }),
                ].join(' · ')
              : [
                  t('enemy.customShort', 'Custom enemy'),
                  t('enemy.hp', {
                    defaultValue: '{{hp}} HP',
                    hp: compact(3).format(hp),
                  }),
                  t('enemy.levelShort', {
                    defaultValue: 'Lv. {{level}}',
                    level: enemy.enemyOverride.enemyLevel ?? 100,
                  }),
                ].join(' · ')}
          </Typography>
        </Box>
        <Typography sx={{ ...type.stat, fontSize: 17 }}>
          {estimate.seconds !== undefined
            ? t('enemy.stygian.defeat', {
                defaultValue: '≈ {{time}} to defeat',
                time: formatDuration(t, estimate.seconds),
              })
            : t('enemy.stygian.defeatOver', {
                defaultValue: 'over {{time}} to defeat',
                time: formatDuration(t, FIGHT_LIMIT),
              })}
        </Typography>
      </Box>

      {/* its state (a boss's), then its HP over the fight */}
      <Box sx={{ display: 'grid', gap: 0.5 }}>
        <Box
          sx={{
            display: preset ? 'block' : 'none',
            position: 'relative',
            height: 12,
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: alpha(giTokens.parchment, 0.06),
          }}
        >
          {segments.map((seg) => (
            <Tooltip
              key={`${seg.start}`}
              arrow
              title={`${stateName(seg.state)} · ${formatFightTime(seg.start)}–${formatFightTime(seg.end)}`}
            >
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: x(seg.start),
                  width: `calc(${x(seg.end)} - ${x(seg.start)})`,
                  bgcolor: stateColor(theme, seg.state),
                  opacity: seg.state === 'regular' ? 1 : 0.85,
                  borderRight: `1px solid ${giTokens.panelDark}`,
                }}
              />
            </Tooltip>
          ))}
        </Box>
        <Box sx={{ position: 'relative', height: 96 }}>
          <Box
            component="svg"
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
            }}
          >
            <defs>
              <linearGradient id="fight-hp" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={giTokens.gold} stopOpacity="0.32" />
                <stop offset="1" stopColor={giTokens.gold} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                x2={W}
                y1={f * H}
                y2={f * H}
                stroke={giTokens.hairline}
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={area} fill="url(#fight-hp)" />
            <path
              d={path}
              fill="none"
              stroke={giTokens.gold}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </Box>
          {/* the moments that take HP off at once */}
          {events.map((e) => {
            const before =
              segments.find((s) => Math.abs(s.end - e.t) < 1e-6)?.hpEnd ?? 0
            return (
              <Tooltip
                key={`${e.t}`}
                arrow
                title={`${eventName(e)} · ${formatFightTime(e.t)}`}
              >
                <Box
                  sx={{
                    position: 'absolute',
                    left: x(e.t),
                    top: `${(1 - before) * 100}%`,
                    width: 10,
                    height: 10,
                    ml: '-5px',
                    mt: '-5px',
                    borderRadius: '50%',
                    bgcolor:
                      e.kind === 'backlash'
                        ? theme.palette.electro.main
                        : theme.palette.pyro.main,
                    boxShadow: `0 0 0 2px ${giTokens.panelDark}`,
                    cursor: 'help',
                  }}
                />
              </Tooltip>
            )
          })}
          {/* (its HP: 100% at the top) */}
          <Typography
            sx={{
              ...type.label,
              position: 'absolute',
              top: -2,
              left: 4,
              fontSize: 11,
              pointerEvents: 'none',
            }}
          >
            {t('enemy.fight.hpAxis', 'HP')}
          </Typography>
        </Box>
        {/* the time marks */}
        <Box sx={{ position: 'relative', height: 16 }}>
          {marks(end).map((m) => (
            <Typography
              key={m}
              sx={{
                ...type.label,
                ...numSx,
                fontSize: 11,
                position: 'absolute',
                left: x(m),
                transform:
                  m === 0
                    ? 'none'
                    : m >= end - 1
                      ? 'translateX(-100%)'
                      : 'translateX(-50%)',
              }}
            >
              {formatFightTime(m)}
            </Typography>
          ))}
        </Box>
      </Box>

      {/* what the colours are */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 0.5,
          pt: 1,
          borderTop: hairline,
        }}
      >
        {!preset && (
          <Typography sx={{ ...type.label, fontWeight: 400 }}>
            {t(
              'enemy.fight.customHint',
              'Its HP ÷ the team’s DPS, the rotation repeated'
            )}
          </Typography>
        )}
        {(preset ? states : []).map((state) => (
          <Box
            key={state}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              fontSize: 12.5,
              color: 'text.secondary',
            }}
          >
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: tokens.radius.control / 2,
                bgcolor: stateColor(theme, state),
              }}
            />
            {stateName(state)}
          </Box>
        ))}
        {events.length > 0 && (
          <Typography sx={{ ...type.label, fontWeight: 400, ml: 'auto' }}>
            {t(
              'enemy.fight.eventsHint',
              'Dots: HP its mechanics take off at once'
            )}
          </Typography>
        )}
      </Box>
    </Box>
  )
}
