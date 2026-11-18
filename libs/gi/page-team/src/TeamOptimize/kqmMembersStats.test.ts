import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type { KqmBuild, KqmMemberStats } from '@genshin-optimizer/gi/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { kqmMembersStats } from './kqmTeamCard'

const { stats } = vi.hoisted(() => ({ stats: vi.fn() }))
vi.mock('@genshin-optimizer/gi/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@genshin-optimizer/gi/ui')>()),
  kqmOutOfCombatStats: stats,
}))

const build = {
  weapon: { key: 'MistsplitterReforged', refinement: 1 },
  sets: { BlizzardStrayer: 4 },
  mains: { sands: 'atk_', goblet: 'cryo_dmg_', circlet: 'critDMG_' },
  rolls: {},
} as KqmBuild
const own = (key: CharacterKey): KqmMemberStats => ({
  mains: build.mains,
  stats: [{ key: 'hp', value: key.length }],
})
const database = {} as ArtCharDatabase

describe('KQM card: the members’ stats', () => {
  afterEach(() => vi.restoreAllMocks())

  it('reads each member with a build at its constellation and the KQM talents', () => {
    stats.mockImplementation((_db, key: CharacterKey) => own(key))
    expect(
      kqmMembersStats(
        database,
        [
          { key: 'KamisatoAyaka', build, constellation: 0 },
          { key: 'Shenhe', build: undefined, constellation: 0 },
          { key: 'Furina', build, constellation: 6 },
        ],
        9
      )
    ).toEqual({ KamisatoAyaka: own('KamisatoAyaka'), Furina: own('Furina') })
    expect(stats).toHaveBeenCalledWith(database, 'Furina', build, {
      constellation: 6,
      talent: 9,
    })
  })

  it('leaves out a member whose calculation throws, and keeps the others', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    stats.mockImplementation((_db, key: CharacterKey) => {
      if (key === 'Shenhe') throw new Error('no sheet')
      return own(key)
    })
    const result = kqmMembersStats(
      database,
      [
        { key: 'KamisatoAyaka', build, constellation: 0 },
        { key: 'Shenhe', build, constellation: 0 },
        { key: 'Furina', build, constellation: 0 },
      ],
      9
    )
    expect(result).toEqual({
      KamisatoAyaka: own('KamisatoAyaka'),
      Furina: own('Furina'),
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('Shenhe')
  })
})
