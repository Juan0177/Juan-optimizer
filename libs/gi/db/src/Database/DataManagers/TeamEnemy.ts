import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import type { EleEnemyResKey } from '@genshin-optimizer/gi/keymap'

/** An enemy's stats over the defaults: its level, DEF reduction and ignore, RES per element */
export type EnemyOverride = Partial<
  Record<
    EleEnemyResKey | 'enemyLevel' | 'enemyDefRed_' | 'enemyDefIgn_',
    number
  >
>

/**
 * How the team plays a boss's mechanics where its fight cannot tell: seconds to break the Radiant
 * Moongecko's Moonstone Anchor ward (1–60: past its 35 s, not in time), and to be healed to full
 * after its Radiant Cocoon (0–40; -1: never)
 */
export interface TeamFightSettings {
  wardSeconds?: number
  healSeconds?: number
  /** Absent: Stygian fights start empty, custom enemies start full. */
  fullEnergy?: boolean
}
/** The most HP an enemy can be given (a trillion) */
export const MAX_ENEMY_HP = 1e12
const MAX_WARD_SECONDS = 60
const MAX_HEAL_SECONDS = 40
/** `TeamFightSettings` kept to their ranges (to 0.1 s); none left: undefined */
export function validateFightSettings(
  value: unknown
): TeamFightSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { wardSeconds, healSeconds, fullEnergy } = value as TeamFightSettings
  const tenth = (v: number) => Math.round(v * 10) / 10
  const out: TeamFightSettings = {
    ...(typeof wardSeconds === 'number' &&
    Number.isFinite(wardSeconds) &&
    wardSeconds >= 1 &&
    wardSeconds <= MAX_WARD_SECONDS
      ? { wardSeconds: tenth(wardSeconds) }
      : {}),
    ...(typeof healSeconds === 'number' &&
    Number.isFinite(healSeconds) &&
    (healSeconds === -1 ||
      (healSeconds >= 0 && healSeconds <= MAX_HEAL_SECONDS))
      ? { healSeconds: healSeconds === -1 ? -1 : tenth(healSeconds) }
      : {}),
    ...(typeof fullEnergy === 'boolean' ? { fullEnergy } : {}),
  }
  return Object.keys(out).length ? out : undefined
}

/** A team's enemy: its stats, the preset last applied, its HP set by hand, how its fight is played */
export interface TeamEnemy {
  enemyOverride: EnemyOverride
  enemyPreset?: string
  enemyHp?: number
  fightSettings?: TeamFightSettings
  /**
   * It can't be frozen, as set by hand (absent: its boss preset's, a boss as gcsim has the game's
   * boss type; else it can be). Hydro and Cryo still react on it, but it never has the Frozen aura
   * (no Shatter, nothing that needs it Frozen)
   */
  freezeImmune?: boolean
}

/** `enemyOverride` with every stat a number (level 100, no DEF changes, 10% RES by default) */
export function validateEnemyOverride(value: unknown): EnemyOverride {
  const source =
    value && typeof value === 'object' ? (value as EnemyOverride) : {}
  const out: EnemyOverride = {}
  const num = (v: unknown, fallback: number) =>
    typeof v === 'number' && !Number.isNaN(v) ? v : fallback
  out.enemyLevel = num(source.enemyLevel, 100)
  out.enemyDefRed_ = num(source.enemyDefRed_, 0)
  out.enemyDefIgn_ = num(source.enemyDefIgn_, 0)
  for (const ele of allElementWithPhyKeys) {
    const key = `${ele}_enemyRes_` as EleEnemyResKey
    out[key] = num(source[key], 10)
  }
  return out
}

/** A `TeamEnemy` from saved data (undefined: none saved) */
export function validateTeamEnemy(value: unknown): TeamEnemy | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { enemyOverride, enemyPreset, enemyHp, fightSettings, freezeImmune } =
    value as TeamEnemy
  const fight = validateFightSettings(fightSettings)
  return {
    enemyOverride: validateEnemyOverride(enemyOverride),
    ...(typeof enemyPreset === 'string' &&
    enemyPreset.length > 0 &&
    enemyPreset.length <= 64
      ? { enemyPreset }
      : {}),
    ...(typeof enemyHp === 'number' &&
    Number.isFinite(enemyHp) &&
    enemyHp >= 1 &&
    enemyHp <= MAX_ENEMY_HP
      ? { enemyHp: Math.round(enemyHp) }
      : {}),
    ...(fight ? { fightSettings: fight } : {}),
    ...(typeof freezeImmune === 'boolean' ? { freezeImmune } : {}),
  }
}
