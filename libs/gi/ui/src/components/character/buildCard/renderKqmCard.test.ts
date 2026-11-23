import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KqmCardData, KqmCardDetails } from './renderKqmCard'
import {
  drawKqmCard,
  KQM_CARD_DETAILS_H,
  KQM_CARD_HEIGHT,
  KQM_CARD_NOTE_LINE,
  KQM_CARD_WIDTH,
  KQM_CHANGED,
  kqmCardHeight,
  renderKqmCard,
} from './renderKqmCard'
import {
  KQM_COMPARE_CARD_HEIGHT,
  KQM_COMPARE_SHEET_H,
  kqmCompareCardHeight,
} from './renderKqmCompareCard'

/*
 * The KQM sheet (KQM Theorycrafting's Share → Team card) is shipped: its drawing must not change.
 * Drawn on a context that records every call and setting; the record's hash is checked.
 */

/** A context recording what is drawn: calls with their arguments, settings with their values */
function recorder() {
  const log: string[] = []
  const state: Record<string, unknown> = { font: '10px sans-serif' }
  const num = (v: unknown) =>
    typeof v === 'number' ? Math.round(v * 1000) / 1000 : v
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key in target) return target[key]
      if (key === 'measureText')
        return (text: string) => {
          const px = Number(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1])
          return { width: text.length * px * 0.5 }
        }
      if (key === 'canvas') return undefined
      return (...args: unknown[]) => {
        log.push(
          `${key}(${args
            .map((a) =>
              typeof a === 'object' && a
                ? `img:${(a as { src?: string }).src}`
                : JSON.stringify(num(a))
            )
            .join(',')})`
        )
      }
    },
    set(target, key: string, value) {
      target[key] = value
      log.push(`${key}=${JSON.stringify(num(value))}`)
      return true
    },
  })
  return { ctx, log }
}

/** djb2, as hex */
const hash = (lines: string[]) => {
  let h = 5381
  for (const c of lines.join('\n')) h = (h * 33 + c.charCodeAt(0)) >>> 0
  return h.toString(16)
}

const member = (
  name: string,
  over: Partial<KqmCardData['members'][number]>
) => ({
  name,
  constellation: 0,
  elementColor: '#9fd6e3',
  element: 'cryo',
  face: `face-${name}`,
  weapon: { name: 'Jadefall’s Splendor', refinement: 1, icon: `w-${name}` },
  sets: [{ name: 'Deepwood Memories', icon: `s-${name}` }],
  damage: '1,872,940',
  share: 0.456,
  field: '11.4s',
  er: '128%',
  ...over,
})
const data: KqmCardData = {
  name: 'Tsaritsa - Yae - Odette - Danica (beta 7.3)',
  members: [
    member('Anastasya', {}),
    member('Yae Miko', {
      element: 'electro',
      elementColor: '#af8ec1',
      weapon: { name: 'A very long weapon name that wraps', refinement: 5 },
      field: undefined,
    }),
    member('Odette', {
      sets: [
        { name: 'Gladiator’s Finale', icon: 's1' },
        { name: 'Shimenawa’s Reminiscence', icon: 's2' },
      ],
    }),
    member('Danica', { element: 'pyro', elementColor: '#ef7938' }),
  ],
  total: '4,107,250',
  dps: '211,714',
  seconds: '19.4s rotation',
  rotation: ['Danica E', 'Odette E E', 'Yae Miko E E E', 'Anastasya hE N2 Q'],
  notes: 'KQM Standards · Talents 9/9/9',
  beta: '7.3 beta v3',
  labels: {
    team: 'Team',
    damage: 'Damage',
    dist: 'Share',
    field: 'Field',
    er: 'ER',
    total: 'Total',
    dpr: 'DPR',
    dps: 'DPS',
    rotation: 'Rotation',
    notes: 'Notes',
    siteName: 'Juan-optimizer (Stellar v1.13.1) · Nov 17, 2026',
  },
}

describe('renderKqmCard', () => {
  let log: string[] = []
  beforeEach(() => {
    const rec = recorder()
    log = rec.log
    // (no DOM here: a canvas whose context records)
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => rec.ctx }),
    })
    // (images load at once)
    vi.stubGlobal(
      'Image',
      class {
        onload?: () => void
        onerror?: () => void
        decoding = ''
        #src = ''
        get src() {
          return this.#src
        }
        set src(v: string) {
          this.#src = v
          queueMicrotask(() => this.onload?.())
        }
      }
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps its size', async () => {
    expect(KQM_CARD_WIDTH).toBe(1760)
    expect(KQM_CARD_HEIGHT).toBe(600)
    expect(kqmCardHeight(data)).toBe(594)
    // (KQM Compare's card stacks two)
    expect(KQM_COMPARE_SHEET_H).toBe(kqmCardHeight())
    const canvas = await renderKqmCard(data)
    expect([canvas.width, canvas.height]).toEqual([3520, 1188])
  })
  it('draws exactly as before', async () => {
    await renderKqmCard(data)
    expect(log.length).toBe(895)
    expect(log.filter((l) => l.startsWith('drawImage')).length).toBe(12)
    expect(hash(log)).toBe('8456ee12')
  })
  it('draws exactly as before without field, DPS, rotation or beta', async () => {
    await renderKqmCard(
      {
        ...data,
        members: data.members.map((m) => ({ ...m, field: undefined })),
        dps: undefined,
        seconds: undefined,
        rotation: undefined,
        beta: undefined,
      },
      1
    )
    expect(log.length).toBe(539)
    expect(hash(log)).toBe('652245f7')
  })
})

describe('drawKqmCard: the rotation’s marked turn', () => {
  const SEP = '   >   '
  /** The texts drawn, each with the font size and alignment it was drawn with */
  function drawn(rotation: string[], rotationTurn: number | number[]) {
    const { ctx, log } = recorder()
    drawKqmCard(
      ctx as unknown as CanvasRenderingContext2D,
      { ...data, rotation },
      { faces: [], weaponIcons: [], setIcons: data.members.map(() => []) },
      { marks: { rotationTurn } }
    )
    let px = 0
    let align = 'start'
    const texts: {
      text: string
      x: number
      y: number
      px: number
      align: string
    }[] = []
    const boxes: number[][] = []
    for (const line of log) {
      const font = /^font="\d+ (\d+(?:\.\d+)?)px/.exec(line)
      if (font) px = Number(font[1])
      const a = /^textAlign="(\w+)"/.exec(line)
      if (a) align = a[1]
      const fill = /^fillText\((".*"),(-?[\d.]+),(-?[\d.]+)\)$/.exec(line)
      if (fill)
        texts.push({
          text: JSON.parse(fill[1]),
          x: Number(fill[2]),
          y: Number(fill[3]),
          px,
          align,
        })
      const box = /^roundRect\((.*)\)$/.exec(line)
      if (box) boxes.push(box[1].split(',').map(Number))
    }
    return { texts, boxes }
  }
  const width = (text: string, px: number) => text.length * px * 0.5
  const long = Array.from(
    { length: 8 },
    (_, i) => `Member${i} hE N2 Q N5 E E E N2`
  )

  it('marks it where it is drawn, at the size it is drawn, however long the rotation', () => {
    const turn = 6
    const { texts, boxes } = drawn(long, turn)
    // (the rotation, whole: wrapped rather than cut short)
    const lines = texts.filter((t) => t.text.includes(`${SEP}`))
    expect(lines.length).toBeGreaterThan(0)
    for (const l of lines) expect(l.text).not.toContain('…')
    expect(lines.flatMap((l) => l.text.split(SEP))).toEqual(long)
    // (the turn, drawn over its own line at that line's size and place)
    const own = texts.find((t) => t.text === long[turn])!
    const line = lines.find((l) => l.text.split(SEP).includes(long[turn]))!
    expect(own.px).toBe(line.px)
    expect(own.y).toBe(line.y)
    const left = line.x - width(line.text, line.px) / 2
    const before = line.text.slice(0, line.text.indexOf(long[turn]))
    expect(own.x).toBeCloseTo(left + width(before, line.px), 3)
    // (its outline around it)
    const box = boxes.at(-1)!
    expect(box[0]).toBeCloseTo(own.x - 10, 3)
    expect(box[2]).toBeCloseTo(width(long[turn], own.px) + 20, 3)
    expect(box[1]).toBeLessThan(own.y)
    expect(box[1] + box[3]).toBeGreaterThan(own.y)
  })
  it('marks several turns, each where it is drawn (a version with members swapped)', () => {
    const rotation = ['Danica E', 'Mitya E Q', 'Odette E', 'Bennett E Q', 'Anastasya Q']
    const { texts, boxes } = drawn(rotation, [1, 3])
    for (const turn of [1, 3])
      expect(texts.some((t) => t.text === rotation[turn])).toBe(true)
    expect(texts.some((t) => t.text === rotation[0])).toBe(false)
    // (one outline each, as one marked turn has its own)
    const single = drawn(rotation, 1).boxes.length
    expect(boxes.length).toBe(single + 1)
  })
  it('a line too long even at its smallest: the mark kept inside what is drawn, or left out', () => {
    const huge = `Member1 ${'E '.repeat(200).trim()}`
    const rotation = ['Danica E', huge, 'Zibai Q']
    const unmarked = drawn(rotation, 99)
    // (the marked turn starts past the cut: no mark, no overlay)
    const past = drawn(rotation, 2)
    expect(past.boxes).toHaveLength(unmarked.boxes.length)
    expect(past.texts.find((t) => t.text.startsWith('Zibai'))).toBeUndefined()
    // (the marked turn cut short: its box and overlay end where the drawn line ends)
    const cut = drawn(rotation, 1)
    const line = cut.texts.find((t) => t.text.startsWith('Member1'))!
    expect(line.text.endsWith('…')).toBe(true)
    const right = line.x + width(line.text, line.px) / 2
    const box = cut.boxes.at(-1)!
    expect(box[2]).toBeGreaterThanOrEqual(0)
    expect(box[0] + box[2] - 10).toBeLessThanOrEqual(right + 0.001)
    const own = cut.texts.filter((t) => t.text.startsWith('Member1')).at(-1)!
    expect(own).not.toBe(line)
    expect(own.x + width(own.text, own.px)).toBeLessThanOrEqual(right + 0.001)
  })
  it('a rotation that fits: one line, marked as before', () => {
    const rotation = ['Danica E', 'Odette E E', 'Yae Miko E E E']
    const { texts, boxes } = drawn(rotation, 1)
    const line = texts.find((t) => t.text === rotation.join(SEP))!
    const own = texts.find((t) => t.text === 'Odette E E')!
    expect(line.px).toBe(28)
    expect(own.px).toBe(28)
    const left = line.x - width(line.text, 28) / 2
    expect(own.x).toBeCloseTo(left + width(`Danica E${SEP}`, 28), 3)
    expect(boxes.at(-1)![0]).toBeCloseTo(own.x - 10, 3)
  })
})

/** A member's detailed block (English labels) */
const details = (
  over: Partial<KqmCardDetails> = {},
  stats: KqmCardDetails['stats'] = [
    { label: 'HP', value: '15,890' },
    { label: 'ATK', value: '2,284' },
    { label: 'DEF', value: '812' },
    { label: 'Elemental Mastery', value: '42' },
    { label: 'CRIT Rate', value: '71.3%' },
    { label: 'CRIT DMG', value: '196.4%' },
    { label: 'Energy Recharge', value: '111.0%' },
    { label: 'Cryo DMG Bonus', value: '61.6%' },
  ]
): KqmCardDetails => ({
  mainsTitle: 'Main stats',
  statsTitle: 'Stats (out of combat)',
  mains: [
    { slot: 'Sands', stat: 'ATK%' },
    { slot: 'Goblet', stat: 'Cryo DMG Bonus' },
    { slot: 'Circlet', stat: 'CRIT DMG' },
  ],
  stats,
  ...over,
})
const detailed: KqmCardData = {
  ...data,
  members: data.members.map((m, i) => ({
    ...m,
    details:
      i === 1
        ? details({}, [
            { label: 'HP', value: '13,810' },
            { label: 'ATK', value: '2,096', was: '2,012' },
            { label: 'DEF', value: '683' },
            { label: 'Elemental Mastery', value: '79' },
            { label: 'CRIT Rate', value: '70.9%', was: '74.8%' },
            { label: 'CRIT DMG', value: '162.8%', was: '151.2%' },
            { label: 'Energy Recharge', value: '111.0%' },
            { label: 'Electro DMG Bonus', value: '46.6%' },
          ])
        : details(),
  })),
}

/** The texts drawn, with the font size, alignment and fill each was drawn with, and the fills */
function parse(log: string[]) {
  let px = 0
  let align = 'start'
  let fill = ''
  const texts: {
    text: string
    x: number
    y: number
    px: number
    align: string
    fill: string
  }[] = []
  const rects: { x: number; y: number; w: number; h: number; fill: string }[] =
    []
  for (const line of log) {
    const font = /^font="\d+ (\d+(?:\.\d+)?)px/.exec(line)
    if (font) px = Number(font[1])
    const a = /^textAlign="(\w+)"/.exec(line)
    if (a) align = a[1]
    const f = /^fillStyle=(".*")$/.exec(line)
    if (f) fill = JSON.parse(f[1])
    const t = /^fillText\((".*"),(-?[\d.]+),(-?[\d.]+)\)$/.exec(line)
    if (t)
      texts.push({
        text: JSON.parse(t[1]),
        x: Number(t[2]),
        y: Number(t[3]),
        px,
        align,
        fill,
      })
    const r = /^fillRect\((.*)\)$/.exec(line)
    if (r) {
      const [x, y, w, h] = r[1].split(',').map(Number)
      rects.push({ x, y, w, h, fill })
    }
  }
  return { texts, rects }
}
/** The mock measure: half the font size a character */
const measured = (t: { text: string; px: number }) => t.text.length * t.px * 0.5
// (the sheet's member columns, as drawn: from the margin, 230 wide; the block under the gear)
const COL = 230
const colOf = (x: number) => Math.floor((x - 36) / COL)
const BLOCK_TOP = 36 + 50 + 190 + 2 * 60

describe('drawKqmCard: the detailed block', () => {
  const draw = (d: KqmCardData) => {
    const { ctx, log } = recorder()
    drawKqmCard(ctx as unknown as CanvasRenderingContext2D, d, {
      faces: [],
      weaponIcons: [],
      setIcons: d.members.map(() => []),
    })
    return { log, ...parse(log) }
  }
  /** The block's rows: the texts drawn in it, by column and line */
  const rows = (texts: ReturnType<typeof parse>['texts']) => {
    const inBlock = texts.filter(
      (t) => t.y > BLOCK_TOP && t.y < BLOCK_TOP + KQM_CARD_DETAILS_H
    )
    const byRow = new Map<string, typeof inBlock>()
    for (const t of inBlock) {
      const key = `${colOf(t.x)}:${t.y}`
      byRow.set(key, [...(byRow.get(key) ?? []), t])
    }
    return [...byRow.entries()].map(([key, ts]) => ({
      col: Number(key.split(':')[0]),
      texts: ts,
    }))
  }

  it('makes the sheet taller by its block, the normal sheet as before', () => {
    expect(kqmCardHeight(data)).toBe(594)
    expect(kqmCardHeight(detailed)).toBe(594 + KQM_CARD_DETAILS_H)
    expect(kqmCardHeight(detailed)).toBeGreaterThan(kqmCardHeight(data))
    // (KQM Compare's card: each half as tall as its sheet)
    const side = (card: KqmCardData) => ({ card, marks: {} })
    const compare = (a: KqmCardData, b: KqmCardData) =>
      kqmCompareCardHeight({ a: side(a), b: side(b) })
    expect(compare(data, data)).toBe(KQM_COMPARE_CARD_HEIGHT)
    expect(compare(detailed, detailed)).toBe(
      KQM_COMPARE_CARD_HEIGHT + 2 * KQM_CARD_DETAILS_H
    )
  })
  it('draws each member’s main stats and stats, label left and value right', () => {
    const { texts } = draw(detailed)
    const blockRows = rows(texts)
    for (let col = 0; col < 4; col++) {
      const own = blockRows.filter((r) => r.col === col)
      // (two titles, three main stats, eight stats)
      expect(own.length).toBe(13)
      const words = own.map((r) => r.texts[0].text)
      expect(words.slice(0, 5)).toEqual([
        'Main stats',
        'Sands',
        'Goblet',
        'Circlet',
        'Stats (out of combat)',
      ])
    }
    // (the values, whole: digits drawn apart, read back left to right)
    const yae = blockRows.filter((r) => r.col === 1)
    const value = (r: (typeof yae)[number]) =>
      r.texts
        .slice(1)
        .sort((a, b) => a.x - b.x)
        .map((t) => t.text)
        .join('')
    expect(value(yae[5])).toBe('13,810')
    expect(value(yae[6])).toBe('2,012 → 2,096')
  })
  it('the rotation and notes move down by the block, the table stays', () => {
    const plain = draw(data).texts
    const rich = draw(detailed).texts
    const at = (ts: typeof plain, text: string) =>
      ts.find((t) => t.text === text)!
    expect(at(rich, 'Rotation').y).toBe(
      at(plain, 'Rotation').y + KQM_CARD_DETAILS_H
    )
    expect(at(rich, 'Notes').y).toBe(at(plain, 'Notes').y + KQM_CARD_DETAILS_H)
    expect(at(rich, 'Damage').y).toBe(at(plain, 'Damage').y)
    expect(at(rich, '4,107,250').y).toBe(at(plain, '4,107,250').y)
  })
  it('a changed stat: "was → value" in the changed tone, on its tint', () => {
    const { texts, rects } = draw(detailed)
    const yae = rows(texts).filter((r) => r.col === 1)
    const atk = yae[6]
    expect(atk.texts[0].text).toBe('ATK')
    for (const t of atk.texts.slice(1)) expect(t.fill).toBe(KQM_CHANGED)
    const tint = rects.filter(
      (r) =>
        r.fill === 'rgba(37, 87, 167, 0.12)' &&
        colOf(r.x) === 1 &&
        r.y < atk.texts[0].y &&
        r.y + r.h > atk.texts[0].y
    )
    expect(tint).toHaveLength(1)
    // (an unchanged stat: no tint, no tone)
    const hp = yae[5]
    for (const t of hp.texts.slice(1)) expect(t.fill).not.toBe(KQM_CHANGED)
    expect(
      rects.filter(
        (r) =>
          r.fill === 'rgba(37, 87, 167, 0.12)' &&
          r.y < hp.texts[0].y &&
          r.y + r.h > hp.texts[0].y
      )
    ).toHaveLength(0)
    // (three changed rows on the card, all Yae's)
    expect(
      rects.filter((r) => r.fill === 'rgba(37, 87, 167, 0.12)')
    ).toHaveLength(3)
  })
  it('long labels and values never overlap, and stay in their column', () => {
    const long = details(
      {
        mainsTitle: 'Statistiche principali con un titolo lunghissimo davvero',
        mains: [
          { slot: 'Sabbie', stat: 'Ricarica di energia' },
          { slot: 'Calice', stat: 'Bonus DAN Electro' },
          { slot: 'Corona', stat: 'Bonus alle cure' },
        ],
      },
      [
        { label: 'Ricarica di energia', value: '151,2%', was: '111,0%' },
        { label: 'Bonus DAN Electro', value: '162,8%', was: '151,2%' },
        { label: 'Elemental Mastery', value: '1.042', was: '1.000' },
        { label: 'A label far too long to fit beside its value', value: '42' },
        { label: 'PS', value: '15.890' },
        { label: 'ATT', value: '2.284' },
        { label: 'DIF', value: '812' },
        { label: 'Tasso CRIT', value: '71,3%' },
      ]
    )
    const { texts } = draw({
      ...data,
      members: data.members.map((m) => ({ ...m, details: long })),
    })
    const blockRows = rows(texts)
    expect(blockRows.length).toBe(4 * 13)
    for (const { col, texts: ts } of blockRows) {
      const left = 36 + col * COL
      const right = left + COL
      const [label, ...value] = ts
      expect(label.align).toBe('left')
      expect(label.x).toBeGreaterThan(left)
      expect(label.x + measured(label)).toBeLessThan(right)
      if (!value.length) continue
      // (a text's left end: its x, or its x less its width when right-aligned)
      const start = (t: (typeof ts)[number]) =>
        t.align === 'right' ? t.x - measured(t) : t.x
      const valueLeft = Math.min(...value.map(start))
      const valueRight = Math.max(...value.map((t) => start(t) + measured(t)))
      // (the label ends before the value starts; both inside the column)
      expect(label.x + measured(label)).toBeLessThan(valueLeft)
      expect(valueRight).toBeLessThanOrEqual(right - 8 + 0.001)
      const valueW = valueRight - valueLeft
      expect(measured(label) + valueW).toBeLessThanOrEqual(COL)
    }
  })
  it('realistic labels beside changed values: whole, in both languages', () => {
    const changed = (labels: string[], mains: string[]) =>
      details(
        {
          mains: [
            { slot: 'Sabbie', stat: mains[0] },
            { slot: 'Calice', stat: mains[1] },
            { slot: 'Corona', stat: mains[2] },
          ],
        },
        [
          { label: labels[0], value: '13.810', was: '13.096' },
          { label: labels[1], value: '2.096', was: '2.012' },
          { label: labels[2], value: '683', was: '612' },
          { label: labels[3], value: '79', was: '42' },
          { label: labels[4], value: '70,9%', was: '74,8%' },
          { label: labels[5], value: '162,8%', was: '151,2%' },
          { label: labels[6], value: '162,8%', was: '151,2%' },
          { label: labels[7], value: '146,6%', was: '100,0%' },
        ]
      )
    const it = changed(
      [
        'PS',
        'ATT',
        'DIF',
        'Maestria elementale',
        'Tasso CRIT',
        'DAN CRIT',
        'Ricarica di energia',
        'Bonus DAN Electro',
      ],
      ['Ricarica di energia', 'Bonus DAN Electro', 'Tasso CRIT']
    )
    const en = changed(
      [
        'HP',
        'ATK',
        'DEF',
        'Elemental Mastery',
        'CRIT Rate',
        'CRIT DMG',
        'Energy Recharge',
        'Electro DMG Bonus',
      ],
      ['Energy Recharge', 'Electro DMG Bonus', 'CRIT Rate']
    )
    const { texts } = draw({
      ...data,
      members: data.members.map((m, i) => ({
        ...m,
        details: i % 2 ? en : it,
      })),
    })
    const block = rows(texts)
    expect(block.length).toBe(4 * 13)
    for (const { texts: ts } of block) {
      for (const t of ts) expect(t.text).not.toContain('…')
      // (label and value at one size, not smaller than 11px)
      for (const t of ts.slice(1)) expect(t.px).toBe(ts[0].px)
      expect(ts[0].px).toBeGreaterThanOrEqual(11)
    }
  })
  it('more main stats or stats than the block holds: only the first 3 and 8', () => {
    const many = details({
      mains: [...details().mains, { slot: 'Flower', stat: 'HP' }],
    })
    many.stats = [...many.stats, { label: 'Healing Bonus', value: '0.0%' }]
    const { texts } = draw({
      ...data,
      members: data.members.map((m) => ({ ...m, details: many })),
    })
    expect(rows(texts).length).toBe(4 * 13)
    expect(texts.some((t) => t.text === 'Flower')).toBe(false)
    expect(texts.some((t) => t.text === 'Healing Bonus')).toBe(false)
  })
  it('a member without details: its column empty, the card drawn', () => {
    const { texts, rects } = draw({
      ...detailed,
      members: detailed.members.map((m, i) =>
        i === 2 ? { ...m, details: undefined } : m
      ),
    })
    const blockRows = rows(texts)
    expect(blockRows.filter((r) => r.col === 2)).toHaveLength(0)
    expect(blockRows.filter((r) => r.col === 3)).toHaveLength(13)
    // (its cell still there: the column's ground under the gear)
    expect(
      rects.some(
        (r) =>
          r.x === 36 + 2 * COL &&
          r.y === BLOCK_TOP &&
          r.w === COL &&
          r.h === KQM_CARD_DETAILS_H
      )
    ).toBe(true)
  })
})

describe('drawKqmCard: notes on more than one line', () => {
  const draw = (d: KqmCardData) => {
    const { ctx, log } = recorder()
    drawKqmCard(ctx as unknown as CanvasRenderingContext2D, d, {
      faces: [],
      weaponIcons: [],
      setIcons: d.members.map(() => []),
    })
    return parse(log)
  }
  const NOTE = 'Out-of-combat stats: no conditional effects or teammates.'
  const twoLines: KqmCardData = {
    ...detailed,
    notes: `KQM Standards · Talents 9/9/9\n${NOTE}`,
  }
  it('the sheet grows by a line for each line after the first', () => {
    expect(kqmCardHeight(twoLines)).toBe(
      kqmCardHeight(detailed) + KQM_CARD_NOTE_LINE
    )
    const side = (card: KqmCardData) => ({ card, marks: {} })
    expect(kqmCompareCardHeight({ a: side(twoLines), b: side(detailed) })).toBe(
      kqmCompareCardHeight({ a: side(detailed), b: side(detailed) }) +
        KQM_CARD_NOTE_LINE
    )
  })
  it('draws each line, centred in the notes row, one under the other', () => {
    const plain = draw(detailed).texts
    const { texts, rects } = draw(twoLines)
    const at = (ts: typeof texts, text: string) =>
      ts.find((t) => t.text === text)!
    const first = at(texts, 'KQM Standards · Talents 9/9/9')
    const second = at(texts, NOTE)
    expect(second.y - first.y).toBe(KQM_CARD_NOTE_LINE)
    expect(second.x).toBe(first.x)
    expect(first.px).toBe(19)
    expect(second.px).toBe(19)
    // (the row's middle between them; the label centred in the taller row)
    const was = at(plain, 'KQM Standards · Talents 9/9/9')
    expect((first.y + second.y) / 2).toBe(was.y + KQM_CARD_NOTE_LINE / 2)
    expect(at(texts, 'Notes').y).toBe(
      at(plain, 'Notes').y + KQM_CARD_NOTE_LINE / 2
    )
    // (its cells as tall as the lines)
    expect(
      rects.some((r) => r.x === 36 && r.h === 60 + KQM_CARD_NOTE_LINE)
    ).toBe(true)
  })
})

/** The detailed sheet's drawing, pinned when it was approved: a change to it must be seen */
const DETAILED_LOG = 1853
const DETAILED_HASH = '9f385eaf'

describe('renderKqmCard: the detailed sheet', () => {
  let log: string[] = []
  beforeEach(() => {
    const rec = recorder()
    log = rec.log
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0, getContext: () => rec.ctx }),
    })
    vi.stubGlobal(
      'Image',
      class {
        onload?: () => void
        decoding = ''
        #src = ''
        get src() {
          return this.#src
        }
        set src(v: string) {
          this.#src = v
          queueMicrotask(() => this.onload?.())
        }
      }
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it('draws as pinned', async () => {
    const canvas = await renderKqmCard(detailed)
    expect([canvas.width, canvas.height]).toEqual([
      3520,
      2 * (594 + KQM_CARD_DETAILS_H),
    ])
    expect(log.length).toBe(DETAILED_LOG)
    expect(hash(log)).toBe(DETAILED_HASH)
  })
})
