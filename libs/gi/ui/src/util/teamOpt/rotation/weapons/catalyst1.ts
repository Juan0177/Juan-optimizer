import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { SimContext } from '../types'
import { isReactionEvent, type WeaponModule } from '../weaponEffects'

/** A damage hit (not a marker or a reaction's own damage) */
const isDamage = (path: readonly string[]) =>
  !path[0].startsWith('_') && path[0] !== 'reaction'

/**
 * Weapon audit batch catalyst1 (2026-11-16), as kqmsim and the game's text. The custom effects set
 * their state at once (hits that take their stats when queued see it), on the wielder's clock.
 */
export const catalyst1: WeaponModule[] = [
  {
    // Lost Prayer to the Sacred Winds (as kqmsim prayer.go): a stack each 240-frame tick of the
    // wielder's clock (counted from the start) while it is on the field, up to 4; all lost when it
    // leaves the field
    weapon: 'LostPrayerToTheSacredWinds',
    custom: ({ members, holds, window, onFieldAt }) => {
      const path = ['LostPrayerToTheSacredWinds', 'BoundlessBlessing']
      /** The wielder's current stint on the field (its generation: a later one ends its ticks) */
      const stint = new Map<CharacterKey, { count: number; gen: number }>()
      let gen = 0
      let started = false
      /**
       * The stacks of a stint from frame `since` (on the wielder's clock) up to now; the ticks
       * already passed are windows up to `until`, the global frame now (the starting member's
       * stint, met late: waits are no events, and nothing that happened before paused its clock)
       */
      const begin = (
        ctx: SimContext,
        k: CharacterKey,
        since: number,
        until?: number
      ) => {
        const mine = { count: 0, gen: ++gen }
        stint.set(k, mine)
        const now = ctx.characterFrame(k)
        let next = (Math.floor(since / 240) + 1) * 240
        for (; next <= now && mine.count < 4; next += 240) {
          mine.count++
          if (until !== undefined)
            window(
              k,
              path,
              `${mine.count}`,
              next,
              mine.count < 4 ? Math.min(next + 240, until) : until
            )
        }
        if (mine.count) ctx.state(k, path, `${mine.count}`)
        const tick = (c: SimContext) => {
          if (stint.get(k)?.gen !== mine.gen) return
          mine.count++
          c.state(k, path, `${mine.count}`)
          if (mine.count < 4) c.atCharacter(k, 240, tick)
        }
        if (mine.count < 4) ctx.atCharacter(k, next - now, tick)
      }
      // (the member on the field from the start, at the first event)
      const start = (ctx: SimContext) => {
        if (started) return
        started = true
        const first = onFieldAt(0)
        if (holds(first)) begin(ctx, first, 0, ctx.now)
      }
      return {
        declare() {
          for (const k of members.filter(holds)) window(k, path, '4', 0, 0)
        },
        onAction: (ctx) => start(ctx),
        onHit: (ctx) => start(ctx),
        onSwap(_t, from, to, ctx) {
          if (!ctx) return
          start(ctx)
          if (stint.delete(from)) ctx.state(from, path, '')
          if (holds(to)) begin(ctx, to, ctx.characterFrame(to))
        },
        end(t) {
          // (no event at all: the starting member waited on the field throughout)
          if (started) return
          started = true
          const first = onFieldAt(0)
          if (!holds(first)) return
          for (let n = 1; n <= 4 && n * 240 < t; n++)
            window(
              first,
              path,
              `${n}`,
              n * 240,
              n < 4 ? Math.min(t, (n + 1) * 240) : t
            )
        },
      }
    },
  },
  {
    // Starsealed Edict (its game text; not in kqmsim): Crystal Compounding for 20 s after the
    // wielder's Skill; meanwhile a Law of Combustion stack (up to 3) per party reaction, off the
    // field too. The next Skill restarts it with no stacks.
    weapon: 'StarsealedEdict',
    custom: ({ members, holds, window }) => {
      const compounding = ['StarsealedEdict', 'crystalCompounding']
      const law = ['StarsealedEdict', 'lawOfCombustion']
      const live = new Map<CharacterKey, { count: number; gen: number }>()
      let gen = 0
      return {
        declare() {
          for (const k of members.filter(holds)) {
            window(k, compounding, 'on', 0, 0)
            window(k, law, '1', 0, 0)
          }
        },
        onAction(ctx, actor, action) {
          if (action.kind !== 'skill' || !holds(actor)) return
          const mine = { count: 0, gen: ++gen }
          live.set(actor, mine)
          ctx.state(actor, compounding, 'on')
          ctx.state(actor, law, '')
          ctx.atCharacter(actor, 1200, (c) => {
            if (live.get(actor) !== mine) return
            live.delete(actor)
            c.state(actor, compounding, '')
            c.state(actor, law, '')
          })
        },
        onHit(ctx, hit) {
          if (!isReactionEvent(hit) || !members.includes(hit.characterKey))
            return
          for (const [k, mine] of live) {
            if (mine.count >= 3) continue
            const count = ++mine.count
            // (granted after the reaction)
            ctx.atCharacter(k, 1, (c) => {
              if (live.get(k) === mine) c.state(k, law, `${count}`)
            })
          }
        },
      }
    },
  },
  {
    // Tulaytullah's Remembrance (as kqmsim tulaytullahsremembrance.go): for 14 s after the
    // wielder's Skill, Normal Attack DMG stacks, +1 a second and +2 per Normal Attack hit (0.3 s
    // cooldown), up to 10. Leaving the field or the next Skill ends them. The sheet's
    // 'timePassive' N is N stacks; its 'hitPassive' stays off. Its Normal Attack SPD +7.5% +2.5%
    // per refinement, for the weapon worn (a play change).
    weapon: 'TulaytullahsRemembrance',
    custom: ({
      members,
      holds,
      wears,
      refinement,
      window,
      ready,
      onFieldAt,
    }) => {
      const time = ['TulaytullahsRemembrance', 'timePassive']
      const hits = ['TulaytullahsRemembrance', 'hitPassive']
      const live = new Map<CharacterKey, { count: number }>()
      const add = (
        c: SimContext,
        k: CharacterKey,
        mine: { count: number },
        n: number
      ) => {
        if (live.get(k) !== mine || mine.count >= 10) return
        mine.count = Math.min(10, mine.count + n)
        c.state(k, time, `${mine.count}`)
      }
      return {
        declare() {
          for (const k of members.filter(holds)) {
            window(k, time, '1', 0, 0)
            window(k, hits, '1', 0, 0)
          }
          for (const k of members.filter(wears))
            window(
              k,
              ['TulaytullahsRemembrance', '_normalAttackSpeed'],
              `${0.075 + 0.025 * refinement(k)}`,
              0,
              Number.POSITIVE_INFINITY
            )
        },
        onAction(ctx, actor, action) {
          if (
            action.kind !== 'skill' ||
            !holds(actor) ||
            onFieldAt(ctx.now) !== actor
          )
            return
          const mine = { count: 0 }
          live.set(actor, mine)
          ctx.state(actor, time, '')
          const tick = (c: SimContext) => {
            if (live.get(actor) !== mine || mine.count >= 10) return
            add(c, actor, mine, 1)
            c.atCharacter(actor, 60, tick)
          }
          ctx.atCharacter(actor, 60, tick)
          ctx.atCharacter(actor, 840, (c) => {
            if (live.get(actor) !== mine) return
            live.delete(actor)
            c.state(actor, time, '')
          })
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holds(k) || hit.tag !== 'normal' || !isDamage(hit.path)) return
          // (every Normal Attack hit starts the cooldown; its stacks count from after the hit)
          if (!ready(`tulaytullah.${k}`, ctx.characterFrame(k), 18)) return
          const mine = live.get(k)
          if (mine) ctx.atCharacter(k, 1, (c) => add(c, k, mine, 2))
        },
        onSwap(_t, from, _to, ctx) {
          if (live.delete(from)) ctx?.state(from, time, '')
        },
      }
    },
  },
  {
    // Dodoco Tales (as kqmsim dodoco.go): the wielder's Normal Attack hits on the field give
    // Charged Attack DMG, its Charged Attack hits ATK, each for 6 s from after the hit
    weapon: 'DodocoTales',
    timed: [
      {
        cond: 'DodoventureNormal',
        on: [{ kind: 'hit', tags: ['normal'], field: 'on' }],
        duration: 360,
        delay: 1,
      },
      {
        cond: 'DodoventureCharged',
        on: [{ kind: 'hit', tags: ['charged'], field: 'on' }],
        duration: 360,
        delay: 1,
      },
    ],
  },
  {
    // Ring of Yaxche (as kqmsim ringofyaxche.go): Normal Attack DMG for 10 s after the wielder's
    // Skill
    weapon: 'RingOfYaxche',
    timed: [
      {
        cond: 'afterSkill',
        on: [{ kind: 'action', actions: ['skill'] }],
        duration: 600,
      },
    ],
  },
  {
    // Solar Pearl (as kqmsim solar.go): the wielder's hits on the field, for 6 s from after the
    // hit: a Normal Attack gives Skill and Burst DMG, a Skill or Burst gives Normal Attack DMG
    weapon: 'SolarPearl',
    timed: [
      {
        cond: 'solarShineNormal',
        value: 'normal',
        on: [{ kind: 'hit', tags: ['normal'], field: 'on' }],
        duration: 360,
        delay: 1,
      },
      {
        cond: 'solarShineSkillBurst',
        value: 'skillBurst',
        on: [{ kind: 'hit', tags: ['skill', 'burst'], field: 'on' }],
        duration: 360,
        delay: 1,
      },
    ],
  },
  {
    // Wine and Song (as kqmsim wine.go): ATK for 5 s after the wielder's dash (alternate sprints
    // are dashes too)
    weapon: 'WineAndSong',
    timed: [
      {
        cond: 'EverChanging',
        on: [{ kind: 'action', actions: ['dash'] }],
        duration: 300,
      },
    ],
  },
]
