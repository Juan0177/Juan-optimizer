// @vitest-environment jsdom
/**
 * The writer can count the first few rotations from the start instead of the repeating pace (a
 * Discord request: is skipping a Burst better in a timed challenge's first rotation?). With every
 * cooldown ready at the start, nothing waits; the time and hits are per rotation of those played;
 * KQM's replay counts the same rotations.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { teamOptMembers } from '@genshin-optimizer/gi/ui'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { firstRotations } from './RotationTiming'
import { kqmRotationReplay, simulateWritten } from './RotationWriter'

const MEMBERS: CharacterKey[] = ['Sucrose', 'Bennett']
// (two Skills a rotation: free the first time through, then each waits for a 15 s charge)
const TEXT = 'Sucrose E -> Bennett N1 N1 -> Sucrose E -> Bennett N1'

const stored = new Map<string, string>()
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, String(v)),
      removeItem: (k: string) => stored.delete(k),
      clear: () => stored.clear(),
      key: (i: number) => [...stored.keys()][i] ?? null,
      get length() {
        return stored.size
      },
    },
  })
})
afterAll(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
})

function setup() {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const key of MEMBERS)
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: key === 'Sucrose' ? 1 : 6,
    })
  const ids = MEMBERS.map((k) => database.teamChars.new(k))
  const teamId = database.teams.new({
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
  })
  const members = teamOptMembers(database, teamId)
  const names = members.map(({ characterKey }) => ({
    characterKey,
    name: characterKey,
  }))
  return { database, teamId, members, names }
}

describe('the first rotations from the start', () => {
  const { database, teamId, members, names } = setup()
  const play = (rotations?: number) =>
    simulateWritten({
      text: TEXT,
      opener: '',
      timing: { edits: {}, ...(rotations && { rotations }) },
      frameData: {},
      team: {
        members: MEMBERS,
        constellations: { Sucrose: 1, Bennett: 6 },
        elements: Object.fromEntries(
          MEMBERS.map((m) => [m, getCharEle(m)])
        ) as never,
        gear: {},
      },
      names,
      members,
      database: database as never,
      teamId,
      gender: 'F',
      openerWarning: (w) => w,
    })!
  it('plays the first rotation with every cooldown ready (nothing waits)', () => {
    const repeating = play()
    const first = play(1)
    const perRotation = (r: typeof first) =>
      r.counted!.sim.frames / r.counted!.rotations
    // (the repeating pace waits for the charges: about 30 s; the first rotation runs freely)
    expect(perRotation(repeating) / 60).toBeGreaterThan(25)
    expect(perRotation(first) / 60).toBeLessThan(10)
    expect(first.counted!.rotations).toBe(1)
    expect(Object.keys(first.counted!.sim.stalls ?? {})).toEqual([])
  })
  it('counts the hits per rotation of those played', () => {
    const one = play(1)
    const two = play(2)
    const hits = (r: typeof one) =>
      Object.values(r.attacks ?? {}).reduce(
        (n, a) => n + (a ?? []).reduce((m, x) => m + (x.hits ?? 1), 0),
        0
      )
    expect(two.counted!.rotations).toBe(2)
    // (the second rotation waits for a charge but deals the same hits)
    expect(hits(two)).toBeCloseTo(hits(one), 5)
    // the timeline shows all of them
    expect(two.sim!.rotationStarts!.length).toBe(2)
  })
  it('counts up to 6 rotations (more is read as 6)', () => {
    expect(play(6).counted!.rotations).toBe(6)
    expect(play(6).sim!.rotationStarts!.length).toBe(6)
    expect(firstRotations({ edits: {}, rotations: 9 })).toBe(6)
    expect(firstRotations({ edits: {} })).toBeUndefined()
  })
  it('KQM’s replay counts the same rotations', () => {
    localStorage.setItem(`teamOptRotationText_${teamId}`, TEXT)
    localStorage.setItem(
      `teamOptRotationTiming_${teamId}`,
      JSON.stringify({ edits: {}, rotations: 1 })
    )
    const replay = kqmRotationReplay({
      database: database as never,
      teamId,
      members,
      gender: 'F',
      names,
      teamOpt: initTeamOpt(),
    })!
    const played = replay({
      constellations: { Sucrose: 1, Bennett: 6 },
      gear: {},
      overrides: {},
    } as never)
    expect(played.rotationTime).toBeLessThan(10)
    expect(played.stalls).toEqual([])
  })
})
