/**
 * Alhaitham's Projection Attack ICD (1.6 s) is a status on his own clock (gcsim/kqmsim
 * `AddStatus(projectionICDKey, 96, true)`): his hitlag extends it. Measured against kqmsim on KQM
 * DB team dRwtpwtwLndP, whose Lunar-Charged count it decides.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

it('fires Projection Attacks on kqmsim’s frames (his hitlag extends the 1.6 s ICD)', () => {
  const members: CharacterKey[] = ['Alhaitham', 'Xingqiu', 'Aino', 'Ineffa']
  const half =
    'Xingqiu E D Q N1 -> Aino Q E -> Alhaitham Q -> Ineffa N1 E -> Alhaitham N3 D N3 E N3 CA D N3 D N3 D N3 D N3 D N3'
  const sim = simulateRotation({
    rotation: parseRotation(
      `Ineffa Q -> ${half} -> ${half}`,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: { Xingqiu: 6, Aino: 6 },
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    repeats: 1,
    keep: 'all',
  })
  const projections = sim.hits
    .filter((h) => h.label.startsWith('Projection Attack') && h.t < 1400)
    .map((h) => h.t)
  // kqmsim's Projection Attack hits (its sample log's damage events, frames from the start)
  const kqmsim = [
    614, 623, 633, 743, 752, 762, 871, 880, 890, 1000, 1009, 1019, 1114, 1123,
    1133, 1245, 1254, 1367, 1376,
  ]
  const start = sim.actions[0].start
  const ours = projections.map((t) => t - start)
  expect(ours).toHaveLength(kqmsim.length)
  ours.forEach((t, i) => expect(Math.abs(t - kqmsim[i])).toBeLessThanOrEqual(5))
})
