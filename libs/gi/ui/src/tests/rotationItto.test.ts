import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

function playOnce(text: string) {
  const members: CharacterKey[] = ['AratakiItto']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: { AratakiItto: 0 },
    repeats: 1,
    keep: 'all',
  })
}

const slashes = (sim: ReturnType<typeof simulateRotation>) =>
  sim.hits
    .filter((h) => h.path[0] === 'charged')
    .map((h) => h.label.replace('Arataki Kesagiri ', ''))

describe('Arataki Itto kit', () => {
  it('gains a Superlative Superstrength stack from N1 -> Q (gcsim burst[prestack=1])', () => {
    // prestack 1 + N1 in the burst 1 + Ushi 1: two combo slashes before the final one
    expect(slashes(playOnce('Itto N1 Q N1 E 3[CA] W1'))).toEqual([
      'Combo Slash',
      'Combo Slash',
      'Final Slash',
    ])
    // no N1 before the burst: one stack fewer
    expect(slashes(playOnce('Itto Q N1 E 3[CA] W1'))).toEqual([
      'Combo Slash',
      'Final Slash',
      'Saichimonji Slash',
    ])
  })
  it('cancels a sped-up Final Slash no earlier than its hit (gcsim CanQueueAfter)', () => {
    const sim = playOnce('Itto N1 Q N1 E 3[CA] D W1')
    const final = sim.actions.findIndex(
      (a) => a.variant?.key === 'kesagiriFinal'
    )
    // after two combo slashes (A1 +20% ATK SPD): its hit 71 - 25 windup, then 10 frames of hitlag
    expect(sim.actions[final + 1].start - sim.actions[final].start).toBe(56)
  })
})
