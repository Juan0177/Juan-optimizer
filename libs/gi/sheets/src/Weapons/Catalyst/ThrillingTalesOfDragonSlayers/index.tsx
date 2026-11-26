import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import {
  constant,
  equal,
  infoMut,
  input,
  lookup,
  prod,
  subscript,
  target,
  unequal,
} from '@genshin-optimizer/gi/wr'
import { cond, nonStackBuff, st, stg, trans } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

const key: WeaponKey = 'ThrillingTalesOfDragonSlayers'
const [, trm] = trans('weapon', key)

const atkSrc = [-1, 0.24, 0.3, 0.36, 0.42, 0.48]

const [condPassivePath, condPassive] = cond(key, 'Heritage')
/**
 * Besides 'on', a rotation-averaged share in steps of 5% ('5' … '95'): used for manual
 * rotations shorter than its 20 s cooldown (where no written rotation times its swap-outs).
 */
const uptimeStates = Array.from({ length: 19 }, (_, i) => `${(i + 1) * 5}`)
const uptime = lookup(
  condPassive,
  {
    on: constant(1),
    ...Object.fromEntries(
      uptimeStates.map((state) => [state, constant(Number(state) / 100)])
    ),
  },
  0
)
const nonstackWrite = lookup(
  condPassive,
  Object.fromEntries(
    ['on', ...uptimeStates].map((state) => [state, input.charKey])
  ),
  undefined
)
const [atk_Disp, atk_dispInactive] = nonStackBuff(
  'ttds',
  'atk_',
  prod(subscript(input.weapon.refinement, atkSrc), uptime)
)
const atk_ = unequal(
  input.activeCharKey,
  input.charKey, // Don't apply to wielding char
  equal(input.activeCharKey, target.charKey, atk_Disp) // Only apply to active char
)

const data = dataObjForWeaponSheet(key, {
  teamBuff: {
    premod: {
      atk_,
    },
    nonStacking: {
      ttds: nonstackWrite,
    },
  },
})

const sheet: IWeaponSheet = {
  document: [
    {
      value: condPassive,
      path: condPassivePath,
      name: trm('condName'),
      teamBuff: true,
      header: headerTemplate(key, st('conditional')),
      states: {
        on: {
          fields: [
            {
              node: infoMut(atk_Disp, { path: 'atk_', isTeamBuff: true }),
            },
            {
              node: atk_dispInactive,
            },
            {
              text: stg('duration'),
              value: 10,
              unit: 's',
            },
          ],
        },
      },
    },
  ],
}
export default new WeaponSheet(sheet, data)
