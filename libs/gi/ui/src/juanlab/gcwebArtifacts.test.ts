import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import { coreStats } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import type { GenInput, GenResult, GenSlot } from './gcwebArtifacts'
import { gcwebReadBack, generateArtifacts } from './gcwebArtifacts'

/** KQMS average roll (5★), in the units the game shows: percent points or flat */
const KQM_ROLL: Record<SubstatKey, number> = {
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
const kqm = (rolls: Partial<Record<SubstatKey, number>>) =>
  Object.fromEntries(
    Object.entries(rolls).map(([key, n]) => [
      key,
      Math.round(n * KQM_ROLL[key as SubstatKey] * 100) / 100,
    ])
  ) as Partial<Record<SubstatKey, number>>

const piece = (
  slotKey: GenSlot['slotKey'],
  mainStatKey: GenSlot['mainStatKey'],
  rarity: 4 | 5 = 5,
  setKey: GenSlot['setKey'] = 'GladiatorsFinale'
): GenSlot => ({
  slotKey,
  mainStatKey,
  rarity,
  level: rarity === 5 ? 20 : 16,
  setKey,
})
const slots5 = (
  sands: GenSlot['mainStatKey'],
  goblet: GenSlot['mainStatKey'],
  circlet: GenSlot['mainStatKey']
) => [
  piece('flower', 'hp'),
  piece('plume', 'atk'),
  piece('sands', sands),
  piece('goblet', goblet),
  piece('circlet', circlet),
]

const isPercent = (key: SubstatKey) => key.endsWith('_')
/** The lowest roll of a substat, as shown */
const lowest = (key: SubstatKey, rarity: 4 | 5) =>
  coreStats.art.sub[rarity][key][0] * (isPercent(key) ? 100 : 1)
/** The game's tiers for a substat, as shown (percent points or flat) */
const tiersShown = (key: SubstatKey, rarity: 4 | 5) =>
  coreStats.art.sub[rarity][key].map((v) => v * (isPercent(key) ? 100 : 1))

/** Every rule a piece must keep to exist on the server through gc-web unchanged */
function expectLegal(input: GenInput, result: GenResult) {
  expect(result.pieces).toHaveLength(input.slots.length)
  result.pieces.forEach((p, i) => {
    const slot = input.slots[i]
    expect(p.slotKey).toBe(slot.slotKey)
    expect(p.mainStatKey).toBe(slot.mainStatKey)
    expect(p.rarity).toBe(slot.rarity)
    expect(p.level).toBe(slot.level)
    expect(p.setKey).toBe(slot.setKey)
    // gc-web's artifactRollLimits(4, level): 4 + level/4 rolls, 1 + level/4 per substat
    const upgrades = Math.floor(slot.level / 4)
    const rolls = p.substats.reduce((sum, s) => sum + s.rolls.length, 0)
    expect(rolls, `${p.slotKey} rolls`).toBe(4 + upgrades)
    expect(p.substats).toHaveLength(4)
    expect(new Set(p.substats.map((s) => s.key)).size).toBe(4)
    for (const sub of p.substats) {
      expect(sub.key).not.toBe(p.mainStatKey)
      expect(allSubstatKeys).toContain(sub.key)
      expect(sub.rolls.length).toBeGreaterThanOrEqual(1)
      expect(sub.rolls.length).toBeLessThanOrEqual(Math.min(6, 1 + upgrades))
      const tiers = tiersShown(sub.key, p.rarity)
      for (const roll of sub.rolls)
        expect(
          tiers.some((t) => Math.abs(t - roll) < 1e-6),
          `${sub.key} roll ${roll}`
        ).toBe(true)
      // value: the shown sum of its rolls (one decimal for percent, whole for flat)
      const sum = sub.rolls.reduce((a, b) => a + b, 0)
      const shown = isPercent(sub.key)
        ? Math.round(sum * 10) / 10
        : Math.round(sum)
      expect(
        Math.abs(sub.value - shown),
        `${sub.key} ${sub.value}`
      ).toBeLessThanOrEqual(isPercent(sub.key) ? 0.1 + 1e-9 : 1)
      expect(
        gcwebReadBack(sub.key, p.rarity, sub.value),
        `${p.slotKey} ${sub.key} ${sub.value}`
      ).toBe(sub.rolls.length)
    }
  })
  // totals: the sum of the pieces' shown values
  for (const key of allSubstatKeys) {
    const sum = result.pieces
      .flatMap((p) => p.substats)
      .filter((s) => s.key === key)
      .reduce((a, s) => a + s.value, 0)
    expect(result.totals[key] ?? 0).toBeCloseTo(sum, 6)
  }
  // gaps: generated − target, used substats only
  for (const key of allSubstatKeys) {
    if (input.used.includes(key))
      expect(result.gaps[key]).toBeCloseTo(
        (result.totals[key] ?? 0) - (input.targets[key] ?? 0),
        2
      )
    else expect(result.gaps[key]).toBeUndefined()
  }
}

describe('gcwebReadBack', () => {
  // Expected values computed by running gc-web's own code (commit 7470b71) in node:
  // payloadToBuild (countsFor + substatMarks, with the test fixture catalog) on one substat, then
  // counting the rolls of the line it writes. Script: a one-off import of public/commands.js and
  // public/juanlab.js; output pasted here.
  it.each([
    ['critRate_', 5, 10.9, 3], // 4 × 2.72 shows 10.9 too: gc-web reads 3 (3.89 + 3.5 + 3.5)
    ['critRate_', 5, 19.4, 5], // 5 × 3.89 shows 19.4 (float32), not 19.5
    ['def', 5, 65, 3], // 4 × 16.2 shows 65, as 18.52 + 23.15 + 23.15
    ['critDMG_', 5, 13.3, 2], // no combination: rounded to the closest
    ['critDMG_', 4, 24.9, 4],
    ['atk', 5, 58, 3],
    ['eleMas', 4, 70, 4], // rounded
    ['enerRech_', 5, 25.9, 4],
  ] as const)('%s %i★ %d → %i rolls', (key, rarity, value, rolls) => {
    expect(gcwebReadBack(key, rarity, value)).toBe(rolls)
  })
})

describe('generateArtifacts', () => {
  // Anastasya-like KQMS (20 placed rolls): CRIT Rate circlet, ATK% sands, elemental goblet;
  // CRIT 8/10 placed, ER 2, the 2 fixed rolls of each used substat included in the targets.
  const anastasya: GenInput = {
    slots: slots5('atk_', 'anemo_dmg_', 'critRate_'),
    targets: kqm({
      critRate_: 10,
      critDMG_: 12,
      atk_: 2,
      enerRech_: 4,
      eleMas: 2,
      hp: 2,
      hp_: 2,
      atk: 2,
      def: 2,
      def_: 2,
    }),
    used: ['critRate_', 'critDMG_', 'atk_', 'enerRech_', 'eleMas'],
  }

  it('KQMS build: 5 legal +20 pieces, used totals within one lowest tier', () => {
    const result = generateArtifacts(anastasya)
    expectLegal(anastasya, result)
    for (const key of anastasya.used)
      expect(
        Math.abs(result.gaps[key] ?? Number.POSITIVE_INFINITY),
        key
      ).toBeLessThanOrEqual(lowest(key, 5))
  })

  it('is deterministic and fast', () => {
    const start = performance.now()
    const a = generateArtifacts(anastasya)
    expect(performance.now() - start).toBeLessThan(100)
    expect(generateArtifacts(anastasya)).toEqual(a)
  })

  it('CRIT DMG circlet with many CRIT DMG rolls: the 4 other pieces carry them, ≤ 6 each', () => {
    const input: GenInput = {
      slots: slots5('atk_', 'pyro_dmg_', 'critDMG_'),
      targets: kqm({ critDMG_: 20, critRate_: 8, atk_: 3 }),
      used: ['critDMG_', 'critRate_', 'atk_'],
    }
    const result = generateArtifacts(input)
    expectLegal(input, result)
    const carriers = result.pieces.filter((p) =>
      p.substats.some((s) => s.key === 'critDMG_')
    )
    expect(carriers.map((p) => p.slotKey)).toEqual([
      'flower',
      'plume',
      'sands',
      'goblet',
    ])
    for (const key of input.used)
      expect(Math.abs(result.gaps[key] ?? 99), key).toBeLessThanOrEqual(
        lowest(key, 5)
      )
  })

  it('ER sands and an ER target beyond 4 pieces: closest legal result, gap reported', () => {
    const input: GenInput = {
      slots: slots5('enerRech_', 'electro_dmg_', 'critRate_'),
      targets: kqm({ enerRech_: 30, critDMG_: 6 }),
      used: ['enerRech_', 'critDMG_'],
    }
    const result = generateArtifacts(input)
    expectLegal(input, result)
    expect(
      result.pieces
        .find((p) => p.slotKey === 'sands')!
        .substats.map((s) => s.key)
    ).not.toContain('enerRech_')
    // ER at most 6 rolls on each of 4 pieces: 24 × 6.48 = 155.5 at best, target 165.3
    expect(result.totals.enerRech_).toBeGreaterThan(140)
    expect(result.gaps.enerRech_).toBeLessThan(0)
    expect(result.gaps.enerRech_).toBeCloseTo(
      (result.totals.enerRech_ ?? 0) - (input.targets.enerRech_ ?? 0),
      2
    )
  })

  it('4★ set: four 4★ +16 pieces (8 rolls, ≤ 5 per substat) and one 5★ +20 circlet', () => {
    const input: GenInput = {
      slots: [
        piece('flower', 'hp', 4, 'Instructor'),
        piece('plume', 'atk', 4, 'Instructor'),
        piece('sands', 'eleMas', 4, 'Instructor'),
        piece('goblet', 'eleMas', 4, 'Instructor'),
        piece('circlet', 'eleMas', 5, 'ViridescentVenerer'),
      ],
      // 4★ substats scale ×0.8 in KQM; any close target will do
      targets: { eleMas: 150, enerRech_: 30, critRate_: 12 },
      used: ['eleMas', 'enerRech_', 'critRate_'],
    }
    const result = generateArtifacts(input)
    expectLegal(input, result)
    // (eleMas is the main of 3 pieces: it can only be on the flower and plume)
    expect(Math.abs(result.gaps.enerRech_ ?? 99)).toBeLessThanOrEqual(
      lowest('enerRech_', 4)
    )
    expect(Math.abs(result.gaps.critRate_ ?? 99)).toBeLessThanOrEqual(
      lowest('critRate_', 4)
    )
  })

  it.each([
    30, 40,
  ])('KQMS with %i placed rolls: the closest legal result with a gap, no throw', (placed) => {
    const input: GenInput = {
      slots: slots5('atk_', 'hydro_dmg_', 'critRate_'),
      targets: kqm({
        critRate_: 2 + Math.round(placed * 0.4),
        critDMG_: 2 + Math.round(placed * 0.5),
        atk_: 2 + Math.round(placed * 0.1),
        enerRech_: 2,
      }),
      used: ['critRate_', 'critDMG_', 'atk_', 'enerRech_'],
    }
    const result = generateArtifacts(input)
    expectLegal(input, result)
    const placedRolls = result.pieces
      .flatMap((p) => p.substats)
      .filter((s) => input.used.includes(s.key))
      .reduce((n, s) => n + s.rolls.length, 0)
    expect(placedRolls).toBeLessThanOrEqual(45)
    const short = input.used.filter(
      (k) => (result.gaps[k] ?? 0) < -lowest(k, 5)
    )
    if (placed === 40) expect(short.length).toBeGreaterThan(0)
    // The shortfall is spread: no used substat loses more than 10% of its target
    for (const key of input.used)
      expect(result.gaps[key] ?? 0, key).toBeGreaterThan(
        -0.1 * (input.targets[key] ?? 0)
      )
  })

  it('a value two tier mixes reach with different roll counts: only mixes gc-web reads back with the same count', () => {
    // Three used substats on every piece, one roll each: the extra rolls (6 per piece) go to one
    // unused substat at the lowest tier gc-web reads back as 6 rolls (6 × lowest reads fewer).
    const input: GenInput = {
      slots: slots5('hp_', 'hydro_dmg_', 'critDMG_'),
      targets: kqm({ critRate_: 5, hp_: 4, critDMG_: 4 }),
      used: ['critRate_', 'hp_', 'critDMG_'],
    }
    const result = generateArtifacts(input)
    expectLegal(input, result)
    const filler = result.pieces
      .flatMap((p) => p.substats.map((s) => ({ ...s, rarity: p.rarity })))
      .filter((s) => !input.used.includes(s.key) && s.rolls.length >= 4)
    expect(filler.length).toBeGreaterThan(0)
    for (const s of filler) {
      const allLowest = s.rolls.length * lowest(s.key, s.rarity)
      // all lowest reads back with fewer rolls, so it is not used
      expect(
        gcwebReadBack(
          s.key,
          s.rarity,
          isPercent(s.key)
            ? Math.round(allLowest * 10) / 10
            : Math.round(allLowest)
        )
      ).toBeLessThan(s.rolls.length)
      expect(gcwebReadBack(s.key, s.rarity, s.value)).toBe(s.rolls.length)
    }
  })

  it('keeps every piece legal over many targets (sweep)', () => {
    const keys = allSubstatKeys
    for (let seed = 1; seed <= 40; seed++) {
      const used = keys.filter((_, i) => (seed * (i + 3)) % 7 < 3)
      const targets = Object.fromEntries(
        used.map((k, i) => [k, kqm({ [k]: ((seed + i * 5) % 14) + 1 })[k]])
      )
      const mains = [
        ['atk_', 'pyro_dmg_', 'critRate_'],
        ['enerRech_', 'hp_', 'critDMG_'],
        ['eleMas', 'eleMas', 'eleMas'],
        ['def_', 'def_', 'heal_'],
      ][seed % 4] as [
        GenSlot['mainStatKey'],
        GenSlot['mainStatKey'],
        GenSlot['mainStatKey'],
      ]
      const input: GenInput = { slots: slots5(...mains), targets, used }
      expectLegal(input, generateArtifacts(input))
    }
  })
})
