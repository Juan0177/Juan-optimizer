import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { SimContext, SimHit } from '../types'
import { healedBy, type WeaponApi, type WeaponModule } from '../weaponEffects'

/** A damage hit of the wielder's own (not a marker, not a reaction's own damage) */
const ownDamage = (hit: SimHit, k: CharacterKey) =>
  hit.characterKey === k &&
  !hit.path[0].startsWith('_') &&
  hit.path[0] !== 'reaction'

/** Marks that are no elemental reaction (kqmsim's reaction events run OnOverload … OnShatter) */
const NOT_REACTIONS = new Set(['moondrift', 'moondriftHarmony'])
/**
 * A reaction the wielder triggers, once per reaction as kqmsim's reaction events: the simulation's
 * reaction marks, and Hyperbloom and Burgeon by their damage (they have no mark). A reaction's
 * other damage (a Swirl's hit, Burning's ticks) is no new reaction.
 */
const ownReaction = (hit: SimHit, k: CharacterKey) =>
  hit.characterKey === k &&
  ((hit.path[0] === '_reaction' && !NOT_REACTIONS.has(hit.path[1] ?? '')) ||
    (hit.path[0] === 'reaction' &&
      (hit.path[1] === 'hyperbloom' || hit.path[1] === 'burgeon')))

const SWIRLS = new Set([
  'pyroSwirl',
  'hydroSwirl',
  'electroSwirl',
  'cryoSwirl',
  'stellarSwirl',
])

/**
 * One window per wielder and conditional that each trigger extends while it is up (emitted when it
 * closes): for buffs refreshed by frequent triggers (each reaction, each Skill hit)
 */
function refreshed(window: WeaponApi['window']) {
  const open = new Map<
    string,
    { k: CharacterKey; path: string[]; start: number; end: number }
  >()
  const emit = (
    w: { k: CharacterKey; path: string[]; start: number },
    end: number
  ) => {
    if (end > w.start) window(w.k, w.path, 'on', w.start, end)
  }
  return {
    open(k: CharacterKey, path: string[], start: number, duration: number) {
      const key = `${k}.${path.join('.')}`
      const w = open.get(key)
      if (w && start <= w.end) {
        w.end = Math.max(w.end, start + duration)
        return
      }
      if (w) emit(w, w.end)
      open.set(key, { k, path, start, end: start + duration })
    },
    end(t: number) {
      for (const w of open.values()) emit(w, Math.min(w.end, t))
      open.clear()
    },
  }
}

/** Weapon audit batch catalyst2 (2026-11-16), as kqmsim and the game's text */
export const catalyst2: WeaponModule[] = [
  {
    // Hymn of the Maelstrom (no reference sim; the game's text): a stack per heal the wielder
    // performs (off the field too), 10 s, up to 3, all refreshed by each; their HP and ATK bonuses
    // +75% for 5 s after any party member's Frozen or Stellar Swirl
    weapon: 'HymnOfTheMaelstrom',
    custom: ({ members, holds, window, stack }) => {
      const holders = members.filter(holds)
      const frozen = refreshed(window)
      return {
        declare() {
          for (const k of holders) {
            window(k, ['HymnOfTheMaelstrom', 'stacks'], '1', 0, 0)
            window(k, ['HymnOfTheMaelstrom', 'frozenSwirl'], 'on', 0, 0)
          }
        },
        onHit(_ctx, hit) {
          if (hit.path[0] === '_heal' && holders.includes(hit.characterKey))
            stack(
              hit.characterKey,
              ['HymnOfTheMaelstrom', 'stacks'],
              hit.t,
              600,
              3
            )
          if (
            hit.path[0] === '_reaction' &&
            (hit.path[1] === 'frozen' || hit.path[1] === 'stellarSwirl')
          )
            for (const k of holders)
              frozen.open(k, ['HymnOfTheMaelstrom', 'frozenSwirl'], hit.t, 300)
        },
        end: (t) => frozen.end(t),
      }
    },
  },
  {
    // Reliquary of Truth (as kqmsim reliquary.go): Secret of Lies (EM) for 12 s after the
    // wielder's Skill, Moon of Truth (CRIT DMG) for 4 s after it deals Lunar-Bloom DMG (off the
    // field too: the kits label those hits "(Lunar-Bloom)"); the sheet raises both while both are up
    weapon: 'ReliquaryOfTruth',
    custom: ({ members, holds, window }) => {
      const holders = members.filter(holds)
      const moon = refreshed(window)
      return {
        declare() {
          for (const k of holders) {
            window(k, ['ReliquaryOfTruth', 'afterSkill'], 'on', 0, 0)
            window(k, ['ReliquaryOfTruth', 'afterLunarBloom'], 'on', 0, 0)
          }
        },
        onAction(ctx, actor, action) {
          if (action.kind === 'skill' && holders.includes(actor))
            ctx.buff(actor, ['ReliquaryOfTruth', 'afterSkill'], 'on', 0, 720, {
              hitlag: 'recipient',
            })
        },
        onHit(_ctx, hit) {
          const k = hit.characterKey
          // (granted after the hit's damage: from the next frame)
          if (
            holders.includes(k) &&
            ownDamage(hit, k) &&
            /Lunar-Bloom/.test(hit.label)
          )
            moon.open(
              k,
              ['ReliquaryOfTruth', 'afterLunarBloom'],
              hit.t + 1,
              240
            )
        },
        end: (t) => moon.end(t),
      }
    },
  },
  {
    // Sunny Morning Sleep-In (as kqmsim sunnymorning.go): the wielder's EM while it is on the
    // field: 6 s after its Swirl or Stellar Swirl, 9 s after its Skill hits, 30 s after its Burst
    // hits
    weapon: 'SunnyMorningSleepIn',
    custom: ({ members, holds, window }) => {
      const holders = members.filter(holds)
      const up = refreshed(window)
      const path = (cond: string) => ['SunnyMorningSleepIn', cond]
      return {
        declare() {
          for (const k of holders)
            for (const cond of ['swirl', 'afterSkill', 'afterBurst'])
              window(k, path(cond), 'on', 0, 0)
        },
        onHit(_ctx, hit) {
          const k = hit.characterKey
          if (!holders.includes(k) || hit.onField !== k) return
          if (hit.path[0] === '_reaction' && SWIRLS.has(hit.path[1] ?? ''))
            up.open(k, path('swirl'), hit.t, 360)
          else if (ownDamage(hit, k) && hit.tag === 'skill')
            up.open(k, path('afterSkill'), hit.t + 1, 540)
          else if (ownDamage(hit, k) && hit.tag === 'burst')
            up.open(k, path('afterBurst'), hit.t + 1, 1800)
        },
        end: (t) => up.end(t),
      }
    },
  },
  {
    // Vivid Notions (as kqmsim vividnotions.go): Dawn's First Hue from the wielder's plunge,
    // Twilight's Splendor from its Skill or Burst, each 15 s on its own clock, both removed 0.1 s
    // after its plunge's ground impact unless gained again meanwhile. (kqmsim also takes the
    // others' Skills and Bursts; the text's "you" is the wielder.)
    weapon: 'VividNotions',
    custom: ({ members, holds, window }) => {
      const holders = members.filter(holds)
      type Effect = 'dawn' | 'twilight'
      /** The gain now up, per wielder and effect */
      const up = new Map<string, object>()
      const lose = (
        ctx: SimContext,
        k: CharacterKey,
        effect: Effect,
        gain: object
      ) => {
        if (up.get(`${k}.${effect}`) !== gain) return
        up.delete(`${k}.${effect}`)
        ctx.state(k, ['VividNotions', effect], '')
      }
      const gain = (ctx: SimContext, k: CharacterKey, effect: Effect) => {
        const token = {}
        up.set(`${k}.${effect}`, token)
        ctx.state(k, ['VividNotions', effect], 'on')
        ctx.atCharacter(k, 900, (c) => lose(c, k, effect, token))
      }
      return {
        declare() {
          for (const k of holders) {
            window(k, ['VividNotions', 'dawn'], 'on', 0, 0)
            window(k, ['VividNotions', 'twilight'], 'on', 0, 0)
          }
        },
        onAction(ctx, actor, action) {
          if (!holders.includes(actor)) return
          if (action.kind === 'plunge') gain(ctx, actor, 'dawn')
          else if (action.kind === 'skill' || action.kind === 'burst')
            gain(ctx, actor, 'twilight')
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          // (the ground impact: a plunge hit that applies its element, not the collision)
          if (
            !holders.includes(k) ||
            !ownDamage(hit, k) ||
            hit.tag !== 'plunge' ||
            hit.durability === 0
          )
            return
          for (const effect of ['dawn', 'twilight'] as const) {
            const token = up.get(`${k}.${effect}`)
            if (token) ctx.atCharacter(k, 6, (c) => lose(c, k, effect, token))
          }
        },
      }
    },
  },
  {
    // Echoes of the Heart (as kqmsim echoesoftheheart.go): EM for 12 s after any reaction the
    // wielder triggers, Stellar Glimmer DMG for 12 s after its Stellar Conduct or Stellar Swirl,
    // off the field too
    weapon: 'EchoesOfTheHeart',
    custom: ({ members, holds, window }) => {
      const holders = members.filter(holds)
      const up = refreshed(window)
      return {
        declare() {
          for (const k of holders) {
            window(k, ['EchoesOfTheHeart', 'react'], 'on', 0, 0)
            window(k, ['EchoesOfTheHeart', 'stellar'], 'on', 0, 0)
          }
        },
        onHit(_ctx, hit) {
          const k = hit.characterKey
          if (!holders.includes(k) || !ownReaction(hit, k)) return
          // (granted after the reaction's damage: from the next frame)
          up.open(k, ['EchoesOfTheHeart', 'react'], hit.t + 1, 720)
          if (
            hit.path[1] === 'stellarConduct' ||
            hit.path[1] === 'stellarSwirl'
          )
            up.open(k, ['EchoesOfTheHeart', 'stellar'], hit.t + 1, 720)
        },
        end: (t) => up.end(t),
      }
    },
  },
  {
    // Flowing Purity (as kqmsim flowingpurity.go): the wielder's Skill, once per 10 s on its own
    // clock, gives All Elemental DMG for 15 s and a Bond of Life; the first heal that reaches it
    // then clears the Bond, for All Elemental DMG 15 s more (no healer: never)
    weapon: 'FlowingPurity',
    custom: ({ members, holds, wears, window, ready, onFieldAt }) => {
      const holders = members.filter(holds)
      /** Wielders with a Bond of Life from it to clear */
      const bond = new Set<CharacterKey>()
      // (the Bond's change, for Bond of Life effects such as Fragment of Harmonic Whimsy)
      const bondChanged = (ctx: SimContext, k: CharacterKey) =>
        ctx.hit(0, {
          characterKey: k,
          path: ['_marker', 'bondOfLife'],
          tag: 'other',
          element: 'physical',
          label: 'Flowing Purity: Bond of Life changed',
        })
      return {
        declare() {
          for (const k of holders) {
            window(k, ['FlowingPurity', 'afterSkill'], 'on', 0, 0)
            window(k, ['FlowingPurity', 'bond'], 'on', 0, 0)
          }
        },
        onAction(ctx, actor, action) {
          if (action.kind !== 'skill' || !holders.includes(actor)) return
          if (!ready(`FlowingPurity.${actor}`, ctx.characterFrame(actor), 600))
            return
          ctx.buff(actor, ['FlowingPurity', 'afterSkill'], 'on', 0, 900, {
            hitlag: 'recipient',
          })
          bond.add(actor)
          if (wears(actor)) bondChanged(ctx, actor)
        },
        onHit(ctx, hit) {
          if (hit.path[0] !== '_heal') return
          for (const k of healedBy(hit, members, onFieldAt(hit.t)))
            if (bond.delete(k)) {
              ctx.buff(k, ['FlowingPurity', 'bond'], 'on', 0, 900, {
                hitlag: 'recipient',
              })
              if (wears(k)) bondChanged(ctx, k)
            }
        },
      }
    },
  },
  {
    // Mappa Mare (as kqmsim mappa.go): a stack per reaction the wielder triggers while it is on
    // the field, up to 2, all lasting 10 s from the last
    weapon: 'MappaMare',
    custom: ({ members, holds, window, stack }) => {
      const holders = members.filter(holds)
      return {
        declare() {
          for (const k of holders)
            window(k, ['MappaMare', 'InfusionScroll'], '1', 0, 0)
        },
        onHit(_ctx, hit) {
          const k = hit.characterKey
          if (holders.includes(k) && hit.onField === k && ownReaction(hit, k))
            stack(k, ['MappaMare', 'InfusionScroll'], hit.t + 1, 600, 2)
        },
      }
    },
  },
]
