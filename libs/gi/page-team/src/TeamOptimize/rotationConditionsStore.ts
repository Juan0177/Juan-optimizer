import { useEffect, useState } from 'react'
import type { RotationConditions } from './timelineModel'

/**
 * The shown result's rotation conditions, by team and tab (`conditionsKey`): the results'
 * timeline works them out from its replay, Damage share shows them
 */
const shown = new Map<string, RotationConditions>()
const listeners = new Map<string, Set<() => void>>()

export const conditionsKey = (teamId: string, tab: 'kqm' | 'team') =>
  `${teamId}|${tab}`

export function publishConditions(
  key: string,
  conditions: RotationConditions | undefined
) {
  if (conditions) shown.set(key, conditions)
  else shown.delete(key)
  for (const listener of listeners.get(key) ?? []) listener()
}

export function useRotationConditions(key: string | undefined) {
  const [value, setValue] = useState(() => (key ? shown.get(key) : undefined))
  useEffect(() => {
    if (!key) return setValue(undefined)
    const update = () => setValue(shown.get(key))
    update()
    const set = listeners.get(key) ?? new Set()
    set.add(update)
    listeners.set(key, set)
    return () => {
      set.delete(update)
    }
  }, [key])
  return value
}
