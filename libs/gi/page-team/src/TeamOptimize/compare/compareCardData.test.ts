import { describe, expect, it } from 'vitest'
import { formatDamage } from '../format'
import { compareCardData } from './compareCardData'
import type { Side } from './compareSwapKqm'

const side = (over: Partial<Side>, keys: [string, number][]): Side => ({
  dpr: 100000,
  dps: 5000,
  rotationTime: 20,
  rotation: 'Danica E -> Yae Miko E E -> Danica Q',
  members: keys.map(([key, damage]) => ({
    key: key as never,
    damage,
    share: damage / 100000,
    er: 120,
    erValue: 121.4,
    constellation: key === 'Danica' ? 2 : 0,
    fixed: key === 'Danica',
  })),
  ...over,
})
const a = side({}, [
  ['Danica', 60000],
  ['YaeMiko', 40000],
])
const b = side({ dpr: 110000, dps: 5500, rotation: 'Danica E -> Mitya E Q' }, [
  ['Danica', 60000],
  ['Mitya', 50000],
])
const ctx = {
  teamName: 'Team X',
  outName: 'Yae Miko',
  inName: 'Mitya',
  gender: 'F' as const,
  t: ((k: string) => k.split(':').pop() ?? k) as never,
}

describe('compareCardData', () => {
  const d = compareCardData(a, b, ctx)
  it('formats DPR and DPS with formatDamage', () => {
    expect(d.a.total).toBe(formatDamage(100000))
    expect(d.b.total).toBe(formatDamage(110000))
    expect(d.a.dps).toBe(formatDamage(5000))
    expect(d.b.dps).toBe(formatDamage(5500))
    expect(d.delta.dpr).toBe('+10%')
  })
  it('keeps shares as 0..1 and ER as a percent', () => {
    expect(d.a.members.map((m) => m.share)).toEqual([0.6, 0.4])
    expect(d.b.members[1].share).toBe(0.5)
    expect(d.a.members[0].er).toBe('121%')
  })
  it('shows both the ER the build reaches and the ER required, labelled apart', () => {
    expect(d.a.members[0].er).toBe('121%')
    expect(d.a.members[0].erTarget).toBe('120%')
    expect(d.labels.er).toBe('kqmCompare.card.erBuild')
    expect(d.labels.erTarget).toBe('kqmCompare.card.erTarget')
    expect(d.a.labels.er).toBe('kqmCompare.card.erBuild')
    expect(d.a.labels.erTarget).toBe('kqmCompare.card.erTarget')
  })
  it('has both rotations, split in turns', () => {
    expect(d.a.rotation).toEqual(['Danica E', 'Yae Miko E E', 'Danica Q'])
    expect(d.b.rotation).toEqual(['Danica E', 'Mitya E Q'])
  })
  it('cuts turns at every separator the parser reads, and at bare names', () => {
    const named = {
      ...ctx,
      t: ((k: string) =>
        k === 'charNames_gen:YaeMiko'
          ? 'Yae Miko'
          : (k.split(':').pop() ?? k)) as never,
    }
    const r = compareCardData(
      {
        ...a,
        rotation: 'Danica E > Yae Miko E E => Danica Q, Yae Miko E; Danica E',
      },
      { ...b, rotation: 'Danica E Mitya E Q\nDanica Q' },
      named
    )
    expect(r.a.rotation).toEqual([
      'Danica E',
      'Yae Miko E E',
      'Danica Q',
      'Yae Miko E',
      'Danica E',
    ])
    expect(r.b.rotation).toEqual(['Danica E', 'Mitya E Q', 'Danica Q'])
  })
  it('names the swap and the team', () => {
    expect(d.swap).toEqual({ out: 'Yae Miko', in: 'Mitya' })
    expect(d.name).toBe('Team X')
    expect(d.labels.delta).toBeTruthy()
  })

  it('carries constellations', () => {
    expect(d.a.members.map((m) => m.constellation)).toEqual([2, 0])
  })
  it('names the weapon and sets of a member with a build', () => {
    const withBuild = side({}, [['Danica', 100000]])
    withBuild.members[0].build = {
      weapon: { key: 'WanderingEvenstar', refinement: 5 },
      sets: { GildedDreams: 4 },
    } as never
    const m = compareCardData(withBuild, b, ctx).a.members[0]
    expect(m.weapon.name).toBe('WanderingEvenstar')
    expect(m.weapon.refinement).toBe(5)
    expect(m.sets.map((x) => x.name)).toEqual(['GildedDreams'])
    // (no build: no gear)
    expect(d.a.members[0].weapon.name).toBe('')
    expect(d.a.members[0].sets).toEqual([])
  })
  it('has no DPS or time when the rotation has no length', () => {
    const r = compareCardData(
      { ...a, rotationTime: 0, dps: 0 },
      { ...b, rotationTime: 0, dps: 0 },
      ctx
    )
    expect(r.a.dps).toBeUndefined()
    expect(r.a.seconds).toBeUndefined()
    expect(r.delta.dps).toBe('–')
  })
  it('shows a dash for the change from nothing', () => {
    const r = compareCardData({ ...a, dpr: 0, dps: 0 }, b, ctx)
    expect(r.delta).toEqual({ dpr: '–', dps: '–' })
  })
})
