import type { GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm, initTeamOpt } from '@genshin-optimizer/gi/db'
import { teamOptMembers } from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import { useSyncExternalStore } from 'react'
import { kqmEnergyUpdate, kqmRotationEnergyOf } from './kqmEnergy'
import { syncVersion } from './kqmVersions'
import { kqmRotationId, savedPlayedRotationKey } from './RotationWriter'
import { cancelKqmRun, startKqmRun } from './useKqmRun'
import { kqmRotationView } from './useTeamOpt'

/** A team's KQM settings as its KQM tab runs them (`useTeamOpt`, `kqmRotationView`) */
function kqmRunTeamOpt(stored: TeamOpt | undefined): TeamOpt {
  const teamOpt = stored ?? initTeamOpt()
  return kqmRotationView(
    teamOpt.assumeMaxMain ? { ...teamOpt, assumeMaxMain: false } : teamOpt
  )
}

/**
 * A team's KQM run started from another page (a version, from its family's list): its shared
 * settings made its original's, its ER targets worked out as its KQM tab does, then the run its
 * tab starts. (Without Wolf's Gravestone's uptime against an enemy with HP, which needs the team's
 * last fight.)
 */
export function startVersionRun(
  database: ArtCharDatabase,
  gender: GenderKey,
  i18n: i18n,
  teamId: string
) {
  syncVersion(database, teamId, { i18n, gender })
  const view = () => kqmRunTeamOpt(database.teams.get(teamId)?.teamOpt)
  const members = teamOptMembers(database, teamId)
  const written = savedPlayedRotationKey(database, kqmRotationId(teamId))
  const worked = written
    ? kqmRotationEnergyOf(database, gender, i18n, teamId, view(), members)
    : {}
  const update = kqmEnergyUpdate({
    members,
    teamOpt: view(),
    written,
    ready: !!written && !!worked.energy,
    rotationEnergy: worked.energy,
    playedTime: worked.rotationTime,
  })
  if (update)
    database.teams.set(teamId, (team) => {
      const teamOpt = team.teamOpt ?? initTeamOpt()
      team.teamOpt = {
        ...teamOpt,
        kqm: { ...(teamOpt.kqm ?? defaultTeamOptKqm), ...update.kqm },
      }
    })
  return startKqmRun(database, gender, i18n, teamId, view())
}

/*
 * Versions waiting to run, one at a time (each run already uses every build thread), in the
 * background of whichever page is shown
 */
const queue: string[] = []
let current: string | undefined
const listeners = new Set<() => void>()
let snapshot: readonly string[] = []
function notify() {
  snapshot = [...(current ? [current] : []), ...queue]
  for (const l of listeners) l()
}

/** Runs the teams' KQM builds one after another (those already waiting or running are kept) */
export function queueVersionRuns(
  database: ArtCharDatabase,
  gender: GenderKey,
  i18n: i18n,
  teamIds: readonly string[]
) {
  for (const id of teamIds)
    if (id !== current && !queue.includes(id)) queue.push(id)
  notify()
  if (current) return
  void (async () => {
    while (queue.length) {
      current = queue.shift()!
      notify()
      try {
        if (database.teams.get(current))
          await startVersionRun(database, gender, i18n, current)
      } catch (e) {
        console.error(e)
      }
    }
    current = undefined
    notify()
  })()
}

/** Stops the versions' runs: the one running, and those waiting */
export function stopVersionRuns(database: ArtCharDatabase) {
  queue.length = 0
  if (current) cancelKqmRun(database, current)
  notify()
}

/** The versions running or waiting to run, the running one first */
export function useVersionQueue(): readonly string[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
    () => snapshot
  )
}
