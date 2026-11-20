import type { Team, TeamEnemy } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm, initTeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useTeam } from '@genshin-optimizer/gi/db-ui'
import { createContext, useCallback, useContext, useMemo } from 'react'

/** Which enemy the editors show and change: the team's, or the KQM tab's own */
export type EnemyScope = 'team' | 'kqm'
export const EnemyScopeContext = createContext<EnemyScope>('team')

/** The team's enemy, as the KQM tab starts with it (a copy) */
export const enemyOfTeam = (team: Team): TeamEnemy => ({
  enemyOverride: structuredClone(team.enemyOverride),
  ...(team.enemyPreset ? { enemyPreset: team.enemyPreset } : {}),
  ...(team.enemyHp ? { enemyHp: team.enemyHp } : {}),
  ...(team.fightSettings
    ? { fightSettings: structuredClone(team.fightSettings) }
    : {}),
})

/** The team with the KQM tab's own enemy in place of its own (not set up yet: the team's) */
export function kqmEnemyTeam(team: Team): Team {
  const enemy = team.teamOpt?.kqm?.enemy
  if (!enemy) return team
  const {
    enemyPreset: _preset,
    enemyHp: _hp,
    fightSettings: _fight,
    ...rest
  } = team
  return { ...rest, ...enemy }
}

export const scopedEnemyTeam = (team: Team, scope: EnemyScope) =>
  scope === 'kqm' ? kqmEnemyTeam(team) : team

/** The team as the enemy editors read it: with its enemy, or the KQM tab's */
export function useEnemyTeam(teamId: string) {
  const scope = useContext(EnemyScopeContext)
  const team = useTeam(teamId)
  return useMemo(() => team && scopedEnemyTeam(team, scope), [team, scope])
}

/** A change to the enemy the editors show (its stats, boss, HP, fight settings) */
export function useSetEnemy(teamId: string) {
  const scope = useContext(EnemyScopeContext)
  const database = useDatabase()
  return useCallback(
    (update: (enemy: TeamEnemy) => void) =>
      database.teams.set(teamId, (team) => {
        if (scope !== 'kqm') {
          update(team)
          return
        }
        const teamOpt = team.teamOpt ?? initTeamOpt()
        const kqm = (teamOpt.kqm ??= { ...defaultTeamOptKqm })
        const enemy = kqm.enemy ? structuredClone(kqm.enemy) : enemyOfTeam(team)
        update(enemy)
        kqm.enemy = Object.fromEntries(
          Object.entries(enemy).filter(([, v]) => v !== undefined)
        ) as unknown as TeamEnemy
        team.teamOpt = teamOpt
      }),
    [database, teamId, scope]
  )
}
