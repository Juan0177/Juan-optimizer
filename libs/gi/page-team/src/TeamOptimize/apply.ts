import { objKeyMap } from '@genshin-optimizer/common/util'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, Team } from '@genshin-optimizer/gi/db'
import type { TeamOptResult } from '@genshin-optimizer/gi/ui'
import { teamOptMembers } from '@genshin-optimizer/gi/ui'

/** The optimized members whose build differs from what they have now */
export function changedMembers(
  database: ArtCharDatabase,
  teamId: string,
  result: TeamOptResult
) {
  return teamOptMembers(database, teamId).filter(
    ({ characterKey, artifactIds, weaponId }) => {
      const build = result.builds[characterKey]
      const weapon = result.weapons?.[characterKey]
      return (
        result.optimized.includes(characterKey) &&
        ((!!build &&
          allArtifactSlotKeys.some((s) => build[s] !== artifactIds[s])) ||
          (!!weapon && weapon !== weaponId))
      )
    }
  )
}

/**
 * The optimized members Equip changes: the result's gear is not what the character wears, or the
 * member is on a saved build (Equip puts it on its equipped build)
 */
export function equipChanges(
  database: ArtCharDatabase,
  teamId: string,
  result: TeamOptResult
) {
  return teamOptMembers(database, teamId).flatMap((member) => {
    const { characterKey, loadoutDatum, isTc } = member
    const build = result.builds[characterKey]
    if (isTc || !build || !result.optimized.includes(characterKey)) return []
    const char = database.chars.get(characterKey)
    const weaponId = result.weapons?.[characterKey] ?? member.weaponId
    const changed =
      loadoutDatum.buildType === 'real' ||
      allArtifactSlotKeys.some(
        (s) => (build[s] || '') !== (char?.equippedArtifacts[s] || '')
      ) ||
      (!!weaponId && weaponId !== char?.equippedWeapon)
    return changed ? [{ ...member, build, weaponId }] : []
  })
}

type EquipmentUndo = NonNullable<Team['equipmentUndo']>

function locationChanges<Location extends string>(
  before: ReadonlyArray<{ id: string; location: Location }>,
  get: (id: string) => { location: Location } | undefined
) {
  return Object.fromEntries(
    before.flatMap(({ id, location }) => {
      const after = get(id)?.location
      return after !== undefined && after !== location
        ? [[id, { before: location, after }] as const]
        : []
    })
  )
}

function buildGear(database: ArtCharDatabase, id: string) {
  const build = database.builds.get(id)
  if (!build) return undefined
  // Save the slots in a consistent order, including slots absent in a JSON backup.
  const artifactIds = objKeyMap(
    allArtifactSlotKeys,
    (slot) => build.artifactIds[slot]
  )
  return { artifactIds, weaponId: build.weaponId }
}

export function canUndoTeamEquip(
  database: ArtCharDatabase,
  undo: EquipmentUndo
) {
  const { artifacts, weapons, builds, loadouts = {} } = undo
  return (
    Object.values(loadouts).every(
      (buildId) => !!database.builds.get(buildId)
    ) &&
    Object.entries(artifacts).every(([id, change]) => {
      const art = database.arts.get(id)
      if (!art || art.location !== change.after) return false
      if (!change.before) return true
      const owner = database.chars.get(
        database.chars.LocationToCharacterKey(change.before)
      )
      if (!owner) return false
      const equipped = owner.equippedArtifacts[art.slotKey]
      return !equipped || artifacts[equipped]?.after === change.before
    }) &&
    Object.entries(weapons).every(
      ([id, change]) =>
        database.weapons.get(id)?.location === change.after &&
        (!change.before ||
          !!database.chars.get(
            database.chars.LocationToCharacterKey(change.before)
          ))
    ) &&
    Object.entries(builds).every(
      ([id, change]) =>
        JSON.stringify(buildGear(database, id)) ===
          JSON.stringify(change.after) &&
        Object.values(change.before.artifactIds).every(
          (artId) => !artId || database.arts.get(artId)
        ) &&
        (!change.before.weaponId ||
          database.weapons.get(change.before.weaponId))
    )
  )
}

export function undoTeamEquip(database: ArtCharDatabase, teamId: string) {
  const undo = database.teams.get(teamId)?.equipmentUndo
  if (!undo || !canUndoTeamEquip(database, undo)) return false
  for (const [id, { before }] of Object.entries(undo.artifacts))
    if (before) database.arts.set(id, { location: before })
  for (const [id, { before }] of Object.entries(undo.artifacts))
    if (!before) database.arts.set(id, { location: before })
  for (const [id, { before }] of Object.entries(undo.weapons))
    if (before) database.weapons.set(id, { location: before })
  for (const [id, { before }] of Object.entries(undo.builds))
    database.builds.set(id, before)
  for (const [teamCharId, buildId] of Object.entries(undo.loadouts ?? {}))
    database.teams.setLoadoutDatum(teamId, teamCharId, {
      buildType: 'real',
      buildId,
    })
  database.teams.set(teamId, { equipmentUndo: undefined })
  return true
}

/**
 * Puts the result on the team's characters: the artifacts and weapons move from whoever has them,
 * as when equipping from the optimizer, and a member on a saved build switches to its equipped
 * build (the saved build is left as it is).
 */
export function equipTeamResult(
  database: ArtCharDatabase,
  teamId: string,
  result: TeamOptResult
) {
  const artsBefore = database.arts.values
  const weaponsBefore = database.weapons.values
  const loadouts: NonNullable<EquipmentUndo['loadouts']> = {}
  for (const member of equipChanges(database, teamId, result)) {
    const { build, weaponId, loadoutDatum, characterKey, location } = member
    if (loadoutDatum.buildType === 'real') {
      if (loadoutDatum.buildId)
        loadouts[member.teamCharId] = loadoutDatum.buildId
      database.teams.setLoadoutDatum(teamId, member.teamCharId, {
        buildType: 'equipped',
      })
    }
    const char = database.chars.get(characterKey)
    if (weaponId && weaponId !== char?.equippedWeapon)
      database.weapons.set(weaponId, { location })
    for (const slotKey of allArtifactSlotKeys) {
      const id = build[slotKey]
      if (id) database.arts.set(id, { location })
      else {
        const old = char?.equippedArtifacts[slotKey]
        if (old && database.arts.get(old))
          database.arts.set(old, { location: '' })
      }
    }
  }
  const artifacts = locationChanges(artsBefore, (id) => database.arts.get(id))
  const weapons = locationChanges(weaponsBefore, (id) =>
    database.weapons.get(id)
  )
  if (
    Object.keys(artifacts).length ||
    Object.keys(weapons).length ||
    Object.keys(loadouts).length
  )
    database.teams.set(teamId, {
      equipmentUndo: { artifacts, weapons, builds: {}, loadouts },
    })
}

export const DEFAULT_BUILD_NAME_FORMAT = '{team} (team optimized)'

/**
 * Expands a saved build name format (supporting `{team}`) for a specific team.
 */
export function formatSavedBuildName(
  format: string,
  teamName: string,
  fallback = 'team optimized'
): string {
  const template = format.trim() || DEFAULT_BUILD_NAME_FORMAT
  const base = teamName.trim()
  const filled = template
    .replace(/\{team\}/gi, base)
    .replace(/\s{2,}/g, ' ')
    .trim()
  return filled || base || fallback
}

/**
 * Infers a reusable `{team}` format string from a user-edited build name so saving
 * as default carries cleanly across other teams.
 */
export function inferBuildNameFormat(
  buildName: string,
  teamName: string
): string {
  const trimmed = buildName.trim()
  const base = teamName.trim()
  if (!trimmed) return DEFAULT_BUILD_NAME_FORMAT
  if (base && trimmed.includes(base)) return trimmed.replace(base, '{team}')
  return trimmed
}

/**
 * Saves the result as a new build per member and switches the team to them: nothing is moved
 * between characters (the builds can be equipped later, from each member's build list).
 */
export function saveTeamResult(
  database: ArtCharDatabase,
  teamId: string,
  result: TeamOptResult,
  name: string
) {
  const saved: NonNullable<Team['savedOptimization']> = {}
  for (const member of changedMembers(database, teamId, result)) {
    const { characterKey, teamCharId, loadoutDatum } = member
    if (loadoutDatum.buildType === 'tc') continue
    const weaponId =
      result.weapons?.[characterKey] ??
      database.teams.getLoadoutWeaponId(loadoutDatum)
    const buildId = database.builds.new({
      characterKey,
      name,
      artifactIds: result.builds[characterKey]!,
      weaponId,
      srcTeamCharId: teamCharId,
    })
    if (buildId)
      saved[teamCharId] = {
        previousType: loadoutDatum.buildType,
        previousBuildId: loadoutDatum.buildId,
        savedBuildId: buildId,
      }
  }
  if (!Object.keys(saved).length) return
  database.teams.set(teamId, (team) => {
    team.savedOptimization = saved
    team.loadoutData = team.loadoutData.map((datum) => {
      const choice = datum && saved[datum.teamCharId]
      return datum && choice
        ? { ...datum, buildType: 'real', buildId: choice.savedBuildId }
        : datum
    })
  })
}

/** Restore the loadout selection. The saved builds are still available in the build list. */
export function restoreTeamBuilds(database: ArtCharDatabase, teamId: string) {
  const team = database.teams.get(teamId)
  const saved = team?.savedOptimization
  if (
    !team ||
    !saved ||
    !Object.entries(saved).every(
      ([id, change]) =>
        team.loadoutData.some(
          (datum) =>
            datum?.teamCharId === id &&
            datum.buildType === 'real' &&
            datum.buildId === change.savedBuildId
        ) &&
        (change.previousType === 'equipped' ||
          !!database.builds.get(change.previousBuildId))
    )
  )
    return false

  database.teams.set(teamId, (draft) => {
    draft.loadoutData = draft.loadoutData.map((datum) => {
      const change = datum && saved[datum.teamCharId]
      return datum && change
        ? {
            ...datum,
            buildType: change.previousType,
            buildId: change.previousBuildId,
          }
        : datum
    })
    delete draft.savedOptimization
  })
  return true
}
