import { SandboxStorage } from '@genshin-optimizer/common/database'
import { allWeaponKeys } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import type { KqmBuild, KqmResult } from '../'
import {
  calculateEnergyRecharge,
  compareTeamKqm,
  defaultEnergyCalculator,
  estimateKqmCatchUp,
  KQM_SUBSTAT_ROLLS,
  kqmArtifactStats,
  kqmRollCaps,
  kqmSets,
  kqmSetsId,
  kqmValues,
  kqmWeapons,
  optimizeTeamKqm,
} from '../'

const build: KqmBuild = {
  weapon: { key: 'AmenomaKageuchi', refinement: 5 },
  sets: { BlizzardStrayer: 4 },
  mains: { sands: 'atk_', goblet: 'cryo_dmg_', circlet: 'critDMG_' },
  rolls: { critRate_: 8, critDMG_: 7, enerRech_: 5 },
}

describe('KQM artifact totals and catch-up estimates', () => {
  it('includes all ten substats, five mains, fixed rolls and distributed rolls without set bonuses', () => {
    const stats = kqmArtifactStats(build)
    const values = kqmValues(build)
    expect(stats).toHaveLength(11)
    expect(stats.some((s) => s.key === ('BlizzardStrayer' as string))).toBe(
      false
    )
    for (const stat of stats) {
      expect(Number.isFinite(stat.total)).toBe(true)
      expect(stat.total).toBeCloseTo(values[stat.key], 10)
      expect(stat.total).toBeCloseTo(
        stat.main + stat.fixed + stat.distributed,
        10
      )
    }
    expect(stats.find((s) => s.key === 'def')!.fixed).toBeCloseTo(39.36)
    expect(stats.find((s) => s.key === 'critRate_')!.total).toBeCloseTo(0.331)
    expect(stats.find((s) => s.key === 'enerRech_')!.total).toBeCloseTo(0.3857)
    expect(stats.find((s) => s.key === 'hp')!.main).toBeGreaterThan(4700)
  })

  it('solves a fractional final roll by evaluating the actual curve and leaves the build untouched', () => {
    const original = structuredClone(build)
    const evaluate = (v: Record<string, number>) => ({
      total: 1000 * (1 + v['atk_']) ** 2,
      valid: true,
    })
    const values = kqmValues(build)
    const target =
      1000 * (1 + values['atk_'] + 2.5 * KQM_SUBSTAT_ROLLS.atk_) ** 2
    const gap = estimateKqmCatchUp(build, target, evaluate)
    expect(gap.status).toBe('matched')
    expect(gap.count).toBeCloseTo(2.5, 5)
    expect(gap.rolls.atk_).toBeCloseTo(2.5, 5)
    expect(gap.total).toBeCloseTo(target, 3)
    expect(build).toEqual(original)
    expect(Object.values(build.rolls).reduce((a, n) => a + n!, 0)).toBe(20)
  })

  it('respects stat caps and does not claim a match when useful stats saturate', () => {
    const cappedBuild = {
      ...build,
      rolls: { critRate_: kqmRollCaps(build.mains).critRate_ },
    }
    const evaluate = (v: Record<string, number>) => ({
      total: v['critRate_'] * 1000,
      valid: true,
    })
    const gap = estimateKqmCatchUp(
      cappedBuild,
      evaluate(kqmValues(cappedBuild)).total + 100,
      evaluate
    )
    expect(gap.status).toBe('limit')
    expect(gap.count).toBe(0)
  })

  it('reports ties with zero rolls and excludes additions that break a constraint', () => {
    const evaluate = (v: Record<string, number>) => ({
      total: v['atk_'] * 1000,
      valid: v['atk_'] <= kqmValues(build)['atk_'] + 1e-10,
    })
    const base = evaluate(kqmValues(build)).total
    expect(estimateKqmCatchUp(build, base, evaluate).status).toBe('tied')
    expect(estimateKqmCatchUp(build, base + 1, evaluate).status).toBe('limit')
  })
})

function setup() {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const [key, weapon] of [
    ['KamisatoAyaka', 'AmenomaKageuchi'],
    ['Shenhe', 'CalamityQueller'],
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
  const ayakaId = database.teamChars.new('KamisatoAyaka')
  const shenheId = database.teamChars.new('Shenhe')
  const teamId = database.teams.new({
    loadoutData: [
      { teamCharId: ayakaId },
      { teamCharId: shenheId },
    ] as LoadoutDatum[],
  })
  const teamOpt = initTeamOpt()
  teamOpt.keep = ['Shenhe']
  teamOpt.kqm = {
    refinement4: 5,
    refinement5: 1,
    energyRecharge: { KamisatoAyaka: 135, Shenhe: 100 },
    excludedWeapons: kqmWeapons('KamisatoAyaka', undefined, { all: true })
      .map((w) => w.key)
      .filter(
        (key) =>
          !['AmenomaKageuchi', 'TheBlackSword', 'FinaleOfTheDeep'].includes(key)
      ),
    weaponList: 2,
  }
  teamOpt.attacks = {
    KamisatoAyaka: [
      { path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' },
      { path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' },
    ],
  }
  // (KQM's own sets only: Blizzard Strayer, Gladiator's Finale, Noblesse Oblige)
  teamOpt.kqm.excludedSets = kqmSets().filter(
    (key) =>
      !['BlizzardStrayer', 'GladiatorsFinale', 'NoblesseOblige'].includes(key)
  )
  return { database, teamId, teamOpt }
}

describe('linked KQM comparisons', () => {
  it('re-optimizes each side for the selected equipment, preserves teammates and measures every rank against the best', async () => {
    const args = { ...setup(), gender: 'F' as const }
    args.teamOpt.keep = []
    args.teamOpt.kqm!.excludedWeapons = allWeaponKeys.filter(
      (key) =>
        ![
          'AmenomaKageuchi',
          'TheBlackSword',
          'FinaleOfTheDeep',
          'FavoniusLance',
        ].includes(key)
    )
    const result = (await optimizeTeamKqm({ ...args, maxRounds: 1 }))!
    const baseline = structuredClone(result)
    expect(result.builds.Shenhe).toBeTruthy()
    const compare = (
      sets: KqmBuild['sets'],
      weapon = { key: 'AmenomaKageuchi', refinement: 5 } as KqmBuild['weapon']
    ) =>
      compareTeamKqm({
        ...args,
        result,
        characterKey: 'KamisatoAyaka',
        sets,
        weapon,
      }) as Promise<KqmResult>
    const cryo = await compare({ BlizzardStrayer: 4 })
    const atk = await compare({ GladiatorsFinale: 4 })
    expect(cryo.builds.KamisatoAyaka!.sets).toEqual({ BlizzardStrayer: 4 })
    expect(atk.builds.KamisatoAyaka!.sets).toEqual({ GladiatorsFinale: 4 })
    for (const option of cryo.rankings.KamisatoAyaka!.weapons)
      expect(option.sets).toEqual({ BlizzardStrayer: 4 })
    for (const option of atk.rankings.KamisatoAyaka!.weapons)
      expect(option.sets).toEqual({ GladiatorsFinale: 4 })
    expect(
      cryo.rankings.KamisatoAyaka!.weapons.map((o) => o.total)
    ).not.toEqual(atk.rankings.KamisatoAyaka!.weapons.map((o) => o.total))
    const crit = await compare(
      { BlizzardStrayer: 4 },
      { key: 'TheBlackSword', refinement: 1 }
    )
    for (const option of crit.rankings.KamisatoAyaka!.sets)
      expect(option.weapon).toEqual({ key: 'TheBlackSword', refinement: 1 })
    expect(crit.rankings.KamisatoAyaka!.sets.map((o) => o.total)).not.toEqual(
      cryo.rankings.KamisatoAyaka!.sets.map((o) => o.total)
    )
    for (const compared of [cryo, atk, crit]) {
      expect(compared.builds.Shenhe).toEqual(result.builds.Shenhe)
      expect(compared.constellations).toEqual(result.constellations)
      expect(
        compared.energyRecharge.KamisatoAyaka!.value
      ).toBeGreaterThanOrEqual(135)
      expect(
        Object.values(compared.builds.KamisatoAyaka!.rolls).reduce(
          (a, n) => a + n!,
          0
        )
      ).toBe(20)
      // every option measured against the ranking's best
      for (const options of Object.values(compared.rankings.KamisatoAyaka!)) {
        expect(options[0].behind).toBeUndefined()
        for (let i = 1; i < options.length; i++)
          if (!options[i].unmet && !options[0].unmet) {
            expect(options[i].behind!.target).toBe(options[0].total)
            if (options[i].behind!.status === 'matched')
              expect(options[i].behind!.total).toBeGreaterThanOrEqual(
                options[0].total * (1 - 1e-8)
              )
          }
      }
    }
    expect(result).toEqual(baseline)
    expect(kqmSetsId(cryo.builds.KamisatoAyaka!.sets)).not.toBe(
      kqmSetsId(atk.builds.KamisatoAyaka!.sets)
    )
    await expect(
      compareTeamKqm({
        ...args,
        result,
        characterKey: 'KamisatoAyaka',
        sets: { BlizzardStrayer: 4 },
        weapon: { key: 'MistsplitterReforged', refinement: 1 },
      })
    ).rejects.toThrow('not allowed')
    await expect(compare({ EmblemOfSeveredFate: 4 })).rejects.toThrow(
      'not allowed'
    )
  }, 120_000)

  it('shows the pick’s team first, then the same team ranked, as without the run’s work', async () => {
    const args = { ...setup(), gender: 'F' as const }
    args.teamOpt.keep = []
    args.teamOpt.kqm!.excludedWeapons = allWeaponKeys.filter(
      (key) =>
        !['AmenomaKageuchi', 'TheBlackSword', 'FavoniusLance'].includes(key)
    )
    const result = (await optimizeTeamKqm({ ...args, maxRounds: 1 }))!
    const pick = {
      characterKey: 'KamisatoAyaka' as const,
      sets: { GladiatorsFinale: 4 } as KqmBuild['sets'],
      weapon: { key: 'TheBlackSword', refinement: 1 } as KqmBuild['weapon'],
    }
    const order: string[] = []
    let preview: KqmResult | undefined
    // (with the run's problems and searches)
    const compared = (await compareTeamKqm({
      ...args,
      result,
      ...pick,
      onPreview: (p) => {
        order.push('preview')
        preview = p
      },
    }).then((r) => {
      order.push('result')
      return r
    }))!
    expect(order).toEqual(['preview', 'result'])
    expect(preview!.rankings).toEqual({})
    expect(preview!.builds).toEqual(compared.builds)
    expect(preview!.after).toEqual(compared.after)
    expect(preview!.energyRecharge).toEqual(compared.energyRecharge)
    expect(compared.rankings.KamisatoAyaka!.weapons.length).toBeGreaterThan(1)
    // a pick on a team picked before (the preview) takes the same work
    const again = (await compareTeamKqm({
      ...args,
      result: preview!,
      ...pick,
    }))!
    expect(again.after.total).toBeCloseTo(compared.after.total, 6)
    // (a copy of the run is another run: none of its work)
    const fresh = (await compareTeamKqm({
      ...args,
      result: structuredClone(result),
      ...pick,
    }))!
    expect(fresh).toEqual(compared)
  }, 120_000)

  it('allows weapon comparisons without a set bonus when sets are explicitly excluded', async () => {
    const args = { ...setup(), gender: 'F' as const }
    args.teamOpt.kqm!.excludedSets = kqmSets()
    const result = (await optimizeTeamKqm({ ...args, maxRounds: 1 }))!
    const compared = (await compareTeamKqm({
      ...args,
      result,
      characterKey: 'KamisatoAyaka',
      sets: {},
      weapon: { key: 'TheBlackSword', refinement: 1 },
    }))!
    expect(compared.builds.KamisatoAyaka!.sets).toEqual({})
    expect(
      compared.rankings.KamisatoAyaka!.weapons.every(
        (o) => !Object.keys(o.sets).length
      )
    ).toBe(true)
    expect(
      Object.values(compared.builds.KamisatoAyaka!.rolls).reduce(
        (a, n) => a + n!,
        0
      )
    ).toBe(20)
  }, 120_000)

  it('recalculates calculator ER for the selected weapon', async () => {
    const args = { ...setup(), gender: 'F' as const }
    const calculator = defaultEnergyCalculator(['KamisatoAyaka', 'Shenhe'], 20)
    calculator.members.KamisatoAyaka!.skillUses = 3
    calculator.members.KamisatoAyaka!.weaponEnergyTriggers = 2
    calculator.members.Shenhe!.burstEvery = 0
    args.teamOpt.kqm!.energySource = 'calculator'
    args.teamOpt.kqm!.energyCalculator = calculator
    args.teamOpt.kqm!.energyRecharge = calculateEnergyRecharge(
      ['KamisatoAyaka', 'Shenhe'],
      calculator
    ).targets
    const result = (await optimizeTeamKqm({ ...args, maxRounds: 1 }))!
    const selected = (await compareTeamKqm({
      ...args,
      result,
      characterKey: 'KamisatoAyaka',
      sets: { BlizzardStrayer: 4 },
      weapon: { key: 'AmenomaKageuchi', refinement: 5 },
    }))!
    const expected = calculateEnergyRecharge(
      ['KamisatoAyaka', 'Shenhe'],
      calculator,
      { KamisatoAyaka: 'AmenomaKageuchi', Shenhe: 'CalamityQueller' },
      { KamisatoAyaka: 5, Shenhe: 1 }
    ).targets.KamisatoAyaka!
    expect(selected.energyRecharge.KamisatoAyaka!.minimum).toBeCloseTo(
      expected,
      6
    )
  }, 120_000)
})
