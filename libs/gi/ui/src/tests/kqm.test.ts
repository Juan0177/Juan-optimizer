import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey, SubstatKey } from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import {
  ArtCharDatabase,
  initTeamOpt,
  validateTeamOpt,
} from '@genshin-optimizer/gi/db'
import { getCharWeaponType, getWeaponStat } from '@genshin-optimizer/gi/stats'
import { getMainStatValue } from '@genshin-optimizer/gi/util'
import { precompute } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import type { KqmBuild, KqmResult } from '../'
import {
  calculateEnergyRecharge,
  compareTeamKqm,
  defaultEnergyCalculator,
  evaluateTeamRotation,
  itemConditionals,
  KQM_ROLLS,
  KQM_SUBSTAT_ROLLS,
  KQM_THREE_STARS,
  kqmArtData,
  kqmBuildRarity,
  kqmBuiltRefinement,
  kqmCompareRefinements,
  kqmConstellation,
  kqmDefaultExcludedWeapons,
  kqmExcludedWeapons,
  kqmGroupRefinements,
  kqmLockedWeapon,
  kqmMemberConstellation,
  kqmMemberRolls,
  kqmRefinement,
  kqmRollCaps,
  kqmSets,
  kqmTalentLevel,
  kqmTeamOverrides,
  kqmValues,
  kqmWeaponData,
  kqmWeaponGroup,
  kqmWeaponSource,
  kqmWeapons,
  optimizeTeamKqm,
  teamRotationNodes,
} from '../'

const ayaka: CharacterKey = 'KamisatoAyaka'
const shenhe: CharacterKey = 'Shenhe'
const baselineEr = { [ayaka]: 100, [shenhe]: 100 }
const standardCharacters = {
  [ayaka]: { talent: { auto: 10, skill: 10, burst: 10 } },
  [shenhe]: { talent: { auto: 10, skill: 10, burst: 10 } },
}

function setup() {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const [key, weapon] of [
    [ayaka, 'MistsplitterReforged'],
    [shenhe, 'CalamityQueller'],
  ] as const) {
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 0,
    })
    database.weapons.new({
      key: weapon,
      level: 90,
      ascension: 6,
      refinement: 1,
      location: key,
      lock: false,
    })
  }
  const ayakaId = database.teamChars.new(ayaka, {
    conditional: { KamisatoAyaka: { afterBurst: 'on' } },
  })
  const shenheId = database.teamChars.new(shenhe, {
    conditional: { Shenhe: { quill: 'quill', burst: 'burst' } },
  })
  const teamId = database.teams.new({
    loadoutData: [
      { teamCharId: ayakaId },
      { teamCharId: shenheId },
    ] as LoadoutDatum[],
  })
  const teamOpt: TeamOpt = {
    ...initTeamOpt(),
    kqm: {
      refinement5: 1,
      refinement4: 5,
      talents: 10,
      energyRecharge: { ...baselineEr },
    },
    attacks: {
      [ayaka]: [
        { path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' },
        { path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' },
      ],
      [shenhe]: [{ path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' }],
    },
  }
  return { database, teamId, ayakaId, shenheId, teamOpt }
}

const run = (database: ArtCharDatabase, teamId: string, teamOpt: TeamOpt) =>
  optimizeTeamKqm({ database, teamId, gender: 'F', teamOpt, maxRounds: 2 })

/** Every build keeps to KQMS: 20 free rolls at most, per-substat caps, its weapon type */
function expectKqms(result: KqmResult) {
  for (const [ck, b] of Object.entries(result.builds) as [
    CharacterKey,
    KqmBuild,
  ][]) {
    const caps = kqmRollCaps(b.mains)
    const total = Object.values(b.rolls).reduce((a, n) => a + (n ?? 0), 0)
    // (2 fewer for each 4★ piece: Instructor's and The Exile's)
    expect(total).toBe(kqmBuildRarity(b).rolls)
    for (const [k, n] of Object.entries(b.rolls) as [SubstatKey, number][])
      expect(n).toBeLessThanOrEqual(caps[k])
    expect(getWeaponStat(b.weapon.key)?.weaponType).toBe(getCharWeaponType(ck))
    const pieces = Object.values(b.sets).reduce((a, n) => a + (n ?? 0), 0)
    expect(pieces).toBeLessThanOrEqual(4)
    for (const k of Object.keys(b.sets)) expect(kqmSets()).toContain(k)
  }
}

describe('KQM Standards builds', () => {
  it('counts 2 rolls of every substat, the main stats at +20, and the caps', () => {
    const mains = {
      sands: 'atk_',
      goblet: 'cryo_dmg_',
      circlet: 'critRate_',
    } as const
    const values = kqmValues({
      sets: { BlizzardStrayer: 4 },
      mains,
      rolls: { critDMG_: 10 },
    })
    const roll = (k: SubstatKey) => KQM_SUBSTAT_ROLLS[k]
    expect(roll('enerRech_') * 100).toBeCloseTo(5.51, 10)
    expect(roll('critRate_') * 100).toBeCloseTo(3.31, 10)
    expect(roll('critDMG_') * 100).toBeCloseTo(6.62, 10)
    expect(values['critDMG_']).toBeCloseTo(12 * roll('critDMG_'), 12)
    expect(values['critRate_']).toBeCloseTo(
      2 * roll('critRate_') + getMainStatValue('critRate_', 5, 20),
      12
    )
    expect(values['atk']).toBeCloseTo(
      2 * roll('atk') + getMainStatValue('atk', 5, 20),
      12
    )
    expect(values['hp']).toBeCloseTo(
      2 * roll('hp') + getMainStatValue('hp', 5, 20),
      12
    )
    expect(values['BlizzardStrayer']).toBe(4)
    const caps = kqmRollCaps(mains)
    // one piece has CRIT Rate / ATK% / ATK / HP as its main stat: 8 free rolls at most
    expect(caps.critRate_).toBe(8)
    expect(caps.atk_).toBe(8)
    expect(caps.atk).toBe(8)
    expect(caps.hp).toBe(8)
    expect(caps.critDMG_).toBe(10)
    // the data the team calculation takes is the same build
    const data = kqmArtData({
      sets: { BlizzardStrayer: 4 },
      mains,
      rolls: { critDMG_: 10 },
    })
    expect(Object.keys(data.artSet ?? {})).toEqual(['BlizzardStrayer'])
  })

  it('finds a team build whose rolls are the best for its sets and main stats', async () => {
    const { database, teamId, teamOpt } = setup()
    const result = (await run(database, teamId, teamOpt))!
    expect(result).toBeTruthy()
    expectKqms(result)
    expect(result.optimized).toEqual([ayaka, shenhe])
    // the reported damage is the team's with those builds, evaluated the regular way
    const gear = Object.fromEntries(
      Object.entries(result.builds).map(([ck, b]) => [ck, kqmArtData(b!)])
    )
    const weapons = Object.fromEntries(
      Object.entries(result.builds).map(([ck, b]) => [
        ck,
        kqmWeaponData(b!.weapon, ck as CharacterKey),
      ])
    )
    // (the rule-based effects the run counted, as it counted them)
    const extraConditionals = Object.fromEntries(
      [ayaka, shenhe].map((ck) => [
        ck,
        itemConditionals(
          {
            attacks: ck === ayaka ? ['burst', 'skill'] : ['skill'],
            auras: ['cryo'],
            otherElements: 0,
          },
          { weapons: [result.builds[ck]!.weapon.key] }
        ).conditional,
      ])
    )
    const again = evaluateTeamRotation(database, teamId, 'F', {
      arts: gear,
      attacks: teamOpt.attacks,
      weapons,
      extraConditionals,
      characters: standardCharacters,
    })!
    expect(again.total).toBeCloseTo(result.after.total, 0)
    // the rankings' best is the result itself
    for (const ck of [ayaka, shenhe]) {
      const r = result.rankings[ck]!
      expect(r.sets[0].total).toBeCloseTo(result.after.total, 0)
      expect(r.weapons[0].total).toBeCloseTo(result.after.total, 0)
      for (const list of [r.sets, r.weapons])
        for (const o of list.filter((o) => !o.unmet))
          expect(o.total).toBeLessThanOrEqual(result.after.total * (1 + 1e-9))
    }

    // Ayaka's free rolls against every way to place them (her sets, main stats, weapon; Shenhe's build)
    const b = result.builds[ayaka]!
    const nodes = teamRotationNodes(database, teamId, 'F', {
      dyn: ayaka,
      arts: { [shenhe]: gear[shenhe] },
      attacks: teamOpt.attacks,
      weapons,
      extraConditionals,
      characters: standardCharacters,
    })!
    const f = precompute(
      nodes.terms.map((t) => t.node),
      {},
      (r) => r.path[1],
      1
    )
    const total = (rolls: Partial<Record<SubstatKey, number>>) =>
      f([
        { values: kqmValues({ sets: b.sets, mains: b.mains, rolls }) },
      ] as never).reduce((a, x) => a + x, 0)
    const caps = kqmRollCaps(b.mains)
    const subs = (
      ['critRate_', 'critDMG_', 'atk_', 'atk', 'enerRech_'] as SubstatKey[]
    ).filter((k) => caps[k] > 0)
    let best = 0
    const place = (
      i: number,
      left: number,
      rolls: Partial<Record<SubstatKey, number>>
    ) => {
      if (i === subs.length) {
        if (left === 0) best = Math.max(best, total(rolls))
        return
      }
      for (let n = 0; n <= Math.min(left, caps[subs[i]]); n++)
        place(i + 1, left - n, { ...rolls, [subs[i]]: n })
    }
    place(0, KQM_ROLLS, {})
    expect(total(b.rolls)).toBeGreaterThanOrEqual(best * (1 - 1e-9))
    // (only stats she scales with get rolls)
    for (const k of Object.keys(b.rolls)) expect(allSubstatKeys).toContain(k)
  }, 300_000)

  it("uses KQM's own settings, not the members' Optimize tab (main stats, sets, stat filters)", async () => {
    const { database, teamId, ayakaId, teamOpt } = setup()
    // the Optimize tab: HP% sands only, every set but Blizzard Strayer left out, a CRIT Rate floor
    const optConfigId = database.teamChars.get(ayakaId)!.optConfigId
    database.optConfigs.set(optConfigId, {
      mainStatKeys: { sands: ['hp_'], goblet: ['hp_'], circlet: ['hp_'] },
      artSetExclusion: Object.fromEntries(
        kqmSets()
          .filter((k) => k !== 'BlizzardStrayer')
          .map((k) => [k, [2, 4]])
      ),
      statFilters: {
        [JSON.stringify(['basic', 'critRate_'])]: [
          { value: 100, disabled: false },
        ],
      },
    })
    // KQM's own choice: Blizzard Strayer and Gladiator's Finale only
    teamOpt.kqm!.excludedSets = kqmSets().filter(
      (k) => k !== 'BlizzardStrayer' && k !== 'GladiatorsFinale'
    )
    const result = (await run(database, teamId, teamOpt))!
    expectKqms(result)
    const build = result.builds[ayaka]!
    // main stats by KQM's rules: a DPS takes no HP% pieces
    expect([
      build.mains.sands,
      build.mains.goblet,
      build.mains.circlet,
    ]).not.toContain('hp_')
    // KQM's sets only, Gladiator's Finale among them (the Optimize tab had left it out)
    const used = result.rankings[ayaka]!.sets.flatMap((o) =>
      Object.keys(o.sets)
    )
    for (const k of used)
      expect(['BlizzardStrayer', 'GladiatorsFinale']).toContain(k)
    expect(used).toContain('GladiatorsFinale')
    // the Optimize tab's CRIT Rate floor is no KQM requirement
    expect(result.after.unmet[ayaka] ?? []).toEqual([])
  }, 300_000)

  it('quick search (the default): after round 1 each member keeps its contenders, the rest listed as screened out, about as good as a full search', async () => {
    const { database, teamId, teamOpt } = setup()
    const full = (await run(database, teamId, {
      ...teamOpt,
      kqm: { ...teamOpt.kqm!, fullSearch: true },
    }))!
    const fast = (await run(database, teamId, teamOpt))!
    expectKqms(fast)
    expect(full.screenedOut).toBeUndefined()
    expect(fast.after.total).toBeGreaterThanOrEqual(full.after.total * 0.99)
    for (const ck of [ayaka, shenhe]) {
      const out = fast.screenedOut?.[ck]
      expect(out).toBeTruthy()
      const ranked = fast.rankings[ck]!
      // (every weapon the full search ranks: ranked here or screened out, never both)
      expect(ranked.weapons.length + out!.weapons.length).toBe(
        full.rankings[ck]!.weapons.length
      )
      expect(out!.weapons.length).toBeGreaterThan(0)
      const build = fast.builds[ck]!
      expect(out!.weapons.map((w) => w.key)).not.toContain(build.weapon.key)
      for (const set of Object.keys(build.sets))
        expect(out!.sets).not.toContain(set)
    }
  })

  it('a locked weapon: every build and ranking of that member uses it, even off in the list, and the others are searched around it', async () => {
    const { database, teamId, teamOpt } = setup()
    // (an event-wish 5★: off in KQM's default list)
    expect(kqmWeapons(ayaka, teamOpt.kqm).map((w) => w.key)).not.toContain(
      'MistsplitterReforged'
    )
    teamOpt.kqm!.lockedWeapons = { [ayaka]: 'MistsplitterReforged' }
    teamOpt.kqm!.refinements = { MistsplitterReforged: 3 }
    expect(kqmWeapons(ayaka, teamOpt.kqm)).toEqual([
      { key: 'MistsplitterReforged', refinement: 3 },
    ])
    for (const fullSearch of [false, true]) {
      const result = (await run(database, teamId, {
        ...teamOpt,
        kqm: { ...teamOpt.kqm!, fullSearch },
      }))!
      expectKqms(result)
      expect(result.builds[ayaka]!.weapon).toEqual({
        key: 'MistsplitterReforged',
        refinement: 3,
      })
      expect(
        new Set(
          result.rankings[ayaka]!.weapons.map(
            (o) => `${o.weapon.key}@${o.weapon.refinement}`
          )
        )
      ).toEqual(new Set(['MistsplitterReforged@3']))
      expect(result.screenedOut?.[ayaka]?.weapons ?? []).toEqual([])
      expect(result.rankings[shenhe]!.weapons.length).toBeGreaterThan(1)
    }
    // (a weapon of another type, as saved from elsewhere: no lock)
    teamOpt.kqm!.lockedWeapons = { [ayaka]: 'CalamityQueller' }
    expect(kqmLockedWeapon(ayaka, teamOpt.kqm)).toBeUndefined()
    expect(kqmWeapons(ayaka, teamOpt.kqm).length).toBeGreaterThan(1)
  }, 300_000)

  it('rolls set per member: each member’s builds and rankings place its own, within its own caps', async () => {
    const { database, teamId, teamOpt } = setup()
    const kqm = { ...teamOpt.kqm!, rolls: 30, memberRolls: { [ayaka]: 40 } }
    expect(kqmMemberRolls(ayaka, kqm)).toBe(40)
    expect(kqmMemberRolls(shenhe, kqm)).toBe(30)
    expect(kqmMemberRolls(shenhe, teamOpt.kqm)).toBe(20)
    const result = (await run(database, teamId, { ...teamOpt, kqm }))!
    const placed = (b: KqmBuild) =>
      Object.values(b.rolls).reduce((a, n) => a + (n ?? 0), 0)
    for (const [ck, budget] of [
      [ayaka, 40],
      [shenhe, 30],
    ] as const) {
      const b = result.builds[ck]!
      expect(placed(b)).toBe(kqmBuildRarity(b, budget).rolls)
      const caps = kqmRollCaps(b.mains, budget)
      for (const [k, n] of Object.entries(b.rolls) as [SubstatKey, number][])
        expect(n).toBeLessThanOrEqual(caps[k])
      for (const o of result.rankings[ck]!.sets)
        expect(placed(o)).toBe(kqmBuildRarity(o, budget).rolls)
    }
    // (more rolls on one member: more damage than the team's 30 for both)
    const even = (await run(database, teamId, {
      ...teamOpt,
      kqm: { ...teamOpt.kqm!, rolls: 30 },
    }))!
    expect(result.after.total).toBeGreaterThan(even.after.total)
  }, 300_000)

  it('a pick of a screened-out set after a quick search counts its effects, as after a full search', async () => {
    const { database, teamId, teamOpt } = setup()
    // (weak sets here: their 35% only on the 2 Skill hits)
    teamOpt.attacks[ayaka] = [
      { path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' },
      {
        path: ['skill', 'press'],
        hits: 2,
        hitMode: 'avgHit',
        states: [
          { owner: ayaka, path: ['Lavawalker', 'state'], value: 'on' },
          { owner: ayaka, path: ['Thundersoother', 'state'], value: 'on' },
        ],
      },
    ]
    const result = (await run(database, teamId, teamOpt))!
    const set = (['Lavawalker', 'Thundersoother'] as const).find((k) =>
      result.screenedOut?.[ayaka]?.sets.includes(k)
    )
    expect(set).toBeTruthy()
    const pick = (fullSearch: boolean) =>
      compareTeamKqm({
        database,
        teamId,
        gender: 'F',
        teamOpt: { ...teamOpt, kqm: { ...teamOpt.kqm!, fullSearch } },
        result,
        characterKey: ayaka,
        weapon: result.builds[ayaka]!.weapon,
        sets: { [set!]: 4 },
      }) as Promise<KqmResult>
    const quick = await pick(false)
    const full = await pick(true)
    expect(quick.builds[ayaka]!.sets).toEqual({ [set!]: 4 })
    expect(quick.after.total).toBeCloseTo(full.after.total, 6)
  }, 300_000)

  it('pairs two sets with the same 2-piece bonus (2-piece ATK + 2-piece ATK)', async () => {
    const { database, teamId, teamOpt } = setup()
    // (two ATK% 2-pieces and one Cryo DMG 2-piece: one bonus class each, ATK% twice)
    teamOpt.kqm!.excludedSets = kqmSets().filter(
      (k) =>
        k !== 'BlizzardStrayer' &&
        k !== 'GladiatorsFinale' &&
        k !== 'ShimenawasReminiscence'
    )
    const result = (await run(database, teamId, teamOpt))!
    expectKqms(result)
    const ranked = result.rankings[ayaka]!.sets.map((o) => o.sets)
    expect(ranked).toContainEqual({
      GladiatorsFinale: 2,
      ShimenawasReminiscence: 2,
    })
  }, 300_000)

  it('meets a member’s requirements', async () => {
    const { database, teamId, ayakaId, teamOpt } = setup()
    const optConfigId = database.teamChars.get(ayakaId)!.optConfigId
    database.optConfigs.set(optConfigId, {
      statFilters: {
        [JSON.stringify(['basic', 'enerRech_'])]: [
          { value: 180, disabled: false },
        ],
      },
    })
    teamOpt.kqm!.energyRecharge![ayaka] = 180
    const result = (await run(database, teamId, teamOpt))!
    expectKqms(result)
    expect(result.after.unmet[ayaka] ?? []).toEqual([])
    expect(result.energyRecharge[ayaka]!.value).toBeGreaterThanOrEqual(180)
  }, 300_000)

  it('builds every member, whatever Team optimize keeps (KQM is for the whole team)', async () => {
    const { database, teamId, teamOpt } = setup()
    const result = (await run(database, teamId, {
      ...teamOpt,
      keep: [shenhe],
    }))!
    expect(Object.keys(result.builds).sort()).toEqual([ayaka, shenhe].sort())
    expect(result.rankings[shenhe]).toBeDefined()
  }, 300_000)

  it('refits one member at another constellation from a run’s builds: its weapon and sets kept, the others’ builds as they were', async () => {
    const { database, teamId, teamOpt } = setup()
    const first = (await run(database, teamId, teamOpt))!
    const at = (constellation: number) => ({
      ...teamOpt,
      kqm: {
        ...teamOpt.kqm!,
        constellations: {
          ...teamOpt.kqm!.constellations,
          [ayaka]: constellation,
        },
      },
    })
    const refit = (await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt: at(6),
      from: first.builds,
      only: ayaka,
      maxRounds: 1,
    }))!
    expect(refit.builds[ayaka]!.weapon).toEqual(first.builds[ayaka]!.weapon)
    expect(refit.builds[ayaka]!.sets).toEqual(first.builds[ayaka]!.sets)
    expect(refit.builds[shenhe]).toEqual(first.builds[shenhe])
    // (no rankings: a quick neighbour of the run) and more damage at C6
    expect(refit.rankings).toEqual({})
    expect(refit.after.total).toBeGreaterThan(first.after.total)
  })

  it('ranks a group’s weapons at every refinement ticked, building at the group’s default one (else the highest)', async () => {
    // (the helpers: Favonius is a 4★ standard wish weapon, R5 unless set; R1 ticked too. The
    // Battle Pass's R1 + R5, saved with the highest as the setting, as before: still built at R1)
    const kqm = {
      refinement5: 1,
      refinement4: 5,
      compareRefinements: { standard4: [1, 5], bp: [1, 5] },
      refinementBp: 5,
    }
    expect(kqmWeaponGroup('FavoniusSword')).toBe('standard4')
    expect(kqmRefinement('FavoniusSword', kqm)).toBe(5)
    expect(kqmGroupRefinements('standard4', kqm)).toEqual([1, 5])
    expect(kqmCompareRefinements('FavoniusSword', kqm)).toEqual([1])
    expect(kqmWeaponGroup('TheBlackSword')).toBe('bp')
    expect(kqmRefinement('TheBlackSword', kqm)).toBe(1)
    expect(kqmGroupRefinements('bp', kqm)).toEqual([1, 5])
    expect(kqmCompareRefinements('TheBlackSword', kqm)).toEqual([5])
    // (the default one when ticked: Battle Pass R1, 4★ standard wish R5; else the highest)
    expect(kqmBuiltRefinement('bp', [1, 5])).toBe(1)
    expect(kqmBuiltRefinement('bp', [3, 5])).toBe(5)
    expect(kqmBuiltRefinement('standard4', [1, 5])).toBe(5)
    expect(kqmBuiltRefinement('standard4', [1, 3])).toBe(3)
    // (a weapon with its own refinement is not compared; a group with one ticked neither)
    expect(
      kqmCompareRefinements('FavoniusSword', {
        ...kqm,
        refinements: { FavoniusSword: 3 },
      })
    ).toEqual([])
    expect(kqmCompareRefinements('PrototypeRancour', kqm)).toEqual([])
    // the run (a full search, which ranks every weapon): each such weapon ranked twice, R1 marked
    // compared; no build takes a compared one
    const { database, teamId, teamOpt } = setup()
    const result = (await run(database, teamId, {
      ...teamOpt,
      kqm: { ...teamOpt.kqm!, ...kqm, fullSearch: true },
    }))!
    const weapons = result.rankings[ayaka]!.weapons
    const favonius = weapons.filter((o) => o.weapon.key === 'FavoniusSword')
    expect(favonius.map((o) => o.weapon.refinement).sort()).toEqual([1, 5])
    expect(favonius.find((o) => o.weapon.refinement === 1)?.compare).toBe(true)
    expect(favonius.find((o) => o.weapon.refinement === 5)?.compare).toBe(
      undefined
    )
    const blackSword = weapons.filter((o) => o.weapon.key === 'TheBlackSword')
    expect(blackSword.map((o) => o.weapon.refinement).sort()).toEqual([1, 5])
    expect(blackSword.find((o) => o.weapon.refinement === 1)?.compare).toBe(
      undefined
    )
    expect(blackSword.find((o) => o.weapon.refinement === 5)?.compare).toBe(
      true
    )
    for (const ck of [ayaka, shenhe]) {
      const built = result.builds[ck]!.weapon
      expect(
        kqmCompareRefinements(built.key, { ...teamOpt.kqm!, ...kqm })
      ).not.toContain(built.refinement)
    }
  })

  it('uses only free weapons by default (4★, the three 3★ and the free 5★ Exaiphanes Blade), at their source’s refinement', async () => {
    const { database, teamId, teamOpt } = setup()
    const result = (await run(database, teamId, teamOpt))!
    for (const ck of [ayaka, shenhe])
      for (const w of [
        result.builds[ck]!.weapon,
        ...result.rankings[ck]!.weapons.map((o) => o.weapon),
      ]) {
        expect(getWeaponStat(w.key)?.rarity).toBe(
          w.key === 'ExaiphanesBlade'
            ? 5
            : KQM_THREE_STARS.includes(w.key)
              ? 3
              : 4
        )
        const source = kqmWeaponSource(w.key)
        expect(['gacha', 'starglitter']).not.toContain(source)
        expect(w.refinement).toBe(
          source === 'bp' || source === 'quest' || source === 'console' ? 1 : 5
        )
      }
    // the table: some known weapons
    expect(kqmWeaponSource('PrototypeRancour')).toBe('craft')
    expect(kqmWeaponSource('TheBlackSword')).toBe('bp')
    expect(kqmWeaponSource('FavoniusSword')).toBe('standard')
    expect(kqmWeaponSource('TheAlleyFlash')).toBe('gacha')
    expect(kqmWeaponSource('BlackcliffLongsword')).toBe('starglitter')
    // the standard wish pool's 4★ (any banner): in by default, at R5; event-wish-only ones out
    expect(kqmRefinement('SacrificialFragments')).toBe(5)
    expect(kqmDefaultExcludedWeapons()).not.toContain('SacrificialFragments')
    expect(kqmWeapons(ayaka).map((w) => w.key)).toContain('SacrificialSword')
    expect(kqmDefaultExcludedWeapons()).toContain('TheAlleyFlash')
    expect(kqmDefaultExcludedWeapons()).toContain('BlackcliffLongsword')
    // (a free copy from a world quest: a reward, R1)
    expect(kqmWeaponSource('MoonweaversDawn')).toBe('quest')
    // a list saved before the standard wish pool was its own: those are on again; one saved
    // since keeps them as it has them
    expect(
      kqmExcludedWeapons({
        refinement5: 1,
        refinement4: 5,
        excludedWeapons: [
          'SacrificialSword',
          'TheAlleyFlash',
          'MoonweaversDawn',
        ],
      })
    ).toEqual(new Set(['TheAlleyFlash']))
    expect(
      kqmExcludedWeapons({
        refinement5: 1,
        refinement4: 5,
        excludedWeapons: ['SacrificialSword', 'TheAlleyFlash'],
        weaponList: 2,
      })
    ).toEqual(new Set(['SacrificialSword', 'TheAlleyFlash']))
    expect(kqmWeaponSource('TheCatch')).toBe('fishing')
    expect(kqmRefinement('TheBlackSword')).toBe(1)
    expect(kqmRefinement('PrototypeRancour')).toBe(5)
    // the only 3★: Harbinger of Dawn, Slingshot, Thrilling Tales of Dragon Slayers, in at R5
    for (const [character, weapon] of [
      ['Bennett', 'HarbingerOfDawn'],
      ['Fischl', 'Slingshot'],
      ['Sucrose', 'ThrillingTalesOfDragonSlayers'],
    ] as const) {
      const offered = kqmWeapons(character)
      expect(offered.find((w) => w.key === weapon)?.refinement).toBe(5)
      expect(kqmDefaultExcludedWeapons()).not.toContain(weapon)
      expect(
        offered
          .filter((w) => getWeaponStat(w.key)?.rarity === 3)
          .map((w) => w.key)
      ).toEqual([weapon])
    }
    // the free 5★: in by default (a sword user gets it), at R1
    expect(kqmWeaponSource('ExaiphanesBlade')).toBe('quest')
    expect(kqmRefinement('ExaiphanesBlade')).toBe(1)
    expect(kqmDefaultExcludedWeapons()).not.toContain('ExaiphanesBlade')
    expect(kqmWeapons(ayaka).map((w) => w.key)).toContain('ExaiphanesBlade')
    expect(kqmDefaultExcludedWeapons()).toContain('MistsplitterReforged')
    // the standard banner's 5★: their own group, off by default, at its setting (R1)
    expect(kqmWeaponSource('SkywardBlade')).toBe('standard')
    expect(kqmWeaponGroup('SkywardBlade')).toBe('standard5')
    expect(kqmDefaultExcludedWeapons()).toContain('SkywardBlade')
    expect(kqmRefinement('SkywardBlade')).toBe(1)
    expect(
      kqmRefinement('SkywardBlade', {
        refinement5: 1,
        refinement4: 5,
        refinementStandard5: 2,
      })
    ).toBe(2)
    // (an old list had them off with the wish 5★: they stay off)
    expect(
      kqmExcludedWeapons({
        refinement5: 1,
        refinement4: 5,
        excludedWeapons: ['SkywardBlade'],
      })
    ).toEqual(new Set(['SkywardBlade']))
    // the groups turned on and off together, and their refinement settings
    expect(kqmWeaponGroup('TheBlackSword')).toBe('bp')
    // (the standard wish pool's 4★: a group of their own, on by default at R5)
    expect(kqmWeaponGroup('FavoniusSword')).toBe('standard4')
    expect(kqmDefaultExcludedWeapons()).not.toContain('FavoniusSword')
    expect(
      kqmRefinement('FavoniusSword', {
        refinement5: 1,
        refinement4: 5,
        refinementStandard4: 1,
      })
    ).toBe(1)
    expect(kqmWeaponGroup('TheAlleyFlash')).toBe('wish4')
    expect(kqmWeaponGroup('BlackcliffLongsword')).toBe('wish4')
    expect(kqmWeaponGroup('MistsplitterReforged')).toBe('wish5')
    expect(kqmWeaponGroup('ExaiphanesBlade')).toBeUndefined()
    expect(kqmWeaponGroup('PrototypeRancour')).toBeUndefined()
    expect(
      kqmRefinement('TheBlackSword', {
        refinement5: 1,
        refinement4: 5,
        refinementBp: 3,
      })
    ).toBe(3)
    expect(
      kqmRefinement('TheAlleyFlash', { refinement5: 1, refinement4: 3 })
    ).toBe(3)
    // (the standard wish pool's: R5 whatever the event-wish setting)
    expect(
      kqmRefinement('FavoniusSword', { refinement5: 1, refinement4: 3 })
    ).toBe(5)
    expect(
      kqmRefinement('TheBlackSword', {
        refinement5: 1,
        refinement4: 5,
        refinements: { TheBlackSword: 4 },
      })
    ).toBe(4)
    // 5★ allowed again, and Blizzard Strayer left out
    const all = (await run(database, teamId, {
      ...teamOpt,
      kqm: {
        talents: 10,
        energyRecharge: { ...baselineEr },
        refinement5: 1,
        refinement4: 5,
        excludedWeapons: [],
        excludedSets: ['BlizzardStrayer'],
      },
    }))!
    expect(
      all.rankings[ayaka]!.weapons.some(
        (o) => getWeaponStat(o.weapon.key)?.rarity === 5
      )
    ).toBe(true)
    for (const ck of [ayaka, shenhe])
      for (const o of all.rankings[ck]!.sets)
        expect(o.sets['BlizzardStrayer']).toBeUndefined()
  }, 300_000)

  it('counts a member’s effects as KQM mode sets them, over the rules', async () => {
    const { database, teamId, teamOpt } = setup()
    const first = (await run(database, teamId, teamOpt))!
    const assumed = first.assumed[ayaka] ?? []
    if (!assumed.length) return
    // every effect counted by rule for her, turned off in KQM mode
    const passives: Record<string, Record<string, string>> = {}
    for (const { path } of assumed)
      (passives[path[0]] ??= {})[path[path.length - 1]] = ''
    const second = (await run(database, teamId, {
      ...teamOpt,
      kqm: {
        talents: 10,
        energyRecharge: { ...baselineEr },
        refinement5: 1,
        refinement4: 5,
        passives: { [ayaka]: passives },
      },
    }))!
    for (const { path } of second.assumed[ayaka] ?? [])
      expect(passives[path[0]]?.[path[path.length - 1]]).toBeUndefined()
  }, 300_000)

  it("builds for the team's enemy: its level and RES", async () => {
    const { database, teamId, teamOpt } = setup()
    const base = (await run(database, teamId, teamOpt))!.after.total
    // Cryo RES 10% -> 70% (the team deals Cryo DMG; Shenhe's burst shreds 15% at KQM's talent
    // 10): from -5% (halved: x1.025) to 55% (x0.45), the same builds
    database.teams.set(teamId, (team) => {
      team.enemyOverride.cryo_enemyRes_ = 70
    })
    const resisted = (await run(database, teamId, teamOpt))!.after.total
    expect(resisted / base).toBeCloseTo(0.45 / 1.025, 6)
    database.teams.set(teamId, (team) => {
      team.enemyOverride.enemyLevel = 110
    })
    expect((await run(database, teamId, teamOpt))!.after.total).toBeLessThan(
      resisted
    )
  }, 300_000)

  it('builds at 10/10/10 talents by default (KQM Standards), 9/9/9 when chosen', async () => {
    const { database, teamId, teamOpt } = setup()
    const { talents: _, ...standard } = teamOpt.kqm!
    const nine = (await run(database, teamId, {
      ...teamOpt,
      kqm: { ...standard, talents: 9 },
    }))!
    const ten = (await run(database, teamId, { ...teamOpt, kqm: standard }))!
    expect(kqmTalentLevel(standard)).toBe(10)
    expect(ten.after.total).toBeGreaterThan(nine.after.total * 1.03)
    // per member too: talents are every member's
    for (const k of [ayaka, shenhe])
      expect(ten.after.members[k]!).toBeGreaterThan(nine.after.members[k]!)
  }, 300_000)

  it("uses C6 for 4★, C1 for the free constellation event's limited 5★ (C2 standard, else C0) and the chosen talents (10/10/10) in search, rankings and evaluation without changing saved characters", async () => {
    const { database, teamId, teamOpt } = setup()
    database.chars.set(ayaka, { constellation: 6, level: 40, ascension: 2 })
    const fischl: CharacterKey = 'Fischl'
    database.chars.set(fischl, {
      key: fischl,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 0,
    })
    database.weapons.new({
      key: 'TheStringless',
      level: 90,
      ascension: 6,
      refinement: 1,
      location: fischl,
      lock: false,
    })
    teamOpt.kqm!.energyRecharge![fischl] = 100
    const fischlId = database.teamChars.new(fischl)
    database.teams.set(teamId, (team) => {
      team.loadoutData[2] = { teamCharId: fischlId } as LoadoutDatum
    })
    teamOpt.attacks[fischl] = [
      { path: ['skill', 'ozDmg'], hits: 10, hitMode: 'avgHit' },
    ]
    const snapshot = JSON.stringify(database.chars.values)
    const result = (await run(database, teamId, teamOpt))!
    expect(result.after.members[fischl]).toBeGreaterThan(0)
    // (Ayaka and Shenhe are in the free constellation event: C1; standard 5★ C2; others C0)
    expect(kqmConstellation(ayaka)).toBe(1)
    expect(kqmConstellation(fischl)).toBe(6)
    expect(kqmConstellation('Diluc')).toBe(2)
    expect(kqmConstellation('YumemizukiMizuki')).toBe(2)
    expect(kqmConstellation('Furina')).toBe(0)
    expect(result.constellations).toEqual({
      [ayaka]: 1,
      [shenhe]: 1,
      [fischl]: 6,
    })
    expect(JSON.stringify(database.chars.values)).toBe(snapshot)
    // The same run with the saved characters already at the standards gives identical output.
    database.chars.set(ayaka, { constellation: 1, level: 90, ascension: 6 })
    database.chars.set(shenhe, { constellation: 1 })
    database.chars.set(fischl, {
      constellation: 6,
      talent: { auto: 10, skill: 10, burst: 10 },
    })
    database.chars.set(ayaka, { talent: { auto: 10, skill: 10, burst: 10 } })
    database.chars.set(shenhe, { talent: { auto: 10, skill: 10, burst: 10 } })
    const standard = (await run(database, teamId, teamOpt))!
    expect(standard.after.total).toBeCloseTo(result.after.total, 5)
    expect(standard.rankings).toEqual(result.rankings)
    // A chosen constellation over the standard one (C3: her burst +3 levels): used for the build,
    // the saved one untouched
    const chosen = (await run(database, teamId, {
      ...teamOpt,
      kqm: { ...teamOpt.kqm!, constellations: { [ayaka]: 3 } },
    }))!
    expect(chosen.constellations[ayaka]).toBe(3)
    expect(chosen.constellations[fischl]).toBe(6)
    expect(chosen.after.members[ayaka]).toBeGreaterThan(
      standard.after.members[ayaka]
    )
    expect(database.chars.get(ayaka)?.constellation).toBe(1)
    expect(
      kqmMemberConstellation(ayaka, { constellations: { [ayaka]: 2 } })
    ).toBe(2)
    expect(kqmMemberConstellation(fischl, undefined)).toBe(6)
    expect(standard.builds).toEqual(result.builds)
    // Team optimize's kept members still get a KQM build, at the KQM constellation
    database.chars.set(ayaka, { constellation: 6 })
    const kept = (await run(database, teamId, { ...teamOpt, keep: [ayaka] }))!
    expect(kept.constellations[ayaka]).toBe(1)
    expect(kept.builds[ayaka]).toBeDefined()
  }, 300_000)

  it('rejects an empty weapon selection instead of silently enabling excluded weapons', async () => {
    const { database, teamId, teamOpt } = setup()
    const excludedWeapons = kqmWeapons(ayaka, undefined, { all: true }).map(
      (w) => w.key
    )
    const settings = {
      ...teamOpt,
      kqm: {
        talents: 10,
        energyRecharge: { ...baselineEr },
        refinement5: 1,
        refinement4: 5,
        excludedWeapons,
        weaponList: 2 as const,
      },
    }
    expect(kqmWeapons(ayaka, settings.kqm)).toEqual([])
    await expect(run(database, teamId, settings)).rejects.toThrow(
      'Select at least one weapon'
    )
  })

  it('supports an explicit no-set-bonus comparison', async () => {
    const { database, teamId, teamOpt } = setup()
    const result = (await run(database, teamId, {
      ...teamOpt,
      kqm: {
        talents: 10,
        energyRecharge: { ...baselineEr },
        refinement5: 1,
        refinement4: 5,
        excludedSets: kqmSets(),
      },
    }))!
    for (const build of Object.values(result.builds))
      expect(build!.sets).toEqual({})
  }, 300_000)

  it('uses 100% (no requirement) for a member without a valid ER target', async () => {
    const { database, teamId, teamOpt } = setup()
    for (const value of [undefined, 99]) {
      teamOpt.kqm!.energyRecharge = { [ayaka]: 130, [shenhe]: value as number }
      const result = (await run(database, teamId, teamOpt))!
      expect(result.energyRecharge[shenhe]!.target).toBe(100)
      expect(result.energyRecharge[ayaka]!.target).toBe(130)
    }
  }, 300_000)

  it('allocates rolls to an explicit ER target and reports impossible targets', async () => {
    const { database, teamId, ayakaId, teamOpt } = setup()
    const configId = database.teamChars.get(ayakaId)!.optConfigId
    // (the Optimize tab's ER floor is not KQM's: KQM's ER target decides)
    database.optConfigs.set(configId, {
      statFilters: {
        [JSON.stringify(['basic', 'enerRech_'])]: [
          { value: 999, disabled: false },
        ],
      },
    })
    teamOpt.keep = [shenhe]
    teamOpt.kqm!.excludedWeapons = kqmWeapons(ayaka, undefined, { all: true })
      .map((w) => w.key)
      .filter((key) => key !== 'PrototypeRancour')
    teamOpt.kqm!.weaponList = 2
    const low = (await run(database, teamId, teamOpt))!
    expect(low.energyRecharge[ayaka]!.minimum).toBe(100)
    expect(low.after.unmet[ayaka] ?? []).toEqual([])
    teamOpt.kqm!.energyRecharge![ayaka] = 150
    const high = (await run(database, teamId, teamOpt))!
    expect(high.energyRecharge[ayaka]!.value).toBeGreaterThanOrEqual(150)
    expect(high.builds[ayaka]!.rolls.enerRech_ ?? 0).toBeGreaterThan(
      low.builds[ayaka]!.rolls.enerRech_ ?? 0
    )
    teamOpt.kqm!.energyRecharge![ayaka] = 300
    const impossible = (await run(database, teamId, teamOpt))!
    expect(impossible.energyRecharge[ayaka]!.value).toBeLessThan(300)
    expect(
      impossible.after.shortfalls![ayaka]!.some(
        (s) => s.path.at(-1) === 'enerRech_'
      )
    ).toBe(true)
    // a requirement no build meets does not mark every ranked option: only one the chosen
    // build meets does (here none)
    const ranked = impossible.rankings[ayaka]!
    expect([...ranked.sets, ...ranked.weapons].some((o) => !o.unmet)).toBe(true)
    expect(ranked.sets[0].total).toBeCloseTo(impossible.after.total, 0)
  }, 300_000)

  it('uses calculator ER constraints for the actual weapons without applying manual reductions twice', async () => {
    const { database, teamId, teamOpt } = setup()
    const settings = defaultEnergyCalculator([ayaka, shenhe], 20)
    settings.members[ayaka]!.skillUses = 2
    settings.members[shenhe]!.skillUses = 2
    settings.members[shenhe]!.burstEvery = 0
    settings.members[shenhe]!.favoniusProcs = 1
    teamOpt.kqm!.energySource = 'calculator'
    teamOpt.kqm!.energyCalculator = settings
    teamOpt.kqm!.energyRecharge = calculateEnergyRecharge(
      [ayaka, shenhe],
      settings
    ).targets
    teamOpt.kqm!.weaponEnergy = { FavoniusLance: { [ayaka]: 100 } }
    // (KQM's own weapon choices: the members' own weapons play no part)
    teamOpt.kqm!.excludedWeapons = [
      ...kqmWeapons(ayaka, undefined, { all: true })
        .map((w) => w.key)
        .filter((key) => key !== 'PrototypeRancour'),
      ...kqmWeapons(shenhe, undefined, { all: true })
        .map((w) => w.key)
        .filter((key) => key !== 'FavoniusLance'),
    ]
    teamOpt.kqm!.weaponList = 2
    const result = (await run(database, teamId, teamOpt))!
    expect(result.builds[shenhe]!.weapon.key).toBe('FavoniusLance')
    // (the weapons' refinements as the run gives them: Favonius's chance follows its refinement)
    const expected = calculateEnergyRecharge(
      [ayaka, shenhe],
      settings,
      { [ayaka]: 'PrototypeRancour', [shenhe]: 'FavoniusLance' },
      {
        [ayaka]: result.builds[ayaka]!.weapon.refinement,
        [shenhe]: result.builds[shenhe]!.weapon.refinement,
      }
    ).targets[ayaka]!
    expect(result.energyRecharge[ayaka]!.minimum).toBeCloseTo(expected, 6)
    expect(result.energyRecharge[ayaka]!.value).toBeGreaterThanOrEqual(expected)
    expect(result.energyRecharge[ayaka]!.minimum).toBeGreaterThan(100)
  }, 300_000)

  it('searches a teammate again when a weapon changes its ER requirement (Favonius), in rankings and picks', async () => {
    const { database, teamId, teamOpt } = setup()
    const settings = defaultEnergyCalculator([ayaka, shenhe], 20)
    settings.members[ayaka]!.skillUses = 2
    settings.members[shenhe]!.skillUses = 2
    settings.members[shenhe]!.burstEvery = 0
    // (Shenhe's Favonius particles: Ayaka gets her off-field share)
    settings.members[shenhe]!.favoniusProcs = 2
    teamOpt.kqm!.energySource = 'calculator'
    teamOpt.kqm!.energyCalculator = settings
    teamOpt.kqm!.energyRecharge = calculateEnergyRecharge(
      [ayaka, shenhe],
      settings
    ).targets
    teamOpt.kqm!.excludedWeapons = [
      ...kqmWeapons(ayaka, undefined, { all: true })
        .map((w) => w.key)
        .filter((key) => key !== 'PrototypeRancour'),
      ...kqmWeapons(shenhe, undefined, { all: true })
        .map((w) => w.key)
        .filter((key) => key !== 'FavoniusLance' && key !== 'TheCatch'),
    ]
    teamOpt.kqm!.weaponList = 2
    const result = (await run(database, teamId, teamOpt))!
    const weaponOf = (key: string) =>
      kqmWeapons(shenhe, teamOpt.kqm).find((w) => w.key === key)!
    const pick = (key: string) =>
      compareTeamKqm({
        database,
        teamId,
        gender: 'F',
        teamOpt,
        result,
        characterKey: shenhe,
        weapon: weaponOf(key),
        sets: result.builds[shenhe]!.sets,
      }).then((r) => r!)
    const favonius = await pick('FavoniusLance')
    const other = await pick('TheCatch')
    const er = (r: KqmResult) => r.energyRecharge[ayaka]!
    // Favonius lowers Ayaka's requirement; without it, she needs more and her build meets it
    expect(er(other).minimum).toBeGreaterThan(er(favonius).minimum + 1)
    expect(er(other).value).toBeGreaterThanOrEqual(er(other).minimum - 1e-6)
    // with Favonius her artifacts are searched again: she uses the ER it frees
    expect(er(favonius).value).toBeLessThan(er(other).minimum)
    // the ranked option whose weapon changes Ayaka's requirement carries her build for it
    const options = result.rankings[shenhe]!.weapons
    const changed = options.find(
      (o) => o.weapon.key !== result.builds[shenhe]!.weapon.key
    )!
    expect(changed.team?.[ayaka]).toBeTruthy()
    // and its total is the team's with it, as a pick of it shows
    const picked = changed.weapon.key === 'FavoniusLance' ? favonius : other
    expect(changed.total).toBeCloseTo(picked.after.total, -1)
  }, 300_000)

  it('quick search keeps Favonius among the contenders (what it frees teammates shows only later), and picks as a full search does', async () => {
    const { database, teamId, teamOpt } = setup()
    const settings = defaultEnergyCalculator([ayaka, shenhe], 20)
    settings.members[ayaka]!.skillUses = 2
    settings.members[shenhe]!.skillUses = 2
    settings.members[shenhe]!.burstEvery = 0
    settings.members[shenhe]!.favoniusProcs = 2
    teamOpt.kqm!.energySource = 'calculator'
    teamOpt.kqm!.energyCalculator = settings
    teamOpt.kqm!.energyRecharge = calculateEnergyRecharge(
      [ayaka, shenhe],
      settings
    ).targets
    teamOpt.kqm!.excludedWeapons = []
    teamOpt.kqm!.weaponList = 2
    const full = (await run(database, teamId, {
      ...teamOpt,
      kqm: { ...teamOpt.kqm!, fullSearch: true },
    }))!
    const fast = (await run(database, teamId, teamOpt))!
    for (const ck of [ayaka, shenhe])
      expect(fast.builds[ck]!.weapon.key).toBe(full.builds[ck]!.weapon.key)
    expect(fast.after.total).toBeGreaterThanOrEqual(full.after.total * 0.99)
    expect(fast.screenedOut?.[shenhe]?.weapons.length).toBeGreaterThan(0)
    expect(fast.rankings[shenhe]!.weapons.map((o) => o.weapon.key)).toContain(
      'FavoniusLance'
    )
  }, 300_000)

  it('gives a page the calculation of a result’s builds (kqmTeamOverrides): the same team total', async () => {
    const { database, teamId, teamOpt } = setup()
    const result = (await run(database, teamId, teamOpt))!
    const overrides = kqmTeamOverrides(database, teamId, teamOpt, result)
    const again = evaluateTeamRotation(database, teamId, 'F', {
      ...overrides,
      arts: overrides.arts!,
      attacks: result.played?.attacks ?? teamOpt.attacks,
      onField: teamOpt.onField,
    })!
    expect(again.total).toBeCloseTo(result.after.total, 6)
    // at the KQM constellations and talents, whatever the members' own
    expect(overrides.characters?.[shenhe]?.constellation).toBe(
      result.constellations[shenhe]
    )
    expect(overrides.characters?.[ayaka]?.talent?.auto).toBe(
      kqmTalentLevel(teamOpt.kqm)
    )
  }, 300_000)

  it('counts 4★ sets by KQMS: 0.8 of the substats and 2 fewer rolls a 4★ piece, 4★ main stats, one 5★ off-piece', async () => {
    expect(kqmSets()).toEqual(
      expect.arrayContaining(['Instructor', 'TheExile'])
    )
    const mains = {
      sands: 'atk_',
      goblet: 'cryo_dmg_',
      circlet: 'critRate_',
    } as const
    const five = kqmValues({ sets: { NoblesseOblige: 4 }, mains, rolls: {} })
    // four 4★ pieces and a 5★ circlet (the default off-piece)
    const four = kqmValues({ sets: { Instructor: 4 }, mains, rolls: {} })
    {
      const rarity = kqmBuildRarity({ sets: { Instructor: 4 } })
      expect(rarity.four).toBe(4)
      expect(rarity.subScale).toBeCloseTo(0.84, 12)
      expect(rarity.rolls).toBe(12)
    }
    // substats: (1 + 0.8 x 4) / 5 of a 5★ roll
    expect(four['critDMG_']).toBeCloseTo(five['critDMG_'] * 0.84, 9)
    // main stats: 4★ +16 on the flower, plume, sands and goblet; the 5★ circlet as it is
    const main = (k: 'hp' | 'atk' | 'atk_' | 'cryo_dmg_', rarity: 4 | 5) =>
      getMainStatValue(k, rarity, rarity === 5 ? 20 : 16)
    const sub = (k: 'hp' | 'atk' | 'atk_', scale: number) =>
      2 * KQM_SUBSTAT_ROLLS[k] * scale
    expect(four['hp']).toBeCloseTo(main('hp', 4) + sub('hp', 0.84), 6)
    expect(four['atk']).toBeCloseTo(main('atk', 4) + sub('atk', 0.84), 6)
    expect(four['atk_']).toBeCloseTo(main('atk_', 4) + sub('atk_', 0.84), 9)
    expect(four['cryo_dmg_']).toBeCloseTo(main('cryo_dmg_', 4), 9)
    expect(
      four['critRate_'] - 2 * KQM_SUBSTAT_ROLLS.critRate_ * 0.84
    ).toBeCloseTo(getMainStatValue('critRate_', 5, 20), 9)
    // another off-piece: the 5★ sands, the circlet 4★
    const offSands = kqmValues({
      sets: { Instructor: 4 },
      mains: { ...mains, off: 'sands' },
      rolls: {},
    })
    expect(offSands['atk_']).toBeCloseTo(main('atk_', 5) + sub('atk_', 0.84), 9)
    // a 2-piece of a 4★ set: two 4★ pieces (the flower and plume)
    const two = kqmValues({
      sets: { TheExile: 2, NoblesseOblige: 2 },
      mains,
      rolls: {},
    })
    {
      const rarity = kqmBuildRarity({
        sets: { TheExile: 2, NoblesseOblige: 2 },
      })
      expect(rarity.four).toBe(2)
      expect(rarity.subScale).toBeCloseTo(0.92, 12)
      expect(rarity.rolls).toBe(16)
    }
    expect(two['atk_']).toBeCloseTo(main('atk_', 5) + sub('atk_', 0.92), 9)
    expect(two['hp']).toBeCloseTo(main('hp', 4) + sub('hp', 0.92), 6)

    // a run restricted to Instructor: 12 rolls placed, and an off-piece chosen
    const { database, teamId, teamOpt } = setup()
    teamOpt.kqm!.excludedSets = kqmSets().filter((k) => k !== 'Instructor')
    const result = (await run(database, teamId, teamOpt))!
    const build = result.builds[ayaka]!
    expect(build.sets).toEqual({ Instructor: 4 })
    expect(Object.values(build.rolls).reduce((a, n) => a + (n ?? 0), 0)).toBe(
      12
    )
    expect(['sands', 'goblet', 'circlet']).toContain(build.mains.off)
    expectKqms(result)
  }, 300_000)

  it('compares ER sands against ATK sands with ER substats before selecting a main stat', async () => {
    const { database, teamId, teamOpt } = setup()
    teamOpt.kqm!.excludedSets = kqmSets().filter((k) => k !== 'BlizzardStrayer')
    teamOpt.keep = [shenhe]
    teamOpt.kqm!.energyRecharge![ayaka] = 135
    teamOpt.kqm!.excludedWeapons = kqmWeapons(ayaka, undefined, { all: true })
      .map((w) => w.key)
      .filter((key) => key !== 'PrototypeRancour')
    teamOpt.kqm!.weaponList = 2
    const result = (await run(database, teamId, teamOpt))!
    // an ATK sands meeting 135% with ER substats beats an ER sands
    expect(result.energyRecharge[ayaka]!.value).toBeGreaterThanOrEqual(135)
    expect(result.builds[ayaka]!.mains.sands).toBe('atk_')
    expect(result.builds[ayaka]!.rolls.enerRech_).toBeGreaterThan(0)
  }, 300_000)

  it('keeps valid KQM settings and drops broken ones', () => {
    const kept = validateTeamOpt({
      ...initTeamOpt(),
      kqm: {
        energyRecharge: {
          [ayaka]: 180,
          [shenhe]: 99,
          Nobody: 200,
          Fischl: '200',
          Lisa: Number.POSITIVE_INFINITY,
        },
        refinement5: 2,
        refinement4: 9,
        excludedWeapons: ['WolfsGravestone', 'NotAWeapon'],
        excludedSets: [],
        weaponEnergy: { FavoniusLance: { Shenhe: 20, Nobody: 5 }, Bad: {} },
        passives: { [ayaka]: { BlizzardStrayer: { condition: '' } } },
      },
    })!.kqm!
    expect(kept.energyRecharge).toEqual({ [ayaka]: 180 })
    expect(kept.refinement5).toBe(2)
    expect(kept.refinement4).toBe(5)
    expect(kept.excludedWeapons).toEqual(['WolfsGravestone'])
    // no set left out: the same as none set
    expect(kept.excludedSets).toBeUndefined()
    expect(kept.weaponEnergy).toEqual({ FavoniusLance: { Shenhe: 20 } })
    expect(kept.passives).toEqual({
      [ayaka]: { BlizzardStrayer: { condition: '' } },
    })
    expect(validateTeamOpt({ ...initTeamOpt(), kqm: 'x' })!.kqm).toBeUndefined()
  })
})
