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
  kind: 'backlash' | 'hornsBreak' | 'wardBreak' | 'blast'
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
    meter?: { key: 'courage' | 'hornGauge' | 'ward'; max: number }
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
  return enemy.enemyHp ? customFight(enemy.enemyHp, team) : undefined
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
