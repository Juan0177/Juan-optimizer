import type { RotationAction } from '../parse'
import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  particleMarker,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/mavuika, main as of 2026-11-10. */

/** Ring form normal attack string (N1..N4; N2 and N3 have several hits) */
const ringNormals: NormalHit[] = [
  {
    hitmarks: [21],
    hitlag: [9],
    toNormal: 31,
    toCharged: 31,
    toAbil: 21,
    frames: 40,
  },
  {
    hitmarks: [14, 26],
    hitlag: [7, 7],
    worldTimeHits: true,
    toNormal: 42,
    toCharged: 42,
    toAbil: 26,
    frames: 50,
  },
  {
    hitmarks: [28, 33, 39],
    hitlag: [4, 4, 4],
    worldTimeHits: true,
    toNormal: 46,
    toCharged: 47,
    toAbil: 39,
    frames: 59,
  },
  {
    hitmarks: [30],
    hitlag: [10],
    toNormal: 60,
    toCharged: 61,
    toAbil: 30,
    frames: 61,
  },
]

/** Flamestrider (bike form) normal attack string (N1..N5, one hit each) */
const bikeNormals: NormalHit[] = [
  {
    hitmarks: [19],
    hitlag: [6],
    toNormal: 23,
    toCharged: 33,
    toAbil: 19,
    frames: 39,
  },
  {
    hitmarks: [24],
    hitlag: [5],
    toNormal: 32,
    toCharged: 35,
    toAbil: 24,
    frames: 46,
  },
  {
    hitmarks: [31],
    hitlag: [3],
    toNormal: 35,
    toCharged: 40,
    toAbil: 31,
    frames: 50,
  },
  {
    hitmarks: [13],
    hitlag: [2],
    toNormal: 27,
    toCharged: 29,
    toAbil: 13,
    frames: 44,
  },
  { hitmarks: [37], toNormal: 68, toCharged: 64, toAbil: 37, frames: 70 },
]

/** Nightsoul points drain per frame: 0.5 every 6 frames in Ring form, 0.9 in Flamestrider */
const RING_RATE = 0.5 / 6
const BIKE_RATE = 0.9 / 6
/** A Flamestrider charged attack drains 0.2 more per 6 frames (its ~134 frames: a flat amount) */
/** Fighting Spirit: 0 to 200; a burst needs 100 */
const MAX_SPIRIT = 200
const BURST_SPIRIT = 100
/** The burst's buff (no Nightsoul drain, the Spirit it spent as a stat) starts 105 frames in, 7 s long */
const BURST_BUFF_START = 105
const BURST_BUFF = 7 * 60
/** One revolution of the Flamestrider's held Charged Attack (gcsim's bikeChargeAttackSpinFrames) */
const BIKE_SPIN = 45
/** Skill recast (form switch) cooldown (gcsim's skillRecastCD) */
const SKILL_RECAST_CD = 60
/** Rings of Searing Radiance: every 2 s in Ring form */
const RADIANCE_INTERVAL = 2 * 60
/** C6: a Flamestrider hit every 3 s in Flamestrider form */
const C6_INTERVAL = 3 * 60
const C6_INITIAL_DELAY = 12
const C6_REFUND = 80
const C6_REFUND_THRESHOLD = 5
const C6_REFUND_CD = 15 * 60

type MavHit = Parameters<SimContext['hit']>[1]

interface MavuikaState {
  /** Nightsoul points, as of `pointsAt` */
  points: number
  pointsAt: number
  /** The Nightsoul Blessing is up (it ends when the points run out) */
  blessing: boolean
  /** Fighting Spirit, 0 to 200 */
  spirit: number
  /** Flamestrider form (otherwise Ring) */
  bike: boolean
  /**
   * The burst's buff is from burstStart to burstEnd (it ends early on a swap). Its end is unknown
   * (MAX_SAFE_INTEGER) until her own clock reaches it: gcsim's Crucible status is a hitlag one
   */
  burstStart: number
  burstEnd: number
  /** Only the latest burst's buff ends on its clock */
  burstToken: number
  /** The Fighting Spirit the burst spent: its buff's state */
  chargeToken: number
  burstStacks: number
  /** The Ring form's radiance chain, and the Flamestrider form's C6 chain (their start frames) */
  ringSrc: number
  bikeSrc: number
  /** A normal attack hit may gain Fighting Spirit from this frame (0.1 s ICD) */
  naIcd: number
  /** The last normal attack string's last hit (0-based), while it is her last action */
  lastNormal?: number
  /** C1: the last frame she gained Fighting Spirit, and whether its ATK buff is on */
  lastGain: number
  c1On: boolean
  /** C2: the Ring's DEF shred is on (Ring form, or either form at C6, in the blessing) */
  c2On: boolean
  c6BikeReady: number
  c6RefundReady: number
  /** A4: only the latest burst's 20 s buff */
  a4Token: number
  /** Her last action was a jump (the Flamestrider plunge follows one): for `variant` */
  lastJump: boolean
  /** Cached constellation for `cooldownKey` (which does not receive SimContext) */
  cons: number
  /** When the 15 s Skill cooldown is next ready (for detecting form-switch recasts in `cooldownKey`) */
  skillReadyAt: number
  /** End frame of gcsim's `skillRecastCDKey` (60 f): used by CA windup skip after Skill */
  recastCdEnd: number
  /** Whether a Flamestrider Dash immediately after her last Charged Attack can charge-cancel (6 f) */
  canChargeCancelDash: boolean
}

const maxPoints = (c: number) => (c >= 1 ? 120 : 80)
const spiritMul = (c: number) => (c >= 1 ? 1.25 : 1)
const inBurst = (s: MavuikaState, t: number) =>
  t >= s.burstStart && t < s.burstEnd

function tryC6Refund(s: MavuikaState, t: number, cons: number) {
  if (
    cons >= 6 &&
    s.blessing &&
    s.bike &&
    s.points <= C6_REFUND_THRESHOLD + 1e-9 &&
    t >= s.c6RefundReady
  ) {
    s.points = Math.min(maxPoints(cons), s.points + C6_REFUND)
    s.c6RefundReady = t + C6_REFUND_CD
    return true
  }
  return false
}

/**
 * Frames of Nightsoul drain from frame `from`: the points lose their rate per frame while the
 * blessing is up, and become Fighting Spirit (C1: the last frame that happened)
 */
function drain(s: MavuikaState, from: number, frames: number, cons: number) {
  const rate = s.bike ? BIKE_RATE : RING_RATE
  let at = from
  const end = from + frames
  while (at < end && s.blessing) {
    tryC6Refund(s, at, cons)
    let step = end - at
    const toEmpty = s.points / rate
    if (toEmpty < step) step = toEmpty
    if (cons >= 6 && s.bike) {
      if (s.points > C6_REFUND_THRESHOLD) {
        const toThreshold = (s.points - C6_REFUND_THRESHOLD) / rate
        if (toThreshold < step) step = toThreshold
      } else if (s.c6RefundReady > at && s.c6RefundReady < at + step) {
        step = s.c6RefundReady - at
      }
    }
    const used = Math.min(s.points, step * rate)
    s.points -= used
    s.spirit = Math.min(MAX_SPIRIT, s.spirit + used * spiritMul(cons))
    if (used > 0) s.lastGain = Math.max(s.lastGain, at + used / rate)
    at += step
    if (!tryC6Refund(s, at, cons) && s.points < 0.001) {
      s.points = 0
      s.blessing = false
    }
    if (step <= 1e-9) break
  }
}

/** Brings the Nightsoul points (and the Fighting Spirit they become) up to frame `t` */
function settle(s: MavuikaState, t: number, cons: number) {
  let at = s.pointsAt
  while (at < t) {
    const burst = inBurst(s, at)
    // (the burst's buff stops the drain; each piece runs to the next change)
    const end = burst
      ? Math.min(t, s.burstEnd)
      : at < s.burstStart
        ? Math.min(t, s.burstStart)
        : t
    if (!burst && s.blessing) drain(s, at, end - at, cons)
    at = end
  }
  s.pointsAt = t
}

/** A discrete Nightsoul use (a dash, a Flamestrider hit, a radiance tick) */
function consume(c: SimContext, s: MavuikaState, amount: number) {
  const cons = c.constellation('Mavuika')
  settle(s, c.now, cons)
  if (!s.blessing || inBurst(s, c.now)) return
  const used = Math.min(s.points, amount)
  s.points -= used
  s.spirit = Math.min(MAX_SPIRIT, s.spirit + used * spiritMul(cons))
  if (used > 0) s.lastGain = c.now
  if (!tryC6Refund(s, c.now, cons) && s.points < 0.001) {
    s.points = 0
    s.blessing = false
  }
}

/** Nightsoul points generated now: the blessing starts with them, or they are added to it */
function gainPoints(c: SimContext, s: MavuikaState, amount: number) {
  const cons = c.constellation('Mavuika')
  settle(s, c.now, cons)
  const wasBlessing = s.blessing
  if (!s.blessing) {
    s.blessing = true
    s.points = Math.min(maxPoints(cons), amount)
  } else s.points = Math.min(maxPoints(cons), s.points + amount)
  if (!wasBlessing && s.blessing && s.bike) startBikeC6(c, s)
}

/**
 * C6, Flamestrider form: a Scorching Ring of Searing Radiance follows her and deals 500% ATK every
 * 3 s while the form lasts (gcsim's c6RingAtk uses 400%, the game text says 500%)
 */
const c6Tick = (s: MavuikaState, src: number) => (c: SimContext) => {
  settle(s, c.now, c.constellation('Mavuika'))
  if (s.bikeSrc !== src || !s.bike || !s.blessing) return
  s.c6BikeReady = c.now + C6_INTERVAL
  hitAt(c, s, 0, {
    characterKey: 'Mavuika',
    path: ['constellation6', 'ringDmg'],
    tag: 'skill',
    element: 'pyro',
    applies: false,
    icd: 'none',
    nightsoul: true,
    label: 'Scorching Ring of Searing Radiance (C6)',
  })
  c.at(C6_INTERVAL, c6Tick(s, src))
}

function startBikeC6(c: SimContext, s: MavuikaState) {
  if (c.constellation('Mavuika') < 6 || !s.bike || !s.blessing) return
  s.bikeSrc = c.now
  const delay = Math.max(C6_INITIAL_DELAY, s.c6BikeReady - c.now)
  c.at(delay, c6Tick(s, c.now))
}

function enterBike(c: SimContext, s: MavuikaState) {
  s.bike = true
  if (s.blessing) startBikeC6(c, s)
}

/** Rings of Searing Radiance: a hit and a Nightsoul cost every 2 s, while in Ring form */
const radianceTick = (s: MavuikaState, src: number) => (c: SimContext) => {
  const cons = c.constellation('Mavuika')
  settle(s, c.now, cons)
  if (s.ringSrc !== src || s.bike || !s.blessing) return
  hitAt(c, s, 0, {
    characterKey: 'Mavuika',
    path: ['skill', 'radianceDmg'],
    tag: 'skill',
    element: 'pyro',
    applies: true,
    icd: 'none',
    nightsoul: true,
    label: 'Rings of Searing Radiance',
  })
  // C6, Ring form: a Flamestrider crashes into the struck opponent for 200% ATK
  if (cons >= 6)
    hitAt(c, s, 3, {
      characterKey: 'Mavuika',
      path: ['constellation6', 'flamestriderDmg'],
      tag: 'skill',
      element: 'pyro',
      applies: false,
      icd: 'none',
      nightsoul: true,
      label: 'Flamestrider (C6)',
    })
  consume(c, s, 3)
  c.at(RADIANCE_INTERVAL, radianceTick(s, src))
}

function enterRing(c: SimContext, s: MavuikaState) {
  s.bike = false
  s.ringSrc = c.now
  c.at(RADIANCE_INTERVAL, radianceTick(s, c.now))
}

/** Her moves on the Flamestrider (in the blessing): the buttons with their own frames there */
const FLAMESTRIDER_MOVES: Partial<Record<RotationAction['kind'], string>> = {
  normal: 'Flamestrider Normal Attack',
  charged: 'Flamestrider Charged Attack',
  skill: 'The Named Moment (Flamestrider)',
  plunge: 'Flamestrider Plunging Attack',
  dash: 'Flamestrider Sprint',
  jump: 'Flamestrider Jump',
}

/** The sheet's burstSpirit state for the Spirit the burst spent (100 to 200, by 10) */
const burstState = (stacks: number) =>
  String(Math.min(200, Math.max(100, Math.floor(stacks / 10) * 10)))

/**
 * A hit of hers. Her conditionals (the burst's buff, C2's form) can end early (a swap) or change
 * with the form, and a window can't be cut once pushed: each is on for the hit's frame only.
 */
function hitAt(ctx: SimContext, s: MavuikaState, delay: number, hit: MavHit) {
  // (the burst's buff as the hit lands, as gcsim reads it then: its end follows her own clock)
  const crucible = (c: SimContext) => {
    if (inBurst(s, c.now))
      c.buff(
        'Mavuika',
        ['Mavuika', 'burstSpirit'],
        burstState(s.burstStacks),
        0,
        1
      )
  }
  if (delay <= 0) crucible(ctx)
  else ctx.at(delay, crucible)
  // C2 in the blessing, Flamestrider form: her own hits deal more (+200 base ATK); in Ring form
  // the base ATK comes with the Ring's shred state (c2Update)
  if (ctx.constellation('Mavuika') >= 2 && s.bike && s.blessing)
    ctx.buff('Mavuika', ['Mavuika', 'c2FlameForm'], 'on', delay, 1)
  ctx.hit(delay, hit)
}

/**
 * C1: +40% ATK for 8 s after gaining Fighting Spirit (gcsim: 10 s; the game text and skillParam
 * say 8 s). C2: while the Ring follows her in the blessing (Ring form; either form at C6), nearby
 * opponents' DEF is decreased by 20% (and she has +200 base ATK). Both are kept as states and
 * brought up to date whenever a hit lands, so every hit sees them as of its frame.
 */
const C1_DURATION = 8 * 60
function consUpdate(ctx: SimContext, s: MavuikaState) {
  const cons = ctx.constellation('Mavuika')
  if (cons >= 1) {
    const on = ctx.now < s.lastGain + C1_DURATION
    if (on !== s.c1On) {
      s.c1On = on
      ctx.state('Mavuika', ['Mavuika', 'c1GainSpirit'], on ? 'on' : '')
    }
  }
  if (cons >= 2) {
    const on = s.blessing && (!s.bike || cons >= 6)
    if (on !== s.c2On) {
      s.c2On = on
      ctx.state('Mavuika', ['Mavuika', 'c2RingForm'], on ? 'on' : '')
    }
  }
}

/** Native single-target bike collision and finisher timing (charge.go). */
export function bikeChargeTiming(
  target: { radius: number; distance: number },
  skip: number
) {
  const { radius: r, distance: d } = target
  if (d + r <= 1 || d - r >= 7) return undefined
  const angleFrame = (degrees: number) => {
    const angle = (degrees + 360) % 360
    const quadrant = Math.floor(angle / 90)
    const spin = 3 - quadrant
    const lengths = [9, 7, 15, 14]
    let accumulated = lengths.slice(0, spin).reduce((a, b) => a + b, 0)
    if (accumulated > 0) accumulated--
    return (
      accumulated +
      Math.round(lengths[spin] - ((angle - quadrant * 90) * lengths[spin]) / 90)
    )
  }
  const theta =
    (Math.acos(
      Math.max(-1, Math.min(1, (16 + d * d - (3 + r) ** 2) / (8 * d)))
    ) *
      180) /
    Math.PI
  const start = angleFrame(90 + theta)
  const end = angleFrame(90 - theta)
  const covers = (frame: number) =>
    r - d > 1 ||
    (start <= end
      ? frame >= start && frame <= end
      : frame >= start || frame <= end)
  let raw = 35
  while (raw < 375 && !covers(raw % 45)) raw++
  const phase = raw % 45
  const delay = phase < 10 ? 10 - phase : phase >= 35 ? 55 - phase : 0
  const hit = raw - skip
  return { hit, final: hit + 1 + delay + 45, normal: hit + delay + 74 + 3 }
}

export const kit: KitModel = {
  characterKey: 'Mavuika',
  element: 'pyro',
  source: `${GCSIM}/mavuika`,
  nightsoul(ctx, state: MavuikaState) {
    const s = { ...state }
    settle(s, ctx.now, ctx.constellation('Mavuika'))
    return { active: s.blessing, points: s.points }
  },
  onNightsoulBurst(ctx) {
    ctx.buff('Mavuika', ['Mavuika', 'a1NsBurst'], 'on', 1, 600, {
      hitlag: 'recipient',
    })
  },
  onNightsoulConsume(ctx, s: MavuikaState, actor, amount) {
    if (actor !== 'Mavuika' && amount > 0) {
      s.spirit = Math.min(
        MAX_SPIRIT,
        s.spirit + amount * spiritMul(ctx.constellation('Mavuika'))
      )
      s.lastGain = ctx.now
    }
  },
  init: (): MavuikaState => ({
    points: 0,
    pointsAt: 0,
    blessing: false,
    spirit: MAX_SPIRIT,
    bike: false,
    burstStart: -1,
    burstEnd: -1,
    burstToken: 0,
    burstStacks: 0,
    chargeToken: 0,
    ringSrc: -1,
    bikeSrc: -1,
    naIcd: -1,
    lastGain: Number.NEGATIVE_INFINITY,
    c1On: false,
    c2On: false,
    c6BikeReady: Number.NEGATIVE_INFINITY,
    c6RefundReady: Number.NEGATIVE_INFINITY,
    a4Token: 0,
    lastJump: false,
    cons: 0,
    skillReadyAt: 0,
    recastCdEnd: Number.NEGATIVE_INFINITY,
    canChargeCancelDash: false,
  }),
  onStart(ctx, s: MavuikaState) {
    s.cons = ctx.constellation('Mavuika')
  },
  cooldownKey(state: MavuikaState, action, now) {
    if (action.kind === 'burst') return 'burst'
    if (action.kind !== 'skill') return undefined
    if (!action.hold && now < state.skillReadyAt) {
      const s = { ...state }
      settle(s, now, s.cons)
      if (s.blessing) return 'skillRecast'
    }
    return 'skill'
  },
  // On the Flamestrider (in the blessing) her normal and charged attacks, E, dash, jump and the
  // plunge after that jump are the Flamestrider's own moves, with their own frames. While E is on
  // cooldown during Nightsoul's Blessing, tapping E recasts to switch between Ring and Flamestrider.
  variant(ctx, state: MavuikaState, action) {
    const s = { ...state }
    const cons = ctx.constellation('Mavuika')
    settle(s, ctx.now, cons)
    if (
      action.kind === 'skill' &&
      !action.hold &&
      s.blessing &&
      ctx.cooldownReadyAt('skill') > ctx.now
    )
      return s.bike
        ? {
            key: 'recastRing',
            label: 'Switch to Ring',
            mode: 'Flamestrider',
          }
        : {
            key: 'recastBike',
            label: 'Switch to Flamestrider',
            mode: 'Ring',
          }
    if (!s.bike || !s.blessing) return undefined
    if (action.kind === 'plunge' && !s.lastJump) return undefined
    const label = FLAMESTRIDER_MOVES[action.kind]
    return label
      ? { key: 'flamestrider', label, mode: 'Flamestrider' }
      : undefined
  },
  act(ctx, s: MavuikaState, action, previous) {
    const cons = ctx.constellation('Mavuika')
    s.cons = cons
    settle(s, ctx.now, cons)
    consUpdate(ctx, s)
    const flame = s.bike && s.blessing
    s.lastJump = action.kind === 'jump'
    // Any non-charged action exits ChargeAttackState and cancels an unreached finisher (gcsim OnRemoved).
    const prevChargeCancelDash = s.canChargeCancelDash
    if (action.kind !== 'charged') {
      s.chargeToken++
      s.canChargeCancelDash = false
    }
    switch (action.kind) {
      case 'normal': {
        const count = action.count ?? 1
        if (flame) {
          s.lastNormal = undefined
          return normalString(
            bikeNormals,
            count,
            (i, d) => {
              hitAt(ctx, s, d, {
                path: ['skill', `normal${i + 1}Dmg`],
                tag: 'normal',
                element: 'pyro',
                applies: true,
                icd: 'MavuikaFlamestrider',
                nightsoul: true,
                label: `Flamestrider N${i + 1}`,
              })
              // (each Flamestrider hit costs 1 Nightsoul point)
              ctx.at(d, (c2) => consume(c2, s, 1))
            },
            ctx
          )
        }
        s.lastNormal = Math.min(count, ringNormals.length) - 1
        return normalString(
          ringNormals,
          count,
          (i, d) =>
            hitAt(ctx, s, d, {
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
      case 'charged': {
        s.lastNormal = undefined
        if (flame) {
          const recastLeft = s.recastCdEnd - ctx.now
          const skipped = ['normal', 'charged', 'dash', 'burst'].includes(
            previous?.kind ?? ''
          )
            ? 15
            : previous?.kind === 'skill' && recastLeft > 0
              ? recastLeft > 45
                ? 13
                : 15
              : previous?.kind === 'plunge'
                ? 13
                : 0
          const timing = bikeChargeTiming(ctx.target, skipped)
          if (!timing)
            return {
              frames: 0,
              failed:
                'Mavuika: the target is outside the Flamestrider spin hitbox.',
            }
          const token = ++s.chargeToken
          // (held for `spins` revolutions, KQM's "C3F": a cyclic hit each, 45 frames apart as
          // gcsim's bikeChargeAttackSpinFrames, the finisher after the last one)
          const spins = Math.max(1, action.spins ?? 1)
          const held = (spins - 1) * BIKE_SPIN
          const final = timing.final + held
          // gcsim cdcLockout: while actively spinning (not after a Finisher), CDC is locked out
          // on raw frames 79..87 + 45k (e.g. C2D at raw 80 is locked out; CD at 35 and C3FD are not).
          const rawCancel = timing.hit + held + skipped
          s.canChargeCancelDash =
            !!action.final ||
            !(rawCancel >= 79 && (rawCancel - 79) % BIKE_SPIN <= 8)
          consume(ctx, s, (0.2 / 6) * Math.max(0, final - 45))
          for (let spin = 0; spin < spins; spin++)
            hitAt(ctx, s, timing.hit + spin * BIKE_SPIN, {
              path: ['skill', 'chargedCyclicDmg'],
              tag: 'charged',
              element: 'pyro',
              nightsoul: true,
              applies: true,
              icd: 'MavuikaFlamestrider',
              label: 'Flamestrider Charged Attack (Cyclic)',
            })
          ctx.at(final, (c) => {
            if (token !== s.chargeToken || c.onField !== 'Mavuika' || !s.bike)
              return
            hitAt(c, s, 0, {
              path: ['skill', 'chargedFinalDmg'],
              tag: 'charged',
              element: 'pyro',
              nightsoul: true,
              applies: true,
              icd: 'MavuikaFlamestrider',
              blunt: true,
              poiseDamage: 120,
              label: 'Flamestrider Charged Attack (Final)',
            })
            c.hit(0, {
              path: ['_marker', 'hitlag'],
              tag: 'other',
              element: 'physical',
              animationPause: 3,
              label: 'Flamestrider finisher hitlag',
            })
          })
          // (the next action cancels the finisher at the last spin's hit, unless it is waited for
          // ("F"): then it comes as gcsim's finisher frames allow, the dash at its hit)
          const cancel = action.final ? final : timing.hit + held
          return {
            frames: timing.normal + held,
            framesInto: {
              normal: timing.normal + held,
              charged: cancel,
              skill: cancel,
              burst: cancel,
              dash: cancel,
              jump: cancel,
              swap: cancel,
              wait: cancel,
            },
          }
        }
        hitAt(ctx, s, 79, {
          path: ['charged', 'finalDmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack',
        })
        // the hit pauses her 13 frames (0.15 s halt + the 3.6-frame defense halt); a following
        // wait starts at the hit (gcsim's CanQueueAfter)
        return withHitlag(
          {
            frames: 99,
            framesInto: {
              normal: 98,
              charged: 98,
              skill: 98,
              dash: 79,
              jump: 79,
              wait: 79,
            },
          },
          { hitmarks: [79], hitlag: [13] }
        )
      }
      case 'skill': {
        s.lastNormal = undefined
        // Skill recast (gcsim skill[recast=1]): switches Ring <-> Flamestrider during Nightsoul's
        // Blessing while E is on its 15 s cooldown (60-frame recast CD, no hit or particles).
        if (
          !action.hold &&
          s.blessing &&
          ctx.cooldownReadyAt('skill') > ctx.now
        ) {
          s.recastCdEnd = ctx.now + SKILL_RECAST_CD
          const recastCooldown = {
            key: 'skillRecast',
            frames: SKILL_RECAST_CD,
          }
          if (!s.bike) {
            enterBike(ctx, s)
            consUpdate(ctx, s)
            return {
              cooldown: recastCooldown,
              frames: 24,
              framesInto: {
                normal: 13,
                charged: 13,
                skill: 13,
                burst: 13,
                dash: 12,
                jump: 13,
                swap: 24,
              },
            }
          }
          enterRing(ctx, s)
          consUpdate(ctx, s)
          return {
            cooldown: recastCooldown,
            frames: 38,
            framesInto: {
              normal: 27,
              charged: 28,
              skill: 28,
              burst: 28,
              dash: 37,
              jump: 38,
              swap: 24,
            },
          }
        }
        const cooldown = { key: 'skill', frames: 15 * 60, delay: 18 }
        s.skillReadyAt = ctx.now + 18 + 15 * 60
        ctx.at(19, (c2) => {
          s.skillReadyAt = c2.cooldownReadyAt('skill')
        })
        particleMarker(ctx, 16, 'The Named Moment particles')
        const skillHit: MavHit = {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          icd: 'none',
          nightsoul: true,
          label: flame ? 'The Named Moment (Flamestrider)' : 'The Named Moment',
        }
        if (flame) {
          // in Flamestrider form, E refreshes the form (press or hold)
          hitAt(ctx, s, 16, skillHit)
          gainPoints(ctx, s, maxPoints(cons))
          s.recastCdEnd = ctx.now + SKILL_RECAST_CD
          ctx.setCooldown('skillRecast', SKILL_RECAST_CD)
          return {
            cooldown,
            frames: 39,
            framesInto: {
              normal: 27,
              charged: 27,
              burst: 27,
              dash: 25,
              jump: 27,
              swap: 24,
            },
          }
        }
        if (action.hold) {
          enterBike(ctx, s)
          hitAt(ctx, s, 16, skillHit)
          gainPoints(ctx, s, maxPoints(cons))
          consUpdate(ctx, s)
          s.recastCdEnd = ctx.now + 24 + SKILL_RECAST_CD
          ctx.at(24, (c2) => c2.setCooldown('skillRecast', SKILL_RECAST_CD))
          return {
            cooldown,
            frames: 43,
            framesInto: { dash: 42, jump: 42, swap: 34 },
          }
        }
        enterRing(ctx, s)
        hitAt(ctx, s, 16, skillHit)
        gainPoints(ctx, s, maxPoints(cons))
        consUpdate(ctx, s)
        return {
          cooldown,
          frames: 28,
          framesInto: {
            normal: 18,
            charged: 19,
            skill: 19,
            burst: 18,
            swap: 24,
          },
        }
      }
      case 'burst': {
        s.lastNormal = undefined
        if (s.spirit < BURST_SPIRIT)
          return {
            frames: 0,
            failed: `Mavuika: not enough Fighting Spirit (${Math.floor(s.spirit)}/${BURST_SPIRIT})`,
          }
        s.burstStacks = s.spirit
        s.spirit = 0
        s.burstStart = ctx.now + BURST_BUFF_START
        // (gcsim's Crucible status is a hitlag one: 7 s of her own clock, which her hitlag pauses,
        // so its end is set when her clock gets there)
        s.burstEnd = Number.MAX_SAFE_INTEGER
        const crucible = ++s.burstToken
        ctx.atCharacter('Mavuika', BURST_BUFF_START + BURST_BUFF, (c) => {
          if (s.burstToken !== crucible) return
          settle(s, c.now, c.constellation('Mavuika'))
          s.burstEnd = Math.min(s.burstEnd, c.now)
        })
        // A4 buffs the active party member for 20 seconds, independently of the
        // seven-second Crucible window that adds flat damage to Mavuika's attacks.
        // (states, so a burst within 20 s of the last one replaces its buff instead of overlapping)
        const a4 = ++s.a4Token
        const spirit = burstState(s.burstStacks)
        for (let second = 0; second <= 20; second++)
          ctx.at(BURST_BUFF_START + second * 60, (c2) => {
            if (s.a4Token !== a4) return
            const on = second < 20
            c2.state('Mavuika', ['Mavuika', 'a4Spirit'], on ? spirit : '')
            c2.state(
              'Mavuika',
              ['Mavuika', 'a4TimeSinceBurst'],
              on ? String(second) : ''
            )
          })
        enterBike(ctx, s)
        ctx.at(87, (c2) => gainPoints(c2, s, 10))
        hitAt(ctx, s, 106, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'pyro',
          applies: true,
          durability: 25,
          icd: 'none',
          nightsoul: true,
          label: 'Sunfell Slice',
        })
        return {
          cooldown: { key: 'burst', frames: 18 * 60 },
          frames: 141,
          framesInto: {
            normal: 116,
            charged: 116,
            skill: 116,
            dash: 116,
            jump: 116,
            swap: 116,
          },
        }
      }
      case 'plunge': {
        s.lastNormal = undefined
        if (flame && previous?.kind === 'jump') {
          // Flamestrider plunge (after its jump): the impact
          hitAt(ctx, s, 41, {
            path: ['skill', 'plungeDmg'],
            tag: 'plunge',
            element: 'pyro',
            applies: true,
            icd: 'MavuikaFlamestrider',
            nightsoul: true,
            label: 'Flamestrider Plunge (impact)',
          })
          return {
            frames: 77,
            framesInto: {
              normal: 60,
              charged: 60,
              skill: 41,
              burst: 61,
              dash: 41,
              jump: 76,
              swap: 75,
            },
          }
        }
        hitAt(ctx, s, 37, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 80,
          framesInto: {
            normal: 51,
            charged: 52,
            skill: 37,
            burst: 51,
            dash: 37,
            swap: 62,
          },
        }
      }
      case 'dash': {
        s.lastNormal = undefined
        if (flame) {
          // Flamestrider Sprint: a hit 6 frames in, and 10 Nightsoul points.
          // Following a Flamestrider Charged Attack (outside CDC lockout), dashing into CA can
          // early charge-cancel at frame 6 (gcsim dash[charge_cancel=1]).
          const chargeCancel =
            previous?.kind === 'charged' && prevChargeCancelDash
          hitAt(ctx, s, 6, {
            path: ['skill', 'sprintDmg'],
            tag: 'other',
            element: 'pyro',
            applies: true,
            icd: 'MavuikaFlamestrider',
            nightsoul: true,
            label: 'Flamestrider Sprint',
          })
          consume(ctx, s, 10)
          return {
            frames: 24,
            framesInto: {
              charged: chargeCancel ? 6 : 20,
              normal: 18,
              skill: 20,
              burst: 20,
              jump: 6,
              swap: 6,
            },
          }
        }
        // (Ring form: the Lady dash)
        return { frames: 22, framesInto: { jump: 3 } }
      }
      case 'jump':
        s.lastNormal = undefined
        // Flamestrider jump (its plunge is available after it); Ring form: the Lady jump
        // (gcsim's bikeJumpFrames: 42, its low plunge at 16)
        if (flame) return { frames: 42, framesInto: { plunge: 16 } }
        return templateJump('lady', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: MavuikaState, hit) {
    const cons = ctx.constellation('Mavuika')
    s.cons = cons
    settle(s, hit.t, cons)
    // Fighting Spirit: any member's normal attack hit gives 1.5 (0.1 s ICD)
    if (hit.tag === 'normal' && hit.t >= s.naIcd) {
      s.naIcd = hit.t + 6
      s.spirit = Math.min(MAX_SPIRIT, s.spirit + 1.5 * spiritMul(cons))
      s.lastGain = hit.t
    }
    consUpdate(ctx, s)
  },
  onSwapOut(ctx, s: MavuikaState) {
    // a swap ends the burst's buff, cancels any pending CA finisher, and resets her last normal
    const cons = ctx.constellation('Mavuika')
    s.cons = cons
    settle(s, ctx.now, cons)
    s.lastNormal = undefined
    s.chargeToken++
    s.canChargeCancelDash = false
    s.burstEnd = Math.min(s.burstEnd, ctx.now)
    s.burstStart = Math.min(s.burstStart, s.burstEnd)
    // leaving the field on the Flamestrider turns it back into the Ring (gcsim's onExitField:
    // exitBike), which then follows the active member
    if (s.bike && s.blessing) enterRing(ctx, s)
    consUpdate(ctx, s)
  },
}
