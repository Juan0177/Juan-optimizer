import { describe, expect, it } from 'vitest'
import { wrapTurns } from './wrapTurns'

const ROTATION =
  'Danica E -> Mitya hE -> Odette E E -> Anastasya E Q -> Danica W1f Q -> Mitya CA Q CA -> Odette E E -> Anastasya E -> Mitya CA E -> Anastasya Q -> Danica W1f Q -> Mitya E CA Q CA -> Odette E E -> Anastasya E -> Mitya CA -> Danica Q -> Anastasya Q'
const turns = ROTATION.split(/\s*->\s*/)
// (a fixed-width font: 10 px a character, as wide as a column of the card)
const measure = (t: string) => t.length * 10

describe('wrapTurns', () => {
  it('keeps every turn of a long rotation, none cut', () => {
    const lines = wrapTurns(turns, measure, 702)
    expect(lines.length).toBeGreaterThan(1)
    const got = lines
      .join(' ')
      .split(/\s*>\s*/)
      .filter(Boolean)
    expect(got).toEqual(turns)
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(702)
    // (a continuing line ends with its `>`)
    for (const line of lines.slice(0, -1)) expect(line.endsWith('>')).toBe(true)
  })
  it('keeps a short rotation on one line, and an empty one on none', () => {
    expect(wrapTurns(['Danica E', 'Mitya Q'], measure, 702)).toEqual([
      'Danica E  >  Mitya Q',
    ])
    expect(wrapTurns([], measure, 702)).toEqual([])
  })
  it('leaves a turn wider than a line whole, alone', () => {
    expect(wrapTurns(['a', 'x'.repeat(100), 'b'], measure, 200)).toEqual([
      'a  >',
      `${'x'.repeat(100)}  >`,
      'b',
    ])
  })
})
