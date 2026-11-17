// juanlab: nomi italiani delle statistiche di KeyMap (che in GO sono scritti in inglese nel codice).
// Stessa costruzione di KeyMap.ts: statistiche base, poi elementi, tipi di colpo e reazioni.
// Termini ufficiali del gioco (datamine italiano): PS, ATT, DIF, Tasso di CRIT, DAN da CRIT, Tripudio elementale…
import {
  allElementWithPhyKeys,
  allLunarReactionKeys,
  allStellarReactionKeys,
} from '@genshin-optimizer/gi/consts'
import {
  additiveReactions,
  amplifyingReactions,
  crittableTransformativeReactions,
  hitMoves,
  transformativeReactions,
} from './StatConstants'

const base: Record<string, string> = {
  hp: 'PS',
  hp_: 'PS',
  atk: 'ATT',
  atk_: 'ATT',
  def: 'DIF',
  def_: 'DIF',
  eleMas: 'Maestria elementale',
  enerRech_: 'Ricarica di energia',
  critRate_: 'Tasso di CRIT',
  critDMG_: 'DAN da CRIT',
  heal_: 'Bonus di guarigione',

  base: 'DAN base',
  dmg_: 'Bonus DAN totale',
  dmgInc: 'Aumento DAN totale',
  all_dmg_: 'Bonus DAN comune',
  all_dmgInc: 'Aumento DAN comune',
  weakspotDMG_: 'DAN ai punti deboli',
  incHeal_: 'Bonus di guarigione ricevuta',
  shield_: 'Efficacia dello scudo',
  cdRed_: 'Riduzione tempo di recupero',
  skillCDRed_: 'Riduz. TdR abilità elem.',
  burstCDRed_: 'Riduz. TdR tripudio elem.',
  moveSPD_: 'Velocità di movimento',
  atkSPD_: "Velocità d'attacco",
  stamina: 'Vigore',
  staminaDec_: 'Riduz. consumo di vigore',
  staminaSprintDec_: 'Riduz. consumo di vigore in scatto',
  staminaGlidingDec_: 'Riduz. consumo di vigore in planata',
  staminaChargedDec_: 'Riduz. consumo di vigore ATT caricato',
  dmgRed_: 'Riduzione DAN',
  normalEle_dmg_: 'Bonus DAN elem. ATT normale',

  heal_multi: 'Moltiplicatore di cura',
  healInc: 'Aumento cura',

  transformative_level_multi:
    'Moltiplicatore di livello reazioni trasformative',
  crystallize_level_multi_: 'Moltiplicatore di livello Cristallizzazione',
  amplificative_dmg_: 'Bonus DAN reazioni amplificanti',
  transformative_dmg_: 'Bonus DAN reazioni trasformative',
  crystallize_dmg_: 'Bonus Cristallizzazione',
  crystallize: 'Cristallizzazione',
  base_amplifying_multi_: 'Moltiplicatore base amplificante',
  base_transformative_multi_: 'Moltiplicatore base trasformativo',
  base_crystallize_multi_: 'Moltiplicatore base Cristallizzazione',

  enemyLevel: 'Livello del nemico',
  enemyLevel_multi_: 'Moltiplicatore RES livello del nemico',
  enemyDef_multi_: 'Moltiplicatore DIF del nemico',
  enemyDefRed_: 'Riduzione DIF del nemico',
  enemyDefIgn_: 'DIF del nemico ignorata',

  infusionSelf: 'Infusione elementale',
  infusionAura: 'Aura di infusione elementale',

  autoBoost: 'Aumento liv. attacco normale',
  skillBoost: 'Aumento liv. abilità elementale',
  burstBoost: 'Aumento liv. tripudio elementale',

  base_atk: 'ATT base',
  base_hp: 'PS base',
  base_def: 'DIF base',

  level: 'Livello',
  ascension: 'Ascensione',
  constellation: 'Costellazione',
  auto: 'Liv. attacco normale',
  skill: 'Liv. abilità elementale',
  burst: 'Liv. tripudio elementale',
}

const ELEMENT: Record<string, string> = {
  physical: 'Fisico',
  anemo: 'Anemo',
  geo: 'Geo',
  electro: 'Electro',
  hydro: 'Hydro',
  pyro: 'Pyro',
  cryo: 'Cryo',
  dendro: 'Dendro',
}
const MOVE: Record<string, string> = {
  normal: 'ATT normale',
  charged: 'ATT caricato',
  plunging: 'ATT in picchiata',
  plunging_collision: 'Collisione in picchiata',
  plunging_impact: 'Impatto in picchiata',
  elemental: 'ATT elementale',
  skill: 'Abilità elem.',
  burst: 'Tripudio elem.',
}
const REACTION: Record<string, string> = {
  overloaded: 'Sovraccarico',
  shattered: 'Rompigelo',
  electrocharged: 'Electrocarica',
  lunarcharged: 'Carica lunare',
  superconduct: 'Superconduzione',
  swirl: 'Turbinio',
  burning: 'Ustione',
  bloom: 'Fioritura',
  burgeon: 'Germinazione',
  hyperbloom: 'Iperfioritura',
  lunarbloom: 'Fioritura lunare',
  lunarcrystallize: 'Cristallizzazione lunare',
  stellarconduct: 'Astroconduzione',
  stellarswirl: 'Turbinio astrale',
  vaporize: 'Vaporizzazione',
  melt: 'Fusione',
  spread: 'Propagazione',
  aggravate: 'Accentuazione',
}
const r = (key: string) => REACTION[key] ?? key

export const statMapIt: Record<string, string> = { ...base }

allElementWithPhyKeys.forEach((e) => {
  const name = ELEMENT[e]
  statMapIt[`${e}_dmg_`] =
    e === 'physical' ? 'Bonus DAN fisici' : `Bonus DAN da ${name}`
  statMapIt[`${e}_res_`] =
    e === 'physical'
      ? 'RES fisica'
      : e === 'anemo'
        ? 'RES ad Anemo'
        : `RES a ${name}`
  statMapIt[`${e}_enemyRes_`] = `RES del nemico (${name})`
  statMapIt[`${e}_dmgInc`] = `Aumento DAN (${name})`
  statMapIt[`${e}_critRate_`] = `Bonus Tasso di CRIT (${name})`
  statMapIt[`${e}_critDMG_`] = `Bonus DAN da CRIT (${name})`
})

Object.keys(hitMoves).forEach((move) => {
  const name = MOVE[move] ?? move
  statMapIt[`${move}_dmgInc`] = `Aumento DAN ${name}`
  statMapIt[`${move}_dmg_`] = `Bonus DAN ${name}`
  statMapIt[`${move}_critRate_`] = `Bonus Tasso di CRIT ${name}`
  statMapIt[`${move}_critDMG_`] = `Bonus DAN da CRIT ${name}`
})

Object.keys(transformativeReactions).forEach((reaction) => {
  statMapIt[`${reaction}_dmg_`] = `Bonus DAN ${r(reaction)}`
  statMapIt[`${reaction}_dmgInc`] = `Aumento DAN ${r(reaction)}`
  if (reaction === 'swirl')
    transformativeReactions.swirl.variants.forEach((v) => {
      statMapIt[`${v}_swirl_hit`] = `DAN da Turbinio (${ELEMENT[v]})`
    })
  else statMapIt[`${reaction}_hit`] = `DAN da ${r(reaction)}`
  statMapIt[`${reaction}_multi_`] = `Moltiplicatore ${r(reaction)}`
})
statMapIt['stellarswirl_vortex1_hit'] = 'DAN vortice Turbinio astrale liv. 1'
statMapIt['stellarswirl_vortex2_hit'] = 'DAN vortice Turbinio astrale liv. 2'

const special = (key: string) => {
  statMapIt[`${key}_baseDmg_`] = `Moltiplicatore DAN base ${r(key)}`
  statMapIt[`${key}_specialDmg_`] = `Bonus DAN speciale ${r(key)}`
  statMapIt[`${key}_reactionDmgInc`] = `Aumento DAN reazione ${r(key)}`
  statMapIt[`${key}_directDmgInc`] = `Aumento DAN diretto ${r(key)}`
}
allLunarReactionKeys.forEach(special)
allStellarReactionKeys.forEach((key) => {
  special(key)
  statMapIt[`${key}_mult_`] = `Moltiplicatore ${r(key)}`
})

crittableTransformativeReactions.forEach((reaction) => {
  statMapIt[`${reaction}_critRate_`] = `Tasso di CRIT ${r(reaction)}`
  statMapIt[`${reaction}_critDMG_`] = `DAN da CRIT ${r(reaction)}`
})

for (const e of ['cryo', 'hydro', 'pyro', 'electro'])
  statMapIt[`${e}_crystallize`] = `Cristallizzazione (${ELEMENT[e]})`

Object.keys(amplifyingReactions).forEach((reaction) => {
  statMapIt[`${reaction}_dmg_`] = `Bonus DAN ${r(reaction)}`
  statMapIt[`${reaction}_multi_`] = `Moltiplicatore ${r(reaction)}`
})
Object.keys(additiveReactions).forEach((reaction) => {
  statMapIt[`${reaction}_dmg_`] = `Bonus DAN ${r(reaction)}`
  statMapIt[`${reaction}_dmgInc`] = `Aumento DAN ${r(reaction)}`
})

/** Lingua scelta nel sito (i18next la salva in localStorage); i nomi italiani solo se e' l'italiano. */
export function isItalian(): boolean {
  try {
    return (globalThis.localStorage?.getItem('i18nextLng') ?? '').startsWith(
      'it'
    )
  } catch {
    return false
  }
}
