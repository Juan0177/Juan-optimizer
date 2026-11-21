import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  shieldMarker,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/beidou, main as of 2026-11-10. */

// Hitmarks are damage frames (no travel). Cancels: into a skill, burst, dash, jump or swap at the
// hitmark, into a normal or charged attack at the end of the animation.
const beidouNormals: NormalHit[] = [
  {
    hitmarks: [23],
    hitlag: [9],
    toNormal: 31,
    toCharged: 31,
    toAbil: 23,
    frames: 31,
  },
  {
    hitmarks: [22],
    hitlag: [11],
    toNormal: 36,
    toCharged: 36,
    toAbil: 22,
    frames: 36,
  },
  {
    hitmarks: [45],
    hitlag: [9],
    toNormal: 54,
    toCharged: 54,
    toAbil: 45,
    frames: 54,
  },
  {
    hitmarks: [25],
    hitlag: [9],
    toNormal: 36,
    toCharged: 36,
    toAbil: 25,
    frames: 36,
  },
  {
    hitmarks: [43],
    hitlag: [11],
    toNormal: 96,
    toCharged: 96,
    toAbil: 43,
    frames: 96,
  },
]

/** Stormbreaker lasts 15 s from the burst */
const stormbreakerFrames = 900

/**
 * Polaris (Revelation): a held Tidecaller gains a stack every 0.8 s even when not attacked (the
 * game files' Charge_Timer raises the hit's CounterStage, so its DMG Bonus and particles). "hE"
 * holds for 2 stacks (the maximum DMG Bonus), "hE[stacks=1]" for 1. Neither gcsim nor the pinned
 * kqmsim models the hold (their counter is taken at the tap's timing), so the hold before the
 * tap's release timeline is 48 frames a stack.
 */
const POLARIS_STACK = 48
const MAX_STACKS = 2

interface BeidouState {
  /** Stormbreaker is up until this frame */
  burstEnd: number
  /** The bounce chain's 60-frame ICD: no new chain before this frame */
  icdEnd: number
  /** Polaris' CD reduction (once per 15 s) is ready again at this frame */
  polarisReady: number
  /** The burst's cast (its discharges' snapshot) */
  castSnapshot?: { t: number; onField: SimContext['onField'] }
}

export const kit: KitModel = {
  characterKey: 'Beidou',
  element: 'electro',
  source: `${GCSIM}/beidou`,
  init: (): BeidouState => ({
    burstEnd: -1,
    icdEnd: -1e9,
    polarisReady: -1e9,
  }),
  onStart(ctx) {
    // Revelation is unlocked (gcsim's default): Polaris and C6's Stellar-Conduct radiance
    ctx.state('Beidou', ['Beidou', 'lockRevelation'], 'on')
  },
  act(ctx, s: BeidouState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          beidouNormals,
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
      case 'charged':
        // gcsim has no Beidou charged attack (its template errors): no damage, no frames
        ctx.note('Beidou: the charged attack is not in gcsim; not modelled')
        return { frames: 30 }
      case 'skill': {
        // Tap: the base hit. Hold (Polaris): a stack each 0.8 s, then the same release
        const stacks = action.hold
          ? Math.min(action.stacks ?? MAX_STACKS, MAX_STACKS)
          : 0
        const hold = stacks * POLARIS_STACK
        const hitmark = hold + 23
        // Tidecaller's shield on Beidou from the cast until the hitmark (kqmsim)
        shieldMarker(ctx, 0, hitmark, 'Tidecaller shield', {
          target: 'Beidou',
          kind: 'BeidouThunderShield',
        })
        ctx.hit(hitmark, {
          path: ['skill', ['baseDmg', 'dmgOneHit', 'dmgTwoHits'][stacks]],
          tag: 'skill',
          element: 'electro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: stacks
            ? `Tidecaller (${stacks} stack${stacks > 1 ? 's' : ''})`
            : 'Tidecaller',
        })
        // The blunt hit's pause: 0.09 s (0.15 s at the maximum bonus) plus the defense halt
        const pause = stacks === MAX_STACKS ? 13 : 9
        ctx.hit(hitmark, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: pause,
          label: 'Tidecaller hitlag',
        })
        if (stacks === MAX_STACKS) {
          // A4 (Lightning Storm): released with the maximum DMG Bonus, Normal and Charged
          // Attacks get +15% DMG and ATK SPD for 10 s (the game files: from the release)
          ctx.buff('Beidou', ['Beidou', 'Ascension4'], 'on', hold, 600, {
            hitlag: 'recipient',
          })
          ctx.at(hold, (c) => c.modifyAttackSpeed('BeidouA4', 0.15, 600))
        }
        if (stacks)
          // Polaris: on hit, each stack cuts the skill CD by 4 s and restores 8 flat Energy (once
          // per 15 s; the Energy is the ER calculator's, from this marker)
          ctx.at(hitmark, (c) => {
            if (c.now < s.polarisReady) return
            s.polarisReady = c.now + 900
            c.reduceCooldown('skill', stacks * 240)
            c.hit(0, {
              path: ['_marker', 'flatEnergy', `${8 * stacks}`],
              tag: 'other',
              element: 'electro',
              label: 'Polaris',
            })
          })
        ctx.note(
          'Beidou: A1 (perfect counter) and C4 (being hit) need enemy attacks; not modelled'
        )
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 450, delay: hold + 4 },
            frames: hold + 45,
            framesInto: {
              normal: hold + 44,
              dash: hold + 24,
              jump: hold + 24,
              swap: hold + 44,
            },
          },
          { hitmarks: [hitmark], hitlag: [pause] }
        )
      }
      case 'burst':
        ctx.hit(28, {
          path: ['burst', 'burstDmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          durability: 100,
          label: 'Stormbreaker',
        })
        // the initial hit's pause (0.1 s, no defense halt)
        ctx.hit(28, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 6,
          label: 'Stormbreaker hitlag',
        })
        s.burstEnd = ctx.now + stormbreakerFrames
        // C1: a party shield at the cast, for Stormbreaker's 15 s
        if (ctx.constellation('Beidou') >= 1)
          shieldMarker(ctx, 0, stormbreakerFrames, 'Stormbreaker shield (C1)', {
            kind: 'BeidouC1',
          })
        // The discharges use the stats at the cast (gcsim snapshots them then)
        s.castSnapshot = { t: ctx.now, onField: ctx.onField }
        // the sheet's burst condition (C6's RES shred): gcsim applies it every 0.5 s from 30
        // frames, each for 1.5 s, so from 30 frames to 1.5 s past the last
        ctx.buff(
          'Beidou',
          ['Beidou', 'burst'],
          'on',
          30,
          stormbreakerFrames + 60
        )
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 1200 },
            frames: 58,
            framesInto: { normal: 55, dash: 48, jump: 48, swap: 46 },
          },
          { hitmarks: [28], hitlag: [6] }
        )
      case 'plunge':
        // not in gcsim (no plunge frames): not modelled
        ctx.note('Beidou: the plunge is not in gcsim; not modelled')
        return { frames: 30 }
      case 'dash':
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('lady', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: BeidouState, hit) {
    // C6 (Revelation): Stellar-Conduct radiance inside a Polestar Field
    ctx.state(
      'Beidou',
      ['Beidou', 'lockStellarRadianceSc'],
      ctx.radiance === 'conduct' ? 'on' : ''
    )
    // Stormbreaker: a Normal or Charged Attack hit by the character on the field starts a chain
    if (hit.characterKey !== hit.onField) return
    if (hit.tag !== 'normal' && hit.tag !== 'charged') return
    if (hit.t >= s.burstEnd || hit.t < s.icdEnd) return
    s.icdEnd = hit.t + 60
    // This simulator has one enemy. The chain needs a DIFFERENT enemy for each bounce
    // (kqmsim burst.go); C2 does not multiply damage against a lone target.
    ctx.hit(1, {
      characterKey: 'Beidou',
      path: ['burst', 'lightningDmg'],
      tag: 'burst',
      element: 'electro',
      applies: true,
      durability: 25,
      icd: 'burst',
      label: 'Stormbreaker (single target)',
      statSnapshots: s.castSnapshot
        ? (
            [
              'atk',
              'critRate_',
              'critDMG_',
              'all_dmg_',
              'burst_dmg_',
              'electro_dmg_',
            ] as const
          ).map((stat) => ({
            stat,
            path: ['total', stat],
            ...s.castSnapshot!,
          }))
        : undefined,
    })
  },
}
