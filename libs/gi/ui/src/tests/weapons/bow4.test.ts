/**
 * Weapon audit batch bow4 (rotation/weapons/bow4): rotation timing, stack, and proc behavior
 * for ElegyForTheEnd, Silverdawn, BreezeborneRefrain, CovenantOfFrostAndSnow,
 * FlowerWreathedFeathers, KingsSquire, SnareHook, and WindblumeOde, plus the sheet fixes on
 * KingsSquire (Physical proc element) and SnareHook (afterReaction conditional gating).
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation, getTeamDataWith } from '../../'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  type SimulationResult,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type {
  HitElement,
  HitTag,
  KitModel,
  SimGear,
  SimHit,
} from '../../util/teamOpt/rotation/types'

type HitSpec = {
  at: number
  path?: string[]
  tag?: HitTag
  element?: HitElement
  label?: string
}

function makeKit(
  characterKey: CharacterKey,
  element: HitElement,
  script: Partial<Record<string, { hits: HitSpec[]; frames: number }>>
): KitModel {
  return {
    characterKey,
    element,
    source: 'test',
    act(ctx, _state, action) {
      const s = script[action.kind] ?? { hits: [], frames: 30 }
      for (const h of s.hits)
        ctx.hit(h.at, {
          path: h.path ?? [action.kind, '0'],
          tag: h.tag ?? (action.kind === 'normal' ? 'normal' : action.kind),
          element: h.element ?? element,
          label: h.label ?? action.text,
        } as Omit<SimHit, 't' | 'characterKey' | 'onField'>)
      return { frames: s.frames }
    },
  }
}

const ELEMENTS: Partial<Record<CharacterKey, HitElement>> = {
  Fischl: 'electro',
  Bennett: 'pyro',
}

function play(
  text: string,
  kits: Partial<Record<CharacterKey, KitModel>>,
  gear: Partial<Record<CharacterKey, SimGear>>,
  repeats = 1
) {
  const members = Object.keys(kits) as CharacterKey[]
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: Object.fromEntries(
      members.map((m) => [m, ELEMENTS[m] ?? 'electro'])
    ),
    repeats,
    keep: 'all',
    kits,
    reactions: { onHit() {} },
    gear,
  })
}

const windowsOf = (
  sim: SimulationResult,
  path: string,
  owner: CharacterKey = 'Fischl'
) =>
  sim.buffWindows
    .filter(
      (w) =>
        w.owner === owner &&
        w.path.join('.') === path &&
        w.end > w.start &&
        // (a timed buff's off state is a window of '')
        w.value !== ''
    )
    .sort((a, b) => a.start - b.start)
    .map(({ value, start, end }) => ({ value, start, end }))

const isDeclared = (
  sim: SimulationResult,
  path: string,
  owner: CharacterKey = 'Fischl'
) =>
  sim.buffWindows.some(
    (w) => w.owner === owner && w.path.join('.') === path && w.end === w.start
  )

function buildFischl(
  weapon: string,
  {
    gobletMain = 'atk_',
    conditional,
    extraMembers = [],
  }: {
    gobletMain?: 'physical_dmg_' | 'electro_dmg_' | 'atk_'
    conditional?: Record<string, Record<string, string>>
    extraMembers?: CharacterKey[]
  } = {}
) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const loadoutData: LoadoutDatum[] = []
  const add = (
    characterKey: CharacterKey,
    wKey: string,
    cond?: Record<string, Record<string, string>>
  ) => {
    db.chars.set(characterKey, {
      key: characterKey,
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 9, skill: 9, burst: 9 },
    })
    const teamCharId = db.teamChars.new(characterKey, {
      conditional: cond as never,
    })
    const buildTcId = db.buildTcs.new({
      characterKey,
      character: {
        level: 90,
        ascension: 6,
        constellation: 0,
        talent: { auto: 9, skill: 9, burst: 9 },
      },
      weapon: { key: wKey, level: 90, ascension: 6, refinement: 1 },
      artifact: {
        slots: {
          flower: { level: 20, rarity: 5, statKey: 'hp' },
          plume: { level: 20, rarity: 5, statKey: 'atk' },
          sands: { level: 20, rarity: 5, statKey: 'atk_' },
          goblet: { level: 20, rarity: 5, statKey: gobletMain },
          circlet: { level: 20, rarity: 5, statKey: 'critRate_' },
        },
        substats: { type: 'max', stats: {}, rarity: 5 },
        sets: {},
      },
    } as never)
    loadoutData.push({ teamCharId, buildType: 'tc', buildTcId } as LoadoutDatum)
  }
  add('Fischl', weapon, conditional)
  for (const m of extraMembers) add(m, 'FavoniusLance')
  const teamId = db.teams.new({ loadoutData } as never)
  return { db, teamId }
}

describe('Elegy for the End', () => {
  it('grants 12 s Farewell Song after 4 Skill/Burst hits (0.2 s ICD, on/off-field) with a 20 s lockout', () => {
    // Skill at t=0: hits at 10, 15 (blocked by 12f ICD), 30, 50, 70 -> 4th sigil at t=70.
    // Swaps to Bennett at t=90; Skill hits at 200 (during 20s lockout) and 1300 (after lockout):
    // 1300..1360 re-accumulates 4 sigils while off-field and triggers a 2nd window at 1360.
    const sim = play(
      'Fischl E Bennett N1 W25',
      {
        Fischl: makeKit('Fischl', 'electro', {
          skill: {
            hits: [
              { at: 10, label: 's1' },
              { at: 15, label: 's-icd' },
              { at: 30, label: 's2' },
              { at: 50, label: 's3' },
              { at: 70, label: 's4' },
              { at: 200, label: 's-locked' },
              { at: 1300, label: 's5' },
              { at: 1320, label: 's6' },
              { at: 1340, label: 's7' },
              { at: 1360, label: 's8' },
            ],
            frames: 90,
          },
        }),
        Bennett: makeKit('Bennett', 'pyro', {
          normal: { hits: [{ at: 10, label: 'bennett-n1' }], frames: 30 },
        }),
      },
      { Fischl: { weapon: 'ElegyForTheEnd', refinement: 1 } }
    )
    expect(isDeclared(sim, 'ElegyForTheEnd.ThePartingRefrain')).toBe(true)
    expect(windowsOf(sim, 'ElegyForTheEnd.ThePartingRefrain')).toEqual([
      { value: 'on', start: 70, end: 790 },
      { value: 'on', start: 1360, end: 2080 },
    ])
    // Triggering 4th hit is pinned off; teammate hit inside [70, 790) receives the party buff.
    const fischlS4 = rotationAttacks(sim, () => undefined).Fischl!.find(
      (a) => a.description === 's4'
    )
    expect(
      fischlS4?.states?.find((s) => s.path[0] === 'ElegyForTheEnd')?.value ?? ''
    ).toBe('')
    const bennettN1 = rotationAttacks(sim, () => undefined).Bennett!.find(
      (a) => a.description === 'bennett-n1'
    )
    expect(
      bennettN1?.states?.find((s) => s.path[0] === 'ElegyForTheEnd')?.value
    ).toBe('on')
  })
})

describe('Silverdawn', () => {
  it('opens for 6 s after Skill/Burst and extends +3 s per Stellar Glimmer trigger (0.1 s ICD, max 8x)', () => {
    const noExt = play(
      'Fischl E W10',
      {
        Fischl: makeKit('Fischl', 'cryo', {
          skill: { hits: [{ at: 10 }], frames: 30 },
        }),
      },
      { Fischl: { weapon: 'Silverdawn', refinement: 1 } }
    )
    expect(isDeclared(noExt, 'Silverdawn.whiteCrownsBequest')).toBe(true)
    expect(windowsOf(noExt, 'Silverdawn.whiteCrownsBequest')).toEqual([
      { value: 'on', start: 0, end: 360 },
    ])

    // 10 Stellar Glimmer hits at 20, 23 (blocked by 6f ICD), 30, 40, ..., 110 (9 eligible -> capped at 8).
    // 360 + 8 * 180 = 1800.
    const hits: HitSpec[] = [
      { at: 10 },
      { at: 20, path: ['_reaction', 'stellarConduct'], tag: 'other' },
    ]
    hits.push({ at: 23, path: ['_reaction', 'stellarConduct'], tag: 'other' })
    for (let i = 0; i < 8; i++)
      hits.push({
        at: 30 + i * 10,
        tag: 'directStellarSwirl',
        path: ['skill', `ss${i}`],
      })
    const extended = play(
      'Fischl E W40',
      {
        Fischl: makeKit('Fischl', 'cryo', {
          skill: { hits, frames: 30 },
        }),
      },
      { Fischl: { weapon: 'Silverdawn', refinement: 1 } }
    )
    expect(windowsOf(extended, 'Silverdawn.whiteCrownsBequest')).toEqual([
      { value: 'on', start: 0, end: 1800 },
    ])
  })

  it('resets extensions on a new Skill/Burst instance', () => {
    // E at 0 extends once (+180 -> 540); Q at 200 resets to 200+360 = 560.
    const sim = play(
      'Fischl E W3 Q W15',
      {
        Fischl: makeKit('Fischl', 'cryo', {
          skill: {
            hits: [
              { at: 10, path: ['_reaction', 'stellarConduct'], tag: 'other' },
            ],
            frames: 20,
          },
          burst: { hits: [{ at: 10 }], frames: 30 },
        }),
      },
      { Fischl: { weapon: 'Silverdawn', refinement: 1 } }
    )
    expect(windowsOf(sim, 'Silverdawn.whiteCrownsBequest')).toEqual([
      { value: 'on', start: 0, end: 200 },
      { value: 'on', start: 200, end: 560 },
    ])
  })
})

describe('Breezeborne Refrain', () => {
  it('opens for 12 s on 3rd Skill/Burst hit (2f ICD) and blocks stack gain while active', () => {
    const sim = play(
      'Fischl E W20',
      {
        Fischl: makeKit('Fischl', 'anemo', {
          skill: {
            hits: [
              { at: 10 },
              { at: 11 }, // blocked by 2f ICD
              { at: 20 },
              { at: 30 }, // 3rd stack -> opens [30, 750)
              { at: 100 }, // locked out during [30, 750)
              { at: 200 }, // locked out
              { at: 750 },
              { at: 760 },
              { at: 770 }, // 3rd stack after expiry -> opens [770, 1490)
            ],
            frames: 30,
          },
        }),
      },
      { Fischl: { weapon: 'BreezeborneRefrain', refinement: 1 } }
    )
    expect(isDeclared(sim, 'BreezeborneRefrain.viper')).toBe(true)
    expect(windowsOf(sim, 'BreezeborneRefrain.viper')).toEqual([
      { value: 'on', start: 30, end: 750 },
      { value: 'on', start: 770, end: 1490 },
    ])
  })
})

describe('Covenant of Frost and Snow & Windblume Ode', () => {
  it('opens Covenant of Frost and Snow for 12 s and Windblume Ode for 6 s after Skill', () => {
    const k = makeKit('Fischl', 'electro', {
      skill: { hits: [{ at: 10 }], frames: 30 },
      burst: { hits: [{ at: 10 }], frames: 30 },
    })
    const cov = play(
      'Fischl Q E W15',
      { Fischl: k },
      {
        Fischl: { weapon: 'CovenantOfFrostAndSnow', refinement: 1 },
      }
    )
    expect(isDeclared(cov, 'CovenantOfFrostAndSnow.passive')).toBe(true)
    expect(windowsOf(cov, 'CovenantOfFrostAndSnow.passive')).toEqual([
      { value: 'on', start: 30, end: 750 },
    ])

    const wind = play(
      'Fischl Q E W15',
      { Fischl: k },
      {
        Fischl: { weapon: 'WindblumeOde', refinement: 1 },
      }
    )
    expect(isDeclared(wind, 'WindblumeOde.WindblumeWish')).toBe(true)
    expect(windowsOf(wind, 'WindblumeOde.WindblumeWish')).toEqual([
      { value: 'on', start: 30, end: 390 },
    ])
  })
})

describe('Flower-Wreathed Feathers', () => {
  it('stacks on Charged Attack actions (30f ICD, max 6) and clears 10 s after the last', () => {
    const sim = play(
      'Fischl CA CA CA CA CA CA CA W15',
      {
        Fischl: makeKit('Fischl', 'pyro', {
          charged: { hits: [{ at: 40 }], frames: 60 },
        }),
      },
      { Fischl: { weapon: 'FlowerWreathedFeathers', refinement: 1 } }
    )
    expect(isDeclared(sim, 'FlowerWreathedFeathers.passive')).toBe(true)
    expect(windowsOf(sim, 'FlowerWreathedFeathers.passive')).toEqual([
      { value: '1', start: 0, end: 60 },
      { value: '2', start: 60, end: 120 },
      { value: '3', start: 120, end: 180 },
      { value: '4', start: 180, end: 240 },
      { value: '5', start: 240, end: 300 },
      // (the 7th refreshes all 6 for 10 s: the state stays '6' until then)
      { value: '6', start: 300, end: 960 },
    ])
  })
})

describe("King's Squire", () => {
  const fischlKit = makeKit('Fischl', 'electro', {
    skill: { hits: [{ at: 10 }], frames: 30 },
    burst: { hits: [{ at: 10 }], frames: 30 },
  })
  const bennettKit = makeKit('Bennett', 'pyro', {
    normal: { hits: [{ at: 10 }], frames: 30 },
  })

  it('opens for 12 s (20 s ICD) and emits Physical proc on expiry when worn', () => {
    const sim = play(
      'Fischl E W15',
      { Fischl: fischlKit },
      { Fischl: { weapon: 'KingsSquire', refinement: 1 } }
    )
    expect(isDeclared(sim, 'KingsSquire.passive')).toBe(true)
    expect(windowsOf(sim, 'KingsSquire.passive')).toEqual([
      { value: 'on', start: 0, end: 720 },
    ])
    const procs = sim.hits.filter((h) => h.path[0] === 'weapon:KingsSquire')
    expect(procs).toHaveLength(1)
    expect(procs[0]).toMatchObject({
      t: 721,
      element: 'physical',
      path: ['weapon:KingsSquire', 'dmg'],
    })

    // Candidate-only opens the buff window without emitting a damage proc.
    const cand = play(
      'Fischl E W15',
      { Fischl: fischlKit },
      {
        Fischl: {
          weapon: 'Slingshot',
          candidates: { weapons: ['KingsSquire'] },
        },
      }
    )
    expect(windowsOf(cand, 'KingsSquire.passive')).toEqual([
      { value: 'on', start: 0, end: 720 },
    ])
    expect(
      cand.hits.filter((h) => h.path[0] === 'weapon:KingsSquire')
    ).toHaveLength(0)
  })

  it('closes on swap-out and emits its proc 1 frame after swap, respecting 20 s ICD', () => {
    // E at 0, swap to Bennett at 30+12=42 (Wait: swapFrames=12, swap finishes at 42;
    // actually let's check when onSwap runs: at swap completion or start), Q at 84 blocked by 20s ICD.
    const sim = play(
      'Fischl E Bennett N1 Fischl Q W25',
      { Fischl: fischlKit, Bennett: bennettKit },
      { Fischl: { weapon: 'KingsSquire', refinement: 1 } }
    )
    const wins = windowsOf(sim, 'KingsSquire.passive')
    expect(wins).toHaveLength(1)
    expect(wins[0].start).toBe(0)
    expect(wins[0].end).toBeLessThan(720)
    const procs = sim.hits.filter((h) => h.path[0] === 'weapon:KingsSquire')
    expect(procs).toHaveLength(1)
    expect(procs[0].t).toBe(wins[0].end + 1)
  })

  it('deals Physical DMG (sheet fix: scales with Physical DMG% goblet, not Electro DMG%)', () => {
    const sim = play(
      'Fischl E W15',
      { Fischl: fischlKit },
      { Fischl: { weapon: 'KingsSquire', refinement: 1 } }
    )
    const procAttack = rotationAttacks(sim, () => undefined).Fischl!.find(
      (a) => a.path[0] === 'weapon:KingsSquire'
    )!
    expect(procAttack).toBeDefined()

    const atkGoblet = buildFischl('KingsSquire', { gobletMain: 'atk_' })
    const physGoblet = buildFischl('KingsSquire', {
      gobletMain: 'physical_dmg_',
    })
    const elecGoblet = buildFischl('KingsSquire', {
      gobletMain: 'electro_dmg_',
    })

    // Compare Electro vs Physical goblet (both lack the ATK% goblet, so Phys > Elec proves Physical element).
    const physTotal = evaluateTeamRotation(
      physGoblet.db,
      physGoblet.teamId,
      'F',
      {
        arts: {},
        attacks: { Fischl: [procAttack] },
      }
    )!.total
    const elecTotal = evaluateTeamRotation(
      elecGoblet.db,
      elecGoblet.teamId,
      'F',
      {
        arts: {},
        attacks: { Fischl: [procAttack] },
      }
    )!.total
    const atkTotal = evaluateTeamRotation(atkGoblet.db, atkGoblet.teamId, 'F', {
      arts: {},
      attacks: { Fischl: [procAttack] },
    })!.total
    expect(physTotal).toBeGreaterThan(elecTotal)
    expect(atkTotal).toBeGreaterThan(0)
  })
})

describe('Snare Hook', () => {
  it('opens afterReaction for 12 s on any wielder reaction (on- or off-field)', () => {
    const sim = play(
      'Fischl E Bennett N1 W15',
      {
        Fischl: makeKit('Fischl', 'electro', {
          skill: {
            hits: [
              { at: 10, label: 'before' },
              {
                at: 10,
                path: ['_reaction', 'overloaded'],
                tag: 'other',
              },
              { at: 20, label: 'after' },
              {
                at: 800,
                path: ['_reaction', 'overloaded'],
                tag: 'other',
              },
            ],
            frames: 30,
          },
        }),
        Bennett: makeKit('Bennett', 'pyro', {
          normal: { hits: [{ at: 10 }], frames: 30 },
        }),
      },
      { Fischl: { weapon: 'SnareHook', refinement: 1 } }
    )
    expect(isDeclared(sim, 'SnareHook.afterReaction')).toBe(true)
    expect(windowsOf(sim, 'SnareHook.afterReaction')).toEqual([
      { value: 'on', start: 10, end: 730 },
      { value: 'on', start: 800, end: 1520 },
    ])
    const attacks = rotationAttacks(sim, () => undefined).Fischl!
    expect(
      attacks
        .find((a) => a.description === 'before')
        ?.states?.find((s) => s.path[0] === 'SnareHook')?.value ?? ''
    ).toBe('')
    expect(
      attacks
        .find((a) => a.description === 'after')
        ?.states?.find((s) => s.path[0] === 'SnareHook')?.value
    ).toBe('on')
  })

  it('gates EM on afterReaction conditional, including Ascendant Gleam (sheet fix)', () => {
    const readEm = (build: ReturnType<typeof buildFischl>) => {
      const ui = uiDataForTeam(
        getTeamDataWith(build.db, build.teamId, {}) as never,
        'F',
        'Fischl'
      ).Fischl
      return (
        (
          ui!.target as {
            get: (node: never) => { value: number } | undefined
          }
        ).get({ operation: 'read', path: ['premod', 'eleMas'] } as never)
          ?.value ?? 0
      )
    }

    const hookOff = buildFischl('SnareHook')
    const hookOn = buildFischl('SnareHook', {
      conditional: { SnareHook: { afterReaction: 'on' } },
    })
    const gleamOff = buildFischl('SnareHook', {
      extraMembers: ['Aino', 'Ineffa'],
    })
    const gleamOn = buildFischl('SnareHook', {
      extraMembers: ['Aino', 'Ineffa'],
      conditional: { SnareHook: { afterReaction: 'on' } },
    })

    expect(readEm(hookOff)).toBe(0)
    expect(readEm(hookOn)).toBeCloseTo(60, 6)
    expect(readEm(gleamOff)).toBe(0)
    expect(readEm(gleamOn)).toBeCloseTo(120, 6)

    const ozAggravate = {
      path: ['skill', 'ozDmg'],
      hits: 1,
      hitMode: 'avgHit' as const,
      reaction: 'aggravate' as const,
    }
    const offDmg = evaluateTeamRotation(hookOff.db, hookOff.teamId, 'F', {
      arts: {},
      attacks: { Fischl: [ozAggravate] },
    })!.total
    const onDmg = evaluateTeamRotation(hookOn.db, hookOn.teamId, 'F', {
      arts: {},
      attacks: { Fischl: [ozAggravate] },
    })!.total

    expect(onDmg).toBeGreaterThan(offDmg)
  })
})
