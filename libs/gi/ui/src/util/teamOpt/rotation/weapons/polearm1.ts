import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { SimContext, SimHit } from '../types'
import type { WeaponModule } from '../weaponEffects'

/** A damage hit of the wielder's (not a marker) */
const isDamage = (hit: SimHit) => !hit.path[0].startsWith('_')

/**
 * A weapon's Energy restored, for the ER calculator to count from the rotation (it fills each
 * member's energy weapon triggers from these markers)
 */
const energyMarker = (ctx: SimContext, k: CharacterKey, weapon: string) =>
  ctx.hit(0, {
    characterKey: k,
    path: ['_marker', 'weaponEnergy', weapon],
    tag: 'other',
    element: 'physical',
    label: `${weapon} Energy`,
  })

const REMORSE = ['unforgivable', 'irreparable'] as const
type Remorse = (typeof REMORSE)[number]
/** A Disaster and Remorse wielder's Path of Conflict: its buffs' ends, on the wielder's clock */
interface RemorsePath {
  pathEnd: number
  ends: Record<Remorse, number>
  up: Record<Remorse, boolean>
  /** It left the field then (both buffs end) */
  swappedAt?: number
}

/** Weapon audit batch polearm1 (2026-11-16), as kqmsim and the game's text */
export const polearm1: WeaponModule[] = [
  {
    // Bloodsoaked Ruins (as kqmsim bloodsoakedruins.go): Lunar-Charged DMG for 3.5 s after the
    // wielder's Burst on the field; Requiem of Ruin (CRIT DMG, 6 s) and 12–16 Energy (once per 14 s)
    // when the wielder triggers Lunar-Charged on the field
    weapon: 'BloodsoakedRuins',
    custom: ({ members, holds, window, ready, onFieldAt }) => ({
      declare() {
        for (const k of members)
          if (holds(k)) {
            window(k, ['BloodsoakedRuins', 'afterBurst'], 'on', 0, 0)
            window(k, ['BloodsoakedRuins', 'afterLc'], 'on', 0, 0)
          }
      },
      onAction(ctx, actor, action) {
        if (
          action.kind === 'burst' &&
          holds(actor) &&
          onFieldAt(ctx.now) === actor
        )
          ctx.buff(actor, ['BloodsoakedRuins', 'afterBurst'], 'on', 0, 210)
      },
      onHit(ctx, hit) {
        const k = hit.characterKey
        if (
          hit.path[0] !== '_reaction' ||
          hit.path[1] !== 'lunarCharged' ||
          hit.onField !== k ||
          !holds(k)
        )
          return
        ctx.buff(k, ['BloodsoakedRuins', 'afterLc'], 'on', 0, 360)
        if (ready(`BloodsoakedRuins.energy.${k}`, ctx.characterFrame(k), 840))
          energyMarker(ctx, k, 'BloodsoakedRuins')
      },
    }),
  },
  {
    // Disaster and Remorse (as kqmsim disasterandremorse.go): the wielder's Skill on the field, once
    // per 18 s, gives Path of Conflict (17 s) and 3 s each of Unforgivable (Normal and Charged
    // Attack DMG) and Irreparable (Skill and Burst DMG). While Path lasts, the wielder's Normal or
    // Charged hits add 1 s to Irreparable and its Skill or Burst hits 1 s to Unforgivable (each once
    // per 0.1 s, while it is up). Both end with Path or when the wielder leaves the field. All on the
    // wielder's own clock (hitlag).
    weapon: 'DisasterAndRemorse',
    custom: ({ members, holds, window, ready, onFieldAt }) => {
      const path = (n: Remorse) => ['DisasterAndRemorse', n]
      /** Per wielder, its current Path (ends on its own clock) */
      const live = new Map<CharacterKey, RemorsePath>()
      const close = (ctx: SimContext, k: CharacterKey, n: Remorse) => {
        const s = live.get(k)
        if (!s?.up[n]) return
        s.up[n] = false
        ctx.state(k, path(n), '')
        if (!s.up.unforgivable && !s.up.irreparable) live.delete(k)
      }
      // (one check per buff, again at its later end when hits extended it)
      const expire = (
        ctx: SimContext,
        k: CharacterKey,
        s: RemorsePath,
        n: Remorse
      ) =>
        ctx.atCharacter(
          k,
          Math.max(1, s.ends[n] - ctx.characterFrame(k)),
          (c) => {
            if (live.get(k) !== s || !s.up[n]) return
            if (c.characterFrame(k) >= s.ends[n]) close(c, k, n)
            else expire(c, k, s, n)
          }
        )
      // (leaving the field removes both: at the swap, or else at the first event from it on)
      const settle = (ctx: SimContext) => {
        for (const [k, s] of [...live])
          if (s.swappedAt !== undefined && ctx.now >= s.swappedAt)
            for (const n of REMORSE) close(ctx, k, n)
      }
      return {
        declare() {
          for (const k of members)
            if (holds(k))
              for (const n of REMORSE) window(k, path(n), 'on', 0, 0)
        },
        onAction(ctx, actor, action) {
          settle(ctx)
          if (
            action.kind !== 'skill' ||
            !holds(actor) ||
            onFieldAt(ctx.now) !== actor
          )
            return
          const own = ctx.characterFrame(actor)
          if (!ready(`DisasterAndRemorse.${actor}`, own, 1080)) return
          const s: RemorsePath = {
            pathEnd: own + 1020,
            ends: { unforgivable: own + 180, irreparable: own + 180 },
            up: { unforgivable: true, irreparable: true },
          }
          live.set(actor, s)
          for (const n of REMORSE) {
            ctx.state(actor, path(n), 'on')
            expire(ctx, actor, s, n)
          }
        },
        onHit(ctx, hit) {
          settle(ctx)
          const k = hit.characterKey
          const s = live.get(k)
          if (!s || !isDamage(hit) || hit.path[0] === 'reaction') return
          const n: Remorse | undefined =
            hit.tag === 'normal' || hit.tag === 'charged'
              ? 'irreparable'
              : hit.tag === 'skill' || hit.tag === 'burst'
                ? 'unforgivable'
                : undefined
          if (!n || !s.up[n]) return
          const own = ctx.characterFrame(k)
          if (own >= s.pathEnd || own >= s.ends[n]) return
          if (!ready(`DisasterAndRemorse.${n}.${k}`, own, 6)) return
          s.ends[n] = Math.min(s.pathEnd, s.ends[n] + 60)
        },
        onSwap(t, from, _to, ctx) {
          const s = live.get(from)
          if (!s) return
          s.swappedAt = t
          if (ctx) for (const n of REMORSE) close(ctx, from, n)
        },
      }
    },
  },
  {
    // Lumidouce Elegy (as kqmsim lumidouceelegy.go): a stack (up to 2, 8 s, all refreshed) when the
    // wielder triggers Burning or deals Dendro DMG to a Burning enemy, off the field too; at 2
    // stacks, 12–16 Energy once per 12 s. The count is set at once and ends 8 s later on the
    // wielder's clock (hitlag), as the engine's timed stacks
    weapon: 'LumidouceElegy',
    custom: ({ members, holds, window, ready }) => {
      const path = ['LumidouceElegy', 'stacks']
      /** Per wielder, its stacks now and their generation (a later refresh voids an expiry) */
      const live = new Map<CharacterKey, { count: number; gen: number }>()
      let gen = 0
      return {
        declare() {
          for (const k of members) if (holds(k)) window(k, path, '1', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holds(k)) return
          const burning =
            hit.path[0] === '_reaction' && hit.path[1] === 'burning'
          const dendro =
            isDamage(hit) && hit.element === 'dendro' && ctx.isBurning
          if (!burning && !dendro) return
          const before = live.get(k)?.count ?? 0
          // (kqmsim adds the stack after the hit's damage: the hit keeps the count before it)
          if (dendro)
            hit.states = [
              ...(hit.states ?? []),
              { owner: k, path, value: before ? `${before}` : '' },
            ]
          const count = Math.min(2, before + 1)
          const mine = { count, gen: ++gen }
          live.set(k, mine)
          ctx.state(k, path, `${count}`)
          ctx.atCharacter(k, 480, (c) => {
            if (live.get(k)?.gen !== mine.gen) return
            live.delete(k)
            c.state(k, path, '')
          })
          if (
            count === 2 &&
            ready(`LumidouceElegy.energy.${k}`, ctx.characterFrame(k), 720)
          )
            energyMarker(ctx, k, 'LumidouceElegy')
        },
      }
    },
  },
  {
    // Crescent Pike (as kqmsim crescent.go): for 5 s (its clock) after the wielder picks up a
    // particle on the field, each of its Normal and Charged Attack hits deals 20–40% ATK as
    // Physical DMG 1 frame later. Particles arrive 100 frames (kqmsim's default ParticleDelay) after
    // a kit's particle marker, or else after the first hit of each member's Skill.
    weapon: 'CrescentPike',
    custom: ({ members, wears }) => {
      const wielders = members.filter(wears)
      /** Its status's end, on the wielder's clock */
      const until = new Map<CharacterKey, number>()
      /** Members whose Skill's first hit is still to come (it makes the particles) */
      const casting = new Set<CharacterKey>()
      /** Members whose kit marks its own particles */
      const marks = new Set<CharacterKey>()
      const pickUp = (ctx: SimContext) => {
        const k = ctx.onField
        if (wielders.includes(k)) until.set(k, ctx.characterFrame(k) + 300)
      }
      return {
        onAction(_ctx, actor, action) {
          if (wielders.length && action.kind === 'skill') casting.add(actor)
        },
        onHit(ctx, hit) {
          if (!wielders.length) return
          const m = hit.characterKey
          if (hit.path[0] === '_marker' && hit.path[1] === 'particles') {
            marks.add(m)
            ctx.at(100, pickUp)
            return
          }
          if (!isDamage(hit) || hit.path[0] === 'reaction') return
          if (hit.tag === 'skill' && casting.delete(m) && !marks.has(m))
            ctx.at(100, pickUp)
          if (
            !wielders.includes(m) ||
            (hit.tag !== 'normal' && hit.tag !== 'charged') ||
            ctx.characterFrame(m) >= (until.get(m) ?? Number.NEGATIVE_INFINITY)
          )
            return
          ctx.hit(1, {
            characterKey: m,
            path: ['weapon:CrescentPike', 'hit'],
            tag: 'other',
            element: 'physical',
            applies: false,
            label: 'Crescent Pike',
          })
        },
      }
    },
  },
  {
    // Footprint of the Rainbow (as kqmsim footprint.go): DEF for 15 s after the wielder's Skill
    weapon: 'FootprintOfTheRainbow',
    timed: [
      {
        cond: 'afterSkill',
        on: [{ kind: 'action', actions: ['skill'] }],
        duration: 900,
      },
    ],
  },
  {
    // Mountain-Bracing Bolt (as kqmsim mountainbracingbolt.go): the wielder's Skill DMG for 8 s
    // after another member uses its Skill
    weapon: 'MountainBracingBolt',
    custom: ({ members, holds, window }) => ({
      declare() {
        for (const k of members)
          if (holds(k))
            window(k, ['MountainBracingBolt', 'afterOtherSkill'], 'on', 0, 0)
      },
      onAction(ctx, actor, action) {
        if (action.kind !== 'skill') return
        for (const k of members)
          if (k !== actor && holds(k))
            ctx.buff(
              k,
              ['MountainBracingBolt', 'afterOtherSkill'],
              'on',
              0,
              480
            )
      },
    }),
  },
  {
    // Prototype Starglitter (as kqmsim prototype.go, but Normal and Charged Attack DMG as the game
    // says, not its ATK): a stack per Skill of the wielder, up to 2, 12 s, all refreshed
    weapon: 'PrototypeStarglitter',
    timed: [
      {
        cond: 'stack',
        on: [{ kind: 'action', actions: ['skill'] }],
        duration: 720,
        stacks: { max: 2, refresh: 'all' },
      },
    ],
  },
  {
    // Sacrificer's Staff (as kqmsim sacrificersstaff.go, but 6 s as the game says, not its 5 s): a
    // stack per Skill hit of the wielder, off the field too, up to 3, all refreshed
    weapon: 'SacrificersStaff',
    timed: [
      {
        cond: 'passive',
        on: [{ kind: 'hit', tags: ['skill'] }],
        duration: 360,
        stacks: { max: 3, refresh: 'all' },
      },
    ],
  },
]
