import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type {
  KqmCardCell,
  KqmCardData,
  KqmCardMarks,
  KqmCompareCardData,
  KqmCompareFigure,
  KqmMemberStats,
  KqmTone,
  RotationMember,
} from '@genshin-optimizer/gi/ui'
import { BETA_LABEL, currentRelease } from '@genshin-optimizer/gi/ui'
import type { TFunction } from 'i18next'
import { formatGain, localizeDecimal, secondsText } from '../format'
import {
  betaOfBuilds,
  type KqmCardView,
  kqmCardDetails,
  kqmStandardNote,
  kqmTeamCardData,
  shareStamp,
} from '../kqmTeamCard'
import type { Side, SideMember } from './compareSwapKqm'
import { cut } from './swapFragment'

export interface CompareCardContext {
  teamName: string
  /** The leaving and the entering member */
  out: CharacterKey
  in: CharacterKey
  gender: GenderKey
  /**
   * Loaded for `juanlab`, `page_team`, `charNames_gen`, `weaponNames_gen` and
   * `artifactNames_gen`
   */
  t: TFunction
  /** The mark in the corner (default: the app, its version and the date) */
  siteName?: string
  /** The language the figures and the date are written in (default: English) */
  locale?: string
  /**
   * The detailed view: A's and B's members' stats out of combat (`kqmOutOfCombatStats`, each on
   * its own side's database); given, each member's block. `t` loaded for `keymap` too.
   */
  statsA?: Partial<Record<CharacterKey, KqmMemberStats>>
  statsB?: Partial<Record<CharacterKey, KqmMemberStats>>
}

/**
 * The swap's two sides as named: the two members; the same member re-entering (`same`: the same
 * key, not just the same name, which Travelers of different elements share), its name and the
 * constellation change ("Yae Miko C0", "C1"); at the same constellation too, its name twice (what
 * differs is its weapon or sets)
 */
export function swapSides(
  outName: string,
  inName: string,
  consOut: number,
  consIn: number,
  same: boolean
): { out: string; in: string } {
  return same && consOut !== consIn
    ? { out: `${outName} C${consOut}`, in: `C${consIn}` }
    : { out: outName, in: inName }
}

/** The swap as named: "Yae Miko → Mitya", "Yae Miko C0 → C1", "Yae Miko → Yae Miko" */
export function swapLabel(
  outName: string,
  inName: string,
  consOut: number,
  consIn: number,
  same: boolean
): string {
  const sides = swapSides(outName, inName, consOut, consIn, same)
  return `${sides.out} → ${sides.in}`
}

/**
 * The written rotation, its members' turns apart (as the KQM sheet does): cut where the parser cuts
 * it, at every separator and at each bare member name
 */
function turns(text: string, names: RotationMember[]) {
  const { parts, steps } = cut(text, names)
  return steps.map((i) => parts[i].trim()).filter(Boolean)
}

// (the table's columns: team, damage, [Δ], share, [field], ER build / required)
const WEIGHTS_A = {
  field: [0.29, 0.23, 0.14, 0.13, 0.21],
  none: [0.33, 0.26, 0.17, 0.24],
}
const WEIGHTS_B = {
  field: [0.24, 0.19, 0.12, 0.12, 0.12, 0.21],
  none: [0.28, 0.21, 0.13, 0.14, 0.24],
}

/** A change's tone: up is better (or worse, `lowerIsBetter`), none: plain */
const toneOf = (change: number, lowerIsBetter = false): KqmTone | undefined =>
  change === 0 ? undefined : change > 0 !== lowerIsBetter ? 'better' : 'worse'
/** A relative change ("+21%") in its tone; from nothing: a dash */
const gainOf = (from: number, to: number, locale?: string) => {
  if (!(from > 0)) return { text: '–' }
  const text = formatGain(to / from - 1, locale)
  return { text, tone: text === '±0%' ? undefined : toneOf(to - from) }
}
/** A change to show, with its sign: "+0.8", "−3" */
const signed = (value: number, digits: number, locale?: string) =>
  `${value > 0 ? '+' : '−'}${localizeDecimal(Math.abs(value).toFixed(digits), locale)}`
const fieldSeconds = (m: SideMember, side: Side) =>
  m.fieldTime !== undefined && side.rotationTime > 0
    ? (m.fieldTime / 100) * side.rotationTime
    : undefined

/**
 * The comparison as the card shows it: A and B as KQM sheets (as KQM Theorycrafting's Share → Team
 * card builds its own), what changed marked on B's (each member's damage, share, field time and ER
 * requirement against A's; the swapped member against the one it replaced), the swap, and the
 * change of the team's damage and rotation in the header
 */
export function compareCardData(
  a: Side,
  b: Side,
  ctx: CompareCardContext
): KqmCompareCardData {
  const { t, gender, locale } = ctx
  const label = (key: string, opts?: Record<string, unknown>) =>
    t(`juanlab:kqmCompare.card.${key}`, opts ?? {})
  const nameOf = (key: CharacterKey) =>
    t(`charNames_gen:${charKeyToLocGenderedCharKey(key, gender)}`)
  const outName = nameOf(ctx.out)
  const inName = nameOf(ctx.in)
  const siteName = ctx.siteName ?? shareStamp(locale)
  const beta = betaOfBuilds([...a.members, ...b.members]).length > 0

  const cardOf = (
    side: Side,
    stats?: Partial<Record<CharacterKey, KqmMemberStats>>
  ): KqmCardData => {
    const card = kqmTeamCardData({
      t,
      gender,
      name: side.members.map((m) => nameOf(m.key)).join(' / '),
      members: side.members.map((m) => ({
        key: m.key,
        constellation: m.constellation,
        build: m.build,
        damage: m.damage,
        er: m.erValue,
        fieldTime: m.fieldTime,
        ...(stats?.[m.key] && { stats: stats[m.key] }),
      })),
      total: side.dpr,
      rotationTime: side.rotationTime > 0 ? side.rotationTime : undefined,
      rotation: turns(
        side.rotation,
        side.members.map((m) => ({ characterKey: m.key, name: nameOf(m.key) }))
      ),
      notes: kqmStandardNote(t, side.talents ?? 9),
      beta,
      siteName,
      locale,
    })
    // (ER: what the build reaches, and what it must reach)
    return {
      ...card,
      members: card.members.map((m, i) => ({
        ...m,
        er: `${Math.round(side.members[i].erValue)}% / ${Math.round(side.members[i].er)}%`,
      })),
      labels: {
        ...card.labels,
        er: `${label('erBuild')}\n${label('erTarget')}`,
      },
    }
  }
  const cardA = cardOf(a, ctx.statsA)
  const cardB = cardOf(b, ctx.statsB)
  // (the same member re-entering: its stats that changed marked against A's; another member
  // entering, or a teammate (its build A's): nothing to mark)
  const statsWas = ctx.out === ctx.in ? ctx.statsA?.[ctx.out] : undefined
  const statsIn = ctx.statsB?.[ctx.in]
  if (statsWas && statsIn)
    cardB.members = cardB.members.map((m, i) =>
      b.members[i].key === ctx.in && m.details
        ? { ...m, details: kqmCardDetails(t, statsIn, locale, statsWas) }
        : m
    )
  const field = (card: KqmCardData) => card.members.some((m) => m.field)
  /** The swapped step's turn, as the comparison found it (by position, not by name) */
  const turnOf = (card: KqmCardData, side: Side) =>
    side.turn !== undefined && card.rotation?.[side.turn] !== undefined
      ? side.turn
      : undefined
  /** ER below what it must reach: a warning */
  const erCell = (m: SideMember): KqmCardCell | undefined =>
    Math.round(m.erValue) < Math.round(m.er)
      ? { tone: 'warn', warn: true }
      : undefined

  // B's members against A's: the same member, else the one it replaced
  const matchOf = (m: SideMember) =>
    a.members.find((x) => x.key === m.key) ??
    a.members.find((x) => x.key === ctx.out)
  const marksA: KqmCardMarks = {
    tag: 'A',
    weights: field(cardA) ? WEIGHTS_A.field : WEIGHTS_A.none,
    er: a.members.map(erCell),
  }
  const outIndex = a.members.findIndex((m) => m.key === ctx.out)
  if (outIndex >= 0) marksA.changed = { index: outIndex, badge: label('out') }
  marksA.rotationTurn = turnOf(cardA, a)

  const changes = b.members.map((m) => {
    const was = matchOf(m)
    const damage = was ? gainOf(was.damage, m.damage, locale) : { text: '–' }
    const shareChange = was ? (m.share - was.share) * 100 : 0
    const share: KqmCardCell | undefined =
      Math.abs(shareChange) >= 0.05
        ? {
            note: label('sharePoints', {
              value: signed(shareChange, 1, locale),
            }),
            noteTone: 'note',
          }
        : undefined
    const fieldNow = fieldSeconds(m, b)
    const fieldWas = was && fieldSeconds(was, a)
    const fieldChange =
      fieldNow !== undefined && fieldWas !== undefined ? fieldNow - fieldWas : 0
    const fieldCell: KqmCardCell | undefined =
      Math.abs(fieldChange) >= 0.05
        ? {
            note: secondsText(signed(fieldChange, 1), locale),
            noteTone: 'note',
          }
        : undefined
    // (the requirement: from A's to B's, lower is better; the build below it: a warning)
    const reqNow = Math.round(m.er)
    const reqWas = was && Math.round(was.er)
    const reqTone =
      reqWas !== undefined ? toneOf(reqNow - reqWas, true) : undefined
    const er: KqmCardCell | undefined =
      reqWas !== undefined && reqWas !== reqNow
        ? {
            ...erCell(m),
            note: `${reqWas}% → ${reqNow}%`,
            noteTone: reqTone,
          }
        : erCell(m)
    return { damage, share, field: fieldCell, er }
  })
  const inIndex = b.members.findIndex((m) => m.key === ctx.in)
  // (the swapped slot's constellation on each side: A's leaving member, B's entering one)
  const consOut = a.members[outIndex]?.constellation ?? 0
  const consIn = b.members[inIndex]?.constellation ?? 0
  const same = ctx.out === ctx.in
  const dpr = gainOf(a.dpr, b.dpr, locale)
  const dps = a.dps > 0 && b.dps > 0 ? gainOf(a.dps, b.dps, locale) : undefined
  const timeChange =
    a.rotationTime > 0 && b.rotationTime > 0
      ? Math.round((b.rotationTime - a.rotationTime) * 10) / 10
      : undefined
  const marksB: KqmCardMarks = {
    tag: 'B',
    weights: field(cardB) ? WEIGHTS_B.field : WEIGHTS_B.none,
    ...(inIndex >= 0 && {
      changed: {
        index: inIndex,
        badge: swapLabel(outName, inName, consOut, consIn, same),
      },
    }),
    rotationTurn: turnOf(cardB, b),
    delta: {
      header: 'Δ',
      members: changes.map((c) => c.damage),
      total: dpr,
      ...(dps && { dps }),
    },
    share: changes.map((c) => c.share),
    field: changes.map((c) => c.field),
    er: changes.map((c) => c.er),
    ...(timeChange
      ? {
          seconds: {
            note: secondsText(signed(timeChange, 1), locale),
            noteTone: toneOf(timeChange, true),
          },
        }
      : {}),
  }

  /** A change as the header shows it: an arrow and its sign, in its tone */
  const figure = (g: { text: string; tone?: KqmTone }): KqmCompareFigure =>
    g.tone
      ? { text: `${g.tone === 'better' ? '↑' : '↓'} ${g.text}`, tone: g.tone }
      : g
  const seconds = (s: number) =>
    secondsText(`${Math.round(s * 10) / 10}`, locale)
  return {
    name: ctx.teamName || label('title'),
    swap: swapSides(outName, inName, consOut, consIn, same),
    siteName,
    beta: beta ? BETA_LABEL : undefined,
    labels: {
      delta: label('delta'),
      dpr: 'DPR',
      dps: 'DPS',
      rotationTime: label('rotationTime'),
    },
    delta: {
      dpr: figure(dpr),
      ...(dps && { dps: figure(dps) }),
      ...(timeChange !== undefined && {
        rotationTime: {
          text: `${seconds(a.rotationTime)} → ${seconds(b.rotationTime)}`,
          tone: toneOf(timeChange, true),
        },
      }),
    },
    a: { card: cardA, marks: marksA },
    b: { card: cardB, marks: marksB },
  }
}

declare const __GO_BUILD_ID__: string

/**
 * The hidden record of how the comparison card was made (`CardImageDialog`'s watermark, as KQM
 * Theorycrafting's pictures carry theirs): the app's version and build, when, the team, the swap,
 * and both sides' figures and builds
 */
export function compareCardRecord({
  teamId,
  teamName,
  gender,
  out,
  inKey,
  a,
  b,
  view,
}: {
  teamId: string
  teamName: string
  gender: GenderKey
  out: CharacterKey
  inKey: CharacterKey
  a: Side
  b: Side
  /** Which sheet was drawn (the usual one, or with each member's stats) */
  view?: KqmCardView
}) {
  const side = (s: Side) => ({
    dpr: s.dpr,
    dps: s.dps,
    rotationTime: s.rotationTime,
    rotation: s.rotation,
    talents: s.talents,
    members: s.members.map((m) => ({
      key: m.key,
      constellation: m.constellation,
      damage: m.damage,
      share: m.share,
      er: m.er,
      erValue: m.erValue,
      fieldTime: m.fieldTime,
      fixed: m.fixed,
      build: m.build,
    })),
  })
  return {
    app: 'Juan-optimizer',
    version: currentRelease.version,
    build: typeof __GO_BUILD_ID__ === 'string' ? __GO_BUILD_ID__ : 'dev',
    site: globalThis.location?.host,
    generatedAt: new Date().toISOString(),
    picture: 'kqmCompare',
    view,
    beta: betaOfBuilds([...a.members, ...b.members]),
    gender,
    team: { id: teamId, name: teamName },
    swap: { out, in: inKey },
    a: side(a),
    b: side(b),
  }
}
