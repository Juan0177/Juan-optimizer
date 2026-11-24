import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { SimContext, SimHit } from '../types'
import { healedBy, isReactionEvent, type WeaponModule } from '../weaponEffects'

/** A damage hit (not a marker or a reaction's own damage) */
const isDamage = (hit: SimHit) =>
  !hit.path[0].startsWith('_') && hit.path[0] !== 'reaction'
const ALL_TAGS = [
  'normal',
  'charged',
  'plunge',
  'skill',
  'burst',
  'directLunarCrystallize',
  'reactionLunarCrystallize',
  'directStellarSwirl',
  'directStellarConduct',
  'other',
] as const
const ELEMENTAL = [
  'geo',
  'hydro',
  'electro',
  'dendro',
  'pyro',
  'cryo',
  'anemo',
] as const

/** Weapon audit batch sword3 (2026-11-16), as kqmsim and the game's text */
/**
 * The Dockhand's Assistant and Portable Power Saw (kqmsim dockhand.go): a Symbol per heal the
 * wielder gives (each member healed) or gets, 30 s, up to 3; its Skill or Burst consumes them:
 * Roused (EM per Symbol) for 10 s, once per 15 s, and their Energy 2 s later (the ER calculator's)
 */
export const stoicSymbols = (
  weapon: 'TheDockhandsAssistant' | 'PortablePowerSaw'
): WeaponModule => ({
  weapon,
  custom: ({ members, holds, window, ready, onFieldAt }) => {
    const path = [weapon, 'symbolsConsumed']
    const holders = members.filter(holds)
    /** Each wielder's Symbols and when they end (its own clock: a hitlag status) */
    const symbols = new Map<CharacterKey, { n: number; end: number }>()
    return {
      declare: () => {
        for (const k of holders) window(k, path, '1', 0, 0)
      },
      onHit(ctx, hit) {
        if (hit.path[0] !== '_heal') return
        const healed = healedBy(hit, members, onFieldAt(hit.t))
        for (const k of holders) {
          const gain =
            hit.characterKey === k ? healed.length : healed.includes(k) ? 1 : 0
          if (!gain) continue
          const own = ctx.characterFrame(k)
          const s = symbols.get(k)
          const held = s && own < s.end ? s.n : 0
          symbols.set(k, { n: Math.min(3, held + gain), end: own + 1800 })
        }
      },
      onAction(ctx, actor, action) {
        if (
          (action.kind !== 'skill' && action.kind !== 'burst') ||
          !holders.includes(actor)
        )
          return
        const own = ctx.characterFrame(actor)
        const s = symbols.get(actor)
        if (!s || own >= s.end || !s.n) return
        if (!ready(`${weapon}.${actor}`, own, 900)) return
        symbols.delete(actor)
        ctx.buff(actor, path, String(s.n), 0, 600, { hitlag: 'recipient' })
        ctx.hit(120, {
          characterKey: actor,
          path: ['_marker', 'weaponEnergy', weapon],
          tag: 'other',
          element: 'physical',
          label: `${weapon} Energy`,
        })
      },
    }
  },
})

export const sword3: WeaponModule[] = [
  {
    // Athame Artis (kqmsim athameartis.go): Blade of the Daylight Hours for 3 s after each of the
    // wielder's Burst hits (off the field too), from the next hit on
    weapon: 'AthameArtis',
    timed: [
      {
        cond: 'burstHit',
        on: [{ kind: 'hit', tags: ['burst'] }],
        duration: 180,
        delay: 1,
      },
    ],
  },
  {
    // Freedom-Sworn (kqmsim freedom.go): a Sigil per reaction of the wielder (off the field too),
    // once per 0.5 s; the 2nd gives the party Song of Resistance for 12 s, then none for 20 s
    weapon: 'FreedomSworn',
    custom: ({ members, holds, window }) => {
      const path = ['FreedomSworn', 'MillennialMovement']
      const holders = members.filter(holds)
      const state = new Map<
        CharacterKey,
        { sigils: number; next: number; cooldown: number }
      >()
      return {
        declare: () => {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holders.includes(k)) return
          // (kqmsim: every reaction event, once: its mark, or Hyperbloom's and Burgeon's damage)
          const reaction = isReactionEvent(hit)
          if (!reaction) return
          // (its Sigil cooldown and 20 s cooldown are hitlag statuses: the wielder's own clock)
          const own = ctx.characterFrame(k)
          const s = state.get(k) ?? {
            sigils: 0,
            next: Number.NEGATIVE_INFINITY,
            cooldown: Number.NEGATIVE_INFINITY,
          }
          state.set(k, s)
          if (own < s.cooldown || own < s.next) return
          s.next = own + 30
          if (++s.sigils < 2) return
          s.sigils = 0
          s.cooldown = own + 1200
          ctx.buff(k, path, 'on', 0, 720)
        },
      }
    },
  },
  {
    // Lightbearing Moonshard (kqmsim lightbearingmoonshard.go): Lunar-Crystallize DMG for 5 s
    // after each of the wielder's Skills
    weapon: 'LightbearingMoonshard',
    timed: [
      {
        cond: 'passive',
        on: [{ kind: 'action', actions: ['skill'] }],
        duration: 300,
      },
    ],
  },
  {
    // Skyward Blade (kqmsim skyward.go): Skypiercing Might for 12 s (hitlag-extended) after the
    // wielder's Burst, ATK SPD +10%, and each of its Normal and Charged hits then deals 20–40% ATK
    // Physical DMG (no cooldown)
    weapon: 'SkywardBlade',
    custom: ({ members, holds, wears, window }) => {
      const path = ['SkywardBlade', 'SkyPiercingMight']
      const holders = members.filter(holds)
      /** Until when (the wielder's own clock) Skypiercing Might is up */
      const until = new Map<CharacterKey, number>()
      return {
        declare: () => {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onAction(ctx, actor, action) {
          if (action.kind !== 'burst' || !holders.includes(actor)) return
          until.set(actor, ctx.characterFrame(actor) + 720)
          ctx.buff(actor, path, 'on', 0, 720, { hitlag: 'recipient' })
          if (wears(actor))
            ctx.modifyAttackSpeed('SkywardBlade', 0.1, 720, actor)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            !wears(k) ||
            !isDamage(hit) ||
            (hit.tag !== 'normal' && hit.tag !== 'charged') ||
            ctx.characterFrame(k) >= (until.get(k) ?? Number.NEGATIVE_INFINITY)
          )
            return
          ctx.hit(0, {
            characterKey: k,
            path: ['weapon:SkywardBlade', 'dmg'],
            tag: 'other',
            element: 'physical',
            applies: false,
            label: 'Skyward Blade',
          })
        },
      }
    },
  },
  {
    // Whitelake Frostfeather (the game's text, no reference sim): a Lake-Hued Lament per Skill
    // hit of the wielder, once per 0.1 s, 8 s each on its own, up to 3
    weapon: 'WhitelakeFrostfeather',
    timed: [
      {
        cond: 'passive',
        on: [{ kind: 'hit', tags: ['skill'] }],
        duration: 480,
        icd: 6,
        stacks: { max: 3, refresh: 'each' },
      },
    ],
  },
  {
    // Cinnabar Spindle (kqmsim cinnabar.go): the wielder's Skill hits within 0.1 s of the first
    // get DEF as DMG; the next window opens 1.5 s after that one closes
    weapon: 'CinnabarSpindle',
    custom: ({ members, holds, window }) => {
      const path = ['CinnabarSpindle', 'SpotlessHeart']
      const holders = members.filter(holds)
      /** When each wielder's last window opened */
      const opened = new Map<CharacterKey, number>()
      return {
        declare: () => {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onHit(_ctx, hit) {
          const k = hit.characterKey
          if (!holders.includes(k) || hit.tag !== 'skill' || !isDamage(hit))
            return
          const from = opened.get(k)
          let on = from !== undefined && hit.t < from + 6
          if (!on && (from === undefined || hit.t >= from + 6 + 90)) {
            opened.set(k, hit.t)
            on = true
          }
          hit.states = [
            ...(hit.states ?? []),
            { owner: k, path, value: on ? 'on' : '' },
          ]
        },
      }
    },
  },
  {
    // Finale of the Deep (gcsim finaleofthedeep.go): ATK for 15 s after the wielder's Skill, once
    // per 10 s, and that Skill's Bond of Life (25% Max HP); heals on the wielder lower it, and once
    // it is cleared flat ATK for 15 s on the wielder's clock (the sheet's switch: the whole Bond).
    // Each change of the Bond is marked (Fragment of Harmonic Whimsy). Without a calculation (no
    // heal amounts) the first heal clears it. A kit clearing its own Bond (Clorinde's Impale,
    // ['_marker', 'bondOfLife', 'loss', 'clear']) clears all of it: the cap's ATK.
    weapon: 'FinaleOfTheDeep',
    timed: [
      {
        cond: 'afterSkill',
        on: [{ kind: 'action', actions: ['skill'] }],
        duration: 900,
        icd: 600,
      },
    ],
    custom: ({ members, holds, wears, window, onFieldAt }) => {
      const path = ['FinaleOfTheDeep', 'bond']
      const holders = members.filter(holds)
      /** Each wielder's Bond left (HP; NaN: not known) */
      const bond = new Map<CharacterKey, number>()
      const icdUntil = new Map<CharacterKey, number>()
      const generation = new Map<CharacterKey, number>()
      /** Flat ATK for 15 s on the wielder's clock ('max': a kit's own Bond, worth the cap) */
      const cleared = (ctx: SimContext, k: CharacterKey, value: string) => {
        const g = (generation.get(k) ?? 0) + 1
        generation.set(k, g)
        ctx.state(k, path, value)
        ctx.atCharacter(k, 900, (c) => {
          if (generation.get(k) === g) c.state(k, path, '')
        })
      }
      // (only for the weapon held: a candidate's Bond would feed other gear's effects)
      const mark = (ctx: SimContext, k: CharacterKey, change: string) =>
        wears(k) &&
        ctx.hit(0, {
          characterKey: k,
          path: ['_marker', 'bondOfLife', change],
          tag: 'other',
          element: 'physical',
          label: 'Finale of the Deep (Bond of Life)',
        })
      return {
        declare() {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onAction(ctx, actor, action) {
          if (action.kind !== 'skill' || !holders.includes(actor)) return
          const clock = ctx.characterFrame(actor)
          if (clock < (icdUntil.get(actor) ?? -Infinity)) return
          icdUntil.set(actor, clock + 600)
          const maxHp = ctx.calculate(actor, ['total', 'hp'])
          bond.set(actor, maxHp ? 0.25 * maxHp : Number.NaN)
          mark(ctx, actor, 'gain')
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            hit.path[0] === '_marker' &&
            hit.path[1] === 'bondOfLife' &&
            hit.path[3] === 'clear' &&
            holders.includes(k)
          ) {
            bond.delete(k)
            cleared(ctx, k, 'max')
            return
          }
          if (hit.path[0] !== '_heal') return
          for (const k of healedBy(
            hit,
            members,
            hit.onField ?? onFieldAt(hit.t)
          )) {
            const left = bond.get(k)
            if (left === undefined || !holders.includes(k)) continue
            const amount =
              hit.path[1] === '_percent'
                ? undefined
                : ctx.calculate(hit.characterKey, [
                    'display',
                    ...hit.path.slice(1),
                  ])
            const rest =
              Number.isNaN(left) || amount === undefined
                ? 0
                : Math.max(0, left - amount)
            mark(ctx, k, 'loss')
            if (rest > 0) {
              bond.set(k, rest)
              continue
            }
            bond.delete(k)
            cleared(ctx, k, 'on')
          }
        },
      }
    },
  },
  {
    // Iron Sting (kqmsim ironsting.go): the wielder's Elemental DMG on the field, once per 1 s,
    // a stack of DMG for 6 s (each refreshing both), up to 2, from the next hit on
    weapon: 'IronSting',
    timed: [
      {
        cond: 'InfusionStinger',
        on: [{ kind: 'hit', tags: ALL_TAGS, elements: ELEMENTAL, field: 'on' }],
        duration: 360,
        icd: 60,
        stacks: { max: 2, refresh: 'all' },
        delay: 1,
      },
    ],
  },
  {
    // New Bough (the game's text, no reference sim): within 12 s of the wielder's Skill, its hits
    // (off the field too) give Verdant for 6 s, once per 1 s, up to 3 (assumed to refresh all)
    weapon: 'NewBough',
    custom: ({ members, holds, window, stack, ready }) => {
      const path = ['NewBough', 'passive']
      const holders = members.filter(holds)
      /** Until when each wielder's hits give Verdant */
      const until = new Map<CharacterKey, number>()
      return {
        declare: () => {
          for (const k of holders) window(k, path, '1', 0, 0)
        },
        onAction(ctx, actor, action) {
          if (action.kind === 'skill' && holders.includes(actor))
            until.set(actor, ctx.now + 720)
        },
        onHit(_ctx, hit) {
          const k = hit.characterKey
          if (
            !holders.includes(k) ||
            !isDamage(hit) ||
            hit.t >= (until.get(k) ?? Number.NEGATIVE_INFINITY) ||
            !ready(`NewBough.passive.${k}`, hit.t, 60)
          )
            return
          stack(k, path, hit.t + 1, 360, 3)
        },
      }
    },
  },
  {
    // Sword of Descension (kqmsim swordofdescension.go): the wielder's Normal and Charged hits on
    // the field, a 50% chance of 200% ATK DMG, once per 10 s
    weapon: 'SwordOfDescension',
    procs: [
      {
        node: 'dmg_',
        label: 'Sword of Descension',
        on: [{ kind: 'hit', tags: ['normal', 'charged'], field: 'on' }],
        chance: 0.5,
        icd: 600,
      },
    ],
  },
  stoicSymbols('TheDockhandsAssistant'),
]
