import { allArtifactSetKeys, allWeaponKeys } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOptKqm } from '@genshin-optimizer/gi/db'
import { teamOptMembers } from '@genshin-optimizer/gi/ui'
import { enemyOfTeam } from '../Enemy/enemyScope'

const GEAR_KEYS = new Set<string>([...allWeaponKeys, ...allArtifactSetKeys])

/**
 * The KQM tab's own switches and enemy, set up once from the team's (as its rotation is): the team
 * switches, the members' kit switches (their gear's are KQM's own already) and the enemy. From
 * then on the two tabs never share them.
 */
export function kqmOwnSetUp(database: ArtCharDatabase, teamId: string) {
  const team = database.teams.get(teamId)
  const kqm = team?.teamOpt?.kqm
  if (!team || !kqm?.attacks) return
  const needSwitches = kqm.teamConditional === undefined
  const needEnemy = kqm.enemy === undefined
  if (!needSwitches && !needEnemy) return
  const passives: NonNullable<TeamOptKqm['passives']> = structuredClone(
    kqm.passives ?? {}
  )
  if (needSwitches)
    for (const m of teamOptMembers(database, teamId))
      for (const [item, conds] of Object.entries(
        (m.teamChar.conditional ?? {}) as Record<string, unknown>
      )) {
        if (GEAR_KEYS.has(item) || !conds || typeof conds !== 'object') continue
        for (const [cond, value] of Object.entries(
          conds as Record<string, unknown>
        )) {
          if (typeof value !== 'string' || !value) continue
          const own = (passives[m.characterKey] ??= {})
          const values = (own[item] ??= {})
          if (values[cond] === undefined) values[cond] = value
        }
      }
  database.teams.set(teamId, (t) => {
    const settings = t.teamOpt?.kqm
    if (!t.teamOpt || !settings) return
    t.teamOpt = {
      ...t.teamOpt,
      kqm: {
        ...settings,
        ...(needSwitches
          ? {
              teamConditional: structuredClone(t.conditional),
              passives,
            }
          : {}),
        ...(needEnemy ? { enemy: enemyOfTeam(t) } : {}),
      },
    }
  })
}
