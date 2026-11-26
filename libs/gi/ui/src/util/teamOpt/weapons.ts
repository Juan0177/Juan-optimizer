import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ICachedWeapon,
  StatFilters,
  TeamOpt,
  TeamOptEnergyCalculator,
} from '@genshin-optimizer/gi/db'
import { getCharWeaponType, getWeaponStat } from '@genshin-optimizer/gi/stats'
import type { TeamOptMember } from './data'
import { calculateEnergyRecharge } from './energyCalc'

export const DEFAULT_WEAPON_MIN_RARITY = 4
export const DEFAULT_WEAPON_MIN_LEVEL = 70

/**
 * Weapons shown and enabled by default in Team optimize: 4★ and 5★ weapons at level 70+.
 * 1–3★ weapons and weapons below level 70 are hidden and disabled by default unless explicitly
 * ticked by the user (`TeamOpt.includedWeapons`).
 */
export function isDefaultTeamOptWeapon(
  weapon: Pick<ICachedWeapon, 'key' | 'level'>
): boolean {
  return (
    (getWeaponStat(weapon.key)?.rarity ?? 0) >= DEFAULT_WEAPON_MIN_RARITY &&
    weapon.level >= DEFAULT_WEAPON_MIN_LEVEL
  )
}

/** Whether `weapon` is excluded globally (explicitly excluded, or hidden-by-default and not included) */
export function isWeaponGloballyExcluded(
  weapon: Pick<ICachedWeapon, 'id' | 'key' | 'level'>,
  teamOpt: Pick<TeamOpt, 'excludedWeapons' | 'includedWeapons'>
): boolean {
  if (isDefaultTeamOptWeapon(weapon))
    return teamOpt.excludedWeapons.includes(weapon.id)
  return !teamOpt.includedWeapons?.includes(weapon.id)
}

/** Whether a weapon can be wielded by `characterKey` */
export function canWield(characterKey: CharacterKey, weapon: ICachedWeapon) {
  return (
    getWeaponStat(weapon.key)?.weaponType === getCharWeaponType(characterKey)
  )
}

/** Whether `weapon` is left out for `characterKey` (globally or for this member) */
export function isWeaponExcludedFor(
  characterKey: CharacterKey,
  weapon: Pick<ICachedWeapon, 'id' | 'key' | 'level'>,
  teamOpt: Pick<
    TeamOpt,
    'excludedWeapons' | 'includedWeapons' | 'excludedWeaponMembers'
  >
): boolean {
  return (
    isWeaponGloballyExcluded(weapon, teamOpt) ||
    !!teamOpt.excludedWeaponMembers?.[weapon.id]?.includes(characterKey)
  )
}

/**
 * Whether every member in `members` can be assigned a distinct weapon from `weapons` that is
 * allowed for them (exact bipartite matching for a small team of up to 4 members).
 */
export function canAssignTeamWeapons(
  members: readonly CharacterKey[],
  weapons: readonly { id: string }[],
  isAllowed: (characterKey: CharacterKey, weaponId: string) => boolean
): boolean {
  const n = members.length
  if (!n) return true
  // Order members with fewer options first so backtracking resolves at once
  const choices = members
    .map((ck) => weapons.filter((w) => isAllowed(ck, w.id)).map((w) => w.id))
    .sort((a, b) => a.length - b.length)
  if (choices.some((c) => !c.length)) return false
  const used = new Set<string>()
  const assign = (i: number): boolean => {
    if (i === n) return true
    // With at least `n` choices, a member can always pick one not used by the other `n - 1`
    if (choices[i].length >= n) return assign(i + 1)
    for (const id of choices[i]) {
      if (used.has(id)) continue
      used.add(id)
      if (assign(i + 1)) return true
      used.delete(id)
    }
    return false
  }
  return assign(0)
}

/**
 * The weapons a member may be given: the ticked ones of its type (not left out in the weapon
 * chooser, globally or for this member), wherever they are (unequipped, on a teammate, or on
 * someone outside the team: the chooser lists them all), and not `taken` by another member. Its
 * current weapon comes first (the one to beat) when it is allowed for it. A weapon left out is
 * never chosen; a member left without any other keeps its current one (it must wield something:
 * `teamOptUntickedWeapons` tells). A teammate's weapon is not one when the current one is left out
 * (or left out for that teammate when it has no other allowed weapon): the teammate would get it in
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
  const excludedFor = (ck: CharacterKey, weapon: ICachedWeapon) =>
    isWeaponExcludedFor(ck, weapon, teamOpt)
  const current = database.weapons.get(currentWeaponId)
  // equipping a teammate's weapon gives it this one's: not when it is left out
  const currentExcluded = current
    ? excludedFor(member.characterKey, current)
    : false
  const holderCanSwap = (weapon: ICachedWeapon) => {
    if (!weapon.location || weapon.location === member.location) return true
    if (!teamLocations.has(weapon.location)) return true
    if (currentExcluded) return false
    const holder = database.chars.LocationToCharacterKey(weapon.location)
    if (!current || !excludedFor(holder, current)) return true
    // If giving `current` to `holder` would leave `holder` on a weapon excluded for them,
    // allow it only when `holder` has another untaken weapon they can switch to.
    return database.weapons.values.some(
      (w) =>
        w.id !== weapon.id &&
        w.id !== current.id &&
        !taken.has(w.id) &&
        canWield(holder, w) &&
        !excludedFor(holder, w)
    )
  }
  const rarity = (weapon: ICachedWeapon) =>
    getWeaponStat(weapon.key)?.rarity ?? 0
  const others = database.weapons.values
    .filter(
      (weapon) =>
        weapon.id !== currentWeaponId &&
        canWield(member.characterKey, weapon) &&
        !excludedFor(member.characterKey, weapon) &&
        !taken.has(weapon.id) &&
        holderCanSwap(weapon)
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
    (!excludedFor(member.characterKey, current) || !others.length)
  const candidates = keepCurrent ? [current, ...others] : others
  // Copies of the same weapon (key, level, ascension, refinement, energy and member settings) give
  // the same builds: one of each is tried, the one that moves least: the member's own, an
  // unequipped one, then one held outside the team, then a teammate's
  const moves = (weapon: ICachedWeapon) =>
    weapon.id === currentWeaponId || weapon.location === member.location
      ? 0
      : !weapon.location
        ? 1
        : !teamLocations.has(weapon.location)
          ? 2
          : 3
  const copyOf = (weapon: ICachedWeapon) => {
    const members = [...(teamOpt.excludedWeaponMembers?.[weapon.id] ?? [])]
      .sort()
      .join(',')
    return `${weapon.key}|${weapon.level}|${weapon.ascension}|${weapon.refinement}|${JSON.stringify(teamOpt.weaponEnergy[weapon.id] ?? {})}|${members}`
  }
  const kept = new Map<string, ICachedWeapon>()
  for (const weapon of candidates) {
    const copy = copyOf(weapon)
    const other = kept.get(copy)
    if (!other || moves(weapon) < moves(other)) kept.set(copy, weapon)
  }
  // A copy at most as high in level, ascension and refinement as another of the same weapon (same
  // settings) is never better: its stats and passive only grow with them (an energy weapon's
  // Energy too), so only the strongest is tried. Not when either is a teammate's: taking it hands
  // that teammate this member's weapon. The member's own stays (its floor).
  const settingsOf = (weapon: ICachedWeapon) =>
    copyOf(weapon).split('|').slice(4).join('|')
  const outranks = (a: ICachedWeapon, b: ICachedWeapon) =>
    a.key === b.key &&
    a !== b &&
    a.level >= b.level &&
    a.ascension >= b.ascension &&
    a.refinement >= b.refinement &&
    moves(a) < 3 &&
    moves(b) < 3 &&
    settingsOf(a) === settingsOf(b)
  const copies = [...kept.values()]
  const chosen = new Set(
    copies.filter(
      (weapon) =>
        weapon.id === currentWeaponId ||
        !copies.some((other) => outranks(other, weapon))
    )
  )
  return candidates.filter((weapon) => chosen.has(weapon))
}

/**
 * The members that end up with a weapon left out in the weapon chooser: none of the ticked ones
 * was free for them (none of their type is ticked for them, or the others took them), so they kept
 * theirs
 */
export function teamOptUntickedWeapons(
  database: ArtCharDatabase,
  members: readonly TeamOptMember[],
  weapons: Partial<Record<CharacterKey, string>>,
  teamOpt: TeamOpt
): CharacterKey[] {
  if (!teamOpt.optimizeWeapons) return []
  return members
    .filter((m) => !m.isTc)
    .filter((m) => {
      const weapon = database.weapons.get(weapons[m.characterKey] ?? m.weaponId)
      return !!weapon && isWeaponExcludedFor(m.characterKey, weapon, teamOpt)
    })
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

export const isErFilter = (pathStr: string) => {
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
 * Automatic ER: the members' Energy Recharge requirements come from the team's ER calculator,
 * worked out for the weapons each build holds; otherwise (Manual) from their own settings
 */
export const teamEnergyAuto = (
  teamOpt: Pick<TeamOpt, 'energySource' | 'energyCalculator'>
) => teamOpt.energySource === 'calculator' && !!teamOpt.energyCalculator

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
  if (!teamEnergyAuto(teamOpt) || !calculator) return undefined
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

/**
 * Per member, how much less Energy Recharge the ER calculator needs when `holder` equips
 * `weaponKey` at `refinement` compared to `holder` holding no energy weapon (the other members
 * holding `baseWeapons`). Undefined when the calculator inputs have errors.
 */
export interface WeaponCalculatorImpact {
  base: Partial<Record<CharacterKey, number>>
  withWeapon: Partial<Record<CharacterKey, number>>
  /** Members whose required ER drops when `holder` wields the weapon */
  changes: {
    characterKey: CharacterKey
    from: number
    to: number
    diff: number
  }[]
}

export function weaponCalculatorImpact(
  keys: readonly CharacterKey[],
  calculator: TeamOptEnergyCalculator,
  holder: CharacterKey,
  weaponKey: WeaponKey,
  refinement: number,
  baseWeapons: Partial<Record<CharacterKey, WeaponKey>> = {},
  baseRefinements: Partial<Record<CharacterKey, number>> = {}
): WeaponCalculatorImpact | undefined {
  const withoutWeapons = { ...baseWeapons }
  const withoutRefinements = { ...baseRefinements }
  delete withoutWeapons[holder]
  delete withoutRefinements[holder]
  const without = calculateEnergyRecharge(
    keys,
    calculator,
    withoutWeapons,
    withoutRefinements
  )
  if (without.errors.length) return undefined
  const withIt = calculateEnergyRecharge(
    keys,
    calculator,
    { ...withoutWeapons, [holder]: weaponKey },
    { ...withoutRefinements, [holder]: refinement }
  )
  if (withIt.errors.length) return undefined
  const changes: WeaponCalculatorImpact['changes'] = []
  for (const ck of keys) {
    const from = without.targets[ck]
    const to = withIt.targets[ck]
    if (from === undefined || to === undefined) continue
    const diff = Math.round((from - to) * 10) / 10
    if (diff >= 0.1) changes.push({ characterKey: ck, from, to, diff })
  }
  return { base: without.targets, withWeapon: withIt.targets, changes }
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
