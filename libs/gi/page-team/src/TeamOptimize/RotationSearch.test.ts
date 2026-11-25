import type { RotationCandidate } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { betterRotationCandidates } from './RotationSearch'

const candidate = (
  text: string,
  dps: number,
  estimate = dps
): RotationCandidate => ({
  text,
  dps,
  estimate,
  time: 20,
  er: {},
  warnings: [],
})

describe('betterRotationCandidates', () => {
  const seed = candidate('seed', 690_000)

  it('drops failed confirmations (null) and confirmed rotations below runDps in quick mode', () => {
    const top = [
      candidate('failed-er', 710_000),
      candidate('confirmed-lower', 705_000),
      candidate('confirmed-higher', 700_000),
      candidate('unconfirmed-better', 698_000),
    ]
    const shown = betterRotationCandidates({
      top,
      rowSeed: seed,
      confirmed: {
        'failed-er': null,
        'confirmed-lower': 687_424,
        'confirmed-higher': 702_000,
      },
      fullDone: false,
      runDps: 693_779,
    })

    expect(shown.map((c) => c.text)).toEqual([
      'confirmed-higher',
      'unconfirmed-better',
    ])
  })

  it('drops failed confirmations (null) even when a full search stops early', () => {
    const top = [
      candidate('failed-er', 715_000),
      candidate('confirmed-winner', 700_000),
      candidate('unconfirmed-next', 699_000),
    ]
    const shown = betterRotationCandidates({
      top,
      rowSeed: seed,
      from: seed,
      confirmed: {
        'failed-er': null,
        'confirmed-winner': 701_000,
      },
      fullDone: true,
      ended: 'time',
      runDps: 693_779,
    })

    expect(shown.map((c) => c.text)).toEqual([
      'confirmed-winner',
      'unconfirmed-next',
    ])
  })

  it('keeps only confirmed winners when a full search converges', () => {
    const top = [
      candidate('confirmed-winner-b', 700_000),
      candidate('confirmed-winner-a', 699_000),
      candidate('unconfirmed-high', 720_000),
    ]
    const shown = betterRotationCandidates({
      top,
      rowSeed: seed,
      from: seed,
      confirmed: {
        'confirmed-winner-b': 698_000,
        'confirmed-winner-a': 705_000,
      },
      fullDone: true,
      ended: 'converged',
      runDps: 693_779,
    })

    expect(shown.map((c) => c.text)).toEqual([
      'confirmed-winner-a',
      'confirmed-winner-b',
    ])
  })
})
