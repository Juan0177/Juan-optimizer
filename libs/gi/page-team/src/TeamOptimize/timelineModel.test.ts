import type { SimHit, SimulationResult } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import type { TimelineTrack } from './timelineModel'
import { rotationConditions } from './timelineModel'

const hit = (
  t: number,
  element: SimHit['element'],
  tag: SimHit['tag'],
  cryo: boolean
) =>
  ({
    t,
    characterKey: 'Ganyu',
    path: ['skill', 'dmg'],
    tag,
    element,
    states: [
      {
        owner: 'team',
        path: ['resonance', 'ShatteringIce'],
        value: cryo ? 'on' : '',
      },
    ],
  }) as unknown as SimHit
const track = (
  path: string[],
  segments: TimelineTrack['segments']
): TimelineTrack => ({
  key: `team|${path.join('.')}`,
  owner: 'team',
  path,
  kind: 'steps',
  group: 'team',
  segments,
  max: 12,
})

describe('a rotation’s conditions, by time and by damage', () => {
  const sim = {
    start: 0,
    frames: 1000,
    // (Cryo on for 0–400, Frozen 400–500, none after)
    auras: [
      { t: 0, auras: { cryo: 1 } },
      { t: 400, auras: { frozen: 1 } },
      { t: 500, auras: {} },
    ],
    hits: [
      hit(100, 'cryo', 'skill', true),
      hit(450, 'cryo', 'burst', true),
      hit(700, 'physical', 'normal', false),
      // (a transformative reaction can't crit: left out)
      {
        ...hit(720, 'cryo', 'other', false),
        path: ['reaction', 'superconduct'],
      },
    ],
  } as unknown as SimulationResult
  const damage = (h: SimHit) =>
    ({ 100: 300, 450: 300, 700: 400, 720: 999 })[h.t]
  it('Cryo Resonance: the enemy Cryo-affected or Frozen, and the damage that can crit then', () => {
    const c = rotationConditions(
      sim,
      [],
      ['Ganyu', 'Shenhe', 'Xiangling', 'Bennett'],
      damage
    )
    expect(c.cryo?.time).toBeCloseTo(0.5, 6)
    expect(c.cryo?.damage).toBeCloseTo(0.6, 6)
    // (one Cryo member: no resonance, nothing shown)
    expect(
      rotationConditions(
        sim,
        [],
        ['Ganyu', 'Xiangling', 'Bennett', 'Xingqiu'],
        damage
      ).cryo
    ).toBeUndefined()
    // (without damage figures: time only)
    expect(
      rotationConditions(sim, [], ['Ganyu', 'Shenhe', 'Xiangling', 'Bennett'])
        .cryo
    ).toEqual({ time: 0.5 })
  })
  it('Polestar Field: up, its stacks while up, and the stacks its damage got', () => {
    const tracks = [
      track(
        ['reaction', 'polestarStacks'],
        [
          { start: 0, end: 200, value: '4' },
          { start: 200, end: 600, value: '12' },
        ]
      ),
      track(
        ['reaction', 'oppInsidePole'],
        [{ start: 0, end: 600, value: 'on' }]
      ),
    ]
    const c = rotationConditions(
      sim,
      tracks,
      ['Ganyu', 'Xiangling', 'Bennett', 'Xingqiu'],
      damage
    )
    expect(c.polestar?.time).toBeCloseTo(0.6, 6)
    // (4 for 200 frames, 12 for 400: 28/3)
    expect(c.polestar?.stacks).toBeCloseTo(28 / 3, 6)
    // (the Cryo hits: 300 at 4 stacks, 300 at 12; the Physical one gets none, the reaction is out)
    expect(c.polestar?.damageStacks).toBeCloseTo(8, 6)
    expect(c.polestar?.bonus).toEqual([])
    expect(
      rotationConditions(sim, tracks, ['Anastasya', 'Ganyu', 'Bennett'])
        .polestar?.bonus
    ).toEqual([{ characterKey: 'Anastasya', stacks: 1 }])
    expect(rotationConditions(sim, [], ['Ganyu']).polestar).toBeUndefined()
  })
})
