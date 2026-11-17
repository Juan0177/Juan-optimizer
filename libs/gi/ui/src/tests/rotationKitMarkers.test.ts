/**
 * Heal and Bond of Life markers in the healers' and Bond kits (as kqmsim), and weapons that now
 * fire from them: Dialogues of the Desert Sages, Song of Stillness, Absolution and Silvershower
 * Heartstrings.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { weaponTriggersFromRotation } from '../util/teamOpt/energyCalc'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  type SimulationResult,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type {
  HitElement,
  KitModel,
  RotationCalculation,
  SimGear,
  SimHit,
} from '../util/teamOpt/rotation/types'

const ELEMENTS: Partial<Record<CharacterKey, HitElement>> = {
  Diona: 'cryo',
  Qiqi: 'cryo',
  Yaoyao: 'dendro',
  Charlotte: 'cryo',
  Chevreuse: 'pyro',
  Sayu: 'anemo',
  Iansan: 'electro',
  Sigewinne: 'hydro',
  Clorinde: 'electro',
  Arlecchino: 'pyro',
  Bennett: 'pyro',
  Fischl: 'electro',
}

function run(
  members: CharacterKey[],
  text: string,
  options: {
    constellations?: Partial<Record<CharacterKey, number>>
    target?: { radius: number; distance: number }
    gear?: Partial<Record<CharacterKey, SimGear>>
    kits?: Partial<Record<CharacterKey, KitModel>>
    calculate?: RotationCalculation
  } = {}
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((m) => [m, ELEMENTS[m]])),
    constellations: options.constellations ?? {},
    repeats: 1,
    keep: 'all',
    ...(options.target && { target: options.target }),
    ...(options.gear && { gear: options.gear }),
    ...(options.kits && { kits: { ...kitModels, ...options.kits } }),
    ...(options.calculate && { calculate: options.calculate }),
  })
}

/** `healer`'s heals on `node` (e.g. 'burst.healDot'): when, and whom */
const heals = (sim: SimulationResult, healer: CharacterKey, node: string) =>
  sim.hits
    .filter(
      (h) =>
        h.path[0] === '_heal' &&
        h.characterKey === healer &&
        h.path.slice(1).join('.') === node
    )
    .map((h) => ({ t: h.t, to: h.healTargets }))

const times = (list: { t: number }[]) => list.map((h) => h.t)

/** The member on the field at each heal's frame (the heal's own onField) */
const healOnField = (
  sim: SimulationResult,
  healer: CharacterKey,
  node: string
) =>
  sim.hits
    .filter(
      (h) =>
        h.path[0] === '_heal' &&
        h.characterKey === healer &&
        h.path.slice(1).join('.') === node
    )
    .map((h) => ({ t: h.t, to: h.healTargets, onField: h.onField }))

const bondMarkers = (sim: SimulationResult, k: CharacterKey) =>
  sim.hits
    .filter(
      (h: SimHit) =>
        h.characterKey === k &&
        h.path[0] === '_marker' &&
        h.path[1] === 'bondOfLife'
    )
    .map((h) => ({ t: h.t, dir: h.path[2] }))

/** HP is tracked: 20000 Max HP, every heal node 3000 */
const calculate: RotationCalculation = (_k, path) => {
  if (path.join('.') === 'total.hp') return 20000
  if (path[0] === 'total') return 0
  return 3000
}

/** A teammate whose start drains `who` to half HP */
const drainer = (characterKey: CharacterKey, who: CharacterKey): KitModel => ({
  characterKey,
  element: 'pyro',
  source: 'test',
  onStart(c) {
    c.at(0, (at) => at.drainHp(who, 0.5))
  },
  act: () => ({ frames: 30 }),
})

describe('heal markers', () => {
  it('Diona: each Signature Mix tick heals the member on the field', () => {
    const sim = run(['Diona', 'Bennett'], 'Diona Q W3 -> Bennett W12')
    const list = healOnField(sim, 'Diona', 'burst.healDot')
    expect(times(list)).toEqual([178, 298, 418, 538, 658, 778])
    for (const h of list) expect(h.to).toEqual([h.onField])
    expect(new Set(list.map((h) => h.onField))).toEqual(
      new Set(['Diona', 'Bennett'])
    )
  })

  it('Qiqi: Herald regen every 4.5 s, and a party heal per Normal hit in it', () => {
    const sim = run(['Qiqi', 'Bennett'], 'Qiqi E N3 -> Bennett W14')
    const regen = healOnField(sim, 'Qiqi', 'skill.contRegen')
    expect(times(regen)).toEqual([32, 302, 572, 842])
    for (const h of regen) expect(h.to).toEqual([h.onField])
    const normals = sim.hits
      .filter((h) => h.characterKey === 'Qiqi' && h.tag === 'normal')
      .map((h) => h.t)
    const onHit = heals(sim, 'Qiqi', 'skill.hitRegen')
    expect(normals).toHaveLength(4)
    expect(times(onHit)).toEqual(normals)
    for (const h of onHit) expect(h.to).toEqual(['Qiqi', 'Bennett'])
  })

  it('Qiqi: the Talisman heals the member who hits, once per 1 s; C4 adds a heal', () => {
    const sim = run(['Qiqi', 'Bennett'], 'Qiqi Q -> Bennett N5 N5 W2', {
      constellations: { Qiqi: 4 },
    })
    const list = heals(sim, 'Qiqi', 'burst.heal')
    // her own burst hit (82 frames in) is the first, then Bennett's hits
    expect(list[0]).toEqual({ t: 82, to: ['Qiqi'] })
    expect(list.slice(1).every((h) => h.to?.[0] === 'Bennett')).toBe(true)
    expect(list.length).toBeGreaterThan(2)
    for (let i = 1; i < list.length; i++)
      expect(list[i].t - list[i - 1].t).toBeGreaterThanOrEqual(61)
    // C4: each one also heals the lowest-HP member (Qiqi on ties: HP is not tracked)
    expect(heals(sim, 'Qiqi', 'constellation4.heal')).toEqual(
      list.map((h) => ({ t: h.t, to: ['Qiqi'] }))
    )
    expect(
      heals(
        run(['Qiqi', 'Bennett'], 'Qiqi Q -> Bennett N5 W2'),
        'Qiqi',
        'constellation4.heal'
      )
    ).toEqual([])
  })

  it('Yaoyao: radishes heal only within 2 m of the player (not at the standard 2.4 m)', () => {
    expect(
      heals(run(['Yaoyao'], 'Yaoyao E W12'), 'Yaoyao', 'skill.heal')
    ).toEqual([])
    const close = run(['Yaoyao'], 'Yaoyao E W16', {
      target: { radius: 2, distance: 1.5 },
    })
    const radish = heals(close, 'Yaoyao', 'skill.heal')
    // a throw every 60 frames from 92 while the Yuegui lasts, landing 13 frames later
    expect(times(radish)).toEqual([
      105, 165, 225, 285, 345, 405, 465, 525, 585, 645,
    ])
    for (const h of radish) expect(h.to).toEqual(['Yaoyao'])
    // A4: every 1 s for 5 s after the last radish heal
    expect(
      times(heals(close, 'Yaoyao', 'passive2.heal')).filter((t) => t > 645)
    ).toEqual([705, 765, 825, 885, 945])
  })

  it('Yaoyao: at 70% HP or less the Yuegui throws at the player, which heals', () => {
    const sim = run(['Yaoyao', 'Bennett'], 'Yaoyao E W5', {
      kits: { Bennett: drainer('Bennett', 'Yaoyao') },
      calculate,
    })
    // 50% HP: the 1st and 2nd throws land on her (+15% each), then she is above 70%
    expect(times(heals(sim, 'Yaoyao', 'skill.heal'))).toEqual([105, 165])
  })

  it('Yaoyao C6: the Mega Radish heals within its 4 m (the 3rd and 6th throws)', () => {
    const sim = run(['Yaoyao'], 'Yaoyao E W12', {
      constellations: { Yaoyao: 6 },
    })
    expect(heals(sim, 'Yaoyao', 'constellation6.heal')).toEqual([
      { t: 232, to: ['Yaoyao'] },
      { t: 412, to: ['Yaoyao'] },
    ])
  })

  it('Charlotte: the cast heals the party, Kamera the active member; C1 regenerates', () => {
    const c0 = run(['Charlotte', 'Bennett'], 'Charlotte Q W8')
    expect(heals(c0, 'Charlotte', 'burst.castHeal')).toEqual([
      { t: 53, to: ['Charlotte', 'Bennett'] },
    ])
    expect(heals(c0, 'Charlotte', 'burst.kameraHeal')).toEqual(
      [95, 119, 143, 166, 179, 203, 226, 249].map((t) => ({
        t,
        to: ['Charlotte'],
      }))
    )
    expect(heals(c0, 'Charlotte', 'constellation1.heal')).toEqual([])
    const c1 = run(['Charlotte', 'Bennett'], 'Charlotte Q W8', {
      constellations: { Charlotte: 1 },
    })
    const verification = heals(c1, 'Charlotte', 'constellation1.heal')
    for (const m of ['Charlotte', 'Bennett'] as const)
      expect(times(verification.filter((h) => h.to?.[0] === m))).toEqual([
        53, 173, 293, 413,
      ])
  })

  it('Chevreuse: her E heals the active member every 2 s for 12 s; C6 heals the party at its end', () => {
    const c0 = run(['Chevreuse', 'Bennett'], 'Chevreuse E W14')
    expect(heals(c0, 'Chevreuse', 'skill.heal')).toEqual(
      [138, 258, 378, 498, 618, 738].map((t) => ({ t, to: ['Chevreuse'] }))
    )
    expect(heals(c0, 'Chevreuse', 'constellation6.heal')).toEqual([])
    const c6 = run(['Chevreuse', 'Bennett'], 'Chevreuse E W14', {
      constellations: { Chevreuse: 6 },
    })
    expect(heals(c6, 'Chevreuse', 'constellation6.heal')).toEqual([
      { t: 738, to: ['Chevreuse', 'Bennett'] },
    ])
  })

  it('Sayu: the cast heals the party; Daruma attacks, or heals too at C1', () => {
    const daruma = (sim: SimulationResult) =>
      sim.hits
        .filter((h) => h.path.join('.') === 'burst.darumaDmg')
        .map((h) => h.t)
    const c0 = run(['Sayu', 'Bennett'], 'Sayu Q W12')
    expect(heals(c0, 'Sayu', 'burst.pressHeal')).toEqual([
      { t: 0, to: ['Sayu', 'Bennett'] },
    ])
    expect(heals(c0, 'Sayu', 'burst.darumaHeal')).toEqual([])
    expect(daruma(c0)).toHaveLength(6)
    const c1 = run(['Sayu', 'Bennett'], 'Sayu Q W12', {
      constellations: { Sayu: 1 },
    })
    expect(times(heals(c1, 'Sayu', 'burst.darumaHeal'))).toEqual(daruma(c1))
    expect(daruma(c1)).toEqual(daruma(c0))
  })

  it('Sayu: at 70% HP or less a Daruma tick heals instead of attacking', () => {
    const sim = run(['Sayu', 'Bennett'], 'Sayu Q W12', {
      kits: { Bennett: drainer('Bennett', 'Sayu') },
      calculate,
    })
    const healed = times(heals(sim, 'Sayu', 'burst.darumaHeal'))
    const attacked = sim.hits
      .filter((h) => h.path.join('.') === 'burst.darumaDmg')
      .map((h) => h.t)
    // the first ticks heal her back above 70%, then they attack; never both (C0)
    expect(healed.length).toBeGreaterThan(0)
    expect(healed.length + attacked.length).toBe(6)
    expect(Math.max(...healed)).toBeLessThan(Math.min(...attacked))
  })

  it('Sayu A1: her Swirl on the field heals the party, once per 2 s', () => {
    const sim = run(['Sayu', 'Bennett'], 'Bennett E -> Sayu E W1')
    const swirls = sim.hits
      .filter(
        (h) =>
          h.characterKey === 'Sayu' &&
          h.path[0] === '_reaction' &&
          h.path[1] === 'pyroSwirl'
      )
      .map((h) => h.t)
    expect(swirls.length).toBeGreaterThan(1)
    expect(heals(sim, 'Sayu', 'passive1.heal')).toEqual([
      { t: swirls[0], to: ['Sayu', 'Bennett'] },
    ])
  })

  it('Iansan A4: Scale restores heal the active member within 10 s of a Nightsoul Burst', () => {
    const sim = run(['Iansan'], 'Iansan E CA Q W6')
    const list = heals(sim, 'Iansan', 'passive2.heal')
    const bursts = sim.hits
      .filter((h) => h.path[0] === '_nightsoulBurst')
      .map((h) => h.t)
    expect(list.length).toBeGreaterThan(0)
    for (const h of list) {
      expect(h.to).toEqual(['Iansan'])
      expect(bursts.some((b) => b <= h.t && h.t <= b + 610)).toBe(true)
    }
    for (let i = 1; i < list.length; i++)
      expect(list[i].t - list[i - 1].t).toBeGreaterThan(168)
  })
})

describe('Bond of Life markers', () => {
  it('Sigewinne: her burst takes her 2 droplets, 2 gains 99 frames in', () => {
    const sim = run(['Sigewinne'], 'Sigewinne E Q W3')
    const q = sim.actions.find((a) => a.text.includes('Q'))!.start
    expect(bondMarkers(sim, 'Sigewinne')).toEqual([
      { t: q + 99, dir: 'gain' },
      { t: q + 99, dir: 'gain' },
    ])
    expect(
      bondMarkers(run(['Sigewinne'], 'Sigewinne Q W3'), 'Sigewinne')
    ).toEqual([])
  })

  it('Clorinde: Swift Hunt gains, Impale the Night loses', () => {
    const sim = run(['Clorinde'], 'Clorinde E N2 E W1')
    expect(bondMarkers(sim, 'Clorinde').map((m) => m.dir)).toEqual([
      'gain',
      'gain',
      'loss',
    ])
  })

  it('Arlecchino: the absorbed directive gains, Masque hits and the burst lose', () => {
    const sim = run(['Arlecchino'], 'Arlecchino E W1 CA N3 Q W2')
    const dirs = bondMarkers(sim, 'Arlecchino').map((m) => m.dir)
    expect(dirs[0]).toBe('gain')
    expect(dirs.slice(1).length).toBeGreaterThan(1)
    expect(dirs.slice(1).every((d) => d === 'loss')).toBe(true)
  })
})

describe('weapons that fire from these markers', () => {
  it('Dialogues of the Desert Sages: Energy from Yaoyao’s heals (none at 2.4 m)', () => {
    const triggers = (distance: number) => {
      const sim = run(['Yaoyao'], 'Yaoyao E W12', {
        target: { radius: 2, distance },
      })
      return weaponTriggersFromRotation(sim, ['Yaoyao']).Yaoyao
        ?.DialoguesOfTheDesertSages
    }
    // (once per 10 s: the 1st radish heal at 105 and an A4 heal from 705)
    expect(triggers(1.5)).toBe(2)
    expect(triggers(2.4)).toBeUndefined()
  })

  it('Song of Stillness: on for 8 s after each Diona heal that reaches its wielder', () => {
    const sim = run(['Diona', 'Fischl'], 'Diona Q -> Fischl W14', {
      gear: { Fischl: { weapon: 'SongOfStillness', refinement: 1 } },
    })
    const windows = sim.buffWindows
      .filter(
        (w) =>
          w.path.join('.') === 'SongOfStillness.afterHeal' &&
          w.value === 'on' &&
          w.end > w.start
      )
      .map((w) => w.start)
    expect(windows).toEqual([178, 298, 418, 538, 658, 778])
  })

  it('Absolution: DMG stacks from Clorinde’s Bond of Life gains', () => {
    const sim = run(['Clorinde'], 'Clorinde E N2 W1', {
      gear: { Clorinde: { weapon: 'Absolution', refinement: 1 } },
    })
    const gains = bondMarkers(sim, 'Clorinde').map((m) => m.t)
    const stacks = sim.buffWindows.filter(
      (w) =>
        w.path.join('.') === 'Absolution.bondStacks' &&
        w.value !== '' &&
        w.end > w.start
    )
    expect(gains).toHaveLength(2)
    expect(stacks.find((w) => w.value === '1')?.start).toBe(gains[0] + 1)
    expect(stacks.find((w) => w.value === '2')?.start).toBe(gains[1] + 1)
  })

  it('Silvershower Heartstrings: Sigewinne reaches 3 stacks with her Bond of Life', () => {
    const values = (text: string) =>
      new Set(
        run(['Sigewinne'], text, {
          gear: {
            Sigewinne: { weapon: 'SilvershowerHeartstrings', refinement: 1 },
          },
        })
          .buffWindows.filter(
            (w) =>
              w.path.join('.') === 'SilvershowerHeartstrings.blessingStacks' &&
              w.end > w.start
          )
          .map((w) => w.value)
      )
    expect(values('Sigewinne E Q W10').has('3')).toBe(true)
    // without the droplets (no Skill before the burst), no Bond stack
    expect(values('Sigewinne Q E W10').has('3')).toBe(false)
  })
})
