import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  lastRotation,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { SimHit } from '../util/teamOpt/rotation/types'

const run = (
  text: string,
  cons = 0,
  members: CharacterKey[] = ['Varesa'],
  extra?: Partial<Parameters<typeof simulateRotation>[0]>
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: { Varesa: cons },
    repeats: 1,
    keep: 'all',
    ...extra,
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

describe('Varesa: Rush charge queue, cooldown reduction, and Fiery Passion exit', () => {
  it('uses Cooldowns charge queue so 6 Es spend 3 paid charges (9 s each, 27 s steady state)', () => {
    // Rot 1 starts with 2 full charges: E1 (0.00 s) paid, E2 free, E3 (4.00 s) paid, E4 free,
    // E5 waits 1.00 s until E1's 9 s charge returns at 9.00 s, E6 free.
    const r1 = run('Varesa E CA P E CA P Q E CA P E CA P Q E CA P E CA P Q')
    const r1Es = r1.actions.filter(
      (a) => a.characterKey === 'Varesa' && a.text === 'E'
    )
    expect(r1Es).toHaveLength(6)
    expect(r1Es[4].start - r1Es[0].start).toBe(540)
    expect(r1.stalls?.['Varesa E']).toBe(60)
    expect(r1.warnings).toEqual([])

    // Steady state: 3 paid charges per loop = 27.0 s minimum rotation length
    const steady = lastRotation(
      run(
        'Iansan E Q -> Varesa E CA P E CA P Q E CA P E CA P Q E CA P E CA P Q -> Iansan',
        0,
        ['Varesa', 'Iansan'],
        { repeats: 4, keep: 'last2' }
      )
    )
    expect(steady.frames).toBe(27 * 60)
    expect(steady.warnings).toEqual([])
  })

  it('applies Anemo resonance (-5% CD) to Rush charges without failing or skipping E', () => {
    const sim = run(
      'Varesa E CA P E CA P Q E CA P E CA P Q E CA P E CA P Q',
      0,
      ['Varesa', 'Xianyun', 'Faruzan']
    )
    const es = sim.actions.filter(
      (a) => a.characterKey === 'Varesa' && a.text === 'E'
    )
    expect(es).toHaveLength(6)
    // 540 * 0.95 = 513 frames (8.55 s) for charge #1 to return
    expect(es[4].start - es[0].start).toBe(513)
    expect(sim.stalls?.['Varesa E']).toBe(33)
    expect(sim.warnings).toEqual([])
  })

  it('applies 4pc Thundering Fury (-1 s CD) to running Rush charges right from the first paid E', () => {
    const sim = run(
      'Bennett Q -> Varesa E CA P E CA P Q E CA P E CA P Q E CA P E CA P Q',
      0,
      ['Varesa', 'Bennett'],
      {
        gear: { Varesa: { sets: { ThunderingFury: 4 } } },
      }
    )
    const es = sim.actions.filter(
      (a) => a.characterKey === 'Varesa' && a.text === 'E'
    )
    expect(es).toHaveLength(6)
    // Overloaded procs shorten the 9 s charge timer so E5 fires at 8.00 s with zero stall
    expect(es[4].start - es[0].start).toBeLessThan(540)
    expect(sim.stalls?.['Varesa E'] ?? 0).toBe(0)
    expect(sim.warnings).toEqual([])
  })

  it('waits for a Rush charge instead of failing when exitNS ends an unused free Rush before E', () => {
    // E1 (paid), E2 (paid -> 0 charges), Q enters Fiery Passion (freeSkill = true),
    // CA P spends Nightsoul points (exitNS = true, freeSkill still unused),
    // next E exits Fiery Passion first so it must wait for E1's 9 s charge instead of failing.
    const sim = run('Varesa E E Q CA P E')
    const es = sim.actions.filter(
      (a) => a.characterKey === 'Varesa' && a.text === 'E'
    )
    expect(es).toHaveLength(3)
    expect(es[2].start - es[0].start).toBe(540)
    expect(sim.warnings).toEqual([])
  })

  it('exits Fiery Passion on swap-out after a Fiery Passion plunge, but keeps it when points remain', () => {
    // After Fiery Passion plunge (exitNS = true) -> swap out -> Apex Drive expires -> Q is base Flying Kick
    const afterFiery = run(
      'Varesa E CA P E CA P -> Bennett E W3 -> Varesa Q',
      0,
      ['Varesa', 'Bennett']
    )
    const kicks = afterFiery.hits.filter(
      (h) => h.characterKey === 'Varesa' && h.tag === 'burst'
    )
    expect(kicks.map((h) => h.label)).toEqual(['Flying Kick'])

    // After normal plunge filling Nightsoul (exitNS = false) -> swap out -> swap back -> E is free Fiery Passion Rush
    const carried = run('Varesa E CA P -> Bennett E -> Varesa E CA P', 0, [
      'Varesa',
      'Bennett',
    ])
    const carriedEs = carried.actions.filter(
      (a) => a.characterKey === 'Varesa' && a.text === 'E'
    )
    expect(carriedEs.map((a) => a.variant?.key ?? 'base')).toEqual([
      'base',
      'fiery',
    ])
  })
})
