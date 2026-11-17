import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { teamOptMembers } from '@genshin-optimizer/gi/ui'

/**
 * What goes with a feedback message, for debugging (the sender can leave it out): the page (route,
 * title, window), the app (version, language, data counts), the last errors it hit and, on a team
 * page, the team as it is set up (members with their constellation, level, talents, weapon and
 * sets; Team optimize / KQM settings; the written rotations); on a character page, that character.
 * Nothing about other teams, no artifact substats, no raw database.
 */

/** The last errors the app hit (window errors, unhandled rejections, console.error) */
const recentErrors: { at: string; message: string }[] = []
const RECENT = 15
const note = (message: string) => {
  recentErrors.push({
    at: new Date().toISOString(),
    message: message.slice(0, 400),
  })
  if (recentErrors.length > RECENT) recentErrors.shift()
}
let installed = false
/** Starts keeping the last errors (once) */
export function installErrorLog() {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) =>
    note(`${e.message} (${e.filename?.split('/').pop()}:${e.lineno})`)
  )
  window.addEventListener('unhandledrejection', (e) =>
    note(`Unhandled: ${String((e.reason as Error)?.message ?? e.reason)}`)
  )
  const original = console.error
  console.error = (...args: unknown[]) => {
    try {
      note(
        args
          .map((a) =>
            a instanceof Error
              ? `${a.message}`
              : typeof a === 'string'
                ? a
                : JSON.stringify(a)?.slice(0, 200)
          )
          .join(' ')
      )
    } catch {
      // (an error that cannot be shown: skipped)
    }
    original.apply(console, args)
  }
}

/** An object, unless it has nothing set (left out then) */
const nonEmpty = <T extends object>(obj: T | undefined) =>
  obj &&
  Object.values(obj).some((v) =>
    v && typeof v === 'object' ? Object.keys(v).length : v !== undefined
  )
    ? obj
    : undefined

const stored = (key: string) => {
  try {
    return globalThis.localStorage?.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}
const parsed = (key: string) => {
  const raw = stored(key)
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

/** A team as it is set up, for debugging */
function teamContext(database: ArtCharDatabase, teamId: string) {
  const team = database.teams.get(teamId)
  if (!team) return { id: teamId, missing: true }
  const members = teamOptMembers(database, teamId).map((m) => {
    const char = database.chars.get(m.characterKey)
    const weapon = m.isTc ? undefined : database.weapons.get(m.weaponId)
    const sets: Record<string, number> = {}
    for (const id of Object.values(m.artifactIds)) {
      const art = id ? database.arts.get(id) : undefined
      if (art) sets[art.setKey] = (sets[art.setKey] ?? 0) + 1
    }
    const { teamChar } = m
    return {
      key: m.characterKey,
      level: char?.level,
      ascension: char?.ascension,
      constellation: char?.constellation,
      talent: char?.talent,
      build: m.isTc ? 'tc' : m.loadoutDatum.buildType,
      weapon: weapon && {
        key: weapon.key,
        level: weapon.level,
        refinement: weapon.refinement,
      },
      sets,
      // (the member's own settings in this team: its buffs' states, bonus stats, hit mode)
      hitMode: teamChar.hitMode,
      reaction: teamChar.reaction || undefined,
      infusionAura: teamChar.infusionAura || undefined,
      bonusStats: nonEmpty(teamChar.bonusStats),
      conditional: nonEmpty(teamChar.conditional),
      customTargets: teamChar.customMultiTargets.length || undefined,
    }
  })
  // (the attacks as a count per member: the rotation text makes them again)
  const { attacks, excludedArts, ...setup } = team.teamOpt ?? {}
  const consRotations = Object.fromEntries(
    members.flatMap((m) => {
      const value = parsed(`kqmConsRotations_${teamId}_${m.key}`)
      return value ? [[m.key, value]] : []
    })
  )
  return {
    id: teamId,
    name: team.name,
    members,
    enemy: nonEmpty(team.enemyOverride),
    conditional: nonEmpty(team.conditional),
    teamOpt: {
      ...setup,
      attacks: Object.fromEntries(
        Object.entries(attacks ?? {}).map(([k, list]) => [
          k,
          (list as unknown[] | undefined)?.length ?? 0,
        ])
      ),
      excludedArts: Array.isArray(excludedArts)
        ? excludedArts.length
        : undefined,
    },
    rotation: {
      text: stored(`teamOptRotationText_${teamId}`),
      // (being written, not saved yet)
      draft: stored(`teamOptRotationDraft_${teamId}`),
      opener: stored(`teamOptRotationOpener_${teamId}`),
      timing: parsed(`teamOptRotationTiming_${teamId}`),
      constellations: Object.keys(consRotations).length
        ? consRotations
        : undefined,
      combinations: parsed(`kqmComboRotations_${teamId}`),
    },
  }
}

/** A character as it is in the database (its page's subject) */
function characterContext(database: ArtCharDatabase, key: string) {
  const char = database.chars.get(key as never)
  if (!char) return { key, missing: true }
  const { key: _, ...rest } = char as unknown as Record<string, unknown>
  return { key, ...rest }
}

/** The page, the app and (on a team or character page) its subject, for a feedback message */
export function feedbackContext(
  database: ArtCharDatabase,
  pathname: string,
  extra: { language?: string; gender?: string }
) {
  const context: Record<string, unknown> = {
    page: {
      route: pathname,
      title: globalThis.document?.title,
      window: `${globalThis.innerWidth}×${globalThis.innerHeight} @${globalThis.devicePixelRatio ?? 1}x`,
      language: extra.language,
      online: globalThis.navigator?.onLine,
    },
    app: {
      gender: extra.gender,
      data: {
        characters: database.chars.keys.length,
        weapons: database.weapons.keys.length,
        artifacts: database.arts.keys.length,
        teams: database.teams.keys.length,
      },
    },
    errors: recentErrors.length ? [...recentErrors] : undefined,
  }
  try {
    const team = /^\/teams\/([^/]+)/.exec(pathname)?.[1]
    if (team) context.team = teamContext(database, decodeURIComponent(team))
    const character = /^\/characters\/([^/]+)/.exec(pathname)?.[1]
    if (character)
      context.character = characterContext(
        database,
        decodeURIComponent(character)
      )
  } catch (e) {
    context.contextError = String((e as Error)?.message ?? e)
  }
  return capped(context)
}

/** The most a message's details may take (the Worker refuses more) */
export const MAX_CONTEXT_CHARS = 60_000
/** The details, made small enough: the largest parts left out first, as the record says */
function capped(context: Record<string, unknown>) {
  const size = () => JSON.stringify(context).length
  const team = context.team as
    | { rotation?: Record<string, unknown>; members?: object[] }
    | undefined
  const cuts: [string, () => void][] = [
    ['rotation timing', () => team?.rotation && delete team.rotation.timing],
    ['rotation draft', () => team?.rotation && delete team.rotation.draft],
    [
      'combination rotations',
      () => team?.rotation && delete team.rotation.combinations,
    ],
    [
      'constellation rotations',
      () => team?.rotation && delete team.rotation.constellations,
    ],
    ['character', () => delete context.character],
    [
      'members’ buff states',
      () =>
        team?.members?.forEach(
          (m) => delete (m as { conditional?: unknown }).conditional
        ),
    ],
  ]
  const leftOut: string[] = []
  for (const [what, cut] of cuts) {
    if (size() <= MAX_CONTEXT_CHARS) break
    cut()
    leftOut.push(what)
  }
  if (leftOut.length) context.leftOut = leftOut
  return size() <= MAX_CONTEXT_CHARS
    ? context
    : { page: context.page, app: context.app, leftOut: ['too large'] }
}
