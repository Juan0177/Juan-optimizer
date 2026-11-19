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
  const { artifacts, weapons, builds } = undo
  return (
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
  database.teams.set(teamId, { equipmentUndo: undefined })
  return true
}

/**
 * Puts the result on the team: a member on its equipped build gets the artifacts equipped (they
 * move from whoever has them, as when equipping from the optimizer); a member on a saved build
 * gets that build updated.
 */
export function equipTeamResult(
  database: ArtCharDatabase,
  teamId: string,
  result: TeamOptResult
) {
  const artsBefore = database.arts.values
  const weaponsBefore = database.weapons.values
  const builds: EquipmentUndo['builds'] = {}
  for (const member of changedMembers(database, teamId, result)) {
    const build = result.builds[member.characterKey]!
    const { loadoutDatum, characterKey, location } = member
    const weaponId = result.weapons?.[characterKey]
    if (loadoutDatum.buildType === 'real' && loadoutDatum.buildId) {
      const before = buildGear(database, loadoutDatum.buildId)
      database.builds.set(loadoutDatum.buildId, {
        artifactIds: build,
        ...(weaponId ? { weaponId } : {}),
      })
      const after = buildGear(database, loadoutDatum.buildId)
      if (before && after) builds[loadoutDatum.buildId] = { before, after }
      continue
    }
    // (equipping moves the weapon from whoever wields it, like the artifacts below)
    if (weaponId && weaponId !== member.weaponId)
      database.weapons.set(weaponId, { location })
    const char = database.chars.get(characterKey)
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
    Object.keys(builds).length
  )
    database.teams.set(teamId, {
      equipmentUndo: { artifacts, weapons, builds },
    })
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
  for (const member of changedMembers(database, teamId, result)) {
    const { characterKey, teamCharId, loadoutDatum } = member
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
    database.teams.setLoadoutDatum(teamId, teamCharId, {
      buildType: 'real',
      buildId,
    })
  }
}
