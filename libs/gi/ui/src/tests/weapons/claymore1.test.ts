/**
 * Weapon audit batch claymore1: the rotation simulation plays A Teaspoon of Transcendence, Fang of
 * the Mountain King, Skyward Pride, Akuoumaru, Blazing Lionfang, Flame-Forged Insight, Fruitful
 * Hook, Luxurious Sea-Lord, Master Key, Serpent Spine, Whiteblind and the beta Royal Decree claymore
 * (rotation/weapons/claymore1.ts, as kqmsim and the game's text), with test kits; and the sheet
 * fixes (Master Key's EM gated by its conditional, Fruitful Hook's buff the wielder's own,
 * Blazing Lionfang's CD label).
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { computeUIData } from '@genshin-optimizer/gi/uidata'
import type { Data, NumNode } from '@genshin-optimizer/gi/wr'
import { constant } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import {
  parseRotation,
  type RotationAction,
} from '../../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type {
  HitElement,
  HitTag,
  KitModel,
  SimGear,
} from '../../util/teamOpt/rotation/types'

type Step = {
  at: number
  tag: HitTag
  path?: string[]
  element?: HitElement
  characterKey?: CharacterKey
  label?: string
}
type Script = Partial<
  Record<
    RotationAction['kind'],
    { frames: number; hits?: Step[] | ((a: RotationAction) => Step[]) }
  >
>

/** A kit that lands the given hits for each action kind (frames from the action's start) */
function kit(
  characterKey: CharacterKey,
  element: HitElement,
  script: Script = {}
): KitModel {
  return {
    characterKey,
    element,
    source: 'test',
    act(ctx, _state, action) {
      const s = script[action.kind] ?? { frames: 30 }
      const hits = typeof s.hits === 'function' ? s.hits(action) : s.hits
      for (const h of hits ?? [])
        ctx.hit(h.at, {
          path: h.path ?? [h.tag, 'dmg'],
          tag: h.tag,
          element: h.element ?? element,
          label: h.label ?? `${action.kind} ${h.at}`,
          ...(h.characterKey && { characterKey: h.characterKey }),
        })
      return { frames: s.frames }
    },
  }
}
const reaction = (
  at: number,
  name: string,
  characterKey?: CharacterKey
): Step => ({
  at,
  tag: 'other',
  path: ['_reaction', name],
  element: 'physical',
  ...(characterKey && { characterKey }),
})

function run(
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
    elements: Object.fromEntries(members.map((m) => [m, kits[m]!.element])),
    repeats: 1,
    kits,
    reactions: { onHit() {} },
    gear,
  })
}
const windowsOf = (sim: ReturnType<typeof simulateRotation>, path: string) =>
  sim.buffWindows
    // (the buff's windows; '' is a timed state's off span)
    .filter(
      (w) => w.path.join('.') === path && w.end > w.start && w.value !== ''
    )
    .map((w) => [w.value, w.start, w.end])
const procTimes = (sim: ReturnType<typeof simulateRotation>, weapon: string) =>
  sim.hits.filter((h) => h.path[0] === `weapon:${weapon}`).map((h) => h.t)

describe('A Teaspoon of Transcendence', () => {
  it('a stack per Charged hit (0.2 s apart), all refreshed to 5 s, at most 3, reset after', () => {
    const sim = run(
      'Eula CA',
      {
        Eula: kit('Eula', 'cryo', {
          charged: {
            frames: 1000,
            hits: [0, 5, 20, 40, 400].map((at) => ({ at, tag: 'charged' })),
          },
        }),
      },
      { Eula: { weapon: 'ATeaspoonOfTranscendence', refinement: 1 } }
    )
    expect(windowsOf(sim, 'ATeaspoonOfTranscendence.passive')).toEqual([
      ['1', 0, 20],
      ['2', 20, 40],
      ['3', 40, 340],
      ['1', 400, 700],
    ])
  })
})

describe('Fang of the Mountain King', () => {
  const sim = run(
    'Kinich E',
    {
      Kinich: kit('Kinich', 'dendro', {
        skill: {
          frames: 900,
          hits: [
            { at: 0, tag: 'skill' },
            { at: 10, tag: 'skill' },
            { at: 40, tag: 'skill' },
            // a teammate starts Burning (+3), again within 2 s (none), then Burgeon (+3)
            reaction(100, 'burning', 'Emilie'),
            reaction(150, 'burning', 'Emilie'),
            {
              at: 300,
              tag: 'other',
              path: ['reaction', 'burgeon'],
              element: 'dendro',
              characterKey: 'Emilie',
            },
            { at: 310, tag: 'skill', label: 'probe' },
          ],
        },
      }),
      Emilie: kit('Emilie', 'dendro'),
    },
    { Kinich: { weapon: 'FangOfTheMountainKing', refinement: 1 } }
  )
  it('one 6 s stack per Skill hit (0.5 s apart), three per party Burning or Burgeon (2 s apart)', () => {
    const w = sim.buffWindows.filter(
      (x) =>
        x.path.join('.') === 'FangOfTheMountainKing.stacks' && x.end > x.start
    )
    expect(w.map((x) => x.start)).toEqual([
      1, 41, 101, 101, 101, 301, 301, 301, 311,
    ])
    expect(w.every((x) => x.end - x.start === 360 && x.max === 6)).toBe(true)
  })
  it('counts them up to 6', () => {
    const states = rotationAttacks(sim)
      .Kinich!.find((a) => a.description === 'probe')!
      .states?.find((s) => s.path.join('.') === 'FangOfTheMountainKing.stacks')
    expect(states?.value).toBe('6')
  })
})

describe('Skyward Pride', () => {
  const eula = (script: Script) =>
    kit('Eula', 'cryo', {
      normal: {
        frames: 200,
        hits: (a) =>
          Array.from({ length: a.count ?? 1 }, (_, i) => ({
            at: i * 20,
            tag: 'normal' as const,
            element: 'physical' as const,
          })),
      },
      burst: { frames: 60 },
      ...script,
    })
  it('a blade per Normal hit after the Burst, 1 frame later, at most 8', () => {
    const sim = run(
      'Eula N2 Q N5 N5',
      { Eula: eula({}) },
      { Eula: { weapon: 'SkywardPride', refinement: 1 } }
    )
    const burst = sim.actions.find((a) => /^q$/i.test(a.text))!.start
    const normals = sim.hits
      .filter((h) => h.tag === 'normal' && h.t > burst)
      .map((h) => h.t)
    expect(normals).toHaveLength(10)
    expect(procTimes(sim, 'SkywardPride')).toEqual(
      normals.slice(0, 8).map((t) => t + 1)
    )
  })
  it('none before the Burst, nor 20 s after it', () => {
    const sim = run(
      'Eula N2 Q E N2',
      { Eula: eula({ skill: { frames: 1300 } }) },
      { Eula: { weapon: 'SkywardPride', refinement: 1 } }
    )
    expect(procTimes(sim, 'SkywardPride')).toEqual([])
  })
})

describe('Akuoumaru', () => {
  it('its state is the party’s combined max Energy for the whole run', () => {
    const sim = run(
      'Beidou E',
      {
        Beidou: kit('Beidou', 'electro', { skill: { frames: 600 } }),
        Bennett: kit('Bennett', 'pyro'),
        Xiangling: kit('Xiangling', 'pyro'),
        Xingqiu: kit('Xingqiu', 'hydro'),
      },
      { Beidou: { weapon: 'Akuoumaru', refinement: 1 } }
    )
    // (80 + 60 + 80 + 80), from the start to the run's end
    const w = windowsOf(sim, 'Akuoumaru.WatatsumiWavewalker')
    expect(w.map(([value, start]) => [value, start])).toEqual([['300', 0]])
    expect(w[0][2]).toBeGreaterThanOrEqual(600)
  })
})

describe('Blazing Lionfang', () => {
  const sim = run(
    'Bennett E -> Dehya E -> Bennett E -> Dehya E',
    {
      Bennett: kit('Bennett', 'pyro', { skill: { frames: 400 } }),
      Dehya: kit('Dehya', 'pyro', { skill: { frames: 700 } }),
    },
    { Dehya: { weapon: 'BlazingLionfang', refinement: 1 } }
  )
  const starts = (k: CharacterKey) =>
    sim.actions.filter((a) => a.characterKey === k).map((a) => a.start)
  it('Reforged Blade after 5 s off the field in total, lost after 10 s on it', () => {
    const [d1, d2] = starts('Dehya')
    const [, b2] = starts('Bennett')
    expect(windowsOf(sim, 'BlazingLionfang.reforgedBlade')).toEqual([
      ['on', 300, d1 + 600],
      ['on', b2 + 300, d2 + 600],
    ])
  })
  it('deals its switch-in DMG as the wielder takes the field with it, once per 14 s', () => {
    expect(procTimes(sim, 'BlazingLionfang')).toEqual(starts('Dehya'))
  })
})

describe('Flame-Forged Insight', () => {
  it('EM for 15 s after the wielder’s own EC, Bloom or Crystallize, once per 15 s', () => {
    const sim = run(
      'Beidou E',
      {
        Beidou: kit('Beidou', 'electro', {
          skill: {
            frames: 2400,
            hits: [
              reaction(0, 'electroCharged'),
              reaction(300, 'bloom'), // in cooldown
              reaction(1000, 'crystallize'),
              reaction(1950, 'melt'), // not one of its reactions
              reaction(2000, 'bloom', 'Bennett'), // a teammate's
            ],
          },
        }),
        Bennett: kit('Bennett', 'pyro'),
      },
      { Beidou: { weapon: 'FlameForgedInsight', refinement: 5 } }
    )
    expect(windowsOf(sim, 'FlameForgedInsight.passive')).toEqual([
      ['on', 0, 900],
      ['on', 1000, 1900],
    ])
  })
})

describe('Fruitful Hook', () => {
  it('10 s after each Plunging hit, from the next hit on', () => {
    const sim = run(
      'Gaming P',
      {
        Gaming: kit('Gaming', 'pyro', {
          plunge: {
            frames: 2400,
            hits: [0, 300, 1500].map((at) => ({ at, tag: 'plunge' })),
          },
        }),
      },
      { Gaming: { weapon: 'FruitfulHook', refinement: 1 } }
    )
    expect(windowsOf(sim, 'FruitfulHook.afterPlunging')).toEqual([
      ['on', 1, 901],
      ['on', 1501, 2101],
    ])
  })
  it('is the wielder’s own buff (not a team buff)', () => {
    const doc = getWeaponSheet('FruitfulHook').document.find(
      (d) => 'path' in d && d.path?.[1] === 'afterPlunging'
    ) as { teamBuff?: boolean } | undefined
    expect(doc).toBeDefined()
    expect(doc?.teamBuff).toBeFalsy()
  })
})

describe('Luxurious Sea-Lord', () => {
  it('tuna 1 frame after an on-field Burst hit, once per 15 s', () => {
    const sim = run(
      'Beidou Q',
      {
        Beidou: kit('Beidou', 'electro', {
          burst: {
            frames: 1200,
            hits: [0, 100, 1000].map((at) => ({ at, tag: 'burst' })),
          },
        }),
      },
      { Beidou: { weapon: 'LuxuriousSeaLord', refinement: 1 } }
    )
    expect(procTimes(sim, 'LuxuriousSeaLord')).toEqual([1, 1001])
  })
  it('none from the wielder’s Burst hits while it is off the field', () => {
    const sim = run(
      'Beidou Q -> Bennett E',
      {
        Beidou: kit('Beidou', 'electro', {
          burst: { frames: 100, hits: [{ at: 0, tag: 'burst' }] },
        }),
        Bennett: kit('Bennett', 'pyro', {
          skill: {
            frames: 1200,
            hits: [{ at: 1000, tag: 'burst', characterKey: 'Beidou' }],
          },
        }),
      },
      { Beidou: { weapon: 'LuxuriousSeaLord', refinement: 1 } }
    )
    expect(procTimes(sim, 'LuxuriousSeaLord')).toEqual([1])
  })
})

describe('Master Key', () => {
  it('its EM only while its conditional is on (after a reaction), doubled at Ascendant Gleam', () => {
    const premod = (getWeaponSheet('MasterKey') as unknown as { data: Data })
      .data.premod as Record<string, NumNode>
    const em = (refinement: number, on: boolean, moonsign = 0) =>
      computeUIData([
        {
          weapon: {
            key: constant('MasterKey'),
            refinement: constant(refinement),
          },
          tally: { moonsign: constant(moonsign) },
          ...(on && {
            conditional: { MasterKey: { afterReaction: constant('on') } },
          }),
        } as Data,
      ]).get(premod['eleMas']).value
    expect(em(1, false)).toBe(0)
    expect(em(1, false, 2)).toBe(0)
    expect(em(1, true)).toBe(60)
    expect(em(1, true, 2)).toBe(120)
    expect(em(5, true)).toBe(120)
    expect(em(5, true, 2)).toBe(240)
  })
  it('12 s after each reaction the wielder triggers, refreshed by each', () => {
    const sim = run(
      'Beidou E',
      {
        Beidou: kit('Beidou', 'electro', {
          skill: {
            frames: 3000,
            hits: [
              reaction(0, 'superconduct'),
              reaction(600, 'overloaded'),
              reaction(1500, 'moondrift'), // not a reaction
              reaction(1600, 'overloaded', 'Bennett'), // a teammate's
              {
                at: 2000,
                tag: 'other',
                path: ['reaction', 'hyperbloom'],
                element: 'dendro',
              },
            ],
          },
        }),
        Bennett: kit('Bennett', 'pyro'),
      },
      { Beidou: { weapon: 'MasterKey', refinement: 1 } }
    )
    expect(windowsOf(sim, 'MasterKey.afterReaction')).toEqual([
      ['on', 0, 720],
      ['on', 600, 1320],
      ['on', 2000, 2720],
    ])
  })
})

describe('Serpent Spine', () => {
  const kits = {
    Eula: kit('Eula', 'cryo', { skill: { frames: 500 } }),
    Bennett: kit('Bennett', 'pyro', { skill: { frames: 500 } }),
  }
  const gear = { Eula: { weapon: 'SerpentSpine', refinement: 1 } }
  it('at its 5 stacks for a wielder on the field at a 4 s tick', () => {
    const w = windowsOf(run('Eula E', kits, gear), 'SerpentSpine.Wavesplitter')
    expect(w.map(([value, start]) => [value, start])).toEqual([['5', 0]])
    expect(w[0][2]).toBeGreaterThanOrEqual(500)
  })
  it('none for a wielder never on the field', () => {
    expect(
      windowsOf(run('Bennett E', kits, gear), 'SerpentSpine.Wavesplitter')
    ).toEqual([])
  })
})

describe('Whiteblind', () => {
  it('a stack per on-field Normal hit (0.5 s apart), all refreshed to 6 s, at most 4', () => {
    const sim = run(
      'Noelle N1',
      {
        Noelle: kit('Noelle', 'geo', {
          normal: {
            frames: 1000,
            hits: [0, 10, 40, 80, 120, 600].map((at) => ({
              at,
              tag: 'normal',
            })),
          },
        }),
      },
      { Noelle: { weapon: 'Whiteblind', refinement: 1 } }
    )
    expect(windowsOf(sim, 'Whiteblind.stack')).toEqual([
      ['1', 1, 41],
      ['2', 41, 81],
      ['3', 81, 121],
      ['4', 121, 481],
      ['1', 601, 961],
    ])
  })
})

describe('the beta Royal Decree claymore', () => {
  it('decree 15 s after Electro hits, complete from a Stellar-Conduct hit to its end', () => {
    const sim = run(
      'Beidou E',
      {
        Beidou: kit('Beidou', 'electro', {
          skill: {
            frames: 3000,
            hits: [
              { at: 0, tag: 'skill' },
              { at: 300, tag: 'directStellarConduct', element: 'cryo' },
              { at: 600, tag: 'skill' }, // refreshes the decree (kept complete)
              { at: 1600, tag: 'directStellarConduct', element: 'cryo' }, // no decree
              { at: 2000, tag: 'skill' },
            ],
          },
        }),
      },
      { Beidou: { weapon: 'TorrentsOfSpring', refinement: 1 } }
    )
    expect(windowsOf(sim, 'TorrentsOfSpring.royalDecree')).toEqual([
      ['decree', 0, 300],
      ['complete', 300, 1500],
      ['decree', 2000, 2900],
    ])
  })
})

describe('Blazing Lionfang’s sheet', () => {
  it('labels its cooldown with the shared CD text', () => {
    const doc = getWeaponSheet('BlazingLionfang').document[0] as unknown as {
      states: Record<
        string,
        { fields: { text?: { props?: { ns?: string } } }[] }
      >
    }
    const cd = doc.states.on.fields.find((f) => f.text)
    expect(cd?.text?.props?.ns).toBe('sheet_gen')
  })
})
