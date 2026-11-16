// juanlab-beta 7.3: Empyrean Sojourn, dal testo della beta (Nanoka 7.2.52). Il 4 pezzi dice che altri effetti
// "saranno rivelati nelle prossime versioni": c'e solo quello gia descritto.
import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import type { Data } from '@genshin-optimizer/gi/wr'
import {
  greaterEq,
  inferInfoMut,
  input,
  percent,
} from '@genshin-optimizer/gi/wr'
import { ArtifactSheet } from '../ArtifactSheet'
import { dataObjForArtifactSheet } from '../dataUtil'
import type { SetEffectSheet } from '../IArtifactSheet'

const key: ArtifactSetKey = 'EmpyreanSojourn'

const set2_enerRech_ = greaterEq(input.artSet[key], 2, percent(0.2))
const set4_skill_dmg_ = greaterEq(input.artSet[key], 4, percent(0.25))
const set4_burst_dmg_ = greaterEq(input.artSet[key], 4, percent(0.25))

export const data: Data = dataObjForArtifactSheet(
  key,
  inferInfoMut({
    premod: {
      enerRech_: set2_enerRech_,
      skill_dmg_: set4_skill_dmg_,
      burst_dmg_: set4_burst_dmg_,
    },
  })
)

const sheet: SetEffectSheet = {
  2: { document: [{ fields: [{ node: set2_enerRech_ }] }] },
  4: {
    document: [
      { fields: [{ node: set4_skill_dmg_ }, { node: set4_burst_dmg_ }] },
    ],
  },
}
export default new ArtifactSheet(sheet, data)
