import { hexRgb, loadImage, offscreen } from './renderBuildCard'

/*
 * The share pictures' look (the KQM sheet, the comparisons): a light page of white panels and
 * hairline rules, ink type in one sans family with a clear scale, members shown by their faces on
 * their element's tint
 */
export const PAGE = '#f3f5f9'
export const PANEL = '#ffffff'
export const WELL = '#eef1f6'
export const RULE = '#e1e5ed'
export const INK = '#1a2130'
export const SLATE = '#5b6577'
export const MIST = 'rgba(26, 33, 48, 0.4)'
/** The pictures' type: Inter (from a CDN, `loadShareFont`), else the system's */
export const FONT =
  '"Inter", "SF Pro Display", system-ui, -apple-system, "Segoe UI Variable", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'

// (the variable font, every weight in one file: Latin, then Latin Extended; other scripts fall
// back to the system's font glyph by glyph)
const FONT_FILES = [
  {
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@5/latin-wght-normal.woff2',
    unicodeRange:
      'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
  },
  {
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/inter:vf@5/latin-ext-wght-normal.woff2',
    unicodeRange:
      'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  },
]
let fontLoading: Promise<void> | undefined
/**
 * The pictures' font, loaded the first time a picture is drawn (not with the page). Slow or
 * offline (4 s at most): the system's font instead.
 */
export function loadShareFont(): Promise<void> {
  fontLoading ??= (async () => {
    if (typeof FontFace === 'undefined' || !globalThis.document?.fonts) return
    try {
      const faces = FONT_FILES.map(
        ({ url, unicodeRange }) =>
          new FontFace('Inter', `url(${url}) format('woff2')`, {
            weight: '100 900',
            unicodeRange,
          })
      )
      const loaded = Promise.all(faces.map((f) => f.load())).then(() => {
        for (const f of faces) document.fonts.add(f)
      })
      await Promise.race([
        loaded,
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ])
    } catch {
      // (the system's font)
    }
  })()
  return fontLoading
}

/** Text in the share pictures' font; returns its width */
export function ink(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  {
    size,
    weight = 400,
    color = INK,
    align = 'left',
    maxWidth,
    minSize = size,
    tracking = 0,
  }: {
    size: number
    weight?: number
    color?: string
    align?: CanvasTextAlign
    maxWidth?: number
    minSize?: number
    /** letter spacing, in px */
    tracking?: number
  }
) {
  const font = (px: number) => `${weight} ${px}px ${FONT}`
  ctx.font = font(size)
  ;(ctx as { letterSpacing?: string }).letterSpacing = `${tracking}px`
  if (maxWidth)
    for (
      let px = size - 1;
      px >= minSize && ctx.measureText(value).width > maxWidth;
      px--
    )
      ctx.font = font(px)
  let shown = value
  if (maxWidth && ctx.measureText(shown).width > maxWidth) {
    while (shown.length > 1 && ctx.measureText(`${shown}…`).width > maxWidth)
      shown = shown.slice(0, -1)
    shown = `${shown.trimEnd()}…`
  }
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(shown, x, y)
  const width = ctx.measureText(shown).width
  ;(ctx as { letterSpacing?: string }).letterSpacing = '0px'
  return width
}

export function rounded(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[]
) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/**
 * A member's face in a circle on its element's tint, a thin ring of its color (the face icon is
 * square and transparent: it fills the circle, its top a little cut)
 */
export function face(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  x: number,
  y: number,
  size: number,
  color: string
) {
  const rgb = hexRgb(color)
  const r = size / 2
  ctx.save()
  ctx.beginPath()
  ctx.arc(x + r, y + r, r, 0, Math.PI * 2)
  ctx.fillStyle = `rgba(${rgb}, 0.18)`
  ctx.fill()
  ctx.clip()
  if (img)
    ctx.drawImage(
      img,
      x - size * 0.06,
      y - size * 0.02,
      size * 1.12,
      size * 1.12
    )
  ctx.restore()
  ctx.beginPath()
  ctx.arc(x + r, y + r, r - 1, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(${rgb}, 0.55)`
  ctx.lineWidth = 2
  ctx.stroke()
}

/** An item's icon on a soft square of its rarity's (or a neutral) tint */
export function item(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | undefined,
  x: number,
  y: number,
  size: number,
  tint?: string
) {
  rounded(ctx, x, y, size, size, size * 0.24)
  ctx.fillStyle = tint ? `rgba(${hexRgb(tint)}, 0.16)` : WELL
  ctx.fill()
  if (img) ctx.drawImage(img, x + 2, y + 2, size - 4, size - 4)
}

/** A canvas at `scale` with the page's ground, its context scaled */
export function page(W: number, H: number, scale: number) {
  const canvas = offscreen(Math.round(W * scale), Math.round(H * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not supported')
  ctx.scale(scale, scale)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = PAGE
  ctx.fillRect(0, 0, W, H)
  return { canvas, ctx }
}

export { loadImage }

declare const __GO_BETA_KEYS__: string[]
declare const __GO_BETA_LABEL__: string
/** Unreleased content (characters, weapons, artifact sets, by key): none on the released site */
export const BETA_KEYS: ReadonlySet<string> = new Set(
  typeof __GO_BETA_KEYS__ !== 'undefined' ? __GO_BETA_KEYS__ : []
)
/** The beta's name ("7.3 beta v3", apps/frontend/beta-content.json), marked over pictures of it */
export const BETA_LABEL =
  typeof __GO_BETA_LABEL__ === 'string' && __GO_BETA_LABEL__
    ? __GO_BETA_LABEL__
    : 'Beta'

/**
 * A picture showing unreleased content: `word` (the beta's name) large and faint, in slanted rows over the
 * whole picture (over everything, light enough that all of it still reads), so that a crop of it
 * still says so
 */
export function betaMark(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  word: string
) {
  ctx.save()
  ctx.font = `700 30px ${FONT}`
  ;(ctx as { letterSpacing?: string }).letterSpacing = '1px'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // (a muted gold, the site's accent: it shows on every tint and still lets the text read)
  ctx.fillStyle = 'rgba(176, 132, 44, 0.12)'
  const stepX = ctx.measureText(word).width + 90
  const stepY = 92
  ctx.translate(W / 2, H / 2)
  ctx.rotate(-Math.PI / 9)
  const R = Math.hypot(W, H) / 2 + stepX
  for (let row = 0, y = -R; y <= R; row++, y += stepY)
    for (let x = -R + (row % 2) * (stepX / 2); x <= R; x += stepX)
      ctx.fillText(word, x, y)
  ctx.restore()
}
