/**
 * The shield markers of the real kits (Ineffa, Kaeya, Kirara, Lan Yan, Layla, Nicole, Noelle,
 * Sigewinne), at kqmsim's Shields.Add frames and durations
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { SimGear } from '../util/teamOpt/rotation/types'

const run = (
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {},
  gear: Partial<Record<CharacterKey, SimGear>> = {}
) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, kitModels[m]!.element])
    ) as never,
    constellations,
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {}, absorbAt: () => undefined },
    gear,
  })
  /** The nth action of `who` whose text is `text` */
  const start = (who: CharacterKey, text: string, nth = 0) =>
    sim.actions.filter((a) => a.characterKey === who && a.text === text)[nth]
      .start
  /** Each shield marker: [frame, duration, target, kind] */
  const shields = sim.hits
    .filter((h) => h.path[0] === '_marker' && h.path[1] === 'shield')
    .map((h) => [h.t, +h.path[2], h.path[3], h.path[4]])
  return { sim, start, shields }
}

describe('shield markers (kqmsim Shields.Add)', () => {
  it('Nicole: a 20 s party shield 8 frames into each skill', () => {
    const { start, shields } = run('Nicole E N3 N3 N3 N3 N3 N3 E W1', [
      'Nicole',
    ])
    const e1 = start('Nicole', 'E')
    const e2 = start('Nicole', 'E', 1)
    expect(shields).toEqual([
      [e1 + 8, 1200, '', ''],
      [e2 + 8, 1200, '', ''],
    ])
    // the burst makes none
    expect(run('Nicole Q W1', ['Nicole']).shields).toEqual([])
    // Angelos Heptades: Pathfinder's Light from the shield, 20 s
    const angelos = run(
      'Nicole E W1',
      ['Nicole'],
      {},
      {
        Nicole: { weapon: 'AngelosHeptades', refinement: 1 },
      }
    )
    const at = angelos.start('Nicole', 'E') + 8
    expect(
      angelos.sim.buffWindows
        .filter(
          (w) =>
            w.path.join('.') === 'AngelosHeptades.shield' &&
            !!w.value &&
            w.end > w.start
        )
        .map((w) => [w.start, w.end])
    ).toEqual([[at, at + 1200]])
  })

  it('Ineffa: the skill at 4 frames; C2 also the burst at 37 (20 s, party)', () => {
    const text = 'Ineffa E Q W1'
    const c0 = run(text, ['Ineffa'])
    expect(c0.shields).toEqual([[c0.start('Ineffa', 'E') + 4, 1200, '', '']])
    const c2 = run(text, ['Ineffa'], { Ineffa: 2 })
    expect(c2.shields).toEqual([
      [c2.start('Ineffa', 'E') + 4, 1200, '', ''],
      [c2.start('Ineffa', 'Q') + 37, 1200, '', ''],
    ])
  })

  it('Kaeya: none (C4 needs his HP below 20%)', () => {
    expect(run('Kaeya E Q W1', ['Kaeya'], { Kaeya: 6 }).shields).toEqual([])
  })

  it('Kirara: 12 s party shields, 15 frames in; the hold adds A1 at its end', () => {
    const tap = run('Kirara E W1', ['Kirara'])
    expect(tap.shields).toEqual([[tap.start('Kirara', 'E') + 15, 720, '', '']])
    const hold = run('Kirara hE W1', ['Kirara'])
    const at = hold.start('Kirara', 'hE')
    expect(hold.shields).toEqual([
      [at + 15, 720, '', ''],
      [at + 600 + 15, 720, '', ''],
    ])
  })

  it("Lan Yan: 12.5 s, 18 frames in; C2 restores it on the active member's normal hits", () => {
    const c0 = run('LanYan E W1', ['LanYan'])
    expect(c0.shields).toEqual([[c0.start('LanYan', 'E') + 18, 750, '', '']])
    const { sim, start, shields } = run(
      'LanYan E -> Bennett N1 N1 N1 N1 N1 N1 N1 N1',
      ['LanYan', 'Bennett'],
      { LanYan: 2 }
    )
    const made = start('LanYan', 'E') + 18
    const until = made + 750
    // (Bennett's hits once per 2 s: the same expiry)
    const normals = sim.hits.filter(
      (h) => h.characterKey === 'Bennett' && h.tag === 'normal'
    )
    const restored: number[] = []
    for (const h of normals)
      if (
        h.t < until &&
        (restored.length === 0 || h.t > restored.at(-1)! + 120)
      )
        restored.push(h.t)
    expect(restored.length).toBeGreaterThan(1)
    expect(shields).toEqual([
      [made, 750, '', ''],
      ...restored.map((t) => [t, until - t, '', '']),
    ])
  })

  it('Layla: a 12 s party shield 19 frames into the skill', () => {
    const { start, shields } = run('Layla E W1', ['Layla'])
    expect(shields).toEqual([[start('Layla', 'E') + 19, 720, '', '']])
  })

  it('Noelle: a 12 s party shield at the skill cast (NoelleSkill)', () => {
    const { start, shields } = run('Noelle E W1', ['Noelle'])
    expect(shields).toEqual([[start('Noelle', 'E'), 720, '', 'NoelleSkill']])
  })

  it('Sigewinne C2: a shield on her for her skill and burst animations', () => {
    const text = 'Sigewinne E W1 Q W1'
    expect(run(text, ['Sigewinne']).shields).toEqual([])
    const { start, shields } = run(text, ['Sigewinne'], { Sigewinne: 2 })
    // (until the frame after the animation: 41 frames, the burst's 99 + 142)
    expect(shields).toEqual([
      [start('Sigewinne', 'E'), 43, 'Sigewinne', ''],
      [start('Sigewinne', 'Q'), 243, 'Sigewinne', ''],
    ])
  })
})
