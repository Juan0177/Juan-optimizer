import type { GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { read } from '@genshin-optimizer/gi/wr'
import { getTeamDataWith, type TeamDataOverrides } from './data'
import { attackDamageOutcomes } from './objective'
import type { RotationCalculation } from './rotation/types'

/**
 * Team calculations kept for reuse, the most recently read: each is a whole team's data, and a
 * rotation played with many candidate sets (their states in every context) makes thousands
 */
const TEAMS_KEPT = 16

/**
 * Evaluate a heal or stat in the timeline's buff context, without changing the saved build.
 * `kept`: the characters of the keys of the values and damage it keeps.
 */
export function rotationCalculation(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  overrides: TeamDataOverrides = {}
): RotationCalculation & { kept: () => number } {
  const teams = new Map<string, ReturnType<typeof uiDataForTeam> | undefined>()
  const values = new Map<string, number | undefined>()
  let kept = 0
  const calculate: RotationCalculation = (
    characterKey,
    path,
    states,
    onField
  ) => {
    const key = JSON.stringify([states, onField])
    const valueKey = `${key}|${characterKey}|${path.join('.')}`
    if (values.has(valueKey)) return values.get(valueKey)
    let data = teams.get(key)
    if (teams.has(key)) teams.delete(key)
    else {
      const team = getTeamDataWith(database, teamId, { ...overrides, states })
      data = team?.[onField]
        ? uiDataForTeam({ [onField]: team[onField], ...team }, gender, onField)
        : undefined
      if (teams.size >= TEAMS_KEPT) teams.delete(teams.keys().next().value!)
    }
    teams.set(key, data)
    const value = data?.[characterKey]?.target.get({ ...read(), path })?.value
    const out =
      typeof value === 'number' && Number.isFinite(value) ? value : undefined
    values.set(valueKey, out)
    kept += valueKey.length
    return out
  }
  const damageCache = new Map<string, ReturnType<typeof attackDamageOutcomes>>()
  calculate.damage = (characterKey, attack) => {
    const key = JSON.stringify([characterKey, attack])
    if (!damageCache.has(key)) {
      damageCache.set(
        key,
        attackDamageOutcomes(
          database,
          teamId,
          gender,
          characterKey,
          attack,
          overrides
        )
      )
      kept += key.length
    }
    return damageCache.get(key)
  }
  return Object.assign(calculate, { kept: () => kept })
}
