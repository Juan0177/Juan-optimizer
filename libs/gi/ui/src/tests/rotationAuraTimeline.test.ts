import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (text: string, members: CharacterKey[], auraTimeline = true) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: {},
    repeats: 1,
    auraTimeline,
  })

describe('the enemy’s auras over time', () => {
  it('records each aura from when it is applied until it runs out', () => {
    const sim = run('Kaeya E W15', ['Kaeya'])
    const auras = sim.auras!
    expect(auras[0]).toEqual({ t: sim.start, auras: {} })
    const on = auras.find((a) => 'cryo' in a.auras)!
    const hit = sim.hits.find((h) => h.element === 'cryo' && h.applies)!
    // (from the hit that applied it, within a frame)
    expect(Math.abs(on.t - hit.t)).toBeLessThanOrEqual(1)
    const off = auras.find((a) => a.t > on.t && !('cryo' in a.auras))!
    // its durability d lasts 6·d + 420 frames from the application (2U: 12 s)
    const length = 6 * (hit.durability ?? 25) + 420
    expect(Math.abs(off.t - hit.t - length)).toBeLessThanOrEqual(2)
  })
  it('shows a reaction’s aura (Frozen), and is absent unless asked for', () => {
    const sim = run('Mona E -> Kaeya E W3', ['Mona', 'Kaeya'])
    expect(sim.auras!.some((a) => 'frozen' in a.auras)).toBe(true)
    expect(run('Kaeya E', ['Kaeya'], false).auras).toBeUndefined()
  })
})
