/**
 * Moonsign: Ascendant Gleam (kqmsim's setupAscendantGleam): with two or more Moonsign members, the
 * latest non-Moonsign member to use a Skill or Burst gives it, for 20 s; a newer one replaces it.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Flins', 'Aino', 'Dori', 'Durin']
const windowsOf = (text: string) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: {},
    repeats: 1,
    keep: 'all',
  })
  const start = (who: CharacterKey) =>
    sim.actions.find((a) => a.characterKey === who)!.start
  const windows = (who: CharacterKey) =>
    sim.buffWindows
      .filter(
        (w) =>
          w.owner === who &&
          w.path.join('.') === `${who}.moonsignAfterSkillBurst` &&
          w.end > w.start
      )
      .map((w) => [w.start, w.end])
  return { start, windows }
}

describe('Ascendant Gleam', () => {
  it("is the latest non-Moonsign member's: Durin's Skill ends Dori's", () => {
    const { start, windows } = windowsOf('Dori E -> Durin E -> Flins E')
    expect(windows('Dori')).toEqual([[start('Dori'), start('Durin')]])
    expect(windows('Durin')).toEqual([[start('Durin'), start('Durin') + 1200]])
  })
  it("a Moonsign member's Skill leaves it as it is", () => {
    const { start, windows } = windowsOf('Dori E -> Flins E -> Aino E')
    expect(windows('Dori')).toEqual([[start('Dori'), start('Dori') + 1200]])
  })
})
