import { unzipFromB64Gzip } from '@genshin-optimizer/common/util'
import { getAppStorage } from './appStorage'

/** An entry of the app's storage (`getAppStorage`), as JSON or as compressed JSON */
export function loadJsonOrB64GzipFromStorage(key: string): any {
  const rawValue = getAppStorage().getString(key)
  let obj = {}
  if (rawValue)
    try {
      // Handle if the value is uncompressed JSON string
      obj = JSON.parse(rawValue)
    } catch {
      // If JSON parse fails, then it should be a compressed b64 gzip
      obj = JSON.parse(unzipFromB64Gzip(rawValue))
    }

  return obj
}
