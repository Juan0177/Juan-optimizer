/**
 * Shield markers of the real kits (Thoma, Traveler Hydro, Valeriy, Xinyan, Yanfei, Yun Jin,
 * Zhongli): each Shields.Add of kqmsim, at its frame and with its duration
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

/** Plays `text` once with `who` (at `cons`) and Xingqiu; its shield markers, from its first action */
function shields(who: CharacterKey, cons: number, text: string) {
  const members: CharacterKey[] = [who, 'Xingqiu']
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: { [who]: cons },
    repeats: 1,
    keep: 'all',
  })
  const start = sim.actions.find((a) => a.characterKey === who)!.start
  const markers = sim.hits
    .filter((h) => h.path[0] === '_marker' && h.path[1] === 'shield')
    .map((h) => ({
      t: h.t - start,
      by: h.characterKey,
      frames: +h.path[2],
      target: h.path[3],
      kind: h.path[4],
    }))
  const at = (label: string) =>
    sim.hits.filter((h) => h.label === label).map((h) => h.t - start)
  return { markers, at }
}
const party = (by: CharacterKey, t: number, frames: number) => ({
  t,
  by,
  frames,
  target: '',
  kind: '',
})

describe('kit shield markers (kqmsim Shields.Add)', () => {
  it('Thoma: the Blazing Barrier 10 frames into his Skill, and a frame after each Fiery Collapse', () => {
    expect(shields('Thoma', 0, 'Thoma E W1').markers).toEqual([
      party('Thoma', 10, 480),
    ])
    const { markers, at } = shields('Thoma', 0, 'Thoma Q N4 W1')
    const collapses = at('Fiery Collapse')
    expect(collapses.length).toBeGreaterThan(0)
    expect(markers).toEqual(collapses.map((t) => party('Thoma', t + 1, 480)))
  })
  it('Traveler Hydro C4: Aquacrest Aegis on the Traveler from the cast to a frame after the next action', () => {
    expect(shields('TravelerHydro', 4, 'TravelerHydro E N1').markers).toEqual([
      {
        t: 0,
        by: 'TravelerHydro',
        frames: 44,
        target: 'TravelerHydro',
        kind: '',
      },
    ])
    // (the hold: 22 Dewdrops, its swap at 89 + 315 frames)
    expect(
      shields('TravelerHydro', 4, 'TravelerHydro hE -> Xingqiu N1').markers
    ).toEqual([
      {
        t: 0,
        by: 'TravelerHydro',
        frames: 405,
        target: 'TravelerHydro',
        kind: '',
      },
    ])
    expect(shields('TravelerHydro', 3, 'TravelerHydro E N1').markers).toEqual(
      []
    )
  })
  it('Valeriy: the party shield 25 frames into his Skill, for 18 s', () => {
    expect(shields('Valeriy', 0, 'Valeriy E W1').markers).toEqual([
      party('Valeriy', 25, 1080),
    ])
  })
  it("Xinyan: the shield 28 frames into her Skill (her clock, after its 9-frame hitlag), C2's Rave 43 into her Burst", () => {
    expect(shields('Xinyan', 0, 'Xinyan E W1').markers).toEqual([
      party('Xinyan', 37, 720),
    ])
    // (after the initial hit's 4-frame defense halt; a Skill while the Rave is up makes none)
    expect(shields('Xinyan', 2, 'Xinyan Q W1 E W1').markers).toEqual([
      party('Xinyan', 47, 720),
    ])
    expect(shields('Xinyan', 1, 'Xinyan Q W1').markers).toEqual([])
  })
  it('Yanfei C4: a party shield at the Burst cast, for 15 s', () => {
    expect(shields('Yanfei', 4, 'Yanfei Q W1').markers).toEqual([
      party('Yanfei', 0, 900),
    ])
    expect(shields('Yanfei', 3, 'Yanfei Q W1').markers).toEqual([])
  })
  it('Yun Jin: a shield on herself from the cast until the hit', () => {
    const self = (frames: number) => ({
      t: 0,
      by: 'YunJin',
      frames,
      target: 'YunJin',
      kind: '',
    })
    expect(shields('YunJin', 0, 'YunJin E W1').markers).toEqual([self(13)])
    expect(shields('YunJin', 0, 'YunJin hE W1').markers).toEqual([self(50)])
  })
  it('Zhongli: the Jade Shield 48 frames into the hold, and at the cast of a C2 Burst', () => {
    expect(shields('Zhongli', 0, 'Zhongli hE W1').markers).toEqual([
      party('Zhongli', 48, 1200),
    ])
    expect(shields('Zhongli', 1, 'Zhongli E W1 Q W1').markers).toEqual([])
    expect(shields('Zhongli', 2, 'Zhongli Q W1').markers).toEqual([
      party('Zhongli', 0, 1200),
    ])
  })
})
