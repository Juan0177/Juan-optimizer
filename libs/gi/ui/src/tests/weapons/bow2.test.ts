/**
 * Weapon audit batch bow2: the rotation simulation times Hunter's Path, Alley Hunter,
 * Cloudforged, Fading Twilight, Ibis Piercer, Range Gauge and Scion of the Blazing Sun from the
 * wielder's own triggers (rotation/weapons/bow2.ts), with small test kits; Scion's Sunfire Arrow
 * is a proc on its new display node; and the sheet fixes (Cloudforged's and Scion's durations,
 * Range Gauge's self-only buff).
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation } from '../../'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  type SimulationResult,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type { HitTag, KitModel } from '../../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['Fischl', 'Bennett']

/**
 * A bow user: each action is 60 frames, its hit 10 frames in (a Charged Attack's `caHits` hits,
 * 2 frames apart); its Skill also hits 500 frames in (off the field by then), and with `heals`
 * its Burst heals the party 5 frames in
 */
function bow({
  caHits = 1,
  heals = false,
}: {
  caHits?: number
  heals?: boolean
} = {}): KitModel {
  return {
    characterKey: 'Fischl',
    element: 'electro',
    source: 'test',
    act(c, _s, action) {
      const hit = (delay: number, tag: HitTag) =>
        c.hit(delay, {
          path: [tag, 'dmg'],
          tag,
          element: 'electro',
          label: action.text,
        })
      if (action.kind === 'charged')
        for (let i = 0; i < caHits; i++) hit(10 + 2 * i, 'charged')
      else if (action.kind === 'skill') {
        hit(10, 'skill')
        hit(500, 'skill')
      } else if (action.kind === 'burst') {
        hit(10, 'burst')
        if (heals)
          c.hit(5, {
            path: ['_heal', 'burst', 'heal'],
            tag: 'other',
            element: 'physical',
            healTargets: members,
            label: 'heal',
          })
      } else if (action.kind === 'normal') hit(10, 'normal')
      return { frames: 60 }
    },
  }
}

/** A teammate whose Burst heals the bow user 5 frames in */
const healer: KitModel = {
  characterKey: 'Bennett',
  element: 'pyro',
  source: 'test',
  act(c, _s, action) {
    if (action.kind === 'burst')
      c.hit(5, {
        path: ['_heal', 'burst', 'heal'],
        tag: 'other',
        element: 'physical',
        healTargets: ['Fischl'],
        label: 'heal',
      })
    return { frames: 60 }
  },
}

function play(
  text: string,
  weapon: string,
  kit: KitModel = bow(),
  refinement = 1
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Fischl: 'electro', Bennett: 'pyro' },
    kits: { Fischl: kit, Bennett: healer },
    gear: { Fischl: { weapon, refinement } },
    repeats: 1,
    keep: 'all',
  })
}

/**
 * The bow user's windows of a conditional while it is on, in order (without the declaration at
 * 0, or the off state the timed buffs set when they end: value '')
 */
const windowsOf = (sim: SimulationResult, path: string) =>
  sim.buffWindows
    .filter(
      (w) =>
        w.owner === 'Fischl' &&
        w.path.join('.') === path &&
        w.value !== '' &&
        w.end > w.start
    )
    .map(({ value, start, end }) => ({ value, start, end }))
    .sort((a, b) => a.start - b.start)
/** The state of a conditional at frame `t` ('' when off) */
const valueAt = (sim: SimulationResult, path: string, t: number) =>
  windowsOf(sim, path).find((w) => w.start <= t && t < w.end)?.value ?? ''
const hitTimes = (sim: SimulationResult, tag: HitTag) =>
  sim.hits
    .filter((h) => h.characterKey === 'Fischl' && h.tag === tag)
    .map((h) => h.t)
const starts = (sim: SimulationResult, text: string, who = 'Fischl') =>
  sim.actions
    .filter((a) => a.characterKey === who && a.text === text)
    .map((a) => a.start)

describe("Hunter's Path: Tireless Hunt", () => {
  it('covers the 12 Charged Attack hits after its trigger, then waits out 12 s', () => {
    // (5 hits per Charged Attack: the 1st triggers, the next 12 are covered)
    const sim = play(
      'Fischl CA CA CA W10 CA',
      'HuntersPath',
      bow({ caHits: 5 })
    )
    const ca = hitTimes(sim, 'charged')
    const w = windowsOf(sim, 'HuntersPath.passive')
    expect(w).toHaveLength(2)
    expect(w[0]).toEqual({ value: 'on', start: ca[0] + 1, end: ca[12] + 1 })
    // (the third Charged Attack's last two hits are not covered, and start no new hunt)
    expect(valueAt(sim, 'HuntersPath.passive', ca[13])).toBe('')
    expect(valueAt(sim, 'HuntersPath.passive', ca[14])).toBe('')
    // after 12 s, the next Charged Attack hit starts another
    expect(ca[15] - ca[0]).toBeGreaterThanOrEqual(720)
    expect(w[1].start).toBe(ca[15] + 1)
    expect(w[1].end).toBeGreaterThan(ca[19])
  })
  it('ends after 10 s', () => {
    const sim = play('Fischl CA W12 CA', 'HuntersPath')
    const ca = hitTimes(sim, 'charged')
    const w = windowsOf(sim, 'HuntersPath.passive')
    expect(w[0]).toEqual({ value: 'on', start: ca[0] + 1, end: ca[0] + 601 })
    expect(w[1].start).toBe(ca[1] + 1)
  })
})

describe('Alley Hunter', () => {
  it('gains a stack a second off the field, keeps them 4 s on it, then loses 2 a second', () => {
    const sim = play('Bennett W5 -> Fischl N1 W7 -> Bennett W2', 'AlleyHunter')
    const path = 'AlleyHunter.OppidanAmbush'
    const on = starts(sim, 'N1')[0]
    const off = (sim.waits ?? []).find(
      (w) => w.characterKey === 'Bennett' && w.start > on
    )!.start
    // off the field from the start: a stack at frames 1, 61, 121…
    expect(valueAt(sim, path, 0)).toBe('')
    expect(valueAt(sim, path, 30)).toBe('1')
    expect(valueAt(sim, path, 250)).toBe('5')
    const held = Math.floor((on - 2) / 60) + 1
    expect(valueAt(sim, path, on - 1)).toBe(`${held}`)
    expect(valueAt(sim, path, on + 239)).toBe(`${held}`)
    expect(valueAt(sim, path, on + 241)).toBe(`${held - 2}`)
    expect(valueAt(sim, path, on + 60 * Math.ceil(held / 2) + 181)).toBe('')
    // off the field again: from 1 s after the swap
    expect(off - on).toBeGreaterThan(240 + 60 * Math.ceil(held / 2))
    expect(valueAt(sim, path, off + 30)).toBe('')
    expect(valueAt(sim, path, off + 61)).toBe('1')
  })
})

describe('Cloudforged', () => {
  it('stacks from the wielder’s Bursts, up to 2, each refreshing both for 18 s', () => {
    const sim = play('Fischl Q W5 Q W20 Q', 'Cloudforged')
    const [q1, q2, q3] = starts(sim, 'Q')
    const w = windowsOf(sim, 'Cloudforged.energyStacks')
    expect(w.slice(0, 2)).toEqual([
      { value: '1', start: q1, end: q2 },
      { value: '2', start: q2, end: q2 + 1080 },
    ])
    // (expired: the next Burst starts again from 1)
    expect(q3).toBeGreaterThan(q2 + 1080)
    expect(w[2]).toMatchObject({ value: '1', start: q3 })
  })
  it('shows its 18 s duration', () => {
    const doc = getWeaponSheet('Cloudforged').document[0] as unknown as {
      states: Record<string, { fields: { unit?: string; value?: number }[] }>
    }
    expect(doc.states['1'].fields.find((f) => f.unit === 's')?.value).toBe(18)
  })
})

describe('Fading Twilight', () => {
  it('moves to the next state on a hit once per 7 s, off the field too', () => {
    // (the Skill's hits at 10 frames, on the field, and at 500, off it)
    const sim = play('Fischl E -> Bennett W10', 'FadingTwilight')
    const [h1, h2] = hitTimes(sim, 'skill')
    expect(h2 - h1).toBeGreaterThanOrEqual(420)
    const path = 'FadingTwilight.state'
    expect(valueAt(sim, path, h1)).toBe('evengleam')
    expect(valueAt(sim, path, h1 + 1)).toBe('afterglow')
    expect(valueAt(sim, path, h2)).toBe('afterglow')
    expect(valueAt(sim, path, h2 + 1)).toBe('dawnblaze')
  })
  it('does not move again within 7 s', () => {
    const sim = play('Fischl N1 N1 N1 N1', 'FadingTwilight')
    const n = hitTimes(sim, 'normal')
    expect(valueAt(sim, 'FadingTwilight.state', n[3])).toBe('afterglow')
  })
})

describe('Ibis Piercer', () => {
  it('stacks after Charged Attack hits, up to 2 for 6 s, from the next hit', () => {
    const sim = play('Fischl CA CA CA W7 CA', 'IbisPiercer')
    const ca = hitTimes(sim, 'charged')
    const path = 'IbisPiercer.passiveStacks'
    expect(valueAt(sim, path, ca[0])).toBe('')
    expect(valueAt(sim, path, ca[1])).toBe('1')
    expect(valueAt(sim, path, ca[2])).toBe('2')
    expect(valueAt(sim, path, ca[2] + 360)).toBe('2')
    expect(valueAt(sim, path, ca[2] + 362)).toBe('')
    // (expired before the fourth: it starts again)
    expect(valueAt(sim, path, ca[3] + 1)).toBe('1')
  })
  it('gains one stack per 0.5 s', () => {
    const sim = play('Fischl CA', 'IbisPiercer', bow({ caHits: 5 }))
    const ca = hitTimes(sim, 'charged')
    expect(valueAt(sim, 'IbisPiercer.passiveStacks', ca[4])).toBe('1')
  })
})

describe('Range Gauge', () => {
  const path = 'RangeGauge.marksConsumed'
  it('consumes the Symbols from heals on its Skill, once per 15 s', () => {
    const sim = play(
      'Bennett Q Q Q Q -> Fischl E -> Bennett Q -> Fischl E W15 E',
      'RangeGauge'
    )
    const [e1, e2, e3] = starts(sim, 'E')
    expect(e2 - e1).toBeLessThan(900)
    expect(e3 - e1).toBeGreaterThanOrEqual(900)
    // 4 heals: 3 Symbols; the second Skill is within 15 s; the third uses the 1 Symbol since
    expect(windowsOf(sim, path)).toEqual([
      { value: '3', start: e1, end: e1 + 600 },
      { value: '1', start: e3, end: e3 + 600 },
    ])
  })
  it('gains a Symbol per character the wielder heals, and none without heals', () => {
    const healing = play('Fischl Q E', 'RangeGauge', bow({ heals: true }))
    expect(windowsOf(healing, path)[0]).toMatchObject({
      value: '2',
      start: starts(healing, 'E')[0],
    })
    expect(windowsOf(play('Fischl E', 'RangeGauge'), path)).toEqual([])
  })
  it('buffs only the wielder', () => {
    expect(
      getWeaponSheet('RangeGauge').document.some(
        (d) => (d as { teamBuff?: boolean }).teamBuff
      )
    ).toBe(false)
  })
})

function team(weapon: string) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set('Fischl', {
    key: 'Fischl',
    level: 90,
    ascension: 6,
    constellation: 0,
    talent: { auto: 9, skill: 9, burst: 9 },
  })
  const teamCharId = db.teamChars.new('Fischl', {})
  const buildTcId = db.buildTcs.new({
    characterKey: 'Fischl',
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

describe('Scion of the Blazing Sun', () => {
  const sim = play('Fischl CA CA W10 CA W12', 'ScionOfTheBlazingSun')
  const ca = hitTimes(sim, 'charged')
  it('drops a Sunfire Arrow 15 frames after a Charged Attack hit, once per 10 s', () => {
    const arrows = sim.hits
      .filter((h) => h.path[0] === 'weapon:ScionOfTheBlazingSun')
      .map((h) => h.t)
    expect(arrows).toEqual([ca[0] + 15, ca[2] + 15])
  })
  it('gives Heartsearer for 10 s from the arrow', () => {
    expect(windowsOf(sim, 'ScionOfTheBlazingSun.afterHit')).toEqual([
      { value: 'on', start: ca[0] + 15, end: ca[0] + 615 },
      { value: 'on', start: ca[2] + 15, end: ca[2] + 615 },
    ])
  })
  it('counts the arrow’s damage, for the build holding it only', () => {
    const attack = rotationAttacks(sim, () => undefined).Fischl!.find(
      (a) => a.path[0] === 'weapon:ScionOfTheBlazingSun'
    )!
    expect(attack.path).toEqual(['weapon:ScionOfTheBlazingSun', 'dmg'])
    const scion = team('ScionOfTheBlazingSun')
    expect(
      evaluateTeamRotation(scion.db, scion.teamId, 'F', {
        arts: {},
        attacks: { Fischl: [attack] },
      })!.total
    ).toBeGreaterThan(0)
    const other = team('Slingshot')
    expect(
      evaluateTeamRotation(other.db, other.teamId, 'F', {
        arts: {},
        attacks: { Fischl: [attack] },
      })?.total ?? 0
    ).toBe(0)
  })
  it('shows Heartsearer’s 10 s duration', () => {
    const doc = getWeaponSheet('ScionOfTheBlazingSun')
      .document[1] as unknown as {
      states: { on: { fields: { unit?: string; value?: number }[] } }
    }
    expect(
      doc.states.on.fields.filter((f) => f.unit === 's').map((f) => f.value)
    ).toEqual([10, 10])
  })
})
