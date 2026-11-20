import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

/** Plays a rotation once (every member at `cons`) and keeps everything */
function playOnce(text: string, members: CharacterKey[], cons: number) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: Object.fromEntries(members.map((m) => [m, cons])),
    repeats: 1,
    keep: 'all',
  })
}

/** Frames of the hits with a given label */
const hitFrames = (sim: ReturnType<typeof simulateRotation>, label: string) =>
  sim.hits.filter((h) => h.label === label).map((h) => h.t)

describe('Navia kit', () => {
  it("recovers Crystalshot's two charges one after the other (gcsim's charge queue)", () => {
    const sim = playOnce('Navia E E E W1', ['Navia'], 0)
    expect(sim.actions.map((a) => a.start)).toEqual([0, 40, 551])
  })
  it("fires a held Crystalshot at gcsim's shortest hold (41 frames)", () => {
    const sim = playOnce('Navia hE W2', ['Navia'], 0)
    expect(hitFrames(sim, 'Rosula Shardshot (5 shots)')).toEqual([50])
    expect(hitFrames(sim, 'Surging Blade')).toEqual([105])
  })
  it("takes the held Crystalshot's frames from the Shrapnel it fires, with Shrapnel from any Crystallize shield", () => {
    const members: CharacterKey[] = ['Bennett', 'Navia']
    // (a party member's three shard pickups land during Navia's hold, before it fires)
    const shields = (at: number[]): KitModel => ({
      characterKey: 'Bennett',
      element: 'pyro',
      source: 'test',
      act(c) {
        for (const d of at)
          c.hit(d, {
            path: ['_marker', 'shield', '906', '', 'crystallize'],
            tag: 'other',
            element: 'physical',
            label: 'Crystallize shield',
          })
        return { frames: 30 }
      },
    })
    const play = (at: number[]) =>
      simulateRotation({
        rotation: parseRotation(
          'Bennett E -> Navia hE N1 W1',
          members.map((characterKey) => ({ characterKey, name: characterKey }))
        ),
        members,
        elements: { Bennett: 'pyro', Navia: 'geo' },
        constellations: {},
        repeats: 1,
        keep: 'all',
        kits: { Bennett: shields(at), Navia: kitModels.Navia },
        reactions: { onHit() {} },
      })
    const intoN1 = (sim: ReturnType<typeof play>) =>
      sim.actions[2].start - sim.actions[1].start
    expect(intoN1(play([]))).toBe(70)
    const fired = play([50, 55, 60])
    expect(hitFrames(fired, 'Rosula Shardshot (11 shots)')).toHaveLength(1)
    expect(intoN1(fired)).toBe(73)
  })
})
