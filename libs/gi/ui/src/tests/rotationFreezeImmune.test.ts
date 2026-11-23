import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { validateTeamEnemy } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { enemyFreezeImmune } from '../components/enemy/stygianBosses'
import { energyCalcData, energyFromRotation } from '../util/teamOpt/energyCalc'
import { itemConditionals } from '../util/teamOpt/itemConditionals'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { SimGear } from '../util/teamOpt/rotation/types'

/** A team's rotation played 4 times (the last 2 kept), on an enemy that can or can't be frozen */
const play = (
  team: CharacterKey[],
  rotation: string,
  freezeImmune: boolean,
  gear: Partial<Record<CharacterKey, SimGear>> = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      rotation,
      team.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members: team,
    elements: Object.fromEntries(team.map((m) => [m, getCharEle(m)])) as never,
    constellations: {},
    repeats: 4,
    keep: 'last2',
    gear,
    freezeImmune,
  })

describe('an enemy that can’t be frozen (gcsim’s FreezeResist 1)', () => {
  const team: CharacterKey[] = ['Xingqiu', 'Kaeya', 'Noelle']
  const text = 'Xingqiu E Q -> Kaeya E Q -> Noelle E N3'
  const strayer = { Kaeya: { sets: { BlizzardStrayer: 4 } } }

  it('still freezes on reaction (Hydro and Cryo consume each other), but never gets Frozen', () => {
    const freezes = (immune: boolean) =>
      play(team, text, immune).hits.filter(
        (h) => h.path[0] === '_reaction' && h.path[1] === 'frozen'
      )
    expect(freezes(false).length).toBeGreaterThan(0)
    expect(freezes(false).every((h) => !h.noFrozen)).toBe(true)
    const immune = freezes(true)
    expect(immune.length).toBeGreaterThan(0)
    expect(immune.every((h) => h.noFrozen)).toBe(true)
  })

  it('has no Shatter and no Frozen Blizzard Strayer, only its Cryo bonus', () => {
    const shatters = (immune: boolean) =>
      play(team, text, immune).hits.filter((h) => h.path[1] === 'shattered')
    expect(shatters(false).length).toBeGreaterThan(0)
    expect(shatters(true)).toHaveLength(0)
    const strayerStates = (immune: boolean) =>
      new Set(
        play(team, text, immune, strayer)
          .hits.filter(
            (h) => h.characterKey === 'Kaeya' && !h.path[0].startsWith('_')
          )
          .flatMap((h) => h.states ?? [])
          .filter((s) => s.path.join('.') === 'BlizzardStrayer.state')
          .map((s) => s.value)
      )
    expect(strayerStates(false).has('frozen')).toBe(true)
    expect(strayerStates(true).has('frozen')).toBe(false)
    expect(strayerStates(true).has('cryo')).toBe(true)
  })

  it('drops no extra particle for Kaeya’s A4 (gcsim: only a Frozen enemy)', () => {
    const uses = (immune: boolean) => {
      const sim = play(
        ['Beidou', 'Kaeya', 'Xingqiu', 'YunJin'],
        'Xingqiu E Q -> Kaeya E -> Beidou hE Q -> YunJin hE Q',
        immune
      )
      const member = energyFromRotation(
        sim,
        ['Beidou', 'Kaeya', 'Xingqiu', 'YunJin'],
        2
      ).members.Kaeya!
      return energyCalcData.Kaeya!.skills[member.skillMode!].label
    }
    expect(uses(false)).toBe('1 freeze')
    expect(uses(true)).toBe('0 freezes')
  })

  it('assumes Blizzard Strayer at Cryo, not Frozen, where nobody set it', () => {
    const rule = (freezeImmune: boolean) =>
      itemConditionals(
        { attacks: ['skill'], auras: ['hydro', 'cryo'], freezeImmune },
        { sets: ['BlizzardStrayer'] }
      ).conditional
    expect(JSON.stringify(rule(false))).toContain('frozen')
    expect(JSON.stringify(rule(true))).not.toContain('frozen')
    expect(JSON.stringify(rule(true))).toContain('cryo')
  })

  it('is a boss preset’s own (the game’s boss type), unless set by hand', () => {
    // Hydro Tulpa is a boss; the Battle-Scarred Rock Crab an elite
    expect(enemyFreezeImmune({ enemyPreset: 'stygian:1001061:regular' })).toBe(
      true
    )
    expect(enemyFreezeImmune({ enemyPreset: 'stygian:1003062:regular' })).toBe(
      false
    )
    expect(
      enemyFreezeImmune({
        enemyPreset: 'stygian:1001061:regular',
        freezeImmune: false,
      })
    ).toBe(false)
    expect(enemyFreezeImmune({ freezeImmune: true })).toBe(true)
    expect(enemyFreezeImmune({})).toBe(false)
    expect(enemyFreezeImmune(undefined)).toBe(false)
  })

  it('keeps a choice made by hand in the saved enemy', () => {
    const saved = (freezeImmune: unknown) =>
      validateTeamEnemy({ enemyOverride: {}, freezeImmune })?.freezeImmune
    expect(saved(true)).toBe(true)
    expect(saved(false)).toBe(false)
    expect(saved('yes')).toBeUndefined()
    expect(saved(undefined)).toBeUndefined()
  })
})
