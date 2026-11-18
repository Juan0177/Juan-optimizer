import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { SimHit } from '../util/teamOpt/rotation/types'

const run = (text: string, cons = 0, members: CharacterKey[] = ['Varesa']) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Varesa: 'electro', Bennett: 'pyro' },
    constellations: { Varesa: cons },
    repeats: 1,
    keep: 'all',
  })

const pinned = (hit: SimHit, cond: string) =>
  hit.states?.find((s) => s.path.join('.') === `Varesa.${cond}`)?.value

describe('Varesa', () => {
  it('turns a normal attack after the Rush into the quick Follow-Up Strike', () => {
    const sim = run('Varesa E N1 W2')
    // the Rush's hit pauses her 4 frames (defense halt): E -> N1 is 22 + 4
    expect(sim.actions[1].start - sim.actions[0].start).toBe(26)
    const hits = sim.hits.filter((h) => h.characterKey === 'Varesa')
    expect(hits.some((h) => /^N\d/.test(h.label))).toBe(false)
    const strike = hits.find((h) => h.label.includes('Follow-Up Strike'))!
    expect(strike.path.join('.')).toBe('charged.dmg')
    expect(strike.t - sim.actions[1].start).toBe(11)
  })

  it('spends Rainbow Crash on the first plunge impact and picks the high plunge after a CA', () => {
    // the Rush's 20 points and the first plunge's 25 fill the gauge: the second is Fiery Passion
    const sim = run('Varesa E N1 P CA P W2')
    const all = sim.hits.filter(
      (h) => h.characterKey === 'Varesa' && h.tag === 'plunge'
    )
    const plunges = all.filter((h) => h.label !== 'Plunge Collision')
    expect(plunges.map((h) => h.path.join('.'))).toEqual([
      'plunging.high',
      'plunging.fphigh',
    ])
    expect(plunges.map((h) => pinned(h, 'a1Rainbow'))).toEqual(['on', ''])
    // (each with its falling hit, as KQM's sims play it: Plunge DMG, no Electro applied)
    const collisions = all.filter((h) => h.label === 'Plunge Collision')
    expect(collisions.map((h) => h.path.join('.'))).toEqual([
      'plunging.dmg',
      'plunging.dmg',
    ])
    expect(collisions.every((h) => !h.applies)).toBe(true)
  })

  it('gives C4’s Diligent Refinement to the next plunge and +100% only to bursts in Fiery Passion or Apex Drive', () => {
    const sim = run('Varesa Q CA P Q W2', 4)
    const hits = sim.hits.filter((h) => h.characterKey === 'Varesa')
    const kick = hits.find((h) => h.label === 'Flying Kick')!
    expect(pinned(kick, 'c4FpApex')).toBe('')
    const plunge = hits.find((h) => h.label === 'Fiery Passion High Plunge')!
    expect(pinned(plunge, 'c4Diligent')).toBe('on')
    const kablam = hits.find((h) => h.label === 'Volcanic Kablam')!
    expect(pinned(kablam, 'c4Diligent')).toBe('')
    expect(pinned(kablam, 'c4FpApex')).toBe('on')
  })
})

describe('Varesa: notes that explain her Kablam and her Rush charges (a player report)', () => {
  const notes = (text: string) => run(text).notes.join(' ')
  it('says nothing when the Q after a Fiery Passion plunge is the Kablam', () => {
    const sim = run('Varesa E CA P E CA P Q')
    expect(sim.actions.at(-1)?.variant?.label).toBe('Volcanic Kablam')
    expect(sim.notes.join(' ')).not.toMatch(/Flying Kick|Rush charge/)
  })
  it('says a Rush after the plunge ended Apex Drive, when the Q is a full Flying Kick', () => {
    const sim = run('Varesa E CA P E CA P E Q')
    expect(sim.actions.at(-1)?.variant).toBeUndefined()
    expect(sim.notes.join(' ')).toContain(
      'a Rush after her Fiery Passion plunge ended Apex Drive'
    )
  })
  it("says Apex Drive's 2.3 s ran out, when the Q comes too late", () => {
    expect(notes('Varesa E CA P E CA P W3 Q')).toContain(
      'Apex Drive lasts 2.3 s'
    )
  })
  it('explains a Q that waits for the Flying Kick, and an E that waits for a charge', () => {
    expect(notes('Varesa Q W1 Q')).toContain(
      "waited for the Flying Kick's 18 s cooldown"
    )
    expect(notes('Varesa E E E')).toContain('waited for a Rush charge')
  })
})
