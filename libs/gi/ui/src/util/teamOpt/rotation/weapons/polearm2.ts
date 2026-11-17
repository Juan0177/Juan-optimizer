import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { SimContext } from '../types'
import { healedBy, type WeaponModule } from '../weaponEffects'

/** Reaction marks that are no gcsim reaction event (Moondrift) */
const NOT_REACTIONS = ['moondrift', 'moondriftHarmony']

/** Weapon audit batch polearm2 (2026-11-16), as kqmsim and the game's text */
export const polearm2: WeaponModule[] = [
  {
    // Calamity Queller (kqmsim calamity.go): Consummation for 20 s after the wielder's Skill on the
    // field, a stack each second from 1 s after it, up to 6 (the sheet doubles it off the field); a
    // new Skill keeps the stacks, and 20 s after the last one they reset (on the wielder's clock)
    weapon: 'CalamityQueller',
    custom: ({ members, holds, window }) => {
      const path = ['CalamityQueller', 'stack']
      const held = new Map<CharacterKey, { count: number; last: number }>()
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, '1', 0, 0)
        },
        onAction: (ctx, actor, action) => {
          if (action.kind !== 'skill' || ctx.onField !== actor || !holds(actor))
            return
          const s = held.get(actor) ?? { count: 0, last: -1 }
          held.set(actor, s)
          const cast = ctx.now
          s.last = cast
          // (kqmsim: each Skill starts its own chain of 1 s gains while below 6)
          const gain = (at: SimContext) => {
            if (s.count >= 6) return
            s.count++
            at.state(actor, path, `${s.count}`)
            if (s.count < 6) at.atCharacter(actor, 60, gain)
          }
          ctx.atCharacter(actor, 60, gain)
          ctx.atCharacter(actor, 1200, (at) => {
            if (s.last !== cast) return
            s.count = 0
            at.state(actor, path, '')
          })
        },
      }
    },
  },
  {
    // Engulfing Lightning (kqmsim engulfing.go): ER +30–50% for 12 s after the wielder's Burst
    weapon: 'EngulfingLightning',
    timed: [
      {
        cond: 'TimelessDream',
        on: [{ kind: 'action', actions: ['burst'] }],
        duration: 720,
      },
    ],
  },
  {
    // Primordial Jade Winged-Spear (kqmsim primordial.go): each damage instance the wielder deals
    // on the field (reaction damage too), once per 0.3 s on its clock, a stack for 6 s, all
    // refreshed, up to 7 (DMG at 7); granted after the hit's damage
    weapon: 'PrimordialJadeWingedSpear',
    custom: ({ members, holds, window, stack, ready }) => {
      const path = ['PrimordialJadeWingedSpear', 'stack']
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, '1', 0, 0)
        },
        onHit: (ctx, hit) => {
          const k = hit.characterKey
          if (hit.path[0].startsWith('_') || hit.onField !== k || !holds(k))
            return
          if (
            !ready(`PrimordialJadeWingedSpear.${k}`, ctx.characterFrame(k), 18)
          )
            return
          stack(k, path, hit.t + 1, 360, 7)
        },
      }
    },
  },
  {
    // Staff of the Scarlet Sands (kqmsim scarletsands.go): the wielder's Skill hits on the field, a
    // stack for 10 s, all refreshed, up to 3; at most 3 gains per 0.3 s (its clock); after the hit
    weapon: 'StaffOfTheScarletSands',
    custom: ({ members, holds, window, stack }) => {
      const path = ['StaffOfTheScarletSands', 'stacks']
      const gains = new Map<CharacterKey, number[]>()
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, '1', 0, 0)
        },
        onHit: (ctx, hit) => {
          const k = hit.characterKey
          if (
            hit.tag !== 'skill' ||
            hit.path[0].startsWith('_') ||
            hit.path[0] === 'reaction' ||
            hit.onField !== k ||
            !holds(k)
          )
            return
          const own = ctx.characterFrame(k)
          const recent = (gains.get(k) ?? []).filter((f) => f > own - 18)
          gains.set(k, recent)
          if (recent.length >= 3) return
          recent.push(own)
          stack(k, path, hit.t + 1, 600, 3)
        },
      }
    },
  },
  {
    // Dragonspine Spear (kqmsim dragonspine.go): the wielder's Normal or Charged hit on the field,
    // once per 10 s (its clock, from a proc), procs at 60–100% (gathered as credit): an Everfrost
    // Icicle 1 frame later, Physical 80–140% ATK, 200–360% on an enemy with Cryo or Frozen
    weapon: 'DragonspineSpear',
    custom: ({ wears, refinement }) => {
      const credit = new Map<CharacterKey, number>()
      const readyAt = new Map<CharacterKey, number>()
      return {
        onHit: (ctx, hit) => {
          const k = hit.characterKey
          if (
            (hit.tag !== 'normal' && hit.tag !== 'charged') ||
            hit.path[0].startsWith('_') ||
            hit.path[0] === 'reaction' ||
            hit.onField !== k ||
            !wears(k)
          )
            return
          const own = ctx.characterFrame(k)
          if (own < (readyAt.get(k) ?? Number.NEGATIVE_INFINITY)) return
          const c = (credit.get(k) ?? 0) + 0.5 + 0.1 * refinement(k)
          if (c < 1 - 1e-9) {
            credit.set(k, c)
            return
          }
          credit.set(k, c - 1)
          readyAt.set(k, own + 600)
          // (the aura after the triggering hit's own application, as kqmsim's OnEnemyDamage)
          const cryo = ctx.absorb(['cryo']) === 'cryo'
          ctx.hit(1, {
            characterKey: k,
            path: ['weapon:DragonspineSpear', cryo ? 'dmgOnCryoOp' : 'dmgAoe'],
            tag: 'other',
            element: 'physical',
            applies: false,
            label: 'Everfrost Icicle',
          })
        },
      }
    },
  },
  {
    // Missive Windspear (kqmsim missive.go): ATK and EM for 10 s (hitlag-extended) after the
    // wielder triggers any reaction while on the field; after the triggering hit
    weapon: 'MissiveWindspear',
    custom: ({ members, holds, window }) => {
      const path = ['MissiveWindspear', 'passive']
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, 'on', 0, 0)
        },
        onHit: (ctx, hit) => {
          const k = hit.characterKey
          const [kind, reaction = ''] = hit.path
          const reacted =
            (kind === '_reaction' && !NOT_REACTIONS.includes(reaction)) ||
            // (Hyperbloom and Burgeon have no mark: their damage)
            (kind === 'reaction' &&
              (reaction === 'hyperbloom' || reaction === 'burgeon'))
          if (!reacted || hit.onField !== k || !holds(k)) return
          ctx.buff(k, path, 'on', 1, 600, { recipient: k, hitlag: 'recipient' })
        },
      }
    },
  },
  {
    // Prospector's Drill (kqmsim prospectorsdrill.go): a Unity's Symbol per heal event the wielder
    // gives (one per target) or receives, off the field too, up to 3, all lost 30 s after the last;
    // its Skill or Burst on the field consumes them for Struggle (per Symbol) for 10 s, once per
    // 15 s (the cooldown starts only when Symbols are consumed)
    weapon: 'ProspectorsDrill',
    custom: ({ members, holds, window, ready, onFieldAt }) => {
      const path = ['ProspectorsDrill', 'marksConsumed']
      const symbols = new Map<CharacterKey, { n: number; until: number }>()
      return {
        declare: () => {
          for (const k of members) if (holds(k)) window(k, path, '1', 0, 0)
        },
        onHit: (ctx, hit) => {
          if (hit.path[0] !== '_heal') return
          const healed = healedBy(hit, members, onFieldAt(hit.t))
          for (const m of members) {
            if (!holds(m)) continue
            const gained =
              m === hit.characterKey
                ? healed.length
                : healed.includes(m)
                  ? 1
                  : 0
            if (!gained) continue
            const own = ctx.characterFrame(m)
            const s = symbols.get(m)
            const n = s && own < s.until ? s.n : 0
            symbols.set(m, { n: Math.min(3, n + gained), until: own + 1800 })
          }
        },
        onAction: (ctx, actor, action) => {
          if (
            (action.kind !== 'skill' && action.kind !== 'burst') ||
            ctx.onField !== actor ||
            !holds(actor)
          )
            return
          const own = ctx.characterFrame(actor)
          const s = symbols.get(actor)
          if (!s || s.n <= 0 || own >= s.until) return
          if (!ready(`ProspectorsDrill.${actor}`, own, 900)) return
          symbols.delete(actor)
          ctx.buff(actor, path, `${s.n}`, 0, 600, {
            recipient: actor,
            hitlag: 'recipient',
          })
        },
      }
    },
  },
  {
    // Song of the Vigil (kqmsim songofthevigil.go): ATK +20–40% for 12 s after the wielder
    // triggers Stellar-Conduct or Stellar Swirl (off the field too); after the triggering hit.
    // (Its Energy per reaction is the ER calculator's.)
    weapon: 'SongOfTheVigil',
    timed: [
      {
        cond: 'stellar',
        on: [
          { kind: 'reaction', reactions: ['stellarConduct', 'stellarSwirl'] },
        ],
        duration: 720,
        delay: 1,
      },
    ],
  },
]
