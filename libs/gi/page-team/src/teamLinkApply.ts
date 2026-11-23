import type { GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type {
  RotationTimingSettings,
  TeamLink,
  TeamLinkTeam,
} from '@genshin-optimizer/gi/ui'
import { createTeamFromLink, withPing } from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import {
  applySavedRotation,
  rotationIdOf,
  setWrittenRotation,
} from './TeamOptimize/RotationWriter'

/**
 * A link's team imported as a new team (`createTeamFromLink`), its rotation written and played on
 * both tabs (Team optimize with the link's builds, KQM at its constellations). Returns its id.
 */
export function importTeamFromLink(
  database: ArtCharDatabase,
  team: TeamLinkTeam,
  {
    i18n,
    gender,
    buildName,
    source,
  }: {
    i18n: i18n
    gender: GenderKey
    buildName: string
    source?: TeamLink['source']
  }
): string {
  const teamId = createTeamFromLink(database, team, { buildName, source })
  if (!teamId || !team.rotation) return teamId
  const { text, opener, pingMs, rotations, countOpener } = team.rotation
  let timing: RotationTimingSettings = { edits: {} }
  if (pingMs !== undefined) timing = withPing(timing, pingMs)
  if (rotations)
    timing = { ...timing, rotations, ...(countOpener ? { countOpener } : {}) }
  const changed = Object.keys(timing).length > 1
  for (const kqm of [false, true]) {
    setWrittenRotation(database, rotationIdOf(teamId, kqm), {
      text,
      opener,
      timing: changed ? JSON.stringify(timing) : '',
    })
    applySavedRotation(database, teamId, { kqm, i18n, gender })
  }
  return teamId
}
