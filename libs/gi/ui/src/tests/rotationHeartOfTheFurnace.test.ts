/**
 * Heart of the Furnace 4pc (gcsim, kqmsim): the wearer's ATK +12% and the party's Stellar Glimmer
 * reaction DMG +50% for 12 s when the wearer triggers a Stellar-Conduct or Stellar Swirl, or deals
 * Stellar DMG; off the field too. A teammate's do not count. Declared off outside its windows (as
 * Instructor is), so a manual "on" cannot cover the whole rotation.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import {
  isStellarAttackPath,
  itemConditionals,
} from '../util/teamOpt/itemConditionals'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel, SimHit } from '../util/teamOpt/rotation/types'

type Mark = { t: number; tag?: SimHit['tag']; reaction?: string }
/** A kit whose Skill lands `marks` (a Stellar DMG hit, or a reaction it triggers) */
const kit = (characterKey: CharacterKey, marks: Mark[]): KitModel => ({
  characterKey,
  element: 'electro',
  source: 'test',
  act(ctx, _state, action) {
    if (action.kind === 'skill')
      for (const m of marks)
        ctx.hit(
          m.t,
          m.reaction
            ? {
                path: ['_reaction', m.reaction],
                tag: 'other',
                element: 'electro',
                label: m.reaction,
              }
            : {
                path: ['skill', 'stellarDmg'],
                tag: m.tag ?? 'skill',
                element: 'electro',
                label: 'Skill',
              }
        )
    return { frames: 60 }
  },
})
const members: CharacterKey[] = ['Mitya', 'Valeriy']
const furnace = (text: string, mitya: Mark[], valeriy: Mark[] = []) => {
  const sim = simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { Mitya: 'electro', Valeriy: 'cryo' },
    repeats: 1,
    kits: { Mitya: kit('Mitya', mitya), Valeriy: kit('Valeriy', valeriy) },
    reactions: { onHit() {} },
    gear: { Mitya: { sets: { HeartOfTheFurnace: 4 } } },
  })
  const start = sim.actions.find((a) => a.characterKey === 'Mitya')!.start
  const windows = sim.buffWindows.filter(
    (w) => w.path.join('.') === 'HeartOfTheFurnace.4Stellar'
  )
  return {
    declared: windows.some((w) => w.end === w.start),
    on: windows
      .filter((w) => w.end > w.start)
      .map((w) => [w.start - start, w.end - w.start]),
  }
}

describe('Heart of the Furnace', () => {
  it('12 s from the wearer’s own Stellar DMG', () => {
    expect(
      furnace('Mitya E -> Valeriy E', [{ t: 10, tag: 'directStellarConduct' }])
        .on
    ).toEqual([[10, 720]])
  })
  it('12 s from a Stellar reaction the wearer triggers, off the field too', () => {
    // (Mitya leaves after 60 frames: her reaction at 200 comes off the field)
    expect(
      furnace('Mitya E -> Valeriy E N1 N1', [
        { t: 200, reaction: 'stellarSwirl' },
      ]).on
    ).toEqual([[200, 720]])
  })
  it('not from the wearer’s other hits, nor a teammate’s Stellar DMG; declared off', () => {
    const r = furnace(
      'Mitya E -> Valeriy E',
      [{ t: 10 }],
      [{ t: 10, tag: 'directStellarConduct' }]
    )
    expect(r.on).toEqual([])
    expect(r.declared).toBe(true)
  })
})

describe('Heart of the Furnace by rule (attacks entered without a rotation)', () => {
  const on = (ctx: Parameters<typeof itemConditionals>[0]) =>
    itemConditionals(ctx, { sets: ['HeartOfTheFurnace'], weapons: [] })
      .conditional?.HeartOfTheFurnace?.['4Stellar']
  it('on only when the wearer deals Stellar DMG itself', () => {
    const team = { attacks: ['skill' as const], auras: ['electro', 'stellar'] }
    expect(on({ ...team, ownStellar: true })).toBe('on')
    expect(on({ ...team, ownStellar: false })).toBeUndefined()
  })
  it('tells Stellar DMG apart by its display path', () => {
    for (const path of [
      ['charged', 'beamStellarDmg'],
      ['charged', 'beamSsDmg'],
      ['burst', 'crownSc'],
      ['normal', 'hit1ScDmg'],
      ['skill', 'wingStellarswirlDmg'],
    ])
      expect([path.join('.'), isStellarAttackPath(path)]).toEqual([
        path.join('.'),
        true,
      ])
    for (const path of [
      ['skill', 'press'],
      ['burst', 'dmg'],
      ['charged', 'beamDmg'],
    ])
      expect([path.join('.'), isStellarAttackPath(path)]).toEqual([
        path.join('.'),
        false,
      ])
  })
})
