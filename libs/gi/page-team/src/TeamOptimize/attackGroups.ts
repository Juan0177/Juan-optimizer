import {
  allArtifactSetKeys,
  allWeaponKeys,
  type CharacterKey,
} from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack, TeamOptBuffOwner } from '@genshin-optimizer/gi/db'

/** Rows of a member's rotation: an attack, or the parts of one split by on-field member and buffs */
export type AttackGroup = { key: string; indices: number[] }

export const attackGroupKey = (attack: TeamOptAttack) =>
  [
    attack.path.join('.'),
    attack.reaction ?? '',
    attack.infusionAura ?? '',
    attack.hitMode,
  ].join('|')

/** The attacks grouped by what they are (path, reaction, infusion, hit mode), in first-seen order */
export function groupAttacks(attacks: readonly TeamOptAttack[]): AttackGroup[] {
  const groups = new Map<string, number[]>()
  attacks.forEach((attack, i) => {
    const key = attackGroupKey(attack)
    const indices = groups.get(key)
    if (indices) indices.push(i)
    else groups.set(key, [i])
  })
  return [...groups].map(([key, indices]) => ({ key, indices }))
}

/** Hits per rotation over the attacks */
export const totalHits = (attacks: readonly TeamOptAttack[]) =>
  attacks.reduce((sum, { hits }) => sum + hits, 0)

/** The weapon and the set pieces each member's build holds */
export type MemberGear = Partial<
  Record<
    CharacterKey,
    { weapon?: string; sets?: Partial<Record<string, number>> }
  >
>

/** Whether the giver of a buff holds the weapon or set it comes from (other buffs: yes) */
export function holdsItem(
  gear: MemberGear,
  owner: TeamOptBuffOwner,
  item: string
) {
  const build = owner === 'team' ? undefined : gear[owner]
  if (!build) return true
  if ((allWeaponKeys as readonly string[]).includes(item))
    return build.weapon === item
  if ((allArtifactSetKeys as readonly string[]).includes(item))
    return (build.sets?.[item] ?? 0) >= 2
  return true
}
