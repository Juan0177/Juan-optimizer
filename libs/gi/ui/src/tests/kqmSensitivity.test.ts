import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  evaluateTeamRotation,
  kqmTeamOverrides,
  kqmTeamSensitivity,
  optimizeTeamKqm,
  teamOptMembers,
} from '../'

const ayaka: CharacterKey = 'KamisatoAyaka'
const shenhe: CharacterKey = 'Shenhe'

function setup() {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const key of [ayaka, shenhe])
    database.chars.set(key, {
      key,
      level: 80,
      ascension: 5,
      talent: { auto: 6, skill: 6, burst: 6 },
      constellation: 0,
    })
  const teamId = database.teams.new({
    loadoutData: [
      { teamCharId: database.teamChars.new(ayaka) },
      { teamCharId: database.teamChars.new(shenhe) },
    ] as LoadoutDatum[],
  })
  const teamOpt: TeamOpt = {
    ...initTeamOpt(),
    kqm: {
      refinement5: 1,
      refinement4: 5,
      talents: 10,
      energyRecharge: { [ayaka]: 100, [shenhe]: 100 },
      // the KQM tab's own switches and enemy, apart from the team's
      teamConditional: { resonance: { ShatteringIce: 'on' }, reaction: {} },
      enemy: { enemyOverride: { enemyLevel: 100, cryo_enemyRes_: 40 } },
    },
    attacks: {
      [ayaka]: [
        { path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' },
        { path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' },
      ],
      [shenhe]: [{ path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' }],
    },
  }
  return { database, teamId, teamOpt }
}

describe('what raises team damage, for KQM builds (kqmTeamSensitivity)', () => {
  it('reads the KQM builds as KQM does, and adds one KQM roll, a talent level or a level to them', async () => {
    const { database, teamId, teamOpt } = setup()
    const result = (await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      maxRounds: 2,
    }))!
    const sensitivity = kqmTeamSensitivity(
      database,
      teamId,
      'F',
      teamOpt,
      result
    )
    // the KQM tab's enemy and switches count (a reading without them would not match)
    expect(sensitivity.base).toBeCloseTo(result.after.total, 6)
    const overrides = kqmTeamOverrides(database, teamId, teamOpt, result)
    const withoutThem = evaluateTeamRotation(database, teamId, 'F', {
      ...overrides,
      arts: overrides.arts!,
      attacks: result.played?.attacks ?? teamOpt.attacks,
    })!.total
    expect(withoutThem).not.toBeCloseTo(result.after.total, 0)

    const [first] = teamOptMembers(database, teamId)
    const rolls = sensitivity.substats(first)
    // one more roll is that roll and nothing else: DEF counts for nobody here
    expect(rolls.def).toBeCloseTo(sensitivity.base!, 6)
    expect(rolls.critDMG_).toBeGreaterThan(sensitivity.base!)
    // KQM's talents (10 here) and level (90), never the members' own (6, level 80)
    expect(sensitivity.character(first, { talent: 'burst' })).toBeUndefined()
    expect(sensitivity.character(first, { level: 80 })).toBeUndefined()
    expect(sensitivity.character(first, { level: 95 })).toBeGreaterThan(
      sensitivity.base!
    )
  }, 300_000)
})
