// @vitest-environment jsdom
/**
 * A fight from no energy plays its first rotation without Bursts. What their Burst would have made
 * ready (a Skill it resets) is left out, not waited for: a player moves on.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { teamOptMembers } from '@genshin-optimizer/gi/ui'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { simulateWritten } from './RotationWriter'

const MEMBERS: CharacterKey[] = ['Bennett', 'Sucrose']
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

describe('the first rotation from no energy', () => {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const key of MEMBERS)
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 0,
    })
  const ids = MEMBERS.map((k) => database.teamChars.new(k))
  const teamId = database.teams.new({
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
  })
  const members = teamOptMembers(database, teamId)
  const play = (text: string, withoutBursts: boolean) =>
    simulateWritten({
      text,
      opener: '',
      timing: { edits: {} },
      frameData: {},
      team: {
        members: MEMBERS,
        constellations: {},
        elements: Object.fromEntries(
          MEMBERS.map((m) => [m, getCharEle(m)])
        ) as never,
        gear: {},
      },
      names: MEMBERS.map((characterKey) => ({
        characterKey,
        name: characterKey,
      })),
      members,
      database: database as never,
      teamId,
      gender: 'F',
      openerWarning: (w) => w,
      repeats: 1,
      keep: 'all',
      withoutBursts,
    })!
  it('leaves out a Skill not ready again, instead of waiting for it', () => {
    const text = 'Bennett E Q E -> Sucrose N1'
    const opening = play(text, true)
    const skills = opening.sim!.actions.filter(
      (a) => a.characterKey === 'Bennett' && a.text === 'E'
    )
    expect(skills.length).toBe(1)
    expect(Object.keys(opening.sim!.stalls ?? {})).toEqual([])
    // (with its Burst it waits for the Skill, as written)
    const played = play(text, false)
    expect(
      played.sim!.actions.filter(
        (a) => a.characterKey === 'Bennett' && a.text === 'E'
      ).length
    ).toBe(2)
  })
  it('plays a Burst’s alternative ("Q/N1") in its place', () => {
    const opening = play('Bennett E Q/N1 -> Sucrose N1', true)
    expect(
      opening.sim!.actions.some(
        (a) => a.characterKey === 'Bennett' && a.text === 'N1'
      )
    ).toBe(true)
    expect(opening.sim!.actions.some((a) => a.text === 'Q')).toBe(false)
  })
})
