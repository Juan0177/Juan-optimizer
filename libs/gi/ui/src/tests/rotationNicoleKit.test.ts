import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Nicole', 'Bennett']
const run = (text: string, constellation = 0) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Nicole: 'pyro', Bennett: 'pyro' },
    constellations: { Nicole: constellation },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
  })

describe('Nicole (gcsim frames and constellations)', () => {
  it('puts the 7-frame windup on the N1 that restarts a written string', () => {
    const sim = run('Nicole N4 W1')
    // N1 10, N2 18+8, N3 40+38, then N1 again 92 + 10 + 7
    expect(sim.hits.filter((h) => h.tag === 'normal').map((h) => h.t)).toEqual([
      10, 26, 78, 109,
    ])
  })

  it('C4: an upgrade grants Pathfinder for 8 of the member’s hits, including the one that upgraded her', () => {
    const sim = run('Nicole E N3 N3 N3 W1', 4)
    const pathfinder = sim.countedBuffs.find(
      (b) => b.path[1] === 'c4Pathfinder'
    )!
    const covered = [...pathfinder.hits].map((i) => sim.hits[i])
    expect(covered).toHaveLength(8)
    expect(covered[0].label).toBe('Revelation: Uncreated Light')
    expect(covered.every((h) => h.characterKey === 'Nicole')).toBe(true)
  })

  it('C6: her upgrade gives every member A1’s Guidance at once, for the rest of the skill’s buff', () => {
    const guidance = (sim: ReturnType<typeof run>) =>
      sim.buffWindows.filter(
        (w) => w.path.join('.') === 'Nicole.a1GuidanceActive' && w.value
      )
    const skill = (sim: ReturnType<typeof run>) =>
      sim.hits.find((h) => h.label === 'Revelation: Uncreated Light')!
    const c6 = run('Nicole E -> Bennett N1 W4', 6)
    const [window] = guidance(c6)
    expect(window.start).toBe(skill(c6).t)
    expect(window.end).toBe(1208)
    // before C6, a member who is not Hexerei waits 3 s on the field for it
    const c5 = run('Nicole E -> Bennett N1 W4', 5)
    expect(guidance(c5)[0].start).toBeGreaterThan(skill(c5).t + 180)
  })
})
