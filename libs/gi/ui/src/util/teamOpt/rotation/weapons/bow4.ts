import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { SimContext, SimHit } from '../types'
import type { WeaponModule } from '../weaponEffects'

const damage = (hit: SimHit) =>
  !hit.path[0].startsWith('_') && hit.path[0] !== 'reaction'

const isReaction = (hit: SimHit) =>
  (hit.path[0] === '_reaction' &&
    hit.path[1] !== 'moondrift' &&
    hit.path[1] !== 'moondriftHarmony') ||
  (hit.path[0] === 'reaction' &&
    (hit.path[1] === 'hyperbloom' || hit.path[1] === 'burgeon'))

const isStellarGlimmer = (hit: SimHit) =>
  (hit.path[0] === '_reaction' &&
    (hit.path[1] === 'stellarConduct' || hit.path[1] === 'stellarSwirl')) ||
  (hit.path[0] === 'reaction' && hit.path[1].startsWith('stellar')) ||
  (damage(hit) &&
    (hit.tag === 'directStellarConduct' || hit.tag === 'directStellarSwirl'))

/** Pin a hit's pre-trigger state so same-frame procs do not apply retroactively. */
function pin(hit: SimHit, path: string[], value: string) {
  const states = (hit.states ??= [])
  if (
    !states.some(
      (s) => s.owner === hit.characterKey && s.path.join('.') === path.join('.')
    )
  )
    states.push({ owner: hit.characterKey, path, value })
}

/** Skill/Burst stackers that consume all stacks to grant a hitlag-extended party buff. */
function skillBurstPartyBuff({
  weapon,
  cond,
  needed,
  icd,
  lockout,
  duration,
}: {
  weapon: string
  cond: string
  needed: number
  icd: number
  lockout: number
  duration: number
}): WeaponModule {
  const path = [weapon, cond]
  return {
    weapon,
    custom: ({ members, holds, window }) => {
      const holders = members.filter(holds)
      const state = new Map<
        CharacterKey,
        { stacks: number; icdUntil: number; lockUntil: number }
      >()
      return {
        declare() {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            !holders.includes(k) ||
            !damage(hit) ||
            (hit.tag !== 'skill' && hit.tag !== 'burst')
          )
            return
          const frame = ctx.characterFrame(k)
          let s = state.get(k)
          if (!s)
            state.set(
              k,
              (s = {
                stacks: 0,
                icdUntil: Number.NEGATIVE_INFINITY,
                lockUntil: Number.NEGATIVE_INFINITY,
              })
            )
          if (frame < s.lockUntil || frame < s.icdUntil) return
          s.icdUntil = frame + icd
          if (++s.stacks < needed) return
          s.stacks = 0
          s.lockUntil = frame + lockout
          pin(hit, path, '')
          ctx.buff(k, path, 'on', 0, duration, { hitlag: 'recipient' })
        },
      }
    },
  }
}

/** On-field Elemental Skill buff on the wielder's hitlag-paused clock. */
function onFieldSkillBuff(
  weapon: string,
  cond: string,
  duration: number
): WeaponModule {
  const path = [weapon, cond]
  return {
    weapon,
    custom: ({ members, holds, window, onFieldAt }) => {
      const holders = members.filter(holds)
      return {
        declare() {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onAction(ctx, actor, action) {
          if (
            action.kind === 'skill' &&
            holders.includes(actor) &&
            onFieldAt(ctx.now) === actor
          )
            ctx.buff(actor, path, 'on', 0, duration, {
              recipient: actor,
              hitlag: 'recipient',
            })
        },
      }
    },
  }
}

/**
 * White Crown's Bequest (game text; no reference sim): for 6 s after the wielder's Skill or Burst,
 * extended by 3 s per Stellar Glimmer reaction or Stellar Glimmer DMG while it lasts (once per
 * 0.1 s, up to 8 times an instance), on the wielder's clock; a new Skill or Burst starts a new
 * instance. Written for any weapon key, so that the beta weapon's name is on one line only.
 */
function whiteCrown(weapon: string): WeaponModule {
  const path = [weapon, 'whiteCrownsBequest']
  return {
    weapon,
    custom: ({ members, holds, window }) => {
      const holders = members.filter(holds)
      const active = new Map<
        CharacterKey,
        {
          start: number
          ownEnd: number
          ext: number
          icdUntil: number
          gen: number
        }
      >()
      const scheduleClose = (
        ctx: SimContext,
        k: CharacterKey,
        entry: NonNullable<ReturnType<typeof active.get>>,
        delay: number
      ) => {
        const gen = entry.gen
        ctx.atCharacter(k, delay, (at) => {
          if (active.get(k) !== entry || entry.gen !== gen) return
          active.delete(k)
          window(k, path, 'on', entry.start, at.now)
        })
      }
      return {
        declare() {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onAction(ctx, actor, action) {
          if (
            (action.kind !== 'skill' && action.kind !== 'burst') ||
            !holders.includes(actor)
          )
            return
          const prev = active.get(actor)
          if (prev && ctx.now > prev.start)
            window(actor, path, 'on', prev.start, ctx.now)
          const own = ctx.characterFrame(actor)
          const entry = {
            start: ctx.now,
            ownEnd: own + 360,
            ext: 0,
            icdUntil: Number.NEGATIVE_INFINITY,
            gen: 0,
          }
          active.set(actor, entry)
          scheduleClose(ctx, actor, entry, 360)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holders.includes(k) || !isStellarGlimmer(hit)) return
          const entry = active.get(k)
          if (!entry) return
          const own = ctx.characterFrame(k)
          if (own >= entry.ownEnd || entry.ext >= 8 || own < entry.icdUntil)
            return
          entry.ext++
          entry.icdUntil = own + 6
          entry.ownEnd += 180
          entry.gen++
          scheduleClose(ctx, k, entry, entry.ownEnd - own)
        },
        end(t) {
          for (const [k, entry] of active)
            if (t > entry.start) window(k, path, 'on', entry.start, t)
          active.clear()
        },
      }
    },
  }
}

/** Beta weapons, one complete entry per line (the released-only build drops these lines) */
const BETA: Record<string, WeaponModule> = {
  Silverdawn: whiteCrown('Silverdawn'),
}

const modules: WeaponModule[] = [
  // Elegy for the End (kqmsim elegy.go): 4 Skill/Burst hits (0.2 s ICD, on/off-field) grant
  // the party Farewell Song for 12 s (hitlag-extended per recipient), then a 20 s lockout.
  skillBurstPartyBuff({
    weapon: 'ElegyForTheEnd',
    cond: 'ThePartingRefrain',
    needed: 4,
    icd: 12,
    lockout: 1200,
    duration: 720,
  }),

  // Breezeborne Refrain (game text; no reference sim): 3 Skill/Burst hits (0.03 s = 2f ICD,
  // on/off-field) grant the party Thus Lied the Viper for 12 s; no stacks while active.
  skillBurstPartyBuff({
    weapon: 'BreezeborneRefrain',
    cond: 'viper',
    needed: 3,
    icd: 2,
    lockout: 720,
    duration: 720,
  }),

  // Covenant of Frost and Snow (kqmsim covenantoffrostandsnow.go): +EM for 12 s after on-field Skill.
  onFieldSkillBuff('CovenantOfFrostAndSnow', 'passive', 720),

  // Flower-Wreathed Feathers (kqmsim flowerwreathedfeathers.go): +1 stack per Aimed Shot
  // (0.5 s ICD, max 6), all refreshed for 10 s after leaving Aiming Mode / swapping out.
  {
    weapon: 'FlowerWreathedFeathers',
    timed: [
      {
        cond: 'passive',
        on: [{ kind: 'action', actions: ['charged'] }],
        duration: 600,
        icd: 30,
        stacks: { max: 6, refresh: 'all' },
      },
    ],
  },

  // King's Squire (kqmsim kingssquire.go): on-field Skill/Burst (20 s ICD) grants +EM for 12 s
  // (hitlag-extended), removed on swap-out; emits 100–180% ATK Physical proc on end or swap-out.
  {
    weapon: 'KingsSquire',
    custom: ({ members, holds, wears, window, onFieldAt }) => {
      const path = ['KingsSquire', 'passive']
      const holders = members.filter(holds)
      const cdUntil = new Map<CharacterKey, number>()
      const active = new Map<
        CharacterKey,
        { start: number; ctx: SimContext; open: boolean }
      >()
      const emitProc = (ctx: SimContext, k: CharacterKey, delay: number) => {
        if (!wears(k)) return
        ctx.hit(delay, {
          characterKey: k,
          path: ['weapon:KingsSquire', 'dmg'],
          tag: 'other',
          element: 'physical',
          applies: false,
          label: "King's Squire",
        })
      }
      return {
        declare() {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onAction(ctx, actor, action) {
          if (
            (action.kind !== 'skill' && action.kind !== 'burst') ||
            !holders.includes(actor) ||
            onFieldAt(ctx.now) !== actor
          )
            return
          const own = ctx.characterFrame(actor)
          if (own < (cdUntil.get(actor) ?? Number.NEGATIVE_INFINITY)) return
          cdUntil.set(actor, own + 1200)
          const entry = { start: ctx.now, ctx, open: true }
          active.set(actor, entry)
          ctx.atCharacter(actor, 720, (at) => {
            if (!entry.open) return
            entry.open = false
            active.delete(actor)
            window(actor, path, 'on', entry.start, at.now)
            emitProc(at, actor, 1)
          })
        },
        onSwap(t, from, _to, ctx) {
          const entry = active.get(from)
          if (!entry?.open) return
          entry.open = false
          active.delete(from)
          if (t > entry.start) window(from, path, 'on', entry.start, t)
          // (kqmsim: the proc is queued at the swap, 1 frame later)
          if (ctx) emitProc(ctx, from, 1)
          else emitProc(entry.ctx, from, t - entry.ctx.now + 1)
        },
        end(t) {
          for (const [k, entry] of active)
            if (entry.open && t > entry.start)
              window(k, path, 'on', entry.start, t)
          active.clear()
        },
      }
    },
  },

  // Snare Hook (kqmsim snarehook.go): +EM for 12 s (hitlag-extended) on any reaction (on/off-field).
  {
    weapon: 'SnareHook',
    custom: ({ members, holds, window }) => {
      const path = ['SnareHook', 'afterReaction']
      const holders = members.filter(holds)
      const ends = new Map<CharacterKey, number>()
      return {
        declare() {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holders.includes(k)) return
          const frame = ctx.characterFrame(k)
          if (damage(hit))
            pin(hit, path, frame < (ends.get(k) ?? 0) ? 'on' : '')
          if (!isReaction(hit)) return
          ends.set(k, frame + 720)
          ctx.buff(k, path, 'on', 0, 720, {
            recipient: k,
            hitlag: 'recipient',
          })
        },
      }
    },
  },

  // Windblume Ode (kqmsim windblume.go): +ATK for 6 s after on-field Skill.
  onFieldSkillBuff('WindblumeOde', 'WindblumeWish', 360),
]

/** Weapon audit batch bow4 (2026-11-16), as kqmsim and the game's text */
export const bow4: WeaponModule[] = [...modules, ...Object.values(BETA)]
