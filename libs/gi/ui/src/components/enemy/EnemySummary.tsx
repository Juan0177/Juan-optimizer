import { stygianBossIcons } from '@genshin-optimizer/gi/assets'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import type { Team } from '@genshin-optimizer/gi/db'
import { Box, Tooltip } from '@mui/material'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import {
  StygianResSummary,
  stygianBossName,
  stygianPhaseName,
} from './StygianPreset'
import type { StygianRes } from './stygianBosses'
import { appliedStygianPreset } from './stygianBosses'
import type {
  FightEnemy,
  FightEstimate,
  FightNote,
  FightTeam,
} from './stygianFights'
import { enemyFight, enemyHpOf, FIGHT_LIMIT } from './stygianFights'

/** A team's enemy as a run used it: its level, RES and DEF, and the preset it was */
export type RunEnemy = Pick<Team, 'enemyOverride' | 'enemyPreset'>

/** The team's enemy now, to keep with a run's result */
export const runEnemyOf = (team: RunEnemy): RunEnemy => ({
  enemyOverride: { ...team.enemyOverride },
  ...(team.enemyPreset ? { enemyPreset: team.enemyPreset } : {}),
})

/** What the damage depends on, with the editor's defaults for what is not set */
const enemyValues = (e: Team['enemyOverride']) => [
  e.enemyLevel ?? 100,
  e.enemyDefRed_ ?? 0,
  e.enemyDefIgn_ ?? 0,
  ...allElementWithPhyKeys.map((ele) => e[`${ele}_enemyRes_`] ?? 10),
]
/** Whether two enemies take the same damage (level, RES, DEF) */
export const sameEnemy = (a: Team['enemyOverride'], b: Team['enemyOverride']) =>
  enemyValues(a).every((v, i) => v === enemyValues(b)[i])

/**
 * An enemy in one line: the boss it is (a preset, not edited since), its level, its RES that
 * stand out (all the same: "All 10%") and its DEF shred, if any
 */
export function EnemySummary({ enemy }: { enemy: RunEnemy }) {
  const { t } = useTranslation(['page_team', 'stygian'])
  const { enemyOverride } = enemy
  const preset = appliedStygianPreset(enemy)
  const res = Object.fromEntries(
    allElementWithPhyKeys.map((e) => {
      const v = enemyOverride[`${e}_enemyRes_`] ?? 10
      return [e, v === Number.MAX_VALUE ? 'immune' : v]
    })
  ) as StygianRes
  const defRed = enemyOverride.enemyDefRed_ ?? 0
  const defIgn = enemyOverride.enemyDefIgn_ ?? 0
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 1,
        rowGap: 0.25,
        minWidth: 0,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {preset && stygianBossIcons[preset.boss.id] && (
        <Box
          component="img"
          src={stygianBossIcons[preset.boss.id]}
          alt=""
          aria-hidden
          sx={{ width: 22, height: 22, borderRadius: 1, flexShrink: 0 }}
        />
      )}
      {preset && (
        <Box component="span" sx={{ fontWeight: 650, color: 'text.primary' }}>
          {stygianBossName(t, preset.boss.id)}
          {preset.phase.key !== preset.boss.main &&
            ` · ${stygianPhaseName(t, preset.phase.key)}`}
        </Box>
      )}
      <span>
        {t('enemyEditor.summaryLevel', {
          defaultValue: 'Lv. {{level}}',
          level: enemyOverride.enemyLevel ?? 100,
        })}
      </span>
      <StygianResSummary res={res} />
      {!!defRed && (
        <span>
          {t('enemyEditor.summaryDefRed', {
            defaultValue: 'DEF −{{value}}%',
            value: defRed,
          })}
        </span>
      )}
      {!!defIgn && (
        <span>
          {t('enemyEditor.summaryDefIgn', {
            defaultValue: 'DEF ignored {{value}}%',
            value: defIgn,
          })}
        </span>
      )}
    </Box>
  )
}

const compact = (digits: number) =>
  new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumSignificantDigits: digits,
  })

/** A fight's length: 4:33 (an hour or more: 1:02:05) */
export function formatFightTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '–'
  const total = Math.round(seconds)
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * A fight's length in words, not to be misread: 43s, 1m 43s, 10m, 1h 02m (`formatFightTime`'s
 * 0:43 is for a time axis)
 */
export function formatDuration(t: TFunction, seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '–'
  const total = Math.round(seconds)
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h)
    return t('page_team:enemyEditor.duration.hm', {
      defaultValue: '{{h}}h {{m}}m',
      h,
      m: pad(m),
    })
  if (m)
    return s
      ? t('page_team:enemyEditor.duration.ms', {
          defaultValue: '{{m}}m {{s}}s',
          m,
          s: pad(s),
        })
      : t('page_team:enemyEditor.duration.m', { defaultValue: '{{m}}m', m })
  return t('page_team:enemyEditor.duration.s', { defaultValue: '{{s}}s', s })
}

/** The breakdown of a fight's estimate, line by line */
export function FightBreakdown({
  estimate,
  hp,
  custom,
}: {
  estimate: FightEstimate
  hp: number
  /** An enemy set by hand (its HP, the user's) */
  custom?: boolean
}) {
  const { t } = useTranslation('page_team')
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const lines = estimate.parts.map((part) => {
    switch (part.key) {
      case 'phase':
        return t('enemyEditor.fight.phase', {
          defaultValue: '{{time}} at its {{phase}} RES',
          time: formatDuration(t, part.seconds),
          phase: stygianPhaseName(t, part.phase),
        })
      case 'valiant':
        return part.courage !== undefined
          ? part.stellar
            ? t('enemyEditor.fight.valiantStellar', {
                defaultValue:
                  '{{count}} Valiant Assaults of ≈ {{seconds}} s: its shield takes the damage, and its 600 Courage drains 15/s, {{courage}}/s more from the team’s Electro hits ({{stellar}} Stellar Glimmer hits/s)',
                count: part.count,
                seconds: Math.round(part.seconds),
                courage: Math.round(part.courage),
                stellar: part.stellar.toFixed(1),
              })
            : t('enemyEditor.fight.valiantCourage', {
                defaultValue:
                  '{{count}} Valiant Assaults of ≈ {{seconds}} s: its shield takes the damage, and its 600 Courage drains 15/s, {{courage}}/s more from the team’s Electro hits',
                count: part.count,
                seconds: Math.round(part.seconds),
                courage: Math.round(part.courage),
              })
          : t('enemyEditor.fight.valiantNoGauge', {
              defaultValue:
                '{{count}} Valiant Assaults of ≈ {{seconds}} s: its shield takes the damage, and its 600 Courage drains 15/s',
              count: part.count,
              seconds: Math.round(part.seconds),
            })
      case 'backlash':
        return t('enemyEditor.fight.backlashStellar', {
          defaultValue:
            'Backlash on leaving them: 60% of the DMG its shield took (150% of the Stellar Glimmer DMG), at most 15% of its HP each: {{hp}} of its HP',
          hp: pct(part.hp),
        })
      case 'horns':
        return part.count
          ? t('enemyEditor.fight.horns', {
              defaultValue:
                '{{count}} pairs of horns (+150% RES), ≈ {{seconds}} s each to break ({{removal}} gauge/s of reactions on their 64U Pyro)',
              count: part.count,
              seconds: Math.round(part.seconds),
              removal: part.removal.toFixed(1),
            })
          : t('enemyEditor.fight.hornsKept', {
              defaultValue:
                'Its horns (+150% RES) stay on for the {{time}}: not broken in time',
              time: formatDuration(t, part.seconds),
            })
      case 'hornsBreak':
        return t('enemyEditor.fight.hornsBreak', {
          defaultValue:
            'Each break: 10% of its HP ({{hp}} in all), then 10 s without horns',
          hp: pct(part.hp),
        })
      case 'custom':
        return t('enemyEditor.fight.custom', {
          defaultValue: '{{time}} at {{dps}} DPS (its HP ÷ the team’s DPS)',
          time: formatDuration(t, part.seconds),
          dps: compact(3).format(part.dps),
        })
      default:
        return ''
    }
  })
  const notes = estimate.notes.map(
    (note) =>
      (
        ({
          stellarGlimmer: t(
            'enemyEditor.fight.note.stellarGlimmer',
            'Not counted: Radiance: Stellar Glimmer while it drinks (its Courage fills 25% slower)'
          ),
          noRotation: t(
            'enemyEditor.fight.note.noRotation',
            'No written rotation: the team’s element applications are not known (none counted)'
          ),
          electroEstimated: t(
            'enemyEditor.fight.note.electroEstimated',
            'No written rotation: its Electro hits are taken from the attacks entered (Stellar Glimmer DMG: Cyno’s, Mitya’s, Yae’s; of the others every 3rd applying 1U, as the standard ICD lets it)'
          ),
          electroStun: t(
            'enemyEditor.fight.note.electroStun',
            'Not counted: the stun Electro hits build up to (it delays its drinks)'
          ),
          noHornRemoval: t(
            'enemyEditor.fight.note.noHornRemoval',
            'No Hydro, Electro, Cryo, Anemo or Geo applied: its horns are never broken'
          ),
          crabs: t(
            'enemyEditor.fight.note.crabs',
            'Not counted: its Sternshield Crabs (their Pyro takes the same reactions; their slam, up to 15% of its HP)'
          ),
          healedToFull: t(
            'enemyEditor.fight.note.healedToFull',
            'Counted at its Dull Carapace RES: the team healed to full after each Radiant Cocoon (its CRIT Rate debuff until then, and the buff after, not counted)'
          ),
          ward: t(
            'enemyEditor.fight.note.ward',
            'Not counted: the Moonstone Anchor’s ward (breaking it moves up to 40% of its HP onto it)'
          ),
          mechanics: t(
            'enemyEditor.fight.note.mechanics',
            'Its HP ÷ the team’s DPS: its mechanics are not counted'
          ),
        }) as Record<FightNote, string>
      )[note]
  )
  return (
    <Box sx={{ display: 'grid', gap: 0.5, maxWidth: 380 }}>
      <Box component="span" sx={{ fontWeight: 650 }}>
        {t('enemyEditor.fight.title', {
          defaultValue: '{{hp}} HP, with the team’s rotation repeated:',
          hp: compact(4).format(hp),
        })}
      </Box>
      {lines.filter(Boolean).map((line) => (
        <Box component="span" key={line}>
          {`• ${line}`}
        </Box>
      ))}
      {notes.map((note) => (
        <Box component="span" key={note} sx={{ opacity: 0.8 }}>
          {note}
        </Box>
      ))}
      {!custom && (
        <Box component="span" sx={{ opacity: 0.7 }}>
          {t(
            'enemyEditor.fight.source',
            'HP and mechanics: stygian.moe, the Fandom wiki and the game files.'
          )}
        </Box>
      )}
    </Box>
  )
}

/**
 * The enemy's HP (a Stygian Onslaught boss's at the difficulty of its level, else the one set by
 * hand), and about how long the team takes to defeat it: a boss's fight's mechanics counted where
 * they are known (`enemyFight`). Its HP unknown: nothing
 */
export function EnemyDefeatTime({
  enemy,
  team,
  hideHp,
}: {
  enemy: FightEnemy
  /** The team in the fight (absent: the HP only) */
  team?: FightTeam
  /** Its HP is said beside it already: the time only */
  hideHp?: boolean
}) {
  const { t } = useTranslation('page_team')
  const hp = enemyHpOf(enemy)
  if (hp === undefined) return null
  const custom = !appliedStygianPreset(enemy)
  const estimate = team ? enemyFight(enemy, team) : undefined
  return (
    <Tooltip
      arrow
      title={
        estimate ? (
          <FightBreakdown estimate={estimate} hp={hp} custom={custom} />
        ) : custom ? (
          t('enemyEditor.customHpTip', 'Its HP, as set.')
        ) : (
          t(
            'enemyEditor.stygian.hpTip',
            'Its HP at this difficulty, from stygian.moe.'
          )
        )
      }
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          columnGap: 0.75,
          cursor: 'help',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {!hideHp && (
          <span>
            {t('enemyEditor.stygian.hp', {
              defaultValue: '{{hp}} HP',
              hp: compact(3).format(hp),
            })}
          </span>
        )}
        {estimate && (
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 650 }}>
            {estimate.seconds !== undefined
              ? t('enemyEditor.stygian.defeat', {
                  defaultValue: '≈ {{time}} to defeat',
                  time: formatDuration(t, estimate.seconds),
                })
              : t('enemyEditor.stygian.defeatOver', {
                  defaultValue: 'over {{time}} to defeat',
                  time: formatDuration(t, FIGHT_LIMIT),
                })}
          </Box>
        )}
      </Box>
    </Tooltip>
  )
}
