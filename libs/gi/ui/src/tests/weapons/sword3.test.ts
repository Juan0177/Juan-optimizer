/**
 * Weapon audit batch sword3 (rotation/weapons/sword3): each weapon's window, stacks or proc
 * opened by its wielder's own triggers in the simulation, closed after its duration or held back
 * by its cooldown (kqmsim, or the game's text where kqmsim has none), and the sheet fixes.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import { simulateRotation } from '../../util/teamOpt/rotation/simulate'
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
  healTargets?: CharacterKey[]
}
/** A test kit: each action kind lands its hits at frames from its start and lasts `frames` */
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
        ...(h.healTargets && { healTargets: h.healTargets }),
      } as Omit<SimHit, 't' | 'characterKey' | 'onField'>)
    return { frames: s.frames }
  },
})

const ELEMENTS: Partial<Record<CharacterKey, string>> = {
  Xiangling: 'pyro',
  Bennett: 'pyro',
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
    elements: Object.fromEntries(members.map((m) => [m, ELEMENTS[m]])),
    repeats: 1,
    kits,
    reactions: { onHit() {} },
    gear,
  })
}
/**
 * A conditional's opened windows: [start, end] or [start, end, value] (not the off state between
 * them, a window with value '', nor its declaration)
 */
const windows = (
  sim: ReturnType<typeof play>,
  path: string,
  owner: CharacterKey = 'Xiangling',
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
  owner: CharacterKey = 'Xiangling'
) =>
  sim.buffWindows.some(
    (w) => w.owner === owner && w.path.join('.') === path && w.end === w.start
  )
const wear = (weapon: string, refinement = 1): SimGear => ({
  weapon,
  refinement,
})

describe('Athame Artis', () => {
  it('3 s after each Burst hit, refreshed by the next, from the next hit on', () => {
    const sim = play(
      'Xiangling N1 Q W8 Q',
      {
        Xiangling: kit('Xiangling', 'pyro', {
          normal: { hits: [{ at: 5 }], frames: 20 },
          burst: { hits: [{ at: 10 }, { at: 100 }], frames: 60 },
        }),
      },
      { Xiangling: wear('AthameArtis') }
    )
    // (Bursts at 20 and 560: hits at 30 and 120, then 570 and 660; the Normal hit opens nothing)
    expect(windows(sim, 'AthameArtis.burstHit')).toEqual([
      [31, 301],
      [571, 841],
    ])
    expect(declared(sim, 'AthameArtis.burstHit')).toBe(true)
  })
})

describe('Freedom-Sworn', () => {
  it('two Sigils from the wielder’s reactions (0.5 s apart) give the party 12 s, then 20 s without', () => {
    const sim = play(
      'Xiangling E W30',
      {
        Xiangling: kit('Xiangling', 'pyro', {
          skill: {
            hits: [
              { at: 0, path: ['_reaction', 'vaporize'], tag: 'other' },
              // (within the 0.5 s Sigil cooldown: none)
              { at: 10, path: ['_reaction', 'melt'], tag: 'other' },
              // (Moondrift is no reaction for it)
              { at: 35, path: ['_reaction', 'moondrift'], tag: 'other' },
              { at: 40, path: ['_reaction', 'overloaded'], tag: 'other' },
              // (in the 20 s cooldown: none)
              { at: 900, path: ['_reaction', 'melt'], tag: 'other' },
              { at: 1000, path: ['_reaction', 'melt'], tag: 'other' },
              // (after it: Hyperbloom's damage counts, it has no marker)
              { at: 1300, path: ['_reaction', 'quicken'], tag: 'other' },
              {
                at: 1340,
                path: ['reaction', 'hyperbloom'],
                tag: 'other',
                element: 'dendro',
              },
            ],
            frames: 60,
          },
        }),
        Bennett: kit('Bennett', 'pyro', {}),
      },
      { Xiangling: wear('FreedomSworn') }
    )
    expect(windows(sim, 'FreedomSworn.MillennialMovement')).toEqual([
      [40, 760],
      [1340, 2060],
    ])
  })
  it('a teammate’s reactions give no Sigil', () => {
    const sim = play(
      'Bennett E W30',
      {
        Xiangling: kit('Xiangling', 'pyro', {}),
        Bennett: kit('Bennett', 'pyro', {
          skill: {
            hits: [
              { at: 0, path: ['_reaction', 'vaporize'], tag: 'other' },
              { at: 60, path: ['_reaction', 'vaporize'], tag: 'other' },
            ],
            frames: 60,
          },
        }),
      },
      { Xiangling: wear('FreedomSworn') }
    )
    expect(windows(sim, 'FreedomSworn.MillennialMovement')).toEqual([])
    expect(declared(sim, 'FreedomSworn.MillennialMovement')).toBe(true)
  })
})

describe('Lightbearing Moonshard', () => {
  it('5 s after each Skill', () => {
    const sim = play(
      'Xiangling E W5 E W10',
      {
        Xiangling: kit('Xiangling', 'geo', {
          skill: { hits: [{ at: 10 }], frames: 60 },
        }),
      },
      { Xiangling: wear('LightbearingMoonshard') }
    )
    expect(windows(sim, 'LightbearingMoonshard.passive')).toEqual([
      [0, 300],
      [360, 660],
    ])
  })
})

describe('Skyward Blade', () => {
  const rotation = 'Xiangling Q N3 W12 N3'
  /** The attack speed each Normal Attack string starts with */
  const speeds: number[] = []
  const base = kit('Xiangling', 'pyro', {
    burst: { hits: [{ at: 30 }], frames: 60 },
    normal: {
      hits: [{ at: 10 }, { at: 25 }, { at: 40 }],
      frames: 50,
    },
  })
  const kits = {
    Xiangling: {
      ...base,
      act(ctx, state, action, previous) {
        if (action.kind === 'normal') speeds.push(ctx.attackSpeed)
        return base.act(ctx, state, action, previous)
      },
    } as KitModel,
  }
  it('12 s of Skypiercing Might after the Burst: a proc per Normal hit in it, ATK SPD +10%', () => {
    speeds.length = 0
    const sim = play(rotation, kits, { Xiangling: wear('SkywardBlade') })
    expect(windows(sim, 'SkywardBlade.SkyPiercingMight')).toEqual([[0, 720]])
    const procs = sim.hits.filter((h) => h.path[0] === 'weapon:SkywardBlade')
    // (the first string's 3 hits; the second one, after 12 s, none)
    expect(procs.map((h) => h.t)).toEqual([70, 85, 100])
    expect(procs[0].path).toEqual(['weapon:SkywardBlade', 'dmg'])
    expect(procs.every((h) => h.element === 'physical')).toBe(true)
    expect(speeds).toEqual([0.1, 0])
  })
  it('a KQM candidate opens its window but plays no proc nor speed', () => {
    speeds.length = 0
    const sim = play(rotation, kits, {
      Xiangling: { weapon: 'Other', candidates: { weapons: ['SkywardBlade'] } },
    })
    expect(windows(sim, 'SkywardBlade.SkyPiercingMight')).toEqual([[0, 720]])
    expect(sim.hits.some((h) => h.path[0] === 'weapon:SkywardBlade')).toBe(
      false
    )
    expect(speeds).toEqual([0, 0])
  })
})

describe('Whitelake Frostfeather', () => {
  it('a stack per Skill hit (0.1 s apart), each 8 s on its own', () => {
    const sim = play(
      'Xiangling N1 E',
      {
        Xiangling: kit('Xiangling', 'cryo', {
          normal: { hits: [{ at: 1 }], frames: 10 },
          skill: {
            hits: [{ at: 5 }, { at: 8 }, { at: 20 }, { at: 40 }],
            frames: 60,
          },
        }),
      },
      { Xiangling: wear('WhitelakeFrostfeather') }
    )
    // (Skill from 10: hits at 15, 18 (in the 0.1 s cooldown), 30, 50; the Normal hit none)
    expect(windows(sim, 'WhitelakeFrostfeather.passive')).toEqual([
      [15, 495],
      [30, 510],
      [50, 530],
    ])
  })
})

describe('Cinnabar Spindle', () => {
  it('Skill hits within 0.1 s of a window’s first, the next window 1.5 s after it closes', () => {
    const sim = play(
      'Xiangling E',
      {
        Xiangling: kit('Xiangling', 'geo', {
          skill: {
            hits: [0, 3, 10, 50, 96, 100, 150, 192].map((at) => ({ at })),
            frames: 240,
          },
        }),
      },
      { Xiangling: wear('CinnabarSpindle') }
    )
    const states = sim.hits
      .filter((h) => h.tag === 'skill')
      .map((h) => [
        h.t,
        h.states?.find(
          (s) => s.path.join('.') === 'CinnabarSpindle.SpotlessHeart'
        )?.value,
      ])
    expect(states).toEqual([
      [0, 'on'],
      [3, 'on'],
      [10, ''],
      [50, ''],
      [96, 'on'],
      [100, 'on'],
      [150, ''],
      [192, 'on'],
    ])
  })
})

describe('Finale of the Deep', () => {
  it('15 s of ATK after a Skill, once per 10 s', () => {
    const sim = play(
      'Xiangling E W5 E W20 E W20',
      {
        Xiangling: kit('Xiangling', 'pyro', {
          skill: { hits: [{ at: 10 }], frames: 60 },
        }),
      },
      { Xiangling: wear('FinaleOfTheDeep') }
    )
    // (the Skill at 6 s is in the 10 s cooldown: it does not extend the first window)
    expect(windows(sim, 'FinaleOfTheDeep.afterSkill')).toEqual([
      [0, 900],
      [1620, 2520],
    ])
    // (no heal: its Bond of Life is never cleared)
    expect(declared(sim, 'FinaleOfTheDeep.bond')).toBe(true)
    expect(windows(sim, 'FinaleOfTheDeep.bond')).toEqual([])
  })

  it('the first heal after the Skill clears its Bond: flat ATK for 15 s, once per Bond', () => {
    const sim = play(
      'Xiangling E N1 N1 W20',
      {
        Xiangling: kit('Xiangling', 'pyro', {
          skill: { hits: [], frames: 60 },
          normal: {
            hits: [
              {
                at: 5,
                path: ['_heal', 'burst', 'heal'],
                tag: 'other',
                healTargets: ['Xiangling'],
              },
            ],
            frames: 20,
          },
        }),
      },
      { Xiangling: wear('FinaleOfTheDeep') }
    )
    expect(windows(sim, 'FinaleOfTheDeep.bond')).toEqual([[65, 965]])
  })
})

describe('Iron Sting', () => {
  it('Elemental DMG on the field: a stack per 1 s, 6 s, refreshing both, up to 2', () => {
    const sim = play(
      'Xiangling N5 W12 E W10',
      {
        Xiangling: kit('Xiangling', 'pyro', {
          skill: { hits: [{ at: 0 }], frames: 30 },
          normal: {
            hits: [
              { at: 0 },
              { at: 30 },
              { at: 70 },
              { at: 140 },
              { at: 300, element: 'physical' },
            ],
            frames: 310,
          },
        }),
      },
      { Xiangling: wear('IronSting') }
    )
    // (the Skill's hit at 1030 starts a new count: the stacks expired at 501)
    expect(
      windows(sim, 'IronSting.InfusionStinger', 'Xiangling', true)
    ).toEqual([
      // (the refresh at 141 keeps 2 stacks: one window to 501)
      [1, 71, '1'],
      [71, 501, '2'],
      [1031, 1391, '1'],
    ])
  })
  it('not from the wielder’s hits off the field', () => {
    const sim = play(
      'Bennett E -> Xiangling W10',
      {
        Bennett: kit('Bennett', 'pyro', {
          skill: { hits: [{ at: 5 }, { at: 300 }], frames: 60 },
        }),
        Xiangling: kit('Xiangling', 'pyro', {}),
      },
      { Bennett: wear('IronSting') }
    )
    expect(windows(sim, 'IronSting.InfusionStinger', 'Bennett', true)).toEqual([
      [6, 366, '1'],
    ])
  })
})

describe('New Bough', () => {
  it('hits within 12 s of a Skill: a stack per 1 s, 6 s, up to 3', () => {
    const sim = play(
      'Xiangling E N1 W12 N1',
      {
        Xiangling: kit('Xiangling', 'dendro', {
          skill: { hits: [{ at: 10 }], frames: 60 },
          normal: {
            hits: [{ at: 10 }, { at: 30 }, { at: 70 }],
            frames: 80,
          },
        }),
      },
      { Xiangling: wear('NewBough') }
    )
    // (Skill hit at 10, Normal hits at 70, 90 (cooldown), 130; the next Normals after 12 s none)
    expect(windows(sim, 'NewBough.passive', 'Xiangling', true)).toEqual([
      [11, 71, '1'],
      [71, 131, '2'],
      [131, 491, '3'],
    ])
  })
})

describe('Sword of Descension', () => {
  it('a 50% chance per Normal hit on the field: a proc per second hit, then 10 s of cooldown', () => {
    const sim = play(
      'Xiangling N2 W10 N2 N2',
      {
        Xiangling: kit('Xiangling', 'pyro', {
          normal: { hits: [{ at: 10 }, { at: 30 }], frames: 60 },
        }),
      },
      { Xiangling: wear('SwordOfDescension') }
    )
    const procs = sim.hits.filter(
      (h) => h.path[0] === 'weapon:SwordOfDescension'
    )
    expect(procs.map((h) => h.t)).toEqual([30, 690])
    expect(procs[0].path).toEqual(['weapon:SwordOfDescension', 'dmg_'])
  })
})

describe('The Dockhand’s Assistant', () => {
  it('Symbols from heals, consumed by its Skill: EM per Symbol for 10 s, once per 15 s', () => {
    const sim = play(
      'Xiangling N1 E W5 E N1 W12 E',
      {
        Xiangling: kit('Xiangling', 'pyro', {
          // (a heal of the whole party by the wielder: a Symbol per member healed, up to 3)
          normal: {
            hits: [
              {
                at: 5,
                path: ['_heal', 'skill', 'heal'],
                tag: 'other',
                healTargets: ['Xiangling', 'Bennett'],
              },
            ],
            frames: 20,
          },
          skill: { hits: [], frames: 60 },
        }),
        Bennett: kit('Bennett', 'pyro', {}),
      },
      { Xiangling: wear('TheDockhandsAssistant') }
    )
    // (N1 at 0: 2 Symbols at 5, the Skill at 20 consumes them; the Skill at 380 has none; N1 at
    // 440: 2 more, consumed by the Skill at 1180, past the 15 s cooldown)
    expect(
      windows(sim, 'TheDockhandsAssistant.symbolsConsumed', 'Xiangling', true)
    ).toEqual([
      [20, 620, '2'],
      [1180, 1780, '2'],
    ])
  })
})

describe('sheet fixes', () => {
  /** Whether a formula reads `path` anywhere inside it */
  const reads = (node: unknown, path: string, seen = new Set<unknown>()) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return false
    seen.add(node)
    const n = node as { operation?: string; path?: string[] }
    if (n.operation === 'read' && n.path?.join('.') === path) return true
    return Object.values(node).some((v) => reads(v, path, seen))
  }
  it.each([
    ['SkywardBlade', 'dmg'],
    ['SwordOfDescension', 'dmg_'],
  ] as const)('%s’s proc scales from total ATK', (key, node) => {
    const display = getWeaponSheet(key).data.display?.[`weapon:${key}`] as
      | Record<string, unknown>
      | undefined
    expect(reads(display?.[node], 'total.atk')).toBe(true)
    expect(reads(display?.[node], 'premod.atk')).toBe(false)
  })
  it('The Dockhand’s Assistant’s EM is its own, not a team buff', () => {
    expect(
      getWeaponSheet('TheDockhandsAssistant').document.some(
        (d) => (d as { teamBuff?: boolean }).teamBuff
      )
    ).toBe(false)
  })
  it('Finale of the Deep’s Bond ATK cap is flat ATK, not shown as a percentage', () => {
    const subscripts: { list?: number[]; info?: { unit?: string } }[] = []
    const walk = (node: unknown, seen = new Set<unknown>()) => {
      if (!node || typeof node !== 'object' || seen.has(node)) return
      seen.add(node)
      const n = node as { operation?: string }
      if (n.operation === 'subscript') subscripts.push(node as never)
      for (const v of Object.values(node)) walk(v, seen)
    }
    walk(
      (
        getWeaponSheet('FinaleOfTheDeep').data.display?.[
          'weapon:FinaleOfTheDeep'
        ] as Record<string, unknown>
      )?.bond_atk
    )
    const cap = subscripts.find((s) => s.list?.includes(150))
    expect(cap).toBeTruthy()
    expect(cap?.info?.unit).not.toBe('%')
    // (its 2.4% of the Bond stays a percentage)
    expect(subscripts.find((s) => s.list?.includes(0.024))?.info?.unit).toBe(
      '%'
    )
  })
})
