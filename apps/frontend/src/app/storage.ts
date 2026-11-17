import { openAppStorage } from '@genshin-optimizer/common/database'

/**
 * localStorage keys that stay there when the data move to IndexedDB: this device's settings and
 * drafts, which the app reads straight from localStorage. Everything else is the database's
 * (artifacts, characters, teams, results, the other database slots...) and moves.
 * A new setting kept in localStorage belongs in this list.
 */
const KEEP_LOCAL_KEYS = new Set([
  'GONewTabDetection',
  'i18nextLng',
  'stellar-notrack',
  'GOGettingStartedHidden',
  'go_opt_gpu',
  'snow_effect_enabled',
  'num_opt_workers',
  // (i18next's check that localStorage works: written and removed at once)
  'i18next.translate.boo',
])
const KEEP_LOCAL_PREFIXES = [
  'infoShown_',
  'go_tcFrom_',
  'teamOptRotation',
  'teamOpt.',
]
const KEEP_LOCAL_SUFFIXES = ['_filtersOpen']

export function keepLocal(key: string) {
  return (
    KEEP_LOCAL_KEYS.has(key) ||
    KEEP_LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
    KEEP_LOCAL_SUFFIXES.some((suffix) => key.endsWith(suffix))
  )
}

/** Opens the app's data (moving them out of localStorage the first time) */
export function openStorage() {
  return openAppStorage({
    name: 'juan-optimizer', // juanlab
    keepLocal,
    newTabKey: 'GONewTabDetection',
  })
}
