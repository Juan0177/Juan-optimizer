import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion } from '@genshin-optimizer/gi/db'
import type { ArtifactBuildData, ArtifactsBySlot } from '../common'
import { artSetPerm, filterArts } from '../common'
import { buildAllowed, exclusionMasks } from './exclusion'

/** Deterministic PRNG (mulberry32) */
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pool = [
  'GladiatorsFinale',
  'WanderersTroupe',
  'NoblesseOblige',
  'ViridescentVenerer',
  'EmblemOfSeveredFate',
  'CrimsonWitchOfFlames',
] as ArtifactSetKey[]

describe('buildAllowed matches the builds artSetPerm enumerates', () => {
  test('random inventories and exclusions', () => {
    const rand = rng(7)
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
    let compared = 0
    for (let trial = 0; trial < 2000; trial++) {
      const nSets = 2 + Math.floor(rand() * (pool.length - 1))
      const sets = pool.slice(0, nSets)
      const partial = rand() < 0.3
      let id = 0
      const values = Object.fromEntries(
        allArtifactSlotKeys.map((slot) => {
          const list: ArtifactBuildData[] = []
          const n = 1 + Math.floor(rand() * 4)
          for (let i = 0; i < n; i++)
            list.push({ id: `${slot}${id++}`, set: pick(sets), values: {} })
          if (partial && rand() < 0.5) list.push({ id: '', values: {} })
          return [slot, list]
        })
      ) as ArtifactsBySlot['values']
      const arts: ArtifactsBySlot = { base: {}, values }
      const exclusion: ArtSetExclusion = {}
      for (const set of sets)
        if (rand() < 0.35)
          (exclusion as Record<string, (2 | 4)[]>)[set] = pick([
            [2],
            [4],
            [2, 4],
          ])
      if (rand() < 0.5)
        exclusion.rainbow = pick([[2], [4], [2, 4]]) as (2 | 4)[]
      if (rand() < 0.4) exclusion.twoTwo = [2, 4]

      // the builds artSetPerm's filters cover (they must be disjoint, so count duplicates)
      const key = (b: ArtifactBuildData[]) =>
        b.map((a) => a.id || '-').join('|')
      const enumerated = new Map<string, number>()
      // as `initialItems` calls it: every artifact's set (`undefined` for empty slots), and the
      // sets each slot has
      const artSets = new Set(
        Object.values(values).flatMap((list) => list.map((a) => a.set!))
      )
      const available = Object.fromEntries(
        Object.entries(values).map(([slot, list]) => [
          slot,
          new Set(list.map((a) => a.set)),
        ])
      )
      for (const filter of artSetPerm(exclusion, artSets, available)) {
        const f = filterArts(arts, filter).values
        for (const a0 of f.flower)
          for (const a1 of f.plume)
            for (const a2 of f.sands)
              for (const a3 of f.goblet)
                for (const a4 of f.circlet) {
                  const k = key([a0, a1, a2, a3, a4])
                  enumerated.set(k, (enumerated.get(k) ?? 0) + 1)
                }
      }
      for (const n of enumerated.values()) expect(n).toBe(1)
      // every build of the inventory, checked one at a time
      const masks = exclusionMasks(exclusion)
      const v = values
      for (const a0 of v.flower)
        for (const a1 of v.plume)
          for (const a2 of v.sands)
            for (const a3 of v.goblet)
              for (const a4 of v.circlet) {
                const b = [a0, a1, a2, a3, a4]
                const allowed = buildAllowed(
                  b.map((a) => a.set),
                  masks
                )
                if (allowed !== enumerated.has(key(b)))
                  throw new Error(
                    `${JSON.stringify(exclusion)} ${b.map((a) => a.set ?? '(empty)').join(',')}: allowed=${allowed}, enumerated=${enumerated.has(key(b))}`
                  )
                compared++
              }
    }
    expect(compared).toBeGreaterThan(50_000)
  })
})

describe('build shapes: two 2-piece bonuses and mixed pieces turned off', () => {
  const [A, B, C, D, E] = pool
  const shapes: Record<string, (ArtifactSetKey | undefined)[]> = {
    '5': [A, A, A, A, A],
    '4+1': [A, A, A, A, B],
    '3+2': [A, A, A, B, B],
    '2+2+1': [A, A, B, B, C],
    '3+1+1': [A, A, A, B, C],
    '2+1+1+1': [A, A, B, C, D],
    '1+1+1+1+1': [A, B, C, D, E],
    // (an empty slot counts as one more set, as the solvers have it)
    '4+empty': [A, A, A, A, undefined],
    '2+2+empty': [A, A, B, B, undefined],
    '3+empty+empty': [A, A, A, undefined, undefined],
  }
  const allowed = (exclusion: ArtSetExclusion) =>
    Object.entries(shapes)
      .filter(([, sets]) => buildAllowed(sets, exclusionMasks(exclusion)))
      .map(([name]) => name)
  const all = Object.keys(shapes)
  test('both allowed: every shape', () => {
    expect(allowed({})).toEqual(all)
  })
  test('no two 2-piece bonuses: 3+2 and 2+2+1 (and their partial forms) go', () => {
    expect(allowed({ twoTwo: [2, 4] })).toEqual(
      all.filter(
        (n) => !['3+2', '2+2+1', '2+2+empty', '3+empty+empty'].includes(n)
      )
    )
  })
  test('no mixed pieces: 2 or more pieces of sets no other piece has go', () => {
    expect(allowed({ rainbow: [2, 4] })).toEqual([
      '5',
      '4+1',
      '3+2',
      '2+2+1',
      '4+empty',
      '2+2+empty',
      '3+empty+empty',
    ])
  })
  test('both off: only builds with 4 pieces of a set', () => {
    expect(allowed({ twoTwo: [2, 4], rainbow: [2, 4] })).toEqual([
      '5',
      '4+1',
      '4+empty',
    ])
  })
  test('with a set rule too: no 2+2, and A at most 3 pieces', () => {
    expect(allowed({ twoTwo: [2, 4], [A]: [4] } as ArtSetExclusion)).toEqual([
      '3+1+1',
      '2+1+1+1',
      '1+1+1+1+1',
    ])
  })
  test('the switches are not sets', () => {
    expect(exclusionMasks({ twoTwo: [2, 4], mixed: [2, 4] }).sets).toEqual({})
  })
})
