import type { ElementWithPhyKey } from '@genshin-optimizer/gi/consts'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import type { Team } from '@genshin-optimizer/gi/db'
import type {
  StygianBoss,
  StygianDifficultyKey,
  StygianPhaseKey,
  StygianRes,
} from './stygianBosses'
import { appliedStygianPreset } from './stygianBosses'

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
  /** Its Electro hits per second, by kind (Wavebinder's Courage); absent: not known */
  electroHits?: ElectroHits
  /** The share of its damage that is Stellar Glimmer DMG (Stellar-Conduct or -Swirl) */
  stellarShare?: number
}

/** Electro hits per second, by what each takes off Wavebinder's Courage */
export interface ElectroHits {
  /** Stellar Glimmer (Stellar-Conduct) Electro DMG */
  stellar: number
  /** The element units the other Electro hits apply, in whole units (1U: 25 durability) */
  units: number
  /** The other Electro hits that apply no element (under ICD, or none to apply) */
  plain: number
  /**
   * Estimated from the attacks entered (no written rotation): every 3rd of the other hits applies
   * 1U (the standard ICD)
   */
  estimated?: boolean
}

/**
 * Wavebinder's Courage (stygian.moe's mechanical guide, the game files' Stygian values): 600 at
 * most; a drink gives 600 (540 under Radiance: Stellar Glimmer); outside its drinks, each Electro
 * hit takes 1.5 per element unit it applies, at least 0.6, and Electro Stellar Glimmer DMG 6; its
 * Valiant Assault drains 15/s (40 s on its own), the hits 8 times as much
 */
export const COURAGE = {
  max: 600,
  decay: 15,
  stellar: 6,
  unit: 1.5,
  plain: 0.6,
  valiant: 8,
  drink: 600,
  stellarDrink: 540,
} as const

/** Courage the team's Electro hits take per second, outside its drinks and Valiant Assault */
export const courageDrain = (hits: ElectroHits | undefined) =>
  hits
    ? COURAGE.stellar * hits.stellar +
      COURAGE.unit * hits.units +
      COURAGE.plain * hits.plain
    : 0

/** A part of the estimate, for its breakdown */
export type FightPart =
  | { key: 'phase'; phase: StygianPhaseKey; seconds: number }
  | {
      key: 'valiant'
      count: number
      seconds: number
      /** Courage the team's Electro hits take per second in it (its own 15/s aside) */
      courage?: number
      /** Its Stellar Glimmer Electro hits per second */
      stellar?: number
    }
  | { key: 'backlash'; count: number; hp: number }
  /** Wavebinder's drinks under Radiance: Stellar Glimmer (540 Courage, not enough on its own) */
  | { key: 'radianceDrinks'; count: number }
  | { key: 'horns'; count: number; seconds: number; removal: number }
  | { key: 'hornsBreak'; count: number; hp: number }
  /** An enemy set by hand: its HP ÷ the team's DPS */
  | { key: 'custom'; dps: number; seconds: number }
export type FightNote =
  | 'noRotation'
  | 'electroEstimated'
  | 'electroStun'
  | 'sip'
  | 'noHornRemoval'
  | 'crabs'
  | 'healedToFull'
  | 'ward'
  | 'mechanics'

/** A stretch of the fight in one state: its HP (fractions of its Max HP) from start to end */
export interface FightSegment {
  start: number
  end: number
  /** Its state: one of its phases, its horns on (the Emperor) or its drink (Wavebinder) */
  state: StygianPhaseKey | 'horns' | 'drinking'
  hpStart: number
  hpEnd: number
  /** The team's DPS against it here (a shield state: what its shield takes) */
  dps?: number
  /** Its meter from start to end (linear): Wavebinder's Courage, the Emperor's horn gauge */
  meterStart?: number
  meterEnd?: number
  /** A shield state: the share of what its shield takes that comes back as backlash (uncapped) */
  backlashRatio?: number
}
/** A moment that takes HP off at once (fractions of its Max HP) */
export interface FightEvent {
  t: number
  kind: 'backlash' | 'hornsBreak'
  hp: number
}

export interface FightEstimate {
  /** Seconds to defeat it; undefined: not within `FIGHT_LIMIT` */
  seconds: number | undefined
  parts: FightPart[]
  /** The fight over time (as far as `FIGHT_LIMIT`), and its meter if it has one */
  timeline: {
    segments: FightSegment[]
    events: FightEvent[]
    meter?: { key: 'courage' | 'hornGauge'; max: number }
  }
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
  const end = Math.min(seconds ?? FIGHT_LIMIT, FIGHT_LIMIT)
  return {
    seconds:
      seconds !== undefined && seconds <= FIGHT_LIMIT ? seconds : undefined,
    parts: seconds ? [{ key: 'phase', phase, seconds }] : [],
    timeline: {
      segments: [
        {
          start: 0,
          end,
          state: phase,
          hpStart: 1,
          hpEnd: Math.max(0, 1 - (dps * end) / hp),
          dps,
        },
      ],
      events: [],
    },
    notes: [],
    modelled: false,
  }
}

/**
 * Wavebinder: Stormfang (stygian.moe's mechanical guide and the game files): ~10 s in, and every
 * 20 s while it is not in its Valiant Assault, it drinks for 3 s:
 * 600 Courage, or 540 under Radiance: Stellar Glimmer (a Stellar Glimmer team: its next drink
 * fills it). Outside its drinks, the team's Electro hits lower its Courage. At 600: Valiant Assault,
 * a shield of its Max HP at Valiant RES (+20% Electro, +60% the rest), Courage draining 15/s and 8
 * times the hits'. Leaving it, it takes 60% of what its shield took and 150% of the Stellar Glimmer
 * DMG in it, at most 15% of its Max HP; its next drink 20 s later (23 s after one left within 18 s
 * without Radiance).
 */
function wavebinder(
  boss: StygianBoss,
  hp: number,
  team: FightTeam
): FightEstimate {
  const regular = dpsAt(team, phaseRes(boss, 'regular')!)
  const valiant = dpsAt(team, phaseRes(boss, 'shielded')!)
  const hits = team.electroHits
  // (its backlash: 60% of what its shield took, 150% of the Stellar Glimmer DMG in it)
  const stellarShare = team.stellarShare ?? 0
  const backlashRatio = 0.6 + 0.9 * stellarShare
  // a Stellar Glimmer team keeps Radiance on it as it drinks: 540 Courage a drink
  const radiance = stellarShare > 0
  const gain = radiance ? COURAGE.stellarDrink : COURAGE.drink
  const outside = courageDrain(hits)
  const courage = COURAGE.valiant * outside
  const drain = COURAGE.decay + courage
  const notes: FightNote[] = ['electroStun']
  if (radiance) notes.push('sip')
  if (!hits) notes.push('noRotation')
  else if (hits.estimated) notes.push('electroEstimated')
  const segments: FightSegment[] = []
  const events: FightEvent[] = []
  let t = 0
  let left = hp
  let meter = 0
  let nextDrink = 10
  let valiants = 0
  let valiantTime = 0
  let regularTime = 0
  let backlash = 0
  let radianceDrinks = 0
  // at its regular RES until `until`, its Courage moving at `rate` (kept within 0–600: a stretch
  // ends where it stops): whether it falls in it
  const atRegular = (
    state: 'regular' | 'drinking',
    until: number,
    rate: number
  ) => {
    while (t < until - 1e-9) {
      const moving =
        (rate < 0 && meter > 0) || (rate > 0 && meter < COURAGE.max)
      const stopAt = !moving
        ? Number.POSITIVE_INFINITY
        : t + (rate < 0 ? meter / -rate : (COURAGE.max - meter) / rate)
      const end = Math.min(until, stopAt)
      const r = moving ? rate : 0
      const span = end - t
      const hpStart = left / hp
      if (regular > 0 && regular * span >= left) {
        const dt = left / regular
        segments.push({
          start: t,
          end: t + dt,
          state,
          hpStart,
          hpEnd: 0,
          dps: regular,
          meterStart: meter,
          meterEnd: meter + r * dt,
        })
        t += dt
        regularTime += dt
        meter += r * dt
        left = 0
        return true
      }
      left -= regular * span
      segments.push({
        start: t,
        end,
        state,
        hpStart,
        hpEnd: left / hp,
        dps: regular,
        meterStart: meter,
        meterEnd: meter + r * span,
      })
      regularTime += span
      meter = Math.min(COURAGE.max, Math.max(0, meter + r * span))
      t = end
    }
    return false
  }
  while (left > 0 && t < FIGHT_LIMIT) {
    // until it drinks: its regular RES, its Courage worn down by the team's Electro hits
    if (atRegular('regular', Math.min(nextDrink, FIGHT_LIMIT), -outside)) break
    if (t >= FIGHT_LIMIT) break
    // its drink (3 s, its regular RES; Electro hits do not lower it then): full, its Valiant
    // Assault begins at once
    const drinkStart = t
    const rate = gain / 3
    const fillAt =
      meter + gain >= COURAGE.max - 1e-9
        ? t + (COURAGE.max - meter) / rate
        : Number.POSITIVE_INFINITY
    if (
      atRegular('drinking', Math.min(drinkStart + 3, fillAt, FIGHT_LIMIT), rate)
    )
      break
    if (t >= FIGHT_LIMIT) break
    if (meter < COURAGE.max - 1e-6) {
      // (Radiance cut its drink short: the next one, 20 s after this one began)
      radianceDrinks++
      nextDrink = drinkStart + 20
      continue
    }
    // Valiant Assault: until its Courage is drained, or its shield (its Max HP) is broken
    const length = Math.min(
      COURAGE.max / drain,
      valiant > 0 ? hp / valiant : Number.POSITIVE_INFINITY
    )
    const end = Math.min(t + length, FIGHT_LIMIT)
    segments.push({
      start: t,
      end,
      state: 'shielded',
      hpStart: left / hp,
      hpEnd: left / hp,
      dps: valiant,
      meterStart: COURAGE.max,
      meterEnd: Math.max(0, COURAGE.max - drain * (end - t)),
      backlashRatio,
    })
    t += length
    valiants++
    valiantTime += length
    meter = 0
    const taken = Math.min(backlashRatio * valiant * length, 0.15 * hp, left)
    backlash += taken
    left -= taken
    if (t <= FIGHT_LIMIT) events.push({ t, kind: 'backlash', hp: taken / hp })
    nextDrink = t + (length < 18 && !radiance ? 23 : 20)
  }
  const seconds = left <= 0 && t <= FIGHT_LIMIT ? t : undefined
  return {
    seconds,
    parts: [
      { key: 'phase', phase: 'regular', seconds: regularTime },
      ...(radianceDrinks
        ? [{ key: 'radianceDrinks' as const, count: radianceDrinks }]
        : []),
      ...(valiants
        ? [
            {
              key: 'valiant' as const,
              count: valiants,
              seconds: valiantTime / valiants,
              ...(hits
                ? {
                    courage,
                    ...(hits.stellar ? { stellar: hits.stellar } : {}),
                  }
                : {}),
            },
            { key: 'backlash' as const, count: valiants, hp: backlash / hp },
          ]
        : []),
    ],
    timeline: {
      segments,
      events,
      meter: { key: 'courage', max: COURAGE.max },
    },
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
  const segments: FightSegment[] = []
  const events: FightEvent[] = []
  let t = 0
  let left = hp
  let breaks = 0
  let hornsTime = 0
  let regularTime = 0
  while (left > 0 && t < FIGHT_LIMIT) {
    // horns on: until they break (or it falls)
    const hpStart = left / hp
    if (withHorns * hornTime >= left || !Number.isFinite(hornTime)) {
      const dt = withHorns > 0 ? left / withHorns : Number.POSITIVE_INFINITY
      const end = Math.min(t + dt, FIGHT_LIMIT)
      segments.push({
        start: t,
        end,
        state: 'horns',
        hpStart,
        hpEnd: Math.max(0, hpStart - (withHorns * (end - t)) / hp),
        dps: withHorns,
        meterStart: 64,
        meterEnd: Math.max(0, 64 - removal * (end - t)),
      })
      t += dt
      hornsTime += dt
      left = 0
      break
    }
    left -= withHorns * hornTime
    const hornsEnd = Math.min(t + hornTime, FIGHT_LIMIT)
    segments.push({
      start: t,
      end: hornsEnd,
      state: 'horns',
      hpStart,
      hpEnd: left / hp,
      dps: withHorns,
      meterStart: 64,
      meterEnd: Math.max(0, 64 - removal * (hornsEnd - t)),
    })
    t += hornTime
    hornsTime += hornTime
    breaks++
    const taken = Math.min(0.1 * hp, left)
    left -= taken
    if (t <= FIGHT_LIMIT) events.push({ t, kind: 'hornsBreak', hp: taken / hp })
    if (left <= 0) break
    // 10 s without them
    const hpAfter = left / hp
    if (without * 10 >= left) {
      const dt = left / without
      segments.push({
        start: t,
        end: t + dt,
        state: 'regular',
        hpStart: hpAfter,
        hpEnd: 0,
        dps: without,
        meterStart: 0,
        meterEnd: 0,
      })
      t += dt
      regularTime += dt
      left = 0
      break
    }
    left -= without * 10
    segments.push({
      start: t,
      end: Math.min(t + 10, FIGHT_LIMIT),
      state: 'regular',
      hpStart: hpAfter,
      hpEnd: left / hp,
      dps: without,
      meterStart: 0,
      meterEnd: 0,
    })
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
    timeline: {
      segments,
      events,
      meter: { key: 'hornGauge', max: 64 },
    },
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

/** The team's DPS against the enemy as set: all its elements' */
export const teamDps = (team: FightTeam) =>
  Object.values(team.dps).reduce<number>((sum, v) => sum + (v ?? 0), 0)

/** An enemy set by hand: its HP ÷ the team's DPS (no mechanics) */
export function customFight(hp: number, team: FightTeam): FightEstimate {
  const dps = teamDps(team)
  const seconds = dps > 0 ? hp / dps : undefined
  const end = Math.min(seconds ?? FIGHT_LIMIT, FIGHT_LIMIT)
  return {
    seconds:
      seconds !== undefined && seconds <= FIGHT_LIMIT ? seconds : undefined,
    parts: seconds !== undefined ? [{ key: 'custom', dps, seconds }] : [],
    timeline: {
      segments: [
        {
          start: 0,
          end,
          state: 'regular',
          hpStart: 1,
          hpEnd: Math.max(0, 1 - (dps * end) / hp),
          dps,
        },
      ],
      events: [],
    },
    notes: [],
    modelled: false,
  }
}

/** An enemy in a fight: its level, RES and DEF, the preset it is, and its HP if set by hand */
export type FightEnemy = Pick<Team, 'enemyOverride' | 'enemyPreset' | 'enemyHp'>

/** The enemy's HP: a Stygian boss's at its difficulty, else the one set by hand (none: unknown) */
export function enemyHpOf(enemy: FightEnemy): number | undefined {
  const preset = appliedStygianPreset(enemy)
  if (preset)
    return preset.difficulty ? preset.boss.hp[preset.difficulty] : undefined
  return enemy.enemyHp
}

/**
 * How long the team takes to defeat the enemy: a Stygian boss's fight (its mechanics where they
 * are known), else its HP (set by hand) ÷ the team's DPS; its HP unknown: undefined
 */
export function enemyFight(
  enemy: FightEnemy,
  team: FightTeam
): FightEstimate | undefined {
  const preset = appliedStygianPreset(enemy)
  if (preset)
    return preset.difficulty
      ? stygianFight(preset.boss, preset.difficulty, team, preset.phase.key)
      : undefined
  return enemy.enemyHp ? customFight(enemy.enemyHp, team) : undefined
}
