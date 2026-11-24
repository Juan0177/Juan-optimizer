import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import { REACTION_NAMES } from '@genshin-optimizer/gi/ui'

/**
 * An attack's name in the hit list, with its reaction: "Frostfall Storm (Melt)". The simulation's
 * attacks already carry it in their description (`rotationAttacks`), so it is added only when
 * missing; adding it again gave "Frostfall Storm (Melt) (Melt)", and the hit list then showed the
 * melting hits as an attack of their own instead of a part of "Frostfall Storm".
 */
export function attackHitLabel(
  a: Pick<TeamOptAttack, 'path' | 'description' | 'reaction'>
): string {
  const base = a.description ?? a.path.join('.')
  if (!a.reaction) return base
  const tag = `(${REACTION_NAMES[a.reaction] ?? a.reaction})`
  return base.endsWith(tag) ? base : `${base} ${tag}`
}

/**
 * Where an attack goes in a member's hit card: the attack's name, and its kinds of hit as its
 * part ("Wing Dance Move (Stellar-Swirl)": "Wing Dance Move", ["Stellar-Swirl"]). Every trailing
 * "(…)" is a kind, so a melting "Flamestrider Charged Attack (Cyclic) (Melt)" is a part of
 * "Flamestrider Charged Attack", beside its "Cyclic" and "Final" hits.
 */
export function attackHitGroup(
  a: Pick<TeamOptAttack, 'path' | 'description' | 'reaction'>
): { name: string; tags: string[] } {
  const label = attackHitLabel(a)
  const tagged = label.match(/^(.*?)((?:\s*\([^()]*\))+)$/)
  if (!tagged || !tagged[1]) return { name: label, tags: [] }
  return {
    name: tagged[1],
    tags: [...tagged[2].matchAll(/\(([^()]*)\)/g)].map((m) => m[1]),
  }
}
