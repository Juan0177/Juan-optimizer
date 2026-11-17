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
  it('has both rotations, split in turns', () => {
    expect(d.a.rotation).toEqual(['Danica E', 'Yae Miko E E', 'Danica Q'])
    expect(d.b.rotation).toEqual(['Danica E', 'Mitya E Q'])
  })
  it('names the swap and the team', () => {
    expect(d.swap).toEqual({ out: 'Yae Miko', in: 'Mitya' })
    expect(d.name).toBe('Team X')
    expect(d.labels.delta).toBeTruthy()
  })
})
