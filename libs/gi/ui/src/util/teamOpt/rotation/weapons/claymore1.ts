import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { energyCalcData } from '../../energyCalc'
import type { SimContext, SimHit } from '../types'
import type { WeaponHandlers, WeaponModule } from '../weaponEffects'

/** A damage hit (not a marker, nor a reaction's own damage) */
const isDamage = (hit: SimHit) =>
  !hit.path[0].startsWith('_') && hit.path[0] !== 'reaction'

/**
 * The wielder's own buff for `duration` frames from now on its own clock (hitlag-extended, as
 * kqmsim's weapon statuses), for the effects whose triggers the engine's forms can't express
 */
const selfBuff = (
  ctx: SimContext,
  k: CharacterKey,
  path: string[],
  duration: number
) => ctx.buff(k, path, 'on', 0, duration, { recipient: k, hitlag: 'recipient' })

/** The reactions that give Flame-Forged Insight its EM (the simulation's reaction marks) */
const FFI_REACTIONS = [
  'electroCharged',
  'lunarCharged',
  'bloom',
  'lunarBloom',
  'crystallize',
  'lunarCrystallize',
]

/**
 * A 7.3 beta claymore's "Royal Decree" (from the game's text, no reference sim): 'decree' for
 * 15 s after the wielder's Electro hits (off the field too), 'complete' from its Stellar-Conduct
 * hit while the decree is up until the decree ends (assumed kept when an Electro hit refreshes it)
 */
function royalDecree(weapon: string): WeaponModule {
  return {
    weapon,
    custom: ({ members, holds, window }): WeaponHandlers => {
      const path = [weapon, 'royalDecree']
      const live = new Map<
        CharacterKey,
        { start: number; end: number; completeAt?: number }
      >()
      const close = (
        k: CharacterKey,
        d: { start: number; end: number; completeAt?: number },
        t: number
      ) => {
        live.delete(k)
        const end = Math.min(d.end, t)
        const split = Math.min(d.completeAt ?? end, end)
        if (split > d.start) window(k, path, 'decree', d.start, split)
        if (end > split) window(k, path, 'complete', split, end)
      }
      return {
        declare() {
          for (const k of members) if (holds(k)) window(k, path, 'decree', 0, 0)
        },
        onHit(_ctx, hit) {
          const k = hit.characterKey
          if (!holds(k) || !isDamage(hit)) return
          let d = live.get(k)
          if (d && hit.t >= d.end) {
            close(k, d, d.end)
            d = undefined
          }
          if (
            d &&
            d.completeAt === undefined &&
            hit.tag === 'directStellarConduct'
          )
            d.completeAt = hit.t
          if (hit.element !== 'electro') return
          if (d) d.end = hit.t + 900
          else live.set(k, { start: hit.t, end: hit.t + 900 })
        },
        end(t) {
          for (const [k, d] of [...live]) close(k, d, t)
        },
      }
    },
  }
}

/** Beta weapons, one complete entry per line (the released-only build drops these lines) */
const BETA: Record<string, WeaponModule> = {
  TorrentsOfSpring: royalDecree('TorrentsOfSpring'),
}

/** Weapon audit batch claymore1 (2026-11-16), as kqmsim and the game's text */
export const claymore1: WeaponModule[] = [
  {
    // A Teaspoon of Transcendence (kqmsim ateaspoonoftranscendence.go): a Transcendence stack per
    // Charged hit, once per 0.2 s, all of them refreshed to 5 s, at most 3
    weapon: 'ATeaspoonOfTranscendence',
    timed: [
      {
        cond: 'passive',
        on: [{ kind: 'hit', tags: ['charged'] }],
        duration: 300,
        icd: 12,
        stacks: { max: 3, refresh: 'all' },
      },
    ],
  },
  {
    // Fang of the Mountain King (kqmsim fangofthemountainking.go): Canopy's Favor, 6 s stacks
    // counted independently (at most 6): one per Skill hit on the field (once per 0.5 s), three
    // when any member starts Burning or triggers Burgeon (once per 2 s, off the field too)
    weapon: 'FangOfTheMountainKing',
    timed: [
      {
        cond: 'stacks',
        on: [{ kind: 'hit', tags: ['skill'], field: 'on' }],
        duration: 360,
        icd: 30,
        stacks: { max: 6, refresh: 'each' },
        delay: 1,
      },
    ],
    custom: ({ members, holds, ready }) => ({
      onHit(ctx, hit) {
        const [kind, reaction] = hit.path
        if (
          !(kind === '_reaction' && reaction === 'burning') &&
          !(kind === 'reaction' && reaction === 'burgeon')
        )
          return
        for (const k of members)
          if (
            holds(k) &&
            ready(
              `FangOfTheMountainKing.react.${k}`,
              ctx.characterFrame(k),
              120
            )
          )
            for (let i = 0; i < 3; i++)
              ctx.buff(k, ['FangOfTheMountainKing', 'stacks'], '1', 1, 360, {
                max: 6,
              })
      },
    }),
  },
  {
    // Skyward Pride (kqmsim skyward.go): for 20 s after the wielder's Burst on the field, its
    // Normal and Charged hits each make a vacuum blade (80–160% ATK Physical) 1 frame later, at
    // most 8
    weapon: 'SkywardPride',
    custom: ({ wears, onFieldAt }) => {
      const blades = new Map<CharacterKey, { until: number; left: number }>()
      return {
        onAction(ctx, actor, action) {
          if (
            action.kind === 'burst' &&
            wears(actor) &&
            onFieldAt(ctx.now) === actor
          )
            blades.set(actor, { until: ctx.now + 1200, left: 8 })
        },
        onHit(ctx, hit) {
          const b = blades.get(hit.characterKey)
          if (!b || b.left <= 0 || hit.t >= b.until || !isDamage(hit)) return
          if (hit.tag !== 'normal' && hit.tag !== 'charged') return
          b.left--
          ctx.hit(1, {
            characterKey: hit.characterKey,
            path: ['weapon:SkywardPride', 'dmg'],
            tag: 'other',
            element: 'physical',
            applies: false,
            label: 'Skyward Pride',
          })
        },
      }
    },
  },
  {
    // Akuoumaru (kqmsim common/wavebreaker.go): Burst DMG from the party's combined max Energy,
    // fixed at the start (the sheet's state: steps of 10 from 40 to 350, as the KQM rule counts it)
    weapon: 'Akuoumaru',
    custom: ({ members, holds, window }) => ({
      end(t) {
        const energy = members.reduce(
          (n, m) => n + (energyCalcData[m]?.burstCost ?? 0),
          0
        )
        const state = `${Math.min(350, Math.max(40, Math.floor(energy / 10) * 10))}`
        for (const k of members)
          if (holds(k))
            window(k, ['Akuoumaru', 'WatatsumiWavewalker'], state, 0, t)
      },
    }),
  },
  {
    // Blazing Lionfang (the game's text, no reference sim): Reforged Blade after 5 s off the field
    // in total, lost after 10 s on it in total; while it is up, taking the field deals 280–560%
    // ATK, once per 14 s (dealt as the wielder's first action after the swap starts)
    weapon: 'BlazingLionfang',
    custom: ({ members, holds, wears, window, ready, onFieldAt }) => {
      const path = ['BlazingLionfang', 'reforgedBlade']
      type State = {
        field: boolean
        since: number
        off: number
        on: number
        activeSince?: number
      }
      const states = new Map<CharacterKey, State>()
      for (const k of members)
        if (holds(k))
          states.set(k, { field: k === onFieldAt(0), since: 0, off: 0, on: 0 })
      /** Count the time since the last change (off or on the field) up to `t` */
      const advance = (k: CharacterKey, s: State, t: number) => {
        const span = t - s.since
        if (span > 0 && !s.field && s.activeSince === undefined) {
          if (s.off + span >= 300) {
            s.activeSince = s.since + 300 - s.off
            s.off = 0
            s.on = 0
          } else s.off += span
        } else if (span > 0 && s.field && s.activeSince !== undefined) {
          if (s.on + span >= 600) {
            window(k, path, 'on', s.activeSince, s.since + 600 - s.on)
            s.activeSince = undefined
            s.off = 0
            s.on = 0
          } else s.on += span
        }
        s.since = t
      }
      const switchIn = new Map<CharacterKey, number>()
      return {
        declare() {
          for (const k of states.keys()) window(k, path, 'on', 0, 0)
        },
        onSwap(t, _from, to) {
          for (const [k, s] of states) {
            advance(k, s, t)
            s.field = k === to
          }
          const s = states.get(to)
          if (
            s?.activeSince !== undefined &&
            wears(to) &&
            ready(`BlazingLionfang.switchIn.${to}`, t, 840)
          )
            switchIn.set(to, t)
        },
        onAction(ctx, actor) {
          const at = switchIn.get(actor)
          if (at === undefined) return
          switchIn.delete(actor)
          ctx.hit(Math.max(0, at - ctx.now), {
            characterKey: actor,
            path: ['weapon:BlazingLionfang', 'switchInDmg'],
            tag: 'other',
            element: 'physical',
            applies: false,
            label: 'Blazing Lionfang',
          })
        },
        end(t) {
          for (const [k, s] of states) {
            advance(k, s, t)
            if (s.activeSince !== undefined && t > s.activeSince)
              window(k, path, 'on', s.activeSince, t)
          }
        },
      }
    },
  },
  {
    // Flame-Forged Insight (kqmsim flameforgedinsight.go): EM for 15 s after the wielder's own
    // Electro-Charged, Lunar-Charged, Bloom, Lunar-Bloom, Crystallize or Lunar-Crystallize (off the
    // field too), once per 15 s
    weapon: 'FlameForgedInsight',
    custom: ({ members, holds, window, ready }) => {
      const path = ['FlameForgedInsight', 'passive']
      return {
        declare() {
          for (const k of members) if (holds(k)) window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            hit.path[0] === '_reaction' &&
            FFI_REACTIONS.includes(hit.path[1] ?? '') &&
            holds(k) &&
            ready(`FlameForgedInsight.${k}`, ctx.characterFrame(k), 900)
          )
            selfBuff(ctx, k, path, 900)
        },
      }
    },
  },
  {
    // Fruitful Hook (kqmsim fruitfulhook.go): Normal, Charged and Plunging DMG for 10 s after the
    // wielder's Plunging hit, from the next hit on
    weapon: 'FruitfulHook',
    timed: [
      {
        cond: 'afterPlunging',
        on: [{ kind: 'hit', tags: ['plunge'] }],
        duration: 600,
        delay: 1,
      },
    ],
  },
  {
    // Luxurious Sea-Lord (kqmsim sealord.go): the wielder's Burst hit on the field summons tuna
    // (100–200% ATK Physical) 1 frame later, once per 15 s
    weapon: 'LuxuriousSeaLord',
    procs: [
      {
        node: 'dmg',
        label: 'Luxurious Sea-Lord',
        on: [{ kind: 'hit', tags: ['burst'], field: 'on' }],
        icd: 900,
        delay: 1,
      },
    ],
  },
  {
    // Master Key (kqmsim masterkey.go): EM for 12 s after any reaction the wielder triggers (off
    // the field too), refreshed by each (Moondrift is not a reaction)
    weapon: 'MasterKey',
    custom: ({ members, holds, window }) => {
      const path = ['MasterKey', 'afterReaction']
      return {
        declare() {
          for (const k of members) if (holds(k)) window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const [kind, reaction = ''] = hit.path
          const reacted =
            (kind === '_reaction' &&
              reaction !== 'moondrift' &&
              reaction !== 'moondriftHarmony') ||
            (kind === 'reaction' &&
              (reaction === 'hyperbloom' || reaction === 'burgeon'))
          if (reacted && holds(hit.characterKey))
            selfBuff(ctx, hit.characterKey, path, 720)
        },
      }
    },
  },
  {
    // Serpent Spine (kqmsim spine.go): a stack per 4 s tick while the wielder is on the field,
    // kept off it, lost only to DMG taken (none here): at its 5 for the run (repeated rotations)
    // once a tick finds the wielder on the field, none for a wielder never on the field at a tick
    weapon: 'SerpentSpine',
    custom: ({ members, holds, window, onFieldAt }) => {
      const path = ['SerpentSpine', 'Wavesplitter']
      return {
        declare() {
          for (const k of members) if (holds(k)) window(k, path, '5', 0, 0)
        },
        end(t) {
          for (const k of members) {
            if (!holds(k)) continue
            let ticked = false
            for (let f = 240; f < t && !ticked; f += 240)
              ticked = onFieldAt(f) === k
            if (ticked) window(k, path, '5', 0, t)
          }
        },
      }
    },
  },
  {
    // Whiteblind (kqmsim whiteblind.go): a stack per Normal or Charged hit on the field, once per
    // 0.5 s, all of them refreshed to 6 s, at most 4, from the next hit on
    weapon: 'Whiteblind',
    timed: [
      {
        cond: 'stack',
        on: [{ kind: 'hit', tags: ['normal', 'charged'], field: 'on' }],
        duration: 360,
        icd: 30,
        stacks: { max: 4, refresh: 'all' },
        delay: 1,
      },
    ],
  },
  ...Object.values(BETA),
]
