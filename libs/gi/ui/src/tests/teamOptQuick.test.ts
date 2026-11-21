import {
  type ArtifactSetKey,
  type ArtifactSlotKey,
  allArtifactSlotKeys,
} from '@genshin-optimizer/gi/consts'
import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import type { ArtifactsBySlot } from '@genshin-optimizer/gi/solver'
import { preprocess, solveLocal } from '@genshin-optimizer/gi/solver'
import {
  dynRead,
  frac,
  max,
  min,
  prod,
  res,
  sum,
  threshold,
} from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { quickPool } from '../util/teamOpt/prefilter'

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const sets = [
  'GladiatorsFinale',
  'WanderersTroupe',
  'NoblesseOblige',
  'ViridescentVenerer',
  'EmblemOfSeveredFate',
  'CrimsonWitchOfFlames',
  'BlizzardStrayer',
] as ArtifactSetKey[]
const [A, B, C, D] = sets
const r = (key: string) => dynRead(key)

type Art = ICachedArtifact & { stats: Record<string, number> }

function makeArts(rand: () => number, perSlot: number): Art[] {
  const arts: Art[] = []
  const q = (x: number) => Math.round(x * 16) / 16
  for (const slot of allArtifactSlotKeys)
    for (let i = 0; i < perSlot; i++) {
      const setKey = sets[Math.floor(rand() * sets.length)]
      const stats: Record<string, number> = { [setKey]: 1 }
      if (rand() < 0.6) stats['atk_'] = q(rand() * 0.3)
      if (rand() < 0.4) stats['atk'] = Math.round(rand() * 120)
      if (rand() < 0.55) stats['cr'] = q(rand() * 0.25)
      if (rand() < 0.55) stats['cd'] = q(rand() * 0.5)
      if (rand() < 0.45) stats['er'] = q(rand() * 0.35)
      if (rand() < 0.4) stats['em'] = Math.round(rand() * 120)
      let mainStatKey = slot === 'flower' ? 'hp' : 'atk'
      const main = (key: string, value: number) => {
        stats[key] = value
        mainStatKey = key
      }
      if (slot === 'sands')
        rand() < 0.6 ? main('atk_', 0.466) : main('er', 0.518)
      if (slot === 'goblet')
        rand() < 0.6 ? main('dmg_', 0.466) : main('atk_', 0.466)
      if (slot === 'circlet') {
        const x = rand()
        if (x < 0.35) main('cr', 0.311)
        else if (x < 0.7) main('cd', 0.622)
        else main('atk_', 0.466)
      }
      arts.push({
        id: `${slot}${i}`,
        slotKey: slot as ArtifactSlotKey,
        setKey,
        mainStatKey,
        stats,
      } as Art)
    }
  return arts
}

/** A team-like formula: multiplicative damage, crit cap, 2- and 4-piece bonuses, EM, ER need */
function formula() {
  const atk = sum(
    prod(1000, sum(1, r('atk_'), threshold(r(A), 2, 0.18, 0))),
    r('atk')
  )
  const critRate = min(
    max(sum(0.05, r('cr'), threshold(r(D), 4, 0.2, 0)), 0),
    1
  )
  const critMult = sum(1, prod(critRate, sum(0.5, r('cd'))))
  const dmgBonus = sum(
    1,
    r('dmg_'),
    threshold(r(A), 4, 0.35, 0),
    threshold(r(B), 2, 0.2, 0),
    threshold(r(D), 2, 0.15, 0)
  )
  const enemyRes = res(sum(0.1, threshold(r(C), 4, -0.4, 0)))
  const reaction = prod(1500, sum(1, prod(2.78, frac(r('em'), 1400))))
  const target = sum(
    prod(atk, critMult, dmgBonus, enemyRes),
    prod(0.3, reaction)
  )
  const er = sum(1, r('er'), threshold(r(C), 2, 0.2, 0))
  return { target, er }
}

function exactBest(arts: Art[], erMin: number) {
  const { target, er } = formula()
  const keys = ['atk_', 'atk', 'cr', 'cd', 'er', 'em', 'dmg_', ...sets]
  const values = Object.fromEntries(
    allArtifactSlotKeys.map((slot) => [
      slot,
      arts
        .filter((a) => a.slotKey === slot)
        .map((a) => ({ id: a.id, set: a.setKey, values: a.stats })),
    ])
  ) as ArtifactsBySlot['values']
  const setup = preprocess({
    arts: { base: Object.fromEntries(keys.map((k) => [k, 0])), values },
    optimizationTarget: target,
    constraints: [{ value: er, min: erMin }],
    exclusion: {},
    topN: 1,
  })
  const best = solveLocal(setup, {}).builds[0]
  return best && { value: best.value, ids: best.artifactIds }
}

const SEEDS = Number(process.env['SEEDS'] ?? 40)
describe('Team optimize Quick search', () => {
  it('rarely misses the best build, and then by little', async () => {
    const gaps: number[] = []
    let narrowed = 0
    for (let seed = 1; seed <= SEEDS; seed++) {
      const rand = rng(seed)
      const arts = makeArts(rand, Number(process.env['PER_SLOT'] ?? 70))
      const erMin = 1.2 + rand() * 0.6
      const fullBuild = exactBest(arts, erMin)
      const full = fullBuild?.value
      const { target, er } = formula()
      const {
        arts: pool,
        seed: qseed,
        refine,
      } = await quickPool({
        arts,
        objective: target,
        constraints: [{ value: er, min: erMin }],
        values: (a) => (a as Art).stats,
        allowed: () => true,
      })
      narrowed += pool.length / arts.length
      const first = exactBest(pool as Art[], erMin)
      const byIdAll = new Map(arts.map((a) => [a.id, a]))
      const wider =
        first && (await refine(first.ids.map((id) => byIdAll.get(id)!)))
      const second = wider && exactBest(wider as Art[], erMin)
      const quickBuild =
        second && first && second.value > first.value ? second : first
      const quick = quickBuild?.value
      if (
        process.env['DEBUG'] &&
        full !== undefined &&
        quick !== undefined &&
        full - quick > 1e-9
      ) {
        const inPool = new Set(pool.map((a) => a.id))
        const byId = new Map(arts.map((a) => [a.id, a]))
        console.log(
          JSON.stringify({
            seed,
            erMin: +erMin.toFixed(3),
            full: Math.round(full),
            quick: Math.round(quick),
            seedValue: Math.round(qseed?.value ?? 0),
            seedSets: qseed?.arts.map((a) => a.setKey.slice(0, 4)),
            best: fullBuild!.ids.map((id) => ({
              id,
              set: byId.get(id)!.setKey.slice(0, 4),
              kept: inPool.has(id),
              stats: byId.get(id)!.stats,
            })),
            quickSets: quickBuild!.ids.map((id) =>
              byId.get(id)!.setKey.slice(0, 4)
            ),
          })
        )
      }
      if (full === undefined) {
        expect(quick).toBeUndefined()
        continue
      }
      gaps.push(quick === undefined ? 1 : (full - quick) / full)
    }
    const missed = gaps.filter((g) => g > 1e-9)
    console.log(
      `Quick: kept ${((narrowed / SEEDS) * 100).toFixed(0)}% of artifacts; missed ${missed.length}/${gaps.length}, worst ${(Math.max(0, ...gaps) * 100).toFixed(3)}%`
    )
    expect(missed.length).toBeLessThanOrEqual(Math.ceil(gaps.length * 0.05))
    expect(Math.max(0, ...gaps)).toBeLessThan(0.01)
  }, 600_000)
})
