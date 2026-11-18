import { SandboxStorage } from '@genshin-optimizer/common/database'
import { toPercent } from '@genshin-optimizer/common/util'
import type {
  ArtifactSlotKey,
  CharacterKey,
  MainStatKey,
} from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import {
  allStats,
  getCharStat,
  getWeaponStat,
} from '@genshin-optimizer/gi/stats'
import { getMainStatValue } from '@genshin-optimizer/gi/util'
import { input } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import type { KqmBuild } from '../'
import { kqmBuildRarity, kqmOutOfCombatStats, kqmValues } from '../'
import { getTeamDataCalc } from '../hooks/useTeamData'

const ayaka: CharacterKey = 'KamisatoAyaka'
const shenhe: CharacterKey = 'Shenhe'
const others: CharacterKey[] = ['KaedeharaKazuha', 'SangonomiyaKokomi']
const run = { constellation: 0, talent: 9 }

/** A database with the characters only: no teams, no conditionals */
function bareDatabase() {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const key of [ayaka, shenhe, ...others])
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 0,
    })
  return database
}

/** The same characters on a 4-member team whose members' conditionals are on */
function teamDatabase() {
  const database = bareDatabase()
  const ids = [
    database.teamChars.new(ayaka, {
      conditional: {
        KamisatoAyaka: { afterBurst: 'on', afterSprint: 'on' },
        MistsplitterReforged: { MistsplittersEmblem: '3' },
        BlizzardStrayer: { state: 'frozen' },
      },
    }),
    database.teamChars.new(shenhe, {
      conditional: {
        Shenhe: { quill: 'quill', burst: 'burst', asc1: 'field' },
        CalamityQueller: { stack: '6' },
        ShimenawasReminiscence: { usedEnergy: 'used' },
      },
    }),
    ...others.map((key) => database.teamChars.new(key)),
  ]
  database.teams.new({
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
  })
  return database
}

const shenheBuild: KqmBuild = {
  weapon: { key: 'CalamityQueller', refinement: 1 },
  sets: { ShimenawasReminiscence: 4 },
  mains: { sands: 'atk_', goblet: 'cryo_dmg_', circlet: 'critRate_' },
  rolls: { atk_: 6, atk: 2, critRate_: 4, critDMG_: 6, enerRech_: 2 },
}
const ayakaBuild: KqmBuild = {
  weapon: { key: 'MistsplitterReforged', refinement: 1 },
  sets: { BlizzardStrayer: 4 },
  mains: { sands: 'atk_', goblet: 'cryo_dmg_', circlet: 'critDMG_' },
  rolls: { atk_: 4, critRate_: 8, critDMG_: 8 },
}

const charCurve = (ck: CharacterKey, key: 'hp' | 'atk' | 'def') => {
  const { lvlCurves, ascensionBonus } = getCharStat(ck)
  const { base, curve } = lvlCurves.find((c) => c.key === key)!
  return (
    base *
      allStats.char.expCurve[curve as keyof typeof allStats.char.expCurve][90] +
    (ascensionBonus[key]?.[6] ?? 0)
  )
}

/**
 * The reference: the same KQM build as a TC loadout (same weapon at 90/6 and refinement, same 5★
 * +20 main stats, the same substat totals, same sets, constellation and talents) in a one-member
 * team with no conditionals, computed through the team path the character page uses
 * (`getTeamDataCalc`: `getTeamData` + `uiDataForTeam`)
 */
function referenceStats(
  characterKey: CharacterKey,
  build: KqmBuild,
  { constellation, talent }: { constellation: number; talent: number }
) {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  // (the character's own saved state differs: the TC loadout's must win)
  database.chars.set(characterKey, {
    key: characterKey,
    level: 20,
    ascension: 1,
    talent: { auto: 1, skill: 1, burst: 1 },
    constellation: 0,
  })
  const slots: Record<ArtifactSlotKey, MainStatKey> = {
    flower: 'hp',
    plume: 'atk',
    ...build.mains,
  }
  const values = kqmValues(build)
  // Substat totals: the build's stats less its five main stats
  const substats = Object.fromEntries(
    allSubstatKeys.map((key) => {
      const mains = Object.values(slots).filter((k) => k === key).length
      const main = mains && getMainStatValue(key as MainStatKey, 5, 20)
      const total = (values[key] ?? 0) - mains * main
      return [key, toPercent(total, key)]
    })
  )
  const buildTcId = database.buildTcs.new({
    characterKey,
    character: {
      level: 90,
      ascension: 6,
      constellation,
      talent: { auto: talent, skill: talent, burst: talent },
    },
    weapon: {
      key: build.weapon.key,
      level: 90,
      ascension: 6,
      refinement: build.weapon.refinement,
    },
    artifact: {
      slots: Object.fromEntries(
        Object.entries(slots).map(([slot, statKey]) => [
          slot,
          { level: 20, rarity: 5, statKey },
        ])
      ),
      substats: { type: 'max', stats: substats, rarity: 5 },
      sets: build.sets,
    },
  } as never)
  const teamCharId = database.teamChars.new(characterKey, { conditional: {} })
  const teamId = database.teams.new({
    loadoutData: [{ teamCharId, buildType: 'tc', buildTcId }] as LoadoutDatum[],
    conditional: {},
  } as never)
  const data = getTeamDataCalc(database, teamId, database.gender, teamCharId)?.[
    characterKey
  ]?.target
  if (!data) throw new Error('no team data')
  return (key: string) =>
    Number(data.get(input.total[key as keyof typeof input.total]).value)
}

describe('kqmOutOfCombatStats', () => {
  it('reads the eight stats in order for a KQM build', () => {
    const result = kqmOutOfCombatStats(bareDatabase(), ayaka, ayakaBuild, run)
    expect(result).toBeDefined()
    expect(result!.mains).toEqual({
      sands: 'atk_',
      goblet: 'cryo_dmg_',
      circlet: 'critDMG_',
    })
    expect(result!.stats.map((s) => s.key)).toEqual([
      'hp',
      'atk',
      'def',
      'eleMas',
      'critRate_',
      'critDMG_',
      'enerRech_',
      'cryo_dmg_',
    ])
    for (const { value } of result!.stats)
      expect(Number.isFinite(value)).toBe(true)
  })

  it('matches a hand sum', () => {
    const result = kqmOutOfCombatStats(
      bareDatabase(),
      shenhe,
      shenheBuild,
      run
    )!
    const stat = (key: string) => result.stats.find((s) => s.key === key)!.value
    const values = kqmValues(shenheBuild)
    const weapon = getWeaponStat('CalamityQueller')
    const weaponCurve = (base: number, curve: string) =>
      base *
      allStats.weapon.expCurve[
        curve as keyof typeof allStats.weapon.expCurve
      ][90]
    const weaponAtk =
      weaponCurve(weapon.mainStat.base, weapon.mainStat.curve) +
      weapon.ascensionBonus.atk![6]
    const weaponSub = weaponCurve(weapon.subStat!.base, weapon.subStat!.curve) // atk_
    const ascAtk_ = getCharStat(shenhe).ascensionBonus.atk_![6] // Shenhe: ATK%
    // ATK = (Shenhe's base ATK + Calamity Queller's base ATK)
    //   × (1 + Shenhe's ascension ATK% + the weapon's ATK% + sands, rolls + Shimenawa 2pc 18%)
    //   + flat ATK (plume + rolls); Calamity Queller's stacking ATK% is conditional: not counted
    const atk =
      (charCurve(shenhe, 'atk') + weaponAtk) *
        (1 + ascAtk_ + weaponSub + values['atk_'] + 0.18) +
      values['atk']
    expect(stat('atk')).toBeCloseTo(atk, 4)
    // CRIT Rate = 5% base + circlet + rolls (Shenhe's ascension stat and the weapon's: not CRIT)
    expect(stat('critRate_')).toBeCloseTo(0.05 + values['critRate_'], 6)
    // Cryo DMG Bonus = goblet + Calamity Queller's unconditional 12% All Elemental DMG Bonus
    expect(stat('cryo_dmg_')).toBeCloseTo(values['cryo_dmg_'] + 0.12, 6)
    // ER = 100% base + rolls
    expect(stat('enerRech_')).toBeCloseTo(1 + values['enerRech_'], 6)
  })

  it('matches the same build as a TC loadout in a one-member team', () => {
    for (const [ck, build] of [
      [shenhe, shenheBuild],
      [ayaka, ayakaBuild],
    ] as const)
      for (const options of [run, { constellation: 6, talent: 10 }]) {
        const result = kqmOutOfCombatStats(bareDatabase(), ck, build, options)!
        const reference = referenceStats(ck, build, options)
        expect(result.stats).toHaveLength(8)
        for (const { key, value } of result.stats)
          expect({ key, value }).toEqual({
            key,
            value: expect.closeTo(reference(key), 6),
          })
      }
  })

  it('ignores conditionals and teammates', () => {
    // (the helper reads no teams: a database whose team has conditionals on changes nothing)
    for (const [ck, build] of [
      [shenhe, shenheBuild],
      [ayaka, ayakaBuild],
    ] as const) {
      const bare = kqmOutOfCombatStats(bareDatabase(), ck, build, run)
      const team = kqmOutOfCombatStats(teamDatabase(), ck, build, run)
      expect(team).toEqual(bare)
    }
    // Mistsplitter's stacks and Blizzard Strayer's 4pc are conditional: only the 12% counts
    const ayakaStats = kqmOutOfCombatStats(
      teamDatabase(),
      ayaka,
      ayakaBuild,
      run
    )!
    const values = kqmValues(ayakaBuild)
    expect(
      ayakaStats.stats.find((s) => s.key === 'cryo_dmg_')!.value
    ).toBeCloseTo(values['cryo_dmg_'] + 0.12 + 0.15, 6) // + Blizzard Strayer 2pc 15%
    expect(
      ayakaStats.stats.find((s) => s.key === 'critRate_')!.value
    ).toBeCloseTo(0.05 + values['critRate_'], 6)
  })

  it('uses the build rarity for 4★ sets', () => {
    const build: KqmBuild = {
      ...ayakaBuild,
      sets: { Instructor: 4 },
      mains: { sands: 'eleMas', goblet: 'cryo_dmg_', circlet: 'critDMG_' },
    }
    expect(kqmBuildRarity(build).subScale).toBeLessThan(1)
    const values = kqmValues(build)
    // (four 4★ pieces, the sands among them: less EM than a 5★ sands)
    expect(values['eleMas']).toBeLessThan(
      kqmValues({ ...build, sets: {} })['eleMas']
    )
    const result = kqmOutOfCombatStats(bareDatabase(), ayaka, build, run)!
    // EM = sands and rolls (4★) + Instructor 2pc 80 (its 4pc is conditional)
    expect(result.stats.find((s) => s.key === 'eleMas')!.value).toBeCloseTo(
      values['eleMas'] + 80,
      4
    )
  })

  it('shows the element DMG Bonus with a non-elemental goblet', () => {
    const build: KqmBuild = {
      ...ayakaBuild,
      sets: {},
      mains: { sands: 'atk_', goblet: 'atk_', circlet: 'critDMG_' },
    }
    const result = kqmOutOfCombatStats(bareDatabase(), ayaka, build, run)!
    expect(result.mains.goblet).toBe('atk_')
    const ele = result.stats[7]
    expect(ele.key).toBe('cryo_dmg_')
    // Mistsplitter's unconditional 12%
    expect(ele.value).toBeCloseTo(0.12, 6)
  })
})
