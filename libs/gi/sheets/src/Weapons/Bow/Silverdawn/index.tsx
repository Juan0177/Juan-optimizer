// juanlab-beta 7.3: Silverdawn (arma di Anastasya), dal testo della beta (Nanoka 7.2.52).
import { objKeyValMap } from '@genshin-optimizer/common/util'
import {
  allStellarReactionKeys,
  type WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { equal, inferInfoMut, input, subscript } from '@genshin-optimizer/gi/wr'
import { cond, st, stg } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

const key: WeaponKey = 'Silverdawn'

// White Crown's Bequest dopo abilita o tripudio: ATT e DAN da CRIT delle reazioni stellari (Stellar Glimmer)
const bequest_arr = [-1, 0.4, 0.52, 0.64, 0.76, 0.88]

const [condBequestPath, condBequest] = cond(key, 'bequest')
const bequest_atk_ = equal(
  condBequest,
  'on',
  subscript(input.weapon.refinement, bequest_arr)
)
const bequest_critDMG_ = objKeyValMap(allStellarReactionKeys, (k) => [
  `${k}_critDMG_`,
  equal(condBequest, 'on', subscript(input.weapon.refinement, bequest_arr)),
])

const data = dataObjForWeaponSheet(
  key,
  inferInfoMut({
    premod: { atk_: bequest_atk_, ...bequest_critDMG_ },
  })
)

const sheet: IWeaponSheet = {
  document: [
    {
      value: condBequest,
      path: condBequestPath,
      header: headerTemplate(key, st('conditional')),
      name: st('afterUse.skillOrBurst'),
      states: {
        on: {
          fields: [
            { node: bequest_atk_ },
            ...Object.values(bequest_critDMG_).map((node) => ({ node })),
            { text: stg('duration'), value: 6, unit: 's' },
          ],
        },
      },
    },
  ],
}
export default new WeaponSheet(sheet, data)
