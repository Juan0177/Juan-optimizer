import type {
  CharacterKey,
  GenderKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase, TeamOpt } from '@genshin-optimizer/gi/db'
import { uiInput } from '@genshin-optimizer/gi/wr'
import { teamOptUIData } from './display'
import type { KqmBuild, KqmResult } from './kqm'
import { kqmBuildRollValue, kqmChosenRolls } from './kqm'
import type { RotationScore } from './rotationSearch'
import { kqmTeamSensitivity, teamSensitivity } from './sensitivity'
import type { TeamOptResult } from './solve'
import { teamOptArtValues } from './solve'

/** The substats a build puts the rolls Energy Recharge does not need into */
const DAMAGE_SUBSTATS: readonly SubstatKey[] = [
  'hp_',
  'atk_',
  'def_',
  'eleMas',
  'critRate_',
  'critDMG_',
]

/** Each member's Energy Recharge price in a KQM or Team Optimize result's builds */
export interface ErPrice {
  /** The team's DPS from one more roll of its best damage substat */
  roll: number
  /** One Energy Recharge roll (%) */
  er: number
  /** Its Energy Recharge without the rolls the build put into it (%) */
  floor: number
  /**
   * Fraction of marginal best-substat value credited when a rotation lowers ER below the baseline
   * (default 1 for liquid KQM rolls; lower for discrete inventory builds so padded/tiny ER drops
   * do not outweigh real DPS losses while ER spikes still pay full cost).
   */
  saveScale?: number
}

/**
 * Real-inventory ER saving conversion factor: freeing ER rolls on discrete artifacts yields a
 * fraction of the single-best marginal substat's first-roll gain, while raising ER pays full cost.
 */
const TEAM_ER_SAVE_SCALE = 0.3

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
    const er = kqmBuildRollValue(build, 'enerRech_') * 100
    prices[key] = {
      roll: best / time,
      er,
      floor: has - (kqmChosenRolls(build).enerRech_ ?? 0) * er,
    }
  }
  return prices
}

/**
 * What a Team Optimize result's inventory builds pay for Energy Recharge, member by member: a
 * 5★ mid roll of their best damage substat for each roll of ER (`teamSensitivity`), above their
 * non-artifact ER floor (base + weapon + ascension + set bonuses). Kept and TC members are
 * fixed-ER (not re-optimized), so they are not priced.
 */
export async function teamErPrices(
  database: ArtCharDatabase,
  teamId: string,
  gender: GenderKey,
  teamOpt: TeamOpt,
  result: Pick<TeamOptResult, 'builds' | 'weapons' | 'attackStates'>,
  pause: () => Promise<void> = async () => undefined
): Promise<Partial<Record<CharacterKey, ErPrice>>> {
  const time = teamOpt.rotationTime ?? 20
  const prices: Partial<Record<CharacterKey, ErPrice>> = {}
  if (!(time > 0)) return prices
  const sensitivity = teamSensitivity(database, teamId, gender, teamOpt, result)
  const { base } = sensitivity
  if (base === undefined) return prices
  const uiData = teamOptUIData(database, teamId, gender, teamOpt, result)
  const mainStatAssumptionLevel = teamOpt.assumeMaxMain ? 20 : 0
  const er = sensitivity.rolls.enerRech_ * 100
  if (!(er > 0)) return prices
  for (const member of sensitivity.members) {
    const key = member.characterKey
    if (member.isTc || teamOpt.keep.includes(key)) continue
    const totalEr = uiData?.[key]?.get(uiInput.total.enerRech_).value
    if (typeof totalEr !== 'number' || !Number.isFinite(totalEr)) continue
    await pause()
    const subs = sensitivity.substats(member)
    let best = 0
    for (const s of DAMAGE_SUBSTATS) {
      const next = subs[s]
      if (next !== undefined) best = Math.max(best, next - base)
    }
    let artEr = 0
    for (const id of Object.values(result.builds[key] ?? {})) {
      const art = id ? database.arts.get(id) : undefined
      if (!art) continue
      artEr +=
        (teamOptArtValues(art, mainStatAssumptionLevel)['enerRech_'] ?? 0) * 100
    }
    prices[key] = {
      roll: best / time,
      er,
      floor: Math.max(100, totalEr * 100 - artEr),
      saveScale: TEAM_ER_SAVE_SCALE,
    }
  }
  return prices
}

/**
 * The DPS builds priced so (`kqmErPrices`, `teamErPrices`) give up for a rotation's Energy
 * Recharge needs. When `base` is provided and a price has `saveScale < 1`, ER increases above
 * `base` pay full marginal cost while ER decreases below `base` credit `saveScale` of it.
 */
export const erCostOf =
  (prices: Partial<Record<CharacterKey, ErPrice>>) =>
  (score: RotationScore, base?: RotationScore) => {
    let cost = 0
    for (const [key, price] of Object.entries(prices) as [
      CharacterKey,
      ErPrice | undefined,
    ][]) {
      if (!price) continue
      const need = score.er[key]
      const baseNeed = base?.er[key]
      if (need === undefined && baseNeed === undefined) continue
      const eff = Math.max(0, (need ?? 100) - price.floor)
      if (!base || price.saveScale === undefined || price.saveScale === 1) {
        cost += (price.roll * eff) / price.er
        continue
      }
      const baseEff = Math.max(0, (baseNeed ?? 100) - price.floor)
      const delta = eff - baseEff
      const weighted = delta < 0 ? baseEff + delta * price.saveScale : eff
      cost += (price.roll * weighted) / price.er
    }
    return cost
  }
