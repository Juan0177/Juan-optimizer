import { kqmCardTones } from './renderKqmCard'
import {
  betaMark,
  FONT,
  ink,
  loadImage,
  loadShareFont,
  page,
  rounded,
} from './shareStyle'

/** A member of a team on the versions sheet */
export type VersionsCardMember = {
  name: string
  /** its constellation: a badge on its portrait, brighter the higher */
  constellation: number
  /** its weapon's refinement when that is its signature weapon: a badge under the constellation */
  signature?: number
  element: string
  elementColor: string
  face: string
  weapon: { name: string; refinement: number; icon?: string }
  sets: { name: string; icon?: string }[]
  /** its share of the team's damage ("39%") */
  share: string
  /** its time on the field per rotation ("12.3s"), when known */
  field?: string
  /** the Energy Recharge it needs ("125%"), when known */
  er?: string
}

/** A team on the versions sheet: the original or one of its versions */
export type VersionsCardTeam = {
  original: boolean
  members: VersionsCardMember[]
  /** team DPS (or damage per rotation), formatted */
  dps: string
  /** the rotation's length ("20.1 s") */
  seconds?: string
  /** the written rotation, its members' turns apart */
  rotation: string[]
}

export type VersionsCardData = {
  teams: VersionsCardTeam[]
  /** best first: each numbered by its place (absent: as arranged, unnumbered) */
  ranked?: boolean
  /** what they were all run under ("KQM Standards · Talents 10/10/10 · …") */
  notes: string
  /** it shows unreleased content: this name over the whole sheet */
  beta?: string
  labels: {
    dps: string
    rotation: string
    original: string
    /** the member's cells' labels: share of the damage, field time, Energy Recharge needed */
    share: string
    field: string
    er: string
    stamp: string
  }
}

const PAGE = '#e8ecf3'
const HEAD = '#d7deea'
const GRID = 'rgba(78, 96, 128, 0.55)'
const TEXT = '#1c2331'
const MUTED = 'rgba(28, 35, 49, 0.58)'
const PAPER = '#f8f9fc'
const M = 32
const GAP = 24
const NOTES = 56
/** a member's column, and the card of four */
const COL = 200
const CARD_W = 4 * COL
const STRIP = 66
const PORTRAIT = 118
const NAME_ROW = 40
const STAT_ROW = 50
const ITEM_ROW = 52
const ROT_ROW = 66
const CARD_H = STRIP + PORTRAIT + NAME_ROW + STAT_ROW + 2 * ITEM_ROW + ROT_ROW
const ROT_LABEL = 104
const ICON = 34

/** Cards across: two for up to four teams, then three */
const columnsFor = (n: number) => (n <= 1 ? 1 : n <= 4 ? 2 : 3)
/** The sheet's size for `n` teams (its placeholder before it is drawn) */
export const versionsCardWidth = (n: number) => {
  const cols = columnsFor(n)
  return 2 * M + cols * CARD_W + (cols - 1) * GAP
}
export const versionsCardHeight = (n: number) => {
  const rows = Math.ceil(Math.max(1, n) / columnsFor(n))
  return M + rows * CARD_H + (rows - 1) * GAP + NOTES + M
}

/**
 * A team and its versions as one sheet to share: a card each, best first, two or three across.
 * Each card: its rank and name, team DPS against the original's and its rotation's length; its
 * members' faces, damage, weapons and sets (those swapped in outlined); its rotation. What they
 * were all run under at the foot. The theorycrafting sheet's look (`renderKqmCard`).
 */
export async function renderVersionsCard(
  data: VersionsCardData,
  scale?: number
): Promise<HTMLCanvasElement> {
  const n = data.teams.length
  // Keep very large sheets fast to draw and PNG-encode while staying crisp to share
  const effectiveScale = scale ?? (n <= 9 ? 2 : n <= 18 ? 1.5 : 1.25)

  // Deduplicate and load every unique portrait, weapon, and artifact icon in one parallel wave
  const urls = new Set<string>()
  for (const team of data.teams) {
    for (const m of team.members) {
      if (m.face) urls.add(m.face)
      if (m.weapon.icon) urls.add(m.weapon.icon)
      for (const s of m.sets) if (s.icon) urls.add(s.icon)
    }
  }
  const [loadedEntries] = await Promise.all([
    Promise.all(
      [...urls].map(async (url) => [url, await loadImage(url)] as const)
    ),
    loadShareFont(),
  ])
  await document.fonts?.ready
  const imageByUrl = new Map(loadedEntries)
  const icons = data.teams.map((team) =>
    team.members.map((m) => ({
      face: m.face ? imageByUrl.get(m.face) : undefined,
      weapon: m.weapon.icon ? imageByUrl.get(m.weapon.icon) : undefined,
      sets: m.sets.map((s) => (s.icon ? imageByUrl.get(s.icon) : undefined)),
    }))
  )

  const cols = columnsFor(n)
  const W = versionsCardWidth(n)
  const H = versionsCardHeight(n)
  const { canvas, ctx } = page(W, H, effectiveScale)
  ctx.fillStyle = PAGE
  ctx.fillRect(0, 0, W, H)
  const fill = (x: number, y: number, w: number, h: number, color: string) => {
    ctx.fillStyle = color
    ctx.fillRect(x, y, w, h)
  }
  const frame = (
    x: number,
    y: number,
    w: number,
    h: number,
    color = GRID,
    width = 1.5
  ) => {
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.strokeRect(x, y, w, h)
  }
  const mid = (y: number, h: number, size: number) => y + h / 2 + size * 0.35
  const widthAt = (value: string, size: number, weight: number) => {
    ctx.font = `${weight} ${size}px ${FONT}`
    return ctx.measureText(value).width
  }
  /** Words in lines of at most `w`: as few lines as fit, as even as can be */
  const wrap = (value: string, w: number, size: number, weight: number) => {
    const words = value.split(' ')
    if (widthAt(value, size, weight) <= w) return [value]
    let best: string[] | undefined
    let widest = Number.POSITIVE_INFINITY
    for (let i = 1; i < words.length; i++) {
      const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')]
      const wide = Math.max(...pair.map((l) => widthAt(l, size, weight)))
      if (wide <= w && wide < widest) {
        widest = wide
        best = pair
      }
    }
    return best
  }
  /**
   * A weapon's or sets' name in its cell: one line (a little smaller if needed), else two even
   * lines; never cut short
   */
  const itemName = (value: string, x: number, y: number, w: number) => {
    for (let px = 16; px >= 14; px--)
      if (widthAt(value, px, 500) <= w) {
        ink(ctx, value, x + w / 2, mid(y, ITEM_ROW, px), {
          size: px,
          weight: 500,
          color: TEXT,
          align: 'center',
        })
        return
      }
    for (let px = 14; px >= 12; px--) {
      const lines = wrap(value, w, px, 500)
      if (!lines) continue
      const lh = px * 1.18
      lines.forEach((line, k) =>
        ink(
          ctx,
          line,
          x + w / 2,
          y + ITEM_ROW / 2 + px * 0.35 + (k - (lines.length - 1) / 2) * lh,
          { size: px, weight: 500, color: TEXT, align: 'center' }
        )
      )
      return
    }
    ink(ctx, value, x + w / 2, mid(y, ITEM_ROW, 12), {
      size: 12,
      weight: 500,
      color: TEXT,
      align: 'center',
      maxWidth: w,
      minSize: 10,
    })
  }
  /** A weapon's or sets' cell: icons at the left (two sets overlapping), the name in the rest */
  const itemCell = (
    value: string,
    images: (HTMLImageElement | undefined)[],
    x: number,
    y: number
  ) => {
    const shown = images.filter((img): img is HTMLImageElement => !!img)
    const two = shown.length > 1
    const size = two ? 30 : ICON
    shown.forEach((img, k) =>
      ctx.drawImage(
        img,
        x + 6 + k * 14,
        y + (ITEM_ROW - size) / 2 + (two ? (k ? 5 : -5) : 0),
        size,
        size
      )
    )
    const used = shown.length ? 6 + (two ? 14 + size : size) + 4 : 6
    itemName(value, x + used, y, COL - used - 6)
  }

  /**
   * A member's constellation on its portrait's right (`x` its right edge): a pill whose look rises
   * with it, so the higher ones are seen at once (C0 plain; C1–C2 blue; C3–C4 violet; C5 amber;
   * C6 gold)
   */
  const consBadge = (n: number, x: number, y: number) => {
    const tier =
      n >= 6
        ? { fill: ['#f6d77a', '#d79b2b'], text: '#3a2500', ring: '#b07a17' }
        : n === 5
          ? { fill: ['#ffe7bd', '#ffd28a'], text: '#7a4a00', ring: '#d9a24a' }
          : n >= 3
            ? { fill: ['#eadcff', '#d8c3ff'], text: '#5a32b8', ring: '#a98be6' }
            : n >= 1
              ? {
                  fill: ['#dce9ff', '#c7dbff'],
                  text: '#2b55c4',
                  ring: '#8fb0ec',
                }
              : {
                  fill: ['rgba(255,255,255,0.85)', 'rgba(255,255,255,0.85)'],
                  text: MUTED,
                  ring: 'rgba(78, 96, 128, 0.35)',
                }
    const w = 40
    const h = 26
    const bx = x - w
    const gradient = ctx.createLinearGradient(bx, y, bx, y + h)
    gradient.addColorStop(0, tier.fill[0])
    gradient.addColorStop(1, tier.fill[1])
    ctx.save()
    if (n >= 6) {
      ctx.shadowColor = 'rgba(215, 155, 43, 0.55)'
      ctx.shadowBlur = 10
    }
    rounded(ctx, bx, y, w, h, h / 2)
    ctx.fillStyle = gradient
    ctx.fill()
    ctx.restore()
    rounded(ctx, bx, y, w, h, h / 2)
    ctx.strokeStyle = tier.ring
    ctx.lineWidth = 1.3
    ctx.stroke()
    ink(ctx, `C${n}`, bx + w / 2, mid(y, h, 15), {
      size: 15,
      weight: 800,
      color: tier.text,
      align: 'center',
    })
  }

  /** Its signature weapon's refinement under the constellation (`x` its right edge) */
  const sigBadge = (r: number, x: number, y: number) => {
    const w = 40
    const h = 26
    const bx = x - w
    rounded(ctx, bx, y, w, h, h / 2)
    ctx.fillStyle = '#d8f1ec'
    ctx.fill()
    rounded(ctx, bx, y, w, h, h / 2)
    ctx.strokeStyle = '#7bc2b3'
    ctx.lineWidth = 1.3
    ctx.stroke()
    ink(ctx, `R${r}`, bx + w / 2, mid(y, h, 15), {
      size: 15,
      weight: 800,
      color: '#16695b',
      align: 'center',
    })
  }

  data.teams.forEach((team, t) => {
    const x0 = M + (t % cols) * (CARD_W + GAP)
    const y0 = M + Math.floor(t / cols) * (CARD_H + GAP)
    // ── the strip: its rank, its DPS (the figure), and against the original
    fill(x0, y0, CARD_W, STRIP, HEAD)
    frame(x0, y0, CARD_W, STRIP)
    const baseline = y0 + STRIP / 2 + 13
    if (data.ranked)
      ink(ctx, `#${t + 1}`, x0 + CARD_W - 16, baseline, {
        size: 18,
        weight: 700,
        color: MUTED,
        align: 'right',
      })
    const fx = x0 + 16
    const figW = ink(ctx, team.dps, fx, baseline, {
      size: 38,
      weight: 800,
      color: TEXT,
      tracking: -0.6,
    })
    const unitW = ink(ctx, data.labels.dps, fx + figW + 7, baseline, {
      size: 15,
      weight: 700,
      color: MUTED,
      tracking: 0.6,
    })
    // (the original's tag)
    if (team.original) {
      const px = fx + figW + 7 + unitW + 18
      const w = widthAt(data.labels.original, 16, 700) + 24
      const h = 30
      const py = y0 + (STRIP - h) / 2
      rounded(ctx, px, py, w, h, h / 2)
      ctx.strokeStyle = MUTED
      ctx.lineWidth = 1.3
      ctx.stroke()
      ink(ctx, data.labels.original, px + w / 2, mid(py, h, 16), {
        size: 16,
        weight: 700,
        color: MUTED,
        align: 'center',
      })
    }
    // ── its members: face, name and damage, weapon, sets
    const py = y0 + STRIP
    team.members.forEach((m, i) => {
      const x = x0 + i * COL
      const { portrait, row } = kqmCardTones(m)
      const img = icons[t][i]
      fill(x, py, COL, PORTRAIT, portrait)
      // (as tall as the cell, the cut top and foot on its borders; never cropped)
      if (img.face)
        ctx.drawImage(
          img.face,
          x + (COL - PORTRAIT) / 2,
          py,
          PORTRAIT,
          PORTRAIT
        )
      consBadge(m.constellation, x + COL - 10, py + 10)
      if (m.signature) sigBadge(m.signature, x + COL - 10, py + 42)
      const ny = py + PORTRAIT
      fill(x, ny, COL, NAME_ROW + STAT_ROW + 2 * ITEM_ROW, row)
      ink(ctx, m.name, x + COL / 2, mid(ny, NAME_ROW, 16), {
        size: 16,
        weight: 700,
        color: TEXT,
        align: 'center',
        maxWidth: COL - 16,
        minSize: 12,
      })
      // (its share, field time and Energy Recharge needed: a cell each, the label over the value)
      const sy = ny + NAME_ROW
      const cell = COL / 3
      ;[
        [data.labels.share, m.share],
        [data.labels.field, m.field ?? '–'],
        [data.labels.er, m.er ?? '–'],
      ].forEach(([label, value], k) => {
        const cx = x + k * cell + cell / 2
        ink(ctx, label, cx, sy + 18, {
          size: 11.5,
          weight: 600,
          color: MUTED,
          align: 'center',
          maxWidth: cell - 8,
          minSize: 9,
          tracking: 0.3,
        })
        ink(ctx, value, cx, sy + 39, {
          size: 15,
          weight: 700,
          color: TEXT,
          align: 'center',
          maxWidth: cell - 8,
          minSize: 11,
        })
        frame(x + k * cell, sy, cell, STAT_ROW)
      })
      const wy = sy + STAT_ROW
      itemCell(`${m.weapon.name} R${m.weapon.refinement}`, [img.weapon], x, wy)
      itemCell(
        m.sets.map((s) => s.name).join(' / '),
        img.sets,
        x,
        wy + ITEM_ROW
      )
      frame(x, py, COL, PORTRAIT)
      frame(x, ny, COL, NAME_ROW)
      frame(x, wy, COL, ITEM_ROW)
      frame(x, wy + ITEM_ROW, COL, ITEM_ROW)
    })
    // ── its rotation: one line, else two, broken between turns
    const ry = py + PORTRAIT + NAME_ROW + STAT_ROW + 2 * ITEM_ROW
    fill(x0, ry, ROT_LABEL, ROT_ROW, HEAD)
    ink(
      ctx,
      data.labels.rotation,
      x0 + ROT_LABEL / 2,
      team.seconds ? ry + 29 : mid(ry, ROT_ROW, 15),
      {
        size: 15,
        weight: 700,
        color: TEXT,
        align: 'center',
        maxWidth: ROT_LABEL - 12,
        minSize: 11,
      }
    )
    if (team.seconds)
      ink(ctx, team.seconds, x0 + ROT_LABEL / 2, ry + 49, {
        size: 14,
        weight: 600,
        color: MUTED,
        align: 'center',
      })
    fill(x0 + ROT_LABEL, ry, CARD_W - ROT_LABEL, ROT_ROW, PAPER)
    frame(x0, ry, ROT_LABEL, ROT_ROW)
    frame(x0 + ROT_LABEL, ry, CARD_W - ROT_LABEL, ROT_ROW)
    const avail = CARD_W - ROT_LABEL - 28
    const tx = x0 + ROT_LABEL + (CARD_W - ROT_LABEL) / 2
    const sep = '  >  '
    const one = team.rotation.join(sep)
    let size = 17
    while (size > 14 && widthAt(one, size, 700) > avail) size--
    if (widthAt(one, size, 700) <= avail)
      ink(ctx, one, tx, mid(ry, ROT_ROW, size), {
        size,
        weight: 700,
        color: TEXT,
        align: 'center',
      })
    else {
      for (size = 15; size >= 12; size--) {
        let split = team.rotation.length
        while (
          split > 1 &&
          widthAt(team.rotation.slice(0, split).join(sep), size, 700) > avail
        )
          split--
        const rest = team.rotation.slice(split).join(sep)
        if (widthAt(rest, size, 700) <= avail || size === 12) {
          const first = team.rotation.slice(0, split).join(sep)
          const lh = size * 1.3
          ;[first, rest].forEach((line, k) =>
            ink(
              ctx,
              line,
              tx,
              ry + ROT_ROW / 2 + size * 0.35 + (k - 0.5) * lh,
              {
                size,
                weight: 700,
                color: TEXT,
                align: 'center',
                maxWidth: avail,
                minSize: 10,
              }
            )
          )
          break
        }
      }
    }
  })
  // ── what they were all run under
  const footY = H - M - NOTES / 2 + 8
  const stampW = ink(ctx, data.labels.stamp, W - M, footY, {
    size: 15,
    color: 'rgba(28, 35, 49, 0.45)',
    align: 'right',
  })
  ink(ctx, data.notes, M, footY, {
    size: 18,
    weight: 500,
    color: MUTED,
    maxWidth: W - 2 * M - stampW - 40,
    minSize: 13,
  })
  if (data.beta) betaMark(ctx, W, H, data.beta)
  return canvas
}
