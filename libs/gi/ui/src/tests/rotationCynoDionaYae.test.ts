import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const run = (
  members: CharacterKey[],
  text: string,
  kits: Partial<Record<CharacterKey, KitModel>>,
  constellations: Partial<Record<CharacterKey, number>> = {},
  target?: { radius: number; distance: number }
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, kits[m]?.element ?? 'physical'])
    ) as never,
    constellations,
    repeats: 1,
    keep: 'all',
    kits,
    reactions: { onHit() {} },
    target,
  })

describe('Cyno Revelation (upstream gcsim)', () => {
  it('enters Pactsworn from Secret Rite; Mortuary Rite waits for its own 180-frame CD', () => {
    const sim = run(['Cyno'], 'Cyno E E N1 W1', { Cyno: kitModels.Cyno })
    const [e1, e2, n1] = sim.actions
    expect(e2.start - e1.start).toBe(197)
    expect(sim.hits.some((h) => h.path.join('.') === 'skill.riteDmg')).toBe(
      true
    )
    // the normal attack after the Rite is a Pactsworn one
    expect(
      sim.hits.find((h) => h.t >= n1.start && h.tag === 'normal')?.path
    ).toEqual(['burst', 'normal_0'])
  })
  it('C1: a Judication gives Normal Attack SPD on its own, no Burst needed (game files)', () => {
    const play = (cons: number) =>
      run(
        ['Cyno'],
        'Cyno E W4 E N4 N1 W1',
        { Cyno: kitModels.Cyno },
        { Cyno: cons }
      )
    const c0 = play(0)
    const c1 = play(1)
    // the second Secret Rite is a Judication (in the Endseer window of the Pactsworn the first one
    // started): its Duststalker Bolts
    expect(c1.hits.some((h) => h.label.startsWith('Duststalker Bolt'))).toBe(
      true
    )
    // (the N1 after the sped-up string starts sooner)
    const next = (sim: typeof c0) => sim.actions[sim.actions.length - 1].start
    expect(next(c1)).toBeLessThan(next(c0))
  })
  it('C1 (Revelation): Together We Rise passes once, to the first member switched in, who keeps it', () => {
    const members: CharacterKey[] = ['Cyno', 'Fischl', 'Bennett']
    const sim = simulateRotation({
      rotation: parseRotation(
        'Cyno Q N2 -> Fischl E -> Bennett E W1',
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      elements: { Cyno: 'electro', Fischl: 'electro', Bennett: 'pyro' },
      constellations: { Cyno: 1 },
      repeats: 1,
      keep: 'all',
      // (in a Polestar Field: Stellar-Conduct radiance)
      reactions: { onHit() {}, radianceAt: () => 'conduct' },
    })
    const holders = sim.buffWindows
      .filter((w) => w.path.join('.') === 'Cyno.c1Together' && w.value)
      .map((w) => w.value)
    // Cyno in Pactsworn, then Fischl (switched in first) to its end: never Bennett after her
    expect([...new Set(holders)]).toEqual(['Cyno', 'Fischl'])
  })
})

describe('Diona Revelation (Choice Treasures)', () => {
  const probe = (delays: number[]): KitModel => ({
    characterKey: 'Keqing',
    element: 'electro',
    source: 'test',
    act(c) {
      for (const delay of delays)
        c.hit(delay, {
          path: ['_reaction', 'superconduct'],
          tag: 'other',
          element: 'electro',
          label: 'Reaction probe',
        })
      return { frames: 400 }
    },
  })
  const paws = (delays: number[]) => {
    const sim = run(['Diona', 'Keqing'], 'Diona E -> Keqing E W1', {
      Diona: kitModels.Diona,
      Keqing: probe(delays),
    })
    const entry = sim.actions[1].start
    return sim.hits
      .filter((h) => h.label === 'Icy Paw (Revelation)')
      .map((h) => h.t - entry)
  }
  it('fires 3 paws 5-7 frames after a Superconduct, once per 3.5 s (inclusive expiry)', () => {
    expect(paws([0, 100, 210, 211])).toEqual([5, 6, 7, 216, 217, 218])
  })
})

describe('Yae Miko', () => {
  // (kqmsim: five 2×2 m boxes 9 frames apart, centred 1.65 m further ahead each; the YaeCharged
  // group deals damage once per 0.5 s)
  it('a Charged Attack hits a target once, from the first of its boxes to reach it', () => {
    const hits = (target?: { radius: number; distance: number }) =>
      run(
        ['YaeMiko'],
        'YaeMiko CA W3',
        { YaeMiko: kitModels.YaeMiko },
        {},
        target
      )
        .hits.filter((h) => h.tag === 'charged')
        .map((h) => h.t)
    // (the default 2 m target at 2.4 m: two boxes reach it, the second does no damage)
    expect(hits()).toEqual([90])
    expect(hits({ radius: 1, distance: 6 })).toEqual([108])
    // (a target so large that the fifth box reaches it after the 0.5 s)
    expect(hits({ radius: 4, distance: 4 })).toEqual([90, 126])
  })
})
