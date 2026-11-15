import type { KitModel, SimContext } from '../types'
import { KQMSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/sandrone. Her timing
 * follows gcsim's later official version (genshinsim/gcsim b107b5d, #3269): a charge is released
 * after the most condensed beams it can fire (3, 6 with C1) rather than held until Decoding Power
 * is full; the Skill repairs Fagio while she hovers (70 as she casts, then 10 every 0.1 s); normal
 * attacks into a charge take their whole animation; the Prism Shots land at 34 frames. */

/*
 * Constellations (kqmsim cons.go, checked against the game text): C1 halves Decoding Power gain
 * and gives the party +30% Stellar Glimmer DMG while Fagio is in Decoding mode; C2 (in Stellar
 * Glimmer radiance) +40% CRIT DMG on condensed beams, +20% per beam fired in that Decoding
 * period (3 stacks); C4 a coordinated Prismatic Resonance Cannon when she deals Stellar DMG
 * (once per 4 s); C6 Condensed Cluster Beams from the 3rd beam on (5 frames after each beam)
 * and +20% elevation (sheet). Power Overdrive charged attacks fire every 24 frames until
 * Decoding Power falls under 50 (the pinned kqmsim fires a single shot and cannot start from an
 * idle Overdrive: its intended timing is used).
 */

const sandroneNormals: NormalHit[] = [
  {
    hitmarks: [24],
    hitlag: [10],
    toNormal: 30,
    toCharged: 53,
    toAbil: 24,
    frames: 38,
  },
  {
    hitmarks: [25],
    hitlag: [10],
    toNormal: 31,
    toCharged: 46,
    toAbil: 25,
    frames: 46,
  },
  {
    hitmarks: [49],
    hitlag: [11],
    toNormal: 69,
    toCharged: 87,
    toAbil: 49,
    frames: 79,
  },
]

/** Sweeping Fire's tick intervals (gcsim's table, repeating) */
const SWEEP_TICKS = [
  24, 18, 25, 15, 18, 24, 18, 18, 22, 18, 18, 24, 18, 18, 24, 18, 18, 24, 18,
  18, 24, 18, 18, 24,
]

const MAX_DECODE = 1000
/** Fagio enters Power Overdrive this many frames after its Decoding Power reaches the maximum */
const OVERDRIVE_DELAY = 19
/**
 * Decoding Power (x10) a charge gains before its Nth beam can still fire in Decoding mode (gcsim's
 * decodeNeededForBeams): N beams need Decoding Power at most 100 minus this at the start
 */
const BEAMS_NEEDED = [0, 128, 458, 788, 1118, 1448, 1778]
/** Beams a charge fires before it is released: 3, or 6 with C1 (its Decoding Power gain is halved) */
const maxBeams = (c1: boolean) => (c1 ? 6 : 3)

/**
 * A Decoding charge, in frames from its first tick (gcsim b107b5d, internal/characters/sandrone/
 * charge.go): heat every 12 frames (+3.2), a condensed beam every 60 (+17), released 1 frame
 * after its last beam, the most beams it can fire before Power Overdrive (3, 6 with C1). If
 * Decoding Power reaches 100 first, Fagio enters Power Overdrive 19 frames later and the charge
 * ends the frame after. `exit` is when the next action can start (its end lag has passed by then).
 * `asked`: the beams written ("CA[beams=2]", gcsim's charge[beams=2]), at most the most it can fire.
 */
export function sandroneChannel(decode: number, c1 = false, asked?: number) {
  const divisor = c1 ? 2 : 1
  let count = 0
  for (let n = 1; n <= Math.min(asked ?? maxBeams(c1), maxBeams(c1)); n++)
    if (decode <= MAX_DECODE - BEAMS_NEEDED[n] / divisor) count = n
  let exit = Number.POSITIVE_INFINITY
  /** Frame Decoding Power reached its maximum */
  let reached = Number.POSITIVE_INFINITY
  const beams: number[] = []
  const sweeps: number[] = []
  const gain = (amount: number, t: number) => {
    decode = Math.min(MAX_DECODE, decode + amount / divisor)
    if (decode >= MAX_DECODE && reached === Number.POSITIVE_INFINITY) {
      reached = t
      exit = Math.min(exit, t + OVERDRIVE_DELAY + 1)
    }
  }
  for (let t = 0; t < exit; t += 12) {
    // (a beam's task was queued before the same frame's heat tick: it lands first)
    if (t > 0 && t % 60 === 0 && t < reached + OVERDRIVE_DELAY) {
      beams.push(t)
      gain(170, t)
      if (beams.length >= count && count > 0) exit = Math.min(exit, t + 1)
    }
    gain(32, t)
  }
  for (let t = 0, i = 0; t < exit; i++) {
    sweeps.push(t)
    t += SWEEP_TICKS[i % SWEEP_TICKS.length]
  }
  return { exit, beams, sweeps, decode, reached }
}

interface SandroneState {
  /** Sandrone was on the field at the last action */
  onField: boolean
  /** Fagio's Decoding Power (x10), settled up to `nextDecay` */
  decode: number
  /** Fagio is in Power Overdrive (from reaching 100 until Decoding Power is under 50) */
  overdrive: boolean
  /** Fagio enters Power Overdrive at this frame if its Decoding Power is still 100 then */
  overdriveAt: number
  /** Sandrone's actions so far (and swaps out): which one is going on */
  action: number
  /** The next Decoding Power decay tick (every 0.5 s: 25, or 75 while Sandrone is off-field) */
  nextDecay: number
  tactics: number
  decreased: number
  /** C4's coordinated attack is ready from (her clock) */
  c4Ready: number
}

/** Decoding Power decays to `now` */
function settleDecode(s: SandroneState, now: number) {
  for (;;) {
    const decay = s.decode > 0 ? s.nextDecay : Number.POSITIVE_INFINITY
    // Power Overdrive begins if Decoding Power is still full then (before a decay tick that frame)
    if (s.overdriveAt <= now && s.overdriveAt <= decay) {
      if (s.decode >= MAX_DECODE) s.overdrive = true
      s.overdriveAt = Number.POSITIVE_INFINITY
      continue
    }
    if (decay > now) return
    const used = Math.min(s.decode, s.onField ? 25 : 75)
    decrease(s, used)
    s.nextDecay += 30
  }
}

function decrease(s: SandroneState, amount: number) {
  const used = Math.min(s.decode, amount)
  s.decode -= used
  // (gcsim's reduceDecode: Power Overdrive ends under 50; under 100 it is no longer coming)
  if (s.decode < MAX_DECODE) s.overdriveAt = Number.POSITIVE_INFINITY
  if (s.decode < 500) s.overdrive = false
  s.decreased += used
  s.tactics = Math.min(10, s.tactics + Math.floor(s.decreased / 100))
  s.decreased %= 100
}
function radianceHit(
  ctx: SimContext,
  base: string,
  group: 'charged' | 'skill' | 'burst',
  label: string,
  states: NonNullable<Parameters<SimContext['hit']>[1]['states']> = []
) {
  const radiance = ctx.radiance
  const node =
    radiance === 'conduct'
      ? `${base}StellarDmg`
      : radiance === 'swirl'
        ? `${base}SsDmg`
        : `${base}Dmg`
  ctx.hit(0, {
    path: [group, node],
    tag:
      radiance === 'conduct'
        ? 'directStellarConduct'
        : radiance === 'swirl'
          ? 'directStellarSwirl'
          : group,
    element: 'cryo',
    applies: !radiance,
    durability: radiance ? 0 : 25,
    icd:
      group === 'charged'
        ? 'SandroneExtraAttackLaser'
        : group === 'burst'
          ? 'burst'
          : 'none',
    label: radiance
      ? `${label} (Stellar-${radiance === 'conduct' ? 'Conduct' : 'Swirl'})`
      : label,
    states: [
      ...states,
      {
        owner: 'Sandrone',
        path: ['Sandrone', 'a0StellarRadianceSc'],
        value: radiance === 'conduct' ? 'on' : radiance === 'swirl' ? 'ss' : '',
      },
    ],
  })
}

export const kit: KitModel = {
  characterKey: 'Sandrone',
  element: 'cryo',
  source: `${KQMSIM}/sandrone`,
  init: (): SandroneState => ({
    onField: false,
    decode: 0,
    overdrive: false,
    overdriveAt: Number.POSITIVE_INFINITY,
    action: 0,
    nextDecay: 0,
    tactics: 0,
    decreased: 0,
    c4Ready: -1,
  }),
  act(ctx, s: SandroneState, action, previous) {
    const c = ctx.constellation('Sandrone')
    // Decay up to now: off-field from the last swap-out, so that interval is at the faster rate
    settleDecode(s, ctx.now)
    const swappedIn = !s.onField
    s.onField = true
    const id = ++s.action
    switch (action.kind) {
      case 'normal':
        return normalString(
          sandroneNormals,
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
      case 'charged': {
        if (s.overdrive) {
          // Power Overdrive (Decoding Power reached 100 and is still 50+): Fagio fires at longer
          // intervals, dealing Cryo DMG, while Decoding Power keeps decreasing; it ends under 50.
          // kqmsim's ticker gives the timing (first shot at the channel's first tick, then every
          // 24 frames, landing 10 frames later) but reschedules the wrong ticker after one shot and
          // cannot start from an idle Overdrive; here the charge is held until Overdrive ends.
          settleDecode(s, ctx.now)
          const odWindup =
            swappedIn ||
            !previous ||
            previous.kind === 'dash' ||
            previous.kind === 'jump'
              ? 25
              : 0
          const first = odWindup + 18
          // decay ticks (25 every 30 frames on field) until Decoding Power is under 500 (x10)
          const ticks = Math.ceil((s.decode - 499) / 25)
          const end = Math.max(first, s.nextDecay - ctx.now + (ticks - 1) * 30)
          for (let t = first; t <= end; t += 24)
            ctx.hit(t + 10, {
              path: ['charged', 'overdriveDmg'],
              tag: 'charged',
              element: 'cryo',
              applies: true,
              icd: 'SandroneSweepingFire',
              label: 'Power Overdrive',
            })
          const odAfter = (e: number) => end + 1 + e
          return {
            frames: odAfter(20),
            framesInto: {
              normal: odAfter(2),
              charged: odAfter(28),
              skill: odAfter(0),
              burst: odAfter(0),
              dash: odAfter(0),
              jump: odAfter(0),
              swap: odAfter(1),
              wait: first,
            },
          }
        }
        const channel = sandroneChannel(s.decode, c >= 1, action.beams)
        if (action.beams && channel.beams.length < action.beams)
          ctx.note(
            action.beams > maxBeams(c >= 1)
              ? `Sandrone: a charge fires ${maxBeams(c >= 1)} beams at most${c >= 1 ? '' : ' before C1'} ("${action.text}" fired ${channel.beams.length}).`
              : `Sandrone: "${action.text}" fired ${channel.beams.length} of ${action.beams} beams: Fagio's Decoding Power was too high for more.`
          )
        // Windup 25f from idle (the start, a dash, a jump or a swap); otherwise in the endlag
        const windup =
          swappedIn ||
          !previous ||
          previous.kind === 'dash' ||
          previous.kind === 'jump'
            ? 25
            : 0
        const t0 = windup + 18 // the first tick
        s.decode = channel.decode
        s.nextDecay = ctx.now + t0 + channel.exit + 30
        // (Power Overdrive 19 frames after Decoding Power reached 100, unless it fell by then)
        s.overdriveAt = ctx.now + t0 + channel.reached + OVERDRIVE_DELAY
        for (const tick of channel.sweeps) {
          const at = t0 + tick
          ctx.hit(at, {
            path: ['charged', 'sweepDmg'],
            tag: 'charged',
            element: 'cryo',
            applies: true,
            icd: 'SandroneSweepingFire',
            label: 'Sweeping Fire',
          })
        }
        // C1: the party's Stellar Glimmer DMG bonus while Fagio is in Decoding mode
        if (c >= 1)
          ctx.buff(
            'Sandrone',
            ['Sandrone', 'c1Decoding'],
            'on',
            t0,
            channel.exit
          )
        for (const [index, tick] of channel.beams.entries()) {
          const k = index + 1
          const beamAt = t0 + tick
          // C2: each beam of this Decoding period adds a stack before it hits (max 3)
          const c2Stacks = [
            {
              owner: 'Sandrone' as const,
              path: ['Sandrone', 'c2Stacks'],
              value: c >= 2 ? `${Math.min(k, 3)}` : '',
            },
          ]
          ctx.at(beamAt, (c2) => {
            radianceHit(c2, 'beam', 'charged', 'Condensed Beam', c2Stacks)
            // C6: from the 3rd beam of a charge, a Condensed Cluster Beam 5 frames later, in the
            // radiance of its beam
            if (c >= 6 && k >= 3) {
              const radiance = c2.radiance
              c2.hit(5, {
                path: [
                  'constellation6',
                  radiance === 'conduct'
                    ? 'dmg2'
                    : radiance === 'swirl'
                      ? 'ssDmg'
                      : 'dmg',
                ],
                tag:
                  radiance === 'conduct'
                    ? 'directStellarConduct'
                    : radiance === 'swirl'
                      ? 'directStellarSwirl'
                      : 'charged',
                element: 'cryo',
                applies: !radiance,
                durability: radiance ? 0 : 25,
                icd: radiance ? 'none' : 'SandroneExtraAttackLaser',
                label: radiance
                  ? `Condensed Cluster Beam (C6, Stellar-${radiance === 'conduct' ? 'Conduct' : 'Swirl'})`
                  : 'Condensed Cluster Beam (C6)',
                states: [
                  ...c2Stacks,
                  {
                    owner: 'Sandrone',
                    path: ['Sandrone', 'a0StellarRadianceSc'],
                    value:
                      radiance === 'conduct'
                        ? 'on'
                        : radiance === 'swirl'
                          ? 'ss'
                          : '',
                  },
                ],
              })
            }
          })
        }
        // Released: every action can start at once (gcsim sets the channel's length to 0, so each
        // end lag has passed by then)
        const end = t0 + channel.exit
        return {
          frames: end,
          framesInto: {
            normal: end,
            charged: end,
            skill: end,
            burst: end,
            dash: end,
            jump: end,
            swap: end,
            // gcsim's CanQueueAfter: a written wait starts with the channel's first tick
            wait: t0,
          },
        }
      }
      case 'skill': {
        // A1: decided as she casts, before the repair below (more than 50 Decoding Power)
        const enhanced = s.decode > 500
        // (gcsim b107b5d: the Prism Shots' task at 19 frames, landing 5 + 10 frames of travel later)
        ctx.at(24, (c2) => {
          c2.hit(10, {
            path: ['skill', 'prismDmg1'],
            tag: 'skill',
            element: 'cryo',
            applies: true,
            icd: 'none',
            label: 'Prism Shot',
          })
          c2.at(10, (c3) => {
            const radiance = c3.radiance
            const node =
              radiance === 'conduct'
                ? 'prismStellarDmg'
                : radiance === 'swirl'
                  ? 'prismSsDmg'
                  : 'prismDmg2'
            c3.hit(0, {
              path: ['skill', node],
              tag:
                radiance === 'conduct'
                  ? 'directStellarConduct'
                  : radiance === 'swirl'
                    ? 'directStellarSwirl'
                    : 'skill',
              element: 'cryo',
              applies: !radiance,
              durability: radiance ? 0 : 25,
              icd: 'none',
              label: radiance
                ? `Prism Shot (Stellar-${radiance === 'conduct' ? 'Conduct' : 'Swirl'})`
                : 'Prism Shot (2nd)',
              states: [
                {
                  owner: 'Sandrone',
                  path: ['Sandrone', 'a0StellarRadianceSc'],
                  value:
                    radiance === 'conduct'
                      ? 'on'
                      : radiance === 'swirl'
                        ? 'ss'
                        : '',
                },
                {
                  owner: 'Sandrone',
                  path: ['Sandrone', 'a1Decoding'],
                  value: enhanced ? 'on' : '',
                },
              ],
            })
          })
        })
        // Fagio repaired while she hovers: 70 Decoding Power as she casts, then 10 every 0.1 s
        // while the Skill goes on (3 times: 100 in all)
        decrease(s, 700)
        for (let i = 1; i <= 3; i++)
          ctx.atCharacter('Sandrone', 6 * i, () => {
            if (s.action === id) decrease(s, 100)
          })
        return {
          cooldown: { key: 'skill', frames: 4 * 60 },
          frames: 46,
          framesInto: { normal: 10, burst: 6, dash: 26, swap: 27 },
        }
      }
      case 'burst': {
        // Bombardment: 3 hits at 123f, 135f and 147f; the Convective Inhibition Ray at 177f
        for (const delay of [123, 135, 147])
          ctx.atCharacter('Sandrone', delay, (at) =>
            at.hit(0, {
              path: ['burst', 'bombardDmg'],
              tag: 'burst',
              element: 'cryo',
              applies: true,
              icd: 'burst',
              label: 'Bombardment',
            })
          )
        ctx.atCharacter('Sandrone', 177, (c2) =>
          radianceHit(c2, 'ray', 'burst', 'Convective Inhibition Ray', [
            {
              owner: 'Sandrone',
              path: ['Sandrone', 'a1Decoding'],
              value: 'on',
            },
            {
              owner: 'Sandrone',
              path: ['Sandrone', 'a1Tactics'],
              value: `${s.tactics}`,
            },
          ])
        )
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 128,
          framesInto: {
            normal: 101,
            skill: 100,
            dash: 103,
            jump: 103,
            swap: 102,
          },
        }
      }
      case 'dash':
        // Girl body: 20f, and 4f into a jump
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // Girl body: 34f after a dash, 31f otherwise
        return templateJump('girl', 'claymore', previous, ctx)
      case 'plunge':
        // gcsim has no plunging attack for Sandrone
        ctx.note(
          'Sandrone: plunging attacks are not modelled (gcsim has none).'
        )
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(ctx, s: SandroneState) {
    settleDecode(s, ctx.now)
    s.onField = false
    s.action++
  },
  // C4: her Stellar-Conduct / Stellar Swirl DMG calls a coordinated Prismatic Resonance Cannon
  // (15 frames later, once per 4 s on her clock), counted as that Stellar Glimmer DMG
  onHit(ctx, s: SandroneState, hit) {
    if (
      hit.characterKey !== 'Sandrone' ||
      (hit.tag !== 'directStellarConduct' &&
        hit.tag !== 'directStellarSwirl') ||
      ctx.constellation('Sandrone') < 4
    )
      return
    // (a gcsim status is still active on its expiry frame: the next one comes after 241 frames)
    const f = ctx.characterFrame('Sandrone')
    if (f <= s.c4Ready) return
    s.c4Ready = f + 240
    const conduct = hit.tag === 'directStellarConduct'
    ctx.hit(15, {
      path: ['constellation4', conduct ? 'dmg' : 'ssDmg'],
      tag: hit.tag,
      element: 'cryo',
      icd: 'none',
      label: `Prismatic Resonance Cannon (C4, Stellar-${conduct ? 'Conduct' : 'Swirl'})`,
      states: [
        {
          owner: 'Sandrone',
          path: ['Sandrone', 'a0StellarRadianceSc'],
          value: conduct ? 'on' : 'ss',
        },
      ],
    })
  },
}
