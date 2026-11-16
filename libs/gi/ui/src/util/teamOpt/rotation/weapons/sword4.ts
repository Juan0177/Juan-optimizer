import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { energyCalcData } from '../../energyCalc'
import type { SimContext, SimHit } from '../types'
import type { WeaponModule } from '../weaponEffects'

const isDamage = (hit: SimHit) =>
  !hit.path[0].startsWith('_') && hit.path[0] !== 'reaction'

const isReaction = (hit: SimHit) =>
  (hit.path[0] === '_reaction' &&
    hit.path[1] !== 'moondrift' &&
    hit.path[1] !== 'moondriftHarmony') ||
  (hit.path[0] === 'reaction' &&
    (hit.path[1] === 'hyperbloom' || hit.path[1] === 'burgeon'))

const isZeroEnergy = (k: CharacterKey) => energyCalcData[k]?.burstCost === 0

const ARKHE_SWORDS = new Set<CharacterKey>([
  'Furina',
  'Lynette',
  'Clorinde',
  'TravelerHydro',
])

/** Weapon audit batch sword4 (2026-11-16), as kqmsim and the game's text */
export const sword4: WeaponModule[] = [
  {
    // Azurelight (as kqmsim azurelight.go): ATK for 12 s (hitlag-extended) after the wielder's
    // on-field Skill; while active at 0 Energy (tracked for zero-cost Bursts), extra ATK and CRIT DMG
    weapon: 'Azurelight',
    custom: ({ members, holds, window }) => {
      const holders = members.filter(holds)
      return {
        declare: () => {
          for (const k of holders) {
            window(k, ['Azurelight', 'afterSkill'], 'on', 0, 0)
            window(k, ['Azurelight', 'noEnergy'], 'on', 0, 0)
          }
        },
        onAction(ctx, actor, action) {
          if (
            action.kind !== 'skill' ||
            actor !== ctx.onField ||
            !holders.includes(actor)
          )
            return
          ctx.buff(actor, ['Azurelight', 'afterSkill'], 'on', 0, 720, {
            recipient: actor,
            hitlag: 'recipient',
          })
          if (isZeroEnergy(actor))
            ctx.buff(actor, ['Azurelight', 'noEnergy'], 'on', 0, 720, {
              recipient: actor,
              hitlag: 'recipient',
            })
        },
      }
    },
  },
  {
    // Haran Geppaku Futsu (as kqmsim haran.go): teammate Skills (0.3 s hitlag-extended ICD) grant
    // up to 2 Wavespike stacks; the wielder's on-field Skill consumes them for 8 s (hitlag-extended)
    weapon: 'HaranGeppakuFutsu',
    custom: ({ members, holds, window, ready }) => {
      const path = ['HaranGeppakuFutsu', 'HonedFlow']
      const holders = members.filter(holds)
      const stacks = new Map<CharacterKey, number>()
      return {
        declare: () => {
          for (const k of holders) window(k, path, '1', 0, 0)
        },
        onAction(ctx, actor, action) {
          if (action.kind !== 'skill') return
          for (const k of holders) {
            if (actor !== k) {
              if (ready(`haranIcd.${k}`, ctx.characterFrame(k), 18))
                stacks.set(k, Math.min(2, (stacks.get(k) ?? 0) + 1))
            } else if (actor === ctx.onField) {
              const count = stacks.get(k) ?? 0
              if (count > 0) {
                ctx.buff(k, path, String(count), 0, 480, {
                  recipient: k,
                  hitlag: 'recipient',
                })
                stacks.set(k, 0)
              }
            }
          }
        },
      }
    },
  },
  {
    // Mistsplitter Reforged (as kqmsim mistsplitter.go): 1 stack each from Normal or Charged
    // Attack Elemental DMG (5 s, from the next hit), the on-field Burst (10 s) and Energy below
    // full (gcsim starts full: from the first Burst on, always for a Burst that costs none; the
    // simulation has no Energy). The count is set at once, each stack ending on the wielder's clock
    weapon: 'MistsplitterReforged',
    custom: ({ members, holds, window }) => {
      const path = ['MistsplitterReforged', 'MistsplittersEmblem']
      const holders = members.filter(holds)
      /** Per wielder: when its Normal and Burst stacks end (its clock), and Energy below full */
      const state = new Map<
        CharacterKey,
        { normalEnd: number; burstEnd: number; energy: boolean }
      >()
      for (const k of holders)
        state.set(k, {
          normalEnd: Number.NEGATIVE_INFINITY,
          burstEnd: Number.NEGATIVE_INFINITY,
          energy: isZeroEnergy(k),
        })
      const sync = (ctx: SimContext, k: CharacterKey) => {
        const s = state.get(k)
        if (!s) return
        const f = ctx.characterFrame(k)
        const count =
          (f < s.normalEnd ? 1 : 0) +
          (f < s.burstEnd ? 1 : 0) +
          (s.energy ? 1 : 0)
        ctx.state(k, path, count > 0 ? String(count) : '')
      }
      return {
        declare: () => {
          for (const k of holders) {
            window(k, path, '1', 0, 0)
            // (a Burst that costs no Energy: its Energy stack from the start, under the counts)
            if (state.get(k)?.energy)
              window(k, path, '1', 0, Number.MAX_SAFE_INTEGER)
          }
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          const s = state.get(k)
          if (
            !s ||
            !isDamage(hit) ||
            (hit.tag !== 'normal' && hit.tag !== 'charged') ||
            hit.element === 'physical'
          )
            return
          ctx.atCharacter(k, 1, (at) => {
            s.normalEnd = Math.max(s.normalEnd, at.characterFrame(k) + 300)
            sync(at, k)
            at.atCharacter(k, 300, (at2) => sync(at2, k))
          })
        },
        onAction(ctx, actor, action) {
          const s = state.get(actor)
          if (!s || action.kind !== 'burst' || actor !== ctx.onField) return
          s.burstEnd = Math.max(s.burstEnd, ctx.characterFrame(actor) + 600)
          s.energy = true
          sync(ctx, actor)
          ctx.atCharacter(actor, 600, (at) => sync(at, actor))
        },
      }
    },
  },
  {
    // Splendor of Tranquil Waters (as kqmsim splendoroftranquilwaters.go): wielder HP change gives
    // Skill DMG (max 3, 6 s); teammate HP change gives Max HP (max 2, 6 s); 0.2 s ICD, off-field too
    weapon: 'SplendorOfTranquilWaters',
    custom: ({ members, holds, window, ready }) => {
      const holders = members.filter(holds)
      const self = new Map<CharacterKey, { count: number; end: number }>()
      const team = new Map<CharacterKey, { count: number; end: number }>()
      const bump = (
        ctx: SimContext,
        k: CharacterKey,
        cond: string,
        map: Map<CharacterKey, { count: number; end: number }>,
        max: number
      ) => {
        const frame = ctx.characterFrame(k)
        if (!ready(`splendor.${cond}.${k}`, frame, 12)) return
        const prev = map.get(k)
        const count = Math.min(
          max,
          (prev && frame < prev.end ? prev.count : 0) + 1
        )
        map.set(k, { count, end: frame + 360 })
        ctx.buff(k, ['SplendorOfTranquilWaters', cond], String(count), 0, 360, {
          recipient: k,
          hitlag: 'recipient',
        })
      }
      return {
        declare: () => {
          for (const k of holders) {
            window(k, ['SplendorOfTranquilWaters', 'selfHpChange'], '1', 0, 0)
            window(k, ['SplendorOfTranquilWaters', 'teamHpChange'], '1', 0, 0)
          }
        },
        onHit(ctx, hit) {
          if (hit.path[0] !== '_marker' || hit.path[1] !== 'hpChange') return
          for (const k of holders)
            if (hit.characterKey === k) bump(ctx, k, 'selfHpChange', self, 3)
            else bump(ctx, k, 'teamHpChange', team, 2)
        },
      }
    },
  },
  {
    // Amenoma Kageuchi (as kqmsim amenoma.go): the wielder's on-field Skill gives a Succession Seed
    // (once per 5 s, lasting 30 s, at most 3: a new one replaces the oldest; its clock); its Burst
    // consumes them all for 6–12 Energy each 3 s later. A marker a Seed, for the ER calculator
    weapon: 'AmenomaKageuchi',
    custom: ({ members, holds, ready }) => {
      const holders = members.filter(holds)
      /** Per wielder, its Seeds' ends (its clock) */
      const seeds = new Map<CharacterKey, number[]>()
      return {
        onAction(ctx, actor, action) {
          if (!holders.includes(actor) || actor !== ctx.onField) return
          const f = ctx.characterFrame(actor)
          const live = (seeds.get(actor) ?? []).filter((end) => end > f)
          if (action.kind === 'skill') {
            if (!ready(`amenoma.${actor}`, f, 300)) return
            if (live.length >= 3)
              live.splice(live.indexOf(Math.min(...live)), 1)
            seeds.set(actor, [...live, f + 1800])
          } else if (action.kind === 'burst' && live.length) {
            seeds.set(actor, [])
            ctx.atCharacter(actor, 180, (at) => {
              for (let i = 0; i < live.length; i++)
                at.hit(0, {
                  characterKey: actor,
                  path: ['_marker', 'weaponEnergy', 'AmenomaKageuchi'],
                  tag: 'other',
                  element: 'physical',
                  label: 'Amenoma Kageuchi Energy',
                })
            })
          }
        },
      }
    },
  },
  {
    // Emberwell (as kqmsim emberwell.go): triggering any reaction grants ATK for 12 s; triggering
    // Stellar-Conduct or Stellar Swirl grants Stellar Glimmer DMG for 12 s (both hitlag-extended, off-field too)
    weapon: 'Emberwell',
    custom: ({ members, holds, window }) => {
      const holders = members.filter(holds)
      return {
        declare: () => {
          for (const k of holders) {
            window(k, ['Emberwell', 'react'], 'on', 0, 0)
            window(k, ['Emberwell', 'stellar'], 'on', 0, 0)
          }
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holders.includes(k) || !isReaction(hit)) return
          ctx.buff(k, ['Emberwell', 'react'], 'on', 0, 720, {
            recipient: k,
            hitlag: 'recipient',
          })
          if (
            hit.path[0] === '_reaction' &&
            (hit.path[1] === 'stellarConduct' || hit.path[1] === 'stellarSwirl')
          )
            ctx.buff(k, ['Emberwell', 'stellar'], 'on', 0, 720, {
              recipient: k,
              hitlag: 'recipient',
            })
        },
      }
    },
  },
  {
    // Fleuve Cendre Ferryman (as kqmsim fleuvecendreferryman.go): Energy Recharge for 5 s
    // (hitlag-extended) after the wielder's on-field Elemental Skill
    weapon: 'FleuveCendreFerryman',
    custom: ({ members, holds, window }) => {
      const path = ['FleuveCendreFerryman', 'afterSkill']
      const holders = members.filter(holds)
      return {
        declare: () => {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onAction(ctx, actor, action) {
          if (
            action.kind !== 'skill' ||
            actor !== ctx.onField ||
            !holders.includes(actor)
          )
            return
          ctx.buff(actor, path, 'on', 0, 300, {
            recipient: actor,
            hitlag: 'recipient',
          })
        },
      }
    },
  },
  {
    // Kagotsurube Isshin (as kqmsim kagotsurubeisshin.go): on-field Normal/Charged/Plunge hit
    // triggers 180% ATK Physical DMG (1 f delay) and +15% ATK for 8 s (hitlag-extended), 8 s ICD
    weapon: 'KagotsurubeIsshin',
    custom: ({ members, holds, wears, window, ready }) => {
      const path = ['KagotsurubeIsshin', 'passive']
      const holders = members.filter(holds)
      return {
        declare: () => {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            !holders.includes(k) ||
            hit.onField !== k ||
            !isDamage(hit) ||
            (hit.tag !== 'normal' &&
              hit.tag !== 'charged' &&
              hit.tag !== 'plunge') ||
            !ready(`isshin.${k}`, ctx.characterFrame(k), 480)
          )
            return
          ctx.buff(k, path, 'on', 1, 480, {
            recipient: k,
            hitlag: 'recipient',
          })
          if (wears(k))
            ctx.hit(1, {
              characterKey: k,
              path: ['weapon:KagotsurubeIsshin', 'dmg'],
              tag: 'other',
              element: 'physical',
              applies: false,
              label: 'Hewing Gale',
            })
        },
      }
    },
  },
  {
    // Prototype Rancour (as kqmsim prototype.go): on-field Normal/Charged hits (0.3 s ICD) grant
    // ATK & DEF stacks up to 4, refreshing a 6 s hitlag-extended duration (from the next hit)
    weapon: 'PrototypeRancour',
    custom: ({ members, holds, window, ready }) => {
      const path = ['PrototypeRancour', 'stack']
      const holders = members.filter(holds)
      const stacks = new Map<CharacterKey, { count: number; end: number }>()
      return {
        declare: () => {
          for (const k of holders) window(k, path, '1', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            !holders.includes(k) ||
            hit.onField !== k ||
            !isDamage(hit) ||
            (hit.tag !== 'normal' && hit.tag !== 'charged')
          )
            return
          const frame = ctx.characterFrame(k)
          if (!ready(`rancour.${k}`, frame, 18)) return
          const prev = stacks.get(k)
          const count = Math.min(
            4,
            (prev && frame < prev.end ? prev.count : 0) + 1
          )
          stacks.set(k, { count, end: frame + 1 + 360 })
          ctx.buff(k, path, String(count), 1, 360, {
            recipient: k,
            hitlag: 'recipient',
          })
        },
      }
    },
  },
  {
    // Serenity's Call (as kqmsim serenityscall.go): triggering an Elemental Reaction (off-field too)
    // increases Max HP for 12 s (hitlag-extended)
    weapon: 'SerenitysCall',
    custom: ({ members, holds, window }) => {
      const path = ['SerenitysCall', 'afterReaction']
      const holders = members.filter(holds)
      return {
        declare: () => {
          for (const k of holders) window(k, path, 'on', 0, 0)
        },
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (!holders.includes(k) || !isReaction(hit)) return
          ctx.buff(k, path, 'on', 0, 720, {
            recipient: k,
            hitlag: 'recipient',
          })
        },
      }
    },
  },
  {
    // Sword of Narzissenkreuz (as kqmsim swordofnarzissenkreuz.go): non-Arkhe wielder's on-field
    // Normal/Charged/Plunge hit deals 160-320% ATK Physical DMG after 6 f on char clock, 12 s ICD
    weapon: 'SwordOfNarzissenkreuz',
    custom: ({ members, wears, ready }) => {
      const wielders = members.filter(wears)
      return {
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            !wielders.includes(k) ||
            ARKHE_SWORDS.has(k) ||
            hit.onField !== k ||
            !isDamage(hit) ||
            (hit.tag !== 'normal' &&
              hit.tag !== 'charged' &&
              hit.tag !== 'plunge') ||
            !ready(`narzissenkreuz.${k}`, ctx.characterFrame(k), 720)
          )
            return
          ctx.atCharacter(k, 6, (at) =>
            at.hit(0, {
              characterKey: k,
              path: ['weapon:SwordOfNarzissenkreuz', 'dmg'],
              tag: 'other',
              element: 'physical',
              applies: false,
              label: "Hero's Blade",
            })
          )
        },
      }
    },
  },
  {
    // The Flute (as kqmsim flute.go): on-field Normal/Charged hits (0.5 s ICD) gain Harmonics
    // lasting 30 s; at 5 Harmonics consumes all for 100-200% ATK Physical DMG (1 f delay)
    weapon: 'TheFlute',
    custom: ({ members, wears, ready }) => {
      const wielders = members.filter(wears)
      const harmonics = new Map<
        CharacterKey,
        { count: number; expiresAt: number }
      >()
      return {
        onHit(ctx, hit) {
          const k = hit.characterKey
          if (
            !wielders.includes(k) ||
            hit.onField !== k ||
            !isDamage(hit) ||
            (hit.tag !== 'normal' && hit.tag !== 'charged')
          )
            return
          const frame = ctx.characterFrame(k)
          if (!ready(`flute.${k}`, frame, 30)) return
          const prev = harmonics.get(k)
          const count = (prev && frame < prev.expiresAt ? prev.count : 0) + 1
          if (count >= 5) {
            harmonics.delete(k)
            ctx.hit(1, {
              characterKey: k,
              path: ['weapon:TheFlute', 'dmg'],
              tag: 'other',
              element: 'physical',
              applies: false,
              label: 'Chord',
            })
          } else harmonics.set(k, { count, expiresAt: frame + 1800 })
        },
      }
    },
  },
]
