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
  kqmSandsKeys,
  kqmTalentLevel,
  optimizeTeamKqm,
  TeamOptCancelled,
  teamOptMembers,
  withRotationEnergy,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import { kqmReplayOf } from '../useKqmRun'
import type { SwapFragmentError, SwapFragmentResult } from './swapFragment'
import { swapFragment } from './swapFragment'

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
  /** Holds A's build (a teammate of the swap) */
  fixed: boolean
}
export interface Side {
  /** Damage per rotation */
  dpr: number
  dps: number
  /** Seconds */
  rotationTime: number
  members: SideMember[]
  rotation: string
}
export type CompareSwapError =
  | 'inTeam'
  | SwapFragmentError
  | 'cancelled'
  | 'unsupported'

/** A saved KQM Theorycrafting run, as `useKqmRun` keeps it */
interface SavedRun {
  result: KqmResult
  /** The settings it ran with */
  teamOpt?: TeamOpt
  /** The settings its damage is for (the rotation as played) */
  runTeamOpt?: TeamOpt
}

/** One side of the comparison, from a KQM result */
export function sideOf(
  result: KqmResult,
  rotation: string,
  fixed: CharacterKey[],
  /** Seconds per rotation when the result played none (the attacks were entered) */
  fallbackTime?: number
): Side {
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
        fixed: fixed.includes(key),
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
  delete bonusStats?.[out]
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
  if (!team) throw new Error('The team is not in the database.')
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
}: SwapArgs): CheckedSwap | { error: CompareSwapError } {
  const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
  const key = swapIn.key
  if (keys.includes(key)) return { error: 'inTeam' }
  const nameOf = (ck: CharacterKey) =>
    i18n.t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`)
  const swapped = swapFragment({
    text,
    opener,
    names: keys.map((ck) => ({ characterKey: ck, name: nameOf(ck) })),
    out,
    inName: nameOf(key),
    fragment,
  })
  if (!swapped.ok) return { error: swapped.error }
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
  const run = saved.run as unknown as SavedRun
  if (
    saved.members.length !== keys.length ||
    !keys.every((k) => saved.members.includes(k))
  )
    throw new Error('The saved KQM result is for other team members.')
  const fixed = keys.filter((k) => k !== out)
  const base = run.teamOpt ?? database.teams.get(teamId)?.teamOpt
  if (!base) throw new Error('The team has no KQM settings.')
  const keysB = keys.map((k) => (k === out ? key : k))
  let teamOpt = swappedTeamOpt(
    base,
    keysB,
    out,
    swapIn,
    search.kind === 'pick' ? search : undefined
  )
  const sandbox = sandboxOf(database, teamId, out, swapIn, teamOpt)
  const replayOf = (settings: TeamOpt) =>
    kqmReplayOf(
      sandbox,
      gender,
      i18n,
      teamId,
      settings,
      swapped.text,
      swapped.opener
    )
  // (the ER calculator's inputs for the entering member: as B's rotation plays them)
  if (
    teamOpt.kqm?.energySource === 'calculator' &&
    teamOpt.kqm.energyCalculator
  ) {
    let energy: RotationEnergy | undefined
    try {
      energy = replayOf(teamOpt)?.({
        constellations: Object.fromEntries(
          keysB.map((k) => [k, kqmMemberConstellation(k, teamOpt.kqm)])
        ),
        gear: {},
        overrides: {},
      })?.energy
    } catch {
      energy = undefined
    }
    teamOpt = withEnteringEnergy(teamOpt, key, energy)
    sandbox.teams.set(teamId, { teamOpt })
  }
  return { run, fixed, keysB, teamOpt, sandbox, replay: replayOf(teamOpt) }
}

/**
 * Team B's KQM settings as the comparison runs them (no run): for showing the entering member's
 * inputs. Writes nothing to `database` or the team's storage; throws as `compareSwapKqm` does.
 */
export function swapSettings(
  args: SwapArgs
): { teamOpt: TeamOpt; keys: CharacterKey[] } | { error: CompareSwapError } {
  const checked = checkSwap(args)
  if ('error' in checked) return { error: checked.error }
  const { teamOpt, keysB } = teamB(args, checked)
  return { teamOpt, keys: keysB }
}

/**
 * KQM Theorycrafting's saved run (A) against the same team with `out` replaced by `swapIn` (B):
 * the leaving member's single step of the rotation becomes the entering member's `fragment`, and
 * one KQM run on a copy of the database searches the entering member only, its teammates holding
 * A's builds. Writes nothing to `database` or the team's storage.
 */
export async function compareSwapKqm({
  onStep,
  isCancelled = () => false,
  ...args
}: SwapArgs & {
  onStep?: (s: KqmStep) => void
  isCancelled?: () => boolean
}): Promise<{ a: Side; b: Side } | { error: CompareSwapError }> {
  const { gender, teamId, text, swapIn } = args
  const key = swapIn.key
  const checked = checkSwap(args)
  if ('error' in checked) return { error: checked.error }
  const { swapped, search } = checked
  if (isCancelled()) return { error: 'cancelled' }

  const { run, fixed, keysB, teamOpt, sandbox, replay } = teamB(args, checked)
  const a = sideOf(
    run.result,
    text,
    fixed,
    run.runTeamOpt?.rotationTime ?? run.teamOpt?.rotationTime
  )
  if (!replay) throw new Error('Team B’s rotation could not be played.')
  const teammates = Object.fromEntries(
    fixed.map((k) => [k, run.result.builds[k]])
  ) as Partial<Record<CharacterKey, KqmBuild>>
  const common = { database: sandbox, teamId, gender, teamOpt, replay, onStep }

  let result: KqmResult | undefined
  try {
    if (search.kind === 'pick') {
      // the comparison of one member's weapon and sets, from A's builds with the entering
      // member's pick (its main stats and rolls searched); its teammates' searched again only
      // when its weapon is not the one it holds: it is, so they keep theirs
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
      // (its build is what B needs: the rankings that follow are not waited for)
      let preview: KqmResult | undefined
      try {
        result = await compareTeamKqm({
          ...common,
          isCancelled: () => !!preview || isCancelled(),
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
          onPreview: (p) => {
            preview = p
          },
        })
      } catch (e) {
        if (!(e instanceof TeamOptCancelled) || !preview) throw e
        result = preview
      }
    }
    // KQM Theorycrafting's one-member search from A's builds: only the entering member's,
    // its weapon and sets free
    else
      result = await optimizeTeamKqm({
        ...common,
        isCancelled,
        from: teammates,
        only: key,
      })
  } catch (e) {
    if (e instanceof TeamOptCancelled) return { error: 'cancelled' }
    throw e
  }
  if (isCancelled()) return { error: 'cancelled' }
  if (!result) throw new Error('KQM could not evaluate team B.')
  // (A's builds held: a fixed member's build differing between A and B is a failure)
  for (const k of fixed)
    if (!sameBuild(result.builds[k], run.result.builds[k]))
      throw new Error(`${k}’s build changed in team B.`)
  return {
    a,
    b: sideOf(result, swapped.text, fixed, teamOpt.rotationTime),
  }
}
