import { objKeyMap } from '@genshin-optimizer/common/util'
import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import {
  constant,
  equal,
  infoMut,
  input,
  lookup,
  naught,
  prod,
  subscript,
} from '@genshin-optimizer/gi/wr'
import { customDmgNode } from '../../../Characters/dataUtil'
import { st } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

const key: WeaponKey = 'SwordOfNarzissenkreuz'

const dmg_arr = [-1, 1.6, 2, 2.4, 2.8, 3.2]
const hasArkhe = lookup(
  input.charKey,
  objKeyMap(['Furina', 'Lynette', 'Clorinde', 'TravelerHydro'], () =>
    constant(1)
  ),
  naught
)
const dmg = equal(
  input.weapon.key,
  key,
  equal(
    hasArkhe,
    0,
    customDmgNode(
      prod(
        subscript(input.weapon.refinement, dmg_arr, { unit: '%' }),
        input.total.atk
      ),
      'elemental',
      {
        hit: { ele: constant('physical') },
      }
    )
  )
)

const data = dataObjForWeaponSheet(key, undefined, {
  dmg,
})
const sheet: IWeaponSheet = {
  document: [
    {
      header: headerTemplate(key, st('dmg')),
      canShow: equal(hasArkhe, 0, 1),
      fields: [{ node: infoMut(dmg, { name: st('dmg') }) }],
    },
  ],
}
export default new WeaponSheet(sheet, data)
