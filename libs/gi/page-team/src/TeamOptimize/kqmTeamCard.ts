import { artifactDefIcon, weaponAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type {
  KqmBuild,
  KqmCardData,
  KqmCardDetails,
  KqmMemberStats,
} from '@genshin-optimizer/gi/ui'
import {
  BETA_KEYS,
  BETA_LABEL,
  currentRelease,
  kqmCardFace,
  kqmOutOfCombatStats,
  statName,
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

/**
 * The sheet's notes: the artifact standard the builds used and the talents. `standard`: its name
 * (Good, Great, a member's own…); absent: KQM Standards
 */
export const kqmStandardNote = (
  t: TFunction,
  talents: number,
  standard?: string
) =>
  standard
    ? t('page_team:teamOpt.kqm.share.standardTalents', {
        defaultValue: '{{standard}} · Talents {{talents}}',
        standard,
        talents: `${talents}/${talents}/${talents}`,
      })
    : t('page_team:teamOpt.kqm.share.standard', {
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
  /** Its build's stats out of combat (`kqmOutOfCombatStats`); given: the detailed sheet's block */
  stats?: KqmMemberStats
}

/** Which sheet the KQM cards draw: the usual one, or with each member's stats */
export type KqmCardView = 'normal' | 'detailed'

/** The KQM cards' last view, in this browser (a per-viewer convenience) */
export const KQM_CARD_VIEW_KEY = 'juanlab-kqmCardView'

/** The KQM cards' view last picked in this browser; none (or no storage): the usual one */
export function readKqmCardView(): KqmCardView {
  try {
    return globalThis.localStorage?.getItem(KQM_CARD_VIEW_KEY) === 'detailed'
      ? 'detailed'
      : 'normal'
  } catch {
    return 'normal'
  }
}

/** Remembers the KQM cards' view in this browser (nothing when storage is off) */
export function writeKqmCardView(view: KqmCardView) {
  try {
    globalThis.localStorage?.setItem(KQM_CARD_VIEW_KEY, view)
  } catch {
    // (private window, blocked storage: the view is simply not remembered)
  }
}

/**
 * A KQM card's download name in a view: the usual one for Normal; Detailed adds "-detailed" (the
 * same in every language), so both views can be downloaded side by side
 */
export const kqmCardFileName = (name: string, view: KqmCardView) =>
  view === 'detailed' ? `${name}-detailed` : name

/** A member whose stats a detailed card shows: its build (none: no stats) and constellation */
export type KqmStatsMember = {
  key: CharacterKey
  build?: KqmBuild
  constellation: number
}

/**
 * The members' stats out of combat (`kqmOutOfCombatStats`), at the run's KQM talents, on the
 * database their result was computed on. A member whose calculation throws gets none (a warning in
 * the console): the card still opens, that member without its details
 */
export function kqmMembersStats(
  database: ArtCharDatabase,
  members: KqmStatsMember[],
  talent: number
): Partial<Record<CharacterKey, KqmMemberStats>> {
  const stats: Partial<Record<CharacterKey, KqmMemberStats>> = {}
  for (const { key, build, constellation } of members) {
    if (!build) continue
    try {
      const own = kqmOutOfCombatStats(database, key, build, {
        constellation,
        talent,
      })
      if (own) stats[key] = own
    } catch (error) {
      console.warn(`KQM card: no stats for ${key}`, error)
    }
  }
  return stats
}

/** A stat's official name in `t`'s language (the `keymap` namespace; else `statName`'s) */
const statLabel = (t: TFunction, key: string) =>
  t(`keymap:${key}`, { defaultValue: statName(key) })

/** A main stat's name; HP%, ATK% and DEF% keep their % (their names alone read as flat) */
const mainLabel = (t: TFunction, key: string) => {
  const name = statLabel(t, key)
  return ['hp_', 'atk_', 'def_'].includes(key) && !name.includes('%')
    ? `${name}%`
    : name
}

const statFormats = new Map<string, Intl.NumberFormat>()
/** A stat's value as written: % (fractions) with one decimal, flat values whole; grouped */
function statValue(key: string, value: number, locale = 'en') {
  const percent = key.endsWith('_')
  const id = `${locale}|${percent}`
  let format = statFormats.get(id)
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: percent ? 1 : 0,
      maximumFractionDigits: percent ? 1 : 0,
      // (Italian groups 4 digits too: "2.315", as the game writes it; Intl.NumberFormat v3,
      // not in TypeScript's lib yet; an older browser reads it as `true`: "2315")
      useGrouping: 'always' as unknown as boolean,
    })
    statFormats.set(id, format)
  }
  return `${format.format(percent ? value * 100 : value)}${percent ? '%' : ''}`
}

/**
 * A member's block on the detailed sheet, from its stats out of combat: the three main stats and
 * the eight stats, named and written in `locale`'s language. `was`: the stats before a change
 * (KQM Compare's A); a row whose written value differs carries the one before.
 */
export function kqmCardDetails(
  t: TFunction,
  stats: KqmMemberStats,
  locale: string | undefined,
  was?: KqmMemberStats
): KqmCardDetails {
  const before = new Map(
    was?.stats.map(({ key, value }) => [key, statValue(key, value, locale)])
  )
  return {
    mainsTitle: t('page_team:teamOpt.card.mains', 'Main stats'),
    statsTitle: t(
      'page_team:teamOpt.card.outOfCombat',
      'Stats (out of combat)'
    ),
    mains: (['sands', 'goblet', 'circlet'] as const).map((slot) => ({
      slot: t(`page_team:teamOpt.kqm.${slot}`, {
        defaultValue: { sands: 'Sands', goblet: 'Goblet', circlet: 'Circlet' }[
          slot
        ],
      }),
      stat: mainLabel(t, stats.mains[slot]),
    })),
    stats: stats.stats.map(({ key, value }) => {
      const written = statValue(key, value, locale)
      const old = before.get(key)
      return {
        label: statLabel(t, key),
        value: written,
        ...(old !== undefined && old !== written ? { was: old } : {}),
      }
    }),
  }
}

const ER_NOTE =
  "Out-of-combat stats: no conditional effects or teammates. The ER in the table is the rotation's."
/**
 * A member whose Energy Recharge out of combat (its stats, when given) is not the table's, as the
 * table writes it (whole percent)
 */
const erDiffers = (m: KqmTeamCardMember) => {
  const er = m.stats?.stats.find((s) => s.key === 'enerRech_')?.value
  return er !== undefined && Math.round(er * 100) !== Math.round(m.er ?? 100)
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
      // (the detailed sheet only: the usual one stays as it was)
      ...(m.stats ? { details: kqmCardDetails(t, m.stats, locale) } : {}),
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
    // (the detailed sheet: its ER out of combat not the table's (the rotation's), said under)
    notes: members.some(erDiffers)
      ? `${notes}\n${t('page_team:teamOpt.card.erNote', ER_NOTE)}`
      : notes,
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
