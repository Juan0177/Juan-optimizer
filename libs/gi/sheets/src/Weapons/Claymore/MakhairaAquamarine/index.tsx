import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import {
  equal,
  infoMut,
  input,
  percent,
  prod,
  subscript,
  target,
  unequal,
} from '@genshin-optimizer/gi/wr'
import { st } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

const key: WeaponKey = 'MakhairaAquamarine'

const atkArr = [-1, 0.24, 0.3, 0.36, 0.42, 0.48]
const selfAtk = equal(
  input.weapon.key,
  key,
  prod(
    subscript(input.weapon.refinement, atkArr, { unit: '%' }),
    input.premod.eleMas
  )
)
const teamAtkDisp = equal(input.weapon.key, key, prod(percent(0.3), selfAtk))
// Every other party member, on the field or not (kqmsim aquamarine.go): not by the active member,
// which the rotation sets to the member on the field for each attack
const teamAtk = unequal(input.charKey, target.charKey, teamAtkDisp)

const data = dataObjForWeaponSheet(
  key,
  {
    total: {
      atk: selfAtk,
    },
    teamBuff: {
      total: {
        atk: teamAtk,
      },
    },
  },
  {
    selfAtk,
    teamAtkDisp,
  }
)

const sheet: IWeaponSheet = {
  document: [
    {
      header: headerTemplate(key, st('base')),
      fields: [
        {
          node: selfAtk,
        },
      ],
    },
    {
      header: headerTemplate(key, st('teamBuff')),
      teamBuff: true,
      fields: [
        {
          node: infoMut(teamAtkDisp, {
            path: 'atk',
            isTeamBuff: true,
          }),
        },
      ],
    },
  ],
}
export default new WeaponSheet(sheet, data)
