import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm, initTeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useTeam } from '@genshin-optimizer/gi/db-ui'
import { useCallback, useMemo } from 'react'

/** A change to the team's Team Optimize settings: edit the draft in place, or return new ones */
export type TeamOptUpdate = (draft: TeamOpt) => TeamOpt | void

/**
 * The team's Team Optimize settings (the defaults until something is set: the team only stores
 * them once the user changes something) and their setter.
 */
export function useTeamOpt(teamId: string) {
  const database = useDatabase()
  const stored = useTeam(teamId)?.teamOpt
  const teamOpt = useMemo(
    () =>
      // ("Main stats at +20" is no longer offered: a team that had it on runs without it)
      stored?.assumeMaxMain
        ? { ...stored, assumeMaxMain: false }
        : (stored ?? initTeamOpt()),
    [stored]
  )
  const setTeamOpt = useCallback(
    (update: TeamOptUpdate) =>
      database.teams.set(teamId, (team) => {
        const draft = structuredClone(team.teamOpt ?? initTeamOpt())
        team.teamOpt = update(draft) ?? draft
      }),
    [database, teamId]
  )
  return [teamOpt, setTeamOpt] as const
}

/**
 * What a run's result depends on among the settings: all but how the result is shown (its
 * rotation time), as JSON with the keys sorted. A result found with another key is out of date.
 */
export function teamOptRunKey(teamOpt: TeamOpt): string {
  const { rotationTime: _shownOnly, kqm: _kqmOnly, ...rest } = teamOpt
  return sortedJson(rest)
}

/** `teamOptRunKey` for a KQM mode run: the settings it uses (the inventory's are not) */
export function kqmRunKey(teamOpt: TeamOpt): string {
  // (not `keep`: KQM builds every member; its own rotation is `attacks` here, the KQM view's)
  const { attacks, onField, bonusStats, weaponEnergy, kqm } = teamOpt
  return sortedJson({
    attacks,
    onField,
    bonusStats,
    weaponEnergy,
    kqm: kqm && { ...kqm, attacks: undefined, rotationTime: undefined },
  })
}

/**
 * The KQM tab's settings as the page reads them: its own rotation (`TeamOptKqm.attacks` and
 * `rotationTime`) as `attacks` and `rotationTime`, the rest as they are. Before it has one of its
 * own (not set up yet): Team optimize's.
 */
export function kqmRotationView(teamOpt: TeamOpt): TeamOpt {
  const kqm = teamOpt.kqm
  if (kqm?.attacks === undefined) return teamOpt
  const { rotationTime: _own, ...rest } = teamOpt
  return {
    ...rest,
    attacks: kqm.attacks,
    ...(kqm.rotationTime !== undefined
      ? { rotationTime: kqm.rotationTime }
      : {}),
  }
}

/**
 * A change made on the KQM tab (`kqmRotationView`): to its own rotation, the rest as it is; Team
 * optimize's attacks and rotation time are left alone
 */
export const kqmRotationUpdate =
  (update: TeamOptUpdate): TeamOptUpdate =>
  (teamOpt) => {
    const view = structuredClone(kqmRotationView(teamOpt))
    const next = update(view) ?? view
    const { attacks, rotationTime, ...rest } = next
    const kqm = { ...(rest.kqm ?? defaultTeamOptKqm), attacks }
    if (rotationTime !== undefined) kqm.rotationTime = rotationTime
    else delete kqm.rotationTime
    const result: TeamOpt = { ...rest, attacks: teamOpt.attacks, kqm }
    if (teamOpt.rotationTime !== undefined)
      result.rotationTime = teamOpt.rotationTime
    return result
  }

/**
 * The KQM tab's own rotation, set up from Team optimize's the first time (a copy: the two are
 * separate from then on)
 */
export const kqmRotationSetUp: TeamOptUpdate = (teamOpt) => {
  if (teamOpt.kqm?.attacks !== undefined) return
  teamOpt.kqm = {
    ...(teamOpt.kqm ?? defaultTeamOptKqm),
    attacks: structuredClone(teamOpt.attacks),
    ...(teamOpt.rotationTime !== undefined
      ? { rotationTime: teamOpt.rotationTime }
      : {}),
  }
}

function sortedJson(value: unknown): string {
  return JSON.stringify(value, (_, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      : value
  )
}
