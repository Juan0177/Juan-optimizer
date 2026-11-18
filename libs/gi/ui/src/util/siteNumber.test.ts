import i18next from 'i18next'
import { afterAll, describe, expect, it } from 'vitest'
import { formatCompact, formatWhole } from './siteNumber'

describe('site numbers', () => {
  it('writes them short, English as before', () => {
    expect(formatCompact(13_500_000, 3, 'en')).toBe('13.5M')
    expect(formatCompact(1_234_567, 4, 'en')).toBe('1.235M')
    expect(formatCompact(63_592, 3, 'en')).toBe('63.6K')
  })
  it('writes them short with the language’s decimal separator, English suffixes', () => {
    expect(formatCompact(13_500_000, 3, 'it')).toBe('13,5M')
    expect(formatCompact(1_234_567, 4, 'it-IT')).toBe('1,235M')
    expect(formatCompact(950, 3, 'it')).toBe('950')
  })
  it('writes them in full, grouped as the language groups them', () => {
    expect(formatWhole(13_500_000, 'en')).toBe('13,500,000')
    expect(formatWhole(13_500_000, 'it')).toBe('13.500.000')
    expect(formatWhole(63_592.4, 'it')).toBe('63.592')
  })
  it('reads the site’s language when none is given (English before i18next is ready)', async () => {
    expect(formatCompact(13_500_000, 3)).toBe('13.5M')
    expect(formatWhole(13_500_000)).toBe('13,500,000')
    await i18next.init({ lng: 'it', resources: {} })
    expect(formatCompact(13_500_000, 3)).toBe('13,5M')
    expect(formatWhole(13_500_000)).toBe('13.500.000')
  })
  afterAll(() => i18next.changeLanguage('en'))
})
