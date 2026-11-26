import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { HEXEREI_CHARACTERS } from '../gearEffects'
import type { RotationAction } from '../parse'
import type {
  ActionResult,
  KitModel,
  NormalStateStart,
  SimContext,
  SimCountedBuff,
  SimHit,
} from '../types'
import {
  atkSpdAdjust,
  GCSIM,
  type NormalHit,
  shieldMarker,
  templateJump,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/nicole, main as of 2026-11-10. */

/*
 * A1 observes the other active members only (game text and upstream gcsim; the kqmsim fork also
 * upgrades Nicole on her own swap-in). C4's Pathfinder's Blessing is a counted buff: an upgrade
 * to Guidance of Theosis (A1, A4, C6) grants the member 20 s and 8 of its own Normal, Charged,
 * Plunging, Skill and Burst hits (16 s cooldown per member), as gcsim's c4OnUpgrade.
 */

/** C4's Pathfinder's Blessing: a marker per grant (the recipient as `characterKey`) */
const PATHFINDER: string[] = ['_marker', 'nicolePathfinder']
/** A grant from the member's own hit on that frame: that hit is covered too */
const PATHFINDER_ON_HIT: string[] = ['_marker', 'nicolePathfinderOnHit']
const PATHFINDER_TAGS: readonly SimHit['tag'][] = [
  'normal',
  'charged',
  'plunge',
  'skill',
  'burst',
]

/** gcsim attack.go: N1 10 / N2 8 / N3 38 (catalyst, no hitlag) */
const nicoleNormals: NormalHit[] = [
  { hitmarks: [10], toNormal: 18, toCharged: 19, toAbil: 10, frames: 26 },
  { hitmarks: [8], toNormal: 22, toCharged: 17, toAbil: 8, frames: 34 },
  { hitmarks: [38], toNormal: 52, toCharged: 52, toAbil: 38, frames: 67 },
]

/**
 * Her normal string. gcsim's windup goes on the hitmark and every cancel: 7 frames on an N1 that
 * restarts the string out of a normal attack (also inside one written string, N3 into N1), 3 on
 * the first attack straight out of a charged attack
 */
function nicoleString(
  ctx: SimContext,
  count: number,
  from: 'normal' | 'charged' | undefined
) {
  const n = Math.max(1, count)
  const first = ctx.normalSequence(nicoleNormals.length, n)
  const normalStarts: NormalStateStart[] = []
  let start = 0
  let frames = 0
  let into: Record<string, number> = {}
  for (let step = 0; step < n; step++) {
    const i = (first + step) % nicoleNormals.length
    const h = nicoleNormals[i]
    const windup =
      step === 0 && from === 'charged'
        ? 3
        : i === 0 && (step > 0 || from === 'normal')
          ? 7
          : 0
    normalStarts.push({ offset: start, index: i })
    ctx.hit(start + h.hitmarks[0] + windup, {
      path: ['normal', `${i}`],
      tag: 'normal',
      element: 'pyro',
      applies: true,
      icd: 'normal',
      label: `N${i + 1}`,
    })
    const speed = ctx.normalAttackSpeed(step > 0)
    const adj = (f: number) =>
      Math.max(h.toAbil, atkSpdAdjust(f, speed)) + windup
    if (step < n - 1) {
      start += adj(h.toNormal)
      continue
    }
    frames = start + adj(h.frames)
    into = {
      normal: start + adj(h.toNormal),
      charged: start + adj(h.toCharged),
      skill: start + adj(h.toAbil),
      burst: start + adj(h.toAbil),
      dash: start + adj(h.toAbil),
      jump: start + adj(h.toAbil),
      swap: start + adj(h.toAbil),
      wait: start + adj(h.toAbil),
    }
  }
  return { normalStarts, frames, framesInto: into }
}

interface NicoleState {
  graceSnapshot?: { t: number; onField: SimContext['onField'] }
  /** Silent Contemplation (the Arcane Projections window), from burstFrom to burstTo */
  burstFrom: number
  burstTo: number
  /** Projections made in this window (4 at most) and the 3 s ICD on them */
  projections: number
  projIcdUntil: number
  /** C1 Arcane Projection: Unity's 6 s ICD */
  graceEnd: number
  swapToken: number
  a4Token: number
  c1Until: number
  hasGuidance: Set<CharacterKey>
  /** Her last action and when its animation ends (gcsim's state is Idle from then) */
  lastKind?: string
  lastEnd: number
  /** C4: each member's Pathfinder's Blessing cooldown (16 s, on that member's clock) */
  c4Icd: Map<SimContext['onField'], number>
}

/**
 * An upgrade to Guidance of Theosis for `member` (gcsim's a1UpgradeBuff): C4 grants Pathfinder's
 * Blessing once per 16 s per member
 */
function upgraded(
  ctx: SimContext,
  s: NicoleState,
  member: SimContext['onField'],
  /** the upgrade came from this member's own hit on this frame, which the Blessing covers */
  byOwnHit = false
) {
  if (ctx.constellation('Nicole') < 4) return
  // (a gcsim status is still active on its expiry frame)
  const f = ctx.characterFrame(member)
  if (f <= (s.c4Icd.get(member) ?? -1)) return
  s.c4Icd.set(member, f + 960)
  ctx.hit(0, {
    characterKey: member,
    path: byOwnHit ? PATHFINDER_ON_HIT : PATHFINDER,
    tag: 'other',
    element: 'physical',
    label: "Pathfinder's Blessing (C4)",
  })
}

function nicoleAct(
  ctx: SimContext,
  s: NicoleState,
  action: RotationAction,
  previous: RotationAction | undefined
): ActionResult {
  // gcsim's state: Idle once her last animation has ended; an action straight at her swap-in is
  // still in the swap's state
  const idle =
    s.lastKind === undefined ||
    (s.lastKind === 'swap' ? ctx.now > s.lastEnd : ctx.now >= s.lastEnd)
  switch (action.kind) {
    case 'normal': {
      // gcsim's state: her own normal or charged attack whose animation is still running
      const from =
        idle || (s.lastKind !== 'normal' && s.lastKind !== 'charged')
          ? undefined
          : s.lastKind
      return nicoleString(ctx, action.count ?? 1, from)
    }
    case 'charged': {
      // gcsim: from Idle, the charged attack's cancels come 2 frames sooner (the hit stays at 66)
      const windup = idle ? 2 : 0
      ctx.hit(66, {
        path: ['charged', 'dmg'],
        tag: 'charged',
        element: 'pyro',
        applies: true,
        icd: 'none',
        label: 'Charged Attack',
      })
      return {
        frames: 99 - windup,
        framesInto: {
          skill: 66 - windup,
          burst: 66 - windup,
          dash: 66 - windup,
          jump: 66 - windup,
          swap: 66 - windup,
        },
      }
    }
    case 'skill': {
      ctx.hit(9, {
        path: ['skill', 'skillDmg'],
        tag: 'skill',
        element: 'pyro',
        applies: true,
        icd: 'none',
        label: 'Revelation: Uncreated Light',
      })
      // Shield of Blazing Light: a party shield for 20 s, made with the buff 8 frames in (kqmsim's
      // addShield; a recast replaces it)
      shieldMarker(ctx, 8, 1200, 'Shield of Blazing Light')
      s.graceEnd = ctx.now + 1208
      s.hasGuidance.clear()
      s.a4Token++
      ctx.state('Nicole', ['Nicole', 'skillGraceActive'], '')
      ctx.state('Nicole', ['Nicole', 'a1GuidanceActive'], '')
      ctx.state('Nicole', ['Nicole', 'a4NicoleGuidance'], '')
      ctx.buff('Nicole', ['Nicole', 'skillGraceActive'], 'on', 8, 1200, {
        hitlag: 'recipient',
      })
      ctx.atCharacter('Nicole', 8, (at) => {
        s.graceSnapshot = { t: at.now, onField: at.onField }
      })
      return {
        cooldown: { key: 'skill', frames: 960 },
        frames: 42,
        framesInto: {
          normal: 40,
          charged: 40,
          skill: 33,
          burst: 32,
          dash: 34,
          jump: 32,
          swap: 31,
        },
      }
    }
    case 'burst': {
      ctx.hit(108, {
        path: ['burst', 'skillDmg'],
        tag: 'burst',
        element: 'pyro',
        applies: true,
        icd: 'none',
        label: 'Ladder of Divine Ascent',
      })
      // Silent Contemplation: 20 s from frame 109; the projections count restarts with it
      s.burstFrom = ctx.now + 109
      s.burstTo = ctx.now + 109 + 1200
      s.projections = 0
      return {
        cooldown: { key: 'burst', frames: 900 },
        frames: 128,
        framesInto: {
          normal: 117,
          charged: 120,
          skill: 116,
          dash: 118,
          jump: 117,
          swap: 113,
        },
      }
    }
    case 'plunge':
      // gcsim has no plunging attack for Nicole
      ctx.note('Nicole: plunging attack not modelled (gcsim has none).')
      return { frames: 30 }
    case 'dash':
      return { frames: 22, framesInto: { jump: 3 } }
    case 'jump':
      return templateJump('lady', 'catalyst', previous, ctx)
    default:
      return { frames: 30 }
  }
}

export const kit: KitModel = {
  characterKey: 'Nicole',
  element: 'pyro',
  source: `${GCSIM}/nicole`,
  init: (): NicoleState => ({
    burstFrom: -1,
    burstTo: -1,
    projections: 0,
    projIcdUntil: -1,
    c1Until: -1,
    graceEnd: -1,
    swapToken: 0,
    a4Token: 0,
    hasGuidance: new Set(),
    lastEnd: -1,
    c4Icd: new Map(),
  }),
  simOnlyBuffs: () => [
    ['Nicole', 'skillGraceActive'],
    ['Nicole', 'a1GuidanceActive'],
    ['Nicole', 'a4NicoleGuidance'],
    ['Nicole', 'c4Pathfinder'],
  ],
  onPartySwap(ctx, s: NicoleState, from, to) {
    if (to === 'Nicole') {
      s.lastKind = 'swap'
      s.lastEnd = ctx.now
    }
    if (from !== 'Nicole' && ctx.constellation('Nicole') < 6) {
      s.hasGuidance.delete(from)
      ctx.state('Nicole', ['Nicole', 'a1GuidanceActive'], '')
    }
    const token = ++s.swapToken
    if (to === 'Nicole') return
    const delay = HEXEREI_CHARACTERS.includes(to) ? 0 : 180
    ctx.atCharacter('Nicole', delay, (c) => {
      if (token !== s.swapToken || c.now >= s.graceEnd) return
      c.buff(
        'Nicole',
        ['Nicole', 'a1GuidanceActive'],
        'on',
        0,
        s.graceEnd - c.now,
        { hitlag: 'recipient' }
      )
      if (!s.hasGuidance.has(to)) {
        s.hasGuidance.add(to)
        upgraded(c, s, to)
      }
    })
  },
  act(ctx, s: NicoleState, action, previous) {
    const r = nicoleAct(ctx, s, action, previous)
    s.lastKind = action.kind
    s.lastEnd = ctx.now + r.frames
    return r
  },
  onSwapOut(_ctx, s: NicoleState) {
    s.lastKind = undefined
  },
  onHit(ctx, s: NicoleState, hit) {
    if (hit.path[0].startsWith('_')) return
    if (s.graceSnapshot && ctx.now < s.graceEnd)
      hit.statSnapshots = [
        ...(hit.statSnapshots ?? []),
        {
          characterKey: 'Nicole',
          stat: 'atk',
          path: ['display', 'skill', 'skillGraceActive_atk'],
          ...s.graceSnapshot,
        },
      ]
    const upgrades =
      hit.characterKey === ctx.onField &&
      hit.element !== 'physical' &&
      ctx.now < s.graceEnd
    if (hit.characterKey === 'Nicole') {
      const before = s.hasGuidance.has('Nicole')
      const on = before || upgrades ? 'on' : ''
      hit.states = [
        ...(hit.states ?? []),
        { owner: 'Nicole', path: ['Nicole', 'a4NicoleGuidance'], value: on },
      ]
      // Upgrading hit snapshots ATK before +300 Guidance while receiving hit-time C2 RES shred / C6 DEF ignore
      if (!before && upgrades)
        hit.statSnapshots = [
          ...(hit.statSnapshots ?? []),
          { stat: 'atk', path: ['total', 'atk'], ...ctx.snapshot('Nicole') },
        ]
    }
    if (upgrades) {
      const c6 = ctx.constellation('Nicole') >= 6
      const dur = c6
        ? s.graceEnd - ctx.now
        : Math.min(480, s.graceEnd - ctx.now)
      ctx.buff('Nicole', ['Nicole', 'a4NicoleGuidance'], 'on', 0, dur, {
        hitlag: 'recipient',
      })
      if (!c6) {
        const a4Token = ++s.a4Token
        ctx.atCharacter('Nicole', dur, () => {
          if (a4Token === s.a4Token) s.hasGuidance.delete('Nicole')
        })
      }
      if (!s.hasGuidance.has('Nicole')) {
        s.hasGuidance.add('Nicole')
        upgraded(ctx, s, 'Nicole', hit.characterKey === 'Nicole')
      }
      if (c6) {
        ctx.buff(
          'Nicole',
          ['Nicole', 'a1GuidanceActive'],
          'on',
          0,
          s.graceEnd - ctx.now,
          { hitlag: 'recipient' }
        )
        for (const m of ctx.members)
          if (m !== 'Nicole' && !s.hasGuidance.has(m)) {
            s.hasGuidance.add(m)
            upgraded(ctx, s, m, hit.characterKey === m)
          }
      }
    }
    if (hit.characterKey !== hit.onField) return
    if (ctx.constellation('Nicole') >= 1 && hit.t >= s.c1Until) {
      s.c1Until = hit.t + 360
      ctx.hit(30, {
        characterKey: hit.characterKey,
        path: ['nicole', 'c1ArcaneProjectionUnityDmg'],
        tag: 'other',
        element: getCharEle(hit.characterKey),
        applies: false,
        icd: 'none',
        poiseDamage: 50,
        label: 'Arcane Projection: Unity (C1)',
      })
    }
    if (
      hit.t >= s.burstFrom &&
      hit.t < s.burstTo &&
      s.projections < 4 &&
      hit.t >= s.projIcdUntil
    ) {
      s.projections++
      s.projIcdUntil = hit.t + 180
      ctx.hit(30, {
        characterKey: hit.characterKey,
        path: ['nicole', 'burstArcaneProjectionDmg'],
        tag: 'other',
        element: getCharEle(hit.characterKey),
        applies: false,
        icd: 'none',
        poiseDamage: 50,
        label: 'Arcane Projection',
      })
    }
  },
  // C4: each grant covers its member's next 8 qualifying hits within 20 s
  countedBuffs(hits, constellation) {
    const covered = new Set<number>()
    if (constellation >= 4) {
      const grant = new Map<string, { until: number; left: number }>()
      /** each member's last qualifying hit (index), for grants from that hit */
      const lastHit = new Map<string, number>()
      hits.forEach((h: SimHit, i) => {
        if (
          h.path[0] === '_marker' &&
          (h.path[1] === PATHFINDER[1] || h.path[1] === PATHFINDER_ON_HIT[1])
        ) {
          const g = { until: h.t + 1200, left: 8 }
          grant.set(h.characterKey, g)
          const own = lastHit.get(h.characterKey)
          if (
            h.path[1] === PATHFINDER_ON_HIT[1] &&
            own !== undefined &&
            hits[own].t === h.t &&
            !covered.has(own)
          ) {
            g.left--
            covered.add(own)
          }
          return
        }
        if (h.path[0].startsWith('_') || !PATHFINDER_TAGS.includes(h.tag))
          return
        lastHit.set(h.characterKey, i)
        const g = grant.get(h.characterKey)
        if (!g || h.t >= g.until || g.left <= 0) return
        g.left--
        covered.add(i)
      })
    }
    const buffs: SimCountedBuff[] = [
      {
        owner: 'Nicole',
        path: ['Nicole', 'c4Pathfinder'],
        value: 'on',
        hits: covered,
      },
    ]
    return { buffs, extraHits: [] }
  },
}
