import type { ICachedArtifact, OptConfig } from '@genshin-optimizer/gi/db'
import { initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import type { TeamOptMember } from '../util/teamOpt/data'
import { teamOptPool } from '../util/teamOpt/solve'

const art = (id: string, location = '') =>
  ({
    id,
    level: 20,
    slotKey: 'flower',
    mainStatKey: 'hp',
    location,
  }) as unknown as ICachedArtifact
const arts = [art('a'), art('b'), art('c', 'Bennett')]
const member = { location: 'Bennett' } as unknown as TeamOptMember
const optConfig = (artExclusion: string[] = []) =>
  ({ mainStatKeys: {}, artExclusion }) as unknown as OptConfig
const ids = (xs: ICachedArtifact[]) => xs.map((x) => x.id)
const pool = (teamOpt = initTeamOpt(), own: string[] = []) =>
  ids(teamOptPool(arts, member, optConfig(own), teamOpt, new Set(), new Set()))

describe("Team Optimize: the team's excluded artifacts", () => {
  it('leaves out the artifacts excluded for the team, equipped ones included', () => {
    expect(pool()).toEqual(['a', 'b', 'c'])
    const teamOpt = { ...initTeamOpt(), excludedArts: ['b', 'c'] }
    expect(pool(teamOpt)).toEqual(['a'])
  })
  it("still leaves out a member's own exclusions, unless the team uses them", () => {
    expect(pool(initTeamOpt(), ['a'])).toEqual(['b', 'c'])
    const teamOpt = { ...initTeamOpt(), useExcludedArts: true }
    expect(pool(teamOpt, ['a'])).toEqual(['a', 'b', 'c'])
    // (the team's list applies either way)
    expect(pool({ ...teamOpt, excludedArts: ['b'] }, ['a'])).toEqual(['a', 'c'])
  })
  it('starts empty', () => {
    expect(initTeamOpt().excludedArts).toEqual([])
  })
})

describe('Team Optimize: whose artifacts it takes', () => {
  // the member is Bennett; Fischl and Keqing are outside the team
  const owned = [
    art('a'),
    art('b', 'Bennett'),
    art('f', 'Fischl'),
    art('k', 'Keqing'),
  ]
  const take = (teamOpt: ReturnType<typeof initTeamOpt>) =>
    ids(
      teamOptPool(
        owned,
        member,
        optConfig(),
        teamOpt,
        new Set(['Bennett']),
        new Set()
      )
    )
  it("takes other characters' artifacts only when asked, and not those left out", () => {
    expect(take(initTeamOpt())).toEqual(['a', 'b'])
    const others = { ...initTeamOpt(), useOtherChars: true }
    expect(take(others)).toEqual(['a', 'b', 'f', 'k'])
    expect(take({ ...others, excludedLocations: ['Keqing'] })).toEqual([
      'a',
      'b',
      'f',
    ])
    // (the list only narrows "Other characters’ artifacts": off, none are taken anyway)
    expect(take({ ...initTeamOpt(), excludedLocations: ['Keqing'] })).toEqual([
      'a',
      'b',
    ])
  })
  it("always takes the team's own artifacts, even if a member is listed", () => {
    const teamOpt = {
      ...initTeamOpt(),
      useOtherChars: true,
      excludedLocations: ['Bennett' as const],
    }
    expect(take(teamOpt)).toEqual(['a', 'b', 'f', 'k'])
  })
})
