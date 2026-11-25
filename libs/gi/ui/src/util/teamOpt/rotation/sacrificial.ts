const sacrificialWeapons: ReadonlySet<string> = new Set([
  'SacrificialBow',
  'SacrificialFragments',
  'SacrificialGreatsword',
  'SacrificialSword',
])

export const isSacrificialWeapon = (weapon: string | undefined) =>
  weapon !== undefined && sacrificialWeapons.has(weapon)

/** Composed's Rate and CDTime in EquipAffixExcelConfigData, by refinement. */
export function sacrificialPassive(refinement = 1) {
  const rank = Math.max(1, Math.min(5, Math.round(refinement))) - 1
  return {
    chance: [0.4, 0.5, 0.6, 0.7, 0.8][rank],
    cooldown: [30, 26, 22, 19, 16][rank] * 60,
  }
}
