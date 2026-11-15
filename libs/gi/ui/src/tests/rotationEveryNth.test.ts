import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { everyNthBursts, parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Ineffa', 'Columbina', 'Sucrose', 'Flins']
const parse = (text: string) =>
  parseRotation(
    text,
    members.map((characterKey) => ({ characterKey, name: characterKey }))
  )
const written = (r: ReturnType<typeof parse>) =>
  r.steps.map(
    (s) => `${s.characterKey} ${s.actions.map((a) => a.text).join(' ')}`
  )

describe('a Burst every Nth rotation (KQM ER calculator)', () => {
  it('plays N rotations with the Burst in one of them, and maps each action back', () => {
    const rotation = parse('Sucrose E Q -> Flins E Q -> Sucrose Q')
    const nth = everyNthBursts(rotation, { Sucrose: 2 })!
    expect(nth.loops).toBe(2)
    expect(written(nth.rotation)).toEqual([
      'Sucrose E Q',
      'Flins E Q',
      'Sucrose Q',
      // (the 2nd: Sucrose's Bursts left out, her step with nothing left too)
      'Sucrose E',
      'Flins E Q',
    ])
    // the written positions: Sucrose E Q, Flins E Q, Sucrose Q = 0..4
    expect(nth.index).toEqual([0, 1, 2, 3, 4, 0, 2, 3])
  })
  it('combines members (every 2nd and every 3rd: 6 rotations), and is off when none', () => {
    const rotation = parse('Sucrose E Q -> Flins E Q')
    const nth = everyNthBursts(rotation, { Sucrose: 2, Flins: 3 })!
    expect(nth.loops).toBe(6)
    const count = (ck: CharacterKey) =>
      nth.rotation.steps
        .filter((s) => s.characterKey === ck)
        .flatMap((s) => s.actions)
        .filter((a) => a.kind === 'burst').length
    expect(count('Sucrose')).toBe(3)
    expect(count('Flins')).toBe(2)
    expect(everyNthBursts(rotation, { Sucrose: 1, Flins: 0 })).toBeUndefined()
    expect(everyNthBursts(parse('Sucrose E'), { Sucrose: 2 })).toBeUndefined()
  })
  it("no longer waits for the Burst it doesn't use (user report: Sucrose's Q every 2nd)", () => {
    const text =
      'Ineffa Q E -> Columbina E Q -> Sucrose E Q -> Flins E E N4 Q N4 E Q N3'
    const play = (rotation: ReturnType<typeof parse>) =>
      simulateRotation({
        rotation,
        members,
        elements: {
          Ineffa: 'electro',
          Columbina: 'hydro',
          Sucrose: 'anemo',
          Flins: 'electro',
        },
        constellations: { Ineffa: 0, Columbina: 0, Sucrose: 6, Flins: 0 },
        repeats: 4,
        keep: 'last2',
        reactions: { onHit() {} },
      })
    const waited = (sim: ReturnType<typeof play>) =>
      (sim.stalls ?? {})['Sucrose Q'] ?? 0
    // written every rotation: her 20 s cooldown makes a 17 s rotation wait
    expect(waited(play(parse(text)))).toBeGreaterThan(0)
    const nth = everyNthBursts(parse(text), { Sucrose: 2 })!
    const sim = play(nth.rotation)
    expect(waited(sim)).toBe(0)
    const bursts = sim.hits.filter(
      (h) => h.characterKey === 'Sucrose' && h.path[0] === 'burst'
    )
    // (still bursting, every other rotation)
    expect(bursts.length).toBeGreaterThan(0)
  })
})
