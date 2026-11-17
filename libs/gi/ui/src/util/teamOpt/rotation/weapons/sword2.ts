import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { energyCalcData } from '../../energyCalc'
import type { HitTag, SimContext, SimHit } from '../types'
import type { WeaponModule } from '../weaponEffects'

/** A damage hit (not a marker or a reaction's own damage) */
const isDamage = (hit: SimHit) =>
  !hit.path[0].startsWith('_') && hit.path[0] !== 'reaction'

/** Every kind of hit an attack can be (for "after the wielder hits an opponent") */
const ANY_HIT: readonly HitTag[] = [
  'normal',
  'charged',
  'plunge',
  'skill',
  'burst',
  'directLunarCrystallize',
  'reactionLunarCrystallize',
  'directStellarSwirl',
  'directStellarConduct',
  'other',
]

/**
 * Per wielder, a buff that lasts `duration` frames on the wielder's clock (hitlag pauses it, as
 * kqmsim's weapon statuses) or `count` covered hits, whichever ends first (kqmsim's status plus a
 * tag counted down). Its state is set at once, so hits that take their stats when queued see it:
 * `open` starts or restarts it, `use` counts a hit it covers (the last one ends it the frame after)
 */
function countedBuff(path: string[]) {
  const live = new Map<CharacterKey, { left: number; gen: number }>()
  let gen = 0
  const off = (ctx: SimContext, k: CharacterKey, mine: { gen: number }) => {
    if (live.get(k)?.gen !== mine.gen) return
    live.delete(k)
    ctx.state(k, path, '')
  }
  return {
    open(ctx: SimContext, k: CharacterKey, duration: number, count: number) {
      const mine = { left: count, gen: ++gen }
      live.set(k, mine)
      ctx.state(k, path, 'on')
      ctx.atCharacter(k, duration, (c) => off(c, k, mine))
    },
    use(ctx: SimContext, k: CharacterKey) {
      const mine = live.get(k)
      if (!mine || mine.left <= 0) return
      if (--mine.left <= 0) ctx.at(1, (c) => off(c, k, mine))
    },
  }
}

/** Weapon audit batch sword2 (2026-11-16), as kqmsim and the game's text */
export const sword2: WeaponModule[] = [
  {
    // Exaiphanes Blade (kqmsim exaiphanesblade.go): the Traveler's ATK +16–40% for 8 s after any
    // of its hits (off the field too), once per 5 s; its sheet counts it for a Traveler only
    weapon: 'ExaiphanesBlade',
    timed: [
      {
        cond: 'passive',
        on: [{ kind: 'hit', tags: ANY_HIT }, { kind: 'reaction' }],
        duration: 480,
        icd: 300,
        delay: 1,
      },
    ],
  },
  {
    // Light of Foliar Incision (kqmsim foliar.go): the wielder's non-Physical Normal Attack hit on
    // the field gives its Normal and Skill hits +EM DMG for 12 s or 28 hits, once per 12 s (the
    // triggering hit excluded, off-field hits neither counted nor buffed)
    weapon: 'LightOfFoliarIncision',
    custom: (api) => {
      const path = ['LightOfFoliarIncision', 'afterNormalEle']
      const holders = api.members.filter(api.holds)
      const buff = countedBuff(path)
      return {
        declare: () => holders.forEach((k) => api.window(k, path, 'on', 0, 0)),
        onHit: (ctx, hit) => {
          const k = hit.characterKey
          if (!holders.includes(k) || hit.onField !== k || !isDamage(hit))
            return
          if (
            hit.tag === 'normal' &&
            hit.element !== 'physical' &&
            api.ready(`LightOfFoliarIncision.${k}`, hit.t, 720)
          ) {
            // (from the next frame: not for the hit that triggers it)
            ctx.atCharacter(k, 1, (c) => buff.open(c, k, 720, 28))
            return
          }
          if (hit.tag === 'normal' || hit.tag === 'skill') buff.use(ctx, k)
        },
      }
    },
  },
  {
    // Uraku Misugiri (kqmsim urakumisugiri.go): its Normal and Skill DMG bonuses double for 15 s
    // after any Geo DMG (any member's, as kqmsim), refreshed by each
    weapon: 'UrakuMisugiri',
    custom: (api) => {
      const path = ['UrakuMisugiri', 'teamGeo']
      const holders = api.members.filter(api.holds)
      // (the latest Geo DMG's buff, per wielder: an earlier expiry does nothing)
      const latest = new Map<CharacterKey, number>()
      let gen = 0
      return {
        declare: () => holders.forEach((k) => api.window(k, path, 'on', 0, 0)),
        onHit: (ctx, hit) => {
          if (hit.element !== 'geo' || hit.path[0].startsWith('_')) return
          for (const k of holders)
            ctx.atCharacter(k, 1, (c) => {
              const mine = ++gen
              latest.set(k, mine)
              c.state(k, path, 'on')
              c.atCharacter(k, 900, (c2) => {
                if (latest.get(k) !== mine) return
                latest.delete(k)
                c2.state(k, path, '')
              })
            })
        },
      }
    },
  },
  {
    // Moonweaver's Dawn (kqmsim moonweaversdawn.go): its extra Burst DMG follows the wielder's
    // Energy capacity (at most 40, at most 60, or none above): set for the whole run
    weapon: 'MoonweaversDawn',
    custom: (api) => {
      const path = ['MoonweaversDawn', 'energy']
      const tier = (k: CharacterKey) => {
        const cost = energyCalcData[k]?.burstCost
        return cost === undefined
          ? undefined
          : cost <= 40
            ? '40'
            : cost <= 60
              ? '60'
              : ''
      }
      // (a member without Energy data keeps its own setting)
      const holders = api.members
        .filter(api.holds)
        .filter((k) => tier(k) !== undefined)
      // (its state set at the run's first event, so hits that take their stats when queued see it)
      let set = false
      const start = (ctx: SimContext) => {
        if (set) return
        set = true
        for (const k of holders) {
          const state = tier(k)
          if (state) ctx.state(k, path, state)
        }
      }
      return {
        declare: () =>
          holders.forEach((k) => api.window(k, path, tier(k) || '60', 0, 0)),
        onAction: (ctx) => start(ctx),
        onHit: (ctx) => start(ctx),
      }
    },
  },
  {
    // Sturdy Bone (as kqmsim sturdybone.go's timing; its numbers are the game's, in the sheet):
    // after the wielder dashes on the field, its Normal Attack DMG + ATK for 7 s or 18 Normal hits
    weapon: 'SturdyBone',
    custom: (api) => {
      const path = ['SturdyBone', 'afterSprint']
      const holders = api.members.filter(api.holds)
      const buff = countedBuff(path)
      return {
        declare: () => holders.forEach((k) => api.window(k, path, 'on', 0, 0)),
        onAction: (ctx, actor, action) => {
          if (
            action.kind === 'dash' &&
            holders.includes(actor) &&
            ctx.onField === actor
          )
            buff.open(ctx, actor, 420, 18)
        },
        onHit: (ctx, hit) => {
          const k = hit.characterKey
          if (
            holders.includes(k) &&
            hit.onField === k &&
            hit.tag === 'normal' &&
            isDamage(hit)
          )
            buff.use(ctx, k)
        },
      }
    },
  },
  {
    // Wolf-Fang (kqmsim wolffang.go): the wielder's Skill (and, apart, Burst) hits on the field
    // each add a CRIT Rate stack for that kind, up to 4, once per 0.1 s, 10 s from the last
    weapon: 'WolfFang',
    timed: [
      {
        cond: 'skillStacks',
        on: [{ kind: 'hit', tags: ['skill'], field: 'on' }],
        duration: 600,
        icd: 6,
        stacks: { max: 4, refresh: 'all' },
        delay: 1,
      },
      {
        cond: 'burstStacks',
        on: [{ kind: 'hit', tags: ['burst'], field: 'on' }],
        duration: 600,
        icd: 6,
        stacks: { max: 4, refresh: 'all' },
        delay: 1,
      },
    ],
  },
]
