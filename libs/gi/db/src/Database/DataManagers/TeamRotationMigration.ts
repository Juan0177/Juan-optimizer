import {
  allCharacterKeys,
  type CharacterKey,
} from '@genshin-optimizer/gi/consts'
import type { RotationDocumentField } from './TeamDataManager'

export function legacyRotationKey(key: string) {
  const rotation =
    /^teamOptRotation(Text|Draft|Opener|Timing|Cons|Copied)_(team_\d+)(_kqm)?$/.exec(
      key
    )
  if (rotation)
    return {
      teamId: rotation[2]!,
      kqm: !!rotation[3],
      field: rotation[1] as RotationDocumentField,
    }
  const manual = /^teamOpt\.start\.manual_(team_\d+)$/.exec(key)
  if (manual)
    return { teamId: manual[1]!, kqm: false, field: 'Manual' as const }
  const combo = /^kqmComboRotations_(team_\d+)$/.exec(key)
  if (combo)
    return {
      teamId: combo[1]!,
      kqm: true,
      field: 'CombinationRotations' as const,
    }
  const cons = /^kqmConsRotations_(team_\d+)_([a-zA-Z0-9]+)$/.exec(key)
  if (cons && allCharacterKeys.includes(cons[2] as CharacterKey))
    return {
      teamId: cons[1]!,
      kqm: true,
      field: 'ConstellationRotations' as const,
      character: cons[2]!,
    }
  return undefined
}

export function readRotationObject(raw: string | undefined) {
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>
  } catch {
    // Keep malformed legacy data available for recovery.
  }
  return undefined
}

const characterNames = new Map(
  allCharacterKeys.map((key) => [key.toLowerCase(), key])
)

export function legacyRotationMembers(
  records: ReadonlyArray<{
    field: RotationDocumentField
    raw: string
    character?: string
  }>
) {
  const members = new Set<string>()
  for (const { field, raw, character } of records) {
    if (character) members.add(character)
    if (field === 'Cons')
      for (const key of Object.keys(readRotationObject(raw) ?? {}))
        if (allCharacterKeys.includes(key as CharacterKey)) members.add(key)
    if (field === 'Text' || field === 'Opener' || field === 'Draft')
      for (const turn of raw.split(/->|→|=>|>|,|;|\n/)) {
        const words = turn.trim().split(/\s+/)
        for (let count = Math.min(words.length, 3); count > 0; count--) {
          const key = characterNames.get(
            words.slice(0, count).join('').toLowerCase()
          )
          if (!key) continue
          members.add(key)
          break
        }
      }
  }
  return members
}
