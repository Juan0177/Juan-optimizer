import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KqmCardData } from './renderKqmCard'
import {
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
