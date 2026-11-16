import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { SimBuffOwner, SimHit } from '../types'
import { isReactionEvent, type WeaponModule } from '../weaponEffects'

/** A non-stacking window per wielder, extended by a trigger while up, emitted when it closes */
function openWindows(
  window: (
    owner: SimBuffOwner,
    path: string[],
    value: string,
    start: number,
    end: number
  ) => void
) {
  const open = new Map<
    string,
    { k: CharacterKey; path: string[]; start: number; end: number }
  >()
  const close = (key: string, t: number) => {
    const w = open.get(key)
    if (!w) return
    open.delete(key)
    const end = Math.min(w.end, t)
    if (end > w.start) window(w.k, w.path, 'on', w.start, end)
  }
  return {
    /** Up from `at` for `duration` frames (a trigger while up extends it) */
    open(k: CharacterKey, path: string[], at: number, duration: number) {
      const key = `${k}.${path.join('.')}`
      const w = open.get(key)
      if (w && at <= w.end) {
        w.end = Math.max(w.end, at + duration)
        return
      }
      close(key, at)
      open.set(key, { k, path, start: at, end: at + duration })
    },
    closeAll(t: number) {
      for (const key of [...open.keys()]) close(key, t)
    },
  }
}

const LUNAR_REACTIONS = ['lunarCharged', 'lunarBloom', 'lunarCrystallize']
/**
 * A Lunar reaction the hit's member triggers (its marker), or its Lunar reaction DMG: the
 * reaction's own hits, and the kits' direct Lunar hits (Lunar-Crystallize tags, Flins' "…LunarDmg",
 * Lauma's "Lunar-Bloom" labels)
 */
export const isLunarHit = (hit: SimHit) =>
  hit.path[0] === '_reaction'
    ? LUNAR_REACTIONS.includes(hit.path[1] ?? '')
    : hit.path[0] === 'reaction'
      ? /^lunar/i.test(hit.path[1] ?? '')
      : !hit.path[0].startsWith('_') &&
        (hit.tag === 'directLunarCrystallize' ||
          hit.tag === 'reactionLunarCrystallize' ||
          /lunar/i.test(hit.path[hit.path.length - 1] ?? '') ||
          /\bLunar-/.test(hit.label))

const NOCTURNE = ['NocturnesCurtainCall', 'passive']
const TOME = ['TomeOfTheEternalFlow', 'hpChanges']
const FRUIT = ['FruitOfFulfillment', 'stacks']

/** Weapon audit batch catalyst4 (2026-11-16), as kqmsim and the game's text */
export const catalyst4: WeaponModule[] = [
  {
    // Crane's Echoing Call (as kqmsim cranesechoingcall.go): the wielder's Plunging hits give the
    // party's Plunging DMG for 20 s, from the next hit on (its energy: the ER calculator's)
    weapon: 'CranesEchoingCall',
    timed: [
      {
        cond: 'passive',
        on: [{ kind: 'hit', tags: ['plunge'] }],
        duration: 1200,
        delay: 1,
      },
    ],
  },
  {
    // Kagura's Verity (the game's text, 24 s; kqmsim kagura.go has the older 16 s): each Skill use
    // gives a Kagura Dance stack, up to 3, all refreshed (its sheet adds Elemental DMG at 3)
    weapon: 'KagurasVerity',
    timed: [
      {
        cond: 'KaguraDance',
        on: [{ kind: 'action', actions: ['skill'] }],
        duration: 1440,
        stacks: { max: 3, refresh: 'all' },
      },
    ],
  },
  {
    // Nocturne's Curtain Call (as kqmsim nocturnes.go): the wielder's Lunar reactions and Lunar
    // reaction DMG (off the field too) give Bountiful Sea's Sacred Wine for 12 s, refreshed
    weapon: 'NocturnesCurtainCall',
    custom: ({ members, holds, window }) => {
      const holders = members.filter(holds)
      const windows = openWindows(window)
      return {
        declare: () => {
          for (const k of holders) window(k, NOCTURNE, 'on', 0, 0)
        },
        onHit: (_ctx, hit) => {
          if (holders.includes(hit.characterKey) && isLunarHit(hit))
            windows.open(hit.characterKey, NOCTURNE, hit.t + 1, 720)
        },
        end: (t) => windows.closeAll(t),
      }
    },
  },
  {
    // Tome of the Eternal Flow (as kqmsim eternalflow.go): the wielder's HP changes on the field
    // (the HP-change markers), once per 0.3 s, give Charged Attack DMG for 4 s, up to 3, all
    // refreshed. Not declared: a run without HP tracking has no HP changes, so the player's
    // choice stays (its energy: the ER calculator's)
    weapon: 'TomeOfTheEternalFlow',
    custom: ({ members, holds, stack, ready }) => {
      const holders = members.filter(holds)
      return {
        onHit: (_ctx, hit) => {
          const k = hit.characterKey
          if (
            hit.path[0] === '_marker' &&
            hit.path[1] === 'hpChange' &&
            holders.includes(k) &&
            hit.onField === k &&
            ready(`TomeOfTheEternalFlow.${k}`, hit.t, 18)
          )
            stack(k, TOME, hit.t + 1, 240, 3)
        },
      }
    },
  },
  {
    // Ballad of the Boundless Blue (the game's text; kqmsim balladoftheboundlessblue.go): the
    // wielder's Normal and Charged hits on the field, once per 0.3 s, give a stack for 6 s, up to
    // 3, all refreshed
    weapon: 'BalladOfTheBoundlessBlue',
    timed: [
      {
        cond: 'hits',
        on: [{ kind: 'hit', tags: ['normal', 'charged'], field: 'on' }],
        duration: 360,
        icd: 18,
        stacks: { max: 3, refresh: 'all' },
        delay: 1,
      },
    ],
  },
  {
    // Dawning Frost (as kqmsim dawningfrost.go): EM for 10 s after the wielder's Charged hits, and
    // for 10 s after its Skill hits, each while it is on the field
    weapon: 'DawningFrost',
    timed: [
      {
        cond: 'chargedHit',
        on: [{ kind: 'hit', tags: ['charged'], field: 'on' }],
        duration: 600,
        delay: 1,
      },
      {
        cond: 'skillHit',
        on: [{ kind: 'hit', tags: ['skill'], field: 'on' }],
        duration: 600,
        delay: 1,
      },
    ],
  },
  {
    // Eye of Perception (the game's text: 240–360% ATK, a 50% chance; kqmsim perception.go: the
    // 12–8 s cooldown, the bolt 10 frames later): one bolt on a single target
    weapon: 'EyeOfPerception',
    procs: [
      {
        node: 'dmg_',
        label: 'Bolt of Perception',
        on: [{ kind: 'hit', tags: ['normal', 'charged'] }],
        chance: 0.5,
        icd: [0, 720, 660, 600, 540, 480],
        delay: 10,
        element: 'physical',
      },
    ],
  },
  {
    // Fruit of Fulfillment (as kqmsim fruitoffulfillment.go): each reaction event the wielder
    // triggers (isReactionEvent, off the field too), once per 0.3 s, adds a Wax and Wane stack (up
    // to 5); one is lost every 6 s without a new one
    weapon: 'FruitOfFulfillment',
    custom: ({ members, holds, window, ready }) => {
      const holders = members.filter(holds)
      const state = new Map<
        CharacterKey,
        { count: number; since: number; nextLoss: number }
      >()
      /** The stacks lost up to `t` (each 6 s after the last gain or loss) */
      const settle = (k: CharacterKey, t: number) => {
        const s = state.get(k)
        if (!s) return
        while (s.count > 0 && s.nextLoss <= t) {
          window(k, FRUIT, `${s.count}`, s.since, s.nextLoss)
          s.count--
          s.since = s.nextLoss
          s.nextLoss += 360
        }
      }
      return {
        declare: () => {
          for (const k of holders) window(k, FRUIT, '1', 0, 0)
        },
        onHit: (_ctx, hit) => {
          const k = hit.characterKey
          if (
            !isReactionEvent(hit) ||
            !holders.includes(k) ||
            !ready(`FruitOfFulfillment.${k}`, hit.t, 18)
          )
            return
          const at = hit.t + 1
          settle(k, at)
          const s = state.get(k)
          if (s && s.count > 0 && at > s.since)
            window(k, FRUIT, `${s.count}`, s.since, at)
          state.set(k, {
            count: Math.min(5, (s?.count ?? 0) + 1),
            since: at,
            nextLoss: at + 360,
          })
        },
        end: (t) => {
          for (const [k, s] of state) {
            settle(k, t)
            if (s.count > 0 && t > s.since)
              window(k, FRUIT, `${s.count}`, s.since, t)
          }
          state.clear()
        },
      }
    },
  },
  {
    // Waveriding Whirl (as kqmsim waveridingwhirl.go): Max HP for 10 s after the wielder's Skill,
    // once per 15 s
    weapon: 'WaveridingWhirl',
    timed: [
      {
        cond: 'passive',
        on: [{ kind: 'action', actions: ['skill'] }],
        duration: 600,
        icd: 900,
      },
    ],
  },
]
