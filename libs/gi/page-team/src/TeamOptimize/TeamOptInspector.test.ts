import { describe, expect, it } from 'vitest'
import { withFoundBuild } from './TeamOptInspector'

const row = (total: number, sets: Record<string, number>) => ({ total, sets })

describe('the set rankings of a member', () => {
  const fourPieces = [
    row(319.81, { TenacityOfTheMillelith: 4 }),
    row(318.9, { DeepwoodMemories: 4 }),
    row(306.92, { GildedDreams: 4 }),
  ]
  it('rank the build found first when it beats every 4 pieces (2+2)', () => {
    const found = row(343.08, { GildedDreams: 2, TenacityOfTheMillelith: 2 })
    const list = withFoundBuild(fourPieces, found)
    expect(list[0]).toBe(found)
    expect(list.slice(1)).toEqual(fourPieces)
  })
  it('place it by its damage when a 4-piece row is better (a picked weapon)', () => {
    const found = row(318.95, { GildedDreams: 2 })
    expect(withFoundBuild(fourPieces, found).map((r) => r.total)).toEqual([
      319.81, 318.95, 318.9, 306.92,
    ])
  })
  it('list a 4-piece build found only once: its set has its row', () => {
    const found = row(319.81, { TenacityOfTheMillelith: 4 })
    expect(withFoundBuild(fourPieces, found)).toEqual(fourPieces)
  })
  it('add a build without any set bonus (mixed pieces)', () => {
    const found = row(330, {})
    expect(withFoundBuild(fourPieces, found)[0]).toBe(found)
  })
  it('keep the rankings as they are with no build found yet', () => {
    expect(withFoundBuild(fourPieces, undefined)).toEqual(fourPieces)
    expect(withFoundBuild([], undefined)).toEqual([])
  })
  it('sort rows that came in out of order', () => {
    expect(
      withFoundBuild([fourPieces[2], fourPieces[0]], undefined).map(
        (r) => r.total
      )
    ).toEqual([319.81, 306.92])
  })
})
