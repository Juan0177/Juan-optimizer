import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

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

describe('Diluc kit', () => {
  it("lands Dawn's ticks only where the phoenix's path reaches the target", () => {
    const sim = playOnce('Diluc Q W5', ['Diluc'], 0)
    expect(hitFrames(sim, 'Dawn (slash)')).toEqual([101])
    // (the default target: 2.4 m away, radius 2)
    expect(hitFrames(sim, 'Dawn (DoT)')).toEqual([112, 124, 136, 148])
    expect(hitFrames(sim, 'Dawn (explosion)')).toEqual([])
  })
  it("plays Xianyun-assisted high and low plunges with gcsim's frames and collision", () => {
    const sim = playOnce(
      'Xianyun E P Q -> Diluc D J HP[collision=0.5] D J LP',
      ['Xianyun', 'Diluc'],
      0
    )
    const [jump1, jump2] = sim.actions
      .filter((a) => a.characterKey === 'Diluc' && a.text === 'J')
      .map((a) => a.start)
    const diluc = sim.hits.filter((h) => h.characterKey === 'Diluc')
    const plunges = diluc.filter((h) => h.tag === 'plunge')
    // the high plunge leaves the airborne jump at 8 frames (4 for the low one)
    expect(plunges.map((h) => [h.label, h.t, h.weight ?? 1])).toEqual([
      ['Plunge Collision', jump1 + 8 + 30, 0.5],
      ['High Plunge', jump1 + 8 + 40, 1],
      ['Low Plunge', jump2 + 4 + 36, 1],
    ])
    expect(plunges.map((h) => h.path.join('.'))).toEqual([
      'plunging.dmg',
      'plunging.high',
      'plunging.low',
    ])
    expect(plunges[0].applies).toBeFalsy()
    // the next dash after the high plunge: at its hitmark
    const dash2 = sim.actions.filter(
      (a) => a.characterKey === 'Diluc' && a.text === 'D'
    )[1].start
    expect(dash2).toBe(jump1 + 8 + 40)
    expect(sim.notes.join(' ')).not.toContain('not modelled')
  })
  it('C6: Searing Onslaught does not interrupt the normal combo', () => {
    const sim = playOnce('Diluc N1 E N1 W1', ['Diluc'], 6)
    expect(
      sim.hits.filter((h) => h.tag === 'normal').map((h) => h.path[1])
    ).toEqual(['0', '1'])
  })
})
