import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase, type LoadoutDatum } from '@genshin-optimizer/gi/db'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { input } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'

describe("KQM never takes a member's own weapon and set switches", () => {
  it("drops the member's own gear switches and bonus stats with ownBuild off", () => {
    const db = new ArtCharDatabase(1, new SandboxStorage({}))
    for (const key of ['Diluc', 'Bennett'] as const)
      db.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
    db.weapons.new({
      key: 'WolfsGravestone',
      level: 90,
      ascension: 6,
      refinement: 1,
      location: 'Diluc',
      lock: false,
    })
    db.weapons.new({
      key: 'DullBlade',
      level: 90,
      ascension: 6,
      refinement: 1,
      location: 'Bennett',
      lock: false,
    })
    const dId = db.teamChars.new('Diluc', {
      conditional: { WolfsGravestone: { WolfishTracker: 'on' } },
      bonusStats: { critRate_: 10 },
    })
    const bId = db.teamChars.new('Bennett', {})
    const teamId = db.teams.new({
      loadoutData: [{ teamCharId: dId }, { teamCharId: bId }] as LoadoutDatum[],
    })
    const atk = (ownBuild: boolean, kqm?: string) =>
      uiDataForTeam(
        getTeamDataWith(db, teamId, {
          ownBuild,
          ...(kqm !== undefined
            ? {
                conditionalOverrides: {
                  Diluc: { WolfsGravestone: { WolfishTracker: kqm } },
                },
              }
            : {}),
        })! as never,
        'F',
        'Diluc'
      ).Bennett!.target.get(input.total.atk_).value
    const off = atk(false)
    expect(atk(true) - off).toBeCloseTo(0.4, 6)
    // (nor its own bonus stats)
    const crit = (ownBuild: boolean) =>
      uiDataForTeam(
        getTeamDataWith(db, teamId, { ownBuild })! as never,
        'F',
        'Diluc'
      ).Diluc!.target.get(input.total.critRate_).value
    expect(crit(true) - crit(false)).toBeCloseTo(0.1, 6)
    // (KQM's own enemy instead of the team's)
    const pyroRes = (enemy?: Record<string, number>) =>
      uiDataForTeam(
        getTeamDataWith(db, teamId, { ownBuild: false, enemy })! as never,
        'F',
        'Diluc'
      ).Diluc!.target.get(input.enemy.pyro_res_).value
    expect(pyroRes()).toBeCloseTo(0.1, 6)
    expect(pyroRes({ pyro_enemyRes_: 50, enemyLevel: 100 })).toBeCloseTo(0.5, 6)
    // (KQM's own switch still counts)
    expect(atk(false, 'on') - off).toBeCloseTo(0.4, 6)
    expect(atk(true, '') - off).toBeCloseTo(0, 6)
  })
})
