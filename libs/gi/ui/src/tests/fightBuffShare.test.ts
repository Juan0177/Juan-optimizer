/** The Moongecko's Disentangled, averaged over the fight's damage time for ranking builds */
import { describe, expect, it } from 'vitest'
import type { FightEstimate } from '../components/enemy/stygianFights'
import { fightBuffShare } from '../components/enemy/stygianFights'

const seg = (start: number, end: number, state: string, dps: number) =>
  ({
    start,
    end,
    state,
    dps,
    hpStart: 1,
    hpEnd: 1,
    meterStart: 0,
    meterEnd: 0,
  }) as never

describe('fightBuffShare', () => {
  it('averages Disentangled over the damage time (no leaps, no cocoon)', () => {
    const estimate = {
      seconds: 60,
      parts: [],
      notes: [],
      timeline: {
        segments: [
          seg(0, 2, 'leap', 0),
          seg(2, 17, 'ward', 300),
          seg(17, 20, 'cocooned', 50),
          seg(20, 35, 'disentangled', 350),
          seg(35, 50, 'dullCarapace', 300),
        ],
        events: [],
      },
    } as unknown as FightEstimate
    const result = fightBuffShare(estimate)!
    expect(result.share).toBeCloseTo(15 / 45)
    expect(result.bonus.critRate_).toBeCloseTo(5)
    expect(result.bonus.all_dmg_).toBeCloseTo(50 / 3)
  })
  it('is nothing without Disentangled', () => {
    expect(
      fightBuffShare({
        timeline: { segments: [seg(0, 10, 'dullCarapace', 1)], events: [] },
      } as unknown as FightEstimate)
    ).toBeUndefined()
  })
})
