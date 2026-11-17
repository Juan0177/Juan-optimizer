import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '../ArtCharDatabase'
import { initTeamOpt } from '../DataManagers/TeamOpt'
import type { TeamKqmSavedRun } from './TeamKqmResultsEntry'
import { TEAM_KQM_RUNS_KEPT } from './TeamKqmResultsEntry'

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
    // a storage that only takes small values (as a full localStorage would)
    const set = storage.set.bind(storage)
    storage.set = (key: string, value: unknown) => {
      if (JSON.stringify(value).length > 1200)
        throw new DOMException('full', 'QuotaExceededError')
      set(key, value)
    }
    expect(() =>
      database.teamKqmResults.setRun('team_3', saved(3))
    ).not.toThrow()
    const runs = Object.keys(
      new ArtCharDatabase(1, storage).teamKqmResults.get().runs
    )
    expect(runs).toContain('team_3')
    expect(runs.length).toBeLessThan(3)
  })

  it('drops runs whose settings no longer validate', () => {
    const storage = new SandboxStorage()
    const database = new ArtCharDatabase(1, storage)
    database.teamKqmResults.setRun('team_1', saved())
    // (the storage keeps each run packed: its settings are in `data`)
    const raw = storage.get('teamKqmResults') as {
      runs: Record<string, { run: { data: Record<string, unknown> } }>
    }
    raw.runs['team_1'].run.data['teamOpt'] = 'not settings'
    storage.set('teamKqmResults', raw)
    expect(new ArtCharDatabase(1, storage).teamKqmResults.get().runs).toEqual(
      {}
    )
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
    // loading it packed it in the storage
    const stored = legacy.get('teamKqmResults') as {
      runs: Record<string, { run: { $packed?: number } }>
    }
    expect(stored.runs['team_1'].run.$packed).toBe(1)
    expect(JSON.stringify(stored).length).toBeLessThan(
      JSON.stringify(saved).length / 10
    )
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
