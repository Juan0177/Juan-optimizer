import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'

const scopes = new WeakMap<ArtCharDatabase, number>()
let nextScope = 0

export function teamRunKey(database: ArtCharDatabase, teamId: string) {
  let scope = scopes.get(database)
  if (scope === undefined) {
    scope = nextScope++
    scopes.set(database, scope)
  }
  return `${scope}:${teamId}`
}

export function teamRoster(database: ArtCharDatabase, teamId: string) {
  return JSON.stringify(
    database.teams
      .get(teamId)
      ?.loadoutData.map(
        (datum) =>
          datum && [
            database.teamChars.get(datum.teamCharId)?.key,
            datum.teamCharId,
          ]
      ) ?? []
  )
}

export function sameBuildRoster(
  builds: Record<string, unknown>,
  members: readonly string[]
) {
  const keys = Object.keys(builds)
  return (
    keys.length === members.length && members.every((key) => keys.includes(key))
  )
}
