import type { ActionResult, KitModel, SimContext } from '../types'
import { KQMSIM, type NormalHit, normalString, withHitlag } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), pinned by KQMSIM, internal/characters/vesna. */
const normals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [7],
    toNormal: 14,
    toCharged: 21,
    toAbil: 13,
    frames: 25,
    worldTimeHits: true,
  },
  {
    hitmarks: [19],
    hitlag: [7],
    toNormal: 33,
    toCharged: 33,
    toAbil: 19,
    frames: 39,
    worldTimeHits: true,
  },
  {
    hitmarks: [10, 21],
    hitlag: [6, 6],
    toNormal: 24,
    toCharged: 23,
    toAbil: 21,
    frames: 30,
    worldTimeHits: true,
  },
  {
    hitmarks: [21],
    hitlag: [5],
    toNormal: 31,
    toCharged: 30,
    toAbil: 21,
    frames: 38,
    worldTimeHits: true,
  },
  {
    hitmarks: [20],
    hitlag: [6],
    toNormal: 40,
    toCharged: 38,
    toAbil: 20,
    frames: 42,
    worldTimeHits: true,
  },
  {
    hitmarks: [29],
    hitlag: [9],
    toNormal: 50,
    toCharged: 50,
    toAbil: 29,
    frames: 50,
    worldTimeHits: true,
  },
]
const essencePoints = [1, 1, 1, 1, 1, 3]
interface State {
  end: number
  token: number
  essence: number
  normalPoints: number
  level: number
  maxUses: number
  a1: object[]
  dashed: boolean
  /** C1: the first max-level Windborne Sword of this Armed for Action is free */
  c1Free: boolean
  /** C6: Windborne Sword: Transpose is available until this (world) frame */
  c6End: number
}
/** The same context with every scheduled event `offset` frames later (a string after a lead-in). */
function shifted(c: SimContext, offset: number): SimContext {
  return new Proxy(c, {
    get(target, prop) {
      if (prop === 'hit')
        return (d: number, h: Parameters<SimContext['hit']>[1]) =>
          target.hit(d + offset, h)
      if (prop === 'at')
        return (d: number, fn: (x: SimContext) => void) =>
          target.at(d + offset, fn)
      return Reflect.get(target, prop)
    },
  })
}
const active = (c: SimContext, s: State) => c.now < s.end
/**
 * Sword Essence (dump `_ABILITY_Vesna_MagicValue`: 30 a Sword Essence, at most 90), kept as whole
 * Sword Essence plus points of 5
 */
function addEssence(s: State, essence: number, points = 0) {
  const total = Math.min(
    18,
    s.essence * 6 + s.normalPoints + essence * 6 + points
  )
  s.essence = Math.floor(total / 6)
  s.normalPoints = total % 6
}
/** Armed for Action ends: all Sword Essence goes */
function clearEssence(s: State) {
  s.essence = 0
  s.normalPoints = 0
}
/** C1: the first max-level Windborne Sword of this Armed for Action needs no Sword Essence */
const freeSword = (s: State) => s.level >= 3 && s.c1Free
const set = (c: SimContext, name: string, value: string) =>
  c.state('Vesna', ['Vesna', name], value)
function sync(c: SimContext, s: State) {
  set(c, 'a0StellarRadiance', c.hasStellarSwirl ? 'ss' : '')
  set(c, 'skillArmed', active(c, s) ? 'on' : '')
  set(c, 'a1Stacks', s.a1.length ? String(s.a1.length) : '')
}
function stack(c: SimContext, s: State) {
  const entry = {}
  s.a1 = [...s.a1, entry].slice(-6)
  sync(c, s)
  // Native's comparison includes the final frame of the 20-second character clock.
  c.atCharacter('Vesna', 1201, (at) => {
    s.a1 = s.a1.filter((x) => x !== entry)
    sync(at, s)
  })
}
function pinion(c: SimContext, delay: number) {
  c.hit(delay, {
    path: ['skill', 'windPinionDmg'],
    tag: 'skill',
    element: 'anemo',
    applies: true,
    icd: 'skill',
    icdGroup: 'VesnaSkill',
    label: 'Wind Pinion',
  })
}
function spirit(
  c: SimContext,
  s: State,
  delay: number,
  node: string,
  label: string,
  burst = false,
  /** The blade still counts as in Armed for Action (the last use: the mode ends after it) */
  armed = false
) {
  c.atCharacter('Vesna', delay, (at) => {
    sync(at, s)
    const stellar = at.hasStellarSwirl
    at.hit(0, {
      path: [
        burst ? 'burst' : 'skill',
        `${node}${stellar ? 'StellarswirlDmg' : 'Dmg'}`,
      ],
      tag: stellar ? 'directStellarSwirl' : burst ? 'burst' : 'skill',
      element: 'anemo',
      applies: !stellar,
      icd: burst ? 'none' : 'skill',
      icdGroup: 'VesnaSkill',
      label: `${label}${stellar ? ' (Stellar Swirl)' : ''}`,
      states: [
        {
          owner: 'Vesna',
          path: ['Vesna', 'a0StellarRadiance'],
          value: stellar ? 'ss' : '',
        },
        {
          owner: 'Vesna',
          path: ['Vesna', 'a1Stacks'],
          value: s.a1.length ? String(s.a1.length) : '',
        },
        ...(armed
          ? [
              {
                owner: 'Vesna' as const,
                path: ['Vesna', 'skillArmed'],
                value: 'on',
              },
            ]
          : []),
      ],
    })
  })
}
/**
 * C6 Windborne Sword: Transpose (native c6Attack: 60 frames; the strike lands at 30, its Spirit
 * Blade at 45 and, in Armed for Action, a wind pinion at 40). The Spirit Blade gives 3 Sword
 * Essence points.
 */
function transpose(c: SimContext, s: State): ActionResult {
  s.c6End = -1
  const stellar = c.hasStellarSwirl
  c.hit(30, {
    path: ['constellation6', 'transposeDmg'],
    tag: 'skill',
    element: 'anemo',
    applies: true,
    icd: 'skill',
    icdGroup: 'VesnaSkill',
    label: 'Windborne Sword: Transpose (C6)',
  })
  c.hit(45, {
    path: ['constellation6', stellar ? 'swordStellarswirlDmg' : 'swordDmg'],
    tag: stellar ? 'directStellarSwirl' : 'skill',
    element: 'anemo',
    applies: !stellar,
    icd: 'skill',
    icdGroup: 'VesnaSkill',
    label: `Windborne Sword: Transpose Spirit Blade (C6)${stellar ? ' (Stellar Swirl)' : ''}`,
    states: [
      {
        owner: 'Vesna',
        path: ['Vesna', 'a0StellarRadiance'],
        value: stellar ? 'ss' : '',
      },
      {
        owner: 'Vesna',
        path: ['Vesna', 'a1Stacks'],
        value: s.a1.length ? String(s.a1.length) : '',
      },
      { owner: 'Vesna', path: ['Vesna', '_swordEssence'], value: '3' },
    ],
  })
  if (active(c, s)) pinion(c, 40)
  return { frames: 60 }
}
const transposeReady = (c: SimContext, s: State) => c.now < s.c6End
export const kit: KitModel = {
  characterKey: 'Vesna',
  element: 'anemo',
  moonsign: 1,
  source: `${KQMSIM}/vesna`,
  init: (): State => ({
    end: -1,
    token: 0,
    essence: 0,
    normalPoints: 0,
    level: 1,
    maxUses: 0,
    a1: [],
    dashed: false,
    c1Free: false,
    c6End: -1,
  }),
  onStart(c, s: State) {
    sync(c, s)
    c.note(
      'Vesna: follows the pinned native source (C1–C6 included), with the game logic where they differ: Wind Pinions only in Armed for Action, Sword Essence capped at 3, a Burst before her Skill keeps its Sword Essence; plunges are unsupported.'
    )
  },
  cooldownKey: (s: State, action, now) =>
    action.kind === 'skill'
      ? now < s.end || now < s.c6End
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  actionReadyAt: (c, s: State, action) =>
    action.kind === 'skill' &&
    !transposeReady(c, s) &&
    active(c, s) &&
    s.essence <= 0 &&
    !freeSword(s)
      ? s.end
      : c.now,
  // In Armed for Action her E is Windborne Blade Lv. 1, 2 or 3 (each with frames of its own); in
  // C6's window after a Lv. 3 her E or normal attack is Windborne Sword: Transpose
  variant(c, s: State, action) {
    if (action.kind !== 'skill' && action.kind !== 'normal') return undefined
    if (transposeReady(c, s))
      return { key: 'transpose', label: 'Windborne Sword: Transpose' }
    if (
      action.kind !== 'skill' ||
      !active(c, s) ||
      (s.essence <= 0 && !freeSword(s))
    )
      return undefined
    const level = Math.min(3, s.level)
    return {
      key: `blade${level}`,
      label: `Windborne Blade Lv. ${level}`,
      mode: 'Armed for Action',
    }
  },
  act(c, s: State, action) {
    sync(c, s)
    switch (action.kind) {
      case 'skill': {
        // C6: a tap within 5 s of a max-level Windborne Sword unleashes Transpose instead.
        if (transposeReady(c, s)) return transpose(c, s)
        if (!active(c, s)) {
          s.end = c.now + 929
          // (+2 Sword Essence on top of any a Burst left: essence goes only when the mode ends)
          addEssence(s, 2)
          s.level = 1
          s.maxUses = 0
          s.a1 = []
          s.c1Free = c.constellation('Vesna') >= 1
          const token = ++s.token
          // C2: entering Armed for Action grants the maximum (6) Disciplinary Action stacks.
          if (c.constellation('Vesna') >= 2)
            for (let i = 0; i < 6; i++) stack(c, s)
          sync(c, s)
          c.atCharacter('Vesna', 929, (at) => {
            if (token !== s.token) return
            s.end = at.now
            clearEssence(s)
            sync(at, s)
          })
          c.hit(29, {
            path: ['skill', 'skillDmg'],
            tag: 'skill',
            element: 'anemo',
            applies: true,
            icd: 'none',
            label: 'The Art of Victory',
          })
          return {
            frames: 32,
            framesInto: {
              normal: 26,
              skill: 27,
              burst: 29,
              dash: 28,
              jump: 27,
              swap: 26,
              wait: 26,
            },
            cooldown: { key: 'skill', delay: 29, frames: 1080 },
          }
        }
        if (s.essence <= 0 && !freeSword(s))
          return {
            frames: 0,
            failed: 'Vesna: Windborne Blade requires Sword Essence.',
          }
        const level = Math.min(3, s.level)
        stack(c, s)
        // C1: the first max-level use of each Armed for Action does not consume Sword Essence.
        if (level === 3 && s.c1Free) s.c1Free = false
        else s.essence--
        if (level < 3) {
          s.level++
          c.hit(level === 1 ? 9 : 17, {
            path: ['skill', `sword${level}Dmg`],
            tag: 'skill',
            element: 'anemo',
            applies: true,
            icd: 'skill',
            icdGroup: 'VesnaSkill',
            label: `Windborne Blade Lv. ${level}`,
          })
          if (level === 2)
            spirit(
              c,
              s,
              47,
              'sword2Spirit',
              'Windborne Blade Lv. 2 Spirit Blade'
            )
          return level === 1
            ? {
                frames: 27,
                framesInto: {
                  skill: 25,
                  burst: 25,
                  dash: 25,
                  jump: 24,
                  swap: 9,
                  wait: 9,
                },
              }
            : {
                frames: 49,
                framesInto: {
                  skill: 39,
                  burst: 40,
                  dash: 40,
                  jump: 42,
                  swap: 17,
                  wait: 17,
                },
              }
        }
        // C1: up to 4 max-level uses instead of 3.
        const last = s.maxUses + 1 >= (c.constellation('Vesna') >= 1 ? 4 : 3)
        // (the last use's blades keep Armed for Action's C1 bonus: the mode ends only after its
        // animation, dump Vesna_ElementalArt_E3_CountChecker_Real)
        for (const t of [24, 33, 41, 50])
          spirit(
            c,
            s,
            t,
            'sword3Spirit',
            'Windborne Blade Lv. 3 Spirit Blade',
            false,
            last
          )
        spirit(
          c,
          s,
          70,
          'sword3SpiritFinal',
          'Windborne Blade Lv. 3 Spirit Blade Final',
          false,
          last
        )
        // C6: Transpose is available for 5 s after a max-level use.
        if (c.constellation('Vesna') >= 6) s.c6End = c.now + 300
        s.maxUses++
        if (last) {
          s.end = c.now
          clearEssence(s)
          sync(c, s)
        }
        return {
          frames: 76,
          framesInto: {
            normal: 70,
            skill: 69,
            burst: 70,
            dash: 70,
            jump: 70,
            swap: 70,
            wait: 50,
          },
        }
      }
      case 'normal': {
        // C6: the first press within the window is Transpose; the rest of the string follows it.
        const lead = transposeReady(c, s) ? transpose(c, s) : undefined
        const count = (action.count ?? 1) - (lead ? 1 : 0)
        if (lead && count <= 0) return lead
        const sc = lead ? shifted(c, lead.frames) : c
        const armed = active(c, s)
        const queued = new Set<number>()
        const result = normalString(
          normals,
          count,
          (i, delay, j) => {
            sc.hit(delay, {
              path: ['normal', String(i)],
              tag: 'normal',
              element: armed ? 'anemo' : 'physical',
              applies: true,
              icd: 'normal',
              label: `Normal ${i + 1}`,
              states: [
                {
                  owner: 'Vesna',
                  path: ['Vesna', 'skillArmed'],
                  value: armed ? 'on' : '',
                },
                ...(armed
                  ? [
                      {
                        owner: 'Vesna' as const,
                        path: ['Vesna', '_swordEssence'],
                        value: String(essencePoints[i]),
                      },
                    ]
                  : []),
              ],
            })
            // (Wind Pinions only in Armed for Action: dump _ABILITY_Vesna_MagicSword_Enabled)
            if (j === 0 && armed) {
              const start = delay - normals[i].hitmarks[0]
              if (!queued.has(start)) {
                queued.add(start)
                pinion(sc, start + 30)
              }
            }
          },
          sc
        )
        if (!lead) return result
        return {
          ...result,
          frames: lead.frames + result.frames,
          normalStarts: result.normalStarts?.map((n) => ({
            ...n,
            offset: n.offset + lead.frames,
          })),
          framesInto: Object.fromEntries(
            Object.entries(result.framesInto ?? {}).map(([k, v]) => [
              k,
              lead.frames + (v as number),
            ])
          ),
        }
      }
      case 'charged': {
        // Vesna uses KQMSim's sword-input rule: the normal string must still be open.
        if (c.normalSequence(normals.length, 0) === 0)
          return {
            frames: 0,
            failed:
              'Vesna: Charged Attack requires a Normal Attack that leaves the combo open.',
          }
        const armed = active(c, s)
        c.hit(31, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: armed ? 'anemo' : 'physical',
          applies: true,
          icd: 'charged',
          label: 'Charged Attack',
          states: [
            {
              owner: 'Vesna',
              path: ['Vesna', 'skillArmed'],
              value: armed ? 'on' : '',
            },
            ...(armed
              ? [
                  {
                    owner: 'Vesna' as const,
                    path: ['Vesna', '_swordEssence'],
                    value: '2',
                  },
                ]
              : []),
          ],
        })
        if (armed) pinion(c, 30)
        c.hit(31, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 6,
          label: 'Melee hitlag',
        })
        return withHitlag(
          {
            frames: 59,
            framesInto: {
              normal: 56,
              skill: 31,
              burst: 31,
              dash: 31,
              jump: 31,
              swap: 31,
              wait: 31,
            },
          },
          { hitmarks: [31], hitlag: [6], worldTimeHits: true }
        )
      }
      case 'burst':
        stack(c, s)
        // (+1 Sword Essence, in Armed for Action or not: kept for her next Skill)
        c.atCharacter('Vesna', 98, () => addEssence(s, 1))
        spirit(c, s, 132, 'spirit', 'Burst', true)
        return {
          frames: 128,
          framesInto: {
            normal: 125,
            skill: 125,
            dash: 126,
            swap: 126,
            wait: 112,
          },
          cooldown: { key: 'burst', frames: 900 },
        }
      case 'dash':
        s.dashed = true
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return { frames: s.dashed ? 34 : 31, framesInto: { plunge: 5 } }
      default:
        return {
          frames: 0,
          failed: `Vesna: ${action.text} is not implemented.`,
        }
    }
  },
  onHit(c, s: State, hit) {
    sync(c, s)
    if (hit.characterKey !== 'Vesna' || hit.path[0].startsWith('_')) return
    // The attack snapshots before its own element application can grant new radiance.
    if (
      !hit.states?.some(
        (x) => x.owner === 'Vesna' && x.path[1] === 'a0StellarRadiance'
      )
    )
      hit.states = [
        ...(hit.states ?? []),
        {
          owner: 'Vesna',
          path: ['Vesna', 'a0StellarRadiance'],
          value: c.hasStellarSwirl ? 'ss' : '',
        },
      ]
    const points = Number(
      hit.states?.find((x) => x.path[1] === '_swordEssence')?.value ?? 0
    )
    if (points && active(c, s)) addEssence(s, 0, points)
  },
  onReactionSnapshot: sync,
  onHitlag(c, s: State, frames) {
    if (active(c, s)) s.end += frames
    if (transposeReady(c, s)) s.c6End += frames
  },
  onSwapOut(c, s: State) {
    // (leaving the field ends Armed for Action and its Sword Essence; a Burst's outside it stays)
    if (active(c, s)) clearEssence(s)
    s.end = c.now
    // C6: leaving the field removes Transpose
    s.c6End = -1
    s.a1 = []
    s.dashed = false
    sync(c, s)
  },
  onPartyAction(_c, s: State, actor, action) {
    if (actor !== 'Vesna' || (action.kind !== 'dash' && action.kind !== 'wait'))
      s.dashed = false
  },
}
