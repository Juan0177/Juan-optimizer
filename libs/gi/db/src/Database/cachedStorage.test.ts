import {
  DBCachedStorage,
  type KVBatch,
  SandboxStorage,
} from '@genshin-optimizer/common/database'
import { randomizeArtifact } from '@genshin-optimizer/gi/util'
import { ArtCharDatabase } from './ArtCharDatabase'
import { initialCharacter } from './DataManagers/CharacterDataManager'
import { defaultInitialWeapon } from './DataManagers/WeaponDataManager'

describe('the database on the app storage kept in IndexedDB (DBCachedStorage)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  /** A database's entries, as saved */
  function saved() {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    const albedo = initialCharacter('Albedo')
    database.chars.set(albedo.key, albedo)
    const weapon = defaultInitialWeapon('sword')
    weapon.location = 'Albedo'
    database.weapons.new(weapon)
    for (let i = 0; i < 20; i++) database.arts.new(randomizeArtifact())
    database.teams.new()
    return database.storage.entries
  }

  it('loads the same data as from localStorage, and loading saves nothing', async () => {
    const entries = saved()
    const batches: KVBatch[] = []
    const storage = new DBCachedStorage(entries, {
      write: async (batch) => {
        batches.push(batch)
      },
    })
    const database = new ArtCharDatabase(1, storage)
    const before = new ArtCharDatabase(
      1,
      new SandboxStorage(Object.fromEntries(entries))
    )
    expect(database.exportGOOD()).toEqual(before.exportGOOD())
    await vi.advanceTimersByTimeAsync(0)
    expect(batches).toEqual([])
  })

  it('saves a change', async () => {
    const batches: KVBatch[] = []
    const storage = new DBCachedStorage(saved(), {
      write: async (batch) => {
        batches.push(batch)
      },
    })
    const database = new ArtCharDatabase(1, storage)
    const [id] = database.arts.keys
    database.arts.set(id, { lock: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(batches.length).toBe(1)
    expect(batches[0].entries.map(([key]) => key)).toEqual([id])
    expect(JSON.parse(batches[0].entries[0][1] as string).lock).toBe(true)
  })
})
