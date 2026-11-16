// juanlab-beta 7.3: Danica, dai dati della beta (Nanoka 7.2.52, numeri dei talenti verificati su gachabase).
// Quando l'originale aggiunge Danica, questo file si cancella e si tiene il suo.
import { objKeyMap, range } from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import {
  equal,
  greaterEq,
  infoMut,
  input,
  lookup,
  min,
  naught,
  one,
  percent,
  prod,
  subscript,
  sum,
  target,
} from '@genshin-optimizer/gi/wr'
import { cond, st, stg } from '../../SheetUtil'
import { CharacterSheet } from '../CharacterSheet'
import { charTemplates } from '../charTemplates'
import {
  dataObjForCharacterSheet,
  dmgNode,
  hitEle,
  plungingDmgNodes,
  shieldElement,
  shieldNodeTalent,
  stellarTalentDmgNode,
} from '../dataUtil'
import type { TalentSheet } from '../ICharacterSheet'

const key: CharacterKey = 'Danica'
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
      skillParam_gen.auto[a++], // 4
    ],
  },
  charged: {
    cyclicDmg: skillParam_gen.auto[a++],
    finalDmg: skillParam_gen.auto[a++],
    stam: skillParam_gen.auto[a++][0],
    duration: skillParam_gen.auto[a++][0],
  },
  plunging: {
    dmg: skillParam_gen.auto[a++],
    low: skillParam_gen.auto[a++],
    high: skillParam_gen.auto[a++],
  },
  skill: {
    skillDmg: skillParam_gen.skill[s++],
    protectDmg: skillParam_gen.skill[s++],
    purgeDmg: skillParam_gen.skill[s++],
    coordDmg: skillParam_gen.skill[s++],
    shieldAtk_: skillParam_gen.skill[s++],
    shieldFlat: skillParam_gen.skill[s++],
    anchorHitArr: [
      skillParam_gen.skill[s++], // 1
      skillParam_gen.skill[s++], // 2
      skillParam_gen.skill[s++], // 3 (x2)
      skillParam_gen.skill[s++], // 4
    ],
    anchorDuration: skillParam_gen.skill[s++][0],
    protectCd: skillParam_gen.skill[s++][0],
    cd: skillParam_gen.skill[s++][0],
  },
  burst: {
    hit1Dmg: skillParam_gen.burst[b++],
    hit1StellarDmg: skillParam_gen.burst[b++],
    hit234Dmg: skillParam_gen.burst[b++],
    hit5Dmg: skillParam_gen.burst[b++],
    hit5StellarDmg: skillParam_gen.burst[b++],
    atkRatio: skillParam_gen.burst[b++],
    maxAtk: skillParam_gen.burst[b++],
    purge_dmg_: skillParam_gen.burst[b++],
    duration: skillParam_gen.burst[b++][0],
    cd: skillParam_gen.burst[b++][0],
    enerCost: skillParam_gen.burst[b++][0],
  },
  passive1: {
    electro_enemyRes_: skillParam_gen.passive1[0][0],
    radiance_electro_enemyRes_: skillParam_gen.passive1[1][0],
    radiance_cryo_enemyRes_: skillParam_gen.passive1[2][0],
  },
  passive2: {
    atkSPD_: skillParam_gen.passive2[0][0],
    maxStacks: 3,
    atk_: 0.2, // dal testo: "Danica gains 20% ATK after using Will to Protect"
  },
  passive3: {
    baseDmgPer100Atk: skillParam_gen.passive3![0][0],
    maxBaseDmg: skillParam_gen.passive3![1][0],
  },
  // I parametri delle costellazioni della beta non corrispondono al testo in C1, C2 e C6: si usano i numeri del testo,
  // che sono gli stessi su Nanoka e su gachabase.
  constellation1: {
    cleanerMult_: 1.2,
    royalGuardMult_: 0.8,
  },
  constellation2: {
    stacks: 7,
    toastAtk_: 1,
    cleanerToastAtk_: 1.5,
  },
  constellation6: {
    stellarconduct_specialDmg_: 0.2,
    royalGuardAtkStep: 1000,
    royalGuard_dmg_perStep: 0.1,
    royalGuardMax_dmg_: 0.4,
    cleanerAtkStep: 500,
    cleanerCritRate_perStep: 0.025,
    cleanerCritDMG_perStep: 0.25,
    cleanerMaxCritRate_: 0.1,
    cleanerMaxCritDMG_: 1,
  },
} as const

// Radiance: Stellar-Conduct (dentro un Campo stellare), come per Valeriy e Mitya
const [condA0StellarRadianceScPath, condA0StellarRadianceSc] = cond(
  key,
  'a0StellarRadianceSc'
)

// Stellar Jubilee: +0.7% DAN base dell'Astroconduzione ogni 100 ATT di Danica, al massimo 14%, per tutto il gruppo
const a0_stellarconduct_baseDmg_ = min(
  prod(percent(dm.passive3.baseDmgPer100Atk / 100), input.total.atk),
  percent(dm.passive3.maxBaseDmg)
)

// Ancora della tempesta sul campo: RES Electro ridotta (A1); con Radiance anche Electro e Cryo ancora di piu.
// C6: DAN dell'Astroconduzione del gruppo elevati del 20% mentre l'Ancora e presente.
const [condAnchorPath, condAnchor] = cond(key, 'anchor')
const a1_electro_enemyRes_ = greaterEq(
  input.asc,
  1,
  equal(
    condAnchor,
    'on',
    sum(
      percent(-dm.passive1.electro_enemyRes_),
      equal(
        condA0StellarRadianceSc,
        'sc',
        percent(-dm.passive1.radiance_electro_enemyRes_)
      )
    )
  )
)
const a1_cryo_enemyRes_ = greaterEq(
  input.asc,
  1,
  equal(
    condAnchor,
    'on',
    equal(
      condA0StellarRadianceSc,
      'sc',
      percent(-dm.passive1.radiance_cryo_enemyRes_)
    )
  )
)
const c6Anchor_stellarconduct_specialDmg_ = greaterEq(
  input.constellation,
  6,
  equal(condAnchor, 'on', percent(dm.constellation6.stellarconduct_specialDmg_))
)

// Forma da cameriera: Guardia reale (dopo Will to Protect) o Pulizie (dopo Will to Purge)
const [condFormPath, condForm] = cond(key, 'form')
// Tripudio usato nei 20s precedenti: potenzia la forma attuale
const [condBurstPath, condBurst] = cond(key, 'burst')
const burstInForm = (
  form: 'royalGuard' | 'cleaner',
  node: Parameters<typeof equal>[2]
) => equal(condForm, form, equal(condBurst, 'on', node))
const c1Mult = (extra: number) =>
  sum(one, greaterEq(input.constellation, 1, percent(extra)))

// Guardia reale + Tripudio: ATT di tutto il gruppo + 10% dell'ATT di Danica (al massimo 400), +80% con C1
const royalGuardAtkDisp = burstInForm(
  'royalGuard',
  prod(
    min(
      prod(
        subscript(input.total.burstIndex, dm.burst.atkRatio, { unit: '%' }),
        input.premod.atk
      ),
      subscript(input.total.burstIndex, dm.burst.maxAtk)
    ),
    c1Mult(dm.constellation1.royalGuardMult_)
  )
)
const royalGuardAtk = infoMut(
  { ...royalGuardAtkDisp },
  { path: 'atk', isTeamBuff: true }
)

// Pulizie + Tripudio: DAN di Will to Purge aumentati (+120% del potenziamento con C1)
const cleanerPurge_dmg_ = burstInForm(
  'cleaner',
  prod(
    subscript(input.total.burstIndex, dm.burst.purge_dmg_, { unit: '%' }),
    c1Mult(dm.constellation1.cleanerMult_)
  )
)

// A4: Pulizie -> VEL d'attacco +20% per carica (max 3); Guardia reale -> ATT +20%
const [condA4StacksPath, condA4Stacks] = cond(key, 'a4Stacks')
const a4StacksArr = range(1, dm.passive2.maxStacks)
const a4_atkSPD_ = greaterEq(
  input.asc,
  4,
  equal(
    condForm,
    'cleaner',
    lookup(
      condA4Stacks,
      objKeyMap(a4StacksArr, (n) => percent(n * dm.passive2.atkSPD_)),
      naught
    )
  )
)
const a4_atk_ = greaterEq(
  input.asc,
  4,
  equal(condForm, 'royalGuard', percent(dm.passive2.atk_))
)

// C2: Let Us Toast. Chi consuma una carica aggiunge il 100% dell'ATT di Danica ai suoi DAN di Astroconduzione;
// Danica in forma Pulizie aggiunge il 150% del suo ATT.
const [condC2ToastPath, condC2Toast] = cond(key, 'c2Toast')
const c2Toast_stellarconduct_dmgIncDisp = infoMut(
  greaterEq(
    input.constellation,
    2,
    equal(
      condC2Toast,
      'on',
      prod(percent(dm.constellation2.toastAtk_), input.total.atk)
    )
  ),
  { path: 'stellarconduct_dmgInc', isTeamBuff: true }
)
const c2Toast_stellarconduct_dmgInc = equal(
  input.activeCharKey,
  target.charKey,
  c2Toast_stellarconduct_dmgIncDisp
)
const c2Cleaner_stellarconduct_dmgInc = greaterEq(
  input.constellation,
  2,
  equal(
    condForm,
    'cleaner',
    equal(
      condC2Toast,
      'on',
      prod(percent(dm.constellation2.cleanerToastAtk_), input.total.atk)
    )
  )
)

// C6, Guardia reale: DAN dell'Astroconduzione del personaggio attivo +10% ogni 1000 ATT di Danica, al massimo 40%
const c6RoyalGuard_stellarconduct_dmg_Disp = greaterEq(
  input.constellation,
  6,
  equal(
    condForm,
    'royalGuard',
    min(
      prod(
        percent(
          dm.constellation6.royalGuard_dmg_perStep /
            dm.constellation6.royalGuardAtkStep
        ),
        input.total.atk
      ),
      percent(dm.constellation6.royalGuardMax_dmg_)
    )
  ),
  { path: 'stellarconduct_dmg_', isTeamBuff: true }
)
const c6RoyalGuard_stellarconduct_dmg_ = equal(
  input.activeCharKey,
  target.charKey,
  c6RoyalGuard_stellarconduct_dmg_Disp
)
// C6, Pulizie: Will to Purge +2,5% Tasso di CRIT e +25% DAN da CRIT ogni 500 ATT (al massimo 10% e 100%)
const c6Cleaner_critRate_ = greaterEq(
  input.constellation,
  6,
  equal(
    condForm,
    'cleaner',
    min(
      prod(
        percent(
          dm.constellation6.cleanerCritRate_perStep /
            dm.constellation6.cleanerAtkStep
        ),
        input.total.atk
      ),
      percent(dm.constellation6.cleanerMaxCritRate_)
    )
  )
)
const c6Cleaner_critDMG_ = greaterEq(
  input.constellation,
  6,
  equal(
    condForm,
    'cleaner',
    min(
      prod(
        percent(
          dm.constellation6.cleanerCritDMG_perStep /
            dm.constellation6.cleanerAtkStep
        ),
        input.total.atk
      ),
      percent(dm.constellation6.cleanerMaxCritDMG_)
    )
  )
)

const skillShield = shieldNodeTalent(
  'atk',
  dm.skill.shieldAtk_,
  dm.skill.shieldFlat,
  'skill'
)
const stellarBurst = (arr: number[]) =>
  stellarTalentDmgNode('atk', arr, 'burst', 'stellarconduct', 'electro', {
    premod: { stellarconduct_dmgInc: c2Cleaner_stellarconduct_dmgInc },
  })

const dmgFormulas = {
  normal: Object.fromEntries(
    dm.normal.hitArr.map((arr, i) => [i, dmgNode('atk', arr, 'normal')])
  ),
  charged: {
    cyclicDmg: dmgNode('atk', dm.charged.cyclicDmg, 'charged'),
    finalDmg: dmgNode('atk', dm.charged.finalDmg, 'charged'),
  },
  plunging: plungingDmgNodes('atk', dm.plunging),
  skill: {
    skillDmg: dmgNode('atk', dm.skill.skillDmg, 'skill'),
    protectDmg: dmgNode('atk', dm.skill.protectDmg, 'skill'),
    purgeDmg: dmgNode('atk', dm.skill.purgeDmg, 'skill', {
      premod: {
        skill_dmg_: cleanerPurge_dmg_,
        critRate_: c6Cleaner_critRate_,
        critDMG_: c6Cleaner_critDMG_,
      },
    }),
    coordDmg: dmgNode('atk', dm.skill.coordDmg, 'skill'),
    skillShield,
    skillShield_electro: shieldElement('electro', skillShield),
    // Attacchi normali con l'Ancora: DAN Electro che non si possono cambiare, con i moltiplicatori dell'abilita
    ...Object.fromEntries(
      dm.skill.anchorHitArr.map((arr, i) => [
        `anchor${i}`,
        dmgNode('atk', arr, 'normal', hitEle.electro, undefined, 'skill'),
      ])
    ),
  },
  burst: {
    hit1Dmg: dmgNode('atk', dm.burst.hit1Dmg, 'burst'),
    hit1StellarDmg: stellarBurst(dm.burst.hit1StellarDmg),
    hit234Dmg: dmgNode('atk', dm.burst.hit234Dmg, 'burst'),
    hit5Dmg: dmgNode('atk', dm.burst.hit5Dmg, 'burst'),
    hit5StellarDmg: stellarBurst(dm.burst.hit5StellarDmg),
  },
}
const burstC3 = greaterEq(input.constellation, 3, 3)
const skillC5 = greaterEq(input.constellation, 5, 3)

export const data = dataObjForCharacterSheet(key, dmgFormulas, {
  premod: {
    burstBoost: burstC3,
    skillBoost: skillC5,
    atkSPD_: a4_atkSPD_,
    atk_: a4_atk_,
  },
  teamBuff: {
    premod: {
      stellarconduct_baseDmg_: a0_stellarconduct_baseDmg_,
      electro_enemyRes_: a1_electro_enemyRes_,
      cryo_enemyRes_: a1_cryo_enemyRes_,
      stellarconduct_specialDmg_: c6Anchor_stellarconduct_specialDmg_,
      stellarconduct_dmgInc: c2Toast_stellarconduct_dmgInc,
      stellarconduct_dmg_: c6RoyalGuard_stellarconduct_dmg_,
    },
    total: {
      atk: royalGuardAtk,
    },
  },
  flags: {
    radiance: condA0StellarRadianceSc,
  },
})

const formStates = (fields: { royalGuard: any[]; cleaner: any[] }) => ({
  royalGuard: { name: ct.ch('royalGuard'), fields: fields.royalGuard },
  cleaner: { name: ct.ch('cleaner'), fields: fields.cleaner },
})

const sheet: TalentSheet = {
  auto: ct.talentTem('auto', [
    {
      text: ct.chg('auto.fields.normal'),
    },
    {
      fields: dm.normal.hitArr.map((_, i) => ({
        node: infoMut(dmgFormulas.normal[i], {
          name: ct.chg(`auto.skillParams.${i}`),
          multi: i === 2 ? 2 : undefined,
        }),
      })),
    },
    {
      text: ct.chg('auto.fields.charged'),
    },
    {
      fields: [
        {
          node: infoMut(dmgFormulas.charged.cyclicDmg, {
            name: ct.chg('auto.skillParams.4'),
          }),
        },
        {
          node: infoMut(dmgFormulas.charged.finalDmg, {
            name: ct.chg('auto.skillParams.5'),
          }),
        },
        {
          text: ct.chg('auto.skillParams.6'),
          value: dm.charged.stam,
          unit: '/s',
        },
        {
          text: ct.chg('auto.skillParams.7'),
          value: dm.charged.duration,
          unit: 's',
        },
      ],
    },
    {
      text: ct.chg('auto.fields.plunging'),
    },
    {
      fields: [
        {
          node: infoMut(dmgFormulas.plunging.dmg, {
            name: stg('plunging.dmg'),
          }),
        },
        {
          node: infoMut(dmgFormulas.plunging.low, {
            name: stg('plunging.low'),
          }),
        },
        {
          node: infoMut(dmgFormulas.plunging.high, {
            name: stg('plunging.high'),
          }),
        },
      ],
    },
  ]),

  skill: ct.talentTem('skill', [
    {
      fields: [
        {
          node: infoMut(dmgFormulas.skill.skillDmg, {
            name: ct.chg('skill.skillParams.0'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.protectDmg, {
            name: ct.chg('skill.skillParams.1'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.purgeDmg, {
            name: ct.chg('skill.skillParams.2'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.coordDmg, {
            name: ct.chg('skill.skillParams.3'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.skillShield, {
            name: ct.chg('skill.skillParams.4'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.skillShield_electro, {
            name: ct.chg('skill.skillParams.4'),
          }),
        },
        ...dm.skill.anchorHitArr.map((_, i) => ({
          node: infoMut(
            (dmgFormulas.skill as Record<string, any>)[`anchor${i}`],
            {
              name: ct.chg(`skill.skillParams.${5 + i}`),
              multi: i === 2 ? 2 : undefined,
            }
          ),
        })),
        {
          text: ct.chg('skill.skillParams.9'),
          value: dm.skill.anchorDuration,
          unit: 's',
        },
        {
          text: ct.chg('skill.skillParams.10'),
          value: dm.skill.protectCd,
          unit: 's',
        },
        {
          text: stg('cd'),
          value: dm.skill.cd,
          unit: 's',
        },
      ],
    },
    ct.condTem('skill', {
      path: condAnchorPath,
      value: condAnchor,
      teamBuff: true,
      name: ct.ch('anchorCond'),
      states: {
        on: {
          fields: [
            { node: a1_electro_enemyRes_ },
            { node: a1_cryo_enemyRes_ },
            { node: c6Anchor_stellarconduct_specialDmg_ },
          ],
        },
      },
    }),
    ct.condTem('skill', {
      path: condFormPath,
      value: condForm,
      teamBuff: true,
      name: ct.ch('formCond'),
      states: formStates({
        royalGuard: [{ node: a4_atk_ }],
        cleaner: [],
      }),
    }),
  ]),

  burst: ct.talentTem('burst', [
    {
      fields: [
        {
          node: infoMut(dmgFormulas.burst.hit1Dmg, {
            name: ct.chg('burst.skillParams.0'),
          }),
        },
        {
          node: infoMut(dmgFormulas.burst.hit1StellarDmg, {
            name: ct.chg('burst.skillParams.0'),
          }),
        },
        {
          node: infoMut(dmgFormulas.burst.hit234Dmg, {
            name: ct.chg('burst.skillParams.1'),
          }),
        },
        {
          node: infoMut(dmgFormulas.burst.hit5Dmg, {
            name: ct.chg('burst.skillParams.2'),
          }),
        },
        {
          node: infoMut(dmgFormulas.burst.hit5StellarDmg, {
            name: ct.chg('burst.skillParams.2'),
          }),
        },
        {
          text: stg('duration'),
          value: dm.burst.duration,
          unit: 's',
        },
        {
          text: stg('cd'),
          value: dm.burst.cd,
          unit: 's',
        },
        {
          text: stg('energyCost'),
          value: dm.burst.enerCost,
        },
      ],
    },
    ct.condTem('burst', {
      path: condBurstPath,
      value: condBurst,
      teamBuff: true,
      name: st('afterUse.burst'),
      states: {
        on: {
          fields: [
            { node: royalGuardAtkDisp },
            {
              node: infoMut(cleanerPurge_dmg_, {
                name: ct.ch('purge_dmg_'),
                unit: '%',
              }),
            },
            {
              text: stg('duration'),
              value: dm.burst.duration,
              unit: 's',
            },
          ],
        },
      },
    }),
  ]),

  passive1: ct.talentTem('passive1'),
  passive2: ct.talentTem('passive2', [
    ct.condTem('passive2', {
      path: condA4StacksPath,
      value: condA4Stacks,
      canShow: equal(condForm, 'cleaner', 1),
      name: ct.ch('a4StacksCond'),
      states: objKeyMap(a4StacksArr, (n) => ({
        name: st('stack', { count: n }),
        fields: [{ node: a4_atkSPD_ }],
      })),
    }),
  ]),
  passive3: ct.talentTem('passive3', [
    ct.fieldsTem('passive3', {
      teamBuff: true,
      fields: [{ node: a0_stellarconduct_baseDmg_ }],
    }),
    ct.condTem('passive3', {
      path: condA0StellarRadianceScPath,
      value: condA0StellarRadianceSc,
      teamBuff: true,
      name: st('elementalReaction.polestar.inside'),
      states: {
        sc: {
          fields: [
            {
              text: st('elementalReaction.stellar.gainRadianceSc'),
            },
          ],
        },
      },
    }),
  ]),
  constellation1: ct.talentTem('constellation1'),
  constellation2: ct.talentTem('constellation2', [
    ct.condTem('constellation2', {
      path: condC2ToastPath,
      value: condC2Toast,
      teamBuff: true,
      name: ct.ch('c2ToastCond'),
      states: {
        on: {
          fields: [
            { node: c2Toast_stellarconduct_dmgIncDisp },
            {
              node: infoMut(c2Cleaner_stellarconduct_dmgInc, {
                name: ct.ch('c2Cleaner'),
              }),
            },
          ],
        },
      },
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
        { node: c6RoyalGuard_stellarconduct_dmg_Disp },
        {
          node: infoMut(c6Cleaner_critRate_, {
            name: ct.ch('purgeCritRate_'),
            unit: '%',
          }),
        },
        {
          node: infoMut(c6Cleaner_critDMG_, {
            name: ct.ch('purgeCritDMG_'),
            unit: '%',
          }),
        },
      ],
    }),
  ]),
}
export default new CharacterSheet(sheet, data)
