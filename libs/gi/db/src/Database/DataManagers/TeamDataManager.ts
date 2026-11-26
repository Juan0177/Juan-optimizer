import { DBLocalStorage } from '@genshin-optimizer/common/database'
import {
  deepClone,
  objKeyMap,
  objMap,
  range,
} from '@genshin-optimizer/common/util'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  MainStatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  allCharacterKeys,
  allElementWithPhyKeys,
  type CharacterKey,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type { IGOOD } from '@genshin-optimizer/gi/good'
import type { EleEnemyResKey } from '@genshin-optimizer/gi/keymap'
import type { ArtCharDatabase } from '../ArtCharDatabase'
import { DataManager } from '../DataManager'
import type { IGO, ImportResult } from '../exim'
import type { ICachedArtifact } from './ArtifactDataManager'
import type { TeamFightSettings } from './TeamEnemy'
import { MAX_ENEMY_HP, validateFightSettings } from './TeamEnemy'
import {
  type TeamEquipmentUndo,
  teamEquipmentUndoSchema,
} from './TeamEquipmentUndo'
import type { TeamOpt } from './TeamOpt'
import { validateTeamOpt } from './TeamOpt'
import {
  legacyRotationKey,
  legacyRotationMembers,
  readRotationObject,
} from './TeamRotationMigration'
import type { ICachedWeapon } from './WeaponDataManager'
import { defaultInitialWeapon } from './WeaponDataManager'

export const rotationDocumentFields = [
  'Text',
  'Draft',
  'Opener',
  'OpenerDraft',
  'Timing',
  'Cons',
  'Copied',
  'Played',
  'Manual',
  'UseAttacks',
  'ConstellationRotations',
  'CombinationRotations',
] as const
export type RotationDocumentField = (typeof rotationDocumentFields)[number]
type RotationDocument = Partial<Record<RotationDocumentField, string>>
type RotationDocuments = {
  inventory?: RotationDocument
  kqm?: RotationDocument
}

function validateRotationDocuments(
  value: RotationDocuments | undefined
): RotationDocuments {
  const documents: RotationDocuments = {}
  for (const mode of ['inventory', 'kqm'] as const) {
    const document = value?.[mode]
    if (!document) continue
    const fields: RotationDocument = {}
    for (const field of rotationDocumentFields)
      if (typeof document[field] === 'string') fields[field] = document[field]
    if (Object.keys(fields).length) documents[mode] = fields
  }
  return documents
}

const buildTypeKeys = ['equipped', 'real', 'tc'] as const
type BuildTypeKey = (typeof buildTypeKeys)[number]
export type LoadoutDatum = {
  teamCharId: string
  buildType: BuildTypeKey
  buildId: string
  buildTcId: string
  compare: boolean
  compareType: BuildTypeKey
  compareBuildId: string
  compareBuildTcId: string
}
export interface Team {
  name: string
  description: string

  enemyOverride: Partial<
    Record<
      EleEnemyResKey | 'enemyLevel' | 'enemyDefRed_' | 'enemyDefIgn_',
      number
    >
  >
  conditional: {
    resonance: { [key: string]: string }
    reaction: { [key: string]: string }
  }
  loadoutData: Array<LoadoutDatum | undefined>
  lastEdit: number
  rotationDocuments?: RotationDocuments
  equipmentUndo?: TeamEquipmentUndo
  /** Team Optimize settings: only stored once the user sets something there */
  teamOpt?: TeamOpt
  /**
   * The enemy preset last applied (a Stygian Onslaught boss: `stygian:<boss>:<phase>`): shown by
   * name while `enemyOverride` still has its RES
   */
  enemyPreset?: string
  /**
   * The enemy's HP, when it is set by hand (a Stygian Onslaught boss's is its preset's): how long
   * the team takes to defeat it
   */
  enemyHp?: number
  /** How the team plays a boss's mechanics where its fight cannot tell (the Moongecko's) */
  fightSettings?: TeamFightSettings
  /** The enemy can't be frozen (see `TeamEnemy.freezeImmune`) */
  freezeImmune?: boolean
  /**
   * The team this one is a version of (KQM's versions: one or two members swapped, compared under
   * the original's settings): the original's id. Absent: not a version
   */
  versionOf?: string
  /** A version's own constellations, over the original's KQM ones (the rest are shared) */
  versionCons?: Partial<Record<CharacterKey, number>>
  /**
   * Whether a version is also shown on the main Teams tab (absent/false: hidden there so versions
   * stay in their original's Versions panel without cluttering the Teams list)
   */
  showInTeams?: boolean
  /**
   * Imported from a team link (another site's): its members start on that site's builds as
   * theorycraft builds, and Optimize team switches the members the player has to their own gear
   */
  importedFrom?: {
    name?: string
    url?: string
    /** The characters the player did not have: the import added them (not theirs until built) */
    added?: CharacterKey[]
  }
}
export type { TeamFightSettings } from './TeamEnemy'
export { MAX_ENEMY_HP, validateFightSettings } from './TeamEnemy'
export type LoadoutExportSetting = {
  convertEquipped: boolean
  convertbuilds: string[]
  convertTcBuilds: string[]
  exportCustomMultiTarget: number[]
}
export const defLoadoutExportSetting = (): LoadoutExportSetting => ({
  convertEquipped: false,
  convertbuilds: [],
  convertTcBuilds: [],
  exportCustomMultiTarget: [],
})
export type LoadoutDataExportSetting = Array<LoadoutExportSetting>
export class TeamDataManager extends DataManager<
  string,
  'teams',
  Team,
  Team,
  ArtCharDatabase
> {
  constructor(database: ArtCharDatabase) {
    super(database, 'teams')
    for (const key of this.database.storage.keys)
      if (key.startsWith('team_') && !this.set(key, {}))
        this.database.storage.remove(key)
  }
  /** "Team N": the first number from (team count + 1) that no team is named with yet */
  newName() {
    const names = new Set(this.values.map((team) => team.name))
    let num = this.values.length + 1
    while (names.has(`Team ${num}`)) num++
    return `Team ${num}`
  }
  override validate(obj: unknown, key = ''): Team | undefined {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined
    let {
      name,
      description,
      enemyOverride,
      conditional,
      loadoutData,
      lastEdit,
    } = obj as Team
    if (typeof name !== 'string') name = this.newName()
    if (typeof description !== 'string') description = ''
    // validate enemyOverride
    if (
      !enemyOverride ||
      typeof enemyOverride !== 'object' ||
      Array.isArray(enemyOverride)
    )
      enemyOverride = {}

    if (typeof enemyOverride.enemyLevel !== 'number')
      enemyOverride.enemyLevel = 100

    if (typeof enemyOverride.enemyDefRed_ !== 'number')
      enemyOverride.enemyDefRed_ = 0

    if (typeof enemyOverride.enemyDefIgn_ !== 'number')
      enemyOverride.enemyDefIgn_ = 0

    allElementWithPhyKeys.map((ele) => {
      const key = `${ele}_enemyRes_` as EleEnemyResKey
      if (typeof enemyOverride[key] !== 'number') enemyOverride[key] = 10
    })

    const conditions = (value: object | undefined) =>
      Object.fromEntries(
        Object.entries(value ?? {}).filter(([, v]) => typeof v === 'string')
      )
    conditional = {
      resonance: conditions(conditional?.resonance),
      reaction: conditions(conditional?.reaction),
    }
    // validate teamCharIds
    if (!Array.isArray(loadoutData))
      loadoutData = range(0, 3).map(() => undefined)

    loadoutData = range(0, 3).map((ind) => {
      const loadoutDatum = loadoutData[ind]
      if (!loadoutDatum || typeof loadoutDatum !== 'object') return undefined
      const { teamCharId } = loadoutDatum
      let {
        buildType,
        buildId,
        buildTcId,
        compare,
        compareType,
        compareBuildId,
        compareBuildTcId,
      } = loadoutDatum
      const teamChar = this.database.teamChars.get(teamCharId)
      if (!teamChar) return undefined

      if (!buildTypeKeys.includes(buildType)) buildType = 'equipped'
      const build = this.database.builds.get(buildId)
      if (
        typeof buildId !== 'string' ||
        !build ||
        build.characterKey !== teamChar.key
      )
        buildId = ''

      const buildTc = this.database.buildTcs.get(buildTcId)
      if (
        typeof buildTcId !== 'string' ||
        !buildTc ||
        buildTc.characterKey !== teamChar.key
      )
        buildTcId = ''

      if (
        (!buildId && !buildTcId) ||
        (buildType === 'real' && !buildId) ||
        (buildType === 'tc' && !buildTcId)
      )
        buildType = 'equipped'

      if (typeof compare !== 'boolean') compare = false
      if (!buildTypeKeys.includes(compareType)) compareType = 'equipped'

      if (
        typeof compareBuildId !== 'string' ||
        !this.database.builds.get(compareBuildId) ||
        this.database.builds.get(compareBuildId)?.characterKey !==
          teamChar.key ||
        !this.database.builds.get(compareBuildId)?.weaponId
      ) {
        compareBuildId = ''
        if (compareType === 'real') compareType = 'equipped'
      }

      const compareBuildTc = this.database.buildTcs.get(compareBuildTcId)
      if (
        typeof compareBuildTcId !== 'string' ||
        !compareBuildTc ||
        compareBuildTc.characterKey !== teamChar.key
      ) {
        compareBuildTcId = ''
        if (compareType === 'tc') compareType = 'equipped'
      }

      return {
        teamCharId,
        buildType,
        buildId,
        buildTcId,
        compare,
        compareType,
        compareBuildId,
        compareBuildTcId,
      } as LoadoutDatum
    })

    // make sure there isnt a team without "Active" character, by shifting characters forward.
    if (!loadoutData[0] && loadoutData.some((loadoutData) => loadoutData)) {
      const index = loadoutData.findIndex((loadoutData) => !!loadoutData)
      loadoutData[0] = loadoutData[index]
      loadoutData[index] = undefined
    }

    if (typeof lastEdit !== 'number') lastEdit = Date.now()

    // optional: a team without Team Optimize settings stays without the field
    const teamOpt = validateTeamOpt((obj as Team).teamOpt)
    const {
      enemyPreset,
      enemyHp,
      versionOf,
      versionCons,
      showInTeams,
      importedFrom,
      freezeImmune,
    } = obj as Team
    const fightSettings = validateFightSettings((obj as Team).fightSettings)

    const validated: Team = {
      name,
      description,
      enemyOverride,
      conditional,
      loadoutData,
      lastEdit,
      ...(teamOpt ? { teamOpt } : {}),
      ...(typeof enemyPreset === 'string' &&
      enemyPreset.length > 0 &&
      enemyPreset.length <= 64
        ? { enemyPreset }
        : {}),
      ...(typeof enemyHp === 'number' &&
      Number.isFinite(enemyHp) &&
      enemyHp >= 1 &&
      enemyHp <= MAX_ENEMY_HP
        ? { enemyHp: Math.round(enemyHp) }
        : {}),
      ...(fightSettings ? { fightSettings } : {}),
      ...(typeof freezeImmune === 'boolean' ? { freezeImmune } : {}),
      ...(typeof versionOf === 'string' &&
      versionOf.startsWith('team_') &&
      versionOf.length <= 64 &&
      versionOf !== key
        ? { versionOf }
        : {}),
    }
    if (validated.versionOf && showInTeams === true)
      validated.showInTeams = true
    if (importedFrom && typeof importedFrom === 'object') {
      const text = (v: unknown, max: number) =>
        typeof v === 'string' && v.length <= max ? v : undefined
      const name = text(importedFrom.name, 60)
      const url = text(importedFrom.url, 500)
      const added = Array.isArray(importedFrom.added)
        ? importedFrom.added.filter((k) => allCharacterKeys.includes(k))
        : []
      validated.importedFrom = {
        ...(name ? { name } : {}),
        ...(url?.startsWith('https://') ? { url } : {}),
        ...(added.length ? { added } : {}),
      }
    }
    if (validated.versionOf && versionCons && typeof versionCons === 'object') {
      const cons = Object.fromEntries(
        Object.entries(versionCons).filter(
          ([k, n]) =>
            allCharacterKeys.includes(k as CharacterKey) &&
            Number.isInteger(n) &&
            (n as number) >= 0 &&
            (n as number) <= 6
        )
      )
      if (Object.keys(cons).length) validated.versionCons = cons
    }
    const equipmentUndo = teamEquipmentUndoSchema.safeParse(
      (obj as Team).equipmentUndo
    )
    if (equipmentUndo.success) validated.equipmentUndo = equipmentUndo.data
    const rotationDocuments = validateRotationDocuments(
      (obj as Team).rotationDocuments
    )
    if (Object.keys(rotationDocuments).length)
      validated.rotationDocuments = rotationDocuments
    const previous = this.get(key)
    if (previous && previous.lastEdit === lastEdit) {
      const {
        lastEdit: _,
        id: _id,
        rotationDocuments: _documents,
        ...before
      } = this.deCache(previous) as Team & { id?: string }
      const {
        lastEdit: _next,
        rotationDocuments: _nextDocuments,
        ...after
      } = validated
      if (JSON.stringify(before) !== JSON.stringify(after))
        validated.lastEdit = Date.now()
    }
    return validated
  }

  /** Persist defaults filled in when a tab first opens without recording a user edit. */
  initializeSettings(teamId: string, update: (team: Team) => void) {
    const current = this.get(teamId)
    if (!current) return
    const next = structuredClone(this.deCache(current))
    update(next)
    const validated = this.validate(next)
    const cached = validated && this.toCache(validated, teamId)
    if (cached) this.setCached(teamId, cached)
  }

  getRotationField(rotationId: string, field: RotationDocumentField) {
    const kqm = rotationId.endsWith('_kqm')
    const teamId = kqm ? rotationId.slice(0, -4) : rotationId
    return this.get(teamId)?.rotationDocuments?.[kqm ? 'kqm' : 'inventory']?.[
      field
    ]
  }

  setRotationField(
    rotationId: string,
    field: RotationDocumentField,
    value: string | null
  ) {
    const kqm = rotationId.endsWith('_kqm')
    const teamId = kqm ? rotationId.slice(0, -4) : rotationId
    const mode = kqm ? 'kqm' : 'inventory'
    if (
      !this.get(teamId) ||
      this.getRotationField(rotationId, field) === (value ?? undefined)
    )
      return
    this.set(teamId, (team) => {
      const document = ((team.rotationDocuments ??= {})[mode] ??= {})
      if (value === null) delete document[field]
      else document[field] = value
    })
  }

  /** Stage old rotations and report which source entries are ready to delete after saving. */
  migrateLocalRotations(
    storage: Storage,
    extraTeams: readonly TeamDataManager[] = []
  ) {
    const managers = [this, ...extraTeams]
    type Entry = NonNullable<ReturnType<typeof legacyRotationKey>> & {
      key: string
      raw: string
      local: boolean
    }
    const groups = new Map<string, Entry[]>()
    const add = (key: string, local: boolean) => {
      const rotation = legacyRotationKey(key)
      if (!rotation) return
      const raw = local
        ? storage.getItem(key)
        : this.database.storage.getString(key)
      if (raw == null) return
      const id = rotation.kqm ? `${rotation.teamId}_kqm` : rotation.teamId
      const group = groups.get(id) ?? []
      group.push({ ...rotation, key, raw, local })
      groups.set(id, group)
    }
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key) add(key, true)
    }
    // Older storage upgrades also moved the legacy constellation keys into the app database.
    if (!(this.database.storage instanceof DBLocalStorage))
      for (const key of this.database.storage.keys) add(key, false)

    const migrated: Entry[] = []
    const destinations = new Set<TeamDataManager>()
    for (const [id, group] of groups) {
      const teamId = group[0]!.teamId
      const members = legacyRotationMembers(group)
      const slots = managers.filter((manager) => manager.get(teamId))
      // (no slot has the team: it was deleted, and its rotation went with it)
      if (!slots.length) {
        migrated.push(...group)
        continue
      }
      const candidates = slots.filter((manager) => {
        const team = manager.get(teamId)!
        const roster = new Set(
          team.loadoutData.flatMap((datum) => {
            const key =
              datum && manager.database.teamChars.get(datum.teamCharId)?.key
            return key ? [key as string] : []
          })
        )
        return [...members].every((member) => roster.has(member))
      })
      // The old keys were shared by every database slot, so each slot with this team ID showed
      // the rotation: it goes to the ones whose roster has the members it names, or else to them all
      const owners = members.size && candidates.length ? candidates : slots
      for (const entry of group) {
        const { field, raw, character } = entry
        for (const owner of owners) {
          const existing = owner.getRotationField(id, field)
          let value = raw
          // (what the team already has is newer than the old copy: it stays)
          if (character) {
            const all = readRotationObject(existing) ?? {}
            const rotation = readRotationObject(raw)
            value =
              !rotation || all[character] !== undefined
                ? (existing ?? '{}')
                : JSON.stringify({ ...all, [character]: rotation })
          } else if (existing !== undefined) value = existing
          if (existing !== value) owner.setRotationField(id, field, value)
          destinations.add(owner)
        }
        migrated.push(entry)
      }
    }
    return { migrated, destinations }
  }

  override remove(key: string, notify = true) {
    const removed = super.remove(key, notify)
    if (removed) {
      this.database.teamOptResults?.setRun(key, undefined)
      this.database.teamKqmResults?.setRun(key, undefined)
      this.database.teamKqmResults?.setSummary(key, undefined)
      // (its versions stay, as teams of their own)
      for (const id of this.keys)
        if (this.get(id)?.versionOf === key)
          this.set(id, (team) => {
            delete team.versionOf
            delete team.showInTeams
          })
    }
    return removed
  }
  /** True when this team is a version whose original exists and is not pinned to the Teams tab */
  isHiddenVersion(teamId: string): boolean {
    const team = this.get(teamId)
    return !!(team?.versionOf && this.get(team.versionOf) && !team.showInTeams)
  }
  new(value: Partial<Team> = {}): string {
    const id = `team_${crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) => n.toString(16).padStart(2, '0')).join('')}`
    return this.set(id, value) ? id : ''
  }
  override clear(): void {
    super.clear()
  }

  duplicate(teamId: string): string {
    const teamRaw = this.database.teams.get(teamId)
    if (!teamRaw) return ''
    const team = deepClone(teamRaw)
    team.name = `${team.name} (duplicated)`
    team.lastEdit = Date.now()
    delete team.equipmentUndo
    for (const document of Object.values(team.rotationDocuments ?? {}))
      delete document.Draft
    return this.new(team)
  }
  export(
    teamId: string,
    loadoutDataExportSetting: LoadoutDataExportSetting
  ): object {
    const team = this.database.teams.get(teamId)
    if (!team) return {}
    const {
      loadoutData,
      rotationDocuments,
      equipmentUndo: _undo,
      // (an id of this database's: a team exported alone is not a version)
      versionOf: _versionOf,
      versionCons: _versionCons,
      showInTeams: _showInTeams,
      ...rest
    } = this.deCache(team)
    const documents = deepClone(rotationDocuments ?? {})
    for (const document of Object.values(documents)) delete document.Draft
    return {
      teamExportVersion: 2,
      rotationDocuments: documents,
      ...rest,
      loadoutData: loadoutData.map(
        (loadoutData, i) =>
          loadoutData?.teamCharId &&
          this.database.teamChars.export(
            loadoutData?.teamCharId,
            loadoutDataExportSetting[i]
          )
      ),
    }
  }
  import(data: unknown): string {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
    const { loadoutData, ...rest } = structuredClone(data) as Omit<
      Partial<Team>,
      'loadoutData'
    > & {
      loadoutData?: unknown
      teamExportVersion?: number
    }
    if (
      !Array.isArray(loadoutData) ||
      loadoutData.length > 4 ||
      (rest.teamExportVersion !== undefined && rest.teamExportVersion !== 2)
    )
      return ''
    const roster = new Set<CharacterKey>()
    for (const entry of loadoutData) {
      if (entry == null) continue
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ''
      const { key, customMultiTargets, buildTcs, optConfig } = entry
      if (
        !allCharacterKeys.includes(key) ||
        roster.has(key) ||
        (customMultiTargets != null && !Array.isArray(customMultiTargets)) ||
        (buildTcs != null &&
          (!Array.isArray(buildTcs) ||
            buildTcs.some(
              (build) =>
                !build ||
                typeof build !== 'object' ||
                Array.isArray(build) ||
                !this.database.buildTcs.validate({
                  ...build,
                  characterKey: key,
                })
            ))) ||
        (optConfig != null &&
          (typeof optConfig !== 'object' || Array.isArray(optConfig)))
      )
        return ''
      roster.add(key)
    }
    // Validate the team itself before importing its loadouts, which create database records.
    const team = this.validate(
      {
        ...rest,
        equipmentUndo: undefined,
        versionOf: undefined,
        versionCons: undefined,
        showInTeams: undefined,
        loadoutData: [],
      },
      ''
    )
    if (!team) return ''
    return this.new({
      ...team,
      name: `${typeof rest.name === 'string' ? rest.name : team.name} (Imported)`,
      lastEdit: Date.now(),
      loadoutData: loadoutData.map((entry) =>
        entry == null
          ? undefined
          : ({
              teamCharId: this.database.teamChars.import(entry),
            } as LoadoutDatum)
      ),
    })
  }
  override importGOOD(good: IGOOD & IGO, result: ImportResult): void {
    result.teams.beforeImport = this.entries.length

    const teams = good[this.dataKey]
    if (teams && Array.isArray(teams)) {
      result.teams.import = teams.length
    }

    super.importGOOD(good, result)
  }

  getActiveTeamChar(teamId: string) {
    const team = this.database.teams.get(teamId)
    const teamCharId = team?.loadoutData[0]?.teamCharId
    return this.database.teamChars.get(teamCharId)
  }

  /**
   *
   * @param teamCharId
   */
  getLoadoutWeaponId({
    buildType,
    buildId,
    teamCharId,
  }: LoadoutDatum): string | undefined {
    return this.#getWeaponId(teamCharId, buildType, buildId)
  }

  getEditWeaponId(buildToEdit: string, teamCharId: string): string | undefined {
    const editType = buildToEdit === 'equipped' ? 'equipped' : 'real'
    return this.#getWeaponId(teamCharId, editType, buildToEdit)
  }

  #getWeaponId(
    teamCharId: string,
    buildType: BuildTypeKey,
    buildId: string
  ): string | undefined {
    const teamChar = this.database.teamChars.get(teamCharId)
    if (!teamChar) return undefined
    const { key: characterKey } = teamChar
    switch (buildType) {
      case 'equipped': {
        const char = this.database.chars.get(characterKey)
        if (!char) return undefined
        return char.equippedWeapon
      }
      case 'real': {
        const build = this.database.builds.get(buildId)
        if (!build) return undefined
        return build.weaponId
      }
    }
    return undefined
  }

  /**
   *
   * @param teamCharId
   * @returns a ICached weapon, because in WR a lack of a weapon can have strange effects
   */
  getLoadoutWeapon(loadoutDatum: LoadoutDatum): ICachedWeapon {
    const { buildType, buildTcId, teamCharId } = loadoutDatum
    const teamChar = this.database.teamChars.get(teamCharId)
    if (!teamChar) return defaultInitialWeapon()
    if (buildType === 'tc') {
      const buildTc = this.database.buildTcs.get(buildTcId)
      if (!buildTc) return defaultInitialWeapon()
      return {
        ...buildTc.weapon,
        location: charKeyToLocCharKey(teamChar.key),
        lock: false,
        id: 'invalid',
      }
    }
    return (
      this.database.weapons.get(this.getLoadoutWeaponId(loadoutDatum)) ??
      defaultInitialWeapon()
    )
  }
  getLoadoutDatum(teamId: string, teamCharId: string) {
    const team = this.get(teamId)
    if (!team) return undefined
    return team.loadoutData.find(
      (loadoutDatum) => loadoutDatum?.teamCharId === teamCharId
    )
  }
  setLoadoutDatum(
    teamId: string,
    teamCharId: string,
    data: Partial<LoadoutDatum>
  ) {
    this.set(teamId, (team) => {
      const loadoutDataInd = team.loadoutData.findIndex(
        (loadoutDatum) => loadoutDatum && loadoutDatum.teamCharId === teamCharId
      )
      if (loadoutDataInd < 0) return

      team.loadoutData[loadoutDataInd]! = {
        ...team.loadoutData[loadoutDataInd]!,
        ...data,
      }
    })
  }

  /**
   * Note: this doesnt return any artifacts(all undefined) when the current teamchar is using a TC Build.
   */
  getLoadoutArtifactIds({
    buildType,
    buildId,
    teamCharId,
  }: LoadoutDatum): Record<ArtifactSlotKey, string | undefined> {
    return this.#getArtifactIds(teamCharId, buildType, buildId)
  }

  getEditArtifactIds(
    buildToEdit: string | 'equipped',
    teamCharId: string
  ): Record<ArtifactSlotKey, string | undefined> {
    const editType = buildToEdit === 'equipped' ? 'equipped' : 'real'
    return this.#getArtifactIds(teamCharId, editType, buildToEdit)
  }

  #getArtifactIds(
    teamCharId: string,
    buildType: BuildTypeKey,
    buildId: string
  ): Record<ArtifactSlotKey, string | undefined> {
    const teamChar = this.database.teamChars.get(teamCharId)
    if (!teamChar) return objKeyMap(allArtifactSlotKeys, () => undefined)
    const { key: characterKey } = teamChar
    switch (buildType) {
      case 'equipped': {
        const char = this.database.chars.get(characterKey)
        if (!char) return objKeyMap(allArtifactSlotKeys, () => undefined)
        return char.equippedArtifacts
      }
      case 'real': {
        const build = this.database.builds.get(buildId)
        if (!build) return objKeyMap(allArtifactSlotKeys, () => undefined)
        return build.artifactIds
      }
    }
    return objKeyMap(allArtifactSlotKeys, () => undefined)
  }

  /**
   * Note: this doesnt return any artifacts(all undefined) when the current teamchar is using a TC Build.
   */
  getLoadoutArtifacts(
    loadouDatum: LoadoutDatum
  ): Record<ArtifactSlotKey, ICachedArtifact | undefined> {
    const artIds = this.getLoadoutArtifactIds(loadouDatum)
    return objMap(artIds, (id) => this.database.arts.get(id))
  }
  getLoadoutArtifactData(loadoutDatum: LoadoutDatum): ArtifactData {
    const { buildType, buildTcId } = loadoutDatum
    if (buildType === 'tc') {
      const buildTc = this.database.buildTcs.get(buildTcId)
      if (!buildTc) return { setNum: {}, mains: {} }
      return {
        setNum: buildTc.artifact.sets,
        mains: {
          sands: buildTc.artifact.slots.sands.statKey,
          goblet: buildTc.artifact.slots.goblet.statKey,
          circlet: buildTc.artifact.slots.circlet.statKey,
        },
      }
    }
    const artifacts = this.getLoadoutArtifacts(loadoutDatum)
    return {
      setNum: Object.values(artifacts).reduce(
        (acc, art) => {
          if (!art) return acc
          acc[art.setKey] = (acc[art.setKey] ?? 0) + 1
          return acc
        },
        {} as Exclude<ArtifactData['setNum'], undefined>
      ),
      mains: {
        sands: artifacts.sands?.mainStatKey,
        goblet: artifacts.goblet?.mainStatKey,
        circlet: artifacts.circlet?.mainStatKey,
      },
    }
  }

  followLoadoutDatum(
    { buildType, buildId, buildTcId }: LoadoutDatum,
    callback: () => void
  ) {
    if (buildType === 'real') {
      const build = this.database.builds.get(buildId)
      if (!build) return () => {}
      const unfollowBuild = this.database.builds.follow(buildId, callback)
      const unfollowWeapon = build.weaponId
        ? this.database.weapons.follow(build.weaponId, callback)
        : () => {}
      const unfollowArts = Object.values(build.artifactIds).map((id) =>
        id ? this.database.arts.follow(id, callback) : () => {}
      )
      return () => {
        unfollowBuild()
        unfollowWeapon()
        unfollowArts.forEach((unfollow) => unfollow())
      }
    } else if (buildType === 'tc')
      return this.database.buildTcs.follow(buildTcId, callback)
    return () => {}
  }
  followLoadoutDatumCompare(
    { compareType, compareBuildId, compareBuildTcId }: LoadoutDatum,
    callback: () => void
  ) {
    if (compareType === 'real') {
      const build = this.database.builds.get(compareBuildId)
      if (!build) return () => {}
      const unfollowBuild = this.database.builds.follow(
        compareBuildId,
        callback
      )
      const unfollowWeapon = build.weaponId
        ? this.database.weapons.follow(build.weaponId, callback)
        : () => {}
      const unfollowArts = Object.values(build.artifactIds).map((id) =>
        id ? this.database.arts.follow(id, callback) : () => {}
      )
      return () => {
        unfollowBuild()
        unfollowWeapon()
        unfollowArts.forEach((unfollow) => unfollow())
      }
    } else if (compareType === 'tc')
      return this.database.buildTcs.follow(compareBuildTcId, callback)
    return () => {}
  }
  getActiveBuildName(
    { buildType, buildId, buildTcId }: LoadoutDatum,
    equippedName = 'Equipped Build'
  ) {
    switch (buildType) {
      case 'equipped':
        return equippedName
      case 'real':
        return this.database.builds.get(buildId)?.name ?? ''
      case 'tc':
        return this.database.buildTcs.get(buildTcId)?.name ?? ''
    }
  }
}
export type ArtifactData = {
  setNum?: Partial<Record<ArtifactSetKey, number>>
  mains?: { sands?: MainStatKey; goblet?: MainStatKey; circlet?: MainStatKey }
}
