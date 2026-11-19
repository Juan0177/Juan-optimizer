import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import {
  rotationTemplates,
  templatesForTeam,
} from '../util/teamOpt/rotation/templates'

const names = (keys: CharacterKey[]) =>
  keys.map((characterKey) => ({ characterKey, name: characterKey }))

describe('built-in rotation templates (a player request)', () => {
  it.each(
    rotationTemplates.map((t) => [t.id, t] as const)
  )('%s plays as it was checked: no warnings, no long waits, its recorded length', (_, t) => {
    expect(t.members).toContain(t.characterKey)
    const rotation = parseRotation(t.text, names(t.members))
    expect(rotation.warnings).toEqual([])
    if (t.opener) {
      const opener = parseRotation(t.opener, names(t.members))
      expect(opener.warnings).toEqual([])
      rotation.opener = opener.steps
    }
    const sim = simulateRotation({
      rotation,
      members: t.members,
      elements: Object.fromEntries(t.members.map((k) => [k, getCharEle(k)])),
      constellations: t.checked?.constellations ?? {},
      gear: t.checked?.gear as never,
    })
    expect(sim.unsupported).toEqual([])
    expect(sim.warnings).toEqual([])
    expect(
      (sim.stallSpans ?? []).filter((s) => s.frames >= 60).map((s) => s.label)
    ).toEqual([])
    expect(Math.abs(sim.frames / 60 - t.seconds) / t.seconds).toBeLessThan(0.05)
  })

  it('lists a team’s own templates first, then those sharing more of its members', () => {
    const list = templatesForTeam(['Mavuika', 'Citlali', 'Bennett', 'Kaeya'])
    expect(list.map((t) => t.characterKey)).toEqual(list.map(() => 'Mavuika'))
    expect(list[0].members).toEqual(
      expect.arrayContaining(['Mavuika', 'Citlali', 'Bennett'])
    )
    expect(templatesForTeam(['Bennett', 'Kaeya'])).toEqual([])
  })
})

describe('Cyno: a cut to his Skill cooldown reaches Mortuary Rite’s (gcsim)', () => {
  it('with 4pc Thundering Fury his Mortuary Rites in an Aggravate string come without waiting', () => {
    const members: CharacterKey[] = ['Cyno', 'Nahida']
    /** Frames between his Mortuary Rites (the Skill in Pactsworn) */
    const gaps = (sets: Record<string, number>) => {
      const sim = simulateRotation({
        rotation: parseRotation(
          'Nahida E -> Cyno E Q 4[N2 E N3 D] N2 E',
          names(members)
        ),
        members,
        elements: { Cyno: 'electro', Nahida: 'dendro' },
        constellations: {},
        gear: { Cyno: { sets } } as never,
      })
      const rites = sim.actions.filter(
        (a) =>
          a.characterKey === 'Cyno' &&
          a.text === 'E' &&
          a.variant?.key === 'pactsworn'
      )
      return rites.slice(1).map((a, i) => a.start - rites[i].start)
    }
    // N2 E N3 D is 157 frames; Mortuary Rite's cooldown, 180 from 26 frames into it
    expect(gaps({ ThunderingFury: 4 }).every((g) => g <= 160)).toBe(true)
    expect(gaps({ GladiatorsFinale: 4 }).every((g) => g >= 200)).toBe(true)
  })
})
