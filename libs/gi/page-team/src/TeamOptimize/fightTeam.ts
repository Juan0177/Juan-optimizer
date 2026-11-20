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
  DamageTimes,
  ElectroHits,
  FightCycle,
  FightTeam,
  KqmBuild,
  SimHit,
  SimulationResult,
  TeamData,
  TeamOptEvaluation,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  addBonusStats,
  evaluateTeamRotation,
  icdTracker,
  MOONGECKO,
  resMultiplier,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import { input } from '@genshin-optimizer/gi/wr'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { attackElement } from './DamageShare'
import {
  rotationIdOf,
  simulateWritten,
  useAppliedRotation,
  useMemberNames,
  useRotationSettings,
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
  /** Its Radiance, active Nightsoul's Blessing and Cryo hits over one rotation */
  cycle?: FightCycle
  /** Its reactions per second, by reaction */
  reactions?: Partial<Record<string, number>>
  /** One rotation's hits as played, and how long it takes (its damage over time) */
  played?: PlayedHits
  /**
   * Its first rotation from no energy: played once from the start without its Bursts, its
   * attacks and how long it takes
   */
  opening?: {
    attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
    seconds: number
    hits?: PlayedHit[]
  }
}

/** A played hit: seconds from its rotation's start, whose, its sheet node and weight */
export interface PlayedHit {
  t: number
  characterKey: CharacterKey
  path: string[]
  weight: number
}
export interface PlayedHits {
  seconds: number
  hits: PlayedHit[]
}

/** The hits from `start` for `frames` frames, timed from `start` */
function playedHits(
  hits: readonly SimHit[],
  start: number,
  frames: number
): PlayedHit[] {
  return hits
    .filter(
      (h) => h.path[0] !== '_marker' && h.t >= start && h.t < start + frames
    )
    .map((h) => ({
      t: (h.t - start) / 60,
      characterKey: h.characterKey,
      path: h.path,
      weight: h.weight ?? 1,
    }))
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
  start = 0,
  played?: Pick<SimulationResult, 'buffWindows' | 'actions' | 'nightsoulSpans'>
): FightApplications {
  return {
    ...gaugeOf(hits, frames, start),
    cycle: cycleOf(hits, frames, start, played),
    reactions: reactionsOf(hits, frames, start),
  }
}

/** How long a Stellar reaction keeps Radiance: Stellar Glimmer on the enemy (reactions.ts) */
const RADIANCE_SECONDS: Record<string, number> = {
  stellarConduct: 6,
  stellarSwirl: 8,
}

/** Windows merged, within one looped rotation of `seconds` (a window past its end wraps) */
function loopWindows(windows: [number, number][], seconds: number) {
  const parts: [number, number][] = []
  for (const [a, b] of windows) {
    if (!(b > a)) continue
    if (b - a >= seconds) return [[0, seconds]] as [number, number][]
    const from = ((a % seconds) + seconds) % seconds
    const to = from + (b - a)
    if (to <= seconds) parts.push([from, to])
    else parts.push([from, seconds], [0, to - seconds])
  }
  parts.sort((x, y) => x[0] - y[0])
  const merged: [number, number][] = []
  for (const [a, b] of parts) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1] + 1e-9) last[1] = Math.max(last[1], b)
    else merged.push([a, b])
  }
  return merged
}

/** One played rotation's Radiance, active Nightsoul's Blessing and Cryo hits (`FightCycle`) */
function cycleOf(
  hits: readonly SimHit[],
  frames: number,
  start: number,
  played?: Pick<SimulationResult, 'buffWindows' | 'actions' | 'nightsoulSpans'>
): FightCycle | undefined {
  const seconds = frames / 60
  if (!(seconds > 0)) return undefined
  const end = start + frames
  const within = (t: number) => t >= start && t < end
  const radiance: [number, number][] = []
  const cryoHits: [number, number][] = []
  for (const h of hits) {
    if (!within(h.t)) continue
    const at = (h.t - start) / 60
    if (h.path[0] === '_reaction') {
      const last = RADIANCE_SECONDS[h.path[1] ?? '']
      if (last) radiance.push([at, at + last])
      continue
    }
    if (h.path[0].startsWith('_')) continue
    if (h.element === 'cryo') cryoHits.push([at, h.weight ?? 1])
  }
  const blessing: [number, number][] = []
  for (const w of played?.buffWindows ?? []) {
    if (
      w.path[0] !== 'ObsidianCodex' ||
      w.path[1] !== '2NightsoulBlessing' ||
      w.value !== 'on'
    )
      continue
    const a = Math.max(w.start, start)
    const b = Math.min(w.end, end)
    if (b > a) blessing.push([(a - start) / 60, (b - start) / 60])
  }
  const anyBlessing: [number, number][] = []
  const entries: number[] = []
  for (const span of played?.nightsoulSpans ?? []) {
    if (span.start >= start && span.start < end)
      entries.push((span.start - start) / 60)
    const a = Math.max(span.start, start)
    const b = Math.min(span.end, end)
    if (b > a) anyBlessing.push([(a - start) / 60, (b - start) / 60])
  }
  return {
    seconds,
    radiance: loopWindows(radiance, seconds),
    nightsoul: loopWindows(blessing, seconds),
    anyNightsoul: loopWindows(anyBlessing, seconds),
    nightsoulEntries: entries.sort((x, y) => x - y),
    cryoHits: cryoHits.sort((x, y) => x[0] - y[0]),
  }
}

/** A played rotation's reactions per second, by reaction (its reaction marks) */
function reactionsOf(hits: readonly SimHit[], frames: number, start: number) {
  const seconds = frames / 60
  const out: Partial<Record<string, number>> = {}
  if (!(seconds > 0)) return out
  for (const h of hits) {
    if (h.path[0] !== '_reaction' || !h.path[1]) continue
    if (h.t < start || h.t >= start + frames) continue
    out[h.path[1]] = (out[h.path[1]] ?? 0) + (h.weight ?? 1) / seconds
  }
  return out
}

function gaugeOf(
  hits: readonly SimHit[],
  frames: number,
  start: number
): Omit<FightApplications, 'cycle' | 'reactions'> {
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
  // (the tab's own rotation: Team optimize's, or KQM's)
  const rid = rotationIdOf(teamId, kqm)
  const applied = useAppliedRotation(rid)
  const { opener, timing, frameData } = useRotationSettings(rid)
  const team = useSimTeam(members, kqm, kqmBuilds)
  const names = useMemberNames(members)
  // (played after the page: a heavy team's rotation takes a moment)
  const deferredTeam = useDeferredValue(team)
  const isKqm = !!kqm
  return useMemo(() => {
    if (!enabled || !applied.trim()) return undefined
    try {
      const played = simulateWritten({
        kqm: isKqm,
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
      const applications: FightApplications = {
        ...applicationsOf(sim.hits, sim.frames, sim.start, sim),
        played: {
          seconds: sim.frames / 60,
          hits: playedHits(sim.hits, sim.start, sim.frames),
        },
      }
      // (a fight from no energy: its first rotation without Bursts, whatever the tab counts; not
      // counted from the start, so `repeats` is what plays)
      const opening = simulateWritten({
        kqm: isKqm,
        text: applied,
        opener,
        timing: { ...timing, rotations: 0 },
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
            opening: {
              attacks: opening.attacks,
              seconds: span / 60,
              hits: playedHits(opening.sim?.hits ?? [], 0, span),
            },
          }
        : applications
    } catch (e) {
      // (a rotation that cannot be played: no applications counted)
      if (process.env['NODE_ENV'] === 'development')
        console.warn('[fight] rotation applications', e)
      return undefined
    }
  }, [
    isKqm,
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
 * The RES (a fraction) whose damage goes up by `ratio` when every RES is `RES_PROBE` lower: the
 * game's RES multiplier solved on a fine grid, from the enemy's own RES (`from`) down (shred only
 * lowers it; above 75% the multiplier bends back, so the nearest match wins)
 */
export function resFromRatio(ratio: number, from = 0.75) {
  let best = from
  let gap = Number.POSITIVE_INFINITY
  for (let r = from; r >= from - 3; r -= 0.0005) {
    const g = Math.abs(resMultiplier(r - RES_PROBE) / resMultiplier(r) - ratio)
    if (g < gap - 1e-9) {
      gap = g
      best = r
    }
  }
  return Math.round(best * 1000) / 1000
}

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
  dataEnemy = enemyOverride,
  applications,
  cocoon,
}: {
  members: CharacterKey[]
  evaluation: TeamOptEvaluation | undefined
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
  teamData: TeamData | undefined
  rotationTime: number | undefined
  enemyOverride: Partial<Record<string, number>>
  /**
   * The enemy `teamData` was computed against, when another (the KQM tab's own): its RES after the
   * team's shred is moved by the difference
   */
  dataEnemy?: Partial<Record<string, number>>
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
  let cryoHits = 0
  // (no written rotation: every 3rd hit of an element applying 1U)
  const hitsByElement: Partial<Record<ElementWithPhyKey, number>> = {}
  for (const ck of members) {
    const damage = evaluation.attacks?.[ck] ?? []
    ;(attacks[ck] ?? []).forEach((attack, i) => {
      const element = attackElement(teamData, ck, attack) as ElementWithPhyKey
      const stellar = stellarAttack(ck, attack)
      if (element === 'cryo') cryoHits += attack.hits
      if (element !== 'physical')
        hitsByElement[element] = (hitsByElement[element] ?? 0) + attack.hits
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
  // the RES after the team's shred: one member's (the enemy's debuffs are the team's); with the
  // RES probe, each element's as the rotation's damage shows it (its buffs' shred included)
  const data = members.map((ck) => teamData[ck]?.target).find((d) => d)
  const probe =
    cocoon?.base &&
    cocoon.shifted &&
    dpsByElement(members, cocoon.shifted, attacks, teamData, rotationTime)
  const probeBase =
    probe &&
    dpsByElement(members, cocoon!.base!, attacks, teamData, rotationTime)
  const effRes = Object.fromEntries(
    allElementWithPhyKeys.map((e) => {
      const from = probeBase?.[e] ?? 0
      const to = probe?.[e] ?? 0
      if (from > 0 && to > 0 && Number.isFinite(baseRes[e]))
        return [e, resFromRatio(to / from, baseRes[e])]
      const v = data?.get(input.total[`${e}_enemyRes_`]).value
      const dataBase = (dataEnemy[`${e}_enemyRes_`] ?? 10) / 100
      return [
        e,
        typeof v === 'number' && Number.isFinite(v) && Number.isFinite(dataBase)
          ? v + (baseRes[e] - dataBase)
          : baseRes[e],
      ]
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
  const rotationTimes = damageTimesOf(
    members,
    evaluation,
    attacks,
    applications?.played
  )
  const openingTimes =
    open?.hits &&
    damageTimesOf(members, cocoon?.opening, open.attacks, {
      seconds: open.seconds,
      hits: open.hits,
    })
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
          ...(applications.cycle ? { cycle: applications.cycle } : {}),
          ...(applications.reactions
            ? { reactions: applications.reactions }
            : {}),
        }
      : {
          cryoRate: cryoHits / rotationTime,
          estimatedGauge: Object.fromEntries(
            Object.entries(hitsByElement).map(([e, n]) => [
              e,
              (n ?? 0) / 3 / rotationTime,
            ])
          ) as Partial<Record<ElementWithPhyKey, number>>,
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
    ...(rotationTimes
      ? {
          damageTimes: {
            rotation: rotationTimes,
            ...(openingTimes ? { opening: openingTimes } : {}),
          },
        }
      : {}),
    healer: members.some((ck) => PARTY_HEALERS.has(ck)),
  }
}

/**
 * A played rotation's damage over its time: each attack's damage shared among its hits (by sheet
 * node, weighted), the rest (no hit of its node played) spread over the rotation
 */
function damageTimesOf(
  members: CharacterKey[],
  evaluation: TeamOptEvaluation | undefined,
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>,
  played: PlayedHits | undefined
): DamageTimes | undefined {
  if (!evaluation || !played?.hits.length || !(played.seconds > 0))
    return undefined
  const keyOf = (ck: CharacterKey, path: readonly string[]) =>
    `${ck}|${path.join('.')}`
  const damageOf = new Map<string, number>()
  let total = 0
  for (const ck of members) {
    const damage = evaluation.attacks?.[ck] ?? []
    ;(attacks[ck] ?? []).forEach((attack, i) => {
      const value = damage[i] ?? 0
      if (!(value > 0)) return
      total += value
      const key = keyOf(ck, attack.path)
      damageOf.set(key, (damageOf.get(key) ?? 0) + value)
    })
  }
  const weightOf = new Map<string, number>()
  for (const hit of played.hits) {
    const key = keyOf(hit.characterKey, hit.path)
    if (damageOf.has(key))
      weightOf.set(key, (weightOf.get(key) ?? 0) + hit.weight)
  }
  const hits: [number, number][] = []
  let timed = 0
  for (const hit of played.hits) {
    const key = keyOf(hit.characterKey, hit.path)
    const weight = weightOf.get(key)
    if (!weight) continue
    const value = (damageOf.get(key)! * hit.weight) / weight
    hits.push([hit.t, value])
    timed += value
  }
  return {
    seconds: played.seconds,
    hits: hits.sort((a, b) => a[0] - b[0]),
    spread: Math.max(0, total - timed) / played.seconds,
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
  /**
   * The rotation against every RES `RES_PROBE` lower: what each element's RES really is under
   * the rotation's own shred (its buffs, not the members' resting stats)
   */
  shifted?: TeamOptEvaluation
}

/** How far the RES probe lowers every RES (a fraction) */
export const RES_PROBE = 0.6
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
      // (every RES `RES_PROBE` lower than the enemy's: the evaluation's own, else the team's)
      const shiftedEnemy = () => {
        const enemy =
          (deferred as { enemy?: Partial<Record<string, number>> }).enemy ??
          database.teams.get(teamId)?.enemyOverride ??
          {}
        return Object.fromEntries(
          allElementWithPhyKeys.map((e) => {
            const v = enemy[`${e}_enemyRes_`] ?? 10
            return [
              `${e}_enemyRes_`,
              v === Number.MAX_VALUE ? v : v - RES_PROBE * 100,
            ]
          })
        )
      }
      try {
        const members = teamOptMembers(database, teamId).map(
          (m) => m.characterKey
        )
        const withBonus = (
          bonus?: BonusStats,
          attacks: EvaluationSettings['attacks'] = deferred.attacks,
          enemyOverride?: Partial<Record<string, number>>
        ) =>
          evaluateTeamRotation(database, teamId, gender, {
            ...deferred,
            attacks,
            ...(enemyOverride ? { enemyOverride } : {}),
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
            shifted: withBonus(undefined, undefined, shiftedEnemy()),
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
