/**
 * Waits as a player reads them (Discord reports): a rotation that starts by waiting for a cooldown
 * left from the one before is shown from its first action, the wait at its end ("Odette EE" alone
 * put her E 13 s in); and Mitya's second tap E, pushed past his 6 s window to switch the Detection
 * Core, says why it waits for the 18 s cooldown.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  lastRotation,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const play = (
  team: CharacterKey[],
  text: string,
  constellations: Partial<Record<CharacterKey, number>> = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      team.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members: team,
    elements: Object.fromEntries(team.map((m) => [m, getCharEle(m)])) as never,
    constellations,
    repeats: 4,
    keep: 'last2',
  })

describe('a rotation that starts by waiting', () => {
  const team: CharacterKey[] = ['Mitya', 'Valeriy', 'Odette', 'Anastasya']
  const sim = play(team, 'Odette EE')
  const shown = lastRotation(sim)
  it('is shown from its first action, as long as a counted rotation', () => {
    const first = Math.min(...shown.actions.map((a) => a.start))
    expect(first).toBe(shown.start)
    expect(shown.frames).toBe(sim.frames / 2)
    // (her Skill's cooldown: most of the rotation is the wait, at its end)
    const last = Math.max(...shown.actions.map((a) => a.start + a.frames))
    expect(shown.start + shown.frames - last).toBeGreaterThan(10 * 60)
  })
  it('keeps the same hits as a counted rotation', () => {
    const counted = sim.hits.filter((h) => h.characterKey === 'Odette').length
    expect(
      shown.hits.filter((h) => h.characterKey === 'Odette').length * 2
    ).toBe(counted)
  })
})

describe('a rotation that does not wait at its start', () => {
  it('is shown as played', () => {
    const team: CharacterKey[] = ['Bennett', 'Xiangling', 'Xingqiu', 'Sucrose']
    const sim = play(
      team,
      'Bennett E Q -> Xingqiu E Q -> Sucrose E -> Xiangling N3 N3 N3 N3 N3 N3 N3 N3'
    )
    expect(lastRotation(sim).start).toBe(sim.rotationStarts!.at(-1))
  })
})

describe("Mitya's second tap E past his switch window", () => {
  const team: CharacterKey[] = ['Mitya', 'Odette', 'Sucrose', 'Valeriy']
  it('notes that it is a new Skill when it has to wait', () => {
    const sim = play(
      team,
      'Mitya tE -> Odette EE -> Valeriy Q -> Sucrose N1ED -> Mitya tE CA Q CA -> Sucrose E D Q -> Valeriy CA E -> Mitya CA',
      { Valeriy: 6 }
    )
    expect(
      sim.notes.some((n) => n.includes('switching the Detection Core'))
    ).toBe(true)
  })
  it('says nothing when the rotation has one tap E', () => {
    const sim = play(team, 'Mitya tE CA CA -> Odette EE -> Mitya CA')
    expect(
      sim.notes.some((n) => n.includes('switching the Detection Core'))
    ).toBe(false)
  })
})
