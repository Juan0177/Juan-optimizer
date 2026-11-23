import { describe, expect, it, vi } from 'vitest'
import { versionComparison } from './versionCompare'

vi.mock('@genshin-optimizer/gi/ui', async (original) => ({
  ...(await original<typeof import('@genshin-optimizer/gi/ui')>()),
  teamOptMembers: (db: { members: Record<string, string[]> }, id: string) =>
    (db.members[id] ?? []).map((characterKey) => ({ characterKey })),
}))
vi.mock('../RotationWriter', () => ({
  kqmRotationId: (id: string) => `${id}_kqm`,
  writtenRotationOf: (db: { written: Record<string, string> }, rid: string) => ({
    text: db.written[rid] ?? '',
    opener: '',
    timing: '',
  }),
  memberNamesOf: (members: { characterKey: string }[]) =>
    members.map(({ characterKey }) => ({ characterKey, name: characterKey })),
}))

const result = (
  keys: string[],
  cons: Record<string, number> = {},
  total = 1000
) => ({
  after: {
    total,
    members: Object.fromEntries(keys.map((k) => [k, total / keys.length])),
  },
  energyRecharge: {},
  builds: {},
  constellations: cons,
  optimized: keys,
  played: { rotationTime: 20 },
})
const run = (keys: string[], cons?: Record<string, number>, rotation?: string) => ({
  members: keys,
  savedAt: 1,
  run: {
    type: 'done',
    result: result(keys, cons),
    teamOpt: {
      rotationTime: 20,
      kqm: rotation ? { energyRotation: `${rotation}|x` } : {},
    },
  },
})
function db(teams: Record<string, { keys: string[]; run?: object; written?: string }>) {
  return {
    members: Object.fromEntries(Object.entries(teams).map(([id, t]) => [id, t.keys])),
    written: Object.fromEntries(
      Object.entries(teams).map(([id, t]) => [`${id}_kqm`, t.written ?? ''])
    ),
    teamKqmResults: { getRun: (id: string) => teams[id]?.run },
  } as never
}
const names = { i18n: {} as never, gender: 'F' as const }
const A = ['Mavuika', 'Xilonen', 'Citlali', 'Nicole']

describe('versionComparison', () => {
  it('pairs the slots that changed, marks their turns, takes each run’s own rotation', () => {
    const textA = 'Mavuika hE -> Nicole E -> Xilonen E -> Citlali E Q -> Mavuika Q'
    const textB = 'Mavuika hE -> Bennett E J Q -> Xilonen E -> Citlali E Q -> Mavuika Q'
    const B = ['Mavuika', 'Xilonen', 'Citlali', 'Bennett']
    const out = versionComparison(
      db({
        root: { keys: A, run: run(A, {}, textA), written: 'not this' },
        v: { keys: B, run: run(B, {}, textB) },
      }),
      'root',
      'v',
      names
    )
    if ('error' in out) throw new Error(out.error)
    expect(out.pairs).toEqual([{ out: 'Nicole', in: 'Bennett' }])
    expect(out.a.rotation).toBe(textA)
    expect(out.b.rotation).toBe(textB)
    expect(out.a.turns).toEqual([1])
    expect(out.b.turns).toEqual([1])
    // (in the team's slot order; the members in both, fixed)
    expect(out.b.members.map((m) => m.key)).toEqual(B)
    expect(out.b.members.filter((m) => m.fixed).map((m) => m.key)).toEqual([
      'Mavuika',
      'Xilonen',
      'Citlali',
    ])
  })
  it('a member at another constellation is a pair with itself; the same team, none', () => {
    const cons = versionComparison(
      db({
        root: { keys: A, run: run(A, { Mavuika: 0 }), written: 'Mavuika Q' },
        v: { keys: A, run: run(A, { Mavuika: 2 }), written: 'Mavuika Q' },
      }),
      'root',
      'v',
      names
    )
    if ('error' in cons) throw new Error(cons.error)
    expect(cons.pairs).toEqual([{ out: 'Mavuika', in: 'Mavuika' }])
    expect(cons.b.turns).toEqual([0])
    const same = versionComparison(
      db({
        root: { keys: A, run: run(A), written: 'Mavuika Q' },
        v: { keys: A, run: run(A), written: 'Mavuika E Q' },
      }),
      'root',
      'v',
      names
    )
    if ('error' in same) throw new Error(same.error)
    expect(same.pairs).toEqual([])
    expect(same.b.turns).toEqual([])
    // (no rotation recorded by the run: the one written now)
    expect(same.b.rotation).toBe('Mavuika E Q')
  })
  it('says which side has no result for its members now', () => {
    const B = ['Mavuika', 'Xilonen', 'Citlali', 'Bennett']
    expect(
      versionComparison(
        db({ root: { keys: A }, v: { keys: B, run: run(B) } }),
        'root',
        'v',
        names
      )
    ).toEqual({ error: 'noResultA' })
    expect(
      versionComparison(
        // (a run for other members than the team has now)
        db({ root: { keys: A, run: run(A) }, v: { keys: B, run: run(A) } }),
        'root',
        'v',
        names
      )
    ).toEqual({ error: 'noResultB' })
  })
})
