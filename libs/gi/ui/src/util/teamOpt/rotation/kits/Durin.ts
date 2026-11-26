import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import type { KitModel, SimContext, SimHit } from '../types'
import {
  flatEnergy,
  KQMSIM,
  type NormalHit,
  normalString,
  particleMarker,
  templateJump,
} from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/durin. */

/** Four normal attack steps (the 3rd has two instances: both on the sheet's node 2) */
const durinNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [2],
    toNormal: 19,
    toCharged: 21,
    toAbil: 11,
    frames: 29,
  },
  {
    hitmarks: [9],
    hitlag: [2],
    toNormal: 14,
    toCharged: 21,
    toAbil: 9,
    frames: 30,
  },
  {
    hitmarks: [14, 37],
    hitlag: [0, 2],
    toNormal: 48,
    toCharged: 43,
    toAbil: 37,
    frames: 55,
  },
  {
    hitmarks: [38],
    hitlag: [3],
    toNormal: 66,
    toCharged: 66,
    toAbil: 38,
    frames: 66,
  },
]

/** Dragon of White Flame: 20 ticks, 58.8 frames apart, the first at 155.2 (gcsim's float timing) */
const whiteTicks = Array.from({ length: 20 }, (_, i) =>
  Math.ceil(155.2 + 58.8 * i)
)
/** Dragon of Dark Decay: 16 ticks, 73.6 frames apart, the first at 175.4; its hits land 9 frames after a tick */
const darkTicks = Array.from({ length: 16 }, (_, i) =>
  Math.ceil(175.4 + 73.6 * i)
)
const DARK_TRAVEL = 9
const BURST_CD = 18 * 60
const WHITE_FORM_LENGTH = 1230
const DARK_FORM_LENGTH = 1260
const SKILL_ENERGY_ICD = 6 * 60
const SKILL_ENERGY = allStats.char.skillParam.Durin.skill[4]
const TIMED_BUFFS = [
  'burstForm',
  'a4Stack',
  'c1Stacks',
  'c2AfterBurst',
  'c2Hydro',
  'c2Cryo',
  'a1WhiteRes',
  'a1WhiteDendro',
  'a1WhiteElectro',
  'a1WhiteAnemo',
  'a1WhiteGeo',
  'c6LightBurstHit',
] as const

interface DurinState {
  window: boolean
  windowId: number
  blackUntil: number
  whiteStart: number
  whiteEnd: number
  darkStart: number
  darkEnd: number
  c2End: number
  energyIcdUntil: number
  burstId: number
  c1Stacks: Partial<Record<CharacterKey, number>>
  c1Credit: Partial<Record<CharacterKey, number>>
}

function skillEnergy(ctx: SimContext, s: DurinState, delay: number) {
  if (ctx.now < s.energyIcdUntil) return
  s.energyIcdUntil = ctx.now + SKILL_ENERGY_ICD
  const idx = ctx.calculate('Durin', ['total', 'skillIndex']) ?? 8
  const amount =
    SKILL_ENERGY[
      Math.min(SKILL_ENERGY.length - 1, Math.max(0, Math.round(idx)))
    ]!
  flatEnergy(ctx, delay, amount, 'Binary Form: Energy')
}

/** C2: the reactions (by anyone) that buff Pyro and the element involved, as the sheet's flags */
const C2_REACTIONS: Record<string, [string, string]> = {
  vaporize: ['c2Hydro', 'hydro'],
  melt: ['c2Cryo', 'cryo'],
  overloaded: ['a1WhiteElectro', 'electro'],
  pyroSwirl: ['a1WhiteAnemo', 'anemo'],
  burning: ['a1WhiteDendro', 'dendro'],
}
const C1_TAGS = ['normal', 'charged', 'plunge', 'skill', 'burst']

export const kit: KitModel = {
  characterKey: 'Durin',
  element: 'pyro',
  source: `${KQMSIM}/durin`,
  init: (): DurinState => ({
    window: false,
    windowId: 0,
    blackUntil: -1,
    burstId: 0,
    whiteStart: -1,
    whiteEnd: -1,
    darkStart: -1,
    darkEnd: -1,
    c2End: -1,
    energyIcdUntil: Number.NEGATIVE_INFINITY,
    c1Stacks: {},
    c1Credit: {},
  }),
  simOnlyBuffs: () => TIMED_BUFFS.map((name) => ['Durin', name]),
  onStart(ctx) {
    for (const name of TIMED_BUFFS) ctx.state('Durin', ['Durin', name], '')
  },
  onBeforeHit(ctx, s: DurinState, hit) {
    // C1: Cycle of Enlightenment. White: the active member's (not Durin's) Normal, Charged,
    // Plunging, Skill or Burst DMG spends 1 of their stacks for +60% of Durin's ATK. Dark: Durin's
    // Burst DMG spends 2 of his for +150% of his ATK. (The sheet's c1Stacks on that hit.)
    if (ctx.constellation('Durin') < 1) return
    if (hit.path[0].startsWith('_') || !C1_TAGS.includes(hit.tag)) return
    const white =
      hit.t >= s.whiteStart &&
      hit.t < s.whiteEnd &&
      hit.characterKey !== 'Durin' &&
      hit.characterKey === hit.onField
    const dark =
      hit.t >= s.darkStart &&
      hit.t < s.darkEnd &&
      hit.characterKey === 'Durin' &&
      hit.tag === 'burst'
    if (!white && !dark) return
    const left = s.c1Stacks[hit.characterKey] ?? 0
    if (left <= 0) return
    hit.states = [
      ...(hit.states ?? []),
      { owner: 'Durin', path: ['Durin', 'c1Stacks'], value: 'on' },
    ]
    spendC1(ctx, s, hit, dark ? 2 : 1)
  },
  onHit(ctx, s: DurinState, hit) {
    const inWhite = ctx.now >= s.whiteStart && ctx.now < s.whiteEnd
    const c2 = ctx.constellation('Durin') >= 2 && ctx.now < s.c2End
    if (!inWhite && !c2) return
    let flag: [string, string] | undefined
    if (hit.path[0] === '_reaction') {
      flag =
        hit.path[1] === 'crystallize' && hit.element === 'pyro'
          ? ['a1WhiteGeo', 'geo']
          : C2_REACTIONS[hit.path[1]]
    } else if (
      !hit.path[0].startsWith('_') &&
      ctx.isBurning &&
      ['pyro', 'dendro'].includes(hit.element)
    )
      flag = ['a1WhiteDendro', 'dendro']
    if (!flag) return
    const [cond, value] = flag
    const isA1 = cond.startsWith('a1')
    if (!isA1 && !c2) return
    if (inWhite && isA1) {
      ctx.buff('Durin', ['Durin', 'a1WhiteRes'], 'on', 0, 360, {
        hitlag: 'enemy',
      })
      ctx.buff('Durin', ['Durin', cond], value, 0, 360, { hitlag: 'enemy' })
    }
    if (c2) {
      ctx.buff('Durin', ['Durin', cond], value, 0, 360, { hitlag: 'recipient' })
      ctx.buff('Durin', ['Durin', 'c2AfterBurst'], 'on', 0, 360, {
        hitlag: 'recipient',
      })
    }
  },
  // In Essential Transmutation (the window after his E) his normal attack is Denial of Darkness
  // and his E is Confirmation of Purity, each with frames of its own (his Dark Q keeps the Q's)
  variant(_ctx, s: DurinState, action) {
    if (!s.window) return undefined
    const mode = 'Essential Transmutation'
    if (action.kind === 'normal')
      return {
        key: 'darkness',
        label: 'Transmutation: Denial of Darkness',
        mode,
      }
    if (action.kind === 'skill')
      return {
        key: 'purity',
        label: 'Transmutation: Confirmation of Purity',
        mode,
      }
    return undefined
  },
  act(ctx, s: DurinState, action, previous) {
    switch (action.kind) {
      case 'normal': {
        if (s.window) {
          s.window = false
          s.windowId++
          s.blackUntil = ctx.now + 30 * 60
          skillEnergy(ctx, s, 0)
          particleMarker(ctx, 32, 'Durin Skill particles')
          for (let i = 0; i < 3; i++)
            ctx.hit([32, 37, 42][i], {
              path: ['skill', `darkDmg${i + 1}`],
              tag: 'skill',
              element: 'pyro',
              applies: true,
              icd: 'DurinSkill',
              label: `Denial of Darkness ${i + 1}`,
            })
          return {
            frames: 67,
            framesInto: {
              normal: 64,
              skill: 48,
              burst: 45,
              dash: 42,
              jump: 41,
              swap: 43,
            },
          }
        }
        return normalString(
          durinNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      }
      case 'charged':
        ctx.hit(17, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack',
        })
        return {
          frames: 58,
          framesInto: {
            normal: 53,
            skill: 52,
            burst: 52,
            dash: 17,
            jump: 17,
            swap: 51,
          },
        }
      case 'skill': {
        if (s.window) {
          s.window = false
          s.windowId++
          s.blackUntil = -1
          skillEnergy(ctx, s, 0)
          particleMarker(ctx, 35, 'Durin Skill particles')
          ctx.hit(35, {
            path: ['skill', 'purityDmg'],
            tag: 'skill',
            element: 'pyro',
            applies: true,
            icd: 'skill',
            label: 'Confirmation of Purity',
          })
          return {
            frames: 83,
            framesInto: {
              normal: 62,
              skill: 53,
              burst: 50,
              dash: 46,
              jump: 47,
              swap: 48,
            },
          }
        }
        // Essential Transformation (tap, no damage): opens the 6 s recast window; 12 s cooldown
        s.window = true
        const id = ++s.windowId
        ctx.at(6 * 60, () => {
          if (s.windowId === id) s.window = false
        })
        return {
          cooldown: { key: 'skill', frames: 12 * 60 },
          frames: 49,
          framesInto: {
            normal: 16,
            skill: 15,
            burst: 4,
            dash: 14,
            jump: 14,
            swap: 13,
          },
        }
      }
      case 'burst': {
        const dark = ctx.now < s.blackUntil
        const id = ++s.burstId
        const c6 = ctx.constellation('Durin') >= 6
        const prevForm =
          ctx.now < s.darkEnd ? 'dark' : ctx.now < s.whiteEnd ? 'white' : ''
        const nextForm = dark ? 'dark' : 'white'
        s.c2End = ctx.now + 20 * 60
        for (const [i, t] of [97, 121, 154].entries())
          ctx.hit(t, {
            path: ['burst', `${dark ? 'dark' : 'purity'}Dmg${i + 1}`],
            tag: 'burst',
            element: 'pyro',
            applies: true,
            icd: 'DurinBurstTornado',
            label: dark ? 'As the Stars Smolder' : 'As the Light Shifts',
          })
        s.whiteStart = dark ? -1 : ctx.now + 97
        s.whiteEnd = dark ? -1 : ctx.now + 97 + WHITE_FORM_LENGTH
        s.darkStart = dark ? ctx.now + 97 : -1
        s.darkEnd = dark ? ctx.now + 97 + DARK_FORM_LENGTH : -1
        if (ctx.constellation('Durin') >= 1)
          s.c1Stacks = Object.fromEntries(
            ctx.members.map((m) => [m, (m === 'Durin') === dark ? 20 : 0])
          )
        if (prevForm && prevForm !== nextForm)
          ctx.state('Durin', ['Durin', 'burstForm'], '')
        ctx.at(97, (c) => {
          if (id !== s.burstId) return
          c.state('Durin', ['Durin', 'burstForm'], nextForm)
          c.at(dark ? DARK_FORM_LENGTH : WHITE_FORM_LENGTH, (end) => {
            if (id === s.burstId) end.state('Durin', ['Durin', 'burstForm'], '')
          })
        })
        if (dark) {
          for (const t of darkTicks)
            ctx.at(t, (c2) => {
              if (s.burstId !== id) return
              c2.hit(DARK_TRAVEL, {
                path: ['burst', 'decayDmg'],
                tag: 'burst',
                element: 'pyro',
                applies: true,
                icd: 'DurinBurstBlack',
                label: 'Dragon of Dark Decay',
              })
            })
        } else {
          for (const t of whiteTicks)
            ctx.at(t, (c2) => {
              if (s.burstId !== id) return
              c2.hit(0, {
                path: ['burst', 'whiteDmg'],
                tag: 'burst',
                element: 'pyro',
                applies: true,
                icd: 'DurinBurstWhite',
                label: 'Dragon of White Flame',
              })
              if (c6)
                c2.buff(
                  'Durin',
                  ['Durin', 'c6LightBurstHit'],
                  'on',
                  0,
                  6 * 60,
                  {
                    hitlag: 'enemy',
                  }
                )
            })
          if (c6)
            for (const d of [97, 121, 154])
              ctx.buff('Durin', ['Durin', 'c6LightBurstHit'], 'on', d, 6 * 60, {
                hitlag: 'enemy',
              })
        }
        // A4: the first 10 DoT ticks get the ATK-scaled bonus (a stack each)
        const a4Ticks = (dark ? darkTicks : whiteTicks).slice(0, 10)
        ctx.buff(
          'Durin',
          ['Durin', 'a4Stack'],
          'on',
          a4Ticks[0],
          a4Ticks[9] - a4Ticks[0] + 1 + (dark ? DARK_TRAVEL : 0)
        )
        return {
          cooldown: { key: 'burst', frames: BURST_CD },
          frames: 104,
          framesInto: {
            normal: 103,
            skill: 103,
            dash: 102,
            jump: 104,
            swap: 102,
          },
        }
      }
      case 'dash':
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // the jump is longer after a dash
        return templateJump('boy', 'sword', previous, ctx)
      default:
        // no plunge in gcsim's Durin
        return { frames: 30 }
    }
  },
  cooldownKey: (s: DurinState, action) =>
    action.kind === 'skill'
      ? s.window
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
}

function spendC1(ctx: SimContext, s: DurinState, hit: SimHit, count: number) {
  if (ctx.constellation('Durin') < 4) {
    s.c1Stacks[hit.characterKey] = (s.c1Stacks[hit.characterKey] ?? 0) - count
    return
  }
  const credit = (s.c1Credit[hit.characterKey] ?? 0) + 0.7
  if (credit < 1) {
    s.c1Credit[hit.characterKey] = credit
    return
  }
  s.c1Credit[hit.characterKey] = credit - 1
  s.c1Stacks[hit.characterKey] = (s.c1Stacks[hit.characterKey] ?? 0) - count
}
