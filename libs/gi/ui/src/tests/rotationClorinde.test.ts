import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

function playOnce(text: string) {
  const members: CharacterKey[] = ['Clorinde']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: { Clorinde: 0 },
    repeats: 1,
    keep: 'all',
  })
}

describe('Clorinde kit', () => {
  it('runs Night Vigil on her clock: Surging Blade’s hitlag extends it (gcsim’s hitlag status)', () => {
    // E at 0: 6 + 450 frames, and the shot's Surging Blade pauses her for 4 (at 81): until 460
    const inVigil = playOnce('Clorinde E N1 W415f E W1')
    expect(inVigil.actions[2].start).toBe(458)
    expect(inVigil.actions[2].variant?.key).toBe('nightVigil')
    const after = playOnce('Clorinde E N1 W419f E W1')
    expect(after.actions[2].variant?.key).toBeUndefined()
  })
  it('marks Impale the Night’s heal as clearing the whole Bond of Life', () => {
    const sim = playOnce('Clorinde E N3 E W1')
    expect(
      sim.hits
        .filter((h) => h.label === 'Impale the Night (Bond of Life)')
        .map((h) => h.path.slice(2))
    ).toEqual([['loss', 'clear']])
  })
})
