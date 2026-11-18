import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase, type LoadoutDatum } from '@genshin-optimizer/gi/db'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { input } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'
import type { FightEstimate } from '../components/enemy/stygianFights'
import {
  hpCrossing,
  playedAttackStates,
  uptimeState,
  withAttackStates,
  wolfsGravestoneStates,
  wolfsGravestoneUptime,
} from '../util/teamOpt/lowHpUptime'

/** A fight that takes HP off steadily over `seconds` */
const steady = (seconds: number): FightEstimate => ({
  seconds,
  parts: [],
  notes: [],
  modelled: false,
  timeline: {
    segments: [
      { start: 0, end: seconds, state: 'p1' as never, hpStart: 1, hpEnd: 0 },
    ],
    events: [],
  },
})

describe("Wolf's Gravestone over a fight (an enemy under 30% HP)", () => {
  it('is on 12 s of every 30 s from when the enemy falls under 30% HP to its defeat', () => {
    // 30 s: the last 9 s are under 30%, all of them on (30%)
    expect(wolfsGravestoneUptime(steady(30))).toMatchObject({
      below: 9,
      state: '30',
    })
    // 60 s: 18 s under, 12 on (20%); 120 s: 36 s under, 12 + 6 on (15%)
    expect(wolfsGravestoneUptime(steady(60))?.uptime).toBeCloseTo(0.2, 6)
    expect(wolfsGravestoneUptime(steady(120))?.uptime).toBeCloseTo(0.15, 6)
    expect(wolfsGravestoneUptime(steady(120))?.state).toBe('15')
  })
  it('reads HP as piecewise: flat while a ward holds it, a step when it breaks', () => {
    const ward: FightEstimate = {
      ...steady(50),
      timeline: {
        segments: [
          { start: 0, end: 20, state: 'p1' as never, hpStart: 1, hpEnd: 0.5 },
          // (flat at 50% under the ward, then the break takes it to 20% at once)
          {
            start: 20,
            end: 35,
            state: 'p1' as never,
            hpStart: 0.5,
            hpEnd: 0.5,
          },
          { start: 35, end: 50, state: 'p1' as never, hpStart: 0.2, hpEnd: 0 },
        ],
        events: [],
      },
    }
    expect(hpCrossing(ward, 0.3)).toBe(35)
    // 15 s under: 12 on of 50
    expect(wolfsGravestoneUptime(ward)?.uptime).toBeCloseTo(12 / 50, 6)
  })
  it('gives nothing without a fight, and off when the enemy is never under 30%', () => {
    expect(wolfsGravestoneUptime(undefined)).toBeUndefined()
    expect(
      wolfsGravestoneUptime({ ...steady(0), seconds: undefined })
    ).toBeUndefined()
    expect(uptimeState(0)).toBe('')
    expect(uptimeState(0.999)).toBe('on')
    expect(uptimeState(0.124)).toBe('10')
  })
  it('puts the state on every attack (over its own at the same path), and a result gives it back', () => {
    const states = wolfsGravestoneStates(['Diluc', 'Bennett'], '20')
    const attacks = withAttackStates(
      {
        Diluc: [
          {
            path: ['normal', '0'],
            hits: 2,
            states: [
              {
                owner: 'Diluc',
                path: ['WolfsGravestone', 'WolfishTracker'],
                value: 'on',
              },
              { owner: 'Diluc', path: ['Diluc', 'x'], value: 'on' },
            ],
          },
        ],
      } as never,
      states
    )
    expect(attacks.Diluc?.[0].states).toEqual([
      { owner: 'Diluc', path: ['Diluc', 'x'], value: 'on' },
      ...states,
    ])
    expect(playedAttackStates({ attacks })).toEqual(states)
    expect(playedAttackStates(undefined)).toBeUndefined()
  })
  it("scales the party's ATK bonus by the state: 'on' 40%, '20' 8%, '' none (R1)", () => {
    const atkOf = (state: string | undefined) => {
      const db = new ArtCharDatabase(1, new SandboxStorage({}))
      for (const key of ['Diluc', 'Bennett'] as const)
        db.chars.set(key, {
          key,
          level: 90,
          ascension: 6,
          talent: { auto: 9, skill: 9, burst: 9 },
          constellation: 0,
        })
      db.weapons.new({
        key: 'WolfsGravestone',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Diluc',
        lock: false,
      })
      db.weapons.new({
        key: 'DullBlade',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Bennett',
        lock: false,
      })
      const dId = db.teamChars.new('Diluc', {
        conditional: state
          ? { WolfsGravestone: { WolfishTracker: state } }
          : {},
      })
      const bId = db.teamChars.new('Bennett', {})
      const teamId = db.teams.new({
        loadoutData: [
          { teamCharId: dId },
          { teamCharId: bId },
        ] as LoadoutDatum[],
      })
      const ui = uiDataForTeam(
        getTeamDataWith(db, teamId, {})! as never,
        'F',
        'Diluc'
      )
      return ui.Bennett!.target.get(input.total.atk_).value
    }
    const off = atkOf(undefined)
    expect(atkOf('on') - off).toBeCloseTo(0.4, 6)
    expect(atkOf('20') - off).toBeCloseTo(0.08, 6)
    expect(atkOf('') - off).toBeCloseTo(0, 6)
  })
})
