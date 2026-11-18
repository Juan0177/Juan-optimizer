import i18next from 'i18next'

/** juanlab: the site's language, for numbers ('en' before i18next is ready, as in tests) */
export const siteLanguage = () =>
  (i18next.isInitialized && i18next.language) || 'en'

const isEnglish = (locale: string) => locale.toLowerCase().startsWith('en')

const compactFormats = new Map<number, Intl.NumberFormat>()
/**
 * juanlab: a number in short, to `digits` significant digits: 13.5M, 63.6K (English suffixes); in
 * another language with its decimal separator: 13,5M
 */
export function formatCompact(
  value: number,
  digits: number,
  locale = siteLanguage()
) {
  let format = compactFormats.get(digits)
  if (!format) {
    format = new Intl.NumberFormat('en', {
      notation: 'compact',
      maximumSignificantDigits: digits,
    })
    compactFormats.set(digits, format)
  }
  const text = format.format(value)
  if (isEnglish(locale)) return text
  const sep =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === 'decimal')?.value ?? '.'
  return text.replace('.', sep)
}

const wholeFormats = new Map<string, Intl.NumberFormat>()
/** juanlab: a whole number in full, grouped as the language groups it: 13,500,000; 13.500.000 */
export function formatWhole(value: number, locale = siteLanguage()) {
  let format = wholeFormats.get(locale)
  if (!format) {
    format = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
    wholeFormats.set(locale, format)
  }
  return format.format(value)
}
