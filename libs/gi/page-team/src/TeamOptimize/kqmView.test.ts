import { initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  kqmRotationSetUp,
  kqmRotationUpdate,
  kqmRotationView,
} from './useTeamOpt'

describe("the KQM tab's own settings", () => {
  it('keeps its own rotation length, extra buffs and on-field member apart from Team optimize', () => {
    const teamOpt = initTeamOpt()
    teamOpt.onField = 'Bennett'
    teamOpt.rotationTime = 18
    teamOpt.bonusStats = { team: { atk: 100 } }
    kqmRotationSetUp(teamOpt)
    // (set up: its rotation, length and on-field member copied once, no extra buffs)
    const view = kqmRotationView(teamOpt)
    expect(view.onField).toBe('Bennett')
    expect(view.rotationTime).toBe(18)
    expect(view.bonusStats).toBeUndefined()
    const next = kqmRotationUpdate((o) => {
      o.bonusStats = { team: { atk_: 20 } }
      o.onField = 'Diluc'
      o.rotationTime = 21
    })(structuredClone(teamOpt))!
    expect(next.bonusStats).toEqual({ team: { atk: 100 } })
    expect(next.onField).toBe('Bennett')
    expect(next.rotationTime).toBe(18)
    expect(kqmRotationView(next)).toMatchObject({
      bonusStats: { team: { atk_: 20 } },
      onField: 'Diluc',
      rotationTime: 21,
    })
    // (Team optimize's changes stay out of the KQM tab)
    next.bonusStats = { team: { hp: 1 } }
    next.onField = 'Xiangling'
    expect(kqmRotationView(next)).toMatchObject({
      bonusStats: { team: { atk_: 20 } },
      onField: 'Diluc',
    })
  })
})
