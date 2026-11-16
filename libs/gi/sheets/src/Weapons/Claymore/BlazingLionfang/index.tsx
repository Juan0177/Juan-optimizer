// juanlab-beta 7.3: Blazing Lionfang. La beta (Nanoka 7.2.52) ha i parametri dell'effetto ma non il testo:
// per ora solo le statistiche, l'effetto si aggiunge quando la descrizione e disponibile.
import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { WeaponSheet } from '../../WeaponSheet'

const key: WeaponKey = 'BlazingLionfang'
const data = dataObjForWeaponSheet(key)
const sheet: IWeaponSheet = { document: [] }
export default new WeaponSheet(sheet, data)
