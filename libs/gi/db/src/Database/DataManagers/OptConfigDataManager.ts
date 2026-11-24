import {
  zodBoolean,
  zodClampedNumber,
  zodFilteredArray,
  zodNumericLiteralWithDefault,
} from '@genshin-optimizer/common/database'
import { clamp, deepClone, deepFreeze } from '@genshin-optimizer/common/util'
import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allLocationCharacterKeys,
  allSubstatKeys,
  artSlotMainKeys,
  defaultOptArtifactLevel,
} from '@genshin-optimizer/gi/consts'
import { z } from 'zod'
import type { ArtCharDatabase } from '../ArtCharDatabase'
import { DataManager } from '../DataManager'
import type { GeneratedBuildList } from './GeneratedBuildListDataManager'

export const maxBuildsToShowList = [1, 2, 3, 4, 5, 8, 10] as const
export const maxBuildsToShowDefault = 5

/**
 * The keys of a build's shape rules, not a set's:
 * - `rainbow`: the solvers' limit on mixed pieces (pieces whose set no other piece has), derived:
 *   `mixed` off, or one set left on (`forcedSet`)
 * - `mixed`: mixed pieces turned off (2-piece + 3 mixed, 3-piece + 2 mixed, 5 mixed)
 * - `twoTwo`: two 2-piece bonuses turned off (2+2+1, 3+2)
 */
export const artSetRuleKeys = ['rainbow', 'mixed', 'twoTwo'] as const
export type ArtSetRuleKey = (typeof artSetRuleKeys)[number]

export const allArtifactSetExclusionKeys = [
  ...allArtifactSetKeys.filter(
    (key) =>
      ![
        'PrayersForDestiny',
        'PrayersForIllumination',
        'PrayersForWisdom',
        'PrayersToSpringtime',
      ].includes(key)
  ),
  ...artSetRuleKeys,
] as ArtSetExclusionKey[]

export type ArtSetExclusionKey =
  | Exclude<
      ArtifactSetKey,
      | 'PrayersForDestiny'
      | 'PrayersForIllumination'
      | 'PrayersForWisdom'
      | 'PrayersToSpringtime'
    >
  | ArtSetRuleKey
export type ArtSetExclusion = Partial<Record<ArtSetExclusionKey, (2 | 4)[]>>

export const isSetRule = (key: string): key is ArtSetRuleKey =>
  (artSetRuleKeys as readonly string[]).includes(key)

/**
 * The set every build wears 4 pieces of: the only one left on (its 4-piece bonus allowed), every
 * other set's bonuses turned off. Its builds then hold at most one piece of another set.
 */
export function forcedSet(exclusion: ArtSetExclusion) {
  const inUse = allArtifactSetExclusionKeys.filter(
    (key) => !isSetRule(key) && (exclusion[key]?.length ?? 0) < 2
  )
  return inUse.length === 1 && !exclusion[inUse[0]]?.includes(4)
    ? (inUse[0] as Exclude<ArtSetExclusionKey, ArtSetRuleKey>)
    : undefined
}

const statFilterSettingSchema = z.object({
  value: z.number().catch(0),
  disabled: zodBoolean(),
})
export type StatFilterSetting = z.infer<typeof statFilterSettingSchema>

const statFiltersSchema = z
  .record(z.string(), z.array(statFilterSettingSchema))
  .catch({})
export type StatFilters = z.infer<typeof statFiltersSchema>

const artSetExclusionSchema = z.preprocess(
  (val) => {
    if (typeof val !== 'object' || val === null) return {}
    const result: ArtSetExclusion = {}
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (!allArtifactSetExclusionKeys.includes(k as ArtSetExclusionKey))
        continue
      // (the solvers' mixed-pieces limit follows from the switches, below: a stored one, as old
      // configs have, is not one of them)
      if (k === 'rainbow') continue
      if (!Array.isArray(v)) continue
      const filtered = [...new Set(v.filter((n) => n === 2 || n === 4))] as (
        | 2
        | 4
      )[]
      if (!filtered.length) continue
      // a switch turned off
      result[k as ArtSetExclusionKey] = isSetRule(k) ? [2, 4] : filtered
    }
    if (result.mixed || forcedSet(result)) result.rainbow = [2, 4]
    return result
  },
  z.record(z.string(), z.array(z.union([z.literal(2), z.literal(4)])))
) as z.ZodType<ArtSetExclusion>

const mainStatKeysSchema = z
  .object({
    sands: zodFilteredArray(artSlotMainKeys.sands, artSlotMainKeys.sands),
    goblet: zodFilteredArray(artSlotMainKeys.goblet, artSlotMainKeys.goblet),
    circlet: zodFilteredArray(artSlotMainKeys.circlet, artSlotMainKeys.circlet),
  })
  .catch({
    sands: [...artSlotMainKeys.sands],
    goblet: [...artSlotMainKeys.goblet],
    circlet: [...artSlotMainKeys.circlet],
  })
  .transform((val) => {
    // Ensure arrays are not empty
    if (!val.sands.length) val.sands = [...artSlotMainKeys.sands]
    if (!val.goblet.length) val.goblet = [...artSlotMainKeys.goblet]
    if (!val.circlet.length) val.circlet = [...artSlotMainKeys.circlet]
    return val
  })

const optConfigSchema = z.object({
  artSetExclusion: artSetExclusionSchema.catch({}),
  statFilters: statFiltersSchema,
  mainStatKeys: mainStatKeysSchema,
  excludedLocations: zodFilteredArray(allLocationCharacterKeys, []),
  artExclusion: z.array(z.string()).catch([]),
  useExcludedArts: zodBoolean(),
  optimizationTarget: z.array(z.string()).optional().catch(undefined),
  mainStatAssumptionLevel: zodClampedNumber(0, 20, 0),
  allowPartial: zodBoolean(),
  maxBuildsToShow: zodNumericLiteralWithDefault(
    maxBuildsToShowList,
    maxBuildsToShowDefault
  ),
  plotBase: z.array(z.string()).optional().catch(undefined),
  compareBuild: zodBoolean(true),
  levelLow: zodClampedNumber(0, 20, defaultOptArtifactLevel),
  levelHigh: zodClampedNumber(0, 20, defaultOptArtifactLevel),
  useTeammateBuild: zodBoolean(),
  generatedBuildListId: z.string().optional().catch(undefined),
  upOptLevelLow: zodClampedNumber(0, 20, 0),
  upOptLevelHigh: zodClampedNumber(0, 20, 19),
  upOptReshape: zodBoolean(),
  upOptReshapeRolls: zodClampedNumber(2, 4, 2),
  upOptDefine: zodBoolean(),
  upOptDefineSubstats: zodFilteredArray(allSubstatKeys, []),
})
export type OptConfig = z.infer<typeof optConfigSchema>

export class OptConfigDataManager extends DataManager<
  string,
  'optConfigs',
  OptConfig,
  OptConfig,
  ArtCharDatabase
> {
  constructor(database: ArtCharDatabase) {
    super(database, 'optConfigs')
    for (const key of this.database.storage.keys)
      if (key.startsWith('optConfig_') && !this.set(key, {}))
        this.database.storage.remove(key)
  }
  override validate(obj: unknown, key: string): OptConfig | undefined {
    const result = optConfigSchema.safeParse(obj)
    if (!result.success) return undefined

    const { ...data } = result.data
    const { upOptReshapeRolls } = data
    let {
      artExclusion,
      excludedLocations,
      generatedBuildListId,
      levelLow,
      levelHigh,
      upOptLevelLow,
      upOptLevelHigh,
    } = data

    // Business logic: filter artExclusion to only IDs that exist in database
    artExclusion = [...new Set(artExclusion)].filter((id) =>
      this.database.arts.keys.includes(id)
    )

    // Business logic: filter excludedLocations to valid chars, exclude self
    excludedLocations = excludedLocations
      .filter((k) => k !== key) // Remove self from list
      .filter(
        (lk) =>
          this.database.chars.get(
            this.database.chars.LocationToCharacterKey(lk)
          ) // Remove characters who do not exist in the DB
      )

    // Business logic: validate generatedBuildListId exists in database
    if (
      generatedBuildListId &&
      !this.database.generatedBuildList.get(generatedBuildListId)
    )
      generatedBuildListId = undefined

    // Business logic: don't allow 2 opt configs to have the same build list
    if (
      generatedBuildListId &&
      this.entries.some(
        ([otherKey, otherConfig]) =>
          key !== otherKey &&
          otherConfig.generatedBuildListId === generatedBuildListId
      )
    )
      generatedBuildListId = undefined

    // Business logic: ensure levelLow <= levelHigh
    levelLow = clamp(levelLow, levelLow, levelHigh)
    levelHigh = clamp(levelHigh, levelLow, levelHigh)

    // Business logic: ensure upOptLevelLow <= upOptLevelHigh
    upOptLevelLow = clamp(upOptLevelLow, upOptLevelLow, upOptLevelHigh)
    upOptLevelHigh = clamp(upOptLevelHigh, upOptLevelLow, upOptLevelHigh)

    return {
      ...data,
      artExclusion,
      excludedLocations,
      generatedBuildListId,
      levelLow,
      levelHigh,
      upOptLevelLow,
      upOptLevelHigh,
      upOptReshapeRolls,
    }
  }
  new(data: Partial<OptConfig> = {}) {
    const id = this.generateKey()
    this.set(id, { ...initialBuildSettings(), ...data })
    return id
  }
  duplicate(optConfigId: string): string {
    const optConfig = this.get(optConfigId)
    if (!optConfig) return ''
    return this.new(structuredClone(optConfig))
  }
  export(optConfigId: string, overrideOptTarget?: string[]): object {
    const optConfig = this.database.optConfigs.get(optConfigId)
    if (!optConfig) return {}
    const {
      // remove user-specific data
      useExcludedArts,
      excludedLocations,
      artExclusion,
      generatedBuildListId,
      ...rest
    } = optConfig
    if (!overrideOptTarget) return rest
    return {
      ...rest,
      optimizationTarget: overrideOptTarget,
    }
  }
  import(data: object): string {
    const id = this.generateKey()
    if (!this.set(id, data)) return ''
    return id
  }
  newOrSetGeneratedBuildList(optConfigId: string, list: GeneratedBuildList) {
    const optConfig = this.get(optConfigId)

    if (!optConfig) {
      console.warn(`OptConfig not found for ID: ${optConfigId}`)
      return false
    }

    const listId = optConfig.generatedBuildListId
    const generatedBuildList =
      listId && this.database.generatedBuildList.get(listId)

    if (listId && generatedBuildList) {
      return this.database.generatedBuildList.set(listId, list)
    } else {
      return this.database.optConfigs.set(optConfigId, {
        generatedBuildListId: this.database.generatedBuildList.new(list),
      })
    }
  }
}

const initialBuildSettings = (): OptConfig =>
  deepFreeze(optConfigSchema.parse({}))

export function handleArtSetExclusion(
  currentArtSetExclusion: ArtSetExclusion,
  setKey: ArtSetExclusionKey,
  num: 2 | 4
) {
  const artSetExclusion = deepClone(currentArtSetExclusion)
  const setExclusion = artSetExclusion[setKey]
  if (!setExclusion) artSetExclusion[setKey] = [num]
  else if (!setExclusion.includes(num))
    artSetExclusion[setKey] = [...setExclusion, num]
  else {
    artSetExclusion[setKey] = setExclusion.filter((n: 2 | 4) => n !== num)
    if (!setExclusion.length) delete artSetExclusion[setKey]
  }
  return artSetExclusion
}
