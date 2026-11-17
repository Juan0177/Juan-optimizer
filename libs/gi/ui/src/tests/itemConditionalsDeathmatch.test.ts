import { describe, expect, it } from 'vitest'
import { itemConditionals } from '../util/teamOpt/itemConditionals'

describe('Deathmatch by rule', () => {
  it('counts one target (KQM’s standard enemy): ATK +24%, not the +16% of 2 or more opponents', () => {
    const { picked } = itemConditionals(
      { attacks: ['normal', 'skill', 'burst'], auras: [] } as never,
      { sets: [], weapons: ['Deathmatch'] }
    )
    expect(picked.map((p) => p.value)).toEqual(['oneOrNone'])
  })
})
