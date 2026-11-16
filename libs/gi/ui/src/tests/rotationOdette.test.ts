import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

describe('Odette character-clock effects', () => {
  const members: CharacterKey[] = ['Odette', 'Mitya']
  const run = (text: string, odette = kitModels.Odette!, mitya?: KitModel) =>
    simulateRotation({
      rotation: parseRotation(
        text,
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      elements: { Odette: 'cryo', Mitya: 'electro' },
      constellations: {},
      kits: { Odette: odette, Mitya: mitya ?? kitModels.Mitya },
      reactions: { onHit() {}, radianceAt: () => 'conduct' },
      repeats: 1,
      keep: 'all',
    })

  it('includes Coda final hitlag in its recovery without delaying its world-time DoT', () => {
    const sim = run('Odette E E Q')
    expect(sim.actions.map((a) => a.start)).toEqual([0, 41, 120])
    expect(
      sim.hits
        .filter((h) => h.label === "Coda at Dawn's Tolling (DoT)")
        .map((h) => h.t)
    ).toEqual([52, 61, 69])
    expect(
      sim.hits.find((h) => h.label.includes('Tolling (Stellar-Conduct)'))?.t
    ).toBe(103)
  })

  // Snow Swan's Dream starts with the Burst, not at the final slash (gcsim): the dump's
  // Avatar_Odette_ElementalBurst grants it (Odette_FinalAct) in Burst_Triggerability, on entering
  // the ElementalBurst state, the same step that starts the CD and summons the Dance Double.
  it('pauses pending burst attacks; Snow Swan’s Dream starts at the cast (game dump)', () => {
    const odette: KitModel = {
      ...kitModels.Odette!,
      onStart(c) {
        c.hit(110, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 7,
          label: 'External pause',
        })
      },
    }
    const sim = run('Odette Q W3', odette)
    expect(
      sim.hits
        .filter((h) => h.label === 'Presto: Bluebird Finale (Slash)')
        .map((h) => h.t)
    ).toEqual([119, 135, 147])
    expect(
      sim.hits.find((h) => h.label === 'Presto: Bluebird Finale (Final)')?.t
    ).toBe(151)
    const buff = sim.buffWindows.find(
      (w) => w.path.join('.') === 'Odette.burst'
    )
    // 20 s on Odette's clock from the cast (the External pause at 110 extends it as it reads)
    expect(buff).toMatchObject({
      start: 1,
      end: 1201,
      hitlag: 'recipient',
      recipient: 'Odette',
    })
  })

  it('keeps the Coda’s Stellar moves until the Double leaves, also past 20 s after a Burst refresh', () => {
    // Coda at 41 (its final hit at 103); the Burst ~10 s later refreshes the Double for 21 s more.
    const sim = run('Odette E E W10 Q W25')
    const q = sim.actions.find((a) => a.text === 'Q')!.start
    const stellarMoves = sim.hits.filter((h) =>
      /^"(Plume|Wing)" Dance Move \(Stellar/.test(h.label)
    )
    const plainMoves = sim.hits.filter((h) =>
      /^"(Plume|Wing)" Dance Move$/.test(h.label)
    )
    // past the old 20 s limit (Coda final hit + 1200 frames), every move still has its Stellar hit
    const late = plainMoves.filter((h) => h.t > 103 + 1200)
    expect(late.length).toBeGreaterThan(2)
    for (const m of late)
      expect(stellarMoves.some((s) => s.t === m.t)).toBe(true)
    // and nothing after the refreshed Double leaves (summoned 1 frame into the Burst, 1262 frames)
    expect(Math.max(...plainMoves.map((h) => h.t))).toBeLessThan(q + 1 + 1262)
  })

  it('a Double summoned after the last one left has no Stellar moves until its own Coda', () => {
    // the first Double (23 + 1262 frames) is gone well before the second E; no Coda follows it
    const sim = run('Odette E E W25 E W8')
    const second = sim.actions[2].start
    const after = (re: RegExp) =>
      sim.hits.filter((h) => h.t > second && re.test(h.label))
    expect(after(/^"(Plume|Wing)" Dance Move$/).length).toBeGreaterThan(2)
    expect(after(/^"(Plume|Wing)" Dance Move \(Stellar/)).toHaveLength(0)
  })

  it('delays the first off-field Splendor transfer by Odette’s own normal hitlag', () => {
    const mitya: KitModel = {
      characterKey: 'Mitya',
      element: 'electro',
      source: 'test',
      act(c) {
        for (const t of [15, 19, 20])
          c.hit(t, {
            path: ['skill', 'probe'],
            tag: 'skill',
            element: 'electro',
            label: `Probe ${t}`,
          })
        return { frames: 100 }
      },
    }
    const sim = run('Odette E N1 -> Mitya E', kitModels.Odette!, mitya)
    expect(sim.actions[2].start).toBe(68)
    expect(
      rotationAttacks(sim).Mitya!.map(
        (a) => a.states?.find((s) => s.path[1] === 'a1TeamSplendor')?.value
      )
    ).toEqual(['0', '0', '1'])
  })
})
