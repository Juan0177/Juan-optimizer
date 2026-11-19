import {
  CardThemed,
  InfoTooltipInline,
  ModalWrapper,
} from '@genshin-optimizer/common/ui'
import { deepClone, layeredAssignment } from '@genshin-optimizer/common/util'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allWeaponKeys,
  charKeyToLocGenderedCharKey,
} from '@genshin-optimizer/gi/consts'
import type {
  TeamOpt,
  TeamOptAttack,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  KqmBuild,
  KqmPlayed,
  KqmReplayInput,
  RotationEnergy,
  RotationTemplate,
  SimGear,
  TeamData,
  TeamDataOverrides,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  actionFrameDefaults,
  CharacterName,
  energyFromRotation,
  everyNthBursts,
  type FrameData,
  HEXEREI_CHARACTERS,
  kitModels,
  kqmMemberConstellation,
  kqmSimGear,
  lastRotation,
  needsRotationCalculation,
  parseRotation,
  REACTION_NAMES,
  type RotationMember,
  rotationAttacks,
  rotationBuffDefaults,
  rotationCalculation,
  rotationSamples,
  type SimBuffOwner,
  type SimHit,
  simulateRotationSamples,
  templatesForTeam,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded'
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded'
import TuneIcon from '@mui/icons-material/Tune'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Dialog,
  Divider,
  IconButton,
  Snackbar,
  type Theme,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import {
  Fragment,
  type ReactNode,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useAttackInfo, variantColor } from './AttackName'
import type { TeamBuff } from './buffs'
import { useTeamBuffs } from './buffs'
import { FrameDataPanel } from './FrameDataPanel'
import { MemberAvatar } from './MemberAvatar'
import { RotationCode } from './RotationCode'
import { templateText, TemplatesButton } from './RotationTemplates'
import type { TimelineMoment, TimelinePin } from './RotationTimeline'
import { laneColor, RotationTimeline, SHORT_SCREEN } from './RotationTimeline'
import {
  DEFAULT_SWAP_FRAMES,
  firstRotations,
  frameOverrides,
  openerCounted as openerIsCounted,
  type RotationTimingSettings,
  timingPing,
} from './RotationTiming'
import {
  TimelineHitStats,
  useMomentFigures,
  useTimelineFigures,
} from './TimelineFigures'
import { Disclosure, focusSx, numSx, quickSx, tokens, type } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'
import { kqmRotationView } from './useTeamOpt'

const storageKey = (teamId: string) => `teamOptRotationText_${teamId}`
/** What was typed but not used yet (kept when the writer closes) */
const draftKey = (teamId: string) => `teamOptRotationDraft_${teamId}`
const openerKey = (teamId: string) => `teamOptRotationOpener_${teamId}`
/**
 * The KQM tab's rotation: its saved text, opener and timing under their own keys (the Team
 * optimize tab's are the team's id)
 */
export const kqmRotationId = (teamId: string) => `${teamId}_kqm`
/** The saved rotation's id for a tab: the team's (Team optimize), or `kqmRotationId` */
export const rotationIdOf = (teamId: string, kqm?: unknown) =>
  kqm ? kqmRotationId(teamId) : teamId
/**
 * The ER calculator's "Burst: Every 2nd": that member's Burst in one of every 2 rotations (KQM's
 * runs, its timeline); none unless the ER comes from the calculator
 */
export function kqmBurstEvery(kqm: TeamOptKqm | undefined) {
  const calculator =
    kqm?.energySource === 'calculator' ? kqm.energyCalculator : undefined
  if (!calculator) return undefined
  const every = Object.fromEntries(
    Object.entries(calculator.members).map(([k, m]) => [k, m?.burstEvery ?? 1])
  ) as Partial<Record<CharacterKey, number>>
  return Object.values(every).some((n) => n !== 1) ? every : undefined
}
/** The KQM tab's rotation set up from Team optimize's the first time (a copy) */
export function copyRotationToKqm(
  teamId: string,
  /** The members' own constellations (Team optimize's attacks were played at them) */
  own: Partial<Record<CharacterKey, number>>
) {
  const kqmId = kqmRotationId(teamId)
  // (the copied attacks were played at the members' own constellations: at KQM's, the KQM tab
  // plays the rotation again and says what changed)
  if (localStorage.getItem(storageKey(teamId))?.trim()) {
    localStorage.setItem(
      consKey(kqmId),
      localStorage.getItem(consKey(teamId)) ?? JSON.stringify(own)
    )
    localStorage.setItem(copiedKey(kqmId), '1')
  }
  for (const key of [storageKey, openerKey, timingKey])
    if (
      localStorage.getItem(key(kqmId)) === null &&
      localStorage.getItem(key(teamId)) !== null
    )
      writeStored(key(kqmId), localStorage.getItem(key(teamId)))
}
/** The constellations the written rotation was last played at (its tab's: own, or KQM's) */
const consKey = (teamId: string) => `teamOptRotationCons_${teamId}`
/** Set while the KQM tab's rotation is a fresh copy of Team optimize's (its first play says so) */
const copiedKey = (teamId: string) => `teamOptRotationCopied_${teamId}`
const timingKey = (teamId: string) => `teamOptRotationTiming_${teamId}`
const timingOpenKey = 'teamOpt.timingOpen'
/**
 * Character frame data: the player's own, for every team. (Ping, once its own setting that
 * delayed every action, is now the swap time it gives, in each team's timing.)
 */
const frameDataKey = 'teamOpt.frameData'
/** A placeholder rotation with the team's own members: the supports, then the first member */
export const exampleRotation = (names: string[]) => {
  if (!names.length) return 'Zibai E N1 E N4 Q -> Zibai'
  const [main, ...supports] = names
  if (!supports.length) return `${main} E Q N3 CA N3 CA`
  return [
    ...supports.map((n) => `${n} E Q`),
    `${main} E N3 CA N3 CA`,
    supports[0],
  ].join(' -> ')
}
/** The writer's action words, inserted from the quick row */
const TOKENS: { text: string; key: string; label: string }[] = [
  { text: 'E', key: 'skill', label: 'Elemental Skill (tap)' },
  { text: 'hE', key: 'hold', label: 'Elemental Skill (hold)' },
  { text: 'Q', key: 'burst', label: 'Elemental Burst' },
  { text: 'N3', key: 'normal', label: 'Normal attacks: N1 to N6 hits' },
  {
    text: 'CA',
    key: 'charged',
    label:
      'Charged Attack (Sandrone: 3 condensed beams, CA[beams=2] for 2, up to 6 from C1; Mavuika: C3F spins 3 times, then the finisher; Arlecchino: CA[cancel] absorbs the Blood-Debt Directive without the hit; Chasca: CA[bullets=4] fires after 4 bullets)',
  },
  {
    text: 'P',
    key: 'plunge',
    label:
      'Plunging Attack (HP: high plunge, LP: low plunge; HP[collision] adds the hit on the way down)',
  },
  { text: 'D', key: 'dash', label: 'Dash' },
  { text: 'J', key: 'jump', label: 'Jump' },
  {
    text: 'W1',
    key: 'wait',
    label:
      'Wait: W1.5 is 1.5 s, W90f is 90 frames; WK is a walk (WK11f: 11 frames)',
  },
  {
    text: 'entry',
    key: 'swap',
    label:
      "Swap in only: the member's swap-in effect and nothing else (an Entry Skill)",
  },
  { text: '->', key: 'next', label: 'Next step or another member' },
]

/** The writer's saved state, with a signal so every view of it (the inline field, the writer) follows */
const storageEvent = 'teamOpt.rotationStorage'
function writeStored(key: string, value: string | null) {
  if (value === null) localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  window.dispatchEvent(new Event(storageEvent))
}
/** Saves the rotation's timing settings (the page's Rotations setting writes it directly) */
export function saveRotationTiming(
  teamId: string,
  timing: RotationTimingSettings
) {
  writeStored(timingKey(teamId), JSON.stringify(timing))
}
function subscribeStored(onChange: () => void) {
  window.addEventListener(storageEvent, onChange)
  return () => window.removeEventListener(storageEvent, onChange)
}
function useStored(key: string) {
  return useSyncExternalStore(subscribeStored, () => localStorage.getItem(key))
}
const parseTiming = (raw: string | null): RotationTimingSettings => {
  try {
    const v = JSON.parse(raw ?? '')
    if (v && typeof v === 'object' && v.edits) return v
  } catch {
    // (none saved)
  }
  return { edits: {} }
}
const parseFrameData = (raw: string | null): FrameData => {
  try {
    const v = JSON.parse(raw ?? '')
    if (v && typeof v === 'object') return v
  } catch {
    // (none saved)
  }
  return {}
}

/** The rotation in use, and what was typed since (a draft, kept until it is used or reverted) */
export function useRotationText(teamId: string) {
  const applied = useStored(storageKey(teamId)) ?? ''
  const draft = useStored(draftKey(teamId))
  const text = draft ?? applied
  const setText = useCallback(
    (value: string) =>
      writeStored(draftKey(teamId), value === applied ? null : value),
    [teamId, applied]
  )
  return { applied, text, setText, isDraft: text !== applied }
}

/** The settings the rotation plays with besides its text: opener, timing (swap) edits, frame data */
export function useRotationSettings(teamId: string) {
  const opener = useStored(openerKey(teamId)) ?? ''
  const timingRaw = useStored(timingKey(teamId))
  const frameRaw = useStored(frameDataKey)
  const timing = useMemo(() => parseTiming(timingRaw), [timingRaw])
  const frameData = useMemo(() => parseFrameData(frameRaw), [frameRaw])
  const edited =
    !!opener.trim() ||
    timing.swapFrames !== undefined ||
    timing.rotations !== undefined ||
    Object.keys(timing.edits).length > 0 ||
    Object.values(frameData).some((m) => Object.keys(m ?? {}).length > 0)
  return { opener, timing, frameData, edited }
}

/** The members' names as the parser matches them (any language) */
export function useMemberNames(members: TeamOptMember[]) {
  const { i18n } = useTranslation('charNames_gen')
  const { gender } = useDBMeta()
  return useMemo(
    () =>
      members.map(({ characterKey }) => ({
        characterKey,
        name: i18n.t(
          `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
        ),
      })),
    [members, gender, i18n]
  )
}

/** The team as the simulation sees it (constellations, elements, the members' sets) */
export function useSimTeam(
  members: TeamOptMember[],
  /**
   * KQM theorycrafting's settings: the rotation is then played at its constellations, with none
   * of the members' own weapons or sets (it never uses their builds)
   */
  kqm?: TeamOptKqm,
  /**
   * With KQM: the builds of its result shown on the page, whose weapons and sets the rotation is
   * played with (their effects: Instructor, Noblesse Oblige...); none without a current result
   */
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
) {
  const database = useDatabase()
  return useMemo(() => {
    const own = simTeamOf(members, database)
    if (!kqm) return own
    return {
      ...own,
      constellations: Object.fromEntries(
        own.members.map((k) => [k, kqmMemberConstellation(k, kqm)])
      ),
      gear: Object.fromEntries(
        own.members.flatMap((k) => {
          const build = kqmBuilds?.[k]
          return build ? [[k, kqmSimGear(build)]] : []
        })
      ),
    }
  }, [members, database, kqm, kqmBuilds])
}
function simTeamOf(members: TeamOptMember[], database: Database) {
  const keys = members.map((m) => m.characterKey)
  return {
    members: keys,
    constellations: Object.fromEntries(
      members.map((m) => [
        m.characterKey,
        (m.isTc
          ? database.buildTcs.get(m.loadoutDatum.buildTcId)?.character
              ?.constellation
          : database.chars.get(m.characterKey)?.constellation) ?? 0,
      ])
    ),
    elements: Object.fromEntries(keys.map((k) => [k, getCharEle(k)])) as never,
    // the members' current sets (for set effects the simulation plays: Thundering Fury)
    gear: Object.fromEntries(
      members.map((m) => {
        const sets: Record<string, number> = {}
        if (m.isTc) {
          const tcSets =
            database.buildTcs.get(m.loadoutDatum.buildTcId)?.artifact.sets ?? {}
          for (const [k, n] of Object.entries(tcSets)) sets[k] = n ?? 0
        } else
          for (const id of Object.values(m.artifactIds)) {
            const setKey = id ? database.arts.get(id)?.setKey : undefined
            if (setKey) sets[setKey] = (sets[setKey] ?? 0) + 1
          }
        const weapon = m.isTc
          ? database.buildTcs.get(m.loadoutDatum.buildTcId)?.weapon
          : database.weapons.get(m.weaponId)
        return [
          m.characterKey,
          { sets, weapon: weapon?.key, refinement: weapon?.refinement },
        ]
      })
    ),
  }
}
/** The team as a simulation plays it: the members' own (`simTeamOf`), or KQM's (`kqmRotationReplay`) */
type SimTeam = {
  members: CharacterKey[]
  constellations: Partial<Record<CharacterKey, number>>
  elements: ReturnType<typeof simTeamOf>['elements']
  gear: Partial<Record<CharacterKey, SimGear>>
}
type Database = ReturnType<typeof useDatabase>

/**
 * The written rotation played frame by frame: its steps, the simulation and each member's attacks
 * (only the buff states that differ from the members' own settings go on the attacks)
 */
export function simulateWritten({
  text,
  opener,
  timing,
  frameData,
  team,
  names,
  members,
  database,
  teamId,
  gender,
  openerWarning,
  repeats,
  keep,
  samples,
  calculation,
  current,
  kqm,
  auraTimeline,
  burstEvery,
  withoutBursts,
}: {
  /** The KQM tab's: its own switches are the states where no attack sets one (`current` absent) */
  kqm?: boolean
  /** Its Bursts left out (a fight that starts with no energy: its first rotation) */
  withoutBursts?: boolean
  /** Record the enemy's auras over time (the writer's timeline; never KQM's many replays) */
  auraTimeline?: boolean
  /**
   * Members that use their Burst only every Nth rotation (KQM's ER calculator): the written
   * rotation is played N in a row with their Burst in one of them (`loops` in the result)
   */
  burstEvery?: Partial<Record<CharacterKey, number>>
  text: string
  opener: string
  timing: RotationTimingSettings
  frameData: FrameData
  team: SimTeam
  names: RotationMember[]
  members: TeamOptMember[]
  database: Database
  teamId: string
  gender: GenderKey
  openerWarning: (warning: string) => string
  /**
   * How many times it is played, and which of them count. Default: as KQM counts it, 4 in a row
   * with the last 2 averaged (the pace it keeps: an action not ready again in time waits), the
   * result's `sim` then the last of them (what a timeline shows) and `counted` the 2.
   */
  repeats?: number
  keep?: 'middle' | 'all' | 'last2'
  /** Seeded samples of members with random effects (default 64) */
  samples?: number
  /** The builds the simulation's stats and heals are read from (default: the members' own) */
  calculation?: TeamDataOverrides
  /**
   * A conditional's state where no attack sets it (default: the member's or team's own): the
   * buff states an attack carries are the ones that differ from it
   */
  current?: (owner: SimBuffOwner, path: string[]) => string | undefined
}) {
  if (!text.trim()) return undefined
  const rotation = parseRotation(text, names)
  // the opener: the first rotation (counted from the start; else a setup before the loop)
  if (opener.trim()) {
    const parsed = parseRotation(opener, names)
    rotation.opener = parsed.steps
    rotation.warnings.push(...parsed.warnings.map(openerWarning))
  }
  if (withoutBursts) {
    // (a step that was only a Burst is left out: the member is not swapped in for nothing; a
    // Burst's alternative, "Q/N1", is played instead. What is not ready without the Bursts, a
    // Skill their Burst would have reset, is left out rather than waited for, as a player would)
    const strip = (steps: typeof rotation.steps) =>
      steps.flatMap((step) => {
        if (!step.actions.length) return [step]
        const actions = step.actions
          .flatMap((a) => (a.kind === 'burst' ? (a.otherwise ?? []) : [a]))
          .map((a) => ({ ...a, optional: true }))
        return actions.length ? [{ ...step, actions }] : []
      })
    rotation.steps = strip(rotation.steps)
    if (rotation.opener) rotation.opener = strip(rotation.opener)
  }
  if (!rotation.steps.length) return { rotation }
  // (a Burst every Nth rotation: N written rotations played as one, timing edits kept per copy)
  const nth = burstEvery ? everyNthBursts(rotation, burstEvery) : undefined
  const edits = frameOverrides(rotation, timing.edits)
  const loops = nth?.loops ?? 1
  // (the writer's and Team optimize's own play: the pace it keeps, as KQM counts it, or the first
  // few rotations from the start when chosen)
  const steady = repeats === undefined
  const first = firstRotations(timing)
  // (counted from the start, the opener is the first rotation, the rotation's copies after it,
  // unless it is a setup before the start)
  const openerCounted = !!rotation.opener?.length && openerIsCounted(timing)
  /** The written rotations counted from the start (each played copy is `loops` of them) */
  const fromStart =
    first === undefined
      ? undefined
      : openerCounted
        ? 1 + (first - 1) * loops
        : first * loops
  const sampled = team.members.some((m) => kitModels[m]?.sampled)
  const sim = simulateRotationSamples(
    {
      ...team,
      calculate: needsRotationCalculation(team.members, team.gear)
        ? rotationCalculation(database, teamId, gender, calculation)
        : undefined,
      rotation: nth?.rotation ?? rotation,
      frameOverrides: nth
        ? Object.fromEntries(
            nth.index.flatMap((written, played) =>
              edits[written] === undefined ? [] : [[played, edits[written]]]
            )
          )
        : edits,
      swapFrames: timing.swapFrames,
      frameData,
      repeats: first ?? (steady ? STEADY_REPEATS : repeats),
      keep: first ? 'all' : steady ? 'last2' : keep,
      openerCounted,
      auraTimeline,
    },
    // (two rotations kept: half the samples each, as much as one rotation of 64)
    // (no more than the members' kits need: a small randomness, few plays)
    sampled
      ? rotationSamples(
          team.members,
          kitModels,
          samples ?? (steady ? 32 : undefined)
        )
      : undefined
  )
  const own =
    current ??
    ((owner: SimBuffOwner, path: string[]) =>
      (kqm ? kqmConditional : ownConditional)(
        database,
        teamId,
        members,
        owner,
        path
      ))
  if (!steady)
    return {
      rotation,
      sim,
      own,
      attacks: rotationAttacks(sim, own),
      counted: undefined,
      loops,
      fromStart,
    }
  const counted = fromStart ?? STEADY_COUNTED
  return {
    rotation,
    // (what the timeline shows: the last of the two counted; the first few, all of them)
    sim: first ? sim : lastRotation(sim),
    own,
    // per rotation: the hits of those counted, averaged
    attacks: perRotation(rotationAttacks(sim, own), counted),
    counted: { sim, rotations: counted, openerCounted },
    loops,
    fromStart,
  }
}

/** Played the writer's way (default `repeats`): 4 rotations in a row, the last 2 counted */
const STEADY_REPEATS = 4
const STEADY_COUNTED = 2
/** Attacks of `rotations` rotations, per rotation */
function perRotation(
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>,
  rotations: number
) {
  return Object.fromEntries(
    Object.entries(attacks).map(([k, list]) => [
      k,
      (list ?? []).map((a) => ({ ...a, hits: (a.hits ?? 1) / rotations })),
    ])
  ) as Partial<Record<CharacterKey, TeamOptAttack[]>>
}
/** A played rotation's time per rotation, seconds (as counted: the steady pace) */
export const writtenSeconds = (result: WrittenRotation) =>
  result.counted
    ? result.counted.sim.frames / 60 / result.counted.rotations
    : result.sim
      ? result.sim.frames / 60
      : undefined
/**
 * When the rotation cannot keep its pace: its first time through (nothing waited for), seconds,
 * and what waits per rotation since (seconds each, the longest first); undefined when it keeps it
 */
export function writtenWaits(result: WrittenRotation) {
  const counted = result.counted
  // (the opener counted as the first rotation is another rotation: not its first time through)
  if (!counted || counted.openerCounted) return undefined
  const first = (counted.sim.rotationFrames?.[0] ?? 0) / 60
  const per = writtenSeconds(result) ?? 0
  const waits = Object.entries(counted.sim.stalls ?? {})
    .map(([label, frames]) => ({
      label,
      seconds: frames / 60 / counted.rotations,
    }))
    .filter((w) => w.seconds >= 0.1)
    .sort((a, b) => b.seconds - a.seconds)
  if (!first || per - first < 0.2) return undefined
  return { first, waits }
}
/** A conditional's state as the member (or the team) has it set */
function ownConditional(
  database: Database,
  teamId: string,
  members: TeamOptMember[],
  owner: SimBuffOwner,
  path: string[]
) {
  const member = members.find((m) => m.characterKey === owner)
  const conditional = (
    owner === 'team'
      ? database.teams.get(teamId)?.conditional
      : member
        ? database.teamChars.get(member.teamCharId)?.conditional
        : undefined
  ) as Record<string, Record<string, string>> | undefined
  return conditional?.[path[0]]?.[path[1]]
}
/**
 * A conditional's state as the KQM tab has it: its own team switches and members' switches
 * (`TeamOptKqm.teamConditional`, `passives`), never the members' own. Not set up yet: the team's.
 */
function kqmConditional(
  database: Database,
  teamId: string,
  members: TeamOptMember[],
  owner: SimBuffOwner,
  path: string[]
) {
  const kqm = database.teams.get(teamId)?.teamOpt?.kqm
  if (!kqm?.teamConditional)
    return ownConditional(database, teamId, members, owner, path)
  if (owner === 'team')
    return (
      (kqm.teamConditional as Record<string, Record<string, string>>)[
        path[0]
      ]?.[path[1]] || undefined
    )
  return kqm.passives?.[owner]?.[path[0]]?.[path[1]] || undefined
}
export type WrittenRotation = NonNullable<ReturnType<typeof simulateWritten>>

/** Weapons and artifact sets: KQM never takes a member's own switches for them */
const GEAR_KEYS = new Set<string>([...allWeaponKeys, ...allArtifactSetKeys])
/** Rotations played for KQM builds, and the last ones counted (the steady pace, past the start) */
const KQM_REPEATS = 4
const KQM_COUNTED = 2
/**
 * KQM theorycrafting's own play of the written rotation (`KqmRunArgs.replay`), apart from Team
 * optimize's (which plays it with the members' own constellations and gear): at the KQM
 * constellations, with the KQM builds' weapons and sets and their stats, 4 rotations in a row with
 * the last 2 averaged. Past the start, an action that is not ready again in time makes every
 * rotation wait (the second rotation alone can still have it from the start), and two in a row
 * even out a cooldown about a rotation long (one rotation can be a lucky one). Its time is the
 * rotation's time. Nothing written: undefined (the attacks entered are used as they are).
 */
export function kqmRotationReplay({
  database,
  teamId,
  members,
  gender,
  names,
  teamOpt,
  text: given,
}: {
  database: Database
  teamId: string
  members: TeamOptMember[]
  gender: GenderKey
  names: RotationMember[]
  teamOpt: TeamOpt
  /** Another rotation to play (one constellation's own); absent: the team's written one */
  text?: string
}):
  | ((input: KqmReplayInput) => KqmPlayed & { energy?: RotationEnergy })
  | undefined {
  const kqmId = kqmRotationId(teamId)
  const text = given ?? localStorage.getItem(storageKey(kqmId)) ?? ''
  if (!text.trim()) return undefined
  const common = {
    text,
    opener: localStorage.getItem(openerKey(kqmId)) ?? '',
    timing: parseTiming(localStorage.getItem(timingKey(kqmId))),
    frameData: parseFrameData(localStorage.getItem(frameDataKey)),
    names,
    members,
    database,
    teamId,
    gender,
    openerWarning: (w: string) => w,
  }
  const keys = members.map((m) => m.characterKey)
  const elements = simTeamOf(members, database).elements
  const burstEvery = kqmBurstEvery(teamOpt.kqm)
  return ({ constellations, gear, overrides }) => {
    // the state where no attack sets one, as KQM counts it: KQM's own switches ('' off), else
    // the rule's (never the members' or the team's own, once KQM has its own: `kqmOwnSettings`)
    const current = (owner: SimBuffOwner, path: string[]) => {
      if (owner === 'team') {
        const switches = overrides.teamConditional as
          | Record<string, Record<string, string>>
          | undefined
        return switches
          ? switches[path[0]]?.[path[1]] || undefined
          : ownConditional(database, teamId, members, owner, path)
      }
      const kqm = overrides.conditionalOverrides?.[owner]?.[path[0]]?.[path[1]]
      if (kqm !== undefined) return kqm || undefined
      if (
        overrides.ownKit !== false &&
        !(overrides.ownBuild === false && GEAR_KEYS.has(path[0]))
      ) {
        const own = ownConditional(database, teamId, members, owner, path)
        if (own !== undefined) return own
      }
      const rule = (
        overrides.extraConditionals?.[owner] as
          | Record<string, Record<string, string>>
          | undefined
      )?.[path[0]]?.[path[1]]
      return rule
    }
    const played = simulateWritten({
      ...common,
      team: { members: keys, constellations, elements, gear },
      calculation: overrides,
      current,
      repeats: KQM_REPEATS,
      keep: 'last2',
      burstEvery,
      // (two rotations kept: fewer samples, as much as the writer's one rotation of 64)
      samples: 32,
    })
    // (written but nothing to play: an error, not the attacks Team optimize played)
    if (!played?.sim || !played.attacks)
      throw new Error(
        'The written rotation has no actions to play. Check the rotation text.'
      )
    // (per rotation: the hits and time of the 2 counted, averaged, each of them `loops` written
    // rotations, or of those counted from the start; members the simulation has no kit for keep
    // the attacks entered for them)
    const counted = played.fromStart ?? KQM_COUNTED * (played.loops ?? 1)
    const attacks = { ...teamOpt.attacks }
    for (const k of keys)
      if (!played.sim.unsupported.includes(k))
        attacks[k] = (played.attacks[k] ?? []).map((a) => ({
          ...a,
          hits: a.hits / counted,
        }))
    const stalls = Object.entries(played.sim.stalls ?? {})
      .map(([label, frames]) => ({ label, seconds: frames / 60 / counted }))
      .filter((s) => s.seconds >= 0.3)
      .sort((a, b) => b.seconds - a.seconds)
    return {
      attacks,
      rotationTime: Math.round((played.sim.frames / 60 / counted) * 10) / 10,
      stalls,
      // (the ER calculator's inputs as this rotation plays them)
      energy: energyFromRotation(played.sim, keys, counted, constellations),
    }
  }
}

/**
 * Team optimize's written rotation played with the members' own constellations and gear, as KQM's
 * replay plays its own: the ER calculator's inputs as it plays them, and its length (s). Nothing
 * written: undefined.
 */
export function teamRotationEnergy({
  database,
  teamId,
  members,
  gender,
  names,
  team,
}: {
  database: Database
  teamId: string
  members: TeamOptMember[]
  gender: GenderKey
  names: RotationMember[]
  team: SimTeam
}): { energy: RotationEnergy; rotationTime: number } | undefined {
  const text = localStorage.getItem(storageKey(teamId)) ?? ''
  if (!text.trim()) return undefined
  const played = simulateWritten({
    text,
    opener: localStorage.getItem(openerKey(teamId)) ?? '',
    timing: parseTiming(localStorage.getItem(timingKey(teamId))),
    frameData: parseFrameData(localStorage.getItem(frameDataKey)),
    names,
    members,
    database,
    teamId,
    gender,
    openerWarning: (w: string) => w,
    team,
    repeats: KQM_REPEATS,
    keep: 'last2',
    samples: 32,
  })
  if (!played?.sim || played.sim.frames <= 0) return undefined
  const counted = played.fromStart ?? KQM_COUNTED * (played.loops ?? 1)
  return {
    energy: energyFromRotation(
      played.sim,
      members.map((m) => m.characterKey),
      counted,
      team.constellations
    ),
    rotationTime: Math.round((played.sim.frames / 60 / counted) * 10) / 10,
  }
}

/** Every member's hits in a played rotation */
export const writtenHits = (result: WrittenRotation) =>
  Object.values(result.attacks ?? {}).reduce(
    (n, attacks) => n + (attacks ?? []).reduce((m, a) => m + (a.hits ?? 1), 0),
    0
  )

/**
 * Uses a played rotation: its buffs on for the team, every member's attacks and the rotation time,
 * the writer's settings saved. Gives back what it replaced, for Undo.
 */
export function applyWritten({
  database,
  teamId,
  members,
  setTeamOpt,
  result,
  text,
  opener,
  timing,
  frameData,
  kqm,
  constellations,
}: {
  database: Database
  teamId: string
  members: TeamOptMember[]
  setTeamOpt: (update: TeamOptUpdate) => void
  result: WrittenRotation
  text: string
  opener: string
  timing: RotationTimingSettings
  frameData: FrameData
  /**
   * The KQM tab's rotation (its saved text; `setTeamOpt` is then the tab's, changing its own
   * attacks), not Team optimize's
   */
  kqm?: boolean
  /** The constellations it was played at (a change plays it again: `useRotationWriter`) */
  constellations: Partial<Record<CharacterKey, number>>
}): WriterUndo | undefined {
  const rid = rotationIdOf(teamId, kqm)
  const attacksNow = () => scopeAttacks(database, teamId, kqm)
  const { own } = result
  // (the rotations counted: their buffs, attacks and time, per rotation)
  const sim = result.counted?.sim ?? result.sim
  const rotations = result.counted?.rotations ?? 1
  if (!sim || !own) return undefined
  const keys = members.map((m) => m.characterKey)
  const before = database.teams.get(teamId)
  const snapshot = {
    teamOpt: before?.teamOpt ? structuredClone(before.teamOpt) : undefined,
    teamConditional: structuredClone(before?.conditional ?? {}),
    charConditionals: Object.fromEntries(
      members.map((m) => [
        m.teamCharId,
        structuredClone(
          database.teamChars.get(m.teamCharId)?.conditional ?? {}
        ),
      ])
    ),
    storage: Object.fromEntries(
      [
        storageKey(rid),
        draftKey(rid),
        openerKey(rid),
        timingKey(rid),
        consKey(rid),
        frameDataKey,
      ].map((k) => [k, localStorage.getItem(k)])
    ),
    replaced: Object.values(attacksNow()).some((a) => !!a?.length),
  }
  // The buffs the rotation times go on for the team (at the state they are in for most hits),
  // so Team Optimize lists them on; the attacks outside them turn them off
  const defaults = rotationBuffDefaults(sim).filter(
    (d) => d.owner === 'team' || keys.includes(d.owner)
  )
  // (on the KQM tab: into its own switches, never the team's or the members')
  if (kqm)
    setTeamOpt((o) => {
      const settings = (o.kqm ??= { ...defaultTeamOptKqm })
      const teamSwitches = structuredClone(
        settings.teamConditional ?? { resonance: {}, reaction: {} }
      )
      const passives = structuredClone(settings.passives ?? {})
      for (const d of defaults)
        if (d.owner === 'team') layeredAssignment(teamSwitches, d.path, d.value)
        else layeredAssignment((passives[d.owner] ??= {}), d.path, d.value)
      settings.teamConditional = teamSwitches
      settings.passives = passives
    })
  for (const d of kqm ? [] : defaults) {
    if (d.owner === 'team') {
      database.teams.set(teamId, (team) => {
        const values = deepClone(team.conditional ?? {})
        layeredAssignment(values, d.path, d.value)
        team.conditional = values
      })
      continue
    }
    const member = members.find((m) => m.characterKey === d.owner)
    if (!member) continue
    database.teamChars.set(member.teamCharId, (teamChar) => {
      const values = deepClone(teamChar.conditional ?? {})
      layeredAssignment(values, d.path, d.value)
      teamChar.conditional = values
    })
  }
  // Hexerei: Witch's Homework is taken as done for each Hexerei member (gcsim's default), so its
  // bonuses apply even alone; their Secret Rite effects still need two (the sheets' tally)
  // (KQM's rules count it already)
  const hexerei = members.filter(
    (m) => !kqm && HEXEREI_CHARACTERS.includes(m.characterKey)
  )
  for (const m of hexerei)
    database.teamChars.set(m.teamCharId, (teamChar) => {
      const values = deepClone(teamChar.conditional ?? {})
      layeredAssignment(values, [m.characterKey, 'lockHomework'], 'on')
      teamChar.conditional = values
    })
  const attacks = perRotation(
    rotationAttacks(sim, (owner, path) => {
      const d = defaults.find(
        (x) => x.owner === owner && x.path.join('.') === path.join('.')
      )
      return d ? d.value : own(owner, path)
    }),
    rotations
  )
  const seconds = sim.frames / 60 / rotations
  const unsupported = sim.unsupported
  const update = (o: TeamOpt) => {
    for (const k of keys)
      if (!unsupported.includes(k)) o.attacks[k] = attacks[k] ?? []
    if (seconds) o.rotationTime = Math.round(seconds * 10) / 10
  }
  // (the setter is the tab's: on the KQM tab it changes KQM's rotation, `kqmRotationUpdate`)
  setTeamOpt(update)
  writeStored(storageKey(rid), text)
  writeStored(draftKey(rid), null)
  writeStored(openerKey(rid), opener)
  writeStored(timingKey(rid), JSON.stringify(timing))
  writeStored(frameDataKey, JSON.stringify(frameData))
  localStorage.setItem(consKey(rid), JSON.stringify(constellations))
  return {
    ...snapshot,
    kqm: !!kqm,
    after: JSON.stringify(attacksNow()),
  }
}

/** A tab's attacks as saved: Team optimize's, or the KQM tab's own (`kqmRotationView`) */
function scopeAttacks(database: Database, teamId: string, kqm?: boolean) {
  const teamOpt = database.teams.get(teamId)?.teamOpt
  return (teamOpt && (kqm ? kqmRotationView(teamOpt) : teamOpt).attacks) ?? {}
}

/** The state using a rotation changes, to put back with Undo */
interface WriterUndo {
  teamOpt: TeamOpt | undefined
  teamConditional: unknown
  charConditionals: Record<string, unknown>
  storage: Record<string, string | null>
  /** The attacks right after applying: Undo only while they are still these */
  after: string
  /** There was a rotation before (Replace, not Add) */
  replaced: boolean
  /** The KQM tab's rotation */
  kqm: boolean
}
function restoreWriterUndo(
  database: Database,
  teamId: string,
  undo: WriterUndo
) {
  database.teams.set(teamId, (team) => {
    team.teamOpt = undo.teamOpt
    team.conditional = undo.teamConditional as typeof team.conditional
  })
  for (const [id, conditional] of Object.entries(undo.charConditionals))
    database.teamChars.set(id, (teamChar) => {
      teamChar.conditional = conditional as typeof teamChar.conditional
    })
  for (const [key, value] of Object.entries(undo.storage))
    writeStored(key, value)
}

/**
 * "Write rotation": the rotation as players write it ("Zibai E N1 E N4 Q …"), turned into each
 * member's attacks and hits by playing it frame by frame (`simulateRotation`), with the buffs on
 * for the hits they cover. The page writes it inline; this gives the writer dialog (timeline, frame
 * data, opener) and the Undo toast both use.
 */
export function useRotationWriter({
  teamId,
  members,
  setTeamOpt,
  teamData,
  kqm,
  kqmBuilds,
  kqmBuffs,
  kqmOverrides,
}: {
  teamId: string
  members: TeamOptMember[]
  setTeamOpt: (update: TeamOptUpdate) => void
  /** The team's data: the names of what the timeline follows */
  teamData?: TeamData
  /**
   * KQM theorycrafting's settings, on its tab: the rotation is previewed at its constellations
   * without the members' own gear, and the timeline shows no damage or stats (those are the
   * members' own builds')
   */
  kqm?: TeamOptKqm
  /** With KQM: the shown result's builds, whose weapon and set effects the preview plays */
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
  /**
   * With KQM: the shown result's buffs (its builds' weapon and set effects, as KQM counts them):
   * the timeline lists those it does not time (Disenchantment's, on by rule) as on all rotation
   */
  kqmBuffs?: TeamBuff[]
  /** With KQM: the shown result's builds as team data (what each buff gives on the timeline) */
  kqmOverrides?: TeamDataOverrides
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  // (whether the writer is open: kept apart from the page, so opening it draws the writer alone)
  const openStore = useMemo(() => writerOpenStore(), [])
  // what using a rotation replaced: undone for a few seconds, while the attacks are unchanged
  const [undo, setUndo] = useState<WriterUndo>()
  // (a rotation played again by itself: what changed, said in the toast instead)
  const [replayed, setReplayed] = useState<string>()
  const setApplied = useCallback((next: WriterUndo | undefined) => {
    setReplayed(undefined)
    setUndo(next)
  }, [])
  // A member's own constellation changed (or a TC build's): the written rotation is played again
  // at the new ones and used, as it would have been written with them (Zibai's C1 fifth Stride),
  // and the toast says what changed
  const { gender } = useDBMeta()
  // (the tab's: the members' own constellations, or KQM's)
  const ownTeam = useSimTeam(members, kqm)
  const names = useMemberNames(members)
  const rid = rotationIdOf(teamId, kqm)
  const { applied: appliedText } = useRotationText(rid)
  const { opener, timing, frameData } = useRotationSettings(rid)
  const consSig = JSON.stringify(ownTeam.constellations)
  // (another tab's rotation: what was said about this one's goes)
  useEffect(() => setApplied(undefined), [rid, setApplied])
  const isKqm = !!kqm
  useEffect(() => {
    const key = consKey(rid)
    if (!appliedText.trim()) return
    const stored = localStorage.getItem(key)
    // (one used before this was kept: taken as used at these constellations)
    if (stored === null) {
      localStorage.setItem(key, consSig)
      return
    }
    if (stored === consSig) {
      // (a copy at the same constellations: nothing to say)
      localStorage.removeItem(copiedKey(rid))
      return
    }
    // (marked as played at these only once it is: a render before then cancels and starts over)
    const id = setTimeout(() => {
      localStorage.setItem(key, consSig)
      const savedBefore = database.teams.get(teamId)?.teamOpt
      const before =
        savedBefore && (kqm ? kqmRotationView(savedBefore) : savedBefore)
      const beforeAttacks = before?.attacks ?? {}
      const beforeTime = before?.rotationTime
      let result: WrittenRotation | undefined
      try {
        result = simulateWritten({
          kqm: isKqm,
          text: appliedText,
          opener,
          timing,
          frameData,
          team: ownTeam,
          names,
          members,
          database,
          teamId,
          gender,
          openerWarning: (warning) => warning,
        })
      } catch {
        return
      }
      if (!result?.sim) return
      const next = applyWritten({
        database,
        teamId,
        members,
        setTeamOpt,
        result,
        text: appliedText,
        opener,
        timing,
        frameData,
        kqm: isKqm,
        constellations: ownTeam.constellations,
      })
      if (!next) return
      const saved = database.teams.get(teamId)?.teamOpt
      const after = saved && (kqm ? kqmRotationView(saved) : saved)
      const was = JSON.parse(stored) as Record<string, number>
      const changedCons = members
        .map((m) => m.characterKey)
        .filter((k) => (was[k] ?? 0) !== (ownTeam.constellations[k] ?? 0))
        .map(
          (k) =>
            `${names.find((n) => n.characterKey === k)?.name ?? k} C${was[k] ?? 0}→C${ownTeam.constellations[k] ?? 0}`
        )
      const changes: string[] = []
      const fmt = (v: number | undefined) =>
        v === undefined ? '–' : `${Math.round(v * 10) / 10} s`
      if (Math.abs((beforeTime ?? 0) - (after?.rotationTime ?? 0)) > 0.05)
        changes.push(`${fmt(beforeTime)} → ${fmt(after?.rotationTime)}`)
      for (const m of members) {
        const a = beforeAttacks[m.characterKey]?.length ?? 0
        const b = after?.attacks?.[m.characterKey]?.length ?? 0
        if (a !== b)
          changes.push(
            t('teamOpt.writer.replayedAttacks', {
              defaultValue: '{{name}} {{from}} → {{to}} attacks',
              name:
                names.find((n) => n.characterKey === m.characterKey)?.name ??
                m.characterKey,
              from: a,
              to: b,
            })
          )
      }
      const sameAttacks =
        JSON.stringify(beforeAttacks) === JSON.stringify(after?.attacks ?? {})
      if (sameAttacks && !changes.length) return
      setUndo(next)
      const changed = changes.length
        ? changes.join(' · ')
        : t('teamOpt.writer.replayedHits', 'its hits changed')
      // (the KQM tab's copy of Team optimize's rotation, played at KQM's constellations the first
      // time: nothing was changed by the user)
      const copied = localStorage.getItem(copiedKey(rid)) !== null
      localStorage.removeItem(copiedKey(rid))
      setReplayed(
        copied
          ? t('teamOpt.writer.replayedKqm', {
              defaultValue:
                'Rotation copied from Team optimize, played at the KQM constellations ({{cons}}) · {{changes}}',
              cons: members
                .map(
                  (m) =>
                    `${names.find((n) => n.characterKey === m.characterKey)?.name ?? m.characterKey} C${ownTeam.constellations[m.characterKey] ?? 0}`
                )
                .join(', '),
              changes: changed,
            })
          : t('teamOpt.writer.replayedCons', {
              defaultValue: '{{cons}}: rotation played again · {{changes}}',
              cons: changedCons.join(', '),
              changes: changed,
            })
      )
    }, 0)
    return () => clearTimeout(id)
    // (the rest read as they are when the constellations change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKqm, consSig, appliedText, rid])
  const undoNow = () => {
    if (!undo) return
    if (JSON.stringify(scopeAttacks(database, teamId, undo.kqm)) === undo.after)
      restoreWriterUndo(database, teamId, undo)
    setUndo(undefined)
  }
  const element = (
    <>
      <WriterHost
        store={openStore}
        teamId={teamId}
        members={members}
        teamData={teamData}
        kqm={kqm}
        kqmBuilds={kqmBuilds}
        kqmBuffs={kqmBuffs}
        kqmOverrides={kqmOverrides}
        setTeamOpt={setTeamOpt}
        onApplied={setApplied}
      />
      <Snackbar
        open={!!undo}
        autoHideDuration={replayed ? 15000 : 10000}
        onClose={(_, reason) => reason !== 'clickaway' && setApplied(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        ContentProps={{
          sx: (theme) => ({
            bgcolor: theme.palette.contentLight.main,
            color: 'text.primary',
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
            fontWeight: 500,
          }),
        }}
        message={
          replayed ??
          (undo?.replaced
            ? t('teamOpt.writer.replaced', 'Rotation replaced')
            : t('teamOpt.writer.appliedToast', 'Rotation added'))
        }
        action={
          // (played again for new constellations: nothing to undo, the old attacks are for
          // constellations the team no longer has)
          replayed ? (
            <Button
              size="small"
              onClick={() => setApplied(undefined)}
              sx={{ color: 'primary.main', fontWeight: 700 }}
            >
              {t('teamOpt.writer.replayedOk', 'OK')}
            </Button>
          ) : (
            <Button
              size="small"
              onClick={undoNow}
              sx={{ color: 'primary.main', fontWeight: 700 }}
            >
              {t('teamOpt.rotation.undo', 'Undo')}
            </Button>
          )
        }
      />
    </>
  )
  return {
    /** Whether the writer is open (`useWriterOpen` to follow it) */
    openStore,
    openWriter: openStore.open,
    /** Opens the writer with a template in its boxes (used once the player applies it) */
    openTemplate: openStore.openTemplate,
    onApplied: setApplied,
    element,
    /** The tab's saved rotation (`rotationIdOf`) */
    rid,
  }
}
export type RotationWriterHandle = ReturnType<typeof useRotationWriter>

/** Whether a writer is open, as a store: the page does not draw again when it opens or closes */
function writerOpenStore() {
  let open = false
  let template: RotationTemplate | undefined
  const listeners = new Set<() => void>()
  const set = (next: boolean) => {
    if (next === open) return
    open = next
    for (const l of listeners) l()
  }
  return {
    get: () => open,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    open: () => {
      template = undefined
      set(true)
    },
    openTemplate: (next: RotationTemplate) => {
      template = next
      set(true)
    },
    /** The template it was opened with (until it closes) */
    takeTemplate: () => template,
    close: () => {
      template = undefined
      set(false)
    },
  }
}
type WriterOpenStore = ReturnType<typeof writerOpenStore>

/** Whether the writer is open (drawn again when it opens or closes, not the page around it) */
export function useWriterOpen(writer: Pick<RotationWriterHandle, 'openStore'>) {
  return useSyncExternalStore(writer.openStore.subscribe, writer.openStore.get)
}

/** The writer window, drawn while its store says it is open */
function WriterHost({
  store,
  ...props
}: { store: WriterOpenStore } & Omit<
  Parameters<typeof WriterModal>[0],
  'onClose' | 'takeTemplate'
>) {
  const open = useSyncExternalStore(store.subscribe, store.get)
  return open ? (
    <WriterModal
      {...props}
      takeTemplate={store.takeTemplate}
      onClose={store.close}
    />
  ) : null
}

/**
 * `value` for playing the rotation: at once while a play is quick, once typing pauses when it is
 * slow (`playMs`, the last play's time: a heavy team's play blocks the page for a few hundred ms,
 * too long to run on every key)
 */
function useSettled<T>(value: T, playMs: { current: number }) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(
      () => startTransition(() => setSettled(value)),
      playMs.current > 50 ? 250 : 0
    )
    return () => clearTimeout(timer)
  }, [value, playMs])
  return settled
}

/**
 * Opens the writer dialog for the rotation written inline: its timeline, frame data and opener
 * (shown once there is a rotation text; reads the saved text itself, so typing re-renders only it)
 */
export function RotationConfigureButton({
  teamId,
  writer,
  disabled,
}: {
  teamId: string
  writer: RotationWriterHandle
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const { edited } = useRotationSettings(writer.rid)
  // (shown before a rotation is written too: the writer is where one is written)
  return (
    <Tooltip
      arrow
      title={t(
        'teamOpt.writer.configureTip',
        'Write the rotation and see its timeline, frame data and opener'
      )}
    >
      <span>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<TuneIcon />}
          onClick={writer.openWriter}
          disabled={disabled}
          sx={{
            height: 30,
            color: 'text.primary',
            borderColor: tokens.hairlineStrong,
            bgcolor: alpha(giTokens.parchment, 0.03),
            whiteSpace: 'nowrap',
            fontSize: 13,
            fontWeight: 600,
            px: 1.25,
            ...quickSx,
            ...focusSx,
            '&:hover': {
              borderColor: alpha(giTokens.parchment, 0.3),
              bgcolor: alpha(giTokens.parchment, 0.06),
            },
            '& .MuiButton-startIcon': { mr: 0.625 },
            '& .MuiButton-startIcon svg': {
              fontSize: 16,
              color: giTokens.gold,
            },
          }}
        >
          {t('teamOpt.writer.configure', 'Write rotation')}
          {edited && (
            <Box
              component="span"
              aria-label={t('teamOpt.timing.edited', 'Timing edited')}
              sx={{
                ml: 0.75,
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: 'primary.main',
              }}
            />
          )}
        </Button>
      </span>
    </Tooltip>
  )
}

/** Inserts an action word at the cursor, spaced from its neighbours */
export function insertWord(
  el: HTMLTextAreaElement | null,
  text: string,
  word: string,
  setText: (value: string) => void
) {
  const start = el?.selectionStart ?? text.length
  const end = el?.selectionEnd ?? text.length
  const before = text.slice(0, start)
  const after = text.slice(end)
  const pad = before && !/\s$/.test(before) ? ' ' : ''
  const tail = after && !/^\s/.test(after) ? ' ' : ''
  setText(`${before}${pad}${word}${tail}${after}`)
  const caret = before.length + pad.length + word.length + tail.length
  requestAnimationFrame(() => {
    el?.focus()
    el?.setSelectionRange(caret, caret)
  })
}

function WriterModal({
  teamId,
  members,
  teamData,
  kqm,
  kqmBuilds,
  kqmBuffs,
  kqmOverrides,
  setTeamOpt,
  onClose,
  onApplied,
  takeTemplate,
}: {
  teamId: string
  members: TeamOptMember[]
  teamData: TeamData | undefined
  kqm: TeamOptKqm | undefined
  kqmBuilds: Partial<Record<CharacterKey, KqmBuild>> | undefined
  kqmBuffs: TeamBuff[] | undefined
  kqmOverrides: TeamDataOverrides | undefined
  setTeamOpt: (update: TeamOptUpdate) => void
  onClose: () => void
  onApplied: (undo: WriterUndo) => void
  /** The template it opens with, if any */
  takeTemplate?: () => RotationTemplate | undefined
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  // a phone in landscape (or a narrow window): the detailed timeline takes the whole screen
  const fullScreen = useMediaQuery(`${SHORT_SCREEN}, (max-width: 700px)`)
  // the rotation in use, and a draft typed since (kept when the writer is closed without using it):
  // the tab's own (Team optimize's, or KQM's)
  const rid = rotationIdOf(teamId, kqm)
  const { applied, text, setText, isDraft: changed } = useRotationText(rid)
  const isDraft = changed && !!applied.trim()
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const openerRef = useRef<HTMLTextAreaElement | null>(null)
  // (the last play's time: a slow one waits for typing to pause)
  const playMs = useRef(0)
  const deferred = useSettled(text, playMs)
  const names = useMemberNames(members)
  const memberKeys = useMemo(
    () => members.map((m) => m.characterKey),
    [members]
  )
  const templates = useMemo(() => templatesForTeam(memberKeys), [memberKeys])
  const [startTemplate] = useState(() => takeTemplate?.())
  const [openerText, setOpenerText] = useState(() =>
    startTemplate
      ? templateText(startTemplate.opener ?? '', names)
      : (localStorage.getItem(openerKey(rid)) ?? '')
  )
  const deferredOpener = useSettled(openerText, playMs)
  const [openerShown, setOpenerShown] = useState(() => !!openerText.trim())
  const pickTemplate = (template: RotationTemplate) => {
    setText(templateText(template.text, names))
    setOpenerText(templateText(template.opener ?? '', names))
    setOpenerShown(!!template.opener)
  }
  // (a template chosen on the start screen: its rotation is the draft, used once it is applied)
  useEffect(() => {
    if (startTemplate) setText(templateText(startTemplate.text, names))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // the box the quick row inserts into: the one typed in last
  const [target, setTarget] = useState<'loop' | 'opener'>('loop')
  const insert = (word: string) =>
    target === 'opener' && openerShown
      ? insertWord(openerRef.current, openerText, word, setOpenerText)
      : insertWord(inputRef.current, text, word, setText)
  const [syntaxOpen, setSyntaxOpen] = useState(false)
  const [timing, setTiming] = useState(() =>
    parseTiming(localStorage.getItem(timingKey(rid)))
  )
  const deferredTiming = useDeferredValue(timing)
  const [frameData, setFrameData] = useState(() =>
    parseFrameData(localStorage.getItem(frameDataKey))
  )
  const deferredFrameData = useDeferredValue(frameData)
  const [timingOpen, setTimingOpen] = useState(
    () => localStorage.getItem(timingOpenKey) === 'on'
  )
  const [inspectorTab, setInspectorTab] = useState<'steps' | 'characters'>(
    'steps'
  )
  const [selectedStep, setSelectedStep] = useState<number>()
  const toggleTiming = (force?: boolean) => {
    const next = force ?? !timingOpen
    if (next === timingOpen) return
    localStorage.setItem(timingOpenKey, next ? 'on' : '')
    setTimingOpen(next)
    // (narrow screens: the panel is under the previews, so bring it into view)
    if (next && window.matchMedia('(max-width: 899.95px)').matches)
      requestAnimationFrame(() =>
        document
          .getElementById('rotation-timing')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      )
  }
  const keys = members.map((m) => m.characterKey)

  const team = useSimTeam(members, kqm, kqmBuilds)
  // (the attacks a rotation leaves are the tab's: at the members' own constellations, or KQM's
  // without the shown builds' gear)
  const ownTeam = useSimTeam(members, kqm)
  const figures = !kqm
  // each member's own frame data for every action (shown as the defaults), once the panel opens
  const frameDefaults = useMemo(
    () =>
      timingOpen
        ? Object.fromEntries(
            team.members.map((m) => [m, actionFrameDefaults(team, m)])
          )
        : {},
    [team, timingOpen]
  )

  // (using the rotation closes the writer: the team it changes is not played again before that)
  const closing = useRef(false)
  const lastResult = useRef<ReturnType<typeof simulateWritten>>(undefined)
  const isKqm = !!kqm
  // the window first: the rotation is played once it is open (a play blocks the page for a moment,
  // which would hold the window back and stall its opening)
  const [primed, setPrimed] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => startTransition(() => setPrimed(true)), 200)
    return () => clearTimeout(id)
  }, [])
  const result = useMemo(
    () => {
      if (!primed) return undefined
      if (closing.current && lastResult.current) return lastResult.current
      const start = performance.now()
      const played = simulateWritten({
        kqm: isKqm,
        text: deferred,
        opener: deferredOpener,
        timing: deferredTiming,
        frameData: deferredFrameData,
        team,
        names,
        members,
        database,
        teamId,
        gender,
        auraTimeline: true,
        openerWarning: (warning) =>
          t('teamOpt.writer.openerWarning', {
            defaultValue: 'Opener: {{warning}}',
            warning,
          }),
      })
      playMs.current = performance.now() - start
      lastResult.current = played
      return played
    },
    // (the members' constellations are read when the text changes)
    [
      primed,
      isKqm,
      deferred,
      deferredTiming,
      deferredFrameData,
      deferredOpener,
      t,
      team,
      names,
      members,
      gender,
      database,
      teamId,
    ]
  )
  // the detailed timeline's window
  const [detailOpen, setDetailOpen] = useState(false)
  // (the detailed window over the whole screen: always on a small one, else when asked)
  const [detailFull, setDetailFull] = useState(false)
  const detailFullScreen = fullScreen || detailFull
  // (the moment pinned: the same in the timeline here and in the detailed window)
  const [timelinePin, setTimelinePin] = useState<TimelinePin>()
  // (what both timelines, the writer's and the detailed window's, are given)
  const timelineProps = (
    rotation: NonNullable<typeof result>['rotation'],
    sim: NonNullable<NonNullable<typeof result>['sim']>
  ) => ({
    members: keys,
    rotation,
    sim,
    edited: editedSteps,
    selected: selectedStep,
    teamData,
    // (on the KQM tab, the KQM builds' effects: never the members' own)
    buffs: figures ? teamBuffs : kqmBuffs,
    damage: timelineFigures.damage,
    renderHit: (hit: SimHit) => {
      const found = timelineFigures.attackOf?.(hit)
      return (
        found && (
          <TimelineHitStats
            teamId={teamId}
            characterKey={found.characterKey}
            attack={found.attack}
          />
        )
      )
    },
    onSelect: (i: number) => {
      setDetailOpen(false)
      setSelectedStep(i)
      setInspectorTab('steps')
      toggleTiming(true)
    },
  })
  // the members' stats at the timeline's moment and what each buff up then gives: their own
  // builds; on the KQM tab the shown result's (none before a result)
  const [moment, setMoment] = useState<TimelineMoment>()
  const momentOn = figures || !!kqmOverrides
  const { stats: momentStats, effects: momentEffects } = useMomentFigures(
    teamId,
    moment,
    {
      enabled: momentOn,
      teamData,
      overrides: figures ? undefined : kqmOverrides,
    }
  )
  // (the members' own weapon and set effects: listed on the timeline, never on the KQM tab)
  const teamBuffs = useTeamBuffs(teamId, teamData)
  // the timeline's damage and stats, with the members' own builds
  const timelineFigures = useTimelineFigures(
    teamId,
    result?.sim,
    result?.own,
    figures
  )
  // a mode or stance's version of an action (Zibai's Spirit Steed's Stride) has its own frame data:
  // the versions this rotation played join each member's defaults
  const frameDefaultsWithVersions = useMemo(() => {
    const played = result?.sim?.actionData
    if (!played) return frameDefaults
    const out = { ...frameDefaults }
    for (const [member, data] of Object.entries(played))
      for (const [key, d] of Object.entries(data ?? {}))
        if (d.variant && out[member as CharacterKey])
          out[member as CharacterKey] = {
            ...out[member as CharacterKey],
            [key]: d,
          }
    return out
  }, [frameDefaults, result])
  const timingEdited =
    timing.swapFrames !== undefined ||
    timing.rotations !== undefined ||
    keys.some((k) => Object.keys(frameData[k] ?? {}).length > 0) ||
    (!!result &&
      Object.keys(frameOverrides(result.rotation, timing.edits)).length > 0)

  const seconds = result ? writtenSeconds(result) : undefined
  const waited = result ? writtenWaits(result) : undefined
  const hadRotation = Object.values(scopeAttacks(database, teamId, !!kqm)).some(
    (a) => !!a?.length
  )
  // (typed since the preview's play, which waits for a pause on a heavy team: used as it is now)
  const stale = deferred !== text || deferredOpener !== openerText
  const apply = () => {
    if (!result?.sim && !stale) return
    const applied =
      kqm || stale
        ? simulateWritten({
            kqm: !!kqm,
            text,
            opener: openerShown ? openerText : '',
            timing,
            frameData,
            team: ownTeam,
            names,
            members,
            database,
            teamId,
            gender,
            openerWarning: (warning) => warning,
          })
        : result
    if (!applied?.sim) return
    closing.current = true
    const undo = applyWritten({
      database,
      teamId,
      members,
      setTeamOpt,
      result: applied,
      text,
      opener: openerShown ? openerText : '',
      timing,
      frameData,
      kqm: !!kqm,
      constellations: ownTeam.constellations,
    })
    if (undo) onApplied(undo)
    onClose()
  }

  const overrides = result?.rotation
    ? frameOverrides(result.rotation, timing.edits)
    : {}
  const editedSteps = new Set(Object.keys(overrides).map(Number))
  const warnings = [
    ...new Set([...(result?.sim?.warnings ?? result?.rotation.warnings ?? [])]),
  ]

  return (
    <ModalWrapper open onClose={onClose} containerProps={{ maxWidth: 'xl' }}>
      {/* (phones and tablets: the window scrolls as one; its footer stays at the bottom of the
          screen, so the card must not clip it) */}
      <CardThemed
        role="dialog"
        aria-modal="true"
        aria-labelledby="rotation-writer-title"
        sx={{ overflow: { xs: 'visible', md: 'hidden' } }}
      >
        {/* title, the timing inspector's toggle, close */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: { xs: 2, sm: 2.5 },
            py: 1.5,
          }}
        >
          <Typography
            id="rotation-writer-title"
            component="h2"
            sx={{ flexGrow: 1, ...type.section }}
          >
            {t('teamOpt.writer.title', 'Write rotation')}{' '}
            <InfoTooltipInline
              title={t(
                'teamOpt.writer.subtitle',
                'Who acts and what they do, step by step. The timeline and hits follow as you type.'
              )}
            />
          </Typography>
          <Button
            size="small"
            color="inherit"
            variant="outlined"
            startIcon={<TuneIcon fontSize="small" />}
            onClick={() => toggleTiming()}
            aria-pressed={timingOpen}
            aria-controls="rotation-timing"
            sx={(theme) => ({
              borderColor: timingOpen
                ? alpha(theme.palette.primary.main, 0.6)
                : 'divider',
              color: timingOpen ? 'primary.main' : 'text.primary',
              bgcolor: timingOpen
                ? alpha(theme.palette.primary.main, 0.1)
                : 'transparent',
              whiteSpace: 'nowrap',
            })}
          >
            {t('teamOpt.frames.button', 'Frame data')}
            {timingEdited && (
              <Box
                component="span"
                title={t('teamOpt.timing.edited', 'Timing edited')}
                sx={{
                  ml: 0.75,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                }}
              />
            )}
          </Button>
          <IconButton
            onClick={onClose}
            aria-label={t('teamOpt.editor.close', 'Close')}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        <Divider />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              md: timingOpen ? 'minmax(0, 1fr) 420px' : 'minmax(0, 1fr)',
            },
            minHeight: 0,
            // (a phone in landscape: one column, the window scrolls, not each column in its 76%)
            [`@media ${SHORT_SCREEN}`]: {
              gridTemplateColumns: 'minmax(0, 1fr)',
            },
          }}
        >
          <Box
            sx={{
              p: { xs: 1.5, sm: 3 },
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              maxHeight: { md: '80vh' },
              overflowY: { md: 'auto' },
              // (the column scrolls: its parts keep their height. Shrunk, the timeline's box went
              // to 0 on a laptop at 100% zoom and the hit cards covered the chart)
              '& > *': { flexShrink: 0 },
              [`@media ${SHORT_SCREEN}`]: {
                maxHeight: 'none',
                overflowY: 'visible',
              },
            }}
          >
            {/* the rotation and its first-rotation-only opener: one code panel, the quick row under
                both (it inserts into the box typed in last) */}
            <WriterSection first>
              <Box
                sx={{
                  borderRadius: tokens.radius.panel,
                  bgcolor: tokens.inset,
                  border: tokensHairline,
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    p: { xs: 1.25, sm: 1.75 },
                    pb: { xs: 1.25, sm: 1.5 },
                  }}
                >
                  <EditorHead
                    label={t('teamOpt.writer.loop', 'Rotation')}
                    aside={
                      <>
                        {isDraft && (
                          <Button
                            size="small"
                            color="inherit"
                            onClick={() => setText(applied)}
                            sx={{
                              color: 'text.secondary',
                              whiteSpace: 'nowrap',
                              fontSize: 12.5,
                            }}
                          >
                            {t(
                              'teamOpt.writer.revert',
                              'Not used yet · Revert'
                            )}
                          </Button>
                        )}
                        <TemplatesButton
                          templates={templates}
                          team={memberKeys}
                          onPick={pickTemplate}
                        />
                        <Button
                          size="small"
                          color="inherit"
                          aria-expanded={syntaxOpen}
                          aria-controls="rotation-syntax"
                          onClick={() => setSyntaxOpen((open) => !open)}
                          sx={(theme) => ({
                            fontSize: 12.5,
                            whiteSpace: 'nowrap',
                            color: syntaxOpen
                              ? 'primary.main'
                              : 'text.secondary',
                            bgcolor: syntaxOpen
                              ? alpha(theme.palette.primary.main, 0.1)
                              : 'transparent',
                          })}
                        >
                          {t('teamOpt.writer.syntax', 'How to write it')}
                        </Button>
                      </>
                    }
                  />
                  <RotationCode
                    autoFocus
                    value={text}
                    onChange={setText}
                    names={names}
                    label={t('teamOpt.writer.loop', 'Rotation')}
                    placeholder={exampleRotation(names.map((n) => n.name))}
                    inputRef={inputRef}
                    active={target === 'loop'}
                    onFocus={() => setTarget('loop')}
                  />
                  {openerShown && (
                    <>
                      <EditorHead
                        sx={{ mt: 1 }}
                        label={t(
                          'teamOpt.writer.opener',
                          'First rotation only'
                        )}
                        info={t(
                          'teamOpt.writer.openerTip',
                          'Your first rotation, when it differs from the rest (no Energy at the start, a setup skill). Played instead of the rotation the first time through. Counted from the start, it is the first rotation; repeating, it only sets up cooldowns, summons and auras and is not counted.'
                        )}
                        aside={
                          <>
                            {/* (counted from the start: the first rotation, or a setup before the start) */}
                            {firstRotations(timing) !== undefined && (
                              <Tooltip
                                title={t(
                                  'teamOpt.writer.openerCountedTip',
                                  'Off: played before the start as a setup and not counted. Its cooldowns, summons and auras carry into the rotations.'
                                )}
                              >
                                <Box
                                  component="label"
                                  sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 0.25,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    color: 'text.secondary',
                                    fontSize: 12.5,
                                  }}
                                >
                                  <Checkbox
                                    size="small"
                                    checked={!timing.openerSetup}
                                    onChange={(_, checked) => {
                                      const { openerSetup: _setup, ...rest } =
                                        timing
                                      setTiming(
                                        checked
                                          ? rest
                                          : { ...rest, openerSetup: true }
                                      )
                                    }}
                                    sx={{ p: 0.5 }}
                                  />
                                  {t('teamOpt.writer.openerCounted', 'Counted')}
                                </Box>
                              </Tooltip>
                            )}
                            <Tooltip
                              title={t('teamOpt.writer.removeOpener', 'Remove')}
                            >
                              <IconButton
                                size="small"
                                aria-label={t(
                                  'teamOpt.writer.removeOpener',
                                  'Remove'
                                )}
                                onClick={() => {
                                  setOpenerShown(false)
                                  setOpenerText('')
                                  setTarget('loop')
                                }}
                                sx={{ color: 'text.secondary' }}
                              >
                                <CloseIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          </>
                        }
                      />
                      <RotationCode
                        minRows={1}
                        value={openerText}
                        onChange={setOpenerText}
                        names={names}
                        label={t(
                          'teamOpt.writer.opener',
                          'First rotation only'
                        )}
                        placeholder={exampleRotation(names.map((n) => n.name))}
                        inputRef={openerRef}
                        active={target === 'opener'}
                        onFocus={() => setTarget('opener')}
                      />
                    </>
                  )}
                </Box>
                <WriterQuickRow
                  bar
                  members={members}
                  onInsert={insert}
                  into={
                    openerShown
                      ? target === 'opener'
                        ? t('teamOpt.writer.opener', 'First rotation only')
                        : t('teamOpt.writer.loop', 'Rotation')
                      : undefined
                  }
                  trailing={
                    !openerShown && (
                      <Button
                        size="small"
                        color="inherit"
                        startIcon={
                          <AddIcon sx={{ fontSize: '16px !important' }} />
                        }
                        onClick={() => {
                          setOpenerShown(true)
                          setTarget('opener')
                          requestAnimationFrame(() =>
                            openerRef.current?.focus()
                          )
                        }}
                        sx={{
                          color: 'text.secondary',
                          fontSize: 12.5,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t(
                          'teamOpt.writer.addOpenerShort',
                          'First rotation only'
                        )}
                      </Button>
                    )
                  }
                />
                {syntaxOpen && <SyntaxSheet />}
              </Box>
              {!!warnings.length && (
                <Box
                  role="status"
                  sx={(theme) => ({
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.25,
                    px: 1.5,
                    py: 1,
                    borderRadius: tokens.radius.inset,
                    bgcolor: alpha(theme.palette.warning.main, 0.07),
                    border: `1px solid ${alpha(theme.palette.warning.main, 0.22)}`,
                  })}
                >
                  {warnings.map((w) => (
                    <Typography key={w} variant="body2" color="warning.main">
                      {w}
                    </Typography>
                  ))}
                </Box>
              )}
            </WriterSection>
            {result?.sim && seconds !== undefined ? (
              <>
                {/* how long it takes (the frame settings it plays with beside), then its timeline */}
                <WriterSection>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      columnGap: 1.5,
                      rowGap: 1,
                      mb: 1.25,
                    }}
                  >
                    {/* the time per rotation, and what of it is waiting for cooldowns */}
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'baseline',
                        flexWrap: 'wrap',
                        columnGap: 1.25,
                        rowGap: 0.5,
                        minWidth: 0,
                      }}
                    >
                      <Typography sx={type.figure}>
                        {seconds.toFixed(1)}
                        <Box
                          component="span"
                          sx={{ fontSize: 15, fontWeight: 500, ml: 0.5 }}
                        >
                          s
                        </Box>
                      </Typography>
                      <Typography sx={{ ...type.label, ...numSx }}>
                        {t('teamOpt.writer.perRotation', 'per rotation')} ·{' '}
                        {Math.round(seconds * 60)}{' '}
                        {t('teamOpt.writer.frames', 'frames')}
                      </Typography>
                      {waited && (
                        <WaitsChip waited={waited} seconds={seconds} />
                      )}
                    </Box>
                    {/* the frame settings it plays with: together on the right, wrapping as one */}
                    <Box
                      sx={{
                        ml: 'auto',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 0.75,
                      }}
                    >
                      <SettingChip
                        label={t('teamOpt.timing.swap', 'Swap time')}
                        value={`${timing.swapFrames ?? DEFAULT_SWAP_FRAMES} f`}
                        edited={timing.swapFrames !== undefined}
                        onClick={() => toggleTiming(true)}
                      />
                      <SettingChip
                        label={t('teamOpt.frames.ping', 'Ping')}
                        value={`${timingPing(timing)} ms`}
                        edited={timing.swapFrames !== undefined}
                        onClick={() => toggleTiming(true)}
                      />
                      {/* (the Rotations setting is on the page, beside the rotation: shown, not set) */}
                      {firstRotations(timing) !== undefined && (
                        <SettingChip
                          label={t('teamOpt.timing.rotations', 'Rotations')}
                          value={t('teamOpt.timing.firstN', {
                            defaultValue: 'First {{count}}',
                            count: firstRotations(timing),
                          })}
                          edited
                        />
                      )}
                    </Box>
                  </Box>
                  <RotationTimeline
                    {...timelineProps(result.rotation, result.sim)}
                    stats={detailOpen ? undefined : momentStats}
                    effects={detailOpen ? undefined : momentEffects}
                    onMoment={momentOn && !detailOpen ? setMoment : undefined}
                    onOpenDetail={() => setDetailOpen(true)}
                    pinned={timelinePin}
                    onPin={setTimelinePin}
                  />
                  {/* the detailed timeline: its own large window */}
                  <Dialog
                    open={detailOpen}
                    onClose={() => setDetailOpen(false)}
                    maxWidth={false}
                    fullScreen={detailFullScreen}
                    PaperProps={{
                      sx: {
                        width: detailFullScreen
                          ? '100vw'
                          : 'min(1760px, calc(100vw - 32px))',
                        // (as tall as the screen allows, always: what the moment's panel shows
                        // changes its height, which would move the window while pointing)
                        height: detailFullScreen
                          ? '100dvh'
                          : 'calc(100vh - 32px)',
                        maxHeight: detailFullScreen
                          ? '100dvh'
                          : 'calc(100vh - 32px)',
                        m: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        bgcolor: tokens.panel,
                        backgroundImage: 'none',
                        border: detailFullScreen
                          ? 'none'
                          : `1px solid ${tokens.hairline}`,
                        borderRadius: detailFullScreen
                          ? 0
                          : tokens.radius.panel,
                      },
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 2,
                        flexShrink: 0,
                        pl: fullScreen ? 1.5 : 3,
                        pr: fullScreen ? 0.5 : 1.5,
                        py: fullScreen ? 0.25 : 1.75,
                        borderBottom: `1px solid ${tokens.hairline}`,
                      }}
                    >
                      <Typography component="h2" sx={type.section}>
                        {t('teamOpt.timeline.title', 'Timeline')}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: 15,
                          fontWeight: 650,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {(seconds ?? result.sim.frames / 60).toFixed(1)} s
                      </Typography>
                      <Typography
                        noWrap
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 13,
                          color: 'text.secondary',
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      >
                        {text}
                      </Typography>
                      {/* (a small screen has it full already) */}
                      {!fullScreen && (
                        <Tooltip
                          title={
                            detailFull
                              ? t(
                                  'teamOpt.timeline.exitFull',
                                  'Exit full screen'
                                )
                              : t('teamOpt.timeline.full', 'Full screen')
                          }
                        >
                          <IconButton
                            onClick={() => setDetailFull((on) => !on)}
                            aria-pressed={detailFull}
                            aria-label={t(
                              'teamOpt.timeline.full',
                              'Full screen'
                            )}
                            sx={{ alignSelf: 'center', ...quickSx, ...focusSx }}
                          >
                            {detailFull ? (
                              <FullscreenExitRoundedIcon />
                            ) : (
                              <FullscreenRoundedIcon />
                            )}
                          </IconButton>
                        </Tooltip>
                      )}
                      <IconButton
                        onClick={() => setDetailOpen(false)}
                        aria-label={t('teamOpt.editor.close', 'Close')}
                        sx={{ alignSelf: 'center', ...quickSx, ...focusSx }}
                      >
                        <CloseIcon />
                      </IconButton>
                    </Box>
                    <Box
                      sx={{
                        minHeight: 0,
                        p: fullScreen ? 1 : 3,
                        overflowY: 'auto',
                      }}
                    >
                      {detailOpen && (
                        <RotationTimeline
                          {...timelineProps(result.rotation, result.sim)}
                          detail
                          // (a bar here: its step selected and its moment pinned; the window stays,
                          // where the simple timeline's bar opens the step's timing)
                          onSelect={setSelectedStep}
                          stats={momentStats}
                          effects={momentEffects}
                          onMoment={momentOn ? setMoment : undefined}
                          pinned={timelinePin}
                          onPin={setTimelinePin}
                        />
                      )}
                    </Box>
                  </Dialog>
                </WriterSection>
                <WriterSection
                  title={t('teamOpt.writer.hitsTitle', 'Hits per rotation')}
                >
                  <HitsSummary
                    members={members}
                    teamData={teamData}
                    attacks={result.attacks}
                    unsupported={result.sim.unsupported}
                  />
                </WriterSection>
                {!!result.sim.notes.length && (
                  <WriterSection>
                    <RotationNotes notes={result.sim.notes} />
                  </WriterSection>
                )}
              </>
            ) : (
              <WriterSection>
                <EmptyTimeline playing={!primed && !!deferred.trim()} />
              </WriterSection>
            )}
          </Box>
          {timingOpen && (
            <Box
              id="rotation-timing"
              component="aside"
              sx={(theme) => ({
                borderLeft: { md: `1px solid ${theme.palette.divider}` },
                borderTop: {
                  xs: `1px solid ${theme.palette.divider}`,
                  md: 'none',
                },
                display: 'flex',
                flexDirection: 'column',
                maxHeight: { md: '76vh' },
                minHeight: 0,
                minWidth: 0,
                [`@media ${SHORT_SCREEN}`]: {
                  maxHeight: 'none',
                  borderLeft: 'none',
                  borderTop: `1px solid ${theme.palette.divider}`,
                },
              })}
            >
              <FrameDataPanel
                members={keys}
                rotation={result?.rotation}
                sim={result?.sim}
                defaults={frameDefaultsWithVersions}
                frameData={frameData}
                setFrameData={setFrameData}
                timing={timing}
                setTiming={setTiming}
                tab={inspectorTab}
                setTab={setInspectorTab}
                selectedStep={selectedStep}
                onSelectStep={setSelectedStep}
              />
            </Box>
          )}
        </Box>
        <Divider />
        <Box
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1,
            px: { xs: 1.5, sm: 2.5 },
            py: 1.5,
            // (phones and tablets: Use this rotation always in reach, not under the hit lists)
            position: { xs: 'sticky', md: 'static' },
            bottom: 0,
            zIndex: 3,
            bgcolor: 'contentNormal.main',
            borderTop: { xs: `1px solid ${theme.palette.divider}`, md: 'none' },
            borderRadius: { xs: '0 0 12px 12px', md: 0 },
          })}
        >
          {timingEdited && (
            <Typography
              variant="caption"
              color="primary.main"
              sx={{ mr: 'auto' }}
            >
              {t('teamOpt.frames.withEdits', 'with your frame data')}
            </Typography>
          )}
          <Button color="secondary" onClick={onClose}>
            {t('teamOpt.runDialog.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={!result?.sim && !stale}
            onClick={apply}
            sx={result?.sim || stale ? giCtaSx : undefined}
          >
            {hadRotation
              ? t('teamOpt.writer.replace', 'Replace rotation')
              : t('teamOpt.writer.apply', 'Use this rotation')}
          </Button>
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

/** The text fields: a code surface (monospace, roomy lines, a gold ring when focused) */
export const editorSx = (theme: Theme) => ({
  '& .MuiInputBase-root': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 14.5,
    lineHeight: 1.75,
    bgcolor: theme.palette.contentDark.main,
    borderRadius: 2,
    transition: 'box-shadow .15s',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: alpha(theme.palette.text.primary, 0.12),
  },
  '& .MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: alpha(theme.palette.text.primary, 0.24),
  },
  '& .MuiInputBase-root.Mui-focused': {
    boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.18)}`,
  },
  '& .MuiInputBase-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: alpha(theme.palette.primary.main, 0.7),
    borderWidth: 1,
  },
  '& textarea::placeholder, & input::placeholder': {
    color: theme.palette.text.secondary,
    opacity: 0.55,
  },
})

/**
 * The time a repeating rotation waits for cooldowns from the one before (a Burst used late in one
 * rotation and early in the next): one short chip, what waited and why on hover
 */
function WaitsChip({
  waited,
  seconds,
}: {
  waited: NonNullable<ReturnType<typeof writtenWaits>>
  seconds: number
}) {
  const { t } = useTranslation('page_team')
  return (
    <Tooltip
      placement="bottom-start"
      title={
        <Box
          sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, py: 0.25 }}
        >
          <Box>
            {t('teamOpt.writer.firstTime', {
              defaultValue: '{{seconds}} s without waiting',
              seconds: waited.first.toFixed(1),
            })}
          </Box>
          {!!waited.waits.length && (
            <Box
              component="dl"
              sx={{
                m: 0,
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto',
                columnGap: 2,
                rowGap: 0.25,
                '& dd': { m: 0, ...numSx, textAlign: 'right' },
              }}
            >
              {waited.waits.map((w) => (
                <Fragment key={w.label}>
                  <dt>{w.label}</dt>
                  <dd>{w.seconds.toFixed(1)} s</dd>
                </Fragment>
              ))}
            </Box>
          )}
          <Box sx={{ opacity: 0.75 }}>
            {t(
              'teamOpt.writer.waitedTip',
              'Played over and over, an action can still be on cooldown when the next rotation reaches it (for example a Burst used late in one rotation and early in the next): the rotation waits for it. Its first time through, nothing waits. Team optimize and KQM count the time per rotation, waits included.'
            )}
          </Box>
        </Box>
      }
    >
      <Box
        component="span"
        tabIndex={0}
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          px: 0.875,
          height: 24,
          borderRadius: tokens.radius.pill,
          fontSize: 12.5,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          color: 'warning.main',
          bgcolor: alpha(theme.palette.warning.main, 0.1),
          boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.warning.main, 0.3)}`,
          cursor: 'help',
          ...numSx,
          ...focusSx,
        })}
      >
        {t('teamOpt.writer.waitsShort', {
          defaultValue: '{{seconds}} s waiting for cooldowns',
          seconds: Math.max(0, seconds - waited.first).toFixed(1),
        })}
      </Box>
    </Tooltip>
  )
}

/** A frame setting in the summary (opens the timing inspector; without `onClick`, shown only) */
function SettingChip({
  label,
  value,
  edited,
  onClick,
}: {
  label: string
  value: string
  edited: boolean
  onClick?: () => void
}) {
  return (
    <ButtonBase
      onClick={onClick}
      disabled={!onClick}
      sx={(theme) => ({
        gap: 0.75,
        px: 1,
        py: 0.375,
        borderRadius: 1.25,
        fontSize: 12.5,
        color: 'text.secondary',
        border: `1px solid ${
          edited
            ? alpha(theme.palette.primary.main, 0.5)
            : alpha(theme.palette.text.primary, 0.12)
        }`,
        '&:hover': { color: 'text.primary' },
      })}
    >
      {label}
      <Box
        component="span"
        sx={{
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: edited ? 'primary.main' : 'text.primary',
        }}
      >
        {value}
      </Box>
    </ButtonBase>
  )
}

/** Before a rotation is written: the timeline's frame, empty */
function EmptyTimeline({ playing }: { playing?: boolean }) {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={(theme) => ({
        mt: 1,
        height: 150,
        borderRadius: 2,
        border: `1px dashed ${alpha(theme.palette.text.primary, 0.14)}`,
        backgroundImage: `repeating-linear-gradient(90deg, transparent 0 59px, ${alpha(theme.palette.text.primary, 0.05)} 59px 60px)`,
        display: 'grid',
        placeItems: 'center',
        ...(playing && {
          '@keyframes writerPlaying': {
            from: { opacity: 0.45 },
            to: { opacity: 1 },
          },
          '& p': {
            animation: 'writerPlaying .8s ease-in-out infinite alternate',
          },
          '@media (prefers-reduced-motion: reduce)': {
            '& p': { animation: 'none' },
          },
        }),
      })}
    >
      <Typography variant="body2" color="text.secondary">
        {playing
          ? t('teamOpt.writer.playing', 'Playing the rotation…')
          : t('teamOpt.writer.emptyTimeline', 'The rotation plays out here')}
      </Typography>
    </Box>
  )
}

/** One part of an attack in a hit card: what kind of hit it is ("Stellar-Conduct"), how many */
interface HitPart {
  tag?: string
  n: number
  path: string[]
}
/**
 * One attack of a member's hit card, named once: its name in the hit's own colour (its element,
 * or its Stellar or Lunar reaction's hue, as in the rotation panel) with its first part's kind
 * and count, its other parts (a Stellar-Conduct hit, a DoT) as quiet rows under it
 */
function HitGroup({
  name,
  parts,
  data,
}: {
  name: string
  parts: HitPart[]
  data: UIData | undefined
}) {
  const [first, ...rest] = parts
  const info = useAttackInfo(data, first.path)
  const color = variantColor(info?.element)
  const count = (value: number, quiet?: boolean) => (
    <Box
      component="span"
      sx={{
        ...numSx,
        fontWeight: quiet ? 500 : 650,
        color: quiet ? 'text.secondary' : 'text.primary',
        textAlign: 'right',
      }}
    >
      {Math.round(value * 100) / 100}
    </Box>
  )
  const tagSx = {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11.5,
    color: 'text.secondary',
  } as const
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: 1.5,
        py: 0.75,
        fontSize: 12.5,
        lineHeight: 1.45,
        '& + &': { borderTop: `1px solid ${tokens.hairline}` },
      }}
    >
      <Tooltip
        title={first.tag ? `${name} (${first.tag})` : name}
        placement="top-start"
        enterDelay={600}
        disableInteractive
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 0.75,
            minWidth: 0,
          }}
        >
          <Box
            component="span"
            sx={{
              color,
              fontWeight: 550,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </Box>
          {first.tag && (
            <Box component="span" sx={tagSx}>
              {first.tag}
            </Box>
          )}
        </Box>
      </Tooltip>
      {count(first.n)}
      {rest.map((part) => (
        <Fragment key={part.tag ?? part.path.join('.')}>
          <Box component="span" sx={{ ...tagSx, pl: 1.5 }}>
            {part.tag ?? name}
          </Box>
          {count(part.n, true)}
        </Fragment>
      ))}
    </Box>
  )
}

/**
 * A part of the writer: a hairline above it (not the first), its heading in sentence case, then
 * its content
 */
function WriterSection({
  title,
  aside,
  first,
  children,
}: {
  title?: ReactNode
  aside?: ReactNode
  first?: boolean
  children: ReactNode
}) {
  return (
    <Box
      component="section"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: 0,
        // (space between the parts, no rules: each is a panel or a titled group of its own)
        ...(first ? {} : { mt: { xs: 2, sm: 3 } }),
      }}
    >
      {(title || aside) && <EditorHead label={title} aside={aside} />}
      {children}
    </Box>
  )
}

function HitsSummary({
  members,
  attacks,
  unsupported,
  teamData,
}: {
  /** The team's data: each attack's own colour (its element or reaction) */
  teamData: TeamData | undefined
  members: TeamOptMember[]
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>> | undefined
  unsupported: CharacterKey[]
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  return (
    // (columns by the space it has, not the screen: the frame data panel beside it narrows it.
    // Every member in a row when they fit, else two by two, never 3 + 1)
    <Box sx={{ containerType: 'inline-size' }}>
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: 'minmax(0, 1fr)',
          '@container (min-width: 480px)': {
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          },
          [`@container (min-width: ${members.length * 250}px)`]: {
            gridTemplateColumns: `repeat(${members.length}, minmax(0, 1fr))`,
          },
        }}
      >
        {members.map(({ characterKey }) => {
          // each attack once ("Palestar Crown"), its kinds of hit (Cryo, Stellar-Conduct) as its parts
          const groups = new Map<string, HitPart[]>()
          for (const a of attacks?.[characterKey] ?? []) {
            const base = a.description ?? a.path.join('.')
            const label = a.reaction
              ? `${base} (${REACTION_NAMES[a.reaction] ?? a.reaction})`
              : base
            // "Wing Dance Move (Stellar-Swirl)": the attack, then what kind of hit it is
            const tagged = label.match(/^(.*?)\s*\(([^()]*)\)$/)
            const name = tagged ? tagged[1] : label
            const tag = tagged?.[2]
            const parts = groups.get(name) ?? []
            const part = parts.find((p) => p.tag === tag)
            if (part) part.n += a.hits ?? 1
            else parts.push({ tag, n: a.hits ?? 1, path: a.path })
            groups.set(name, parts)
          }
          const sums = [...groups.values()].map((parts) =>
            parts.reduce((sum, p) => sum + p.n, 0)
          )
          const total = sums.reduce((a, b) => a + b, 0)
          return (
            <Box
              key={characterKey}
              sx={{
                px: 1.5,
                pt: 1.25,
                pb: 0.75,
                borderRadius: tokens.radius.inset,
                bgcolor: tokens.inset,
                border: tokensHairline,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  pb: 0.75,
                  borderBottom: tokensHairline,
                }}
              >
                <MemberAvatar characterKey={characterKey} size={24} />
                <Typography noWrap sx={{ fontSize: 14, fontWeight: 650 }}>
                  <CharacterName characterKey={characterKey} gender={gender} />
                </Typography>
                <Typography
                  component="span"
                  sx={{
                    ...type.label,
                    ...numSx,
                    ml: 'auto',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {!kitModels[characterKey]
                    ? t('teamOpt.writer.noKitShort', 'attacks kept')
                    : t('teamOpt.writer.hitCount', {
                        defaultValue: '{{count}} hits',
                        count: Math.round(total * 100) / 100,
                      })}
                </Typography>
              </Box>
              {unsupported.includes(characterKey) ? null : groups.size ? (
                <Box>
                  {[...groups].map(([name, parts]) => (
                    <HitGroup
                      key={name}
                      name={name}
                      parts={parts}
                      data={teamData?.[characterKey]?.target}
                    />
                  ))}
                </Box>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {t('teamOpt.writer.none', 'No hits')}
                </Typography>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/**
 * What the simulation assumed or could not check, and what the rotation waited for: folded
 * behind one line, each a short row (its subject, then what it says)
 */
function RotationNotes({ notes }: { notes: string[] }) {
  const { t } = useTranslation('page_team')
  const [open, setOpen] = useState(false)
  const waits = notes.filter((n) => n.startsWith('Waited '))
  const rest = notes.filter((n) => !n.startsWith('Waited '))
  return (
    <Disclosure
      open={open}
      onToggle={() => setOpen((o) => !o)}
      label={t('teamOpt.writer.notes', 'Notes')}
      count={notes.length}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          columnGap: 1.5,
          rowGap: 0.75,
          mt: 0.5,
          p: 1.5,
          borderRadius: 2,
          bgcolor: tokens.inset,
          border: tokensHairline,
          fontSize: 12.5,
          lineHeight: 1.5,
        }}
      >
        {rest.map((note) => {
          const at = note.indexOf(': ')
          const subject = at > 0 && at < 28 ? note.slice(0, at) : ''
          return (
            <Fragment key={note}>
              <Box
                component="span"
                sx={{ fontWeight: 650, whiteSpace: 'nowrap' }}
              >
                {subject}
              </Box>
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {subject ? note.slice(at + 2) : note}
              </Box>
            </Fragment>
          )
        })}
        {!!waits.length && (
          <>
            <Box
              component="span"
              sx={{ fontWeight: 650, whiteSpace: 'nowrap' }}
            >
              {t('teamOpt.writer.waits', 'Waits')}
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {waits.map((note) => (
                <Box
                  key={note}
                  component="span"
                  sx={(theme) => ({
                    px: 0.875,
                    borderRadius: 999,
                    lineHeight: '22px',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'text.secondary',
                    bgcolor: alpha(theme.palette.text.primary, 0.05),
                  })}
                >
                  {note.replace(/^Waited /, '').replace(/\.$/, '')}
                </Box>
              ))}
            </Box>
          </>
        )}
      </Box>
    </Disclosure>
  )
}
const tokensHairline = `1px solid ${tokens.hairline}`

/** (a chip pressed keeps the cursor in the text: it inserts there) */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()

/** One row under the writer: the members (insert their name) and the action words */
export function WriterQuickRow({
  members,
  onInsert,
  draft,
  into,
  trailing,
  bar,
}: {
  members: TeamOptMember[]
  onInsert: (word: string) => void
  draft?: ReactNode
  /** The box the words go into, when there are several (shown with the row) */
  into?: string
  /** At the row's end (the writer: add the first-rotation-only box) */
  trailing?: ReactNode
  /** The writer's code panel: a bar along its bottom */
  bar?: boolean
}) {
  const { t, i18n } = useTranslation(['page_team', 'charNames_gen'])
  const { gender } = useDBMeta()
  const chip = (theme: Theme) => ({
    height: 28,
    px: 1,
    gap: 0.625,
    borderRadius: tokens.radius.control,
    fontSize: 13,
    color: alpha(theme.palette.text.primary, 0.82),
    bgcolor: alpha(theme.palette.text.primary, 0.035),
    boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.1)}`,
    ...quickSx,
    '&:hover, &.Mui-focusVisible': {
      color: 'text.primary',
      bgcolor: alpha(theme.palette.primary.main, 0.1),
      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.55)}`,
    },
    '&:active': { bgcolor: alpha(theme.palette.primary.main, 0.18) },
  })
  const tip = (what: string) =>
    into
      ? t('teamOpt.writer.insertInto', {
          defaultValue: 'Insert {{what}} into {{box}}',
          what,
          box: into,
        })
      : what
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.625,
        ...(bar && {
          px: { xs: 1.25, sm: 1.75 },
          py: 1.125,
          borderTop: `1px solid ${tokens.hairline}`,
          bgcolor: alpha(theme.palette.common.black, 0.14),
        }),
      })}
    >
      {into && (
        <Typography
          component="span"
          sx={{
            fontSize: 12,
            color: 'text.secondary',
            whiteSpace: 'nowrap',
            mr: 0.5,
          }}
        >
          {t('teamOpt.writer.into', 'Into')}{' '}
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
            {into}
          </Box>
        </Typography>
      )}
      {members.map(({ characterKey }) => {
        const name = i18n.t(
          `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
        )
        return (
          <Tooltip
            key={characterKey}
            arrow
            title={
              into
                ? tip(name)
                : t('teamOpt.writer.insertMember', 'Insert {{name}}', { name })
            }
          >
            <ButtonBase
              onClick={() => onInsert(name)}
              onMouseDown={keepFocus}
              sx={(theme) => ({
                ...chip(theme),
                pl: 0.5,
                // (the member's colour, as in the text and the timeline)
                '& .lane': { bgcolor: laneColor(theme, characterKey) },
              })}
            >
              <MemberAvatar characterKey={characterKey} size={20} />
              {name}
              <Box
                className="lane"
                component="span"
                sx={{ width: 5, height: 5, borderRadius: '50%', ml: 0.25 }}
              />
            </ButtonBase>
          </Tooltip>
        )
      })}
      <Box
        sx={(theme) => ({
          width: '1px',
          height: 18,
          mx: 0.5,
          bgcolor: alpha(theme.palette.text.primary, 0.12),
        })}
      />
      {TOKENS.map((tok) => (
        <Tooltip
          key={tok.key}
          arrow
          title={tip(t(`teamOpt.writer.token.${tok.key}`, tok.label))}
        >
          <ButtonBase
            onClick={() => onInsert(tok.text)}
            onMouseDown={keepFocus}
            sx={(theme) => ({
              ...chip(theme),
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              minWidth: 34,
              px: 0.875,
            })}
          >
            {tok.text}
          </ButtonBase>
        </Tooltip>
      ))}
      {(draft || trailing) && (
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
          {draft}
          {trailing}
        </Box>
      )}
    </Box>
  )
}

/** A code box's heading: its name (and ⓘ), with its own controls on the right */
function EditorHead({
  label,
  info,
  aside,
  sx,
}: {
  label?: ReactNode
  info?: string
  aside?: ReactNode
  sx?: object
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        minHeight: 30,
        ...sx,
      }}
    >
      <Typography component="h3" sx={type.title}>
        {label}
      </Typography>
      {info && <InfoTooltipInline title={info} />}
      <Box
        sx={{
          ml: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        {aside}
      </Box>
    </Box>
  )
}

/** How a rotation is written: each word with what it does, and a worked example */
function SyntaxSheet() {
  const { t } = useTranslation('page_team')
  const rows: [string, string][] = [
    [
      'Name E Q',
      t(
        'teamOpt.writer.syntax.step',
        'A step: who acts, then their actions. Names can be short (bina, ei).'
      ),
    ],
    [
      '->',
      t(
        'teamOpt.writer.syntax.next',
        'Next step. Also →, >, a comma or a new line.'
      ),
    ],
    [
      'E / tE · hE',
      t('teamOpt.writer.syntax.skill', 'Elemental Skill, tapped · held'),
    ],
    ['Q', t('teamOpt.writer.syntax.burst', 'Elemental Burst')],
    [
      'N1 – N6',
      t(
        'teamOpt.writer.syntax.normal',
        'A normal attack string of that many hits'
      ),
    ],
    ['CA', t('teamOpt.writer.syntax.charged', 'Charged Attack')],
    [
      'CA[beams=2]',
      t(
        'teamOpt.writer.syntax.beams',
        'Sandrone: release after 2 condensed beams (3 by default, up to 6 from C1)'
      ),
    ],
    [
      'CA[cancel]',
      t(
        'teamOpt.writer.syntax.cancel',
        'Arlecchino: cancel the Charged Attack before it hits. She still absorbs the Blood-Debt Directive (Bond of Life, C2’s Bloodfire), but the attack never lands, so it doesn’t use up the aura for Melt'
      ),
    ],
    [
      'CA[bullets=4]',
      t(
        'teamOpt.writer.syntax.bullets',
        'Chasca: fire after loading 4 bullets (6 by default)'
      ),
    ],
    [
      'HP · LP',
      t(
        'teamOpt.writer.syntax.plunge',
        'A high or low plunge (P alone: the character’s usual one). HP[collision] adds the collision hit on the way down; HP[collision=0.5] counts it on half of them'
      ),
    ],
    [
      'C3F · C2D',
      t(
        'teamOpt.writer.syntax.spins',
        'Mavuika: 3 Flamestrider spins, then the finisher · 2 spins, then a dash (no finisher)'
      ),
    ],
    ['P · D · J', t('teamOpt.writer.syntax.moves', 'Plunge · dash · jump')],
    [
      '4[N5 CD] · 4N5CD',
      t(
        'teamOpt.writer.syntax.repeat',
        'A group that many times (up to 20), as N5 CD four times'
      ),
    ],
    ['W1.5 · W90f', t('teamOpt.writer.syntax.wait', 'Wait 1.5 s · 90 frames')],
    [
      'WK · WK11f',
      t(
        'teamOpt.writer.syntax.walk',
        'Walk 1 frame · 11 frames (an action: Tartaglia’s next Skill is his walking one)'
      ),
    ],
    [
      'E? · Q?',
      t(
        'teamOpt.writer.syntax.ready',
        'Only when ready: left out, not waited for'
      ),
    ],
    [
      'Q?/N3 · E?/N2CA',
      t(
        'teamOpt.writer.syntax.otherwise',
        'Only when ready, otherwise the actions after "/" (no spaces inside)'
      ),
    ],
    [
      'D?/CA',
      t(
        'teamOpt.writer.syntax.dashReady',
        'Wanderer: dash only with Descent, otherwise a Charged Attack'
      ),
    ],
    [
      'entry',
      t(
        'teamOpt.writer.syntax.entry',
        "Swap in only: the member's swap-in effect (a name alone mid-rotation is the same)"
      ),
    ],
    [
      '(note) · A/B',
      t('teamOpt.writer.syntax.notes', 'Ignored · the first one is played'),
    ],
    [
      '-> Name',
      t(
        'teamOpt.writer.syntax.loop',
        'End with the first member: where the rotation loops'
      ),
    ],
  ]
  return (
    <Box
      id="rotation-syntax"
      sx={{
        px: { xs: 1.25, sm: 1.75 },
        py: 1.5,
        borderTop: `1px solid ${tokens.hairline}`,
      }}
    >
      <Box
        component="dl"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: {
            xs: 'max-content minmax(0, 1fr)',
            md: 'max-content minmax(0, 1fr) max-content minmax(0, 1fr)',
          },
          columnGap: 2,
          rowGap: 0.75,
          fontSize: 12.5,
          lineHeight: 1.5,
          '& dt': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            color: 'text.primary',
            whiteSpace: 'nowrap',
          },
          '& dd': { m: 0, color: 'text.secondary' },
        }}
      >
        {rows.map(([code, meaning]) => (
          <Fragment key={code}>
            <dt>{code}</dt>
            <dd>{meaning}</dd>
          </Fragment>
        ))}
      </Box>
      <Typography
        sx={{ mt: 1.25, fontSize: 12, color: 'text.secondary', opacity: 0.8 }}
      >
        {t(
          'teamOpt.writer.syntax.credit',
          'Automatic entry skills are included; actions not modelled are listed in the notes. Frame data: gcsim and kqmsim (AGPLv3).'
        )}
      </Typography>
    </Box>
  )
}
