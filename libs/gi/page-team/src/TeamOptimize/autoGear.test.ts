import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getTeamDataCalc } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { clearToAuto, teamBuffsOf } from './buffs'

const MEMBERS: CharacterKey[] = ['Mitya', 'Alyosha', 'Anastasya', 'Escoffier']

/** Escoffier with Deathmatch, her switch for it as given */
function setup(stack?: string) {
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
  database.weapons.new({
    key: 'Deathmatch',
    level: 90,
    ascension: 6,
    refinement: 1,
    location: 'Escoffier',
    lock: false,
  })
  if (stack)
    database.teamChars.set(ids[3], {
      conditional: { Deathmatch: { stack } } as never,
    })
  const deathmatch = () =>
    teamBuffsOf(
      database,
      teamId,
      getTeamDataCalc(database, teamId, 'F', '') as never
    ).find((b) => b.ref.path[0] === 'Deathmatch')
  return { database, deathmatch, teamCharId: ids[3] }
}

describe('Team optimize’s gear effects nobody set', () => {
  it('lists one on by rule as Auto', () => {
    const buff = setup().deathmatch()
    expect(buff?.auto).toBe(true)
    expect(buff?.value).toBe('oneOrNone')
  })

  it('offers to go back to Auto from a state set by hand', () => {
    const { database, deathmatch, teamCharId } = setup('moreThanOne')
    const buff = deathmatch()!
    expect(buff.auto).toBeUndefined()
    expect(buff.overridesAuto).toBe(teamCharId)
    clearToAuto(database, buff)
    expect(
      (
        database.teamChars.get(teamCharId)?.conditional as Record<
          string,
          Record<string, string>
        >
      )?.Deathmatch?.stack
    ).toBeUndefined()
    expect(deathmatch()?.auto).toBe(true)
  })
})
