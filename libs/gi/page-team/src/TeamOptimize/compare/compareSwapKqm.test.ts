// @vitest-environment jsdom
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allWeaponKeys,
  charKeyToLocGenderedCharKey,
} from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import type { KqmBuild, KqmResult } from '@genshin-optimizer/gi/ui'
import {
  kqmWeapons,
  optimizeTeamKqm,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { kqmReplayOf } from '../useKqmRun'
import type { SwapIn } from './compareSwapKqm'
import { compareSwapKqm, sideOf } from './compareSwapKqm'

const MEMBERS: CharacterKey[] = ['Anastasya', 'YaeMiko', 'Odette', 'Danica']
const FIXED: CharacterKey[] = ['Anastasya', 'Odette', 'Danica']
const NAMES: Partial<Record<CharacterKey, string>> = {
  Anastasya: 'Anastasya',
  YaeMiko: 'Yae Miko',
  Odette: 'Odette',
  Danica: 'Danica',
  Mitya: 'Mitya',
}
const TEXT =
  'Danica E -> Odette E E -> Yae Miko E E E -> Danica Q -> Anastasya hE N2 Q N5 E E E N2'
const WEAPONS = [
  'SkywardHarp',
  'WintersHeavyHeart',
  'MistsplitterReforged',
  'SerpentSpine',
  'WanderingEvenstar',
]
const SETS: ArtifactSetKey[] = [
  'BlizzardStrayer',
  'GildedDreams',
  'NoblesseOblige',
  'EmblemOfSeveredFate',
  'ThunderingFury',
]
const OWN: Record<string, Omit<KqmBuild, 'weapon'> & { weapon: string }> = {
  Anastasya: {
    weapon: 'SkywardHarp',
    sets: { BlizzardStrayer: 4 },
    mains: { sands: 'atk_', goblet: 'cryo_dmg_', circlet: 'critDMG_' },
    rolls: { critRate_: 10, critDMG_: 8 },
  },
  YaeMiko: {
    weapon: 'WintersHeavyHeart',
    sets: { GildedDreams: 4 },
    mains: { sands: 'eleMas', goblet: 'eleMas', circlet: 'eleMas' },
    rolls: { eleMas: 8, enerRech_: 6 },
  },
  Odette: {
    weapon: 'MistsplitterReforged',
    sets: { NoblesseOblige: 4 },
    mains: { sands: 'enerRech_', goblet: 'hp_', circlet: 'hp_' },
    rolls: { enerRech_: 8, hp_: 8 },
  },
  Danica: {
    weapon: 'SerpentSpine',
    sets: { EmblemOfSeveredFate: 4 },
    mains: { sands: 'enerRech_', goblet: 'electro_dmg_', circlet: 'critRate_' },
    rolls: { critDMG_: 10, enerRech_: 6 },
  },
}

const fakeI18n = {
  t: (key: string) => {
    const loc = key.split(':')[1]
    const ck = Object.keys(NAMES).find(
      (k) => charKeyToLocGenderedCharKey(k as CharacterKey, 'F') === loc
    ) as CharacterKey | undefined
    return (ck && NAMES[ck]) ?? loc
  },
} as unknown as i18n

// (the rotation is read from localStorage, which this environment does not provide)
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

const storageKeys = (teamId: string) => [
  `teamOptRotationText_${teamId}`,
  `teamOptRotationDraft_${teamId}`,
  `teamOptRotationOpener_${teamId}`,
  `teamOptRotationTiming_${teamId}`,
]

/** A 4-member team with a KQM run saved in `teamKqmResults` (its builds given, not searched) */
async function setup() {
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
  const teamOpt: TeamOpt = {
    ...initTeamOpt(),
    rotationTime: 20,
    kqm: {
      refinement4: 5,
      refinement5: 1,
      talents: 9,
      energySource: 'manual',
      energyRecharge: {
        Anastasya: 120,
        YaeMiko: 130,
        Odette: 140,
        Danica: 160,
      },
      constellations: { YaeMiko: 1 },
      // (Wandering Evenstar left out: the swap allows the entering member's pick)
      excludedWeapons: allWeaponKeys.filter(
        (k) => !WEAPONS.includes(k) || k === 'WanderingEvenstar'
      ),
      weaponList: 2,
      excludedSets: allArtifactSetKeys.filter((k) => !SETS.includes(k)),
    },
  }
  const teamId = database.teams.new({
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
    teamOpt,
  })
  stored.set(`teamOptRotationText_${teamId}`, TEXT)
  stored.set(`teamOptRotationDraft_${teamId}`, 'draft')
  stored.set(`teamOptRotationOpener_${teamId}`, '')
  stored.set(`teamOptRotationTiming_${teamId}`, '{}')
  const builds = Object.fromEntries(
    MEMBERS.map((ck) => {
      const own = OWN[ck]
      const weapon = kqmWeapons(ck, teamOpt.kqm).find(
        (w) => w.key === own.weapon
      )!
      return [ck, { ...own, weapon }]
    })
  ) as Record<CharacterKey, KqmBuild>
  const result = await optimizeTeamKqm({
    database,
    teamId,
    gender: 'F',
    teamOpt,
    replay: kqmReplayOf(database, 'F', fakeI18n, teamId, teamOpt),
    from: builds,
    only: [],
  })
  expect(result).toBeTruthy()
  database.teamKqmResults.setRun(teamId, {
    savedAt: 1,
    members: teamOptMembers(database, teamId).map((m) => m.characterKey),
    run: {
      type: 'done',
      result: result as never,
      seconds: 1,
      teamOpt,
      runTeamOpt: teamOpt,
      rotation: 'played',
    },
  })
  const saved = database.teamKqmResults.getRun(teamId)!
  return { database, teamId, saved }
}

const MITYA: SwapIn = {
  key: 'Mitya',
  constellation: 0,
  weapon: { key: 'WanderingEvenstar', refinement: 1 },
  sets: { GildedDreams: 4 },
  build: 'kqm',
}

const argsOf = (s: Awaited<ReturnType<typeof setup>>) => ({
  database: s.database,
  teamId: s.teamId,
  gender: 'F' as const,
  i18n: fakeI18n,
  saved: s.saved,
  out: 'YaeMiko' as const,
  swapIn: MITYA,
  text: TEXT,
  opener: '',
  fragment: 'E Q',
})

const snapshot = (s: Awaited<ReturnType<typeof setup>>) => ({
  db: JSON.stringify(s.database.storage.entries),
  storage: storageKeys(s.teamId).map((k) => localStorage.getItem(k)),
})

describe('sideOf', () => {
  it('reads DPR, DPS, shares and ER from a KQM result', () => {
    const result = {
      builds: {},
      constellations: {},
      energyRecharge: {
        Anastasya: { target: 130, minimum: 120, value: 135 },
        Danica: { target: 150, minimum: 150, value: 152 },
      },
      after: {
        total: 1000,
        members: { Anastasya: 600, Danica: 400 },
        attacks: {},
        unmet: {},
      },
      rankings: {},
      assumed: {},
      optimized: ['Anastasya', 'Danica'],
      rounds: 0,
      played: { attacks: {}, rotationTime: 20 },
    } as KqmResult
    const side = sideOf(result, TEXT, ['Danica'])
    expect(side.dpr).toBe(1000)
    expect(side.dps).toBe(50)
    expect(side.rotationTime).toBe(20)
    expect(side.rotation).toBe(TEXT)
    expect(side.members).toEqual([
      {
        key: 'Anastasya',
        damage: 600,
        share: 0.6,
        er: 130,
        erValue: 135,
        build: undefined,
        fixed: false,
      },
      {
        key: 'Danica',
        damage: 400,
        share: 0.4,
        er: 150,
        erValue: 152,
        build: undefined,
        fixed: true,
      },
    ])
  })
})

describe('compareSwapKqm', () => {
  it('runs on a copy: no writes, the fixed members keep their builds', async () => {
    const s = await setup()
    const before = snapshot(s)
    const out = await compareSwapKqm(argsOf(s))
    expect(snapshot(s)).toEqual(before)
    expect(s.database.teamKqmResults.getRun(s.teamId)).toEqual(s.saved)
    if ('error' in out) throw new Error(out.error)
    const { a, b } = out
    expect(a.members.map((m) => m.key)).toEqual(MEMBERS)
    expect(b.members.map((m) => m.key)).toEqual([
      'Anastasya',
      'Mitya',
      'Odette',
      'Danica',
    ])
    expect(b.rotation).toBe(
      'Danica E -> Odette E E -> Mitya E Q -> Danica Q -> Anastasya hE N2 Q N5 E E E N2'
    )
    const savedBuilds = (s.saved.run.result as unknown as KqmResult).builds
    for (const m of b.members.filter((m) => FIXED.includes(m.key))) {
      expect(m.fixed).toBe(true)
      expect(m.build).toEqual(savedBuilds[m.key])
    }
    const mitya = b.members.find((m) => m.key === 'Mitya')!
    expect(mitya.fixed).toBe(false)
    expect(mitya.build).toMatchObject({
      weapon: { key: 'WanderingEvenstar', refinement: 1 },
      sets: { GildedDreams: 4 },
    })
    expect(mitya.damage).toBeGreaterThan(0)
    expect(b.dpr).toBeGreaterThan(0)
    expect(b.dps).toBeCloseTo(b.dpr / b.rotationTime, 6)
    // A is KQM Theorycrafting's saved result as it is
    expect(a.dpr).toBe((s.saved.run.result as unknown as KqmResult).after.total)
  }, 300_000)

  it('searches the entering member’s weapon and sets when both are auto', async () => {
    const s = await setup()
    const before = snapshot(s)
    const out = await compareSwapKqm({
      ...argsOf(s),
      swapIn: { ...MITYA, weapon: 'auto', sets: 'auto' },
    })
    expect(snapshot(s)).toEqual(before)
    if ('error' in out) throw new Error(out.error)
    const savedBuilds = (s.saved.run.result as unknown as KqmResult).builds
    for (const m of out.b.members.filter((m) => FIXED.includes(m.key)))
      expect(m.build).toEqual(savedBuilds[m.key])
    const mitya = out.b.members.find((m) => m.key === 'Mitya')!
    // (the team's KQM settings allow one catalyst: Wandering Evenstar is left out)
    expect(mitya.build?.weapon.key).toBe('WintersHeavyHeart')
    expect(SETS).toEqual(
      expect.arrayContaining(Object.keys(mitya.build?.sets ?? {}))
    )
    expect(mitya.damage).toBeGreaterThan(0)
  }, 300_000)

  it('refuses a character already in the team', async () => {
    const s = await setup()
    const before = snapshot(s)
    expect(
      await compareSwapKqm({
        ...argsOf(s),
        swapIn: { ...MITYA, key: 'Odette' },
      })
    ).toEqual({ error: 'inTeam' })
    expect(snapshot(s)).toEqual(before)
  }, 60_000)

  it('passes the fragment errors through', async () => {
    const s = await setup()
    expect(
      await compareSwapKqm({ ...argsOf(s), text: `${TEXT} -> Yae Miko E` })
    ).toEqual({ error: 'repeated' })
    expect(await compareSwapKqm({ ...argsOf(s), fragment: ' ' })).toEqual({
      error: 'emptyFragment',
    })
  }, 60_000)

  it('stops when cancelled, writing nothing', async () => {
    const s = await setup()
    const before = snapshot(s)
    expect(
      await compareSwapKqm({ ...argsOf(s), isCancelled: () => true })
    ).toEqual({ error: 'cancelled' })
    expect(snapshot(s)).toEqual(before)
    // (cancelled while the search runs)
    for (const swapIn of [MITYA, { ...MITYA, weapon: 'auto', sets: 'auto' }]) {
      let calls = 0
      expect(
        await compareSwapKqm({
          ...argsOf(s),
          swapIn: swapIn as SwapIn,
          isCancelled: () => ++calls > 3,
        })
      ).toEqual({ error: 'cancelled' })
      expect(calls).toBeGreaterThan(3)
    }
    expect(snapshot(s)).toEqual(before)
  }, 60_000)

  it('leaves an existing build or a mixed weapon/sets choice unsupported', async () => {
    const s = await setup()
    expect(
      await compareSwapKqm({
        ...argsOf(s),
        swapIn: { ...MITYA, build: { kind: 'existing', buildId: 'x' } },
      })
    ).toEqual({ error: 'unsupported' })
    expect(
      await compareSwapKqm({ ...argsOf(s), swapIn: { ...MITYA, sets: 'auto' } })
    ).toEqual({ error: 'unsupported' })
  }, 60_000)
})
