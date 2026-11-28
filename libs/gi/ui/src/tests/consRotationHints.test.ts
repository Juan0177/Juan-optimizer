import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  constellationHintOf,
  constellationRotationHints,
  defaultEnergyCalculator,
  isAutoAdaptableHint,
  mergeMemberRotations,
  optimizeTeamKqm,
  playedAttackStates,
  runInvestmentJob,
  stepDiffSummary,
  suggestConstellationRotations,
  teamOptMembers,
  withRotationEnergy,
  writtenKqmReplay,
} from '../'

function buildKqmDb(
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
    name: 'Cons Rotation Hint Test',
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

describe('constellation rotation hints & auto-adaptation', () => {
  it('detects deterministic and combo rotation-changing constellations from kit models and curated metadata', () => {
    const vesnaC1 = constellationHintOf('Vesna', 1)
    expect(vesnaC1?.kind).toBe('extraSkill')
    expect(isAutoAdaptableHint(vesnaC1!)).toBe(true)

    const vesnaC6 = constellationHintOf('Vesna', 6)
    expect(vesnaC6?.kind).toBe('combo')
    expect(isAutoAdaptableHint(vesnaC6!)).toBe(false)

    // Auto-detected from kit.charges()
    expect(constellationHintOf('Yelan', 1)?.kind).toBe('extraSkill')
    expect(constellationHintOf('Xiao', 1)?.kind).toBe('extraSkill')
    expect(constellationHintOf('Xianyun', 1)?.kind).toBe('extraSkill')

    // Auto-detected from actionVariants() CA[beams=N]
    const sandroneC1 = constellationHintOf('Sandrone', 1)
    expect(sandroneC1?.kind).toBe('chargeBeams')
    expect(sandroneC1?.beams).toBe(6)
    expect(isAutoAdaptableHint(sandroneC1!)).toBe(true)

    // Curated burst reset & complex combo cons
    expect(constellationHintOf('KaedeharaKazuha', 1)?.kind).toBe(
      'burstResetSkill'
    )
    expect(constellationHintOf('Flins', 1)?.kind).toBe('combo')
    expect(constellationHintOf('Wriothesley', 1)?.kind).toBe('combo')

    // Respects baseCons..maxCons range
    expect(
      constellationRotationHints('Vesna', 0, 3).map((h) => h.cons)
    ).toEqual([1])
    expect(
      constellationRotationHints('Vesna', 1, 6).map((h) => h.cons)
    ).toEqual([6])
  })

  it('generates and simulator-verifies deterministic suggestions for Vesna C1, Yelan C1, Kazuha C1, and Sandrone C1', () => {
    const vesnaNames = [
      { characterKey: 'Vesna' as CharacterKey, name: 'Vesna' },
      { characterKey: 'Bennett' as CharacterKey, name: 'Bennett' },
    ]
    const vesnaBase = 'Bennett E Q -> Vesna E E E Q E N6 E N6 E'
    const vesnaSuggs = suggestConstellationRotations(
      vesnaBase,
      vesnaNames,
      'Vesna',
      1,
      {
        members: ['Vesna', 'Bennett'],
        constellations: { Vesna: 0, Bennett: 6 },
      }
    )
    expect(vesnaSuggs.length).toBeGreaterThan(0)
    expect(vesnaSuggs.some((s) => s.text.includes('Q E E'))).toBe(true)
    expect(vesnaSuggs[0].extraHits).toBeGreaterThan(0)
    expect(vesnaSuggs[0].diff).toContain('Vesna:')

    const yelanNames = [
      { characterKey: 'Yelan' as CharacterKey, name: 'Yelan' },
      { characterKey: 'Furina' as CharacterKey, name: 'Furina' },
    ]
    const yelanSuggs = suggestConstellationRotations(
      'Furina E Q -> Yelan E Q',
      yelanNames,
      'Yelan',
      1,
      {
        members: ['Yelan', 'Furina'],
        constellations: { Yelan: 0, Furina: 0 },
      }
    )
    expect(yelanSuggs.length).toBeGreaterThan(0)
    expect(
      yelanSuggs.some(
        (s) => s.text.includes('Yelan E E Q') || s.text.includes('Yelan E Q E')
      )
    ).toBe(true)

    const kazuhaNames = [
      { characterKey: 'KaedeharaKazuha' as CharacterKey, name: 'Kazuha' },
      { characterKey: 'Bennett' as CharacterKey, name: 'Bennett' },
    ]
    const kazuhaSuggs = suggestConstellationRotations(
      'Bennett E Q -> Kazuha tE P Q',
      kazuhaNames,
      'KaedeharaKazuha',
      1,
      {
        members: ['KaedeharaKazuha', 'Bennett'],
        constellations: { KaedeharaKazuha: 0, Bennett: 6 },
      }
    )
    expect(kazuhaSuggs.length).toBeGreaterThan(0)
    expect(kazuhaSuggs[0].text).toContain('Q tE')

    const sandroneNames = [
      { characterKey: 'Sandrone' as CharacterKey, name: 'Sandrone' },
    ]
    const sandroneSuggs = suggestConstellationRotations(
      'Sandrone E Q CA',
      sandroneNames,
      'Sandrone',
      1
    )
    expect(sandroneSuggs.length).toBeGreaterThan(0)
    expect(sandroneSuggs[0].text).toBe('Sandrone E Q CA[beams=6]')
  })

  it('composes independent single-member rotations cleanly on multi-member investment paths', () => {
    const names = [
      { characterKey: 'Yelan' as CharacterKey, name: 'Yelan' },
      { characterKey: 'Vesna' as CharacterKey, name: 'Vesna' },
    ]
    const base = 'Yelan E Q -> Vesna E E E Q E N6 E N6 E'
    const merged = mergeMemberRotations(
      base,
      [
        {
          characterKey: 'Yelan',
          text: 'Yelan E E Q -> Vesna E E E Q E N6 E N6 E',
          label: 'Auto Yelan C1 rot',
          isAuto: true,
        },
        {
          characterKey: 'Vesna',
          text: 'Yelan E Q -> Vesna E E E Q E E N6 E N6 E',
          label: 'Auto Vesna C1 rot',
          isAuto: true,
        },
      ],
      names
    )
    expect(merged?.text).toBe('Yelan E E Q -> Vesna E E E Q E E N6 E N6 E')
    expect(merged?.label).toBe('Auto Yelan C1 + Vesna C1 rot')
    expect(merged?.isAuto).toBe(true)

    expect(stepDiffSummary(base, merged!.text, names, 'Vesna')).toBe(
      'Vesna: E E E Q E N6 E N6 E → E E E Q E E N6 E N6 E'
    )
  })

  it('auto-adapts Vesna C1 in KQM investment evaluation and beats the C0-rotation C1 DPS', async () => {
    const names = [
      { characterKey: 'Vesna' as CharacterKey, name: 'Vesna' },
      { characterKey: 'Bennett' as CharacterKey, name: 'Bennett' },
    ]
    const baseRot = 'Bennett E Q -> Vesna E E E Q E N6 E N6 E'
    const { database, teamId, teamOpt, rotation, replay } = buildKqmDb(
      [
        ['Vesna', 'FavoniusSword'],
        ['Bennett', 'SapwoodBlade'],
      ],
      baseRot,
      names,
      {
        constellations: { Vesna: 0, Bennett: 6 },
      }
    )

    const baseResult = await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      replay,
    })
    expect(baseResult).toBeTruthy()
    const baseEr = Object.fromEntries(
      Object.entries(baseResult!.energyRecharge).flatMap(([ck, er]) =>
        er ? [[ck, er.minimum]] : []
      )
    )

    const suggs = suggestConstellationRotations(baseRot, names, 'Vesna', 1, {
      members: ['Vesna', 'Bennett'],
      constellations: { Vesna: 0, Bennett: 6 },
    })
    expect(suggs.length).toBeGreaterThan(0)

    // Evaluate Vesna C1 with C0 rotation (no autoCandidates)
    const c1Fixed = await runInvestmentJob(database, {
      mode: 'kqm',
      teamId,
      gender: 'F',
      setup: teamOpt,
      from: baseResult!.builds,
      played: baseResult!.played,
      attackStates: playedAttackStates(baseResult!.played),
      cons: { Vesna: 1 },
      rotation,
      baseEr,
      summaryOnly: true,
    })
    // Evaluate Vesna C1 with autoCandidates enabled
    const c1Auto = await runInvestmentJob(database, {
      mode: 'kqm',
      teamId,
      gender: 'F',
      setup: teamOpt,
      from: baseResult!.builds,
      played: baseResult!.played,
      attackStates: playedAttackStates(baseResult!.played),
      cons: { Vesna: 1 },
      rotation,
      autoCandidates: suggs.map((s) => s.text),
      baseEr,
      summaryOnly: true,
    })

    expect(c1Fixed).toBeTruthy()
    expect(c1Auto).toBeTruthy()
    const fixedDps = c1Fixed!.team / (c1Fixed!.seconds || 1)
    const autoDps = c1Auto!.team / (c1Auto!.seconds || 1)
    expect(c1Auto!.autoRotation).toBeTruthy()
    expect(c1Auto!.autoRotation).toContain('Q E E')
    // Extra 4th Lv. 3 Windborne Blade delivers a large real DPS gain over C0-rotation C1!
    expect(autoDps).toBeGreaterThan(fixedDps * 1.1)
  }, 60_000)
})
