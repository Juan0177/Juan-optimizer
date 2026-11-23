import type {
  KqmCardData,
  KqmCardImages,
  KqmCardMarks,
  KqmTone,
} from './renderKqmCard'
import {
  drawKqmCard,
  KQM_CARD_WIDTH,
  KQM_CHANGED,
  KQM_TONE,
  kqmCardHeight,
  loadKqmCardImages,
} from './renderKqmCard'
import { betaMark, ink, loadShareFont, page } from './shareStyle'

/** A change of B against A as the header shows it: "−4.3%", in its tone */
export type KqmCompareFigure = { text: string; tone?: KqmTone }

/**
 * Everything the comparison card shows: team A and team B as KQM sheets with what changed marked
 * on B's, and in its header the swap and the change of the team's figures
 */
export type KqmCompareCardData = {
  name: string
  /** the change: one swap's two sides ("Nicole → Bennett"), or a line (several, or none) */
  swap: { out: string; in: string } | { line: string }
  /** "Juan-optimizer (Stellar v1.13.1) · 17 nov 2026" */
  siteName: string
  /** it shows unreleased content: this name over the whole picture */
  beta?: string
  labels: {
    /** "Change (B over A)" */
    delta: string
    dpr: string
    dps: string
    /** the rotation's length */
    rotationTime: string
  }
  /** B against A: damage per rotation, per second, and the rotation's length ("19.4s → 20.2s") */
  delta: {
    dpr: KqmCompareFigure
    dps?: KqmCompareFigure
    rotationTime?: KqmCompareFigure
  }
  a: { card: KqmCardData; marks: KqmCardMarks }
  b: { card: KqmCardData; marks: KqmCardMarks }
}

export const KQM_COMPARE_CARD_WIDTH = KQM_CARD_WIDTH
// (the header; then each sheet, A's margin under it shared with B's over it)
const HEAD_H = 128
const SHEET_GAP = 14
/**
 * A KQM sheet's usual height (`kqmCardHeight`, as a number: this module may be read before the
 * sheet's, the buildCard modules importing each other)
 */
export const KQM_COMPARE_SHEET_H = 594
/** The sheets' tops and the card's height, from the sheets' heights (A's, B's) */
const layout = (a: number, b: number) => {
  const ya = HEAD_H - 24
  const yb = ya + a - 36 + SHEET_GAP
  return { ya, yb, height: yb + b }
}
/** The usual card's height (for placeholders) */
export const KQM_COMPARE_CARD_HEIGHT = layout(
  KQM_COMPARE_SHEET_H,
  KQM_COMPARE_SHEET_H
).height
/** The card's height: its sheets' (taller when detailed) */
export function kqmCompareCardHeight(
  data: Pick<KqmCompareCardData, 'a' | 'b'>
) {
  return sheetsLayout(data).height
}
const sheetsLayout = ({ a, b }: Pick<KqmCompareCardData, 'a' | 'b'>) =>
  layout(kqmCardHeight(a.card), kqmCardHeight(b.card))

const TEXT = '#1c2331'
const PAGE = '#e8ecf3'
const GRID = 'rgba(78, 96, 128, 0.55)'
const M = 36

/**
 * Team A (KQM Theorycrafting's result) against team B (the same team with one member swapped): a
 * header with the swap and the change of the team's damage and rotation, then A's KQM sheet and
 * B's under it, what changed marked on B's.
 */
export async function renderKqmCompareCard(
  data: KqmCompareCardData,
  scale = 2
): Promise<HTMLCanvasElement> {
  const [a, b] = await Promise.all([
    loadKqmCardImages(data.a.card),
    loadKqmCardImages(data.b.card),
    loadShareFont(),
  ])
  await document.fonts?.ready
  const W = KQM_COMPARE_CARD_WIDTH
  const { ya, yb, height: H } = sheetsLayout(data)
  const { canvas, ctx } = page(W, H, scale)
  ctx.fillStyle = PAGE
  ctx.fillRect(0, 0, W, H)
  drawCompareHeader(ctx, data)
  const images: KqmCardImages[] = [a, b]
  ;[data.a, data.b].forEach((side, i) =>
    drawKqmCard(ctx, side.card, images[i], {
      y: i ? yb : ya,
      marks: { ...side.marks, noStamp: true },
    })
  )
  // (between the sheets: a rule)
  ctx.fillStyle = GRID
  ctx.fillRect(M, yb + 6, W - 2 * M, 1.5)
  if (data.beta) betaMark(ctx, W, H, data.beta)
  return canvas
}

/** The header: the team, the swap; the change of DPR, DPS and the rotation's length, large */
function drawCompareHeader(
  ctx: CanvasRenderingContext2D,
  data: KqmCompareCardData
) {
  const W = KQM_COMPARE_CARD_WIDTH
  ink(ctx, data.siteName, W - M, M + 8, {
    size: 15,
    color: 'rgba(28, 35, 49, 0.55)',
    align: 'right',
  })
  ink(ctx, data.name, M, M + 34, {
    size: 30,
    weight: 700,
    color: TEXT,
    maxWidth: 760,
    minSize: 20,
  })
  const swap =
    'line' in data.swap
      ? data.swap.line
      : `${data.swap.out}  →  ${data.swap.in}`
  ink(ctx, swap, M, M + 76, {
    size: 26,
    weight: 800,
    color: KQM_CHANGED,
    maxWidth: 760,
    minSize: 18,
  })

  // the figures, right to left: rotation's length, DPS, DPR
  const figures = [
    { label: data.labels.dpr, figure: data.delta.dpr, w: 190 },
    ...(data.delta.dps
      ? [{ label: data.labels.dps, figure: data.delta.dps, w: 190 }]
      : []),
    ...(data.delta.rotationTime
      ? [
          {
            label: data.labels.rotationTime,
            figure: data.delta.rotationTime,
            w: 250,
          },
        ]
      : []),
  ]
  const boxY = M + 22
  const boxH = 72
  let x = W - M
  for (const { label, figure, w } of [...figures].reverse()) {
    x -= w
    ctx.fillStyle = '#f8f9fc'
    ctx.fillRect(x, boxY, w, boxH)
    ctx.strokeStyle = GRID
    ctx.lineWidth = 1.5
    ctx.strokeRect(x, boxY, w, boxH)
    ink(ctx, label, x + w / 2, boxY + 22, {
      size: 15,
      weight: 700,
      color: TEXT,
      align: 'center',
      maxWidth: w - 16,
      minSize: 11,
    })
    ink(ctx, figure.text, x + w / 2, boxY + 58, {
      size: 28,
      weight: 800,
      color: figure.tone ? KQM_TONE[figure.tone] : TEXT,
      align: 'center',
      maxWidth: w - 16,
      minSize: 16,
    })
    x -= 12
  }
  ink(ctx, data.labels.delta, x - 6, boxY + boxH / 2 + 6, {
    size: 17,
    weight: 700,
    color: TEXT,
    align: 'right',
  })
}
