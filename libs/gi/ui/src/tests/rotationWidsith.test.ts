/**
 * The Widsith (gcsim): taking the field plays one of three songs at random for 10 s (ATK, all
 * Elemental DMG or Elemental Mastery), once per 30 s. The optimizer uses their average: a third
 * of each, only in those 10 s.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type LoadoutDatum } from '@genshin-optimizer/gi/db'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { computeUIData, uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import type { Data, NumNode } from '@genshin-optimizer/gi/wr'
import { constant } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'
import { itemConditionals } from '../util/teamOpt/itemConditionals'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

/** A kit whose every action is one Skill hit and `frames` long */
const kit = (characterKey: CharacterKey, frames: number): KitModel => ({
  characterKey,
  element: 'hydro',
  source: 'test',
  act(ctx) {
    ctx.hit(1, {
      path: ['skill', 'press'],
      tag: 'skill',
      element: 'hydro',
      label: 'Skill',
    })
    return { frames }
  },
})

describe('The Widsith', () => {
  it('averages its three songs: a third of each, in full for the one picked', () => {
    const premod = (getWeaponSheet('TheWidsith') as unknown as { data: Data })
      .data.premod as Record<string, NumNode>
    const value = (song: string, stat: string) =>
      computeUIData([
        {
          weapon: { refinement: constant(5) },
          conditional: { TheWidsith: { Debut: constant(song) } },
        } as Data,
      ]).get(premod[stat]).value
    expect(value('avg', 'atk_')).toBeCloseTo(1.2 / 3)
    expect(value('avg', 'pyro_dmg_')).toBeCloseTo(0.96 / 3)
    expect(value('avg', 'eleMas')).toBeCloseTo(160)
    expect(value('recitative', 'atk_')).toBeCloseTo(1.2)
    expect(value('recitative', 'eleMas')).toBe(0)
    expect(value('aria', 'hydro_dmg_')).toBeCloseTo(0.96)
  })

  it('plays for 10 s each time the wielder takes the field, once per 30 s', () => {
    const members: CharacterKey[] = ['Mona', 'Bennett']
    const sim = simulateRotation({
      rotation: parseRotation(
        'Bennett E -> Mona E -> Bennett E -> Mona E -> Bennett E -> Mona E',
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      constellations: {},
      elements: { Mona: 'hydro', Bennett: 'pyro' },
      repeats: 1,
      kits: { Mona: kit('Mona', 600), Bennett: kit('Bennett', 600) },
      reactions: { onHit() {} },
      gear: { Mona: { weapon: 'TheWidsith', refinement: 5 } },
    })
    const windows = sim.buffWindows
      .filter((w) => w.path.join('.') === 'TheWidsith.Debut' && w.end > w.start)
      .map((w) => [w.value, w.start, w.end - w.start])
    // Mona takes the field at 10 s, 30 s and 50 s: the song at 10 s and at 50 s, not 30 s
    const enters = sim.actions
      .filter((a) => a.characterKey === 'Mona')
      .map((a) => a.start)
    expect(windows).toEqual([
      ['avg', enters[0], 600],
      ['avg', enters[2], 600],
    ])
    expect(enters[1] - enters[0]).toBeLessThan(1800)
    expect(enters[2] - enters[0]).toBeGreaterThanOrEqual(1800)
  })

  it('KQM’s rule (no rotation timing) uses the average song', () => {
    const { picked } = itemConditionals(
      { attacks: ['skill'], auras: [] } as never,
      { sets: [], weapons: ['TheWidsith'] }
    )
    expect(picked).toEqual([{ path: ['TheWidsith', 'Debut'], value: 'avg' }])
  })

  it('the song a switch picked plays in the rotation’s windows, not the average', () => {
    const db = new ArtCharDatabase(1, new SandboxStorage())
    db.chars.set('Mona', {
      key: 'Mona',
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 0,
    })
    db.weapons.new({
      key: 'TheWidsith',
      level: 90,
      ascension: 6,
      refinement: 5,
      location: 'Mona',
      lock: false,
    })
    const teamId = db.teams.new({
      loadoutData: [{ teamCharId: db.teamChars.new('Mona') }] as LoadoutDatum[],
    })
    const em = (song: string | undefined, state: string) =>
      uiDataForTeam(
        getTeamDataWith(db, teamId, {
          conditionalOverrides: song
            ? { Mona: { TheWidsith: { Debut: song } } }
            : undefined,
          states: [
            { owner: 'Mona', path: ['TheWidsith', 'Debut'], value: state },
          ],
        })! as never,
        'F',
        'Mona'
      ).Mona!.target.getDisplay()['basic']['eleMas'].value
    const none = em(undefined, '')
    expect(em(undefined, 'avg') - none).toBeCloseTo(160)
    expect(em('interlude', 'avg') - none).toBeCloseTo(480)
    expect(em('recitative', 'avg') - none).toBeCloseTo(0)
    expect(em('interlude', '') - none).toBeCloseTo(0)
  })
})
