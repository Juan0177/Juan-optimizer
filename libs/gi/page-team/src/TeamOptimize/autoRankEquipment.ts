import { useSyncExternalStore } from 'react'

const AUTO_RANK_KEY = 'teamOpt.autoRankEquipment'
const listeners = new Set<() => void>()
let cached: boolean | undefined

function loadFromStorage(): boolean | undefined {
  try {
    const storage = globalThis.localStorage
    if (!storage || typeof storage.getItem !== 'function') return undefined
    const raw = storage.getItem(AUTO_RANK_KEY)
    return raw === '1'
  } catch {
    return undefined
  }
}

/** Whether Team Optimize should automatically run equipment ranking right after finishing. */
export function readAutoRankEquipment(): boolean {
  if (cached === undefined) cached = loadFromStorage() ?? false
  return cached
}

export function setAutoRankEquipment(enabled: boolean) {
  cached = enabled
  try {
    const storage = globalThis.localStorage
    if (storage && typeof storage.setItem === 'function') {
      if (enabled) storage.setItem(AUTO_RANK_KEY, '1')
      else storage.removeItem?.(AUTO_RANK_KEY)
    }
  } catch {
    // ignore storage errors in restricted environments
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === AUTO_RANK_KEY || e.key === null) {
      cached = loadFromStorage() ?? false
      listener()
    }
  }
  globalThis.window?.addEventListener?.('storage', onStorage)
  return () => {
    listeners.delete(listener)
    globalThis.window?.removeEventListener?.('storage', onStorage)
  }
}

/**
 * Shared user preference (persisted in localStorage) to automatically run "Rank equipment"
 * right after Team Optimize finishes, matching the earlier behavior.
 */
export function useAutoRankEquipment(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribe,
    readAutoRankEquipment,
    () => false
  )
  return [enabled, setAutoRankEquipment]
}
