import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { healedBy, type WeaponModule } from '../weaponEffects'

/** Fading Twilight's states, in the order its hits move it through them */
const TWILIGHT_STATES = ['evengleam', 'afterglow', 'dawnblaze']

/** Weapon audit batch bow2 (2026-11-16), as kqmsim and the game's text */
export const bow2: WeaponModule[] = [
  {
    // Skyward Harp (kqmsim skyward.go): the wielder's damage on the field has a 60–100% chance
    // to deal 125% ATK Physical DMG 1 frame later; a proc starts its 4–2 s cooldown
    weapon: 'SkywardHarp',
    procs: [
      {
        node: 'dmg',
        label: 'Skyward Harp',
        on: [
          {
            kind: 'hit',
            tags: ['normal', 'charged', 'plunge', 'skill', 'burst'],
            field: 'on',
          },
        ],
        chance: [0, 0.6, 0.7, 0.8, 0.9, 1],
        icd: [0, 240, 210, 180, 150, 120],
        delay: 1,
      },
    ],
  },
  {
    // Hunter's Path (kqmsim hunterspath.go): a Charged Attack hit starts Tireless Hunt for 10 s,
    // once per 12 s; it covers the next 12 Charged Attack hits (the triggering one gets none)
    weapon: 'HuntersPath',
    custom: ({ members, holds, window, ready }) => {
      const path = ['HuntersPath', 'passive']
      const hunts = new Map<
        CharacterKey,
        { start: number; end: number; left: number }
      >()
      const close = (k: CharacterKey, t: number) => {
        const hunt = hunts.get(k)
        if (!hunt) return
        hunts.delete(k)
        const end = Math.min(hunt.end, t)
        if (end > hunt.start) window(k, path, 'on', hunt.start, end)
      }
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, 'on', 0, 0)
        },
        onHit: (_ctx, hit) => {
          const k = hit.characterKey
          if (hit.tag !== 'charged' || hit.path[0].startsWith('_') || !holds(k))
            return
          const hunt = hunts.get(k)
          if (hunt && hit.t < hunt.end) {
            // (a hit on the trigger's own frame is not covered: the window starts after it)
            if (hit.t >= hunt.start && --hunt.left === 0) close(k, hit.t + 1)
            return
          }
          if (hunt) close(k, hunt.end)
          if (ready(`HuntersPath.${k}`, hit.t, 720))
            hunts.set(k, { start: hit.t + 1, end: hit.t + 601, left: 12 })
        },
        end: (t) => {
          for (const k of [...hunts.keys()]) close(k, t)
        },
      }
    },
  },
  {
    // Alley Hunter (kqmsim alley.go): off the field, a stack (DMG +2–4%) every second, up to 10;
    // after 4 s on the field it loses 2 stacks a second. Each swap restarts the count's ramp
    weapon: 'AlleyHunter',
    custom: ({ members, holds, window, onFieldAt }) => {
      const path = ['AlleyHunter', 'OppidanAmbush']
      /** Per wielder, its stretch on or off the field: from when, its stacks then, its first tick */
      const runs = new Map<
        CharacterKey,
        { since: number; base: number; on: boolean; first: number }
      >()
      /** A stretch's windows up to `t`: its stacks at `t` */
      const flush = (k: CharacterKey, t: number) => {
        const run = runs.get(k)
        if (!run) return 0
        let from = run.since
        let count = run.base
        for (let at = run.since + run.first; at < t; at += 60) {
          const next = run.on ? Math.max(0, count - 2) : Math.min(10, count + 1)
          if (next === count) break
          if (count > 0 && at > from) window(k, path, `${count}`, from, at)
          from = at
          count = next
        }
        if (count > 0 && t > from) window(k, path, `${count}`, from, t)
        return count
      }
      return {
        declare: () => {
          for (const k of members) {
            if (!holds(k)) continue
            window(k, path, '1', 0, 0)
            // (off the field at the start: its first stack a frame in)
            const on = onFieldAt(0) === k
            runs.set(k, { since: 0, base: 0, on, first: on ? 240 : 1 })
          }
        },
        onSwap: (t, from, to) => {
          if (holds(from))
            runs.set(from, {
              since: t,
              base: flush(from, t),
              on: false,
              first: 60,
            })
          if (holds(to))
            runs.set(to, { since: t, base: flush(to, t), on: true, first: 240 })
        },
        end: (t) => {
          for (const k of [...runs.keys()]) flush(k, t)
          runs.clear()
        },
      }
    },
  },
  {
    // Cloudforged (the game's text; 18 s and 2 stacks as kqmsim cloudforged.go): EM per stack
    // for 18 s after the wielder's Energy goes down (its Burst), each gain refreshing both
    weapon: 'Cloudforged',
    timed: [
      {
        cond: 'energyStacks',
        on: [{ kind: 'action', actions: ['burst'] }],
        duration: 1080,
        stacks: { max: 2, refresh: 'all' },
      },
    ],
  },
  {
    // Fading Twilight (kqmsim twilight.go): from Evengleam, the wielder's hits (off the field too)
    // move it to the next state once per 7 s; the hit that moves it keeps the old state
    weapon: 'FadingTwilight',
    custom: ({ members, holds, window, ready }) => {
      const path = ['FadingTwilight', 'state']
      const states = new Map<CharacterKey, { state: number; since: number }>()
      const emit = (k: CharacterKey, t: number) => {
        const s = states.get(k)
        if (s && t > s.since)
          window(k, path, TWILIGHT_STATES[s.state], s.since, t)
      }
      return {
        declare: () => {
          for (const k of members) {
            if (!holds(k)) continue
            window(k, path, TWILIGHT_STATES[0], 0, 0)
            states.set(k, { state: 0, since: 0 })
          }
        },
        onHit: (_ctx, hit) => {
          const k = hit.characterKey
          const s = states.get(k)
          if (!s || hit.path[0].startsWith('_')) return
          if (!ready(`FadingTwilight.${k}`, hit.t, 420)) return
          emit(k, hit.t + 1)
          states.set(k, { state: (s.state + 1) % 3, since: hit.t + 1 })
        },
        end: (t) => {
          for (const k of [...states.keys()]) emit(k, t)
          states.clear()
        },
      }
    },
  },
  {
    // Ibis Piercer (kqmsim ibispiercer.go): EM per stack for 6 s after the wielder's Charged
    // Attack hits on the field, once per 0.5 s, up to 2 (each gain refreshing both)
    weapon: 'IbisPiercer',
    timed: [
      {
        cond: 'passiveStacks',
        on: [{ kind: 'hit', tags: ['charged'], field: 'on' }],
        duration: 360,
        icd: 30,
        stacks: { max: 2, refresh: 'all' },
        delay: 1,
      },
    ],
  },
  {
    // Range Gauge (kqmsim rangegauge.go): a Symbol per heal the wielder gives (each target) or
    // gets, up to 3 for 30 s from the last; its Skill or Burst on the field consumes them for
    // Struggle (10 s), once per 15 s
    weapon: 'RangeGauge',
    custom: ({ members, holds, window, ready, onFieldAt }) => {
      const path = ['RangeGauge', 'marksConsumed']
      const symbols = new Map<CharacterKey, { count: number; until: number }>()
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, '1', 0, 0)
        },
        onHit: (_ctx, hit) => {
          if (hit.path[0] !== '_heal') return
          const healed = healedBy(hit, members, onFieldAt(hit.t))
          for (const k of members) {
            if (!holds(k)) continue
            const gained =
              hit.characterKey === k
                ? healed.length
                : healed.includes(k)
                  ? 1
                  : 0
            if (!gained) continue
            const s = symbols.get(k)
            const held = s && hit.t < s.until ? s.count : 0
            symbols.set(k, {
              count: Math.min(3, held + gained),
              until: hit.t + 1800,
            })
          }
        },
        onAction: (ctx, actor, action) => {
          if (action.kind !== 'skill' && action.kind !== 'burst') return
          const s = symbols.get(actor)
          const t = ctx.now
          if (!holds(actor) || !s || t >= s.until || onFieldAt(t) !== actor)
            return
          if (!ready(`RangeGauge.${actor}`, t, 900)) return
          window(actor, path, `${s.count}`, t, t + 600)
          symbols.delete(actor)
        },
      }
    },
  },
  {
    // Scion of the Blazing Sun (kqmsim scionoftheblazingsun.go): the wielder's Charged Attack hit
    // on the field drops a Sunfire Arrow (Physical) 15 frames later, once per 10 s; its hit gives
    // the enemy Heartsearer (the wielder's Charged Attack DMG) for 10 s
    weapon: 'ScionOfTheBlazingSun',
    procs: [
      {
        node: 'dmg',
        label: 'Sunfire Arrow',
        on: [{ kind: 'hit', tags: ['charged'], field: 'on' }],
        icd: 600,
        delay: 15,
      },
    ],
    timed: [
      {
        cond: 'afterHit',
        on: [{ kind: 'hit', tags: ['charged'], field: 'on' }],
        duration: 600,
        icd: 600,
        delay: 15,
      },
    ],
  },
]
