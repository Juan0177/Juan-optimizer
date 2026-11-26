import { SuspenseTooltip } from '@genshin-optimizer/common/ui'
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
import { Box, Typography } from '@mui/material'
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
  /** Its share of the rotation, 0 to 1, when the rotation or cooldown limits uptime */
  rotation?: number
  /** Rotation-share source: timed by the written rotation, or scaled by rotation length */
  rotationSource?: 'played' | 'cooldown'
  source: 'rule' | 'kqm'
}

/**
 * Hit-weighted uptime (0..1) of a weapon passive that the written rotation explicitly timed via
 * `states` or `limits`. Returns `undefined` if the rotation never timed this passive.
 */
export function playedWeaponPassiveUptime(
  attacks: TeamOpt['attacks'] | undefined,
  owner: CharacterKey,
  path: readonly string[],
  baseValue: string | undefined,
  teamBuff: boolean
): number | undefined {
  if (!attacks) return undefined
  const key = path.join('.')
  const match = (ref: { owner: string; path: readonly string[] }) =>
    ref.owner === owner && ref.path.join('.') === key
  let timed = false
  for (const list of Object.values(attacks))
    for (const attack of list ?? [])
      if (attack.states?.some(match) || attack.limits?.some(match)) {
        timed = true
        break
      }
  if (!timed) return undefined

  const activeHitsOf = (
    attack: NonNullable<TeamOpt['attacks'][CharacterKey]>[number]
  ) => {
    const hits = attack.hits ?? 0
    if (hits <= 0) return 0
    const state = attack.states?.find(match)
    if (state !== undefined) return state.value ? hits : 0
    const limit = attack.limits?.find(match)
    if (limit !== undefined) return Math.max(0, Math.min(hits, limit.hits))
    return baseValue ? hits : 0
  }

  // Thrilling Tales only buffs the active teammate receiving the swap (never the wielder or
  // off-field hits): measure uptime across the recipient teammate(s)' on-field hits.
  if (path[0] === 'ThrillingTalesOfDragonSlayers') {
    const byMember = new Map<CharacterKey, { on: number; total: number }>()
    for (const [ck, list] of Object.entries(attacks) as [
      CharacterKey,
      TeamOpt['attacks'][CharacterKey],
    ][]) {
      if (ck === owner) continue
      let on = 0
      let total = 0
      for (const attack of list ?? []) {
        const hits = attack.hits ?? 0
        if (hits <= 0) continue
        if (attack.onField && attack.onField !== ck) continue
        total += hits
        on += activeHitsOf(attack)
      }
      if (total > 0) byMember.set(ck, { on, total })
    }
    const recipients = [...byMember.values()].filter((m) => m.on > 0)
    if (!recipients.length) return 0
    const on = recipients.reduce((s, m) => s + m.on, 0)
    const total = recipients.reduce((s, m) => s + m.total, 0)
    return total > 0 ? Math.min(1, on / total) : 0
  }

  let on = 0
  let total = 0
  for (const [ck, list] of Object.entries(attacks) as [
    CharacterKey,
    TeamOpt['attacks'][CharacterKey],
  ][]) {
    if (!teamBuff && ck !== owner) continue
    for (const attack of list ?? []) {
      const hits = attack.hits ?? 0
      if (hits <= 0) continue
      total += hits
      on += activeHitsOf(attack)
    }
  }
  return total > 0 ? Math.min(1, on / total) : undefined
}

/**
 * Per weapon, its passives a KQM run counts on for this member: by rule, KQM mode's switch, or for
 * a share of the fight against the enemy (Wolf's Gravestone) or rotation (TTDS, timed passives)
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
        rotationTime: result.played ? undefined : runSettings.rotationTime,
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
        const timedUptime =
          fightValue === undefined
            ? playedWeaponPassiveUptime(
                result.played?.attacks,
                characterKey,
                path,
                value,
                !!section.teamBuff
              )
            : undefined
        if (!value && timedUptime === undefined) continue
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
        const cooldownShare =
          fight === undefined &&
          timedUptime === undefined &&
          weaponKey === 'ThrillingTalesOfDragonSlayers' &&
          value &&
          value !== 'on' &&
          /^\d+$/.test(value)
            ? Number(value) / 100
            : undefined
        const rotation = timedUptime ?? cooldownShare
        const rotationSource =
          timedUptime !== undefined
            ? ('played' as const)
            : cooldownShare !== undefined
              ? ('cooldown' as const)
              : undefined
        out.push({
          path: path.join('.'),
          label: section.name,
          state:
            fight === undefined &&
            rotation === undefined &&
            entries.length > 1 &&
            value
              ? (states[value]?.name ?? value)
              : undefined,
          fight,
          rotation,
          rotationSource,
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
  const rotation = passives.find((p) => p.rotation !== undefined)?.rotation
  const share = fight ?? rotation
  const sourceText = (p: CountedPassive) =>
    p.fight !== undefined
      ? t('teamOpt.kqm.passiveFight', {
          defaultValue: '{{percent}}% of the fight, from the enemy’s HP',
          percent: Math.round(p.fight * 100),
        })
      : p.rotation !== undefined
        ? p.rotationSource === 'cooldown'
          ? t('teamOpt.kqm.passiveCooldown', {
              defaultValue: '{{percent}}% of rotations (20 s cooldown)',
              percent: Math.round(p.rotation * 100),
            })
          : t('teamOpt.kqm.passiveRotation', {
              defaultValue: '{{percent}}% of hits in this rotation',
              percent: Math.round(p.rotation * 100),
            })
        : p.source === 'rule'
          ? t('teamOpt.kqm.passiveRule', 'on by rule')
          : t('teamOpt.kqm.passiveSwitch', 'on by your switch')
  return (
    <SuspenseTooltip
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
        {share !== undefined && Math.round(share * 100) < 100
          ? t('teamOpt.kqm.passiveShare', {
              defaultValue: 'Passive {{percent}}%',
              percent: Math.round(share * 100),
            })
          : t('teamOpt.kqm.passiveOn', 'Passive on')}
      </Box>
    </SuspenseTooltip>
  )
}
