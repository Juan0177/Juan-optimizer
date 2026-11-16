// @vitest-environment jsdom
/**
 * Ping in the rotation writer: a swap waits on the server (a round trip), so ping sets the swap
 * time (gcsim: frames = ping ms × 2 × 60 / 1000; KQM standard 12 frames ≈ 100 ms). Ping and swap
 * time are one setting shown two ways; other actions are not delayed by ping.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SWAP_FRAMES,
  pingToSwapFrames,
  swapFramesToPing,
  timingPing,
  withPing,
  withSwapFrames,
} from './RotationTiming'

describe('ping sets the swap time', () => {
  it('converts as gcsim does (a round trip)', () => {
    expect(pingToSwapFrames(100)).toBe(12)
    expect(pingToSwapFrames(30)).toBe(4)
    expect(pingToSwapFrames(200)).toBe(24)
    expect(swapFramesToPing(DEFAULT_SWAP_FRAMES)).toBe(100)
    expect(swapFramesToPing(8)).toBe(67)
  })
  it('keeps the ping typed in, and the swap time it gives', () => {
    const timing = withPing({ edits: {} }, 60)
    expect(timing.swapFrames).toBe(7)
    expect(timingPing(timing)).toBe(60)
  })
  it('a ping giving KQM’s 12 frames is no edit', () => {
    const timing = withPing({ edits: {}, swapFrames: 20, pingMs: 170 }, 100)
    expect(timing.swapFrames).toBeUndefined()
    expect(timing.pingMs).toBeUndefined()
    expect(timingPing(timing)).toBe(100)
  })
  it('a swap time typed in shows its own ping', () => {
    const timing = withSwapFrames({ edits: {}, swapFrames: 7, pingMs: 60 }, 24)
    expect(timing).toEqual({ edits: {}, swapFrames: 24 })
    expect(timingPing(timing)).toBe(200)
    expect(withSwapFrames(timing, DEFAULT_SWAP_FRAMES)).toEqual({ edits: {} })
  })
})
