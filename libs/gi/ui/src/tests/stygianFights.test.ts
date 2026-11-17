import { describe, expect, it } from 'vitest'
import { stygianBoss } from '../components/enemy/stygianBosses'
import type { FightTeam } from '../components/enemy/stygianFights'
import {
  dpsAt,
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
    expect(backlash.hp).toBeCloseTo(each * backlash.count, 9)
    // more than its HP ÷ the DPS: the Valiant States' 40 s are its shield's
    expect(fight.seconds!).toBeGreaterThan(hp / 300000)
    expect(fight.notes).toContain('stellarGlimmer')
  })

  it('Wavebinder: Electro drains its Courage, shortening each Valiant State', () => {
    const boss = stygianBoss(1013061)!
    const slow = stygianFight(boss, 'dire', team('electro', 300000, {}))
    const fast = stygianFight(
      boss,
      'dire',
      team('electro', 300000, { electro: 2 })
    )
    const length = (f: typeof slow) =>
      (f.parts.find((p) => p.key === 'valiant') as { seconds: number }).seconds
    // 600 Courage ÷ (15 + 8 × 1.5 × 2 per second)
    expect(length(fast)).toBeCloseTo(600 / 39, 9)
    expect(fast.seconds!).toBeLessThan(slow.seconds!)
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

  it('other bosses: their HP ÷ the DPS, noted', () => {
    const boss = stygianBoss(1004062)! // Battle-Hardened Lightkeeper (10% RES)
    const fight = stygianFight(boss, 'dire', team('pyro', 100000))
    expect(fight.seconds).toBeCloseTo(boss.hp.dire / 100000, 9)
    expect(fight.modelled).toBe(false)
    expect(fight.notes).toEqual(['mechanics'])
  })
})
