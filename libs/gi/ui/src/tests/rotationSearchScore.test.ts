import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  defaultEnergyCalculator,
  evaluateTeamRotation,
  kqmRotationSearchSetup,
  optimizeTeamKqm,
  parseFrameData,
  parseTiming,
  rotationScorer,
  simTeamOf,
  teamOptMembers,
  teamRotationSearchSetup,
  updateEnergyCalcMember,
  writtenTeamReplay,
} from '../'

const ayaka: CharacterKey = 'KamisatoAyaka'
const shenhe: CharacterKey = 'Shenhe'

describe('a rotation search’s player', () => {
  it('scores the same when what it keeps starts over before every rotation', async () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    for (const key of [ayaka, shenhe])
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
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
      kqm: { refinement5: 1, refinement4: 5, talents: 10 },
      attacks: {
        [ayaka]: [{ path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' }],
        [shenhe]: [{ path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' }],
      },
    }
    const result = (await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      maxRounds: 2,
    }))!
    const setup = kqmRotationSearchSetup(
      database,
      teamId,
      'F',
      [
        { characterKey: ayaka, name: 'Ayaka' },
        { characterKey: shenhe, name: 'Shenhe' },
      ],
      teamOpt,
      result,
      {
        opener: '',
        timing: parseTiming(null),
        frameData: parseFrameData(null),
      }
    )
    const kept = rotationScorer(database, setup)
    const anew = rotationScorer(database, setup, 0)
    const texts = [
      'Shenhe E Q -> Ayaka E Q N2 CA',
      'Shenhe Q E -> Ayaka Q E N2 CA',
      'Shenhe E Q -> Ayaka E Q N2 CA',
      'Shenhe E -> Ayaka E N2 CA -> Shenhe Q -> Ayaka Q N2',
    ]
    for (const text of texts) {
      const score = kept(text)
      expect(score?.dps).toBeGreaterThan(0)
      expect(anew(text)).toEqual(score)
    }
  })

  it('Team optimize’s player counts a rotation as its tab does: played with the members’ own gear and the build’s set and weapon effects, its damage with the build', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    for (const [key, weapon] of [
      [ayaka, 'AmenomaKageuchi'],
      [shenhe, 'Deathmatch'],
    ] as const) {
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
      database.weapons.new({
        key: weapon,
        level: 90,
        ascension: 6,
        refinement: 1,
        location: key,
        lock: false,
      })
    }
    // (the build's weapon, not the one Ayaka holds)
    const mistsplitter = database.weapons.get(
      database.weapons.new({
        key: 'MistsplitterReforged',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: '',
        lock: false,
      })
    )!
    const teamId = database.teams.new({
      loadoutData: [
        { teamCharId: database.teamChars.new(ayaka) },
        { teamCharId: database.teamChars.new(shenhe) },
      ] as LoadoutDatum[],
    })
    const teamOpt = initTeamOpt()
    const names = [
      { characterKey: ayaka, name: 'Ayaka' },
      { characterKey: shenhe, name: 'Shenhe' },
    ]
    const saved = {
      opener: '',
      timing: parseTiming(null),
      frameData: parseFrameData(null),
    }
    const overrides = { arts: {}, weapons: { [ayaka]: mistsplitter } }
    const score = rotationScorer(
      database,
      teamRotationSearchSetup(
        database,
        teamId,
        'F',
        names,
        teamOpt,
        overrides,
        { [ayaka]: { weapon: 'MistsplitterReforged', refinement: 1 } },
        saved
      )
    )
    const text = 'Shenhe E Q -> Ayaka E Q N2 CA'
    const members = teamOptMembers(database, teamId)
    const played = writtenTeamReplay({
      database,
      teamId,
      members,
      gender: 'F',
      names,
      teamOpt,
      text,
      ...saved,
    })!({
      gear: {
        [ayaka]: {
          ...simTeamOf(members, database).gear[ayaka],
          candidates: { sets: [], weapons: ['MistsplitterReforged'] },
        },
        [shenhe]: {
          ...simTeamOf(members, database).gear[shenhe],
          candidates: { sets: [], weapons: [] },
        },
      },
      overrides: {},
    })
    const total = evaluateTeamRotation(database, teamId, 'F', {
      ...overrides,
      attacks: played.attacks,
    })!.total
    const scored = score(text)!
    expect(scored.time).toBe(played.rotationTime)
    expect(scored.dps).toBeCloseTo(total / played.rotationTime!, 6)
    // (the build counts: its weapon is not Ayaka's own)
    const own = evaluateTeamRotation(database, teamId, 'F', {
      arts: {},
      attacks: played.attacks,
    })!.total
    expect(total).not.toBeCloseTo(own, 0)
  })

  it('respects the team’s saved ER calculator settings (enemy particles and burstEvery) instead of defaults', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    for (const [key, weapon] of [
      [ayaka, 'AmenomaKageuchi'],
      [shenhe, 'Deathmatch'],
    ] as const) {
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
      database.weapons.new({
        key: weapon,
        level: 90,
        ascension: 6,
        refinement: 1,
        location: key,
        lock: false,
      })
    }
    const teamId = database.teams.new({
      loadoutData: [
        { teamCharId: database.teamChars.new(ayaka) },
        { teamCharId: database.teamChars.new(shenhe) },
      ] as LoadoutDatum[],
    })
    const names = [
      { characterKey: ayaka, name: 'Ayaka' },
      { characterKey: shenhe, name: 'Shenhe' },
    ]
    const saved = {
      opener: '',
      timing: parseTiming(null),
      frameData: parseFrameData(null),
    }
    const text = 'Shenhe E Q -> Ayaka E Q N2 CA'
    const baseScore = rotationScorer(
      database,
      teamRotationSearchSetup(
        database,
        teamId,
        'F',
        names,
        initTeamOpt(),
        { arts: {}, weapons: {} },
        {},
        saved
      )
    )(text)!

    let calc = defaultEnergyCalculator([ayaka, shenhe], 20)
    calc.enemyParticles = 0
    calc = updateEnergyCalcMember(calc, [ayaka, shenhe], shenhe, {
      burstEvery: 0,
    })
    const customTeamOpt: TeamOpt = {
      ...initTeamOpt(),
      energySource: 'calculator',
      energyCalculator: calc,
    }
    const customScore = rotationScorer(
      database,
      teamRotationSearchSetup(
        database,
        teamId,
        'F',
        names,
        customTeamOpt,
        { arts: {}, weapons: {} },
        {},
        saved
      )
    )(text)!

    // Without enemy particles Ayaka needs more ER, and Shenhe skipping Burst drops to 100%
    expect(customScore.er[ayaka]!).toBeGreaterThan(baseScore.er[ayaka]!)
    expect(customScore.er[shenhe]).toBe(100)
  })
})
