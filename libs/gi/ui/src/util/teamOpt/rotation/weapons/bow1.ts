import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle, getCharStat } from '@genshin-optimizer/gi/stats'
import type { SimContext, SimHit } from '../types'
import type { WeaponModule } from '../weaponEffects'

/** Intervals [start, end) per source, as windows of how many sources are up (at most `cap`) */
function countWindows(
  sources: readonly (readonly [number, number])[][],
  until: number,
  cap: number
) {
  const cuts = new Set<number>([0, until])
  for (const list of sources)
    for (const [a, b] of list) {
      if (a < until) cuts.add(Math.max(0, a))
      if (b < until) cuts.add(Math.max(0, b))
    }
  const sorted = [...cuts].sort((a, b) => a - b)
  const out: [number, number, number][] = []
  for (let i = 0; i + 1 < sorted.length; i++) {
    const [a, b] = [sorted[i], sorted[i + 1]]
    const n = Math.min(
      cap,
      sources.filter((list) => list.some(([s, e]) => s <= a && a < e)).length
    )
    const last = out[out.length - 1]
    if (last && last[2] === n && last[1] === a) last[1] = b
    else out.push([a, b, n])
  }
  return out.filter(([a, b, n]) => n > 0 && b > a)
}

/** A status that each trigger restarts (kqmsim's AddStatus): its intervals */
function restart(list: [number, number][], t: number, duration: number) {
  const last = list[list.length - 1]
  if (last && t <= last[1]) last[1] = t + duration
  else list.push([t, t + duration])
}

const isLunarCrystallize = (hit: SimHit) =>
  hit.tag === 'directLunarCrystallize' ||
  hit.tag === 'reactionLunarCrystallize' ||
  (hit.path[0] === 'reaction' && hit.path[1] === 'lunarcrystallize')

/** Weapon audit batch bow1 (2026-11-16), as kqmsim and the game's text */
export const bow1: WeaponModule[] = [
  {
    // Amos' Bow (kqmsim amos.go): each Normal/Charged hit gets a stack per 0.1 s its arrow flew
    // (up to 5), from the hit's travel frames (gcsim's default 10: 1 stack)
    weapon: 'AmosBow',
    custom: ({ members, holds, window }) => {
      const path = ['AmosBow', 'StrongWilled']
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, '1', 0, 0)
        },
        onHit: (_ctx, hit) => {
          const k = hit.characterKey
          if (
            !holds(k) ||
            hit.path[0].startsWith('_') ||
            (hit.tag !== 'normal' && hit.tag !== 'charged')
          )
            return
          const travel = hit.travel ?? 10
          const n = Math.min(5, Math.floor(travel / 6))
          hit.states = [
            ...(hit.states ?? []),
            { owner: k, path, value: n ? `${n}` : '' },
          ]
        },
      }
    },
  },
  {
    // Golden Frostbound Oath (kqmsim goldenfrostboundoath.go): the wielder's Skill or
    // Lunar-Crystallize hits give Frost Fae's Favor for 6 s (off the field too, from the next
    // hit); while it is up, a 1 s tick gives the others Frost Fae's Mischief for 2 s when a
    // Moondrift is near
    weapon: 'GoldenFrostboundOath',
    custom: ({ members, holds, window }) => {
      const favor = ['GoldenFrostboundOath', 'skillOrLc']
      const mischief = ['GoldenFrostboundOath', 'moondrift']
      /** Per wielder: its Favor's end (its own clock) and the current tick chain */
      const until = new Map<CharacterKey, number>()
      const chain = new Map<CharacterKey, number>()
      const tick = (c: SimContext, k: CharacterKey, id: number) => {
        if (chain.get(k) !== id || c.characterFrame(k) >= (until.get(k) ?? -1))
          return
        c.atCharacter(k, 60, (next) => tick(next, k, id))
        if (c.moondrifts > 0) c.buff(k, mischief, 'on', 0, 120)
      }
      return {
        declare: () => {
          for (const k of members)
            if (holds(k)) {
              window(k, favor, 'on', 0, 0)
              window(k, mischief, 'on', 0, 0)
            }
        },
        onHit: (ctx, hit) => {
          const k = hit.characterKey
          if (!holds(k)) return
          if (
            !isLunarCrystallize(hit) &&
            !(hit.tag === 'skill' && !hit.path[0].startsWith('_'))
          )
            return
          ctx.buff(k, favor, 'on', 1, 360, { hitlag: 'recipient' })
          until.set(k, ctx.characterFrame(k) + 361)
          const id = (chain.get(k) ?? 0) + 1
          chain.set(k, id)
          tick(ctx, k, id)
        },
      }
    },
  },
  {
    // Silvershower Heartstrings (kqmsim heartstrings.go): a Remedy stack each from the wielder's
    // Skill on the field (25 s), its Bond of Life gains (25 s; not losses, :79-86) and its heals
    // (20 s), each restarted only by its own source
    weapon: 'SilvershowerHeartstrings',
    custom: ({ members, holds, window, onFieldAt }) => {
      const path = ['SilvershowerHeartstrings', 'blessingStacks']
      const spans = new Map<CharacterKey, [number, number][][]>()
      const of = (k: CharacterKey) => {
        let s = spans.get(k)
        if (!s) spans.set(k, (s = [[], [], []]))
        return s
      }
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, '1', 0, 0)
        },
        onAction: (ctx, actor, action) => {
          if (
            action.kind === 'skill' &&
            holds(actor) &&
            onFieldAt(ctx.now) === actor
          )
            restart(of(actor)[0], ctx.now, 25 * 60)
        },
        onHit: (_ctx, hit) => {
          const k = hit.characterKey
          if (!holds(k)) return
          // (markers without a direction count, as before)
          if (
            hit.path[0] === '_marker' &&
            hit.path[1] === 'bondOfLife' &&
            hit.path[2] !== 'loss'
          )
            restart(of(k)[1], hit.t, 25 * 60)
          else if (hit.path[0] === '_heal') restart(of(k)[2], hit.t, 20 * 60)
        },
        end: (t) => {
          for (const [k, s] of spans)
            for (const [a, b, n] of countWindows(s, t, 3))
              window(k, path, `${n}`, a, b)
        },
      }
    },
  },
  {
    // Thundering Pulse (kqmsim thundering.go): Thunder Emblem stacks from the wielder's Normal
    // Attack DMG (5 s, from the next hit), its Skill on the field (10 s) and Energy below full
    // (gcsim starts full: from its first Burst on; the simulation has no Energy)
    weapon: 'ThunderingPulse',
    custom: ({ members, holds, window, onFieldAt }) => {
      const path = ['ThunderingPulse', 'RuleByThunder']
      const spans = new Map<CharacterKey, [number, number][][]>()
      const of = (k: CharacterKey) => {
        let s = spans.get(k)
        if (!s) spans.set(k, (s = [[], [], []]))
        return s
      }
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, '1', 0, 0)
        },
        onAction: (ctx, actor, action) => {
          if (!holds(actor)) return
          if (action.kind === 'skill' && onFieldAt(ctx.now) === actor)
            restart(of(actor)[1], ctx.now, 10 * 60)
          const energy = of(actor)[2]
          if (action.kind === 'burst' && !energy.length)
            energy.push([ctx.now, Number.POSITIVE_INFINITY])
        },
        onHit: (_ctx, hit) => {
          const k = hit.characterKey
          if (holds(k) && hit.tag === 'normal' && !hit.path[0].startsWith('_'))
            restart(of(k)[0], hit.t + 1, 5 * 60)
        },
        end: (t) => {
          for (const [k, s] of spans)
            for (const [a, b, n] of countWindows(s, t, 3))
              window(k, path, `${n}`, a, b)
        },
      }
    },
  },
  {
    // Chain Breaker (kqmsim chainbreaker.go): a stack per party member from Natlan or of another
    // element than the wielder's (the wielder too, when from Natlan), for the whole run
    weapon: 'ChainBreaker',
    custom: ({ members, holds, window }) => {
      const path = ['ChainBreaker', 'natlanOrNonEle']
      const count = (k: CharacterKey) =>
        members.filter(
          (m) =>
            getCharEle(m) !== getCharEle(k) ||
            getCharStat(m).region === 'natlan'
        ).length
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, '1', 0, 0)
        },
        end: (t) => {
          for (const k of members) {
            const n = Math.min(4, count(k))
            if (holds(k) && n > 0 && t > 0) window(k, path, `${n}`, 0, t)
          }
        },
      }
    },
  },
  {
    // End of the Line (kqmsim endoftheline.go): the wielder's Skill on the field starts Flowrider
    // (15 s, once per 12 s): its hits on the field then deal 80–160% ATK Physical DMG a frame later,
    // once per 2 s, 3 times at most
    weapon: 'EndOfTheLine',
    custom: ({ wears, ready, onFieldAt }) => {
      const flowrider = new Map<
        CharacterKey,
        { end: number; procs: number; next: number }
      >()
      return {
        onAction: (ctx, actor, action) => {
          if (
            action.kind !== 'skill' ||
            !wears(actor) ||
            onFieldAt(ctx.now) !== actor
          )
            return
          const f = ctx.characterFrame(actor)
          if (ready(`EndOfTheLine.${actor}`, f, 12 * 60))
            flowrider.set(actor, { end: f + 15 * 60, procs: 0, next: f })
        },
        onHit: (ctx, hit) => {
          const k = hit.characterKey
          const s = flowrider.get(k)
          if (
            !s ||
            hit.onField !== k ||
            hit.path[0].startsWith('_') ||
            hit.path[0] === 'weapon:EndOfTheLine'
          )
            return
          const f = ctx.characterFrame(k)
          if (f >= s.end || f < s.next) return
          ctx.hit(1, {
            characterKey: k,
            path: ['weapon:EndOfTheLine', 'dmg'],
            tag: 'other',
            element: 'physical',
            applies: false,
            label: 'End of the Line (Flowrider)',
          })
          if (++s.procs >= 3) flowrider.delete(k)
          else s.next = f + 2 * 60
        },
      }
    },
  },
  {
    // Hamayumi (kqmsim hamayumi.go): doubled while the wielder's Energy is full: as gcsim starts
    // full, until its first Burst (the simulation has no Energy)
    weapon: 'Hamayumi',
    custom: ({ members, holds, window }) => {
      const path = ['Hamayumi', 'FullDraw']
      const burst = new Map<CharacterKey, number>()
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, 'on', 0, 0)
        },
        onAction: (ctx, actor, action) => {
          if (action.kind === 'burst' && holds(actor) && !burst.has(actor))
            burst.set(actor, ctx.now)
        },
        end: (t) => {
          for (const k of members) {
            const until = Math.min(t, burst.get(k) ?? t)
            if (holds(k) && until > 0) window(k, path, 'on', 0, until)
          }
        },
      }
    },
  },
  {
    // Mitternachts Waltz (kqmsim mitternachtswaltz.go): the wielder's Normal Attack hits on the
    // field give Skill DMG for 5 s, its Skill hits on the field Normal Attack DMG for 5 s (from
    // the next hit)
    weapon: 'MitternachtsWaltz',
    timed: [
      {
        cond: 'EvernightDuetSkill',
        on: [{ kind: 'hit', tags: ['normal'], field: 'on' }],
        duration: 5 * 60,
        delay: 1,
      },
      {
        cond: 'EvernightDuetNormal',
        on: [{ kind: 'hit', tags: ['skill'], field: 'on' }],
        duration: 5 * 60,
        delay: 1,
      },
    ],
  },
  {
    // Prototype Crescent (gcsim prototypecrescent.go): an aimed shot on a weak point gives ATK for
    // 10 s on the wielder's clock, refreshed by the next one
    weapon: 'PrototypeCrescent',
    timed: [
      {
        cond: 'Unreturning',
        on: [{ kind: 'hit', tags: ['charged'], weakspot: true }],
        duration: 10 * 60,
      },
    ],
  },
]
