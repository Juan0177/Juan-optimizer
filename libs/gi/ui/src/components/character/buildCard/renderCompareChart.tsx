import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { charIllustration, charSplash } from '@genshin-optimizer/gi/char-cards'
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
  labels: { unmet: string; siteName: string }
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

// the charts' palette, the site's own (graphite, parchment, one gold), the same for every
// character: a graphite-night ground with the member's element glowing where its art stands,
// parchment bars (the 100%'s gold), gold figures, parchment type
const GROUND_TOP = '#15161d'
const GROUND_BOTTOM = '#1f2029'
const BAR = '#ece5d8'
const BAR_BASE = '#d3bc8e'
const BAR_TEXT = '#1b1914'
const FIGURE = '#e6d5b1'
const TITLE = '#f5f0e6'
const SUBTITLE = '#d3bc8e'
const SHADOW = 'rgba(6, 6, 10, 0.7)'

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
  const top = 196
  const FOOT_H = 64
  // (as tall as its rows need)
  const H = top + rows.length * ROW_H + 28 + FOOT_H + 24
  const { canvas, ctx } = page(W, H, scale)

  // ── the ground, drawn (sharp at any size): graphite night, a glow of the member's element where
  // the character stands, a cooler one at the top left, a few faint stars
  const ground = ctx.createLinearGradient(0, 0, W * 0.4, H)
  ground.addColorStop(0, GROUND_TOP)
  ground.addColorStop(1, GROUND_BOTTOM)
  ctx.fillStyle = ground
  ctx.fillRect(0, 0, W, H)
  const rgb = hexRgb(data.member.elementColor)
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
  glowAt(W * 0.74, H * 0.45, Math.max(H, W) * 0.62, rgb, 0.3)
  glowAt(W * 0.06, 0, W * 0.55, '211, 188, 142', 0.1)
  // (the stars: the same for the same title, denser toward the art)
  let seed = [...data.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)
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
  // (a vignette: the corners deeper)
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

  // ── the splash art, full strength, on the right (fading in from the middle: the icons and the
  // bars' starts on the plain ground)
  if (splash) {
    const art = offscreen(Math.round(W * scale), Math.round(H * scale))
    const a = art.getContext('2d')
    if (a) {
      a.scale(scale, scale)
      a.imageSmoothingQuality = 'high'
      const ratio = splash.naturalWidth / splash.naturalHeight
      if (ratio > 1.4) {
        // a splash art (2:1, the character in its middle): a little taller than the picture (the
        // character from top to foot; it is softened anyway, so enlarging shows little), at most
        // 2.2 times its own size; its middle at 76% across, its foot at the picture's
        const dh = Math.min(
          Math.max(H * 1.04, 900),
          (splash.naturalHeight * 2.2) / scale
        )
        const dw = dh * ratio
        a.drawImage(splash, W * 0.76 - dw / 2, H - dh, dw, dh)
      } else {
        // official art (opaque, cropped to the character): the right part, from the top
        const dw = H * ratio
        a.drawImage(splash, W - dw, 0, dw, H)
      }
      a.globalCompositeOperation = 'destination-in'
      const fade = a.createLinearGradient(W * 0.3, 0, W * 0.52, 0)
      fade.addColorStop(0, 'rgba(0, 0, 0, 0)')
      fade.addColorStop(1, 'rgba(0, 0, 0, 1)')
      a.fillStyle = fade
      a.fillRect(0, 0, W, H)
      // (a little dimmed, the art only: the bars and figures read on it)
      a.globalCompositeOperation = 'source-atop'
      a.fillStyle = 'rgba(12, 12, 18, 0.24)'
      a.fillRect(0, 0, W, H)
      // (and a little softened: a light blur, else drawn at a smaller size and stretched back)
      ctx.save()
      if (typeof (ctx as { filter?: unknown }).filter === 'string') {
        ctx.filter = `blur(${1.6 * scale}px)`
        ctx.drawImage(art, 0, 0, W, H)
      } else {
        const soft = offscreen(Math.round(W * 0.6), Math.round(H * 0.6))
        soft.getContext('2d')?.drawImage(art, 0, 0, soft.width, soft.height)
        ctx.drawImage(soft, 0, 0, W, H)
      }
      ctx.restore()
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
  ctx.fillRect(BAR_X - 2, top - 8, 2, rows.length * ROW_H + 16)
  const best = Math.max(...rows.map((r) => r.value), 1)
  const baseValue = base?.value || best
  let iconIndex = 0
  rows.forEach((row, i) => {
    const cy = top + i * ROW_H + ROW_H / 2
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
    const w = Math.max(BAR_H * 2, (row.value / best) * BAR_MAX)
    const by = cy - BAR_H / 2
    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)'
    ctx.shadowBlur = 10
    ctx.shadowOffsetY = 3
    rounded(ctx, BAR_X, by, w, BAR_H, [0, 10, 10, 0])
    ctx.fillStyle = row.base ? BAR_BASE : BAR
    ctx.fill()
    ctx.restore()
    // its name in the bar
    const nameW = ink(ctx, row.label, BAR_X + 18, cy + 9, {
      size: 26,
      weight: 700,
      color: BAR_TEXT,
      maxWidth: w - 36,
      minSize: 15,
    })
    if (row.unmet)
      ink(ctx, data.labels.unmet, BAR_X + 18 + nameW + 12, cy + 7, {
        size: 16,
        weight: 600,
        color: 'rgba(27, 25, 20, 0.6)',
      })
    ctx.restore()
    // its percentage, after the bar (outlined: clear on any part of the art)
    const pct = `${Math.round((row.value / baseValue) * 100)}%`
    const px = BAR_X + w + 12
    ctx.font = `750 30px ${FONT}`
    settle(px - 8, cy - 24, ctx.measureText(pct).width + 18, 46, 14)
    ctx.save()
    ctx.font = `750 30px ${FONT}`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 6
    ctx.strokeStyle = 'rgba(12, 12, 16, 0.8)'
    ctx.shadowColor = SHADOW
    ctx.shadowBlur = 10
    ctx.strokeText(pct, px, cy + 10)
    ctx.restore()
    ink(ctx, pct, px, cy + 10, {
      size: 30,
      weight: 750,
      color: row.unmet ? 'rgba(230, 213, 177, 0.6)' : FIGURE,
    })
  })

  // ── the team, by face and constellation; the site
  const fmid = top + rows.length * ROW_H + 28 + FOOT_H / 2
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
