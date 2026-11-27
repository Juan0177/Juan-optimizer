import { hexRgb } from './renderBuildCard'
import {
  BAR,
  BAR_BASE,
  BAR_TEXT,
  FIGURE,
  nightGround,
  SHADOW,
  SUBTITLE,
  TITLE,
} from './renderCompareChart'
import {
  betaMark,
  FONT,
  face,
  ink,
  loadImage,
  loadShareFont,
  page,
  rounded,
} from './shareStyle'

/** A cost's best constellations (and optional R1 signatures) for the team, and the team's DPS with them */
export type InvestmentRow = {
  cost: number
  /** each member's constellation (in `members`' order) */
  cons: number[]
  /** whether each member added their R1 signature weapon (in `members`' order) */
  sig?: boolean[]
  /** the team's DPS (any unit: percentages are of the first row's) */
  value: number
  /** in the bar: the DPS itself, formatted ("61.2K") */
  detail?: string
}

/** Everything the constellation investment chart shows */
export type InvestmentChartData = {
  title: string
  subtitle: string
  members: { face: string; elementColor: string; name: string }[]
  /** from cost 0 (the run's constellations: the 100%) up */
  rows: InvestmentRow[]
  /** it shows unreleased content: this name over the whole chart; absent: none */
  beta?: string
  labels: {
    cost: string
    dps: string
    /** at the foot, on the left: what a cost is */
    note: string
    siteName: string
  }
}

export const INVESTMENT_CHART_WIDTH = 1500

const M = 56
const COST_W = 76
const COL_W = 118
const ROW_H = 60
const BAR_H = 40
const FACE = 84

/**
 * The team's constellations, as an investment: for each cost (one constellation of any member),
 * the team's best constellations and its DPS with them. Read across a row: the cost, each
 * member's constellation (the raised ones in gold), the team's DPS bar and its percentage of the
 * run's. On the charts' graphite night, each member's element glowing over its column.
 */
export async function renderInvestmentChart(
  data: InvestmentChartData,
  scale = 1
): Promise<HTMLCanvasElement> {
  const font = loadShareFont()
  const faces = await Promise.all(data.members.map((m) => loadImage(m.face)))
  await font
  await document.fonts?.ready

  const W = INVESTMENT_CHART_WIDTH
  const n = data.members.length
  const colX = (j: number) => M + COST_W + j * COL_W + COL_W / 2
  const BAR_X = M + COST_W + n * COL_W + 34
  const BAR_MAX = W - M - 118 - BAR_X
  const top = 352
  const FOOT_H = 64
  const H = top + data.rows.length * ROW_H + 26 + FOOT_H + 20
  const { canvas, ctx } = page(W, H, scale)
  nightGround(
    ctx,
    W,
    H,
    data.title,
    data.members.map((m, j) => ({
      x: colX(j),
      y: 230,
      r: 300,
      color: m.elementColor,
      alpha: 0.22,
    }))
  )
  const shaded = (draw: () => void) => {
    ctx.save()
    ctx.shadowColor = SHADOW
    ctx.shadowBlur = 12
    ctx.shadowOffsetY = 2
    draw()
    ctx.restore()
  }

  // ── the title, what it measures
  shaded(() => {
    ink(ctx, data.title, W / 2, 98, {
      size: 52,
      weight: 800,
      tracking: -0.6,
      color: TITLE,
      align: 'center',
      maxWidth: W - 2 * M,
      minSize: 30,
    })
    ink(ctx, data.subtitle, W / 2, 140, {
      size: 25,
      weight: 650,
      color: SUBTITLE,
      align: 'center',
      maxWidth: W - 2 * M,
      minSize: 16,
    })
  })

  // ── the columns' heads: each member's face and name; the cost's, the DPS's
  data.members.forEach((m, j) => {
    ctx.save()
    ctx.shadowColor = SHADOW
    ctx.shadowBlur = 16
    face(ctx, faces[j], colX(j) - FACE / 2, 196, FACE, m.elementColor)
    ctx.restore()
    shaded(() =>
      ink(ctx, m.name, colX(j), 312, {
        size: 18,
        weight: 700,
        color: TITLE,
        align: 'center',
        maxWidth: COL_W - 10,
        minSize: 12,
      })
    )
  })
  const head = (text: string, x: number, align: CanvasTextAlign) =>
    ink(ctx, text, x, 312, {
      size: 16,
      weight: 650,
      color: 'rgba(236, 229, 216, 0.55)',
      align,
      tracking: 0.3,
    })
  head(data.labels.cost, M + COST_W / 2 - 6, 'center')
  head(data.labels.dps, BAR_X, 'left')

  // ── the rows: banded, so a row reads across
  const best = Math.max(...data.rows.map((r) => r.value), 1)
  const baseValue = data.rows[0]?.value || best
  const baseCons = data.rows[0]?.cons ?? []
  data.rows.forEach((row, i) => {
    const y = top + i * ROW_H
    const cy = y + ROW_H / 2
    if (i % 2 === 0) {
      rounded(ctx, M - 16, y + 3, W - 2 * M + 32, ROW_H - 6, 14)
      ctx.fillStyle = 'rgba(236, 229, 216, 0.035)'
      ctx.fill()
    }
    // the cost
    ink(ctx, `${row.cost}`, M + COST_W / 2 - 6, cy + 10, {
      size: 28,
      weight: 750,
      color: i ? FIGURE : 'rgba(230, 213, 177, 0.6)',
      align: 'center',
    })
    // each member's constellation (and optional R1 sig): upgraded ones in gold, the others faint
    row.cons.forEach((c, j) => {
      const addedSig = !!row.sig?.[j]
      const raised = c > (baseCons[j] ?? 0) || addedSig
      const x = colX(j)
      const pillW = addedSig ? 88 : 68
      if (raised) {
        const rgb = hexRgb(data.members[j]?.elementColor ?? '#d3bc8e')
        rounded(ctx, x - pillW / 2, cy - 18, pillW, 36, 18)
        ctx.fillStyle = 'rgba(211, 188, 142, 0.2)'
        ctx.fill()
        ctx.strokeStyle = `rgba(${rgb}, 0.7)`
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ink(ctx, addedSig ? `C${c}R1` : `C${c}`, x, cy + (addedSig ? 8 : 9), {
        size: addedSig ? 21 : raised ? 25 : 22,
        weight: raised ? 800 : 650,
        color: raised ? '#f4e3bc' : 'rgba(236, 229, 216, 0.3)',
        align: 'center',
      })
    })
    // the team's DPS: a bar (the run's in gold), its figure in it, its percentage after
    const w = Math.max(BAR_H * 2.5, (row.value / best) * BAR_MAX)
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
    ctx.shadowBlur = 10
    ctx.shadowOffsetY = 3
    rounded(ctx, BAR_X, cy - BAR_H / 2, w, BAR_H, [0, 10, 10, 0])
    ctx.fillStyle = i ? BAR : BAR_BASE
    ctx.fill()
    ctx.restore()
    if (row.detail)
      ink(ctx, row.detail, BAR_X + 16, cy + 8, {
        size: 21,
        weight: 700,
        color: BAR_TEXT,
        maxWidth: w - 28,
        minSize: 13,
      })
    const pct = `${Math.round((row.value / baseValue) * 100)}%`
    ctx.save()
    ctx.font = `750 28px ${FONT}`
    ctx.lineJoin = 'round'
    ctx.lineWidth = 5
    ctx.strokeStyle = 'rgba(12, 12, 16, 0.8)'
    ctx.strokeText(pct, BAR_X + w + 12, cy + 10)
    ctx.restore()
    ink(ctx, pct, BAR_X + w + 12, cy + 10, {
      size: 28,
      weight: 750,
      color: FIGURE,
    })
  })

  // ── the foot: what a cost is; the site
  const fmid = top + data.rows.length * ROW_H + 26 + FOOT_H / 2
  shaded(() => {
    ink(ctx, data.labels.note, M, fmid + 7, {
      size: 19,
      weight: 600,
      color: 'rgba(236, 229, 216, 0.82)',
      maxWidth: W - 2 * M - 360,
      minSize: 13,
    })
    ink(ctx, data.labels.siteName, W - M, fmid + 6, {
      size: 15,
      weight: 500,
      color: 'rgba(236, 229, 216, 0.7)',
      align: 'right',
    })
  })
  if (data.beta) betaMark(ctx, W, H, data.beta)
  return canvas
}
