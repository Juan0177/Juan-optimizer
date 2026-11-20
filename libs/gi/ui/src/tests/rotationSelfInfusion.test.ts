import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { HitElement, KitModel } from '../util/teamOpt/rotation/types'

const seen: [number, HitElement | undefined, HitElement | undefined][] = []
const infuser: KitModel = {
  characterKey: 'Bennett',
  element: 'pyro',
  source: 'test',
  act(ctx, _s, action) {
    if (action.kind === 'burst') ctx.selfInfuse('pyro', 25, 126)
    return { frames: 10 }
  },
}
const absorber: KitModel = {
  characterKey: 'Sucrose',
  element: 'anemo',
  source: 'test',
  act(ctx, _s, action) {
    if (action.kind === 'skill')
      seen.push([
        ctx.now,
        ctx.absorb(),
        ctx.absorb(undefined, { player: true }),
      ])
    return { frames: 10 }
  },
}

function run(text: string) {
  seen.length = 0
  const members: CharacterKey[] = ['Bennett', 'Sucrose']
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Bennett: 'pyro', Sucrose: 'anemo' },
    repeats: 1,
    kits: { Bennett: infuser, Sucrose: absorber },
    reactions: { onHit() {} },
  })
  return seen.map(([t, enemy, player]) => [t, enemy ?? '', player ?? ''])
}

describe('the player’s own aura (gcsim’s ApplySelfInfusion)', () => {
  it('an absorb covering the player picks it up while it lasts; the enemy-only one does not', () => {
    // (Bennett's Q at 0: 25 units over 126 frames; the swap takes the Skill to 11 here)
    const at = run('Bennett Q Sucrose E W2 E')
    expect(at[0][1]).toBe('')
    expect(at[0][2]).toBe('pyro')
    const late = run('Bennett Q Sucrose W3 E')
    expect(late[0][0]).toBeGreaterThan(126)
    expect(late[0][2]).toBe('')
  })

  it('a refill before it runs out tops it up at the same rate', () => {
    const at = run('Bennett Q W1.5 Q Sucrose W1.5 E')
    // (the refill at 100 lasts to about 226)
    expect(at[0][0]).toBeGreaterThan(126)
    expect(at[0][0]).toBeLessThan(226)
    expect(at[0][2]).toBe('pyro')
  })
})
