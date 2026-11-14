/**
 * Epochal Advent's 4-piece in the rotation: a Starspark (2 at most) when the wearer uses a Skill
 * or Burst or performs a Normal Attack, one lost every 3 s on the field, Undying Radiance while
 * one is held.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const play = (members: CharacterKey[], text: string, repeats?: number) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    gear: { Sandrone: { sets: { LegacyOfTheFirstChronicle: 4 } } },
    ...(repeats ? { repeats, keep: 'all' as const } : {}),
  })
  return { sim, attacks: rotationAttacks(sim) }
}
/** Sandrone's hits with Undying Radiance, of all hers (by hits) */
const radianceShare = (attacks: ReturnType<typeof play>['attacks']) => {
  let on = 0
  let all = 0
  for (const a of attacks.Sandrone ?? []) {
    all += a.hits
    const st = a.states?.find(
      (s) => s.path.join('.') === 'LegacyOfTheFirstChronicle.undyingRadiance'
    )
    if (st?.value === 'on') on += a.hits
  }
  return on / all
}
/** When each of Sandrone's hits lands, and whether it has Undying Radiance */
const timeline = (sim: ReturnType<typeof play>['sim']) => {
  const windows = sim.buffWindows.filter(
    (b) =>
      b.owner === 'Sandrone' &&
      b.path.join('.') === 'LegacyOfTheFirstChronicle.undyingRadiance' &&
      b.end > b.start
  )
  return sim.hits
    .filter((h) => h.characterKey === 'Sandrone' && !h.path[0].startsWith('_'))
    .map((h) => ({
      t: h.t,
      on: windows.some((w) => w.start <= h.t && h.t < w.end),
    }))
}

describe('Epochal Advent Starsparks', () => {
  it('holds Undying Radiance for 3 s on the field after one Skill', () => {
    const { sim } = play(['Sandrone'], 'Sandrone E W6', 1)
    const hits = timeline(sim)
    // the Skill's Prism Shots land within 3 s: with Radiance
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.every((h) => h.on === h.t < 180)).toBe(true)
  })
  it('keeps it 3 s longer with a second Starspark, and loses none off the field', () => {
    // Skill then Burst: 2 Starsparks, Radiance for about 6 s of field time
    const two = play(['Sandrone', 'Odette'], 'Sandrone E Q W8', 1).sim
    const windows = two.buffWindows.filter(
      (b) =>
        b.path.join('.') === 'LegacyOfTheFirstChronicle.undyingRadiance' &&
        b.end > b.start
    )
    expect(windows).toHaveLength(1)
    expect(windows[0].end - windows[0].start).toBeGreaterThan(330)
    expect(windows[0].end - windows[0].start).toBeLessThan(400)
    // off the field (Odette's turn) the clock waits: Radiance lasts past 6 s of rotation time
    const away = play(
      ['Sandrone', 'Odette'],
      'Sandrone E Q -> Odette W8 -> Sandrone W8',
      1
    ).sim
    const span = away.buffWindows
      .filter(
        (b) =>
          b.path.join('.') === 'LegacyOfTheFirstChronicle.undyingRadiance' &&
          b.end > b.start
      )
      .reduce((n, b) => n + b.end - b.start, 0)
    expect(span).toBeGreaterThan(600)
  })
  it('measures Sandrone’s uptime in a Stellar team', () => {
    const members: CharacterKey[] = ['Mitya', 'Alyosha', 'Odette', 'Sandrone']
    const { attacks } = play(
      members,
      'Mitya tE -> Alyosha E Q -> Odette E E -> Sandrone E CA Q E CA E CA -> Mitya'
    )
    const share = radianceShare(attacks)
    console.log(
      `Sandrone hits with Undying Radiance: ${(share * 100).toFixed(1)}%`
    )
    expect(share).toBeGreaterThan(0)
    expect(share).toBeLessThan(1)
  })
})
