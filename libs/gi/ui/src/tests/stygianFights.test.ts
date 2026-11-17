import { describe, expect, it } from 'vitest'
import { stygianBoss } from '../components/enemy/stygianBosses'
import type { FightTeam } from '../components/enemy/stygianFights'
import {
  COURAGE,
  courageDrain,
  customFight,
  dpsAt,
  enemyFight,
  enemyHpOf,
  FIGHT_LIMIT,
  resMultiplier,
  stygianFight,
} from '../components/enemy/stygianFights'

const all = (v: number) => ({
  physical: v,
  anemo: v,
  geo: v,
  electro: v,
  dendro: v,
  hydro: v,
  pyro: v,
  cryo: v,
})
/** A team dealing only `element` DMG, against an enemy with 10% RES everywhere, no shred */
const team = (
  element: keyof ReturnType<typeof all>,
  dps: number,
  gauge?: FightTeam['gauge']
): FightTeam => ({
  dps: { [element]: dps },
  baseRes: all(0.1),
  effRes: all(0.1),
  ...(gauge ? { gauge } : {}),
})

describe('Stygian Onslaught fights', () => {
  it('rescales each element’s damage to another RES, the team’s shred kept', () => {
    const t: FightTeam = {
      dps: { hydro: 100, electro: 50 },
      baseRes: all(0.1),
      // (15% Hydro shred: its RES is at -5% now)
      effRes: { ...all(0.1), hydro: -0.05 },
    }
    const res = { ...all(10), hydro: 70, electro: -10 }
    const hydro = (100 * resMultiplier(-0.05 + 0.6)) / resMultiplier(-0.05)
    const electro = (50 * resMultiplier(-0.1)) / resMultiplier(0.1)
    expect(dpsAt(t, res as never)).toBeCloseTo(hydro + electro, 9)
    // an immune element deals nothing
    expect(dpsAt(t, { ...res, hydro: 'immune' } as never)).toBeCloseTo(
      electro,
      9
    )
  })

  it('Wavebinder: Valiant States last 40 s with no Electro, its backlash at most 15%', () => {
    const boss = stygianBoss(1013061)!
    const hp = boss.hp.dire
    // a Physical team against its regular RES (10%): 300K DPS there
    const fight = stygianFight(boss, 'dire', team('physical', 300000, {}))
    const valiant = fight.parts.find((p) => p.key === 'valiant')
    expect(valiant && valiant.key === 'valiant' && valiant.seconds).toBe(40)
    // 60% of what its shield took (at Valiant RES: Physical 70%, so 100K DPS), at most 15% each
    const backlash = fight.parts.find((p) => p.key === 'backlash') as {
      count: number
      hp: number
    }
    const each = Math.min(0.6 * 100000 * 40, 0.15 * hp) / hp
    // (the last one at most the HP left: it can be the one that defeats it)
    expect(backlash.hp).toBeLessThanOrEqual(each * backlash.count + 1e-9)
    expect(backlash.hp).toBeGreaterThan(each * (backlash.count - 1))
    // more than its HP ÷ the DPS: the Valiant States' 40 s are its shield's
    expect(fight.seconds!).toBeGreaterThan(hp / 300000)
    expect(fight.notes).toContain('stellarGlimmer')
  })

  it('Wavebinder: Electro drains its Courage, shortening each Valiant State', () => {
    const boss = stygianBoss(1013061)!
    const slow = stygianFight(boss, 'dire', team('electro', 300000, {}))
    const fast = stygianFight(boss, 'dire', {
      ...team('electro', 300000),
      electroHits: { stellar: 0, hits: 2, units: 2 },
    })
    const length = (f: typeof slow) =>
      (f.parts.find((p) => p.key === 'valiant') as { seconds: number }).seconds
    // 600 Courage ÷ (15 + 8 × (0.6 × 2 + 0.06 × 2) per second)
    expect(length(fast)).toBeCloseTo(600 / (15 + 8 * 1.32), 9)
    expect(fast.seconds!).toBeLessThan(slow.seconds!)
  })

  it('Wavebinder: each Electro hit takes its Courage (the game files: 6 Stellar Glimmer, else 0.6 and 0.06 per unit), 8× in its Valiant Assault', () => {
    const boss = stygianBoss(1013061)!
    const valiant = (electroHits: FightTeam['electroHits']) => {
      const fight = stygianFight(boss, 'dire', {
        ...team('electro', 300000),
        ...(electroHits ? { electroHits } : {}),
      })
      return {
        fight,
        part: fight.parts.find((p) => p.key === 'valiant') as {
          seconds: number
          courage?: number
          stellar?: number
        },
      }
    }
    // one Stellar Glimmer hit a second: 15 + 8 × 6 = 63 Courage/s
    const stellar = valiant({ stellar: 1, hits: 0, units: 0 })
    expect(stellar.part.seconds).toBeCloseTo(600 / 63, 9)
    expect(stellar.part.courage).toBeCloseTo(48, 9)
    expect(stellar.part.stellar).toBe(1)
    // 7 other hits applying 2 units: 15 + 8 × (7 × 0.6 + 2 × 0.06)
    expect(valiant({ stellar: 0, hits: 7, units: 2 }).part.seconds).toBeCloseTo(
      600 / (15 + 8 * 4.32),
      9
    )
    // measured drains in its Valiant Assault: 48, 5.28 (1U applied), 4.8 (none)
    const inValiant = (h: Parameters<typeof courageDrain>[0]) =>
      COURAGE.valiant * courageDrain(h)
    expect(inValiant({ stellar: 1, hits: 0, units: 0 })).toBeCloseTo(48, 9)
    expect(inValiant({ stellar: 0, hits: 1, units: 1 })).toBeCloseTo(5.28, 9)
    expect(inValiant({ stellar: 0, hits: 1, units: 0 })).toBeCloseTo(4.8, 9)
    // its hits taken from the attacks entered: said so; none known: said so too
    expect(
      valiant({ stellar: 0, hits: 3, units: 1, estimated: true }).fight.notes
    ).toContain('electroEstimated')
    const none = valiant(undefined)
    expect(none.fight.notes).toContain('noRotation')
    expect(none.part.seconds).toBe(40)
    expect(none.part.courage).toBeUndefined()
    // the stun its Electro hits build up to is not counted
    expect(none.fight.notes).toContain('electroStun')
  })

  it('Wavebinder: its backlash counts the Stellar Glimmer DMG its shield took at 150%', () => {
    const boss = stygianBoss(1013061)!
    const hp = boss.hp.dire
    // 20K DPS at Valiant RES (Physical 70%), 40 s: its shield takes 800K
    const valiantDps = 20000
    const regularDps = (valiantDps * resMultiplier(0.1)) / resMultiplier(0.7)
    const backlash = (stellarShare: number) =>
      (
        stygianFight(boss, 'dire', {
          ...team('physical', regularDps),
          stellarShare,
        }).timeline.events[0] as { hp: number }
      ).hp * hp
    expect(backlash(0)).toBeCloseTo(0.6 * 800000, 0)
    expect(backlash(1)).toBeCloseTo(1.5 * 800000, 0)
    expect(backlash(0.5)).toBeCloseTo((0.6 + 0.45) * 800000, 0)
  })

  it('Emperor of Fire and Iron: its horns, broken by reactions on their 64U Pyro', () => {
    const boss = stygianBoss(1006063)!
    const hp = boss.hp.fearless
    // Hydro on Pyro: 2x; 2 gauge/s of Hydro: 64U in 16 s
    const fight = stygianFight(
      boss,
      'fearless',
      team('hydro', 400000, { hydro: 2 })
    )
    const horns = fight.parts.find((p) => p.key === 'horns') as {
      seconds: number
      removal: number
      count: number
    }
    expect(horns.removal).toBe(4)
    expect(horns.seconds).toBe(16)
    // each break: 10% of its HP
    const breaks = fight.parts.find((p) => p.key === 'hornsBreak') as {
      hp: number
    }
    expect(breaks.hp).toBeCloseTo(horns.count * 0.1, 9)
    // slower than its HP ÷ the DPS without horns: most of the fight is at +150% RES
    expect(fight.seconds!).toBeGreaterThan(hp / 400000)
    // a Pyro team never breaks them
    const pyro = stygianFight(boss, 'fearless', team('pyro', 400000, {}))
    expect(pyro.notes).toContain('noHornRemoval')
    expect(
      (pyro.parts.find((p) => p.key === 'horns') as { count: number }).count
    ).toBe(0)
  })

  it('lays the fight out over time: its states, its HP falling, its mechanics’ drops', () => {
    for (const [id, gauge] of [
      [1013061, { electro: 1.5 }],
      [1006063, { hydro: 1.5 }],
      [1004062, {}],
    ] as const) {
      const fight = stygianFight(
        stygianBoss(id)!,
        'dire',
        team('electro', 250000, gauge)
      )
      const { segments, events } = fight.timeline
      // one stretch after the other, from 0 to the end of the fight, HP only ever falling
      expect(segments[0].start).toBe(0)
      expect(segments[0].hpStart).toBe(1)
      for (const [i, seg] of segments.entries()) {
        expect(seg.end).toBeGreaterThanOrEqual(seg.start)
        expect(seg.hpEnd).toBeLessThanOrEqual(seg.hpStart + 1e-12)
        if (i) expect(seg.start).toBeCloseTo(segments[i - 1].end, 9)
      }
      const last = segments[segments.length - 1]
      const lastEvent = events[events.length - 1]
      expect(Math.max(last.end, lastEvent?.t ?? 0)).toBeCloseTo(
        fight.seconds!,
        6
      )
      // each drop: a backlash or a horn break, as many as the breakdown says
      const count = (key: string) =>
        (fight.parts.find((p) => p.key === key) as { count?: number })?.count
      if (id === 1013061)
        expect(events.filter((e) => e.kind === 'backlash').length).toBe(
          count('valiant')
        )
      if (id === 1006063)
        expect(events.filter((e) => e.kind === 'hornsBreak').length).toBe(
          count('horns')
        )
      if (id === 1004062) expect(events).toEqual([])
    }
  })

  it('other bosses: their HP ÷ the DPS, noted', () => {
    const boss = stygianBoss(1004062)! // Battle-Hardened Lightkeeper (10% RES)
    const fight = stygianFight(boss, 'dire', team('pyro', 100000))
    expect(fight.seconds).toBeCloseTo(boss.hp.dire / 100000, 9)
    expect(fight.modelled).toBe(false)
    expect(fight.notes).toEqual(['mechanics'])
  })
})

describe('an enemy set by hand', () => {
  const custom = { enemyOverride: { enemyLevel: 100, pyro_enemyRes_: 60 } }
  it('takes its HP ÷ the team’s DPS, all its elements’', () => {
    const t: FightTeam = {
      dps: { pyro: 60_000, physical: 40_000 },
      baseRes: all(0.1),
      effRes: all(0.1),
    }
    const fight = customFight(20_000_000, t)
    expect(fight.seconds).toBeCloseTo(200)
    expect(fight.parts).toEqual([{ key: 'custom', dps: 100_000, seconds: 200 }])
    expect(fight.timeline.segments).toEqual([
      { start: 0, end: 200, state: 'regular', hpStart: 1, hpEnd: 0 },
    ])
    expect(fight.notes).toEqual([])
    // its HP set: that fight; none: no fight, no HP
    expect(
      enemyFight({ ...custom, enemyHp: 20_000_000 }, t)?.seconds
    ).toBeCloseTo(200)
    expect(enemyHpOf({ ...custom, enemyHp: 20_000_000 })).toBe(20_000_000)
    expect(enemyFight(custom, t)).toBeUndefined()
    expect(enemyHpOf(custom)).toBeUndefined()
  })
  it('is too slow to say past the limit, or without damage', () => {
    const slow = customFight(1e12, team('pyro', 1000))
    expect(slow.seconds).toBeUndefined()
    expect(slow.timeline.segments[0].end).toBe(FIGHT_LIMIT)
    expect(slow.timeline.segments[0].hpEnd).toBeGreaterThan(0.99)
    const none = customFight(1e6, {
      dps: {},
      baseRes: all(0.1),
      effRes: all(0.1),
    })
    expect(none.seconds).toBeUndefined()
    expect(none.parts).toEqual([])
  })
  it('is a Stygian boss’s HP and fight while its preset applies (a custom HP aside)', () => {
    const boss = stygianBoss(1013061)!
    const wavebinder = {
      enemyOverride: {
        enemyLevel: 110,
        ...Object.fromEntries(
          Object.entries(boss.phases.find((p) => p.key === boss.main)!.res).map(
            ([e, v]) => [
              `${e}_enemyRes_`,
              v === 'immune' ? Number.MAX_VALUE : v,
            ]
          )
        ),
      },
      enemyPreset: `stygian:1013061:${boss.main}`,
      enemyHp: 5,
    }
    expect(enemyHpOf(wavebinder)).toBe(boss.hp.dire)
    const t = team('hydro', 100_000)
    expect(enemyFight(wavebinder, t)).toEqual(stygianFight(boss, 'dire', t))
  })
})
