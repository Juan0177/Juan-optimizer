import type {
  CharacterKey,
  ElementWithPhyKey,
} from '@genshin-optimizer/gi/consts'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack, TeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  ElectroHits,
  FightTeam,
  KqmBuild,
  SimHit,
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

/** What the team's written rotation does to the enemy, per second */
export interface FightApplications {
  /** Gauge units applied, by element: its hits that apply it through their ICD */
  gauge: Partial<Record<ElementWithPhyKey, number>>
  /** Its Electro hits, by what each takes off Wavebinder's Courage */
  electroHits: ElectroHits
}

/**
 * A played rotation's hits, per second: the gauge units each element applies through its ICD, and
 * its Electro hits by what each takes off Wavebinder's Courage
 */
export function applicationsOf(
  hits: readonly SimHit[],
  frames: number
): FightApplications {
  const passes = icdTracker()
  const units: Partial<Record<ElementWithPhyKey, number>> = {}
  const electro = { stellar: 0, hits: 0, units: 0 }
  for (const hit of [...hits].sort((a, b) => a.t - b.t)) {
    if (hit.path[0] === '_marker') continue
    const weight = hit.weight ?? 1
    // (an Electro hit: Stellar Glimmer DMG, or one applying its element, or none)
    const isElectro = hit.element === 'electro'
    const stellar =
      isElectro &&
      (hit.tag === 'directStellarConduct' || hit.tag === 'directStellarSwirl')
    if (stellar) electro.stellar += weight
    else if (isElectro) electro.hits += weight
    const durability = hit.durability ?? 25
    if (
      !hit.applies ||
      hit.element === 'physical' ||
      durability <= 0 ||
      !passes(hit)
    )
      continue
    units[hit.element] = (units[hit.element] ?? 0) + (durability / 25) * weight
    if (isElectro && !stellar) electro.units += (durability / 25) * weight
  }
  const seconds = frames / 60
  return {
    gauge: Object.fromEntries(
      Object.entries(units).map(([e, u]) => [e, u / seconds])
    ) as Partial<Record<ElementWithPhyKey, number>>,
    electroHits: {
      stellar: electro.stellar / seconds,
      hits: electro.hits / seconds,
      units: electro.units / seconds,
    },
  }
}

/**
 * The team's written rotation, played: the gauge units it applies per second, by element (its hits
 * that apply their element through their ICD, as the reactions count them), and its Electro hits
 * by kind. No written rotation (or `enabled` off): undefined.
 */
export function useRotationApplications(
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
      return applicationsOf(sim.hits, sim.frames)
    } catch (e) {
      // (a rotation that cannot be played: no applications counted)
      if (process.env['NODE_ENV'] === 'development')
        console.warn('[fight] rotation applications', e)
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
 * Attacks dealing Stellar Glimmer DMG (Stellar-Conduct or -Swirl), as the kits deal them (their
 * hits tagged directStellar…), beyond the nodes named so: an attack entered by hand does not say
 * so itself
 */
const STELLAR_ATTACKS: Partial<Record<CharacterKey, RegExp>> = {
  Anastasya: /\.\w+S[cs]$/,
  Danica: /^(skill\.(onField|entry)Dmg|burst\.hit[15]ScDmg)$/,
  Mitya:
    /^(skill\.(tap|hold|steadyConsume|steadyDetonate)Dmg|constellation4\.dmg)$/,
  Wriothesley:
    /^(passive1\.(hit[35]|lusterDmg)|constellation6\.(hit5|lusterDmg))$/,
  YaeMiko: /^lockedPassive\.dmg$/,
  YumemizukiMizuki: /^(lockedPassive\.skillContSsDmg|constellation1\.ssDmg)$/,
}
export const stellarAttack = (ck: CharacterKey, attack: TeamOptAttack) =>
  /stellar/i.test(attack.path[attack.path.length - 1] ?? '') ||
  !!STELLAR_ATTACKS[ck]?.test(attack.path.join('.'))

/**
 * The team in a fight, from an evaluation of its rotation: its DPS by element (each attack's
 * element from the members' data), the enemy's RES it was computed at, before and after the
 * team's shred, and its element applications (the written rotation's; without one, its Electro
 * hits estimated from the attacks entered)
 */
export function fightTeamOf({
  members,
  evaluation,
  attacks,
  teamData,
  rotationTime,
  enemyOverride,
  applications,
}: {
  members: CharacterKey[]
  evaluation: TeamOptEvaluation | undefined
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
  teamData: TeamData | undefined
  rotationTime: number | undefined
  enemyOverride: Partial<Record<string, number>>
  applications?: FightApplications
}): FightTeam | undefined {
  if (!evaluation || !rotationTime || !teamData) return undefined
  const dps: Partial<Record<ElementWithPhyKey, number>> = {}
  // (its Electro hits per rotation, Stellar Glimmer DMG and the others; its Stellar Glimmer DMG)
  let stellarHits = 0
  let electroHits = 0
  let stellarDamage = 0
  let damageTotal = 0
  for (const ck of members) {
    const damage = evaluation.attacks?.[ck] ?? []
    ;(attacks[ck] ?? []).forEach((attack, i) => {
      const element = attackElement(teamData, ck, attack) as ElementWithPhyKey
      const stellar = stellarAttack(ck, attack)
      if (element === 'electro') {
        if (stellar) stellarHits += attack.hits
        else electroHits += attack.hits
      }
      const value = damage[i] ?? 0
      if (value <= 0) return
      dps[element] = (dps[element] ?? 0) + value / rotationTime
      damageTotal += value
      if (stellar) stellarDamage += value
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
  return {
    dps,
    baseRes,
    effRes,
    stellarShare: damageTotal > 0 ? stellarDamage / damageTotal : 0,
    ...(applications
      ? { gauge: applications.gauge, electroHits: applications.electroHits }
      : {
          // (no written rotation: every 3rd other hit applying 1U, as the standard ICD lets it)
          electroHits: {
            stellar: stellarHits / rotationTime,
            hits: electroHits / rotationTime,
            units: electroHits / 3 / rotationTime,
            estimated: true,
          },
        }),
  }
}
