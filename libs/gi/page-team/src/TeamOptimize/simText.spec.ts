import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { simText } from './simText'

/** A `t` that returns the key and its values, to see what simText asks for */
const t = ((key: string, options: Record<string, unknown>) =>
  `${key} ${JSON.stringify({ ...options, defaultValue: undefined })}`) as unknown as TFunction

describe('simText', () => {
  it('translates the parser and simulation messages it knows', () => {
    expect(simText(t, 'Furina: "X" is not an action (skipped)')).toBe(
      'page_team:teamOpt.sim.notAction {"who":"Furina","word":"X"}'
    )
    expect(simText(t, "Waited 2.5 s for Furina's E.", 'it')).toBe(
      'page_team:teamOpt.sim.waitedFor {"seconds":"2,5","who":"Furina","action":"E"}'
    )
    expect(
      simText(t, 'Waited 1.0 s before swapping from Furina to Mitya.', 'en')
    ).toBe(
      'page_team:teamOpt.sim.waitedSwap {"seconds":"1.0","from":"Furina","to":"Mitya"}'
    )
  })
  it('leaves any other text as it is', () => {
    const note = 'Aino: hold skill is not in gcsim; modelled as the tap'
    expect(simText(t, note)).toBe(note)
  })
})
