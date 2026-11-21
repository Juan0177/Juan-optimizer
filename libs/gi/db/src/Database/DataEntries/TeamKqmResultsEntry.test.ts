import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '../ArtCharDatabase'
import { initTeamOpt } from '../DataManagers/TeamOpt'
import type { TeamKqmSavedRun } from './TeamKqmResultsEntry'
import { runStorageKey, TEAM_KQM_RUNS_KEPT } from './TeamKqmResultsEntry'

const saved = (savedAt = 1_700_000_000_000): TeamKqmSavedRun => ({
  savedAt,
  members: ['Columbina', 'Sucrose', 'Ineffa', 'Flins'],
  run: {
    type: 'done',
    seconds: 41.2,
    teamOpt: { ...initTeamOpt(), rotationTime: 21 },
    rotation: 'played',
    result: {
      builds: { Flins: { weapon: { key: 'BloodsoakedRuins' } } },
      rankings: { Flins: { weapons: [], sets: [] } },
      after: { total: 2 },
    },
  },
})

describe('database.teamKqmResults (last KQM theorycrafting runs)', () => {
  it('keeps a team’s run across a reload of the database', () => {
    const storage = new SandboxStorage()
    new ArtCharDatabase(1, storage).teamKqmResults.setRun('team_1', saved())
    const run = new ArtCharDatabase(1, storage).teamKqmResults.getRun('team_1')
    expect(run).toEqual(JSON.parse(JSON.stringify(saved())))
    // a copy the page may change: the database keeps its own
    expect(Object.isFrozen(run?.run.result)).toBe(false)
  })

  it('forgets a team’s run, and only that one', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    database.teamKqmResults.setRun('team_1', saved())
    database.teamKqmResults.setRun('team_2', saved())
    database.teamKqmResults.setRun('team_1', undefined)
    expect(Object.keys(database.teamKqmResults.get().runs)).toEqual(['team_2'])
  })

  it('keeps only the most recent teams’ runs', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    for (let i = 1; i <= TEAM_KQM_RUNS_KEPT + 2; i++)
      database.teamKqmResults.setRun(`team_${i}`, saved(i))
    const kept = Object.keys(database.teamKqmResults.get().runs).sort()
    expect(kept).toHaveLength(TEAM_KQM_RUNS_KEPT)
    expect(kept).not.toContain('team_1')
    expect(kept).not.toContain('team_2')
    expect(kept).toContain(`team_${TEAM_KQM_RUNS_KEPT + 2}`)
  })

  it('makes room when the browser’s storage is full, and never throws', () => {
    const storage = new SandboxStorage()
    const database = new ArtCharDatabase(1, storage)
    database.teamKqmResults.setRun('team_1', saved(1))
    database.teamKqmResults.setRun('team_2', saved(2))
    // a storage with room for two runs (as a full localStorage would)
    const setString = storage.setString.bind(storage)
    storage.setString = (key: string, value: string) => {
      const others = storage.keys.filter(
        (k) => k.startsWith(runStorageKey('')) && k !== key
      )
      if (key.startsWith(runStorageKey('')) && others.length >= 2)
        throw new DOMException('full', 'QuotaExceededError')
      setString(key, value)
    }
    expect(() =>
      database.teamKqmResults.setRun('team_3', saved(3))
    ).not.toThrow()
    const reloaded = new ArtCharDatabase(1, storage).teamKqmResults
    expect(Object.keys(reloaded.get().runs).sort()).toEqual([
      'team_2',
      'team_3',
    ])
    expect(reloaded.getRun('team_3')).toEqual(
      JSON.parse(JSON.stringify(saved(3)))
    )
    expect(storage.getString(runStorageKey('team_1'))).toBeUndefined()
  })

  it('writes only the saved run: the others stay as they are', () => {
    const storage = new SandboxStorage()
    const database = new ArtCharDatabase(1, storage)
    database.teamKqmResults.setRun('team_1', saved(1))
    const written: string[] = []
    const setString = storage.setString.bind(storage)
    storage.setString = (key: string, value: string) => {
      written.push(key)
      setString(key, value)
    }
    database.teamKqmResults.setRun('team_2', saved(2))
    expect(written).toContain(runStorageKey('team_2'))
    expect(written).not.toContain(runStorageKey('team_1'))
    expect((storage.getString('teamKqmResults') ?? '').length).toBeLessThan(400)
  })

  it('moves its runs along with the database to another storage', () => {
    const first = new ArtCharDatabase(1, new SandboxStorage())
    const second = new ArtCharDatabase(2, new SandboxStorage())
    first.teamKqmResults.setRun('team_1', saved(1))
    second.teamKqmResults.setRun('team_9', saved(9))
    first.swapStorage(second)
    const reloadedFirst = new ArtCharDatabase(1, first.storage).teamKqmResults
    const reloadedSecond = new ArtCharDatabase(2, second.storage).teamKqmResults
    expect(reloadedFirst.getRun('team_1')).toEqual(
      JSON.parse(JSON.stringify(saved(1)))
    )
    expect(reloadedFirst.getRun('team_9')).toBeUndefined()
    expect(reloadedSecond.getRun('team_9')).toEqual(
      JSON.parse(JSON.stringify(saved(9)))
    )
    expect(first.storage.getString(runStorageKey('team_9'))).toBeUndefined()
  })

  it('forgets every run when the database is cleared', () => {
    const storage = new SandboxStorage()
    const database = new ArtCharDatabase(1, storage)
    database.teamKqmResults.setRun('team_1', saved(1))
    database.clear()
    expect(database.teamKqmResults.getRun('team_1')).toBeUndefined()
    expect(storage.getString(runStorageKey('team_1'))).toBeUndefined()
  })

  it('drops runs whose settings no longer validate', () => {
    const storage = new SandboxStorage()
    const database = new ArtCharDatabase(1, storage)
    database.teamKqmResults.setRun('team_1', saved())
    // (the storage keeps each run packed under its own key: its settings are in `data`)
    const raw = storage.get(runStorageKey('team_1')) as {
      data: Record<string, unknown>
    }
    raw.data['teamOpt'] = 'not settings'
    storage.set(runStorageKey('team_1'), raw)
    expect(
      new ArtCharDatabase(1, storage).teamKqmResults.getRun('team_1')
    ).toBeUndefined()
  })

  it('removes a stored run its index no longer lists', () => {
    const storage = new SandboxStorage()
    new ArtCharDatabase(1, storage).teamKqmResults.setRun('team_1', saved())
    storage.setString(runStorageKey('team_7'), '{}')
    new ArtCharDatabase(1, storage)
    expect(storage.getString(runStorageKey('team_7'))).toBeUndefined()
    expect(storage.getString(runStorageKey('team_1'))).toBeDefined()
  })

  it('is never part of a GOOD export or import', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    database.teamKqmResults.setRun('team_1', saved())
    const good = database.exportGOOD() as Record<string, unknown>
    expect(good['teamKqmResults']).toBeUndefined()
  })
})

describe('saved KQM runs are packed for the storage', () => {
  /** A run that played a written rotation: every attack with every buff's state, twice */
  const played = () => {
    const states = (i: number) =>
      Array.from({ length: 40 }, (_, b) => ({
        owner: b % 2 ? 'Mitya' : 'team',
        path: ['Mitya', `buff${b}`],
        value: (i + b) % 3 ? 'on' : `${b % 5}`,
      }))
    const attacks = {
      Mitya: Array.from({ length: 120 }, (_, i) => ({
        path: ['skill', `hit${i % 7}`],
        hits: 0.5,
        hitMode: 'avgHit',
        states: states(i),
        limits: [{ owner: 'Mitya', path: ['Mitya', 'buff3'], hits: 0 }],
      })),
    }
    return {
      savedAt: 1_700_000_000_000,
      members: ['Mitya'],
      run: {
        type: 'done',
        seconds: 12,
        teamOpt: initTeamOpt(),
        runTeamOpt: { ...initTeamOpt(), attacks, rotationTime: 18.4 },
        result: {
          builds: { Mitya: { weapon: { key: 'ClashOfKings', refinement: 1 } } },
          played: { attacks, rotationTime: 18.4 },
        },
      },
    }
  }
  it('comes back exactly as an unpacked run does, at a fraction of the size', () => {
    const saved = JSON.parse(JSON.stringify(played()))
    // as an older version saved it (not packed): what loading it gives is the reference
    const legacy = new SandboxStorage()
    legacy.set('teamKqmResults', { runs: { team_1: saved } })
    const reference = new ArtCharDatabase(1, legacy).teamKqmResults.getRun(
      'team_1'
    )!
    // (the result is kept as it is: every attack's states and limits, exactly)
    expect(reference.run.result).toEqual(saved.run.result)
    // loading it moved it, packed, to its own key
    const stored = legacy.get(runStorageKey('team_1')) as { $packed?: number }
    expect(stored.$packed).toBe(1)
    expect(JSON.stringify(stored).length).toBeLessThan(
      JSON.stringify(saved).length / 10
    )
    expect(legacy.get('teamKqmResults')).toEqual({
      runs: { team_1: { savedAt: saved.savedAt, members: saved.members } },
    })
    // and the packed run reads back the same, again and again
    const again = new ArtCharDatabase(1, legacy).teamKqmResults.getRun('team_1')
    expect(again).toEqual(reference)
    const fresh = new SandboxStorage()
    new ArtCharDatabase(1, fresh).teamKqmResults.setRun('team_1', reference)
    expect(
      new ArtCharDatabase(1, fresh).teamKqmResults.getRun('team_1')
    ).toEqual(reference)
  })
})

describe('database.teamKqmResults summaries (KQM versions)', () => {
  const summary = (total: number) => ({
    savedAt: 1_700_000_000_000,
    members: ['Sandrone', 'Anastasya', 'Odette', 'Mitya'],
    total,
    memberTotals: { Sandrone: total / 2, Anastasya: total / 2 },
    rotationTime: 20.5,
    gear: {
      Sandrone: {
        weapon: 'TheCatch',
        refinement: 5,
        sets: { GladiatorsFinale: 4 },
      },
    },
    settings: '{}',
    rotation: 'Sandrone E',
  })
  it('keeps every team’s summary across reloads, apart from the runs kept', () => {
    const storage = new SandboxStorage()
    const database = new ArtCharDatabase(1, storage)
    for (let i = 0; i < TEAM_KQM_RUNS_KEPT + 3; i++) {
      database.teamKqmResults.setRun(`team_${i}`, saved(1_700_000_000_000 + i))
      database.teamKqmResults.setSummary(`team_${i}`, summary(1000 + i))
    }
    const reloaded = new ArtCharDatabase(1, storage).teamKqmResults
    expect(Object.keys(reloaded.get().runs)).toHaveLength(TEAM_KQM_RUNS_KEPT)
    for (let i = 0; i < TEAM_KQM_RUNS_KEPT + 3; i++)
      expect(reloaded.getSummary(`team_${i}`)).toEqual(summary(1000 + i))
  })
  it('forgets one, drops invalid ones, and goes with its team', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    database.teamKqmResults.setSummary('team_1', summary(1))
    database.teamKqmResults.setSummary('team_2', summary(2))
    database.teamKqmResults.setSummary('team_1', undefined)
    expect(database.teamKqmResults.getSummary('team_1')).toBeUndefined()
    database.teamKqmResults.setSummary('team_3', {
      ...summary(3),
      total: Number.NaN,
    })
    expect(database.teamKqmResults.getSummary('team_3')).toBeUndefined()
    expect(database.teamKqmResults.getSummary('team_2')).toEqual(summary(2))
    const teamId = database.teams.new({})
    database.teamKqmResults.setSummary(teamId, summary(4))
    database.teams.remove(teamId)
    expect(database.teamKqmResults.getSummary(teamId)).toBeUndefined()
  })
})
