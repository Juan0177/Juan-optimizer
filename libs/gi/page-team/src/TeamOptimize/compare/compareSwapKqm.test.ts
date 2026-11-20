// @vitest-environment jsdom
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allWeaponKeys,
  charKeyToLocGenderedCharKey,
} from '@genshin-optimizer/gi/consts'
import type {
  LoadoutDatum,
  TeamOpt,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import type {
  KqmBuild,
  KqmResult,
  RunAttackState,
} from '@genshin-optimizer/gi/ui'
import {
  defaultEnergyCalculator,
  kqmWeapons,
  optimizeTeamKqm,
  playedAttackStates,
  teamOptMembers,
  wolfsGravestoneStates,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { kqmReplayOf } from '../useKqmRun'
import { CompareSwapFailure } from './compareError'
import type { SwapIn } from './compareSwapKqm'
import { compareSwapKqm, sideOf, swapSettings } from './compareSwapKqm'

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
async function setup(
  kqm: Partial<TeamOptKqm> = {},
  ownOverride: Partial<typeof OWN> = {},
  /** As KQM Theorycrafting's run against the team's enemy (Wolf's Gravestone's uptime) */
  attackStates?: readonly RunAttackState[]
) {
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
      ...kqm,
    },
  }
  const teamId = database.teams.new({
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
    teamOpt,
  })
  // (KQM Theorycrafting's own rotation, saved with the team)
  const kqmId = `${teamId}_kqm`
  database.teams.setRotationField(kqmId, 'Text', TEXT)
  database.teams.setRotationField(kqmId, 'Draft', 'draft')
  database.teams.setRotationField(kqmId, 'Opener', '')
  database.teams.setRotationField(kqmId, 'Timing', '{}')
  const builds = Object.fromEntries(
    MEMBERS.map((ck) => {
      const own = ownOverride[ck] ?? OWN[ck]
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
    attackStates,
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

type Outcome = Exclude<
  Awaited<ReturnType<typeof compareSwapKqm>>,
  { error: unknown }
>
type Preview = Pick<Outcome, 'a' | 'b' | 'resultB'>

/**
 * B's result as KQM Theorycrafting's: the entering member's rankings (weapons and sets), it
 * alone ranked; its teammates' builds A's; the headline delivered first; B's sandbox and settings
 */
function expectRankedB(
  s: Awaited<ReturnType<typeof setup>>,
  out: Outcome,
  previews: Preview[]
) {
  const { resultB, sandbox, teamOptB } = out
  expect(resultB.optimized).toEqual(['Mitya'])
  expect(Object.keys(resultB.rankings)).toEqual(['Mitya'])
  const ranking = resultB.rankings.Mitya!
  expect(ranking.weapons.length).toBeGreaterThan(0)
  expect(ranking.sets.length).toBeGreaterThan(0)
  for (const option of [...ranking.weapons, ...ranking.sets])
    expect(option.total).toBeGreaterThan(0)
  const savedBuilds = (s.saved.run.result as unknown as KqmResult).builds
  for (const k of FIXED) expect(resultB.builds[k]).toEqual(savedBuilds[k])
  expect(resultB.builds.Mitya).toEqual(
    out.b.members.find((m) => m.key === 'Mitya')!.build
  )
  // the headline first, its rankings not yet
  expect(previews).toHaveLength(1)
  const [preview] = previews
  expect(preview.resultB.rankings).toEqual({})
  expect(preview.resultB.optimized).toEqual(['Mitya'])
  expect(preview.resultB.builds).toEqual(resultB.builds)
  expect(preview.a).toEqual(out.a)
  expect(preview.b).toEqual(out.b)
  // (B's sandbox, settings and rotation with the headline: its results screen while it ranks)
  expect(preview.sandbox).toBe(out.sandbox)
  expect(preview.teamOptB).toBe(out.teamOptB)
  expect(preview.rotationB).toEqual(out.rotationB)
  // B's copy of the database, its team with the entering member, for the inspector
  expect(sandbox).not.toBe(s.database)
  expect(teamOptMembers(sandbox, s.teamId).map((m) => m.characterKey)).toEqual([
    'Anastasya',
    'Mitya',
    'Odette',
    'Danica',
  ])
  expect(
    teamOptMembers(s.database, s.teamId).map((m) => m.characterKey)
  ).toEqual(MEMBERS)
  expect(sandbox.teams.get(s.teamId)?.teamOpt).toEqual(teamOptB)
  expect(teamOptB.kqm?.constellations?.YaeMiko).toBeUndefined()
  // B's rotation as it was played, for its inspector (not the team's written one)
  expect(out.rotationB.text).toBe(out.b.rotation)
  expect(out.rotationB.opener).toBeTypeOf('string')
  expect(out.rotationB.timing.edits).toBeTypeOf('object')
}

describe('sideOf', () => {
  it('reads DPR, DPS, shares and ER from a KQM result', () => {
    const result = {
      builds: {},
      constellations: { Anastasya: 2 },
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
    expect(side.talents).toBeUndefined()
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
        constellation: 2,
        fixed: false,
      },
      {
        key: 'Danica',
        damage: 400,
        share: 0.4,
        er: 150,
        erValue: 152,
        build: undefined,
        constellation: 0,
        fixed: true,
      },
    ])
    // (the settings: each member's field time, as the ER calculator has it, and the talents)
    const set = sideOf(result, TEXT, ['Danica'], undefined, {
      kqm: {
        talents: 10,
        energyCalculator: { members: { Anastasya: { fieldTime: 60 } } },
      },
    } as never)
    expect(set.talents).toBe(10)
    expect(set.members.map((m) => m.fieldTime)).toEqual([60, undefined])
  })
})

describe('compareSwapKqm', () => {
  it('runs on a copy: no writes, the fixed members keep their builds', async () => {
    const s = await setup()
    const before = snapshot(s)
    const previews: Preview[] = []
    let resolved = false
    const out = await compareSwapKqm({
      ...argsOf(s),
      onPreview: (p) => {
        expect(resolved).toBe(false)
        previews.push(p)
      },
    })
    resolved = true
    expect(snapshot(s)).toEqual(before)
    expect(s.database.teamKqmResults.getRun(s.teamId)).toEqual(s.saved)
    if ('error' in out) throw new Error(out.error)
    expectRankedB(s, out, previews)
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
    // (the swapped step's turn on both sides, for the card: by position, not by name)
    expect(a.turn).toBe(2)
    expect(b.turn).toBe(2)
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
    const previews: Preview[] = []
    const out = await compareSwapKqm({
      ...argsOf(s),
      swapIn: { ...MITYA, weapon: 'auto', sets: 'auto' },
      onPreview: (p) => previews.push(p),
    })
    expect(snapshot(s)).toEqual(before)
    if ('error' in out) throw new Error(out.error)
    expectRankedB(s, out, previews)
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

  const YAE: SwapIn = {
    key: 'YaeMiko',
    constellation: 1,
    weapon: { key: 'WintersHeavyHeart', refinement: 5 },
    sets: { GildedDreams: 4 },
    build: 'kqm',
  }

  it('compares the leaving character with itself at another constellation', async () => {
    const s = await setup({ constellations: { YaeMiko: 0 } })
    const before = snapshot(s)
    const out = await compareSwapKqm({ ...argsOf(s), swapIn: YAE })
    expect(snapshot(s)).toEqual(before)
    if ('error' in out) throw new Error(out.error)
    expect(out.b.members.map((m) => m.key)).toEqual(MEMBERS)
    expect(out.a.members.find((m) => m.key === 'YaeMiko')?.constellation).toBe(
      0
    )
    expect(out.b.members.find((m) => m.key === 'YaeMiko')?.constellation).toBe(
      1
    )
    const savedBuilds = (s.saved.run.result as unknown as KqmResult).builds
    for (const m of out.b.members.filter((m) => FIXED.includes(m.key)))
      expect(m.build).toEqual(savedBuilds[m.key])
    expect(out.b.dpr).toBeGreaterThan(0)
  }, 300_000)

  it('runs a same-character swap that changes nothing', async () => {
    // (A's Yae Miko is the build KQM itself finds for her with her ER target: a first
    // comparison's B, so that the same swap on that team has nothing to improve)
    const er = { energyRecharge: { YaeMiko: 130 } } as Partial<TeamOptKqm>
    const swapIn = { ...YAE, kqm: er }
    // (the same actions A's rotation has for her)
    const args = { fragment: 'E E E', swapIn }
    const first = await setup()
    const found = await compareSwapKqm({ ...argsOf(first), ...args })
    if ('error' in found) throw new Error(found.error)
    const { weapon, ...found_ } = found.b.members.find(
      (m) => m.key === 'YaeMiko'
    )!.build!
    const s = await setup({}, { YaeMiko: { ...found_, weapon: weapon.key } })
    const out = await compareSwapKqm({ ...argsOf(s), ...args })
    if ('error' in out) throw new Error(out.error)
    expect(Math.abs(out.b.dpr - out.a.dpr) / out.a.dpr).toBeLessThan(0.005)
    for (const k of MEMBERS) {
      const [a, b] = [out.a, out.b].map(
        (side) => side.members.find((m) => m.key === k)!
      )
      expect(b.build).toEqual(a.build)
      expect(Math.abs(b.damage - a.damage) / a.damage).toBeLessThan(0.005)
    }
  }, 600_000)

  it('plays B with A’s Wolf’s Gravestone uptime against the enemy', async () => {
    // (Danica holds Wolf's Gravestone; A ran with its passive at 60% uptime, as KQM
    // Theorycrafting runs it against an enemy with HP)
    const kqm = {
      excludedWeapons: allWeaponKeys.filter(
        (k) =>
          (!WEAPONS.includes(k) && k !== 'WolfsGravestone') ||
          k === 'WanderingEvenstar'
      ),
    }
    const danica = { Danica: { ...OWN['Danica'], weapon: 'WolfsGravestone' } }
    const states = wolfsGravestoneStates(MEMBERS, '60')
    const er = { energyRecharge: { YaeMiko: 130 } } as Partial<TeamOptKqm>
    const args = { fragment: 'E E E', swapIn: { ...YAE, kqm: er } }
    // (A's Yae Miko is the build KQM finds for her, as in the swap that changes nothing)
    const first = await setup(kqm, danica, states)
    const found = await compareSwapKqm({ ...argsOf(first), ...args })
    if ('error' in found) throw new Error(found.error)
    const { weapon, ...found_ } = found.b.members.find(
      (m) => m.key === 'YaeMiko'
    )!.build!
    const s = await setup(
      kqm,
      { ...danica, YaeMiko: { ...found_, weapon: weapon.key } },
      states
    )
    const savedA = s.saved.run.result as unknown as KqmResult
    const byOwner = (list: RunAttackState[] | undefined) =>
      [...(list ?? [])].sort((x, y) => `${x.owner}`.localeCompare(`${y.owner}`))
    expect(byOwner(playedAttackStates(savedA.played))).toEqual(byOwner(states))
    const out = await compareSwapKqm({ ...argsOf(s), ...args })
    if ('error' in out) throw new Error(out.error)
    // B plays the same uptime (its members', the entering one's included)
    expect(byOwner(playedAttackStates(out.resultB.played))).toEqual(
      byOwner(states)
    )
    // and the same team with the same gear gives A's damage
    expect(Math.abs(out.b.dpr - out.a.dpr) / out.a.dpr).toBeLessThan(0.005)
    for (const k of MEMBERS) {
      const [a, b] = [out.a, out.b].map(
        (side) => side.members.find((m) => m.key === k)!
      )
      expect(b.build).toEqual(a.build)
      expect(Math.abs(b.damage - a.damage) / a.damage).toBeLessThan(0.005)
    }
  }, 600_000)

  it('keeps the character’s own bonus stats when it re-enters', async () => {
    const s = await setup()
    const base = s.database.teams.get(s.teamId)!.teamOpt!
    const withBonus = {
      ...base,
      bonusStats: { YaeMiko: { critRate_: 5 }, Odette: { critRate_: 3 } },
      attacks: { YaeMiko: [{ sentinel: true }] },
    } as unknown as TeamOpt
    const saved = {
      ...s.saved,
      run: { ...s.saved.run, teamOpt: withBonus },
    } as typeof s.saved
    const same = await compareSwapKqm({ ...argsOf(s), saved, swapIn: YAE })
    if ('error' in same) throw new Error(same.error)
    expect(same.teamOptB.bonusStats?.YaeMiko).toEqual({ critRate_: 5 })
    expect(same.teamOptB.bonusStats?.Odette).toEqual({ critRate_: 3 })
    // (its attacks are dropped and derived again, not A's carried over)
    expect(same.teamOptB.attacks.YaeMiko).not.toEqual(withBonus.attacks.YaeMiko)
    expect(
      same.sandbox.teams.get(s.teamId)?.teamOpt?.attacks.YaeMiko
    ).not.toEqual(withBonus.attacks.YaeMiko)
    const other = await compareSwapKqm({ ...argsOf(s), saved })
    if ('error' in other) throw new Error(other.error)
    expect(other.teamOptB.bonusStats?.YaeMiko).toBeUndefined()
    expect(other.teamOptB.bonusStats?.Odette).toEqual({ critRate_: 3 })
  }, 600_000)

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
    ).toEqual({ error: 'repeated', count: 2 })
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
    // (cancelled while the search runs: before the headline)
    for (const swapIn of [MITYA, { ...MITYA, weapon: 'auto', sets: 'auto' }]) {
      let calls = 0
      let previewed = false
      expect(
        await compareSwapKqm({
          ...argsOf(s),
          swapIn: swapIn as SwapIn,
          isCancelled: () => ++calls > 2,
          onPreview: () => {
            previewed = true
          },
        })
      ).toEqual({ error: 'cancelled' })
      expect(calls).toBeGreaterThan(2)
      expect(previewed).toBe(false)
    }
    expect(snapshot(s)).toEqual(before)
  }, 60_000)

  it('keeps the headline when cancelled after it: no rankings, no error', async () => {
    const s = await setup()
    const before = snapshot(s)
    for (const swapIn of [MITYA, { ...MITYA, weapon: 'auto', sets: 'auto' }]) {
      let preview: Preview | undefined
      const out = await compareSwapKqm({
        ...argsOf(s),
        swapIn: swapIn as SwapIn,
        onPreview: (p) => {
          preview = p
        },
        isCancelled: () => !!preview,
      })
      if ('error' in out) throw new Error(out.error)
      expect(preview).toBeDefined()
      expect(out.resultB.rankings).toEqual({})
      expect(out.resultB.builds).toEqual(preview!.resultB.builds)
      expect(out.b).toEqual(preview!.b)
      expect(out.sandbox).not.toBe(s.database)
    }
    expect(snapshot(s)).toEqual(before)
  }, 300_000)

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

  it('fills the entering member’s ER calculator inputs from B’s rotation, its own winning', async () => {
    const calculator = defaultEnergyCalculator(MEMBERS, 20, 'Anastasya')
    calculator.members.YaeMiko!.fieldTime = 12
    calculator.members.Anastasya!.fieldTime = 52
    calculator.members.Odette!.fieldTime = 18
    calculator.members.Danica!.fieldTime = 18
    const s = await setup({
      energySource: 'calculator',
      energyCalculator: calculator,
    })
    const before = snapshot(s)
    const settingsOf = (fragment: string, swapIn: SwapIn = MITYA) => {
      const out = swapSettings({ ...argsOf(s), fragment, swapIn })
      if ('error' in out) throw new Error(out.error)
      return out.teamOpt.kqm!.energyCalculator!
    }
    const once = settingsOf('E Q')
    const twice = settingsOf('E E E Q')
    const start = defaultEnergyCalculator(['Mitya']).members.Mitya!
    // (the rotation's, not the starting assumptions: its Favonius procs, its energy weapon
    // triggers, more with more casts)
    expect(start.favoniusProcs).toBe(0)
    expect(once.members.Mitya!.favoniusProcs).toBeGreaterThan(0)
    expect(start.weaponTriggers).toBeUndefined()
    expect(once.members.Mitya!.weaponTriggers).toBeDefined()
    expect(twice.members.Mitya!.weaponTriggers).not.toEqual(
      once.members.Mitya!.weaponTriggers
    )
    // the leaving member's field time; the teammates' inputs as they were
    expect(once.members.Mitya!.fieldTime).toBe(12)
    expect(twice.members.Mitya!.fieldTime).toBe(12)
    for (const k of FIXED)
      expect(once.members[k]).toEqual(calculator.members[k])
    expect(once.members.YaeMiko).toBeUndefined()
    // values set in its own KQM settings (marked `edited`) win over the rotation's
    const own = settingsOf('E E E Q', {
      ...MITYA,
      kqm: {
        energyCalculator: {
          ...calculator,
          members: {
            Mitya: {
              ...twice.members.Mitya!,
              favoniusProcs: 0,
              skillUses: 7,
              fieldTime: 40,
              edited: ['favoniusProcs', 'fieldTime'],
            },
          },
        },
      },
    })
    expect(own.members.Mitya!.favoniusProcs).toBe(0)
    // (not marked: the rotation's)
    expect(own.members.Mitya!.skillUses).toBe(twice.members.Mitya!.skillUses)
    expect(own.members.Mitya!.fieldTime).toBe(12)
    expect(snapshot(s)).toEqual(before)
    // and the run plays with them
    const out = await compareSwapKqm({ ...argsOf(s), fragment: 'E E E Q' })
    if ('error' in out) throw new Error(out.error)
    expect(out.b.members.find((m) => m.key === 'Mitya')!.er).toBeGreaterThan(0)
    // (the calculator's counts are per B's rotation as KQM plays it, not A's length)
    expect(calculator.rotationTime).toBe(20)
    expect(twice.rotationTime).not.toBe(20)
    expect(twice.rotationTime).toBeCloseTo(out.b.rotationTime, 1)
    // the entering member's effects counted by rule, for showing them
    const settings = swapSettings({ ...argsOf(s), fragment: 'E E E Q' })
    if ('error' in settings) throw new Error(settings.error)
    expect(typeof settings.rules).toBe('object')
    expect(snapshot(s)).toEqual(before)
  }, 300_000)

  it('plays the team’s frame-timing edits on the same actions in B', async () => {
    const calculator = defaultEnergyCalculator(MEMBERS, 20, 'Anastasya')
    const s = await setup({
      energySource: 'calculator',
      energyCalculator: calculator,
    })
    const seconds = () => {
      const out = swapSettings(argsOf(s))
      if ('error' in out) throw new Error(out.error)
      return out.teamOpt.kqm!.energyCalculator!.rotationTime
    }
    const plain = seconds()
    // (Danica's Q, the 7th action of A's rotation and the 6th of B's: 10 s longer)
    s.database.teams.setRotationField(
      `${s.teamId}_kqm`,
      'Timing',
      JSON.stringify({
        edits: { 6: { characterKey: 'Danica', text: 'Q', frames: 600 } },
      })
    )
    const before = snapshot(s)
    expect(seconds()).toBeGreaterThan(plain + 5)
    // (the team's timing is read, not changed)
    expect(snapshot(s)).toEqual(before)
  }, 300_000)

  it('fails with a code the page can say in the user’s language', async () => {
    const s = await setup()
    const failure = await compareSwapKqm({
      ...argsOf(s),
      saved: {
        ...s.saved,
        members: ['Anastasya', 'Furina', 'Odette', 'Danica'],
      },
    }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(CompareSwapFailure)
    expect((failure as CompareSwapFailure).code).toBe('otherMembers')
  }, 60_000)
})
