import { DBLocalStorage } from '@genshin-optimizer/common/database'
import type { EnkaShowcase, IGOOD } from '@genshin-optimizer/gi/good'
import { enkaToGood } from '@genshin-optimizer/gi/good'
// biome-ignore lint/style/noRestrictedImports: the showcase fixture lives beside enkaToGood
import * as fixture from '../../../good/src/enka/fixtures/showcase.json'
import { ArtCharDatabase } from './ArtCharDatabase'
import { initialCharacter } from './DataManagers/CharacterDataManager'
import type { IGO } from './exim'

const dbStorage = new DBLocalStorage(localStorage)
let database = new ArtCharDatabase(1, dbStorage)
const { good } = enkaToGood(fixture as unknown as EnkaShowcase)
/** As Import from Enka does it: kept what is not in it, matched what is */
const importShowcase = (data: IGOOD = good) =>
  database.importGOOD(structuredClone(data) as IGOOD & IGO, true, true, false)

describe('Import from Enka', () => {
  beforeEach(() => {
    dbStorage.clear()
    database = new ArtCharDatabase(1, dbStorage)
  })

  test('equips each character with what it wears', () => {
    importShowcase()
    expect(database.chars.get('Amber')).toMatchObject({
      level: 90,
      constellation: 6,
      talent: { auto: 10, skill: 10, burst: 10 },
    })
    const amber = database.chars.get('Amber')!
    expect(database.weapons.get(amber.equippedWeapon)).toMatchObject({
      key: 'SkywardHarp',
      refinement: 2,
      location: 'Amber',
    })
    expect(Object.values(amber.equippedArtifacts).filter(Boolean)).toHaveLength(
      5
    )
    expect(database.arts.values).toHaveLength(20)
  })

  test('a second import of the same showcase adds nothing', () => {
    importShowcase()
    const result = importShowcase()
    expect(database.arts.values).toHaveLength(20)
    expect(database.weapons.values.filter((w) => w.location)).toHaveLength(4)
    expect(result.artifacts.new).toHaveLength(0)
    expect(result.artifacts.unchanged).toHaveLength(20)
  })

  test('keeps the rest of the database, and matches pieces it already had', () => {
    database.chars.set('Albedo', initialCharacter('Albedo'))
    // (a scanner's inventory: the same pieces, unequipped, and locked)
    importShowcase({
      ...good,
      characters: [],
      weapons: [],
      artifacts: good.artifacts?.map((a) => ({
        ...a,
        location: '',
        lock: true,
      })),
    })
    expect(database.arts.values).toHaveLength(20)
    const result = importShowcase()
    expect(result.artifacts.new).toHaveLength(0)
    expect(database.arts.values).toHaveLength(20)
    expect(database.arts.values.every((a) => a.location && a.lock)).toBe(true)
    expect(database.chars.get('Albedo')).toBeDefined()
  })
})
