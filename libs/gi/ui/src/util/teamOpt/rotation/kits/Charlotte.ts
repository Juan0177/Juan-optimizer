import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KitModel, SimContext } from '../types'
import {
  flatEnergy,
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/charlotte, main as of 2026-11-10. */

// Normal attack string (gcsim's InitNormalCancelSlice): the hitmark into charged, the animation
// into the next normal. The cancels into abilities differ per hit: see `abilCancel`.
const charlotteNormals: NormalHit[] = [
  { hitmarks: [13], toNormal: 23, toCharged: 25, toAbil: 5, frames: 32 },
  { hitmarks: [25], toNormal: 35, toCharged: 26, toAbil: 15, frames: 45 },
  { hitmarks: [31], toNormal: 74, toCharged: 66, toAbil: 14, frames: 74 },
]

/** Cancels into skill, burst, dash, jump and swap, per hit (gcsim's per-action overrides) */
const abilCancel = [
  { skill: 5, burst: 5, dash: 5, jump: 6, swap: 12 },
  { skill: 15, burst: 17, dash: 16, jump: 16, swap: 16 },
  { skill: 14, burst: 7, dash: 8, jump: 7, swap: 4 },
]

interface CharlotteState {
  /** Focused Impression (hold E's mark) is on the enemy until this frame (-1: none) */
  holdMarkEnd: number
  /** The mark whose tick chain runs: a new mark ends the old chain */
  markId: number
  /** C4: its Energy restores in the current 20 s window, and the window's end */
  c4Count: number
  c4WindowEnd: number
  /** The mark on the enemy (its id), until it expires; -1: none */
  markLive: number
  /** C6 Summation of Interest: its 6 s ICD */
  c6Icd: number
  /** Spiritbreath Thorn: its 6 s ICD */
  thornIcd: number
  /** C1 Verification: each member's status end, on its own clock */
  c1Until: Partial<Record<CharacterKey, number>>
}

/**
 * A heal by Charlotte. Her burst's and C6's heals start C1's Verification on each member they reach
 * (kqmsim charlotte/cons.go:41-56)
 */
function charlotteHeal(
  c: SimContext,
  s: CharlotteState,
  node: string[],
  healTargets: CharacterKey[],
  label: string
) {
  c.hit(0, {
    characterKey: 'Charlotte',
    path: ['_heal', ...node],
    tag: 'other',
    element: 'cryo',
    healTargets,
    label,
  })
  if (c.constellation('Charlotte') >= 1)
    for (const m of healTargets) verification(c, s, m)
}

/**
 * C1 Verification: unless it is already on that member, 6 s (its clock): a heal now and every 2 s
 * while it lasts (kqmsim cons.go:24-39; a status is active on its expiry frame)
 */
function verification(c: SimContext, s: CharlotteState, m: CharacterKey) {
  if (c.characterFrame(m) <= (s.c1Until[m] ?? -1)) return
  s.c1Until[m] = c.characterFrame(m) + 360
  const tick = (t: SimContext): void => {
    if (t.characterFrame(m) > (s.c1Until[m] ?? -1)) return
    t.hit(0, {
      characterKey: 'Charlotte',
      path: ['_heal', 'constellation1', 'heal'],
      tag: 'other',
      element: 'cryo',
      healTargets: [m],
      label: 'Verification (C1, Heal)',
    })
    t.atCharacter(m, 120, tick)
  }
  tick(c)
}

/**
 * A mark's damage: every 1.5 s while it lasts (the first tick 1.5 s after the mark). A new mark
 * ends the old chain. (gcsim: the first tick is an enemy task and the mark an enemy status, both
 * pushed back by enemy hitlag; later ticks run on the world clock.)
 */
function markTick(
  c: SimContext,
  s: CharlotteState,
  id: number,
  path: string[],
  label: string
) {
  if (id !== s.markId || s.markLive !== id) return
  c.hit(0, {
    path,
    tag: 'skill',
    element: 'cryo',
    applies: true,
    icd: 'CharlotteMark',
    label,
  })
  c.at(90, (c2) => markTick(c2, s, id, path, label))
}

/** Puts a mark on the enemy at the skill's hit: `lasts` frames; hold's mark replaces the press's */
function startMark(
  ctx: SimContext,
  s: CharlotteState,
  hitAt: number,
  lasts: number,
  path: string[],
  label: string,
  hold: boolean
) {
  const id = ++s.markId
  ctx.at(hitAt, (c2) => {
    s.markLive = id
    // (open-ended while it lasts: its enemy-time expiry sets the end)
    s.holdMarkEnd = hold ? Number.MAX_SAFE_INTEGER : -1
    // the mark lasts `lasts` frames of enemy time
    c2.atEnemy(lasts, (c3) => {
      if (s.markLive !== id) return
      s.markLive = -1
      if (hold) s.holdMarkEnd = c3.now
    })
    c2.atEnemy(90, (c3) => markTick(c3, s, id, path, label))
  })
  // C4: the enemy is marked (burst DMG +)
  if (ctx.constellation('Charlotte') >= 4)
    ctx.buff('Charlotte', ['Charlotte', 'c4Marked'], 'on', hitAt, lasts, {
      hitlag: 'enemy',
    })
}

/** Spiritbreath Thorn: 30 frames after a charged attack, every 6 s (no Durability: no element) */
function thorn(c: SimContext, s: CharlotteState) {
  if (c.now < s.thornIcd) return
  s.thornIcd = c.now + 360
  c.hit(0, {
    path: ['charged', 'thornDmg'],
    tag: 'charged',
    element: 'cryo',
    applies: false,
    icd: 'none',
    label: 'Spiritbreath Thorn',
  })
}

export const kit: KitModel = {
  characterKey: 'Charlotte',
  element: 'cryo',
  source: `${GCSIM}/charlotte`,
  init: (): CharlotteState => ({
    holdMarkEnd: -1,
    markId: 0,
    c4Count: 0,
    c4WindowEnd: -1,
    markLive: -1,
    c6Icd: -1e9,
    thornIcd: -1e9,
    c1Until: {},
  }),
  act(ctx, s: CharlotteState, action, previous) {
    const c = ctx.constellation('Charlotte')
    switch (action.kind) {
      case 'normal': {
        const count = action.count ?? 1
        const result = normalString(
          charlotteNormals,
          count,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'cryo',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
        // the string's cancels into abilities (its last step's, which need not be N{count}: the
        // combo continues), from that step's start; a written wait starts at its earliest cancel
        const last = result.normalStarts![result.normalStarts!.length - 1]
        const start = last.offset
        const cancel = abilCancel[last.index]
        result.framesInto = {
          ...result.framesInto,
          skill: start + cancel.skill,
          burst: start + cancel.burst,
          dash: start + cancel.dash,
          jump: start + cancel.jump,
          swap: start + cancel.swap,
          wait: start + Math.min(...Object.values(cancel)),
        }
        return result
      }
      case 'charged': {
        // gcsim starts the charge earlier after a normal (14), a tap skill (8) or a burst (3)
        const windup =
          previous?.kind === 'normal'
            ? 14
            : previous?.kind === 'skill' && !previous.hold
              ? 8
              : previous?.kind === 'burst'
                ? 3
                : 0
        ctx.hit(67 - windup, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Charged Attack',
        })
        // Spiritbreath Thorn: 30 frames after the charged attack's hit
        ctx.at(67 - windup + 30, (c2) => thorn(c2, s))
        return {
          frames: 84 - windup,
          framesInto: {
            normal: 79 - windup,
            skill: 71 - windup,
            burst: 71 - windup,
            dash: 21 - windup,
            jump: 21 - windup,
            swap: 60 - windup,
          },
        }
      }
      case 'skill': {
        if (action.hold) {
          // hE: the shortest hold (the rotation text has no duration); the hit at hold + 111
          const hold = 1
          const hitAt = hold + 111
          ctx.hit(hitAt, {
            path: ['skill', 'photoHoldDmg'],
            tag: 'skill',
            element: 'cryo',
            applies: true,
            icd: 'skill',
            // (gcsim: stats at the cast)
            snapshotDelay: 0,
            label: 'Framing: Freezing Point Composition (Hold)',
          })
          // Focused Impression: 774 frames (ticks every 1.5 s)
          startMark(
            ctx,
            s,
            hitAt,
            774,
            ['skill', 'focusMarkDmg'],
            'Focused Impression Mark',
            true
          )
          if (c >= 2)
            ctx.buff('Charlotte', ['Charlotte', 'c2Hit'], '1', hitAt, 720)
          return {
            cooldown: { key: 'skill', frames: 1080, delay: hitAt - 2 },
            frames: hold + 137,
            framesInto: {
              normal: hold + 132,
              charged: hold + 132,
              skill: hold + 130,
              burst: hold + 130,
              swap: hold + 134,
            },
          }
        }
        // tap: Snappy Silhouette, a 408-frame mark
        const hitAt = 31
        ctx.hit(hitAt, {
          path: ['skill', 'photoPressDmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'skill',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Framing: Freezing Point Composition',
        })
        startMark(
          ctx,
          s,
          hitAt,
          408,
          ['skill', 'snapMarkDmg'],
          'Snappy Silhouette Mark',
          false
        )
        // C2: the opponents hit by the skill (1: a single target assumed) give ATK for 12 s
        if (c >= 2)
          ctx.buff('Charlotte', ['Charlotte', 'c2Hit'], '1', hitAt, 720)
        return {
          cooldown: { key: 'skill', frames: 720, delay: 29 },
          frames: 49,
          framesInto: {
            normal: 42,
            skill: 48,
            burst: 42,
            dash: 42,
            jump: 42,
            swap: 41,
          },
        }
      }
      case 'burst': {
        // Still Photo: the cast hit at 53 frames, then 8 Kamera ticks from 95 to 249 frames
        ctx.hit(53, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Still Photo: Comprehensive Confirmation',
        })
        // C4: a hit on the marked enemy restores 2 Energy, 5 times per 20 s
        for (const t of [53, 95, 119, 143, 166, 179, 203, 226, 249])
          ctx.at(t, (c2) => {
            if (c2.constellation('Charlotte') < 4 || s.markLive < 0) return
            if (c2.now >= s.c4WindowEnd) {
              s.c4Count = 0
              s.c4WindowEnd = c2.now + 1200
            }
            if (s.c4Count >= 5) return
            s.c4Count++
            flatEnergy(c2, 0, 2, 'Charlotte C4', { owner: 'Charlotte' })
          })
        // the cast heals the party at 53 frames (kqmsim charlotte/burst.go:73)
        ctx.at(53, (c2) =>
          charlotteHeal(
            c2,
            s,
            ['burst', 'castHeal'],
            [...c2.members],
            'Still Photo: Comprehensive Confirmation (Heal)'
          )
        )
        for (const t of [95, 119, 143, 166, 179, 203, 226, 249]) {
          ctx.hit(t, {
            path: ['burst', 'kameraDmg'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            icd: 'CharlotteKamera',
            label: 'Still Photo: Kamera',
          })
          // each Kamera tick heals the active member (its 7 m area, 4.5 m ahead, always covers the
          // player: kqmsim burst.go:87)
          ctx.at(t, (c2) =>
            charlotteHeal(
              c2,
              s,
              ['burst', 'kameraHeal'],
              [c2.onField],
              'Still Photo: Kamera (Heal)'
            )
          )
        }
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 70,
          framesInto: {
            normal: 68,
            charged: 68,
            skill: 69,
            dash: 57,
            jump: 58,
            swap: 68,
          },
        }
      }
      case 'plunge':
        // gcsim's Low Plunge (the rotation's plunge has no high/low choice; collision not used)
        ctx.hit(44, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 65,
          framesInto: {
            normal: 57,
            charged: 47,
            skill: 57,
            burst: 56,
            dash: 44,
            swap: 48,
          },
        }
      case 'dash':
        // Girl body: 20 frames, jump after 4
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // Girl body: 31 frames (34 after a dash)
        return templateJump('girl', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: CharlotteState, hit) {
    // C6 A Summation of Interest: a team member's normal or charged hit on the Focused
    // Impression enemy (the active member's, 6 s ICD), 14 frames later
    if (ctx.constellation('Charlotte') < 6) return
    if (s.holdMarkEnd < 0 || hit.t >= s.holdMarkEnd) return
    if (hit.onField !== hit.characterKey) return
    if (hit.tag !== 'normal' && hit.tag !== 'charged') return
    if (hit.t < s.c6Icd) return
    s.c6Icd = hit.t + 360
    ctx.hit(14, {
      characterKey: 'Charlotte',
      path: ['constellation6', 'dmg'],
      tag: 'burst',
      element: 'cryo',
      applies: true,
      icd: 'none',
      label: 'A Summation of Interest (C6)',
    })
    // it heals the active member when the player is within 5 m of the enemy (kqmsim cons.go:150)
    if (ctx.target.distance <= 5)
      ctx.at(14, (c2) =>
        charlotteHeal(
          c2,
          s,
          ['constellation6', 'heal'],
          [c2.onField],
          'A Summation of Interest (C6, Heal)'
        )
      )
  },
}
