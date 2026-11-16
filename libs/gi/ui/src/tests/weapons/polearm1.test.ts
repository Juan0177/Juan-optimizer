/**
 * Weapon audit batch polearm1 (rotation/weapons/polearm1.ts), as kqmsim: Bloodsoaked Ruins,
 * Disaster and Remorse, Lumidouce Elegy, Crescent Pike's proc, Footprint of the Rainbow,
 * Mountain-Bracing Bolt, Prototype Starglitter and Sacrificer's Staff, each opened by its own
 * triggers in a played rotation (small test kits) and closed after its duration.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation } from '../../'
import {
  parseRotation,
  type RotationActionKind,
} from '../../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type {
  HitElement,
  HitTag,
  KitModel,
  SimContext,
  SimGear,
} from '../../util/teamOpt/rotation/types'

type Script = Partial<Record<RotationActionKind, (ctx: SimContext) => void>>
/** A test kit: each action takes `frames` (by kind) and runs its script */
const kit = (
  characterKey: CharacterKey,
  element: HitElement,
  script: Script = {},
  frames: Partial<Record<RotationActionKind, number>> = {}
): KitModel => ({
  characterKey,
  element,
  source: 'test',
  act(ctx, _state, action) {
    script[action.kind]?.(ctx)
    return { frames: frames[action.kind] ?? 120 }
  },
})
/** Hits of the acting member, `delay` frames from now */
const hits = (
  ctx: SimContext,
  tag: HitTag,
  element: HitElement,
  delays: number[]
) => {
  for (const delay of delays)
    ctx.hit(delay, {
      path: [tag, `${delay}`],
      tag,
      element,
      label: tag,
    })
}
/** A reaction marker of the acting member, `delay` frames from now */
const reaction = (ctx: SimContext, name: string, delay: number) =>
  ctx.hit(delay, {
    path: ['_reaction', name],
    tag: 'other',
    element: 'physical',
    label: name,
  })

function play(
  text: string,
  kits: Partial<Record<CharacterKey, KitModel>>,
  gear: Partial<Record<CharacterKey, SimGear>>,
  burningAt?: (t: number) => boolean
) {
  const members = Object.keys(kits) as CharacterKey[]
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: Object.fromEntries(members.map((m) => [m, kits[m]!.element])),
    repeats: 1,
    keep: 'all',
    kits,
    reactions: { onHit() {}, ...(burningAt && { burningAt }) },
    gear,
  })
}
/** A conditional's windows with a value: [start, end, value] */
const windows = (sim: ReturnType<typeof play>, path: string) =>
  sim.buffWindows
    .filter((w) => w.path.join('.') === path && w.end > w.start && w.value)
    .map((w) => [w.start, w.end, w.value])
const markers = (sim: ReturnType<typeof play>, weapon: string) =>
  sim.hits
    .filter((h) => h.path.join('.') === `_marker.weaponEnergy.${weapon}`)
    .map((h) => [h.characterKey, h.t])

describe('Bloodsoaked Ruins', () => {
  it('Lunar-Charged DMG for 3.5 s after the wielder’s Burst', () => {
    const sim = play(
      'Flins Q',
      { Flins: kit('Flins', 'electro') },
      { Flins: { weapon: 'BloodsoakedRuins', refinement: 1 } }
    )
    expect(windows(sim, 'BloodsoakedRuins.afterBurst')).toEqual([
      [0, 210, 'on'],
    ])
  })
  it('CRIT DMG for 6 s and Energy once per 14 s after its own Lunar-Charged on the field', () => {
    const sim = play(
      'Flins E -> Ineffa E',
      {
        Flins: kit(
          'Flins',
          'electro',
          {
            skill: (ctx) => {
              reaction(ctx, 'lunarCharged', 30)
              reaction(ctx, 'lunarCharged', 400)
              // (lands with Ineffa on the field, after the Energy's cooldown: nothing)
              reaction(ctx, 'lunarCharged', 1000)
            },
          },
          { skill: 600 }
        ),
        Ineffa: kit('Ineffa', 'electro', {
          skill: (ctx) => reaction(ctx, 'lunarCharged', 10),
        }),
      },
      { Flins: { weapon: 'BloodsoakedRuins', refinement: 1 } }
    )
    expect(windows(sim, 'BloodsoakedRuins.afterLc')).toEqual([
      [30, 390, 'on'],
      [400, 760, 'on'],
    ])
    expect(markers(sim, 'BloodsoakedRuins')).toEqual([['Flins', 30]])
    expect(windows(sim, 'BloodsoakedRuins.afterBurst')).toEqual([])
  })
})

describe('Disaster and Remorse', () => {
  const gear = { Xiao: { weapon: 'DisasterAndRemorse', refinement: 1 } }
  it('3 s each after the Skill, extended by the other kind’s hits once per 0.1 s', () => {
    const sim = play(
      'Xiao E',
      {
        Xiao: kit(
          'Xiao',
          'anemo',
          {
            skill: (ctx) => {
              // Skill hits extend Unforgivable: 180 → 240 → 300 (the one at 12 is in the 0.1 s)
              hits(ctx, 'skill', 'anemo', [10, 12, 20])
              // Normal hits extend Irreparable: 180 → 240 → 300 → 360
              hits(ctx, 'normal', 'anemo', [100, 200, 260])
            },
          },
          { skill: 600 }
        ),
      },
      gear
    )
    expect(windows(sim, 'DisasterAndRemorse.unforgivable')).toEqual([
      [0, 300, 'on'],
    ])
    expect(windows(sim, 'DisasterAndRemorse.irreparable')).toEqual([
      [0, 360, 'on'],
    ])
  })
  it('ends with Path of Conflict (17 s) and keeps to its 18 s cooldown', () => {
    let first = true
    const sim = play(
      'Xiao E E',
      {
        Xiao: kit(
          'Xiao',
          'anemo',
          {
            skill: (ctx) => {
              if (!first) return
              first = false
              hits(
                ctx,
                'normal',
                'anemo',
                Array.from({ length: 50 }, (_, i) => 30 + 30 * i)
              )
            },
          },
          { skill: 600 }
        ),
      },
      gear
    )
    expect(windows(sim, 'DisasterAndRemorse.irreparable')).toEqual([
      [0, 1020, 'on'],
    ])
    // (the second Skill at 10 s is within 18 s: no new Path)
    expect(windows(sim, 'DisasterAndRemorse.unforgivable')).toEqual([
      [0, 180, 'on'],
    ])
  })
  it('both end when the wielder leaves the field', () => {
    const sim = play(
      'Xiao E -> Bennett E',
      {
        Xiao: kit('Xiao', 'anemo', {
          skill: (ctx) => {
            hits(ctx, 'normal', 'anemo', [30, 60, 90])
            hits(ctx, 'skill', 'anemo', [300])
          },
        }),
        Bennett: kit('Bennett', 'pyro'),
      },
      gear
    )
    const swap = sim.actions.find((a) => a.characterKey === 'Bennett')!.start
    expect(swap).toBeGreaterThan(120)
    expect(swap).toBeLessThan(180)
    expect(windows(sim, 'DisasterAndRemorse.unforgivable')).toEqual([
      [0, swap, 'on'],
    ])
    expect(windows(sim, 'DisasterAndRemorse.irreparable')).toEqual([
      [0, swap, 'on'],
    ])
  })
})

describe('Lumidouce Elegy', () => {
  const gear = { Emilie: { weapon: 'LumidouceElegy', refinement: 1 } }
  it('a stack per Burning it triggers, 8 s, Energy at 2 stacks once per 12 s', () => {
    const sim = play(
      'Emilie E -> Bennett E',
      {
        Emilie: kit('Emilie', 'dendro', {
          skill: (ctx) => {
            reaction(ctx, 'burning', 0)
            reaction(ctx, 'burning', 100)
            // (off the field too)
            reaction(ctx, 'burning', 300)
          },
        }),
        // (a teammate's Burning: none)
        Bennett: kit('Bennett', 'pyro', {
          skill: (ctx) => reaction(ctx, 'burning', 700),
        }),
      },
      gear
    )
    expect(windows(sim, 'LumidouceElegy.stacks')).toEqual([
      [0, 100, '1'],
      // (a refresh at 2 stacks keeps the state: one window, to 8 s from the last)
      [100, 780, '2'],
    ])
    expect(markers(sim, 'LumidouceElegy')).toEqual([['Emilie', 100]])
  })
  it('a stack per Dendro hit on a Burning enemy, after the hit itself', () => {
    const sim = play(
      'Emilie E',
      {
        Emilie: kit(
          'Emilie',
          'dendro',
          {
            skill: (ctx) => {
              hits(ctx, 'skill', 'dendro', [100, 600, 650])
              hits(ctx, 'skill', 'pyro', [700])
            },
          },
          { skill: 900 }
        ),
      },
      gear,
      (t) => t >= 500
    )
    expect(windows(sim, 'LumidouceElegy.stacks')).toEqual([
      [600, 650, '1'],
      [650, 1130, '2'],
    ])
    const own = (t: number) =>
      sim.hits
        .find((h) => h.t === t && h.tag === 'skill')!
        .states?.find((s) => s.path.join('.') === 'LumidouceElegy.stacks')
        ?.value
    expect(own(600)).toBe('')
    expect(own(650)).toBe('1')
  })
})

/** A Rosaria with `weapon` (Team optimize's build), for the attacks the simulation makes */
function rosaria(weapon: string) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set('Rosaria', {
    key: 'Rosaria',
    level: 90,
    ascension: 6,
    constellation: 0,
    talent: { auto: 9, skill: 9, burst: 9 },
  })
  const teamCharId = db.teamChars.new('Rosaria', {})
  const buildTcId = db.buildTcs.new({
    characterKey: 'Rosaria',
    character: {
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 9, skill: 9, burst: 9 },
    },
    weapon: { key: weapon, level: 90, ascension: 6, refinement: 5 },
    artifact: {
      slots: {},
      substats: { type: 'max', stats: {}, rarity: 5 },
      sets: {},
    },
  } as never)
  const teamId = db.teams.new({
    loadoutData: [{ teamCharId, buildType: 'tc', buildTcId }] as LoadoutDatum[],
  } as never)
  return { db, teamId }
}

describe('Crescent Pike', () => {
  const pike = (weapon: string) =>
    play(
      'Rosaria E N1',
      {
        Rosaria: kit(
          'Rosaria',
          'cryo',
          {
            // (its first hit makes the particles: picked up 100 frames later, at 110)
            skill: (ctx) => hits(ctx, 'skill', 'cryo', [10, 20]),
            // (from 60: Normal hits at 80, 160, 400 and 420, a Charged one at 200, a Skill one at 300)
            normal: (ctx) => {
              hits(ctx, 'normal', 'physical', [20, 100, 340, 360])
              hits(ctx, 'charged', 'physical', [140])
              hits(ctx, 'skill', 'cryo', [240])
            },
          },
          { skill: 60, normal: 600 }
        ),
      },
      { Rosaria: { weapon, refinement: 5 } }
    )
  it('a Physical hit after each Normal or Charged hit for 5 s from a particle pickup', () => {
    const sim = pike('CrescentPike')
    const procs = sim.hits.filter((h) => h.path[0] === 'weapon:CrescentPike')
    // (5 s from 110: to 410)
    expect(procs.map((h) => h.t)).toEqual([161, 201, 401])
    expect(procs[0].path).toEqual(['weapon:CrescentPike', 'hit'])
    expect(procs[0].element).toBe('physical')
  })
  it('is an attack Team optimize counts, for the build holding it only', () => {
    const sim = pike('CrescentPike')
    const attack = rotationAttacks(sim, () => undefined).Rosaria!.find(
      (a) => a.path[0] === 'weapon:CrescentPike'
    )!
    expect(attack.hits).toBe(3)
    const held = rosaria('CrescentPike')
    expect(
      evaluateTeamRotation(held.db, held.teamId, 'F', {
        arts: {},
        attacks: { Rosaria: [attack] },
      })!.total
    ).toBeGreaterThan(0)
    const other = rosaria('Deathmatch')
    expect(
      evaluateTeamRotation(other.db, other.teamId, 'F', {
        arts: {},
        attacks: { Rosaria: [attack] },
      })?.total ?? 0
    ).toBe(0)
  })
  it('is not played for another polearm', () => {
    expect(
      pike('Deathmatch').hits.some((h) => h.path[0].startsWith('weapon:'))
    ).toBe(false)
  })
})

describe('Footprint of the Rainbow', () => {
  it('DEF for 15 s after the Skill, refreshed by the next', () => {
    const sim = play(
      'Rosaria E E',
      { Rosaria: kit('Rosaria', 'cryo', {}, { skill: 600 }) },
      { Rosaria: { weapon: 'FootprintOfTheRainbow', refinement: 1 } }
    )
    expect(windows(sim, 'FootprintOfTheRainbow.afterSkill')).toEqual([
      [0, 1500, 'on'],
    ])
  })
})

describe('Mountain-Bracing Bolt', () => {
  it('Skill DMG for 8 s after another member’s Skill, not its own', () => {
    const sim = play(
      'Bennett E -> Rosaria E',
      {
        Bennett: kit('Bennett', 'pyro'),
        Rosaria: kit('Rosaria', 'cryo'),
      },
      { Rosaria: { weapon: 'MountainBracingBolt', refinement: 1 } }
    )
    expect(windows(sim, 'MountainBracingBolt.afterOtherSkill')).toEqual([
      [0, 480, 'on'],
    ])
  })
})

describe('Prototype Starglitter', () => {
  it('a stack per Skill, up to 2, all refreshed, 12 s', () => {
    const sim = play(
      'Rosaria E E',
      { Rosaria: kit('Rosaria', 'cryo', {}, { skill: 300 }) },
      { Rosaria: { weapon: 'PrototypeStarglitter', refinement: 1 } }
    )
    expect(windows(sim, 'PrototypeStarglitter.stack')).toEqual([
      [0, 300, '1'],
      [300, 1020, '2'],
    ])
  })
})

describe('Sacrificer’s Staff', () => {
  it('a stack per Skill hit, up to 3, 6 s, off the field too', () => {
    const sim = play(
      'Rosaria E -> Bennett E',
      {
        Rosaria: kit('Rosaria', 'cryo', {
          skill: (ctx) => hits(ctx, 'skill', 'cryo', [10, 20, 30, 40, 1000]),
        }),
        Bennett: kit('Bennett', 'pyro'),
      },
      { Rosaria: { weapon: 'SacrificersStaff', refinement: 1 } }
    )
    expect(windows(sim, 'SacrificersStaff.passive')).toEqual([
      [10, 20, '1'],
      [20, 30, '2'],
      // (a refresh at 3 stacks keeps the state: one window, to 6 s from the last)
      [30, 400, '3'],
      [1000, 1360, '1'],
    ])
  })
})
