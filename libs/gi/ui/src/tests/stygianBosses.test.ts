import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import {
  appliedStygianPreset,
  currentStygianSeason,
  stygianBosses,
  stygianDifficulties,
  stygianEnemy,
  stygianPresetKey,
  stygianSeasons,
} from '../components/enemy/stygianBosses'

const locales = join(__dirname, '../../../localization/assets/locales')
const languages = [
  'chs',
  'cht',
  'de',
  'en',
  'es',
  'fr',
  'id',
  'it',
  'ja',
  'ko',
  'pt',
  'ru',
  'th',
  'vi',
]

describe('Stygian Onslaught presets', () => {
  it("has every released season's bosses, each with a phase's RES for every element", () => {
    expect(stygianSeasons.length).toBe(13)
    const ids = new Set(stygianSeasons.flatMap((s) => s.bosses))
    expect(stygianBosses.map((b) => b.id).sort()).toEqual([...ids].sort())
    for (const boss of stygianBosses) {
      expect(boss.phases.some((p) => p.key === boss.main)).toBe(true)
      for (const phase of boss.phases)
        expect(Object.keys(phase.res).sort()).toEqual(
          [...allElementWithPhyKeys].sort()
        )
    }
    expect(stygianDifficulties.map((d) => d.level)).toEqual([105, 110])
  })

  it('sets the level and RES, an immunity as the editor does', () => {
    const wavebinder = stygianEnemy(1013061, 'regular', 110)
    expect(wavebinder).toEqual({
      enemyLevel: 110,
      physical_enemyRes_: 10,
      anemo_enemyRes_: 10,
      geo_enemyRes_: 10,
      electro_enemyRes_: -10,
      dendro_enemyRes_: 10,
      hydro_enemyRes_: 70,
      pyro_enemyRes_: 10,
      cryo_enemyRes_: 10,
    })
    expect(stygianEnemy(1001061, 'regular', 105).hydro_enemyRes_).toBe(
      Number.MAX_VALUE
    )
    // (the dump and the wiki over stygian.moe: Anemo 50%)
    expect(stygianEnemy(1011062, 'regular', 110).anemo_enemyRes_).toBe(50)
  })

  it('is shown while the enemy still has its RES, at the difficulty of its level', () => {
    const enemyOverride = {
      ...stygianEnemy(1013061, 'shielded', 105),
      enemyDefRed_: 0,
    }
    const enemyPreset = stygianPresetKey(1013061, 'shielded')
    const applied = appliedStygianPreset({ enemyOverride, enemyPreset })!
    expect([applied.boss.id, applied.phase.key, applied.difficulty]).toEqual([
      1013061,
      'shielded',
      'fearless',
    ])
    // another level: still the boss, no difficulty
    expect(
      appliedStygianPreset({
        enemyOverride: { ...enemyOverride, enemyLevel: 100 },
        enemyPreset,
      })?.difficulty
    ).toBeUndefined()
    // a RES edited by hand: the user's own enemy
    expect(
      appliedStygianPreset({
        enemyOverride: { ...enemyOverride, hydro_enemyRes_: 129 },
        enemyPreset,
      })
    ).toBeUndefined()
    expect(appliedStygianPreset({ enemyOverride })).toBeUndefined()
    expect(
      appliedStygianPreset({ enemyOverride, enemyPreset: 'stygian:1:regular' })
    ).toBeUndefined()
  })

  it('knows the season on', () => {
    expect(currentStygianSeason('2026-11-17')?.bosses).toEqual([
      1013061, 1006063, 1008061,
    ])
    expect(currentStygianSeason('2025-06-01')).toBeUndefined()
  })

  it('names every boss and season in every language', () => {
    for (const lang of languages) {
      const names = JSON.parse(
        readFileSync(join(locales, lang, 'stygian.json'), 'utf8')
      )
      for (const boss of stygianBosses)
        expect(names.boss[boss.id], `${lang} ${boss.id}`).toBeTruthy()
      for (const season of stygianSeasons)
        expect(names.season[season.id], `${lang} ${season.id}`).toBeTruthy()
    }
  })
})
