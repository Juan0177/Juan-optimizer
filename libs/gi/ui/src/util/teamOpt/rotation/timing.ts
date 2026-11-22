import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ParsedRotation } from './parse'
import { FPS } from './types'

/** A frame edit, kept only while the action at that position is still the same one */
export interface TimingEdit {
  characterKey: CharacterKey
  text: string
  frames: number
}
export interface RotationTimingSettings {
  /** By the action's position in the written rotation */
  edits: Record<number, TimingEdit>
  /** Frames from pressing swap to the next member acting (undefined: the default 12) */
  swapFrames?: number
  /** The ping typed in, which set `swapFrames` (shown as typed; otherwise from the swap time) */
  pingMs?: number
  /**
   * Rotations counted from the start, nothing waited for from before (a timed challenge's first
   * rotations): 1 to 6. Undefined (or 0): the steady pace, the last STEADY_COUNTED of
   * STEADY_REPEATS played in a row (by then each waits for what the one before left on cooldown)
   */
  rotations?: number
  /**
   * Counted from the start, the opener is the first rotation, counted. Undefined: a setup played
   * before the start, not counted (what it leaves carries into the rotations)
   */
  countOpener?: boolean
}
/** The choices for `RotationTimingSettings.rotations` counted from the start */
export const FIRST_ROTATIONS = [1, 2, 3, 4, 5, 6] as const
/** The steady pace, the default: 4 rotations played in a row, the last 2 counted (averaged) */
export const STEADY_REPEATS = 4
export const STEADY_COUNTED = 2
/** The steady pace's rotations counted, as its label names them ("Steady DPS (rot 3–4)") */
export const STEADY_RANGE = {
  from: STEADY_REPEATS - STEADY_COUNTED + 1,
  to: STEADY_REPEATS,
}
/** The rotations a team's timing counts from the start (undefined: the steady pace) */
export const firstRotations = (timing: RotationTimingSettings) =>
  timing.rotations && timing.rotations > 0
    ? Math.min(FIRST_ROTATIONS.length, Math.round(timing.rotations))
    : undefined
/** Whether a written opener is counted: as the first rotation, counted from the start */
export const openerCounted = (timing: RotationTimingSettings) =>
  firstRotations(timing) !== undefined && !!timing.countOpener
/** KQM's standard swap: 12 frames, about 100 ms of ping */
export const DEFAULT_SWAP_FRAMES = 12
/**
 * A swap waits on the server (a round trip), so ping sets the swap time; other actions are not
 * delayed by it. gcsim's rule: frames = ping ms × 2 × 60 / 1000 (100 ms ≈ 12 frames)
 */
export const pingToSwapFrames = (ms: number) =>
  Math.round((ms * 2 * FPS) / 1000)
export const swapFramesToPing = (frames: number) =>
  Math.round((frames * 1000) / (2 * FPS))
/** The ping a team's timing shows: as typed, or the swap time's */
export const timingPing = (timing: RotationTimingSettings) =>
  timing.pingMs ?? swapFramesToPing(timing.swapFrames ?? DEFAULT_SWAP_FRAMES)
/** Timing with a typed ping: the swap time it gives (KQM's 12 frames: no edit) */
export function withPing(
  timing: RotationTimingSettings,
  ms: number
): RotationTimingSettings {
  const frames = pingToSwapFrames(ms)
  const { swapFrames: _s, pingMs: _p, ...rest } = timing
  return frames === DEFAULT_SWAP_FRAMES
    ? rest
    : { ...rest, swapFrames: frames, pingMs: ms }
}
/** Timing with a typed swap time (the ping then follows it) */
export function withSwapFrames(
  timing: RotationTimingSettings,
  frames: number
): RotationTimingSettings {
  const { swapFrames: _s, pingMs: _p, ...rest } = timing
  return frames === DEFAULT_SWAP_FRAMES ? rest : { ...rest, swapFrames: frames }
}

/** The written actions in order (the simulator's action positions) */
export function flatActions(rotation: ParsedRotation) {
  return rotation.steps.flatMap((step) =>
    step.actions.map((action) => ({
      characterKey: step.characterKey,
      action,
    }))
  )
}

/** The opener's actions in order (the simulator's `openerIndex` positions) */
export const openerActions = (rotation: ParsedRotation) =>
  flatActions({ ...rotation, steps: rotation.opener ?? [] })

/** The edits that still match the written rotation, as the simulator's overrides */
export function frameOverrides(
  rotation: ParsedRotation,
  edits: Record<number, TimingEdit>
): Record<number, number> {
  const flat = flatActions(rotation)
  const out: Record<number, number> = {}
  for (const [i, e] of Object.entries(edits)) {
    const f = flat[Number(i)]
    if (f && f.characterKey === e.characterKey && f.action.text === e.text)
      out[Number(i)] = e.frames
  }
  return out
}

export const seconds = (frames: number) => (frames / FPS).toFixed(2)
