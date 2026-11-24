import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'

/** Each member's Normal Attack DMG increase with Citlali's C1 Stellar Blade switch on, `active` on field */
function normalDmgInc(active: CharacterKey) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const members: CharacterKey[] = ['Citlali', 'Mavuika', 'Bennett']
  const weapons = {
    Citlali: 'ApprenticesNotes',
    Mavuika: 'WasterGreatsword',
    Bennett: 'DullBlade',
  } as const
  for (const key of members) {
    db.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 1, skill: 1, burst: 1 },
      constellation: key === 'Citlali' ? 1 : 0,
    })
    db.weapons.new({
      key: weapons[key as keyof typeof weapons],
      level: 90,
      ascension: 6,
      refinement: 1,
      location: key,
      lock: false,
    })
  }
  const ids = members.map((key) =>
    db.teamChars.new(
      key,
      key === 'Citlali'
        ? { conditional: { Citlali: { c1BladeConsume: 'on' } } }
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
        path: ['premod', 'normal_dmgInc'],
      }).value as number,
    ])
  )
}

describe('Citlali C1: Stellar Blades', () => {
  it('add to the active member’s damage only', () => {
    const inc = normalDmgInc('Mavuika')
    expect(inc['Mavuika']).toBeGreaterThan(0)
    expect(inc['Bennett']).toBe(0)
    expect(inc['Citlali']).toBe(0)
  })
})
