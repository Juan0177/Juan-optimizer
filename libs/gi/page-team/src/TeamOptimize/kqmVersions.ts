import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { signatureWeapons } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  LoadoutDatum,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm, initTeamOpt } from '@genshin-optimizer/gi/db'
import {
  kqmMemberConstellation,
  mainPart,
  parseRotation,
  supportPart,
  swapRotationMembers,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import {
  applySavedRotation,
  kqmRotationId,
  memberNamesOf,
  setWrittenRotation,
  writtenRotationOf,
} from './RotationWriter'
import { sortedJson } from './useTeamOpt'

/**
 * The KQM settings a version takes from its original, so that versions compare like for like: the
 * artifact standard, weapons and sets, refinements, constellations, enemy and extra buffs. A
 * version keeps its own rotation, the switches its rotation sets, and the ER targets worked out
 * for it (the same way as the original's).
 */
export const KQM_SHARED = [
  'enemy',
  'talents',
  'fullSearch',
  'rolls',
  'memberRolls',
  'constellations',
  'refinement5',
  'refinement4',
  'refinementStandard5',
  'refinementBp',
  'refinementStandard4',
  'compareRefinements',
  'excludedWeapons',
  'weaponList',
  'refinements',
  'lockedWeapons',
  'excludedSets',
  'weaponEnergy',
  'bonusStats',
] as const satisfies readonly (keyof TeamOptKqm)[]

/** A team's own constellations over the family's (a version's) */
type OwnCons = Partial<Record<CharacterKey, number>>
const ownConsOf = (database: ArtCharDatabase, teamId: string): OwnCons =>
  database.teams.get(teamId)?.versionCons ?? {}

/**
 * The shared settings of `kqm`, its constellations made `cons` (absent: its own), the members
 * in `without` left out of them
 */
const sharedOf = (
  kqm: TeamOptKqm | undefined,
  { cons, without = {} }: { cons?: OwnCons; without?: OwnCons } = {}
) => {
  const shared = Object.fromEntries(
    KQM_SHARED.flatMap((key) =>
      kqm?.[key] === undefined ? [] : [[key, kqm[key]]]
    )
  ) as Partial<TeamOptKqm>
  const constellations: OwnCons = { ...(cons ?? kqm?.constellations ?? {}) }
  for (const k of Object.keys(constellations))
    if (constellations[k as CharacterKey] === undefined || k in without)
      delete constellations[k as CharacterKey]
  if (Object.keys(constellations).length) shared.constellations = constellations
  else delete shared.constellations
  return shared
}

/** The original of a team that is a version (one whose original is gone is its own) */
export function versionRoot(database: ArtCharDatabase, teamId: string) {
  const root = database.teams.get(teamId)?.versionOf
  return root && database.teams.get(root) ? root : teamId
}

/** An original's versions, oldest first */
export function versionsOf(database: ArtCharDatabase, rootId: string) {
  return database.teams.keys.filter(
    (id) => id !== rootId && database.teams.get(id)?.versionOf === rootId
  )
}

/**
 * What a version's run depends on from its original: the shared settings and the rotation's
 * timing (rotations counted, the opener), as JSON. Runs with another are out of date.
 */
export function kqmSharedKey(database: ArtCharDatabase, teamId: string) {
  const rootId = versionRoot(database, teamId)
  const rootKqm = database.teams.get(rootId)?.teamOpt?.kqm
  const sig = signatureOf(database, teamId)
  return sortedJson({
    // (the constellations it plays at: the family's with its own over them, its members' only)
    kqm: sharedOf(rootKqm, {
      cons: consFor(database, teamId, rootKqm),
    }),
    timing: writtenRotationOf(database, kqmRotationId(rootId)).timing,
    // (its own signature weapon choices)
    ...(Object.keys(sig).length ? { sig } : {}),
  })
}

/**
 * The constellations a team of the family plays at, each of its members': its own, else the
 * family's (its default when the family has none set)
 */
function consFor(
  database: ArtCharDatabase,
  teamId: string,
  rootKqm: TeamOptKqm | undefined
): OwnCons {
  const own = ownConsOf(database, teamId)
  return Object.fromEntries(
    teamOptMembers(database, teamId).map(({ characterKey: k }) => [
      k,
      own[k] ?? kqmMemberConstellation(k, rootKqm),
    ])
  )
}

/**
 * Makes a version its family's original (the old original one of its versions): every team keeps
 * the settings and constellations it plays at, so its results still hold. Whether it did.
 */
export function makeOriginal(
  database: ArtCharDatabase,
  teamId: string,
  names: { i18n: i18n; gender: GenderKey }
): boolean {
  const oldRoot = versionRoot(database, teamId)
  if (oldRoot === teamId) return false
  // (its own copy of the family's settings may predate the original's last change)
  syncVersion(database, teamId, names)
  const oldKqm = database.teams.get(oldRoot)?.teamOpt?.kqm
  const family = [oldRoot, ...versionsOf(database, oldRoot)]
  // (each team's constellations as it plays them, before the family's change)
  const playing = new Map(
    family.map((id) => [id, consFor(database, id, oldKqm)] as const)
  )
  const newCons: OwnCons = {
    ...oldKqm?.constellations,
    ...playing.get(teamId),
  }
  database.teams.set(teamId, (team) => {
    delete team.versionOf
    delete team.versionCons
    team.teamOpt = {
      ...(team.teamOpt ?? initTeamOpt()),
      kqm: {
        ...(team.teamOpt?.kqm ?? defaultTeamOptKqm),
        constellations: newCons,
      },
    }
  })
  const newKqm = database.teams.get(teamId)?.teamOpt?.kqm
  for (const id of family) {
    if (id === teamId) continue
    const own = Object.fromEntries(
      Object.entries(playing.get(id) ?? {}).filter(
        ([k, n]) => n !== kqmMemberConstellation(k as CharacterKey, newKqm)
      )
    ) as OwnCons
    database.teams.set(id, (team) => {
      team.versionOf = teamId
      if (Object.keys(own).length) team.versionCons = own
      else delete team.versionCons
    })
  }
  return true
}

/**
 * A version's shared settings and rotation timing made its original's again; its rotation is
 * played again (at the new constellations or timing) when they change. Whether anything did.
 */
export function syncVersion(
  database: ArtCharDatabase,
  teamId: string,
  names: { i18n: i18n; gender: GenderKey }
): boolean {
  const rootId = versionRoot(database, teamId)
  if (rootId === teamId) return false
  const rootKqm = database.teams.get(rootId)?.teamOpt?.kqm
  const ownKqm = database.teams.get(teamId)?.teamOpt?.kqm
  // (the family's, with its own constellations over them)
  const target = sharedOf(rootKqm, {
    cons: { ...rootKqm?.constellations, ...ownConsOf(database, teamId) },
  })
  const settingsChanged = sortedJson(target) !== sortedJson(sharedOf(ownKqm))
  const timing = writtenRotationOf(database, kqmRotationId(rootId)).timing
  const timingChanged =
    timing !== writtenRotationOf(database, kqmRotationId(teamId)).timing
  if (!settingsChanged && !timingChanged) return false
  if (settingsChanged)
    database.teams.set(teamId, (team) => {
      const kqm: TeamOptKqm = structuredClone(
        team.teamOpt?.kqm ?? defaultTeamOptKqm
      )
      for (const key of KQM_SHARED) delete kqm[key]
      team.teamOpt = {
        ...(team.teamOpt ?? initTeamOpt()),
        kqm: { ...kqm, ...structuredClone(target) },
      }
    })
  if (timingChanged)
    database.teams.setRotationField(
      kqmRotationId(teamId),
      'Timing',
      timing || null
    )
  applySavedRotation(database, teamId, { kqm: true, ...names })
  return true
}

/**
 * The shared settings and rotation timing changed on a version's page made its original's (so the
 * whole family's: the others take them before they run); the original's rotation is played again
 * when they change. Whether anything did.
 */
export function pushVersionSettings(
  database: ArtCharDatabase,
  teamId: string,
  names: { i18n: i18n; gender: GenderKey }
): boolean {
  const rootId = versionRoot(database, teamId)
  if (rootId === teamId) return false
  const ownKqm = database.teams.get(teamId)?.teamOpt?.kqm
  const rootKqm = database.teams.get(rootId)?.teamOpt?.kqm
  const own = ownConsOf(database, teamId)
  // (its own constellations changed here stay its own; the rest are the family's)
  const ownNow: OwnCons = Object.fromEntries(
    Object.keys(own).map((k) => [
      k,
      ownKqm?.constellations?.[k as CharacterKey] ?? own[k as CharacterKey],
    ])
  )
  const ownChanged = sortedJson(ownNow) !== sortedJson(own)
  const pushed = sharedOf(ownKqm, {
    cons: {
      ...ownKqm?.constellations,
      ...Object.fromEntries(
        Object.keys(own).map((k) => [
          k,
          rootKqm?.constellations?.[k as CharacterKey],
        ])
      ),
    },
  })
  const settingsChanged = sortedJson(pushed) !== sortedJson(sharedOf(rootKqm))
  const timing = writtenRotationOf(database, kqmRotationId(teamId)).timing
  const timingChanged =
    timing !== writtenRotationOf(database, kqmRotationId(rootId)).timing
  if (ownChanged)
    database.teams.set(teamId, (team) => {
      team.versionCons = ownNow
    })
  if (!settingsChanged && !timingChanged) return ownChanged
  if (settingsChanged)
    database.teams.set(rootId, (team) => {
      const kqm: TeamOptKqm = structuredClone(
        team.teamOpt?.kqm ?? defaultTeamOptKqm
      )
      for (const key of KQM_SHARED) delete kqm[key]
      team.teamOpt = {
        ...(team.teamOpt ?? initTeamOpt()),
        kqm: { ...kqm, ...structuredClone(pushed) },
      }
    })
  if (timingChanged)
    database.teams.setRotationField(
      kqmRotationId(rootId),
      'Timing',
      timing || null
    )
  applySavedRotation(database, rootId, { kqm: true, ...names })
  return true
}

/**
 * A tab's rotation of the original (`rid`) for a version: each one swapped in plays its usual
 * support part (`supportPart`) at the first step of the one it replaces, and is left out of the
 * opener
 */
function swappedRotation(
  database: ArtCharDatabase,
  rid: string,
  members: readonly CharacterKey[],
  swaps: readonly VersionSwap[],
  { i18n, gender }: { i18n: i18n; gender: GenderKey }
) {
  const names = memberNamesOf(
    members.map((characterKey) => ({ characterKey })),
    i18n,
    gender
  )
  const { text, opener } = writtenRotationOf(database, rid)
  // (the member with the most actions, the main DPS: one taking its place plays its own main part,
  // from its templates)
  const actions = new Map<CharacterKey, number>()
  for (const step of parseRotation(text, names).steps)
    actions.set(
      step.characterKey,
      (actions.get(step.characterKey) ?? 0) + step.actions.length
    )
  const main = members.reduce((a, b) =>
    (actions.get(b) ?? 0) > (actions.get(a) ?? 0) ? b : a
  )
  const parts = swaps.map(({ from, to }) => ({
    from,
    name: memberNamesOf([{ characterKey: to }], i18n, gender)[0].name,
    ...(from === main
      ? { part: mainPart(to) ?? supportPart(to), longest: true }
      : { part: supportPart(to) }),
  }))
  return {
    text: text.trim() ? swapRotationMembers(text, names, parts) : '',
    opener: opener.trim()
      ? swapRotationMembers(
          opener,
          names,
          parts.map(({ from, name }) => ({ from, name }))
        )
      : '',
  }
}

/**
 * The KQM rotation a version of a team starts with, before it is made (to show and edit): the
 * original's, swapped
 */
export function versionRotation(
  database: ArtCharDatabase,
  teamId: string,
  swaps: readonly VersionSwap[],
  names: { i18n: i18n; gender: GenderKey }
) {
  const rootId = versionRoot(database, teamId)
  const members = teamOptMembers(database, rootId).map((m) => m.characterKey)
  return swappedRotation(database, kqmRotationId(rootId), members, swaps, names)
}

/**
 * A version's name: its members, "Flins | Columbina | Ineffa | Sucrose", those with their own
 * constellation with it ("Sucrose C2")
 */
export function versionName(
  members: readonly CharacterKey[],
  constellations: OwnCons,
  { i18n, gender }: { i18n: i18n; gender: GenderKey },
  /** Its members' signature weapons (`TeamOptKqm.signature`): " R1", " no sig" */
  signature: OwnCons = {}
) {
  return memberNamesOf(
    members.map((characterKey) => ({ characterKey })),
    i18n,
    gender
  )
    .map(({ characterKey, name }) => {
      const c = constellations[characterKey]
      const r = signature[characterKey]
      return `${name}${c === undefined ? '' : ` C${c}`}${r === undefined ? '' : r ? ` R${r}` : ' no sig'}`
    })
    .join(' | ')
}

/** A team's own signature weapon choices (`TeamOptKqm.signature`), its members' with one */
export function signatureOf(
  database: ArtCharDatabase,
  teamId: string,
  members: readonly CharacterKey[] = teamOptMembers(database, teamId).map(
    (m) => m.characterKey
  )
): OwnCons {
  const chosen = database.teams.get(teamId)?.teamOpt?.kqm?.signature ?? {}
  return Object.fromEntries(
    members.flatMap((k) =>
      chosen[k] !== undefined && signatureWeapons[k] ? [[k, chosen[k]]] : []
    )
  )
}

/** A swap in a version: a member of the original, and who takes its place */
export interface VersionSwap {
  from: CharacterKey
  to: CharacterKey
}

/**
 * The swaps once a member is picked for the slot of the original's `from`: it takes that slot. One
 * picked from another slot leaves it to that slot's original member. Members of the original stay in
 * their own slots, so one put in another slot swaps places with who is there. Undefined when the team
 * stays as it is (one already in it, at its own slot).
 */
export function pickVersionMember(
  members: readonly CharacterKey[],
  swaps: readonly VersionSwap[],
  from: CharacterKey,
  to: CharacterKey
): VersionSwap[] | undefined {
  const shown = members.map((k) => swaps.find((s) => s.from === k)?.to ?? k)
  const at = members.indexOf(from)
  const was = shown.indexOf(to)
  if (at < 0 || was === at || (was >= 0 && members[was] === to)) return
  const team = shown.map((k, i) => (i === was ? members[i] : k))
  team[at] = to
  const ins = team.filter((k) => !members.includes(k))
  const outs = members.flatMap((k, i) => (team.includes(k) ? [] : [i]))
  const stay = new Set(outs.map((i) => team[i]).filter((k) => ins.includes(k)))
  const rest = ins.filter((k) => !stay.has(k))
  return outs.map((i) => ({
    from: members[i],
    to: stay.has(team[i]) ? team[i] : rest.shift()!,
  }))
}

/**
 * A new version of a team (`rootId`, or the original of a version): a team of its own with members
 * swapped or other constellations (or both), under the original's KQM settings. Each one swapped in plays its usual
 * support part (`supportPart`) at the first step of the one it replaces. Its id ('' when the swaps
 * do not fit the team).
 */
export function createVersion(
  database: ArtCharDatabase,
  teamId: string,
  swaps: readonly VersionSwap[],
  { i18n, gender }: { i18n: i18n; gender: GenderKey },
  /** Its rotation on both tabs, as chosen; absent: each tab's of the original's, swapped */
  rotation?: { text: string; opener: string },
  /** Its own constellations, over the family's (its members': those that differ count) */
  constellations: OwnCons = {},
  /** Its name; absent or blank: `versionName`'s */
  name?: string,
  /**
   * A team of the family it copies (Duplicate): its members' builds and switches, and with no
   * `rotation`, its rotations; it may then be made without a change (another rotation)
   */
  base?: string,
  /** Its members' signature weapons (`TeamOptKqm.signature`: 0 none, 1–5 its refinement) */
  signature: OwnCons = {}
): string {
  const rootId = versionRoot(database, teamId)
  const root = database.teams.get(rootId)
  if (!root) return ''
  const baseId = base && versionRoot(database, base) === rootId ? base : rootId
  const baseTeam = database.teams.get(baseId)
  if (!baseTeam) return ''
  const members = teamOptMembers(database, rootId).map((m) => m.characterKey)
  const froms = swaps.map((s) => s.from)
  const tos = swaps.map((s) => s.to)
  const team2 = members.map((k) => swaps.find((s) => s.from === k)?.to ?? k)
  const gone = teamOptMembers(database, baseId)
    .map((m) => m.characterKey)
    .filter((k) => !team2.includes(k))
  const rootKqm = root.teamOpt?.kqm
  const cons = Object.fromEntries(
    Object.entries(constellations).filter(
      ([k, n]) =>
        team2.includes(k as CharacterKey) &&
        Number.isInteger(n) &&
        n! >= 0 &&
        n! <= 6 &&
        n !== kqmMemberConstellation(k as CharacterKey, rootKqm)
    )
  ) as OwnCons
  const sig = Object.fromEntries(
    Object.entries(signature).filter(
      ([k, r]) =>
        team2.includes(k as CharacterKey) &&
        signatureWeapons[k as CharacterKey] &&
        Number.isInteger(r) &&
        r! >= 0 &&
        r! <= 5
    )
  ) as OwnCons
  if (
    (!base &&
      !swaps.length &&
      !Object.keys(cons).length &&
      !Object.keys(sig).length) ||
    new Set(froms).size !== froms.length ||
    new Set(tos).size !== tos.length ||
    froms.some((k) => !members.includes(k)) ||
    tos.some((k) => members.includes(k))
  )
    return ''
  // (by the original's slots: who each holds)
  const slots = root.loadoutData.map((datum) => {
    const key = database.teamChars.get(datum?.teamCharId)?.key
    return key && (swaps.find((s) => s.from === key)?.to ?? key)
  })
  const keyOf = (datum?: LoadoutDatum) =>
    database.teamChars.get(datum?.teamCharId)?.key
  // (one the copied team or the original has keeps its loadout)
  const loadoutOf = (k: CharacterKey) =>
    [...baseTeam.loadoutData, ...root.loadoutData].find((d) => keyOf(d) === k)
  const id = database.teams.duplicate(baseId)
  if (!id) return ''
  database.teams.set(id, (team) => {
    team.name = name?.trim() || versionName(team2, cons, { i18n, gender }, sig)
    team.versionOf = rootId
    team.loadoutData = baseTeam.loadoutData.map((datum, i) => {
      const want = slots[i]
      return !want || keyOf(datum) === want
        ? datum
        : (loadoutOf(want) ??
            ({ teamCharId: database.teamChars.new(want) } as LoadoutDatum))
    })
    if (Object.keys(cons).length) team.versionCons = cons
    else delete team.versionCons
    const teamOpt = structuredClone(team.teamOpt ?? initTeamOpt())
    if (Object.keys(cons).length || baseId !== rootId)
      teamOpt.kqm = {
        ...(teamOpt.kqm ?? defaultTeamOptKqm),
        constellations: { ...rootKqm?.constellations, ...cons },
      }
    if (Object.keys(sig).length)
      teamOpt.kqm = { ...(teamOpt.kqm ?? defaultTeamOptKqm), signature: sig }
    else if (teamOpt.kqm) delete teamOpt.kqm.signature
    for (const k of gone) {
      delete teamOpt.attacks[k]
      delete teamOpt.kqm?.attacks?.[k]
      delete teamOpt.kqm?.passives?.[k]
    }
    if (teamOpt.onField && gone.includes(teamOpt.onField))
      delete teamOpt.onField
    if (teamOpt.kqm) {
      if (teamOpt.kqm.onField && gone.includes(teamOpt.kqm.onField))
        delete teamOpt.kqm.onField
      // (worked out again for its own rotation, as the original's were; ones typed by hand are
      // kept, for the members they were typed for)
      if (teamOpt.kqm.energySource !== 'manual') {
        delete teamOpt.kqm.energyRecharge
        delete teamOpt.kqm.energyCalculator
      }
      delete teamOpt.kqm.energyRotation
    }
    team.teamOpt = teamOpt
  })
  for (const [rid, baseRid] of [
    [id, baseId],
    [kqmRotationId(id), kqmRotationId(baseId)],
  ]) {
    setWrittenRotation(
      database,
      rid,
      rotation ??
        (baseId === rootId
          ? swappedRotation(database, rid, members, swaps, { i18n, gender })
          : writtenRotationOf(database, baseRid))
    )
    for (const field of [
      'ConstellationRotations',
      'CombinationRotations',
    ] as const)
      database.teams.setRotationField(rid, field, null)
  }
  applySavedRotation(database, id, { kqm: true, i18n, gender })
  applySavedRotation(database, id, { kqm: false, i18n, gender })
  return id
}
