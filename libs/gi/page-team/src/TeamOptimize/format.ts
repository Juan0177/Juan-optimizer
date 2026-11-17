import { statName } from '@genshin-optimizer/gi/ui'
import i18next from 'i18next'

const compact = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 2,
})
const compactPrecise = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 3,
})

/** Damage per rotation, short: 12.4K, 3.45M (12,4K and 3,45M in Italian: the site's decimal separator) */
export function formatDamage(value: number | undefined, precise = false) {
  if (value === undefined || !Number.isFinite(value)) return '–'
  return localizeDecimal(
    (precise ? compactPrecise : compact).format(value),
    siteLocale()
  )
}

/** Damage per rotation, or per second (DPS) when the rotation's length is known */
/** A rotation's length when the team has none set (seconds) */
export const defaultRotationTime = 20

export function formatRate(
  value: number | undefined,
  rotationTime: number | undefined,
  precise = false
) {
  return formatDamage(
    value !== undefined && rotationTime ? value / rotationTime : value,
    precise
  )
}

/** The site's language, for numbers ('en' before i18next is ready, as in tests) */
function siteLocale() {
  return (i18next.isInitialized && i18next.language) || 'en'
}

const wholeFormats = new Map<string, Intl.NumberFormat>()
/** Damage per rotation, or per second, in full: 63,592 (as precise as `formatRate`'s 63.592K); `locale`: the language's grouping (63.592) */
export function formatRateFull(
  value: number | undefined,
  rotationTime: number | undefined,
  locale = 'en'
) {
  if (value === undefined || !Number.isFinite(value)) return '–'
  let whole = wholeFormats.get(locale)
  if (!whole) {
    whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
    wholeFormats.set(locale, whole)
  }
  return whole.format(rotationTime ? value / rotationTime : value)
}

const isEnglish = (locale: string | undefined) =>
  !locale || locale.toLowerCase().startsWith('en')

/** A number written with a point ("19.4", "+0.8%") in the language's decimal separator ("19,4"); English: as is */
export function localizeDecimal(text: string, locale?: string) {
  if (isEnglish(locale)) return text
  const sep =
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((p) => p.type === 'decimal')?.value ?? '.'
  return text.replace('.', sep)
}

/** A length of time in seconds, `text` its number: "19.4s"; in other languages "19,4 s" */
export function secondsText(text: string, locale?: string) {
  return isEnglish(locale) ? `${text}s` : `${localizeDecimal(text, locale)} s`
}

/** A relative change: +9.6%, −0.4% */
export function formatGain(ratio: number, locale?: string) {
  if (!Number.isFinite(ratio)) return '–'
  const pct = ratio * 100
  const digits = Math.abs(pct) < 10 ? 1 : 0
  const text = Math.abs(pct).toFixed(digits)
  if (text === (0).toFixed(digits)) return '±0%'
  return `${pct > 0 ? '+' : '−'}${localizeDecimal(text, locale)}%`
}

/** Hits per rotation: integers as they are, averages with up to two decimals */
export function formatHits(hits: number) {
  return Number.isInteger(hits) ? `${hits}` : `${Math.round(hits * 100) / 100}`
}

/** A main stat's short name; HP%, ATK% and DEF% keep their % (their names alone read as flat) */
export function mainStatLabel(key: string) {
  const name = statName(key)
  return ['hp_', 'atk_', 'def_'].includes(key) && !name.includes('%')
    ? `${name}%`
    : name
}
