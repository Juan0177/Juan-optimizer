/**
 * KQM's search judges every set and weapon with the effects the rotation plays for it, not only
 * the ones already worn: the replay plays the members' candidates' buff windows
 * (`SimGear.candidates`), each problem keeps only the ones a build in it can have, and a one-copy
 * weapon goes to one member at most.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allWeaponKeys } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import type { KqmBuild } from '../'
import {
  KQM_ONE_COPY,
  kqmProblemAttacks,
  kqmSets,
  kqmTopTeams,
  optimizeTeamKqm,
} from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { SimGear } from '../util/teamOpt/rotation/types'

const statePaths = (attacks: TeamOpt['attacks']) =>
  new Set(
    Object.values(attacks)
      .flat()
      .flatMap((a) => a?.states ?? [])
      .map((s) => `${s.owner}:${s.path.join('.')}`)
  )

describe('candidate set effects in the rotation', () => {
  const members: CharacterKey[] = ['YumemizukiMizuki', 'Odette']
  const play = (gear: Partial<Record<CharacterKey, SimGear>>) =>
    rotationAttacks(
      simulateRotation({
        rotation: parseRotation(
          'Odette E -> YumemizukiMizuki E W5 -> Odette',
          members.map((characterKey) => ({ characterKey, name: characterKey }))
        ),
        members,
        constellations: {},
        elements: Object.fromEntries(
          members.map((m) => [m, getCharEle(m)])
        ) as never,
        gear,
      })
    )

  it("plays Viridescent Venerer's Cryo shred and Scarlet Proof on Mizuki's Stellar Swirls for a candidate as for a set worn", () => {
    const worn = statePaths(
      play({ YumemizukiMizuki: { sets: { ViridescentVenerer: 4 } } })
    )
    expect(worn).toContain('YumemizukiMizuki:ViridescentVenerer.swirlcryo')
    const none = statePaths(play({}))
    expect(none).not.toContain('YumemizukiMizuki:ViridescentVenerer.swirlcryo')
    const candidates = statePaths(
      play({
        YumemizukiMizuki: {
          sets: { BlizzardStrayer: 4 },
          candidates: { sets: ['ViridescentVenerer', 'ScarletProof'] },
        },
      })
    )
    expect(candidates).toContain(
      'YumemizukiMizuki:ViridescentVenerer.swirlcryo'
    )
    expect(candidates).toContain('YumemizukiMizuki:ScarletProof.4Ss')
  })
})

describe('a candidate Archaic Petra', () => {
  const members: CharacterKey[] = ['Navia', 'Chiori', 'Bennett', 'Fischl']
  const play = (gear: Partial<Record<CharacterKey, SimGear>>) =>
    rotationAttacks(
      simulateRotation({
        rotation: parseRotation(
          'Chiori E -> Fischl E -> Bennett Q E -> Navia Q hE N3 D N2 hE N3 D N2 -> Chiori',
          members.map((characterKey) => ({ characterKey, name: characterKey }))
        ),
        members,
        constellations: {},
        elements: Object.fromEntries(
          members.map((m) => [m, getCharEle(m)])
        ) as never,
        gear,
      })
    )
  // hits per attack and the states no set's or weapon's own sheet gates
  const shared = (attacks: TeamOpt['attacks']) => {
    const hits = new Map<string, number>()
    for (const [ck, list] of Object.entries(attacks))
      for (const a of list ?? []) {
        const states = (a.states ?? [])
          .filter((s) => s.path[0] !== 'ArchaicPetra')
          .map((s) => `${s.owner}:${s.path.join('.')}=${s.value}`)
          .sort()
          .join(',')
        const key = `${ck}|${a.path.join('.')}|${states}`
        hits.set(key, (hits.get(key) ?? 0) + a.hits)
      }
    return Object.fromEntries(
      [...hits].map(([k, n]) => [k, +n.toFixed(6)]).sort()
    )
  }

  it("opens its own window, but leaves the shards, their shields and Navia's take of them as without the set", () => {
    const none = play({})
    const tried = play({ Bennett: { candidates: { sets: ['ArchaicPetra'] } } })
    const worn = play({ Bennett: { sets: { ArchaicPetra: 4 } } })
    expect(statePaths(tried)).toContain('Bennett:ArchaicPetra.element')
    expect(statePaths(worn)).toContain('Bennett:ArchaicPetra.element')
    expect(shared(tried)).toEqual(shared(none))
    // (worn, its holder picks the shards up: the play changes)
    expect(shared(worn)).not.toEqual(shared(none))
  })
})

describe("a problem's attacks", () => {
  const build = (sets: KqmBuild['sets'], weapon: string): KqmBuild => ({
    weapon: { key: weapon as never, refinement: 1 },
    sets,
    mains: { sands: 'atk_', goblet: 'atk_', circlet: 'critRate_' },
    rolls: {},
  })
  it('drops the states of sets and weapons no build in it can have, and merges what they split', () => {
    const attack = (
      states: { owner: string; path: string[]; value: string }[]
    ) => ({
      path: ['skill', 'dmg'],
      hits: 1,
      hitMode: 'avgHit' as const,
      states: states as never,
    })
    const attacks: TeamOpt['attacks'] = {
      Odette: [
        attack([
          {
            owner: 'YumemizukiMizuki',
            path: ['ViridescentVenerer', 'swirlcryo'],
            value: 'cryo',
          },
          { owner: 'Odette', path: ['NoblesseOblige', 'set4'], value: 'on' },
          {
            owner: 'Odette',
            path: ['ThrillingTalesOfDragonSlayers', 'Heritage'],
            value: 'on',
          },
        ]),
        attack([
          {
            owner: 'YumemizukiMizuki',
            path: ['ViridescentVenerer', 'swirlcryo'],
            value: '',
          },
          { owner: 'Odette', path: ['NoblesseOblige', 'set4'], value: 'on' },
          {
            owner: 'Odette',
            path: ['ThrillingTalesOfDragonSlayers', 'Heritage'],
            value: '',
          },
        ]),
      ],
    }
    const state = {
      YumemizukiMizuki: build({ BlizzardStrayer: 4 }, 'BlackmarrowLantern'),
      Odette: build({ GladiatorsFinale: 4 }, 'SacrificialSword'),
    }
    // Odette's artifacts vary: her Noblesse is kept, Mizuki's VV (not on her) and Odette's
    // Thrilling Tales (not her weapon) are dropped, and the two attacks become one of 2 hits
    const pruned = kqmProblemAttacks(attacks, 'Odette', state).Odette!
    expect(pruned).toHaveLength(1)
    expect(pruned[0].hits).toBe(2)
    expect(pruned[0].states?.map((s) => s.path[0])).toEqual(['NoblesseOblige'])
    // Mizuki wearing VV: her shred is kept, and the attacks stay apart
    const withVV = kqmProblemAttacks(attacks, 'Odette', {
      ...state,
      YumemizukiMizuki: build({ ViridescentVenerer: 4 }, 'BlackmarrowLantern'),
    }).Odette!
    expect(withVV).toHaveLength(2)
    // Mizuki's own sets vary in her problem: her VV states are kept
    expect(
      kqmProblemAttacks(attacks, 'YumemizukiMizuki', state).Odette
    ).toHaveLength(2)
  })

  it('drops the limits of gear no build in it can have, and the member’s own sets outside its sets', () => {
    const attack = (
      limits: { owner: string; path: string[]; hits: number }[],
      hits = 1
    ) => ({
      path: ['skill', 'dmg'],
      hits,
      hitMode: 'avgHit' as const,
      limits: limits as never,
    })
    const state = {
      YumemizukiMizuki: build({ BlizzardStrayer: 4 }, 'BlackmarrowLantern'),
      Odette: build({ GladiatorsFinale: 4 }, 'SacrificialSword'),
    }
    const vv = { owner: 'YumemizukiMizuki', path: ['ViridescentVenerer', 'x'] }
    const noblesse = { owner: 'Odette', path: ['NoblesseOblige', 'set4'] }
    const attacks: TeamOpt['attacks'] = {
      Odette: [
        attack([{ ...vv, hits: 0 }]),
        attack([]),
        attack([{ ...noblesse, hits: 0 }]),
      ],
    }
    // Mizuki's VV limit (not on her) is dropped: the first two are one of 2 hits
    const pruned = kqmProblemAttacks(attacks, 'Odette', state).Odette!
    expect(pruned.map((a) => a.hits)).toEqual([2, 1])
    expect(pruned[1].limits).toEqual([{ ...noblesse, hits: 0 }])
    // Odette's Noblesse outside her sets: dropped too, all three are one
    const narrowed = kqmProblemAttacks(
      attacks,
      'Odette',
      state,
      new Set(['GladiatorsFinale'])
    ).Odette!
    expect(narrowed.map((a) => a.hits)).toEqual([3])
    // a limit on some of an attack's hits: those attacks stay apart (merged, it would cover fewer)
    const partial = kqmProblemAttacks(
      { Odette: [0, 1].map(() => attack([{ ...noblesse, hits: 1 }], 2)) },
      'Odette',
      state
    ).Odette!
    expect(partial.map((a) => a.hits)).toEqual([2, 2])
  })
})

describe('one-copy weapons', () => {
  it('gives a quest weapon like Exaiphanes’ Blade to one member at most', async () => {
    expect(KQM_ONE_COPY).toContain('ExaiphanesBlade')
    expect(KQM_ONE_COPY).not.toContain('MoonweaversDawn')
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    const members = ['KamisatoAyaka', 'Keqing'] as const
    for (const key of members)
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
    const ids = members.map((k) => database.teamChars.new(k))
    const teamId = database.teams.new({
      loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
    })
    for (const id of ids)
      database.optConfigs.set(database.teamChars.get(id)!.optConfigId, {
        mainStatKeys: {
          sands: ['atk_'],
          goblet: ['atk_'],
          circlet: ['critDMG_'],
        },
        artSetExclusion: Object.fromEntries(
          kqmSets().map((key) => [
            key,
            key === 'GladiatorsFinale' ? [2] : [2, 4],
          ])
        ),
      })
    const teamOpt = initTeamOpt()
    teamOpt.kqm = {
      refinement4: 1,
      refinement5: 1,
      energyRecharge: { KamisatoAyaka: 100, Keqing: 100 },
      excludedWeapons: allWeaponKeys.filter(
        (k) => !['ExaiphanesBlade', 'FavoniusSword'].includes(k)
      ),
      weaponList: 2,
    }
    teamOpt.attacks = {
      KamisatoAyaka: [{ path: ['skill', 'press'], hits: 4, hitMode: 'avgHit' }],
      Keqing: [{ path: ['skill', 'stiletto'], hits: 4, hitMode: 'avgHit' }],
    }
    const result = (await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      maxRounds: 2,
    }))!
    const holders = members.filter(
      (k) => result.builds[k]?.weapon.key === 'ExaiphanesBlade'
    )
    expect(holders.length).toBeLessThanOrEqual(1)
    // (and each one's weapon ranking leaves it out while the other has it)
    for (const k of members) {
      const other = members.find((m) => m !== k)!
      if (result.builds[other]?.weapon.key === 'ExaiphanesBlade')
        expect(
          result.rankings[k]?.weapons.map((o) => o.weapon.key)
        ).not.toContain('ExaiphanesBlade')
    }
  }, 300_000)

  it('a one-copy weapon locked for one member is no one else’s; locked for two, the run is refused', async () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    const members = ['KamisatoAyaka', 'Keqing'] as const
    for (const key of members)
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
    const teamId = database.teams.new({
      loadoutData: members.map((k) => ({
        teamCharId: database.teamChars.new(k),
      })) as LoadoutDatum[],
    })
    const teamOpt = initTeamOpt()
    teamOpt.kqm = {
      refinement4: 1,
      refinement5: 1,
      energyRecharge: { KamisatoAyaka: 100, Keqing: 100 },
      excludedWeapons: allWeaponKeys.filter(
        (k) => !['ExaiphanesBlade', 'FavoniusSword'].includes(k)
      ),
      weaponList: 2,
      lockedWeapons: { Keqing: 'ExaiphanesBlade' },
    }
    teamOpt.attacks = {
      KamisatoAyaka: [{ path: ['skill', 'press'], hits: 4, hitMode: 'avgHit' }],
      Keqing: [{ path: ['skill', 'stiletto'], hits: 4, hitMode: 'avgHit' }],
    }
    const run = () =>
      optimizeTeamKqm({ database, teamId, gender: 'F', teamOpt, maxRounds: 2 })
    const result = (await run())!
    expect(result.builds.Keqing!.weapon.key).toBe('ExaiphanesBlade')
    expect(
      new Set(result.rankings.Keqing!.weapons.map((o) => o.weapon.key))
    ).toEqual(new Set(['ExaiphanesBlade']))
    expect(result.builds.KamisatoAyaka!.weapon.key).toBe('FavoniusSword')
    expect(
      result.rankings.KamisatoAyaka!.weapons.map((o) => o.weapon.key)
    ).not.toContain('ExaiphanesBlade')
    teamOpt.kqm.lockedWeapons = {
      Keqing: 'ExaiphanesBlade',
      KamisatoAyaka: 'ExaiphanesBlade',
    }
    await expect(run()).rejects.toThrow('there is only one')
    // (Ayaka's list holds only the blade locked for Keqing: nothing is left for her)
    teamOpt.kqm.lockedWeapons = { Keqing: 'ExaiphanesBlade' }
    teamOpt.kqm.excludedWeapons = allWeaponKeys.filter(
      (k) => k !== 'ExaiphanesBlade'
    )
    await expect(run()).rejects.toThrow('locked for another member')
  }, 300_000)
})

describe('top teams', () => {
  it('lists the run’s team, then the best one-member changes by team damage, each a whole team’s score', async () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    const members = ['KamisatoAyaka', 'Shenhe'] as const
    for (const key of members)
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
    const ids = members.map((k) => database.teamChars.new(k))
    const teamId = database.teams.new({
      loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
    })
    for (const id of ids)
      database.optConfigs.set(database.teamChars.get(id)!.optConfigId, {
        mainStatKeys: {
          sands: ['atk_'],
          goblet: ['cryo_dmg_', 'atk_'],
          circlet: ['critDMG_'],
        },
        artSetExclusion: Object.fromEntries(
          kqmSets().map((key) => [
            key,
            ['BlizzardStrayer', 'NoblesseOblige', 'GladiatorsFinale'].includes(
              key
            )
              ? [2]
              : [2, 4],
          ])
        ),
      })
    const teamOpt = initTeamOpt()
    teamOpt.kqm = {
      refinement4: 5,
      refinement5: 1,
      energyRecharge: { KamisatoAyaka: 100, Shenhe: 100 },
      excludedWeapons: allWeaponKeys.filter(
        (k) =>
          ![
            'AmenomaKageuchi',
            'TheBlackSword',
            'FavoniusLance',
            'CalamityQueller',
          ].includes(k)
      ),
      weaponList: 2,
    }
    teamOpt.attacks = {
      KamisatoAyaka: [
        { path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' },
        { path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' },
      ],
      Shenhe: [{ path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' }],
    }
    const result = (await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      maxRounds: 2,
    }))!
    const top = kqmTopTeams(result, 10)
    const id = (b: Pick<KqmBuild, 'weapon' | 'sets'>) =>
      `${b.weapon.key}|${Object.entries(b.sets).sort().join()}`
    // first: the run's own team, its total
    expect(top[0].changed).toBeUndefined()
    expect(top[0].total).toBe(result.after.total)
    for (const k of members)
      expect(id(top[0].builds[k]!)).toBe(id(result.builds[k]!))
    // then by team damage, each one member changed from the run's team
    expect(top.length).toBeGreaterThan(2)
    expect(top.length).toBeLessThanOrEqual(10)
    for (let i = 2; i < top.length; i++)
      expect(top[i].total).toBeLessThanOrEqual(top[i - 1].total)
    for (const option of top.slice(1)) {
      const changed = members.filter(
        (k) => id(option.builds[k]!) !== id(result.builds[k]!)
      )
      expect(changed).toEqual([option.changed])
    }
    // (a ranking's totals are the team's damage, as the run's: its own build's is the run's)
    for (const k of members) {
      const same = [
        ...result.rankings[k]!.sets,
        ...result.rankings[k]!.weapons,
      ].find((o) => id(o) === id(result.builds[k]!))
      if (same)
        expect(Math.abs(same.total / result.after.total - 1)).toBeLessThan(1e-6)
    }
    expect(kqmTopTeams(result, 3)).toHaveLength(3)
  }, 300_000)
})
