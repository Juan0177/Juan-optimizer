import { valueString } from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  SimBuffOwner,
  SimHit,
  SimulationResult,
  TeamOptEvaluation,
} from '@genshin-optimizer/gi/ui'
import {
  attackHitData,
  evaluateTeamRotation,
  getTeamDataWith,
  resolveInfo,
  rotationAttacks,
  teamOptBonusStats,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { useEffect, useMemo, useState } from 'react'
import { HitStats } from './AttackEditor'
import { basicStats } from './ResultDetails'
import type { MomentStat, TimelineMoment } from './RotationTimeline'
import { useTeamOpt } from './useTeamOpt'

type HitAttacks = Map<SimHit, { characterKey: CharacterKey; index: number }>
interface Mapped {
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
  hitAttacks: HitAttacks
}

/**
 * The timeline's figures with the members' own builds (Team optimize's: never on the KQM tab):
 * each simulated hit's damage, and the attack it belongs to. The rotation's attacks are made from
 * the simulation shown (its first sample), evaluated once in the background; until then, and
 * when `enabled` is off, there are no figures.
 */
export function useTimelineFigures(
  teamId: string,
  sim: SimulationResult | undefined,
  own:
    | ((owner: SimBuffOwner, path: string[]) => string | undefined)
    | undefined,
  enabled: boolean
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [teamOpt] = useTeamOpt(teamId)
  const mapped = useMemo<Mapped | undefined>(() => {
    if (!sim || !enabled) return undefined
    const hitAttacks: HitAttacks = new Map()
    // (the hits shown are the first sample's: its own attacks, not the samples' average)
    const attacks = rotationAttacks(
      { ...sim, samples: undefined },
      own,
      [],
      hitAttacks
    )
    return { attacks, hitAttacks }
  }, [sim, own, enabled])
  const [evaluated, setEvaluated] = useState<{
    mapped: Mapped
    evaluation: TeamOptEvaluation
  }>()
  const assumeMaxMain = !!teamOpt.assumeMaxMain
  const { onField, bonusStats } = teamOpt
  useEffect(() => {
    if (!mapped) return undefined
    const timer = setTimeout(() => {
      const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
      const evaluation = evaluateTeamRotation(database, teamId, gender, {
        arts: {},
        attacks: mapped.attacks,
        mainStatAssumptionLevel: assumeMaxMain ? 20 : 0,
        onField,
        bonusStats: teamOptBonusStats({ bonusStats } as never, keys),
      })
      if (evaluation) setEvaluated({ mapped, evaluation })
    }, 150)
    return () => clearTimeout(timer)
  }, [mapped, database, teamId, gender, assumeMaxMain, onField, bonusStats])
  return useMemo(() => {
    if (!mapped || evaluated?.mapped !== mapped) return {}
    const { evaluation } = evaluated
    const attackOf = (hit: SimHit) => {
      const at = mapped.hitAttacks.get(hit)
      const attack = at && mapped.attacks[at.characterKey]?.[at.index]
      return at && attack ? { ...at, attack } : undefined
    }
    return {
      attackOf,
      /** One hit's damage: its attack's, per hit */
      damage: (hit: SimHit) => {
        const found = attackOf(hit)
        const total =
          found && evaluation.attacks[found.characterKey]?.[found.index]
        if (!found || total === undefined || !(found.attack.hits > 0))
          return undefined
        return (total / found.attack.hits) * (hit.weight ?? 1)
      },
    }
  }, [mapped, evaluated])
}

/** A pinned hit's stats: the character's and the hit's own, with the buffs up when it landed */
export function TimelineHitStats({
  teamId,
  characterKey,
  attack,
}: {
  teamId: string
  characterKey: CharacterKey
  attack: TeamOptAttack
}) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [teamOpt] = useTeamOpt(teamId)
  const [hit, setHit] = useState<ReturnType<typeof attackHitData> | null>()
  const assumeMaxMain = !!teamOpt.assumeMaxMain
  const { onField, bonusStats } = teamOpt
  useEffect(() => {
    setHit(undefined)
    const timer = setTimeout(() => {
      const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
      setHit(
        attackHitData(database, teamId, gender, {
          attack,
          characterKey,
          mainStatAssumptionLevel: assumeMaxMain ? 20 : 0,
          onField,
          bonusStats: teamOptBonusStats({ bonusStats } as never, keys),
        }) ?? null
      )
    }, 60)
    return () => clearTimeout(timer)
  }, [
    database,
    teamId,
    gender,
    attack,
    characterKey,
    assumeMaxMain,
    onField,
    bonusStats,
  ])
  return <HitStats hit={hit} />
}

/** The stats a member's card lists at a moment, in this order */
const MOMENT_STATS = [
  'hp',
  'atk',
  'def',
  'eleMas',
  'enerRech_',
  'critRate_',
  'critDMG_',
]
/** Their short names (a card has two narrow columns) */
const SHORT_NAMES: Record<string, string> = {
  hp: 'HP',
  atk: 'ATK',
  def: 'DEF',
  eleMas: 'EM',
  enerRech_: 'ER',
  critRate_: 'CRIT Rate',
  critDMG_: 'CRIT DMG',
}
const shortName = (stat: string) =>
  SHORT_NAMES[stat] ??
  (stat.endsWith('_dmg_')
    ? `${stat[0].toUpperCase()}${stat.slice(1, -5)} DMG`
    : undefined)

/**
 * Every member's stats at a moment of the timeline, with the members' own builds (Team
 * optimize's: never on the KQM tab): the buffs the simulation times in the state they are in
 * then (or off), the member on the field then, the extra buffs counted. Worked out in the
 * background; the stats of the moment before stay until then.
 */
export function useMomentStats(
  teamId: string,
  moment: TimelineMoment | undefined,
  enabled: boolean
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [teamOpt] = useTeamOpt(teamId)
  const [stats, setStats] =
    useState<Partial<Record<CharacterKey, MomentStat[]>>>()
  const assumeMaxMain = !!teamOpt.assumeMaxMain
  const { bonusStats } = teamOpt
  const key = moment && enabled ? JSON.stringify(moment) : undefined
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `moment`
  useEffect(() => {
    if (!moment || !key) return setStats(undefined)
    const timer = setTimeout(() => {
      const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
      const data = getTeamDataWith(database, teamId, {
        states: moment.states,
        excluded: moment.excluded,
        mainStatAssumptionLevel: assumeMaxMain ? 20 : 0,
        bonusStats: teamOptBonusStats({ bonusStats }, keys),
      })
      if (!data) return
      const active =
        moment.onField && data[moment.onField] ? moment.onField : keys[0]
      if (!active || !data[active]) return
      const ui = uiDataForTeam(
        { [active]: data[active], ...data },
        gender,
        active
      )
      setStats(
        Object.fromEntries(
          keys.flatMap((characterKey) => {
            const target = ui[characterKey]?.target
            if (!target) return []
            const found = new Map(basicStats(target))
            const list = [
              ...MOMENT_STATS,
              // (its damage bonuses: the elements' and Physical, when it has any)
              ...[...found.keys()].filter((k) => k.endsWith('_dmg_')),
            ].flatMap((stat): MomentStat[] => {
              const calc = found.get(stat)
              if (!calc || typeof calc.value !== 'number') return []
              if (stat.endsWith('_dmg_') && !calc.value) return []
              const { name, unit, fixed, variant } = resolveInfo(calc.info)
              return [
                {
                  key: stat,
                  name: shortName(stat) ?? name,
                  value: valueString(calc.value, unit, fixed),
                  variant:
                    variant && variant !== 'invalid' ? variant : undefined,
                },
              ]
            })
            return [[characterKey, list]]
          })
        )
      )
    }, 40)
    return () => clearTimeout(timer)
  }, [database, teamId, gender, key, assumeMaxMain, bonusStats])
  return enabled ? stats : undefined
}
