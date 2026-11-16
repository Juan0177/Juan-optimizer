// juanlab-beta 7.3: Anastasya (la Zarina), dai dati della beta (Nanoka 7.2.52, numeri dei talenti verificati su
// gachabase). Quando l'originale la aggiunge, questo file si cancella e si tiene il suo.
// Modello: Odette (Cryo, stessa passiva Stellar Jubilee e stessa logica di Radiance).
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import {
  equal,
  greaterEq,
  infoMut,
  input,
  min,
  one,
  percent,
  prod,
  subscript,
  sum,
  target,
  unequal,
} from '@genshin-optimizer/gi/wr'
import { any, cond, st, stg } from '../../SheetUtil'
import { CharacterSheet } from '../CharacterSheet'
import { charTemplates } from '../charTemplates'
import {
  dataObjForCharacterSheet,
  dmgNode,
  hitEle,
  plungingDmgNodes,
  stellarTalentDmgNode,
} from '../dataUtil'
import type { TalentSheet } from '../ICharacterSheet'

const key: CharacterKey = 'Anastasya'
const skillParam_gen = allStats.char.skillParam[key]
const ct = charTemplates(key)

let a = 0,
  s = 0,
  b = 0
const dm = {
  normal: {
    hitArr: [
      skillParam_gen.auto[a++], // 1
      skillParam_gen.auto[a++], // 2
      skillParam_gen.auto[a++], // 3 (x2)
      skillParam_gen.auto[a++], // 4 (x3)
      skillParam_gen.auto[a++], // 5
    ],
  },
  charged: {
    aimed: skillParam_gen.auto[a++],
    aimedCharged: skillParam_gen.auto[a++],
  },
  plunging: {
    dmg: skillParam_gen.auto[a++],
    low: skillParam_gen.auto[a++],
    high: skillParam_gen.auto[a++],
  },
  skill: {
    tapDmg: skillParam_gen.skill[s++],
    holdDmg: skillParam_gen.skill[s++],
    crownDmg: skillParam_gen.skill[s++],
    crownScDmg: skillParam_gen.skill[s++],
    crownSsDmg: skillParam_gen.skill[s++],
    spearArr: [
      skillParam_gen.skill[s++], // 1
      skillParam_gen.skill[s++], // 2 (x2)
      skillParam_gen.skill[s++], // 3
      skillParam_gen.skill[s++], // 4 (x3)
      skillParam_gen.skill[s++], // 5 (x3)
    ],
    spearStellarArr: [0, 1, 2, 3, 4].map(() => ({
      sc: skillParam_gen.skill[s++],
      ss: skillParam_gen.skill[s++],
    })),
    crownDuration: skillParam_gen.skill[s++][0],
    honorDuration: skillParam_gen.skill[s++][0],
    cd: skillParam_gen.skill[s++][0],
  },
  burst: {
    newWorldDmg: skillParam_gen.burst[b++],
    stellar_dmg_: skillParam_gen.burst[b++],
    crownScDmg: skillParam_gen.burst[b++],
    crownSsDmg: skillParam_gen.burst[b++],
    triumphScDmg: skillParam_gen.burst[b++],
    triumphSsDmg: skillParam_gen.burst[b++],
    evernightScDmg: skillParam_gen.burst[b++],
    evernightSsDmg: skillParam_gen.burst[b++],
    doomHit1Dmg: skillParam_gen.burst[b++],
    doomStellarArr: [0, 1, 2].map(() => ({
      sc: skillParam_gen.burst[b++],
      ss: skillParam_gen.burst[b++],
    })),
    newWorldDuration: skillParam_gen.burst[b++][0],
    evernightDuration: skillParam_gen.burst[b++][0],
    cd: skillParam_gen.burst[b++][0],
    enerCost: skillParam_gen.burst[b++][0],
  },
  passive1: {
    critDMG_: skillParam_gen.passive1[0][0],
    duration: skillParam_gen.passive1[1][0],
  },
  passive3: {
    radianceSsDuration: skillParam_gen.passive3![0][0],
    baseDmgPer100Atk: skillParam_gen.passive3![1][0],
    maxBaseDmg: skillParam_gen.passive3![2][0],
  },
  constellation1: {
    cryo_atk_: skillParam_gen.constellation1[0],
    eleMas: skillParam_gen.constellation1[1],
  },
  // C2: il parametro della beta dice 50%, il testo (uguale su Nanoka e gachabase) 60%: si usa il testo.
  constellation2: {
    love_critDMG_: 0.6,
    loveDuration: skillParam_gen.constellation2[1],
    honorMult: skillParam_gen.constellation2[2],
    honorDuration: skillParam_gen.constellation2[3],
    stellar_specialDmg_: skillParam_gen.constellation2[4],
  },
  constellation4: {
    accoladeMult_: skillParam_gen.constellation4[0],
  },
  constellation6: {
    love_specialDmg_: skillParam_gen.constellation6[3],
    honor_specialDmg_: skillParam_gen.constellation6[5],
  },
} as const

// Radiance: Stellar-Conduct (nel Campo stellare) o Stellar Swirl (8s dopo un Turbinio astrale del gruppo)
const [condA0StellarRadiancePath, condA0StellarRadiance] = cond(
  key,
  'a0StellarRadiance'
)
const isRadianceScOrNotRadiance = any(
  1,
  equal(condA0StellarRadiance, 'sc', 1),
  equal(condA0StellarRadiance, undefined, 1)
)

// Stellar Jubilee: +0.7% DAN base di Astroconduzione e Turbinio astrale ogni 100 ATT, al massimo 14%
const a0_stellarconduct_baseDmg_ = min(
  prod(percent(dm.passive3.baseDmgPer100Atk), input.total.atk, 1 / 100),
  percent(dm.passive3.maxBaseDmg)
)
const a0_stellarswirl_baseDmg_ = { ...a0_stellarconduct_baseDmg_ }

// Benedizione attuale: Amore (abilita premuta) o Onore (abilita tenuta)
const [condBlessingPath, condBlessing] = cond(key, 'blessing')

// A1, Encomi: DAN da CRIT +12% al gruppo per 20s dopo l'abilita; C1: ATT +15% ai Cryo, Maestria +60 agli altri;
// C4: questi bonus al 130%
const [condAccoladesPath, condAccolades] = cond(key, 'accolades')
const c4Mult = sum(
  one,
  greaterEq(input.constellation, 4, percent(dm.constellation4.accoladeMult_))
)
const a1Accolades_critDMG_ = greaterEq(
  input.asc,
  1,
  equal(condAccolades, 'on', prod(percent(dm.passive1.critDMG_), c4Mult))
)
const c1Accolades_atk_ = greaterEq(
  input.constellation,
  1,
  equal(
    condAccolades,
    'on',
    equal(
      target.charEle,
      'cryo',
      prod(percent(dm.constellation1.cryo_atk_), c4Mult)
    )
  )
)
const c1Accolades_eleMas = greaterEq(
  input.constellation,
  1,
  equal(
    condAccolades,
    'on',
    unequal(target.charEle, 'cryo', prod(dm.constellation1.eleMas, c4Mult))
  )
)

// Tripudio "To the New World" (Amore): DAN delle reazioni stellari del gruppo aumentati
const [condNewWorldPath, condNewWorld] = cond(key, 'newWorld')
const newWorld_stellarconduct_dmg_ = equal(
  condNewWorld,
  'on',
  subscript(input.total.burstIndex, dm.burst.stellar_dmg_, { unit: '%' })
)
const newWorld_stellarswirl_dmg_ = { ...newWorld_stellarconduct_dmg_ }

// C2: DAN delle reazioni stellari elevati del 5% sempre; Amore: DAN da CRIT delle reazioni stellari +60%;
// Onore: attacchi normali, The Evernight Yields to Dawn e Doom al 125%
const c2_stellarconduct_specialDmg_ = greaterEq(
  input.constellation,
  2,
  percent(dm.constellation2.stellar_specialDmg_),
  { path: 'stellarconduct_specialDmg_', isTeamBuff: true }
)
const c2Love_stellarconduct_critDMG_ = greaterEq(
  input.constellation,
  2,
  equal(condBlessing, 'love', percent(dm.constellation2.love_critDMG_))
)
const c2Love_stellarswirl_critDMG_ = { ...c2Love_stellarconduct_critDMG_ }
const c2HonorMult = sum(
  one,
  greaterEq(
    input.constellation,
    2,
    equal(condBlessing, 'honor', percent(dm.constellation2.honorMult - 1))
  )
)

// C6: Amore: reazioni stellari del gruppo elevate del 10%; Onore: quelle di Anastasya del 20%
const c6Love_stellarconduct_specialDmg_ = greaterEq(
  input.constellation,
  6,
  equal(condBlessing, 'love', percent(dm.constellation6.love_specialDmg_)),
  { path: 'stellarconduct_specialDmg_', isTeamBuff: true }
)
const c6Honor_stellarconduct_specialDmg_ = greaterEq(
  input.constellation,
  6,
  equal(condBlessing, 'honor', percent(dm.constellation6.honor_specialDmg_))
)
const team_stellarconduct_specialDmg_ = sum(
  c2_stellarconduct_specialDmg_,
  c6Love_stellarconduct_specialDmg_
)
const team_stellarswirl_specialDmg_ = { ...team_stellarconduct_specialDmg_ }
const self_stellarconduct_specialDmg_ = c6Honor_stellarconduct_specialDmg_
const self_stellarswirl_specialDmg_ = { ...c6Honor_stellarconduct_specialDmg_ }

const stellar = (
  arr: number[],
  talent: 'skill' | 'burst',
  variant: 'stellarconduct' | 'stellarswirl',
  mult?: Parameters<typeof prod>[0]
) =>
  stellarTalentDmgNode(
    'atk',
    arr,
    talent,
    variant,
    'cryo',
    undefined,
    mult as any
  )
// Danno stellare solo in Radiance (Corona, ultimo colpo della lancia): Astroconduzione o Turbinio astrale
const radianceSc = (node: ReturnType<typeof stellar>) =>
  equal(condA0StellarRadiance, 'sc', node)
const radianceSs = (node: ReturnType<typeof stellar>) =>
  equal(condA0StellarRadiance, 'ss', node)
// Danno "considerato Astroconduzione", che in Radiance: Stellar Swirl diventa Turbinio astrale
const scUnlessSs = (node: ReturnType<typeof stellar>) =>
  equal(isRadianceScOrNotRadiance, 1, node)

const dmgFormulas = {
  normal: Object.fromEntries(
    dm.normal.hitArr.map((arr, i) => [i, dmgNode('atk', arr, 'normal')])
  ),
  charged: {
    aimed: dmgNode('atk', dm.charged.aimed, 'charged'),
    aimedCharged: dmgNode(
      'atk',
      dm.charged.aimedCharged,
      'charged',
      hitEle.cryo
    ),
  },
  plunging: plungingDmgNodes('atk', dm.plunging),
  skill: {
    tapDmg: dmgNode('atk', dm.skill.tapDmg, 'skill'),
    holdDmg: dmgNode('atk', dm.skill.holdDmg, 'skill'),
    crownDmg: dmgNode('atk', dm.skill.crownDmg, 'skill'),
    crownScDmg: radianceSc(
      stellar(dm.skill.crownScDmg, 'skill', 'stellarconduct')
    ),
    crownSsDmg: radianceSs(
      stellar(dm.skill.crownSsDmg, 'skill', 'stellarswirl')
    ),
    // Lancia benedetta (Onore): attacchi normali Cryo con i moltiplicatori dell'abilita
    ...Object.fromEntries(
      dm.skill.spearArr.map((arr, i) => [
        `spear${i}`,
        dmgNode('atk', arr, 'normal', hitEle.cryo, c2HonorMult, 'skill'),
      ])
    ),
    ...Object.fromEntries(
      dm.skill.spearStellarArr.flatMap(({ sc, ss }, i) => [
        [
          `spearSc${i}`,
          radianceSc(stellar(sc, 'skill', 'stellarconduct', c2HonorMult)),
        ],
        [
          `spearSs${i}`,
          radianceSs(stellar(ss, 'skill', 'stellarswirl', c2HonorMult)),
        ],
      ])
    ),
  },
  burst: {
    newWorldDmg: dmgNode('atk', dm.burst.newWorldDmg, 'burst'),
    crownScDmg: scUnlessSs(
      stellar(dm.burst.crownScDmg, 'burst', 'stellarconduct')
    ),
    crownSsDmg: radianceSs(
      stellar(dm.burst.crownSsDmg, 'burst', 'stellarswirl')
    ),
    triumphScDmg: scUnlessSs(
      stellar(dm.burst.triumphScDmg, 'burst', 'stellarconduct')
    ),
    triumphSsDmg: radianceSs(
      stellar(dm.burst.triumphSsDmg, 'burst', 'stellarswirl')
    ),
    evernightScDmg: scUnlessSs(
      stellar(dm.burst.evernightScDmg, 'burst', 'stellarconduct', c2HonorMult)
    ),
    evernightSsDmg: radianceSs(
      stellar(dm.burst.evernightSsDmg, 'burst', 'stellarswirl', c2HonorMult)
    ),
    doomHit1Dmg: dmgNode(
      'atk',
      dm.burst.doomHit1Dmg,
      'skill',
      hitEle.cryo,
      c2HonorMult,
      'burst'
    ),
    ...Object.fromEntries(
      dm.burst.doomStellarArr.flatMap(({ sc, ss }, i) => [
        [
          `doomSc${i}`,
          scUnlessSs(stellar(sc, 'burst', 'stellarconduct', c2HonorMult)),
        ],
        [
          `doomSs${i}`,
          radianceSs(stellar(ss, 'burst', 'stellarswirl', c2HonorMult)),
        ],
      ])
    ),
  },
}
const burstC3 = greaterEq(input.constellation, 3, 3)
const skillC5 = greaterEq(input.constellation, 5, 3)

export const data = dataObjForCharacterSheet(key, dmgFormulas, {
  premod: {
    burstBoost: burstC3,
    skillBoost: skillC5,
    stellarconduct_specialDmg_: self_stellarconduct_specialDmg_,
    stellarswirl_specialDmg_: self_stellarswirl_specialDmg_,
  },
  teamBuff: {
    premod: {
      stellarconduct_baseDmg_: a0_stellarconduct_baseDmg_,
      stellarswirl_baseDmg_: a0_stellarswirl_baseDmg_,
      critDMG_: a1Accolades_critDMG_,
      atk_: c1Accolades_atk_,
      eleMas: c1Accolades_eleMas,
      stellarconduct_dmg_: newWorld_stellarconduct_dmg_,
      stellarswirl_dmg_: newWorld_stellarswirl_dmg_,
      stellarconduct_critDMG_: c2Love_stellarconduct_critDMG_,
      stellarswirl_critDMG_: c2Love_stellarswirl_critDMG_,
      stellarconduct_specialDmg_: team_stellarconduct_specialDmg_,
      stellarswirl_specialDmg_: team_stellarswirl_specialDmg_,
    },
  },
  flags: {
    radiance: condA0StellarRadiance,
  },
})

const node = (n: any, name: any, multi?: number) => ({
  node: infoMut(n, { name, ...(multi ? { multi } : {}) }),
})
const sk = (i: number) => ct.chg(`skill.skillParams.${i}`)
const bu = (i: number) => ct.chg(`burst.skillParams.${i}`)
// biome-ignore lint/suspicious/noExplicitAny: accesso per nome ai nodi generati con Object.fromEntries
const f = dmgFormulas as any

const sheet: TalentSheet = {
  auto: ct.talentTem('auto', [
    { text: ct.chg('auto.fields.normal') },
    {
      fields: dm.normal.hitArr.map((_, i) =>
        node(
          f.normal[i],
          ct.chg(`auto.skillParams.${i}`),
          i === 2 ? 2 : i === 3 ? 3 : undefined
        )
      ),
    },
    { text: ct.chg('auto.fields.charged') },
    {
      fields: [
        node(f.charged.aimed, ct.chg('auto.skillParams.5')),
        node(f.charged.aimedCharged, ct.chg('auto.skillParams.6')),
      ],
    },
    { text: ct.chg('auto.fields.plunging') },
    {
      fields: [
        node(f.plunging.dmg, stg('plunging.dmg')),
        node(f.plunging.low, stg('plunging.low')),
        node(f.plunging.high, stg('plunging.high')),
      ],
    },
  ]),

  skill: ct.talentTem('skill', [
    {
      fields: [
        node(f.skill.tapDmg, sk(0)),
        node(f.skill.holdDmg, sk(1)),
        node(f.skill.crownDmg, sk(2), 2),
        node(f.skill.crownScDmg, sk(3)),
        node(f.skill.crownSsDmg, sk(3)),
        ...dm.skill.spearArr.map((_, i) =>
          node(f.skill[`spear${i}`], sk(4 + i), [1, 2, 1, 3, 3][i])
        ),
        ...dm.skill.spearStellarArr.flatMap((_, i) => [
          node(f.skill[`spearSc${i}`], sk(9 + i)),
          node(f.skill[`spearSs${i}`], sk(9 + i)),
        ]),
        { text: sk(14), value: dm.skill.crownDuration, unit: 's' },
        { text: sk(15), value: dm.skill.honorDuration, unit: 's' },
        { text: stg('cd'), value: dm.skill.cd, unit: 's' },
      ],
    },
    ct.condTem('skill', {
      path: condBlessingPath,
      value: condBlessing,
      teamBuff: true,
      name: ct.ch('blessingCond'),
      states: {
        love: { name: ct.ch('love'), fields: [] },
        honor: { name: ct.ch('honor'), fields: [] },
      },
    }),
  ]),

  burst: ct.talentTem('burst', [
    {
      fields: [
        node(f.burst.newWorldDmg, bu(0)),
        node(f.burst.crownScDmg, bu(2)),
        node(f.burst.crownSsDmg, bu(2)),
        node(f.burst.triumphScDmg, bu(3)),
        node(f.burst.triumphSsDmg, bu(3)),
        node(f.burst.evernightScDmg, bu(4)),
        node(f.burst.evernightSsDmg, bu(4)),
        node(f.burst.doomHit1Dmg, bu(5), 5),
        ...dm.burst.doomStellarArr.flatMap((_, i) => [
          node(f.burst[`doomSc${i}`], bu(6 + i)),
          node(f.burst[`doomSs${i}`], bu(6 + i)),
        ]),
        { text: bu(9), value: dm.burst.newWorldDuration, unit: 's' },
        { text: bu(10), value: dm.burst.evernightDuration, unit: 's' },
        { text: stg('cd'), value: dm.burst.cd, unit: 's' },
        { text: stg('energyCost'), value: dm.burst.enerCost },
      ],
    },
    ct.condTem('burst', {
      path: condNewWorldPath,
      value: condNewWorld,
      teamBuff: true,
      name: ct.ch('newWorldCond'),
      states: {
        on: {
          fields: [
            { node: newWorld_stellarconduct_dmg_ },
            { node: newWorld_stellarswirl_dmg_ },
            {
              text: stg('duration'),
              value: dm.burst.newWorldDuration,
              unit: 's',
            },
          ],
        },
      },
    }),
  ]),

  passive1: ct.talentTem('passive1', [
    ct.condTem('passive1', {
      path: condAccoladesPath,
      value: condAccolades,
      teamBuff: true,
      name: ct.ch('accoladesCond'),
      states: {
        on: {
          fields: [
            { node: a1Accolades_critDMG_ },
            { node: c1Accolades_atk_ },
            { node: c1Accolades_eleMas },
            { text: stg('duration'), value: dm.passive1.duration, unit: 's' },
          ],
        },
      },
    }),
  ]),
  passive2: ct.talentTem('passive2'),
  passive3: ct.talentTem('passive3', [
    ct.fieldsTem('passive3', {
      teamBuff: true,
      fields: [
        { node: a0_stellarconduct_baseDmg_ },
        { node: a0_stellarswirl_baseDmg_ },
      ],
    }),
    ct.condTem('passive3', {
      path: condA0StellarRadiancePath,
      value: condA0StellarRadiance,
      teamBuff: true,
      name: st('elementalReaction.stellar.radiance'),
      states: {
        sc: {
          name: st('elementalReaction.polestar.inside'),
          fields: [{ text: st('elementalReaction.stellar.gainRadianceSc') }],
        },
        ss: {
          name: st('elementalReaction.team.stellarswirl'),
          fields: [
            { text: st('elementalReaction.stellar.gainRadianceSs') },
            {
              text: stg('duration'),
              value: dm.passive3.radianceSsDuration,
              unit: 's',
            },
          ],
        },
      },
    }),
  ]),
  constellation1: ct.talentTem('constellation1'),
  constellation2: ct.talentTem('constellation2', [
    ct.fieldsTem('constellation2', {
      teamBuff: true,
      fields: [
        { node: c2_stellarconduct_specialDmg_ },
        { node: c2Love_stellarconduct_critDMG_ },
        { node: c2Love_stellarswirl_critDMG_ },
        {
          node: infoMut(prod(c2HonorMult, 1), {
            name: ct.ch('honorMult'),
            unit: '%',
          }),
        },
      ],
    }),
  ]),
  constellation3: ct.talentTem('constellation3', [
    { fields: [{ node: burstC3 }] },
  ]),
  constellation4: ct.talentTem('constellation4'),
  constellation5: ct.talentTem('constellation5', [
    { fields: [{ node: skillC5 }] },
  ]),
  constellation6: ct.talentTem('constellation6', [
    ct.fieldsTem('constellation6', {
      teamBuff: true,
      fields: [
        { node: c6Love_stellarconduct_specialDmg_ },
        { node: c6Honor_stellarconduct_specialDmg_ },
      ],
    }),
  ]),
}
export default new CharacterSheet(sheet, data)
