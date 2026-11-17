import { stygianBossIcons } from '@genshin-optimizer/gi/assets'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import type { Team } from '@genshin-optimizer/gi/db'
import { Box, Tooltip } from '@mui/material'
import { useTranslation } from 'react-i18next'
import {
  StygianResSummary,
  stygianBossName,
  stygianPhaseName,
} from './StygianPreset'
import type { StygianRes } from './stygianBosses'
import { appliedStygianPreset } from './stygianBosses'
import type { FightEstimate, FightNote, FightTeam } from './stygianFights'
import { FIGHT_LIMIT, stygianFight } from './stygianFights'

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

/** The breakdown of a fight's estimate, line by line */
function FightBreakdown({
  estimate,
  hp,
}: {
  estimate: FightEstimate
  hp: number
}) {
  const { t } = useTranslation('page_team')
  const pct = (v: number) => `${Math.round(v * 100)}%`
  const lines = estimate.parts.map((part) => {
    switch (part.key) {
      case 'phase':
        return t('enemyEditor.fight.phase', {
          defaultValue: '{{time}} at its {{phase}} RES',
          time: formatFightTime(part.seconds),
          phase: stygianPhaseName(t, part.phase),
        })
      case 'valiant':
        return part.electro !== undefined
          ? t('enemyEditor.fight.valiant', {
              defaultValue:
                '{{count}} Valiant States of ≈ {{seconds}} s (its shield takes the damage; {{electro}} Electro gauge/s drains its Courage)',
              count: part.count,
              seconds: Math.round(part.seconds),
              electro: part.electro.toFixed(1),
            })
          : t('enemyEditor.fight.valiantNoGauge', {
              defaultValue:
                '{{count}} Valiant States of ≈ {{seconds}} s (its shield takes the damage)',
              count: part.count,
              seconds: Math.round(part.seconds),
            })
      case 'backlash':
        return t('enemyEditor.fight.backlash', {
          defaultValue: 'Backlash on leaving them: {{hp}} of its HP',
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
              time: formatFightTime(part.seconds),
            })
      case 'hornsBreak':
        return t('enemyEditor.fight.hornsBreak', {
          defaultValue:
            'Each break: 10% of its HP ({{hp}} in all), then 10 s without horns',
          hp: pct(part.hp),
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
            'Not counted: Stellar Glimmer (it cuts its drinks short)'
          ),
          noRotation: t(
            'enemyEditor.fight.note.noRotation',
            'No written rotation: the team’s element applications are not known (none counted)'
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
      <Box component="span" sx={{ opacity: 0.7 }}>
        {t(
          'enemyEditor.fight.source',
          'HP and mechanics: stygian.moe and the Fandom wiki.'
        )}
      </Box>
    </Box>
  )
}

/**
 * A Stygian Onslaught boss's HP (at the difficulty of its level), and about how long the team
 * takes to defeat it: its fight's mechanics counted where they are known (`stygianFight`)
 */
export function StygianDefeatTime({
  enemy,
  team,
}: {
  enemy: RunEnemy
  /** The team in the fight (absent: the HP only) */
  team?: FightTeam
}) {
  const { t } = useTranslation('page_team')
  const preset = appliedStygianPreset(enemy)
  if (!preset?.difficulty) return null
  const hp = preset.boss.hp[preset.difficulty]
  const estimate = team
    ? stygianFight(preset.boss, preset.difficulty, team, preset.phase.key)
    : undefined
  return (
    <Tooltip
      arrow
      title={
        estimate ? (
          <FightBreakdown estimate={estimate} hp={hp} />
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
        <span>
          {t('enemyEditor.stygian.hp', {
            defaultValue: '{{hp}} HP',
            hp: compact(3).format(hp),
          })}
        </span>
        {estimate && (
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 650 }}>
            {estimate.seconds !== undefined
              ? t('enemyEditor.stygian.defeat', {
                  defaultValue: '≈ {{time}} to defeat',
                  time: formatFightTime(estimate.seconds),
                })
              : t('enemyEditor.stygian.defeatOver', {
                  defaultValue: 'over {{time}} to defeat',
                  time: formatFightTime(FIGHT_LIMIT),
                })}
          </Box>
        )}
      </Box>
    </Tooltip>
  )
}
