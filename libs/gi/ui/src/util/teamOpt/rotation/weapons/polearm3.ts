import { healedBy, type WeaponModule } from '../weaponEffects'

/** Weapon audit batch polearm3 (2026-11-16), as kqmsim and the game's text */
export const polearm3: WeaponModule[] = [
  {
    // Skyward Spine (kqmsim spear/skyward/skyward.go): permanent +12% Normal ATK SPD while worn;
    // on-field Normal/Charged hits have a 50% chance to deal Physical vacuum blade DMG (2s ICD)
    weapon: 'SkywardSpine',
    procs: [
      {
        node: 'dmg',
        label: 'Skyward Spine',
        on: [
          {
            kind: 'hit',
            tags: ['normal', 'charged'],
            field: 'on',
          },
        ],
        chance: 0.5,
        icd: 120,
        delay: 1,
      },
    ],
    custom: (api) => ({
      declare() {
        for (const k of api.members)
          if (api.wears(k))
            api.window(
              k,
              ['SkywardSpine', '_selfAttackSpeed'],
              '0.12',
              0,
              Number.POSITIVE_INFINITY
            )
      },
    }),
  },
  {
    // Symphonist of Scents (kqmsim spear/symphonist/symphonist.go): when the wielder initiates
    // healing (on-field or off-field), the wielder and healed character(s) gain +ATK for 3s
    weapon: 'SymphonistOfScents',
    custom: (api) => {
      const holders = api.members.filter(api.holds)
      return {
        declare() {
          for (const k of holders)
            api.window(k, ['SymphonistOfScents', 'healing'], 'on', 0, 0)
        },
        onHit(ctx, hit) {
          if (hit.path[0] !== '_heal') return
          const k = hit.characterKey
          if (!api.holds(k)) return
          const healed = healedBy(hit, api.members, api.onFieldAt(hit.t))
          for (const recipient of new Set([k, ...healed]))
            ctx.buff(k, ['SymphonistOfScents', 'healing'], 'on', 0, 180, {
              recipient,
              hitlag: 'recipient',
            })
        },
      }
    },
  },
  {
    // Tamayuratei no Ohanashi (kqmsim spear/tamayuratei/tamayuratei.go): on-field Elemental Skill
    // increases the wielder's ATK and Movement SPD for 10s (hitlag-extended)
    weapon: 'TamayurateiNoOhanashi',
    custom: (api) => {
      const holders = api.members.filter(api.holds)
      return {
        declare() {
          for (const k of holders)
            api.window(k, ['TamayurateiNoOhanashi', 'afterSkill'], 'on', 0, 0)
        },
        onAction(ctx, actor, action) {
          if (
            action.kind === 'skill' &&
            actor === ctx.onField &&
            api.holds(actor)
          )
            ctx.buff(
              actor,
              ['TamayurateiNoOhanashi', 'afterSkill'],
              'on',
              0,
              600,
              {
                recipient: actor,
                hitlag: 'recipient',
              }
            )
        },
      }
    },
  },
]
