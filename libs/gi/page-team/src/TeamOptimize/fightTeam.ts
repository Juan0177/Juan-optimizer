import type {
  CharacterKey,
  ElementWithPhyKey,
} from '@genshin-optimizer/gi/consts'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack, TeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  FightTeam,
  KqmBuild,
  TeamData,
  TeamOptEvaluation,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import { icdTracker } from '@genshin-optimizer/gi/ui'
import { input } from '@genshin-optimizer/gi/wr'
import { useDeferredValue, useMemo } from 'react'
import { attackElement } from './DamageShare'
import {
  simulateWritten,
  useMemberNames,
  useRotationSettings,
  useRotationText,
  useSimTeam,
} from './RotationWriter'

/**
 * The gauge units the team's written rotation applies per second, by element: its hits that
 * apply their element through their ICD (as the reactions count them). No written rotation (or
 * `enabled` off): undefined.
 */
export function useRotationGauge(
  teamId: string,
  members: TeamOptMember[],
  enabled: boolean,
  kqm?: TeamOptKqm,
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const { applied } = useRotationText(teamId)
  const { opener, timing, frameData } = useRotationSettings(teamId)
  const team = useSimTeam(members, kqm, kqmBuilds)
  const names = useMemberNames(members)
  // (played after the page: a heavy team's rotation takes a moment)
  const deferredTeam = useDeferredValue(team)
  return useMemo(() => {
    if (!enabled || !applied.trim()) return undefined
    try {
      const played = simulateWritten({
        text: applied,
        opener,
        timing,
        frameData,
        team: deferredTeam,
        names,
        members,
        database,
        teamId,
        gender,
        openerWarning: (warning) => warning,
        // (applications only: a few samples are enough)
        samples: 4,
      })
      const sim = played?.sim
      if (!sim || sim.frames <= 0) return undefined
      const passes = icdTracker()
      const units: Partial<Record<ElementWithPhyKey, number>> = {}
      for (const hit of [...sim.hits].sort((a, b) => a.t - b.t)) {
        if (!hit.applies || hit.element === 'physical') continue
        const durability = hit.durability ?? 25
        if (durability <= 0 || !passes(hit)) continue
        units[hit.element] =
          (units[hit.element] ?? 0) + (durability / 25) * (hit.weight ?? 1)
      }
      const seconds = sim.frames / 60
      return Object.fromEntries(
        Object.entries(units).map(([e, u]) => [e, u / seconds])
      ) as Partial<Record<ElementWithPhyKey, number>>
    } catch (e) {
      // (a rotation that cannot be played: no applications counted)
      if (process.env['NODE_ENV'] === 'development')
        console.warn('[fight] rotation gauge', e)
      return undefined
    }
  }, [
    enabled,
    applied,
    opener,
    timing,
    frameData,
    deferredTeam,
    names,
    members,
    database,
    teamId,
    gender,
  ])
}

/**
 * The team in a fight, from an evaluation of its rotation: its DPS by element (each attack's
 * element from the members' data), the enemy's RES it was computed at, before and after the
 * team's shred, and its element applications
 */
export function fightTeamOf({
  members,
  evaluation,
  attacks,
  teamData,
  rotationTime,
  enemyOverride,
  gauge,
}: {
  members: CharacterKey[]
  evaluation: TeamOptEvaluation | undefined
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
  teamData: TeamData | undefined
  rotationTime: number | undefined
  enemyOverride: Partial<Record<string, number>>
  gauge?: Partial<Record<ElementWithPhyKey, number>>
}): FightTeam | undefined {
  if (!evaluation || !rotationTime || !teamData) return undefined
  const dps: Partial<Record<ElementWithPhyKey, number>> = {}
  for (const ck of members) {
    const damage = evaluation.attacks?.[ck] ?? []
    ;(attacks[ck] ?? []).forEach((attack, i) => {
      const value = damage[i] ?? 0
      if (value <= 0) return
      const element = attackElement(teamData, ck, attack) as ElementWithPhyKey
      dps[element] = (dps[element] ?? 0) + value / rotationTime
    })
  }
  const baseRes = Object.fromEntries(
    allElementWithPhyKeys.map((e) => {
      const v = enemyOverride[`${e}_enemyRes_`] ?? 10
      return [e, v === Number.MAX_VALUE ? Number.POSITIVE_INFINITY : v / 100]
    })
  ) as Record<ElementWithPhyKey, number>
  // the RES after the team's shred: one member's (the enemy's debuffs are the team's)
  const data = members.map((ck) => teamData[ck]?.target).find((d) => d)
  const effRes = Object.fromEntries(
    allElementWithPhyKeys.map((e) => {
      const v = data?.get(input.total[`${e}_enemyRes_`]).value
      return [e, typeof v === 'number' && Number.isFinite(v) ? v : baseRes[e]]
    })
  ) as Record<ElementWithPhyKey, number>
  return { dps, baseRes, effRes, ...(gauge ? { gauge } : {}) }
}
