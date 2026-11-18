import type { TeamOpt, TeamOptKqm } from '@genshin-optimizer/gi/db'
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

/** The settings each tab keeps its own of: the KQM tab's are in `TeamOptKqm` */
const KQM_OWN = ['rotationTime', 'bonusStats', 'onField'] as const

/**
 * The KQM tab's settings as the page reads them: its own rotation (`TeamOptKqm.attacks`), its
 * length, extra buffs and on-field member as `attacks`, `rotationTime`, `bonusStats` and
 * `onField`; the rest as they are. Before it has one of its own (not set up yet): Team optimize's.
 */
export function kqmRotationView(teamOpt: TeamOpt): TeamOpt {
  const kqm = teamOpt.kqm
  if (kqm?.attacks === undefined) return teamOpt
  const view: TeamOpt = { ...teamOpt, attacks: kqm.attacks }
  for (const key of KQM_OWN) {
    delete view[key]
    if (kqm[key] !== undefined)
      (view as unknown as Record<string, unknown>)[key] = kqm[key]
  }
  return view
}

/**
 * A change made on the KQM tab (`kqmRotationView`): to its own rotation, length, extra buffs and
 * on-field member, the rest as it is; Team optimize's are left alone
 */
export const kqmRotationUpdate =
  (update: TeamOptUpdate): TeamOptUpdate =>
  (teamOpt) => {
    const view = structuredClone(kqmRotationView(teamOpt))
    const next = update(view) ?? view
    const kqm: TeamOptKqm = {
      ...(next.kqm ?? defaultTeamOptKqm),
      attacks: next.attacks,
    }
    const result: TeamOpt = { ...next, attacks: teamOpt.attacks, kqm }
    for (const key of KQM_OWN) {
      if (next[key] !== undefined)
        (kqm as unknown as Record<string, unknown>)[key] = next[key]
      else delete kqm[key]
      delete result[key]
      if (teamOpt[key] !== undefined)
        (result as unknown as Record<string, unknown>)[key] = teamOpt[key]
    }
    return result
  }

/**
 * The KQM tab's own rotation, set up from Team optimize's the first time (a copy: the two are
 * separate from then on), with its length and on-field member; no extra buffs (KQM's builds are
 * general, not the user's)
 */
export const kqmRotationSetUp: TeamOptUpdate = (teamOpt) => {
  if (teamOpt.kqm?.attacks !== undefined) return
  teamOpt.kqm = {
    ...(teamOpt.kqm ?? defaultTeamOptKqm),
    attacks: structuredClone(teamOpt.attacks),
    ...(teamOpt.rotationTime !== undefined
      ? { rotationTime: teamOpt.rotationTime }
      : {}),
    ...(teamOpt.onField !== undefined ? { onField: teamOpt.onField } : {}),
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
