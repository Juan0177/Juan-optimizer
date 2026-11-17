import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type LoadoutDatum } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { input } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

function run(
  text: string,
  members: CharacterKey[],
  cons: Partial<Record<CharacterKey, number>> = {}
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: cons,
    repeats: 1,
    keep: 'all',
  })
}

/** Odette (C`constellation`, A6) with Bennett, and Odette's Marvelous Splendor conditional */
function sheets(constellation: number, splendor?: string) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set('Odette', {
    key: 'Odette',
    level: 90,
    ascension: 6,
    talent: { auto: 10, skill: 10, burst: 10 },
    constellation,
  })
  db.chars.set('Bennett', {
    key: 'Bennett',
    level: 90,
    ascension: 6,
    talent: { auto: 9, skill: 9, burst: 9 },
    constellation: 0,
  })
  for (const location of ['Odette', 'Bennett'] as const)
    db.weapons.new({
      key: 'DullBlade',
      level: 90,
      ascension: 6,
      refinement: 1,
      location,
      lock: false,
    })
  const oId = db.teamChars.new('Odette', {
    conditional:
      splendor === undefined ? {} : { Odette: { a1TeamSplendor: splendor } },
  })
  const bId = db.teamChars.new('Bennett', {})
  const teamId = db.teams.new({
    loadoutData: [{ teamCharId: oId }, { teamCharId: bId }] as LoadoutDatum[],
  })
  const ui = uiDataForTeam(
    getTeamDataWith(db, teamId, {})! as never,
    'F',
    'Odette'
  )
  return { odette: ui.Odette!.target, bennett: ui.Bennett!.target }
}

describe('Odette constellations', () => {
  it('C4: Stellar Glimmer damage draws a coordinated attack (3.5 s cooldown) and shares Snow Swan’s Dream', () => {
    const sim = run('Odette E Q E W8 -> Bennett E', ['Odette', 'Bennett'], {
      Odette: 4,
    })
    const c4 = sim.hits.filter((h) => h.label.startsWith('Odette C4'))
    expect(c4.length).toBeGreaterThan(0)
    for (let i = 1; i < c4.length; i++)
      expect(c4[i].t - c4[i - 1].t).toBeGreaterThanOrEqual(210)
    expect(
      sim.buffWindows.some(
        (w) => w.path.join('.') === 'Odette.burst' && w.recipient === 'Bennett'
      )
    ).toBe(true)
  })

  it('C1 adds Daybreak Finale on her character clock', () => {
    const sim = run('Odette E E W2', ['Odette'], { Odette: 1 })
    const coda = sim.hits.find((h) =>
      h.label.startsWith("Coda at Dawn's Tolling (Stellar")
    )!
    const c1 = sim.hits.find((h) => h.label.startsWith('Daybreak Finale'))!
    expect(c1.t).toBe(coda.t)
    expect(c1.tag).toBe('directStellarConduct')
  })

  it('C6 keeps her own Splendor while granting it', () => {
    const sim = run('Odette E -> Bennett W5', ['Odette', 'Bennett'], {
      Odette: 6,
    })
    const team = sim.buffWindows.filter(
      (w) => w.path.join('.') === 'Odette.a1TeamSplendor'
    )
    expect(Math.max(...team.map((w) => Number(w.value || 0)))).toBe(6)
  })

  // Avatar_Odette_ElementalBurst: Burst_Triggerability (entering the Burst) grants Snow Swan's
  // Dream and, at C4, UNIQUE_Odette_FinalAct_OnAvatars to the others, as it summons the Double
  it('C4 shares Snow Swan’s Dream from the cast, as Odette gets it', () => {
    const sim = run('Odette Q W3', ['Odette', 'Bennett'], { Odette: 4 })
    const dream = sim.buffWindows.filter(
      (w) => w.path.join('.') === 'Odette.burst'
    )
    expect(
      dream.map((w) => [w.recipient, w.start, w.end]).sort()
    ).toEqual([
      ['Bennett', 1, 1201],
      ['Odette', 1, 1201],
    ])
  })

  // Avatar_Odette_PermanentSkill_1: the C6 20% is part of her own Talent1_HuaCai_OnSelf_N
  // modifiers (EffectFactor C6_DamagePerLayer_Self + _Other), present only with her stacks
  it('C6: Odette’s 45% Elevation needs her Marvelous Splendor (the Double out)', () => {
    const none = sheets(6)
    expect(
      none.odette.get(input.total.stellarconduct_specialDmg_).value
    ).toBeCloseTo(0, 6)
    const held = sheets(6, '0')
    expect(
      held.odette.get(input.total.stellarconduct_specialDmg_).value
    ).toBeCloseTo(0.45, 6)
    expect(
      held.odette.get(input.total.stellarswirl_specialDmg_).value
    ).toBeCloseTo(0.45, 6)
    // the others: 25% from their first stack
    expect(
      held.bennett.get(input.total.stellarconduct_specialDmg_).value
    ).toBeCloseTo(0, 6)
    expect(
      sheets(6, '2').bennett.get(input.total.stellarconduct_specialDmg_).value
    ).toBeCloseTo(0.25, 6)
    // below C6: none
    expect(
      sheets(5, '0').odette.get(input.total.stellarconduct_specialDmg_).value
    ).toBeCloseTo(0, 6)
  })
})
