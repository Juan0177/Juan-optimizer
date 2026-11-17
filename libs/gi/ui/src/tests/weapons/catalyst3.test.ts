import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOptAttack } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation } from '../../'
import type { RotationAction } from '../../util/teamOpt/rotation/parse'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
  simulateRotationSamples,
} from '../../util/teamOpt/rotation/simulate'
import type { SimContext, SimHit } from '../../util/teamOpt/rotation/types'

type Options = Parameters<typeof simulateRotation>[0]
type Sim = ReturnType<typeof simulateRotation>
const members: CharacterKey[] = ['Lisa', 'Bennett']
const parse = (text: string) =>
  parseRotation(
    text,
    members.map((characterKey) => ({ characterKey, name: characterKey }))
  )

function options(
  weapon: string,
  schedule: (ctx: SimContext, action: RotationAction) => void,
  frames = 2000,
  extra: Partial<Options> = {}
): Options {
  return {
    rotation: parse('Lisa E'),
    members,
    constellations: {},
    elements: { Lisa: 'electro', Bennett: 'pyro' },
    gear: { Lisa: { weapon, refinement: 1 } },
    repeats: 1,
    keep: 'all',
    kits: {
      Lisa: {
        characterKey: 'Lisa',
        element: 'electro',
        source: 'test',
        act(ctx, _state, action) {
          schedule(ctx, action)
          return { frames }
        },
      },
      Bennett: {
        characterKey: 'Bennett',
        element: 'pyro',
        source: 'test',
        act: () => ({ frames }),
      },
    },
    ...extra,
  }
}
const run = (...args: Parameters<typeof options>) =>
  simulateRotation(options(...args))
function hit(
  ctx: SimContext,
  t: number,
  label: string,
  extra: Partial<SimHit> = {}
) {
  ctx.hit(t, {
    path: ['normal', '0'],
    tag: 'normal',
    element: 'physical',
    applies: false,
    label,
    ...extra,
  })
}
const marker = (ctx: SimContext, t: number, name: string) =>
  hit(ctx, t, name, { path: ['_marker', name], tag: 'other' })
const attacks = (sim: Sim) => Object.values(rotationAttacks(sim)).flat()
const state = (sim: Sim, label: string, weapon: string, cond: string) => {
  const attack = attacks(sim).find(
    (a) => a.description === label || a.description?.startsWith(`${label} (`)
  )
  expect(attack, label).toBeDefined()
  return (
    attack?.states?.find(
      (s) => s.owner === 'Lisa' && s.path.join('.') === `${weapon}.${cond}`
    )?.value ?? ''
  )
}
const procs = (sim: Sim, weapon: string) =>
  sim.hits.filter((h) => h.path[0] === `weapon:${weapon}`)

describe('Cashflow Supervision', () => {
  it('gains and refreshes shared stacks, enforces the HP-change ICD and resets after expiry', () => {
    const sim = run('CashflowSupervision', (ctx) => {
      for (const t of [10, 20, 29, 48, 250, 500]) marker(ctx, t, 'hpChange')
      for (const t of [9, 10, 20, 29, 48, 249, 250, 489, 490, 500])
        hit(ctx, t, `probe ${t}`)
    })
    // (a stack refreshed at 250 lasts 240 frames: gcsim's attack modifier no longer applies on
    // its expiry frame, 490, while the stack count still carries over an HP change on it)
    expect(
      [9, 10, 20, 29, 48, 249, 250, 489, 490, 500].map((t) =>
        state(sim, `probe ${t}`, 'CashflowSupervision', 'hpChanges')
      )
    ).toEqual(['', '1', '1', '2', '3', '3', '3', '3', '', '1'])
    expect(sim.buffWindows).toContainEqual(
      expect.objectContaining({
        path: ['CashflowSupervision', '_normalAttackSpeed'],
        value: '0.08',
        start: 48,
        end: 490,
      })
    )
  })

  it('carries its stacks over an HP change on their expiry frame, whose own damage is unbuffed', () => {
    const sim = run('CashflowSupervision', (ctx) => {
      hit(ctx, 278, 'expiry frame')
      for (const t of [0, 19, 38, 278]) marker(ctx, t, 'hpChange')
      hit(ctx, 279, 'after refresh')
    })
    expect(state(sim, 'expiry frame', 'CashflowSupervision', 'hpChanges')).toBe(
      ''
    )
    expect(
      state(sim, 'after refresh', 'CashflowSupervision', 'hpChanges')
    ).toBe('3')
  })

  it.each([
    [1, 'CashflowSupervision', 0.08],
    [5, 'CashflowSupervision', 0.16],
    [1, 'candidate', 0],
  ] as const)('gives its three-stack ATK SPD to Normal Attacks only (R%i %s)', (refinement, worn, speed) => {
    const seen: Partial<Record<string, number>> = {}
    run(
      'CashflowSupervision',
      (ctx, action) => {
        if (action.kind === 'skill')
          for (const t of [0, 19, 38]) marker(ctx, t, 'hpChange')
        else
          seen[action.kind] =
            action.kind === 'normal'
              ? ctx.normalAttackSpeed(false)
              : ctx.attackSpeed
      },
      50,
      {
        rotation: parse('Lisa E N1 CA'),
        gear: {
          Lisa:
            worn === 'candidate'
              ? {
                  weapon: 'OtherworldlyStory',
                  candidates: { weapons: ['CashflowSupervision'] },
                }
              : { weapon: worn, refinement },
        },
      }
    )
    expect(seen.normal).toBeCloseTo(speed)
    expect(seen.charged).toBe(0)
  })

  it('uses the holder clock for the ICD and duration', () => {
    const sim = run('CashflowSupervision', (ctx) => {
      for (const t of [0, 19, 39]) marker(ctx, t, 'hpChange')
      hit(ctx, 5, 'pause', {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        animationPause: 20,
      })
      for (const t of [19, 39, 278, 279]) hit(ctx, t, `probe ${t}`)
    })
    expect(
      [19, 39, 278, 279].map((t) =>
        state(sim, `probe ${t}`, 'CashflowSupervision', 'hpChanges')
      )
    ).toEqual(['1', '2', '2', ''])
  })

  it('uses effective tracked HP changes, rejecting pure overheal', () => {
    const sim = run(
      'CashflowSupervision',
      (ctx) => {
        ctx.healPercent('Lisa', 0.1, ['Lisa']) // full HP: no change
        ctx.at(20, (at) => at.drainHp('Lisa', 0.1))
        ctx.at(40, (at) => at.healPercent('Lisa', 0.2, ['Lisa']))
        for (const t of [1, 21, 41]) hit(ctx, t, `probe ${t}`)
      },
      500,
      {
        calculate: (_k, path) =>
          path.join('.') === 'total.hp' ? 10000 : undefined,
      }
    )
    expect(
      [1, 21, 41].map((t) =>
        state(sim, `probe ${t}`, 'CashflowSupervision', 'hpChanges')
      )
    ).toEqual(['', '1', '2'])
  })

  it('opens candidate buffs without emitting a candidate speed state, and cannot gain off field', () => {
    const sim = run(
      'CashflowSupervision',
      (ctx) => {
        for (const t of [0, 19, 38, 100]) marker(ctx, t, 'hpChange')
        hit(ctx, 101, 'off-field probe')
      },
      50,
      {
        rotation: parse('Lisa E -> Bennett E W5'),
        gear: {
          Lisa: {
            weapon: 'OtherworldlyStory',
            candidates: { weapons: ['CashflowSupervision'] },
          },
        },
      }
    )
    expect(
      state(sim, 'off-field probe', 'CashflowSupervision', 'hpChanges')
    ).toBe('3')
    expect(
      sim.buffWindows.some(
        (w) => w.path[1] === '_normalAttackSpeed' && w.value !== 'on'
      )
    ).toBe(false)
    const lastGain = sim.buffWindows
      .filter((w) => w.path[1] === 'hpChanges' && w.value === '3')
      .pop()!
    expect(lastGain.end).toBe(278) // the off-field marker at 100 did not refresh it
  })
})

describe("Jadefall's Splendor", () => {
  it('opens Burst/shield windows and counts only uncancelled, worn-weapon energy callbacks', () => {
    const schedule = (ctx: SimContext) => {
      for (const t of [100, 300]) marker(ctx, t, 'shield')
      for (const t of [1, 279, 280, 300, 479, 480]) hit(ctx, t, `probe ${t}`)
    }
    const sim = run('JadefallsSplendor', schedule, 800, {
      rotation: parse('Lisa Q'),
    })
    expect(
      [1, 279, 280, 300, 479, 480].map((t) =>
        state(sim, `probe ${t}`, 'JadefallsSplendor', 'condPassive')
      )
    ).toEqual(['on', 'on', '', 'on', 'on', ''])
    expect(
      sim.hits
        .filter(
          (h) => h.path.join('.') === '_marker.weaponEnergy.JadefallsSplendor'
        )
        .map((h) => h.t)
    ).toEqual([242, 442])
    const candidate = run('JadefallsSplendor', schedule, 800, {
      rotation: parse('Lisa Q'),
      gear: {
        Lisa: {
          weapon: 'OtherworldlyStory',
          candidates: { weapons: ['JadefallsSplendor'] },
        },
      },
    })
    expect(
      state(candidate, 'probe 1', 'JadefallsSplendor', 'condPassive')
    ).toBe('on')
    expect(candidate.hits.some((h) => h.path[1] === 'weaponEnergy')).toBe(false)
  })

  it('retains the activation HP component snapshot and refreshes it on an off-field shield', () => {
    const sim = run(
      'JadefallsSplendor',
      (ctx) => {
        ctx.at(50, (at) => at.state('Lisa', ['Test', 'hpBuff'], 'on'))
        marker(ctx, 100, 'shield')
        hit(ctx, 80, 'old snapshot')
        hit(ctx, 110, 'refreshed snapshot')
      },
      20,
      { rotation: parse('Lisa Q -> Bennett E W3') }
    )
    const component = (label: string) =>
      attacks(sim)
        .find((a) => a.description === label)
        ?.statSnapshots?.find(
          (s) =>
            s.path.join('.') === 'display.weapon:JadefallsSplendor.electro_dmg_'
        )
    expect(
      component('old snapshot')?.states.find((s) => s.path[1] === 'hpBuff')
        ?.value ?? ''
    ).toBe('')
    expect(
      component('refreshed snapshot')?.states.find(
        (s) => s.path[1] === 'hpBuff'
      )?.value
    ).toBe('on')
    expect(component('refreshed snapshot')?.onField).toBe('Bennett')
    expect(
      state(sim, 'refreshed snapshot', 'JadefallsSplendor', 'condPassive')
    ).toBe('on')
  })
})

describe("Nightweaver's Looking Glass", () => {
  it('opens independent statuses off field, preserves the triggering hit, and exposes their overlap to teammates', () => {
    const sim = run(
      'NightweaversLookingGlass',
      (ctx) => {
        hit(ctx, 10, 'wrong element', {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'electro',
        })
        hit(ctx, 20, 'Prayer trigger', {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'dendro',
        })
        hit(ctx, 30, 'Verse trigger', {
          characterKey: 'Bennett',
          path: ['_reaction', 'lunarBloom'],
          tag: 'other',
        })
        hit(ctx, 100, 'pause', {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          animationPause: 20,
        })
        for (const t of [21, 31, 310, 311, 650, 651])
          hit(ctx, t, `team probe ${t}`, { characterKey: 'Bennett' })
      },
      5,
      { rotation: parse('Lisa E -> Bennett E W12') }
    )
    expect(
      state(
        sim,
        'wrong element',
        'NightweaversLookingGlass',
        'afterHydroOrDendro'
      )
    ).toBe('')
    expect(
      state(
        sim,
        'Prayer trigger',
        'NightweaversLookingGlass',
        'afterHydroOrDendro'
      )
    ).toBe('')
    expect(
      [21, 31, 310, 311].map((t) =>
        state(
          sim,
          `team probe ${t}`,
          'NightweaversLookingGlass',
          'afterHydroOrDendro'
        )
      )
    ).toEqual(['on', 'on', 'on', ''])
    expect(
      [21, 31, 650, 651].map((t) =>
        state(
          sim,
          `team probe ${t}`,
          'NightweaversLookingGlass',
          'afterLunarBloom'
        )
      )
    ).toEqual(['', 'on', 'on', ''])
  })
})

describe("Surf's Up", () => {
  it('expires unconsumed stacks after 14 s and enforces the separate Vaporize gain cooldown', () => {
    const sim = run('SurfsUp', (ctx) => {
      hit(ctx, 10, 'first loss')
      for (const t of [20, 30, 110, 111])
        hit(ctx, t, `vape ${t}`, {
          tag: 'skill',
          path: ['skill', 'dmg'],
          reaction: 'vaporize',
        })
      hit(ctx, 101, 'second loss')
      for (const t of [31, 112, 839, 840])
        hit(ctx, t, `charged ${t}`, {
          tag: 'charged',
          path: ['charged', 'dmg'],
        })
    })
    expect(
      [20, 30, 110, 111].map((t) =>
        state(sim, `vape ${t}`, 'SurfsUp', 'stacks')
      )
    ).toEqual(['3', '4', '3', '3'])
    expect(
      [31, 112, 839, 840].map((t) =>
        state(sim, `charged ${t}`, 'SurfsUp', 'stacks')
      )
    ).toEqual(['4', '4', '4', ''])
  })

  it('consumes after damage with an independent loss ICD, can regain from zero, and does not extend its lifetime', () => {
    const sim = run('SurfsUp', (ctx) => {
      for (const t of [10, 20, 100, 101, 192, 283, 401, 840, 841])
        hit(ctx, t, `normal ${t}`)
      hit(ctx, 400, 'Vaporize skill', {
        tag: 'skill',
        path: ['skill', 'dmg'],
        reaction: 'vaporize',
      })
    })
    expect(
      [10, 20, 100, 101, 192, 283, 401, 840, 841].map((t) =>
        state(sim, `normal ${t}`, 'SurfsUp', 'stacks')
      )
    ).toEqual(['4', '3', '3', '3', '2', '1', '1', '', ''])
    expect(state(sim, 'Vaporize skill', 'SurfsUp', 'stacks')).toBe('')
    expect(
      sim.buffWindows
        .filter((w) => w.path[0] === 'SurfsUp' && w.value !== '')
        .every((w) => w.end <= 841)
    ).toBe(true)
  })

  it('lets a Vaporizing Normal carry a fifth internal stack before consumption', () => {
    const sim = run('SurfsUp', (ctx) => {
      hit(ctx, 10, 'vape normal', { reaction: 'vaporize' })
      hit(ctx, 11, 'next normal')
      hit(ctx, 41, 'overflow expired')
    })
    expect(
      ['vape normal', 'next normal', 'overflow expired'].map((label) =>
        state(sim, label, 'SurfsUp', 'stacks')
      )
    ).toEqual(['4', '4', '4'])
  })

  it('gates activation on Skill and its owner-clock cooldown', () => {
    const sim = run(
      'SurfsUp',
      (ctx, action) => {
        hit(ctx, 1, `${action.kind} ${ctx.now}`)
      },
      1,
      { rotation: parse('Lisa Q E W899f E W1f E') }
    )
    expect(state(sim, 'burst 0', 'SurfsUp', 'stacks')).toBe('')
    const grants = sim.buffWindows.filter(
      (w) => w.path[0] === 'SurfsUp' && w.value === '4'
    )
    expect(grants.map((w) => w.start)).toEqual([1, 903])
  })
})

describe('Skill-triggered EM and ER', () => {
  it.each([
    ['EtherlightSpindlelute', 'condPassive', 'on', 1200],
    ['OathswornEye', 'faLight', 'skillBurst', 600],
  ] as const)('%s triggers only on Skill and expires on the holder clock', (weapon, cond, value, duration) => {
    const sim = run(
      weapon,
      (ctx) => {
        hit(ctx, 1, `probe ${ctx.now + 1}`)
        if (ctx.now === 1) {
          hit(ctx, 10, 'pause', {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            animationPause: 20,
          })
          hit(ctx, duration + 19, 'last active')
          hit(ctx, duration + 20, 'expired')
        }
      },
      1,
      { rotation: parse('Lisa Q E W25') }
    )
    expect(state(sim, 'probe 1', weapon, cond)).toBe('')
    expect(state(sim, 'probe 2', weapon, cond)).toBe(value)
    expect(state(sim, 'last active', weapon, cond)).toBe(value)
    expect(state(sim, 'expired', weapon, cond)).toBe('')
  })

  it('refreshes Etherlight instead of stacking and ignores the stale expiry callback', () => {
    const sim = run(
      'EtherlightSpindlelute',
      (ctx) => {
        hit(ctx, 1100, `probe ${ctx.now + 1100}`)
      },
      1,
      { rotation: parse('Lisa E W999f E W25') }
    )
    expect(
      state(sim, 'probe 1100', 'EtherlightSpindlelute', 'condPassive')
    ).toBe('on')
    expect(
      state(sim, 'probe 2100', 'EtherlightSpindlelute', 'condPassive')
    ).toBe('on')
    expect(
      sim.buffWindows.filter(
        (w) =>
          w.path[0] === 'EtherlightSpindlelute' &&
          w.value === 'on' &&
          w.end > w.start
      )
    ).toHaveLength(1)
  })
})

describe('Catalyst damage procs', () => {
  it('Skyward Atlas rolls per eligible Normal, keeps six summon snapshots, and persists across swaps', () => {
    const draws = [0.25, 0.75]
    const sim = run(
      'SkywardAtlas',
      (ctx) => {
        hit(ctx, 0, 'failed roll')
        hit(ctx, 10, 'summon')
        ctx.at(100, (at) => at.state('Lisa', ['Test', 'lateAtk'], 'on'))
      },
      20,
      {
        rotation: parse('Lisa E -> Bennett E W20'),
        random: () => draws.shift() ?? 0.75,
      }
    )
    expect(procs(sim, 'SkywardAtlas').map((h) => h.t)).toEqual([
      167, 314, 461, 608, 755, 902,
    ])
    expect(
      procs(sim, 'SkywardAtlas').every(
        (h) => h.snapshotT === 10 && h.onField === 'Bennett'
      )
    ).toBe(true)
    const procAttacks = attacks(sim).filter(
      (a) => a.path[0] === 'weapon:SkywardAtlas'
    )
    expect(
      procAttacks.every(
        (a) =>
          a.statSnapshots
            ?.find((s) => s.stat === 'atk')
            ?.states.find((s) => s.path[1] === 'lateAtk')?.value !== 'on'
      )
    ).toBe(true)
  })

  it('Skyward Atlas starts its hitlag-aware cooldown on summon', () => {
    const sim = run(
      'SkywardAtlas',
      (ctx) => {
        for (const t of [0, 1800, 1820, 1821]) hit(ctx, t, `normal ${t}`)
        hit(ctx, 100, 'pause', {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          animationPause: 20,
        })
      },
      3000,
      { random: () => 0.75 }
    )
    expect(procs(sim, 'SkywardAtlas').map((h) => h.t)).toEqual([
      157, 304, 451, 598, 745, 892, 1978, 2125, 2272, 2419, 2566, 2713,
    ])
  })

  it('Ash-Graven Drinking Horn emits an HP proc and enforces the owner-clock cooldown', () => {
    const sim = run('AshGravenDrinkingHorn', (ctx) => {
      for (const t of [0, 900, 920, 921]) hit(ctx, t, `normal ${t}`)
      hit(ctx, 100, 'pause', {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        animationPause: 20,
      })
    })
    expect(procs(sim, 'AshGravenDrinkingHorn').map((h) => h.t)).toEqual([
      1, 922,
    ])
    expect(
      procs(sim, 'AshGravenDrinkingHorn').every(
        (h) =>
          h.snapshotT === h.t - 1 &&
          h.tag === 'other' &&
          h.element === 'physical'
      )
    ).toBe(true)
  })

  it('Frostbearer uses independent failed/successful rolls and the cooldown begins on success', () => {
    const draws = [0.99, 0.1, 0.1]
    const sim = run(
      'Frostbearer',
      (ctx) => {
        for (const t of [0, 10, 20, 610, 611]) hit(ctx, t, `normal ${t}`)
      },
      1000,
      { random: () => draws.shift() ?? 0.1 }
    )
    expect(procs(sim, 'Frostbearer').map((h) => h.t)).toEqual([11, 612])
    expect(procs(sim, 'Frostbearer').map((h) => h.path[1])).toEqual([
      'dmgAoe',
      'dmgAoe',
    ])
  })

  it.each([
    'cryo',
    'frozen',
  ] as const)('Frostbearer selects only its replacement node against live %s', (aura) => {
    const sim = run(
      'Frostbearer',
      (ctx) => {
        if (aura === 'frozen')
          hit(ctx, 0, 'Hydro aura', {
            path: ['skill', 'hydro'],
            tag: 'skill',
            element: 'hydro',
            applies: true,
            icd: 'none',
          })
        hit(ctx, 1, 'Cryo aura', {
          path: ['skill', 'cryo'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'none',
        })
        hit(ctx, 10, 'normal')
      },
      500,
      { random: () => 0.1 }
    )
    expect(procs(sim, 'Frostbearer').map((h) => h.path[1])).toEqual([
      'dmgOnCryoOp',
    ])
  })

  it.each([
    'SkywardAtlas',
    'Frostbearer',
    'AshGravenDrinkingHorn',
  ])('%s never emits candidate-weapon procs or off-field procs', (weapon) => {
    const schedule = (ctx: SimContext) => hit(ctx, 100, 'normal')
    const candidate = run(weapon, schedule, 500, {
      gear: {
        Lisa: {
          weapon: 'OtherworldlyStory',
          candidates: { weapons: [weapon] },
        },
      },
      random: () => (weapon === 'SkywardAtlas' ? 0.75 : 0.1),
    })
    expect(procs(candidate, weapon)).toHaveLength(0)
    const offField = run(weapon, schedule, 20, {
      rotation: parse('Lisa E -> Bennett E W5'),
      random: () => (weapon === 'SkywardAtlas' ? 0.75 : 0.1),
    })
    expect(procs(offField, weapon)).toHaveLength(0)
  })

  it('averages complete seeded Atlas and Frostbearer timelines when sampling is requested', () => {
    const atlas = simulateRotationSamples(
      options('SkywardAtlas', (ctx) => hit(ctx, 0, 'normal'), 1000),
      16,
      123
    )
    const frost = simulateRotationSamples(
      options('Frostbearer', (ctx) => hit(ctx, 0, 'normal'), 1000),
      10,
      123
    )
    const expected = (sim: Sim, weapon: string) =>
      sim.samples!.reduce(
        (n, s) => n + s.probability * procs(s.result, weapon).length,
        0
      )
    expect(expected(atlas, 'SkywardAtlas')).toBeCloseTo(3)
    expect(expected(frost, 'Frostbearer')).toBeCloseTo(0.6)
  })
})

function build(weapon: string, refinement: number) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const character = {
    level: 90,
    ascension: 6,
    constellation: 0,
    talent: { auto: 9, skill: 9, burst: 9 },
  }
  db.chars.set('Lisa', { key: 'Lisa', ...character })
  const teamCharId = db.teamChars.new('Lisa', {})
  const buildTcId = db.buildTcs.new({
    characterKey: 'Lisa',
    character,
    weapon: { key: weapon, level: 90, ascension: 6, refinement },
    artifact: {
      slots: {},
      substats: { type: 'max', stats: {}, rarity: 5 },
      sets: {},
    },
  } as never)
  const teamId = db.teams.new({
    loadoutData: [{ teamCharId, buildType: 'tc', buildTcId }] as LoadoutDatum[],
  } as never)
  const damage = (attack: TeamOptAttack) =>
    evaluateTeamRotation(db, teamId, 'F', {
      arts: {},
      attacks: { Lisa: [attack] },
    })!.total
  return { db, teamId, damage }
}

describe('Proc sheet integration', () => {
  it.each([
    'SkywardAtlas',
    'Frostbearer',
    'AshGravenDrinkingHorn',
  ])('%s emitted hits evaluate on their existing damage node at R1 and R5', (weapon) => {
    const sim = run(weapon, (ctx) => hit(ctx, 0, 'normal'), 1000, {
      random: () => (weapon === 'SkywardAtlas' ? 0.75 : 0.1),
    })
    const attack = attacks(sim).find((a) => a.path[0] === `weapon:${weapon}`)!
    expect(attack).toBeDefined()
    const r1 = build(weapon, 1).damage(attack)
    const r5 = build(weapon, 5).damage(attack)
    expect(r1).toBeGreaterThan(0)
    expect(r5 / r1).toBeCloseTo(weapon === 'Frostbearer' ? 1.4 / 0.8 : 2)
    expect(build('OtherworldlyStory', 1).damage(attack)).toBe(0)
  })

  it('Frostbearer replaces its ordinary multiplier with the Cryo multiplier at every refinement', () => {
    for (const refinement of [1, 2, 3, 4, 5]) {
      const { damage } = build('Frostbearer', refinement)
      const attack = (node: string): TeamOptAttack => ({
        path: ['weapon:Frostbearer', node],
        hits: 1,
        hitMode: 'avgHit',
      })
      expect(
        damage(attack('dmgOnCryoOp')) / damage(attack('dmgAoe'))
      ).toBeCloseTo((1.6 + 0.4 * refinement) / (0.65 + 0.15 * refinement))
    }
  })
})
