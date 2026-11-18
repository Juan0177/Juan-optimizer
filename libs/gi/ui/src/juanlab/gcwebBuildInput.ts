// juanlab: una build KQM o TC descritta come input del generatore dei 5 manufatti per gc-web (gcwebArtifacts.ts).
// Qui solo la descrizione fedele della build (pezzi, set, rarità, livello, totali delle sottostatistiche come le
// mostra il gioco); limiti, tiri e tier li decide il generatore.
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  allSubstatKeys,
} from '@genshin-optimizer/gi/consts'
import type { BuildTc } from '@genshin-optimizer/gi/db'
import { getArtSetStat } from '@genshin-optimizer/gi/stats'
import { getMainStatValue, getSubstatValue } from '@genshin-optimizer/gi/util'
import type { KqmBuild } from '../util/teamOpt/kqm'
import { KQM_FIXED_ROLLS, kqmBuildRarity, kqmValues } from '../util/teamOpt/kqm'
import type { GenInput, GenSlot } from './gcwebArtifacts'

/**
 * Sets for the pieces the build leaves free (the off-piece of a 4-piece build, the pieces of a build with
 * fewer than 5 set pieces). One piece of a set gives no bonus, so any set works; these are old, common 5★
 * sets (Gladiator's Finale first: the most farmed) that the server always has. Several, all different, so
 * that free pieces never add a 2-piece bonus between themselves.
 */
const OFF_SETS: readonly ArtifactSetKey[] = [
  'GladiatorsFinale',
  'WanderersTroupe',
  'NoblesseOblige',
  'BloodstainedChivalry',
  'ViridescentVenerer',
  'ArchaicPetra',
  'MaidenBeloved',
]
export const DEFAULT_OFF_SET: ArtifactSetKey = OFF_SETS[0]

/** The set's game data, or undefined for a key it does not know (a stale TC set, a bad offSet) */
const setStat = (setKey: ArtifactSetKey) => {
  try {
    return getArtSetStat(setKey) as
      | { slots: readonly string[]; rarities: readonly number[] }
      | undefined
  } catch {
    return undefined
  }
}

/** A set can be this piece: it has the slot, and (`strict`) the rarity */
const fits = (
  setKey: ArtifactSetKey,
  slotKey: ArtifactSlotKey,
  rarity: number,
  strict = true
) => {
  const stat = setStat(setKey)
  return (
    !!stat &&
    !!stat.slots?.includes(slotKey) &&
    (!strict || !!stat.rarities?.includes(rarity))
  )
}

/**
 * Each slot's set. The build's sets first, the most constrained first (1-piece sets: their one slot;
 * 4★-only sets: the 4★ pieces), on the first slots that can take them, flower to circlet. Then the
 * pieces left: `offSet` when asked (and not one of the build's sets); a 2+2 build's fifth piece is of
 * one of its two sets (3 pieces give the same 2-piece bonus, and it is a set the user has); otherwise
 * different sets from `OFF_SETS`, so no bonus is added.
 */
function assignSets(
  slots: { slotKey: ArtifactSlotKey; rarity: number }[],
  sets: Partial<Record<ArtifactSetKey, number>>,
  offSet?: ArtifactSetKey
): ArtifactSetKey[] {
  const entries = (Object.entries(sets) as [ArtifactSetKey, number][]).filter(
    ([setKey, count]) => count > 0 && !!setStat(setKey)
  )
  const room = (setKey: ArtifactSetKey) =>
    slots.filter((s) => fits(setKey, s.slotKey, s.rarity)).length
  const order = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => room(a.entry[0]) - room(b.entry[0]) || a.index - b.index)
    .map(({ entry }) => entry)
  const out: (ArtifactSetKey | undefined)[] = slots.map(() => undefined)
  for (const [setKey, count] of order) {
    let left = count
    // the slots with the set's rarity first; a TC build may give a set a rarity it lacks
    for (const strict of [true, false])
      slots.forEach((s, i) => {
        if (left > 0 && !out[i] && fits(setKey, s.slotKey, s.rarity, strict)) {
          out[i] = setKey
          left--
        }
      })
  }

  const buildSets = new Set(entries.map(([setKey]) => setKey))
  const twoPlusTwo =
    entries.length === 2 && entries.every(([, count]) => count === 2)
  const taken = new Set<ArtifactSetKey>()
  return out.map((setKey, i) => {
    if (setKey) return setKey
    const { slotKey, rarity } = slots[i]
    const free = (key: ArtifactSetKey) =>
      !buildSets.has(key) && !taken.has(key) && fits(key, slotKey, rarity)
    // An explicit offSet wins, also over a 2+2 build's own fifth piece (rule 2 below)
    if (offSet && free(offSet)) {
      taken.add(offSet)
      return offSet
    }
    if (twoPlusTwo) {
      const fifth = entries.find(([key]) => fits(key, slotKey, rarity))
      if (fifth) return fifth[0]
    }
    const pick =
      OFF_SETS.find(free) ??
      OFF_SETS.find((key) => !buildSets.has(key)) ??
      DEFAULT_OFF_SET
    taken.add(pick)
    return pick
  })
}

/** The level a piece is used at: 5★ +20, 4★ +16 (as KQM counts their main stats) */
const maxLevel = (rarity: 4 | 5) => (rarity === 5 ? 20 : 16)
const isPercent = (key: SubstatKey) => key.endsWith('_')
const round6 = (value: number) => Math.round(value * 1e6) / 1e6
/** Counted whenever the entry point does not say which stats matter */
const ALWAYS_USED: readonly SubstatKey[] = [
  'critRate_',
  'critDMG_',
  'enerRech_',
]
/** A percent stat's flat counterpart: counted with it when the entry point does not say what matters */
const FLAT_OF: Partial<Record<SubstatKey, SubstatKey>> = {
  hp_: 'hp',
  atk_: 'atk',
  def_: 'def',
}
/**
 * The used substats when the entry point does not give `scales`: those `counted` judges from the build,
 * plus each counted percent stat's flat counterpart when `hasFlat` (it keeps the build's value as its
 * target: an HP scaler's flat HP is not filler that takes the pieces' extra rolls)
 */
const judgedUsed = (
  counted: (key: SubstatKey) => boolean,
  hasFlat: (key: SubstatKey) => boolean = () => true
): SubstatKey[] => {
  const base = new Set(allSubstatKeys.filter(counted))
  return allSubstatKeys.filter(
    (key) =>
      base.has(key) ||
      (hasFlat(key) &&
        allSubstatKeys.some((pct) => base.has(pct) && FLAT_OF[pct] === key))
  )
}

/**
 * A KQM build as the generator's input. Pieces: KQMS's (5★ +20; with 4★ sets, their pieces 4★ +16, the
 * flower and plume first, then all but the `mains.off` slot, as `kqmStatValues` counts them). Targets: the
 * build's substat totals (`kqmValues`, without the main stats) as the game shows them, for the used
 * substats only (the others' fixed rolls are not targets). Used: `scales` when given (the stats the
 * damage reads), else the substats with placed rolls, CRIT Rate, CRIT DMG and ER, and the flat
 * counterpart of a counted HP%/ATK%/DEF% (target: its fixed rolls).
 */
export function genInputFromKqm(
  build: KqmBuild,
  opts: {
    /** The stats the damage or a requirement reads (the KQM problem's `scales`) */
    scales?: SubstatKey[]
    /** The set of the pieces the build leaves free (default `DEFAULT_OFF_SET`) */
    offSet?: ArtifactSetKey
  }
): GenInput {
  const { four } = kqmBuildRarity(build)
  const off = build.mains.off ?? 'circlet'
  const mains: MainStatKey[] = [
    'hp',
    'atk',
    build.mains.sands,
    build.mains.goblet,
    build.mains.circlet,
  ]
  // kqmStatValues: the flower and plume 4★ first, then all but the 5★ off-piece
  const isFour = [
    four >= 1,
    four >= 2,
    four >= 4 && off !== 'sands',
    four >= 4 && off !== 'goblet',
    four >= 4 && off !== 'circlet',
  ]
  const pieces = allArtifactSlotKeys.map((slotKey, i) => {
    const rarity: 4 | 5 = isFour[i] ? 4 : 5
    return { slotKey, mainStatKey: mains[i], rarity, level: maxLevel(rarity) }
  })
  const setKeys = assignSets(pieces, build.sets, opts.offSet)
  const slots: GenSlot[] = pieces.map((piece, i) => ({
    ...piece,
    setKey: setKeys[i],
  }))

  const used: SubstatKey[] = opts.scales?.length
    ? allSubstatKeys.filter((key) => opts.scales!.includes(key))
    : judgedUsed(
        (key) => (build.rolls[key] ?? 0) > 0 || ALWAYS_USED.includes(key)
      )
  const values = kqmValues(build)
  const targets: GenInput['targets'] = {}
  for (const key of used) {
    const main = slots.reduce(
      (sum, s) =>
        s.mainStatKey === key
          ? sum + getMainStatValue(s.mainStatKey, s.rarity, s.level)
          : sum,
      0
    )
    const value = (values[key] ?? 0) - main
    targets[key] = Math.max(0, round6(isPercent(key) ? value * 100 : value))
  }
  return { slots, targets, used }
}

/**
 * A TC build (GO's theorycraft loadout) as the generator's input: its slots (main stat, rarity, level; 4★
 * for rarities below, which the generator has no tiers for), its sets, and its substat totals (TC keeps
 * values, as the game shows them) as targets for the used substats. Used: `scales` when given (as for
 * KQM), else the substats above what 2 rolls give (GO's roll value for the build's substat rarity and
 * type: KQMS-style builds put 2 on every substat) plus CRIT Rate, CRIT DMG and ER, and the flat counterpart
 * (with a value) of a counted HP%/ATK%/DEF%, its stored value as target. The others are filler:
 * their fixed rolls are not targets, so the pieces' extra rolls land on them, not on a counted stat.
 */
export function genInputFromTc(
  buildTc: BuildTc,
  opts: {
    /** The stats the damage or a requirement reads */
    scales?: SubstatKey[]
  } = {}
): GenInput {
  const { slots: tcSlots, substats, sets } = buildTc.artifact
  const pieces = allArtifactSlotKeys.map((slotKey) => {
    const { statKey, rarity, level } = tcSlots[slotKey]
    return {
      slotKey,
      mainStatKey: statKey,
      rarity: (rarity >= 5 ? 5 : 4) as 4 | 5,
      level,
    }
  })
  const setKeys = assignSets(
    pieces,
    sets as Partial<Record<ArtifactSetKey, number>>
  )
  const value = (key: SubstatKey) => substats.stats[key] ?? 0
  /** What the 2 fixed rolls give, a hair above for float noise */
  const fixed = (key: SubstatKey) =>
    KQM_FIXED_ROLLS *
    getSubstatValue(key, substats.rarity, substats.type) *
    (1 + 1e-6)
  const used: SubstatKey[] = opts.scales?.length
    ? allSubstatKeys.filter((key) => opts.scales!.includes(key))
    : judgedUsed(
        (key) => ALWAYS_USED.includes(key) || value(key) > fixed(key),
        (key) => value(key) > 0
      )
  const targets: GenInput['targets'] = {}
  for (const key of used) targets[key] = Math.max(0, value(key))
  return {
    slots: pieces.map((piece, i) => ({ ...piece, setKey: setKeys[i] })),
    targets,
    used,
  }
}
