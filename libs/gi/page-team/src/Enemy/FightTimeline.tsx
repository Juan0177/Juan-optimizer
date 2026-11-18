import { stygianBossIcons } from '@genshin-optimizer/gi/assets'
import type { ElementWithPhyKey } from '@genshin-optimizer/gi/consts'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type {
  FightEnemy,
  FightEstimate,
  FightEvent,
  FightSegment,
  FightTeam,
  StygianRes,
} from '@genshin-optimizer/gi/ui'
import {
  appliedStygianPreset,
  enemyFight,
  enemyHpOf,
  FIGHT_LIMIT,
  formatDuration,
  formatFightTime,
  MOONGECKO,
  StygianResSummary,
  stygianBossName,
  stygianPhaseName,
} from '@genshin-optimizer/gi/ui'
import type { Theme } from '@mui/material'
import { alpha, Box, ButtonBase, Typography, useTheme } from '@mui/material'
import type { TFunction } from 'i18next'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { siteDecimal } from '../TeamOptimize/format'
import {
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  tokens,
  type,
} from '../TeamOptimize/ui'

/**
 * A state's colour: its RES's (shielded or cocooned: water, horns: fire, weakened or stunned:
 * rock), a ward up (rock, faint), out of reach (none), the team buffed (gold); its regular RES
 * (the Moongecko's Dull Carapace) the lane's own
 */
function stateColor(theme: Theme, state: FightSegment['state']) {
  switch (state) {
    case 'shielded':
    case 'enhanced':
    case 'rage':
    case 'geohuman':
    case 'enhancedCocoon':
      return theme.palette.hydro.main
    case 'drinking':
      return alpha(theme.palette.hydro.main, 0.45)
    case 'cocooned':
      return alpha(theme.palette.hydro.main, 0.7)
    case 'horns':
    case 'molten':
      return theme.palette.pyro.main
    case 'weakened':
    case 'stunned':
      return theme.palette.geo.main
    case 'ward':
      return alpha(theme.palette.geo.main, 0.4)
    case 'leap':
      return alpha(giTokens.parchment, 0.1)
    case 'disentangled':
      return giTokens.gold
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

const W = 1000
const H = 100
/** The lanes' heights (px): its state, its HP, its meter, the team's DPS, the time marks */
const STATE_H = 12
const HP_H = 96
const METER_H = 40
const DPS_H = 40
const MARKS_H = 16

/** The fight at one moment: its state there, its HP, its meter and its shield's take so far */
interface Moment {
  t: number
  seg: FightSegment
  /** Its HP (a fraction of its Max HP) */
  hp: number
  meter?: number
  /** How fast its meter moves there (per second) */
  rate?: number
  /** A shield state: what its shield has taken so far, and the backlash it comes to */
  absorbed?: number
  backlash?: number
  /** One of its mechanics' moments, at the cursor */
  event?: FightEvent
}

/**
 * The fight against the enemy, over time: its HP and, a Stygian Onslaught boss's, its state (its
 * phases; the Emperor's horns; Wavebinder's drinks) and its meter (Wavebinder's Courage, the
 * Emperor's horn gauge), with the moments its mechanics take HP off at once. Pointing at a moment
 * (or pinning it) reads the fight there. An enemy set by hand: its HP going down at the team's
 * DPS. Its HP unknown: nothing
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
  const view = useMemo(
    () => (estimate && hp !== undefined ? fightView(estimate) : undefined),
    [estimate, hp]
  )
  if (!estimate || hp === undefined || !view) return null
  const { segments, events, meter } = estimate.timeline
  const stateName = (state: FightSegment['state']) => {
    switch (state) {
      case 'horns':
        return t('enemy.fight.hornsState', 'Horns on (+150% RES)')
      case 'drinking':
        return t('enemy.fight.drinking', 'Drinking (Courage rising)')
      case 'leap':
        return t('enemy.fight.leap', 'Out of reach')
      case 'ward':
        return t('enemy.fight.ward', 'Anchor’s ward up (its HP untouched)')
      case 'cocooned':
        return t('enemy.fight.cocooned', 'Radiant Cocoon on the team')
      case 'enhancedCocoon':
        return t(
          'enemy.fight.enhancedCocoon',
          'Radiant Cocoon on the team (all its RES up)'
        )
      case 'disentangled':
        return t('enemy.fight.disentangled', 'Disentangled (team buffed)')
      default:
        return state === 'shielded' && preset?.boss.id === 1013061
          ? t('enemy.fight.valiantAssault', 'Valiant Assault (shielded)')
          : stygianPhaseName(t, state)
    }
  }
  // each state's RES (a boss's phase; its horns: +150%; its drink: its regular RES; the
  // Moongecko's: its Dull Carapace RES, +60% Geo RES in the cocoon, all RES after a ward kept)
  const resOf = (state: FightSegment['state']): StygianRes => {
    if (!preset) return customRes(enemy)
    const phases = preset.boss.phases
    const regular =
      phases.find((p) => p.key === 'regular')?.res ?? preset.phase.res
    const plus = (res: StygianRes, add: (e: ElementWithPhyKey) => number) =>
      Object.fromEntries(
        allElementWithPhyKeys.map((e) => {
          const v = res[e]
          return [e, v === 'immune' ? v : v + add(e)]
        })
      ) as StygianRes
    if (state === 'horns') return plus(regular, () => 150)
    if (state === 'drinking') return regular
    const dull = phases.find((p) => p.key === 'dullCarapace')?.res
    if (dull) {
      if (state === 'cocooned')
        return plus(dull, (e) => (e === 'geo' ? MOONGECKO.cocoonRes : 0))
      if (state === 'enhancedCocoon')
        return plus(dull, () => MOONGECKO.cocoonRes)
      if (
        state === 'ward' ||
        state === 'leap' ||
        state === 'stunned' ||
        state === 'disentangled'
      )
        return dull
    }
    return phases.find((p) => p.key === state)?.res ?? preset.phase.res
  }
  const icon = preset && stygianBossIcons[preset.boss.id]
  const states = [...new Set(segments.map((s) => s.state))]
  const meterLabel =
    meter?.key === 'courage'
      ? t('enemy.fight.courage', 'Courage')
      : meter?.key === 'ward'
        ? t('enemy.fight.wardLayers', 'Ward layers')
        : t('enemy.fight.hornGauge', 'Horn gauge')
  const meterColor =
    meter?.key === 'hornGauge'
      ? theme.palette.pyro.main
      : meter?.key === 'ward'
        ? theme.palette.geo.main
        : theme.palette.anemo.main
  return (
    <Box
      component="section"
      aria-label={t('enemy.fight.title', 'Fight timeline')}
      sx={{
        ...insetSx,
        p: { xs: 1.5, sm: 2 },
        mt: { xs: 2, sm: 2.5 },
        display: 'grid',
        gap: 1.5,
      }}
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
            ? t('enemyEditor.stygian.defeat', {
                defaultValue: '≈ {{time}} to defeat',
                time: formatDuration(t, estimate.seconds),
              })
            : t('enemyEditor.stygian.defeatOver', {
                defaultValue: 'over {{time}} to defeat',
                time: formatDuration(t, FIGHT_LIMIT),
              })}
        </Typography>
      </Box>

      {/* the chart (drawn once), and the moment pointed at over it */}
      <FightScrub
        view={view}
        hasStates={!!preset}
        meter={meter}
        meterColor={meterColor}
        meterLabel={meterLabel}
        maxHp={hp}
        stateName={stateName}
        stateColor={(state) => stateColor(theme, state)}
        resOf={resOf}
      >
        <FightChart
          view={view}
          hasStates={!!preset}
          meter={meter}
          meterColor={meterColor}
          meterLabel={meterLabel}
        />
      </FightScrub>

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
          <Swatch key={state} color={stateColor(theme, state)}>
            {stateName(state)}
          </Swatch>
        ))}
        {meter && (
          <Swatch color={meterColor} line>
            {meter.key === 'courage'
              ? t('enemy.fight.courageLegend', {
                  defaultValue: 'Courage (full at {{max}})',
                  max: meter.max,
                })
              : meter.key === 'ward'
                ? t('enemy.fight.wardLegend', {
                    defaultValue: 'Ward layers left ({{max}} of 4U Geo)',
                    max: meter.max,
                  })
                : t('enemy.fight.hornGaugeLegend', {
                    defaultValue: 'Horn gauge ({{max}}U of Pyro)',
                    max: meter.max,
                  })}
          </Swatch>
        )}
        <Swatch color={alpha(giTokens.parchment, 0.6)} line>
          {t('enemy.fight.dpsLegend', 'Team DPS (into a shield or ward)')}
        </Swatch>
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

/** A legend's entry: its colour (a block, or a line for a meter) and its name */
function Swatch({
  color,
  line,
  children,
}: {
  color: string
  line?: boolean
  children: ReactNode
}) {
  return (
    <Box
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
          width: line ? 14 : 10,
          height: line ? 3 : 10,
          borderRadius: line ? 2 : tokens.radius.control / 2,
          bgcolor: color,
        }}
      />
      {children}
    </Box>
  )
}

/** The fight laid out once: its length, its HP and meter lines, and its moments */
function fightView(estimate: FightEstimate) {
  const { segments, events, meter } = estimate.timeline
  // (a little room after its end: a drop to 0 there is not cut off at the edge)
  const end =
    Math.max(
      1,
      estimate.seconds ?? segments[segments.length - 1]?.end ?? FIGHT_LIMIT
    ) * 1.015
  const sx = (s: number) => ((Math.min(s, end) / end) * W).toFixed(2)
  // the HP line: each stretch, then each moment's drop
  const points: [number, number][] = []
  for (const seg of segments) {
    points.push([seg.start, seg.hpStart], [seg.end, seg.hpEnd])
    const event = events.find((e) => Math.abs(e.t - seg.end) < 1e-6)
    if (event) points.push([event.t, Math.max(0, seg.hpEnd - event.hp)])
  }
  const hpPath = points
    .map(([s, v], i) => `${i ? 'L' : 'M'}${sx(s)},${((1 - v) * H).toFixed(2)}`)
    .join(' ')
  const hpArea = `${hpPath} L${sx(points[points.length - 1]?.[0] ?? 0)},${H} L0,${H} Z`
  // the meter's line: each stretch from its start to its end (a regrowth: a step)
  let meterPath: string | undefined
  if (meter) {
    const m: [number, number][] = []
    for (const seg of segments)
      if (seg.meterStart !== undefined)
        m.push(
          [seg.start, seg.meterStart],
          [seg.end, seg.meterEnd ?? seg.meterStart]
        )
    meterPath = m
      .map(
        ([s, v], i) =>
          `${i ? 'L' : 'M'}${sx(s)},${((1 - v / meter.max) * H).toFixed(2)}`
      )
      .join(' ')
  }
  const meterArea =
    meterPath &&
    `${meterPath} L${sx(segments[segments.length - 1]?.end ?? 0)},${H} L0,${H} Z`
  // the team's DPS: a step per stretch (into a shield or ward there), scaled to its highest
  const maxDps = Math.max(0, ...segments.map((seg) => seg.dps ?? 0))
  const dpsY = (v: number) =>
    maxDps > 0 ? ((1 - (0.9 * v) / maxDps) * H).toFixed(2) : `${H}`
  const dpsPath =
    maxDps > 0
      ? segments
          .map(
            (seg, i) =>
              `${i ? 'L' : 'M'}${sx(seg.start)},${dpsY(seg.dps ?? 0)} L${sx(seg.end)},${dpsY(seg.dps ?? 0)}`
          )
          .join(' ')
      : undefined
  return {
    estimate,
    end,
    hpPath,
    hpArea,
    meterPath,
    meterArea,
    dpsPath,
    maxDps,
    /** The fight at `s` seconds (`maxHp`: its Max HP, for its shield's backlash cap) */
    at(s: number, maxHp: number): Moment {
      const time = Math.min(Math.max(0, s), end)
      const seg =
        segments.find((g) => time <= g.end + 1e-9) ??
        segments[segments.length - 1]
      const span = seg.end - seg.start
      const f =
        span > 0 ? Math.min(1, Math.max(0, (time - seg.start) / span)) : 0
      const hpNow = seg.hpStart + (seg.hpEnd - seg.hpStart) * f
      const m0 = seg.meterStart
      const m1 = seg.meterEnd ?? m0
      const here =
        seg.backlashRatio !== undefined && seg.dps
          ? seg.dps * (time - seg.start)
          : undefined
      const absorbed =
        here !== undefined ? (seg.absorbedBefore ?? 0) + here : undefined
      return {
        t: time,
        seg,
        hp: hpNow,
        ...(m0 !== undefined && m1 !== undefined
          ? {
              meter: m0 + (m1 - m0) * f,
              ...(span > 0 ? { rate: (m1 - m0) / span } : {}),
            }
          : {}),
        ...(absorbed !== undefined && here !== undefined
          ? {
              absorbed,
              backlash: Math.min(
                (seg.backlashBefore ?? 0) + (seg.backlashRatio ?? 0) * here,
                (seg.backlashCap ?? 0.15) * maxHp,
                hpNow * maxHp
              ),
            }
          : {}),
        event: events.find((e) => Math.abs(e.t - time) <= end * 0.006),
      }
    },
  }
}
type FightView = ReturnType<typeof fightView>

/** The chart's lanes: its state, its HP (with its mechanics' drops), its meter, the time marks */
function FightChart({
  view,
  hasStates,
  meter,
  meterColor,
  meterLabel,
}: {
  view: FightView
  hasStates: boolean
  meter?: FightEstimate['timeline']['meter']
  meterColor: string
  meterLabel: string
}) {
  const { t } = useTranslation('page_team')
  const theme = useTheme()
  const { estimate, end } = view
  const { segments, events } = estimate.timeline
  const x = (s: number) => `${(Math.min(s, end) / end) * 100}%`
  const lane = {
    position: 'relative',
    borderRadius: 1,
    overflow: 'hidden',
  } as const
  return (
    <Box sx={{ display: 'grid', gap: 0.5 }}>
      {hasStates && (
        <Box
          sx={{
            ...lane,
            height: STATE_H,
            bgcolor: alpha(giTokens.parchment, 0.06),
          }}
        >
          {segments.map((seg) => (
            <Box
              key={`${seg.start}`}
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
          ))}
        </Box>
      )}
      <Box sx={{ position: 'relative', height: HP_H }}>
        <Box
          component="svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          aria-hidden
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
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
          <path d={view.hpArea} fill="url(#fight-hp)" />
          <path
            d={view.hpPath}
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
            <Box
              key={`${e.t}`}
              aria-hidden
              sx={{
                position: 'absolute',
                left: x(e.t),
                top: `${(1 - before) * 100}%`,
                width: 10,
                height: 10,
                ml: '-5px',
                mt: '-5px',
                borderRadius: '50%',
                // (the Anchor's blast takes no HP: a ring)
                bgcolor:
                  e.kind === 'blast'
                    ? giTokens.panelDark
                    : e.kind === 'backlash'
                      ? theme.palette.electro.main
                      : e.kind === 'wardBreak'
                        ? theme.palette.geo.main
                        : theme.palette.pyro.main,
                border:
                  e.kind === 'blast'
                    ? `2px solid ${theme.palette.pyro.main}`
                    : undefined,
                boxShadow: `0 0 0 2px ${giTokens.panelDark}`,
                pointerEvents: 'none',
              }}
            />
          )
        })}
        <LaneLabel>{t('enemy.fight.hpAxis', 'HP')}</LaneLabel>
      </Box>
      {meter && view.meterPath && (
        <Box
          sx={{
            ...lane,
            height: METER_H,
            bgcolor: alpha(giTokens.parchment, 0.03),
          }}
        >
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
            <path d={view.meterArea} fill={alpha(meterColor, 0.14)} />
            <path
              d={view.meterPath}
              fill="none"
              stroke={meterColor}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </Box>
          <LaneLabel>{meterLabel}</LaneLabel>
        </Box>
      )}
      {/* the team's DPS over the fight (where a shield or ward takes it: what it takes) */}
      {view.dpsPath && (
        <Box
          sx={{
            ...lane,
            height: DPS_H,
            bgcolor: alpha(giTokens.parchment, 0.03),
          }}
        >
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
            <path
              d={view.dpsPath}
              fill="none"
              stroke={alpha(giTokens.parchment, 0.6)}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </Box>
          <LaneLabel>
            {t('enemy.fight.dpsAxis', {
              defaultValue: 'DPS (top {{dps}})',
              dps: compact(3).format(view.maxDps / 0.9),
            })}
          </LaneLabel>
        </Box>
      )}
      {/* the time marks */}
      <Box sx={{ position: 'relative', height: MARKS_H }}>
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
  )
}

/** A lane's name, in its top left corner */
function LaneLabel({ children }: { children: ReactNode }) {
  return (
    <Typography
      sx={{
        ...type.label,
        position: 'absolute',
        top: 1,
        left: 4,
        fontSize: 11,
        pointerEvents: 'none',
      }}
    >
      {children}
    </Typography>
  )
}

/**
 * The moment pointed at over the chart (or pinned by a click, or moved with ← →): a line across
 * its lanes, and the fight there in a line below. Only this re-renders as the pointer moves.
 */
function FightScrub({
  view,
  hasStates,
  meter,
  meterColor,
  meterLabel,
  maxHp,
  stateName,
  stateColor,
  resOf,
  children,
}: {
  view: FightView
  hasStates: boolean
  meter?: FightEstimate['timeline']['meter']
  meterColor: string
  meterLabel: string
  maxHp: number
  stateName: (state: FightSegment['state']) => string
  stateColor: (state: FightSegment['state']) => string
  resOf: (state: FightSegment['state']) => StygianRes
  children: ReactNode
}) {
  const { t } = useTranslation('page_team')
  const ref = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<{ t: number; pinned: boolean }>()
  const { end } = view
  const timeAt = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box || box.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * end
  }
  const onPointerMove = (e: PointerEvent) => {
    if (cursor?.pinned) return
    setCursor({ t: timeAt(e.clientX), pinned: false })
  }
  const onPointerLeave = () => {
    if (!cursor?.pinned) setCursor(undefined)
  }
  const onClick = (e: { clientX: number }) => {
    const at = timeAt(e.clientX)
    // (a click on the pinned moment lets it go; elsewhere, it moves there)
    setCursor((c) =>
      c?.pinned && Math.abs(c.t - at) < end * 0.01
        ? { t: at, pinned: false }
        : { t: at, pinned: true }
    )
  }
  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1
    const now = cursor?.t ?? 0
    const next =
      e.key === 'ArrowRight'
        ? now + step
        : e.key === 'ArrowLeft'
          ? now - step
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? end
              : undefined
    if (e.key === 'Escape' && cursor) {
      e.preventDefault()
      setCursor(undefined)
      return
    }
    if (next === undefined) return
    e.preventDefault()
    setCursor({ t: Math.min(end, Math.max(0, next)), pinned: true })
  }
  const moment = cursor ? view.at(cursor.t, maxHp) : undefined
  // (the line spans the lanes above the time marks)
  const meterLane = meter && view.meterPath ? METER_H + 4 : 0
  const lanes =
    (hasStates ? STATE_H + 4 : 0) +
    HP_H +
    meterLane +
    (view.dpsPath ? DPS_H + 4 : 0)
  const valueText = moment ? momentText(t, moment, maxHp, stateName) : undefined
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box
        ref={ref}
        role="slider"
        tabIndex={0}
        aria-label={t('enemy.fight.scrubLabel', 'Moment of the fight')}
        aria-valuemin={0}
        aria-valuemax={Math.round(end)}
        aria-valuenow={Math.round(moment?.t ?? 0)}
        aria-valuetext={valueText}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
        onKeyDown={onKeyDown}
        sx={{
          position: 'relative',
          cursor: 'crosshair',
          touchAction: 'pan-y',
          borderRadius: 1,
          outline: 'none',
          ...focusSx,
        }}
      >
        {children}
        {moment && (
          <Box
            aria-hidden
            // (its place in `style`: an `sx` value would add a CSS class for every position)
            style={{ left: `${(moment.t / end) * 100}%`, height: lanes }}
            sx={{
              position: 'absolute',
              top: 0,
              width: 0,
              borderLeft: `1px ${cursor?.pinned ? 'solid' : 'dashed'} ${alpha(giTokens.parchment, cursor?.pinned ? 0.85 : 0.55)}`,
              pointerEvents: 'none',
            }}
          >
            {/* where its HP and meter are, on their lines */}
            <Dot
              top={(hasStates ? STATE_H + 4 : 0) + (1 - moment.hp) * HP_H}
              color={giTokens.gold}
            />
            {meter && moment.meter !== undefined && view.meterPath && (
              <Dot
                top={
                  (hasStates ? STATE_H + 4 : 0) +
                  HP_H +
                  4 +
                  (1 - moment.meter / meter.max) * METER_H
                }
                color={meterColor}
              />
            )}
            {view.dpsPath && view.maxDps > 0 && (
              <Dot
                top={
                  (hasStates ? STATE_H + 4 : 0) +
                  HP_H +
                  meterLane +
                  4 +
                  (1 - (0.9 * (moment.seg.dps ?? 0)) / view.maxDps) * DPS_H
                }
                color={giTokens.parchment}
              />
            )}
          </Box>
        )}
      </Box>
      {/* the fight at that moment (a line kept for it: nothing moves as it appears) */}
      <Box
        sx={{
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 0.5,
          px: 1.25,
          py: 0.75,
          borderRadius: tokens.radius.control,
          bgcolor: alpha(giTokens.parchment, moment ? 0.05 : 0.025),
          ...quickSx,
        }}
      >
        {moment ? (
          <MomentLine
            moment={moment}
            maxHp={maxHp}
            meter={meter}
            meterColor={meterColor}
            meterLabel={meterLabel}
            stateName={stateName}
            stateColor={stateColor}
            resOf={resOf}
            pinned={!!cursor?.pinned}
            onUnpin={() => setCursor(undefined)}
          />
        ) : (
          <Typography sx={{ ...type.label, fontWeight: 400 }}>
            {meter?.key === 'courage'
              ? t(
                  'enemy.fight.scrubHintCourage',
                  'Point at a moment to see its HP, Courage and RES there · click to pin it · ← → by 1 s'
                )
              : meter?.key === 'ward'
                ? t(
                    'enemy.fight.scrubHintWard',
                    'Point at a moment to see its HP, its ward, RES and the team’s DPS there · click to pin it · ← → by 1 s'
                  )
                : t(
                    'enemy.fight.scrubHint',
                    'Point at a moment to see its HP and RES there · click to pin it · ← → by 1 s'
                  )}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

/** A marker on a line, at the cursor (its place in `style`, as the cursor's) */
function Dot({ top, color }: { top: number; color: string }) {
  return (
    <Box
      style={{ top }}
      sx={{
        position: 'absolute',
        left: -4,
        width: 8,
        height: 8,
        mt: '-4px',
        borderRadius: '50%',
        bgcolor: color,
        boxShadow: `0 0 0 2px ${giTokens.panelDark}`,
      }}
    />
  )
}

/** The fight at a moment, in a line: its time, state, HP, meter, RES, the DPS there, its shield */
function MomentLine({
  moment,
  maxHp,
  meter,
  meterColor,
  meterLabel,
  stateName,
  stateColor,
  resOf,
  pinned,
  onUnpin,
}: {
  moment: Moment
  maxHp: number
  meter?: FightEstimate['timeline']['meter']
  meterColor: string
  meterLabel: string
  stateName: (state: FightSegment['state']) => string
  stateColor: (state: FightSegment['state']) => string
  resOf: (state: FightSegment['state']) => StygianRes
  pinned: boolean
  onUnpin: () => void
}) {
  const { t } = useTranslation('page_team')
  const { seg } = moment
  const value = { color: 'text.primary', fontWeight: 650 } as const
  const item = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.75,
    fontSize: 13,
    color: 'text.secondary',
    ...numSx,
  } as const
  const rate = (r: number) =>
    `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r) >= 10 ? Math.round(Math.abs(r)) : siteDecimal(Math.abs(r))}`
  return (
    <>
      <Box sx={item}>
        <Box component="span" sx={{ ...value, minWidth: 34 }}>
          {formatFightTime(moment.t)}
        </Box>
        <Box
          component="span"
          sx={{
            width: 10,
            height: 10,
            borderRadius: tokens.radius.control / 2,
            bgcolor: stateColor(seg.state),
          }}
        />
        <Box component="span" sx={{ color: 'text.primary' }}>
          {stateName(seg.state)}
        </Box>
      </Box>
      <Box sx={item}>
        {t('enemy.fight.hpAxis', 'HP')}
        <Box component="span" sx={value}>
          {siteDecimal(moment.hp * 100)}%
        </Box>
        <span>{compact(3).format(moment.hp * maxHp)}</span>
      </Box>
      {meter && moment.meter !== undefined && (
        <Box sx={item}>
          <Box
            component="span"
            sx={{ width: 10, height: 3, borderRadius: 2, bgcolor: meterColor }}
          />
          {meterLabel}
          <Box component="span" sx={value}>
            {meter.key === 'hornGauge'
              ? `${siteDecimal(moment.meter)}U`
              : meter.key === 'ward'
                ? siteDecimal(moment.meter)
                : Math.round(moment.meter)}
          </Box>
          <span>
            / {meter.max}
            {meter.key === 'hornGauge' ? 'U' : ''}
          </span>
          {!!moment.rate && (
            <span>
              {t('enemy.fight.perSecond', {
                defaultValue: '({{rate}}/s)',
                rate: rate(moment.rate),
              })}
            </span>
          )}
        </Box>
      )}
      <Box sx={item}>
        {t('enemy.fight.resAt', 'RES')}
        <Box component="span" sx={{ color: 'text.primary' }}>
          <StygianResSummary res={resOf(seg.state)} />
        </Box>
      </Box>
      {seg.dps !== undefined && (
        <Box sx={item}>
          {moment.absorbed !== undefined
            ? seg.state === 'ward'
              ? t('enemy.fight.dpsWard', 'Into its ward')
              : t('enemy.fight.dpsShield', 'Into its shield')
            : t('enemy.fight.dpsHere', 'Team DPS here')}
          <Box component="span" sx={value}>
            {compact(3).format(seg.dps)}
          </Box>
        </Box>
      )}
      {moment.absorbed !== undefined && moment.backlash !== undefined && (
        <Box sx={item}>
          {seg.state === 'ward'
            ? t('enemy.fight.anchorTook', 'The Anchor took')
            : t('enemy.fight.shieldTook', 'Its shield took')}
          <Box component="span" sx={value}>
            {compact(3).format(moment.absorbed)}
          </Box>
          {seg.state === 'ward'
            ? t('enemy.fight.wardSoFar', {
                defaultValue:
                  '→ {{hp}} off it when the ward breaks ({{pct}}% of its HP)',
                hp: compact(3).format(moment.backlash),
                pct: siteDecimal((moment.backlash / maxHp) * 100),
              })
            : t('enemy.fight.backlashSoFar', {
                defaultValue:
                  '→ {{hp}} backlash when it ends ({{pct}}% of its HP)',
                hp: compact(3).format(moment.backlash),
                pct: siteDecimal((moment.backlash / maxHp) * 100),
              })}
        </Box>
      )}
      {moment.event && (
        <Box sx={{ ...item, color: 'text.primary' }}>
          {moment.event.kind === 'backlash'
            ? t('enemy.fight.backlashAt', {
                defaultValue: 'Backlash: −{{hp}}% of its HP',
                hp: siteDecimal(moment.event.hp * 100),
              })
            : moment.event.kind === 'wardBreak'
              ? t('enemy.fight.wardBreakAt', {
                  defaultValue: 'Ward broken: −{{hp}}% of its HP',
                  hp: siteDecimal(moment.event.hp * 100),
                })
              : moment.event.kind === 'blast'
                ? t(
                    'enemy.fight.blastAt',
                    'Ward not broken: the Anchor blasts the team (200% ATK Geo DMG)'
                  )
                : t('enemy.fight.hornsBreakAt', {
                    defaultValue: 'Horns broken: −{{hp}}% of its HP',
                    hp: siteDecimal(moment.event.hp * 100),
                  })}
        </Box>
      )}
      {pinned && (
        <ButtonBase
          onClick={onUnpin}
          sx={{
            ml: 'auto',
            px: 1,
            py: 0.25,
            borderRadius: tokens.radius.control,
            fontSize: 12.5,
            color: 'text.secondary',
            ...quickSx,
            ...focusSx,
            '&:hover': { color: 'text.primary', bgcolor: giTokens.panelHover },
          }}
        >
          {t('enemy.fight.unpin', 'Unpin')}
        </ButtonBase>
      )}
    </>
  )
}

/** A moment in words, for a screen reader */
function momentText(
  t: TFunction,
  moment: Moment,
  maxHp: number,
  stateName: (state: FightSegment['state']) => string
) {
  return [
    formatFightTime(moment.t),
    stateName(moment.seg.state),
    t('enemy.fight.hpText', {
      defaultValue: 'HP {{pct}}% ({{hp}})',
      pct: siteDecimal(moment.hp * 100),
      hp: compact(3).format(moment.hp * maxHp),
    }),
    moment.meter !== undefined &&
      t('enemy.fight.meterText', {
        defaultValue: 'meter {{value}}',
        value: Math.round(moment.meter),
      }),
  ]
    .filter(Boolean)
    .join(', ')
}

/** A custom enemy's RES (percent; immune: 'immune') */
function customRes(enemy: FightEnemy): StygianRes {
  return Object.fromEntries(
    allElementWithPhyKeys.map((e: ElementWithPhyKey) => {
      const v = enemy.enemyOverride[`${e}_enemyRes_`] ?? 10
      return [e, v === Number.MAX_VALUE ? 'immune' : v]
    })
  ) as StygianRes
}
