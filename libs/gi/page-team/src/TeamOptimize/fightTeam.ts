import type {
  CharacterKey,
  ElementWithPhyKey,
} from '@genshin-optimizer/gi/consts'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack, TeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharStat } from '@genshin-optimizer/gi/stats'
import type {
  BonusStats,
  ElectroHits,
  FightTeam,
  KqmBuild,
  SimHit,
  TeamData,
  TeamOptEvaluation,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  addBonusStats,
  evaluateTeamRotation,
  icdTracker,
  MOONGECKO,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import { input } from '@genshin-optimizer/gi/wr'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
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
  /** Seconds it takes to break the Moongecko's Moonstone Anchor ward (`wardTimeOf`) */
  wardSeconds: number
  /**
   * Its first rotation from no energy: played once from the start without its Bursts, its
   * attacks and how long it takes
   */
  opening?: {
    attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
    seconds: number
  }
}

const MELEE = ['sword', 'claymore', 'polearm']
/**
 * Seconds a played rotation's hits take to break the Radiant Moongecko's Moonstone Anchor ward
 * (`MOONGECKO`: 9 layers of 4U Geo, 100 durability each), the rotation looped from its start.
 * Its poise takes a Geo ward down (the wiki's Ward page, from the game's cost ratios): a Blunt hit
 * 0.35 of its poise (claymores' normal and charged attacks, plunges, Geo attacks: gcsim's Shatter
 * rule), another melee hit 0.05. Poise: the kit's, else 100 (Blunt) or 50. A hit takes at most the
 * layer left; none land in the 0.1 s before the next layer. Not within 120 s: Infinity. `start`:
 * the kept rotation's first frame (its hits' times are the whole play's)
 */
export function wardTimeOf(
  hits: readonly SimHit[],
  frames: number,
  start = 0
): number {
  const cost = (hit: SimHit) => {
    // (reaction damage, Lunar or Stellar included, strikes with no poise: only the members'
    // own attacks wear the ward down)
    if (
      hit.path[0] === '_marker' ||
      hit.path[0] === '_heal' ||
      hit.path[0] === 'reaction' ||
      hit.path[0] === '_reaction' ||
      !['normal', 'charged', 'plunge', 'skill', 'burst'].includes(hit.tag)
    )
      return 0
    const weapon = getCharStat(hit.characterKey).weaponType
    const attack =
      hit.tag === 'normal' || hit.tag === 'charged' || hit.tag === 'plunge'
    const blunt =
      hit.blunt ||
      hit.element === 'geo' ||
      (hit.tag === 'plunge' && hit.durability !== 0) ||
      ((hit.tag === 'normal' || hit.tag === 'charged') && weapon === 'claymore')
    const melee = attack && MELEE.includes(weapon)
    if (!blunt && !melee) return 0
    const poise = hit.poiseDamage ?? (blunt ? 100 : 50)
    return (blunt ? 0.35 : 0.05) * poise * (hit.weight ?? 1)
  }
  const sorted = hits
    .map((hit) => ({ t: hit.t - start, cost: cost(hit) }))
    .filter((h) => h.cost > 0)
    .sort((a, b) => a.t - b.t)
  if (!sorted.length || frames <= 0) return Number.POSITIVE_INFINITY
  let layers = 0
  let left: number = MOONGECKO.layerDurability
  let ready = 0
  for (let loop = 0; (loop * frames) / 60 < 120; loop++)
    for (const hit of sorted) {
      const time = (loop * frames + hit.t) / 60
      if (time < ready) continue
      left -= hit.cost
      if (left > 1e-9) continue
      if (++layers >= MOONGECKO.layers) return time
      left = MOONGECKO.layerDurability
      ready = time + MOONGECKO.layerGap
    }
  return Number.POSITIVE_INFINITY
}

/**
 * Members whose kit heals the party (the rotation kits' heals): they break the Moongecko's Radiant
 * Cocoon. Not counted: self-heals (Hu Tao), a constellation's heal (Gorou, Dehya), Xingqiu's
 * small Rain Sword heal
 */
export const PARTY_HEALERS: ReadonlySet<CharacterKey> = new Set<CharacterKey>([
  'Alyosha',
  'Baizhu',
  'Barbara',
  'Bennett',
  'Charlotte',
  'Chevreuse',
  'Diona',
  'Dori',
  'Escoffier',
  'Furina',
  'Iansan',
  'Ifa',
  'Jahoda',
  'Jean',
  'KukiShinobu',
  'Linnea',
  'Mika',
  'Noelle',
  'Qiqi',
  'SangonomiyaKokomi',
  'Sayu',
  'Sigewinne',
  'Vodyanitsa',
  'Xianyun',
  'Xilonen',
  'Yaoyao',
  'YumemizukiMizuki',
])

/**
 * A played rotation's hits, per second: the gauge units each element applies through its ICD, and
 * its Electro hits by what each takes off Wavebinder's Courage
 */
export function applicationsOf(
  hits: readonly SimHit[],
  frames: number,
  start = 0
): FightApplications {
  const passes = icdTracker()
  const units: Partial<Record<ElementWithPhyKey, number>> = {}
  const electro = { stellar: 0, units: 0, plain: 0 }
  for (const hit of [...hits].sort((a, b) => a.t - b.t)) {
    if (hit.path[0] === '_marker') continue
    const weight = hit.weight ?? 1
    // (an Electro hit: Stellar Glimmer DMG, or one applying its element, or none)
    const isElectro = hit.element === 'electro'
    const stellar =
      isElectro &&
      (hit.tag === 'directStellarConduct' || hit.tag === 'directStellarSwirl')
    if (stellar) electro.stellar += weight
    const durability = hit.durability ?? 25
    if (
      !hit.applies ||
      hit.element === 'physical' ||
      durability <= 0 ||
      !passes(hit)
    ) {
      if (isElectro && !stellar) electro.plain += weight
      continue
    }
    units[hit.element] = (units[hit.element] ?? 0) + (durability / 25) * weight
    // (the game counts its durability in whole units, at most 4U)
    if (isElectro && !stellar)
      electro.units += Math.min(4, Math.ceil(durability / 25)) * weight
  }
  const seconds = frames / 60
  return {
    gauge: Object.fromEntries(
      Object.entries(units).map(([e, u]) => [e, u / seconds])
    ) as Partial<Record<ElementWithPhyKey, number>>,
    electroHits: {
      stellar: electro.stellar / seconds,
      units: electro.units / seconds,
      plain: electro.plain / seconds,
    },
    wardSeconds: wardTimeOf(hits, frames, start),
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
      const applications = applicationsOf(sim.hits, sim.frames, sim.start)
      // (a fight from no energy: its first rotation without Bursts)
      const opening = simulateWritten({
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
        samples: 4,
        repeats: 1,
        keep: 'all',
        withoutBursts: true,
      })
      const span = opening?.sim && opening.sim.start + opening.sim.frames
      return opening?.attacks && span && span > 0
        ? {
            ...applications,
            opening: { attacks: opening.attacks, seconds: span / 60 },
          }
        : applications
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

/** An evaluation's damage per second, by element (each attack's element from the members' data) */
function dpsByElement(
  members: CharacterKey[],
  evaluation: TeamOptEvaluation,
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>,
  teamData: TeamData,
  rotationTime: number
) {
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
  return dps
}

/**
 * The team in a fight, from an evaluation of its rotation: its DPS by element (each attack's
 * element from the members' data), the enemy's RES it was computed at, before and after the
 * team's shred, and its element applications (the written rotation's; without one, its Electro
 * hits estimated from the attacks entered). With `cocoon` (the same evaluation in the Moongecko's
 * Radiant Cocoon and Disentangled, `useCocoonEvaluations`): its DPS in them too.
 */
export function fightTeamOf({
  members,
  evaluation,
  attacks,
  teamData,
  rotationTime,
  enemyOverride,
  applications,
  cocoon,
}: {
  members: CharacterKey[]
  evaluation: TeamOptEvaluation | undefined
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
  teamData: TeamData | undefined
  rotationTime: number | undefined
  enemyOverride: Partial<Record<string, number>>
  applications?: FightApplications
  cocoon?: CocoonEvaluations
}): FightTeam | undefined {
  if (!evaluation || !rotationTime || !teamData) return undefined
  const dps = dpsByElement(members, evaluation, attacks, teamData, rotationTime)
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
  // its DPS in the cocoon and Disentangled: each element's, as their evaluation changes it from
  // the same one without them (the damage shown may be a run's, found with its own settings)
  const base =
    cocoon?.base &&
    dpsByElement(members, cocoon.base, attacks, teamData, rotationTime)
  const variant = (e: TeamOptEvaluation | undefined) => {
    if (!e || !base) return undefined
    const changed = dpsByElement(members, e, attacks, teamData, rotationTime)
    return Object.fromEntries(
      Object.entries(dps).map(([el, v]) => {
        const from = base[el as ElementWithPhyKey] ?? 0
        const to = changed[el as ElementWithPhyKey] ?? 0
        return [el, from > 0 ? (v * to) / from : v]
      })
    ) as Partial<Record<ElementWithPhyKey, number>>
  }
  const cocooned = variant(cocoon?.cocooned)
  const disentangled = variant(cocoon?.disentangled)
  // the first rotation from no energy: its own attacks and length, as its evaluation changes
  // each element's DPS from the rotation's
  const open = applications?.opening
  const opening =
    open && cocoon?.opening && base
      ? (() => {
          const own = dpsByElement(
            members,
            cocoon.opening!,
            open.attacks,
            teamData,
            open.seconds
          )
          return Object.fromEntries(
            allElementWithPhyKeys.map((el) => {
              const from = base[el] ?? 0
              const to = own[el] ?? 0
              return [el, from > 0 ? ((dps[el] ?? 0) * to) / from : to]
            })
          ) as Partial<Record<ElementWithPhyKey, number>>
        })()
      : undefined
  return {
    dps,
    baseRes,
    effRes,
    stellarShare: damageTotal > 0 ? stellarDamage / damageTotal : 0,
    ...(applications
      ? {
          gauge: applications.gauge,
          electroHits: applications.electroHits,
          wardSeconds: applications.wardSeconds,
        }
      : {
          // (no written rotation: every 3rd other hit applying 1U, as the standard ICD lets it)
          electroHits: {
            stellar: stellarHits / rotationTime,
            units: electroHits / 3 / rotationTime,
            plain: (electroHits * 2) / 3 / rotationTime,
            estimated: true,
          },
        }),
    ...(cocooned ? { cocooned } : {}),
    ...(disentangled ? { disentangled } : {}),
    ...(opening && open
      ? { opening: { dps: opening, seconds: open.seconds } }
      : {}),
    healer: members.some((ck) => PARTY_HEALERS.has(ck)),
  }
}

/** Radiant Cocoon's stats on a member (percent points): −100% CRIT Rate, −50% DMG Bonus */
export const COCOON_BONUS: BonusStats = { critRate_: -100, all_dmg_: -50 }
/** Disentangled's: +15% CRIT Rate, +50% DMG Bonus */
export const DISENTANGLED_BONUS: BonusStats = { critRate_: 15, all_dmg_: 50 }

/**
 * The rotation's damage in the Moongecko's Radiant Cocoon, and with Disentangled, and the same
 * evaluation without them
 */
export interface CocoonEvaluations {
  base?: TeamOptEvaluation
  cocooned?: TeamOptEvaluation
  disentangled?: TeamOptEvaluation
  /** The first rotation from no energy (`FightApplications.opening`'s attacks) */
  opening?: TeamOptEvaluation
}
type EvaluationSettings = Parameters<typeof evaluateTeamRotation>[3]

/**
 * The rotation's damage with the Moongecko's Radiant Cocoon on every member, and with Disentangled:
 * the evaluation the damage shown comes from (`settings`), their stats added to each member's.
 * `settings` undefined (another enemy): none. Computed after a pause (a team's formulas take a
 * moment).
 */
export function useCocoonEvaluations(
  teamId: string,
  settings: EvaluationSettings | undefined,
  {
    cocoon = true,
    opening,
  }: {
    /** The Moongecko's cocoon and Disentangled too (another boss: the opening only) */
    cocoon?: boolean
    /** The first rotation from no energy: its attacks */
    opening?: Partial<Record<CharacterKey, TeamOptAttack[]>>
  } = {}
): CocoonEvaluations | undefined {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const deferred = useDeferredValue(settings)
  const [out, setOut] = useState<{
    settings: EvaluationSettings
    value: CocoonEvaluations
  }>()
  useEffect(() => {
    if (!deferred) return undefined
    const timer = setTimeout(() => {
      try {
        const members = teamOptMembers(database, teamId).map(
          (m) => m.characterKey
        )
        const withBonus = (
          bonus?: BonusStats,
          attacks: EvaluationSettings['attacks'] = deferred.attacks
        ) =>
          evaluateTeamRotation(database, teamId, gender, {
            ...deferred,
            attacks,
            bonusStats: Object.fromEntries(
              members.map((ck) => [
                ck,
                addBonusStats(deferred.bonusStats?.[ck], bonus),
              ])
            ),
          })
        setOut({
          settings: deferred,
          value: {
            base: withBonus(),
            ...(cocoon
              ? {
                  cocooned: withBonus(COCOON_BONUS),
                  disentangled: withBonus(DISENTANGLED_BONUS),
                }
              : {}),
            ...(opening ? { opening: withBonus(undefined, opening) } : {}),
          },
        })
      } catch (e) {
        if (process.env['NODE_ENV'] === 'development')
          console.warn('[fight] cocoon evaluations', e)
      }
    }, 150)
    return () => clearTimeout(timer)
  }, [database, teamId, gender, deferred, cocoon, opening])
  // (only for the settings asked: an older team's stay out)
  return settings && out?.settings === settings ? out.value : undefined
}
