import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'

/** Arlecchino's Normal Attack DMG increase at the sheet's Bond of Life state `bondPercent` */
function normalDmgInc(bondPercent: string, constellation: number) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set('Arlecchino', {
    key: 'Arlecchino',
    level: 90,
    ascension: 6,
    talent: { auto: 10, skill: 1, burst: 1 },
    constellation,
  })
  db.weapons.new({
    key: 'WhiteTassel',
    level: 90,
    ascension: 6,
    refinement: 1,
    location: 'Arlecchino',
    lock: false,
  })
  const teamCharId = db.teamChars.new('Arlecchino', {
    conditional: { Arlecchino: { bondPercent } },
  })
  const teamId = db.teams.new({
    loadoutData: [{ teamCharId }] as LoadoutDatum[],
  })
  const data = getTeamDataWith(db, teamId, {})!
  const ui = uiDataForTeam(data as never, 'F', 'Arlecchino')
  return (ui.Arlecchino!.target as any).get({
    operation: 'read',
    path: ['premod', 'normal_dmgInc'],
  }).value as number
}

describe('Arlecchino: Masque of the Red Death', () => {
  it('adds Normal Attack DMG only from 30% Bond of Life, C1’s increase too', () => {
    for (const cons of [0, 1]) {
      expect(normalDmgInc('25', cons)).toBe(0)
      expect(normalDmgInc('30', cons)).toBeGreaterThan(0)
    }
    expect(normalDmgInc('30', 1)).toBeGreaterThan(normalDmgInc('30', 0))
  })
})
