import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KqmCardData } from './renderKqmCard'
import {
  drawKqmCard,
  KQM_CARD_HEIGHT,
  KQM_CARD_WIDTH,
  kqmCardHeight,
  renderKqmCard,
} from './renderKqmCard'
import { KQM_COMPARE_SHEET_H } from './renderKqmCompareCard'

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
  function drawn(rotation: string[], rotationTurn: number) {
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
