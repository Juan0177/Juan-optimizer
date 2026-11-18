import type { ArtifactSlotKey, SubstatKey } from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import type { BuildTc } from '@genshin-optimizer/gi/db'
import { initCharTC } from '@genshin-optimizer/gi/db'
import type { IArtifact } from '@genshin-optimizer/gi/schema'
import { getMainStatValue, getSubstatValue } from '@genshin-optimizer/gi/util'
import { describe, expect, it } from 'vitest'
import type { KqmBuild } from '../util/teamOpt/kqm'
import { kqmValues } from '../util/teamOpt/kqm'
import {
  artifactsToPayload,
  decodePayload,
  encodePayload,
  genResultToPayload,
} from './gcweb'
import { gcwebReadBack, generateArtifacts } from './gcwebArtifacts'
import {
  DEFAULT_OFF_SET,
  genInputFromKqm,
  genInputFromTc,
} from './gcwebBuildInput'

/** KQMS average 5★ roll as shown (percent points or flat) */
const ROLL: Record<SubstatKey, number> = {
  hp_: 4.96,
  hp: 253.94,
  atk_: 4.96,
  atk: 16.54,
  def_: 6.2,
  def: 19.68,
  eleMas: 19.82,
  critRate_: 3.31,
  critDMG_: 6.62,
  enerRech_: 5.51,
}
const SLOTS: ArtifactSlotKey[] = [
  'flower',
  'plume',
  'sands',
  'goblet',
  'circlet',
]

const kqmBuild = (
  sets: KqmBuild['sets'],
  mains: KqmBuild['mains'],
  rolls: KqmBuild['rolls']
): KqmBuild => ({
  weapon: { key: 'MistsplitterReforged', refinement: 1 },
  sets,
  mains,
  rolls,
})

const RAIDEN = kqmBuild(
  { EmblemOfSeveredFate: 4 },
  { sands: 'enerRech_', goblet: 'electro_dmg_', circlet: 'critRate_' },
  { critDMG_: 8, critRate_: 6, enerRech_: 4, atk_: 2 }
)

describe('genInputFromKqm', () => {
  it('KQMS 5★ build: slots, mains, +20, the 4-piece set and an off-piece', () => {
    const input = genInputFromKqm(RAIDEN, {})
    expect(input.slots.map((s) => s.slotKey)).toEqual(SLOTS)
    expect(input.slots.map((s) => s.mainStatKey)).toEqual([
      'hp',
      'atk',
      'enerRech_',
      'electro_dmg_',
      'critRate_',
    ])
    expect(input.slots.every((s) => s.rarity === 5 && s.level === 20)).toBe(
      true
    )
    expect(input.slots.map((s) => s.setKey)).toEqual([
      'EmblemOfSeveredFate',
      'EmblemOfSeveredFate',
      'EmblemOfSeveredFate',
      'EmblemOfSeveredFate',
      DEFAULT_OFF_SET,
    ])
    expect(DEFAULT_OFF_SET).not.toBe('EmblemOfSeveredFate')
  })

  it('targets: KQM totals minus main stats, in shown units; unused substats dropped', () => {
    const input = genInputFromKqm(RAIDEN, {})
    expect(new Set(input.used)).toEqual(
      new Set(['critDMG_', 'critRate_', 'enerRech_', 'atk_', 'atk'])
    )
    expect(Object.keys(input.targets).sort()).toEqual(
      ['atk', 'atk_', 'critDMG_', 'critRate_', 'enerRech_'].sort()
    )
    expect(input.targets.critRate_).toBeCloseTo(8 * ROLL.critRate_, 6)
    expect(input.targets.critDMG_).toBeCloseTo(10 * ROLL.critDMG_, 6)
    expect(input.targets.enerRech_).toBeCloseTo(6 * ROLL.enerRech_, 6)
    expect(input.targets.atk_).toBeCloseTo(4 * ROLL.atk_, 6)
    // ATK% has placed rolls: flat ATK keeps its 2 fixed rolls as a target (not filler)
    expect(input.targets.atk).toBeCloseTo(2 * ROLL.atk, 6)
    expect(input.targets.hp).toBeUndefined()
    // the same numbers as kqmValues, once the main stats are added back (fractions)
    const values = kqmValues(RAIDEN)
    const mains = (key: SubstatKey) =>
      input.slots
        .filter((s) => s.mainStatKey === key)
        .reduce(
          (sum, s) => sum + getMainStatValue(s.mainStatKey, s.rarity, s.level),
          0
        )
    for (const key of input.used)
      expect(
        (input.targets[key] ?? 0) / (key.endsWith('_') ? 100 : 1) + mains(key)
      ).toBeCloseTo(values[key], 6)
  })

  it('used from scales when given (substats only), fixed rolls as targets', () => {
    const input = genInputFromKqm(RAIDEN, {
      scales: ['atk', 'atk_', 'critRate_', 'critDMG_'],
    })
    expect(new Set(input.used)).toEqual(
      new Set(['atk', 'atk_', 'critRate_', 'critDMG_'])
    )
    expect(input.targets.atk).toBeCloseTo(2 * ROLL.atk, 6)
    expect(input.targets.enerRech_).toBeUndefined()
  })

  it('4★ set: the 4★ pieces +16, the 5★ off-piece +20 of another set', () => {
    const build = kqmBuild(
      { Instructor: 4 },
      { sands: 'eleMas', goblet: 'eleMas', circlet: 'eleMas' },
      { eleMas: 6, enerRech_: 4 }
    )
    const input = genInputFromKqm(build, {})
    expect(input.slots.map((s) => [s.rarity, s.level])).toEqual([
      [4, 16],
      [4, 16],
      [4, 16],
      [4, 16],
      [5, 20],
    ])
    expect(input.slots.map((s) => s.setKey)).toEqual([
      'Instructor',
      'Instructor',
      'Instructor',
      'Instructor',
      DEFAULT_OFF_SET,
    ])
    // KQMS: a 4★ build's substats count 0.84 (4 pieces at 0.8, one at 1)
    expect(input.targets.eleMas).toBeCloseTo(8 * ROLL.eleMas * 0.84, 6)
    expect(input.targets.enerRech_).toBeCloseTo(6 * ROLL.enerRech_ * 0.84, 6)

    const sands = genInputFromKqm(
      { ...build, mains: { ...build.mains, off: 'sands' } },
      {}
    )
    expect(sands.slots.map((s) => s.rarity)).toEqual([4, 4, 5, 4, 4])
    expect(sands.slots[2].setKey).toBe(DEFAULT_OFF_SET)
    expect(sands.targets.eleMas).toBeCloseTo(8 * ROLL.eleMas * 0.84, 6)
  })

  it('off-piece set: the one asked for, unless it is the 4-piece set', () => {
    expect(
      genInputFromKqm(RAIDEN, { offSet: 'WanderersTroupe' }).slots[4].setKey
    ).toBe('WanderersTroupe')
    expect(
      genInputFromKqm(RAIDEN, { offSet: 'EmblemOfSeveredFate' }).slots[4].setKey
    ).toBe(DEFAULT_OFF_SET)
    // a 4★-only set cannot be the 5★ off-piece
    expect(
      genInputFromKqm(RAIDEN, { offSet: 'Instructor' }).slots[4].setKey
    ).toBe(DEFAULT_OFF_SET)
  })

  it('2+2 keeps both sets, the fifth piece of one of them', () => {
    const build = kqmBuild(
      { GladiatorsFinale: 2, ShimenawasReminiscence: 2 },
      { sands: 'atk_', goblet: 'pyro_dmg_', circlet: 'critDMG_' },
      { critRate_: 8, critDMG_: 6, atk_: 6 }
    )
    const sets = genInputFromKqm(build, {}).slots.map((s) => s.setKey)
    expect(sets).toEqual([
      'GladiatorsFinale',
      'GladiatorsFinale',
      'ShimenawasReminiscence',
      'ShimenawasReminiscence',
      'GladiatorsFinale',
    ])
    // with a 4★ set: its pieces are the 4★ flower and plume; the fifth is of the 5★ set
    const four = genInputFromKqm(
      { ...build, sets: { Instructor: 2, NoblesseOblige: 2 } },
      {}
    )
    expect(four.slots.map((s) => [s.setKey, s.rarity])).toEqual([
      ['Instructor', 4],
      ['Instructor', 4],
      ['NoblesseOblige', 5],
      ['NoblesseOblige', 5],
      ['NoblesseOblige', 5],
    ])
    // two 4★ sets: four 4★ pieces, and the 5★ fifth cannot be of either
    const both = genInputFromKqm(
      { ...build, sets: { Instructor: 2, TheExile: 2 } },
      {}
    )
    expect(both.slots.map((s) => [s.setKey, s.rarity])).toEqual([
      ['Instructor', 4],
      ['Instructor', 4],
      ['TheExile', 4],
      ['TheExile', 4],
      [DEFAULT_OFF_SET, 5],
    ])
  })

  it('no set bonus: five different sets (no 2-piece bonus added)', () => {
    const input = genInputFromKqm({ ...RAIDEN, sets: {} }, {})
    expect(new Set(input.slots.map((s) => s.setKey)).size).toBe(5)
  })

  it('feeds the generator: 5 pieces of 9 rolls, the sets kept', () => {
    const input = genInputFromKqm(RAIDEN, {})
    const result = generateArtifacts(input)
    expect(result.pieces.map((p) => p.setKey)).toEqual(
      input.slots.map((s) => s.setKey)
    )
    for (const piece of result.pieces)
      expect(piece.substats.reduce((sum, s) => sum + s.rolls.length, 0)).toBe(9)
  })
})

describe('genInputFromTc', () => {
  const tc = (
    type: BuildTc['artifact']['substats']['type'],
    stats: Partial<Record<SubstatKey, number>>
  ): BuildTc => {
    const build = initCharTC('Furina', 'SplendorOfTranquilWaters')
    build.artifact.slots.sands = { level: 20, statKey: 'hp_', rarity: 5 }
    build.artifact.slots.goblet = { level: 20, statKey: 'hp_', rarity: 5 }
    build.artifact.slots.circlet = {
      level: 16,
      statKey: 'critRate_',
      rarity: 4,
    }
    build.artifact.substats.type = type
    for (const key of allSubstatKeys)
      build.artifact.substats.stats[key] = stats[key] ?? 0
    build.artifact.sets = { GoldenTroupe: 4 }
    return build
  }
  const STATS = { critRate_: 19.4, critDMG_: 79.3, hp_: 29.7, enerRech_: 11 }

  it.each([
    'max',
    'mid',
    'min',
  ] as const)('type %s: slots, values as targets, the non-zero substats used', (type) => {
    const input = genInputFromTc(tc(type, STATS))
    expect(input.slots.map((s) => [s.slotKey, s.mainStatKey])).toEqual([
      ['flower', 'hp'],
      ['plume', 'atk'],
      ['sands', 'hp_'],
      ['goblet', 'hp_'],
      ['circlet', 'critRate_'],
    ])
    expect(input.slots.map((s) => [s.rarity, s.level])).toEqual([
      [5, 20],
      [5, 20],
      [5, 20],
      [5, 20],
      [4, 16],
    ])
    expect(input.targets).toEqual(STATS)
    expect(new Set(input.used)).toEqual(new Set(Object.keys(STATS)))
    expect(input.slots.map((s) => s.setKey)).toEqual([
      'GoldenTroupe',
      'GoldenTroupe',
      'GoldenTroupe',
      'GoldenTroupe',
      DEFAULT_OFF_SET,
    ])
  })

  it('a 1-piece set goes to its slot; rarities below 4★ count as 4★', () => {
    const build = tc('max', STATS)
    build.artifact.sets = { PrayersForWisdom: 1, GoldenTroupe: 4 }
    build.artifact.slots.sands.rarity = 3
    const input = genInputFromTc(build)
    expect(input.slots.map((s) => s.setKey)).toEqual([
      'GoldenTroupe',
      'GoldenTroupe',
      'GoldenTroupe',
      'GoldenTroupe',
      'PrayersForWisdom',
    ])
    expect(input.slots[2].rarity).toBe(4)
  })

  // GO's KQMS button (TabTheorycraft kqms): 2 rolls of every substat at the `mid` value, then the
  // distributed ones on top. Only the stats above their 2 fixed rolls (and CRIT, ER) are counted.
  const kqmsTc = (extra: Partial<Record<SubstatKey, number>>) => {
    const build = initCharTC('Furina', 'SplendorOfTranquilWaters')
    build.artifact.slots.sands = { level: 20, statKey: 'hp_', rarity: 5 }
    build.artifact.slots.goblet = {
      level: 20,
      statKey: 'hydro_dmg_',
      rarity: 5,
    }
    build.artifact.slots.circlet = {
      level: 20,
      statKey: 'critRate_',
      rarity: 5,
    }
    build.artifact.sets = { GoldenTroupe: 4 }
    build.artifact.substats.type = 'mid'
    for (const key of allSubstatKeys)
      build.artifact.substats.stats[key] =
        getSubstatValue(key, 5, 'mid') * (2 + (extra[key] ?? 0))
    return build
  }

  it('KQMS-style TC build: the 2 fixed rolls of the other substats are filler, not targets', () => {
    const build = kqmsTc({ critDMG_: 10, critRate_: 4, hp_: 4, eleMas: 2 })
    const input = genInputFromTc(build)
    expect(new Set(input.used)).toEqual(
      new Set(['critDMG_', 'critRate_', 'hp_', 'hp', 'eleMas', 'enerRech_'])
    )
    // HP% is counted, so flat HP keeps its 2 fixed rolls (an HP scaler's extra rolls go elsewhere)
    expect(input.targets.hp).toBeCloseTo(2 * getSubstatValue('hp', 5, 'mid'), 9)
    expect(Object.keys(input.targets).sort()).toEqual([...input.used].sort())
    expect(input.targets.hp_).toBeCloseTo(build.artifact.substats.stats.hp_, 9)
    // ER is counted with its 2 fixed rolls only
    expect(input.targets.enerRech_).toBeCloseTo(
      2 * getSubstatValue('enerRech_', 5, 'mid'),
      9
    )
    // the extra rolls (45 slots for 40 rolls) go on filler: every counted stat within one roll
    const result = generateArtifacts(input)
    for (const key of input.used)
      expect(Math.abs(result.gaps[key] ?? 0)).toBeLessThan(
        getSubstatValue(key, 5, 'min')
      )
    expect(Math.abs((result.totals.hp ?? 0) - 508)).toBeLessThan(
      getSubstatValue('hp', 5, 'min')
    )
  })

  it('TC with scales: the used substats are the ones read', () => {
    const input = genInputFromTc(kqmsTc({ critDMG_: 10, critRate_: 4 }), {
      scales: ['hp', 'critRate_', 'critDMG_'],
    })
    expect(new Set(input.used)).toEqual(
      new Set(['hp', 'critRate_', 'critDMG_'])
    )
    expect(input.targets.hp).toBeCloseTo(2 * getSubstatValue('hp', 5, 'mid'), 9)
    expect(input.targets.enerRech_).toBeUndefined()
  })

  it('a set key the game data does not know is skipped, not thrown on', () => {
    const build = tc('max', STATS)
    build.artifact.sets = {
      NoSuchSet: 4,
    } as unknown as BuildTc['artifact']['sets']
    const input = genInputFromTc(build)
    expect(input.slots.map((s) => s.setKey)).toHaveLength(5)
    expect(new Set(input.slots.map((s) => s.setKey)).size).toBe(5)
    expect(input.slots.map((s) => s.setKey)).not.toContain('NoSuchSet')
    // and an unknown off-piece set is ignored
    expect(
      genInputFromKqm(RAIDEN, {
        offSet: 'NoSuchSet' as unknown as typeof DEFAULT_OFF_SET,
      }).slots[4].setKey
    ).toBe(DEFAULT_OFF_SET)
  })
})

describe('genResultToPayload', () => {
  const result = generateArtifacts(genInputFromKqm(RAIDEN, {}))

  it('the same ids as artifactsToPayload, values as shown', () => {
    const payload = genResultToPayload(
      'RaidenShogun',
      'F',
      'Raiden KQM',
      result
    )
    const artifacts: IArtifact[] = result.pieces.map((p) => ({
      setKey: p.setKey,
      slotKey: p.slotKey,
      level: p.level,
      rarity: p.rarity,
      mainStatKey: p.mainStatKey,
      location: '',
      lock: false,
      substats: p.substats.map((s) => ({ key: s.key, value: s.value })),
    }))
    expect(payload).toEqual(
      artifactsToPayload('RaidenShogun', 'F', 'Raiden KQM', artifacts)
    )
    expect(payload.artifacts).toHaveLength(5)
    expect(payload.artifacts.map((a) => a.slot)).toEqual([
      'EQUIP_BRACER',
      'EQUIP_NECKLACE',
      'EQUIP_SHOES',
      'EQUIP_RING',
      'EQUIP_DRESS',
    ])
    expect(payload.artifacts[0].setId).toBe(15020) // Emblem of Severed Fate
    expect(payload.artifacts[0].mainProp).toBe('FIGHT_PROP_HP')
    expect(payload.artifacts[2].mainProp).toBe('FIGHT_PROP_CHARGE_EFFICIENCY')
    expect(payload.artifacts[4].mainProp).toBe('FIGHT_PROP_CRITICAL')
    expect(payload.character?.name).toBe('Raiden KQM')
    payload.artifacts.forEach((a, i) => {
      expect(a.rarity).toBe(result.pieces[i].rarity)
      expect(a.level).toBe(result.pieces[i].level)
      expect(a.substats.map((s) => s.value)).toEqual(
        result.pieces[i].substats.map((s) => s.value)
      )
      expect(a.substats).toHaveLength(4)
    })
  })

  it('gc-web reads each value back with the piece’s rolls; round-trips through the link', () => {
    const payload = genResultToPayload('RaidenShogun', 'F', 'x', result)
    const PROP_KEY: Record<string, SubstatKey> = {
      FIGHT_PROP_HP: 'hp',
      FIGHT_PROP_HP_PERCENT: 'hp_',
      FIGHT_PROP_ATTACK: 'atk',
      FIGHT_PROP_ATTACK_PERCENT: 'atk_',
      FIGHT_PROP_DEFENSE: 'def',
      FIGHT_PROP_DEFENSE_PERCENT: 'def_',
      FIGHT_PROP_ELEMENT_MASTERY: 'eleMas',
      FIGHT_PROP_CHARGE_EFFICIENCY: 'enerRech_',
      FIGHT_PROP_CRITICAL: 'critRate_',
      FIGHT_PROP_CRITICAL_HURT: 'critDMG_',
    }
    payload.artifacts.forEach((a, i) =>
      a.substats.forEach((s, j) =>
        expect(
          gcwebReadBack(PROP_KEY[s.prop], a.rarity as 4 | 5, s.value)
        ).toBe(result.pieces[i].substats[j].rolls.length)
      )
    )
    expect(decodePayload(encodePayload(payload))).toEqual(payload)
  })

  it('Traveler: the avatar id by gender', () => {
    expect(
      genResultToPayload('TravelerAnemo', 'M', 'x', result).character?.avatarId
    ).toBe(10000005)
  })
})
