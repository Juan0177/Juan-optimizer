/**
 * Weapon effects in the shared simulation files (weapon audit 2026-11-16).
 *
 * A set's or weapon's window that gearEffects writes when its effect closes (Primordial Jade
 * Winged-Spear's stacks, a shield weapon's protected spans) covers frames already played: a hit
 * that took its stats at its cast in those frames (gcsim's snapshotDelay) still counts it.
 * Also the weapon effects gearEffects plays itself: Golden Majesty, Beacon of the Reed Sea's
 * after-Skill ATK, a Leaf from Hyperbloom; a weapon's Normal Attack SPD; Amos' Bow on Ganyu.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel, SimHit } from '../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['Xiao']
const hit: Omit<SimHit, 't' | 'characterKey' | 'onField'> = {
  path: ['normal', '0'],
  tag: 'normal',
  element: 'physical',
  label: 'hit',
}
// (a hit at once, then one cast at 20 that takes its stats at the cast and lands at 30)
const kit: KitModel = {
  characterKey: 'Xiao',
  element: 'anemo',
  source: 'test',
  act(c) {
    c.hit(0, hit)
    c.at(20, (at) =>
      at.hit(10, {
        ...hit,
        path: ['normal', '1'],
        snapshotDelay: 0,
        label: 'cast',
      })
    )
    return { frames: 40 }
  },
}
const play = (weapon: string, xiao: KitModel = kit) =>
  simulateRotation({
    rotation: parseRotation('Xiao E', [{ characterKey: 'Xiao', name: 'Xiao' }]),
    members,
    elements: { Xiao: 'anemo' },
    constellations: {},
    gear: { Xiao: { weapon, refinement: 1 } },
    kits: { Xiao: xiao },
    repeats: 1,
    keep: 'all',
  })
const stackAtCast = (weapon: string) => {
  const attack = rotationAttacks(play(weapon)).Xiao!.find(
    (a) => a.path.join('.') === 'normal.1'
  )!
  // (its ATK as at the cast: a snapshot's states, or its own when nothing changed since)
  const states =
    attack.statSnapshots?.find((s) => s.stat === 'atk')?.states ??
    attack.states ??
    []
  return states.find((s) => s.path.join('.') === `${weapon}.stack`)?.value
}

describe('windows written after the fact', () => {
  it('count for a hit that took its stats at its cast within them', () => {
    // (the first hit's stack, from frame 1, written only when it lapses at 361)
    expect(stackAtCast('PrimordialJadeWingedSpear')).toBe('1')
  })
})

/** A kit whose Skill lands these hits (frame, hit) */
const hits = (...list: [number, Partial<SimHit>][]): KitModel => ({
  ...kit,
  act(c) {
    for (const [at, h] of list) c.hit(at, { ...hit, ...h })
    return { frames: 40 }
  },
})
const spans = (weapon: string, xiao: KitModel, conditional: string) =>
  play(weapon, xiao)
    .buffWindows.filter(
      (w) =>
        w.path.join('.') === `${weapon}.${conditional}` &&
        w.value &&
        w.end > w.start
    )
    .map((w) => [w.value, w.start, w.end])

describe('weapon effects in gearEffects', () => {
  it('Golden Majesty: a stack per on-field hit, once per 0.3 s, all refreshed, up to 5, 8 s', () => {
    const six = hits(
      ...[0, 20, 40, 60, 80, 100].map((t): [number, Partial<SimHit>] => [t, {}])
    )
    for (const weapon of [
      'TheUnforged',
      'SummitShaper',
      'MemoryOfDust',
      'VortexVanquisher',
    ])
      expect(spans(weapon, six, 'GoldenMajesty')).toEqual([
        ['1', 0, 20],
        ['2', 20, 40],
        ['3', 40, 60],
        ['4', 60, 80],
        // (refreshed at 100: until 100 + 480)
        ['5', 80, 580],
      ])
    // (the hit itself counts the stacks from before it)
    const first = play('TheUnforged', six).hits.find((h) => h.t === 20)!
    expect(
      first.states?.find(
        (s) => s.path.join('.') === 'TheUnforged.GoldenMajesty'
      )?.value
    ).toBe('1')
    // (two hits 10 frames apart: one stack)
    expect(
      spans('TheUnforged', hits([0, {}], [10, {}]), 'GoldenMajesty')
    ).toEqual([['1', 0, 480]])
  })
  it('Beacon of the Reed Sea: ATK for 8 s after each Skill hit, from the next hit', () => {
    expect(
      spans(
        'BeaconOfTheReedSea',
        hits([0, { tag: 'skill', path: ['skill', '0'] }], [30, {}]),
        'afterSkill'
      )
    ).toEqual([['on', 1, 481]])
    expect(spans('BeaconOfTheReedSea', hits([0, {}]), 'afterSkill')).toEqual([])
  })
  it('Sapwood Blade: a Leaf from the wielder’s Hyperbloom, once per 20 s', () => {
    const bloom: Partial<SimHit> = {
      path: ['reaction', 'hyperbloom'],
      tag: 'other',
      element: 'dendro',
    }
    expect(
      spans('SapwoodBlade', hits([0, bloom], [100, bloom]), 'passive')
    ).toEqual([['on', 0, 720]])
  })
})

describe('a weapon’s Normal Attack SPD', () => {
  const speedOf = (weapon: string, refinement: number) => {
    let speed = Number.NaN
    simulateRotation({
      rotation: parseRotation('Xiao N1', [
        { characterKey: 'Xiao', name: 'Xiao' },
      ]),
      members,
      elements: { Xiao: 'anemo' },
      constellations: {},
      gear: { Xiao: { weapon, refinement } },
      kits: {
        Xiao: {
          ...kit,
          act(c) {
            speed = c.normalAttackSpeed?.(false) ?? Number.NaN
            return { frames: 10 }
          },
        },
      },
      repeats: 1,
    })
    return speed
  }
  it('Tulaytullah’s Remembrance: +10% at R1, +20% at R5, worn only', () => {
    expect(speedOf('TulaytullahsRemembrance', 1)).toBeCloseTo(0.1)
    expect(speedOf('TulaytullahsRemembrance', 5)).toBeCloseTo(0.2)
    expect(speedOf('TheWidsith', 1)).toBe(0)
  })
})

describe('Amos’ Bow on Ganyu', () => {
  it('a stack for the Frostflake Arrow’s travel, 4 for its Bloom', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Ganyu CA W1', [
        { characterKey: 'Ganyu', name: 'Ganyu' },
      ]),
      members: ['Ganyu'],
      elements: { Ganyu: 'cryo' },
      constellations: {},
      gear: { Ganyu: { weapon: 'AmosBow', refinement: 1 } },
      repeats: 1,
      keep: 'all',
    })
    const stacks = (node: string) =>
      sim.hits
        .find((h) => h.path.join('.') === `charged.${node}`)
        ?.states?.find((s) => s.path.join('.') === 'AmosBow.StrongWilled')
        ?.value
    expect(stacks('frostflake')).toBe('1')
    expect(stacks('frostflakeBloom')).toBe('4')
  })
})

describe('heals by Max HP %', () => {
  it('trigger the weapons on heals (Tidal Shadow on Gaming’s self-heal)', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Xiao E W1', [
        { characterKey: 'Xiao', name: 'Xiao' },
      ]),
      members,
      elements: { Xiao: 'anemo' },
      constellations: {},
      gear: { Xiao: { weapon: 'TidalShadow', refinement: 1 } },
      kits: {
        Xiao: {
          ...kit,
          act(c) {
            c.healPercent('Xiao', 0.1, ['Xiao'])
            return { frames: 10 }
          },
        },
      },
      repeats: 1,
      keep: 'all',
    })
    expect(
      sim.buffWindows
        .filter(
          (w) => w.path.join('.') === 'TidalShadow.afterHeal' && w.end > w.start
        )
        .map((w) => [w.start, w.end])
    ).toEqual([[0, 480]])
  })
})
