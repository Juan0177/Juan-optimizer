import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { HEXEREI_CHARACTERS } from '../gearEffects'
import type { HitTag, SimContext, SimHit } from '../types'
import type { WeaponModule } from '../weaponEffects'

const damage = (hit: SimHit) =>
  !hit.path[0].startsWith('_') && hit.path[0] !== 'reaction'
const countValue = (n: number) => (n ? String(n) : '')
/** Preserve event order when another hit on the same frame changes the live state. */
function pin(hit: SimHit, path: string[], value: string) {
  const states = (hit.states ??= [])
  if (
    !states.some(
      (s) => s.owner === hit.characterKey && s.path.join('.') === path.join('.')
    )
  )
    states.push({ owner: hit.characterKey, path, value })
}
const polarTags: readonly HitTag[] = ['normal', 'charged', 'skill', 'burst']
const dawnTags = ['normal', 'skill', 'burst'] as const

/** Weapon audit bow3: adapted from kqmsim 7bdf45f2e (AGPLv3) and the game's text. */
export const bow3: WeaponModule[] = [
  {
    // Swirl refreshes 12 s of ATK, as kqmsim astralvulturescrimsonplumage.go;
    // include Stellar Swirl as required by the weapon text (missing from that subscription).
    weapon: 'AstralVulturesCrimsonPlumage',
    custom: ({ members, holds, window }) => {
      const path = ['AstralVulturesCrimsonPlumage', 'passive']
      const ends = new Map<CharacterKey, number>()
      return {
        declare() {
          for (const k of members.filter(holds)) window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holds(k)) return
          const frame = ctx.characterFrame(k)
          if (damage(hit))
            pin(hit, path, frame < (ends.get(k) ?? 0) ? 'on' : '')
          if (
            hit.onField !== k ||
            hit.path[0] !== '_reaction' ||
            ![
              'pyroSwirl',
              'hydroSwirl',
              'electroSwirl',
              'cryoSwirl',
              'stellarSwirl',
            ].includes(hit.path[1])
          )
            return
          ends.set(k, frame + 720)
          ctx.buff(k, path, 'on', 0, 720, { recipient: k, hitlag: 'recipient' })
        },
      }
    },
  },
  {
    // Each on-field Normal/Charged/Skill/Burst hit refreshes only its category's
    // 12 s status, as kqmsim polarstar.go; the triggering hit uses the previous count.
    weapon: 'PolarStar',
    custom: ({ members, holds, window }) => {
      const path = ['PolarStar', 'GoldenMajesty']
      const categories = new Map<CharacterKey, Map<HitTag, number>>()
      const active = (ctx: SimContext, k: CharacterKey) =>
        [...(categories.get(k)?.values() ?? [])].filter(
          (end) => end > ctx.characterFrame(k)
        ).length
      return {
        declare() {
          for (const k of members.filter(holds)) window(k, path, '1', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holds(k) || !damage(hit)) return
          pin(hit, path, countValue(active(ctx, k)))
          if (hit.onField !== k || !polarTags.includes(hit.tag)) return
          let tags = categories.get(k)
          if (!tags) categories.set(k, (tags = new Map()))
          const expiry = ctx.characterFrame(k) + 720
          tags.set(hit.tag, expiry)
          ctx.state(k, path, countValue(active(ctx, k)))
          ctx.atCharacter(k, 720, (c) => {
            if (tags.get(hit.tag) !== expiry) return
            tags.delete(hit.tag)
            c.state(k, path, countValue(active(c, k)))
          })
        },
      }
    },
  },
  {
    // Independent preload/decay/recovery, as kqmsim daybreakchronicles.go; text adds
    // the per-type 0.1 s ICD and Secret Rite's recovery of all three categories.
    weapon: 'TheDaybreakChronicles',
    custom: ({ members, holds, window }) => {
      type Kind = (typeof dawnTags)[number]
      type Pool = { count: number; generation: number; ready: number }
      const pools = new Map<CharacterKey, Record<Kind, Pool>>()
      const path = (kind: Kind) => ['TheDaybreakChronicles', `${kind}Stacks`]
      const decay = (
        ctx: SimContext,
        k: CharacterKey,
        kind: Kind,
        delay: number
      ) => {
        const pool = pools.get(k)![kind]
        const generation = ++pool.generation
        const tick = (c: SimContext) => {
          if (pool.generation !== generation) return
          pool.count = Math.max(0, pool.count - 1)
          c.state(k, path(kind), countValue(pool.count))
          if (pool.count) c.atCharacter(k, 60, tick)
        }
        if (pool.count) ctx.atCharacter(k, delay, tick)
      }
      const initialize = (ctx: SimContext) => {
        for (const k of members.filter(holds)) {
          if (pools.has(k)) continue
          ctx.note(
            'The Daybreak Chronicles assumes at least 3 s out of combat before frame 0; decay restarts after recovery, as kqmsim.'
          )
          const frame = ctx.characterFrame(k)
          const elapsed = Math.min(6, Math.floor(frame / 60))
          const pool = () => ({ count: 6 - elapsed, generation: 0, ready: 0 })
          pools.set(k, { normal: pool(), skill: pool(), burst: pool() })
          for (const kind of dawnTags) {
            // A leading wait has no weapon callback. Reconstruct its untouched preload decay.
            for (let i = 0; i < Math.min(6, Math.ceil(frame / 60)); i++)
              window(
                k,
                path(kind),
                String(6 - i),
                i * 60,
                Math.min(ctx.now, (i + 1) * 60)
              )
            ctx.state(k, path(kind), countValue(6 - elapsed))
            decay(ctx, k, kind, 60 - (frame % 60))
          }
        }
      }
      return {
        declare() {
          for (const k of members.filter(holds))
            for (const kind of dawnTags) window(k, path(kind), '6', 0, 0)
        },
        // Coordinator request: dispatch this before kit startup/cast snapshots. Until the
        // shared lifecycle exposes it, ordinary hit windows initialize at the first event.
        onStart: initialize,
        onAction: initialize,
        onHit(ctx, hit) {
          initialize(ctx)
          const k = hit.characterKey
          if (!holds(k) || !damage(hit)) return
          const poolsForOwner = pools.get(k)!
          const kind = dawnTags.find((tag) => tag === hit.tag)
          const frame = ctx.characterFrame(k)
          if (kind && frame >= poolsForOwner[kind].ready) {
            poolsForOwner[kind].ready = frame + 6
            const secretRite =
              members.filter((m) => HEXEREI_CHARACTERS.includes(m)).length >= 2
            for (const type of secretRite ? dawnTags : [kind]) {
              const pool = poolsForOwner[type]
              pool.count = Math.min(6, pool.count + (secretRite ? 2 : 1))
              ctx.state(k, path(type), String(pool.count))
              decay(ctx, k, type, 60)
            }
          }
          // (kqmsim adds the stack on OnEnemyHit, before the hit's attack mods: the hit counts its
          // own recovery)
          for (const type of dawnTags)
            pin(hit, path(type), countValue(poolsForOwner[type].count))
        },
      }
    },
  },
  {
    // Only explicit credited targetDied markers grant independently expiring cyclic
    // 30 s slots, as kqmsim common/blackcliff.go. Ordinary hits never imply a kill.
    weapon: 'BlackcliffWarbow',
    custom: ({ members, holds, window }) => {
      const path = ['BlackcliffWarbow', 'PressTheAdvantage']
      const slots = new Map<CharacterKey, { ends: number[]; next: number }>()
      const active = (ctx: SimContext, k: CharacterKey) =>
        (slots.get(k)?.ends ?? []).filter((end) => end > ctx.characterFrame(k))
          .length
      return {
        declare() {
          for (const k of members.filter(holds)) window(k, path, '1', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holds(k)) return
          if (damage(hit)) pin(hit, path, countValue(active(ctx, k)))
          if (hit.path.join('.') !== '_marker.targetDied' || hit.onField !== k)
            return
          let pool = slots.get(k)
          if (!pool) slots.set(k, (pool = { ends: [0, 0, 0], next: 0 }))
          const slot = pool.next
          pool.next = (slot + 1) % 3
          const expiry = ctx.characterFrame(k) + 1800
          pool.ends[slot] = expiry
          ctx.state(k, path, countValue(active(ctx, k)))
          ctx.atCharacter(k, 1800, (c) => {
            if (pool.ends[slot] !== expiry) return
            pool.ends[slot] = 0
            c.state(k, path, countValue(active(c, k)))
          })
        },
      }
    },
  },
  {
    // Normal/Charged hits gain up to four stacks and refresh the entire 6 s pool,
    // with an 18-frame acquisition ICD, as kqmsim compound.go (speed only when worn).
    weapon: 'CompoundBow',
    custom: ({ members, holds, wears, refinement, window }) => {
      const path = ['CompoundBow', 'InfusionArrow']
      const pools = new Map<
        CharacterKey,
        { count: number; end: number; ready: number; generation: number }
      >()
      return {
        declare() {
          for (const k of members.filter(holds)) window(k, path, '1', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holds(k) || !damage(hit)) return
          let pool = pools.get(k)
          if (!pool)
            pools.set(k, (pool = { count: 0, end: 0, ready: 0, generation: 0 }))
          const frame = ctx.characterFrame(k)
          if (frame >= pool.end) pool.count = 0
          pin(hit, path, countValue(pool.count))
          if (
            hit.onField !== k ||
            !['normal', 'charged'].includes(hit.tag) ||
            frame < pool.ready
          )
            return
          pool.count = Math.min(4, pool.count + 1)
          pool.end = frame + 360
          pool.ready = frame + 18
          const generation = ++pool.generation
          ctx.state(k, path, String(pool.count))
          ctx.atCharacter(k, 360, (c) => {
            if (pool.generation !== generation) return
            pool.count = 0
            c.state(k, path, '')
          })
          if (wears(k))
            ctx.modifyAttackSpeed(
              'CompoundBow',
              [0, 0.012, 0.015, 0.018, 0.021, 0.024][refinement(k)] *
                pool.count,
              360,
              k
            )
        },
      }
    },
  },
  {
    // On-field attack damage queues one trigger-snapshotted Physical HP proc,
    // once per 900 owner frames, as kqmsim sequenceofsolitude.go.
    weapon: 'SequenceOfSolitude',
    custom: ({ wears, ready }) => ({
      onHit(ctx, hit) {
        const k = hit.characterKey
        if (
          !wears(k) ||
          hit.onField !== k ||
          hit.path[0].startsWith('_') ||
          hit.path[0] === 'weapon:SequenceOfSolitude' ||
          !ready(`SequenceOfSolitude.${k}`, ctx.characterFrame(k), 900)
        )
          return
        ctx.hit(1, {
          characterKey: k,
          path: ['weapon:SequenceOfSolitude', 'dmg'],
          tag: 'other',
          element: 'physical',
          applies: false,
          snapshotDelay: 0,
          label: 'Sequence of Solitude Proc',
        })
      },
    }),
  },
  {
    // Nine trigger-snapshotted Physical ticks (+1 through +241), as kqmsim viridescent.go.
    // Use the engine's expected-timing chance credit; only a proc starts its 14–10 s ICD.
    weapon: 'TheViridescentHunt',
    custom: ({ wears, refinement }) => {
      const pools = new Map<CharacterKey, { credit: number; ready: number }>()
      return {
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            !wears(k) ||
            !damage(hit) ||
            hit.onField !== k ||
            !['normal', 'charged'].includes(hit.tag)
          )
            return
          let pool = pools.get(k)
          if (!pool) pools.set(k, (pool = { credit: 0, ready: 0 }))
          const frame = ctx.characterFrame(k)
          if (frame < pool.ready) return
          pool.credit += 0.5
          if (pool.credit < 1) return
          pool.credit -= 1
          pool.ready = frame + 900 - 60 * refinement(k)
          ctx.note(
            'The Viridescent Hunt uses expected timing (50% trigger credit) and assumes targets are grouped in its cyclone; enemy pull motion is not simulated.'
          )
          for (let i = 0; i <= 8; i++)
            ctx.hit(1 + 30 * i, {
              characterKey: k,
              path: ['weapon:TheViridescentHunt', 'dmg'],
              tag: 'other',
              element: 'physical',
              applies: false,
              snapshotDelay: 0,
              label: 'Viridescent Cyclone',
            })
        },
      }
    },
  },
]
