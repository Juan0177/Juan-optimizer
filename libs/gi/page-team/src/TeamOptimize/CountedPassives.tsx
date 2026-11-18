import { objPathValue } from '@genshin-optimizer/common/util'
import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import type { DocumentConditional } from '@genshin-optimizer/gi/sheets'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import type { KqmResult } from '@genshin-optimizer/gi/ui'
import {
  kqmRuleConditionals,
  playedAttackStates,
  quickTooltipProps,
  WOLFS_GRAVESTONE,
} from '@genshin-optimizer/gi/ui'
import { Box, Tooltip, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { numSx } from './ui'

const isConditional = (section: unknown): section is DocumentConditional =>
  !!section && typeof section === 'object' && 'states' in section

/** A weapon passive the team's figures count, and how */
export interface CountedPassive {
  /** Its conditional's path, joined */
  path: string
  label: ReactNode
  /** Its state's name (a choice of several), or undefined for a plain switch */
  state?: ReactNode
  /** Its share of the fight, 0 to 1, when the enemy's HP sets it */
  fight?: number
  source: 'rule' | 'kqm'
}

/**
 * Per weapon, its passives a KQM run counts on for this member: by rule, KQM mode's switch, or for
 * a share of the fight against the enemy (Wolf's Gravestone)
 */
export function useCountedPassives(
  teamId: string,
  runSettings: TeamOpt,
  result: KqmResult,
  characterKey: CharacterKey
) {
  const database = useDatabase()
  return useMemo(() => {
    const rules =
      kqmRuleConditionals(database, teamId, {
        attacks: result.played?.attacks ?? runSettings.attacks,
      })[characterKey]?.conditional ?? {}
    const kqm = runSettings.kqm?.passives?.[characterKey] ?? {}
    const played = new Map(
      (playedAttackStates(result.played) ?? [])
        .filter((s) => s.owner === characterKey)
        .map((s) => [s.path.join('.'), s.value])
    )
    const cache = new Map<WeaponKey, CountedPassive[]>()
    return (weaponKey: WeaponKey) => {
      const known = cache.get(weaponKey)
      if (known) return known
      const out: CountedPassive[] = []
      for (const section of (getWeaponSheet(weaponKey)?.document ?? []).filter(
        isConditional
      )) {
        if (!('path' in section) || section.path?.[0] !== weaponKey) continue
        const path = section.path as string[]
        const cond = path[path.length - 1]
        const kqmValue = kqm[weaponKey]?.[cond]
        const fightValue = played.get(path.join('.'))
        const [value, source] =
          fightValue !== undefined
            ? [fightValue, 'kqm' as const]
            : kqmValue !== undefined
              ? [kqmValue, 'kqm' as const]
              : [
                  objPathValue(rules as Record<string, unknown>, path) as
                    | string
                    | undefined,
                  'rule' as const,
                ]
        if (!value) continue
        const states =
          typeof section.states === 'function' ? {} : section.states
        const entries = Object.entries(states) as [
          string,
          { name?: ReactNode },
        ][]
        const fight =
          fightValue !== undefined &&
          path.join('.') === WOLFS_GRAVESTONE.path.join('.')
            ? fightValue === 'on'
              ? 1
              : Number(fightValue) / 100
            : undefined
        out.push({
          path: path.join('.'),
          label: section.name,
          state:
            fight === undefined && entries.length > 1
              ? (states[value]?.name ?? value)
              : undefined,
          fight,
          source: fightValue !== undefined ? 'kqm' : source,
        })
      }
      cache.set(weaponKey, out)
      return out
    }
  }, [database, teamId, runSettings, result, characterKey])
}

/** A small tag after a ranked weapon's name: its passive is counted (how, on hover) */
export function PassiveTag({ passives }: { passives: CountedPassive[] }) {
  const { t } = useTranslation('page_team')
  if (!passives.length) return null
  const fight = passives.find((p) => p.fight !== undefined)?.fight
  const sourceText = (p: CountedPassive) =>
    p.fight !== undefined
      ? t('teamOpt.kqm.passiveFight', {
          defaultValue: '{{percent}}% of the fight, from the enemy’s HP',
          percent: Math.round(p.fight * 100),
        })
      : p.source === 'rule'
        ? t('teamOpt.kqm.passiveRule', 'on by rule')
        : t('teamOpt.kqm.passiveSwitch', 'on by your switch')
  return (
    <Tooltip
      arrow
      placement="left"
      {...quickTooltipProps}
      title={
        <Box sx={{ display: 'grid', gap: 0.5 }}>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
            {t('teamOpt.kqm.passiveCounted', 'Passive counted')}
          </Typography>
          {passives.map((p) => (
            <Typography key={p.path} sx={{ fontSize: 12.5 }}>
              {p.label}
              {p.state !== undefined && <>: {p.state}</>}
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {' '}
                · {sourceText(p)}
              </Box>
            </Typography>
          ))}
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
            {t(
              'teamOpt.kqm.passiveWhere',
              'Set it in Choose weapons; an enemy with HP sets Wolf’s Gravestone’s'
            )}
          </Typography>
        </Box>
      }
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 17,
          px: 0.625,
          ml: 0.75,
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          lineHeight: 1,
          color: 'text.secondary',
          bgcolor: 'action.hover',
          cursor: 'help',
          flexShrink: 0,
          verticalAlign: 'middle',
          ...numSx,
        }}
      >
        {fight !== undefined && fight < 1
          ? t('teamOpt.kqm.passiveShare', {
              defaultValue: 'Passive {{percent}}%',
              percent: Math.round(fight * 100),
            })
          : t('teamOpt.kqm.passiveOn', 'Passive on')}
      </Box>
    </Tooltip>
  )
}
