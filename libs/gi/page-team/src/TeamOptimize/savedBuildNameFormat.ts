import { useSyncExternalStore } from 'react'
import { DEFAULT_BUILD_NAME_FORMAT } from './apply'

const FORMAT_KEY = 'teamOpt.savedBuildNameFormat'
const listeners = new Set<() => void>()
let cached: string | undefined

function loadFromStorage(): string | undefined {
  try {
    const storage = globalThis.localStorage
    if (!storage || typeof storage.getItem !== 'function') return undefined
    const raw = storage.getItem(FORMAT_KEY)?.trim()
    return raw || undefined
  } catch {
    return undefined
  }
}

/** Persisted build name format for "Save and use on this team" (supports `{team}`). */
export function readSavedBuildNameFormat(): string {
  if (cached === undefined)
    cached = loadFromStorage() ?? DEFAULT_BUILD_NAME_FORMAT
  return cached
}

export function setSavedBuildNameFormat(format: string) {
  const next = format.trim() || DEFAULT_BUILD_NAME_FORMAT
  cached = next
  try {
    const storage = globalThis.localStorage
    if (storage && typeof storage.setItem === 'function') {
      if (next === DEFAULT_BUILD_NAME_FORMAT) storage.removeItem?.(FORMAT_KEY)
      else storage.setItem(FORMAT_KEY, next)
    }
  } catch {
    // ignore storage errors in restricted environments
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === FORMAT_KEY || e.key === null) {
      cached = loadFromStorage() ?? DEFAULT_BUILD_NAME_FORMAT
      listener()
    }
  }
  globalThis.window?.addEventListener?.('storage', onStorage)
  return () => {
    listeners.delete(listener)
    globalThis.window?.removeEventListener?.('storage', onStorage)
  }
}

/** Shared persisted name format preference for saved Team Optimize builds. */
export function useSavedBuildNameFormat(): [string, (format: string) => void] {
  const format = useSyncExternalStore(
    subscribe,
    readSavedBuildNameFormat,
    () => DEFAULT_BUILD_NAME_FORMAT
  )
  return [format, setSavedBuildNameFormat]
}
