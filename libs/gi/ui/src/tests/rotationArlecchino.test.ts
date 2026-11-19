import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation, rotationSpans } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const names = (keys: CharacterKey[]) =>
  keys.map((characterKey) => ({ characterKey, name: characterKey }))

function run(text: string, constellation = 0) {
  const members: CharacterKey[] = ['Arlecchino']
  return simulateRotation({
    rotation: parseRotation(text, names(members)),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: { Arlecchino: constellation },
    repeats: 1,
    keep: 'all',
  })
}

describe("Arlecchino's Charged Attack cancelled before it hits (a player request)", () => {
  it('reads "CA[cancel] D" and gcsim\'s "CA[early_cancel=1] J"', () => {
    for (const text of [
      'Arlecchino E CA[cancel] D N5',
      'Arlecchino E CA[early_cancel=1] J N5',
    ]) {
      const parsed = parseRotation(text, names(['Arlecchino']))
      expect(parsed.warnings).toEqual([])
      expect(parsed.steps[0].actions[1]).toMatchObject({
        kind: 'charged',
        cancel: true,
      })
    }
  })

  it('needs a dash or jump to cancel it, and is Arlecchino’s only (otherwise a plain Charged Attack)', () => {
    const alone = parseRotation(
      'Arlecchino E CA[cancel] N5',
      names(['Arlecchino'])
    )
    expect(alone.steps[0].actions[1].cancel).toBeUndefined()
    expect(alone.warnings[0]).toContain('a dash or jump cancels it')
    const other = parseRotation('Bennett CA[cancel] D', names(['Bennett']))
    expect(other.steps[0].actions[0].cancel).toBeUndefined()
    expect(other.warnings[0]).toContain("only Arlecchino's")
  })

  it('is an action in the writer, written with a space before its dash too', () => {
    const text = 'Arlecchino E CA[cancel] D N5'
    const word = rotationSpans(text, names(['Arlecchino'])).find(
      (s) => text.slice(s.from, s.to) === 'CA[cancel]'
    )
    expect(word?.kind).toBe('action')
  })

  it('absorbs the directive without the attack’s hit, and the dash comes 13 frames in (gcsim)', () => {
    const sim = run('Arlecchino E W6 CA[cancel] D N1')
    expect(sim.hits.some((h) => h.label === 'Charged Attack')).toBe(false)
    expect(
      sim.hits.some((h) => h.path.join('.') === '_marker.bondOfLife.gain')
    ).toBe(true)
    const ca = sim.actions.find((a) => a.text === 'CA[cancel]')!
    const dash = sim.actions.find((a) => a.text === 'D')!
    expect(dash.start - ca.start).toBe(13)
    // (the directive, upgraded by A1 after 5 s, gives 130%: the first Normal Attack is Pyro)
    const n1 = sim.hits.find((h) => h.label === 'N1')!
    expect(n1.element).toBe('pyro')
    expect(
      sim.buffWindows.find(
        (w) => w.path[1] === 'bondPercent' && w.start === n1.t
      )?.value
    ).toBe('130')
  })

  it('at C2 still sets off Balemoon Bloodfire', () => {
    const sim = run('Arlecchino E CA[cancel] D N1 W1', 2)
    expect(
      sim.hits.filter((h) => h.label === 'Balemoon Bloodfire (C2)')
    ).toHaveLength(1)
  })
})
