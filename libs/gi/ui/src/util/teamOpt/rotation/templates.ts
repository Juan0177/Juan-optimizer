import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
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
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map(({ t }) => t)
}
