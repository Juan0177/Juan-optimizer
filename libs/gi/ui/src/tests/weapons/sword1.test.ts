/**
 * Weapon audit batch sword1: the rotation simulation times Absolution, Beyond the Chrysalis, Key
 * of Khaj-Nisut, Peak Patrol Song, Flute of Ezpitzal, Silver Light and Toukabou Shigure from the
 * wielder's own triggers (rotation/weapons/sword1.ts), with a small test kit.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import {
  parseRotation,
  type RotationActionKind,
} from '../../util/teamOpt/rotation/parse'
import {
  type SimulationResult,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type {
  HitTag,
  KitModel,
  SimContext,
} from '../../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['Clorinde', 'Bennett']
const hitAt = (
  c: SimContext,
  delay: number,
  tag: HitTag,
  path: string[],
  label: string
) => c.hit(delay, { path, tag, element: 'electro', label })

/**
 * The wielder: E, Q and P hit 5 frames in (30-frame actions), a Normal string's hits 10 frames
 * in and every 20 frames; `own` replaces an action's hits
 */
function blade(
  own: Partial<Record<RotationActionKind, (c: SimContext) => void>> = {}
): KitModel {
  return {
    characterKey: 'Clorinde',
    element: 'electro',
    source: 'test',
    act(c, _s, action) {
      const replace = own[action.kind]
      if (replace) {
        replace(c)
        return { frames: 30 }
      }
      if (action.kind === 'normal') {
        const n = action.count ?? 1
        for (let i = 0; i < n; i++)
          hitAt(c, 10 + 20 * i, 'normal', ['normal', '0'], `N${i + 1}`)
        return { frames: 20 * n + 10 }
      }
      if (action.kind === 'skill') hitAt(c, 5, 'skill', ['skill', 'dmg'], 'E')
      else if (action.kind === 'burst')
        hitAt(c, 5, 'burst', ['burst', 'dmg'], 'Q')
      else if (action.kind === 'plunge')
        hitAt(c, 5, 'plunge', ['plunge', 'dmg'], 'P')
      return { frames: 30 }
    },
  }
}
const idle: KitModel = {
  characterKey: 'Bennett',
  element: 'pyro',
  source: 'test',
  act: () => ({ frames: 30 }),
}

function run(text: string, weapon: string, kit = blade()) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Clorinde: 'electro', Bennett: 'pyro' },
    constellations: {},
    kits: { Clorinde: kit, Bennett: idle },
    gear: { Clorinde: { weapon, refinement: 1 } },
    repeats: 1,
    keep: 'all',
  })
}
/**
 * The wielder's buff spans of a conditional (value, start, end): touching windows of one value
 * merged (a refresh re-sets the state), the off state ('') and declared ones left out
 */
const windows = (sim: SimulationResult, path: string) => {
  const out: [string, number, number][] = []
  const list = sim.buffWindows
    .filter(
      (w) =>
        w.owner === 'Clorinde' &&
        w.path.join('.') === path &&
        w.value !== '' &&
        w.end > w.start
    )
    .sort((a, b) => a.start - b.start)
  for (const w of list) {
    const last = out[out.length - 1]
    if (last && last[0] === w.value && last[2] === w.start) last[2] = w.end
    else out.push([w.value, w.start, w.end])
  }
  return out
}
const declared = (sim: SimulationResult, path: string) =>
  sim.buffWindows.some(
    (w) => w.owner === 'Clorinde' && w.path.join('.') === path
  )
/** When the wielder's hits with this label land */
const times = (sim: SimulationResult, label: string) =>
  sim.hits
    .filter((h) => h.characterKey === 'Clorinde' && h.label === label)
    .map((h) => h.t)
/** When the wielder's actions start */
const starts = (sim: SimulationResult, text: string) =>
  sim.actions
    .filter((a) => a.characterKey === 'Clorinde' && a.text === text)
    .map((a) => a.start)

describe('Absolution: DMG stacks from Bond of Life gains', () => {
  const marker = (kind?: string) => (c: SimContext) =>
    c.hit(5, {
      path: ['_marker', 'bondOfLife', ...(kind ? [kind] : [])],
      tag: 'other',
      element: 'electro',
      label: `bond ${kind ?? 'changed'}`,
    })
  const kit = blade({
    skill: marker('gain'),
    burst: marker('loss'),
    charged: marker(),
  })
  const sim = run('Clorinde E E Q CA E E W7 E', 'Absolution', kit)
  const gains = times(sim, 'bond gain')
  it('stacks to 3 from gains only, all refreshed, and starts over after 6 s', () => {
    expect(gains).toHaveLength(5)
    const [g1, g2, g3, g4, g5] = gains.map((t) => t + 1)
    expect(windows(sim, 'Absolution.bondStacks')).toEqual([
      ['1', g1, g2],
      ['2', g2, g3],
      ['3', g3, g4 + 360],
      ['1', g5, g5 + 360],
    ])
  })
  it('is declared off, and not for another sword', () => {
    expect(declared(sim, 'Absolution.bondStacks')).toBe(true)
    const other = run('Clorinde E E', 'FavoniusSword', kit)
    expect(declared(other, 'Absolution.bondStacks')).toBe(false)
  })
})

describe('Beyond the Chrysalis: Devotion, Defiance, Plenty in turn, ended on swap-out', () => {
  const sim = run(
    'Clorinde E Q E E -> Bennett E -> Clorinde Q',
    'BeyondTheChrysalis'
  )
  const [e1, , e3] = starts(sim, 'E')
  const [q1, q2] = starts(sim, 'Q')
  const out = sim.swaps![0].start + sim.swaps![0].frames
  it('opens Devotion, then Defiance; the third use (Plenty) opens neither', () => {
    // (the 4th use is Devotion again: its window goes on from the first)
    expect(windows(sim, 'BeyondTheChrysalis.devotion')).toEqual([
      ['on', e1, out],
      ['on', q2, q2 + 600],
    ])
    expect(windows(sim, 'BeyondTheChrysalis.defiance')).toEqual([
      ['on', q1, out],
    ])
    expect(e3).toBeLessThan(out)
  })
})

describe('Key of Khaj-Nisut: Grand Hymn from Skill hits on the field', () => {
  const kit = blade({
    // two Skill hits 5 frames apart (the second inside the 0.3 s ICD)
    skill: (c) => {
      hitAt(c, 5, 'skill', ['skill', 'dmg'], 'E')
      hitAt(c, 10, 'skill', ['skill', 'dmg'], 'E2')
    },
    // a Skill hit that lands after the wielder has left the field
    burst: (c) => hitAt(c, 200, 'skill', ['skill', 'late'], 'late'),
  })
  const sim = run('Clorinde E E Q -> Bennett E W5', 'KeyOfKhajNisut', kit)
  it('stacks once per 0.3 s for 20 s, all refreshed; not from an off-field hit', () => {
    const [a, b] = times(sim, 'E').map((t) => t + 1)
    expect(times(sim, 'late')).toHaveLength(1)
    expect(windows(sim, 'KeyOfKhajNisut.afterSkill')).toEqual([
      ['1', a, b],
      ['2', b, b + 1200],
    ])
  })
})

describe('Peak Patrol Song: Ode to Flowers from Normal and Plunging hits', () => {
  const kit = blade({
    // (a Skill hit never counts)
    skill: (c) => hitAt(c, 5, 'skill', ['skill', 'dmg'], 'E'),
  })
  const sim = run('Clorinde N3 E W8 P', 'PeakPatrolSong', kit)
  it('stacks to 2 for 6 s each hit; each hit at 2 gives the party buff for 15 s', () => {
    const [n1, n2, n3] = [1, 2, 3].map((i) => times(sim, `N${i}`)[0] + 1)
    const p = times(sim, 'P')[0] + 1
    expect(windows(sim, 'PeakPatrolSong.odeStacks')).toEqual([
      ['1', n1, n2],
      ['2', n2, n3 + 360],
      ['1', p, p + 360],
    ])
    expect(windows(sim, 'PeakPatrolSong.odeMaxed')).toEqual([
      ['on', n2, n3 + 900],
    ])
  })
})

describe('Flute of Ezpitzal: DEF for 15 s after a Skill', () => {
  const sim = run('Clorinde E W5 E W20 E', 'FluteOfEzpitzal')
  it('opens on each Skill use and refreshes while up', () => {
    const [a, b, c] = starts(sim, 'E')
    expect(windows(sim, 'FluteOfEzpitzal.afterSkill')).toEqual([
      ['on', a, b + 900],
      ['on', c, c + 900],
    ])
  })
})

describe('Silver Light: EM stacks for 12 s after each Skill, on their own clocks', () => {
  const sim = run('Clorinde E E W13 E', 'SilverLight')
  it('adds a stack per Skill use, up to 2', () => {
    const [a, b, c] = starts(sim, 'E')
    expect(windows(sim, 'SilverLight.passive')).toEqual([
      ['1', a, a + 720],
      ['1', b, b + 720],
      ['1', c, c + 720],
    ])
    expect(
      sim.buffWindows
        .filter((w) => w.path.join('.') === 'SilverLight.passive')
        .filter((w) => w.end > w.start)
        .every((w) => w.max === 2)
    ).toBe(true)
  })
})

describe('Toukabou Shigure: Cursed Parasol for 10 s, once per 15 s', () => {
  const sim = run('Clorinde N1 W5 E W10 E', 'ToukabouShigure')
  it('opens from the hit after the trigger and keeps to its cooldown', () => {
    const n = times(sim, 'N1')[0]
    const [, late] = times(sim, 'E')
    expect(late - n).toBeGreaterThanOrEqual(900)
    expect(windows(sim, 'ToukabouShigure.passive')).toEqual([
      ['on', n + 1, n + 601],
      ['on', late + 1, late + 601],
    ])
  })
})
