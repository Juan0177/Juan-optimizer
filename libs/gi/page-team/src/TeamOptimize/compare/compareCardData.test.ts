import type { KqmMemberStats } from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { formatRateFull } from '../format'
import {
  compareCardData,
  compareCardRecord,
  swapLabel,
} from './compareCardData'
import type { Side } from './sides'

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
const a = side({ turns: [1] }, [
  ['Danica', 60000],
  ['YaeMiko', 40000],
])
const b = side(
  {
    dpr: 110000,
    dps: 5000,
    rotationTime: 22,
    rotation: 'Danica E -> Mitya E Q',
    turns: [1],
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
  pairs: [{ out: 'YaeMiko', in: 'Mitya' }] as never,
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
  it('says the artifacts’ rolls beside KQM’s talents, by the standard’s own name', () => {
    const seen: [string, Record<string, unknown> | undefined][] = []
    const tSeen = ((k: string, o?: Record<string, unknown>) => {
      seen.push([k, o])
      return `${k.split(/[:.]/).pop()}${o?.['standard'] ? `(${o['standard']})` : ''}`
    }) as never
    const great = { ...a, artifacts: { standard: 'great' as const } }
    const mixed = {
      ...b,
      artifacts: { standard: 'great' as const, memberStandards: { Mitya: 'perfect' as const } },
    }
    const d = compareCardData(great, mixed, { ...ctx, t: tSeen })
    // (the standards' names from KQM Theorycrafting's texts, the line from Juan-optimizer's)
    expect(d.a.card.notes).toBe('standardRolls(tierGreat)')
    expect(d.b.card.notes).toBe('standardRolls(standardMixed)')
    expect(seen.map(([k]) => k)).toContain('page_team:teamOpt.kqm.tierGreat')
    expect(seen.find(([k]) => k === 'juanlab:card.standardRolls')?.[1]).toMatchObject({
      talents: '9/9/9',
    })
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
      changed: [{ index: 1, badge: 'out' }],
      rotationTurn: [1],
    })
    expect(d.b.marks).toMatchObject({
      tag: 'B',
      changed: [{ index: 1, badge: 'Yae Miko → Mitya' }],
      rotationTurn: [1],
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
      { ...a, rotation: 'Danica E -> Yae E E E -> Danica Q', turns: [1] },
      { ...b, rotation: 'Danica E -> Mitya E Q', turns: [1] },
      ctx
    )
    expect(r.a.card.rotation).toEqual(['Danica E', 'Yae E E E', 'Danica Q'])
    expect(r.a.marks.rotationTurn).toEqual([1])
    expect(r.b.marks.rotationTurn).toEqual([1])
    // (none known: none marked, even where a turn starts with the member's name)
    const none = compareCardData(
      { ...a, turns: undefined },
      { ...b, turns: undefined },
      ctx
    )
    expect(none.a.marks.rotationTurn).toEqual([])
    expect(none.b.marks.rotationTurn).toEqual([])
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
      pairs: [{ out: 'YaeMiko', in: 'Mitya' }],
      a,
      b,
    })
    expect(rec).toMatchObject({
      app: 'Juan-optimizer',
      picture: 'kqmCompare',
      team: { id: 't1', name: 'Team X' },
      swaps: [{ out: 'YaeMiko', in: 'Mitya' }],
      a: { dpr: 100000, rotationTime: 20 },
      b: { dpr: 110000, rotationTime: 22 },
    })
    expect(rec.b.members[1]).toMatchObject({ key: 'Mitya', fieldTime: 40 })
  })
})

describe('compareCardData: a version with several members changed, or none', () => {
  const four = (over: Partial<Side>, keys: string[]) =>
    side(
      over,
      keys.map((k) => [k, 25000] as [string, number])
    )
  const a4 = four(
    { rotation: 'Danica E -> Yae Miko E E -> Odette E -> Anastasya Q' },
    ['Danica', 'YaeMiko', 'Odette', 'Anastasya']
  )
  const b4 = four(
    {
      rotation: 'Danica E -> Mitya E Q -> Bennett E -> Anastasya Q',
      turns: [1, 2],
    },
    ['Danica', 'Mitya', 'Bennett', 'Anastasya']
  )
  const pairs = [
    { out: 'YaeMiko', in: 'Mitya' },
    { out: 'Odette', in: 'Bennett' },
  ] as never
  const named = {
    ...ctx,
    t: ((k: string, o?: object) =>
      k === 'charNames_gen:Odette'
        ? 'Odette'
        : k === 'charNames_gen:Bennett'
          ? 'Bennett'
          : (ctx.t as (k: string, o?: object) => string)(k, o)) as never,
  }
  it('marks every member that changed, and heads the card with each swap', () => {
    const d = compareCardData({ ...a4, turns: [1, 2] }, b4, {
      ...named,
      pairs,
    })
    expect(d.a.marks.changed).toEqual([
      { index: 1, badge: 'out' },
      { index: 2, badge: 'out' },
    ])
    expect(d.b.marks.changed).toEqual([
      { index: 1, badge: 'Yae Miko → Mitya' },
      { index: 2, badge: 'Odette → Bennett' },
    ])
    expect(d.b.marks.rotationTurn).toEqual([1, 2])
    expect(d.swap).toEqual({ line: 'Yae Miko → Mitya  ·  Odette → Bennett' })
    // (each one against the member whose slot it took)
    expect(d.b.marks.delta?.members.map((c) => c.text)).toEqual([
      '±0%',
      '±0%',
      '±0%',
      '±0%',
    ])
  })
  it('the same members (another rotation): nothing marked, said in the header', () => {
    const d = compareCardData(a4, { ...a4, dpr: 120000 }, { ...named, pairs: [] })
    expect(d.a.marks.changed).toEqual([])
    expect(d.b.marks.changed).toEqual([])
    expect(d.swap).toEqual({ line: 'sameMembers' })
    expect(d.delta.dpr).toEqual({ text: '↑ +20%', tone: 'better' })
  })
})

describe('swapLabel', () => {
  it('names both members when they differ', () => {
    expect(swapLabel('Yae Miko', 'Mitya', 0, 1, false)).toBe('Yae Miko → Mitya')
  })
  it('gives the constellation change when the same member re-enters', () => {
    expect(swapLabel('Yae Miko', 'Yae Miko', 0, 1, true)).toBe(
      'Yae Miko C0 → C1'
    )
  })
  it('names it twice when the constellation is the same too', () => {
    expect(swapLabel('Yae Miko', 'Yae Miko', 2, 2, true)).toBe(
      'Yae Miko → Yae Miko'
    )
  })
  it('names both when two members share a name (Travelers): not the same member', () => {
    expect(swapLabel('Lumine', 'Lumine', 0, 6, false)).toBe('Lumine → Lumine')
  })
})

describe('compareCardData: two members sharing a name (Travelers)', () => {
  const aT = side({ turns: [1] }, [
    ['Danica', 60000],
    ['TravelerAnemo', 40000, { constellation: 0 }],
  ])
  const bT = side({ dpr: 110000, turns: [1] }, [
    ['Danica', 50000],
    ['TravelerDendro', 60000, { constellation: 6 }],
  ])
  const d = compareCardData(aT, bT, {
    ...ctx,
    pairs: [{ out: 'TravelerAnemo', in: 'TravelerDendro' }] as never,
    t: ((k: string) =>
      k === 'charNames_gen:TravelerF' ? 'Lumine' : ctx.t(k)) as never,
  })
  it('badges and heads the swap as two members, as before', () => {
    expect(d.b.marks.changed).toEqual([{ index: 1, badge: 'Lumine → Lumine' }])
    expect(d.swap).toEqual({ out: 'Lumine', in: 'Lumine' })
  })
})

describe('compareCardData: the same member re-entering', () => {
  const bSame = side(
    { dpr: 110000, rotation: 'Danica E -> Yae Miko E E', turns: [1] },
    [
      ['Danica', 50000],
      ['YaeMiko', 60000, { constellation: 1 }],
    ]
  )
  const d = compareCardData(a, bSame, {
    ...ctx,
    pairs: [{ out: 'YaeMiko', in: 'YaeMiko' }] as never,
  })
  it('badges the swapped member with the constellation change', () => {
    expect(d.b.marks.changed).toEqual([{ index: 1, badge: 'Yae Miko C0 → C1' }])
    expect(d.a.marks.changed).toEqual([{ index: 1, badge: 'out' }])
  })
  it('heads the card with the constellation change', () => {
    const swap = d.swap as { out: string; in: string }
    expect(`${swap.out} → ${swap.in}`).toBe('Yae Miko C0 → C1')
  })
  it('compares the member with itself in A', () => {
    expect(d.b.marks.delta?.members.map((c) => c.text)).toEqual([
      '−17%',
      '+50%',
    ])
  })
})

describe('compareCardData: the detailed view (each member’s stats)', () => {
  /** A build's stats out of combat (as `kqmOutOfCombatStats` returns them) */
  const stats = (atk: number, er: number): KqmMemberStats => ({
    mains: { sands: 'atk_', goblet: 'electro_dmg_', circlet: 'critRate_' },
    stats: [
      { key: 'hp', value: 15000 },
      { key: 'atk', value: atk },
      { key: 'def', value: 800 },
      { key: 'eleMas', value: 0 },
      { key: 'critRate_', value: 0.7 },
      { key: 'critDMG_', value: 1.5 },
      { key: 'enerRech_', value: er },
      { key: 'electro_dmg_', value: 0.466 },
    ],
  })
  // (their ER out of combat as each table writes it: A 121%, B's Danica 125%, Mitya 121%)
  const statsA = {
    Danica: stats(2000, 1.214),
    YaeMiko: stats(2100, 1.214),
  } as never
  const statsB = {
    Danica: stats(2000, 1.25),
    Mitya: stats(1800, 1.214),
  } as never
  const marked = (d: ReturnType<typeof compareCardData>) =>
    [d.a, d.b].flatMap((half, h) =>
      half.card.members.flatMap((m, i) =>
        (m.details?.stats ?? [])
          .filter((s) => 'was' in s)
          .map((s) => `${h ? 'B' : 'A'}${i}:${s.label}:${s.was}→${s.value}`)
      )
    )
  /** The card without its members' details */
  const plain = (d: ReturnType<typeof compareCardData>) => {
    const strip = (card: (typeof d)['a']['card']) => ({
      ...card,
      members: card.members.map(({ details: _, ...m }) => m),
    })
    return {
      ...d,
      a: { ...d.a, card: strip(d.a.card) },
      b: { ...d.b, card: strip(d.b.card) },
    }
  }

  it('without stats: the card as it was (no details)', () => {
    const r = compareCardData(a, b, {
      ...ctx,
      statsA: undefined,
      statsB: undefined,
    })
    expect(r).toStrictEqual(compareCardData(a, b, ctx))
    expect(
      [...r.a.card.members, ...r.b.card.members].some((m) => 'details' in m)
    ).toBe(false)
  })
  it('gives every member of both halves its details', () => {
    const r = compareCardData(a, b, { ...ctx, statsA, statsB })
    for (const m of [...r.a.card.members, ...r.b.card.members]) {
      expect(m.details?.stats).toHaveLength(8)
      expect(m.details?.mains).toHaveLength(3)
    }
    expect(r.b.card.members[1].details?.stats[1]).toEqual({
      label: 'atk',
      value: '1,800',
    })
  })
  it('keeps everything the normal card shows: the same card plus the details', () => {
    const normal = compareCardData(a, b, ctx)
    const r = compareCardData(a, b, { ...ctx, statsA, statsB })
    expect(plain(r)).toStrictEqual(normal)
    // (its Δ column, share points, ER build / required with its change and warning, header)
    expect(r.b.marks.delta?.members.map((c) => c.text)).toEqual([
      '−17%',
      '+50%',
    ])
    expect(r.b.marks.er?.[0]).toMatchObject({ warn: true, note: '120% → 130%' })
    expect(r.b.card.labels.er).toBe('erBuild\nerTarget')
    expect(r.delta.dpr).toEqual({ text: '↑ +10%', tone: 'better' })
  })
  it('a different member entering: its stats plain (nothing to compare with); a teammate’s changed ER marked', () => {
    const r = compareCardData(a, b, { ...ctx, statsA, statsB })
    // (Mitya is new; Danica's ER out of combat went from 121.4% to 125%)
    expect(marked(r)).toEqual(['B0:enerRech_:121.4%→125.0%'])
  })
  it('the same member at another constellation, and a teammate with another build: their changed stats marked, against A’s', () => {
    const bSame = side(
      { dpr: 110000, rotation: 'Danica E -> Yae Miko E E', turns: [1] },
      [
        ['Danica', 50000, { erValue: 125 }],
        ['YaeMiko', 60000, { constellation: 1 }],
      ]
    )
    const r = compareCardData(a, bSame, {
      ...ctx,
      pairs: [{ out: 'YaeMiko', in: 'YaeMiko' }] as never,
      statsA,
      // (each version has its own builds: its teammate's changed too)
      statsB: {
        Danica: stats(2222, 1.25),
        YaeMiko: stats(2300, 1.214),
      } as never,
    })
    expect(marked(r)).toEqual([
      'B0:atk:2,000→2,222',
      'B0:enerRech_:121.4%→125.0%',
      'B1:atk:2,100→2,300',
    ])
  })
  it('a teammate with the same stats: nothing marked; with others: they are', () => {
    const same = compareCardData(a, b, {
      ...ctx,
      statsA,
      statsB: { ...(statsB as object), Danica: stats(2000, 1.214) } as never,
    })
    expect(marked(same)).toEqual([])
    const r = compareCardData(a, b, {
      ...ctx,
      statsA,
      statsB: { ...(statsB as object), Danica: stats(2500, 1.214) } as never,
    })
    expect(marked(r)).toEqual(['B0:atk:2,000→2,500'])
  })
  it('says on its own line when a member’s ER out of combat is not the table’s', () => {
    // (A's Yae Miko: 100% out of combat, 121% in the table; B as its table)
    const r = compareCardData(a, b, {
      ...ctx,
      statsA: { ...(statsA as object), YaeMiko: stats(2100, 1) } as never,
      statsB,
    })
    expect(r.a.card.notes).toBe('standard\nerNote')
    expect(r.b.card.notes).toBe('standard')
    // (none differing, or the normal view: no note)
    expect(compareCardData(a, b, { ...ctx, statsA, statsB }).a.card.notes).toBe(
      'standard'
    )
    expect(compareCardData(a, b, ctx).a.card.notes).toBe('standard')
  })
  it('records which view it is', () => {
    const rec = compareCardRecord({
      teamId: 't1',
      teamName: 'Team X',
      gender: 'F',
      pairs: [{ out: 'YaeMiko', in: 'Mitya' }],
      a,
      b,
      view: 'detailed',
    })
    expect(rec.view).toBe('detailed')
  })
})
