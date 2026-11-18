import { describe, expect, it } from 'vitest'
import { formatHp, parseHp } from './hp'

describe('an HP as typed', () => {
  it('reads suffixes, thousands separators and decimal commas', () => {
    expect(parseHp('20M')).toBe(20_000_000)
    expect(parseHp(' 1.5b ')).toBe(1_500_000_000)
    expect(parseHp('750k')).toBe(750_000)
    expect(parseHp('33,5M')).toBe(33_500_000)
    expect(parseHp('1.234m')).toBe(1_234_000)
    expect(parseHp('1,234m')).toBe(1_234_000)
    expect(parseHp('20,000,000')).toBe(20_000_000)
    expect(parseHp('20.000.000')).toBe(20_000_000)
    expect(parseHp('20 000 000')).toBe(20_000_000)
    expect(parseHp('12345678')).toBe(12_345_678)
    expect(parseHp('.5m')).toBe(500_000)
  })
  it('is none when empty, and not a number otherwise', () => {
    expect(parseHp('')).toBeUndefined()
    expect(parseHp('   ')).toBeUndefined()
    for (const text of ['abc', '20MM', '-5', '1e9', 'm', '20,00,000'])
      expect(parseHp(text)).toBeNull()
  })
  it('is written out in full to edit', () => {
    expect(formatHp(33_500_000)).toBe('33,500,000')
  })
})
