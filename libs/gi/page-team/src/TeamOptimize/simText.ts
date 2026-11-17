import type { TFunction } from 'i18next'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * The rotation parser's and the simulation's own messages (written in English where they are made)
 * in the site's language: each known shape has a translation key; anything else (a character
 * kit's technical note) is shown as it is.
 */
const patterns: {
  re: RegExp
  key: string
  english: string
  values: (m: RegExpMatchArray) => Record<string, string>
}[] = [
  {
    re: /^(.+): "(.+)" is not an action \(skipped\)$/,
    key: 'notAction',
    english: '{{who}}: "{{word}}" is not an action (skipped)',
    values: (m) => ({ who: m[1], word: m[2] }),
  },
  {
    re: /^(.+): "(.+)": spins and a finisher are Mavuika's Flamestrider Charged Attack only \(played as a Charged Attack\)$/,
    key: 'spinsOnlyMavuika',
    english:
      '{{who}}: "{{raw}}": spins and a finisher are Mavuika\'s Flamestrider Charged Attack only (played as a Charged Attack)',
    values: (m) => ({ who: m[1], raw: m[2] }),
  },
  {
    re: /^(.+): "(.+)": 1 to (\d+) spins \(played as a Charged Attack\)$/,
    key: 'spinsRange',
    english:
      '{{who}}: "{{raw}}": 1 to {{most}} spins (played as a Charged Attack)',
    values: (m) => ({ who: m[1], raw: m[2], most: m[3] }),
  },
  {
    re: /^(.+): "(.+)": only Sandrone's Charged Attack has beams \(played as a plain Charged Attack\)$/,
    key: 'beamsOnlySandrone',
    english:
      '{{who}}: "{{raw}}": only Sandrone\'s Charged Attack has beams (played as a plain Charged Attack)',
    values: (m) => ({ who: m[1], raw: m[2] }),
  },
  {
    re: /^(.+): "(.+)": 1 to (\d+) beams \(played as a plain Charged Attack\)$/,
    key: 'beamsRange',
    english:
      '{{who}}: "{{raw}}": 1 to {{most}} beams (played as a plain Charged Attack)',
    values: (m) => ({ who: m[1], raw: m[2], most: m[3] }),
  },
  {
    re: /^"(.+)": no team member with that name \(step skipped\)$/,
    key: 'noMember',
    english: '"{{word}}": no team member with that name (step skipped)',
    values: (m) => ({ word: m[1] }),
  },
  {
    re: /^(.+): no actions \(step skipped\)$/,
    key: 'noActions',
    english: '{{who}}: no actions (step skipped)',
    values: (m) => ({ who: m[1] }),
  },
  {
    re: /^(.+): no kit model yet \(their actions were skipped\)$/,
    key: 'noKit',
    english: '{{who}}: no kit model yet (their actions were skipped)',
    values: (m) => ({ who: m[1] }),
  },
  {
    re: /^(\S+)'s (.+) was left out when it was not ready\.$/,
    key: 'leftOut',
    english: "{{who}}'s {{action}} was left out when it was not ready.",
    values: (m) => ({ who: m[1], action: m[2] }),
  },
  {
    re: /^(.+): (.+) could not become ready within 30 seconds\.$/,
    key: 'neverReady',
    english: '{{who}}: {{action}} could not become ready within 30 seconds.',
    values: (m) => ({ who: m[1], action: m[2] }),
  },
  {
    re: /^Waited ([\d.]+) s before swapping from (\S+) to (\S+)\.$/,
    key: 'waitedSwap',
    english: 'Waited {{seconds}} s before swapping from {{from}} to {{to}}.',
    values: (m) => ({ seconds: m[1], from: m[2], to: m[3] }),
  },
  {
    re: /^Waited ([\d.]+) s for (\S+)'s (.+)\.$/,
    key: 'waitedFor',
    english: "Waited {{seconds}} s for {{who}}'s {{action}}.",
    values: (m) => ({ seconds: m[1], who: m[2], action: m[3] }),
  },
]

/** One message in the site's language (see `patterns`) */
export function simText(t: TFunction, text: string, language = 'en'): string {
  for (const { re, key, english, values } of patterns) {
    const m = text.match(re)
    if (!m) continue
    const v = values(m)
    // decimals as the site writes them ("2,5 s" in Italian)
    if (v['seconds'] !== undefined)
      v['seconds'] = Number(v['seconds']).toLocaleString(language, {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    return t(`page_team:teamOpt.sim.${key}`, {
      defaultValue: english,
      ...v,
    }) as string
  }
  return text
}

/** `simText` for a component */
export function useSimText() {
  const { t, i18n } = useTranslation('page_team')
  return useCallback(
    (text: string) => simText(t, text, i18n.language),
    [t, i18n.language]
  )
}
