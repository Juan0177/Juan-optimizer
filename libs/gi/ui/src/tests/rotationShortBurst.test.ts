import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { everyNthBursts, parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Varesa', 'Iansan', 'Chevreuse', 'Xiangling']
const play = (
  text: string,
  burstEvery?: Partial<Record<CharacterKey, number>>
) => {
  const parsed = parseRotation(
    text,
    members.map((characterKey) => ({ characterKey, name: characterKey }))
  )
  const rotation = burstEvery
    ? (everyNthBursts(parsed, burstEvery)?.rotation ?? parsed)
    : parsed
  return simulateRotation({
    rotation,
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: {},
    repeats: 1,
    keep: 'all',
  })
}
const varesa = (sim: ReturnType<typeof play>) =>
  sim.actions
    .filter((a) => a.characterKey === 'Varesa')
    .map((a) => a.variant?.label ?? a.text)

describe('a Burst every 2nd rotation keeps the short Burst (a player report: Varesa)', () => {
  it("plays Varesa's 30-Energy Volcanic Kablam in every copy, her full Burst in one", () => {
    const sim = play(
      // (the Kablam right after the Fiery Passion plunge, then her full Flying Kick)
      'Iansan E Q -> Chevreuse hE Q -> Varesa E CA P E CA P Q Q -> Iansan',
      { Varesa: 2 }
    )
    const labels = varesa(sim)
    expect(labels.filter((l) => l === 'Volcanic Kablam')).toHaveLength(2)
    // (the full Flying Kick only in the first copy)
    expect(
      sim.actions.filter(
        (a) => a.characterKey === 'Varesa' && a.text === 'Q' && !a.variant
      )
    ).toHaveLength(1)
    // and no Rush is refused for want of a charge
    expect(sim.warnings.join(' ')).not.toContain('Rush charge')
  })
  it('leaves the rotation as it was when every Burst is played', () => {
    const text =
      'Iansan E Q -> Chevreuse hE Q -> Varesa E CA P E CA P Q -> Iansan'
    expect(varesa(play(text))).toEqual(varesa(play(text, { Varesa: 1 })))
  })
  it("still drops a member's full Bursts in the copies without them", () => {
    const sim = play('Iansan E Q -> Varesa E CA P E CA P Q -> Iansan', {
      Iansan: 2,
    })
    expect(
      sim.actions.filter((a) => a.characterKey === 'Iansan' && a.text === 'Q')
    ).toHaveLength(1)
  })
})
