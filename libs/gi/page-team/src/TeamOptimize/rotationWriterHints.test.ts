import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TFunction } from 'i18next'
import { describe, expect, it } from 'vitest'
import { teamQuickTokens, teamSyntaxRows } from './rotationWriterHints'

const t = ((
  _key: string,
  opts?: string | { defaultValue?: string; [k: string]: unknown }
) => {
  if (typeof opts === 'string') return opts
  let out = opts?.defaultValue ?? ''
  for (const [k, v] of Object.entries(opts ?? {}))
    if (k !== 'defaultValue') out = out.replaceAll(`{{${k}}}`, String(v))
  return out
}) as unknown as TFunction

const makeTeam = (keys: CharacterKey[]) => ({
  members: keys.map((characterKey) => ({ characterKey })),
  names: keys.map((characterKey) => ({ characterKey, name: characterKey })),
})

describe('rotationWriterHints', () => {
  it('omits entry, plunge, and unrelated kit tips on a standard team', () => {
    const { members, names } = makeTeam([
      'KamisatoAyaka',
      'Furina',
      'Xingqiu',
      'Yelan',
    ])
    const tokens = teamQuickTokens(members, names, t)
    const texts = tokens.map((tok) => tok.text)

    expect(texts).not.toContain('entry')
    expect(texts).not.toContain('P')
    expect(texts).not.toContain('hE')
    expect(texts).not.toContain('CA[beams=2]')
    expect(texts).not.toContain('CA[cancel]')
    expect(texts).not.toContain('C3F')
    expect(tokens.find((tok) => tok.text === 'CA')?.label).toBe(
      'Charged Attack'
    )

    const { teamRows, generalRows } = teamSyntaxRows(members, names, t)
    expect(teamRows).toEqual([])
    expect(generalRows[0].code).toBe('KamisatoAyaka E Q')
    expect(generalRows.some((r) => r.meaning.includes('Beidou'))).toBe(false)
    expect(generalRows.some((r) => r.meaning.includes('Sandrone'))).toBe(false)
  })

  it('includes kit-specific chips and syntax rows only for characters in the team', () => {
    const { members, names } = makeTeam([
      'Arlecchino',
      'Iansan',
      'KaedeharaKazuha',
      'Bennett',
    ])
    const tokens = teamQuickTokens(members, names, t)
    const texts = tokens.map((tok) => tok.text)

    expect(texts).toContain('hE')
    expect(texts).toContain('P')
    expect(texts).toContain('CA[cancel]')
    expect(texts).toContain('N3[movement=4]')
    expect(texts).not.toContain('entry')
    expect(texts).not.toContain('C3F')
    expect(texts).not.toContain('CA[beams=2]')
    expect(tokens.find((tok) => tok.text === 'CA')?.label).toContain(
      'Arlecchino'
    )
    expect(tokens.find((tok) => tok.text === 'CA')?.label).not.toContain(
      'Mavuika'
    )

    const { teamRows } = teamSyntaxRows(members, names, t)
    const codes = teamRows.map((r) => r.code)
    expect(codes).toContain('hE')
    expect(codes).toContain('HP · LP')
    expect(codes).toContain('CA[cancel]')
    expect(codes).toContain('N3[movement=4]')
    expect(codes).not.toContain('entry')
    expect(codes).not.toContain('C3F · C2D')
  })

  it('includes entry chip and names teammates dynamically for kits with onSwapIn', () => {
    const { members, names } = makeTeam([
      'YumemizukiMizuki',
      'Furina',
      'Fischl',
      'Xingqiu',
    ])
    const tokens = teamQuickTokens(members, names, t)
    const entry = tokens.find((tok) => tok.text === 'entry')
    expect(entry).toBeDefined()
    expect(entry?.label).toContain('YumemizukiMizuki')

    const { teamRows } = teamSyntaxRows(members, names, t)
    expect(teamRows.some((r) => r.code === 'entry')).toBe(true)
  })
})
