import type {
  CharacterKey,
  ElementKey,
  MainStatKey,
} from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { input } from '@genshin-optimizer/gi/wr'
import { getCharDataBundle } from '../../hooks/useTeamData'
import type { KqmBuild } from './kqm'
import { kqmArtData, kqmWeaponData } from './kqm'

/** A stat a KQM card shows (the in-game character screen's) */
export type KqmStatKey =
  | 'hp'
  | 'atk'
  | 'def'
  | 'eleMas'
  | 'critRate_'
  | 'critDMG_'
  | 'enerRech_'
  | `${ElementKey}_dmg_`
  | 'physical_dmg_'

/** A member's KQM build out of combat: its main stats and its eight final stats */
export interface KqmMemberStats {
  mains: { sands: MainStatKey; goblet: MainStatKey; circlet: MainStatKey }
  /** 8 entries, in `KqmStatKey`'s order (the character's element DMG Bonus last); % as fractions */
  stats: { key: KqmStatKey; value: number }[]
}

/**
 * A KQM build's stats out of combat, as the in-game character screen shows them: the character
 * alone at 90/6 with the given constellation and talents, its KQM weapon and artifacts, the set
 * bonuses and weapon stats that need no condition. No conditionals, teammates, resonance or extra
 * buffs: it reads none of the database's teams. `undefined` without the character's or weapon's
 * sheet.
 */
export function kqmOutOfCombatStats(
  database: ArtCharDatabase,
  characterKey: CharacterKey,
  build: KqmBuild,
  { constellation, talent }: { constellation: number; talent: number }
): KqmMemberStats | undefined {
  const bundle = getCharDataBundle(
    database,
    false,
    0,
    {
      key: characterKey,
      level: 90,
      ascension: 6,
      constellation,
      talent: { auto: talent, skill: talent, burst: talent },
      infusionAura: '',
      customMultiTargets: [],
      conditional: { resonance: {}, reaction: {} },
      bonusStats: {},
      enemyOverride: {},
      hitMode: 'avgHit',
      reaction: undefined,
    },
    kqmWeaponData(build.weapon, characterKey),
    kqmArtData(build)
  )
  if (!bundle) return undefined
  const data = uiDataForTeam(
    { [characterKey]: bundle.data },
    database.gender,
    characterKey
  )[characterKey]?.target
  if (!data) return undefined
  const keys: KqmStatKey[] = [
    'hp',
    'atk',
    'def',
    'eleMas',
    'critRate_',
    'critDMG_',
    'enerRech_',
    `${getCharEle(characterKey)}_dmg_`,
  ]
  const { sands, goblet, circlet } = build.mains
  return {
    mains: { sands, goblet, circlet },
    stats: keys.map((key) => ({
      key,
      value: Number(data.get(input.total[key]).value),
    })),
  }
}
