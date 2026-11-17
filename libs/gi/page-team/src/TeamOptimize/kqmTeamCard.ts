import { artifactDefIcon, weaponAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type { KqmBuild, KqmCardData } from '@genshin-optimizer/gi/ui'
import {
  BETA_KEYS,
  BETA_LABEL,
  currentRelease,
  kqmCardFace,
} from '@genshin-optimizer/gi/ui'
import type { TFunction } from 'i18next'
import { formatRateFull, localizeDecimal, secondsText } from './format'

/*
 * The KQM sheet's data (KQM Theorycrafting's Share → Team card), shared with KQM Compare's card:
 * both draw the same sheet from the same figures
 */

/**
 * What made the picture and when, small in its corner (to check a shared picture against later):
 * "Stellar Optimizer v1.11.2 · 16 Nov 2026"
 */
export const shareStamp = (locale?: string) =>
  `Juan-optimizer (Stellar v${currentRelease.version}) · ${new Date().toLocaleDateString(
    // (English: the browser's, as ever; another language: that language's)
    locale && !locale.toLowerCase().startsWith('en') ? locale : undefined,
    { day: 'numeric', month: 'short', year: 'numeric' }
  )}`

/** The unreleased content (keys) among `keys`, each once */
export const betaOf = (keys: Iterable<string>) =>
  [...new Set(keys)].filter((k) => BETA_KEYS.has(k)).sort()

/** The unreleased content a team's builds rest on: a member, a build's weapon or sets */
export const betaOfBuilds = (
  members: { key: CharacterKey; build?: KqmBuild }[]
) =>
  betaOf(
    members.flatMap(({ key, build }) => [
      key,
      ...(build ? [build.weapon.key, ...Object.keys(build.sets)] : []),
    ])
  )

/** The sheet's notes: the KQM standard and its talents */
export const kqmStandardNote = (t: TFunction, talents: number) =>
  t('page_team:teamOpt.kqm.share.standard', {
    defaultValue: 'KQM Standards · Talents {{talents}}',
    talents: `${talents}/${talents}/${talents}`,
  })

/** A member of the sheet, as a KQM result has it */
export interface KqmTeamCardMember {
  key: CharacterKey
  constellation: number
  /** Its build; absent: no weapon or sets shown */
  build?: KqmBuild
  /** Damage per rotation */
  damage: number
  /** The Energy Recharge its build reaches (%); absent: 100% */
  er?: number
  /** Its share of the rotation's field time (%), as the ER calculator has it */
  fieldTime?: number
}

/** The KQM sheet's data: names, icons, figures as the sheet writes them */
export function kqmTeamCardData({
  t,
  gender,
  name,
  members,
  total,
  rotationTime,
  rotation,
  notes,
  beta,
  siteName,
  locale,
}: {
  /** Loaded for `page_team`, `charNames_gen`, `weaponNames_gen` and `artifactNames_gen` */
  t: TFunction
  gender: GenderKey
  name: string
  members: KqmTeamCardMember[]
  /** The team's damage per rotation */
  total: number
  /** Seconds per rotation, when known */
  rotationTime?: number
  /** The written rotation, its members' turns apart */
  rotation: string[]
  notes: string
  /** It shows unreleased content */
  beta: boolean
  siteName: string
  /** The language the numbers are written in (default: English) */
  locale?: string
}): KqmCardData {
  const charName = (ck: CharacterKey) =>
    t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`)
  return {
    name,
    locale,
    members: members.map((m) => ({
      ...kqmCardFace(m.key, gender),
      name: charName(m.key),
      constellation: m.constellation,
      weapon: m.build
        ? {
            name: t(`weaponNames_gen:${m.build.weapon.key}`),
            refinement: m.build.weapon.refinement,
            icon: weaponAsset(m.build.weapon.key, true),
          }
        : { name: '–', refinement: 0 },
      sets: Object.keys(m.build?.sets ?? {}).map((key) => ({
        name: t(`artifactNames_gen:${key}`),
        icon: artifactDefIcon(key as never),
      })),
      damage: formatRateFull(m.damage, undefined, locale),
      share: total > 0 ? m.damage / total : 0,
      // (field time: the ER calculator's, from the rotation or as typed)
      field:
        rotationTime && m.fieldTime !== undefined
          ? secondsText(((m.fieldTime / 100) * rotationTime).toFixed(1), locale)
          : undefined,
      er: `${Math.round(m.er ?? 100)}%`,
    })),
    total: formatRateFull(total, undefined, locale),
    dps: rotationTime ? formatRateFull(total, rotationTime, locale) : undefined,
    seconds: rotationTime
      ? t('page_team:teamOpt.kqm.share.seconds', {
          defaultValue: '{{seconds}}s rotation',
          seconds: localizeDecimal(`${rotationTime}`, locale),
        })
      : undefined,
    rotation,
    notes,
    beta: beta ? BETA_LABEL : undefined,
    labels: {
      team: t('page_team:teamOpt.kqm.share.colTeam', 'Team'),
      damage: t('page_team:teamOpt.kqm.share.colDamage', 'Damage'),
      dist: t('page_team:teamOpt.kqm.share.colShare', 'Share'),
      field: t('page_team:teamOpt.kqm.share.colField', 'Field'),
      er: 'ER',
      total: t('page_team:teamOpt.kqm.share.total', 'Total'),
      dpr: 'DPR',
      dps: 'DPS',
      rotation: t('page_team:teamOpt.kqm.share.rotation', 'Rotation'),
      notes: t('page_team:teamOpt.kqm.share.notes', 'Notes'),
      siteName,
    },
  }
}
