import {
  DBLocalStorage,
  SandboxStorage,
} from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '../ArtCharDatabase'
import { initCharTC } from './BuildTcDataManager'
import { defLoadoutExportSetting, type LoadoutDatum } from './TeamDataManager'

describe('export and import test', () => {
  const dbStorage = new DBLocalStorage(localStorage)
  const dbIndex = 1
  let database = new ArtCharDatabase(dbIndex, dbStorage)

  beforeEach(() => {
    dbStorage.clear()
    database = new ArtCharDatabase(dbIndex, dbStorage)
  })
  test('exim', () => {
    // Create a team [Raiden, null, bennett, null]

    const raidenId = database.teamChars.new('RaidenShogun', {
      optConfigId: database.optConfigs.new({
        optimizationTarget: ['test'],
      }),
    })
    database.builds.new({ characterKey: 'RaidenShogun' })
    database.buildTcs.new(initCharTC('RaidenShogun', 'EngulfingLightning'))
    expect(database.builds.forCharacter('RaidenShogun').length).toEqual(1)
    expect(database.buildTcs.forCharacter('RaidenShogun').length).toEqual(1)

    const bennettId = database.teamChars.new('Bennett')
    database.builds.new({ characterKey: 'Bennett' })
    database.buildTcs.new(initCharTC('Bennett', 'SapwoodBlade'))
    const teamId = database.teams.new({
      loadoutData: [
        { teamCharId: raidenId } as LoadoutDatum,
        undefined,
        { teamCharId: bennettId } as LoadoutDatum,
      ],
    })

    const dbTeam = database.teams.get(teamId)!
    expect(dbTeam).toBeTruthy()
    expect(dbTeam.loadoutData[0]?.teamCharId).toEqual(raidenId)
    expect(dbTeam.loadoutData[2]?.teamCharId).toEqual(bennettId)

    const exp = database.teams.export(teamId, [
      {
        convertbuilds: [],
        convertEquipped: true,
        convertTcBuilds: [],
        exportCustomMultiTarget: [],
      },
      {
        convertbuilds: [],
        convertEquipped: true,
        convertTcBuilds: [],
        exportCustomMultiTarget: [],
      },
      {
        convertbuilds: [],
        convertEquipped: true,
        convertTcBuilds: [],
        exportCustomMultiTarget: [],
      },
    ])
    expect(exp).toBeTruthy()
    expect((exp as any).loadoutData[0].key).toEqual('RaidenShogun')
    expect((exp as any).loadoutData[0].optConfig.optimizationTarget).toEqual([
      'test',
    ])

    let res: object | undefined
    expect(() => {
      const json = JSON.stringify(exp)
      res = JSON.parse(json)
    }).not.toThrow()
    expect(res).toBeTruthy()
    const importTeamId = database.teams.import(exp)
    const importTeam = database.teams.get(importTeamId)!
    expect(importTeam).toBeTruthy()

    const raidenTeamChar = database.teamChars.get(
      importTeam.loadoutData[0]?.teamCharId
    )
    expect(raidenTeamChar?.key).toEqual('RaidenShogun')
    expect(database.buildTcs.forCharacter('RaidenShogun').length).toEqual(2)
    expect(
      database.optConfigs.get(raidenTeamChar?.optConfigId)?.optimizationTarget
    ).toEqual(['test'])
    const bennettTeamChar = database.teamChars.get(
      importTeam.loadoutData[2]?.teamCharId
    )
    expect(bennettTeamChar?.key).toEqual('Bennett')
    expect(database.buildTcs.forCharacter('Bennett').length).toEqual(2)
  })

  test('migrates saved rotations and preserves both tabs across duplicate and transfer', () => {
    const teamCharId = database.teamChars.new('Bennett')
    const legacyId = 'team_0'
    database.teams.set(legacyId, {
      loadoutData: [{ teamCharId } as LoadoutDatum],
    })
    localStorage.setItem('teamOptRotationText_team_0', 'Bennett E N3')
    localStorage.setItem('teamOptRotationText_team_0_kqm', 'Bennett Q')
    localStorage.setItem('teamOptRotationOpener_team_0_kqm', 'Bennett E')
    localStorage.setItem('teamOptRotationText_team_9', 'Deleted team')
    const migration = database.teams.migrateLocalRotations(localStorage)
    expect(migration.migrated.map(({ key }) => key)).toContain(
      'teamOptRotationText_team_0'
    )
    expect(migration.unresolved.map(({ key }) => key)).toContain(
      'teamOptRotationText_team_9'
    )
    expect(localStorage.getItem('teamOptRotationText_team_0')).toBe(
      'Bennett E N3'
    )
    expect(localStorage.getItem('teamOptRotationText_team_9')).toBe(
      'Deleted team'
    )
    database.teams.setRotationField(legacyId, 'Draft', 'Bennett E')

    const copy = database.teams.duplicate(legacyId)
    const imported = database.teams.import(
      database.teams.export(legacyId, [defLoadoutExportSetting()])
    )
    for (const id of [copy, imported]) {
      expect(id).toBeTruthy()
      expect(database.teams.getRotationField(id, 'Text')).toBe('Bennett E N3')
      expect(database.teams.getRotationField(id, 'Draft')).toBeUndefined()
      expect(database.teams.getRotationField(`${id}_kqm`, 'Text')).toBe(
        'Bennett Q'
      )
      expect(database.teams.getRotationField(`${id}_kqm`, 'Opener')).toBe(
        'Bennett E'
      )
    }
    database.teams.remove(legacyId)
    expect(database.teams.getRotationField(legacyId, 'Text')).toBeUndefined()
    expect(
      database.teams.getRotationField(database.teams.new(), 'Text')
    ).toBeUndefined()
  })

  test('uses the legacy roster evidence to resolve a team ID shared by two slots', () => {
    const backup = new ArtCharDatabase(2, new SandboxStorage())
    const legacyId = 'team_0'
    const bennett = database.teamChars.new('Bennett')
    const xiangling = backup.teamChars.new('Xiangling')
    database.teams.set(legacyId, {
      loadoutData: [{ teamCharId: bennett } as LoadoutDatum],
    })
    backup.teams.set(legacyId, {
      loadoutData: [{ teamCharId: xiangling } as LoadoutDatum],
    })
    const textKey = 'teamOptRotationText_team_0'
    const ambiguousKey = 'teamOptRotationTiming_team_0_kqm'
    localStorage.setItem(textKey, 'Xiangling E')
    localStorage.setItem(ambiguousKey, '{"edits":{}}')

    const migration = database.teams.migrateLocalRotations(localStorage, [
      backup.teams,
    ])
    expect([...migration.destinations]).toEqual([backup.teams])
    expect(migration.unresolved.map(({ key }) => key)).toEqual([ambiguousKey])
    expect(backup.teams.getRotationField(legacyId, 'Text')).toBe('Xiangling E')
    expect(database.teams.getRotationField(legacyId, 'Text')).toBeUndefined()
    expect(localStorage.getItem(textKey)).toBe('Xiangling E')
    expect(localStorage.getItem(ambiguousKey)).toBe('{"edits":{}}')
  })

  test('rejects an invalid member before importing a valid member or its configuration', () => {
    expect(
      database.teams.import({
        name: 'Invalid team',
        loadoutData: [{ key: 'Bennett' }, { key: 'InvalidCharacter' }],
      })
    ).toBe('')
    expect(database.teams.keys).toHaveLength(0)
    expect(database.teamChars.keys).toHaveLength(0)
    expect(database.optConfigs.keys).toHaveLength(0)
    expect(database.chars.keys).toHaveLength(0)
  })

  test('updates Last edit for team changes and leaves it alone for draft changes', () => {
    const id = database.teams.new({ lastEdit: 1 })
    database.teams.setRotationField(id, 'Draft', 'Bennett E')
    database.teams.initializeSettings(id, (team) => {
      team.enemyHp = 1000
    })
    expect(database.teams.get(id)?.lastEdit).toBe(1)
    database.teams.set(id, { name: 'Edited name' })
    expect(database.teams.get(id)?.lastEdit).toBeGreaterThan(1)
  })

  test('deleting loadout does not delete builds', () => {
    const teamCharId = database.teamChars.new('HuTao')
    database.builds.new({ characterKey: 'HuTao' })
    database.buildTcs.new(initCharTC('HuTao', 'StaffOfHoma'))
    expect(database.builds.forCharacter('HuTao').length).toEqual(1)
    expect(database.buildTcs.forCharacter('HuTao').length).toEqual(1)

    database.teamChars.remove(teamCharId)

    expect(database.builds.forCharacter('HuTao').length).toEqual(1)
    expect(database.buildTcs.forCharacter('HuTao').length).toEqual(1)
  })

  test('entriesForCharacter sorts srcTeamCharId builds first', () => {
    const loadoutA = database.teamChars.new('Xiangling')
    const loadoutB = database.teamChars.new('Xiangling')
    const id1 = database.builds.new({ characterKey: 'Xiangling' })
    const id2 = database.builds.new({
      characterKey: 'Xiangling',
      srcTeamCharId: loadoutB,
    })
    const id3 = database.builds.new({
      characterKey: 'Xiangling',
      srcTeamCharId: loadoutA,
    })

    expect(
      database.builds
        .entriesForCharacter('Xiangling', loadoutA)
        .map(([id]) => id)
    ).toEqual([id3, id1, id2])

    const tcId1 = database.buildTcs.new(initCharTC('Xiangling', 'StaffOfHoma'))
    const tcId2 = database.buildTcs.new({
      ...initCharTC('Xiangling', 'StaffOfHoma'),
      srcTeamCharId: loadoutB,
    })
    const tcId3 = database.buildTcs.new({
      ...initCharTC('Xiangling', 'StaffOfHoma'),
      srcTeamCharId: loadoutA,
    })
    expect(
      database.buildTcs
        .entriesForCharacter('Xiangling', loadoutA)
        .map(([id]) => id)
    ).toEqual([tcId3, tcId1, tcId2])
  })

  test('two loadouts for same character can reference same build', () => {
    const loadoutA = database.teamChars.new('Xiangling')
    const loadoutB = database.teamChars.new('Xiangling')
    database.builds.new({ characterKey: 'Xiangling' })
    const buildId = database.builds.keys[0]!

    const teamId = database.teams.new({
      loadoutData: [
        {
          teamCharId: loadoutA,
          buildType: 'real',
          buildId,
        } as LoadoutDatum,
        {
          teamCharId: loadoutB,
          buildType: 'real',
          buildId,
        } as LoadoutDatum,
      ],
    })

    const team = database.teams.get(teamId)!
    expect(team.loadoutData[0]?.buildId).toEqual(buildId)
    expect(team.loadoutData[1]?.buildId).toEqual(buildId)
  })
})
