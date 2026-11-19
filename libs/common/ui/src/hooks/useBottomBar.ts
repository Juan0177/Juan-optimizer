import { useEffect, useRef } from 'react'

/** CSS variable holding the room a page's sticky bottom bar takes, for the floating buttons */
export const BOTTOM_BAR_VAR = '--go-bottom-bar'

/** `bottom` for a button fixed at the bottom right: `gap` px above the page's bottom bar, if any */
export const aboveBottomBar = (gap: number) =>
  `calc(${gap}px + var(${BOTTOM_BAR_VAR}, 0px))`

/** Marks the element as the page's sticky bottom bar while it is mounted (and measured) */
export function useBottomBar<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const root = document.documentElement
    const measure = () => {
      const bottom = Number.parseFloat(getComputedStyle(el).bottom) || 0
      root.style.setProperty(
        BOTTOM_BAR_VAR,
        `${Math.ceil(el.offsetHeight + bottom)}px`
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
      root.style.removeProperty(BOTTOM_BAR_VAR)
    }
  }, [])
  return ref
}
