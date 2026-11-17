import { describe, expect, it } from 'vitest'
import { formatRateFull } from '../format'
import { compareCardData, compareCardRecord } from './compareCardData'
import type { Side } from './compareSwapKqm'

const build = (weapon: string) =>
  ({
    weapon: { key: weapon, refinement: 5 },
    sets: { GildedDreams: 4 },
    mains: {},
    rolls: {},
  }) as never
const side = (
  over: Partial<Side>,
  keys: [string, number, Partial<Side['members'][number]>?][]
): Side => ({
  dpr: 100000,
  dps: 5000,
  rotationTime: 20,
  rotation: 'Danica E -> Yae Miko E E -> Danica Q',
  talents: 9,
  members: keys.map(([key, damage, m]) => ({
    key: key as never,
    damage,
    share: damage / 100000,
    er: 120,
    erValue: 121.4,
    constellation: key === 'Danica' ? 2 : 0,
    fixed: key === 'Danica',
    build: build('WanderingEvenstar'),
    fieldTime: 50,
    ...m,
  })),
  ...over,
})
const a = side({ turn: 1 }, [
  ['Danica', 60000],
  ['YaeMiko', 40000],
])
const b = side(
  {
    dpr: 110000,
    dps: 5000,
    rotationTime: 22,
    rotation: 'Danica E -> Mitya E Q',
    turn: 1,
  },
  [
    ['Danica', 50000, { er: 130, erValue: 125, share: 50000 / 110000 }],
    ['Mitya', 60000, { er: 120, share: 60000 / 110000, fieldTime: 40 }],
  ]
)
const names: Record<string, string> = {
  'charNames_gen:YaeMiko': 'Yae Miko',
  'charNames_gen:Mitya': 'Mitya',
  'charNames_gen:Danica': 'Danica',
}
const ctx = {
  teamName: 'Team X',
  out: 'YaeMiko' as never,
  in: 'Mitya' as never,
  gender: 'F' as const,
  siteName: 'stamp',
  t: ((k: string, o?: { value?: string }) =>
    names[k] ??
    `${k.split(/[:.]/).pop() ?? k}${o?.value ? `(${o.value})` : ''}`) as never,
}

describe('compareCardData', () => {
  const d = compareCardData(a, b, ctx)
  it('draws both sides as the KQM sheet does: its figures, names and labels', () => {
    expect(d.a.card.total).toBe(formatRateFull(100000, undefined))
    expect(d.b.card.total).toBe(formatRateFull(110000, undefined))
    expect(d.a.card.dps).toBe(formatRateFull(100000, 20))
    expect(d.b.card.seconds).toBe('seconds')
    expect(d.a.card.members.map((m) => m.name)).toEqual(['Danica', 'Yae Miko'])
    expect(d.a.card.members[0].weapon).toMatchObject({
      name: 'WanderingEvenstar',
      refinement: 5,
    })
    expect(d.a.card.members[0].sets.map((s) => s.name)).toEqual([
      'GildedDreams',
    ])
    expect(d.a.card.members.map((m) => m.constellation)).toEqual([2, 0])
    expect(d.a.card.members.map((m) => m.share)).toEqual([0.6, 0.4])
    expect(d.a.card.notes).toBe('standard')
    expect(d.a.card.labels.siteName).toBe('stamp')
    expect(d.siteName).toBe('stamp')
  })
  it('takes the field time from the ER calculator, on each side its own rotation', () => {
    expect(d.a.card.members.map((m) => m.field)).toEqual(['10.0s', '10.0s'])
    expect(d.b.card.members.map((m) => m.field)).toEqual(['11.0s', '8.8s'])
    // (against A's: the swapped member against the one it replaced)
    expect(d.b.marks.field?.map((c) => c?.note)).toEqual(['+1.0s', '−1.2s'])
  })
  it('shows the ER the build reaches over the ER required, labelled apart', () => {
    expect(d.a.card.members[0].er).toBe('121% / 120%')
    expect(d.b.card.members[0].er).toBe('125% / 130%')
    expect(d.a.card.labels.er).toBe('erBuild\nerTarget')
  })
  it('marks the change of the ER required, and a build below it', () => {
    expect(d.b.marks.er?.[0]).toEqual({
      tone: 'warn',
      warn: true,
      note: '120% → 130%',
      noteTone: 'worse',
    })
    expect(d.b.marks.er?.[1]).toBeUndefined()
    expect(d.a.marks.er).toEqual([undefined, undefined])
  })
  it('gives each of B’s members its damage change against A, the swapped one against the replaced', () => {
    expect(d.b.marks.delta?.members.map((c) => c.text)).toEqual([
      '−17%',
      '+50%',
    ])
    expect(d.b.marks.delta?.members.map((c) => c.tone)).toEqual([
      'worse',
      'better',
    ])
    expect(d.b.marks.delta?.total).toEqual({ text: '+10%', tone: 'better' })
    expect(d.b.marks.delta?.dps).toEqual({ text: '±0%', tone: undefined })
    expect(d.b.marks.share?.map((c) => c?.note)).toEqual([
      'sharePoints(−14.5)',
      'sharePoints(+14.5)',
    ])
  })
  it('marks the swap: its member on both sheets, its step in both rotations', () => {
    expect(d.a.marks).toMatchObject({
      tag: 'A',
      changed: { index: 1, badge: 'out' },
      rotationTurn: 1,
    })
    expect(d.b.marks).toMatchObject({
      tag: 'B',
      changed: { index: 1, badge: 'Yae Miko → Mitya' },
      rotationTurn: 1,
    })
    expect(d.a.card.rotation).toEqual(['Danica E', 'Yae Miko E E', 'Danica Q'])
    expect(d.b.card.rotation).toEqual(['Danica E', 'Mitya E Q'])
  })
  it('heads the card with the swap and the team’s changes', () => {
    expect(d.name).toBe('Team X')
    expect(d.swap).toEqual({ out: 'Yae Miko', in: 'Mitya' })
    expect(d.delta.dpr).toEqual({ text: '↑ +10%', tone: 'better' })
    expect(d.delta.dps).toEqual({ text: '±0%', tone: undefined })
    expect(d.delta.rotationTime).toEqual({
      text: '20s → 22s',
      tone: 'worse',
    })
    expect(d.b.marks.seconds).toEqual({ note: '+2.0s', noteTone: 'worse' })
  })
  it('marks the swapped step by its position, however it is written (a nickname, another language)', () => {
    // (the turn as the comparison found it: not looked up by the member's name)
    const r = compareCardData(
      { ...a, rotation: 'Danica E -> Yae E E E -> Danica Q', turn: 1 },
      { ...b, rotation: 'Danica E -> Mitya E Q', turn: 1 },
      ctx
    )
    expect(r.a.card.rotation).toEqual(['Danica E', 'Yae E E E', 'Danica Q'])
    expect(r.a.marks.rotationTurn).toBe(1)
    expect(r.b.marks.rotationTurn).toBe(1)
    // (none known: none marked, even where a turn starts with the member's name)
    const none = compareCardData(
      { ...a, turn: undefined },
      { ...b, turn: undefined },
      ctx
    )
    expect(none.a.marks.rotationTurn).toBeUndefined()
    expect(none.b.marks.rotationTurn).toBeUndefined()
  })
  it('cuts turns at every separator the parser reads, and at bare names', () => {
    const r = compareCardData(
      {
        ...a,
        rotation: 'Danica E > Yae Miko E E => Danica Q, Yae Miko E; Danica E',
      },
      { ...b, rotation: 'Danica E Mitya E Q\nDanica Q' },
      ctx
    )
    expect(r.a.card.rotation).toEqual([
      'Danica E',
      'Yae Miko E E',
      'Danica Q',
      'Yae Miko E',
      'Danica E',
    ])
    expect(r.b.card.rotation).toEqual(['Danica E', 'Mitya E Q', 'Danica Q'])
  })
  it('has no DPS, time or field when the rotation has no length', () => {
    const r = compareCardData(
      { ...a, rotationTime: 0, dps: 0 },
      { ...b, rotationTime: 0, dps: 0 },
      ctx
    )
    expect(r.a.card.dps).toBeUndefined()
    expect(r.a.card.seconds).toBeUndefined()
    expect(r.a.card.members[0].field).toBeUndefined()
    expect(r.delta.dps).toBeUndefined()
    expect(r.delta.rotationTime).toBeUndefined()
  })
  it('shows a dash for the change from nothing', () => {
    const r = compareCardData({ ...a, dpr: 0, dps: 0 }, b, ctx)
    expect(r.delta.dpr).toEqual({ text: '–' })
  })
  it('is beta only with unreleased content', () => {
    expect(d.beta).toBeUndefined()
    expect(d.a.card.beta).toBeUndefined()
  })
  it('records how the card was made', () => {
    const rec = compareCardRecord({
      teamId: 't1',
      teamName: 'Team X',
      gender: 'F',
      out: 'YaeMiko',
      inKey: 'Mitya',
      a,
      b,
    })
    expect(rec).toMatchObject({
      app: 'Juan-optimizer',
      picture: 'kqmCompare',
      team: { id: 't1', name: 'Team X' },
      swap: { out: 'YaeMiko', in: 'Mitya' },
      a: { dpr: 100000, rotationTime: 20 },
      b: { dpr: 110000, rotationTime: 22 },
    })
    expect(rec.b.members[1]).toMatchObject({ key: 'Mitya', fieldTime: 40 })
  })
})
