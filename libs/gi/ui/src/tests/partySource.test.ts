import { markPartyWide, uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import type { Data } from '@genshin-optimizer/gi/wr'
import { constant } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'

// The party's own buffs (elemental resonance, reactions) are merged into every member's data and
// counted once through one member's copy: they are labelled as the party's, not that member's.
describe('team buff sources', () => {
  const resonance = markPartyWide(
    { teamBuff: { premod: { critRate_: constant(0.15) } } } as Data,
    'resonance'
  )
  const mitya: Data = { teamBuff: { premod: { critDMG_: constant(0.4) } } }
  const team = uiDataForTeam(
    { Mitya: [mitya, resonance], Odette: [{}, resonance] } as never,
    'F',
    'Mitya'
  )
  type Result = {
    info: { source?: string }
    meta: { ops: Result[] }
  }
  const buffs = (ck: 'Mitya' | 'Odette') =>
    team[ck]!.target.getTeamBuff().premod as unknown as Record<
      string,
      Result | undefined
    >
  /** The sources of a buff's parts (a path several members feed is their sum) */
  const sourcesOf = (r: Result | undefined): (string | undefined)[] =>
    !r ? [] : r.info.source ? [r.info.source] : r.meta.ops.flatMap(sourcesOf)

  it('labels a buff only resonance gives as the resonance', () => {
    expect(new Set(sourcesOf(buffs('Odette').critRate_))).toEqual(
      new Set(['resonance'])
    )
  })
  it("keeps a member's own team buff labelled as the member", () => {
    expect(sourcesOf(buffs('Odette').critDMG_)).toEqual(['Mitya'])
  })
  it('labels a path the member also buffs as the member', () => {
    const own: Data = { teamBuff: { premod: { critRate_: constant(0.1) } } }
    const mixed = uiDataForTeam(
      { Mitya: [own, resonance], Odette: [{}, resonance] } as never,
      'F',
      'Mitya'
    )
    const premod = mixed.Odette!.target.getTeamBuff()
      .premod as unknown as Record<string, Result | undefined>
    // Mitya's part (his own buff and his resonance copy) is his; Odette's copy the resonance's
    expect(new Set(sourcesOf(premod.critRate_))).toEqual(
      new Set(['Mitya', 'resonance'])
    )
  })
})
