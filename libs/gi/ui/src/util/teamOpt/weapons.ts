import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ICachedWeapon,
  StatFilters,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import { getCharWeaponType, getWeaponStat } from '@genshin-optimizer/gi/stats'
import type { TeamOptMember } from './data'
import { calculateEnergyRecharge } from './energyCalc'

/** Whether a weapon can be wielded by `characterKey` */
export function canWield(characterKey: CharacterKey, weapon: ICachedWeapon) {
  return (
    getWeaponStat(weapon.key)?.weaponType === getCharWeaponType(characterKey)
  )
}

/**
 * The weapons a member may be given: the ticked ones of its type (not left out in the weapon
 * chooser), wherever they are (unequipped, on a teammate, or on someone outside the team: the
 * chooser lists them all), and not `taken` by another member. Its current weapon comes first (the
 * one to beat) when it is ticked. A weapon left out is never chosen; a member left without any
 * other keeps its current one (it must wield something: `teamOptUntickedWeapons` tells). A
 * teammate's weapon is not one when the current one is left out: the teammate would get it in
 * exchange. The others come strongest first (rarity, level, refinement): of weapons that are worth
 * the same to the team, the first one tried is kept, so never a 1-star for being listed first.
 */
export function teamOptWeaponCandidates(
  database: ArtCharDatabase,
  member: TeamOptMember,
  currentWeaponId: string,
  teamOpt: TeamOpt,
  teamLocations: ReadonlySet<string>,
  taken: ReadonlySet<string>
): ICachedWeapon[] {
  const excluded = new Set(teamOpt.excludedWeapons)
  const current = database.weapons.get(currentWeaponId)
  // equipping a teammate's weapon gives it this one's: not when it is left out
  const mayTakeTeammates = !excluded.has(currentWeaponId)
  const rarity = (weapon: ICachedWeapon) =>
    getWeaponStat(weapon.key)?.rarity ?? 0
  const others = database.weapons.values
    .filter(
      (weapon) =>
        weapon.id !== currentWeaponId &&
        canWield(member.characterKey, weapon) &&
        !excluded.has(weapon.id) &&
        !taken.has(weapon.id) &&
        (mayTakeTeammates ||
          !weapon.location ||
          weapon.location === member.location ||
          !teamLocations.has(weapon.location))
    )
    .sort(
      (a, b) =>
        rarity(b) - rarity(a) ||
        b.level - a.level ||
        b.refinement - a.refinement
    )
  const keepCurrent =
    current &&
    !taken.has(current.id) &&
    (!excluded.has(current.id) || !others.length)
  const candidates = keepCurrent ? [current, ...others] : others
  // Copies of the same weapon (key, level, ascension, refinement, energy setting) give the same
  // builds: one of each is tried, the one that moves least: the member's own, an unequipped one,
  // then one held outside the team, then a teammate's
  const moves = (weapon: ICachedWeapon) =>
    weapon.id === currentWeaponId || weapon.location === member.location
      ? 0
      : !weapon.location
        ? 1
        : !teamLocations.has(weapon.location)
          ? 2
          : 3
  const copyOf = (weapon: ICachedWeapon) =>
    `${weapon.key}|${weapon.level}|${weapon.ascension}|${weapon.refinement}|${JSON.stringify(teamOpt.weaponEnergy[weapon.id] ?? {})}`
  const kept = new Map<string, ICachedWeapon>()
  for (const weapon of candidates) {
    const copy = copyOf(weapon)
    const other = kept.get(copy)
    if (!other || moves(weapon) < moves(other)) kept.set(copy, weapon)
  }
  const chosen = new Set(kept.values())
  return candidates.filter((weapon) => chosen.has(weapon))
}

/**
 * The members that end up with a weapon left out in the weapon chooser: none of the ticked ones
 * was free for them (none of their type is ticked, or the others took them), so they kept theirs
 */
export function teamOptUntickedWeapons(
  members: readonly TeamOptMember[],
  weapons: Partial<Record<CharacterKey, string>>,
  teamOpt: TeamOpt
): CharacterKey[] {
  if (!teamOpt.optimizeWeapons) return []
  const excluded = new Set(teamOpt.excludedWeapons)
  return members
    .filter((m) => !m.isTc)
    .filter((m) => excluded.has(weapons[m.characterKey] ?? m.weaponId))
    .map((m) => m.characterKey)
}

/**
 * Weapons whose passive gives the team or the wielder energy (particles, energy restored): not a
 * stat the formulas count. Tagged in the weapon chooser, where the user sets how much less Energy
 * Recharge each member needs while one of them wields it (`TeamOpt.weaponEnergy`); passives that
 * give Energy Recharge itself are counted already when on.
 */
export const energyWeaponKeys: readonly WeaponKey[] = [
  'FavoniusSword',
  'FavoniusGreatsword',
  'FavoniusLance',
  'FavoniusCodex',
  'FavoniusWarbow',
  'SacrificialSword',
  'SacrificialGreatsword',
  'SacrificialFragments',
  'SacrificialBow',
  'PrototypeAmber',
  'EverlastingMoonglow',
  'EngulfingLightning',
  'TomeOfTheEternalFlow',
  'KitainCrossSpear',
  'CranesEchoingCall',
  'FlameForgedInsight',
  'AmenomaKageuchi',
  'KatsuragikiriNagamasa',
  'AngelosHeptades',
  'BeyondTheChrysalis',
  'BloodsoakedRuins',
  'DialoguesOfTheDesertSages',
  'ExaiphanesBlade',
  'Frostbreath',
  'LumidouceElegy',
  'NocturnesCurtainCall',
  'PortablePowerSaw',
  'RightfulReward',
  'Silverdawn',
  'SongOfTheVigil',
  'TheDockhandsAssistant',
  'WhitelakeFrostfeather',
]
export const isEnergyWeapon = (weaponKey: WeaponKey) =>
  energyWeaponKeys.includes(weaponKey)

const isErFilter = (pathStr: string) => {
  try {
    return (JSON.parse(pathStr) as string[]).at(-1) === 'enerRech_'
  } catch {
    return false
  }
}

/** Whether `statFilters` has an Energy Recharge requirement that is on */
export function hasEnergyRequirement(statFilters: StatFilters | undefined) {
  return Object.entries(statFilters ?? {}).some(
    ([path, settings]) => isErFilter(path) && settings.some((s) => !s.disabled)
  )
}

/** `statFilters` with its Energy Recharge requirements lowered by `relief` (percent points) */
export function withEnergyRelief(
  statFilters: StatFilters,
  relief: number
): StatFilters {
  if (!(relief > 0)) return statFilters
  return Object.fromEntries(
    Object.entries(statFilters).map(([path, settings]) => [
      path,
      isErFilter(path)
        ? settings.map((s) => ({ ...s, value: s.value - relief }))
        : settings,
    ])
  )
}

/**
 * Per member, how much less Energy Recharge it needs with the team's `weapons`: what the user set
 * for it on each energy weapon someone in the team wields (`TeamOpt.weaponEnergy`), added up.
 */
export function teamEnergyRelief(
  weapons: Partial<Record<CharacterKey, ICachedWeapon>>,
  teamOpt: TeamOpt
): Partial<Record<CharacterKey, number>> {
  const relief: Partial<Record<CharacterKey, number>> = {}
  const counted = new Set<string>()
  for (const weapon of Object.values(weapons)) {
    if (!weapon || counted.has(weapon.id)) continue
    counted.add(weapon.id)
    for (const [characterKey, value] of Object.entries(
      teamOpt.weaponEnergy[weapon.id] ?? {}
    ) as [CharacterKey, number][])
      if (value > 0) relief[characterKey] = (relief[characterKey] ?? 0) + value
  }
  return relief
}

const ER_FILTER = JSON.stringify(['basic', 'enerRech_'])

/**
 * The members' Energy Recharge targets from the team's ER calculator, for the weapons they hold
 * (Favonius particles and energy weapons count for their wielders). Undefined: the requirements are
 * the members' own (`TeamOpt.energySource`), or the calculator cannot tell.
 */
export function teamCalculatorTargets(
  keys: readonly CharacterKey[],
  weapons: Partial<Record<CharacterKey, ICachedWeapon>>,
  teamOpt: Pick<TeamOpt, 'energySource' | 'energyCalculator'>
): Partial<Record<CharacterKey, number>> | undefined {
  const calculator = teamOpt.energyCalculator
  if (teamOpt.energySource !== 'calculator' || !calculator) return undefined
  const held = keys.filter((k) => weapons[k])
  const result = calculateEnergyRecharge(
    keys,
    calculator,
    Object.fromEntries(held.map((k) => [k, weapons[k]!.key])),
    Object.fromEntries(held.map((k) => [k, weapons[k]!.refinement]))
  )
  return result.errors.length ? undefined : result.targets
}

/** `statFilters` with its Energy Recharge requirement set to `target` (undefined: none) */
function withErTarget(statFilters: StatFilters, target: number | undefined) {
  const rest = Object.fromEntries(
    Object.entries(statFilters).filter(([path]) => !isErFilter(path))
  )
  return target === undefined
    ? rest
    : { ...rest, [ER_FILTER]: [{ value: target, disabled: false }] }
}

/**
 * Each member's minimum Energy Recharge with these weapons, as `teamStatFilters` sets it (absent:
 * none): what a weapon changes for the others
 */
export function teamEnergyNeeds(
  base: Partial<Record<CharacterKey, StatFilters>>,
  weapons: Partial<Record<CharacterKey, ICachedWeapon>>,
  teamOpt: TeamOpt
): Partial<Record<CharacterKey, number>> {
  const needs: Partial<Record<CharacterKey, number>> = {}
  for (const [ck, filters] of Object.entries(
    teamStatFilters(base, weapons, teamOpt)
  ))
    for (const [path, settings] of Object.entries(filters ?? {}))
      if (isErFilter(path))
        for (const s of settings)
          if (!s.disabled)
            needs[ck as CharacterKey] = Math.max(
              needs[ck as CharacterKey] ?? Number.NEGATIVE_INFINITY,
              s.value
            )
  return needs
}

/**
 * Each member's constraints: its optimizer's, with its Energy Recharge requirement lowered by
 * what the team's energy weapons are worth to it (`teamEnergyRelief`); with the ER calculator,
 * the calculator's target for the weapons held instead.
 */
export function teamStatFilters(
  base: Partial<Record<CharacterKey, StatFilters>>,
  weapons: Partial<Record<CharacterKey, ICachedWeapon>>,
  teamOpt: TeamOpt
): Partial<Record<CharacterKey, StatFilters>> {
  const targets = teamCalculatorTargets(
    Object.keys(base) as CharacterKey[],
    weapons,
    teamOpt
  )
  if (targets)
    return Object.fromEntries(
      Object.entries(base).map(([characterKey, filters]) => [
        characterKey,
        withErTarget(filters ?? {}, targets[characterKey as CharacterKey]),
      ])
    ) as Partial<Record<CharacterKey, StatFilters>>
  const relief = teamEnergyRelief(weapons, teamOpt)
  return Object.fromEntries(
    Object.entries(base).map(([characterKey, filters]) => [
      characterKey,
      withEnergyRelief(
        filters ?? {},
        relief[characterKey as CharacterKey] ?? 0
      ),
    ])
  ) as Partial<Record<CharacterKey, StatFilters>>
}

/** The members' current weapons */
export function teamOptCurrentWeapons(
  database: ArtCharDatabase,
  members: readonly TeamOptMember[]
): Partial<Record<CharacterKey, ICachedWeapon>> {
  const weapons: Partial<Record<CharacterKey, ICachedWeapon>> = {}
  for (const { characterKey, weaponId, isTc } of members) {
    if (isTc) continue
    const weapon = database.weapons.get(weaponId)
    if (weapon) weapons[characterKey] = weapon
  }
  return weapons
}
