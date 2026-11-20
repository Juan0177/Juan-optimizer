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
  MOONGECKO,
  DRIFTING_SNOW,
  DRIFTING_SNOW_BOSS,
  LION,
  LION_BOSS,
  LYSIS_BOSS,
  MOONGECKO_BOSS,
  OVERSEER_BOSS,
  resMultiplier,
  SCULPTOR,
  SCULPTOR_BOSS,
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
    expect(fight.notes).toContain('electroStun')
  })

  it('Wavebinder: Electro drains its Courage, shortening each Valiant State', () => {
    const boss = stygianBoss(1013061)!
    const slow = stygianFight(boss, 'dire', team('electro', 300000, {}))
    const fast = stygianFight(boss, 'dire', {
      ...team('electro', 300000),
      electroHits: { stellar: 0, units: 2, plain: 0 },
    })
    const length = (f: typeof slow) =>
      (f.parts.find((p) => p.key === 'valiant') as { seconds: number }).seconds
    // 600 Courage ÷ (15 + 8 × 1.5 × 2 per second)
    expect(length(fast)).toBeCloseTo(600 / 39, 9)
    expect(fast.seconds!).toBeLessThan(slow.seconds!)
  })

  it('Wavebinder: each Electro hit takes its Courage (stygian.moe, the game files: 6 Stellar Glimmer, 1.5 a unit applied, 0.6 none), 8× in its Valiant Assault', () => {
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
    const stellar = valiant({ stellar: 1, units: 0, plain: 0 })
    expect(stellar.part.seconds).toBeCloseTo(600 / 63, 9)
    expect(stellar.part.courage).toBeCloseTo(48, 9)
    expect(stellar.part.stellar).toBe(1)
    // 2 units of Electro applied and 5 hits without: 15 + 8 × (2 × 1.5 + 5 × 0.6) = 63
    expect(
      valiant({ stellar: 0, units: 2, plain: 5 }).part.seconds
    ).toBeCloseTo(600 / 63, 9)
    // in its Valiant Assault: 48 a Stellar Glimmer hit, 12 a 1U hit, 4.8 a hit applying none
    const inValiant = (h: Parameters<typeof courageDrain>[0]) =>
      COURAGE.valiant * courageDrain(h)
    expect(inValiant({ stellar: 1, units: 0, plain: 0 })).toBeCloseTo(48, 9)
    expect(inValiant({ stellar: 0, units: 1, plain: 0 })).toBeCloseTo(12, 9)
    expect(inValiant({ stellar: 0, units: 0, plain: 1 })).toBeCloseTo(4.8, 9)
    // its hits taken from the attacks entered: said so; none known: said so too
    expect(
      valiant({ stellar: 0, units: 1, plain: 2, estimated: true }).fight.notes
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

  it('Wavebinder: Radiance as it drinks (a Stellar Glimmer team) gives 540 Courage, so its Valiant Assault waits for the next drink', () => {
    const boss = stygianBoss(1013061)!
    const electroHits = { stellar: 0.5, units: 0.5, plain: 1 }
    const plainTeam = stygianFight(boss, 'dire', {
      ...team('electro', 300000),
      electroHits,
    })
    const stellarTeam = stygianFight(boss, 'dire', {
      ...team('electro', 300000),
      electroHits,
      stellarShare: 0.5,
    })
    const first = (f: typeof plainTeam) =>
      f.timeline.segments.find((s) => s.state === 'shielded')!.start
    // without: full at its first drink (10 s + 3 s)
    expect(first(plainTeam)).toBeCloseTo(13, 9)
    // with: 540 at its first drink, worn down by the hits until its next at 30 s, which fills it
    const drink1 = stellarTeam.timeline.segments.find(
      (s) => s.state === 'drinking'
    )!
    expect(drink1.meterEnd).toBeCloseTo(540, 9)
    const outside = courageDrain(electroHits)
    const atNext = 540 - outside * (30 - 13)
    expect(first(stellarTeam)).toBeCloseTo(30 + ((600 - atNext) / 540) * 3, 6)
    expect(
      stellarTeam.parts.find((p) => p.key === 'radianceDrinks')
    ).toBeDefined()
    expect(stellarTeam.notes).toContain('sip')
    // fewer Valiant Assaults in the fight: the Stellar Glimmer team's advantage
    const count = (f: typeof plainTeam) =>
      f.timeline.segments.filter((s) => s.state === 'shielded').length
    expect(count(stellarTeam)).toBeLessThan(count(plainTeam))
  })

  it('Wavebinder over time: its Courage fills over each 3 s drink and drains over each Valiant Assault', () => {
    const boss = stygianBoss(1013061)!
    const fight = stygianFight(boss, 'dire', {
      ...team('electro', 300000),
      electroHits: { stellar: 1, units: 1, plain: 2 },
    })
    const { segments, meter } = fight.timeline
    expect(meter).toEqual({ key: 'courage', max: 600 })
    const drinks = segments.filter((s) => s.state === 'drinking')
    const valiants = segments.filter((s) => s.state === 'shielded')
    expect(drinks.length).toBeGreaterThan(0)
    for (const d of drinks.slice(0, -1)) {
      expect(d.end - d.start).toBeCloseTo(3, 9)
      expect([d.meterStart, d.meterEnd]).toEqual([0, 600])
    }
    for (const v of valiants) {
      expect(v.meterStart).toBe(600)
      expect(v.meterEnd).toBeCloseTo(0, 9)
      expect(v.backlashRatio).toBeCloseTo(0.6, 9)
      // what its shield takes: the team's DPS at its Valiant RES
      expect(v.dps).toBeGreaterThan(0)
    }
    // every stretch has the team's DPS there, and a drink always comes before a Valiant Assault
    for (const [i, seg] of segments.entries()) {
      expect(seg.dps).toBeDefined()
      if (seg.state === 'shielded')
        expect(segments[i - 1]?.state).toBe('drinking')
    }
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
    // its horn gauge over time: 64U, gone as they break; none in the 10 s without them
    expect(fight.timeline.meter).toEqual({ key: 'hornGauge', max: 64 })
    const first = fight.timeline.segments[0]
    expect([first.state, first.meterStart, first.meterEnd]).toEqual([
      'horns',
      64,
      0,
    ])
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
      [MOONGECKO_BOSS, {}],
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
      if (id === MOONGECKO_BOSS)
        expect(events.filter((e) => e.kind === 'wardBreak').length).toBe(
          count('wardBreak')
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
      {
        start: 0,
        end: 200,
        state: 'regular',
        hpStart: 1,
        hpEnd: 0,
        dps: 100_000,
      },
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

describe('Radiant Moongecko (the game files’ Fearless/Dire values)', () => {
  const boss = stygianBoss(MOONGECKO_BOSS)!
  const hp = boss.hp.dire
  /** Half Geo, half Physical: 10% RES everywhere, as its Dull Carapace */
  const mixed = (extra: Partial<FightTeam> = {}): FightTeam => ({
    dps: { geo: 100000, physical: 100000 },
    baseRes: all(0.1),
    effRes: all(0.1),
    ...extra,
  })
  const states = (f: ReturnType<typeof stygianFight>) =>
    f.timeline.segments.map((s) => s.state)

  it('opens with its Anchor: the ward takes the damage, its HP untouched; broken, 70% of the Geo DMG and 10% of the rest come off it, then a 4.36 s stun', () => {
    const fight = stygianFight(boss, 'dire', mixed(), undefined, {
      wardSeconds: 10,
    })
    const [leap, ward, stun] = fight.timeline.segments
    expect(leap).toMatchObject({
      start: 0,
      end: MOONGECKO.entry,
      state: 'leap',
      hpStart: 1,
      hpEnd: 1,
      dps: 0,
    })
    expect(ward).toMatchObject({ state: 'ward', hpStart: 1, hpEnd: 1 })
    expect(ward.start).toBeCloseTo(2, 9)
    expect(ward.end).toBeCloseTo(12, 9)
    // its ward wears down from 9 layers to none
    expect(ward.meterStart).toBeCloseTo(9, 9)
    expect(ward.meterEnd).toBeCloseTo(0, 9)
    const [broken] = fight.timeline.events
    expect(broken.kind).toBe('wardBreak')
    expect(broken.t).toBeCloseTo(12, 9)
    expect(broken.hp).toBeCloseTo((0.7 * 1e6 + 0.1 * 1e6) / hp, 9)
    expect(stun.state).toBe('stunned')
    expect(stun.end - stun.start).toBeCloseTo(4.36, 9)
    expect(fight.notes).toContain('wardSet')
    expect(fight.modelled).toBe(true)
  })

  it('moves at most 40% of its Max HP off it when its ward breaks', () => {
    const fight = stygianFight(
      boss,
      'dire',
      mixed({ dps: { geo: 5e6 } }),
      undefined,
      { wardSeconds: 30 }
    )
    expect(fight.timeline.events[0].hp).toBeCloseTo(0.4, 9)
    expect(fight.parts.find((p) => p.key === 'wardBreak')).toMatchObject({
      capped: 1,
    })
  })

  it('roars 2 s after its stun: the cocoon (+60% Geo RES, the team’s cocooned DPS) until healed, then 15 s Disentangled, its next Anchor 40 s after the stun', () => {
    const fight = stygianFight(
      boss,
      'dire',
      mixed({
        healer: true,
        cocooned: { geo: 40000, physical: 40000 },
        disentangled: { geo: 150000, physical: 150000 },
      }),
      undefined,
      { wardSeconds: 10 }
    )
    const segs = fight.timeline.segments
    expect(states(fight).slice(0, 8)).toEqual([
      'leap',
      'ward',
      'stunned',
      'dullCarapace',
      'cocooned',
      'disentangled',
      'dullCarapace',
      'leap',
    ])
    const stunEnd = 12 + MOONGECKO.stun
    const [, , , before, cocoon, freed, after, next] = segs
    expect(before.end - before.start).toBeCloseTo(MOONGECKO.roar, 9)
    expect(cocoon.end - cocoon.start).toBeCloseTo(MOONGECKO.heal, 9)
    // the cocooned DPS, its Geo at 70% RES; Disentangled, at its Dull Carapace RES
    expect(cocoon.dps).toBeCloseTo(
      (40000 * resMultiplier(0.7)) / resMultiplier(0.1) + 40000,
      6
    )
    expect(freed.dps).toBeCloseTo(300000, 6)
    expect(freed.end - freed.start).toBeCloseTo(MOONGECKO.disentangled, 9)
    expect(after.dps).toBeCloseTo(200000, 6)
    expect(next.start).toBeCloseTo(stunEnd + MOONGECKO.stage, 9)
    expect(fight.notes).not.toContain('noHealer')
    expect(fight.notes).not.toContain('cocoonApprox')
  })

  it('without a healer, the team stays in its cocoon until the next Anchor', () => {
    const fight = stygianFight(boss, 'dire', mixed(), undefined, {
      wardSeconds: 10,
    })
    expect(states(fight).slice(3, 6)).toEqual([
      'dullCarapace',
      'cocooned',
      'leap',
    ])
    expect(fight.notes).toContain('noHealer')
    // (its DPS in the cocoon not computed: its own, at +60% Geo RES)
    expect(fight.notes).toContain('cocoonApprox')
  })

  it('a ward not broken in its 35 s: no HP off it, the Anchor’s blast, and all its RES up in the next cocoon', () => {
    const fight = stygianFight(boss, 'dire', mixed(), undefined, {
      wardSeconds: 60,
    })
    const [, ward, leap] = fight.timeline.segments
    expect(ward.end - ward.start).toBeCloseTo(MOONGECKO.window, 9)
    expect(leap.state).toBe('leap')
    expect(leap.end - leap.start).toBeCloseTo(MOONGECKO.blast, 9)
    expect(fight.timeline.events[0]).toMatchObject({ kind: 'blast', hp: 0 })
    expect(states(fight)).toContain('enhancedCocoon')
    expect(fight.parts.find((p) => p.key === 'anchors')).toMatchObject({
      broken: 0,
    })
  })

  it('takes the ward’s time as set, else the written rotation’s, else assumed', () => {
    const at = (t: FightTeam, settings?: { wardSeconds?: number }) =>
      stygianFight(boss, 'dire', t, undefined, settings).timeline.segments[1]
    const ward = (s: { start: number; end: number }) => s.end - s.start
    expect(ward(at(mixed({ wardSeconds: 8 })))).toBeCloseTo(8, 9)
    expect(ward(at(mixed({ wardSeconds: 8 }), { wardSeconds: 5 }))).toBeCloseTo(
      5,
      9
    )
    expect(ward(at(mixed()))).toBeCloseTo(MOONGECKO.wardDefault, 9)
    expect(
      stygianFight(boss, 'dire', mixed({ wardSeconds: 8 })).notes
    ).toContain('wardEstimated')
    expect(stygianFight(boss, 'dire', mixed()).notes).toContain('wardAssumed')
  })

  it('reads the team’s settings from its enemy', () => {
    const enemy = {
      enemyOverride: { enemyLevel: 110 },
      enemyPreset: `stygian:${MOONGECKO_BOSS}:regular`,
      fightSettings: { wardSeconds: 7, healSeconds: -1 },
    }
    // (its preset's RES: Geo 70%, the rest 10%)
    Object.assign(
      enemy.enemyOverride,
      Object.fromEntries(
        Object.entries(boss.phases.find((p) => p.key === 'regular')!.res).map(
          ([e, v]) => [`${e}_enemyRes_`, v]
        )
      )
    )
    const fight = enemyFight(enemy as never, mixed({ healer: true }))!
    expect(fight.timeline.segments[1].end).toBeCloseTo(9, 9)
    // (never healed, as set, though the team has a healer)
    expect(fight.notes).toContain('noHealer')
  })
})

describe('a fight that starts with no energy', () => {
  const boss = stygianBoss(1004062)! // Battle-Hardened Lightkeeper (10% RES)
  const hp = boss.hp.dire
  const opened = (over: Partial<FightTeam> = {}): FightTeam => ({
    ...team('pyro', 100000),
    // (its first 20 s without Bursts: half the DPS)
    opening: { dps: { pyro: 50000 }, seconds: 20 },
    ...over,
  })
  it('plays its first rotation at its own DPS, then the rotation as it repeats', () => {
    const fight = stygianFight(boss, 'dire', opened())
    expect(fight.seconds).toBeCloseTo(20 + (hp - 50000 * 20) / 100000, 6)
    expect(fight.timeline.segments[0]).toMatchObject({ end: 20, dps: 50000 })
    expect(fight.notes).toContain('opening')
  })
  it('starts with full energy when set so', () => {
    const fight = stygianFight(boss, 'dire', opened(), undefined, {
      fullEnergy: true,
    })
    expect(fight.seconds).toBeCloseTo(hp / 100000, 6)
    expect(fight.notes).not.toContain('opening')
  })
  it('the Moongecko: its first ward takes the opening’s damage', () => {
    const geo = (dps: number) => ({ geo: dps })
    const t: FightTeam = {
      dps: geo(200000),
      baseRes: all(0.1),
      effRes: all(0.1),
      opening: { dps: geo(100000), seconds: 12 },
    }
    const fight = stygianFight(
      stygianBoss(MOONGECKO_BOSS)!,
      'dire',
      t,
      undefined,
      { wardSeconds: 15 }
    )
    // (ward from 2 s to 17 s: 10 s of the opening, 5 s of the rotation)
    const recorded = 100000 * 10 + 200000 * 5
    expect(fight.timeline.events[0].hp).toBeCloseTo(
      (0.7 * recorded) / stygianBoss(MOONGECKO_BOSS)!.hp.dire,
      9
    )
  })
})

/** A looped rotation of `seconds`: its Radiance, active Nightsoul's Blessing, Cryo hits */
const cycle = (
  seconds: number,
  over: Partial<import('../components/enemy/stygianFights').FightCycle> = {}
) => ({ seconds, radiance: [], nightsoul: [], cryoHits: [], ...over })

describe('Secret Source Automaton: Overseer Device (the game files’ Fearless/Dire values)', () => {
  const boss = stygianBoss(OVERSEER_BOSS)!
  const part = (f: ReturnType<typeof stygianFight>) =>
    f.parts.find((p) => p.key === 'sweeper') as {
      count: number
      seconds: number
      stopped: number
      counterstrike: number
    }
  it('keeps its Sweeper RES (270%) without Cryo or Nightsoul, then its normal attacks at 80%', () => {
    const fight = stygianFight(boss, 'dire', {
      ...team('physical', 100000),
      cycle: cycle(10),
    })
    const p = part(fight)
    expect(p.stopped).toBe(0)
    expect(p.counterstrike).toBe(0)
    expect(fight.timeline.segments[0].state).toBe('enhanced')
    expect(
      fight.timeline.segments.find((s) => s.start >= 57.5 - 1e-9)?.state
    ).toBe('normalMode')
  })
  it('stops once Cryo outpaces its Flow Momentum: 3 hits/s from 32 (net −4/s), first at 10 or less ≈ 4.3 s into its loop', () => {
    // (one Cryo hit every 1/3 s)
    const hits = [0, 1, 2].map((i) => [i / 3, 1] as [number, number])
    const fight = stygianFight(boss, 'dire', {
      ...team('cryo', 100000),
      cycle: cycle(1, { cryoHits: hits }),
    })
    const stop = fight.timeline.segments.find((s) => s.state === 'lowEnergy')!
    // (14 hits by 4.33 s, −42, and 10 ticks, +20: at 10)
    expect(stop.start).toBeCloseTo(5 + 13 / 3, 6)
    // stopped once: its normal attacks after at 10%
    expect(
      fight.timeline.segments.find((s) => s.start >= 57.5 - 1e-9)?.state
    ).toBe('regular')
  })
  it('turns to Forced Counterstrike 18 s into its loop with Nightsoul’s Blessing kept from the start (10 a second)', () => {
    const fight = stygianFight(boss, 'dire', {
      ...team('pyro', 100000),
      cycle: cycle(10, { nightsoul: [[0, 10]] }),
    })
    const counter = fight.timeline.segments.find(
      (s) => s.state === 'nightsoul'
    )!
    expect(counter.start).toBeCloseTo(5 + 18, 0)
  })
})

describe('Battle-Hardened Domovoy Sculptor', () => {
  const boss = stygianBoss(SCULPTOR_BOSS)!
  it('turns each sculpting with Radiance on it into statues: 2 × 499,999 off it, 2 stacks then 3', () => {
    const fight = stygianFight(boss, 'fearless', {
      ...team('anemo', 100000),
      cycle: cycle(10, { radiance: [[0, 10]] }),
    })
    const statues = fight.timeline.events.filter((e) => e.kind === 'statue')
    expect(statues[0].t).toBeCloseTo(SCULPTOR.first + SCULPTOR.lead + 0.1, 9)
    expect(statues[0].hp).toBeCloseTo(999998 / boss.hp.fearless, 9)
    const states = fight.timeline.segments.map((s) => s.state)
    expect(states.slice(0, 3)).toEqual(['initial', 'stacks2', 'stacks3'])
  })
  it('stays at 90% RES without Radiance, nothing off it', () => {
    const fight = stygianFight(boss, 'fearless', {
      ...team('anemo', 100000),
      cycle: cycle(10),
    })
    expect(fight.timeline.events).toEqual([])
    expect(new Set(fight.timeline.segments.map((s) => s.state))).toEqual(
      new Set(['initial'])
    )
    // (90% RES: ×1/(4·0.9+1) of the 10% damage)
    const dps = (100000 * (1 / 4.6)) / 0.9
    expect(fight.seconds).toBeCloseTo(boss.hp.fearless / dps, 3)
  })
  it('lets its stacks lapse 30 s after the last statues', () => {
    // (Radiance in the first two sculptings' windows only)
    const fight = stygianFight(boss, 'dire', {
      ...team('anemo', 50000),
      cycle: cycle(600, { radiance: [[8, 30]] }),
    })
    const lapse = fight.timeline.segments.find(
      (s, i) => i > 0 && s.state === 'initial'
    )!
    expect(lapse.start).toBeCloseTo(
      SCULPTOR.first + SCULPTOR.cadence + 1.1 + 30,
      6
    )
  })
})

describe('Guardian Blade of Drifting Snow', () => {
  const boss = stygianBoss(DRIFTING_SNOW_BOSS)!
  const hp = boss.hp.fearless
  it('holds its HP at 81% for its first Ice Coffin', () => {
    const fight = stygianFight(boss, 'fearless', team('physical', 100000, {}))
    const first = fight.timeline.segments[0]
    expect(first.hpEnd).toBeCloseTo(DRIFTING_SNOW.trigger, 9)
    expect(first.end).toBeCloseTo((0.19 * hp) / 100000, 6)
  })
  it('breaks its ward with Pyro (2 units each): 10% off it, then 10 s at −40%', () => {
    // (2U Pyro a second: 100 durability a second, 10.5 s)
    const fight = stygianFight(
      boss,
      'fearless',
      team('pyro', 100000, { pyro: 2 })
    )
    const coffin = fight.timeline.segments.find((s) => s.state === 'warded')!
    expect(coffin.end - coffin.start).toBeCloseTo(10.5, 6)
    expect(fight.timeline.events[0]).toMatchObject({ kind: 'backlash' })
    expect(fight.timeline.events[0].hp).toBeCloseTo(0.1, 9)
    const weak = fight.timeline.segments.find((s) => s.state === 'stunned')!
    expect(weak.end - weak.start).toBeCloseTo(10, 6)
  })
  it('gets 10% back from a coffin not broken in 20 s', () => {
    const fight = stygianFight(boss, 'fearless', team('physical', 100000, {}))
    const heal = fight.timeline.events.find((e) => e.kind === 'heal')!
    expect(heal.hp).toBeCloseTo(-0.1, 9)
  })
  it('turns its ward to a shield of 15% of its HP under Radiance; broken: 10% and 60% of it off', () => {
    const fight = stygianFight(boss, 'fearless', {
      ...team('electro', 300000, {}),
      cycle: cycle(10, { radiance: [[0, 10]] }),
    })
    const shield = fight.timeline.segments.find((s) => s.state === 'barrier')!
    expect(shield.end - shield.start).toBeCloseTo((0.15 * hp) / 300000, 6)
    expect(fight.timeline.events[0].hp).toBeCloseTo(0.1 + 0.6 * 0.15, 9)
  })
})

describe('Chimeric Winged Lion', () => {
  const boss = stygianBoss(LION_BOSS)!
  it('breaks its Electro Ward with Cryo (1000 durability, 25 a unit), its backlash 30% of what it took', () => {
    // (1U Cryo a second: 40 s)
    const fight = stygianFight(
      boss,
      'fearless',
      team('cryo', 100000, { cryo: 1 })
    )
    const end = fight.timeline.segments.find(
      (s) => s.state === 'stunned'
    )!.start
    expect(end - LION.opening).toBeCloseTo(40, 6)
    const absorbed = 100000 * 40
    expect(fight.timeline.events[0].hp).toBeCloseTo(
      (0.3 * absorbed) / boss.hp.fearless,
      9
    )
    const stun = fight.timeline.segments.find((s) => s.state === 'stunned')!
    expect(stun.end - stun.start).toBeCloseTo(LION.paralysis, 6)
  })
  it('never takes damage while its ward holds (no reactions)', () => {
    const fight = stygianFight(boss, 'fearless', team('physical', 100000, {}))
    expect(fight.seconds).toBeUndefined()
  })
  it('turns its shockwave on its ward under Radiance: 400 off 2.1 s after', () => {
    const fight = stygianFight(boss, 'fearless', {
      ...team('cryo', 100000, { cryo: 0.5 }),
      cycle: cycle(10, { radiance: [[0, 10]] }),
    })
    const part = fight.parts.find((p) => p.key === 'electroWards') as {
      backfires: number
    }
    expect(part.backfires).toBeGreaterThan(0)
    const ward = fight.timeline.segments.find(
      (s) =>
        s.state === 'warded' &&
        Math.abs(s.end - (LION.shockFirst + LION.shockDelay)) < 1e-6
    )!
    const next =
      fight.timeline.segments[fight.timeline.segments.indexOf(ward) + 1]
    expect(ward.meterEnd! - next.meterStart!).toBeCloseTo(LION.shockWear, 6)
  })
})

describe('Secret Source Automaton: Lysis Shears', () => {
  const boss = stygianBoss(LYSIS_BOSS)!
  it('fills its countermeasures on their own in 100 s; its shield’s backlash 50% of what it took', () => {
    const fight = stygianFight(boss, 'fearless', team('physical', 100000, {}))
    const p = fight.parts.find((x) => x.key === 'countermeasures') as {
      seconds: number
    }
    expect(p.seconds).toBe(100)
    // (110% RES: ×1/5.4 of the 10% damage)
    const absorbed = (100000 / 5.4 / 0.9) * 100
    expect(fight.timeline.events[0].hp).toBeCloseTo(
      (0.5 * absorbed) / boss.hp.fearless,
      9
    )
    expect(fight.timeline.events[1]).toMatchObject({ kind: 'hpLoss', hp: 0.15 })
  })
  it('fills in 40 s with a member in Nightsoul’s Blessing throughout (5 a second)', () => {
    const fight = stygianFight(boss, 'fearless', {
      ...team('pyro', 100000, {}),
      cycle: cycle(10, { anyNightsoul: [[0, 10]], nightsoulEntries: [] }),
    })
    const p = fight.parts.find((x) => x.key === 'countermeasures') as {
      seconds: number
    }
    expect(p.seconds).toBe(40)
  })
})
