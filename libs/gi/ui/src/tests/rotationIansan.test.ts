import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (text: string, cons: number) =>
  simulateRotation({
    rotation: parseRotation(text, [{ characterKey: 'Iansan', name: 'Iansan' }]),
    members: ['Iansan'],
    elements: { Iansan: 'electro' },
    constellations: { Iansan: cons },
    repeats: 1,
    keep: 'all',
  })

const precise = (sim: ReturnType<typeof run>) =>
  sim.buffWindows.filter(
    (w) => w.path.join('.') === 'Iansan.a1Precise' && w.value === 'on'
  )

describe('Iansan', () => {
  it('gains Precise Movement from the burst only at C2', () => {
    expect(precise(run('Iansan Q W3', 0))).toHaveLength(0)
    const [window] = precise(run('Iansan Q W3', 2))
    expect(window.start).toBe(0)
  })

  it('ends Precise Movement with her Nightsoul’s Blessing', () => {
    const sim = run('Iansan E CA W20', 0)
    const [window] = precise(sim)
    // the Swift Stormflight's hit starts it; the 16 s blessing (or its points) ends it before 15 s
    expect(window.start).toBeGreaterThan(0)
    expect(window.end - window.start).toBeLessThan(15 * 60)
  })

  it('restores the Scale’s points from the active member’s movement, 6 m an action unless written', () => {
    const members = [
      { characterKey: 'Iansan' as const, name: 'Iansan' },
      { characterKey: 'Bennett' as const, name: 'Bennett' },
    ]
    const points = (bennett: string) => {
      const sim = simulateRotation({
        rotation: parseRotation(`Iansan E Q CA -> Bennett ${bennett}`, members),
        members: ['Iansan', 'Bennett'],
        elements: { Iansan: 'electro', Bennett: 'pyro' },
        constellations: {},
        repeats: 1,
        keep: 'all',
      })
      return Number(
        sim.buffWindows
          .filter((w) => w.path.join('.') === 'Iansan.burstNs' && w.value)
          .at(-1)?.value
      )
    }
    // waits don't move; each normal attack is an action that moves 6 m unless written
    expect(points('W8')).toBeLessThan(42)
    expect(points('6[N4]')).toBe(42)
    expect(points('6[N4[movement=0]]')).toBeLessThan(42)
    expect(points('6[N4[movement=0]]')).toBe(points('W8'))
    expect(points('6[N4[movement=3]]')).toBeGreaterThan(points('W8'))
  })

  it('reads [movement=N] after any action', () => {
    const parsed = parseRotation(
      'Bennett N3[movement=4] Q[movement=2]? hE[movement=1.5] D[movement=8] WK[movement=3] W1[movement=2] CA[movement=x]',
      [{ characterKey: 'Bennett', name: 'Bennett' }]
    )
    expect(
      parsed.steps[0].actions.map((a) => [a.kind, a.movement, !!a.optional])
    ).toEqual([
      ['normal', 4, false],
      ['burst', 2, true],
      ['skill', 1.5, false],
      ['dash', 8, false],
      ['wait', 3, false],
      ['wait', undefined, false],
      ['charged', undefined, false],
    ])
    expect(parsed.steps[0].actions[1].text).toBe('Q[movement=2]?')
    expect(parsed.warnings).toEqual([
      'Bennett: "W1[movement=2]": a wait doesn\'t move, a walk does (WK) (played without it)',
      'Bennett: "CA[movement=x]": write the metres it moves, as [movement=6] (played without it)',
    ])
  })
})
