import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation, rotationSpans } from '../util/teamOpt/rotation/parse'

const team = (entries: [CharacterKey, string][]) =>
  entries.map(([characterKey, name]) => ({ characterKey, name }))

describe('rotation text warnings', () => {
  it('names the member as written, not its first word', () => {
    const parsed = parseRotation('Hu Tao E FOO', team([['HuTao', 'Hu Tao']]))
    expect(parsed.warnings).toEqual([
      'Hu Tao: "FOO" is not an action (skipped)',
    ])
  })

  it('says once which names are not in the team', () => {
    const parsed = parseRotation(
      'Columbina E Q -> Ineffa E Q -> Bennett E -> Columbina',
      team([['Bennett', 'Bennett']])
    )
    expect(parsed.steps.map((s) => s.characterKey)).toEqual(['Bennett'])
    expect(parsed.warnings).toEqual([
      '"Columbina", "Ineffa": no team member with that name (3 steps skipped)',
    ])
  })

  it('reads full-width commas and semicolons as step breaks', () => {
    const members = team([
      ['Bennett', 'Bennett'],
      ['Xiangling', 'Xiangling'],
    ])
    const parsed = parseRotation('Bennett E Q，Xiangling Q；Bennett E', members)
    expect(parsed.warnings).toEqual([])
    expect(parsed.steps.map((s) => s.characterKey)).toEqual([
      'Bennett',
      'Xiangling',
      'Bennett',
    ])
    expect(
      rotationSpans('Bennett E，Xiangling Q', members).filter(
        (s) => s.kind === 'separator'
      )
    ).toHaveLength(1)
  })
})
