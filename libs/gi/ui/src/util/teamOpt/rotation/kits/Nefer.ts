import type { KitModel, SimContext } from '../types'
import { type NormalHit, normalString, templateJump } from './common'

/*
 * Nefer. Neither gcsim nor the pinned kqmsim has her, so this kit follows the in-game text and the
 * talent numbers (Shadow Dance 9 s and 3 Phantasm Performances; two skill charges, 9 s each; Veil
 * of Falsehood: 9 s per stack, max 3, C2 5 and +5 s; the burst consumes every Veil). Phantasm
 * Performance spends 1 Verdant Dew (the game's ability config: once per performance).
 * Action frames are ESTIMATES (no published frame data): a Lady catalyst body (normals in the range
 * of gcsim's Lisa / Nicole), the performance's two own hits and three shade hits spaced over
 * ~1.6 s, the burst's two hits at 70 and 100 frames.
 * Not modelled: A4 (extra Verdant Dew from Slither, its base amount is not given in-game).
 */

const neferNormals: NormalHit[] = [
  { hitmarks: [18], toNormal: 26, toCharged: 30, toAbil: 18, frames: 32 },
  { hitmarks: [16], toNormal: 27, toCharged: 30, toAbil: 16, frames: 34 },
  // N3: two hits (both on the sheet's node 2)
  {
    hitmarks: [14, 26],
    toNormal: 40,
    toCharged: 42,
    toAbil: 26,
    frames: 48,
  },
  { hitmarks: [24], toNormal: 62, toCharged: 62, toAbil: 24, frames: 62 },
]
// (N3's two hits share the sheet's node 2: the game lists it as one ×2 multiplier)
const normalNode = (i: number, _j: number) => (i < 3 ? i : 3)

const SHADOW = 540
const PERFORMANCES = 3
const SEED_WINDOW = 900
const SEED_LIFE = 360
const SEED_CAP = 5

interface NeferState {
  inShadow: boolean
  shadowEnd: number
  shadowToken: number
  c4ResToken: number
  performances: number
  seedEnd: number
  seeds: number[]
  veils: number[]
}

const activeSeeds = (s: NeferState, now: number) =>
  s.seeds.filter((end) => end > now)

function addSeeds(s: NeferState, now: number, n: number) {
  if (n <= 0) return
  const seeds = activeSeeds(s, now)
  for (let i = 0; i < n; i++) seeds.push(now + SEED_LIFE)
  s.seeds = seeds.slice(-SEED_CAP)
}

const activeVeils = (s: NeferState, now: number) =>
  s.veils.filter((end) => end > now)

function addVeils(c: SimContext, s: NeferState, n: number) {
  if (n <= 0) return
  const c2 = c.constellation('Nefer') >= 2
  const cap = c2 ? 5 : 3
  const life = c2 ? 840 : 540
  const veils = activeVeils(s, c.now)
  for (let i = 0; i < n; i++) veils.push(c.now + life)
  const reachedCap = veils.length >= cap
  s.veils = veils.slice(-cap)
  if (reachedCap && c.moonsign >= 2)
    c.buff('Nefer', ['Nefer', 'a1MaxVeilEm'], 'on', 0, 480)
  syncVeils(c, s)
}

function endShadow(ctx: SimContext, s: NeferState) {
  if (!s.inShadow) return
  s.inShadow = false
  s.shadowEnd = -1
  ++s.shadowToken
  if (ctx.constellation('Nefer') >= 4) {
    ctx.endDewBoost()
    const resToken = ++s.c4ResToken
    ctx.at(270, (c) => {
      if (s.c4ResToken === resToken)
        c.state('Nefer', ['Nefer', 'c4ShadowDance'], '')
    })
  }
}

/** The Veil count as the sheet's condition, until the next stack expires */
function syncVeils(c: SimContext, s: NeferState) {
  const veils = activeVeils(s, c.now)
  s.veils = veils
  c.state(
    'Nefer',
    ['Nefer', 'a1VeilStacks'],
    veils.length ? `${veils.length}` : ''
  )
  const next = Math.min(...veils)
  if (Number.isFinite(next)) c.at(next - c.now, (c2) => syncVeils(c2, s))
}

/** A direct Lunar-Bloom hit of Phantasm Performance (no element application) */
function lunar(c: SimContext, delay: number, path: string[], label: string) {
  c.hit(delay, {
    path,
    tag: 'other',
    element: 'dendro',
    applies: false,
    icd: 'none',
    label: `${label} (Lunar-Bloom)`,
  })
}

export const kit: KitModel = {
  characterKey: 'Nefer',
  element: 'dendro',
  source: 'in-game text and talent data (no gcsim kit); frames estimated',
  // Moonsign Benediction: +1 to the party's Moonsign
  moonsign: 1,
  simOnlyBuffs: () => [
    ['Nefer', 'a1VeilStacks'],
    ['Nefer', 'a1MaxVeilEm'],
    ['Nefer', 'burstVeilsAbsorbed'],
    ['Nefer', 'c4ShadowDance'],
  ],
  charges: () => ({ skill: 2 }),
  init: (): NeferState => ({
    inShadow: false,
    shadowEnd: -1,
    shadowToken: 0,
    c4ResToken: 0,
    performances: 0,
    seedEnd: -1,
    seeds: [],
    veils: [],
  }),
  onStart(c) {
    c.note(
      'Nefer: action frames are estimates (no published frame data). Seeds of Deceit are one per Lunar-Bloom in the 15 s after her skill; A4 (Slither Dew) is not modelled.'
    )
  },
  onSwapOut(ctx, s: NeferState) {
    endShadow(ctx, s)
  },
  onHit(c, s: NeferState, hit) {
    if (
      hit.path[0] === '_reaction' &&
      hit.path[1] === 'lunarBloom' &&
      c.now < s.seedEnd &&
      c.moonsign >= 2
    )
      addSeeds(s, c.now, 1)
  },
  variant(ctx, s: NeferState, action) {
    return action.kind === 'charged' &&
      s.inShadow &&
      ctx.now < s.shadowEnd &&
      s.performances < PERFORMANCES &&
      ctx.dew >= 1
      ? {
          key: 'phantasm',
          label: 'Phantasm Performance',
          mode: 'Shadow Dance',
        }
      : undefined
  },
  act(ctx, s: NeferState, action, previous) {
    const c = ctx.constellation('Nefer')
    const shadow =
      s.inShadow && ctx.now < s.shadowEnd && s.performances < PERFORMANCES
    switch (action.kind) {
      case 'normal':
        return normalString(
          neferNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${normalNode(i, j)}`],
              tag: 'normal',
              element: 'dendro',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}${i === 2 ? ` (${j + 1})` : ''}`,
            }),
          ctx
        )
      case 'skill': {
        ctx.hit(18, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'skill',
          label: 'Senet Strategy',
        })
        s.inShadow = true
        s.shadowEnd = ctx.now + SHADOW
        const shadowToken = ++s.shadowToken
        s.performances = 0
        s.seedEnd = ctx.now + SEED_WINDOW
        if (ctx.moonsign >= 2)
          addSeeds(s, ctx.now, ctx.suppressCores(SEED_WINDOW))
        if (c >= 2) addVeils(ctx, s, 2)
        if (c >= 4) {
          ++s.c4ResToken
          ctx.state('Nefer', ['Nefer', 'c4ShadowDance'], 'on')
          ctx.endDewBoost()
          ctx.boostDew(SHADOW, 1.25)
        }
        ctx.at(SHADOW, (c2) => {
          if (s.shadowToken === shadowToken) endShadow(c2, s)
        })
        return {
          frames: 40,
          framesInto: { charged: 30, normal: 34, burst: 34, swap: 36 },
          cooldown: { key: 'skill', frames: 540 },
        }
      }
      case 'charged': {
        const seeds = activeSeeds(s, ctx.now).length
        if (seeds) {
          addVeils(ctx, s, seeds)
          s.seeds = []
        }
        if (shadow && ctx.dew >= 1) {
          // Phantasm Performance: 1 Dew; Nefer's two hits, then the shades' three Lunar-Bloom hits
          ctx.consumeDew(1)
          s.performances++
          syncVeils(ctx, s)
          ctx.hit(22, {
            path: ['skill', 'nefer1Dmg'],
            tag: 'charged',
            element: 'dendro',
            applies: true,
            icd: 'charged',
            label: 'Phantasm Performance (Nefer 1)',
          })
          if (c >= 6)
            lunar(
              ctx,
              40,
              ['skill', 'nefer2Dmg'],
              'Phantasm Performance (Nefer 2)'
            )
          else
            ctx.hit(40, {
              path: ['skill', 'nefer2Dmg'],
              tag: 'charged',
              element: 'dendro',
              applies: true,
              icd: 'charged',
              label: 'Phantasm Performance (Nefer 2)',
            })
          lunar(
            ctx,
            58,
            ['skill', 'shade1Dmg'],
            'Phantasm Performance (Shade 1)'
          )
          lunar(
            ctx,
            74,
            ['skill', 'shade2Dmg'],
            'Phantasm Performance (Shade 2)'
          )
          lunar(
            ctx,
            96,
            ['skill', 'shade3Dmg'],
            'Phantasm Performance (Shade 3)'
          )
          // C6: one more Lunar-Bloom hit as the performance ends
          if (c >= 6)
            lunar(
              ctx,
              104,
              ['constellation6', 'dmg'],
              'Phantasm Performance end (C6)'
            )
          if (s.performances >= PERFORMANCES) {
            const token = s.shadowToken
            ctx.at(100, (c2) => {
              if (s.shadowToken === token) endShadow(c2, s)
            })
          }
          return {
            frames: 100,
            framesInto: {
              normal: 96,
              skill: 96,
              burst: 96,
              dash: 60,
              swap: 96,
            },
          }
        }
        ctx.hit(52, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'dendro',
          applies: true,
          icd: 'charged',
          label: 'Charged Attack',
        })
        return {
          frames: 66,
          framesInto: { normal: 62, skill: 62, burst: 62, dash: 52, swap: 62 },
        }
      }
      case 'burst': {
        // Consumes every Veil for its DMG bonus
        const veils = activeVeils(s, ctx.now).length
        s.veils = []
        syncVeils(ctx, s)
        const states = veils
          ? [
              {
                owner: 'Nefer' as const,
                path: ['Nefer', 'burstVeilsAbsorbed'],
                value: `${veils}`,
              },
            ]
          : undefined
        for (const [d, node, label] of [
          [70, 'hit1', 'Sacred Vow (1)'],
          [100, 'hit2', 'Sacred Vow (2)'],
        ] as const)
          ctx.hit(d, {
            path: ['burst', node],
            tag: 'burst',
            element: 'dendro',
            applies: true,
            durability: 25,
            icd: 'burst',
            label,
            states,
          })
        return {
          frames: 115,
          framesInto: { normal: 112, skill: 112, swap: 110 },
          cooldown: { key: 'burst', frames: 900 },
        }
      }
      case 'dash':
        return { frames: 20, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('lady', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
