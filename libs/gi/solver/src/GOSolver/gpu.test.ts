import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import { dynRead, max, prod, sum } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { testing } from './gpu'

const { shaderSource } = testing

describe('WebGPU shader', () => {
  // a team's damage sums every attack of a long rotation: Metal rejects an expression nested
  // more than 256 levels, and the search went to the CPU (seconds per search)
  it('computes a long sum or max in steps of at most 64 operands', () => {
    const attacks = Array.from({ length: 300 }, (_, i) =>
      prod(i + 1, dynRead('atk'))
    )
    const src = shaderSource(
      [sum(...attacks), max(...attacks)],
      [1],
      ['atk'],
      {
        base: {},
        values: Object.fromEntries(
          allArtifactSlotKeys.map((slot) => [slot, []])
        ) as never,
      },
      undefined,
      undefined,
      0
    )!
    const statements = src.split(';')
    const most = (re: RegExp) =>
      Math.max(...statements.map((s) => s.match(re)?.length ?? 0))
    expect(most(/\+/g)).toBeLessThanOrEqual(64)
    expect(most(/max\(/g)).toBeLessThanOrEqual(64)
  })

  // its own names (set counts c0…c4, rows w0…w4) must not hide the formula's
  it('names the steps of a long sum apart from its own variables', () => {
    const attacks = Array.from({ length: 400 }, (_, i) =>
      prod(i + 1, dynRead('atk'))
    )
    const src = shaderSource(
      [sum(...attacks), dynRead('atk')],
      [1],
      ['atk'],
      {
        base: {},
        values: Object.fromEntries(
          allArtifactSlotKeys.map((slot) => [slot, []])
        ) as never,
      },
      undefined,
      { rainbow: 0b111110, maskOffset: 0 },
      0
    )!
    const names = [...src.matchAll(/let (\w+)/g)].map((m) => m[1])
    const steps = names.filter((n) => /^ws\d+$/.test(n))
    const own = new Set(names.filter((n) => !/^ws\d+$/.test(n)))
    expect(steps.length).toBeGreaterThan(4)
    expect(new Set(steps).size).toBe(steps.length)
    expect(steps.filter((n) => own.has(n))).toEqual([])
  })

  it('picks the mixed-piece mask by whether a set has 4 pieces, only when the two differ', () => {
    const source = (rules: {
      rainbow: number
      noFour?: number
      maskOffset: number
    }) =>
      testing.shaderSource(
        [dynRead('atk')],
        [],
        ['atk'],
        {
          base: {},
          values: Object.fromEntries(
            allArtifactSlotKeys.map((slot) => [slot, []])
          ) as never,
        },
        undefined,
        rules,
        0
      )!
    // two 2-piece bonuses turned off: 0 or 1 mixed pieces only with 4 of a set
    const twoTwo = source({
      rainbow: 0b111111,
      noFour: 0b111100,
      maskOffset: 0,
    })
    expect(twoTwo).toContain(
      'let rbm = select(60u, 63u, max(max(c0, c1), max(max(c2, c3), c4)) >= 4u);'
    )
    expect(twoTwo).toContain('(((rbm >> rb)')
    // the same masks: the shader as before
    for (const rules of [
      { rainbow: 0b11, maskOffset: 0 },
      { rainbow: 0b11, noFour: 0b11, maskOffset: 0 },
    ]) {
      const src = source(rules)
      expect(src).not.toContain('rbm')
      expect(src).toContain('(((3u >> rb)')
    }
  })
})
