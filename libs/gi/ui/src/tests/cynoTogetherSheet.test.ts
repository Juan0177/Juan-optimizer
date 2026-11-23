import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'

/** Each member's Elemental Mastery with Cyno's Together We Rise set to `together`, `active` on field */
function eleMas(together: string, active: CharacterKey) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const members: CharacterKey[] = ['Cyno', 'Fischl', 'Bennett']
  for (const key of members)
    db.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 1, skill: 1, burst: 1 },
      constellation: key === 'Cyno' ? 1 : 0,
    })
  const ids = members.map((key) =>
    db.teamChars.new(
      key,
      key === 'Cyno'
        ? {
            conditional: {
              Cyno: {
                lockRevelation: 'on',
                lockStellarRadianceSc: 'on',
                c1Together: together,
              },
            },
          }
        : {}
    )
  )
  const teamId = db.teams.new({
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
  })
  const data = getTeamDataWith(db, teamId, {})!
  const ui = uiDataForTeam(data as never, 'F', active)
  return Object.fromEntries(
    members.map((m) => [
      m,
      (ui[m]!.target as any).get({
        operation: 'read',
        path: ['premod', 'eleMas'],
      }).value as number,
    ])
  )
}

describe('Cyno C1 (Revelation): Together We Rise', () => {
  it('gives its holder 200 EM, on the field or not, and nobody else', () => {
    const none = eleMas('', 'Bennett')
    const fischl = eleMas('Fischl', 'Bennett')
    expect(fischl.Fischl - none.Fischl).toBeCloseTo(200)
    expect(fischl.Bennett - none.Bennett).toBeCloseTo(0)
    expect(fischl.Cyno - none.Cyno).toBeCloseTo(0)
  })
  it('set on by hand: the active member’s', () => {
    const none = eleMas('', 'Bennett')
    const on = eleMas('on', 'Bennett')
    expect(on.Bennett - none.Bennett).toBeCloseTo(200)
    expect(on.Fischl - none.Fischl).toBeCloseTo(0)
  })
})
