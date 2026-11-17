/**
 * A written rotation gives a member one attack per group of hits with the same buffs: a long one
 * needs well over 40 (at 40, saving the team dropped the hits past its 40th group).
 */
import {
  initTeamOpt,
  TEAM_OPT_MAX_ATTACKS,
  validateTeamOpt,
} from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'

describe('Team optimize attacks per member', () => {
  it('keeps a written rotation’s 100+ attacks when saved', () => {
    const attacks = Array.from({ length: 120 }, (_, i) => ({
      path: ['skill', `hit${i}`],
      hits: 1,
    }))
    const saved = validateTeamOpt({
      ...initTeamOpt(),
      attacks: { Emilie: attacks },
    })
    expect(saved.attacks.Emilie).toHaveLength(120)
    expect(TEAM_OPT_MAX_ATTACKS).toBeGreaterThanOrEqual(400)
  })
})
