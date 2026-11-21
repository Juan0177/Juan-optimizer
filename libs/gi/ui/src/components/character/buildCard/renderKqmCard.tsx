import { characterAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { cardElementColor } from './buildCardData'
import {
  betaMark,
  FONT,
  ink,
  loadImage,
  loadShareFont,
  page,
} from './shareStyle'

/** A member on the KQM sheet */
export type KqmCardMember = {
  name: string
  constellation: number
  elementColor: string
  /** its element ("cryo"): its cells' tints (`ELEMENT_TONES`) */
  element: string
  /** its face icon */
  face: string
  /** its weapon: name, refinement, icon */
  weapon: { name: string; refinement: number; icon?: string }
  /** its set bonuses: name and icon (two for 2+2) */
  sets: { name: string; icon?: string }[]
  /** its damage per rotation, formatted */
  damage: string
  /** its share of the team's damage, 0…1 */
  share: number
  /** its time on the field per rotation ("13.2s"), when known */
  field?: string
  /** its Energy Recharge ("111%") */
  er: string
}

/** Everything the KQM sheet shows, as plain text and image URLs */
export type KqmCardData = {
  name: string
  members: KqmCardMember[]
  /** the team's damage per rotation, and per second when the rotation's length is known */
  total: string
  dps?: string
  /** "20.6s rotation" */
  seconds?: string
  /** the written rotation, its members' turns apart */
  rotation?: string[]
  notes: string
  /** it shows unreleased content: this name ("7.3 beta v3") over the whole sheet; absent: none */
  beta?: string
  labels: {
    team: string
    damage: string
    dist: string
    field: string
    er: string
    total: string
    dpr: string
    dps: string
    rotation: string
    notes: string
    siteName: string
  }
}

/** A member's face and color for the share pictures */
export function kqmCardFace(characterKey: CharacterKey, gender: GenderKey) {
  const element = getCharEle(characterKey)
  return {
    element,
    elementColor: GAME_ELEMENT[element] ?? cardElementColor(element),
    face: characterAsset(characterKey, 'icon', gender) ?? '',
  }
}

export const KQM_CARD_WIDTH = 1760
/** The usual height (for placeholders) */
export const KQM_CARD_HEIGHT = 600

// a theorycrafting sheet: pale cells in the members' colors on a light page, a clear grid
const PAGE = '#e8ecf3'
const HEAD = '#d7deea'
const GRID = 'rgba(78, 96, 128, 0.55)'
const TEXT = '#1c2331'
const M = 36
const GAP = 18
const COL = 230
const PORTRAIT = 190
const ITEM_ROW = 60
const LABEL_W = 200
/** the size of the weapon and set names, and the smallest they may shrink to on one line */
const ITEM_SIZE = 19
const ITEM_MIN = 16
/** a weapon's or set's icon in its cell, and its left margin */
const ITEM_ICON = 46
const ICON_PAD = 10

/**
 * The elements' hues as the game shows them (its element symbols), for the share pictures: their
 * faces' rings, bars and cells
 */
export const GAME_ELEMENT: Record<string, string> = {
  pyro: '#ef7938',
  hydro: '#4cc2f1',
  cryo: '#9fd6e3',
  electro: '#af8ec1',
  anemo: '#74c2a8',
  geo: '#fab632',
  dendro: '#a5c83b',
  physical: '#a8aab3',
}
/** A member's cells: the game's hue lightened (the portrait more, its rows less) */
export const kqmCardTones = (m: { element: string; elementColor: string }) => {
  const hue = GAME_ELEMENT[m.element] ?? m.elementColor
  return { portrait: pastel(hue, 0.34), row: pastel(hue, 0.16) }
}
const tonesOf = kqmCardTones

/** A color, as a pale cell (an element without its own tones) */
function pastel(hex: string, amount = 0.2) {
  const v = Number.parseInt(hex.slice(1, 7), 16)
  const mix = (c: number) => Math.round(255 - (255 - c) * amount)
  return `rgb(${mix((v >> 16) & 255)}, ${mix((v >> 8) & 255)}, ${mix(v & 255)})`
}

/**
 * A KQM result as a theorycrafting sheet to share: the members' faces with their weapon and sets
 * under them; beside them each one's damage per rotation, share, field time and Energy Recharge,
 * the team's damage per rotation and per second; under it all the rotation and the notes.
 */
export async function renderKqmCard(
  data: KqmCardData,
  scale = 2
): Promise<HTMLCanvasElement> {
  const [faces, weaponIcons, setIcons] = await Promise.all([
    Promise.all(data.members.map((m) => loadImage(m.face))),
    Promise.all(data.members.map((m) => loadImage(m.weapon.icon ?? ''))),
    Promise.all(
      data.members.map((m) =>
        Promise.all(m.sets.map((set) => loadImage(set.icon ?? '')))
      )
    ),
    loadShareFont(),
  ])
  await document.fonts?.ready

  const W = KQM_CARD_WIDTH
  const n = data.members.length
  const field = data.members.some((m) => m.field)
  const top = M + 50
  const blockH = PORTRAIT + 2 * ITEM_ROW
  const leftW = n * COL
  const tableX = M + leftW + GAP
  const tableW = W - M - tableX
  const rotY = top + blockH + GAP
  const rotH = 84
  const notesY = rotY + rotH
  const H = notesY + ITEM_ROW + M
  const { canvas, ctx } = page(W, H, scale)
  ctx.fillStyle = PAGE
  ctx.fillRect(0, 0, W, H)

  const fillCell = (
    x: number,
    y: number,
    w: number,
    h: number,
    fill: string
  ) => {
    ctx.fillStyle = fill
    ctx.fillRect(x, y, w, h)
  }
  const frame = (x: number, y: number, w: number, h: number) => {
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1.5
    ctx.strokeRect(x, y, w, h)
  }
  const mid = (y: number, h: number, size: number) => y + h / 2 + size * 0.35
  const say = (
    value: string,
    x: number,
    y: number,
    h: number,
    opts: {
      size?: number
      weight?: number
      align?: CanvasTextAlign
      maxWidth?: number
    } = {}
  ) => {
    const size = opts.size ?? 20
    ink(ctx, value, x, mid(y, h, size), {
      size,
      weight: opts.weight ?? 500,
      color: TEXT,
      align: opts.align ?? 'center',
      maxWidth: opts.maxWidth,
      minSize: Math.min(size, 13),
    })
  }
  /**
   * A weapon's or sets' name in its cell: one line (a little smaller if needed), else two even
   * lines at the full size
   */
  const itemText = (value: string, x: number, y: number, w: number) => {
    const maxW = w - 20
    for (let px = ITEM_SIZE; px >= ITEM_MIN; px--) {
      ctx.font = `500 ${px}px ${FONT}`
      if (ctx.measureText(value).width <= maxW) {
        say(value, x + w / 2, y, ITEM_ROW, { size: px })
        return
      }
    }
    // (two lines: the break that makes them most even)
    ctx.font = `500 ${ITEM_MIN + 1}px ${FONT}`
    const words = value.split(' ')
    let lines = [value]
    let widest = Number.POSITIVE_INFINITY
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
      const w = Math.max(...pair.map((l) => ctx.measureText(l).width))
      if (w < widest) {
        widest = w
        lines = pair
      }
    }
    const size = ITEM_MIN + 1
    const lh = size * 1.22
    lines.forEach((line, k) => {
      ink(
        ctx,
        line,
        x + w / 2,
        y + ITEM_ROW / 2 + size * 0.35 + (k - (lines.length - 1) / 2) * lh,
        {
          size,
          weight: 500,
          color: TEXT,
          align: 'center',
          maxWidth: maxW,
          minSize: 12,
        }
      )
    })
  }

  /**
   * A weapon's or sets' cell: its icons at the left, straight on the cell (two sets overlapping),
   * its name centred in the rest
   */
  const itemCell = (
    value: string,
    icons: (HTMLImageElement | undefined)[],
    x: number,
    y: number
  ) => {
    const shown = icons.filter((img): img is HTMLImageElement => !!img)
    if (!shown.length) return itemText(value, x, y, COL)
    const two = shown.length > 1
    const size = two ? 38 : ITEM_ICON
    shown.forEach((img, k) => {
      const ix = x + ICON_PAD + k * 20
      const iy = y + (ITEM_ROW - size) / 2 + (two ? (k ? 6 : -6) : 0)
      ctx.drawImage(img, ix, iy, size, size)
    })
    const used = ICON_PAD + (two ? 20 + size : size) + 2
    itemText(value, x + used, y, COL - used)
  }

  // ── the team's name, the site
  ink(ctx, data.name, M, M + 28, {
    size: 26,
    weight: 700,
    color: TEXT,
    maxWidth: W - 2 * M - 380,
    minSize: 18,
  })
  ink(ctx, data.labels.siteName, W - M, M + 28, {
    size: 15,
    color: 'rgba(28, 35, 49, 0.45)',
    align: 'right',
  })

  // ── the members: face, weapon, sets
  data.members.forEach((m, i) => {
    const x = M + i * COL
    const { portrait: tint, row: pale } = tonesOf(m)
    fillCell(x, top, COL, PORTRAIT, tint)
    const img = faces[i]
    if (img) {
      // (as tall as the cell: the icon's cut top and foot fall on its borders; centred across)
      const size = PORTRAIT
      ctx.drawImage(
        img,
        x + (COL - size) / 2,
        top + PORTRAIT - size,
        size,
        size
      )
    }
    const wy = top + PORTRAIT
    fillCell(x, wy, COL, ITEM_ROW, pale)
    itemCell(
      `${m.weapon.name} R${m.weapon.refinement}`,
      [weaponIcons[i]],
      x,
      wy
    )
    fillCell(x, wy + ITEM_ROW, COL, ITEM_ROW, pale)
    itemCell(
      m.sets.map((set) => set.name).join(' / '),
      setIcons[i],
      x,
      wy + ITEM_ROW
    )
    frame(x, top, COL, PORTRAIT)
    frame(x, wy, COL, ITEM_ROW)
    frame(x, wy + ITEM_ROW, COL, ITEM_ROW)
  })

  // ── the table: each member's damage per rotation, share, field time, Energy Recharge
  const weights = field
    ? [0.33, 0.25, 0.14, 0.13, 0.15]
    : [0.38, 0.28, 0.17, 0.17]
  const xs = weights.reduce<number[]>(
    (acc, f, i) => [...acc, acc[i] + f * tableW],
    [tableX]
  )
  const end = xs[xs.length - 1]
  const rows = n + (data.dps ? 3 : 2)
  const rowH = blockH / rows
  const headers = [
    data.labels.team,
    data.labels.damage,
    data.labels.dist,
    ...(field ? [data.labels.field] : []),
    data.labels.er,
  ]
  headers.forEach((h, c) => {
    fillCell(xs[c], top, xs[c + 1] - xs[c], rowH, HEAD)
    say(h, (xs[c] + xs[c + 1]) / 2, top, rowH, { weight: 700 })
    frame(xs[c], top, xs[c + 1] - xs[c], rowH)
  })
  data.members.forEach((m, r) => {
    const y = top + (r + 1) * rowH
    const pale = tonesOf(m).row
    const values = [
      `C${m.constellation} ${m.name}`,
      m.damage,
      `${(m.share * 100).toFixed(1)}%`,
      ...(field ? [m.field ?? '–'] : []),
      m.er,
    ]
    values.forEach((v, c) => {
      const w = xs[c + 1] - xs[c]
      fillCell(xs[c], y, w, rowH, pale)
      if (c === 0)
        say(v, xs[c] + 16, y, rowH, { align: 'left', maxWidth: w - 26 })
      else say(v, xs[c + 1] - 16, y, rowH, { align: 'right', maxWidth: w - 26 })
      frame(xs[c], y, w, rowH)
    })
  })
  // the team's damage per rotation (DPR), then per second (DPS)
  const totals = (y: number, label: string, value: string, unit: string) => {
    fillCell(xs[0], y, end - xs[0], rowH, HEAD)
    say(label, xs[0] + 16, y, rowH, {
      weight: 700,
      align: 'left',
      maxWidth: xs[1] - xs[0] - 26,
    })
    say(value, xs[2] - 16, y, rowH, { weight: 600, align: 'right' })
    say(unit, (xs[2] + end) / 2, y, rowH, { weight: 700 })
    frame(xs[0], y, xs[1] - xs[0], rowH)
    frame(xs[1], y, xs[2] - xs[1], rowH)
    frame(xs[2], y, end - xs[2], rowH)
  }
  const totalY = top + (n + 1) * rowH
  totals(totalY, data.labels.total, data.total, data.labels.dpr)
  if (data.dps)
    totals(totalY + rowH, data.seconds ?? '', data.dps, data.labels.dps)

  // ── the rotation and the notes, centred in their rows
  const fullW = W - 2 * M
  const textX = M + LABEL_W + (fullW - LABEL_W) / 2
  const labelled = (y: number, h: number, label: string) => {
    fillCell(M, y, LABEL_W, h, HEAD)
    say(label, M + LABEL_W / 2, y, h, { size: 21, weight: 700 })
    fillCell(M + LABEL_W, y, fullW - LABEL_W, h, '#f8f9fc')
    frame(M, y, LABEL_W, h)
    frame(M + LABEL_W, y, fullW - LABEL_W, h)
  }
  labelled(rotY, rotH, data.labels.rotation)
  if (data.rotation?.length) {
    // (as large as the width allows, on one line)
    const text = data.rotation.join('   >   ')
    const avail = fullW - LABEL_W - 48
    let size = 28
    ctx.font = `700 ${size}px ${FONT}`
    while (size > 15 && ctx.measureText(text).width > avail) {
      size--
      ctx.font = `700 ${size}px ${FONT}`
    }
    say(text, textX, rotY, rotH, { size, weight: 700, maxWidth: avail })
  }
  labelled(notesY, ITEM_ROW, data.labels.notes)
  say(data.notes, textX, notesY, ITEM_ROW, {
    size: 19,
    maxWidth: fullW - LABEL_W - 48,
  })
  if (data.beta) betaMark(ctx, W, H, data.beta)
  return canvas
}
