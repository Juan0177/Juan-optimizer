import type { ElementWithPhyKey } from '@genshin-optimizer/gi/consts'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import type {
  StygianBoss,
  StygianDifficultyKey,
  StygianPhaseKey,
  StygianRes,
} from './stygianBosses'

/**
 * How long a team takes to defeat a Stygian Onslaught boss, its fight's mechanics counted where
 * they are known (this season's bosses: stygian.moe's mechanics guide and the Fandom wiki), else
 * its HP ÷ the team's DPS. An estimate: the team's rotation repeated, its damage per element
 * rescaled to each phase's RES (after the team's own shred), its element applications from the
 * written rotation (gcsim's ICD).
 */

/** What the team brings to the fight */
export interface FightTeam {
  /** Damage per second by element, against the enemy as set (`baseRes`) */
  dps: Partial<Record<ElementWithPhyKey, number>>
  /** That enemy's RES (fractions: 0.1 for 10%; immune: Infinity) */
  baseRes: Record<ElementWithPhyKey, number>
  /** Its RES after the team's shred (what the damage was computed with) */
  effRes: Record<ElementWithPhyKey, number>
  /** Gauge units applied per second, by element (ICD counted); absent: no written rotation */
  gauge?: Partial<Record<ElementWithPhyKey, number>>
}

/** A part of the estimate, for its breakdown */
export type FightPart =
  | { key: 'phase'; phase: StygianPhaseKey; seconds: number }
  | { key: 'valiant'; count: number; seconds: number; electro?: number }
  | { key: 'backlash'; count: number; hp: number }
  | { key: 'horns'; count: number; seconds: number; removal: number }
  | { key: 'hornsBreak'; count: number; hp: number }
export type FightNote =
  | 'stellarGlimmer'
  | 'noRotation'
  | 'noHornRemoval'
  | 'crabs'
  | 'healedToFull'
  | 'ward'
  | 'mechanics'

export interface FightEstimate {
  /** Seconds to defeat it; undefined: not within `FIGHT_LIMIT` */
  seconds: number | undefined
  parts: FightPart[]
  /** What it does not count */
  notes: FightNote[]
  /** Whether the boss's mechanics are modelled (else: HP ÷ DPS) */
  modelled: boolean
}

/** Longer than this (seconds): too slow to say */
export const FIGHT_LIMIT = 600

/** The game's RES multiplier */
export function resMultiplier(res: number) {
  if (res < 0) return 1 - res / 2
  if (res >= 0.75) return 1 / (res * 4 + 1)
  return 1 - res
}

const fraction = (v: number | 'immune') =>
  v === 'immune' ? Number.POSITIVE_INFINITY : v / 100

/** The team's DPS against another phase's RES: each element's, its shred kept */
export function dpsAt(team: FightTeam, res: StygianRes) {
  let total = 0
  for (const e of allElementWithPhyKeys) {
    const dps = team.dps[e] ?? 0
    if (dps <= 0) continue
    const target = fraction(res[e])
    if (!Number.isFinite(target)) continue
    const base = team.baseRes[e]
    const eff = team.effRes[e]
    if (!Number.isFinite(base) || !Number.isFinite(eff)) continue
    total += (dps * resMultiplier(eff + target - base)) / resMultiplier(eff)
  }
  return total
}

const phaseRes = (boss: StygianBoss, key: StygianPhaseKey) =>
  boss.phases.find((p) => p.key === key)?.res

/** HP ÷ DPS at a phase */
function plain(
  boss: StygianBoss,
  hp: number,
  team: FightTeam,
  phase: StygianPhaseKey
): FightEstimate {
  const res = phaseRes(boss, phase)
  const dps = res ? dpsAt(team, res) : 0
  const seconds = dps > 0 ? hp / dps : undefined
  return {
    seconds:
      seconds !== undefined && seconds <= FIGHT_LIMIT ? seconds : undefined,
    parts: seconds ? [{ key: 'phase', phase, seconds }] : [],
    notes: [],
    modelled: false,
  }
}

/**
 * Wavebinder: Stormfang (stygian.moe): ~10 s in, and 20 s after each Valiant State (23 s after one
 * left within 18 s), it drinks for 3 s and fills its 600 Courage: Valiant State. A shield of its
 * Max HP takes the damage at Valiant RES; Courage drains 15/s, and Electro DMG takes 8 x 1.5 per
 * gauge unit. Leaving it, it takes 60% of the damage its shield took, at most 15% of its Max HP.
 */
function wavebinder(
  boss: StygianBoss,
  hp: number,
  team: FightTeam
): FightEstimate {
  const regular = dpsAt(team, phaseRes(boss, 'regular')!)
  const valiant = dpsAt(team, phaseRes(boss, 'shielded')!)
  const electro = team.gauge?.electro ?? 0
  const drain = 15 + 8 * 1.5 * electro
  const notes: FightNote[] = ['stellarGlimmer']
  if (!team.gauge) notes.push('noRotation')
  let t = 0
  let left = hp
  let nextDrink = 10
  let valiants = 0
  let valiantTime = 0
  let regularTime = 0
  let backlash = 0
  while (left > 0 && t < FIGHT_LIMIT) {
    // the regular RES until its drink ends (the drink: 3 s, still at regular RES)
    const until = nextDrink + 3
    if (regular * (until - t) >= left) {
      const dt = left / regular
      t += dt
      regularTime += dt
      left = 0
      break
    }
    left -= regular * (until - t)
    regularTime += until - t
    t = until
    // Valiant State: until its Courage is drained, or its shield (its Max HP) is broken
    const length = Math.min(
      600 / drain,
      valiant > 0 ? hp / valiant : Number.POSITIVE_INFINITY
    )
    t += length
    valiants++
    valiantTime += length
    const taken = Math.min(0.6 * valiant * length, 0.15 * hp)
    backlash += taken
    left -= taken
    nextDrink = t + (length < 18 ? 23 : 20)
  }
  const seconds = left <= 0 && t <= FIGHT_LIMIT ? t : undefined
  return {
    seconds,
    parts: [
      { key: 'phase', phase: 'regular', seconds: regularTime },
      ...(valiants
        ? [
            {
              key: 'valiant' as const,
              count: valiants,
              seconds: valiantTime / valiants,
              ...(team.gauge ? { electro } : {}),
            },
            { key: 'backlash' as const, count: valiants, hp: backlash / hp },
          ]
        : []),
    ],
    notes,
    modelled: true,
  }
}

/**
 * Emperor of Fire and Iron: Ordained Conquest (the wiki; stygian.moe): its horns, a 64U Pyro aura,
 * add 150% to all its RES. Elemental reactions on them take them down (gauge per reaction: Hydro
 * 2x, Electro 1x, Cryo, Anemo and Geo 0.5x); broken, it takes 10% of its Max HP, and 10 s later it
 * grows new ones. Its Sternshield Crabs (12U Pyro each, slamming into it when depleted) take the
 * same reactions to the same end, and are not counted.
 */
function emperor(
  boss: StygianBoss,
  hp: number,
  team: FightTeam
): FightEstimate {
  const regular = phaseRes(boss, 'regular')!
  const hornsRes = Object.fromEntries(
    allElementWithPhyKeys.map((e) => {
      const v = regular[e]
      return [e, v === 'immune' ? v : v + 150]
    })
  ) as StygianRes
  const withHorns = dpsAt(team, hornsRes)
  const without = dpsAt(team, regular)
  const g = team.gauge ?? {}
  const removal =
    2 * (g.hydro ?? 0) +
    (g.electro ?? 0) +
    0.5 * ((g.cryo ?? 0) + (g.anemo ?? 0) + (g.geo ?? 0))
  const notes: FightNote[] = ['crabs']
  if (!team.gauge) notes.push('noRotation')
  else if (removal <= 0) notes.push('noHornRemoval')
  const hornTime = removal > 0 ? 64 / removal : Number.POSITIVE_INFINITY
  let t = 0
  let left = hp
  let breaks = 0
  let hornsTime = 0
  let regularTime = 0
  while (left > 0 && t < FIGHT_LIMIT) {
    // horns on: until they break (or it falls)
    if (withHorns * hornTime >= left || !Number.isFinite(hornTime)) {
      const dt = withHorns > 0 ? left / withHorns : Number.POSITIVE_INFINITY
      t += dt
      hornsTime += dt
      left = 0
      break
    }
    left -= withHorns * hornTime
    t += hornTime
    hornsTime += hornTime
    breaks++
    left -= 0.1 * hp
    if (left <= 0) break
    // 10 s without them
    if (without * 10 >= left) {
      const dt = left / without
      t += dt
      regularTime += dt
      left = 0
      break
    }
    left -= without * 10
    t += 10
    regularTime += 10
  }
  const seconds = left <= 0 && t <= FIGHT_LIMIT ? t : undefined
  return {
    seconds,
    parts: [
      // (each pair of horns: how long it takes to break; never broken: the whole fight)
      {
        key: 'horns',
        count: breaks,
        seconds: breaks ? hornTime : hornsTime,
        removal,
      },
      ...(breaks
        ? [{ key: 'hornsBreak' as const, count: breaks, hp: breaks * 0.1 }]
        : []),
      ...(regularTime
        ? [
            {
              key: 'phase' as const,
              phase: 'regular' as const,
              seconds: regularTime,
            },
          ]
        : []),
    ],
    notes,
    modelled: true,
  }
}

/**
 * Radiant Moongecko: Entangled Fangs: healed to full after its Radiant Cocoon, the team fights it
 * at its Dull Carapace RES (stygian.moe). Its Moonstone Anchor's ward (9 segments of 4U Geo, up
 * to 40% of its Max HP moved to it when broken) comes at times its guide does not give: not
 * counted, nor the CRIT debuff before healing or the buff after.
 */
function moongecko(
  boss: StygianBoss,
  hp: number,
  team: FightTeam
): FightEstimate {
  const estimate = plain(boss, hp, team, 'dullCarapace')
  return { ...estimate, notes: ['healedToFull', 'ward'], modelled: true }
}

const models: Partial<
  Record<
    number,
    (boss: StygianBoss, hp: number, team: FightTeam) => FightEstimate
  >
> = {
  1013061: wavebinder,
  1006063: emperor,
  1008061: moongecko,
}

/** The fight at a difficulty: its mechanics where they are known, else HP ÷ DPS at `phase` */
export function stygianFight(
  boss: StygianBoss,
  difficulty: StygianDifficultyKey,
  team: FightTeam,
  phase: StygianPhaseKey = boss.main
): FightEstimate {
  const hp = boss.hp[difficulty]
  const model = models[boss.id]
  if (model) return model(boss, hp, team)
  return { ...plain(boss, hp, team, phase), notes: ['mechanics'] }
}

/** Whether a boss's fight has its mechanics modelled */
export const stygianFightModelled = (bossId: number) => !!models[bossId]
