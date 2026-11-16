/**
 * Weapon audit batch catalyst4: the rotation simulation times Crane's Echoing Call, Kagura's
 * Verity, Nocturne's Curtain Call, Tome of the Eternal Flow, Ballad of the Boundless Blue, Dawning
 * Frost, Fruit of Fulfillment and Waveriding Whirl from the wielder's own triggers, and plays Eye
 * of Perception's bolt (rotation/weapons/catalyst4.ts), with a small test kit.
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
  type SimulationResult,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type {
  HitTag,
  KitModel,
  SimContext,
} from '../../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['Lisa', 'Bennett']
const hitAt = (
  c: SimContext,
  delay: number,
  tag: HitTag,
  path: string[],
  label: string,
  characterKey?: CharacterKey
) =>
  c.hit(delay, {
    path,
    tag,
    element: 'electro',
    label,
    ...(characterKey && { characterKey }),
  })

type Own = Partial<Record<RotationActionKind, (c: SimContext) => void>>
/**
 * A member: E, Q, CA and P hit 5 frames in (30-frame actions), a Normal string's hits 10 frames
 * in and every 20 frames; `own` replaces an action's hits
 */
function kit(characterKey: CharacterKey, own: Own = {}): KitModel {
  return {
    characterKey,
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
      const tags: Partial<Record<RotationActionKind, HitTag>> = {
        skill: 'skill',
        burst: 'burst',
        charged: 'charged',
        plunge: 'plunge',
      }
      const tag = tags[action.kind]
      if (tag) hitAt(c, 5, tag, [tag, 'dmg'], action.text)
      return { frames: 30 }
    },
  }
}

function run(text: string, weapon: string, lisa: Own = {}, bennett: Own = {}) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Lisa: 'electro', Bennett: 'pyro' },
    constellations: {},
    kits: { Lisa: kit('Lisa', lisa), Bennett: kit('Bennett', bennett) },
    gear: { Lisa: { weapon, refinement: 1 } },
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
        w.owner === 'Lisa' &&
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
  sim.buffWindows.some((w) => w.owner === 'Lisa' && w.path.join('.') === path)
/** When the wielder's hits with this label land */
const times = (sim: SimulationResult, label: string) =>
  sim.hits
    .filter((h) => h.characterKey === 'Lisa' && h.label === label)
    .map((h) => h.t)
/** When the wielder's actions start */
const starts = (sim: SimulationResult, text: string) =>
  sim.actions
    .filter((a) => a.characterKey === 'Lisa' && a.text === text)
    .map((a) => a.start)

describe("Crane's Echoing Call: the party's Plunging DMG after the wielder's plunge", () => {
  const sim = run(
    'Lisa P W5 P -> Bennett P W25',
    'CranesEchoingCall',
    {},
    { plunge: (c) => hitAt(c, 5, 'plunge', ['plunge', 'dmg'], 'teammate P') }
  )
  it('opens 20 s from the hit after each plunge, not from a teammate’s', () => {
    const [p1, p2] = times(sim, 'P').map((t) => t + 1)
    expect(windows(sim, 'CranesEchoingCall.passive')).toEqual([
      ['on', p1, p2 + 1200],
    ])
    expect(declared(sim, 'CranesEchoingCall.passive')).toBe(true)
  })
})

describe("Kagura's Verity: Kagura Dance stacks from Skill uses", () => {
  const sim = run('Lisa E E E E W25 E', 'KagurasVerity')
  it('stacks to 3 for 24 s, all refreshed, and starts over once expired', () => {
    const [a, b, c, d, e] = starts(sim, 'E')
    expect(windows(sim, 'KagurasVerity.KaguraDance')).toEqual([
      ['1', a, b],
      ['2', b, c],
      ['3', c, d + 1440],
      ['1', e, e + 1440],
    ])
  })
})

describe("Nocturne's Curtain Call: Sacred Wine from the wielder's Lunar reactions and DMG", () => {
  const sim = run(
    'Lisa E W5 Q W15 CA N1 -> Bennett E',
    'NocturnesCurtainCall',
    {
      skill: (c) =>
        hitAt(c, 5, 'other', ['_reaction', 'lunarCharged'], 'LC trigger'),
      burst: (c) =>
        hitAt(c, 5, 'other', ['reaction', 'lunarcharged'], 'LC damage'),
      charged: (c) =>
        hitAt(c, 5, 'burst', ['burst', 'middleLunarDmg'], 'direct Lunar'),
    },
    {
      skill: (c) =>
        hitAt(c, 5, 'other', ['_reaction', 'lunarCharged'], 'teammate LC'),
    }
  )
  it('opens 12 s from each, refreshed while up; Normal hits and teammates do not', () => {
    const [m] = times(sim, 'LC trigger')
    const [r] = times(sim, 'LC damage')
    const [d] = times(sim, 'direct Lunar')
    expect(r + 1).toBeLessThanOrEqual(m + 721)
    expect(d + 1).toBeGreaterThan(r + 721)
    expect(windows(sim, 'NocturnesCurtainCall.passive')).toEqual([
      ['on', m + 1, r + 721],
      ['on', d + 1, d + 721],
    ])
  })
})

describe('Tome of the Eternal Flow: Charged DMG stacks from HP changes on the field', () => {
  const marker =
    (delay: number, characterKey?: CharacterKey) => (c: SimContext) =>
      hitAt(
        c,
        delay,
        'other',
        ['_marker', 'hpChange'],
        'hp change',
        characterKey
      )
  const sim = run(
    'Lisa E E -> Bennett E W5',
    'TomeOfTheEternalFlow',
    {
      skill: (c) => {
        marker(5)(c)
        marker(10)(c) // inside the 0.3 s ICD
      },
    },
    // (the wielder's HP changes while it is off the field)
    { skill: marker(5, 'Lisa') }
  )
  it('stacks once per 0.3 s for 4 s, all refreshed; not off the field', () => {
    const t = times(sim, 'hp change')
    expect(t).toHaveLength(5)
    const [a, , b] = t.map((x) => x + 1)
    expect(windows(sim, 'TomeOfTheEternalFlow.hpChanges')).toEqual([
      ['1', a, b],
      ['2', b, b + 240],
    ])
  })
  it('is not declared (without HP changes the player’s choice stays)', () => {
    const quiet = run('Lisa E E', 'TomeOfTheEternalFlow')
    expect(declared(quiet, 'TomeOfTheEternalFlow.hpChanges')).toBe(false)
  })
})

describe('Ballad of the Boundless Blue: stacks from Normal and Charged hits', () => {
  const sim = run('Lisa N3 E W7 CA', 'BalladOfTheBoundlessBlue', {
    charged: (c) => {
      hitAt(c, 5, 'charged', ['charged', 'dmg'], 'CA')
      hitAt(c, 10, 'charged', ['charged', 'dmg'], 'CA2') // inside the ICD
    },
  })
  it('stacks once per 0.3 s for 6 s, up to 3, all refreshed; not from a Skill', () => {
    const [n1, n2, n3] = [1, 2, 3].map((i) => times(sim, `N${i}`)[0] + 1)
    const ca = times(sim, 'CA')[0] + 1
    expect(windows(sim, 'BalladOfTheBoundlessBlue.hits')).toEqual([
      ['1', n1, n2],
      ['2', n2, n3],
      ['3', n3, n3 + 360],
      ['1', ca, ca + 360],
    ])
  })
})

describe('Dawning Frost: EM after Charged hits and after Skill hits, on the field', () => {
  const sim = run('Lisa CA E Q -> Bennett E W12', 'DawningFrost', {
    // a Skill hit that lands after the wielder has left the field
    burst: (c) => hitAt(c, 200, 'skill', ['skill', 'late'], 'late'),
  })
  it('opens each for 10 s from the hit after', () => {
    const ca = times(sim, 'CA')[0] + 1
    const e = times(sim, 'E')[0] + 1
    expect(times(sim, 'late')).toHaveLength(1)
    expect(windows(sim, 'DawningFrost.chargedHit')).toEqual([
      ['on', ca, ca + 600],
    ])
    expect(windows(sim, 'DawningFrost.skillHit')).toEqual([['on', e, e + 600]])
  })
})

describe('Fruit of Fulfillment: Wax and Wane from the wielder’s reactions', () => {
  const sim = run('Lisa E E Q W8 E', 'FruitOfFulfillment', {
    skill: (c) => {
      hitAt(c, 5, 'other', ['_reaction', 'overloaded'], 'reaction')
      hitAt(c, 10, 'other', ['_reaction', 'overloaded'], 'reaction 2') // ICD
    },
    burst: (c) => hitAt(c, 5, 'other', ['_reaction', 'moondrift'], 'moondrift'),
  })
  it('gains a stack per reaction (0.3 s ICD) and loses one every 6 s without', () => {
    const [a, b, c] = times(sim, 'reaction').map((t) => t + 1)
    expect(c).toBeGreaterThan(b + 360)
    expect(windows(sim, 'FruitOfFulfillment.stacks')).toEqual([
      ['1', a, b],
      ['2', b, b + 360],
      ['1', b + 360, c],
      ['2', c, c + 360],
      ['1', c + 360, c + 720],
    ])
  })
})

describe('Waveriding Whirl: Max HP for 10 s after a Skill, once per 15 s', () => {
  const sim = run('Lisa E W5 E W10 E', 'WaveridingWhirl')
  it('keeps to its cooldown', () => {
    const [a, , c] = starts(sim, 'E')
    expect(c - a).toBeGreaterThanOrEqual(900)
    expect(windows(sim, 'WaveridingWhirl.passive')).toEqual([
      ['on', a, a + 600],
      ['on', c, c + 600],
    ])
  })
})

function lisa(weapon: string) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set('Lisa', {
    key: 'Lisa',
    level: 90,
    ascension: 6,
    constellation: 0,
    talent: { auto: 9, skill: 9, burst: 9 },
  })
  const teamCharId = db.teamChars.new('Lisa', {})
  const buildTcId = db.buildTcs.new({
    characterKey: 'Lisa',
    character: {
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 9, skill: 9, burst: 9 },
    },
    weapon: { key: weapon, level: 90, ascension: 6, refinement: 1 },
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

describe('Eye of Perception: its Bolt of Perception', () => {
  const sim = run('Lisa N5 W12 N5', 'EyeOfPerception')
  const procs = sim.hits.filter((h) => h.path[0] === 'weapon:EyeOfPerception')
  it('fires 10 frames after every second eligible hit (50%), once per 12 s at R1', () => {
    const normals = sim.hits
      .filter((h) => h.characterKey === 'Lisa' && h.tag === 'normal')
      .map((h) => h.t)
    const late = normals.find((t) => t >= normals[1] + 720)!
    const next = normals[normals.indexOf(late) + 1]
    expect(procs.map((h) => [h.path[1], h.t])).toEqual([
      ['dmg_', normals[1] + 10],
      ['dmg_', next + 10],
    ])
  })
  it('is an attack Team optimize counts, for the build holding it only', () => {
    const attack = rotationAttacks(sim, () => undefined).Lisa!.find(
      (a) => a.path[0] === 'weapon:EyeOfPerception'
    )!
    expect(attack.path).toEqual(['weapon:EyeOfPerception', 'dmg_'])
    expect(attack.hits).toBe(procs.length)
    const eye = lisa('EyeOfPerception')
    const withEye = evaluateTeamRotation(eye.db, eye.teamId, 'F', {
      arts: {},
      attacks: { Lisa: [attack] },
    })!.total
    expect(withEye).toBeGreaterThan(0)
    const other = lisa('ApprenticesNotes')
    const without = evaluateTeamRotation(other.db, other.teamId, 'F', {
      arts: {},
      attacks: { Lisa: [attack] },
    })?.total
    expect(without ?? 0).toBe(0)
  })
})
