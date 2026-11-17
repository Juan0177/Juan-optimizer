/**
 * An HP as typed: "20M", "1.5b", "750k", "20,000,000", "20 000 000", "20.000.000" or "1,5M".
 * Empty: undefined (no HP); not a number: null
 */
export function parseHp(text: string): number | undefined | null {
  let s = text
    .trim()
    .toLowerCase()
    .replace(/[\s_'’]/g, '')
  if (!s) return undefined
  // thousands separators (1,234,567 or 1.234.567), else a decimal comma (1,5m; with a suffix, one
  // separator is a decimal one: 1.234m)
  if (
    /^\d{1,3}([,.])\d{3}(\1\d{3})*([kmb])?$/.test(s) &&
    !/^\d+[.,]\d{3}[kmb]$/.test(s)
  )
    s = s.replace(/[,.]/g, '')
  else s = s.replace(',', '.')
  const match = s.match(/^(\d+(?:\.\d+)?|\.\d+)([kmb])?$/)
  if (!match) return null
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[match[2] as 'k' | 'm' | 'b'] ?? 1
  const hp = Number(match[1]) * scale
  return Number.isFinite(hp) ? hp : null
}

/** An HP to edit: 20,000,000 */
export const formatHp = (hp: number) =>
  new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(hp)
