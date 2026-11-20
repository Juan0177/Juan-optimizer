/**
 * An open/closed flag outside React state: flipping it re-renders only the components that read
 * it (the members' headers and folds), not the page that owns it
 */
export function expandStore(initial: boolean) {
  let open = initial
  const listeners = new Set<() => void>()
  const set = (next: boolean) => {
    if (next === open) return
    open = next
    for (const listener of listeners) listener()
  }
  return {
    get: () => open,
    set,
    toggle: () => set(!open),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
export type ExpandStore = ReturnType<typeof expandStore>
