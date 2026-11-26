import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { memberSteps } from './parse'
import data from './templates.json'

export const rotationTemplateKinds = {
  natlan: 'Natlan',
  melt: 'Melt',
  freeze: 'Freeze',
  vapeMelt: 'Vape-Melt',
  aggravate: 'Aggravate',
  quickbloom: 'Quickbloom',
  lunarCharged: 'Lunar-Charged',
  lunarBloom: 'Lunar-Bloom',
  lunarCrystallize: 'Lunar-Crystallize',
  stellarConduct: 'Stellar-Conduct',
  hypercarry: 'Hypercarry',
  vaporize: 'Vaporize',
  overvape: 'Overvape',
  overloaded: 'Overloaded',
  national: 'National',
  burning: 'Burning',
  crystallize: 'Crystallize',
  monoPyro: 'Mono Pyro',
  hexerei: 'Hexerei',
  spread: 'Spread',
  physical: 'Physical',
  doubleGeo: 'Double Geo',
} as const
export type RotationTemplateKind = keyof typeof rotationTemplateKinds

/** A built-in rotation for a main DPS and the team it is written for */
export interface RotationTemplate {
  /** The members, joined (the main DPS's list is keyed by it) */
  id: string
  /** The main DPS it is for */
  characterKey: CharacterKey
  /** Its archetype (`teamOpt.templates.kind.<kind>`) */
  kind: RotationTemplateKind
  members: CharacterKey[]
  text: string
  /** The first rotation, when it differs from the loop */
  opener?: string
  /** How long `text` plays in our simulation (all of its rotations), seconds */
  seconds: number
  /** The rotations `text` holds: 2 when Bursts alternate between rotations */
  rotations?: number
  source: { name: string; url: string }
  /** The constellations and gear it was played with when it was checked (the source's) */
  checked?: {
    constellations?: Partial<Record<CharacterKey, number>>
    gear?: Partial<
      Record<
        CharacterKey,
        {
          weapon?: WeaponKey
          refinement?: number
          sets?: Partial<Record<ArtifactSetKey, number>>
        }
      >
    >
  }
}

/**
 * From KQM's guides and team calcs (and community calcs where KQM has none), each played in our
 * simulation before it was added. The released build leaves out entries whose key names beta
 * content, so a template's id names every member.
 */
export const rotationTemplates: RotationTemplate[] = Object.entries(
  data as Record<
    string,
    Record<string, Omit<RotationTemplate, 'id' | 'characterKey'>>
  >
).flatMap(([characterKey, byId]) =>
  Object.entries(byId).map(([id, template]) => ({
    ...template,
    id,
    characterKey: characterKey as CharacterKey,
  }))
)

/**
 * The templates for a team's members as main DPS: those whose whole team it is first, then by how
 * many of their members it has
 */
export function templatesForTeam(members: CharacterKey[]) {
  const has = (t: RotationTemplate) =>
    t.members.filter((m) => members.includes(m)).length
  return rotationTemplates
    .filter((t) => members.includes(t.characterKey))
    .map((t, i) => ({ t, i, n: has(t) }))
    .sort(
      (a, b) =>
        Number(b.n === b.t.members.length) -
          Number(a.n === a.t.members.length) ||
        b.n - a.n ||
        a.i - b.i
    )
    .map(({ t }) => t)
}

/**
 * What a character does as a support in the templates: its first step there, the most common one
 * ("E Q" when no template has it as a support)
 */
export function supportPart(characterKey: CharacterKey): string {
  return supportPartSuggestions(characterKey, 1)[0] ?? 'E Q'
}

const DEFAULT_SUPPORT_PARTS = ['E Q', 'E', 'Q', 'Q E'] as const

/**
 * Distinct support parts a character plays across templates, most common first, padded with basic
 * fallbacks (`E Q`, `E`, `Q`, `Q E`) so every character has quick one-click alternatives.
 */
export function supportPartSuggestions(
  characterKey: CharacterKey,
  limit = 5
): string[] {
  const counts = new Map<string, number>()
  for (const t of rotationTemplates) {
    if (t.characterKey === characterKey || !t.members.includes(characterKey))
      continue
    const [part] = memberSteps(
      t.text,
      t.members.map((k) => ({ characterKey: k, name: k })),
      characterKey
    )
    if (part) counts.set(part, (counts.get(part) ?? 0) + 1)
  }
  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([part]) => part)
  for (const fallback of DEFAULT_SUPPORT_PARTS)
    if (!ranked.includes(fallback)) ranked.push(fallback)
  return ranked.slice(0, Math.max(1, limit))
}

/**
 * What a character does as the main DPS in its own templates: its longest step in the first one
 * (its field time); none without a template of its own
 */
export function mainPart(characterKey: CharacterKey): string | undefined {
  return mainPartSuggestions(characterKey, 1)[0]
}

/**
 * Distinct main-DPS field-time steps a character plays across its own templates (longest step per
 * template), preserving template order without duplicates.
 */
export function mainPartSuggestions(
  characterKey: CharacterKey,
  limit = 4
): string[] {
  const words = (part: string) => part.split(/\s+/).length
  const out: string[] = []
  for (const template of rotationTemplates) {
    if (template.characterKey !== characterKey) continue
    const best = memberSteps(
      template.text,
      template.members.map((k) => ({ characterKey: k, name: k })),
      characterKey
    ).reduce<string | undefined>(
      (longest, part) =>
        !longest || words(part) > words(longest) ? part : longest,
      undefined
    )
    if (best && !out.includes(best)) {
      out.push(best)
      if (out.length >= limit) break
    }
  }
  return out
}
