import type {
  CharacterKey,
  GenderKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import type { KqmBuild, KqmResult } from './kqm'
import { KQM_SUBSTAT_ROLLS, kqmBuildRarity } from './kqm'
import type { RotationScore } from './rotationSearch'
import { kqmTeamSensitivity } from './sensitivity'

/** The substats a build puts the rolls Energy Recharge does not need into */
const DAMAGE_SUBSTATS: readonly SubstatKey[] = [
  'hp_',
  'atk_',
  'def_',
  'eleMas',
  'critRate_',
  'critDMG_',
]

/** Each member's Energy Recharge price in a KQM result's builds */
export interface ErPrice {
  /** The team's DPS from one more roll of its best damage substat */
  roll: number
  /** One Energy Recharge roll (%) */
  er: number
  /** Its Energy Recharge without the rolls the build put into it (%) */
  floor: number
}

/**
 * What a KQM result's builds pay for Energy Recharge, member by member: a roll of its best damage
 * substat for each roll of ER (`kqmTeamSensitivity`), above what the build has without ER rolls
 */
export async function kqmErPrices(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  runTeamOpt: TeamOpt,
  result: KqmResult,
  /** Lets the page take input between evaluations */
  pause: () => Promise<void> = async () => undefined,
  /**
   * What a roll of each substat adds to the team's damage (0.0105 for +1.05%), where known (the
   * "What raises team damage" table's): the others are worked out
   */
  gains: Partial<
    Record<CharacterKey, Partial<Record<SubstatKey, number | null>>>
  > = {}
): Promise<Partial<Record<CharacterKey, ErPrice>>> {
  const time = result.played?.rotationTime ?? runTeamOpt.rotationTime ?? 20
  const prices: Partial<Record<CharacterKey, ErPrice>> = {}
  if (!(time > 0)) return prices
  let sensitivity: ReturnType<typeof kqmTeamSensitivity> | undefined
  for (const [key, build] of Object.entries(result.builds) as [
    CharacterKey,
    KqmBuild,
  ][]) {
    const has = result.energyRecharge[key]?.value
    if (has === undefined) continue
    const known = gains[key]
    let best = 0
    if (known && DAMAGE_SUBSTATS.every((s) => known[s] !== undefined))
      for (const s of DAMAGE_SUBSTATS)
        best = Math.max(best, (known[s] ?? 0) * result.after.total)
    else {
      await pause()
      sensitivity ??= kqmTeamSensitivity(
        database,
        teamId,
        gender,
        runTeamOpt,
        result
      )
      const { base } = sensitivity
      const member = sensitivity.members.find((m) => m.characterKey === key)
      if (base === undefined || !member) continue
      for (const s of DAMAGE_SUBSTATS) {
        await pause()
        const total = sensitivity.substats(member, [s])[s]
        if (total !== undefined) best = Math.max(best, total - base)
      }
    }
    const er =
      KQM_SUBSTAT_ROLLS.enerRech_ * kqmBuildRarity(build).subScale * 100
    prices[key] = {
      roll: best / time,
      er,
      floor: has - (build.rolls.enerRech_ ?? 0) * er,
    }
  }
  return prices
}

/** The DPS builds priced so (`kqmErPrices`) give up for a rotation's Energy Recharge needs */
export const erCostOf =
  (prices: Partial<Record<CharacterKey, ErPrice>>) => (score: RotationScore) =>
    Object.entries(score.er).reduce((cost, [key, need]) => {
      const price = prices[key as CharacterKey]
      return price && need !== undefined
        ? cost + (price.roll * Math.max(0, need - price.floor)) / price.er
        : cost
    }, 0)
