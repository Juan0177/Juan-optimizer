import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import { equal, input, percent, subscript } from '@genshin-optimizer/gi/wr'
import { cond, st, stg } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

const key: WeaponKey = 'TamayurateiNoOhanashi'

const atk_arr = [-1, 0.2, 0.25, 0.3, 0.35, 0.4]
const [condAfterSkillPath, condAfterSkill] = cond(key, 'afterSkill')
const afterSkill_atk_ = equal(
  condAfterSkill,
  'on',
  subscript(input.weapon.refinement, atk_arr)
)
const afterSkill_moveSPD_ = equal(condAfterSkill, 'on', percent(0.1))

const data = dataObjForWeaponSheet(key, {
  premod: {
    atk_: afterSkill_atk_,
    moveSPD_: afterSkill_moveSPD_,
  },
})

const sheet: IWeaponSheet = {
  document: [
    {
      value: condAfterSkill,
      path: condAfterSkillPath,
      header: headerTemplate(key, st('cond')),
      name: st('afterUse.skill'),
      states: {
        on: {
          fields: [
            {
              node: afterSkill_atk_,
            },
            {
              node: afterSkill_moveSPD_,
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
