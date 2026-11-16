import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { computeUIData } from '@genshin-optimizer/gi/uidata'
import { constant, type Data, type NumNode } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import { elementalReactions } from '../../util/teamOpt/rotation/reactions'
import {
  type RotationReactions,
  rotationAttacks,
  type SimulationResult,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type {
  KitModel,
  SimContext,
  SimGear,
} from '../../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['Razor', 'Bennett']
type Hit = Parameters<SimContext['hit']>[1]
const normal = (label: string, extra: Partial<Hit> = {}): Hit => ({
  path: ['normal', '0'],
  tag: 'normal',
  element: 'physical',
  label,
  ...extra,
})
const mark = (reaction: string, extra: Partial<Hit> = {}): Hit =>
  normal(reaction, {
    path: ['_reaction', reaction],
    tag: 'other',
    ...extra,
  })
/** A reaction event as the simulation makes it: a mark, or (Hyperbloom, Burgeon) its damage */
const reactionEvent = (reaction: string, extra: Partial<Hit> = {}): Hit =>
  reaction === 'burgeon' || reaction === 'hyperbloom'
    ? normal(reaction, { path: ['reaction', reaction], tag: 'other', ...extra })
    : mark(reaction, extra)
const probe = (ctx: SimContext, times: number[]) => {
  for (const t of times)
    ctx.hit(t, normal(`${t}`, { path: ['burst', 'probe'], tag: 'burst' }))
}
function run(
  weapon: string,
  script: (ctx: SimContext) => void,
  {
    frames = 2100,
    text = 'Razor Q',
    refinement = 1,
    candidate = false,
    reactions = { onHit() {} } as RotationReactions,
  } = {}
) {
  const kits: Partial<Record<CharacterKey, KitModel>> = {
    Razor: {
      characterKey: 'Razor',
      element: 'electro',
      source: 'test',
      act(ctx) {
        script(ctx)
        return { frames }
      },
    },
    Bennett: {
      characterKey: 'Bennett',
      element: 'pyro',
      source: 'test',
      act: () => ({ frames: 2100 }),
    },
  }
  const gear: SimGear = candidate
    ? { weapon: 'WasterGreatsword', candidates: { weapons: [weapon] } }
    : { weapon, refinement }
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Razor: 'electro', Bennett: 'pyro' },
    kits,
    gear: { Razor: gear },
    repeats: 1,
    keep: 'all',
    reactions,
  })
}
function state(
  sim: SimulationResult,
  label: string,
  weapon: string,
  cond: string,
  actor: CharacterKey = 'Razor'
) {
  return (
    rotationAttacks(sim)
      [actor]?.find((a) => a.description === label)
      ?.states?.find((s) => s.path.join('.') === `${weapon}.${cond}`)?.value ??
    ''
  )
}
const states = (
  sim: SimulationResult,
  times: number[],
  weapon: string,
  cond: string
) => times.map((t) => state(sim, `${t}`, weapon, cond))

function sheetStat(weapon: string, stat: string, context: Data) {
  const data = (getWeaponSheet(weapon as never) as unknown as { data: Data })
    .data
  return computeUIData([context]).get(
    (data.premod as Record<string, NumNode>)[stat]
  ).value
}

describe('Gest of the Mighty Wolf', () => {
  it('retains the refinement tables and gates only CRIT DMG on Secret Rite', () => {
    for (const [r, expected] of [
      [1, 0.3],
      [5, 0.62],
    ]) {
      const context = (hexerei: number): Data => ({
        weapon: { refinement: constant(r) },
        tally: { hexerei: constant(hexerei) },
        conditional: { GestOfTheMightyWolf: { stacks: constant('4') } },
      })
      expect(
        sheetStat('GestOfTheMightyWolf', 'all_dmg_', context(0))
      ).toBeCloseTo(expected)
      expect(sheetStat('GestOfTheMightyWolf', 'critDMG_', context(0))).toBe(0)
      expect(
        sheetStat('GestOfTheMightyWolf', 'critDMG_', context(2))
      ).toBeCloseTo(expected)
    }
  })

  it('has unconditional 10% speed at every refinement and no stacks initially', () => {
    for (const r of [1, 5])
      expect(
        sheetStat('GestOfTheMightyWolf', 'atkSPD_', {
          weapon: { refinement: constant(r) },
        })
      ).toBeCloseTo(0.1)
    const sim = run('GestOfTheMightyWolf', (ctx) => probe(ctx, [1]))
    expect(state(sim, '1', 'GestOfTheMightyWolf', 'stacks')).toBe('')
  })

  it('gains one per Normal hit after damage, caps four and refreshes all for 4 s', () => {
    const sim = run('GestOfTheMightyWolf', (ctx) => {
      for (const t of [10, 20, 30, 40, 50]) ctx.hit(t, normal(`N${t}`))
      probe(ctx, [11, 21, 51, 289, 290, 301])
    })
    expect(state(sim, 'N10', 'GestOfTheMightyWolf', 'stacks')).toBe('')
    expect(state(sim, 'N20', 'GestOfTheMightyWolf', 'stacks')).toBe('1')
    expect(
      states(sim, [11, 21, 51, 289, 290, 301], 'GestOfTheMightyWolf', 'stacks')
    ).toEqual(['1', '2', '4', '4', '', ''])
  })

  it('gains two on Skill/Charged starts, shares the text ICD and resets after a gap', () => {
    const sim = run(
      'GestOfTheMightyWolf',
      (ctx) => {
        ctx.hit(0, normal('same frame'))
        probe(ctx, [1, 241])
      },
      { text: 'Razor E CA', frames: 300 }
    )
    expect(state(sim, '1', 'GestOfTheMightyWolf', 'stacks')).toBe('2')
    const windows = sim.buffWindows.filter(
      (w) => w.path.join('.') === 'GestOfTheMightyWolf.stacks' && w.value
    )
    expect(windows.filter((w) => w.end > w.start).map((w) => w.value)).toEqual([
      '2',
      '2',
    ])
  })

  it('starts a new stack at exact expiry even when the hit was queued before the expiry task', () => {
    const sim = run('GestOfTheMightyWolf', (ctx) => {
      ctx.hit(10, normal('First'))
      ctx.hit(250, normal('At expiry'))
      probe(ctx, [251])
    })
    expect(state(sim, 'At expiry', 'GestOfTheMightyWolf', 'stacks')).toBe('')
    expect(state(sim, '251', 'GestOfTheMightyWolf', 'stacks')).toBe('1')
  })

  it('changes action timing only when worn, but opens a candidate’s stat windows', () => {
    const play = (candidate: boolean) =>
      simulateRotation({
        rotation: parseRotation('Razor N4 N4', [
          { characterKey: 'Razor', name: 'Razor' },
        ]),
        members: ['Razor'],
        elements: { Razor: 'electro' },
        constellations: {},
        gear: {
          Razor: candidate
            ? {
                weapon: 'WasterGreatsword',
                candidates: { weapons: ['GestOfTheMightyWolf'] },
              }
            : { weapon: 'GestOfTheMightyWolf' },
        },
        repeats: 1,
        keep: 'all',
      })
    const worn = play(false)
    const candidate = play(true)
    expect(worn.frames).toBeLessThan(candidate.frames)
    expect(
      candidate.buffWindows.some(
        (w) => w.path[1] === 'stacks' && w.value === '4'
      )
    ).toBe(true)
  })
})

describe('Song of Broken Pines', () => {
  it('builds four Sigils, rejects early hits, expires Banner-Hymn and locks gains for 20 s', () => {
    const sim = run('SongOfBrokenPines', (ctx) => {
      for (const t of [
        10, 11, 28, 46, 64, 100, 200, 300, 400, 1263, 1264, 1282, 1300, 1318,
      ])
        ctx.hit(t, normal(`N${t}`, { tag: t === 46 ? 'charged' : 'normal' }))
      probe(ctx, [63, 65, 783, 784, 1200, 1319])
    })
    expect(
      states(
        sim,
        [63, 65, 783, 784, 1200, 1319],
        'SongOfBrokenPines',
        'RebelsBannerHymn'
      )
    ).toEqual(['', 'on', 'on', '', '', 'on'])
    expect(state(sim, 'N64', 'SongOfBrokenPines', 'RebelsBannerHymn')).toBe('')
    const speed = sim.buffWindows.filter(
      (w) => w.path[1] === '_normalAttackSpeed' && w.start === 64
    )
    expect(speed.map((w) => w.recipient).sort()).toEqual(['Bennett', 'Razor'])
    expect(Number(speed[0].value)).toBeCloseTo(0.12)
  })

  it('uses each recipient’s hitlag, persists on swap, and gives teammates the buff', () => {
    const sim = run(
      'SongOfBrokenPines',
      (ctx) => {
        for (const t of [10, 28, 46, 64]) ctx.hit(t, normal(`N${t}`))
        ctx.hit(
          100,
          normal('Pause', {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            animationPause: 20,
          })
        )
        probe(ctx, [790, 805])
        ctx.hit(
          790,
          normal('Bennett late', { characterKey: 'Bennett', tag: 'burst' })
        )
      },
      { text: 'Razor Q -> Bennett E', frames: 120 }
    )
    expect(
      states(sim, [790, 805], 'SongOfBrokenPines', 'RebelsBannerHymn')
    ).toEqual(['on', ''])
    expect(
      state(
        sim,
        'Bennett late',
        'SongOfBrokenPines',
        'RebelsBannerHymn',
        'Bennett'
      )
    ).toBe('')
  })
})

describe('Song of Broken Pines speed', () => {
  it('speeds up Normals after Banner-Hymn only when worn', () => {
    const play = (gear: SimGear) =>
      simulateRotation({
        rotation: parseRotation('Razor N4 N4 N4', [
          { characterKey: 'Razor', name: 'Razor' },
        ]),
        members: ['Razor'],
        elements: { Razor: 'electro' },
        constellations: {},
        gear: { Razor: gear },
        repeats: 1,
        keep: 'all',
      })
    const worn = play({ weapon: 'SongOfBrokenPines', refinement: 5 })
    const base = play({
      weapon: 'WasterGreatsword',
      candidates: { weapons: ['SongOfBrokenPines'] },
    })
    // (the first string builds the Sigils at the old speed; the later ones are faster)
    expect(worn.actions[0].frames).toBe(base.actions[0].frames)
    expect(worn.actions[2].frames).toBeLessThan(base.actions[2].frames)
    expect(
      base.buffWindows.some(
        (w) => w.path.join('.') === 'SongOfBrokenPines.RebelsBannerHymn'
      )
    ).toBe(true)
  })
})

describe('Verdict', () => {
  it('gains party Lunar-Crystallize Seals with a 1 s ICD and clears 12 frames after the first Skill hit', () => {
    const sim = run('Verdict', (ctx) => {
      for (const t of [0, 10, 60, 122])
        ctx.hit(t, mark('lunarCrystallize', { characterKey: 'Bennett' }))
      for (const t of [120, 125, 131, 132])
        ctx.hit(t, normal(`E${t}`, { path: ['skill', 'press'], tag: 'skill' }))
      probe(ctx, [1, 11, 61, 133, 1000])
    })
    expect(states(sim, [1, 11, 61, 133, 1000], 'Verdict', 'seals')).toEqual([
      '1',
      '1',
      '2',
      '',
      '',
    ])
    for (const t of [120, 125, 131])
      expect(state(sim, `E${t}`, 'Verdict', 'seals')).toBe('2')
    expect(state(sim, 'E132', 'Verdict', 'seals')).toBe('')
  })

  it('requires actual shard pickup, refreshes a 15 s status and ignores other shields', () => {
    const sim = run('Verdict', (ctx) => {
      ctx.hit(0, mark('crystallize', { element: 'pyro' }))
      ctx.hit(
        5,
        normal('Other shield', {
          path: ['_marker', 'shield', '900', '', 'skill'],
          tag: 'other',
        })
      )
      for (const t of [10, 500])
        ctx.hit(
          t,
          normal('Pickup', {
            path: ['_marker', 'shield', '900', '', 'crystallize'],
            tag: 'other',
            characterKey: 'Bennett',
          })
        )
      probe(ctx, [1, 6, 11, 501, 1399, 1400])
    })
    expect(
      states(sim, [1, 6, 11, 501, 1399, 1400], 'Verdict', 'seals')
    ).toEqual(['', '', '1', '2', '2', ''])
  })

  it('uses wearer hitlag for delayed consumption and grants candidate Seals', () => {
    const sim = run(
      'Verdict',
      (ctx) => {
        ctx.hit(0, mark('lunarCrystallize'))
        ctx.hit(10, normal('Skill', { tag: 'skill' }))
        ctx.hit(
          15,
          normal('Pause', {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            animationPause: 10,
          })
        )
        probe(ctx, [31, 32])
      },
      { candidate: true }
    )
    expect(states(sim, [31, 32], 'Verdict', 'seals')).toEqual(['1', ''])
  })

  it('starts at one Seal when a pickup lands at the old status’s exact expiry', () => {
    const sim = run('Verdict', (ctx) => {
      for (const t of [10, 910])
        ctx.hit(
          t,
          normal('Pickup', {
            path: ['_marker', 'shield', '900', '', 'crystallize'],
            tag: 'other',
          })
        )
      probe(ctx, [911])
    })
    expect(state(sim, '911', 'Verdict', 'seals')).toBe('1')
  })
})

describe('Earth Shaker', () => {
  it.each([
    'overloaded',
    'vaporize',
    'melt',
    'pyroSwirl',
    'burning',
    'burgeon',
    'crystallize',
  ])('triggers from a teammate’s %s, refreshes and expires on the wielder clock', (reaction) => {
    const sim = run('EarthShaker', (ctx) => {
      for (const t of [10, 100])
        ctx.hit(
          t,
          reactionEvent(reaction, { characterKey: 'Bennett', element: 'pyro' })
        )
      ctx.hit(
        200,
        normal('Pause', {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          animationPause: 10,
        })
      )
      probe(ctx, [9, 11, 589, 590])
    })
    expect(
      states(sim, [9, 11, 589, 590], 'EarthShaker', 'pyroReaction')
    ).toEqual(['', 'on', 'on', ''])
  })

  it('ignores Pyro hits and non-Pyro Crystallize, but accepts off-field party reactions', () => {
    const sim = run(
      'EarthShaker',
      (ctx) => {
        ctx.hit(10, normal('Pyro hit', { element: 'pyro' }))
        // (a reaction's own damage is no reaction event)
        ctx.hit(
          15,
          normal('Overloaded DMG', {
            path: ['reaction', 'overloaded'],
            tag: 'other',
            element: 'pyro',
          })
        )
        ctx.hit(20, mark('crystallize', { element: 'cryo' }))
        ctx.hit(40, mark('vaporize'))
        probe(ctx, [11, 21, 41, 520])
      },
      { text: 'Razor Q -> Bennett E', frames: 1, candidate: true }
    )
    expect(
      states(sim, [11, 21, 41, 520], 'EarthShaker', 'pyroReaction')
    ).toEqual(['', '', 'on', ''])
  })
})

describe('Mailed Flower', () => {
  it('buffs after own on-field Skill damage, refreshes on Shatter and expires', () => {
    const sim = run('MailedFlower', (ctx) => {
      ctx.hit(10, normal('Skill', { path: ['skill', 'press'], tag: 'skill' }))
      ctx.hit(100, mark('shattered'))
      probe(ctx, [9, 11, 579, 580])
    })
    expect(state(sim, 'Skill', 'MailedFlower', 'passive')).toBe('')
    expect(states(sim, [9, 11, 579, 580], 'MailedFlower', 'passive')).toEqual([
      '',
      'on',
      'on',
      '',
    ])
  })

  it.each([
    'hyperbloom',
    'burgeon',
  ])('counts the wielder’s own %s (its damage, no mark) but not a reaction’s own damage', (reaction) => {
    const sim = run('MailedFlower', (ctx) => {
      ctx.hit(
        0,
        normal('Overloaded DMG', {
          path: ['reaction', 'overloaded'],
          tag: 'other',
        })
      )
      ctx.hit(10, reactionEvent(reaction))
      probe(ctx, [1, 11, 489, 490])
    })
    expect(states(sim, [1, 11, 489, 490], 'MailedFlower', 'passive')).toEqual([
      '',
      'on',
      'on',
      '',
    ])
  })

  it('ignores teammate/synthetic/off-field triggers and respects the actual damage tag', () => {
    const sim = run(
      'MailedFlower',
      (ctx) => {
        ctx.hit(0, mark('vaporize', { characterKey: 'Bennett' }))
        ctx.hit(0, mark('moondriftHarmony'))
        ctx.hit(0, mark('moondrift'))
        ctx.hit(
          0,
          normal('Plunge under Skill', {
            path: ['skill', 'plunge'],
            tag: 'plunge',
          })
        )
        ctx.hit(40, normal('Off-field Skill', { tag: 'skill' }))
        ctx.hit(50, mark('shattered'))
        probe(ctx, [1, 51])
      },
      { text: 'Razor Q -> Bennett E', frames: 1, candidate: true }
    )
    expect(states(sim, [1, 51], 'MailedFlower', 'passive')).toEqual(['', ''])
  })
})

describe('Snow-Tombed Starsilver', () => {
  it('uses chance credit, starts its ICD only on a proc and emits a snapshotted weapon hit', () => {
    const sim = run('SnowTombedStarsilver', (ctx) => {
      for (const t of [10, 20, 30, 619, 620, 630]) ctx.hit(t, normal(`N${t}`))
    })
    const procs = sim.hits.filter(
      (h) => h.path[0] === 'weapon:SnowTombedStarsilver'
    )
    expect(procs.map((h) => h.t)).toEqual([21, 631])
    expect(
      procs.every(
        (h) =>
          h.path[1] === 'dmgAoe' &&
          h.tag === 'other' &&
          h.element === 'physical' &&
          !h.applies
      )
    ).toBe(true)
    expect(procs[0].snapshotT).toBe(20)
    expect(
      rotationAttacks(sim)
        .Razor?.filter((a) => a.path[0] === 'weapon:SnowTombedStarsilver')
        .reduce((n, a) => n + a.hits, 0)
    ).toBe(2)
  })

  it.each([
    'cryo',
    'frozen',
  ] as const)('selects the node from the %s aura remaining after the triggering hit', (aura) => {
    const reactions = elementalReactions({ members })
    const sim = run(
      'SnowTombedStarsilver',
      (ctx) => {
        ctx.hit(
          0,
          normal('Cryo aura', {
            element: 'cryo',
            applies: true,
            durability: 100,
            tag: 'other',
          })
        )
        if (aura === 'frozen')
          ctx.hit(
            1,
            normal('Hydro aura', {
              element: 'hydro',
              applies: true,
              durability: 100,
              tag: 'other',
            })
          )
        ctx.hit(10, normal('Trigger'))
      },
      { refinement: 5, reactions }
    )
    expect(
      sim.hits
        .filter((h) => h.path[0] === 'weapon:SnowTombedStarsilver')
        .map((h) => h.path[1])
    ).toEqual([aura === 'cryo' ? 'dmgOnCryoOp' : 'dmgAoe'])
  })

  it('queries Cryo independently of a higher-priority aura', () => {
    const queried: unknown[] = []
    const sim = run('SnowTombedStarsilver', (ctx) => ctx.hit(10, normal('N')), {
      refinement: 5,
      reactions: {
        onHit() {},
        absorbAt: (_t, priority) => {
          queried.push(priority)
          return priority?.includes('cryo') ? 'cryo' : 'pyro'
        },
      },
    })
    expect(queried).toContainEqual(['cryo'])
    expect(
      sim.hits.find((h) => h.path[0] === 'weapon:SnowTombedStarsilver')?.path[1]
    ).toBe('dmgOnCryoOp')
  })

  it('recognizes remaining Frozen even when no ordinary aura is absorbable', () => {
    const sim = run('SnowTombedStarsilver', (ctx) => ctx.hit(10, normal('N')), {
      refinement: 5,
      reactions: {
        onHit() {},
        absorbAt: () => undefined,
        frozenAt: () => true,
      },
    })
    expect(
      sim.hits.find((h) => h.path[0] === 'weapon:SnowTombedStarsilver')?.path[1]
    ).toBe('dmgOnCryoOp')
  })

  it('pauses its cooldown during the wielder’s hitlag', () => {
    const sim = run(
      'SnowTombedStarsilver',
      (ctx) => {
        for (const t of [10, 610, 629, 630]) ctx.hit(t, normal(`N${t}`))
        ctx.hit(
          100,
          normal('Pause', {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            animationPause: 20,
          })
        )
      },
      { refinement: 5 }
    )
    expect(
      sim.hits
        .filter((h) => h.path[0] === 'weapon:SnowTombedStarsilver')
        .map((h) => h.t)
    ).toEqual([11, 631])
  })

  it('never procs from off-field hits, Skill damage, markers, or candidate-only gear', () => {
    const sim = run(
      'SnowTombedStarsilver',
      (ctx) => {
        ctx.hit(0, normal('Skill', { tag: 'skill' }))
        ctx.hit(0, mark('shattered', { tag: 'normal' }))
        ctx.hit(40, normal('Off-field Normal'))
      },
      { text: 'Razor Q -> Bennett E', frames: 1, refinement: 5 }
    )
    expect(sim.hits.some((h) => h.path[0].startsWith('weapon:'))).toBe(false)
    const candidate = run(
      'SnowTombedStarsilver',
      (ctx) => {
        ctx.hit(10, normal('N'))
        ctx.hit(20, normal('N2'))
      },
      { candidate: true }
    )
    expect(candidate.hits.some((h) => h.path[0].startsWith('weapon:'))).toBe(
      false
    )
  })
})
