import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allCharacterKeys } from '@genshin-optimizer/gi/consts'
import type {
  SimBuffOwner,
  SimHit,
  SimulationResult,
} from '@genshin-optimizer/gi/ui'
import type { BuffEffect } from './buffs'

/** One stretch of a track: its value from `start` to `end` (frames) */
export interface TrackSegment {
  start: number
  end: number
  value: string
}

/**
 * A conditional the simulation follows over the rotation: a resource or stack count (`steps`: its
 * values are numbers), or a buff that is on or in a named state (`ribbon`)
 */
export interface TimelineTrack {
  key: string
  owner: SimBuffOwner
  path: string[]
  kind: 'steps' | 'ribbon'
  /** Where it belongs: a member's own kit, the team's (reactions), or a weapon's or set's */
  group: 'kit' | 'team' | 'gear'
  segments: TrackSegment[]
  /** The highest value of a `steps` track */
  max: number
  /** On for the whole rotation by the member's own setting (the simulation does not time it) */
  constant?: boolean
}

const CHARACTERS: ReadonlySet<string> = new Set(allCharacterKeys)
const refKey = (b: { owner: string; path: string[] }) =>
  `${b.owner}|${b.path.join('.')}`
const isNumber = (value: string) => value !== '' && Number.isFinite(+value)

/**
 * The simulation's buff windows as tracks over the kept rotation: per conditional, its value at
 * every moment (stacking windows as their count, otherwise the latest window's state), clipped to
 * the rotation. Conditionals that are never on in it are left out.
 */
export function timelineTracks(sim: SimulationResult): TimelineTrack[] {
  const from = sim.start
  const to = sim.start + sim.frames
  const byRef = new Map<string, SimulationResult['buffWindows']>()
  for (const w of sim.buffWindows) {
    if (w.path[1]?.startsWith('_') || w.end <= w.start) continue
    if (w.end <= from || w.start >= to || !w.value) continue
    const key = refKey(w)
    const list = byRef.get(key)
    if (list) list.push(w)
    else byRef.set(key, [w])
  }
  const tracks: TimelineTrack[] = []
  for (const [key, windows] of byRef) {
    const { owner, path } = windows[0]
    const stacking =
      windows.every((w) => w.value === '1') &&
      (!!path[1]?.toLowerCase().includes('stack') ||
        windows.some((w) => w.max !== undefined))
    const cap = Math.max(...windows.map((w) => w.max ?? 3))
    const bounds = [
      ...new Set(
        windows.flatMap((w) => [Math.max(from, w.start), Math.min(to, w.end)])
      ),
    ].sort((a, b) => a - b)
    const segments: TrackSegment[] = []
    for (let i = 0; i + 1 < bounds.length; i++) {
      const start = bounds[i]
      const end = bounds[i + 1]
      const on = windows.filter((w) => w.start <= start && start < w.end)
      if (!on.length) continue
      const value = stacking
        ? `${Math.min(cap, on.length)}`
        : on.reduce((latest, w) => (w.start >= latest.start ? w : latest)).value
      const last = segments[segments.length - 1]
      if (last && last.end === start && last.value === value) last.end = end
      else segments.push({ start, end, value })
    }
    if (!segments.length) continue
    const steps = segments.every((s) => isNumber(s.value))
    tracks.push({
      key,
      owner,
      path,
      kind: steps ? 'steps' : 'ribbon',
      group:
        owner === 'team' ? 'team' : CHARACTERS.has(path[0]) ? 'kit' : 'gear',
      segments,
      max: steps ? Math.max(1, ...segments.map((s) => +s.value)) : 1,
    })
  }
  return tracks
}

/** A buff's key among a moment's effects: its owner, its conditional and its state */
export const momentBuffKey = (buff: {
  owner: string
  path: readonly string[]
  value: string
}) => `${buff.owner}|${buff.path.join('.')}|${buff.value}`

/** What each buff up at a moment gives, by `momentBuffKey` */
export type MomentEffects = ReadonlyMap<string, BuffEffect[]>

/** A track's value at a frame ('' when it is off) */
export const trackValueAt = (track: TimelineTrack, frame: number) =>
  track.segments.find((s) => s.start <= frame && frame < s.end)?.value ?? ''

/** The element an aura shows as (the reaction auras by their own name) */
export const AURA_ORDER = [
  'pyro',
  'hydro',
  'electro',
  'cryo',
  'dendro',
  'quicken',
  'frozen',
  'burning',
] as const
export type AuraKey = (typeof AURA_ORDER)[number]

/** Each aura's stretches over the kept rotation (from `SimulationResult.auras`) */
export function auraLanes(
  sim: SimulationResult
): { aura: AuraKey; segments: { start: number; end: number }[] }[] {
  const log = sim.auras
  if (!log?.length) return []
  const end = sim.start + sim.frames
  const lanes = new Map<AuraKey, { start: number; end: number }[]>()
  log.forEach((entry, i) => {
    const until = log[i + 1]?.t ?? end
    for (const aura of AURA_ORDER) {
      if (!(aura in entry.auras)) continue
      const list = lanes.get(aura) ?? []
      const last = list[list.length - 1]
      if (last && last.end === entry.t) last.end = until
      else list.push({ start: entry.t, end: until })
      lanes.set(aura, list)
    }
  })
  return AURA_ORDER.flatMap((aura) => {
    const segments = lanes.get(aura)
    return segments ? [{ aura, segments }] : []
  })
}

/** The auras on the enemy at a frame */
export function aurasAt(sim: SimulationResult, frame: number): AuraKey[] {
  const log = sim.auras
  if (!log?.length) return []
  let entry = log[0]
  for (const e of log) {
    if (e.t > frame) break
    entry = e
  }
  return AURA_ORDER.filter((aura) => aura in entry.auras)
}

/** Who is on the field at a frame: the member the latest action or swap before it belongs to */
export function onFieldAt(
  sim: SimulationResult,
  frame: number
): CharacterKey | undefined {
  let found: { t: number; characterKey: CharacterKey } | undefined
  for (const a of sim.actions)
    if (a.start <= frame && (!found || a.start >= found.t))
      found = { t: a.start, characterKey: a.characterKey }
  for (const w of sim.swaps ?? []) {
    const at = w.start + w.frames
    if (at <= frame && (!found || at >= found.t))
      found = { t: at, characterKey: w.to }
  }
  return found?.characterKey ?? sim.actions[0]?.characterKey
}

/** The rotation's damaging hits (no markers), in time order */
export const damagingHits = (sim: SimulationResult): SimHit[] =>
  sim.hits.filter(
    (h) =>
      !h.path[0]?.startsWith('_') &&
      h.t >= sim.start &&
      h.t <= sim.start + sim.frames
  )
