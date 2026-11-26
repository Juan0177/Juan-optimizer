// @vitest-environment jsdom
import { SandboxStorage } from '@genshin-optimizer/common/database'
import {
  ArtCharDatabase,
  type LoadoutDatum,
  randomDevArtifact,
} from '@genshin-optimizer/gi/db'
import type { TeamOptResult } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import {
  equipChanges,
  equipTeamResult,
  restoreTeamBuilds,
  saveTeamResult,
  undoTeamEquip,
} from './apply'

function setup() {
  const storage = new SandboxStorage({})
  const database = new ArtCharDatabase(1, storage)
  const bennett = database.teamChars.new('Bennett')
  const sucrose = database.teamChars.new('Sucrose')
  database.chars.getWithInitWeapon('Xiangling')
  const current = database.arts.new({
    ...randomDevArtifact('flower'),
    location: 'Bennett',
  })
  const borrowed = database.arts.new({
    ...randomDevArtifact('flower'),
    location: 'Xiangling',
  })
  const savedArt = database.arts.new(randomDevArtifact('flower'))
  const replacement = database.arts.new(randomDevArtifact('flower'))
  const savedBuild = database.builds.new({
    characterKey: 'Sucrose',
    artifactIds: { flower: savedArt },
  })
  const teamId = database.teams.new({
    loadoutData: [
      { teamCharId: bennett, buildType: 'equipped' },
      { teamCharId: sucrose, buildType: 'real', buildId: savedBuild },
    ] as LoadoutDatum[],
  })
  const result = {
    builds: { Bennett: { flower: borrowed }, Sucrose: { flower: replacement } },
    weapons: {},
    optimized: ['Bennett', 'Sucrose'],
  } as TeamOptResult
  return {
    database,
    storage,
    teamId,
    current,
    borrowed,
    savedBuild,
    savedArt,
    replacement,
    result,
  }
}

describe('Team Optimize Equip recovery', () => {
  it('equips a member on a saved build too, and undo puts it back on that build', () => {
    const {
      database,
      storage,
      teamId,
      current,
      borrowed,
      savedBuild,
      savedArt,
      replacement,
      result,
    } = setup()
    expect(
      equipChanges(database, teamId, result).map((m) => m.characterKey)
    ).toEqual(['Bennett', 'Sucrose'])
    equipTeamResult(database, teamId, result)
    expect(database.arts.get(borrowed)?.location).toBe('Bennett')
    expect(database.arts.get(replacement)?.location).toBe('Sucrose')
    expect(database.builds.get(savedBuild)?.artifactIds.flower).toBe(savedArt)
    const sucroseLoadout = () =>
      database.teams.get(teamId)?.loadoutData[1]?.buildType
    expect(sucroseLoadout()).toBe('equipped')
    expect(equipChanges(database, teamId, result)).toEqual([])

    const reloaded = new ArtCharDatabase(1, storage)
    const unrelated = reloaded.arts.new({
      ...randomDevArtifact('plume'),
      location: 'Bennett',
    })
    expect(undoTeamEquip(reloaded, teamId)).toBe(true)
    expect(reloaded.arts.get(current)?.location).toBe('Bennett')
    expect(reloaded.arts.get(borrowed)?.location).toBe('Xiangling')
    expect(reloaded.arts.get(replacement)?.location).toBe('')
    expect(reloaded.arts.get(unrelated)?.location).toBe('Bennett')
    expect(reloaded.teams.get(teamId)?.loadoutData[1]).toMatchObject({
      buildType: 'real',
      buildId: savedBuild,
    })
    expect(reloaded.builds.get(savedBuild)?.artifactIds.flower).toBe(savedArt)
    expect(reloaded.teams.get(teamId)?.equipmentUndo).toBeUndefined()
  })

  it('offers Equip after Save as builds, whose builds equal the result', () => {
    const { database, teamId, result } = setup()
    saveTeamResult(database, teamId, result, 'Saved')
    expect(
      equipChanges(database, teamId, result).map((m) => m.characterKey)
    ).toEqual(['Bennett', 'Sucrose'])
  })

  it('restores the previous selection after reload and keeps the saved builds', () => {
    const { database, storage, teamId, result, savedBuild, borrowed } = setup()
    saveTeamResult(database, teamId, result, 'Saved')
    const created = database.teams.get(teamId)!.loadoutData[0]!.buildId
    const reloaded = new ArtCharDatabase(1, storage)
    saveTeamResult(reloaded, teamId, result, 'Repeated')
    expect(reloaded.teams.get(teamId)?.loadoutData[0]?.buildId).toBe(created)
    expect(restoreTeamBuilds(reloaded, teamId)).toBe(true)
    expect(reloaded.teams.get(teamId)?.loadoutData[0]?.buildType).toBe(
      'equipped'
    )
    expect(reloaded.teams.get(teamId)?.loadoutData[1]?.buildId).toBe(savedBuild)
    expect(reloaded.builds.get(created)?.artifactIds.flower).toBe(borrowed)
    expect(reloaded.arts.get(borrowed)?.location).toBe('Xiangling')
  })

  it('declines to overwrite gear changed since equipping', () => {
    const { database, teamId, borrowed, result } = setup()
    equipTeamResult(database, teamId, result)
    const edit = database.arts.new({
      ...randomDevArtifact('flower'),
      location: 'Bennett',
    })
    expect(undoTeamEquip(database, teamId)).toBe(false)
    expect(database.arts.get(edit)?.location).toBe('Bennett')
    expect(database.arts.get(borrowed)?.location).toBe('')
  })
})
