/**
 * Tests for polearm3 weapon modules (SkywardSpine, SymphonistOfScents, TamayurateiNoOhanashi)
 * and sheet fixes (BlackcliffPole, FracturedHalo, RoyalSpear, TamayurateiNoOhanashi).
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation, getTeamDataWith } from '../../'
import { parseRotation } from '../../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../../util/teamOpt/rotation/simulate'
import type { KitModel, SimHit } from '../../util/teamOpt/rotation/types'

function setupPolearmTeam(
  char: CharacterKey,
  weapon: WeaponKey,
  conditional: Record<string, Record<string, string>> = {},
  teammate?: CharacterKey
) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const addMember = (key: CharacterKey, wKey: WeaponKey, cond = {}) => {
    db.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 9, skill: 9, burst: 9 },
    })
    const teamCharId = db.teamChars.new(key, { conditional: cond })
    const buildTcId = db.buildTcs.new({
      characterKey: key,
      character: {
        level: 90,
        ascension: 6,
        constellation: 0,
        talent: { auto: 9, skill: 9, burst: 9 },
      },
      weapon: { key: wKey, level: 90, ascension: 6, refinement: 1 },
      artifact: {
        slots: {},
        substats: { type: 'max', stats: {}, rarity: 5 },
        sets: {},
      },
    } as never)
    return { teamCharId, buildType: 'tc', buildTcId } as LoadoutDatum
  }
  const loadoutData = [addMember(char, weapon, conditional)]
  if (teammate) loadoutData.push(addMember(teammate, 'DullBlade'))
  const teamId = db.teams.new({ loadoutData } as never)
  return { db, teamId }
}

const stateValue = (
  attacks: ReturnType<typeof rotationAttacks>,
  actor: CharacterKey,
  label: string,
  weapon: string,
  cond: string
) =>
  attacks[actor]
    ?.find((a) => a.description === label)
    ?.states?.find((s) => s.path[0] === weapon && s.path[1] === cond)?.value ??
  ''

describe('SkywardSpine module', () => {
  const runNormals = (gear: Parameters<typeof simulateRotation>[0]['gear']) =>
    simulateRotation({
      rotation: parseRotation('Xiangling N5 N5 N5 N5', [
        { characterKey: 'Xiangling', name: 'Xiangling' },
      ]),
      members: ['Xiangling'],
      constellations: {},
      elements: { Xiangling: 'pyro' },
      gear,
      repeats: 1,
      keep: 'all',
    })

  it('speeds up Normal Attacks by 12% and procs Physical vacuum blades with a 2s ICD', () => {
    const withSpine = runNormals({
      Xiangling: { weapon: 'SkywardSpine', refinement: 1 },
    })
    const withOther = runNormals({
      Xiangling: { weapon: 'FavoniusLance', refinement: 1 },
    })
    expect(withSpine.frames).toBeLessThan(withOther.frames)

    const procs = withSpine.hits.filter(
      (h) => h.path[0] === 'weapon:SkywardSpine'
    )
    expect(procs.length).toBeGreaterThanOrEqual(2)
    for (const p of procs) {
      expect(p.path).toEqual(['weapon:SkywardSpine', 'dmg'])
      expect(p.element).toBe('physical')
    }
    for (let i = 1; i < procs.length; i++)
      expect(procs[i].t - procs[i - 1].t).toBeGreaterThanOrEqual(120)

    const attack = rotationAttacks(withSpine, () => undefined).Xiangling!.find(
      (a) => a.path[0] === 'weapon:SkywardSpine'
    )!
    expect(attack.hits).toBe(procs.length)

    const spineTeam = setupPolearmTeam('Xiangling', 'SkywardSpine')
    expect(
      evaluateTeamRotation(spineTeam.db, spineTeam.teamId, 'F', {
        arts: {},
        attacks: { Xiangling: [attack] },
      })!.total
    ).toBeGreaterThan(0)

    const otherTeam = setupPolearmTeam('Xiangling', 'FavoniusLance')
    expect(
      evaluateTeamRotation(otherTeam.db, otherTeam.teamId, 'F', {
        arts: {},
        attacks: { Xiangling: [attack] },
      })?.total ?? 0
    ).toBe(0)
  })

  it('does not apply ATK SPD or procs when only a KQM candidate', () => {
    const withCand = runNormals({
      Xiangling: {
        weapon: 'FavoniusLance',
        candidates: { weapons: ['SkywardSpine'] },
      },
    })
    const withOther = runNormals({
      Xiangling: { weapon: 'FavoniusLance', refinement: 1 },
    })
    expect(withCand.frames).toBe(withOther.frames)
    expect(withCand.hits.some((h) => h.path[0] === 'weapon:SkywardSpine')).toBe(
      false
    )
  })
})

describe('SymphonistOfScents module', () => {
  const baseHit: Omit<SimHit, 't' | 'characterKey' | 'onField'> = {
    path: ['normal', '0'],
    tag: 'normal',
    element: 'pyro',
    label: 'Hit',
  }

  it('windows healing for wielder + healed characters for 3s (hitlag-extended) and excludes unhealed teammates', () => {
    const kits: Partial<Record<CharacterKey, KitModel>> = {
      Escoffier: {
        characterKey: 'Escoffier',
        element: 'cryo',
        source: 'test',
        act(c) {
          c.hit(0, {
            ...baseHit,
            element: 'cryo',
            label: 'BeforeHeal',
          })
          // Single-target heal at t=10 while on-field (will later heal Xiangling off-field)
          c.hit(10, {
            path: ['_heal', 'skill'],
            tag: 'other',
            element: 'cryo',
            label: 'HealSelf',
          })
          // Off-field periodic single-target heal at t=300 (hits active character Xiangling)
          c.at(300, (c2) => {
            c2.hit(0, {
              path: ['_heal', 'passive'],
              tag: 'other',
              element: 'cryo',
              label: 'HealActive',
            })
          })
          // Team-wide heal at t=700
          c.at(700, (c2) => {
            c2.hit(0, {
              path: ['_heal', 'burst'],
              tag: 'other',
              element: 'cryo',
              weight: 3,
              label: 'HealAll',
            })
          })
          c.hit(200, {
            ...baseHit,
            element: 'cryo',
            label: 'EscoffierExpired',
          })
          return { frames: 220 }
        },
      },
      Xiangling: {
        characterKey: 'Xiangling',
        element: 'pyro',
        source: 'test',
        act(c) {
          // Off-field Escoffier passive heals at t=300; hitlag of 20f extends Xiangling's 180f buff to 500
          c.hit(50, { ...baseHit, label: 'XianglingBefore' })
          c.hit(100, { ...baseHit, label: 'XianglingHealed' })
          c.hit(150, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 20,
            label: 'Pause',
          })
          c.hit(250, { ...baseHit, label: 'XianglingExtended' })
          c.hit(300, { ...baseHit, label: 'XianglingAfter' })
          return { frames: 320 }
        },
      },
      Bennett: {
        characterKey: 'Bennett',
        element: 'pyro',
        source: 'test',
        act(c) {
          c.hit(0, { ...baseHit, label: 'BennettUnhealed' })
          c.hit(200, { ...baseHit, label: 'BennettTeamHeal' })
          return { frames: 220 }
        },
      },
    }

    const sim = simulateRotation({
      rotation: parseRotation('Escoffier E Xiangling N1 Bennett N1', [
        { characterKey: 'Escoffier', name: 'Escoffier' },
        { characterKey: 'Xiangling', name: 'Xiangling' },
        { characterKey: 'Bennett', name: 'Bennett' },
      ]),
      members: ['Escoffier', 'Xiangling', 'Bennett'],
      elements: { Escoffier: 'cryo', Xiangling: 'pyro', Bennett: 'pyro' },
      constellations: {},
      kits,
      gear: { Escoffier: { weapon: 'SymphonistOfScents', refinement: 1 } },
      repeats: 1,
      swapFrames: 12,
      keep: 'all',
      reactions: { onHit() {} },
    })

    const attacks = rotationAttacks(sim)
    expect(
      stateValue(
        attacks,
        'Escoffier',
        'BeforeHeal',
        'SymphonistOfScents',
        'healing'
      )
    ).toBe('')
    expect(
      stateValue(
        attacks,
        'Escoffier',
        'EscoffierExpired',
        'SymphonistOfScents',
        'healing'
      )
    ).toBe('')
    expect(
      stateValue(
        attacks,
        'Xiangling',
        'XianglingBefore',
        'SymphonistOfScents',
        'healing'
      )
    ).toBe('')
    expect(
      stateValue(
        attacks,
        'Xiangling',
        'XianglingHealed',
        'SymphonistOfScents',
        'healing'
      )
    ).toBe('on')
    expect(
      stateValue(
        attacks,
        'Xiangling',
        'XianglingExtended',
        'SymphonistOfScents',
        'healing'
      )
    ).toBe('on')
    expect(
      stateValue(
        attacks,
        'Xiangling',
        'XianglingAfter',
        'SymphonistOfScents',
        'healing'
      )
    ).toBe('')
    // Unhealed teammate never receives the buff from single-target healing, only from team-wide heal
    expect(
      stateValue(
        attacks,
        'Bennett',
        'BennettUnhealed',
        'SymphonistOfScents',
        'healing'
      )
    ).toBe('')
    expect(
      stateValue(
        attacks,
        'Bennett',
        'BennettTeamHeal',
        'SymphonistOfScents',
        'healing'
      )
    ).toBe('on')
  })
})

describe('TamayurateiNoOhanashi module', () => {
  it('opens afterSkill for 10s (600f, hitlag-extended) on on-field Skill and closes after expiry', () => {
    const hit: Omit<SimHit, 't' | 'characterKey' | 'onField'> = {
      path: ['normal', '0'],
      tag: 'normal',
      element: 'pyro',
      label: 'Hit',
    }
    const kit: KitModel = {
      characterKey: 'Xiangling',
      element: 'pyro',
      source: 'test',
      act(c, _s, action) {
        if (action.kind === 'normal') {
          c.hit(0, { ...hit, label: 'Before' })
          return { frames: 20 }
        }
        // Skill at t=20: 600f base + 20f hitlag -> expires at t=640
        c.hit(10, { ...hit, label: 'Active' })
        c.hit(100, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 20,
          label: 'Pause',
        })
        c.hit(610, { ...hit, label: 'Extended' })
        c.hit(620, { ...hit, label: 'Expired' })
        return { frames: 650 }
      },
    }

    const sim = simulateRotation({
      rotation: parseRotation('Xiangling N1 E', [
        { characterKey: 'Xiangling', name: 'Xiangling' },
      ]),
      members: ['Xiangling'],
      elements: { Xiangling: 'pyro' },
      constellations: {},
      kits: { Xiangling: kit },
      gear: {
        Xiangling: { weapon: 'TamayurateiNoOhanashi', refinement: 1 },
      },
      repeats: 1,
      keep: 'all',
      reactions: { onHit() {} },
    })

    const attacks = rotationAttacks(sim)
    expect(
      stateValue(
        attacks,
        'Xiangling',
        'Before',
        'TamayurateiNoOhanashi',
        'afterSkill'
      )
    ).toBe('')
    expect(
      stateValue(
        attacks,
        'Xiangling',
        'Active',
        'TamayurateiNoOhanashi',
        'afterSkill'
      )
    ).toBe('on')
    expect(
      stateValue(
        attacks,
        'Xiangling',
        'Extended',
        'TamayurateiNoOhanashi',
        'afterSkill'
      )
    ).toBe('on')
    expect(
      stateValue(
        attacks,
        'Xiangling',
        'Expired',
        'TamayurateiNoOhanashi',
        'afterSkill'
      )
    ).toBe('')
  })
})

describe('polearm3 sheet fixes', () => {
  it('BlackcliffPole and RoyalSpear do not mark self-only sections as teamBuff', () => {
    expect(getWeaponSheet('BlackcliffPole').document[0]).not.toHaveProperty(
      'teamBuff',
      true
    )
    expect(getWeaponSheet('RoyalSpear').document[0]).not.toHaveProperty(
      'teamBuff',
      true
    )
  })

  it('TamayurateiNoOhanashi grants +10% moveSPD_ along with +20% ATK (R1) when afterSkill is on', () => {
    const read = (
      u: ReturnType<typeof uiDataForTeam>[CharacterKey],
      stat: string
    ) =>
      (
        u!.target as {
          get: (node: never) => { value: number } | undefined
        }
      ).get({ operation: 'read', path: ['premod', stat] } as never)?.value ?? 0

    const withOn = setupPolearmTeam('Xiangling', 'TamayurateiNoOhanashi', {
      TamayurateiNoOhanashi: { afterSkill: 'on' },
    })
    const uiOn = uiDataForTeam(
      getTeamDataWith(withOn.db, withOn.teamId, {}) as never,
      'F',
      'Xiangling'
    ).Xiangling

    const withOff = setupPolearmTeam('Xiangling', 'TamayurateiNoOhanashi')
    const uiOff = uiDataForTeam(
      getTeamDataWith(withOff.db, withOff.teamId, {}) as never,
      'F',
      'Xiangling'
    ).Xiangling

    expect(read(uiOn, 'moveSPD_')).toBeCloseTo(0.1, 6)
    expect(read(uiOff, 'moveSPD_')).toBe(0)
    expect(read(uiOn, 'atk_') - read(uiOff, 'atk_')).toBeCloseTo(0.2, 6)
  })

  it('FracturedHalo applies afterShield Lunar-Charged DMG even when afterSkillBurst is off, and afterSkillBurst is not teamBuff', () => {
    expect(getWeaponSheet('FracturedHalo').document[0]).not.toHaveProperty(
      'teamBuff',
      true
    )
    // (Electrifying Edict outlasts the ATK bonus: its toggle is not hidden when that is off)
    expect(getWeaponSheet('FracturedHalo').document[1]).not.toHaveProperty(
      'canShow'
    )
    const read = (
      u: ReturnType<typeof uiDataForTeam>[CharacterKey],
      stat: string
    ) =>
      (
        u!.target as {
          get: (node: never) => { value: number } | undefined
        }
      ).get({ operation: 'read', path: ['premod', stat] } as never)?.value ?? 0

    const { db, teamId } = setupPolearmTeam(
      'Xiangling',
      'FracturedHalo',
      { FracturedHalo: { afterShield: 'on' } },
      'Fischl'
    )
    const base = setupPolearmTeam('Xiangling', 'FracturedHalo', {}, 'Fischl')
    const teamData = getTeamDataWith(db, teamId, {}) as never
    const baseData = getTeamDataWith(base.db, base.teamId, {}) as never
    const xianglingUi = uiDataForTeam(teamData, 'F', 'Xiangling').Xiangling
    const fischlUi = uiDataForTeam(teamData, 'F', 'Fischl').Fischl
    const xianglingBase = uiDataForTeam(baseData, 'F', 'Xiangling').Xiangling

    expect(read(xianglingUi, 'lunarcharged_dmg_')).toBeCloseTo(0.4, 6)
    expect(read(fischlUi, 'lunarcharged_dmg_')).toBeCloseTo(0.4, 6)
    expect(read(xianglingUi, 'atk_')).toBeCloseTo(
      read(xianglingBase, 'atk_'),
      6
    )
  })
})
