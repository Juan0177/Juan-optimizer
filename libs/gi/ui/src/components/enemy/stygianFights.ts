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
  /**
   * Its DPS by element (against `baseRes`, as `dps`) with the Moongecko's Radiant Cocoon on every
   * member: −100% CRIT Rate, −50% DMG Bonus. Absent: not computed (its own DPS counted)
   */
  cocooned?: Partial<Record<ElementWithPhyKey, number>>
  /** …and with Disentangled on every member: +15% CRIT Rate, +50% DMG Bonus */
  disentangled?: Partial<Record<ElementWithPhyKey, number>>
  /**
   * Seconds its written rotation takes to break the Moongecko's Moonstone Anchor ward (`wardTime`):
   * Infinity, never; absent: not known
   */
  wardSeconds?: number
  /** Whether a member heals the party (its kit heals): it breaks out of the Radiant Cocoon */
  healer?: boolean
  /**
   * Its first rotation from no energy (Stygian Onslaught starts at none): its DPS by element
   * without Bursts (against `baseRes`), for its first `seconds`
   */
  opening?: {
    dps: Partial<Record<ElementWithPhyKey, number>>
    seconds: number
  }
  /**
   * When its damage lands: one rotation's hits (seconds into it, damage against `baseRes`) and
   * the damage of attacks with no timed hit, per second; the opening's too. Absent: no written
   * rotation played
   */
  damageTimes?: {
    rotation: DamageTimes
    opening?: DamageTimes
  }
  /** Its written rotation, looped: when it has Radiance on the enemy, Nightsoul's Blessing, Cryo hits */
  cycle?: FightCycle
  /** Its reactions per second, by reaction (the written rotation's) */
  reactions?: Partial<Record<string, number>>
  /** Its Cryo DMG instances per second, from the attacks entered (when no `cycle`) */
  cryoRate?: number
  /**
   * Gauge units per second by element, estimated from the attacks entered (no written rotation:
   * every 3rd hit of an element applying 1U, as the standard ICD lets it)
   */
  estimatedGauge?: Partial<Record<ElementWithPhyKey, number>>
}

/**
 * One written rotation, looped from the fight's start (seconds from the rotation's start): when the
 * enemy has Radiance: Stellar Glimmer, when the active member is in Nightsoul's Blessing, and its
 * Cryo DMG instances
 */
export interface FightCycle {
  seconds: number
  radiance: [number, number][]
  nightsoul: [number, number][]
  /** Any member's Nightsoul's Blessing, on the field or off; and each member's entries into it */
  anyNightsoul?: [number, number][]
  nightsoulEntries?: number[]
  /** [seconds, instances] */
  cryoHits: [number, number][]
}

/** The share of the looped rotation its windows cover */
export function cycleShare(windows: [number, number][], seconds: number) {
  if (!(seconds > 0)) return 0
  const covered = windows.reduce((n, [a, b]) => n + Math.max(0, b - a), 0)
  return Math.min(1, covered / seconds)
}

/** Seconds of window between `from` and `to` (fight time, the rotation looped from 0) */
export function cycleCovered(
  windows: [number, number][],
  seconds: number,
  from: number,
  to: number
) {
  if (!(seconds > 0) || !(to > from)) return 0
  const loops = Math.floor(from / seconds)
  let total = 0
  for (let base = loops * seconds; base < to; base += seconds)
    for (const [a, b] of windows) {
      const start = Math.max(from, base + a)
      const end = Math.min(to, base + b)
      if (end > start) total += end - start
    }
  return total
}

/** The first moment at or after `t` (fight time) inside a window; none: undefined */
export function cycleNext(
  windows: [number, number][],
  seconds: number,
  t: number
): number | undefined {
  if (!(seconds > 0) || !windows.length) return undefined
  const base = Math.floor(t / seconds) * seconds
  let best: number | undefined
  for (const loop of [0, seconds])
    for (const [a, b] of windows) {
      const start = base + loop + a
      const end = base + loop + b
      if (end <= t) continue
      const at = Math.max(t, start)
      if (best === undefined || at < best) best = at
    }
  return best
}

/** The seconds of a looped window list's gaps (time with none of it) */
function cycleGaps(windows: [number, number][], seconds: number) {
  if (!windows.length) return [seconds]
  const sorted = [...windows].sort((x, y) => x[0] - y[0])
  const gaps: number[] = []
  for (let i = 0; i < sorted.length; i++) {
    const end = sorted[i][1]
    const next =
      i + 1 < sorted.length ? sorted[i + 1][0] : sorted[0][0] + seconds
    if (next > end) gaps.push(next - end)
  }
  return gaps
}

/**
 * The chance that a stretch of `length` seconds, starting at any moment of the looped rotation,
 * meets one of its windows
 */
export function cycleMeets(
  windows: [number, number][],
  seconds: number,
  length: number
) {
  if (!(seconds > 0)) return 0
  if (!windows.length) return 0
  const missed = cycleGaps(windows, seconds).reduce(
    (n, gap) => n + Math.max(0, gap - length),
    0
  )
  return Math.max(0, Math.min(1, 1 - missed / seconds))
}

/** A played rotation's damage over its time (`FightTeam.damageTimes`) */
export interface DamageTimes {
  seconds: number
  /** [seconds into the rotation, damage] */
  hits: [number, number][]
  /** Damage per second not tied to a hit (spread over the rotation) */
  spread: number
}

/**
 * How the team plays a boss's mechanics where the fight cannot tell (`Team.fightSettings`): the
 * Moongecko's ward and cocoon
 */
export interface FightSettings {
  /** Seconds to break the Moonstone Anchor's ward (over `MOONGECKO.window`: not in time) */
  wardSeconds?: number
  /** Seconds after each Radiant Cocoon until the team is healed to full; below 0: never */
  healSeconds?: number
  /** The fight starts with full energy (default: none, as Stygian Onslaught does) */
  fullEnergy?: boolean
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
  /**
   * The Moongecko's Vagrant Reverberations: their number, how long its ward held each (`seconds`)
   * and how many were broken in time
   */
  | { key: 'anchors'; count: number; seconds: number; broken: number }
  /** Its wards broken: what they took off it (70% of the Geo DMG the Anchor took, 10% of the rest) */
  | { key: 'wardBreak'; count: number; hp: number; capped: number }
  /** Its Radiant Cocoons: how long the team spent in them; `healed`: seconds to heal out */
  | { key: 'cocoon'; count: number; seconds: number; healed?: number }
  /** Disentangled: how long the team had it */
  | { key: 'disentangled'; seconds: number }
  /**
   * The Overseer Device's Sweeper Modes: their number, their time in all, and of it how long it was
   * stopped (Flow Momentum at 10 or less) and in Forced Counterstrike
   */
  | {
      key: 'sweeper'
      count: number
      seconds: number
      stopped: number
      counterstrike: number
      /** The team's Cryo DMG instances per second */
      cryo: number
    }
  /** The Domovoy Sculptor's sculptures: cast, and turned into statues by Radiance (their blasts' HP) */
  | { key: 'sculptures'; count: number; interrupted: number; hp: number }
  /** The Guardian Blade's Ice Coffins: their number, how many broken and how many as shields */
  | {
      key: 'coffins'
      count: number
      broken: number
      shields: number
      /** How long each held, on average */
      seconds: number
    }
  /** …broken: the HP they took off it (10% each, more for a shield's backlash) */
  | { key: 'coffinBreak'; count: number; hp: number }
  /** …not broken: the HP it got back */
  | { key: 'coffinHeal'; count: number; hp: number }
  /** The Winged Lion's Electro Wards: their number, broken, each's time, the team's wear on them */
  | {
      key: 'electroWards'
      count: number
      broken: number
      seconds: number
      /** Durability the team's reactions take off per second (of 1000) */
      rate: number
      /** Shockwaves turned on it by Radiance (400 each) */
      backfires: number
    }
  /** A ward or shield broken: its backlash in all, the share of what it took and its cap */
  | {
      key: 'wardBacklash'
      count: number
      hp: number
      ratio: number
      cap: number
    }
  /** Paralyzed: how often, how long in all */
  | { key: 'paralysis'; count: number; seconds: number }
  /** The Winged Lion's vortices: their number, and how many failed */
  | { key: 'vortex'; count: number; failed: number }
  /** Lysis Shears' Adaptive Countermeasures: filled after `seconds`, Nightsoul's Blessing's share */
  | { key: 'countermeasures'; seconds: number | undefined; nightsoul: number }
  /** …its cannon interrupted: the HP it lost (15%) */
  | { key: 'cannon'; hp: number }
export type FightNote =
  | 'noRotation'
  | 'electroEstimated'
  | 'electroStun'
  | 'sip'
  | 'noHornRemoval'
  | 'crabs'
  /** The Moongecko's ward time: the written rotation's hits (poise known or assumed) */
  | 'wardEstimated'
  /** …neither set nor known from a written rotation: assumed */
  | 'wardAssumed'
  /** …set by hand */
  | 'wardSet'
  /** No healer: the team stays in its Radiant Cocoon until the next Anchor */
  | 'noHealer'
  /** The team's DPS in its cocoon and Disentangled not computed (its own counted) */
  | 'cocoonApprox'
  /** Its first rotation counted without Bursts: the fight starts with no energy */
  | 'opening'
  | 'mechanics'
  /** Its transforms' and switches' lengths are estimates (not in the game files) */
  | 'transitionsEstimated'
  /** No written rotation: its Cryo hits from the attacks entered, spread evenly; Nightsoul's Blessing not known */
  | 'cryoEstimated'
  /** No written rotation: Radiance taken to be up throughout (the team deals Stellar Glimmer DMG) */
  | 'radianceAssumed'
  /** No written rotation: its element applications estimated from the attacks entered */
  | 'gaugeEstimated'
  /** The window in which Radiance counts is an estimate */
  | 'windowEstimated'
  /** Its flights are estimates (ranged hits counted in full) */
  | 'flightEstimated'
  /** Lysis Shears' mechanisms: the climb to break them is an estimate */
  | 'mechanismsEstimated'
  /** Nightsoul's Blessing not known (no written rotation): its countermeasures fill on their own */
  | 'noNightsoul'

/** A stretch of the fight in one state: its HP (fractions of its Max HP) from start to end */
export interface FightSegment {
  start: number
  end: number
  /**
   * Its state: one of its phases, its horns on (the Emperor) or its drink (Wavebinder); the
   * Moongecko's leap (out of reach), its ward up, the team in its Radiant Cocoon (all RES: after a
   * ward not broken) or Disentangled
   */
  state:
    | StygianPhaseKey
    | 'horns'
    | 'drinking'
    | 'leap'
    | 'ward'
    | 'cocooned'
    | 'enhancedCocoon'
    | 'disentangled'
    | 'warded'
    | 'barrier'
    | 'airborne'
    | 'cannon'
  hpStart: number
  hpEnd: number
  /** The team's DPS against it here (a shield state: what its shield takes) */
  dps?: number
  /** Its meter from start to end (linear): Wavebinder's Courage, the Emperor's horn gauge */
  meterStart?: number
  meterEnd?: number
  /** A shield state: the share of what its shield takes that comes back as backlash (uncapped) */
  backlashRatio?: number
  /** …its cap (a fraction of its Max HP; absent: Wavebinder's 15%) */
  backlashCap?: number
  /**
   * A shield state: what its shield took before this stretch (the Moongecko's ward: its earlier
   * stretches in the same Anchor), and its backlash so far
   */
  absorbedBefore?: number
  backlashBefore?: number
}
/** A moment that takes HP off at once (fractions of its Max HP); the Anchor's blast: none */
export interface FightEvent {
  t: number
  kind:
    | 'backlash'
    | 'hornsBreak'
    | 'wardBreak'
    | 'blast'
    | 'statue'
    | 'hpLoss'
    | 'heal'
  /** HP taken off (a heal: negative) */
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
    meter?: {
      key:
        | 'courage'
        | 'hornGauge'
        | 'ward'
        | 'momentum'
        | 'stacks'
        | 'wardGauge'
        | 'progress'
      max: number
    }
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

/**
 * The team's DPS against another phase's RES: each element's, its shred kept (`dps`: its DPS by
 * element in another state, against the same enemy; `only`: these elements' alone)
 */
export function dpsAt(
  team: FightTeam,
  res: StygianRes,
  dps: Partial<Record<ElementWithPhyKey, number>> = team.dps,
  only?: (e: ElementWithPhyKey) => boolean
) {
  let total = 0
  for (const e of allElementWithPhyKeys) {
    if (only && !only(e)) continue
    const value = dps[e] ?? 0
    if (value <= 0) continue
    const target = fraction(res[e])
    if (!Number.isFinite(target)) continue
    const base = team.baseRes[e]
    const eff = team.effRes[e]
    if (!Number.isFinite(base) || !Number.isFinite(eff)) continue
    total += (value * resMultiplier(eff + target - base)) / resMultiplier(eff)
  }
  return total
}

const phaseRes = (boss: StygianBoss, key: StygianPhaseKey) =>
  boss.phases.find((p) => p.key === key)?.res

/** HP ÷ DPS at a phase (its first rotation from no energy at its own DPS) */
function plain(
  boss: StygianBoss,
  hp: number,
  team: FightTeam,
  phase: StygianPhaseKey,
  settings: FightSettings = {}
): FightEstimate {
  const res = phaseRes(boss, phase)
  const dps = res ? dpsAt(team, res) : 0
  const open = openingOf(team, settings)
  const openDps = open && res ? dpsAt(team, res, open.dps) : dps
  const openFor = open?.seconds ?? 0
  const openDone = Math.min(openFor, openDps > 0 ? hp / openDps : openFor)
  const left = Math.max(0, hp - openDps * openDone)
  const seconds =
    left <= 1e-6 ? openDone : dps > 0 ? openDone + left / dps : undefined
  const end = Math.min(seconds ?? FIGHT_LIMIT, FIGHT_LIMIT)
  const segments: FightSegment[] = []
  if (openDone > 0)
    segments.push({
      start: 0,
      end: Math.min(openDone, end),
      state: phase,
      hpStart: 1,
      hpEnd: Math.max(0, 1 - (openDps * Math.min(openDone, end)) / hp),
      dps: openDps,
    })
  if (end > openDone)
    segments.push({
      start: openDone,
      end,
      state: phase,
      hpStart: left / hp,
      hpEnd: Math.max(0, (left - dps * (end - openDone)) / hp),
      dps,
    })
  return {
    seconds:
      seconds !== undefined && seconds <= FIGHT_LIMIT ? seconds : undefined,
    parts: seconds ? [{ key: 'phase', phase, seconds }] : [],
    timeline: { segments, events: [] },
    notes: open ? ['opening'] : [],
    modelled: false,
  }
}

/** The fight's first rotation from no energy, unless it starts with full energy */
function openingOf(team: FightTeam, settings: FightSettings) {
  return !settings.fullEnergy && team.opening && team.opening.seconds > 0
    ? team.opening
    : undefined
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

/** Radiant Moongecko: Entangled Fangs' stage (its boss id) */
export const MOONGECKO_BOSS = 1008061
/**
 * Radiant Moongecko: Entangled Fangs, Fearless/Dire: the game files' values for it in Stygian
 * Onslaught (its LeyLineChallenge_MonsterLevelHigh branch), with the Fandom wiki and stygian.moe
 */
export const MOONGECKO = {
  /** Its leap to the arena's centre, until its Moonstone Anchor's ward is up (estimate) */
  entry: 2,
  /** The time the ward has (its ShieldTimer: 35 s in Fearless/Dire, 25 s elsewhere) */
  window: 35,
  /** After it, out of reach until the Anchor's blast (Gecko_UltimateAttackDelay) */
  blast: 1.5,
  /** The ward: 9 layers of 4U Geo (100 durability each; 70 outside Fearless/Dire) */
  layers: 9,
  layerDurability: 100,
  /** After each broken layer, the next one's delay (its MulShieldInterval) */
  layerGap: 0.1,
  /**
   * The ward broken: it takes 10% of the DMG the Anchor took and 70% of its Geo DMG (the wiki and
   * stygian.moe read it as 70% of the Geo DMG and 10% of the rest), at most 40% of its Max HP
   */
  geo: 0.7,
  other: 0.1,
  cap: 0.4,
  /** Then stunned (Gecko_WeakStateTimer_LeyLineChallenge) */
  stun: 4.36,
  /** Back on the ground until the next Anchor (Gecko_StageChangeTimer) */
  stage: 40,
  /** Into that time, its roar: the Radiant Cocoon (estimate) */
  roar: 2,
  /** The cocoon's RES: +60% Geo RES (all RES after a ward not broken in time) */
  cocoonRes: 60,
  /** Disentangled: +15% CRIT Rate, +50% DMG Bonus for 15 s */
  disentangled: 15,
  /** A team with a healer: healed to full this long after the roar */
  heal: 3,
  /** The ward's time neither set nor known from the written rotation */
  wardDefault: 15,
} as const

/**
 * Radiant Moongecko: Entangled Fangs (Fearless/Dire, `MOONGECKO`): the fight opens with its
 * Vagrant Reverberation, and another one comes after each 40 s back on the ground. Its Moonstone
 * Anchor's ward (9 layers of 4U Geo) takes the team's damage, its HP untouched; broken within
 * 35 s, it takes 70% of the Geo DMG the Anchor took and 10% of the rest (at most 40% of its Max
 * HP) and is stunned 4.36 s; not broken, it blasts the team, and its next cocoon raises all its
 * RES. Back on the ground it roars: Radiant Cocoon on the team (−100% CRIT Rate, −50% DMG Bonus)
 * and +60% Geo RES on it, until the team is healed to full; then Disentangled (+15% CRIT Rate,
 * +50% DMG Bonus) for 15 s, and its RES back to 10%. The ward's time: as set, else the written
 * rotation's (`FightTeam.wardSeconds`), else assumed; healed to full: as set, else a few seconds
 * after the roar for a team with a healer.
 */
function moongecko(
  boss: StygianBoss,
  hp: number,
  team: FightTeam,
  settings: FightSettings = {}
): FightEstimate {
  const M = MOONGECKO
  const dull = phaseRes(boss, 'dullCarapace')!
  const plus = (add: (e: ElementWithPhyKey) => number) =>
    Object.fromEntries(
      allElementWithPhyKeys.map((e) => {
        const v = dull[e]
        return [e, v === 'immune' ? v : v + add(e)]
      })
    ) as StygianRes
  const cocoonRes = plus((e) => (e === 'geo' ? M.cocoonRes : 0))
  const enhancedRes = plus(() => M.cocoonRes)
  const own = team.dps
  const cocooned = team.cocooned ?? own
  const freed = team.disentangled ?? own
  const dpsOf = {
    own: dpsAt(team, dull, own),
    freed: dpsAt(team, dull, freed),
    cocoon: dpsAt(team, cocoonRes, cocooned),
    enhanced: dpsAt(team, enhancedRes, cocooned),
  }
  // what the Anchor takes per second (at its Dull Carapace RES: the cocoon's RES goes as it
  // leaps), its Geo DMG and the rest
  const into = (dps: Partial<Record<ElementWithPhyKey, number>>) => ({
    geo: dpsAt(team, dull, dps, (e) => e === 'geo'),
    other: dpsAt(team, dull, dps, (e) => e !== 'geo'),
  })
  const intoOwn = into(own)
  const intoFreed = into(freed)
  // its first rotation from no energy (no Bursts): its own DPS, the share of the rotation's
  const open = openingOf(team, settings)
  const openEnd = open ? open.seconds : 0
  const intoOpen = open ? into(open.dps) : intoOwn
  const openShare =
    open && dpsOf.own > 0 ? dpsAt(team, dull, open.dps) / dpsOf.own : 1

  const notes: FightNote[] = []
  const ward = settings.wardSeconds ?? team.wardSeconds ?? M.wardDefault
  notes.push(
    settings.wardSeconds !== undefined
      ? 'wardSet'
      : team.wardSeconds !== undefined
        ? 'wardEstimated'
        : 'wardAssumed'
  )
  const broken = ward <= M.window
  const heal =
    settings.healSeconds !== undefined
      ? settings.healSeconds >= 0
        ? settings.healSeconds
        : undefined
      : team.healer
        ? M.heal
        : undefined
  if (heal === undefined) notes.push('noHealer')
  if (!team.cocooned || !team.disentangled) notes.push('cocoonApprox')
  if (open) notes.push('opening')

  const segments: FightSegment[] = []
  const events: FightEvent[] = []
  let t = 0
  let left = hp
  // Disentangled on until then (a late heal: into the next Anchor)
  let freedUntil = Number.NEGATIVE_INFINITY
  let anchors = 0
  let brokenCount = 0
  let capped = 0
  let transfer = 0
  let cocoons = 0
  let cocoonTime = 0
  let freedTime = 0
  // a stretch at `dps` until `until` (the fight's limit at most): whether it falls in it
  const fall = (state: FightSegment['state'], until: number, dps: number) => {
    // (its first rotation from no energy: at its share of the DPS)
    if (
      t < openEnd - 1e-9 &&
      until > t + 1e-9 &&
      fallAt(state, Math.min(until, openEnd), dps * openShare)
    )
      return true
    return fallAt(state, until, dps)
  }
  const fallAt = (state: FightSegment['state'], until: number, dps: number) => {
    const end = Math.min(until, FIGHT_LIMIT)
    if (end <= t + 1e-9) return false
    const hpStart = left / hp
    const reaches = dps > 0 && dps * (end - t) >= left
    const stop = reaches ? t + left / dps : end
    left = reaches ? 0 : left - dps * (end - t)
    segments.push({
      start: t,
      end: stop,
      state,
      hpStart,
      hpEnd: left / hp,
      dps,
      meterStart: 0,
      meterEnd: 0,
    })
    if (state === 'cocooned' || state === 'enhancedCocoon')
      cocoonTime += stop - t
    if (state === 'disentangled') freedTime += stop - t
    t = stop
    return reaches
  }
  // at its Dull Carapace RES: the team's own stats, or Disentangled while it lasts
  const stretch = (state: 'stunned' | 'dullCarapace', until: number) => {
    if (
      t < freedUntil &&
      fall(
        state === 'stunned' ? state : 'disentangled',
        Math.min(until, freedUntil),
        dpsOf.freed
      )
    )
      return true
    return fall(state, until, dpsOf.own)
  }
  // out of reach (no damage) until `until`
  const pause = (until: number) => {
    const end = Math.min(until, FIGHT_LIMIT)
    if (end > t + 1e-9)
      segments.push({
        start: t,
        end,
        state: 'leap',
        hpStart: left / hp,
        hpEnd: left / hp,
        dps: 0,
        meterStart: 0,
        meterEnd: 0,
      })
    t = end
  }
  // the layers left, `elapsed` seconds after the ward is up (worn down evenly)
  const layersAt = (elapsed: number) =>
    Number.isFinite(ward)
      ? Math.max(0, M.layers * (1 - elapsed / ward))
      : M.layers
  while (left > 0 && t < FIGHT_LIMIT) {
    // Vagrant Reverberation: its leap, then its Anchor's ward
    pause(t + M.entry)
    if (t >= FIGHT_LIMIT) break
    anchors++
    const wardStart = t
    const wardEnd = wardStart + (broken ? ward : M.window)
    let geo = 0
    let other = 0
    while (t < wardEnd - 1e-9 && t < FIGHT_LIMIT) {
      const freedNow = t < freedUntil
      const opening = t < openEnd - 1e-9
      const end = Math.min(
        wardEnd,
        freedNow ? freedUntil : wardEnd,
        opening ? openEnd : wardEnd,
        FIGHT_LIMIT
      )
      const into = opening ? intoOpen : freedNow ? intoFreed : intoOwn
      const total = into.geo + into.other
      segments.push({
        start: t,
        end,
        state: 'ward',
        hpStart: left / hp,
        hpEnd: left / hp,
        dps: total,
        meterStart: layersAt(t - wardStart),
        meterEnd: layersAt(end - wardStart),
        backlashRatio:
          total > 0 ? (M.geo * into.geo + M.other * into.other) / total : 0,
        backlashCap: M.cap,
        absorbedBefore: geo + other,
        backlashBefore: Math.min(M.geo * geo + M.other * other, M.cap * hp),
      })
      geo += into.geo * (end - t)
      other += into.other * (end - t)
      t = end
    }
    if (t >= FIGHT_LIMIT) break
    let enhanced = false
    if (broken) {
      brokenCount++
      const raw = M.geo * geo + M.other * other
      if (raw > M.cap * hp) capped++
      const taken = Math.min(raw, M.cap * hp, left)
      transfer += taken
      left -= taken
      events.push({ t, kind: 'wardBreak', hp: taken / hp })
      if (left <= 0) break
      if (stretch('stunned', t + M.stun)) break
    } else {
      pause(t + M.blast)
      if (t >= FIGHT_LIMIT) break
      events.push({ t, kind: 'blast', hp: 0 })
      enhanced = true
    }
    // back on the ground for 40 s: its roar, then the cocoon until the team is healed to full
    const stageEnd = t + M.stage
    if (stretch('dullCarapace', t + M.roar)) break
    if (t >= FIGHT_LIMIT) break
    cocoons++
    const cocoonEnd =
      heal !== undefined ? Math.min(t + heal, stageEnd) : stageEnd
    if (
      fall(
        enhanced ? 'enhancedCocoon' : 'cocooned',
        cocoonEnd,
        enhanced ? dpsOf.enhanced : dpsOf.cocoon
      )
    )
      break
    if (heal !== undefined && t < stageEnd - 1e-9)
      freedUntil = t + M.disentangled
    if (stretch('dullCarapace', stageEnd)) break
  }
  const seconds = left <= 0 && t <= FIGHT_LIMIT ? t : undefined
  return {
    seconds,
    parts: [
      ...(anchors
        ? [
            {
              key: 'anchors' as const,
              count: anchors,
              seconds: broken ? ward : M.window,
              broken: brokenCount,
            },
          ]
        : []),
      ...(brokenCount
        ? [
            {
              key: 'wardBreak' as const,
              count: brokenCount,
              hp: transfer / hp,
              capped,
            },
          ]
        : []),
      ...(cocoons
        ? [
            {
              key: 'cocoon' as const,
              count: cocoons,
              seconds: cocoonTime,
              ...(heal !== undefined ? { healed: heal } : {}),
            },
          ]
        : []),
      ...(freedTime
        ? [{ key: 'disentangled' as const, seconds: freedTime }]
        : []),
    ],
    timeline: {
      segments,
      events,
      meter: { key: 'ward', max: M.layers },
    },
    notes,
    modelled: true,
  }
}

/**
 * A fight's HP over time, stretch by stretch: each at a state's RES (out of reach: none), its first
 * rotation from no energy at the opening's DPS; a state's stretches in a row make one segment
 */
function hpRun(hp: number, team: FightTeam, settings: FightSettings) {
  const open = openingOf(team, settings)
  const openEnd = open?.seconds ?? 0
  const rates = new Map<StygianRes, [number, number]>()
  const rateOf = (res: StygianRes, opening: boolean) => {
    let r = rates.get(res)
    if (!r) {
      r = [dpsAt(team, res), open ? dpsAt(team, res, open.dps) : 0]
      rates.set(res, r)
    }
    return opening ? r[1] : r[0]
  }
  const segments: FightSegment[] = []
  const events: FightEvent[] = []
  // (an event since the last stretch: the next one starts a segment of its own)
  let cut = false
  const run = {
    t: 0,
    left: hp,
    segments,
    events,
    opening: !!open,
    /** The DPS at a RES now (its opening's in the first rotation) */
    dps: (res: StygianRes) => rateOf(res, run.t < openEnd - 1e-9),
    /**
     * In `state` at `res` until `until` (the fight's limit at most), its meter at `meter` there and
     * the stretch's other fields: whether it falls in it
     */
    to(
      state: FightSegment['state'],
      res: StygianRes | null,
      until: number,
      meter = 0,
      extra: Partial<FightSegment> = {},
      /** HP it stops at (its HP held there, or a mechanic it sets off) */
      floor = 0
    ): boolean {
      const end = Math.min(until, FIGHT_LIMIT)
      while (run.t < end - 1e-9 && run.left > floor) {
        const opening = run.t < openEnd - 1e-9
        const stop = opening ? Math.min(end, openEnd) : end
        const dps = res ? rateOf(res, opening) : 0
        const reaches = dps > 0 && dps * (stop - run.t) >= run.left - floor
        const finish = reaches ? run.t + (run.left - floor) / dps : stop
        const hpStart = run.left / hp
        run.left = reaches ? floor : run.left - dps * (finish - run.t)
        const last = segments[segments.length - 1]
        if (
          last &&
          !cut &&
          last.state === state &&
          last.dps === dps &&
          Math.abs(last.end - run.t) < 1e-9 &&
          !extra.backlashRatio
        ) {
          last.end = finish
          last.hpEnd = run.left / hp
          last.meterEnd = meter
        } else
          segments.push({
            start: run.t,
            end: finish,
            state,
            hpStart,
            hpEnd: run.left / hp,
            dps,
            meterStart: meter,
            meterEnd: meter,
            ...extra,
          })
        cut = false
        run.t = finish
        if (reaches) return true
      }
      return run.left <= floor
    },
    /**
     * Its HP untouched until `until` while something else takes the damage at `res` (a ward, a
     * shield): what it took. `meter` from → to over the stretch, `extra` on its segments
     */
    hold(
      state: FightSegment['state'],
      res: StygianRes | null,
      until: number,
      meter: [number, number] = [0, 0],
      extra: Partial<FightSegment> = {}
    ): number {
      const from = run.t
      const end = Math.min(until, FIGHT_LIMIT)
      let taken = 0
      const meterAt = (t: number) =>
        end > from
          ? meter[0] + ((meter[1] - meter[0]) * (t - from)) / (end - from)
          : meter[1]
      while (run.t < end - 1e-9) {
        const opening = run.t < openEnd - 1e-9
        const stop = opening ? Math.min(end, openEnd) : end
        const dps = res ? rateOf(res, opening) : 0
        segments.push({
          start: run.t,
          end: stop,
          state,
          hpStart: run.left / hp,
          hpEnd: run.left / hp,
          dps,
          meterStart: meterAt(run.t),
          meterEnd: meterAt(stop),
          ...extra,
          ...(extra.backlashRatio !== undefined
            ? {
                absorbedBefore: (extra.absorbedBefore ?? 0) + taken,
                backlashBefore:
                  (extra.backlashBefore ?? 0) + extra.backlashRatio * taken,
              }
            : {}),
        })
        taken += dps * (stop - run.t)
        run.t = stop
      }
      return taken
    },
    /** HP back (at most to its Max HP), as `kind` */
    heal(kind: FightEvent['kind'], amount: number) {
      const healed = Math.min(Math.max(0, amount), hp - run.left)
      run.left += healed
      cut = true
      if (run.t <= FIGHT_LIMIT)
        events.push({ t: run.t, kind, hp: -healed / hp })
      return healed
    },
    /** HP off at once (at most what is left), as `kind` */
    take(kind: FightEvent['kind'], amount: number) {
      const taken = Math.min(Math.max(0, amount), run.left)
      run.left -= taken
      cut = true
      if (run.t <= FIGHT_LIMIT) events.push({ t: run.t, kind, hp: taken / hp })
      return taken
    },
    /** Its time to defeat: undefined past the limit */
    seconds: () =>
      run.left <= 1e-6 && run.t <= FIGHT_LIMIT ? run.t : undefined,
  }
  return run
}

/** The team's Cryo DMG instances in [from, to) of the fight: [seconds, instances], in order */
function cryoHitsIn(team: FightTeam, from: number, to: number) {
  const out: [number, number][] = []
  const cycle = team.cycle
  if (cycle && cycle.seconds > 0) {
    for (
      let base = Math.floor(from / cycle.seconds) * cycle.seconds;
      base < to;
      base += cycle.seconds
    )
      for (const [t, n] of cycle.cryoHits) {
        const at = base + t
        if (at >= from && at < to) out.push([at, n])
      }
    return out
  }
  const rate = team.cryoRate ?? 0
  if (rate > 0) for (let t = from; t < to; t += 1 / rate) out.push([t, 1])
  return out
}

/**
 * The moments the active member enters Nightsoul's Blessing in [from, to) of the fight (a window
 * carried over the rotation's end is no new entry)
 */
function blessingEntries(cycle: FightCycle, from: number, to: number) {
  const { seconds, nightsoul } = cycle
  const out: number[] = []
  if (!(seconds > 0)) return out
  const carried = nightsoul.some(([, b]) => b >= seconds - 1e-9)
  for (
    let base = Math.floor(from / seconds) * seconds;
    base < to;
    base += seconds
  )
    for (const [a] of nightsoul) {
      if (a <= 1e-9 && carried) continue
      const at = base + a
      if (at > from && at < to) out.push(at)
    }
  return out.sort((x, y) => x - y)
}

/** Secret Source Automaton: Overseer Device - Obliterator Panoply's stage (its boss id) */
export const OVERSEER_BOSS = 1001063
/**
 * The Overseer Device's Fearless/Dire values: the game files' DragonCollar abilities (their Abyss
 * version, the LeyLineChallenge_MonsterLevelHigh branch), with the wiki and stygian.moe
 */
export const OVERSEER = {
  /** A Sweeper Mode every 75 s (its StateChange cooldown), the first at once */
  cycle: 75,
  /** Its transform and blink to the arena's centre, out of its loop (estimate) */
  entry: 5,
  /** Its Sweeper Mode's countdown (55 s; 35 s elsewhere), from its transform's end (estimate) */
  sweeper: 55,
  start: 2.5,
  /** Flow Momentum: 32 at each Sweeper Mode, at most 135, +2 every 0.4 s in its loop */
  momentumStart: 32,
  momentumMax: 135,
  tick: 0.4,
  gain: 2,
  /** …−3 a Cryo DMG instance (−4 elsewhere); at 10 or less, stopped */
  perCryo: 3,
  stopAt: 10,
  /** Adaptive Countermeasures: +30 as the active member enters Nightsoul's Blessing, +10 a second kept */
  countermeasures: 180,
  enter: 30,
  perSecond: 10,
  /** Its switch to Forced Counterstrike: its Flow Momentum frozen, Cryo hits not counted (estimate) */
  switch: 2,
} as const

/**
 * Secret Source Automaton: Overseer Device - Obliterator Panoply (`OVERSEER`): a Sweeper Mode every
 * 75 s at 270% RES. In its loop, Flow Momentum rises 5/s and each Cryo DMG instance takes 3 off;
 * at 10 or less it stops (30% RES, Cryo −30%). The active member's Nightsoul's Blessing fills its
 * Adaptive Countermeasures (30 an entry, 10 a second; at 180, Forced Counterstrike: 110% RES until
 * the mode ends, stopped by Cryo the same way). Between modes its normal attacks: 80% RES, 10% if
 * it was stopped or in Forced Counterstrike in the mode before.
 */
function overseer(
  boss: StygianBoss,
  hp: number,
  team: FightTeam,
  settings: FightSettings = {}
): FightEstimate {
  const O = OVERSEER
  const res = (key: StygianPhaseKey) => phaseRes(boss, key)!
  const R = {
    sweeper: res('enhanced'),
    stopped: res('lowEnergy'),
    counter: res('nightsoul'),
    normal: res('normalMode'),
    broken: res('regular'),
  }
  const run = hpRun(hp, team, settings)
  const notes: FightNote[] = ['transitionsEstimated']
  if (!team.cycle) notes.push(team.cryoRate ? 'cryoEstimated' : 'noRotation')
  if (run.opening) notes.push('opening')
  const cycle = team.cycle
  let modes = 0
  let loopTime = 0
  let stoppedTime = 0
  let counterTime = 0
  let normalTime = 0
  let brokenTime = 0
  let cryoCount = 0
  for (let c = 0; run.left > 0 && c < FIGHT_LIMIT; c += O.cycle) {
    modes++
    // its transform: out of its loop, at its Sweeper RES
    if (run.to('enhanced', R.sweeper, c + O.entry, O.momentumStart)) break
    const loopStart = c + O.entry
    const loopEnd = c + O.start + O.sweeper
    const hits = cryoHitsIn(team, loopStart, loopEnd)
    const entries = cycle ? blessingEntries(cycle, loopStart, loopEnd) : []
    let momentum: number = O.momentumStart
    let countermeasures = 0
    let counter = false
    let switchEnd = Number.NEGATIVE_INFINITY
    let broken = false
    let nextTick = loopStart + O.tick
    let h = 0
    let e = 0
    let t = loopStart
    while (t < loopEnd - 1e-9 && run.left > 0 && t < FIGHT_LIMIT) {
      const next = Math.min(
        nextTick,
        hits[h]?.[0] ?? Number.POSITIVE_INFINITY,
        entries[e] ?? Number.POSITIVE_INFINITY,
        loopEnd
      )
      const stopped = momentum <= O.stopAt
      if (stopped || counter) broken = true
      const state = stopped ? 'lowEnergy' : counter ? 'nightsoul' : 'enhanced'
      if (
        next > t &&
        run.to(
          state,
          stopped ? R.stopped : counter ? R.counter : R.sweeper,
          next,
          momentum
        )
      )
        break
      if (stopped) stoppedTime += next - t
      else if (counter) counterTime += next - t
      const detecting = next >= switchEnd
      if (cycle && !counter && detecting)
        countermeasures +=
          O.perSecond *
          cycleCovered(
            cycle.nightsoul,
            cycle.seconds,
            Math.max(t, switchEnd),
            next
          )
      t = next
      if (t >= nextTick - 1e-9) {
        if (detecting) momentum = Math.min(O.momentumMax, momentum + O.gain)
        nextTick += O.tick
      }
      while (h < hits.length && hits[h][0] <= t + 1e-9) {
        if (detecting) {
          momentum = Math.max(0, momentum - O.perCryo * hits[h][1])
          cryoCount += hits[h][1]
        }
        h++
      }
      while (e < entries.length && entries[e] <= t + 1e-9) {
        if (detecting && !counter) countermeasures += O.enter
        e++
      }
      if (!counter && countermeasures >= O.countermeasures - 1e-9) {
        counter = true
        switchEnd = t + O.switch
      }
    }
    loopTime += Math.max(0, Math.min(t, loopEnd) - loopStart)
    if (run.left <= 0 || run.t >= FIGHT_LIMIT) break
    // its normal attacks until the next Sweeper Mode
    const normalStart = run.t
    if (
      run.to(
        broken ? 'regular' : 'normalMode',
        broken ? R.broken : R.normal,
        c + O.cycle,
        0
      )
    ) {
      if (broken) brokenTime += run.t - normalStart
      else normalTime += run.t - normalStart
      break
    }
    if (broken) brokenTime += run.t - normalStart
    else normalTime += run.t - normalStart
  }
  return {
    seconds: run.seconds(),
    parts: [
      {
        key: 'sweeper',
        count: modes,
        seconds: loopTime,
        stopped: stoppedTime,
        counterstrike: counterTime,
        cryo: loopTime > 0 ? cryoCount / loopTime : 0,
      },
      ...(normalTime
        ? [
            {
              key: 'phase' as const,
              phase: 'normalMode' as const,
              seconds: normalTime,
            },
          ]
        : []),
      ...(brokenTime
        ? [
            {
              key: 'phase' as const,
              phase: 'regular' as const,
              seconds: brokenTime,
            },
          ]
        : []),
    ],
    timeline: {
      segments: run.segments,
      events: run.events,
      meter: { key: 'momentum', max: O.momentumMax },
    },
    notes,
    modelled: true,
  }
}

/**
 * When the team has Radiance: Stellar Glimmer on the enemy: its written rotation's, looped; without
 * one, throughout if it deals Stellar Glimmer DMG (noted), else never
 */
function radianceOf(team: FightTeam, notes: FightNote[]) {
  const cycle = team.cycle
  if (cycle)
    return {
      /** The first moment in [from, to] with Radiance on */
      firstIn: (from: number, to: number) => {
        const at = cycleNext(cycle.radiance, cycle.seconds, from)
        return at !== undefined && at <= to + 1e-9 ? at : undefined
      },
      share: cycleShare(cycle.radiance, cycle.seconds),
    }
  if ((team.stellarShare ?? 0) > 0) {
    notes.push('radianceAssumed')
    return { firstIn: (from: number) => from, share: 1 }
  }
  if (!notes.includes('noRotation')) notes.push('noRotation')
  return { firstIn: () => undefined, share: 0 }
}

/** The team's gauge units per second by element: its written rotation's, else estimated (noted) */
function gaugeFor(team: FightTeam, notes: FightNote[]) {
  if (team.gauge) return team.gauge
  if (team.estimatedGauge) {
    notes.push('gaugeEstimated')
    return team.estimatedGauge
  }
  if (!notes.includes('noRotation')) notes.push('noRotation')
  return {}
}

/** Seconds spent in each state, from a fight's segments */
function stateTimes(segments: FightSegment[]) {
  const out: Partial<Record<FightSegment['state'], number>> = {}
  for (const g of segments) out[g.state] = (out[g.state] ?? 0) + g.end - g.start
  return out
}

/** The phase parts of the states given, in that order, for those it spent time in */
function phaseParts(
  segments: FightSegment[],
  keys: StygianPhaseKey[]
): FightPart[] {
  const times = stateTimes(segments)
  return keys.flatMap((phase) =>
    (times[phase] ?? 0) > 1e-6
      ? [{ key: 'phase' as const, phase, seconds: times[phase]! }]
      : []
  )
}

/** Battle-Hardened Domovoy Sculptor: Gale Hewing's stage (its boss id) */
export const SCULPTOR_BOSS = 1012061
/**
 * The Domovoy Sculptor's Fearless/Dire values (the game files' Karzelek_Tsereteli abilities, their
 * LeyLineChallenge pose; stygian.moe and the wiki for its cadence)
 */
export const SCULPTOR = {
  /** Its first sculpting ~8 s in, then every 16 s */
  first: 8,
  cadence: 16,
  /** Radiance on it in its cast's loop turns the sculptures into statues: ~1–5 s in (estimate) */
  lead: 1,
  window: 4,
  /** Each statue explodes 0.1 s later: 499,999 DMG to it (RES not counted), 2 a cast */
  delay: 0.1,
  explosion: 499999,
  statues: 2,
  /** …and 2 stacks of RES down (3 at most), all lasting 30 s from the last */
  perCast: 2,
  maxStacks: 3,
  last: 30,
} as const

/**
 * Battle-Hardened Domovoy Sculptor: Gale Hewing (`SCULPTOR`): 90% RES at the start. Each sculpting
 * with Radiance: Stellar Glimmer on it in its window becomes 2 statues that explode on it (499,999
 * each) and take its RES down 2 stacks (50%, Anemo 40%; at 3, 30%, Anemo 15%), for 30 s from the
 * last; without, Big-Mouthed Jack Frosts, and nothing off it.
 */
function sculptor(
  boss: StygianBoss,
  hp: number,
  team: FightTeam,
  settings: FightSettings = {}
): FightEstimate {
  const S = SCULPTOR
  const notes: FightNote[] = ['windowEstimated']
  const radiance = radianceOf(team, notes)
  const run = hpRun(hp, team, settings)
  if (run.opening) notes.push('opening')
  const stateOf = (stacks: number): StygianPhaseKey =>
    stacks >= 3 ? 'stacks3' : stacks >= 1 ? 'stacks2' : 'initial'
  let stacks = 0
  let expires = Number.POSITIVE_INFINITY
  // at its stacks' RES until `until`, the stacks running out on the way
  const advance = (until: number) => {
    while (expires < until - 1e-9) {
      if (
        run.to(
          stateOf(stacks),
          phaseRes(boss, stateOf(stacks))!,
          expires,
          stacks
        )
      )
        return true
      stacks = 0
      expires = Number.POSITIVE_INFINITY
    }
    return run.to(
      stateOf(stacks),
      phaseRes(boss, stateOf(stacks))!,
      until,
      stacks
    )
  }
  let casts = 0
  let interrupted = 0
  let blasts = 0
  for (
    let cast = S.first;
    run.left > 0 && cast < FIGHT_LIMIT;
    cast += S.cadence
  ) {
    casts++
    const from = cast + S.lead
    const at = radiance.firstIn(from, from + S.window)
    if (at === undefined) {
      if (advance(cast + S.cadence)) break
      continue
    }
    if (advance(at + S.delay)) break
    interrupted++
    blasts += run.take('statue', S.statues * S.explosion)
    if (run.left <= 0) break
    stacks = Math.min(S.maxStacks, stacks + S.perCast)
    expires = run.t + S.last
    if (advance(cast + S.cadence)) break
  }
  return {
    seconds: run.seconds(),
    parts: [
      { key: 'sculptures', count: casts, interrupted, hp: blasts / hp },
      ...phaseParts(run.segments, ['initial', 'stacks2', 'stacks3']),
    ],
    timeline: {
      segments: run.segments,
      events: run.events,
      meter: { key: 'stacks', max: S.maxStacks },
    },
    notes,
    modelled: true,
  }
}

/** Guardian Blade of Drifting Snow: Endless Reverberation's stage (its boss id) */
export const DRIFTING_SNOW_BOSS = 1012063
/**
 * The Guardian Blade's Fearless/Dire values (the game files' Snegurochka_Contessa_02 IceShield
 * LeyLineChallenge ability; stygian.moe and the wiki agree)
 */
export const DRIFTING_SNOW = {
  /** Its first Ice Coffin at 81% HP (its HP held at 80% till then) */
  trigger: 0.81,
  /** Its blink to the centre and its cast, out of reach (estimate) */
  entry: 2,
  /** The coffin holds 20 s: a 1050 durability Frozen ward (42U), its HP untouched */
  window: 20,
  ward: 1050,
  /** Ward units off per unit applied: Pyro 2 (Melt), Electro 1, Anemo and Geo 0.5; DMG none */
  wear: { pyro: 2, electro: 1, anemo: 0.5, geo: 0.5 },
  /** Radiance on it: the ward becomes a shield of 15% of its Max HP (× the ward left), all DMG */
  shield: 0.15,
  /** Broken: 10% of its Max HP off, a shield's 60% of what it took more (10% at most), 10 s weak */
  backlash: 0.1,
  shieldBacklash: 0.6,
  shieldCap: 0.1,
  weak: 10,
  /** Not broken: its exit (estimate), then 10% of its Max HP back */
  exit: 1.5,
  heal: 0.1,
  /** Its second (and last) coffin 25 s after the weakness ends or the heal */
  gap: 25,
  coffins: 2,
} as const

/**
 * Guardian Blade of Drifting Snow: Endless Reverberation (`DRIFTING_SNOW`): at 81% HP it encases
 * itself in an Ice Coffin, a Frozen ward the team's Pyro, Electro, Anemo and Geo wear down (its DMG
 * does nothing); with Radiance: Stellar Glimmer on it, a shield of 15% of its Max HP instead.
 * Broken within 20 s: 10% of its Max HP off (and 60% of what the shield took), 10 s at −40% RES;
 * not broken: 10% back. Its second coffin 25 s later; then none.
 */
function driftingSnow(
  boss: StygianBoss,
  hp: number,
  team: FightTeam,
  settings: FightSettings = {}
): FightEstimate {
  const D = DRIFTING_SNOW
  const regular = phaseRes(boss, 'regular')!
  const weak = phaseRes(boss, 'stunned')!
  const notes: FightNote[] = ['transitionsEstimated']
  const gauge = gaugeFor(team, notes)
  const radiance = radianceOf(team, notes)
  const run = hpRun(hp, team, settings)
  if (run.opening) notes.push('opening')
  // ward durability the team takes off per second
  const wear =
    25 *
    ((gauge.pyro ?? 0) * D.wear.pyro +
      (gauge.electro ?? 0) * D.wear.electro +
      (gauge.anemo ?? 0) * D.wear.anemo +
      (gauge.geo ?? 0) * D.wear.geo)
  let coffins = 0
  let broken = 0
  let shields = 0
  let held = 0
  let breakHp = 0
  let heals = 0
  let healed = 0
  // until 81% (its HP held at 80% till then: what goes past it is lost)
  run.to('regular', regular, FIGHT_LIMIT, 0, {}, D.trigger * hp)
  while (run.left > 0 && run.t < FIGHT_LIMIT && coffins < D.coffins) {
    coffins++
    run.to('leap', null, run.t + D.entry)
    if (run.t >= FIGHT_LIMIT) break
    const start = run.t
    const end = start + D.window
    const breaksAt = wear > 0 ? start + D.ward / wear : Number.POSITIVE_INFINITY
    const radianceAt = radiance.firstIn(start, Math.min(end, breaksAt))
    let done = false
    if (radianceAt !== undefined) {
      // the ward until Radiance, then the shield of what is left
      const wardLeft = Math.max(0, D.ward - wear * (radianceAt - start))
      run.hold('warded', null, radianceAt, [D.ward, wardLeft])
      const shield = D.shield * hp * (wardLeft / D.ward)
      shields++
      const shieldDps = run.dps(regular)
      const lasts =
        shieldDps > 0 ? shield / shieldDps : Number.POSITIVE_INFINITY
      const shieldEnd = Math.min(end, radianceAt + lasts)
      const took = run.hold('barrier', regular, shieldEnd, [wardLeft, 0], {
        backlashRatio: D.shieldBacklash,
        backlashCap: D.backlash + D.shieldCap,
        backlashBefore: D.backlash * hp,
      })
      if (took >= shield - 1e-6 && shieldEnd < end - 1e-9) {
        done = true
        breakHp += run.take(
          'backlash',
          D.backlash * hp + Math.min(D.shieldBacklash * took, D.shieldCap * hp)
        )
      }
    } else if (breaksAt <= end + 1e-9) {
      run.hold('warded', null, breaksAt, [D.ward, 0])
      done = true
      breakHp += run.take('backlash', D.backlash * hp)
    } else {
      run.hold('warded', null, end, [
        D.ward,
        Math.max(0, D.ward - wear * D.window),
      ])
    }
    held += run.t - start
    if (run.left <= 0 || run.t >= FIGHT_LIMIT) break
    if (done) {
      broken++
      if (run.to('stunned', weak, run.t + D.weak)) break
    } else {
      run.to('leap', null, run.t + D.exit)
      heals++
      healed += run.heal('heal', D.heal * hp)
    }
    if (coffins >= D.coffins) break
    if (run.to('regular', regular, run.t + D.gap)) break
  }
  if (run.left > 0) run.to('regular', regular, FIGHT_LIMIT)
  return {
    seconds: run.seconds(),
    parts: [
      {
        key: 'coffins',
        count: coffins,
        broken,
        shields,
        seconds: coffins ? held / coffins : 0,
      },
      ...(broken
        ? [{ key: 'coffinBreak' as const, count: broken, hp: breakHp / hp }]
        : []),
      ...(heals
        ? [{ key: 'coffinHeal' as const, count: heals, hp: healed / hp }]
        : []),
      ...phaseParts(run.segments, ['regular', 'stunned']),
    ],
    timeline: {
      segments: run.segments,
      events: run.events,
      meter: { key: 'wardGauge', max: D.ward },
    },
    notes,
    modelled: true,
  }
}

/** Chimeric Winged Lion: Power Overwhelming's stage (its boss id) */
export const LION_BOSS = 1011061
/**
 * The Winged Lion's Fearless/Dire values (the game files' Chimera_Manticore abilities, their
 * LeyLineChallenge_MonsterLevelHigh branch; stygian.moe and the wiki agree)
 */
export const LION = {
  /** Before its first ward: +200% RES (estimate; 5 s at most) */
  opening: 2.5,
  /** Its Electro Ward: 1000 durability (40U), its HP untouched */
  ward: 1000,
  /** Ward units off per unit applied: Cryo, Pyro, Dendro 1; Anemo, Geo 0.5; Hydro: Electro-Charged */
  wear: { cryo: 1, pyro: 1, dendro: 1, anemo: 0.5, geo: 0.5 },
  /** Hydro on it: an Electro-Charged tick a second, 10 durability each */
  charged: 10,
  /** Its shockwave 12.5 s in, then 30 s after the last; Radiance in its wind-up turns it on its ward */
  shockFirst: 12.5,
  shockEvery: 30,
  shockWindow: 4,
  shockDelay: 2.1,
  shockWear: 400,
  /** Broken: true DMG of 30% of what the ward took, 100% of its Stellar Glimmer DMG; 80% at most */
  backlash: 0.3,
  stellar: 0.7,
  cap: 0.8,
  /** Then 12 s paralyzed */
  paralysis: 12,
  /** Its flight and circling, then its vortex (estimates) */
  flight: 10,
  vortexStart: 1,
  /** The vortex: Radiance on it ends it 2.1 s later; Hydro/Pyro/Electro/Cryo hits on its orbs at 9.5 s */
  radianceDelay: 2.1,
  vortex: 9.5,
  /** Failed: 16 s paralyzed, then a new ward. Absorbed: a second flight and landing (estimate) */
  windParalysis: 16,
  regroup: 8,
} as const

/**
 * Chimeric Winged Lion: Power Overwhelming (`LION`): an Electro Ward (1000 durability) takes the
 * damage, worn down by the team's reactions (Cryo, Pyro and Dendro in full, Anemo and Geo half,
 * Hydro by Electro-Charged) and by its shockwave turned on it by Radiance (400). Broken: 30% of what
 * it took (100% of its Stellar Glimmer DMG) off its HP, at most 80%, then 12 s paralyzed (−60% RES,
 * Cryo and Anemo −120%), a flight, and its vortex: Radiance or Hydro/Pyro/Electro/Cryo hits on its
 * orbs make it fail, 16 s paralyzed; then its ward again.
 */
function lion(
  boss: StygianBoss,
  hp: number,
  team: FightTeam,
  settings: FightSettings = {}
): FightEstimate {
  const L = LION
  const regular = phaseRes(boss, 'regular')!
  const stunned = phaseRes(boss, 'stunned')!
  const opening = phaseRes(boss, 'opening') ?? regular
  const notes: FightNote[] = ['flightEstimated']
  const gauge = gaugeFor(team, notes)
  const radiance = radianceOf(team, notes)
  const run = hpRun(hp, team, settings)
  if (run.opening) notes.push('opening')
  const wear =
    25 *
      ((gauge.cryo ?? 0) * L.wear.cryo +
        (gauge.pyro ?? 0) * L.wear.pyro +
        (gauge.dendro ?? 0) * L.wear.dendro +
        (gauge.anemo ?? 0) * L.wear.anemo +
        (gauge.geo ?? 0) * L.wear.geo) +
    ((gauge.hydro ?? 0) > 0 ? L.charged : 0)
  const ratio = L.backlash + L.stellar * (team.stellarShare ?? 0)
  const orbs = (['hydro', 'pyro', 'electro', 'cryo'] as const).some(
    (e) => (team.dps[e] ?? 0) > 0
  )
  let wards = 0
  let broken = 0
  let wardTime = 0
  let backfires = 0
  let backlash = 0
  let paralyses = 0
  let paralyzed = 0
  let vortices = 0
  let failed = 0
  let nextShock: number = L.shockFirst
  run.to('opening', opening, L.opening)
  while (run.left > 0 && run.t < FIGHT_LIMIT) {
    wards++
    const start = run.t
    let durability: number = L.ward
    let absorbed = 0
    let breaksAt: number | undefined
    // the ward, shockwave by shockwave
    while (run.t < FIGHT_LIMIT) {
      const shock = Math.max(nextShock, run.t)
      const seen = radiance.firstIn(shock, shock + L.shockWindow)
      const hitAt = seen !== undefined ? seen + L.shockDelay : undefined
      const nextEvent = hitAt ?? shock + L.shockWindow
      const wornAt =
        wear > 0 ? run.t + durability / wear : Number.POSITIVE_INFINITY
      const stop = Math.min(wornAt, nextEvent, FIGHT_LIMIT)
      const from = durability
      durability = Math.max(0, durability - wear * (stop - run.t))
      absorbed += run.hold('warded', regular, stop, [from, durability], {
        backlashRatio: ratio,
        backlashCap: L.cap,
        absorbedBefore: absorbed,
        backlashBefore: ratio * absorbed,
      })
      if (stop >= FIGHT_LIMIT - 1e-9) break
      if (wornAt <= nextEvent + 1e-9) {
        breaksAt = run.t
        break
      }
      nextShock = shock + L.shockEvery
      if (hitAt !== undefined) {
        backfires++
        durability = Math.max(0, durability - L.shockWear)
        if (durability <= 1e-9) {
          breaksAt = run.t
          break
        }
      }
    }
    wardTime += run.t - start
    if (breaksAt === undefined) break
    broken++
    backlash += run.take('backlash', Math.min(ratio * absorbed, L.cap * hp))
    if (run.left <= 0) break
    paralyses++
    const p0 = run.t
    if (run.to('stunned', stunned, run.t + L.paralysis)) {
      paralyzed += run.t - p0
      break
    }
    paralyzed += run.t - p0
    // its flight, then its vortex
    if (run.to('airborne', regular, run.t + L.flight)) break
    vortices++
    const vortexAt = run.t
    const seen = radiance.firstIn(vortexAt + L.vortexStart, vortexAt + L.vortex)
    const failAt =
      seen !== undefined
        ? Math.min(
            seen + L.radianceDelay,
            orbs ? vortexAt + L.vortex : Number.POSITIVE_INFINITY
          )
        : orbs
          ? vortexAt + L.vortex
          : undefined
    if (failAt !== undefined) {
      failed++
      if (run.to('airborne', regular, failAt)) break
      const w0 = run.t
      if (run.to('stunned', stunned, run.t + L.windParalysis)) {
        paralyses++
        paralyzed += run.t - w0
        break
      }
      paralyses++
      paralyzed += run.t - w0
    } else if (run.to('airborne', regular, vortexAt + L.vortex + L.regroup))
      break
    nextShock = Math.max(nextShock, run.t)
  }
  return {
    seconds: run.seconds(),
    parts: [
      {
        key: 'electroWards',
        count: wards,
        broken,
        seconds: wards ? wardTime / wards : 0,
        rate: wear,
        backfires,
      },
      ...(broken
        ? [
            {
              key: 'wardBacklash' as const,
              count: broken,
              hp: backlash / hp,
              ratio,
              cap: L.cap,
            },
          ]
        : []),
      ...(paralyses
        ? [{ key: 'paralysis' as const, count: paralyses, seconds: paralyzed }]
        : []),
      ...(vortices
        ? [{ key: 'vortex' as const, count: vortices, failed }]
        : []),
    ],
    timeline: {
      segments: run.segments,
      events: run.events,
      meter: { key: 'wardGauge', max: L.ward },
    },
    notes,
    modelled: true,
  }
}

/** Secret Source Automaton: Configuration Device - Lysis Shears' stage (its boss id) */
export const LYSIS_BOSS = 1010063
/**
 * Lysis Shears' Fearless/Dire values (the game files' DragonClaw ShieldManager_LeyLineChallenge;
 * stygian.moe and the wiki agree)
 */
export const LYSIS = {
  /** Adaptive Countermeasures fill at 200: +2 a second, +5 as a member enters Nightsoul's Blessing, +3 a second while one is in it (off the field too) */
  max: 200,
  passive: 2,
  enter: 5,
  kept: 3,
  /** Till then a shield of 200% of its Max HP at 110% RES, its HP untouched */
  shield: 2,
  /** Filled: the shield breaks, 50% of what it took (its Max HP at most) off its HP, its RES at 10% */
  backlash: 0.5,
  absorbedCap: 1,
  /** Its cannon charges: the 2 mechanisms climbed to and broken (estimates) */
  mechanisms: 13,
  /** Both broken: 15% of its Max HP off, 15 s paralyzed (−30% RES) */
  hpLoss: 0.15,
  stun: 15,
} as const

/**
 * Secret Source Automaton: Configuration Device - Lysis Shears (`LYSIS`): a shield of twice its Max
 * HP and 110% RES until its Adaptive Countermeasures fill (on their own in 100 s; sooner with
 * Nightsoul's Blessing). Filled: the shield breaks, 50% of what it took off its HP (50% at most),
 * its RES 10%; its cannon's mechanisms broken: 15% off and 15 s paralyzed (−30%); then 10% RES.
 */
function lysis(
  boss: StygianBoss,
  hp: number,
  team: FightTeam,
  settings: FightSettings = {}
): FightEstimate {
  const Y = LYSIS
  const shielded = phaseRes(boss, 'shielded')!
  const recovered = phaseRes(boss, 'recovered')!
  const stunned = phaseRes(boss, 'stunned')!
  const notes: FightNote[] = ['mechanismsEstimated']
  const run = hpRun(hp, team, settings)
  if (run.opening) notes.push('opening')
  const cycle = team.cycle
  const blessed = cycle?.anyNightsoul
  if (!cycle) notes.push('noNightsoul')
  // its progress, second by second (entries as they come): when it fills
  let progress = 0
  let fillAt: number | undefined
  const entryTimes: number[] = []
  if (cycle)
    for (let base = 0; base < FIGHT_LIMIT; base += cycle.seconds)
      for (const at of cycle.nightsoulEntries ?? [])
        if (base + at < FIGHT_LIMIT) entryTimes.push(base + at)
  entryTimes.sort((a, b) => a - b)
  let e = 0
  for (let tick = 1; tick <= FIGHT_LIMIT && fillAt === undefined; tick++) {
    while (e < entryTimes.length && entryTimes[e] <= tick) {
      progress += Y.enter
      if (progress >= Y.max) {
        fillAt = entryTimes[e]
        break
      }
      e++
    }
    if (fillAt !== undefined) break
    const kept =
      cycle && blessed
        ? cycleCovered(blessed, cycle.seconds, tick - 1, tick)
        : 0
    progress += Y.passive + Y.kept * kept
    if (progress >= Y.max) fillAt = tick
  }
  const meterAt = fillAt ?? FIGHT_LIMIT
  const took = run.hold(
    'shielded',
    shielded,
    meterAt,
    [0, Math.min(Y.max, progress)],
    {
      backlashRatio: Y.backlash,
      backlashCap: Y.backlash * Y.absorbedCap,
    }
  )
  let backlash = 0
  let lost = 0
  if (fillAt !== undefined && run.t < FIGHT_LIMIT) {
    backlash = run.take(
      'backlash',
      Y.backlash * Math.min(took, Y.absorbedCap * hp)
    )
    if (
      run.left > 0 &&
      !run.to('cannon', recovered, run.t + Y.mechanisms) &&
      run.t < FIGHT_LIMIT
    ) {
      lost = run.take('hpLoss', Y.hpLoss * hp)
      if (run.left > 0 && !run.to('stunned', stunned, run.t + Y.stun))
        run.to('recovered', recovered, FIGHT_LIMIT)
    }
  }
  return {
    seconds: run.seconds(),
    parts: [
      {
        key: 'countermeasures',
        seconds: fillAt,
        nightsoul: cycle && blessed ? cycleShare(blessed, cycle.seconds) : 0,
      },
      ...(fillAt !== undefined
        ? [
            {
              key: 'wardBacklash' as const,
              count: 1,
              hp: backlash / hp,
              ratio: Y.backlash,
              cap: Y.backlash * Y.absorbedCap,
            },
          ]
        : []),
      ...(lost ? [{ key: 'cannon' as const, hp: lost / hp }] : []),
      ...phaseParts(run.segments, ['recovered', 'stunned']),
    ],
    timeline: {
      segments: run.segments,
      events: run.events,
      meter: { key: 'progress', max: Y.max },
    },
    notes,
    modelled: true,
  }
}

const models: Partial<
  Record<
    number,
    (
      boss: StygianBoss,
      hp: number,
      team: FightTeam,
      settings?: FightSettings
    ) => FightEstimate
  >
> = {
  1013061: wavebinder,
  1006063: emperor,
  [MOONGECKO_BOSS]: moongecko,
  [OVERSEER_BOSS]: overseer,
  [SCULPTOR_BOSS]: sculptor,
  [DRIFTING_SNOW_BOSS]: driftingSnow,
  [LION_BOSS]: lion,
  [LYSIS_BOSS]: lysis,
}

/** The fight at a difficulty: its mechanics where they are known, else HP ÷ DPS at `phase` */
export function stygianFight(
  boss: StygianBoss,
  difficulty: StygianDifficultyKey,
  team: FightTeam,
  phase: StygianPhaseKey = boss.main,
  settings?: FightSettings
): FightEstimate {
  const hp = boss.hp[difficulty]
  const model = models[boss.id]
  if (model) return model(boss, hp, team, settings)
  const estimate = plain(boss, hp, team, phase, settings)
  return { ...estimate, notes: [...estimate.notes, 'mechanics'] }
}

/** Whether a boss's fight has its mechanics modelled */
export const stygianFightModelled = (bossId: number) => !!models[bossId]

/** The team's DPS against the enemy as set: all its elements' */
export const teamDps = (team: FightTeam) =>
  Object.values(team.dps).reduce<number>((sum, v) => sum + (v ?? 0), 0)

/** An enemy set by hand: its HP ÷ the team's DPS (no mechanics) */
export function customFight(
  hp: number,
  team: FightTeam,
  settings: FightSettings = { fullEnergy: true }
): FightEstimate {
  const dps = teamDps(team)
  const open = openingOf(team, settings)
  const openDps = open ? teamDps({ ...team, dps: open.dps }) : 0
  const openFor = open?.seconds ?? 0
  const openDone = Math.min(openFor, openDps > 0 ? hp / openDps : openFor)
  const left = Math.max(0, hp - openDps * openDone)
  const seconds =
    left <= 1e-6 && open
      ? openDone
      : dps > 0
        ? openDone + left / dps
        : undefined
  const end = Math.min(seconds ?? FIGHT_LIMIT, FIGHT_LIMIT)
  const segments: FightSegment[] = []
  if (openDone > 0)
    segments.push({
      start: 0,
      end: Math.min(openDone, end),
      state: 'regular',
      hpStart: 1,
      hpEnd: Math.max(0, 1 - (openDps * Math.min(openDone, end)) / hp),
      dps: openDps,
    })
  if (end > openDone || !open)
    segments.push({
      start: openDone,
      end,
      state: 'regular',
      hpStart: left / hp,
      hpEnd: Math.max(0, (left - dps * (end - openDone)) / hp),
      dps,
    })
  return {
    seconds:
      seconds !== undefined && seconds <= FIGHT_LIMIT ? seconds : undefined,
    parts:
      seconds !== undefined
        ? [{ key: 'custom', dps: hp / seconds, seconds }]
        : [],
    timeline: {
      segments,
      events: [],
    },
    notes: open ? ['opening'] : [],
    modelled: false,
  }
}

/**
 * An enemy in a fight: its level, RES and DEF, the preset it is, its HP if set by hand, and how
 * the team plays its mechanics where the fight cannot tell
 */
export type FightEnemy = Pick<
  Team,
  'enemyOverride' | 'enemyPreset' | 'enemyHp' | 'fightSettings'
>

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
      ? stygianFight(
          preset.boss,
          preset.difficulty,
          team,
          preset.phase.key,
          enemy.fightSettings
        )
      : undefined
  return enemy.enemyHp
    ? customFight(enemy.enemyHp, team, {
        fullEnergy: enemy.fightSettings?.fullEnergy !== false,
      })
    : undefined
}

/**
 * The share of the fight's damage time a state with buffs of its own takes (the Moongecko's
 * Disentangled), and those buffs averaged over it: what a Team optimize run adds while it ranks
 * builds (one calculation, not one per state), so a build does not cap its CRIT Rate without
 * Disentangled's. Out of reach and cocooned stretches are not damage time (the cocoon's damage
 * is a sliver, its −100% CRIT Rate left out).
 */
export function fightBuffShare(
  estimate: FightEstimate | undefined
):
  | { share: number; bonus: { critRate_: number; all_dmg_: number } }
  | undefined {
  const segments = estimate?.timeline?.segments
  if (!segments?.length) return undefined
  let damage = 0
  let freed = 0
  for (const { start, end, state, dps } of segments) {
    if (!((dps ?? 0) > 0) || state === 'cocooned' || state === 'enhancedCocoon')
      continue
    damage += end - start
    if (state === 'disentangled') freed += end - start
  }
  if (!(damage > 0) || !(freed > 0)) return undefined
  const share = freed / damage
  return {
    share,
    bonus: {
      critRate_: MOONGECKO_DISENTANGLED.critRate_ * share,
      all_dmg_: MOONGECKO_DISENTANGLED.all_dmg_ * share,
    },
  }
}
/** Disentangled's buffs (percent points) */
export const MOONGECKO_DISENTANGLED = { critRate_: 15, all_dmg_: 50 } as const
