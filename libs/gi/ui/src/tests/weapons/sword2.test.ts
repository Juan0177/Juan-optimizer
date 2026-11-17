/**
 * Weapon audit batch sword2: the rotation simulation's windows for Exaiphanes Blade, Light of
 * Foliar Incision, Uraku Misugiri, Moonweaver's Dawn, Sturdy Bone and Wolf-Fang (as kqmsim), and
 * the sheet fixes of Exaiphanes Blade (permanent CRIT DMG) and Aquila Favonia (total ATK heal).
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { computeUIData } from '@genshin-optimizer/gi/uidata'
import type { Data, NumNode } from '@genshin-optimizer/gi/wr'
import { constant } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import {
  type SimulationResult,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type { HitElement, KitModel } from '../../util/teamOpt/rotation/types'

/**
 * A test kit: N<n> makes n Normal hits 10 frames apart (its element), CA one Physical Normal hit,
 * E one Skill hit, Q Burst hits at 1, 4 and 20 frames, D a dash (no hit)
 */
const kit = (characterKey: CharacterKey, element: HitElement): KitModel => ({
  characterKey,
  element,
  source: 'test',
  act(ctx, _state, action) {
    if (action.kind === 'normal') {
      const n = action.count ?? 1
      for (let i = 0; i < n; i++)
        ctx.hit(i * 10, {
          path: ['normal', '0'],
          tag: 'normal',
          element,
          label: 'Normal',
        })
      return { frames: n * 10 + 10 }
    }
    if (action.kind === 'charged') {
      ctx.hit(0, {
        path: ['normal', '0'],
        tag: 'normal',
        element: 'physical',
        label: 'Physical Normal',
      })
      return { frames: 20 }
    }
    if (action.kind === 'skill') {
      ctx.hit(1, {
        path: ['skill', 'dmg'],
        tag: 'skill',
        element,
        label: 'Skill',
      })
      return { frames: 60 }
    }
    if (action.kind === 'burst') {
      for (const d of [1, 4, 20])
        ctx.hit(d, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element,
          label: 'Burst',
        })
      return { frames: 60 }
    }
    return { frames: 20 }
  },
})

function play(
  text: string,
  members: [CharacterKey, HitElement][],
  weapon: string,
  refinement = 1
): SimulationResult {
  const keys = members.map(([k]) => k)
  return simulateRotation({
    rotation: parseRotation(
      text,
      keys.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members: keys,
    constellations: {},
    elements: Object.fromEntries(members),
    kits: Object.fromEntries(members.map(([k, e]) => [k, kit(k, e)])),
    reactions: { onHit() {} },
    gear: { [keys[0]]: { weapon, refinement } },
    repeats: 1,
    keep: 'all',
  })
}

/**
 * The windows where the buff is on for a while, as [start, end, value]: not the declarations or
 * the off state (''), neighbours of one value merged (a refresh keeps the state)
 */
const windows = (sim: SimulationResult, path: string) => {
  const out: [number, number, string][] = []
  for (const w of sim.buffWindows
    .filter((w) => w.path.join('.') === path && w.end > w.start && w.value)
    .sort((x, y) => x.start - y.start)) {
    const last = out[out.length - 1]
    if (last && last[1] === w.start && last[2] === w.value) last[1] = w.end
    else out.push([w.start, w.end, w.value])
  }
  return out
}
const times = (sim: SimulationResult, label: string) =>
  sim.hits.filter((h) => h.label === label).map((h) => h.t)

describe('Exaiphanes Blade', () => {
  it('gives the Traveler ATK for 8 s after a hit, once per 5 s, from the next frame', () => {
    const sim = play(
      'TravelerAnemo N1 N1 N1 W10 N1',
      [['TravelerAnemo', 'anemo']],
      'ExaiphanesBlade'
    )
    const [a, b, c, d] = times(sim, 'Normal')
    expect(b - a).toBeLessThan(300) // (in its cooldown: neither restarts it)
    expect(c - a).toBeLessThan(300)
    const w = windows(sim, 'ExaiphanesBlade.passive')
    expect(w[0]).toEqual([a + 1, a + 481, 'on'])
    expect(w[1][0]).toBe(d + 1)
    expect(w).toHaveLength(2)
  })
  it('keeps its CRIT DMG without the after-hit bonus; the ATK still needs it', () => {
    const premod = (
      getWeaponSheet('ExaiphanesBlade') as unknown as { data: Data }
    ).data.premod as Record<string, NumNode>
    const resonances = Object.fromEntries(
      ['anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo'].map(
        (e) => [`traveler${e}`, constant('on')]
      )
    )
    const value = (stat: string, passive?: string) =>
      computeUIData([
        {
          charKey: constant('TravelerAnemo'),
          weapon: { refinement: constant(5) },
          conditional: {
            Traveler: resonances,
            ...(passive && {
              ExaiphanesBlade: { passive: constant(passive) },
            }),
          },
        } as Data,
      ]).get(premod[stat]).value
    expect(value('critDMG_')).toBeCloseTo(0.42)
    expect(value('critDMG_', 'on')).toBeCloseTo(0.42)
    expect(value('atk_')).toBe(0)
    expect(value('atk_', 'on')).toBeCloseTo(0.4)
  })
})

describe('Light of Foliar Incision', () => {
  const path = 'LightOfFoliarIncision.afterNormalEle'
  it('starts after an elemental Normal hit and ends after 28 Normal or Skill hits', () => {
    const sim = play(
      'Alhaitham CA N1 N5 N5 N5 N5 N5 E N5',
      [['Alhaitham', 'dendro']],
      'LightOfFoliarIncision'
    )
    const normals = times(sim, 'Normal')
    const covered = [...normals.slice(1), ...times(sim, 'Skill')].sort(
      (x, y) => x - y
    )
    // (the first elemental Normal hit triggers it; the Physical one before it does not)
    expect(times(sim, 'Physical Normal')[0]).toBeLessThan(normals[0])
    expect(windows(sim, path)).toEqual([
      [normals[0] + 1, covered[27] + 1, 'on'],
    ])
  })
  it('lasts 12 s, is gained once per 12 s, and never from Physical Normal hits', () => {
    const sim = play(
      'Alhaitham N1 W5 N1 W8 N1',
      [['Alhaitham', 'dendro']],
      'LightOfFoliarIncision'
    )
    const [a, , c] = times(sim, 'Normal')
    const w = windows(sim, path)
    expect(w[0]).toEqual([a + 1, a + 721, 'on'])
    expect(w[1][0]).toBe(c + 1)
    expect(w).toHaveLength(2)
    expect(
      windows(
        play(
          'Alhaitham CA CA CA',
          [['Alhaitham', 'dendro']],
          'LightOfFoliarIncision'
        ),
        path
      )
    ).toEqual([])
  })
})

describe('Uraku Misugiri', () => {
  const path = 'UrakuMisugiri.teamGeo'
  it('doubles for 15 s after a teammate’s Geo DMG', () => {
    const sim = play(
      'KamisatoAyato N1 -> Zhongli E -> KamisatoAyato N1',
      [
        ['KamisatoAyato', 'hydro'],
        ['Zhongli', 'geo'],
      ],
      'UrakuMisugiri'
    )
    const [geo] = times(sim, 'Skill')
    const w = windows(sim, path)
    expect(w).toHaveLength(1)
    expect(w[0][0]).toBe(geo + 1)
    expect(w[0][1]).toBeLessThanOrEqual(geo + 901)
  })
  it('stays off in a team without Geo DMG', () => {
    const sim = play(
      'KamisatoAyato N5 E N5',
      [['KamisatoAyato', 'hydro']],
      'UrakuMisugiri'
    )
    expect(windows(sim, path)).toEqual([])
  })
})

describe("Moonweaver's Dawn", () => {
  const path = 'MoonweaversDawn.energy'
  const tierOf = (k: CharacterKey) => {
    const sim = play(`${k} Q`, [[k, 'hydro']], 'MoonweaversDawn')
    return windows(sim, path).map((w) => w[2])
  }
  it('follows the wielder’s Energy capacity: 40 or less, 60 or less, none above', () => {
    expect(tierOf('Keqing')).toEqual(['40'])
    expect(tierOf('Kaeya')).toEqual(['60'])
    expect(tierOf('Xingqiu')).toEqual([])
  })
})

describe('Sturdy Bone', () => {
  const path = 'SturdyBone.afterSprint'
  it('starts on a dash and ends after 18 Normal hits', () => {
    const sim = play(
      'Keqing N1 D N5 N5 N5 N5',
      [['Keqing', 'electro']],
      'SturdyBone'
    )
    const normals = times(sim, 'Normal')
    const dash = sim.actions.find((a) => a.text === 'D')!.start
    expect(normals[0]).toBeLessThan(dash)
    expect(windows(sim, path)).toEqual([[dash, normals[18] + 1, 'on']])
  })
  it('lasts 7 s at most, and never without a dash', () => {
    const sim = play('Keqing D W8 N1', [['Keqing', 'electro']], 'SturdyBone')
    const dash = sim.actions.find((a) => a.text === 'D')!.start
    expect(windows(sim, path)).toEqual([[dash, dash + 420, 'on']])
    expect(
      windows(play('Keqing N5 N5', [['Keqing', 'electro']], 'SturdyBone'), path)
    ).toEqual([])
  })
})

describe('Wolf-Fang', () => {
  it('stacks Skill CRIT Rate up to 4, each stack refreshing 10 s, from the next frame', () => {
    const sim = play('Kaeya E E E E E W11 E', [['Kaeya', 'cryo']], 'WolfFang')
    const [a, b, c, d, e, f] = times(sim, 'Skill')
    const w = windows(sim, 'WolfFang.skillStacks')
    // (the fifth hit keeps 4 stacks and refreshes them: 10 s from it)
    expect(w.slice(0, 4)).toEqual([
      [a + 1, b + 1, '1'],
      [b + 1, c + 1, '2'],
      [c + 1, d + 1, '3'],
      [d + 1, e + 601, '4'],
    ])
    // (expired after the wait: the next Skill hit starts again at one)
    expect(w[4][0]).toBe(f + 1)
    expect(w[4][2]).toBe('1')
  })
  it('stacks Burst CRIT Rate apart, at most once per 0.1 s', () => {
    const sim = play('Kaeya Q', [['Kaeya', 'cryo']], 'WolfFang')
    const [a, , c] = times(sim, 'Burst')
    expect(
      windows(sim, 'WolfFang.burstStacks').map(([s, , v]) => [s, v])
    ).toEqual([
      [a + 1, '1'],
      [c + 1, '2'],
    ])
    expect(windows(sim, 'WolfFang.skillStacks')).toEqual([])
  })
})

describe('Aquila Favonia', () => {
  it('heals from total ATK with the Healing Bonus', () => {
    const display = (
      getWeaponSheet('AquilaFavonia') as unknown as { data: Data }
    ).data.display as Record<string, Record<string, NumNode>>
    const heal = computeUIData([
      {
        weapon: { key: constant('AquilaFavonia'), refinement: constant(1) },
        total: {
          atk: constant(1000),
          heal_: constant(0.5),
          incHeal_: constant(0),
          healInc: constant(0),
        },
      } as Data,
    ]).get(display['weapon:AquilaFavonia'].heal).value
    expect(heal).toBeCloseTo(1500)
  })
})
