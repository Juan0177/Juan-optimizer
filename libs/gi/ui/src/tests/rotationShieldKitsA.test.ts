/**
 * Shield markers of the real kits (kqmsim's Shields.Add sites): Baizhu, Beidou, Candace, Citlali,
 * Columbina, Dahlia, Danica and Diona
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

function run(
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {}
) {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations,
    repeats: 1,
    keep: 'all',
  })
  /** The nth action of a member: its start frame */
  const start = (who: CharacterKey, nth = 0) =>
    sim.actions.filter((a) => a.characterKey === who)[nth].start
  const markers = sim.hits.filter(
    (h) => h.path[0] === '_marker' && h.path[1] === 'shield'
  )
  // (the first member is the creator)
  for (const h of markers) expect(h.characterKey).toBe(members[0])
  /** [frame, duration, target, kind] of each shield marker */
  const shields = markers
    .map((h) => [h.t, +h.path[2], h.path[3], h.path[4]])
    .sort((a, b) => +a[0] - +b[0])
  return { sim, start, shields }
}

describe('kit shield markers', () => {
  it('Baizhu: a Seamless Shield at 81 frames, refreshed 5 times 146 apart (152 frames each); C6 on Gossamer Sprite hits', () => {
    const { start, shields } = run('Baizhu Q W14', ['Baizhu'])
    const q = start('Baizhu')
    expect(shields).toEqual(
      [81, 223, 369, 515, 661, 807].map((d) => [q + d, 152, '', ''])
    )
    // (C6: the skill's first hit, then the C2 Splice it starts, 13 frames later, each make one)
    const c6 = run('Baizhu E W1', ['Baizhu'], { Baizhu: 6 })
    const e = c6.start('Baizhu')
    expect(c6.shields).toEqual([
      [e + 13, 152, '', ''],
      [e + 26, 152, '', ''],
    ])
  })

  it("Beidou: Tidecaller's shield on her until the hitmark; C1 a 15 s party shield at the burst", () => {
    const { start, shields } = run('Beidou E Q W1', ['Beidou'], { Beidou: 1 })
    expect(shields).toEqual([
      [start('Beidou'), 23, 'Beidou', 'BeidouThunderShield'],
      [start('Beidou', 1), 900, '', 'BeidouC1'],
    ])
    // (the hold lasts until its later hitmark; no C1 shield at C0)
    const hold = run('Beidou hE Q W1', ['Beidou'])
    expect(hold.shields).toEqual([
      [hold.start('Beidou'), 96 + 23, 'Beidou', 'BeidouThunderShield'],
    ])
  })

  it("Candace: Heron's Sanctum's shield on her until the skill hits (tap 16, hold 91)", () => {
    const tap = run('Candace E W1', ['Candace'])
    expect(tap.shields).toEqual([[tap.start('Candace'), 16, 'Candace', '']])
    const hold = run('Candace hE W1', ['Candace'])
    expect(hold.shields).toEqual([[hold.start('Candace'), 91, 'Candace', '']])
  })

  it('Citlali: the Opal Shield, a 20 s party shield 37 frames into the skill', () => {
    const { start, shields } = run('Citlali E W2', ['Citlali'])
    expect(shields).toEqual([[start('Citlali') + 37, 1200, '', '']])
  })

  it('Columbina: C1 a Lunar-Crystallize Gravity Interference gives her the 8 s Rainsea Shield', () => {
    const members: CharacterKey[] = ['Columbina', 'Zibai', 'Ningguang']
    // (C1's cast-time Gravity Interference, 21 frames in: Lunar-Crystallize in a Geo team)
    const { start, shields } = run('Columbina E W2', members, { Columbina: 1 })
    expect(shields).toEqual([[start('Columbina') + 21, 480, '', '']])
    expect(run('Columbina E W2', members).shields).toEqual([])
    expect(
      run('Columbina E W2', ['Columbina', 'Zhongli', 'Ningguang'], {
        Columbina: 1,
      }).shields
    ).toEqual([])
    // (a Lunar-Charged one gives none)
    expect(
      run('Columbina E W2', ['Columbina', 'Ineffa', 'Beidou'], {
        Columbina: 1,
      }).shields
    ).toEqual([])
  })

  it('Dahlia: a party shield 31 frames into the burst until Favonian Favor ends (+1 frame; +3 s at C4)', () => {
    const { start, shields } = run('Dahlia Q W2', ['Dahlia'])
    expect(shields).toEqual([[start('Dahlia') + 31, 721, '', '']])
    const c4 = run('Dahlia Q W2', ['Dahlia'], { Dahlia: 4 })
    expect(c4.shields).toEqual([[c4.start('Dahlia') + 31, 901, '', '']])
  })

  it("Danica: the Entry Skill's Defense Maid gives a 25 s party shield", () => {
    const { sim, shields } = run('Danica E N4 -> Kaeya E -> Danica N1 W1', [
      'Danica',
      'Kaeya',
    ])
    const entry = sim.swaps!.filter((s) => s.to === 'Danica')[0]
    expect(shields).toEqual([[entry.start + entry.frames, 1500, '', '']])
  })

  it("Diona: each paw that hits adds a paw's duration (2.4 s at level 10) to the Icy Paws shield", () => {
    const tap = run('Diona E W1', ['Diona'])
    const e = tap.start('Diona')
    // (the second paw: the first's 144 frames plus its own, from a frame later)
    expect(tap.shields).toEqual([
      [e + 10, 144, '', ''],
      [e + 11, 287, '', ''],
    ])
    const hold = run('Diona hE W1', ['Diona'])
    const h = hold.start('Diona')
    expect(hold.shields).toEqual(
      [0, 1, 2, 3, 4].map((i) => [h + 34 + i, (i + 1) * 144 - i, '', ''])
    )
  })
})
