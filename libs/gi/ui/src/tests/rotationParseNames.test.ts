import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'

const team = (names: Record<string, string>) =>
  Object.entries(names).map(([characterKey, name]) => ({
    characterKey: characterKey as CharacterKey,
    name,
  }))
const russian = team({
  Ineffa: 'Инеффа',
  Columbina: 'Коломбина',
  Sucrose: 'Сахароза',
  Flins: 'Флинс',
})
const steps = (text: string, members = russian) => {
  const r = parseRotation(text, members)
  return {
    steps: r.steps.map(
      (s) => `${s.characterKey} ${s.actions.map((a) => a.text).join(' ')}`
    ),
    warnings: r.warnings,
  }
}

describe('rotation names in any language', () => {
  it('matches Cyrillic names (as the Russian UI shows them)', () => {
    expect(
      steps('Инеффа Q E -> Коломбина E Q -> Сахароза E -> Флинс E')
    ).toEqual({
      steps: ['Ineffa Q E', 'Columbina E Q', 'Sucrose E', 'Flins E'],
      warnings: [],
    })
  })
  it('splits a rotation written without arrows at each member name', () => {
    // as reported: "Инеффа Q E Коломбина E Q Сахароза E Флинс E E Q N3 N3 E Q N3 Сахароза E"
    expect(
      steps(
        'Инеффа Q E Коломбина E Q Сахароза E Флинс E E Q N3 N3 E Q N3 Сахароза E'
      ).steps
    ).toEqual([
      'Ineffa Q E',
      'Columbina E Q',
      'Sucrose E',
      'Flins E E Q N3 N3 E Q N3',
      'Sucrose E',
    ])
    const en = team({ Ineffa: 'Ineffa', Columbina: 'Columbina' })
    expect(steps('Ineffa Q E Columbina E Q', en).steps).toEqual([
      'Ineffa Q E',
      'Columbina E Q',
    ])
  })
  it('ignores case and accents, and matches a name start in any script', () => {
    expect(steps('инеффа Q -> КОЛОМБ E').steps).toEqual([
      'Ineffa Q',
      'Columbina E',
    ])
    const accented = team({ Ineffa: 'Ïneffa' })
    expect(steps('ineffa E', accented).steps).toEqual(['Ineffa E'])
  })
  it('keeps a several-word name whole and never splits inside a note', () => {
    const kazuha = team({
      KaedeharaKazuha: 'Kaedehara Kazuha',
      Bennett: 'Bennett',
    })
    expect(steps('Kaedehara Kazuha E Q Bennett E', kazuha).steps).toEqual([
      'KaedeharaKazuha E Q',
      'Bennett E',
    ])
    expect(
      steps('Bennett E (before Kaedehara Kazuha) Q', kazuha).steps
    ).toEqual(['Bennett E Q'])
  })
  it('matches CJK names', () => {
    const cjk = team({ Ineffa: '伊涅芙', Flins: '菲林斯' })
    expect(steps('伊涅芙 Q E 菲林斯 E Q', cjk).steps).toEqual([
      'Ineffa Q E',
      'Flins E Q',
    ])
  })
})
