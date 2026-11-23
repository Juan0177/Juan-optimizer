import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const team: CharacterKey[] = ['Mitya', 'Anastasya', 'Danica', 'Odette']
const attacksOf = (text: string) =>
  rotationAttacks(
    simulateRotation({
      rotation: parseRotation(
        text,
        team.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members: team,
      elements: Object.fromEntries(
        team.map((m) => [m, getCharEle(m)])
      ) as never,
      constellations: { Odette: 2 },
      repeats: 4,
      keep: 'last2',
    }),
    // her loadout has them on (as an earlier rotation's defaults leave them)
    (owner, path) =>
      owner !== 'Odette'
        ? undefined
        : path[1] === 'burst' || path[1] === 'c2NearOpponent'
          ? 'on'
          : path[1] === 'a1TeamSplendor'
            ? '4'
            : undefined
  )
/** Whether every attack of `member` has Odette's `buff` off */
const off = (
  attacks: ReturnType<typeof attacksOf>,
  member: CharacterKey,
  buff: string
) =>
  (attacks[member] ?? []).every((a) =>
    a.limits?.some(
      (l) => l.owner === 'Odette' && l.path[1] === buff && l.hits === 0
    )
  )

describe("Odette's buffs come only from her Skill and Burst", () => {
  it('are off for everyone when the rotation never uses them', () => {
    const attacks = attacksOf(
      'Danica E -> Mitya E -> Anastasya hE N3 Q N3 E N3'
    )
    for (const member of ['Mitya', 'Anastasya', 'Danica'] as const)
      for (const buff of ['burst', 'a1TeamSplendor', 'c2NearOpponent'])
        expect(off(attacks, member, buff)).toBe(true)
  })

  it('follow her Dance Double when she uses her Skill', () => {
    const attacks = attacksOf(
      'Odette E -> Danica E -> Mitya E -> Anastasya hE N3 Q N3 E N3'
    )
    expect(off(attacks, 'Anastasya', 'burst')).toBe(true)
    expect(
      attacks.Anastasya?.some((a) =>
        a.states?.some(
          (s) => s.path[1] === 'a1TeamSplendor' && Number(s.value) > 0
        )
      )
    ).toBe(true)
  })
})
