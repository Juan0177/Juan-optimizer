// @vitest-environment jsdom
/**
 * KQM theorycrafting hands a 4-piece set to a teammate when the pair wins only together: a set
 * whose effect the team shares and does not stack (Heart of the Furnace, Tenacity of the
 * Millelith) is worth most on whoever keeps it up, but one member's step never moves it (taking
 * it alone doubles it, giving it up alone loses it).
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSetKeys, allWeaponKeys } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { optimizeTeamKqm, teamOptMembers } from '@genshin-optimizer/gi/ui'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { kqmRotationReplay } from './RotationWriter'

const MEMBERS: CharacterKey[] = ['Sandrone', 'Odette', 'Anastasya', 'Danica']
const TEXT =
  'Anastasya E Q -> Odette E E -> Danica E Q -> Sandrone E CA Q E CA E CA'
const WEAPONS = [
  'UltimateOverlordsMegaMagicSword',
  'FinaleOfTheDeep',
  'SkywardHarp',
  'FavoniusGreatsword',
]
const SETS: ArtifactSetKey[] = [
  'DisenchantmentInDeepShadow',
  'TenacityOfTheMillelith',
  'HeartOfTheFurnace',
  'NoblesseOblige',
  'LegacyOfTheFirstChronicle',
]

// (the rotation text is read from localStorage, which this environment does not provide)
const stored = new Map<string, string>()
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, String(v)),
      removeItem: (k: string) => stored.delete(k),
      clear: () => stored.clear(),
      key: (i: number) => [...stored.keys()][i] ?? null,
      get length() {
        return stored.size
      },
    },
  })
})
afterAll(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
})

describe('KQM set hand-off', () => {
  it('gives the shared set to the teammate who keeps it up, and the member its own set', async () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    for (const key of MEMBERS)
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
    const ids = MEMBERS.map((k) => database.teamChars.new(k))
    const teamId = database.teams.new({
      loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
    })
    const teamOpt = initTeamOpt()
    teamOpt.kqm = {
      refinement4: 5,
      refinement5: 1,
      talents: 9,
      energyRecharge: {
        Sandrone: 140,
        Odette: 100,
        Anastasya: 125,
        Danica: 200,
      },
      excludedWeapons: allWeaponKeys.filter((k) => !WEAPONS.includes(k)),
      excludedSets: allArtifactSetKeys.filter((k) => !SETS.includes(k)),
      weaponList: 2,
    }
    localStorage.setItem(`teamOptRotationText_${teamId}`, TEXT)
    const members = teamOptMembers(database, teamId)
    const replay = kqmRotationReplay({
      database: database as never,
      teamId,
      members,
      gender: 'F',
      names: members.map(({ characterKey }) => ({
        characterKey,
        name: characterKey,
      })),
      teamOpt,
    })
    const result = await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      replay,
    })
    expect(result).toBeTruthy()
    const sets = Object.fromEntries(
      MEMBERS.map((k) => [k, Object.keys(result!.builds[k]!.sets)])
    )
    // Danica, first on the field after Anastasya's Burst, keeps Tenacity up for the team.
    // (Anastasya's own set: Disenchantment since Danica's Scouring Anchor ends Royal Guard and its
    // party ATK, as the game does; before, the Furnace)
    expect(sets).toMatchObject({
      Danica: ['TenacityOfTheMillelith'],
      Anastasya: ['DisenchantmentInDeepShadow'],
    })
  }, 300_000)
})
