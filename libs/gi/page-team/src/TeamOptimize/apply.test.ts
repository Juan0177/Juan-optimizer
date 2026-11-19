// @vitest-environment jsdom
import { SandboxStorage } from '@genshin-optimizer/common/database'
import {
  ArtCharDatabase,
  type LoadoutDatum,
  randomDevArtifact,
} from '@genshin-optimizer/gi/db'
import type { TeamOptResult } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { equipTeamResult, undoTeamEquip } from './apply'

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
  it('restores borrowed gear and saved builds after reload without touching unrelated gear', () => {
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
    equipTeamResult(database, teamId, result)
    expect(database.arts.get(borrowed)?.location).toBe('Bennett')
    expect(database.builds.get(savedBuild)?.artifactIds.flower).toBe(
      replacement
    )

    const reloaded = new ArtCharDatabase(1, storage)
    const unrelated = reloaded.arts.new({
      ...randomDevArtifact('plume'),
      location: 'Bennett',
    })
    expect(undoTeamEquip(reloaded, teamId)).toBe(true)
    expect(reloaded.arts.get(current)?.location).toBe('Bennett')
    expect(reloaded.arts.get(borrowed)?.location).toBe('Xiangling')
    expect(reloaded.arts.get(unrelated)?.location).toBe('Bennett')
    expect(reloaded.builds.get(savedBuild)?.artifactIds.flower).toBe(savedArt)
    expect(reloaded.teams.get(teamId)?.equipmentUndo).toBeUndefined()
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
