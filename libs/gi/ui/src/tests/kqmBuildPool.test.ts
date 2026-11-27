import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import { teamOptMembers } from '../util/teamOpt/data'
import { databaseSnapshot } from '../util/teamOpt/kqmBuildPool'

function makeDb() {
  const db = new ArtCharDatabase(1, new SandboxStorage())
  db.chars.getWithInitWeapon('Arlecchino')
  db.chars.getWithInitWeapon('Yelan')
  db.chars.getWithInitWeapon('Bennett')
  db.chars.getWithInitWeapon('Zhongli')
  const a1 = db.arts.new({
    setKey: 'GladiatorsFinale',
    slotKey: 'flower',
    level: 20,
    rarity: 5,
    mainStatKey: 'hp',
    location: 'Arlecchino',
    lock: false,
    substats: [{ key: 'critRate_', value: 10 }],
  })
  const aUnused = db.arts.new({
    setKey: 'EmblemOfSeveredFate',
    slotKey: 'plume',
    level: 20,
    rarity: 5,
    mainStatKey: 'atk',
    location: '',
    lock: false,
    substats: [{ key: 'enerRech_', value: 15 }],
  })
  const tc1 = db.teamChars.new('Arlecchino')
  const tc2 = db.teamChars.new('Yelan')
  const tcOther1 = db.teamChars.new('Bennett')
  const tcOther2 = db.teamChars.new('Zhongli')
  const team1 = db.teams.new({
    name: 'Active Team',
    loadoutData: [{ teamCharId: tc1 }, { teamCharId: tc2 }],
  })
  const team2 = db.teams.new({
    name: 'Unrelated Huge Team',
    loadoutData: [{ teamCharId: tcOther1 }, { teamCharId: tcOther2 }],
  })
  return { db, team1, team2, a1, aUnused }
}

describe('databaseSnapshot scoping & stability', () => {
  it('excludes unrelated teams, unequipped artifacts, and saved KQM/TeamOpt run blobs', () => {
    const { db, team1, team2, a1, aUnused } = makeDb()
    db.teamKqmResults.setRun(team1, {
      savedAt: 1000,
      members: ['Arlecchino', 'Yelan'],
      run: {
        type: 'done',
        result: { builds: { Arlecchino: {} } },
        teamOpt: {},
      },
    })
    db.teamKqmResults.setRun(team2, {
      savedAt: 2000,
      members: ['Bennett', 'Zhongli'],
      run: {
        type: 'done',
        result: { builds: { Bennett: {} } },
        teamOpt: {},
      },
    })

    const snap = databaseSnapshot(db, { teamId: team1, artifacts: 'team' })
    expect(snap.entries[team1]).toBeDefined()
    expect(snap.entries[team2]).toBeUndefined()
    expect(snap.entries[a1]).toBeDefined()
    expect(snap.entries[aUnused]).toBeUndefined()
    expect(snap.entries['teamKqmResults']).toBeUndefined()
    expect(snap.entries[`teamKqmRun_${team1}`]).toBeUndefined()
    expect(snap.entries[`teamKqmRun_${team2}`]).toBeUndefined()
    expect(snap.entries['teamOptResults']).toBeUndefined()

    const copy = new ArtCharDatabase(
      snap.dbIndex,
      new SandboxStorage(snap.entries)
    )
    const origMembers = teamOptMembers(db, team1)
    const copyMembers = teamOptMembers(copy, team1)
    expect(copyMembers.map((m) => m.characterKey)).toEqual(
      origMembers.map((m) => m.characterKey)
    )
    expect(copyMembers[0].artifactIds.flower).toBe(a1)
    expect(copy.teams.keys).toEqual([team1])
  })

  it('keeps the exact same snapshot key after saving KQM runs and dbMeta.lastEdit', () => {
    const { db, team1 } = makeDb()
    const before = databaseSnapshot(db, { teamId: team1, artifacts: 'team' })

    db.teamKqmResults.setRun(team1, {
      savedAt: Date.now(),
      members: ['Arlecchino', 'Yelan'],
      run: {
        type: 'done',
        result: { builds: { Arlecchino: {} } },
        teamOpt: {},
      },
    })
    db.dbMeta.set({ lastEdit: Date.now() + 5000 })

    const after = databaseSnapshot(db, { teamId: team1, artifacts: 'team' })
    expect(after.key).toBe(before.key)
    expect(after).toBe(before)
  })

  it('includes extraArtifactIds and extraWeaponIds for inventory investment jobs', () => {
    const { db, team1, aUnused } = makeDb()
    const snap = databaseSnapshot(db, {
      teamId: team1,
      artifacts: 'team',
      extraArtifactIds: [aUnused],
    })
    expect(snap.entries[aUnused]).toBeDefined()
  })
})
