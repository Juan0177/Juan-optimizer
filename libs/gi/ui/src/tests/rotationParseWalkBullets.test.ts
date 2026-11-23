import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const parse = (text: string, who: CharacterKey[]) =>
  parseRotation(
    text,
    who.map((characterKey) => ({ characterKey, name: characterKey }))
  )

describe('walks (WK, gcsim walk)', () => {
  it('reads WK (1 frame), WK11f, WK0.5 and walks in repeats; W stays a wait', () => {
    const r = parse('Tartaglia WK Q WK11f E WK0.5 2[WK E] W4f', ['Tartaglia'])
    expect(r.warnings).toEqual([])
    expect(
      r.steps[0].actions.map((a) => [
        a.kind,
        a.kind === 'wait' ? Math.round((a.count ?? 0) * 60) : undefined,
        !!a.walk,
      ])
    ).toEqual([
      ['wait', 1, true],
      ['burst', undefined, false],
      ['wait', 11, true],
      ['skill', undefined, false],
      ['wait', 30, true],
      ['wait', 1, true],
      ['skill', undefined, false],
      ['wait', 1, true],
      ['skill', undefined, false],
      ['wait', 4, false],
    ])
  })

  it('ends the Normal Attack string at a walk, not at idle time', () => {
    const normals = (text: string) =>
      simulateRotation({
        rotation: parse(text, ['Bennett']),
        members: ['Bennett'],
        elements: { Bennett: 'pyro' },
        constellations: {},
        repeats: 1,
        keep: 'all',
        reactions: { onHit() {} },
      })
        .hits.filter((h) => h.tag === 'normal')
        .map((h) => h.label)
    expect(normals('Bennett N2 WK N2')).toEqual(['N1', 'N2', 'N1', 'N2'])
    expect(normals('Bennett N2 W4f N2')).toEqual(['N1', 'N2', 'N3', 'N4'])
  })
})

describe('a string carrying on (N3-4)', () => {
  const normals = (text: string) =>
    simulateRotation({
      rotation: parse(text, ['Bennett']),
      members: ['Bennett'],
      elements: { Bennett: 'pyro' },
      constellations: {},
      repeats: 1,
      keep: 'all',
      reactions: { onHit() {} },
    })
      .hits.filter((h) => h.tag === 'normal')
      .map((h) => h.label)
  it('plays the hits it names, whatever came before; Nn still starts over after a Skill', () => {
    expect(normals('Bennett N2 E N3-4')).toEqual(['N1', 'N2', 'N3', 'N4'])
    expect(normals('Bennett N2 E N2')).toEqual(['N1', 'N2', 'N1', 'N2'])
    expect(normals('Bennett N2-3 N2')).toEqual(['N2', 'N3', 'N4', 'N5'])
    const r = parse('Bennett N3-4 N4-3', ['Bennett'])
    expect(r.steps[0].actions.map((a) => [a.count, a.from])).toEqual([[2, 3]])
    expect(r.warnings.join(' ')).toContain('runs forward')
  })
})

describe("Chasca's bullets (CA[bullets=N], gcsim aim[bullets=N])", () => {
  const charged = (text: string, who: CharacterKey[] = ['Chasca']) => {
    const r = parse(text, who)
    return {
      bullets: r.steps[0].actions
        .filter((a) => a.kind === 'charged')
        .map((a) => a.bullets),
      warnings: r.warnings,
    }
  }
  it('reads the bullet count, in repeats too', () => {
    expect(charged('Chasca E 4[CA] CA[bullets=4] 2[CA[bullets=2]]')).toEqual({
      bullets: [undefined, undefined, undefined, undefined, 4, 2, 2],
      warnings: [],
    })
  })
  it('warns and plays a plain Charged Attack out of range or for anyone else', () => {
    const out = charged('Chasca CA[bullets=7] CA[bullets=0]')
    expect(out.bullets).toEqual([undefined, undefined])
    expect(out.warnings).toHaveLength(2)
    const other = charged('Sandrone CA[bullets=4]', ['Sandrone'])
    expect(other.bullets).toEqual([undefined])
    expect(other.warnings.join(' ')).toContain("only Chasca's")
  })
  it("leaves Sandrone's beams as they were", () => {
    const r = parse('Sandrone CA[beams=2]', ['Sandrone'])
    expect(r.steps[0].actions[0].beams).toBe(2)
    expect(r.warnings).toEqual([])
  })
})
