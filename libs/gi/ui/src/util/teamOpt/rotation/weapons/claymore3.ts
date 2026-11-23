import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { SimHit } from '../types'
import type { WeaponModule } from '../weaponEffects'
import { stoicSymbols } from './sword3'

/**
 * A reaction its character triggers, as kqmsim's reaction events: a reaction mark (not Moondrift,
 * no gcsim event), or Hyperbloom's or Burgeon's damage (they have no mark)
 */
const ownReaction = (hit: SimHit) => {
  const [kind, reaction = ''] = hit.path
  return (
    (kind === '_reaction' &&
      reaction !== 'moondrift' &&
      reaction !== 'moondriftHarmony') ||
    (kind === 'reaction' &&
      (reaction === 'hyperbloom' || reaction === 'burgeon'))
  )
}
const stellarReaction = (hit: SimHit) =>
  hit.path[0] === '_reaction' &&
  (hit.path[1] === 'stellarConduct' || hit.path[1] === 'stellarSwirl')

/** Weapon audit batch claymore3 (2026-11-16), as kqmsim and the game's text */
export const claymore3: WeaponModule[] = [
  stoicSymbols('PortablePowerSaw'),
  {
    // Blade of Atonement (kqmsim bladeofatonement.go): EM for 12 s after any reaction the wielder
    // triggers, ATK for 12 s after its Stellar-Conduct or Stellar Swirl (off the field too, both
    // refreshed, hitlag-extended); after the triggering hit
    weapon: 'BladeOfAtonement',
    custom: ({ members, holds, window }) => {
      const react = ['BladeOfAtonement', 'react']
      const stellar = ['BladeOfAtonement', 'stellar']
      return {
        declare: () => {
          for (const k of members)
            if (holds(k)) {
              window(k, react, 'on', 0, 0)
              window(k, stellar, 'on', 0, 0)
            }
        },
        onHit: (ctx, hit) => {
          const k = hit.characterKey
          if (!holds(k) || !ownReaction(hit)) return
          const options = { recipient: k, hitlag: 'recipient' } as const
          ctx.buff(k, react, 'on', 1, 720, options)
          if (stellarReaction(hit)) ctx.buff(k, stellar, 'on', 1, 720, options)
        },
      }
    },
  },
  {
    // Forged by the Golden Melody (kqmsim forgedbythegoldenmelody.go): from the start of the fight,
    // off the field too, a Harmonic Movement every 10 s in turn (ATK, EM, Stellar Glimmer DMG; its
    // `buff_type` 0); the wielder's Stellar-Conduct or Stellar Swirl adds a 12 s Contrapuntal copy
    // of the one playing, once per 12 s (its clock). (The 10 s turns are not hitlag-extended.)
    weapon: 'ForgedByTheGoldenMelody',
    custom: ({ members, holds, window, ready }) => {
      const movement = ['ForgedByTheGoldenMelody', 'movement']
      const contra = ['ForgedByTheGoldenMelody', 'contra']
      const holders = (): CharacterKey[] => members.filter(holds)
      /** The sheet's state of the Harmonic Movement playing at `t` */
      const playing = (t: number) => `${(Math.floor(t / 600) % 3) + 1}`
      return {
        declare: () => {
          for (const k of holders()) {
            window(k, movement, '1', 0, 0)
            window(k, contra, '1', 0, 0)
          }
        },
        onHit: (ctx, hit) => {
          const k = hit.characterKey
          if (!holds(k) || !stellarReaction(hit)) return
          if (
            !ready(`ForgedByTheGoldenMelody.${k}`, ctx.characterFrame(k), 720)
          )
            return
          ctx.buff(k, contra, playing(hit.t), 1, 720, {
            recipient: k,
            hitlag: 'recipient',
          })
        },
        end: (t) => {
          for (const k of holders())
            for (let start = 0; start < t; start += 600)
              window(
                k,
                movement,
                playing(start),
                start,
                Math.min(t, start + 600)
              )
        },
      }
    },
  },
  {
    // Prototype Archaic (kqmsim prototype.go): the wielder's Normal or Charged hit on the field has
    // a 50% chance (gathered as credit) to deal 240–480% ATK Physical DMG 1 frame later; a proc
    // starts its 15 s cooldown
    weapon: 'PrototypeArchaic',
    procs: [
      {
        node: 'dmg',
        label: 'Prototype Archaic',
        on: [{ kind: 'hit', tags: ['normal', 'charged'], field: 'on' }],
        chance: 0.5,
        icd: 900,
        delay: 1,
      },
    ],
  },
]
