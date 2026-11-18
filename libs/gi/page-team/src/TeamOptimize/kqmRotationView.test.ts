/** The KQM tab's own rotation: read, changed and set up apart from Team optimize's */
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  kqmRotationSetUp,
  kqmRotationUpdate,
  kqmRotationView,
  kqmRunKey,
} from './useTeamOpt'

const attack = (hits: number) => ({ hits }) as never
const own = (): TeamOpt => ({
  ...initTeamOpt(),
  attacks: { Zibai: [attack(1)] },
  rotationTime: 20,
})

describe('the KQM tab’s rotation', () => {
  it('starts as a copy of Team optimize’s, then is its own', () => {
    const teamOpt = own()
    kqmRotationSetUp(teamOpt)
    expect(teamOpt.kqm?.attacks).toEqual({ Zibai: [attack(1)] })
    expect(teamOpt.kqm?.rotationTime).toBe(20)
    const next = kqmRotationUpdate((o) => {
      o.attacks.Zibai = [attack(5)]
      o.rotationTime = 18.3
    })(structuredClone(teamOpt)) as TeamOpt
    // KQM's changed, Team optimize's left alone
    expect(next.attacks).toEqual({ Zibai: [attack(1)] })
    expect(next.rotationTime).toBe(20)
    expect(kqmRotationView(next).attacks).toEqual({ Zibai: [attack(5)] })
    expect(kqmRotationView(next).rotationTime).toBe(18.3)
  })
  it("keeps its own on-field member, and the run key ignores the rotation's copy", () => {
    const teamOpt = own()
    kqmRotationSetUp(teamOpt)
    const next = kqmRotationUpdate((o) => {
      o.onField = 'Zibai'
    })(structuredClone(teamOpt)) as TeamOpt
    expect(next.onField).toBe(teamOpt.onField)
    expect(kqmRotationView(next).onField).toBe('Zibai')
    const view = kqmRotationView(next)
    expect(kqmRunKey(view)).toBe(
      kqmRunKey({ ...view, kqm: { ...view.kqm!, attacks: {} } })
    )
  })
})
