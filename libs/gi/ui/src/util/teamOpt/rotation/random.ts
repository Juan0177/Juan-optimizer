/** Reproducible Mulberry32 stream. Each sampled rotation gets its own stream. */
export function rotationRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let x = Math.imul(state ^ (state >>> 15), state | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * `count` streams for sampled rotations whose k-th draws, taken together, cover [0, 1) evenly:
 * each lands in its own 1/count slice (a Latin hypercube over the draw order). A few samples then
 * see the whole range of a random event (Citlali's skull at 87 to 117 frames) instead of
 * wherever independent draws happen to fall. Each stream alone is still uniform, so averages
 * over the samples stay unbiased.
 */
export function stratifiedRandoms(
  count: number,
  seed: number
): (() => number)[] {
  const slices: number[][] = []
  const shuffle = rotationRandom(seed ^ 0x5f356495)
  const sliceAt = (k: number) => {
    while (slices.length <= k) {
      const order = Array.from({ length: count }, (_, i) => i)
      for (let i = count - 1; i > 0; i--) {
        const j = Math.floor(shuffle() * (i + 1))
        ;[order[i], order[j]] = [order[j], order[i]]
      }
      slices.push(order)
    }
    return slices[k]
  }
  return Array.from({ length: count }, (_, i) => {
    const own = rotationRandom(seed + Math.imul(i, 0x9e3779b9))
    let k = 0
    return () => (sliceAt(k++)[i] + own()) / count
  })
}
