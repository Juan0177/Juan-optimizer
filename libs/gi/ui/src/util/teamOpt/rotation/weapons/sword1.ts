import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { HitTag } from '../types'
import {
  hitTriggers,
  type WeaponModule,
  type WeaponTrigger,
} from '../weaponEffects'

/** The wielder's own damage of any kind (kqmsim's OnEnemyDamage from its ActorIndex) */
const ANY_HIT: readonly HitTag[] = [
  'normal',
  'charged',
  'plunge',
  'skill',
  'burst',
  'other',
  'directLunarCrystallize',
  'directStellarSwirl',
  'directStellarConduct',
]

/** A non-stacking window per wielder, extended by a trigger while up, emitted when it closes */
function openWindows(
  window: (
    owner: CharacterKey,
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
    close(k: CharacterKey, path: string[], t: number) {
      close(`${k}.${path.join('.')}`, t)
    },
    closeAll(t: number) {
      for (const key of [...open.keys()]) close(key, t)
    },
  }
}

const ABSOLUTION = ['Absolution', 'bondStacks']
const CHRYSALIS = ['devotion', 'defiance'] as const
const ODES = ['PeakPatrolSong', 'odeStacks']
const ODES_MAXED = ['PeakPatrolSong', 'odeMaxed']
const ODE_TRIGGER: WeaponTrigger = { kind: 'hit', tags: ['normal', 'plunge'] }

/** Weapon audit batch sword1 (2026-11-16), as kqmsim and the game's text */
export const sword1: WeaponModule[] = [
  {
    // Absolution (as kqmsim absolution.go): each gain of the wielder's Bond of Life (the kits'
    // ['_marker', 'bondOfLife', 'gain'], off the field too) adds DMG for 6 s, up to 3, all refreshed
    weapon: 'Absolution',
    custom: ({ members, holds, window, stack }) => {
      const holders = members.filter(holds)
      return {
        declare: () => {
          for (const k of holders) window(k, ABSOLUTION, '1', 0, 0)
        },
        onHit: (_ctx, hit) => {
          if (
            hit.path[0] === '_marker' &&
            hit.path[1] === 'bondOfLife' &&
            hit.path[2] === 'gain' &&
            holders.includes(hit.characterKey)
          )
            // (granted after the change: from the next hit on)
            stack(hit.characterKey, ABSOLUTION, hit.t + 1, 360, 3)
        },
      }
    },
  },
  {
    // Beyond the Chrysalis (the game's text; no reference sim): each Skill or Burst use on the field
    // gives the next of Winds of Devotion (CRIT DMG, 10 s), Winds of Defiance (Stellar Swirl DMG,
    // 10 s) and Winds of Plenty (Energy: the ER calculator's); leaving the field ends them and
    // restarts the cycle
    weapon: 'BeyondTheChrysalis',
    custom: ({ members, holds, window }) => {
      const holders = members.filter(holds)
      const step = new Map<CharacterKey, number>()
      const windows = openWindows(window)
      return {
        declare: () => {
          for (const k of holders)
            for (const name of CHRYSALIS)
              window(k, ['BeyondTheChrysalis', name], 'on', 0, 0)
        },
        onAction: (ctx, actor, action) => {
          if (
            !holders.includes(actor) ||
            (action.kind !== 'skill' && action.kind !== 'burst') ||
            ctx.onField !== actor
          )
            return
          const i = step.get(actor) ?? 0
          step.set(actor, (i + 1) % 3)
          const name = CHRYSALIS[i]
          if (name)
            windows.open(actor, ['BeyondTheChrysalis', name], ctx.now, 600)
        },
        onSwap: (t, from) => {
          if (!holders.includes(from)) return
          step.delete(from)
          for (const name of CHRYSALIS)
            windows.close(from, ['BeyondTheChrysalis', name], t)
        },
        end: (t) => windows.closeAll(t),
      }
    },
  },
  {
    // Key of Khaj-Nisut (as kqmsim keyofkhajnisut.go): the wielder's Skill hits on the field, once
    // per 0.3 s, give Grand Hymn for 20 s, up to 3, all refreshed (its sheet adds the party's EM at 3)
    weapon: 'KeyOfKhajNisut',
    timed: [
      {
        cond: 'afterSkill',
        on: [{ kind: 'hit', tags: ['skill'], field: 'on' }],
        duration: 1200,
        icd: 18,
        stacks: { max: 3, refresh: 'all' },
        delay: 1,
      },
    ],
  },
  {
    // Peak Patrol Song (as kqmsim peakpatrolsong.go): the wielder's Normal or Plunging hits (off the
    // field too), once per 0.1 s, give Ode to Flowers for 6 s, up to 2, all refreshed; each one at
    // 2 stacks gives the party's Elemental DMG (its sheet's odeMaxed) for 15 s
    weapon: 'PeakPatrolSong',
    custom: ({ members, holds, window, stack, ready, onFieldAt }) => {
      const holders = members.filter(holds)
      const odes = new Map<CharacterKey, { count: number; end: number }>()
      const windows = openWindows(window)
      return {
        declare: () => {
          for (const k of holders) {
            window(k, ODES, '1', 0, 0)
            window(k, ODES_MAXED, 'on', 0, 0)
          }
        },
        onHit: (_ctx, hit) => {
          const k = hit.characterKey
          if (
            !holders.includes(k) ||
            !hitTriggers(ODE_TRIGGER, k, hit, members, onFieldAt(hit.t)) ||
            !ready(`PeakPatrolSong.${k}`, hit.t, 6)
          )
            return
          // (granted after the hit's damage)
          const at = hit.t + 1
          const old = odes.get(k)
          const count = old && old.end > at ? Math.min(2, old.count + 1) : 1
          odes.set(k, { count, end: at + 360 })
          stack(k, ODES, at, 360, 2)
          if (count === 2) windows.open(k, ODES_MAXED, at, 900)
        },
        end: (t) => windows.closeAll(t),
      }
    },
  },
  {
    // Flute of Ezpitzal (as kqmsim fluteofezpitzal.go): DEF for 15 s after the wielder's Skill
    weapon: 'FluteOfEzpitzal',
    timed: [
      {
        cond: 'afterSkill',
        on: [{ kind: 'action', actions: ['skill'] }],
        duration: 900,
      },
    ],
  },
  {
    // Silver Light (the game's text; no reference sim): EM for 12 s after each Skill use, up to 2
    // stacks, each on its own clock
    weapon: 'SilverLight',
    timed: [
      {
        cond: 'passive',
        on: [{ kind: 'action', actions: ['skill'] }],
        duration: 720,
        stacks: { max: 2, refresh: 'each' },
      },
    ],
  },
  {
    // Toukabou Shigure (as kqmsim toukaboushigure.go): the wielder's hit puts Cursed Parasol on the
    // enemy for 10 s (from the next hit on), once per 15 s; defeats (its reset) are not modelled
    weapon: 'ToukabouShigure',
    timed: [
      {
        cond: 'passive',
        on: [{ kind: 'hit', tags: ANY_HIT }],
        duration: 600,
        icd: 900,
        delay: 1,
      },
    ],
  },
]
