import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  defaultEnergyCalculator,
  optimizeTeamKqm,
  playedAttackStates,
  runInvestmentJob,
  teamOptMembers,
  withRotationEnergy,
  writtenKqmReplay,
} from '../'

function buildTeamDb(
  membersSpec: readonly [CharacterKey, WeaponKey][],
  rotationText: string,
  names: { characterKey: CharacterKey; name: string }[],
  kqmOverrides?: Partial<NonNullable<TeamOpt['kqm']>>
) {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  const loadoutData: LoadoutDatum[] = []
  for (const [key, weapon] of membersSpec) {
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 10, skill: 10, burst: 10 },
      constellation: 0,
    })
    database.weapons.new({
      key: weapon,
      level: 90,
      ascension: 6,
      refinement: 5,
      location: key,
      lock: false,
    })
    const tcId = database.teamChars.new(key)
    loadoutData.push({ teamCharId: tcId } as LoadoutDatum)
  }
  const teamId = database.teams.new({
    name: 'ER Investment Test Team',
    loadoutData,
  })
  const keys = membersSpec.map(([k]) => k)
  const members = teamOptMembers(database, teamId)
  const rotation = {
    names,
    text: rotationText,
    opener: '',
    timing: { edits: {} },
    frameData: {},
  }
  const baseCalc = defaultEnergyCalculator(
    keys,
    20,
    keys[0],
    Object.fromEntries(keys.map((k) => [k, 0]))
  )
  const teamOpt: TeamOpt = {
    ...initTeamOpt(),
    kqm: {
      refinement5: 1,
      refinement4: 5,
      talents: 10,
      constellations: Object.fromEntries(keys.map((k) => [k, 0])),
      energySource: 'calculator',
      energyCalculator: baseCalc,
      ...kqmOverrides,
    },
  }
  const replay = writtenKqmReplay({
    database,
    teamId,
    members,
    gender: 'F',
    names,
    teamOpt,
    text: rotationText,
    opener: '',
    timing: { edits: {} },
    frameData: {},
  })!
  // Pre-fill calculator from baseline rotation just like the UI does before running KQM
  const initPlayed = replay({
    constellations: teamOpt.kqm!.constellations!,
    gear: {},
    overrides: {},
  })
  teamOpt.kqm!.energyCalculator = {
    ...withRotationEnergy(baseCalc, keys, initPlayed.energy),
    rotationTime: initPlayed.rotationTime ?? 20,
  }
  return { database, teamId, teamOpt, members, rotation, replay }
}

const erScoreOf = (b: {
  mains: { sands: string }
  rolls: Partial<Record<string, number>>
}) => (b.mains.sands === 'enerRech_' ? 10 : 0) + (b.rolls.enerRech_ ?? 0)

describe('Investment comparison ER accuracy (R1 & constellations)', () => {
  it('applies Furina C4 flat energy in KQM ER calculator and refits her artifacts for higher DPS', async () => {
    // Non-ER weapon (Harbinger of Dawn) forces Furina to invest ER sands/rolls at C3 (~162% ER);
    // C4 grants 4 flat energy / 5s (no direct damage multiplier!) -> drops ER need & raises DPS!
    const { database, teamId, teamOpt, rotation, replay } = buildTeamDb(
      [
        ['Furina', 'HarbingerOfDawn'],
        ['KaedeharaKazuha', 'IronSting'],
        ['Bennett', 'SapwoodBlade'],
      ],
      'Furina E Q -> Bennett E Q -> Kazuha tE P Q -> Bennett E N2',
      [
        { characterKey: 'Furina', name: 'Furina' },
        { characterKey: 'KaedeharaKazuha', name: 'Kazuha' },
        { characterKey: 'Bennett', name: 'Bennett' },
      ],
      {
        constellations: { Furina: 0, KaedeharaKazuha: 0, Bennett: 6 },
        lockedWeapons: {
          Furina: 'HarbingerOfDawn',
          KaedeharaKazuha: 'IronSting',
          Bennett: 'SapwoodBlade',
        },
      }
    )

    const base = await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      replay,
      skipRankings: true,
      maxRounds: 1,
      inline: true,
    })
    expect(base).toBeTruthy()
    const baseEr = Object.fromEntries(
      Object.entries(base!.energyRecharge).flatMap(([ck, er]) =>
        er ? [[ck, er.minimum]] : []
      )
    )

    // Compare C3 vs C4: Furina C4 ONLY adds flat Energy (no direct damage multiplier!),
    // so C4 > C3 strictly proves the ER calculator received Furina C4's flat energy and refitted her build.
    const c3 = await runInvestmentJob(database, {
      mode: 'kqm',
      teamId,
      gender: 'F',
      setup: teamOpt,
      from: base!.builds,
      played: base!.played,
      attackStates: playedAttackStates(base!.played),
      cons: { Furina: 3 },
      rotation,
      baseEr,
      summaryOnly: true,
    })
    const c4 = await runInvestmentJob(database, {
      mode: 'kqm',
      teamId,
      gender: 'F',
      setup: teamOpt,
      from: base!.builds,
      played: base!.played,
      attackStates: playedAttackStates(base!.played),
      cons: { Furina: 4 },
      rotation,
      baseEr,
      summaryOnly: true,
    })
    expect(c3).toBeTruthy()
    expect(c4).toBeTruthy()
    expect(c4!.team).toBeGreaterThan(c3!.team * 1.03)
    expect(erScoreOf(c4!.builds.Furina!)).toBeLessThan(
      erScoreOf(c3!.builds.Furina!)
    )
  }, 60_000)

  it('refits teammates when dropping Favonius for R1 raises their ER requirements', async () => {
    // Double Hydro + Kazuha (20s rotation): Xingqiu holds Favonius Sword so both Yelan and Kazuha
    // have reachable ER after Yelan drops Favonius Warbow for R1 Aqua Simulacra; Kazuha's ER jumps
    // -> Kazuha is automatically refitted to cover the lost Favonius particles and stays feasible!
    const { database, teamId, teamOpt, rotation, replay } = buildTeamDb(
      [
        ['Yelan', 'FavoniusWarbow'],
        ['Xingqiu', 'FavoniusSword'],
        ['KaedeharaKazuha', 'SapwoodBlade'],
      ],
      'Xingqiu E Q -> Yelan E Q -> Kazuha tE P Q -> Yelan N4 -> Kazuha tE P -> Yelan N4',
      [
        { characterKey: 'Yelan', name: 'Yelan' },
        { characterKey: 'Xingqiu', name: 'Xingqiu' },
        { characterKey: 'KaedeharaKazuha', name: 'Kazuha' },
      ],
      {
        constellations: { Yelan: 0, Xingqiu: 6, KaedeharaKazuha: 0 },
        lockedWeapons: {
          Yelan: 'FavoniusWarbow',
          Xingqiu: 'FavoniusSword',
          KaedeharaKazuha: 'SapwoodBlade',
        },
      }
    )

    const base = await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      replay,
      skipRankings: true,
      maxRounds: 1,
      inline: true,
    })
    expect(base).toBeTruthy()
    const baseEr = Object.fromEntries(
      Object.entries(base!.energyRecharge).flatMap(([ck, er]) =>
        er ? [[ck, er.minimum]] : []
      )
    )
    const baseKazuhaBuild = base!.builds.KaedeharaKazuha!

    // Upgrade Yelan from Favonius Warbow -> R1 Aqua Simulacra
    const yelanR1 = await runInvestmentJob(database, {
      mode: 'kqm',
      teamId,
      gender: 'F',
      setup: teamOpt,
      from: base!.builds,
      played: base!.played,
      attackStates: playedAttackStates(base!.played),
      cons: {},
      signatures: { Yelan: 1 },
      rotation,
      baseEr,
      summaryOnly: true,
    })
    expect(yelanR1).toBeTruthy()
    // Kazuha's build was automatically refitted to cover the lost Favonius particles
    expect(erScoreOf(yelanR1!.builds.KaedeharaKazuha!)).toBeGreaterThan(
      erScoreOf(baseKazuhaBuild)
    )
    // And with teammates refitted, the whole team meets its ER target (not left unmet)!
    expect(yelanR1!.unmet).toBe(false)
  }, 60_000)

  it('refits Electro teammates when Xilonen C2 restores 25 flat Electro Energy', async () => {
    // Yae Miko + Fischl + Bennett + Xilonen (2+ PHEC teammates puts Xilonen in sampler mode):
    // Yae sits at ~155% ER at Xilonen C0; Xilonen C2 grants +25 flat Energy to Electro teammates
    // -> Yae's ER drops and her non-raised KQM build is automatically refitted into ATK/Crit!
    const { database, teamId, teamOpt, rotation, replay } = buildTeamDb(
      [
        ['YaeMiko', 'TheWidsith'],
        ['Fischl', 'TheStringless'],
        ['Bennett', 'SapwoodBlade'],
        ['Xilonen', 'FluteOfEzpitzal'],
      ],
      'YaeMiko E E E -> Fischl E -> Xilonen E N2 -> Bennett E Q -> YaeMiko Q E E E N3 N3',
      [
        { characterKey: 'YaeMiko', name: 'YaeMiko' },
        { characterKey: 'Fischl', name: 'Fischl' },
        { characterKey: 'Bennett', name: 'Bennett' },
        { characterKey: 'Xilonen', name: 'Xilonen' },
      ],
      {
        constellations: { YaeMiko: 0, Fischl: 6, Bennett: 6, Xilonen: 0 },
        lockedWeapons: {
          YaeMiko: 'TheWidsith',
          Fischl: 'TheStringless',
          Bennett: 'SapwoodBlade',
          Xilonen: 'FluteOfEzpitzal',
        },
      }
    )

    const base = await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      replay,
      skipRankings: true,
      maxRounds: 1,
      inline: true,
    })
    expect(base).toBeTruthy()
    const baseEr = Object.fromEntries(
      Object.entries(base!.energyRecharge).flatMap(([ck, er]) =>
        er ? [[ck, er.minimum]] : []
      )
    )
    const baseYaeEr = erScoreOf(base!.builds.YaeMiko!)

    const xiloC2 = await runInvestmentJob(database, {
      mode: 'kqm',
      teamId,
      gender: 'F',
      setup: teamOpt,
      from: base!.builds,
      played: base!.played,
      attackStates: playedAttackStates(base!.played),
      cons: { Xilonen: 2 },
      rotation,
      baseEr,
      summaryOnly: true,
    })
    expect(xiloC2).toBeTruthy()
    // Non-raised Yae Miko was automatically refitted to drop ER rolls/sands!
    expect(erScoreOf(xiloC2!.builds.YaeMiko!)).toBeLessThan(baseYaeEr)
    expect(xiloC2!.team).toBeGreaterThan(base!.after.total)
  }, 60_000)

  it('refits builds when a conditional alt rotation adds extra Skill casts (Yelan C1 E E Q)', async () => {
    const { database, teamId, teamOpt, rotation, replay } = buildTeamDb(
      [
        ['Yelan', 'Slingshot'],
        ['Xingqiu', 'SacrificialSword'],
        ['KaedeharaKazuha', 'IronSting'],
      ],
      'Xingqiu E Q -> Yelan E Q -> Kazuha tE P Q -> Yelan N4 -> Kazuha tE P -> Yelan N4',
      [
        { characterKey: 'Yelan', name: 'Yelan' },
        { characterKey: 'Xingqiu', name: 'Xingqiu' },
        { characterKey: 'KaedeharaKazuha', name: 'Kazuha' },
      ],
      {
        constellations: { Yelan: 0, Xingqiu: 6, KaedeharaKazuha: 0 },
        lockedWeapons: {
          Yelan: 'Slingshot',
          Xingqiu: 'SacrificialSword',
          KaedeharaKazuha: 'IronSting',
        },
      }
    )

    const base = await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      replay,
      skipRankings: true,
      maxRounds: 1,
      inline: true,
    })
    expect(base).toBeTruthy()
    const baseEr = Object.fromEntries(
      Object.entries(base!.energyRecharge).flatMap(([ck, er]) =>
        er ? [[ck, er.minimum]] : []
      )
    )

    const c1Alt = await runInvestmentJob(database, {
      mode: 'kqm',
      teamId,
      gender: 'F',
      setup: teamOpt,
      from: base!.builds,
      played: base!.played,
      attackStates: playedAttackStates(base!.played),
      cons: { Yelan: 1 },
      rotation,
      text: 'Xingqiu E Q -> Yelan E Q -> Kazuha tE P Q -> Yelan E N4 -> Kazuha tE P -> Yelan N4',
      baseEr,
      summaryOnly: true,
    })
    expect(c1Alt).toBeTruthy()
    expect(erScoreOf(c1Alt!.builds.Yelan!)).toBeLessThan(
      erScoreOf(base!.builds.Yelan!)
    )
    expect(c1Alt!.team).toBeGreaterThan(base!.after.total)
  }, 60_000)

  it('flags ER unmet in Inventory mode when swapping off an ER weapon drops below ER filter', async () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    database.chars.set('Furina', {
      key: 'Furina',
      level: 90,
      ascension: 6,
      talent: { auto: 10, skill: 10, burst: 10 },
      constellation: 0,
    })
    const favId = database.weapons.new({
      key: 'FavoniusSword',
      level: 90,
      ascension: 6,
      refinement: 5,
      location: 'Furina',
      lock: false,
    })
    const tcId = database.teamChars.new('Furina')
    const teamChar = database.teamChars.get(tcId)!
    // Require 150% ER (Favonius Sword gives 61.3% -> 161.3% meets; R1 Splendor gives 0% -> 100% unmet!)
    database.optConfigs.set(teamChar.optConfigId, {
      statFilters: {
        [JSON.stringify(['basic', 'enerRech_'])]: [
          { value: 150, disabled: false },
        ],
      },
    })
    const teamId = database.teams.new({
      name: 'Inv ER Test',
      loadoutData: [{ teamCharId: tcId } as LoadoutDatum],
    })
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: {
        Furina: [
          { path: ['skill', 'crabalettaDmg'], hits: 4, hitMode: 'avgHit' },
        ],
      },
    }

    const baseInv = await runInvestmentJob(database, {
      mode: 'inventory',
      teamId,
      gender: 'F',
      teamOpt,
      result: { builds: {}, weapons: { Furina: favId } },
      cons: {},
    })
    const sigInv = await runInvestmentJob(database, {
      mode: 'inventory',
      teamId,
      gender: 'F',
      teamOpt,
      result: { builds: {}, weapons: { Furina: favId } },
      cons: {},
      signatures: { Furina: 1 },
    })
    expect(baseInv).toBeTruthy()
    expect(sigInv).toBeTruthy()
    expect(baseInv!.unmet).toBe(false)
    expect(sigInv!.unmet).toBe(true)
  })
})
