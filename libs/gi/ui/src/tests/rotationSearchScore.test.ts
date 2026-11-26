import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  defaultEnergyCalculator,
  erCostOf,
  evaluateTeamRotation,
  kqmRotationSearchSetup,
  optimizeTeamKqm,
  parseFrameData,
  parseTiming,
  rotationScorer,
  simTeamOf,
  teamErPrices,
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
    expect(played.exactTime).toBeGreaterThan(0)
    expect(scored.dps).toBeCloseTo(total / played.exactTime!, 6)
    // Offset plays shift swapFrames without corrupting nominal cached results
    const shifted = score(text, 4)!
    expect(shifted.dps).toBeGreaterThan(0)
    expect(shifted.time).toBeGreaterThanOrEqual(scored.time)
    expect(score(text)).toEqual(scored)
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

  it('prices Team Optimize ER changes from inventory builds and skips kept members', async () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    const weapons: Record<string, string> = {}
    const builds: Record<string, Record<string, string>> = {}
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
      weapons[key] = database.weapons.new({
        key: weapon,
        level: 90,
        ascension: 6,
        refinement: 1,
        location: key,
        lock: false,
      })
      builds[key] = {
        flower: database.arts.new({
          setKey: 'BlizzardStrayer',
          slotKey: 'flower',
          level: 20,
          rarity: 5,
          mainStatKey: 'hp',
          location: key,
          lock: false,
          substats: [
            { key: 'critRate_', value: 10 },
            { key: 'critDMG_', value: 20 },
            { key: 'atk_', value: 10 },
            { key: 'enerRech_', value: 15 },
          ],
        }),
        sands: database.arts.new({
          setKey: 'BlizzardStrayer',
          slotKey: 'sands',
          level: 20,
          rarity: 5,
          mainStatKey: 'enerRech_',
          location: key,
          lock: false,
          substats: [
            { key: 'critRate_', value: 10 },
            { key: 'critDMG_', value: 20 },
            { key: 'atk_', value: 10 },
            { key: 'hp_', value: 5 },
          ],
        }),
      }
    }
    const teamId = database.teams.new({
      loadoutData: [
        { teamCharId: database.teamChars.new(ayaka) },
        { teamCharId: database.teamChars.new(shenhe) },
      ] as LoadoutDatum[],
    })
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      rotationTime: 20,
      attacks: {
        [ayaka]: [{ path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' }],
        [shenhe]: [{ path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' }],
      },
    }
    const prices = await teamErPrices(database, teamId, 'F', teamOpt, {
      builds: builds as never,
      weapons: weapons as never,
    })
    // Both have non-ER weapons, so artifact ER (51.8 + 15) is excluded from floor -> floor = 100
    expect(prices[ayaka]?.roll).toBeGreaterThan(0)
    expect(prices[ayaka]?.floor).toBeCloseTo(100, 1)
    expect(prices[ayaka]?.saveScale).toBeLessThan(1)
    expect(prices[shenhe]?.roll).toBeGreaterThan(0)
    const cost = erCostOf(prices)
    const baseScore = { dps: 0, time: 20, er: { [ayaka]: 140 }, warnings: [] }
    const low = cost(
      { dps: 0, time: 20, er: { [ayaka]: 120 }, warnings: [] },
      baseScore
    )
    const high = cost(
      { dps: 0, time: 20, er: { [ayaka]: 160 }, warnings: [] },
      baseScore
    )
    const baseCost = cost(baseScore, baseScore)
    // Raising ER by +20% costs more than lowering ER by -20% credits (asymmetric inventory pricing)
    expect(high - baseCost).toBeGreaterThan((baseCost - low) * 2)

    // Kept members are not re-optimized, so they are not priced
    const keptPrices = await teamErPrices(
      database,
      teamId,
      'F',
      { ...teamOpt, keep: [shenhe] },
      { builds: builds as never, weapons: weapons as never }
    )
    expect(keptPrices[ayaka]).toBeDefined()
    expect(keptPrices[shenhe]).toBeUndefined()
  })
})
