import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import { allElementKeys } from '@genshin-optimizer/gi/consts'
import {
  constant,
  input,
  lookup,
  naught,
  prod,
  subscript,
} from '@genshin-optimizer/gi/wr'
import { cond, st, stg, trans } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

const key: WeaponKey = 'TheWidsith'
const [tr, trm] = trans('weapon', key)

const refinementAtkVals = [-1, 0.6, 0.75, 0.9, 1.05, 1.2]
const refinementEleDmgVals = [-1, 0.48, 0.6, 0.72, 0.84, 0.96]
const refinementEleMasVals = [-1, 240, 300, 360, 420, 480]

const [condPassivePath, condPassive] = cond(key, 'Debut')
/** A theme's bonus: in full when it is the song played, a third for `avg` (one of three at random) */
const theme = (song: string, values: number[]) =>
  prod(
    lookup(condPassive, { [song]: constant(1), avg: constant(1 / 3) }, naught),
    subscript(input.weapon.refinement, values)
  )
const atk_ = theme('recitative', refinementAtkVals)
const eleBonus_ = Object.fromEntries(
  allElementKeys.map((ele) => [ele, theme('aria', refinementEleDmgVals)])
)
const eleMas = theme('interlude', refinementEleMasVals)

const data = dataObjForWeaponSheet(key, {
  premod: {
    atk_,
    ...Object.fromEntries(
      allElementKeys.map((ele) => [`${ele}_dmg_`, eleBonus_[ele]])
    ),
    eleMas,
  },
})

const sheet: IWeaponSheet = {
  document: [
    {
      value: condPassive,
      path: condPassivePath,
      teamBuff: true,
      header: headerTemplate(key, st('conditional')),
      name: tr('passiveName'),
      states: {
        aria: {
          name: trm('aria'),
          fields: [
            ...allElementKeys.map((ele) => ({ node: eleBonus_[ele] })),
            {
              text: stg('duration'),
              value: 10,
              unit: 's',
            },
          ],
        },
        interlude: {
          name: trm('interlude'),
          fields: [
            {
              node: eleMas,
            },
            {
              text: stg('duration'),
              value: 10,
              unit: 's',
            },
          ],
        },
        recitative: {
          name: trm('recitative'),
          fields: [
            {
              node: atk_,
            },
            {
              text: stg('duration'),
              value: 10,
              unit: 's',
            },
          ],
        },
        avg: {
          name: trm('avg'),
          fields: [
            { node: atk_ },
            ...allElementKeys.map((ele) => ({ node: eleBonus_[ele] })),
            { node: eleMas },
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
