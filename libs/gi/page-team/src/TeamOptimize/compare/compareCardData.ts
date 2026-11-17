import { artifactDefIcon, weaponAsset } from '@genshin-optimizer/gi/assets'
import type { GenderKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type {
  KqmCompareCardData,
  KqmCompareCardSide,
} from '@genshin-optimizer/gi/ui'
import { kqmCardFace } from '@genshin-optimizer/gi/ui'
import type { TFunction } from 'i18next'
import { formatDamage, formatGain } from '../format'
import type { Side } from './compareSwapKqm'

export interface CompareCardContext {
  teamName: string
  /** The leaving and the entering member's names */
  outName: string
  inName: string
  gender: GenderKey
  /** Loaded for `juanlab`, `charNames_gen`, `weaponNames_gen` and `artifactNames_gen` */
  t: TFunction
}

/** The written rotation, its members' turns apart (as the KQM sheet does) */
function turns(text: string) {
  return text
    .split(/\s*(?:->|→|\n)+\s*/)
    .map((turn) => turn.replace(/^>\s*/, '').trim())
    .filter(Boolean)
}

/** The comparison as the card shows it: both sides as KQM sheets, the swap and the change */
export function compareCardData(
  a: Side,
  b: Side,
  ctx: CompareCardContext
): KqmCompareCardData {
  const { t, gender } = ctx
  const label = (key: string) => t(`juanlab:kqmCompare.card.${key}`)
  const labels: KqmCompareCardSide['labels'] = {
    team: label('team'),
    damage: label('damage'),
    dist: label('share'),
    field: '',
    // (what the build reaches, and what it must reach: both, each labelled)
    er: label('erBuild'),
    erTarget: label('erTarget'),
    total: label('total'),
    dpr: 'DPR',
    dps: 'DPS',
    rotation: label('rotation'),
    notes: '',
    // (the mark: the app's name)
    siteName: 'Juan-optimizer',
  }
  const nameOf = (key: Side['members'][number]['key']) =>
    t(`charNames_gen:${charKeyToLocGenderedCharKey(key, gender)}`)
  const sideData = (side: Side): KqmCompareCardSide => ({
    name: side.members.map((m) => nameOf(m.key)).join(' / '),
    members: side.members.map((m) => ({
      ...kqmCardFace(m.key, gender),
      name: nameOf(m.key),
      constellation: m.constellation,
      weapon: m.build
        ? {
            name: t(`weaponNames_gen:${m.build.weapon.key}`),
            refinement: m.build.weapon.refinement,
            icon: weaponAsset(m.build.weapon.key, true),
          }
        : { name: '', refinement: 1 },
      sets: m.build
        ? Object.keys(m.build.sets).map((key) => ({
            name: t(`artifactNames_gen:${key}`),
            icon: artifactDefIcon(key as never),
          }))
        : [],
      damage: formatDamage(m.damage),
      share: m.share,
      er: `${Math.round(m.erValue)}%`,
      erTarget: `${Math.round(m.er)}%`,
    })),
    total: formatDamage(side.dpr),
    dps: side.rotationTime > 0 ? formatDamage(side.dps) : undefined,
    seconds:
      side.rotationTime > 0
        ? `${Math.round(side.rotationTime * 10) / 10}s`
        : undefined,
    rotation: turns(side.rotation),
    notes: '',
    labels,
  })
  const gain = (from: number, to: number) =>
    from > 0 ? formatGain(to / from - 1) : '–'
  return {
    name: ctx.teamName || label('title'),
    a: sideData(a),
    b: sideData(b),
    swap: { out: ctx.outName, in: ctx.inName },
    labels: { ...labels, delta: label('delta') },
    delta: { dpr: gain(a.dpr, b.dpr), dps: gain(a.dps, b.dps) },
  }
}
