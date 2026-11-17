import { charIllustration, charSplash } from '@genshin-optimizer/gi/char-cards'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { hexRgb, offscreen } from './renderBuildCard'
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

/** A bar of a comparison: an option (a weapon, sets or a constellation) and the team's damage with it */
export type CompareRow = {
  label: string
  /** its icons (two for 2+2 sets) */
  icons: { src: string; rarity?: number }[]
  /** the team's damage with it, in any unit (bars and percentages are relative) */
  value: number
  /**
   * the member's own damage with it (the constellation chart): a second, slimmer bar under the
   * team's, with its own percentage of the 100%'s
   */
  personal?: number
  /** the 100%: the option the others are measured against (its bar in the member's color) */
  base?: boolean
  /** it misses a requirement the chosen build meets (an Energy Recharge target) */
  unmet?: boolean
}

/** Everything a comparison chart shows */
export type CompareChartData = {
  title: string
  subtitle: string
  rows: CompareRow[]
  /** the member compared: its face, its color */
  member: {
    face: string
    elementColor: string
    /** its splash art (transparent), or official art (opaque): on the right, full strength */
    splash?: string
  }
  /** the team, at the foot: each member's face and line ("C0 Mitya") */
  team?: { face: string; elementColor: string; label: string }[]
  /** the team and the standard, at the foot */
  footer: string
  /** it shows unreleased content: this name ("7.3 beta v3") over the whole chart; absent: none */
  beta?: string
  labels: {
    unmet: string
    siteName: string
    /** the two bars' names when rows have a `personal` value: "Team DPS", "Mitya's DPS" */
    team?: string
    personal?: string
  }
}

/** A member's art beside a chart: its splash art, else (unreleased) its official art */
export const compareChartSplash = (ck: CharacterKey, gender: GenderKey) =>
  charSplash(ck, gender) ?? charIllustration(ck)

export const COMPARE_CHART_WIDTH = 1500
/** The usual height of a ranking of 20 (for placeholders) */
export const COMPARE_CHART_HEIGHT = 1900

const M = 56
const MAX_ROWS = 20
const ROW_H = 80
const BAR_H = 62
/** where the bars start (after the icons), and the longest bar's length */
const BAR_X = M + 92
const BAR_MAX = 840
/** The longest bar beside art: the column right of the percentages is the character's */
const BAR_MAX_ART = 700

// the charts' palette, the site's own (graphite, parchment, one gold), the same for every
// character: a graphite-night ground with the member's element glowing where its art stands,
// parchment bars (the 100%'s gold), gold figures, parchment type
const GROUND_TOP = '#15161d'
const GROUND_BOTTOM = '#1f2029'
export const BAR = '#ece5d8'
export const BAR_BASE = '#d3bc8e'
export const BAR_TEXT = '#1b1914'
export const FIGURE = '#e6d5b1'
export const TITLE = '#f5f0e6'
export const SUBTITLE = '#d3bc8e'
export const SHADOW = 'rgba(6, 6, 10, 0.7)'

/**
 * The charts' ground (drawn: sharp at any size): graphite night, glows (an element's where its
 * character stands; always a gold one at the top left), faint stars (the same for the same
 * `seedText`, denser toward the right), the corners deeper
 */
export function nightGround(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  seedText: string,
  glows: { x: number; y: number; r: number; color: string; alpha: number }[]
) {
  const ground = ctx.createLinearGradient(0, 0, W * 0.4, H)
  ground.addColorStop(0, GROUND_TOP)
  ground.addColorStop(1, GROUND_BOTTOM)
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, W, H)
  const glowAt = (
    x: number,
    y: number,
    r: number,
    color: string,
    alpha: number
  ) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${color}, ${alpha})`)
    g.addColorStop(0.55, `rgba(${color}, ${alpha * 0.35})`)
    g.addColorStop(1, `rgba(${color}, 0)`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
  for (const g of glows) glowAt(g.x, g.y, g.r, hexRgb(g.color), g.alpha)
  glowAt(W * 0.06, 0, W * 0.55, '211, 188, 142', 0.1)
  let seed = [...seedText].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let i = 0; i < 160; i++) {
    const x = W * Math.sqrt(random())
    const y = H * random()
    const r = 0.5 + random() * random() * 1.6
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(245, 238, 222, ${0.15 + random() * 0.45})`
    ctx.fill()
  }
  const vignette = ctx.createRadialGradient(
    W / 2,
    H / 2,
    Math.min(W, H) * 0.35,
    W / 2,
    H / 2,
    Math.hypot(W, H) / 2
  )
  vignette.addColorStop(0, 'rgba(6, 6, 10, 0)')
  vignette.addColorStop(1, 'rgba(6, 6, 10, 0.5)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, W, H)
}

/**
 * Where the character is in a transparent splash, as fractions of it: the columns and rows that
 * hold most of its opaque pixels (a few stray sparkles and effects at the edges left out) and the
 * middle of its weight across. Opaque art (no transparency to go by), or nothing drawn: undefined.
 */
function subjectOf(img: HTMLImageElement) {
  const w = 160
  const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth))
  const c = offscreen(w, h)
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return undefined
  g.drawImage(img, 0, 0, w, h)
  let data: Uint8ClampedArray
  try {
    data = g.getImageData(0, 0, w, h).data
  } catch {
    return undefined
  }
  const cols = new Float64Array(w)
  const lines = new Float64Array(h)
  let total = 0
  let sumX = 0
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const alpha = data[(j * w + i) * 4 + 3] / 255
      cols[i] += alpha
      lines[j] += alpha
      sumX += alpha * i
      total += alpha
    }
  // (nothing, or opaque all over)
  if (total < 1 || total > w * h * 0.9) return undefined
  const range = (sums: Float64Array, low: number, high: number) => {
    let acc = 0
    let from = 0
    while (from < sums.length - 1 && acc + sums[from] < total * low)
      acc += sums[from++]
    acc = 0
    let to = sums.length - 1
    while (to > from && acc + sums[to] < total * high) acc += sums[to--]
    return [from / sums.length, (to + 1) / sums.length] as const
  }
  const [x0, x1] = range(cols, 0.1, 0.1)
  const [y0, y1] = range(lines, 0.02, 0.06)
  return { x0, x1, y0, y1, cx: sumX / total / w }
}

/**
 * A comparison to share: options as bars of the team's damage relative to a base one (100%), best
 * first, on a graphite-night ground (drawn: sharp at any size). The member's splash
 * art stands full strength on the right; the bars are solid and end a little past the middle at
 * most, so the art shows beside them; each percentage follows its bar.
 */
export async function renderCompareChart(
  data: CompareChartData,
  /** 1: 1500 px across, the splash art at about its own size (sharp); larger only enlarges it */
  scale = 1
): Promise<HTMLCanvasElement> {
  const rows = data.rows.slice(0, MAX_ROWS)
  // (the 100% is always shown, last if it did not make the list)
  const base = data.rows.find((r) => r.base)
  if (base && !rows.includes(base)) rows[rows.length - 1] = base
  const font = loadShareFont()
  const team = data.team ?? []
  const [[faceImg, splash, ...icons], teamFaces] = await Promise.all([
    Promise.all([
      loadImage(data.member.face),
      loadImage(data.member.splash ?? ''),
      ...rows.flatMap((r) => r.icons.map((i) => loadImage(i.src))),
    ]),
    Promise.all(team.map((m) => loadImage(m.face))),
  ])
  await font
  await document.fonts?.ready

  const W = COMPARE_CHART_WIDTH
  // (shorter bars beside art: room for the character)
  const barMax = splash ? BAR_MAX_ART : BAR_MAX
  // (rows with the member's own damage too: taller, two bars each, a legend over them)
  const dual = rows.some((r) => r.personal !== undefined)
  const rowH = dual ? 96 : ROW_H
  const top = dual ? 232 : 196
  const FOOT_H = 64
  // (as tall as its rows need)
  const H = top + rows.length * rowH + 28 + FOOT_H + 24
  const { canvas, ctx } = page(W, H, scale)

  // ── the ground, drawn (sharp at any size): graphite night, a glow of the member's element where
  // the character stands, a cooler one at the top left, a few faint stars
  nightGround(ctx, W, H, data.title, [
    {
      x: W * 0.74,
      y: H * 0.45,
      r: Math.max(H, W) * 0.62,
      color: data.member.elementColor,
      alpha: 0.3,
    },
  ])

  // ── the splash art, sharp and full strength, in the column right of the bars and their
  // percentages: never blurred or dimmed, enlarged at most a little (the game's 2048×1024 is the
  // largest there is). A transparent splash is placed by where its character is (`subjectOf`):
  // the character fills the column, centred on the list (short or long), anything of the art left
  // of the column fading out; its top and foot fade where the picture goes on past them. Opaque
  // official art (unreleased characters) stands at the right, faded in from its own left edge.
  if (splash) {
    const art = offscreen(Math.round(W * scale), Math.round(H * scale))
    const a = art.getContext('2d')
    if (a) {
      a.scale(scale, scale)
      a.imageSmoothingQuality = 'high'
      const ratio = splash.naturalWidth / splash.naturalHeight
      // (at most 1.3 times its own pixels: sharp)
      const sharp = (splash.naturalHeight * 1.3) / scale
      // the column: from the longest bar's percentage to the right edge; the list, top to bottom
      const colLeft = BAR_X + barMax + 96
      const colWidth = W - colLeft
      const listTop = top - 24
      const listBottom = top + rows.length * rowH + 12
      const listMid = (listTop + listBottom) / 2
      const subject = subjectOf(splash)
      let x: number
      let y: number
      let dh: number
      if (subject) {
        const sw = subject.x1 - subject.x0
        const sh = subject.y1 - subject.y0
        // as large as is sharp, the character as wide as the column (a little may leave the
        // picture on the right) and no taller than the picture
        // (a long list has the height for a larger character: more of it may leave on the right)
        const tall = Math.min(1, Math.max(0, (rows.length - 8) / 12))
        dh = Math.min(
          sharp,
          (colWidth * (1.25 + 0.35 * tall)) / (sw * ratio),
          (H * 0.98) / sh
        )
        const dw = dh * ratio
        // its middle a little right of the column's (room from the percentages)
        x = colLeft + colWidth * 0.62 - subject.cx * dw
        // its middle on the list's (a little above it on a long list: the face nearer the top), its
        // top not above the picture's
        y =
          listMid -
          (listBottom - listTop) * 0.06 * tall -
          ((subject.y0 + subject.y1) / 2) * dh
        y = Math.min(Math.max(y, 8 - subject.y0 * dh), H - subject.y1 * dh - 8)
      } else {
        // opaque art: the column and a little more (its left edge fades in), at the right
        dh = Math.min(sharp, H, (colWidth + 140) / ratio)
        x = W - dh * ratio
        y = Math.max(0, Math.min(listMid - dh / 2, H - dh))
      }
      const dw = dh * ratio
      a.drawImage(splash, x, y, dw, dh)
      a.globalCompositeOperation = 'destination-in'
      if (subject) {
        // (left of the column, out)
        const fade = a.createLinearGradient(colLeft - 150, 0, colLeft + 30, 0)
        fade.addColorStop(0, 'rgba(0, 0, 0, 0)')
        fade.addColorStop(1, 'rgba(0, 0, 0, 1)')
        a.fillStyle = fade
        a.fillRect(0, 0, W, H)
        // (its top and foot, where the picture goes on past them: the whole picture is painted,
        // as destination-in clears what it does not cover)
        const edge = (from: number, to: number) => {
          const g = a.createLinearGradient(0, from, 0, to)
          g.addColorStop(0, 'rgba(0, 0, 0, 0)')
          g.addColorStop(1, 'rgba(0, 0, 0, 1)')
          a.fillStyle = g
          a.fillRect(0, 0, W, H)
        }
        if (y > 1) edge(y, y + Math.min(200, dh * 0.2))
        if (y + dh < H - 1) edge(y + dh, y + dh - Math.min(300, dh * 0.3))
        // (a wide oval around the character: the whole figure kept, a splash's background
        // effects far from it, a half-transparent backdrop's corners, faded)
        const sx = x + ((subject.x0 + subject.x1) / 2) * dw
        const sy = y + ((subject.y0 + subject.y1) / 2) * dh
        const ox = Math.max((subject.x1 - subject.x0) * dw * 1, 1)
        const oy = (subject.y1 - subject.y0) * dh * 0.82
        a.save()
        a.translate(sx, sy)
        a.scale(1, oy / ox)
        const oval = a.createRadialGradient(0, 0, 0, 0, 0, ox)
        oval.addColorStop(0, 'rgba(0, 0, 0, 1)')
        oval.addColorStop(0.5, 'rgba(0, 0, 0, 1)')
        oval.addColorStop(1, 'rgba(0, 0, 0, 0)')
        a.fillStyle = oval
        a.fillRect(-W * 4, -H * 4, W * 8, H * 8)
        a.restore()
      } else {
        // opaque art: an oval around the character, its background fading out on every side (no
        // box shows, whatever its colour)
        const rx = dw * 0.5
        const ry = dh * 0.47
        a.save()
        a.translate(x + dw * 0.54, y + dh * 0.45)
        a.scale(1, ry / rx)
        const oval = a.createRadialGradient(0, 0, 0, 0, 0, rx)
        oval.addColorStop(0, 'rgba(0, 0, 0, 1)')
        oval.addColorStop(0.5, 'rgba(0, 0, 0, 1)')
        oval.addColorStop(1, 'rgba(0, 0, 0, 0)')
        a.fillStyle = oval
        a.fillRect(-W * 4, -H * 4, W * 8, H * 8)
        a.restore()
      }
      ctx.drawImage(art, 0, 0, W, H)
    }
  }
  // (the foot a little darker, for the team's line)
  const foot = ctx.createLinearGradient(0, H - 200, 0, H)
  foot.addColorStop(0, 'rgba(10, 10, 14, 0)')
  foot.addColorStop(1, 'rgba(10, 10, 14, 0.6)')
  ctx.fillStyle = foot
  ctx.fillRect(0, H - 200, W, 200)

  // white type with a soft dark shadow, clear on the art
  const shaded = (draw: () => void) => {
    ctx.save()
    ctx.shadowColor = SHADOW
    ctx.shadowBlur = 12
    ctx.shadowOffsetY = 2
    draw()
    ctx.restore()
  }

  /**
   * How much the picture so far would disrupt light type in a box (0 calm … 1 bad): a light
   * patch, or a busy one (its lightness varying a lot), from a few thousand of its pixels;
   * unreadable: assumed bad
   */
  const disruption = (x: number, y: number, w: number, h: number) => {
    try {
      const sx = Math.max(0, Math.floor(x * scale))
      const sy = Math.max(0, Math.floor(y * scale))
      const sw = Math.min(canvas.width - sx, Math.ceil(w * scale))
      const sh = Math.min(canvas.height - sy, Math.ceil(h * scale))
      if (sw <= 0 || sh <= 0) return 0
      const d = ctx.getImageData(sx, sy, sw, sh).data
      const step = Math.max(1, Math.floor(Math.sqrt((sw * sh) / 3000)))
      let n = 0
      let sum = 0
      let sum2 = 0
      for (let j = 0; j < sh; j += step)
        for (let i = 0; i < sw; i += step) {
          const k = (j * sw + i) * 4
          const l =
            (0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]) / 255
          sum += l
          sum2 += l * l
          n++
        }
      const mean = sum / n
      const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean))
      return Math.min(1, Math.max(0, (mean - 0.22) * 1.8 + sd * 2.4))
    } catch {
      return 1
    }
  }
  /**
   * Under light type, a box of the picture made calm enough to read on, as much as it needs: a
   * calm patch is left as it is; a disruptive one gets a frosted chip (the patch blurred, then
   * darkened the more, the worse it was)
   */
  const settle = (x: number, y: number, w: number, h: number, r: number) => {
    const risk = disruption(x, y, w, h)
    if (risk < 0.3) return
    const tiny = offscreen(
      Math.max(1, Math.round(w / 12)),
      Math.max(1, Math.round(h / 12))
    )
    tiny
      .getContext('2d')
      ?.drawImage(
        canvas,
        x * scale,
        y * scale,
        w * scale,
        h * scale,
        0,
        0,
        tiny.width,
        tiny.height
      )
    ctx.save()
    rounded(ctx, x, y, w, h, r)
    ctx.clip()
    ctx.drawImage(tiny, x, y, w, h)
    ctx.fillStyle = `rgba(14, 14, 20, ${0.3 + 0.45 * risk})`
    ctx.fillRect(x, y, w, h)
    ctx.restore()
    rounded(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r)
    ctx.strokeStyle = 'rgba(236, 229, 216, 0.12)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // ── the member's face and the title, centred together; what it measures under it
  const FACE = 118
  ctx.font = `800 52px ${FONT}`
  ;(ctx as { letterSpacing?: string }).letterSpacing = '-0.6px'
  const titleW = Math.min(
    ctx.measureText(data.title).width,
    W - 2 * M - FACE - 24
  )
  ;(ctx as { letterSpacing?: string }).letterSpacing = '0px'
  const blockX = (W - (FACE + 24 + titleW)) / 2
  if (faceImg) {
    ctx.save()
    ctx.shadowColor = SHADOW
    ctx.shadowBlur = 14
    ctx.drawImage(faceImg, blockX, 40, FACE, FACE)
    ctx.restore()
  }
  const textMid = blockX + FACE + 24 + titleW / 2
  ctx.font = `650 25px ${FONT}`
  const subW = Math.min(ctx.measureText(data.subtitle).width, W - 2 * M)
  const blockW = Math.max(titleW, subW) + 48
  settle(textMid - blockW / 2, 50, blockW, 116, 22)
  shaded(() => {
    ink(ctx, data.title, textMid, 104, {
      size: 52,
      weight: 800,
      tracking: -0.6,
      color: TITLE,
      align: 'center',
      maxWidth: titleW,
      minSize: 30,
    })
    ink(ctx, data.subtitle, textMid, 146, {
      size: 25,
      weight: 650,
      color: SUBTITLE,
      align: 'center',
      maxWidth: W - 2 * M,
      minSize: 16,
    })
  })

  // ── the bars: solid, the 100%'s deeper; the line they start from
  ctx.fillStyle = 'rgba(211, 188, 142, 0.55)'
  ctx.fillRect(BAR_X - 2, top - 8, 2, rows.length * rowH + 16)
  const best = Math.max(...rows.map((r) => r.value), 1)
  const baseValue = base?.value || best
  const bestOwn = Math.max(...rows.map((r) => r.personal ?? 0), 1)
  const baseOwn = base?.personal || bestOwn
  const own = hexRgb(data.member.elementColor)
  /** A percentage after its bar, outlined (clear on any part of the art) */
  const figure = (
    text: string,
    x: number,
    y: number,
    size: number,
    color: string
  ) => {
    ctx.font = `750 ${size}px ${FONT}`
    settle(
      x - 8,
      y - size * 0.95,
      ctx.measureText(text).width + 18,
      size * 1.5,
      14
    )
    ctx.save()
    ctx.font = `750 ${size}px ${FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.lineJoin = 'round'
    ctx.lineWidth = size / 5
    ctx.strokeStyle = 'rgba(12, 12, 16, 0.8)'
    ctx.shadowColor = SHADOW
    ctx.shadowBlur = 10
    ctx.strokeText(text, x, y)
    ctx.restore()
    ink(ctx, text, x, y, { size, weight: 750, color })
  }
  // (the legend: which bar is which)
  if (dual) {
    ctx.font = `650 19px ${FONT}`
    const items = [
      { label: data.labels.team ?? '', fill: BAR, h: 14 },
      { label: data.labels.personal ?? '', fill: `rgb(${own})`, h: 8 },
    ]
    const widths = items.map((x) => 40 + 10 + ctx.measureText(x.label).width)
    let lx = (W - widths.reduce((a, b) => a + b, 0) - 36) / 2
    const ly = 186
    items.forEach((item, k) => {
      rounded(ctx, lx, ly - item.h / 2, 40, item.h, [0, 4, 4, 0])
      ctx.fillStyle = item.fill
      ctx.fill()
      shaded(() =>
        ink(ctx, item.label, lx + 50, ly + 7, {
          size: 19,
          weight: 650,
          color: TITLE,
        })
      )
      lx += widths[k] + 36
    })
  }
  let iconIndex = 0
  rows.forEach((row, i) => {
    const cy = top + i * rowH + rowH / 2
    // its icons, straight on the ground (two sets overlapping)
    const two = row.icons.length > 1
    row.icons.forEach((_, k) => {
      const img = icons[iconIndex++]
      if (!img) return
      const size = two ? 52 : 70
      const ix = two ? M - 8 + k * 30 : M + (BAR_X - M - size) / 2 - 4
      const iy = cy - size / 2 + (two ? (k ? 9 : -9) : 0)
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
      ctx.shadowBlur = 8
      ctx.shadowOffsetY = 2
      ctx.drawImage(img, ix, iy, size, size)
      ctx.restore()
    })
    ctx.save()
    if (row.unmet) ctx.globalAlpha = 0.62
    const w = Math.max(BAR_H * 2, (row.value / best) * barMax)
    // (with the member's own bar under it: the team's a little slimmer, higher)
    const barH = dual ? 46 : BAR_H
    const mid = dual ? cy - 14 : cy
    const by = mid - barH / 2
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
    ctx.shadowBlur = 10
    ctx.shadowOffsetY = 3
    rounded(ctx, BAR_X, by, w, barH, [0, 10, 10, 0])
    ctx.fillStyle = row.base ? BAR_BASE : BAR
    ctx.fill()
    ctx.restore()
    // its name in the bar
    const nameW = ink(ctx, row.label, BAR_X + 18, mid + 9, {
      size: 26,
      weight: 700,
      color: BAR_TEXT,
      maxWidth: w - 36,
      minSize: 15,
    })
    if (row.unmet)
      ink(ctx, data.labels.unmet, BAR_X + 18 + nameW + 12, mid + 7, {
        size: 16,
        weight: 600,
        color: 'rgba(27, 25, 20, 0.6)',
      })
    ctx.restore()
    // its percentage, after the bar
    figure(
      `${Math.round((row.value / baseValue) * 100)}%`,
      BAR_X + w + 12,
      mid + 10,
      dual ? 26 : 30,
      row.unmet ? 'rgba(230, 213, 177, 0.6)' : FIGURE
    )
    // the member's own damage: a slim bar in its colour under the team's, its percentage after
    if (dual && row.personal !== undefined) {
      const ownW = Math.max(24, (row.personal / bestOwn) * barMax)
      const oy = cy + 16
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
      ctx.shadowBlur = 8
      ctx.shadowOffsetY = 2
      rounded(ctx, BAR_X, oy, ownW, 18, [0, 7, 7, 0])
      ctx.fillStyle = `rgba(${own}, ${row.base ? 1 : 0.82})`
      ctx.fill()
      ctx.restore()
      figure(
        `${Math.round((row.personal / baseOwn) * 100)}%`,
        BAR_X + ownW + 12,
        oy + 16,
        19,
        `rgb(${own})`
      )
    }
  })

  // ── the team, by face and constellation; the site
  const fmid = top + rows.length * rowH + 28 + FOOT_H / 2
  let fx = M
  const SMALL = 40
  ctx.font = `700 20px ${FONT}`
  const teamW = team.reduce(
    (sum, m) =>
      sum + SMALL + 10 + Math.min(ctx.measureText(m.label).width, 220) + 26,
    -26
  )
  if (team.length) settle(M - 12, fmid - 30, teamW + 24, 60, 18)
  ctx.font = `500 15px ${FONT}`
  const stampW = ctx.measureText(data.labels.siteName).width
  settle(W - M - stampW - 12, fmid - 18, stampW + 24, 34, 12)
  shaded(() => {
    team.forEach((m, k) => {
      face(ctx, teamFaces[k], fx, fmid - SMALL / 2, SMALL, m.elementColor)
      fx += SMALL + 10
      fx +=
        ink(ctx, m.label, fx, fmid + 7, {
          size: 20,
          weight: 700,
          color: TITLE,
          maxWidth: 220,
          minSize: 13,
        }) + 26
    })
    if (!team.length)
      ink(ctx, data.footer, M, fmid + 7, {
        size: 20,
        weight: 650,
        color: TITLE,
        maxWidth: W - 2 * M - 300,
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
