import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { SimContext, SimHit } from '../types'
import { isReactionEvent, type WeaponModule } from '../weaponEffects'

const damage = (hit: SimHit) =>
  !hit.path[0].startsWith('_') && hit.path[0] !== 'reaction'

/** Keep a damage-triggered buff out of the hit that first grants it. */
function beforeTrigger(
  ctx: SimContext,
  hit: SimHit,
  path: string[],
  value?: string
) {
  const owner = hit.characterKey
  // (a snapshot only when the caller does not know the value: it scans every window)
  const previous =
    value ??
    ctx
      .snapshot(owner)
      .states?.find(
        (s) => s.owner === owner && s.path.join('.') === path.join('.')
      )?.value
  ;(hit.states ??= []).push({ owner, path, value: previous ?? '' })
}

/** Claymore buff timelines and Everfrost, adapted from kqmsim's claymore weapon files below. */
export const claymore2: WeaponModule[] = [
  {
    // Four Winds: +1 per Normal hit, +2 per Skill/Charged start, shared 4 s expiry;
    // as kqmsim gestofthemightywolf.go, with the game's 0.01 s trigger guard.
    weapon: 'GestOfTheMightyWolf',
    custom: (api) => {
      const path = ['GestOfTheMightyWolf', 'stacks']
      const counts = new Map<CharacterKey, number>()
      const expires = new Map<CharacterKey, number>()
      const versions = new Map<CharacterKey, number>()
      const gain = (ctx: SimContext, k: CharacterKey, n: number) => {
        if (!api.ready(`gest.${k}`, ctx.now, 0.6)) return
        const previous =
          ctx.now < (expires.get(k) ?? -1) ? (counts.get(k) ?? 0) : 0
        const count = Math.min(4, previous + n)
        counts.set(k, count)
        expires.set(k, ctx.now + 240)
        ctx.state(k, path, `${count}`)
        const version = (versions.get(k) ?? 0) + 1
        versions.set(k, version)
        // The pinned reference uses world time for this particular modifier.
        ctx.at(240, (at) => {
          if (versions.get(k) !== version) return
          counts.set(k, 0)
          at.state(k, path, '')
        })
      }
      return {
        declare() {
          for (const k of api.members.filter(api.holds)) {
            api.window(k, path, '1', 0, 0)
            if (api.wears(k))
              api.window(
                k,
                ['GestOfTheMightyWolf', '_selfAttackSpeed'],
                '0.1',
                0,
                Number.MAX_SAFE_INTEGER
              )
          }
        },
        onAction(ctx, k, action) {
          if (
            api.holds(k) &&
            ctx.onField === k &&
            (action.kind === 'skill' || action.kind === 'charged')
          )
            gain(ctx, k, 2)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            !api.holds(k) ||
            hit.onField !== k ||
            hit.tag !== 'normal' ||
            !damage(hit)
          )
            return
          beforeTrigger(
            ctx,
            hit,
            path,
            hit.t < (expires.get(k) ?? -1) ? `${counts.get(k) ?? 0}` : ''
          )
          gain(ctx, k, 1)
        },
      }
    },
  },
  {
    // Four on-field Normal/Charged hits grant 12 s of party Banner-Hymn, then a
    // 20 s Sigil lockout; as kqmsim pines.go (18-frame acquisition ICD).
    weapon: 'SongOfBrokenPines',
    custom: (api) => {
      const path = ['SongOfBrokenPines', 'RebelsBannerHymn']
      const sigils = new Map<CharacterKey, number>()
      const lockedUntil = new Map<CharacterKey, number>()
      return {
        declare() {
          for (const k of api.members.filter(api.holds))
            api.window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            !api.holds(k) ||
            hit.onField !== k ||
            !damage(hit) ||
            (hit.tag !== 'normal' && hit.tag !== 'charged')
          )
            return
          const clock = ctx.characterFrame(k)
          if (
            clock < (lockedUntil.get(k) ?? -1) ||
            !api.ready(`pines.sigil.${k}`, clock, 18)
          )
            return
          const count = (sigils.get(k) ?? 0) + 1
          sigils.set(k, count % 4)
          if (count !== 4) return
          beforeTrigger(ctx, hit, path)
          lockedUntil.set(k, clock + 1200)
          for (const recipient of api.members) {
            ctx.buff(k, path, 'on', 0, 720, {
              recipient,
              hitlag: 'recipient',
            })
            // Shared normal-speed reader requested in shared/claymore2.md.
            if (api.wears(k))
              ctx.buff(
                k,
                ['SongOfBrokenPines', '_normalAttackSpeed'],
                `${0.09 + 0.03 * api.refinement(k)}`,
                0,
                720,
                { recipient, hitlag: 'recipient' }
              )
          }
        },
      }
    },
  },
  {
    // Seals from party Lunar-Crystallize or a confirmed Crystallize shield pickup,
    // consumed 12 wearer frames after Skill damage; as kqmsim verdict.go.
    weapon: 'Verdict',
    custom: (api) => {
      const path = ['Verdict', 'seals']
      const counts = new Map<CharacterKey, number>()
      const expires = new Map<CharacterKey, number>()
      const versions = new Map<CharacterKey, number>()
      const consuming = new Set<CharacterKey>()
      const clear = (ctx: SimContext, k: CharacterKey) => {
        counts.set(k, 0)
        expires.delete(k)
        versions.set(k, (versions.get(k) ?? 0) + 1)
        ctx.state(k, path, '')
      }
      return {
        declare() {
          for (const k of api.members.filter(api.holds))
            api.window(k, path, '1', 0, 0)
        },
        onHit(ctx, hit) {
          const lunar =
            hit.path[0] === '_reaction' && hit.path[1] === 'lunarCrystallize'
          const pickup =
            hit.path[0] === '_marker' &&
            hit.path[1] === 'shield' &&
            hit.path[4] === 'crystallize'
          for (const k of api.members.filter(api.holds)) {
            const clock = ctx.characterFrame(k)
            if ((counts.get(k) ?? 0) > 0 && clock >= (expires.get(k) ?? -1))
              clear(ctx, k)
            if (
              pickup ||
              (lunar && api.ready(`verdict.lunar.${k}`, clock, 60))
            ) {
              const count = Math.min(2, (counts.get(k) ?? 0) + 1)
              counts.set(k, count)
              expires.set(k, clock + 900)
              ctx.state(k, path, `${count}`)
              const version = (versions.get(k) ?? 0) + 1
              versions.set(k, version)
              ctx.atCharacter(k, 900, (at) => {
                if (versions.get(k) === version) clear(at, k)
              })
            }
            if (
              hit.characterKey === k &&
              damage(hit) &&
              hit.tag === 'skill' &&
              (counts.get(k) ?? 0) > 0 &&
              !consuming.has(k)
            ) {
              consuming.add(k)
              ctx.atCharacter(k, 12, (at) => {
                clear(at, k)
                consuming.delete(k)
              })
            }
          }
        },
      }
    },
  },
  {
    // Any party Pyro reaction refreshes the wielder's 8 s Skill bonus, off field
    // too; as kqmsim earthshaker.go. Pyro damage alone is not a trigger; Burgeon has no
    // reaction mark (its damage is the event).
    weapon: 'EarthShaker',
    custom: (api) => {
      const path = ['EarthShaker', 'pyroReaction']
      return {
        declare() {
          for (const k of api.members.filter(api.holds))
            api.window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const reaction = hit.path[1]
          const burgeon = hit.path[0] === 'reaction' && reaction === 'burgeon'
          if (
            !burgeon &&
            (hit.path[0] !== '_reaction' ||
              (![
                'overloaded',
                'vaporize',
                'melt',
                'pyroSwirl',
                'burning',
              ].includes(reaction) &&
                !(reaction === 'crystallize' && hit.element === 'pyro')))
          )
            return
          for (const k of api.members.filter(api.holds))
            ctx.buff(k, path, 'on', 0, 480, {
              recipient: k,
              hitlag: 'recipient',
            })
        },
      }
    },
  },
  {
    // Own on-field Skill damage or an elemental reaction (Shatter, Hyperbloom and Burgeon
    // too) refreshes ATK/EM for 8 s; as kqmsim mailedflower.go.
    weapon: 'MailedFlower',
    custom: (api) => {
      const path = ['MailedFlower', 'passive']
      return {
        declare() {
          for (const k of api.members.filter(api.holds))
            api.window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!api.holds(k) || hit.onField !== k) return
          const skill = damage(hit) && hit.tag === 'skill'
          const reaction = isReactionEvent(hit)
          if (!skill && !reaction) return
          if (skill) beforeTrigger(ctx, hit, path)
          ctx.buff(k, path, 'on', 0, 480, {
            recipient: k,
            hitlag: 'recipient',
          })
        },
      }
    },
  },
  {
    // One Physical Icicle, stronger against Cryo/Frozen; as kqmsim starsilver.go.
    // Chance credit follows weaponEffects' expected timing; only a proc starts its 10 s ICD.
    weapon: 'SnowTombedStarsilver',
    custom: (api) => {
      const credit = new Map<CharacterKey, number>()
      const readyAt = new Map<CharacterKey, number>()
      return {
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            !api.wears(k) ||
            hit.onField !== k ||
            !damage(hit) ||
            (hit.tag !== 'normal' && hit.tag !== 'charged')
          )
            return
          const clock = ctx.characterFrame(k)
          if (clock < (readyAt.get(k) ?? -1)) return
          const next = (credit.get(k) ?? 0) + 0.5 + 0.1 * api.refinement(k)
          if (next < 1 - 1e-9) {
            credit.set(k, next)
            return
          }
          credit.set(k, next - 1)
          readyAt.set(k, clock + 600)
          ctx.hit(1, {
            characterKey: k,
            path: [
              'weapon:SnowTombedStarsilver',
              ctx.absorb(['cryo']) === 'cryo' || ctx.isFrozen
                ? 'dmgOnCryoOp'
                : 'dmgAoe',
            ],
            tag: 'other',
            element: 'physical',
            applies: false,
            snapshotDelay: 0,
            label: 'Everfrost Icicle',
          })
        },
      }
    },
  },
]
