import { objKeyMap, range } from '@genshin-optimizer/common/util'
import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import {
  constant,
  input,
  lookup,
  naught,
  prod,
  subscript,
} from '@genshin-optimizer/gi/wr'
import { cond, st } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

const key: WeaponKey = 'TheDaybreakChronicles'

const dmg_arr = [-1, 0.1, 0.125, 0.15, 0.175, 0.2]

const passiveArr = range(1, 6)
const bonuses = (['normal', 'skill', 'burst'] as const).map((type) => {
  const [path, value] = cond(key, `${type}Stacks`)
  const node = prod(
    lookup(
      value,
      objKeyMap(passiveArr, (v) => constant(v)),
      naught
    ),
    subscript(input.weapon.refinement, dmg_arr)
  )
  // (translated names: "After hitting an opponent with a Normal Attack"…)
  const name = st(`hitOp.${type}`)
  return { path, value, node, name }
})
const [normal_dmg_, skill_dmg_, burst_dmg_] = bonuses.map(({ node }) => node)

const data = dataObjForWeaponSheet(key, {
  premod: {
    normal_dmg_,
    skill_dmg_,
    burst_dmg_,
  },
})

const sheet: IWeaponSheet = {
  document: bonuses.map(({ path, value, node, name }) => ({
    value,
    path,
    header: headerTemplate(key, st('stacks')),
    name,
    states: objKeyMap(passiveArr, (v) => ({
      name: st('stack', { count: v }),
      fields: [{ node }],
    })),
  })),
}
export default new WeaponSheet(sheet, data)
