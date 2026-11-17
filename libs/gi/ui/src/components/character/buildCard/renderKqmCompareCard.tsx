import type { KqmCardData } from './renderKqmCard'
import {
  FONT,
  face,
  INK,
  ink,
  item,
  loadImage,
  loadShareFont,
  PANEL,
  page,
  RULE,
  rounded,
  SLATE,
  WELL,
} from './shareStyle'
import { wrapTurns } from './wrapTurns'

/**
 * One side of the comparison: the KQM sheet's data, each member with the ER its build reaches
 * (`er`) and the ER required (`erTarget`)
 */
export type KqmCompareCardSide = Omit<KqmCardData, 'members' | 'labels'> & {
  members: (KqmCardData['members'][number] & { erTarget: string })[]
  labels: KqmCardData['labels'] & { erTarget: string }
}

/** Everything the comparison card shows: team A and team B as the KQM sheet's data, and the change */
export type KqmCompareCardData = {
  name: string
  a: KqmCompareCardSide
  b: KqmCompareCardSide
  swap: { out: string; in: string }
  labels: KqmCompareCardSide['labels'] & { delta: string }
  /** B against A: "+9.6%" (damage per rotation, per second) */
  delta: { dpr: string; dps: string }
}

export const KQM_COMPARE_CARD_WIDTH = 1600
export const KQM_COMPARE_CARD_HEIGHT = 808

const M = 36
const GAP = 28
// (a member: its name, its weapon, its sets on a line of their own)
const ROW = 96
const FACE = 60
// (text on white: ink 16:1, slate 5.9:1; the change in a green and a red that read on white)
const UP = '#1b7a3a'
const DOWN = '#b3261e'

/**
 * Team A (KQM Theorycrafting's result) against team B (the same team with one member swapped): a
 * header with the swap and the change, then two panels with each member's damage, share and ER,
 * the damage per rotation and per second, and the rotation.
 */
export async function renderKqmCompareCard(
  data: KqmCompareCardData,
  scale = 2
): Promise<HTMLCanvasElement> {
  const sides = [data.a, data.b]
  const [faces, weapons] = await Promise.all([
    Promise.all(
      sides.map((s) => Promise.all(s.members.map((m) => loadImage(m.face))))
    ),
    Promise.all(
      sides.map((s) =>
        Promise.all(s.members.map((m) => loadImage(m.weapon.icon ?? '')))
      )
    ),
    loadShareFont(),
  ])
  await document.fonts?.ready

  const W = KQM_COMPARE_CARD_WIDTH
  const colW = (W - 2 * M - GAP) / 2
  const n = Math.max(data.a.members.length, data.b.members.length)
  const headH = 118
  const colHead = 44
  const totalsH = 2 * 52
  // (each rotation over as many lines as its turns need: the taller of the two sets the height)
  const ROT_SIZE = 18
  const ROT_LINE = 27
  const rotWidth = colW - 48
  const measureCtx = page(W, 10, 1).ctx
  measureCtx.font = `600 ${ROT_SIZE}px ${FONT}`
  const rotLines = sides.map((s) =>
    wrapTurns(
      s.rotation ?? [],
      (t) => measureCtx.measureText(t).width,
      rotWidth
    )
  )
  const rotH = 50 + Math.max(1, ...rotLines.map((l) => l.length)) * ROT_LINE
  const panelH = 20 + colHead + n * ROW + totalsH + rotH + 20
  const top = M + headH
  const H = top + panelH + M
  const { canvas, ctx } = page(W, H, scale)

  // ── header: team, swap, the change
  ink(ctx, data.name, M, M + 30, {
    size: 30,
    weight: 700,
    maxWidth: W - 2 * M - 360,
    minSize: 20,
  })
  ink(ctx, data.labels.siteName, W - M, M + 30, {
    size: 16,
    weight: 600,
    color: SLATE,
    align: 'right',
  })
  ink(ctx, `${data.swap.out}  →  ${data.swap.in}`, M, M + 66, {
    size: 22,
    weight: 600,
    color: SLATE,
    maxWidth: W - 2 * M - 700,
    minSize: 16,
  })
  const changeColor = (text: string) =>
    text.startsWith('+') ? UP : text.startsWith('−') ? DOWN : INK
  ink(ctx, data.labels.delta, W - M - 300, M + 66, {
    size: 15,
    weight: 600,
    color: SLATE,
    align: 'right',
  })
  ink(ctx, `${data.labels.dpr} ${data.delta.dpr}`, W - M - 150, M + 66, {
    size: 22,
    weight: 700,
    color: changeColor(data.delta.dpr),
    align: 'right',
  })
  ink(ctx, `${data.labels.dps} ${data.delta.dps}`, W - M, M + 66, {
    size: 22,
    weight: 700,
    color: changeColor(data.delta.dps),
    align: 'right',
  })

  sides.forEach((side, s) => {
    const x = M + s * (colW + GAP)
    rounded(ctx, x, top, colW, panelH, 18)
    ctx.fillStyle = PANEL
    ctx.fill()
    ctx.strokeStyle = RULE
    ctx.lineWidth = 1.5
    ctx.stroke()

    const px = x + 24
    const pw = colW - 48
    // columns: member | damage | share | ER build over ER required (right edges)
    const damageX = x + colW * 0.6
    const shareX = x + colW * 0.82
    const erX = x + colW - 24
    let y = top + 20
    ink(ctx, s === 0 ? 'A' : 'B', px, y + 30, {
      size: 24,
      weight: 800,
      color: s === 0 ? SLATE : INK,
    })
    ink(ctx, side.name, px + 32, y + 30, {
      size: 17,
      weight: 600,
      color: SLATE,
      maxWidth: damageX - px - 150,
      minSize: 13,
    })
    const head = (label: string, hx: number) =>
      ink(ctx, label, hx, y + 30, {
        size: 15,
        weight: 600,
        color: SLATE,
        align: 'right',
      })
    head(side.labels.damage, damageX)
    head(side.labels.dist, shareX)
    // (two labels, as the cells: what the build reaches, then what it must reach)
    ink(ctx, side.labels.er, erX, y + 22, {
      size: 15,
      weight: 600,
      color: SLATE,
      align: 'right',
    })
    ink(ctx, side.labels.erTarget, erX, y + 40, {
      size: 13,
      weight: 600,
      color: SLATE,
      align: 'right',
    })
    y += colHead

    side.members.forEach((m, i) => {
      const ry = y + i * ROW
      ctx.fillStyle = RULE
      ctx.fillRect(px, ry, pw, 1)
      face(ctx, faces[s][i], px, ry + (ROW - FACE) / 2, FACE, m.elementColor)
      const tx = px + FACE + 16
      // (the damage figure's room: about 90 px)
      const textW = damageX - tx - 90
      const hasGear = !!m.weapon.name
      ink(ctx, `C${m.constellation} ${m.name}`, tx, ry + (hasGear ? 30 : 56), {
        size: 21,
        weight: 700,
        maxWidth: textW,
        minSize: 14,
      })
      if (hasGear) {
        const icon = weapons[s][i]
        if (icon) item(ctx, icon, tx, ry + 38, 24)
        ink(
          ctx,
          `${m.weapon.name} R${m.weapon.refinement}`,
          tx + (icon ? 30 : 0),
          ry + 56,
          {
            size: 15,
            color: SLATE,
            maxWidth: textW - (icon ? 30 : 0),
            minSize: 12,
          }
        )
        // (the sets on their own line, the whole width: their names fit)
        const sets = m.sets.map((set) => set.name).join(' / ')
        if (sets)
          ink(ctx, sets, tx, ry + 80, {
            size: 15,
            color: SLATE,
            maxWidth: textW,
            minSize: 12,
          })
      }
      ink(ctx, m.damage, damageX, ry + 56, {
        size: 21,
        weight: 600,
        align: 'right',
      })
      // share: a thin bar under the figure
      ink(ctx, `${(m.share * 100).toFixed(1)}%`, shareX, ry + 56, {
        size: 21,
        weight: 600,
        align: 'right',
      })
      const barW = 90
      rounded(ctx, shareX - barW, ry + 68, barW, 6, 3)
      ctx.fillStyle = WELL
      ctx.fill()
      rounded(
        ctx,
        shareX - barW,
        ry + 68,
        Math.max(0, Math.min(1, m.share)) * barW,
        6,
        3
      )
      ctx.fillStyle = m.elementColor
      ctx.fill()
      ink(ctx, m.er, erX, ry + 50, { size: 21, weight: 600, align: 'right' })
      ink(ctx, m.erTarget, erX, ry + 74, {
        size: 15,
        weight: 600,
        color: SLATE,
        align: 'right',
      })
    })
    y += n * ROW

    // damage per rotation, per second
    ctx.fillStyle = RULE
    ctx.fillRect(px, y, pw, 1)
    const total = (ty: number, label: string, value: string, note?: string) => {
      ink(ctx, label, px, ty + 33, { size: 20, weight: 700 })
      if (note)
        ink(ctx, note, px + 70, ty + 33, {
          size: 16,
          color: SLATE,
          maxWidth: 300,
        })
      ink(ctx, value, damageX, ty + 33, {
        size: 24,
        weight: 700,
        align: 'right',
      })
    }
    total(y, side.labels.dpr, side.total)
    if (side.dps) total(y + 52, side.labels.dps, side.dps, side.seconds)
    y += totalsH

    // rotation
    ctx.fillStyle = RULE
    ctx.fillRect(px, y, pw, 1)
    ink(ctx, side.labels.rotation, px, y + 30, {
      size: 15,
      weight: 600,
      color: SLATE,
    })
    rotLines[s].forEach((line, k) =>
      ink(ctx, line, px, y + 62 + k * ROT_LINE, { size: ROT_SIZE, weight: 600 })
    )
  })
  return canvas
}
