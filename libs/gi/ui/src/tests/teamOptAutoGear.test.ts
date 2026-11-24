import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import { teamRotationNodes } from '../util/teamOpt/objective'
import { evaluateTeamNodes } from '../util/teamOpt/solve'

const MEMBERS: CharacterKey[] = ['Mitya', 'Alyosha', 'Anastasya', 'Escoffier']

/** Escoffier with Deathmatch R1, her Deathmatch switch as given */
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
  return { database, teamId }
}
/** A Frosty Parfait hit while Mitya is on the field */
const parfait = (database: ArtCharDatabase, teamId: string, own = true) => {
  const attacks = {
    Escoffier: [
      {
        path: ['skill', 'parfaitDmg'],
        hits: 1,
        hitMode: 'avgHit' as const,
        onField: 'Mitya' as CharacterKey,
      },
    ],
  }
  const nodes = teamRotationNodes(database, teamId, 'F', {
    arts: {},
    attacks,
    ...(own ? {} : { ownBuild: false }),
  })!
  return evaluateTeamNodes(database, teamId, attacks, nodes).total
}

describe('Team optimize decides the gear effects nobody set', () => {
  it('counts Deathmatch off the field by rule (one target: fewer than 2 opponents)', () => {
    const auto = setup()
    const set = setup('oneOrNone')
    expect(parfait(auto.database, auto.teamId)).toBeCloseTo(
      parfait(set.database, set.teamId),
      6
    )
    // (the ATK bonus: without the rule it is lower)
    expect(parfait(auto.database, auto.teamId)).toBeGreaterThan(
      parfait(auto.database, auto.teamId, false) * 1.1
    )
  })

  it('keeps a switch set by hand', () => {
    const auto = setup()
    const two = setup('moreThanOne')
    expect(parfait(two.database, two.teamId)).toBeLessThan(
      parfait(auto.database, auto.teamId)
    )
  })
})
