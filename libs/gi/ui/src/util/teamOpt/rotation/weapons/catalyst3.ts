import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type { SimContext, SimHit, SimSnapshot } from '../types'
import type { WeaponApi, WeaponModule } from '../weaponEffects'

/** Weapon audit batch catalyst3 (2026-11-16), as kqmsim and the game's text */
export const catalyst3: WeaponModule[] = [
  {
    // Shared HP-change stacks, as kqmsim cashflow/cashflow.go. The separate speed state
    // awaits the shared simulator's Normal-only speed accessor (coordinator request).
    weapon: 'CashflowSupervision',
    custom: (api) => {
      const stacks = clockedState(api, 'CashflowSupervision', 'hpChanges')
      const speed = clockedState(
        api,
        'CashflowSupervision',
        '_normalAttackSpeed'
      )
      return {
        declare: () => {
          stacks.declare('1')
          speed.declare()
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!api.holds(k)) return
          if (isDamage(hit)) stacks.capture(ctx, hit, k, false)
          if (
            hit.path[0] !== '_marker' ||
            hit.path[1] !== 'hpChange' ||
            hit.onField !== k ||
            !api.ready(`cashflow.${k}`, ctx.characterFrame(k), 19)
          )
            return
          const count = Math.min(3, Number(stacks.read(ctx, k)) + 1)
          stacks.set(ctx, k, String(count), 240)
          if (api.wears(k))
            speed.set(
              ctx,
              k,
              count === 3 ? String(0.06 + 0.02 * api.refinement(k)) : '',
              240
            )
        },
      }
    },
  },
  {
    // Burst/shield Regalia and replaceable energy callback, as kqmsim
    // jadefallssplendor/jadefallssplendor.go (142 frames; game text says 150).
    weapon: 'JadefallsSplendor',
    custom: (api) => {
      const regalia = clockedState(api, 'JadefallsSplendor', 'condPassive')
      const history = new Map<
        CharacterKey,
        { start: number; end: number; snapshot: SimSnapshot }[]
      >()
      const activate = (ctx: SimContext, k: CharacterKey) => {
        regalia.set(ctx, k, 'on', 180)
        const entries = history.get(k) ?? []
        const previous = entries[entries.length - 1]
        if (previous) previous.end = Math.min(previous.end, ctx.now)
        const entry = {
          start: ctx.now,
          end: Number.POSITIVE_INFINITY,
          snapshot: ctx.snapshot(k),
        }
        entries.push(entry)
        history.set(k, entries)
        // (its stat modifier no longer applies on its expiry frame)
        ctx.atCharacter(k, 180, (at) => {
          entry.end = Math.min(entry.end, at.now)
        })
        if (api.wears(k))
          ctx.atCharacter(k, 142, (at) => {
            if (entries[entries.length - 1] !== entry) return
            at.hit(0, {
              characterKey: k,
              path: ['_marker', 'weaponEnergy', 'JadefallsSplendor'],
              tag: 'other',
              element: 'physical',
              label: "Jadefall's Splendor Energy",
            })
          })
      }
      return {
        declare: () => regalia.declare(),
        onAction(ctx, actor, action) {
          if (
            api.holds(actor) &&
            ctx.onField === actor &&
            action.kind === 'burst'
          )
            activate(ctx, actor)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!api.holds(k)) return
          if (hit.path[0] === '_marker' && hit.path[1] === 'shield') {
            activate(ctx, k)
            return
          }
          if (!isDamage(hit)) return
          const stat = `${getCharEle(k)}_dmg_` as const
          const t =
            hit.statSnapshots?.find(
              (s) => s.stat === stat && s.path.join('.') === `total.${stat}`
            )?.t ??
            hit.snapshotT ??
            hit.t
          const entry = [...(history.get(k) ?? [])]
            .reverse()
            .find((e) => e.start <= t && t < e.end)
          preserve(hit, k, regalia.path, entry ? 'on' : '')
          if (entry)
            (hit.statSnapshots ??= []).push({
              ...entry.snapshot,
              characterKey: k,
              recipient: k,
              stat,
              path: ['display', 'weapon:JadefallsSplendor', stat],
            })
        },
      }
    },
  },
  {
    // Independent holder-clock Prayer/Verse statuses, as kqmsim nightweavers/nightweavers.go.
    // The sheet supplies holder EM and the nonstacking team bonus during their overlap (which
    // kqmsim reads through StatusIsActive: through the expiry frame).
    weapon: 'NightweaversLookingGlass',
    custom: (api) => {
      const prayer = clockedState(
        api,
        'NightweaversLookingGlass',
        'afterHydroOrDendro',
        true
      )
      const verse = clockedState(
        api,
        'NightweaversLookingGlass',
        'afterLunarBloom',
        true
      )
      return {
        declare: () => {
          prayer.declare()
          verse.declare()
        },
        onHit(ctx, hit) {
          if (isDamage(hit))
            for (const holder of api.members.filter(api.holds)) {
              prayer.capture(ctx, hit, holder)
              verse.capture(ctx, hit, holder)
            }
          if (
            api.holds(hit.characterKey) &&
            isDamage(hit) &&
            hit.tag === 'skill' &&
            (hit.element === 'hydro' || hit.element === 'dendro')
          )
            prayer.set(ctx, hit.characterKey, 'on', 270)
          if (hit.path[0] === '_reaction' && hit.path[1] === 'lunarBloom')
            for (const holder of api.members.filter(api.holds))
              verse.set(ctx, holder, 'on', 600)
        },
      }
    },
  },
  {
    // Six cloud hits retain their summon snapshot across swaps, as kqmsim skyward/skyward.go.
    weapon: 'SkywardAtlas',
    custom: (api) => {
      const ready = new Map<CharacterKey, number>()
      return {
        onHit(ctx, hit) {
          const k = hit.characterKey
          const own = ctx.characterFrame(k)
          if (
            !api.wears(k) ||
            !isDamage(hit) ||
            hit.tag !== 'normal' ||
            hit.onField !== k ||
            own <= (ready.get(k) ?? Number.NEGATIVE_INFINITY) ||
            ctx.random() < 0.5
          )
            return
          ready.set(k, own + 1800)
          for (let i = 1; i <= 6; i++)
            ctx.hit(i * 147 + 10, {
              characterKey: k,
              path: ['weapon:SkywardAtlas', 'dmg'],
              tag: 'other',
              element: 'physical',
              applies: false,
              snapshotDelay: 0,
              label: 'Skyward Atlas Proc',
            })
        },
      }
    },
  },
  {
    // Skill opens a consumable resource; Vaporize gains precede Normal losses, as kqmsim
    // surfsup/surfsup.go, including its temporary fifth stack (displayed at most four).
    weapon: 'SurfsUp',
    custom: (api) => {
      const stacks = clockedState(api, 'SurfsUp', 'stacks')
      const resources = new Map<CharacterKey, { count: number; end: number }>()
      const publish = (ctx: SimContext, k: CharacterKey) => {
        const resource = resources.get(k)!
        stacks.set(
          ctx,
          k,
          resource.count ? String(Math.min(4, resource.count)) : '',
          resource.end - ctx.characterFrame(k)
        )
      }
      return {
        declare: () => stacks.declare('1'),
        onAction(ctx, actor, action) {
          const own = ctx.characterFrame(actor)
          if (
            !api.holds(actor) ||
            ctx.onField !== actor ||
            action.kind !== 'skill' ||
            !api.ready(`surfsUp.activate.${actor}`, own, 901)
          )
            return
          resources.set(actor, { count: 4, end: own + 840 })
          publish(ctx, actor)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!api.holds(k) || !isDamage(hit)) return
          // Preserve damage before the reaction's gain or this Normal's consumption.
          stacks.capture(ctx, hit, k, false)
          const resource = resources.get(k)
          const own = ctx.characterFrame(k)
          if (!resource || own > resource.end || hit.onField !== k) return
          // The reaction engine flags the source hit before gear handlers, then queues a
          // marker. Reading the source avoids counting that later marker a second time.
          if (
            hit.reaction === 'vaporize' &&
            api.ready(`surfsUp.gain.${k}`, own, 91)
          ) {
            resource.count = Math.min(5, resource.count + 1)
            if (resource.count === 5)
              ctx.atCharacter(k, 30, (at) => {
                if (resources.get(k) !== resource) return
                resource.count = 4
                if (at.characterFrame(k) <= resource.end) publish(at, k)
              })
            publish(ctx, k)
          }
          if (hit.tag === 'normal' && api.ready(`surfsUp.loss.${k}`, own, 91)) {
            resource.count = Math.max(0, resource.count - 1)
            publish(ctx, k)
          }
        },
      }
    },
  },
  {
    // On-field damage produces a snapshotted Max HP Physical hit, as kqmsim ashgraven/ashgraven.go.
    weapon: 'AshGravenDrinkingHorn',
    custom: (api) => ({
      onHit(ctx, hit) {
        const k = hit.characterKey
        if (
          api.wears(k) &&
          isDamage(hit) &&
          hit.onField === k &&
          api.ready(`ashgraven.${k}`, ctx.characterFrame(k), 901)
        )
          ctx.hit(1, {
            characterKey: k,
            path: ['weapon:AshGravenDrinkingHorn', 'dmg'],
            tag: 'other',
            element: 'physical',
            applies: false,
            snapshotDelay: 0,
            label: 'Ash-Graven Drinking Horn Proc',
          })
      },
    }),
  },
  {
    // Skill use grants holder EM on its hitlag clock, as kqmsim etherlightspindlelute/etherlightspindlelute.go.
    weapon: 'EtherlightSpindlelute',
    custom: (api) =>
      afterSkill(api, 'EtherlightSpindlelute', 'condPassive', 1200),
  },
  {
    // Independent rolls, live Cryo/Frozen replacement and owner-clock ICD, as kqmsim frostbearer/frostbearer.go.
    weapon: 'Frostbearer',
    custom: (api) => {
      const ready = new Map<CharacterKey, number>()
      return {
        onHit(ctx, hit) {
          const k = hit.characterKey
          const own = ctx.characterFrame(k)
          if (
            !api.wears(k) ||
            !isDamage(hit) ||
            (hit.tag !== 'normal' && hit.tag !== 'charged') ||
            hit.onField !== k ||
            own <= (ready.get(k) ?? Number.NEGATIVE_INFINITY) ||
            ctx.random() >= 0.5 + 0.1 * api.refinement(k)
          )
            return
          ready.set(k, own + 600)
          const cryo = ctx.isFrozen || ctx.absorb(['cryo']) === 'cryo'
          ctx.hit(1, {
            characterKey: k,
            path: ['weapon:Frostbearer', cryo ? 'dmgOnCryoOp' : 'dmgAoe'],
            tag: 'other',
            element: 'physical',
            applies: false,
            snapshotDelay: 0,
            label: 'Frostbearer Proc',
          })
        },
      }
    },
  },
  {
    // Skill use (not Burst) grants holder ER, as kqmsim oathsworneye/oathsworneye.go.
    weapon: 'OathswornEye',
    custom: (api) =>
      afterSkill(api, 'OathswornEye', 'faLight', 600, 'skillBurst'),
  },
]

const isDamage = (hit: SimHit) => !hit.path[0].startsWith('_')

/** Preserve event order when a later event changes a conditional at the same frame. */
function preserve(
  hit: SimHit,
  owner: CharacterKey,
  path: string[],
  value: string
) {
  if (
    hit.states?.some(
      (s) => s.owner === owner && s.path.join('.') === path.join('.')
    )
  )
    return
  ;(hit.states ??= []).push({ owner, path, value })
}

/**
 * A replaceable status on its owner's clock, also visible to teammates. gcsim's checks of a
 * modifier (StatModIsActive, StatusIsActive) still count it on its expiry frame (`read`), but a
 * stat or attack modifier no longer applies to damage on that frame (stats.go, mods.go: expiry >
 * frame), so its state ends at `duration`. `inclusive`: a buff gcsim reads through
 * StatusIsActive (Nightweaver's team bonus) lasts through its expiry frame.
 */
function clockedState(
  api: WeaponApi,
  weapon: string,
  conditional: string,
  inclusive = false
) {
  const path = [weapon, conditional]
  const current = new Map<CharacterKey, { value: string; end: number }>()
  const read = (ctx: SimContext, k: CharacterKey) => {
    const entry = current.get(k)
    return entry && ctx.characterFrame(k) <= entry.end ? entry.value : ''
  }
  /** Its value for damage */
  const live = (ctx: SimContext, k: CharacterKey) => {
    const entry = current.get(k)
    const own = ctx.characterFrame(k)
    return entry && (inclusive ? own <= entry.end : own < entry.end)
      ? entry.value
      : ''
  }
  return {
    path,
    declare: (value = 'on') => {
      for (const k of api.members.filter(api.holds))
        api.window(k, path, value, 0, 0)
    },
    read,
    capture: (ctx: SimContext, hit: SimHit, k: CharacterKey, snapshot = true) =>
      preserve(
        hit,
        k,
        path,
        (snapshot
          ? hit.snapshotStates?.find(
              (s) => s.owner === k && s.path.join('.') === path.join('.')
            )?.value
          : undefined) ?? live(ctx, k)
      ),
    set(ctx: SimContext, k: CharacterKey, value: string, duration: number) {
      const entry = { value, end: ctx.characterFrame(k) + duration }
      current.set(k, entry)
      ctx.state(k, path, value)
      ctx.atCharacter(k, inclusive ? duration + 1 : duration, (at) => {
        if (current.get(k) === entry) at.state(k, path, '')
      })
    },
  }
}

function afterSkill(
  api: WeaponApi,
  weapon: string,
  cond: string,
  duration: number,
  value = 'on'
) {
  const status = clockedState(api, weapon, cond)
  return {
    declare: () => status.declare(value),
    onAction(ctx: SimContext, actor: CharacterKey, action: { kind: string }) {
      if (api.holds(actor) && ctx.onField === actor && action.kind === 'skill')
        status.set(ctx, actor, value, duration)
    },
    onHit(ctx: SimContext, hit: SimHit) {
      if (api.holds(hit.characterKey) && isDamage(hit))
        status.capture(ctx, hit, hit.characterKey)
    },
  }
}
