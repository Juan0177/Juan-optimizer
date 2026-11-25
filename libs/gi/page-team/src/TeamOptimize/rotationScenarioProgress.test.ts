import type { TeamOptStep } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { createTeamProgressTracker } from './rotationScenarioRun'

const names = [
  { characterKey: 'Varesa' as const, name: 'Varesa' },
  { characterKey: 'Mavuika' as const, name: 'Mavuika' },
  { characterKey: 'Iansan' as const, name: 'Iansan' },
  { characterKey: 'Chevreuse' as const, name: 'Chevreuse' },
]

describe('createTeamProgressTracker', () => {
  it('advances monotonically across multi-weapon steps, ER checks, mid-run repairs, extra rounds, exchanges, and fallback passes', () => {
    const tracker = createTeamProgressTracker(names)
    const fractions: number[] = []
    const record = (out: { fraction: number; detail: string }) => {
      fractions.push(out.fraction)
      return out
    }

    // Initial poll before any step
    record(tracker.onPoll(0, Number.NaN))

    // Round 1, Member 1: 5 weapons (including weapon 1 -> weapon 2 transition)
    const r1m1: TeamOptStep = {
      round: 1,
      maxRounds: 4,
      step: 1,
      steps: 4,
      characterKey: 'Varesa',
    }
    record(tracker.onStep(r1m1))
    for (let w = 1; w <= 5; w++) {
      record(tracker.onStep({ ...r1m1, weapon: w, weapons: 5 }))
      record(tracker.onPoll(50, 100))
      record(tracker.onPoll(100, 100))
    }

    // Round 1, Member 2: 3 weapons, weapon 2 triggers energy-weapon re-opt for 2 teammates
    const r1m2: TeamOptStep = {
      round: 1,
      maxRounds: 4,
      step: 2,
      steps: 4,
      characterKey: 'Mavuika',
    }
    record(tracker.onStep(r1m2))
    record(tracker.onStep({ ...r1m2, weapon: 1, weapons: 3 }))
    record(tracker.onPoll(100, 100))
    // Weapon 2: wielder + 2 affected teammates (repeated onStep on same weapon slot)
    record(tracker.onStep({ ...r1m2, weapon: 2, weapons: 3 }))
    record(tracker.onPoll(80, 100))
    record(
      tracker.onStep({ ...r1m2, weapon: 2, weapons: 3, energyFor: 'Iansan' })
    )
    record(tracker.onPoll(0, 100))
    record(tracker.onPoll(100, 100))
    record(
      tracker.onStep({
        ...r1m2,
        weapon: 2,
        weapons: 3,
        energyFor: 'Chevreuse',
      })
    )
    record(tracker.onPoll(50, 100))
    record(tracker.onPoll(100, 100))
    record(tracker.onStep({ ...r1m2, weapon: 3, weapons: 3 }))
    record(tracker.onPoll(100, 100))

    // Round 1, Members 3 & 4
    record(
      tracker.onStep({
        round: 1,
        maxRounds: 4,
        step: 3,
        steps: 4,
        characterKey: 'Iansan',
      })
    )
    record(tracker.onPoll(100, 100))
    record(
      tracker.onStep({
        round: 1,
        maxRounds: 4,
        step: 4,
        steps: 4,
        characterKey: 'Chevreuse',
      })
    )
    record(tracker.onPoll(100, 100))

    // Mid-run repairIn (exchange: true at end of Round 1) must NOT jump straight to 88%
    const repairStart = record(
      tracker.onStep({
        round: 1,
        maxRounds: 4,
        step: 3,
        steps: 4,
        characterKey: 'Iansan',
        exchange: true,
      })
    )
    expect(repairStart.fraction).toBeLessThan(0.75)
    record(tracker.onPoll(100, 100))
    // Second internal solve() resets counters back to 0 within same repair step
    record(tracker.onPoll(0, 100))
    record(tracker.onPoll(100, 100))

    // Round 2 & expanded Round 3 & Round 4
    for (const round of [2, 3, 4]) {
      const beforeRound = fractions.at(-1)!
      for (const [idx, ck] of (
        ['Varesa', 'Mavuika', 'Iansan', 'Chevreuse'] as const
      ).entries()) {
        record(
          tracker.onStep({
            round,
            maxRounds: 4,
            step: idx + 1,
            steps: 4,
            characterKey: ck,
          })
        )
        record(tracker.onPoll(50, 100))
        record(tracker.onPoll(100, 100))
      }
      // Every round still moves progress strictly forward (never pinned)
      expect(fractions.at(-1)!).toBeGreaterThan(beforeRound)
    }

    // End-of-run exchangeIn across all 4 members must glide steadily (no 88%->96%->88% sawtooth)
    const exBefore = fractions.at(-1)!
    for (const [idx, ck] of (
      ['Varesa', 'Mavuika', 'Iansan', 'Chevreuse'] as const
    ).entries()) {
      record(
        tracker.onStep({
          round: 4,
          maxRounds: 4,
          step: idx + 1,
          steps: 4,
          characterKey: ck,
          exchange: true,
        })
      )
      record(tracker.onPoll(50, 100))
      record(tracker.onPoll(100, 100))
    }
    expect(fractions.at(-1)!).toBeGreaterThan(exBefore)

    // Fallback non-provisional runRounds() restarting at round 1 must not regress
    const fallbackBefore = fractions.at(-1)!
    record(
      tracker.onStep({
        round: 1,
        maxRounds: 4,
        step: 1,
        steps: 4,
        characterKey: 'Varesa',
      })
    )
    record(tracker.onPoll(100, 100))
    expect(fractions.at(-1)!).toBeGreaterThanOrEqual(fallbackBefore)

    // Strict monotonicity and bounds across the entire trace
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1])
      expect(fractions[i]).toBeLessThanOrEqual(0.97)
    }
  })

  it('never shows stale 100% detail text on step transition before the new solve starts', () => {
    const tracker = createTeamProgressTracker(names)
    tracker.onStep({
      round: 1,
      maxRounds: 2,
      step: 1,
      steps: 2,
      characterKey: 'Varesa',
    })
    const done1 = tracker.onPoll(500, 500)
    expect(done1.detail).toContain('100%')

    // Transition to Member 2: onStep ignores any previous solver counters
    const start2 = tracker.onStep({
      round: 1,
      maxRounds: 2,
      step: 2,
      steps: 2,
      characterKey: 'Mavuika',
    })
    expect(start2.detail).toBe('Round 1 · Mavuika')
    expect(start2.fraction).toBeGreaterThanOrEqual(done1.fraction)
  })
})
