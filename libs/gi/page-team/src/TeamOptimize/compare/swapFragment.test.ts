import type { RotationMember } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { swapFragment } from './swapFragment'

const names: RotationMember[] = [
  { characterKey: 'Anastasya', name: 'Anastasya' },
  { characterKey: 'YaeMiko', name: 'Yae Miko' },
  { characterKey: 'Odette', name: 'Odette' },
  { characterKey: 'Danica', name: 'Danica' },
]
const text =
  'Danica E -> Odette E E -> Yae Miko E E E -> Danica Q -> Anastasya hE N2 Q N5 E E E N2'
const swapped =
  'Danica E -> Odette E E -> Mitya E Q -> Danica Q -> Anastasya hE N2 Q N5 E E E N2'
const base = {
  text,
  opener: '',
  names,
  out: 'YaeMiko' as const,
  inName: 'Mitya',
  fragment: 'E Q',
}

describe('swapFragment', () => {
  it('replaces the single step', () => {
    const r = swapFragment(base)
    expect(r).toMatchObject({
      ok: true,
      text: swapped,
      replaced: 'Yae Miko E E E',
      where: 'text',
    })
  })
  it('matches nicknames', () => {
    const r = swapFragment({ ...base, text: text.replace('Yae Miko', 'Yae') })
    expect(r).toMatchObject({
      ok: true,
      text: swapped,
      replaced: 'Yae E E E',
    })
  })
  it('notFound', () => {
    expect(swapFragment({ ...base, out: 'Mitya' as never })).toEqual({
      ok: false,
      error: 'notFound',
      count: 0,
    })
  })
  it('repeated in the text', () => {
    const r = swapFragment({ ...base, text: `${text} -> Yae Miko E` })
    expect(r).toEqual({ ok: false, error: 'repeated', count: 2 })
  })
  it('repeated across opener and text', () => {
    const r = swapFragment({ ...base, opener: 'Yae Miko E -> Danica E' })
    expect(r).toEqual({ ok: false, error: 'repeated', count: 2 })
  })
  it('opener only', () => {
    const noYae = 'Danica E -> Odette E E -> Danica Q'
    const r = swapFragment({
      ...base,
      text: noYae,
      opener: 'Yae Miko E -> Danica E',
    })
    expect(r).toMatchObject({
      ok: true,
      where: 'opener',
      opener: 'Mitya E Q -> Danica E',
      text: noYae,
    })
  })
  it('emptyFragment', () => {
    expect(swapFragment({ ...base, fragment: '  ' })).toMatchObject({
      ok: false,
      error: 'emptyFragment',
    })
  })
  it('cuts at arrows other than ->', () => {
    const r = swapFragment({
      ...base,
      text: 'Danica E → Yae Miko E E E => Odette E',
    })
    expect(r).toMatchObject({
      ok: true,
      text: 'Danica E → Mitya E Q => Odette E',
      replaced: 'Yae Miko E E E',
    })
  })
  it('does not touch a neighbour sharing an arrow-free piece', () => {
    const r = swapFragment({
      ...base,
      text: 'Danica E → Yae Miko E E E',
      out: 'Danica',
    })
    expect(r).toMatchObject({ ok: true, text: 'Mitya E Q → Yae Miko E E E' })
  })
  it('cuts at newlines, commas and semicolons', () => {
    const r = swapFragment({
      ...base,
      text: 'Danica E\nYae Miko E E E, Odette E; Danica Q',
    })
    expect(r).toMatchObject({
      ok: true,
      text: 'Danica E\nMitya E Q, Odette E; Danica Q',
    })
  })
  it('cuts at bare member names', () => {
    const r = swapFragment({ ...base, text: 'Yae E Danica Q' })
    expect(r).toMatchObject({
      ok: true,
      text: 'Mitya E Q Danica Q',
      replaced: 'Yae E',
    })
    const d = swapFragment({ ...base, text: 'Yae E Danica Q', out: 'Danica' })
    expect(d).toMatchObject({ ok: true, text: 'Yae E Mitya E Q' })
  })
  it('counts a second step of the same member inside a piece', () => {
    const r = swapFragment({
      ...base,
      text: 'Danica E Yae Miko E Odette E Yae Miko Q',
    })
    expect(r).toEqual({ ok: false, error: 'repeated', count: 2 })
  })
  it('rewrites a trailing loop marker without counting it', () => {
    expect(
      swapFragment({ ...base, text: `${text} -> Yae Miko` })
    ).toMatchObject({
      ok: true,
      text: `${swapped} -> Mitya`,
    })
    const r = swapFragment({
      ...base,
      text: 'Danica E -> Odette E -> Yae',
      opener: 'Yae Miko E -> Danica E -> Yae',
    })
    expect(r).toMatchObject({
      ok: true,
      where: 'opener',
      opener: 'Mitya E Q -> Danica E -> Mitya',
      text: 'Danica E -> Odette E -> Mitya',
    })
  })
  it('a loop marker alone is notFound', () => {
    expect(
      swapFragment({ ...base, text: 'Danica E -> Odette E -> Yae' })
    ).toEqual({ ok: false, error: 'notFound', count: 0 })
  })
})
