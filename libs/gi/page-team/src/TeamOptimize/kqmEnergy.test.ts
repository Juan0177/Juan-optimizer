import { defaultTeamOptKqm, initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import { kqmEnergyUpdate } from './kqmEnergy'

/**
 * A user request: Automatic and Manual ER are a choice. Manual, chosen, stays Manual: a rotation
 * written or changed later never puts the calculator's targets over the ones typed.
 */
describe('KQM ER: Manual stays Manual', () => {
  it('a new rotation leaves Manual targets alone', () => {
    const teamOpt = {
      ...initTeamOpt(),
      kqm: {
        ...defaultTeamOptKqm,
        energySource: 'manual' as const,
        energyRecharge: { Bennett: 180 },
        energyRotation: 'an older rotation',
      },
    }
    for (const written of ['an older rotation', 'a new rotation', ''])
      expect(
        kqmEnergyUpdate({
          members: [],
          teamOpt,
          written,
          ready: !!written,
        })
      ).toBeUndefined()
  })
})
