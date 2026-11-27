import type { ElementWithPhyKey } from '@genshin-optimizer/gi/consts'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import type { Team } from '@genshin-optimizer/gi/db'
import data from './stygianSeasons.gen.json'

/**
 * Stygian Onslaught bosses as enemy presets: the Fearless and Dire stage (Lv. 105 and 110) of
 * every boss of the released seasons, with its RES in each phase of the fight.
 *
 * - The seasons, bosses and levels come from the game dump (`tools/stygian/gen_stygian.py`, which
 *   also writes the bosses' names in every language: the `stygian` namespace).
 * - The RES per phase is the fight's (its abilities change the monster table's): from
 *   stygian.moe, checked against the dump's monster table and the Fandom wiki's Stygian Onslaught
 *   sections. Where they disagree, two of the three decide (Veteran Wind Operative: Anemo 50%, as
 *   in the dump and the wiki, not stygian.moe's 70%).
 *
 * - Its HP at Fearless (Lv. 105) and Dire (Lv. 110) is stygian.moe's: the dump has the HP curve
 *   (`hp_ratio` x GROW_CURVE_HP_2 is ~94K at Lv. 105) but not the stages' HP multipliers (about x46
 *   at Fearless and x77 at Dire for the Iktomisaurus), which its level scripts set. A boss back in
 *   a later season: its latest HP.
 *
 * A boss is keyed by its Fearless/Dire stage config id (the dump's LeyLineLevelConfig).
 */

/** A phase's RES: percent, `'immune'` for an element it takes no damage from */
export type StygianRes = Record<ElementWithPhyKey, number | 'immune'>

export const stygianPhaseKeys = [
  'regular',
  'shielded',
  'stunned',
  'weakened',
  'recovered',
  'enhanced',
  'rage',
  'geohuman',
  'molten',
  'lowEnergy',
  'nightsoul',
  'hat',
  'ducks',
  'dullCarapace',
  'opening',
  'recording',
  'initial',
  'stacks2',
  'stacks3',
  'normalMode',
] as const
export type StygianPhaseKey = (typeof stygianPhaseKeys)[number]

export interface StygianPhase {
  key: StygianPhaseKey
  res: StygianRes
}

export interface StygianBoss {
  id: number
  /** Its HP at each difficulty (stygian.moe's) */
  hp: Record<StygianDifficultyKey, number>
  /** The fight's phases, in the order they come */
  phases: StygianPhase[]
  /** The phase its HP is mostly taken in: the one picked first */
  main: StygianPhaseKey
  /** The seasons it was in (ids), oldest first */
  seasons: number[]
  /** It can't be frozen (the game's boss type: gcsim's rule) */
  freezeImmune: boolean
}

/** RES of `all` elements, but for the ones given */
const res = (
  all: number,
  others: Partial<Record<ElementWithPhyKey, number | 'immune'>> = {}
): StygianRes => ({
  ...(Object.fromEntries(allElementWithPhyKeys.map((e) => [e, all])) as Record<
    ElementWithPhyKey,
    number
  >),
  ...others,
})

const phase = (key: StygianPhaseKey, r: StygianRes): StygianPhase => ({
  key,
  res: r,
})

/** Per boss (stage config id): its phases, and the main one */
const fights: Record<number, [StygianPhase[], StygianPhaseKey]> = {
  // Hydro Tulpa: Turbulent Vortex
  1001061: [
    [
      phase('regular', res(10, { hydro: 'immune' })),
      phase('rage', res(210, { hydro: 'immune' })),
    ],
    'regular',
  ],
  // Lava Dragon Statue: Blazing Flame (Geohuman, then Molten Dragon, then weakened for 17 s)
  1001062: [
    [
      phase('geohuman', res(200)),
      phase('molten', res(45, { pyro: 200 })),
      phase('weakened', res(10)),
    ],
    'weakened',
  ],
  // Secret Source Automaton: Overseer Device - Obliterator Panoply (Cryo hits: Low Energy; after
  // each Sweeper Mode, its normal attacks at 80%, 10% once stopped or in Forced Counterstrike)
  1001063: [
    [
      phase('enhanced', res(270)),
      phase('lowEnergy', res(30, { cryo: -30 })),
      phase('nightsoul', res(110)),
      phase('normalMode', res(80)),
      phase('regular', res(10)),
    ],
    'lowEnergy',
  ],
  // Tenebrous Papilla: Shadow Void Transfiguration
  1002061: [
    [phase('regular', res(10)), phase('weakened', res(-50))],
    'regular',
  ],
  // Battle-Hardened Tent Tortoise: Thunderous Aegis
  1002062: [
    [phase('regular', res(10, { physical: 50, electro: 70 }))],
    'regular',
  ],
  // Battle-Hardened Pipilpan Idol: Hundred Deceptions
  1002063: [
    [
      phase('regular', res(10)),
      phase('hat', res(135, { hydro: 10, electro: 10 })),
      phase('weakened', res(-90)),
    ],
    'regular',
  ],
  // Aeonblight Drake: Annihilation Configuration
  1003061: [[phase('regular', res(10, { physical: 70 }))], 'regular'],
  // Battle-Scarred Rock Crab: One Million Blasts
  1003062: [
    [phase('regular', res(10)), phase('weakened', res(-30))],
    'regular',
  ],
  // Battle-Hardened Fireblade Shock Trooper: Forlorn Hope
  1003063: [
    [
      phase('regular', res(10, { physical: -20 })),
      phase('shielded', res(70, { physical: 40, electro: 10 })),
      phase('weakened', res(-40, { physical: -70 })),
      phase('recovered', res(10, { physical: -20, electro: -50 })),
    ],
    'regular',
  ],
  // Frostnight Herra: Hatred and Rage
  1004061: [
    [phase('regular', res(10)), phase('enhanced', res(130))],
    'regular',
  ],
  // Battle-Hardened Lightkeeper: Mourning Echoes
  1004062: [[phase('regular', res(10))], 'regular'],
  // Veteran Frost Operative: Bloodsoaked Blade
  1004063: [
    [phase('regular', res(10, { physical: -20, cryo: 70 }))],
    'regular',
  ],
  // Iniquitous Baptist: Resonant Wrath
  1005061: [[phase('regular', res(10))], 'regular'],
  // Battle-Hardened Iktomisaurus: Frostbound Resolve
  1005062: [[phase('regular', res(70, { cryo: 110 }))], 'regular'],
  // Experimental Field Generator: Extreme Potential
  1005063: [[phase('regular', res(10, { geo: 70 }))], 'regular'],
  // Lord of the Hidden Depths: Whisperer of Nightmares — Ravager's Edge
  1006061: [
    [phase('regular', res(10)), phase('weakened', res(-60))],
    'regular',
  ],
  // Emperor of Fire and Iron: Ordained Conquest
  1006063: [[phase('regular', res(10, { pyro: 60 }))], 'regular'],
  // Battle-Hardened Hexadecatonic Mandragora: Stormvine (weakened once its split copies are down)
  1007061: [
    [
      phase('regular', res(310, { dendro: 435 })),
      phase('weakened', res(10, { dendro: 135, anemo: -40 })),
    ],
    'weakened',
  ],
  // Knuckle Duckle: Armored Arsenal (shielded until its ducks are down, then stunned)
  1007062: [
    [
      phase('shielded', res(210)),
      phase('ducks', res(10)),
      phase('stunned', res(-50, { electro: -110 })),
      phase('recovered', res(10, { electro: -50 })),
    ],
    'recovered',
  ],
  // Radiant Moongecko: Entangled Fangs
  1008061: [
    [phase('regular', res(10, { geo: 70 })), phase('dullCarapace', res(10))],
    'regular',
  ],
  // Battle-Hardened Glacial Wolf: Glacial Soul
  1009061: [
    [
      phase('opening', res(110, { anemo: 150 })),
      phase('regular', res(10, { anemo: 50 })),
      phase('weakened', res(-60, { anemo: -20 })),
    ],
    'regular',
  ],
  // The Open-Eyed: Overbearing Contempt
  1009063: [
    [phase('regular', res(10)), phase('recording', res(80))],
    'regular',
  ],
  // Shadow of the Precursor's Secret Source Matrix of Overseer Network: Will of the Hive
  1010061: [
    [
      phase('shielded', res(135, { electro: 10, cryo: 10 })),
      phase('stunned', res(-40)),
      phase('regular', res(10)),
    ],
    'regular',
  ],
  // Secret Source Automaton: Configuration Device - Lysis Shears
  1010063: [
    [
      phase('shielded', res(110)),
      phase('stunned', res(-30)),
      phase('recovered', res(10)),
    ],
    'recovered',
  ],
  // Chimeric Winged Lion: Power Overwhelming (before its first Electro Ward: +200% RES)
  1011061: [
    [
      phase('opening', res(210, { electro: 250, anemo: 250 })),
      phase('regular', res(10, { electro: 50, anemo: 50 })),
      phase('stunned', res(-60, { cryo: -120, anemo: -120 })),
    ],
    'regular',
  ],
  // Veteran Wind Operative: Treacherous Blade
  1011062: [
    [phase('regular', res(10, { physical: -20, anemo: 50 }))],
    'regular',
  ],
  // Battle-Hardened Domovoy Sculptor: Gale Hewing (each sculpting turned to statues by Radiance:
  // 2 stacks of RES down, 3 at most)
  1012061: [
    [
      phase('initial', res(90)),
      phase('stacks2', res(50, { anemo: 40 })),
      phase('stacks3', res(30, { anemo: 15 })),
    ],
    'initial',
  ],
  // Guardian Blade of Drifting Snow: Endless Reverberation
  1012063: [[phase('regular', res(10)), phase('stunned', res(-40))], 'regular'],
  // Wavebinder: Stormfang
  1013061: [
    [
      phase('regular', res(10, { hydro: 70, electro: -10 })),
      phase('shielded', res(70, { hydro: 130, electro: 10 })),
    ],
    'regular',
  ],
}

/** Per boss: its HP at Fearless (Lv. 105) and Dire (Lv. 110), stygian.moe's */
const hps: Record<number, [number, number]> = {
  1001061: [7658830, 17260005], // Hydro Tulpa
  1001062: [5690637, 11183934], // Lava Dragon Statue
  1001063: [7606009, 14916723], // Secret Source Automaton: Overseer Device
  1002061: [6419729, 11168065], // Tenebrous Papilla
  1002062: [6350005, 13283708], // Battle-Hardened Tent Tortoise
  1002063: [6254996, 10200307], // Battle-Hardened Pipilpan Idol
  1003061: [6004430, 13909262], // Aeonblight Drake
  1003062: [5833716, 10053991], // Battle-Scarred Rock Crab
  1003063: [9232639, 17195518], // Battle-Hardened Fireblade Shock Trooper
  1004061: [7496352, 12855408], // Frostnight Herra
  1004062: [3307214, 8109043], // Battle-Hardened Lightkeeper
  1004063: [7135813, 13969549], // Veteran Frost Operative
  1005061: [5213725, 10902915], // Iniquitous Baptist
  1005062: [4344257, 7972064], // Battle-Hardened Iktomisaurus
  1005063: [13231421, 23020735], // Experimental Field Generator
  1006061: [12437830, 23658108], // Lord of the Hidden Depths
  1006063: [8552749, 14042886], // Emperor of Fire and Iron
  1007061: [6459516, 11896648], // Battle-Hardened Hexadecatonic Mandragora
  1007062: [13114773, 25925712], // Knuckle Duckle
  1008061: [10253199, 20950072], // Radiant Moongecko
  1009061: [9996870, 20201856], // Battle-Hardened Glacial Wolf
  1009063: [13402600, 28135427], // The Open-Eyed
  1010061: [8268034, 16743001], // Precursor's Secret Source Matrix
  1010063: [8121748, 23114376], // Secret Source Automaton: Configuration Device
  1011061: [10748445, 23349702], // Chimeric Winged Lion
  1011062: [8068956, 17506995], // Veteran Wind Operative
  1012061: [13581631, 32436188], // Battle-Hardened Domovoy Sculptor
  1012063: [10335048, 21871500], // Guardian Blade of Drifting Snow
  1013061: [15310194, 33517377], // Wavebinder
}

export interface StygianSeason {
  id: number
  /** The first and last days (server time, UTC+8), `YYYY-MM-DD` */
  start: string
  end: string
  bosses: number[]
}
export const stygianSeasons: StygianSeason[] = data.seasons

/** The difficulties the presets are for, and their enemy level */
export const stygianDifficulties = [
  { key: 'fearless', level: data.levels.fearless },
  { key: 'dire', level: data.levels.dire },
] as const
export type StygianDifficultyKey = (typeof stygianDifficulties)[number]['key']

/** Every boss, the latest season's first */
export const stygianBosses: StygianBoss[] = (() => {
  const seasonsOf = new Map<number, number[]>()
  for (const season of stygianSeasons)
    for (const id of season.bosses)
      seasonsOf.set(id, [...(seasonsOf.get(id) ?? []), season.id])
  return [...seasonsOf]
    .sort(([, a], [, b]) => b[b.length - 1] - a[a.length - 1])
    .map(([id, seasons]) => {
      const fight = fights[id]
      const hp = hps[id]
      if (!fight || !hp) throw new Error(`Stygian boss ${id} has no RES or HP`)
      return {
        id,
        hp: { fearless: hp[0], dire: hp[1] },
        phases: fight[0],
        main: fight[1],
        seasons,
        freezeImmune: data.freezeImmune.includes(id),
      }
    })
})()

export const stygianBoss = (id: number) =>
  stygianBosses.find((b) => b.id === id)

const today = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The season on at `date` (`YYYY-MM-DD`, default: today), if any */
export function currentStygianSeason(
  date = today()
): StygianSeason | undefined {
  return stygianSeasons.find((s) => s.start <= date && date < s.end)
}

/** A team's `enemyPreset`: the boss, and its phase */
export const stygianPresetKey = (bossId: number, phase: StygianPhaseKey) =>
  `stygian:${bossId}:${phase}`

/**
 * Whether an enemy can't be frozen: as set by hand, else as its boss preset is (a boss of the
 * game's boss type can't: gcsim's rule), else it can be
 */
export function enemyFreezeImmune(
  enemy: Pick<Team, 'freezeImmune' | 'enemyPreset'> | undefined
): boolean {
  if (enemy?.freezeImmune !== undefined) return enemy.freezeImmune
  const id = enemy?.enemyPreset?.match(/^stygian:(\d+):/)?.[1]
  return !!(id && stygianBoss(Number(id))?.freezeImmune)
}

/** The enemy a preset sets: its level and RES (its DEF changes are the team's own) */
export function stygianEnemy(
  bossId: number,
  phase: StygianPhaseKey,
  level: number
): Team['enemyOverride'] {
  const found = stygianBoss(bossId)?.phases.find((p) => p.key === phase)
  if (!found) return {}
  return {
    enemyLevel: level,
    ...Object.fromEntries(
      allElementWithPhyKeys.map((e) => {
        const value = found.res[e]
        return [`${e}_enemyRes_`, value === 'immune' ? Number.MAX_VALUE : value]
      })
    ),
  }
}

/**
 * The preset a team's enemy is: its `enemyPreset`, as long as the enemy still has that phase's
 * RES (edited since: none). The difficulty when the level is one of theirs.
 */
export function appliedStygianPreset(
  team: Pick<Team, 'enemyOverride' | 'enemyPreset'>
):
  | {
      boss: StygianBoss
      phase: StygianPhase
      difficulty: StygianDifficultyKey | undefined
    }
  | undefined {
  const match = team.enemyPreset?.match(/^stygian:(\d+):(\w+)$/)
  if (!match) return undefined
  const boss = stygianBoss(Number(match[1]))
  const found = boss?.phases.find((p) => p.key === match[2])
  if (!boss || !found) return undefined
  const { enemyOverride } = team
  const same = allElementWithPhyKeys.every((e) => {
    const value = found.res[e]
    return (
      enemyOverride[`${e}_enemyRes_`] ===
      (value === 'immune' ? Number.MAX_VALUE : value)
    )
  })
  if (!same) return undefined
  const difficulty = stygianDifficulties.find(
    (d) => d.level === enemyOverride.enemyLevel
  )?.key
  return { boss, phase: found, difficulty }
}

/** The opening energy for a custom enemy or a Stygian preset. */
export function startsWithoutEnergy(
  enemy:
    | Pick<Team, 'enemyOverride' | 'enemyPreset' | 'fightSettings'>
    | undefined
): boolean {
  return (
    enemy?.fightSettings?.fullEnergy === false ||
    (enemy?.fightSettings?.fullEnergy === undefined &&
      !!enemy &&
      !!appliedStygianPreset(enemy))
  )
}
