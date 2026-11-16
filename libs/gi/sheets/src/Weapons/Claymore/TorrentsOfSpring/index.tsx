// juanlab-beta 7.3: Torrents of Spring (arma di Danica), dal testo della beta (Nanoka 7.2.52).
import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import {
  equal,
  inferInfoMut,
  input,
  subscript,
  sum,
  target,
} from '@genshin-optimizer/gi/wr'
import { cond, st, stg, trans } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

const key: WeaponKey = 'TorrentsOfSpring'
const [, trm] = trans('weapon', key)

// R1-R5: ATT; Attendant's Measure: DAN di Astroconduzione del personaggio attivo; potenziamento: ancora ATT e DAN
const atk_arr = [-1, 0.16, 0.2, 0.24, 0.28, 0.32]
const stellar_dmg_arr = [-1, 0.2, 0.25, 0.3, 0.35, 0.4]
const enhancedAtk_arr = [-1, 0.16, 0.2, 0.24, 0.28, 0.32]
const enhancedStellar_dmg_arr = [-1, 0.2, 0.25, 0.3, 0.35, 0.4]

const atk_ = equal(
  input.weapon.key,
  key,
  subscript(input.weapon.refinement, atk_arr)
)

const [condMeasurePath, condMeasure] = cond(key, 'measure')
const measure_stellarconduct_dmg_ = sum(
  equal(
    condMeasure,
    'on',
    subscript(input.weapon.refinement, stellar_dmg_arr, { unit: '%' })
  ),
  equal(
    condMeasure,
    'enhanced',
    subscript(
      input.weapon.refinement,
      stellar_dmg_arr.map((v, i) => v + enhancedStellar_dmg_arr[i]),
      { unit: '%' }
    )
  )
)
const measure_stellarconduct_dmg_active = equal(
  input.activeCharKey,
  target.charKey,
  measure_stellarconduct_dmg_
)
const enhanced_atk_ = equal(
  condMeasure,
  'enhanced',
  subscript(input.weapon.refinement, enhancedAtk_arr)
)

const data = dataObjForWeaponSheet(
  key,
  inferInfoMut({
    premod: { atk_: sum(atk_, enhanced_atk_) },
    teamBuff: {
      premod: { stellarconduct_dmg_: measure_stellarconduct_dmg_active },
    },
  })
)

const sheet: IWeaponSheet = {
  document: [
    {
      header: headerTemplate(key, st('base')),
      fields: [{ node: atk_ }],
    },
    {
      value: condMeasure,
      path: condMeasurePath,
      teamBuff: true,
      header: headerTemplate(key, st('conditional')),
      name: trm('measureCond'),
      states: {
        on: {
          name: trm('measure'),
          fields: [
            { node: measure_stellarconduct_dmg_ },
            { text: stg('duration'), value: 15, unit: 's' },
          ],
        },
        enhanced: {
          name: trm('enhanced'),
          fields: [
            { node: measure_stellarconduct_dmg_ },
            { node: enhanced_atk_ },
            { text: stg('duration'), value: 15, unit: 's' },
          ],
        },
      },
    },
  ],
}
export default new WeaponSheet(sheet, data)
