import { createTestDBStorage } from '@genshin-optimizer/common/database'
import { defaultOptArtifactLevel } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase } from '../ArtCharDatabase'
import type { ArtSetExclusion } from './OptConfigDataManager'
import {
  allArtifactSetExclusionKeys,
  forcedSet,
  isSetRule,
  withForcedSet,
} from './OptConfigDataManager'

describe('OptConfigDataManager', () => {
  let database: ArtCharDatabase
  let optConfigs: ArtCharDatabase['optConfigs']

  beforeEach(() => {
    const dbStorage = createTestDBStorage('go')
    database = new ArtCharDatabase(1, dbStorage)
    optConfigs = database.optConfigs
  })

  it('should remove invalid generatedBuildListId', () => {
    const id = optConfigs.new()
    const invalid = {
      ...optConfigs.get(id),
      generatedBuildListId: 'INVALID_ID',
    }
    const result = optConfigs['validate'](invalid, id)
    expect(result?.generatedBuildListId).toBeUndefined()
  })

  it('should default optimization level range to max artifacts only', () => {
    const id = optConfigs.new()
    const cfg = optConfigs.get(id)
    expect(cfg?.levelLow).toBe(defaultOptArtifactLevel)
    expect(cfg?.levelHigh).toBe(defaultOptArtifactLevel)
  })

  it('should keep valid generatedBuildListId', () => {
    const id = optConfigs.new()
    const buildListId = database.generatedBuildList.new({
      builds: [],
      buildDate: 12345,
    })
    const valid = {
      ...optConfigs.get(id),
      generatedBuildListId: buildListId,
    }
    const result = optConfigs['validate'](valid, id)
    expect(result?.generatedBuildListId).toBe(buildListId)
  })

  it('should remove generatedBuildListId if shared with another config', () => {
    const buildListId = database.generatedBuildList.new({
      builds: [],
      buildDate: 12345,
    })

    const id1 = optConfigs.new({ generatedBuildListId: buildListId })
    const id2 = optConfigs.new()

    const conflicting = {
      ...optConfigs.get(id2),
      generatedBuildListId: buildListId,
    }
    const result = optConfigs['validate'](conflicting, id2)
    expect(result?.generatedBuildListId).toBeUndefined()
    expect(optConfigs.get(id1)?.generatedBuildListId).toBe(buildListId)
  })

  it('should filter artExclusion to only existing artifact IDs', () => {
    const id = optConfigs.new()
    const artId = database.arts.new({
      setKey: 'Adventurer',
      rarity: 3,
      level: 0,
      slotKey: 'flower',
      mainStatKey: 'hp',
      substats: [],
      location: '',
      lock: false,
    })

    const invalid = {
      ...optConfigs.get(id),
      artExclusion: [artId, 'INVALID_ID', 'ANOTHER_INVALID'],
    }
    const result = optConfigs['validate'](invalid, id)
    expect(result?.artExclusion).toEqual([artId])
  })

  it('should ensure levelLow <= levelHigh', () => {
    const id = optConfigs.new()
    const invalid = {
      ...optConfigs.get(id),
      levelLow: 15,
      levelHigh: 10,
    }
    const result = optConfigs['validate'](invalid, id)
    expect(result?.levelLow).toBeLessThanOrEqual(result?.levelHigh ?? 0)
  })

  it('should ensure upOptLevelLow <= upOptLevelHigh', () => {
    const id = optConfigs.new()
    const invalid = {
      ...optConfigs.get(id),
      upOptLevelLow: 18,
      upOptLevelHigh: 5,
    }
    const result = optConfigs['validate'](invalid, id)
    expect(result?.upOptLevelLow).toBeLessThanOrEqual(
      result?.upOptLevelHigh ?? 0
    )
  })

  it('should exclude self from excludedLocations', () => {
    database.chars.set('Amber', { key: 'Amber' })
    database.chars.set('Bennett', { key: 'Bennett' })
    const id = optConfigs.new()

    const invalid = {
      ...optConfigs.get(id),
      excludedLocations: ['Amber', id, 'Bennett'],
    }
    const result = optConfigs['validate'](invalid, id)
    expect(result?.excludedLocations).not.toContain(id)
  })

  // (the sets dialog has no mixed pieces: they are limited only when one set is left)
  it('drops an old mixed-pieces limit and keeps every set choice', () => {
    const id = optConfigs.new()
    const saved = {
      ...optConfigs.get(id),
      artSetExclusion: {
        rainbow: [2, 4],
        GladiatorsFinale: [4],
        EmblemOfSeveredFate: [2],
        NoblesseOblige: [2, 4],
      },
    }
    const result = optConfigs['validate'](saved, id)
    expect(result?.artSetExclusion).toEqual({
      GladiatorsFinale: [4],
      EmblemOfSeveredFate: [2],
      NoblesseOblige: [2, 4],
    })
    // (saved again, as the dialog saves a change: still none)
    optConfigs.set(id, {
      artSetExclusion: { ...saved.artSetExclusion, rainbow: [4] } as never,
    })
    expect(optConfigs.get(id)?.artSetExclusion).not.toHaveProperty('rainbow')
  })

  it('with every set but one off, builds wear 4 pieces of that one', () => {
    const id = optConfigs.new()
    const allBut = (...kept: string[]) =>
      Object.fromEntries(
        allArtifactSetExclusionKeys
          .filter((key) => !isSetRule(key) && !kept.includes(key))
          .map((key) => [key, [2, 4]])
      ) as ArtSetExclusion
    optConfigs.set(id, { artSetExclusion: allBut('TenacityOfTheMillelith') })
    const forced = optConfigs.get(id)!.artSetExclusion
    expect(forcedSet(forced)).toBe('TenacityOfTheMillelith')
    // (at most one piece of another set: four of the one left)
    expect(forced.rainbow).toEqual([2, 4])
    // its 4-piece bonus turned off too: nothing to force
    optConfigs.set(id, {
      artSetExclusion: { ...forced, TenacityOfTheMillelith: [4] },
    })
    expect(optConfigs.get(id)!.artSetExclusion).not.toHaveProperty('rainbow')
    // another set on again: mixed pieces too
    optConfigs.set(id, {
      artSetExclusion: allBut('TenacityOfTheMillelith', 'NoblesseOblige'),
    })
    expect(forcedSet(optConfigs.get(id)!.artSetExclusion)).toBeUndefined()
    expect(optConfigs.get(id)!.artSetExclusion).not.toHaveProperty('rainbow')
  })

  it('keeps the build-shape switches, and turns mixed pieces off as the solvers read it', () => {
    const id = optConfigs.new()
    // a stored mixed-pieces limit from before the switches: not one of them
    optConfigs.set(id, {
      artSetExclusion: { rainbow: [2], GladiatorsFinale: [4] },
    })
    expect(optConfigs.get(id)!.artSetExclusion).toEqual({
      GladiatorsFinale: [4],
    })
    // switches off (any value stores as off)
    optConfigs.set(id, {
      artSetExclusion: { twoTwo: [2], mixed: [4], GladiatorsFinale: [4] },
    })
    expect(optConfigs.get(id)!.artSetExclusion).toEqual({
      twoTwo: [2, 4],
      mixed: [2, 4],
      rainbow: [2, 4],
      GladiatorsFinale: [4],
    })
    // mixed pieces on again: the solvers' limit goes with it, two 2-piece bonuses stay off
    const { mixed: _, ...rest } = optConfigs.get(id)!.artSetExclusion
    optConfigs.set(id, { artSetExclusion: rest })
    expect(optConfigs.get(id)!.artSetExclusion).toEqual({
      twoTwo: [2, 4],
      GladiatorsFinale: [4],
    })
    // empty values: on
    optConfigs.set(id, { artSetExclusion: { twoTwo: [], mixed: [] } })
    expect(optConfigs.get(id)!.artSetExclusion).toEqual({})
  })

  it('a switch is not a set: one set left on still forces it', () => {
    const id = optConfigs.new()
    const allBut = (kept: string) =>
      Object.fromEntries(
        allArtifactSetExclusionKeys
          .filter((key) => !isSetRule(key) && key !== kept)
          .map((key) => [key, [2, 4]])
      ) as ArtSetExclusion
    optConfigs.set(id, {
      artSetExclusion: { ...allBut('NoblesseOblige'), twoTwo: [2, 4] },
    })
    const exclusion = optConfigs.get(id)!.artSetExclusion
    expect(forcedSet(exclusion)).toBe('NoblesseOblige')
    expect(exclusion.rainbow).toEqual([2, 4])
    expect(exclusion.twoTwo).toEqual([2, 4])
  })

  it('one owned set left on forces it, whatever unowned sets are left on', () => {
    const allBut = (...kept: string[]) =>
      Object.fromEntries(
        allArtifactSetExclusionKeys
          .filter((key) => !isSetRule(key) && !kept.includes(key))
          .map((key) => [key, [2, 4]])
      ) as ArtSetExclusion
    // VV and two sets with no pieces in the inventory left on
    const exclusion = allBut(
      'ViridescentVenerer',
      'LegacyOfTheFirstChronicle',
      'PreludeOfTheKingfisherCanopy'
    )
    const owned = new Set([
      'ViridescentVenerer',
      'Instructor',
      'NoblesseOblige',
    ])
    expect(forcedSet(exclusion)).toBeUndefined()
    expect(forcedSet(exclusion, owned)).toBe('ViridescentVenerer')
    expect(withForcedSet(exclusion, owned).rainbow).toEqual([2, 4])
    expect(withForcedSet(exclusion, owned)).not.toBe(exclusion)
    // two owned sets on: nothing forced, the same object
    const two = allBut('ViridescentVenerer', 'Instructor')
    expect(withForcedSet(two, owned)).toBe(two)
    // its 4-piece off: nothing to force
    const twoOnly = { ...exclusion, ViridescentVenerer: [4] } as ArtSetExclusion
    expect(forcedSet(twoOnly, owned)).toBeUndefined()
    // mixed pieces already off: kept as it is
    const mixedOff = {
      ...two,
      mixed: [2, 4],
      rainbow: [2, 4],
    } as ArtSetExclusion
    expect(withForcedSet(mixedOff, owned)).toBe(mixedOff)
  })
})
