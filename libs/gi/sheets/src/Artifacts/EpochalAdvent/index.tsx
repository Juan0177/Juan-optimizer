// juanlab-beta 7.3: Epochal Advent, dal testo della beta (Nanoka 7.2.52).
import { objKeyValMap } from '@genshin-optimizer/common/util'
import {
  type ArtifactSetKey,
  allStellarReactionKeys,
} from '@genshin-optimizer/gi/consts'
import type { Data } from '@genshin-optimizer/gi/wr'
import {
  equal,
  greaterEq,
  inferInfoMut,
  input,
  percent,
} from '@genshin-optimizer/gi/wr'
import { cond, stg, trans } from '../../SheetUtil'
import { ArtifactSheet, setHeaderTemplate } from '../ArtifactSheet'
import { dataObjForArtifactSheet } from '../dataUtil'
import type { SetEffectSheet } from '../IArtifactSheet'

const key: ArtifactSetKey = 'EpochalAdvent'
const setHeader = setHeaderTemplate(key)
const [, trm] = trans('artifact', key)

const set2_atk_ = greaterEq(input.artSet[key], 2, percent(0.18))

// 4 pezzi, Undying Radiance (almeno 1 Starspark): Tasso di CRIT dei DAN Cryo +20%, e altri +20% se sono DAN di
// reazione stellare. Le reazioni stellari Cryo usano gia il Tasso di CRIT Cryo; il +20% stellare in GO vale per
// tutto il DAN della reazione (va bene per chi la infligge come Cryo, il caso del set).
const [cond4Path, cond4] = cond(key, 'undyingRadiance')
const set4_cryo_critRate_ = greaterEq(
  input.artSet[key],
  4,
  equal(cond4, 'on', percent(0.2))
)
const set4_stellar_critRate_ = objKeyValMap(allStellarReactionKeys, (k) => [
  `${k}_critRate_`,
  greaterEq(input.artSet[key], 4, equal(cond4, 'on', percent(0.2))),
])

export const data: Data = dataObjForArtifactSheet(
  key,
  inferInfoMut({
    premod: {
      atk_: set2_atk_,
      cryo_critRate_: set4_cryo_critRate_,
      ...set4_stellar_critRate_,
    },
  })
)

const sheet: SetEffectSheet = {
  2: { document: [{ fields: [{ node: set2_atk_ }] }] },
  4: {
    document: [
      {
        header: setHeader(4),
        path: cond4Path,
        value: cond4,
        name: trm('cond'),
        states: {
          on: {
            fields: [
              { node: set4_cryo_critRate_ },
              ...Object.values(set4_stellar_critRate_).map((node) => ({
                node,
              })),
              { text: stg('duration'), value: 3, unit: 's' },
            ],
          },
        },
      },
    ],
  },
}
export default new ArtifactSheet(sheet, data)
