import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamOptKqm } from '@genshin-optimizer/gi/db'
import type { KqmBuild, KqmResult } from '@genshin-optimizer/gi/ui'
import { kqmTalentLevel } from '@genshin-optimizer/gi/ui'

/*
 * juanlab: the two sides of the comparison card, each from a KQM result (the original's and a
 * version's, as KQM Theorycrafting saved them)
 */

export interface SideMember {
  key: CharacterKey
  damage: number
  /** Of the team's damage (0 to 1) */
  share: number
  /** Total ER target (%) */
  er: number
  /** Total ER its build reaches (%) */
  erValue: number
  build?: KqmBuild
  /** Its constellation in the result */
  constellation: number
  /** In both teams (not swapped) */
  fixed: boolean
  /** Its share of the rotation's field time (%), as the ER calculator has it */
  fieldTime?: number
}
export interface Side {
  /** Damage per rotation */
  dpr: number
  dps: number
  /** Seconds */
  rotationTime: number
  members: SideMember[]
  rotation: string
  /**
   * The changed members' turns of `rotation` (their indexes among the turns the parser cuts it
   * into), marked on the card; absent or empty: none
   */
  turns?: number[]
  /** The KQM talent level its settings use */
  talents?: number
  /** The artifact standard its settings use (all members', or each one's) */
  artifacts?: Pick<TeamOptKqm, 'standard' | 'memberStandards'>
}

/** One side of the comparison, from a KQM result */
export function sideOf(
  result: KqmResult,
  rotation: string,
  fixed: readonly CharacterKey[],
  /** Seconds per rotation when the result played none (the attacks were entered) */
  fallbackTime?: number,
  /** The settings it was set up with: its members' field time, its talents, its standard */
  settings?: TeamOpt,
  /** Its members in this order (the team's slots); absent: the result's */
  order?: readonly CharacterKey[]
): Side {
  const calc = settings?.kqm?.energyCalculator
  const dpr = result.after.total
  const rotationTime = result.played?.rotationTime ?? fallbackTime ?? 0
  const found = result.optimized?.length
    ? result.optimized
    : (Object.keys(result.after.members) as CharacterKey[])
  const keys = order
    ? [
        ...order.filter((k) => found.includes(k)),
        ...found.filter((k) => !order.includes(k)),
      ]
    : found
  return {
    dpr,
    dps: rotationTime > 0 ? dpr / rotationTime : 0,
    rotationTime,
    rotation,
    ...(settings && {
      talents: kqmTalentLevel(settings.kqm),
      artifacts: {
        standard: settings.kqm?.standard,
        memberStandards: settings.kqm?.memberStandards,
      },
    }),
    members: keys.map((key) => {
      const damage = result.after.members[key] ?? 0
      const energy = result.energyRecharge[key]
      return {
        key,
        damage,
        share: dpr ? damage / dpr : 0,
        er: energy?.target ?? 0,
        erValue: energy?.value ?? 0,
        build: result.builds[key],
        constellation: result.constellations[key] ?? 0,
        fixed: fixed.includes(key),
        fieldTime: calc?.members[key]?.fieldTime,
      }
    }),
  }
}
