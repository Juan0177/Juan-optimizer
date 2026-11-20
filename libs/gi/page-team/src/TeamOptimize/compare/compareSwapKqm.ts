import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type {
  LoadoutDatum,
  TeamKqmSavedRun,
  TeamOpt,
  TeamOptEnergyCalculator,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type {
  KqmBuild,
  KqmResult,
  KqmSets,
  KqmStep,
  KqmWeapon,
  RotationEnergy,
} from '@genshin-optimizer/gi/ui'
import {
  compareTeamKqm,
  defaultEnergyCalculator,
  KQM_WEAPON_LIST,
  kqmCircletKeys,
  kqmExcludedWeapons,
  kqmGobletKeys,
  kqmMemberConstellation,
  kqmRuleConditionals,
  kqmSandsKeys,
  kqmTalentLevel,
  optimizeTeamKqm,
  playedAttackStates,
  TeamOptCancelled,
  teamOptMembers,
  withRotationEnergy,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import type { RotationTimingSettings } from '../RotationTiming'
import { readKqmRotation } from '../RotationWriter'
import type { KqmRotation } from '../useKqmRun'
import { kqmReplayOf } from '../useKqmRun'
import { CompareSwapFailure } from './compareError'
import { savedRunOf } from './savedRun'
import type { SwapFragmentError, SwapFragmentResult } from './swapFragment'
import { swapFragment, timingForSwap } from './swapFragment'

/*
 * KQM Compare's computation: team A is KQM Theorycrafting's saved run (read only); team B is the
 * same team with one member swapped, computed on a throwaway copy of the database (every damage
 * path is keyed by a team in the database), where only the entering member is searched and its
 * teammates keep A's builds. Nothing is written to the user's database or the team's storage.
 */

/** The member entering team B, and how its KQM build is found */
export interface SwapIn {
  key: CharacterKey
  constellation: number
  /** Its weapon, or `'auto'`: the KQM search chooses (only with `sets` `'auto'` too) */
  weapon: KqmWeapon | 'auto'
  /** Its artifact sets, or `'auto'`: the KQM search chooses (only with `weapon` `'auto'` too) */
  sets: KqmSets | 'auto'
  /** A KQM build (`'kqm'`); an existing build is not supported yet */
  build: 'kqm' | { kind: 'existing'; buildId: string }
  /**
   * The entering member's own KQM settings: only its per-member entries are read (its ER target,
   * passives, weapon energy, ER calculator inputs); its field time is the leaving member's. In
   * the ER calculator, team B's rotation fills in its inputs, except the ones marked `edited`.
   */
  kqm?: Partial<TeamOptKqm>
}
export interface SideMember {
  key: CharacterKey
  damage: number
  /** Of the team's damage (0 to 1) */
  share: number
  /** Total ER target (%) */
  er: number
  /** Total ER its build reaches (%) */
  erValue: number
  build?: KqmBuild
  /** Its constellation in the result */
  constellation: number
  /** Holds A's build (a teammate of the swap) */
  fixed: boolean
  /** Its share of the rotation's field time (%), as the ER calculator has it */
  fieldTime?: number
}
export interface Side {
  /** Damage per rotation */
  dpr: number
  dps: number
  /** Seconds */
  rotationTime: number
  members: SideMember[]
  rotation: string
  /**
   * The swapped member's turn of `rotation` (its index among the turns the parser cuts it into),
   * marked on the card; absent: none (its step was in the opener)
   */
  turn?: number
  /** The KQM talent level its settings use */
  talents?: number
}
export type CompareSwapError =
  | 'inTeam'
  | SwapFragmentError
  | 'cancelled'
  | 'unsupported'

/** A refused swap: why, and for a member found more than once, how many times */
export type CompareSwapRefusal = { error: CompareSwapError; count?: number }

/** One side of the comparison, from a KQM result */
export function sideOf(
  result: KqmResult,
  rotation: string,
  fixed: CharacterKey[],
  /** Seconds per rotation when the result played none (the attacks were entered) */
  fallbackTime?: number,
  /** The settings it was set up with: its members' field time, its talents */
  settings?: TeamOpt
): Side {
  const calc = settings?.kqm?.energyCalculator
  const dpr = result.after.total
  const rotationTime = result.played?.rotationTime ?? fallbackTime ?? 0
  const keys = result.optimized?.length
    ? result.optimized
    : (Object.keys(result.after.members) as CharacterKey[])
  return {
    dpr,
    dps: rotationTime > 0 ? dpr / rotationTime : 0,
    rotationTime,
    rotation,
    ...(settings && { talents: kqmTalentLevel(settings.kqm) }),
    members: keys.map((key) => {
      const damage = result.after.members[key] ?? 0
      const energy = result.energyRecharge[key]
      return {
        key,
        damage,
        share: dpr ? damage / dpr : 0,
        er: energy?.target ?? 0,
        erValue: energy?.value ?? 0,
        build: result.builds[key],
        constellation: result.constellations[key] ?? 0,
        fixed: fixed.includes(key),
        fieldTime: calc?.members[key]?.fieldTime,
      }
    }),
  }
}

/** How the entering member's build is found: none of these is supported yet: undefined */
function searchOf(swapIn: SwapIn) {
  if (swapIn.build !== 'kqm') return undefined
  const { weapon, sets } = swapIn
  if (weapon !== 'auto' && sets !== 'auto')
    return { kind: 'pick' as const, weapon, sets }
  if (weapon === 'auto' && sets === 'auto') return { kind: 'auto' as const }
  // (one fixed and one searched: the one-member search keeps both or neither)
  return undefined
}

/** A per-member record with `out`'s entry gone and `key`'s set to `value` */
function swapEntry<T>(
  record: Partial<Record<CharacterKey, T>> | undefined,
  out: CharacterKey,
  key: CharacterKey,
  value: T | undefined
): Partial<Record<CharacterKey, T>> | undefined {
  if (!record && value === undefined) return undefined
  const next = { ...record }
  delete next[out]
  delete next[key]
  if (value !== undefined) next[key] = value
  return next
}

/**
 * Team B's settings: A's, with the leaving member's per-member entries gone and the entering
 * member's own (its constellation, its KQM settings; its field time the leaving member's). A
 * picked weapon and sets are allowed for it (they may be left out of A's choice).
 */
function swappedTeamOpt(
  base: TeamOpt,
  keys: CharacterKey[],
  out: CharacterKey,
  swapIn: SwapIn,
  pick: { weapon: KqmWeapon; sets: KqmSets } | undefined
): TeamOpt {
  const key = swapIn.key
  const own = swapIn.kqm ?? {}
  const kqm: TeamOptKqm = structuredClone(base.kqm ?? defaultTeamOptKqm)
  kqm.energyRecharge = swapEntry(
    kqm.energyRecharge,
    out,
    key,
    own.energyRecharge?.[key]
  )
  kqm.constellations = swapEntry(
    kqm.constellations,
    out,
    key,
    swapIn.constellation
  )
  kqm.passives = swapEntry(kqm.passives, out, key, own.passives?.[key])
  if (kqm.weaponEnergy || own.weaponEnergy)
    kqm.weaponEnergy = Object.fromEntries(
      [
        ...new Set([
          ...Object.keys(kqm.weaponEnergy ?? {}),
          ...Object.keys(own.weaponEnergy ?? {}),
        ]),
      ].map((w) => [
        w,
        swapEntry(
          kqm.weaponEnergy?.[w as keyof typeof kqm.weaponEnergy],
          out,
          key,
          own.weaponEnergy?.[w as keyof typeof own.weaponEnergy]?.[key]
        ),
      ])
    )
  const onField = base.onField === out ? key : base.onField
  if (kqm.energyCalculator) {
    const calc = kqm.energyCalculator
    const fallback = defaultEnergyCalculator(
      keys,
      calc.rotationTime,
      onField ?? keys[0],
      Object.fromEntries(
        keys.map((k) => [k, kqm.constellations?.[k]])
      ) as Partial<Record<CharacterKey, number>>
    ).members[key]!
    const leaving = calc.members[out]
    const members: TeamOptEnergyCalculator['members'] = {}
    for (const k of keys) {
      if (k === key) {
        members[k] = {
          ...fallback,
          ...own.energyCalculator?.members[key],
          // (the slot's share of the field time)
          ...(leaving && { fieldTime: leaving.fieldTime }),
        }
        continue
      }
      const m = calc.members[k]
      if (!m) continue
      // (particles caught by the leaving member go to the one taking its place)
      members[k] = {
        ...m,
        ...(m.catchBy === out && { catchBy: key }),
        ...(m.favoniusCatchBy === out && { favoniusCatchBy: key }),
      }
    }
    kqm.energyCalculator = { ...calc, members }
  }
  if (pick) {
    kqm.excludedWeapons = [...kqmExcludedWeapons(kqm)].filter(
      (w) => w !== pick.weapon.key
    )
    kqm.weaponList = KQM_WEAPON_LIST
    kqm.refinements = {
      ...kqm.refinements,
      [pick.weapon.key]: pick.weapon.refinement,
    }
    if (kqm.excludedSets)
      kqm.excludedSets = kqm.excludedSets.filter((s) => !(s in pick.sets))
  }
  const attacks = { ...base.attacks }
  delete attacks[out]
  const bonusStats = base.bonusStats && { ...base.bonusStats }
  if (swapIn.key !== out) delete bonusStats?.[out]
  return {
    ...base,
    attacks,
    keep: base.keep.filter((k) => k !== out),
    ...(onField !== undefined && { onField }),
    ...(bonusStats && { bonusStats }),
    kqm,
  }
}

/**
 * Team B's settings with the entering member's ER calculator inputs filled in from team B's
 * rotation as KQM plays it (as KQM Theorycrafting fills a member's, `withRotationEnergy`): the
 * inputs its own settings mark `edited` stay, its field time stays the leaving member's, and its
 * teammates' inputs are left as they are.
 */
function withEnteringEnergy(
  teamOpt: TeamOpt,
  key: CharacterKey,
  energy: RotationEnergy | undefined
): TeamOpt {
  const calc = teamOpt.kqm?.energyCalculator
  const member = calc?.members[key]
  if (!teamOpt.kqm || !calc || !member || !energy?.members[key]) return teamOpt
  const filled = withRotationEnergy(
    { ...calc, members: { [key]: member } },
    [key],
    energy
  ).members[key]!
  return {
    ...teamOpt,
    kqm: {
      ...teamOpt.kqm,
      energyCalculator: {
        ...calc,
        members: {
          ...calc.members,
          [key]: { ...filled, fieldTime: member.fieldTime },
        },
      },
    },
  }
}

/**
 * A throwaway copy of the database with team B: the entering member added if missing (level 90,
 * the KQM talents), a new team character in the leaving member's slot, team B's settings
 */
function sandboxOf(
  database: ArtCharDatabase,
  teamId: string,
  out: CharacterKey,
  swapIn: SwapIn,
  teamOpt: TeamOpt
) {
  const sandbox = new ArtCharDatabase(
    database.dbIndex,
    new SandboxStorage(Object.fromEntries(database.storage.entries))
  )
  const key = swapIn.key
  const talent = kqmTalentLevel(teamOpt.kqm)
  if (!sandbox.chars.get(key))
    sandbox.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      constellation: swapIn.constellation,
      talent: { auto: talent, skill: talent, burst: talent },
    })
  const team = sandbox.teams.get(teamId)
  if (!team)
    throw new CompareSwapFailure('noTeam', 'The team is not in the database.')
  const teamCharId = sandbox.teamChars.new(key, {})
  sandbox.teams.set(teamId, {
    loadoutData: team.loadoutData.map((d) =>
      d && sandbox.teamChars.get(d.teamCharId)?.key === out
        ? ({ teamCharId } as LoadoutDatum)
        : d
    ),
    teamOpt,
  })
  return sandbox
}

const sameBuild = (a: KqmBuild | undefined, b: KqmBuild | undefined) =>
  JSON.stringify(a) === JSON.stringify(b)

/** What both the comparison and its settings preview are given */
interface SwapArgs {
  database: ArtCharDatabase
  teamId: string
  gender: GenderKey
  i18n: i18n
  /** KQM Theorycrafting's saved run (`database.teamKqmResults.getRun`) */
  saved: TeamKqmSavedRun
  out: CharacterKey
  swapIn: SwapIn
  /** KQM Theorycrafting's rotation and opener, as written */
  text: string
  opener: string
  /** The entering member's actions, in place of the leaving member's step */
  fragment: string
  /**
   * Its actions in the opener, in place of the leaving member's step there, when the leaving
   * member acts in the rotation and in the opener
   */
  openerFragment?: string
  /** KQM Theorycrafting's rotation timing (frame edits, swap time); absent: the team's saved one */
  timing?: RotationTimingSettings
}

/** A swap that passed its checks: the team's keys, B's rotation, how the entering member is found */
interface CheckedSwap {
  keys: CharacterKey[]
  swapped: Extract<SwapFragmentResult, { ok: true }>
  search: NonNullable<ReturnType<typeof searchOf>>
}

/** The swap's checks (nothing built yet): the error, else the team's keys and B's rotation */
function checkSwap({
  database,
  teamId,
  gender,
  i18n,
  out,
  swapIn,
  text,
  opener,
  fragment,
  openerFragment,
}: SwapArgs): CheckedSwap | CompareSwapRefusal {
  const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
  const key = swapIn.key
  if (key !== out && keys.includes(key)) return { error: 'inTeam' }
  const nameOf = (ck: CharacterKey) =>
    i18n.t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`)
  const swapped = swapFragment({
    text,
    opener,
    names: keys.map((ck) => ({ characterKey: ck, name: nameOf(ck) })),
    out,
    inName: nameOf(key),
    fragment,
    openerFragment,
  })
  if (!swapped.ok)
    return swapped.error === 'repeated'
      ? { error: swapped.error, count: swapped.count }
      : { error: swapped.error }
  const search = searchOf(swapIn)
  if (!search) return { error: 'unsupported' }
  return { keys, swapped, search }
}

/**
 * Team B on a copy of the database: its settings (the entering member's ER calculator inputs
 * filled in from B's rotation) and its rotation, ready to play. Throws when the saved run does
 * not fit the team.
 */
function teamB(args: SwapArgs, { keys, swapped, search }: CheckedSwap) {
  const { database, teamId, gender, i18n, saved, out, swapIn } = args
  const key = swapIn.key
  const run = savedRunOf(saved)
  if (
    saved.members.length !== keys.length ||
    !keys.every((k) => saved.members.includes(k))
  )
    throw new CompareSwapFailure(
      'otherMembers',
      'The saved KQM result is for other team members.'
    )
  const fixed = keys.filter((k) => k !== out)
  const base = run.teamOpt ?? database.teams.get(teamId)?.teamOpt
  if (!base)
    throw new CompareSwapFailure('noSettings', 'The team has no KQM settings.')
  const keysB = keys.map((k) => (k === out ? key : k))
  let teamOpt = swappedTeamOpt(
    base,
    keysB,
    out,
    swapIn,
    search.kind === 'pick' ? search : undefined
  )
  const sandbox = sandboxOf(database, teamId, out, swapIn, teamOpt)
  // (the team's frame edits, each on its own action of B's rotation)
  const timing = timingForSwap(
    args.timing ?? readKqmRotation(database, teamId).timing,
    swapped
  )
  const replayOf = (settings: TeamOpt) =>
    kqmReplayOf(
      sandbox,
      gender,
      i18n,
      teamId,
      settings,
      swapped.text,
      swapped.opener,
      timing
    )
  // (the ER calculator's inputs for the entering member: as B's rotation plays them)
  if (
    teamOpt.kqm?.energySource === 'calculator' &&
    teamOpt.kqm.energyCalculator
  ) {
    let energy: RotationEnergy | undefined
    let seconds: number | undefined
    try {
      const played = replayOf(teamOpt)?.({
        constellations: Object.fromEntries(
          keysB.map((k) => [k, kqmMemberConstellation(k, teamOpt.kqm)])
        ),
        gear: {},
        overrides: {},
      })
      energy = played?.energy
      seconds = played?.rotationTime
    } catch {
      energy = undefined
    }
    teamOpt = withEnteringEnergy(teamOpt, key, energy)
    // (its counts are per B's rotation as KQM plays it, as KQM Theorycrafting keeps them)
    if (seconds && teamOpt.kqm?.energyCalculator)
      teamOpt = {
        ...teamOpt,
        kqm: {
          ...teamOpt.kqm,
          energyCalculator: {
            ...teamOpt.kqm.energyCalculator,
            rotationTime: seconds,
          },
        },
      }
    sandbox.teams.set(teamId, { teamOpt })
  }
  return {
    run,
    fixed,
    keysB,
    teamOpt,
    sandbox,
    replay: replayOf(teamOpt),
    rotation: { text: swapped.text, opener: swapped.opener, timing },
  }
}

/**
 * Team B's KQM settings as the comparison runs them (no run): for showing the entering member's
 * inputs. Writes nothing to `database` or the team's storage; throws as `compareSwapKqm` does.
 */
export function swapSettings(args: SwapArgs):
  | {
      teamOpt: TeamOpt
      keys: CharacterKey[]
      /**
       * The entering member's weapon and set effects counted by rule where its settings do not
       * set them (`kqmRuleConditionals`, in team B)
       */
      rules: Record<string, unknown>
    }
  | CompareSwapRefusal {
  const checked = checkSwap(args)
  if ('error' in checked) return checked
  const { teamOpt, keysB, sandbox } = teamB(args, checked)
  const rules =
    kqmRuleConditionals(sandbox, args.teamId, teamOpt)[args.swapIn.key]
      ?.conditional ?? {}
  return { teamOpt, keys: keysB, rules: rules as Record<string, unknown> }
}

/**
 * B's headline: both sides, and B's KQM result (its rankings not yet: `rankings` has none), with
 * B's sandbox for its results screen while the rankings are worked out
 */
export interface CompareSwapPreview {
  a: Side
  b: Side
  /** As KQM Theorycrafting's, for team B: only the entering member optimized (and ranked) */
  resultB: KqmResult
  /** The throwaway copy of the database team B was computed on (never the user's) */
  sandbox: ArtCharDatabase
  /** Team B's KQM settings, as set on `sandbox` */
  teamOptB: TeamOpt
  /**
   * Team B's rotation as it was played (its text and opener with the entering member's actions,
   * the team's frame edits moved onto them): its inspector plays this, not the team's written one
   */
  rotationB: KqmRotation
}
/** The comparison done: with the entering member's rankings */
export type CompareSwapOutcome = CompareSwapPreview

/**
 * KQM Theorycrafting's saved run (A) against the same team with `out` replaced by `swapIn` (B):
 * the leaving member's single step of the rotation becomes the entering member's `fragment`, and
 * one KQM run on a copy of the database searches the entering member only, its teammates holding
 * A's builds, then ranks its weapons and artifact sets (as KQM Theorycrafting's rankings, the
 * teammates fixed). B's headline is given first (`onPreview`); cancelled after it, the comparison
 * ends with it (no rankings). Writes nothing to `database` or the team's storage.
 */
export async function compareSwapKqm({
  onStep,
  isCancelled = () => false,
  onPreview,
  ...args
}: SwapArgs & {
  onStep?: (s: KqmStep) => void
  isCancelled?: () => boolean
  /** B's headline, as soon as the entering member's build is found (before its rankings) */
  onPreview?: (preview: CompareSwapPreview) => void
}): Promise<CompareSwapOutcome | CompareSwapRefusal> {
  const { gender, teamId, text, swapIn } = args
  const key = swapIn.key
  const checked = checkSwap(args)
  if ('error' in checked) return checked
  const { swapped, search } = checked
  if (isCancelled()) return { error: 'cancelled' }

  const { run, fixed, keysB, teamOpt, sandbox, replay, rotation } = teamB(
    args,
    checked
  )
  const a: Side = {
    ...sideOf(
      run.result,
      text,
      fixed,
      run.runTeamOpt?.rotationTime ?? run.teamOpt?.rotationTime,
      run.teamOpt ?? run.runTeamOpt
    ),
    turn: swapped.turn,
  }
  if (!replay)
    throw new CompareSwapFailure(
      'notPlayable',
      'Team B’s rotation could not be played.'
    )
  const teammates = Object.fromEntries(
    fixed.map((k) => [k, run.result.builds[k]])
  ) as Partial<Record<CharacterKey, KqmBuild>>
  // (A's builds held: a fixed member's build differing between A and B is a failure)
  const changedBuild = (result: KqmResult) =>
    fixed.find((k) => !sameBuild(result.builds[k], run.result.builds[k]))
  /** B's side and result as KQM Theorycrafting shows a result: the entering member optimized */
  const viewOf = (result: KqmResult): CompareSwapPreview => ({
    a,
    b: {
      ...sideOf(result, swapped.text, fixed, teamOpt.rotationTime, teamOpt),
      turn: swapped.insertedTurn,
    },
    resultB: { ...result, optimized: [key] },
    sandbox,
    teamOptB: teamOpt,
    rotationB: rotation,
  })
  // the headline, once (its builds are B's: the rankings that follow do not change them)
  let preview: KqmResult | undefined
  const previewed = (p: KqmResult) => {
    preview = p
    // (a fixed member's build changed: the comparison fails at the end, no headline)
    if (onPreview && !changedBuild(p)) onPreview(viewOf(p))
  }
  // A's run states (Wolf's Gravestone's uptime against the team's enemy, as KQM Theorycrafting
  // ran it), the entering member's in the leaving member's place: B plays the fight A did
  const attackStates = playedAttackStates(run.result.played)?.map((s) =>
    s.owner === args.out ? { ...s, owner: key } : s
  )
  const common = {
    database: sandbox,
    teamId,
    gender,
    teamOpt,
    replay,
    attackStates,
    onStep,
    isCancelled,
  }

  let result: KqmResult | undefined
  try {
    if (search.kind === 'pick') {
      // the comparison of one member's weapon and sets, from A's builds with the entering
      // member's pick (its main stats and rolls searched), then its rankings; its teammates'
      // searched again only when its weapon is not the one it holds: it is, so they keep theirs
      const start: KqmBuild = {
        weapon: search.weapon,
        sets: search.sets,
        mains: {
          sands: kqmSandsKeys[0],
          goblet: kqmGobletKeys(getCharEle(key))[0],
          circlet: kqmCircletKeys[0],
        },
        rolls: {},
      }
      result = await compareTeamKqm({
        ...common,
        result: {
          ...run.result,
          builds: { ...teammates, [key]: start },
          constellations: {},
          energyRecharge: {},
          rankings: {},
          assumed: {},
          optimized: keysB,
          played: undefined,
        },
        characterKey: key,
        weapon: search.weapon,
        sets: search.sets,
        onPreview: previewed,
      })
    }
    // KQM Theorycrafting's one-member search from A's builds: only the entering member's,
    // its weapon and sets free, then its rankings
    else
      result = await optimizeTeamKqm({
        ...common,
        from: teammates,
        only: key,
        rankOnly: true,
        onPreview: previewed,
      })
  } catch (e) {
    if (!(e instanceof TeamOptCancelled)) throw e
    // (cancelled after the headline: the comparison ends with it, no rankings)
    if (!preview) return { error: 'cancelled' }
    result = preview
  }
  if (isCancelled() && !preview) return { error: 'cancelled' }
  if (!result)
    throw new CompareSwapFailure('noResult', 'KQM could not evaluate team B.')
  const changed = changedBuild(result)
  if (changed)
    throw new CompareSwapFailure(
      'buildChanged',
      `${changed}’s build changed in team B.`,
      changed
    )
  return viewOf(result)
}
