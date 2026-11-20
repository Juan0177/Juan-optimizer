import { valueString } from '@genshin-optimizer/common/util'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  SimBuffOwner,
  SimHit,
  SimulationResult,
  TeamData,
  TeamDataOverrides,
  TeamOptEvaluation,
} from '@genshin-optimizer/gi/ui'
import {
  attackHitData,
  evaluateTeamNodes,
  evaluateTeamRotation,
  getTeamDataWith,
  resolveInfo,
  rotationAttacks,
  teamOptBonusStats,
  teamOptMembers,
  teamRotationNodes,
} from '@genshin-optimizer/gi/ui'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { useEffect, useMemo, useRef, useState } from 'react'
import { HitStats } from './AttackEditor'
import type { BuffEffect } from './buffs'
import { buffEffects, describe } from './buffs'
import { basicStats } from './ResultDetails'
import type { MomentStat, TimelineMoment } from './RotationTimeline'
import type { MomentEffects } from './timelineModel'
import { momentBuffKey } from './timelineModel'
import { useTeamOpt } from './useTeamOpt'

type HitAttacks = Map<SimHit, { characterKey: CharacterKey; index: number }>
interface Mapped {
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>
  hitAttacks: HitAttacks
}

/**
 * The timeline's figures: each simulated hit's damage, and the attack it belongs to. With the
 * members' own builds (Team optimize's), or with `overrides` (KQM theorycrafting's builds, as its
 * run evaluates them: never the members' own on the KQM tab). The rotation's attacks are made from
 * the simulation shown (its first sample), evaluated once in the background; until then, and
 * when `enabled` is off, there are no figures.
 */
export function useTimelineFigures(
  teamId: string,
  sim: SimulationResult | undefined,
  own:
    | ((owner: SimBuffOwner, path: string[]) => string | undefined)
    | undefined,
  enabled: boolean,
  overrides?: TeamDataOverrides
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
  const kqmOnField = teamOpt.kqm?.onField
  useEffect(() => {
    if (!mapped) return undefined
    const timer = setTimeout(() => {
      const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
      const evaluation = overrides
        ? kqmEvaluation(database, teamId, gender, overrides, {
            attacks: mapped.attacks,
            onField: kqmOnField ?? onField,
          })
        : evaluateTeamRotation(database, teamId, gender, {
            arts: {},
            attacks: mapped.attacks,
            mainStatAssumptionLevel: assumeMaxMain ? 20 : 0,
            onField,
            bonusStats: teamOptBonusStats({ bonusStats } as never, keys),
          })
      if (evaluation) setEvaluated({ mapped, evaluation })
    }, 150)
    return () => clearTimeout(timer)
  }, [
    mapped,
    database,
    teamId,
    gender,
    assumeMaxMain,
    onField,
    kqmOnField,
    bonusStats,
    overrides,
  ])
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

/**
 * Attacks evaluated with KQM theorycrafting's builds and settings, as its run does (its own
 * switches, enemy and rules included, which `evaluateTeamRotation` leaves out)
 */
function kqmEvaluation(
  database: ReturnType<typeof useDatabase>,
  teamId: string,
  gender: GenderKey,
  overrides: TeamDataOverrides,
  { attacks, onField }: { attacks: Mapped['attacks']; onField?: CharacterKey }
) {
  const nodes = teamRotationNodes(database, teamId, gender, {
    ...overrides,
    arts: overrides.arts ?? {},
    attacks,
    onField,
  })
  return nodes && evaluateTeamNodes(database, teamId, attacks, nodes)
}

/** A pinned hit's stats: the character's and the hit's own, with the buffs up when it landed */
export function TimelineHitStats({
  teamId,
  characterKey,
  attack,
  overrides,
}: {
  teamId: string
  characterKey: CharacterKey
  attack: TeamOptAttack
  /** KQM theorycrafting's builds (never the members' own on the KQM tab) */
  overrides?: TeamDataOverrides
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
          onField: (overrides && teamOpt.kqm?.onField) || onField,
          bonusStats: teamOptBonusStats({ bonusStats } as never, keys),
          overrides,
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
    teamOpt.kqm?.onField,
    bonusStats,
    overrides,
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
 * The team at a moment of the timeline: the buffs the simulation times in the state they are in
 * then (or off), the member on the field then, the extra buffs counted. From it, each member's
 * stats then (`stats`: Team optimize's, with the members' own builds) and what each buff up then
 * gives, as its sheet shows it (`overrides`: KQM theorycrafting's builds, never the members' own).
 * Worked out in the background; what a buff gives stays from the moments before (each moment
 * adds to it), so the panel does not flicker while the next one is worked out.
 */
export function useMomentFigures(
  teamId: string,
  moment: TimelineMoment | undefined,
  {
    enabled,
    stats: withStats = true,
    teamData,
    overrides,
    mainStatAssumptionLevel,
  }: {
    enabled: boolean
    /** Each member's stats then (off: only what the buffs give) */
    stats?: boolean
    /** The members' sheets: what each buff is */
    teamData?: TeamData
    overrides?: TeamDataOverrides
    mainStatAssumptionLevel?: number
  }
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [teamOpt] = useTeamOpt(teamId)
  const [stats, setStats] =
    useState<Partial<Record<CharacterKey, MomentStat[]>>>()
  const [effects, setEffects] = useState<MomentEffects>()
  const assumeMaxMain = !!teamOpt.assumeMaxMain
  const { bonusStats } = teamOpt
  const level = mainStatAssumptionLevel ?? (assumeMaxMain ? 20 : 0)
  // (what the buffs gave at earlier moments: kept while the team is the same)
  const known = useRef<{ basis: unknown[]; map: Map<string, BuffEffect[]> }>({
    basis: [],
    map: new Map(),
  })
  const key = moment && enabled ? JSON.stringify(moment) : undefined
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `moment`
  useEffect(() => {
    if (!moment || !key) {
      setStats(undefined)
      return undefined
    }
    const timer = setTimeout(() => {
      const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
      const data = getTeamDataWith(database, teamId, {
        ...overrides,
        // (the ones on all rotation too: what they give is read in this data)
        states: [...moment.states, ...(moment.always ?? [])],
        excluded: moment.excluded,
        mainStatAssumptionLevel: level,
        bonusStats:
          overrides?.bonusStats ?? teamOptBonusStats({ bonusStats }, keys),
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
      if (withStats)
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
      if (!teamData) return
      // what each buff up then gives: its sheet's fields in that state, read from its owner's
      // data then (the team's own, a resonance's, from the member on the field)
      const sheets: TeamData = Object.fromEntries(
        keys.flatMap((ck) => {
          const bundle = teamData[ck]
          const target = ui[ck]?.target
          return bundle && target ? [[ck, { ...bundle, target }]] : []
        })
      )
      const basis = [teamData, overrides, level, bonusStats, gender]
      if (known.current.basis.some((x, i) => x !== basis[i]))
        known.current = { basis, map: new Map() }
      const map = new Map(known.current.map)
      for (const buff of [...moment.states, ...(moment.always ?? [])]) {
        const owner = buff.owner === 'team' ? active : buff.owner
        const target = ui[owner]?.target
        if (!target) continue
        const { fields } = describe(
          { owner: buff.owner, path: buff.path },
          buff.value,
          sheets
        )
        map.set(momentBuffKey(buff), buffEffects(fields?.[buff.value], target))
      }
      known.current.map = map
      setEffects(map)
    }, 40)
    return () => clearTimeout(timer)
  }, [
    database,
    teamId,
    gender,
    key,
    level,
    bonusStats,
    overrides,
    teamData,
    withStats,
  ])
  return {
    stats: enabled && withStats ? stats : undefined,
    effects: enabled ? effects : undefined,
  }
}
