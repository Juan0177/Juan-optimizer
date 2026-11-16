/**
 * Weapon audit batch sword4 (rotation/weapons/sword4): each weapon's window, stacks or proc
 * opened by its wielder's own triggers in the simulation, closed after its duration or held back
 * by its cooldown (kqmsim, or the game's text where kqmsim has none), and the sheet fixes.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation } from '../../'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type {
  HitElement,
  HitTag,
  KitModel,
  SimGear,
  SimHit,
} from '../../util/teamOpt/rotation/types'

type Mark = {
  at: number
  path?: string[]
  tag?: HitTag
  element?: HitElement
  animationPause?: number
}

const kit = (
  characterKey: CharacterKey,
  element: HitElement,
  script: Partial<Record<string, { hits: Mark[]; frames: number }>>
): KitModel => ({
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
        label: 'hit',
        ...(h.animationPause !== undefined && {
          animationPause: h.animationPause,
        }),
      } as Omit<SimHit, 't' | 'characterKey' | 'onField'>)
    return { frames: s.frames }
  },
})

const ELEMENTS: Partial<Record<CharacterKey, HitElement>> = {
  Kaeya: 'cryo',
  Skirk: 'cryo',
  Bennett: 'pyro',
  Furina: 'hydro',
  Lynette: 'anemo',
  Clorinde: 'electro',
  TravelerHydro: 'hydro',
}

function play(
  text: string,
  kits: Partial<Record<CharacterKey, KitModel>>,
  gear: Partial<Record<CharacterKey, SimGear>>
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
      members.map((m) => [m, ELEMENTS[m] ?? 'physical'])
    ),
    repeats: 1,
    kits,
    reactions: { onHit() {} },
    gear,
  })
}

const windows = (
  sim: ReturnType<typeof play>,
  path: string,
  owner: CharacterKey,
  withValue = false
) =>
  sim.buffWindows
    .filter(
      (w) =>
        w.owner === owner &&
        w.path.join('.') === path &&
        w.end > w.start &&
        w.value !== ''
    )
    .sort((a, b) => a.start - b.start)
    .map((w) => (withValue ? [w.start, w.end, w.value] : [w.start, w.end]))

const declared = (
  sim: ReturnType<typeof play>,
  path: string,
  owner: CharacterKey
) =>
  sim.buffWindows.some(
    (w) => w.owner === owner && w.path.join('.') === path && w.end === w.start
  )

const wear = (weapon: string, refinement = 1): SimGear => ({
  weapon,
  refinement,
})

function buildTeam(
  members: { key: CharacterKey; weapon: string; refinement?: number }[],
  conditional?: Record<string, unknown>,
  bonusStats?: Record<string, number>
) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const loadoutData: LoadoutDatum[] = []
  for (const m of members) {
    db.chars.set(m.key, {
      key: m.key,
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 9, skill: 9, burst: 9 },
    })
    const teamCharId = db.teamChars.new(m.key, {
      conditional: (conditional?.[m.key] ?? {}) as never,
      bonusStats: (bonusStats && m.key === members[0].key
        ? bonusStats
        : {}) as never,
    })
    const buildTcId = db.buildTcs.new({
      characterKey: m.key,
      character: {
        level: 90,
        ascension: 6,
        constellation: 0,
        talent: { auto: 9, skill: 9, burst: 9 },
      },
      weapon: {
        key: m.weapon,
        level: 90,
        ascension: 6,
        refinement: m.refinement ?? 1,
      },
      artifact: {
        slots: {},
        substats: { type: 'max', stats: {}, rarity: 5 },
        sets: {},
      },
    } as never)
    loadoutData.push({ teamCharId, buildType: 'tc', buildTcId } as LoadoutDatum)
  }
  const teamId = db.teams.new({ loadoutData } as never)
  return { db, teamId }
}

describe('Azurelight', () => {
  it('opens afterSkill for 12 s on Skill, and noEnergy only for zero-cost Bursts', () => {
    const kaeya = play(
      'Kaeya E',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          skill: {
            hits: [{ at: 10, path: ['_marker', 'hitlag'], animationPause: 5 }],
            frames: 30,
          },
        }),
      },
      { Kaeya: wear('Azurelight') }
    )
    expect(declared(kaeya, 'Azurelight.afterSkill', 'Kaeya')).toBe(true)
    expect(declared(kaeya, 'Azurelight.noEnergy', 'Kaeya')).toBe(true)
    // (Skill at 0; hitlag pause of 5 f at 10 extends end from 720 to 725)
    expect(windows(kaeya, 'Azurelight.afterSkill', 'Kaeya')).toEqual([[0, 720]])
    expect(
      kaeya.buffWindows.find(
        (w) => w.path.join('.') === 'Azurelight.afterSkill' && w.end > 0
      )?.hitlag
    ).toBe('recipient')
    expect(windows(kaeya, 'Azurelight.noEnergy', 'Kaeya')).toEqual([])

    const skirk = play(
      'Skirk E',
      { Skirk: kit('Skirk', 'cryo', { skill: { hits: [], frames: 30 } }) },
      { Skirk: wear('Azurelight') }
    )
    expect(windows(skirk, 'Azurelight.afterSkill', 'Skirk')).toEqual([[0, 720]])
    expect(windows(skirk, 'Azurelight.noEnergy', 'Skirk')).toEqual([[0, 720]])
  })
})

describe('Haran Geppaku Futsu', () => {
  it('gains up to 2 Wavespikes from teammate Skills (0.3 s ICD) and consumes them on wielder Skill for 8 s', () => {
    const sim = play(
      'Bennett E E E -> Kaeya E W10 E',
      {
        Bennett: kit('Bennett', 'pyro', { skill: { hits: [], frames: 10 } }),
        Kaeya: kit('Kaeya', 'cryo', { skill: { hits: [], frames: 30 } }),
      },
      { Kaeya: wear('HaranGeppakuFutsu') }
    )
    // Bennett Skills at 0, 10 (within 18 f ICD -> ignored), 20 (past 18 f ICD -> 2 stacks)
    // Swap to Kaeya (12 f): Kaeya E at 42 consumes 2 stacks (42 -> 522); W10 = 600 f -> E at 672 has 0 stacks
    expect(declared(sim, 'HaranGeppakuFutsu.HonedFlow', 'Kaeya')).toBe(true)
    expect(windows(sim, 'HaranGeppakuFutsu.HonedFlow', 'Kaeya', true)).toEqual([
      [42, 522, '2'],
    ])
  })
})

describe('Mistsplitter Reforged', () => {
  it('combines Elemental Normal (5 s, next hit), Burst (10 s), and Energy < 100% stacks independently', () => {
    const sim = play(
      'Kaeya N1 Q W12',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          normal: { hits: [{ at: 5, element: 'cryo' }], frames: 20 },
          burst: { hits: [{ at: 10 }], frames: 30 },
        }),
      },
      { Kaeya: wear('MistsplitterReforged') }
    )
    // N1 hit at 5 -> NA stack [6, 306); Burst at 20 -> Burst stack [20, 620), and Energy below
    // full from it on
    expect(
      windows(sim, 'MistsplitterReforged.MistsplittersEmblem', 'Kaeya', true)
    ).toEqual([
      [6, 20, '1'],
      [20, 306, '3'],
      [306, 620, '2'],
      [620, Number.MAX_SAFE_INTEGER, '1'],
    ])

    // Charged Attack Elemental DMG gives the Normal Attack stack too (kqmsim: AttackTagExtra)
    const charged = play(
      'Kaeya C',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          charged: { hits: [{ at: 5, element: 'cryo' }], frames: 20 },
        }),
      },
      { Kaeya: wear('MistsplitterReforged') }
    )
    expect(
      windows(
        charged,
        'MistsplitterReforged.MistsplittersEmblem',
        'Kaeya',
        true
      )
    ).toEqual([[6, 306, '1']])

    // Physical Normal hits do not grant the Elemental Normal stack; zero-cost Burst starts with 1 stack
    const skirk = play(
      'Skirk N1',
      {
        Skirk: kit('Skirk', 'cryo', {
          normal: { hits: [{ at: 5, element: 'physical' }], frames: 20 },
        }),
      },
      { Skirk: wear('MistsplitterReforged') }
    )
    const skirkWindows = windows(
      skirk,
      'MistsplitterReforged.MistsplittersEmblem',
      'Skirk',
      true
    )
    expect(skirkWindows).toHaveLength(1)
    expect(skirkWindows[0][0]).toBe(0)
    expect(skirkWindows[0][1]).toBeGreaterThanOrEqual(skirk.frames)
    expect(skirkWindows[0][2]).toBe('1')
  })

  it('sets the count at once: an action during the stacks sees them in its snapshot', () => {
    const seen: string[] = []
    const base = kit('Kaeya', 'cryo', { burst: { hits: [], frames: 30 } })
    play(
      'Kaeya Q N1',
      {
        Kaeya: {
          ...base,
          act(ctx, state, action, previous) {
            if (action.kind === 'normal')
              seen.push(
                ctx
                  .snapshot('Kaeya')
                  .states.find(
                    (s) =>
                      s.owner === 'Kaeya' &&
                      s.path.join('.') ===
                        'MistsplitterReforged.MistsplittersEmblem'
                  )?.value ?? ''
              )
            return base.act(ctx, state, action, previous)
          },
        },
      },
      { Kaeya: wear('MistsplitterReforged') }
    )
    // (Burst at 0: its stack and Energy below full; the Normal at 30 is inside both)
    expect(seen).toEqual(['2'])
  })
})

describe('Amenoma Kageuchi', () => {
  it('gains a Seed per on-field Skill (5 s ICD, at most 3) and marks one Energy a Seed 3 s after the Burst', () => {
    const kits = {
      Kaeya: kit('Kaeya', 'cryo', {
        skill: { hits: [], frames: 30 },
        burst: { hits: [], frames: 30 },
      }),
    }
    const energy = (sim: ReturnType<typeof play>) =>
      sim.hits
        .filter(
          (h) => h.path.join('.') === '_marker.weaponEnergy.AmenomaKageuchi'
        )
        .map((h) => [h.t, h.characterKey])
    // E at 0 (Seed), E at 30 (ICD), E at 360 (Seed), Q at 390: 2 Seeds, Energy at 570
    expect(
      energy(
        play('Kaeya E E W5 E Q W4', kits, { Kaeya: wear('AmenomaKageuchi') })
      )
    ).toEqual([
      [570, 'Kaeya'],
      [570, 'Kaeya'],
    ])
    // Skills at 0, 330, 660, 990: the 4th replaces the oldest, Q at 1020 consumes 3
    expect(
      energy(
        play('Kaeya E W5 E W5 E W5 E Q W4', kits, {
          Kaeya: wear('AmenomaKageuchi'),
        })
      )
    ).toEqual([
      [1200, 'Kaeya'],
      [1200, 'Kaeya'],
      [1200, 'Kaeya'],
    ])
    // no Seed, no Energy
    expect(
      energy(play('Kaeya Q W4', kits, { Kaeya: wear('AmenomaKageuchi') }))
    ).toEqual([])
  })
})

describe('Splendor of Tranquil Waters', () => {
  it('stacks self Skill DMG (max 3) and teammate Max HP (max 2) on HP changes, off-field too', () => {
    const sim = play(
      'Kaeya E -> Bennett E',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          skill: {
            hits: [
              { at: 0, path: ['_marker', 'hpChange'] },
              { at: 5, path: ['_marker', 'hpChange'] }, // within 12 f ICD
              { at: 20, path: ['_marker', 'hpChange'] },
              { at: 40, path: ['_marker', 'hpChange'] },
              { at: 60, path: ['_marker', 'hpChange'] },
            ],
            frames: 80,
          },
        }),
        Bennett: kit('Bennett', 'pyro', {
          skill: {
            hits: [
              { at: 0, path: ['_marker', 'hpChange'] },
              { at: 20, path: ['_marker', 'hpChange'] },
              { at: 40, path: ['_marker', 'hpChange'] },
            ],
            frames: 60,
          },
        }),
      },
      { Kaeya: wear('SplendorOfTranquilWaters') }
    )
    expect(
      windows(sim, 'SplendorOfTranquilWaters.selfHpChange', 'Kaeya', true)
    ).toEqual([
      [0, 360, '1'],
      [20, 380, '2'],
      [40, 400, '3'],
      [60, 420, '3'],
    ])
    // Bennett starts at 80 + 12 swap = 92; Kaeya is off-field and still gains teamHpChange
    expect(
      windows(sim, 'SplendorOfTranquilWaters.teamHpChange', 'Kaeya', true)
    ).toEqual([
      [92, 452, '1'],
      [112, 472, '2'],
      [132, 492, '2'],
    ])
  })
})

describe('Emberwell', () => {
  it('opens react on any reaction and stellar on Stellar-Conduct / Stellar Swirl for 12 s', () => {
    const sim = play(
      'Kaeya E -> Bennett E',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          skill: {
            hits: [
              { at: 10, path: ['_reaction', 'melt'] },
              { at: 50, path: ['_reaction', 'stellarConduct'] },
            ],
            frames: 60,
          },
        }),
        Bennett: kit('Bennett', 'pyro', { skill: { hits: [], frames: 20 } }),
      },
      { Kaeya: wear('Emberwell') }
    )
    expect(windows(sim, 'Emberwell.react', 'Kaeya')).toEqual([
      [10, 730],
      [50, 770],
    ])
    expect(windows(sim, 'Emberwell.stellar', 'Kaeya')).toEqual([[50, 770]])
  })
})

describe('Fleuve Cendre Ferryman', () => {
  it('opens afterSkill for 5 s after the wielder’s on-field Skill', () => {
    const sim = play(
      'Kaeya E W6 E',
      { Kaeya: kit('Kaeya', 'cryo', { skill: { hits: [], frames: 30 } }) },
      { Kaeya: wear('FleuveCendreFerryman') }
    )
    expect(declared(sim, 'FleuveCendreFerryman.afterSkill', 'Kaeya')).toBe(true)
    expect(windows(sim, 'FleuveCendreFerryman.afterSkill', 'Kaeya')).toEqual([
      [0, 300],
      [390, 690],
    ])
  })
})

describe('Kagotsurube Isshin', () => {
  it('opens +15% ATK for 8 s and emits the 180% ATK proc at 1 f delay with 8 s ICD', () => {
    const sim = play(
      'Kaeya E N1 N1 W9 N1',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          skill: { hits: [{ at: 5 }], frames: 20 },
          normal: { hits: [{ at: 5 }], frames: 20 },
        }),
      },
      { Kaeya: wear('KagotsurubeIsshin') }
    )
    // E at 0 (no proc); N1 at 20 -> hit at 25 -> proc & buff at 26..506; N1 at 40 (ICD); N1 at 600 -> hit at 605 -> proc & buff at 606..1086
    const procs = sim.hits.filter(
      (h) => h.path[0] === 'weapon:KagotsurubeIsshin'
    )
    expect(procs.map((h) => h.t)).toEqual([26, 606])
    expect(windows(sim, 'KagotsurubeIsshin.passive', 'Kaeya')).toEqual([
      [26, 506],
      [606, 1086],
    ])
    // Triggering hit at 25 does not have passive; proc at 26 does
    const attacks = rotationAttacks(sim).Kaeya!
    const triggerHit = attacks.find((a) => a.path[0] === 'normal')!
    const procAttack = attacks.find(
      (a) => a.path[0] === 'weapon:KagotsurubeIsshin'
    )!
    expect(
      triggerHit.states?.find((s) => s.path[0] === 'KagotsurubeIsshin')?.value
    ).toBeUndefined()
    expect(
      procAttack.states?.find((s) => s.path[0] === 'KagotsurubeIsshin')?.value
    ).toBe('on')
    expect(
      rotationAttacks(sim, () => 'on')
        .Kaeya!.find((a) => a.path[0] === 'normal')!
        .limits?.some((l) => l.path[0] === 'KagotsurubeIsshin')
    ).toBe(true)

    const isshin = buildTeam([{ key: 'Kaeya', weapon: 'KagotsurubeIsshin' }])
    expect(
      evaluateTeamRotation(isshin.db, isshin.teamId, 'F', {
        arts: {},
        attacks: { Kaeya: [procAttack] },
      })!.total
    ).toBeGreaterThan(0)
    const other = buildTeam([{ key: 'Kaeya', weapon: 'DullBlade' }])
    expect(
      evaluateTeamRotation(other.db, other.teamId, 'F', {
        arts: {},
        attacks: { Kaeya: [procAttack] },
      })?.total ?? 0
    ).toBe(0)
  })
})

describe('Prototype Rancour', () => {
  it('ramps 1..4 stacks with 0.3 s ICD and 6 s refreshing duration', () => {
    const sim = play(
      'Kaeya N1 N1 N1 N1 N1 W7 N1',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          normal: { hits: [{ at: 0 }], frames: 20 },
        }),
      },
      { Kaeya: wear('PrototypeRancour') }
    )
    // Hits at 0, 20, 40, 60, 80 (capped at 4), then W7 = 420 -> hit at 520 (past 81 + 360 = 441 -> resets to 1)
    expect(windows(sim, 'PrototypeRancour.stack', 'Kaeya', true)).toEqual([
      [1, 361, '1'],
      [21, 381, '2'],
      [41, 401, '3'],
      [61, 421, '4'],
      [81, 441, '4'],
      [521, 881, '1'],
    ])
  })
})

describe("Serenity's Call", () => {
  it('opens afterReaction for 12 s on wielder reactions (off-field too)', () => {
    const sim = play(
      'Kaeya E -> Bennett E',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          skill: {
            hits: [{ at: 10, path: ['_reaction', 'melt'] }],
            frames: 20,
          },
        }),
        Bennett: kit('Bennett', 'pyro', { skill: { hits: [], frames: 20 } }),
      },
      { Kaeya: wear('SerenitysCall') }
    )
    expect(declared(sim, 'SerenitysCall.afterReaction', 'Kaeya')).toBe(true)
    expect(windows(sim, 'SerenitysCall.afterReaction', 'Kaeya')).toEqual([
      [10, 730],
    ])
  })
})

describe('Sword of Narzissenkreuz', () => {
  it('emits Hero’s Blade after 6 f on char clock (12 s ICD) for non-Arkhe wielders only', () => {
    const kaeya = play(
      'Kaeya N1 N1 W13 N1',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          normal: {
            hits: [
              { at: 2 },
              { at: 4, path: ['_marker', 'hitlag'], animationPause: 5 },
            ],
            frames: 20,
          },
        }),
      },
      { Kaeya: wear('SwordOfNarzissenkreuz') }
    )
    // N1 at 0 -> hit at 2 + 6 char frames + 5 f hitlag pause at 4 = 13; N1 at 20 (ICD);
    // N1 after N1_2 (20 f) + W13 (780 f) = 820 -> hit at 822 + 6 + 5 = 833
    expect(
      kaeya.hits
        .filter((h) => h.path[0] === 'weapon:SwordOfNarzissenkreuz')
        .map((h) => h.t)
    ).toEqual([13, 833])

    for (const arkheChar of [
      'Furina',
      'Lynette',
      'Clorinde',
      'TravelerHydro',
    ] as const) {
      const sim = play(
        `${arkheChar} N1`,
        {
          [arkheChar]: kit(arkheChar, 'hydro', {
            normal: { hits: [{ at: 2 }], frames: 20 },
          }),
        },
        { [arkheChar]: wear('SwordOfNarzissenkreuz') }
      )
      expect(
        sim.hits.some((h) => h.path[0] === 'weapon:SwordOfNarzissenkreuz')
      ).toBe(false)
    }
  })
})

describe('The Flute', () => {
  it('procs Chord on the 5th Harmonic (0.5 s ICD) and resets if 30 s elapse', () => {
    const sim = play(
      'Kaeya N1 N1 N1 N1 N1 N1',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          normal: { hits: [{ at: 0 }], frames: 30 },
        }),
      },
      { Kaeya: wear('TheFlute') }
    )
    // Hits at 0, 30, 60, 90, 120 -> 5th Harmonic fires at 121
    expect(
      sim.hits.filter((h) => h.path[0] === 'weapon:TheFlute').map((h) => h.t)
    ).toEqual([121])

    const expired = play(
      'Kaeya N1 N1 N1 N1 W31 N1',
      {
        Kaeya: kit('Kaeya', 'cryo', {
          normal: { hits: [{ at: 0 }], frames: 30 },
        }),
      },
      { Kaeya: wear('TheFlute') }
    )
    expect(expired.hits.some((h) => h.path[0] === 'weapon:TheFlute')).toBe(
      false
    )
  })
})

describe('sheet fixes', () => {
  const reads = (node: unknown, path: string, seen = new Set<unknown>()) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return false
    seen.add(node)
    const n = node as { operation?: string; path?: string[] }
    if (n.operation === 'read' && n.path?.join('.') === path) return true
    return Object.values(node).some((v) => reads(v, path, seen))
  }

  it('Mistsplitter Reforged has no teamBuff flag', () => {
    expect(
      getWeaponSheet('MistsplitterReforged').document.some(
        (d) => (d as { teamBuff?: boolean }).teamBuff
      )
    ).toBe(false)
  })

  it('Prototype Rancour conditional label uses hitOp.normalOrCharged', () => {
    const doc = getWeaponSheet('PrototypeRancour').document[0] as {
      name?: { props?: { key18?: string } }
    }
    expect(doc.name?.props?.key18).toBe('hitOp.normalOrCharged')
  })

  it("Serenity's Call gates Max HP bonus on condAfterReaction", () => {
    const furinaOff = buildTeam([
      { key: 'Furina', weapon: 'SerenitysCall', refinement: 5 },
    ])
    const furinaOn = buildTeam(
      [{ key: 'Furina', weapon: 'SerenitysCall', refinement: 5 }],
      { Furina: { SerenitysCall: { afterReaction: 'on' } } }
    )
    const furinaGleamOff = buildTeam([
      { key: 'Furina', weapon: 'SerenitysCall', refinement: 5 },
      { key: 'Columbina', weapon: 'PrototypeAmber', refinement: 1 },
      { key: 'Ineffa', weapon: 'FavoniusLance', refinement: 1 },
    ])
    const furinaAttack = {
      path: ['skill', 'usherDmg'],
      hits: 1,
      hitMode: 'avgHit' as const,
    }
    const dmgOff = evaluateTeamRotation(furinaOff.db, furinaOff.teamId, 'F', {
      arts: {},
      attacks: { Furina: [furinaAttack] },
    })!.total
    const dmgGleamOff = evaluateTeamRotation(
      furinaGleamOff.db,
      furinaGleamOff.teamId,
      'F',
      {
        arts: {},
        attacks: { Furina: [furinaAttack] },
      }
    )!.total
    const dmgOn = evaluateTeamRotation(furinaOn.db, furinaOn.teamId, 'F', {
      arts: {},
      attacks: { Furina: [furinaAttack] },
    })!.total
    expect(dmgGleamOff).toBeCloseTo(dmgOff, 5)
    expect(dmgOn).toBeGreaterThan(dmgOff * 1.2)
  })

  it('Sword of Narzissenkreuz disables its proc DMG for Arkhe characters', () => {
    const procAttack = {
      path: ['weapon:SwordOfNarzissenkreuz', 'dmg'],
      hits: 1,
      hitMode: 'avgHit' as const,
    }
    const kaeya = buildTeam([
      { key: 'Kaeya', weapon: 'SwordOfNarzissenkreuz', refinement: 1 },
    ])
    expect(
      evaluateTeamRotation(kaeya.db, kaeya.teamId, 'F', {
        arts: {},
        attacks: { Kaeya: [procAttack] },
      })!.total
    ).toBeGreaterThan(0)
    for (const arkheChar of [
      'Furina',
      'Lynette',
      'Clorinde',
      'TravelerHydro',
    ] as const) {
      const team = buildTeam([
        { key: arkheChar, weapon: 'SwordOfNarzissenkreuz', refinement: 1 },
      ])
      expect(
        evaluateTeamRotation(team.db, team.teamId, 'F', {
          arts: {},
          attacks: { [arkheChar]: [procAttack] },
        })?.total ?? 0
      ).toBe(0)
    }
  })

  it('The Flute exposes dmg scaling by refinement and from total ATK', () => {
    const display = getWeaponSheet('TheFlute').data.display?.[
      'weapon:TheFlute'
    ] as Record<string, unknown> | undefined
    expect(display?.dmg).toBeDefined()
    expect(display?.dmg_).toBeUndefined()
    expect(reads(display?.dmg, 'total.atk')).toBe(true)
    expect(reads(display?.dmg, 'premod.atk')).toBe(false)

    const procAttack = {
      path: ['weapon:TheFlute', 'dmg'],
      hits: 1,
      hitMode: 'avgHit' as const,
    }
    const r1 = buildTeam([{ key: 'Kaeya', weapon: 'TheFlute', refinement: 1 }])
    const r5 = buildTeam([{ key: 'Kaeya', weapon: 'TheFlute', refinement: 5 }])
    const r1Flat = buildTeam(
      [{ key: 'Kaeya', weapon: 'TheFlute', refinement: 1 }],
      undefined,
      { atk: 500 }
    )
    const dmg1 = evaluateTeamRotation(r1.db, r1.teamId, 'F', {
      arts: {},
      attacks: { Kaeya: [procAttack] },
    })!.total
    const dmg5 = evaluateTeamRotation(r5.db, r5.teamId, 'F', {
      arts: {},
      attacks: { Kaeya: [procAttack] },
    })!.total
    const dmgFlat = evaluateTeamRotation(r1Flat.db, r1Flat.teamId, 'F', {
      arts: {},
      attacks: { Kaeya: [procAttack] },
    })!.total
    expect(dmg1).toBeGreaterThan(0)
    expect(dmg5 / dmg1).toBeCloseTo(2, 5)
    expect(dmgFlat).toBeGreaterThan(dmg1)
  })
})
