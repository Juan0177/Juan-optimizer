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

/** A number written with a point, in the language's decimal separator; English (or none): as is */
const decimalIn = (text: string, locale?: string) =>
  !locale || locale.toLowerCase().startsWith('en')
    ? text
    : text.replace(
        '.',
        new Intl.NumberFormat(locale)
          .formatToParts(1.1)
          .find((p) => p.type === 'decimal')?.value ?? '.'
      )

/** Everything the KQM sheet shows, as plain text and image URLs */
export type KqmCardData = {
  name: string
  /** the language the figures are written in (a decimal comma for Italian); absent: English */
  locale?: string
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
const tonesOf = (m: KqmCardMember) => {
  const hue = GAME_ELEMENT[m.element] ?? m.elementColor
  return { portrait: pastel(hue, 0.34), row: pastel(hue, 0.16) }
}

/** A color, as a pale cell (an element without its own tones) */
function pastel(hex: string, amount = 0.2) {
  const v = Number.parseInt(hex.slice(1, 7), 16)
  const mix = (c: number) => Math.round(255 - (255 - c) * amount)
  return `rgb(${mix((v >> 16) & 255)}, ${mix((v >> 8) & 255)}, ${mix(v & 255)})`
}

/** How a marked value reads: better (green), worse (red), a warning (amber), a plain change */
export type KqmTone = 'better' | 'worse' | 'warn' | 'note'
/** The share pictures' tones: legible on the sheet's pale cells (contrast ≥ 4.5:1) */
export const KQM_TONE: Record<KqmTone, string> = {
  better: '#17692f',
  worse: '#a8231b',
  warn: '#8a5300',
  note: '#4a5568',
}
/** The mark for what changed (the swapped member's column and row, a rotation's step) */
export const KQM_CHANGED = '#2557a7'

/**
 * A cell's marks (the comparison's): its value in a tone (`warn`: with a warning sign), and a
 * smaller line under it (`note`) in its own tone
 */
export type KqmCardCell = {
  tone?: KqmTone
  warn?: boolean
  note?: string
  noteTone?: KqmTone
}

/** What the comparison marks on a sheet; nothing: the sheet as KQM Theorycrafting shares it */
export type KqmCardMarks = {
  /** "A", "B": before the sheet's name */
  tag?: string
  /** the member that changes: its column and row outlined, a badge on its face ("Out") */
  changed?: { index: number; badge: string }
  /** the rotation's step that changes (its index in `rotation`) */
  rotationTurn?: number
  /** a column after the damage: its header, each member's cell, the totals' (DPR, DPS) */
  delta?: {
    header: string
    members: ({ text: string } & KqmCardCell)[]
    total?: { text: string } & KqmCardCell
    dps?: { text: string } & KqmCardCell
  }
  /** marks on the members' share, field time and Energy Recharge */
  share?: (KqmCardCell | undefined)[]
  field?: (KqmCardCell | undefined)[]
  er?: (KqmCardCell | undefined)[]
  /** a line under the rotation's length ("+0.8s") */
  seconds?: { note: string; noteTone?: KqmTone }
  /** the table's columns' widths (fractions), in place of the usual */
  weights?: number[]
  /** no site's name at the top right (the picture has it elsewhere) */
  noStamp?: boolean
}

/** The sheet's images: the members' faces, weapons' and sets' icons */
export type KqmCardImages = {
  faces: (HTMLImageElement | undefined)[]
  weaponIcons: (HTMLImageElement | undefined)[]
  setIcons: (HTMLImageElement | undefined)[][]
}

/** The sheet's images, loaded */
export async function loadKqmCardImages(
  data: KqmCardData
): Promise<KqmCardImages> {
  const [faces, weaponIcons, setIcons] = await Promise.all([
    Promise.all(data.members.map((m) => loadImage(m.face))),
    Promise.all(data.members.map((m) => loadImage(m.weapon.icon ?? ''))),
    Promise.all(
      data.members.map((m) =>
        Promise.all(m.sets.map((set) => loadImage(set.icon ?? '')))
      )
    ),
  ])
  return { faces, weaponIcons, setIcons }
}

// (the sheet's rows: the name's, the faces with weapon and sets, the rotation's, the notes')
const TOP = M + 50
const BLOCK_H = PORTRAIT + 2 * ITEM_ROW
const ROT_H = 84

/** The sheet's height (its margins included) */
export function kqmCardHeight(_data?: KqmCardData) {
  return TOP + BLOCK_H + GAP + ROT_H + ITEM_ROW + M
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
  const [images] = await Promise.all([loadKqmCardImages(data), loadShareFont()])
  await document.fonts?.ready

  const W = KQM_CARD_WIDTH
  const H = kqmCardHeight(data)
  const { canvas, ctx } = page(W, H, scale)
  ctx.fillStyle = PAGE
  ctx.fillRect(0, 0, W, H)
  drawKqmCard(ctx, data, images)
  if (data.beta) betaMark(ctx, W, H, data.beta)
  return canvas
}

/**
 * The sheet drawn on `ctx` (its page already filled), its top at `y` (`kqmCardHeight` tall,
 * `KQM_CARD_WIDTH` wide), with the comparison's `marks`; no beta mark (the picture's own)
 */
export function drawKqmCard(
  ctx: CanvasRenderingContext2D,
  data: KqmCardData,
  { faces, weaponIcons, setIcons }: KqmCardImages,
  { y: y0 = 0, marks = {} }: { y?: number; marks?: KqmCardMarks } = {}
) {
  const W = KQM_CARD_WIDTH
  const n = data.members.length
  const field = data.members.some((m) => m.field)
  const top = y0 + TOP
  const blockH = BLOCK_H
  const leftW = n * COL
  const tableX = M + leftW + GAP
  const tableW = W - M - tableX
  const rotY = top + blockH + GAP
  const rotH = ROT_H
  const notesY = rotY + rotH
  const changed = marks.changed

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
  /** the changing member's outline (over the grid) */
  const outline = (x: number, y: number, w: number, h: number) => {
    ctx.strokeStyle = KQM_CHANGED
    ctx.lineWidth = 4
    ctx.strokeRect(x + 2, y + 2, w - 4, h - 4)
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
      color?: string
    } = {}
  ) => {
    const size = opts.size ?? 20
    ink(ctx, value, x, mid(y, h, size), {
      size,
      weight: opts.weight ?? 500,
      color: opts.color ?? TEXT,
      align: opts.align ?? 'center',
      maxWidth: opts.maxWidth,
      minSize: Math.min(size, 13),
    })
  }
  /** a warning sign: an amber triangle with "!" (its left at `x`, centred on `cy`) */
  const warnSign = (x: number, cy: number, size: number) => {
    ctx.beginPath()
    ctx.moveTo(x + size / 2, cy - size / 2)
    ctx.lineTo(x + size, cy + size / 2)
    ctx.lineTo(x, cy + size / 2)
    ctx.closePath()
    ctx.fillStyle = KQM_TONE.warn
    ctx.fill()
    ink(ctx, '!', x + size / 2, cy + size / 2 - 2, {
      size: size * 0.75,
      weight: 800,
      color: '#ffffff',
      align: 'center',
    })
  }
  /**
   * A marked cell's value (right or left aligned at `x`), in its tone, with a warning sign before
   * it and its note on a smaller line under it
   */
  const markedCell = (
    value: string,
    cell: KqmCardCell,
    x: number,
    y: number,
    h: number,
    opts: { align: 'left' | 'right'; maxWidth: number; weight?: number }
  ) => {
    const size = cell.note ? 17 : 20
    const base = cell.note ? y + h / 2 : mid(y, h, size)
    const sign = cell.warn ? size * 0.9 + 6 : 0
    const width = ink(
      ctx,
      value,
      x + (opts.align === 'left' ? sign : 0),
      base,
      {
        size,
        weight: opts.weight ?? (cell.tone ? 700 : 500),
        color: cell.tone ? KQM_TONE[cell.tone] : TEXT,
        align: opts.align,
        maxWidth: opts.maxWidth - sign,
        minSize: 13,
      }
    )
    if (cell.warn) {
      const sx = opts.align === 'left' ? x : x - width - sign
      warnSign(sx, base - size * 0.35, size * 0.9)
    }
    if (cell.note)
      ink(ctx, cell.note, x, base + 15, {
        size: 13,
        weight: 600,
        color: KQM_TONE[cell.noteTone ?? 'note'],
        align: opts.align,
        maxWidth: opts.maxWidth,
        minSize: 11,
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

  // ── the team's name (after its tag), the site
  let nameX = M
  if (marks.tag) {
    ctx.fillStyle = TEXT
    ctx.beginPath()
    ctx.roundRect(M, y0 + M + 2, 38, 36, 8)
    ctx.fill()
    ink(ctx, marks.tag, M + 19, y0 + M + 29, {
      size: 24,
      weight: 800,
      color: '#ffffff',
      align: 'center',
    })
    nameX = M + 52
  }
  ink(ctx, data.name, nameX, y0 + M + 28, {
    size: 26,
    weight: 700,
    color: TEXT,
    maxWidth: W - M - nameX - 380,
    minSize: 18,
  })
  if (!marks.noStamp)
    ink(ctx, data.labels.siteName, W - M, y0 + M + 28, {
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
  if (changed) {
    // (the changing member: its column outlined, a badge at the top of its face)
    const x = M + changed.index * COL
    outline(x, top, COL, blockH)
    ctx.font = `700 15px ${FONT}`
    const bw = Math.min(COL - 16, ctx.measureText(changed.badge).width + 20)
    ctx.fillStyle = KQM_CHANGED
    ctx.beginPath()
    ctx.roundRect(x + (COL - bw) / 2, top + 10, bw, 26, 13)
    ctx.fill()
    ink(ctx, changed.badge, x + COL / 2, top + 28, {
      size: 15,
      weight: 700,
      color: '#ffffff',
      align: 'center',
      maxWidth: bw - 12,
      minSize: 11,
    })
  }

  // ── the table: each member's damage per rotation, share, field time, Energy Recharge
  const delta = marks.delta
  const weights =
    marks.weights ??
    (field ? [0.33, 0.25, 0.14, 0.13, 0.15] : [0.38, 0.28, 0.17, 0.17])
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
    ...(delta ? [delta.header] : []),
    data.labels.dist,
    ...(field ? [data.labels.field] : []),
    data.labels.er,
  ]
  headers.forEach((h, c) => {
    fillCell(xs[c], top, xs[c + 1] - xs[c], rowH, HEAD)
    // (two labels: on two smaller lines)
    const lines = h.split('\n')
    if (lines.length > 1)
      lines.forEach((line, k) =>
        ink(
          ctx,
          line,
          (xs[c] + xs[c + 1]) / 2,
          top + rowH / 2 + 5 + (k - (lines.length - 1) / 2) * 17,
          {
            size: 14,
            weight: 700,
            color: TEXT,
            align: 'center',
            maxWidth: xs[c + 1] - xs[c] - 10,
            minSize: 11,
          }
        )
      )
    else say(h, (xs[c] + xs[c + 1]) / 2, top, rowH, { weight: 700 })
    frame(xs[c], top, xs[c + 1] - xs[c], rowH)
  })
  data.members.forEach((m, r) => {
    const y = top + (r + 1) * rowH
    const pale = tonesOf(m).row
    const values = [
      `C${m.constellation} ${m.name}`,
      m.damage,
      ...(delta ? [delta.members[r]?.text ?? ''] : []),
      `${decimalIn((m.share * 100).toFixed(1), data.locale)}%`,
      ...(field ? [m.field ?? '–'] : []),
      m.er,
    ]
    // (the comparison's marks, by column)
    const cells: (KqmCardCell | undefined)[] = [
      undefined,
      undefined,
      ...(delta ? [delta.members[r]] : []),
      marks.share?.[r],
      ...(field ? [marks.field?.[r]] : []),
      marks.er?.[r],
    ]
    values.forEach((v, c) => {
      const w = xs[c + 1] - xs[c]
      fillCell(xs[c], y, w, rowH, pale)
      const cell = cells[c]
      if (cell)
        markedCell(v, cell, xs[c + 1] - 16, y, rowH, {
          align: 'right',
          maxWidth: w - 26,
        })
      else if (c === 0)
        say(v, xs[c] + 16, y, rowH, { align: 'left', maxWidth: w - 26 })
      else say(v, xs[c + 1] - 16, y, rowH, { align: 'right', maxWidth: w - 26 })
      frame(xs[c], y, w, rowH)
    })
    if (changed?.index === r) outline(xs[0], y, end - xs[0], rowH)
  })
  // the team's damage per rotation (DPR), then per second (DPS)
  const unitX = delta ? xs[3] : xs[2]
  const totals = (
    y: number,
    label: string,
    value: string,
    unit: string,
    change?: { text: string } & KqmCardCell,
    note?: { note: string; noteTone?: KqmTone }
  ) => {
    fillCell(xs[0], y, end - xs[0], rowH, HEAD)
    if (note)
      markedCell(label, { ...note, tone: undefined }, xs[0] + 16, y, rowH, {
        align: 'left',
        maxWidth: xs[1] - xs[0] - 26,
        weight: 700,
      })
    else
      say(label, xs[0] + 16, y, rowH, {
        weight: 700,
        align: 'left',
        maxWidth: xs[1] - xs[0] - 26,
      })
    say(value, xs[2] - 16, y, rowH, { weight: 600, align: 'right' })
    if (change)
      markedCell(change.text, change, xs[3] - 16, y, rowH, {
        align: 'right',
        maxWidth: xs[3] - xs[2] - 26,
      })
    say(unit, (unitX + end) / 2, y, rowH, { weight: 700 })
    frame(xs[0], y, xs[1] - xs[0], rowH)
    frame(xs[1], y, xs[2] - xs[1], rowH)
    if (delta) frame(xs[2], y, xs[3] - xs[2], rowH)
    frame(unitX, y, end - unitX, rowH)
  }
  const totalY = top + (n + 1) * rowH
  totals(totalY, data.labels.total, data.total, data.labels.dpr, delta?.total)
  if (data.dps)
    totals(
      totalY + rowH,
      data.seconds ?? '',
      data.dps,
      data.labels.dps,
      delta?.dps,
      marks.seconds
    )

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
    const SEP = '   >   '
    const text = data.rotation.join(SEP)
    const avail = fullW - LABEL_W - 48
    let size = 28
    ctx.font = `700 ${size}px ${FONT}`
    while (size > 15 && ctx.measureText(text).width > avail) {
      size--
      ctx.font = `700 ${size}px ${FONT}`
    }
    const turn = marks.rotationTurn
    if (turn === undefined || !data.rotation[turn])
      say(text, textX, rotY, rotH, { size, weight: 700, maxWidth: avail })
    else {
      // (the changing step on a tint, outlined, in the mark's color; the rest as usual)
      const width = Math.min(avail, ctx.measureText(text).width)
      const before = data.rotation.slice(0, turn).join(SEP)
      const startX =
        textX - width / 2 + (before ? ctx.measureText(before + SEP).width : 0)
      const turnW = ctx.measureText(data.rotation[turn]).width
      ctx.fillStyle = 'rgba(37, 87, 167, 0.14)'
      ctx.beginPath()
      ctx.roundRect(startX - 10, rotY + 14, turnW + 20, rotH - 28, 8)
      ctx.fill()
      ctx.strokeStyle = KQM_CHANGED
      ctx.lineWidth = 2
      ctx.stroke()
      say(text, textX, rotY, rotH, { size, weight: 700, maxWidth: avail })
      ink(ctx, data.rotation[turn], startX, mid(rotY, rotH, size), {
        size,
        weight: 800,
        color: KQM_CHANGED,
      })
    }
  }
  labelled(notesY, ITEM_ROW, data.labels.notes)
  say(data.notes, textX, notesY, ITEM_ROW, {
    size: 19,
    maxWidth: fullW - LABEL_W - 48,
  })
}
