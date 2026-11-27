import { notEmpty } from '@genshin-optimizer/common/util'
import type {
  CharacterKey,
  GenderKey,
  RefinementKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { signatureWeapons } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  ICachedArtifact,
  ICachedWeapon,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import {
  type CharacterOverride,
  teamOptBonusStats,
  teamOptMembers,
} from './data'
import { isCalcEnergyWeapon, isFavonius } from './energyCalc'
import {
  type KqmBuild,
  type KqmPlayed,
  kqmMemberConstellation,
  optimizeTeamKqm,
} from './kqm'
import { type RunAttackState, withAttackStates } from './lowHpUptime'
import {
  type FrameData,
  isSacrificialWeapon,
  needsRotationCalculation,
  type RotationMember,
  type RotationTimingSettings,
  type SimGear,
} from './rotation'
import { WEAPON_MODULES } from './rotation/weapons'
import { rotationCalculation } from './rotationCalculation'
import { writtenTeamReplay } from './rotationSearchTeam'
import { teamRuleConditionals } from './ruleConditionals'
import { evaluateTeamRotation, type TeamOptResult } from './solve'
import { simTeamOf, writtenKqmReplay } from './writtenRotation'

const SIM_WEAPONS = new Set<string>(WEAPON_MODULES.map((m) => m.weapon))
/** Only kits whose rotation simulation actually branches on C3 or C5 */
const C3_SIM_KITS = new Set<CharacterKey>(['RaidenShogun'])
const C5_SIM_KITS = new Set<CharacterKey>(['Chongyun', 'Diona'])

/** Canonical constellation for simulation equivalence (C3->C2 and C5->C4 when kit does not branch on them) */
function simEquivCons(ck: CharacterKey, cons: number) {
  if (cons === 3 && !C3_SIM_KITS.has(ck)) return 2
  if (cons === 5 && !C5_SIM_KITS.has(ck)) return 4
  return cons
}

const REPLAY_CACHE_MAX = 48
const kqmReplayCache = new Map<string, KqmPlayed>()

/** True if switching between `oldKey` and `newKey` could alter rotation simulation or team ER. */
function weaponAffectsSimulation(
  oldKey: WeaponKey | undefined,
  newKey: WeaponKey | undefined
) {
  if (oldKey === newKey) return false
  for (const key of [oldKey, newKey]) {
    if (!key) continue
    if (
      SIM_WEAPONS.has(key) ||
      key === 'PrototypeAmber' ||
      key === 'FinaleOfTheDeep' ||
      isSacrificialWeapon(key) ||
      isFavonius(key) ||
      isCalcEnergyWeapon(key)
    )
      return true
  }
  return false
}

export interface InvestRotationMeta {
  names: RotationMember[]
  text: string
  opener: string
  timing: RotationTimingSettings
  frameData: FrameData
}

export interface KqmInvestJob {
  mode: 'kqm'
  teamId: string
  gender: GenderKey
  setup: TeamOpt
  from: Partial<Record<CharacterKey, KqmBuild>>
  played?: KqmPlayed
  attackStates?: readonly RunAttackState[]
  cons: Partial<Record<CharacterKey, number>>
  signatures?: Partial<Record<CharacterKey, number>>
  rotation?: InvestRotationMeta
  text?: string
  /** Skip full `finish()` graph rebuild when caller only needs team DPS, builds, and unmet flag */
  summaryOnly?: boolean
}

export interface InventoryInvestJob {
  mode: 'inventory'
  teamId: string
  gender: GenderKey
  teamOpt: TeamOpt
  result: Pick<
    TeamOptResult,
    'builds' | 'weapons' | 'attackStates' | 'rotationTime'
  >
  cons: Partial<Record<CharacterKey, number>>
  signatures?: Partial<Record<CharacterKey, number>>
  rotation?: InvestRotationMeta
  text?: string
}

export type InvestJob = KqmInvestJob | InventoryInvestJob

export interface InvestResult {
  team: number
  members: Partial<Record<CharacterKey, number>>
  seconds?: number
  builds: Partial<Record<CharacterKey, KqmBuild>>
  unmet?: boolean
}

/**
 * Runs one KQM or Inventory investment evaluation end-to-end inside a worker (or inline in tests).
 * All rotation simulation, formula compilation, and artifact refitting happen inside this call
 * with zero worker-to-main serialization overhead.
 */
export async function runInvestmentJob(
  database: ArtCharDatabase,
  job: InvestJob,
  isCancelled: () => boolean = () => false
): Promise<InvestResult | undefined> {
  if (isCancelled()) return undefined
  return job.mode === 'kqm'
    ? runKqmInvestJob(database, job, isCancelled)
    : runInventoryInvestJob(database, job)
}

async function runKqmInvestJob(
  database: ArtCharDatabase,
  job: KqmInvestJob,
  isCancelled: () => boolean
): Promise<InvestResult | undefined> {
  const {
    teamId,
    gender,
    setup,
    from,
    played,
    attackStates,
    cons,
    signatures,
    rotation,
    text,
    summaryOnly = true,
  } = job
  const kqm = setup.kqm ?? defaultTeamOptKqm
  const nextSignature = signatures
    ? { ...kqm.signature, ...signatures }
    : kqm.signature
  const teamOpt: TeamOpt = {
    ...setup,
    kqm: {
      ...kqm,
      constellations: { ...kqm.constellations, ...cons },
      ...(nextSignature ? { signature: nextSignature } : {}),
    },
  }
  const raisedSet = new Set<CharacterKey>([
    ...(Object.keys(cons) as CharacterKey[]),
    ...(Object.keys(signatures ?? {}) as CharacterKey[]),
  ])
  const fromBuilds: Partial<Record<CharacterKey, KqmBuild>> = { ...from }
  let weaponSimChanged = false
  for (const [ck, ref] of Object.entries(signatures ?? {}) as [
    CharacterKey,
    number,
  ][]) {
    const sigKey = signatureWeapons[ck]
    const prev = fromBuilds[ck]
    if (sigKey && ref && prev) {
      if (weaponAffectsSimulation(prev.weapon.key, sigKey))
        weaponSimChanged = true
      fromBuilds[ck] = { ...prev, weapon: { key: sigKey, refinement: ref } }
    }
  }

  // Exact replay skip: no alt rotation, no weapon sim effect changed, and every member's
  // simulation-relevant constellation (C3->C2, C5->C4 for pure talent-level cons) is unchanged.
  const members = teamOptMembers(database, teamId)
  const memberKeys = members.map((m) => m.characterKey)
  const hasCalcSim = needsRotationCalculation(memberKeys)
  if (hasCalcSim && signatures && Object.keys(signatures).length > 0)
    weaponSimChanged = true
  const consSimChanged = (
    Object.entries(cons) as [CharacterKey, number][]
  ).some(([ck, nextC]) => {
    const prevC = kqmMemberConstellation(ck, kqm)
    return simEquivCons(ck, nextC) !== simEquivCons(ck, prevC)
  })
  const canReusePlayed =
    !!played && !text?.trim() && !consSimChanged && !weaponSimChanged

  const activeText = text?.trim() || rotation?.text?.trim() || ''
  const replayKey =
    activeText && rotation
      ? JSON.stringify([
          teamId,
          activeText,
          rotation.opener,
          rotation.timing,
          members.map(({ characterKey: ck }) => {
            const c = kqmMemberConstellation(ck, teamOpt.kqm)
            const w = fromBuilds[ck]?.weapon
            const simW =
              w && (hasCalcSim || weaponAffectsSimulation(undefined, w.key))
                ? `${w.key}@${w.refinement}`
                : ''
            return [ck, simEquivCons(ck, c), simW]
          }),
        ])
      : undefined

  const cachedPlayed = canReusePlayed
    ? played
    : replayKey
      ? kqmReplayCache.get(replayKey)
      : undefined

  const baseReplay =
    !cachedPlayed && activeText && rotation
      ? writtenKqmReplay({
          database,
          teamId,
          members,
          gender,
          names: rotation.names,
          teamOpt,
          text: activeText,
          opener: rotation.opener,
          timing: rotation.timing,
          frameData: rotation.frameData,
        })
      : undefined

  const replay =
    baseReplay && replayKey
      ? (input: Parameters<typeof baseReplay>[0]) => {
          const out = baseReplay(input)
          if (out) {
            kqmReplayCache.set(replayKey, out)
            if (kqmReplayCache.size > REPLAY_CACHE_MAX)
              kqmReplayCache.delete(kqmReplayCache.keys().next().value!)
          }
          return out
        }
      : baseReplay

  const hasSig = !!signatures && Object.keys(signatures).length > 0
  const found = await optimizeTeamKqm({
    database,
    teamId,
    gender,
    teamOpt,
    replay,
    initialPlayed: cachedPlayed,
    attackStates,
    from: fromBuilds,
    only: [...raisedSet],
    maxRounds: 1,
    inline: true,
    summaryOnly,
    mainsSearched: hasSig ? 4 : 3,
    isCancelled,
  })
  if (!found || isCancelled()) return undefined
  const unmet =
    Object.values(found.energyRecharge).some(
      (er) => !!er && er.value + 1e-6 < er.minimum
    ) || Object.values(found.after.unmet).some((u) => !!u?.length)
  return {
    team: found.after.total,
    members: found.after.members,
    seconds:
      found.played?.rotationTime ?? teamOpt.rotationTime ?? setup.rotationTime,
    builds: found.builds,
    unmet,
  }
}

function runInventoryInvestJob(
  database: ArtCharDatabase,
  job: InventoryInvestJob
): InvestResult | undefined {
  const { teamId, gender, teamOpt, result, cons, signatures, rotation, text } =
    job
  const members = teamOptMembers(database, teamId)
  const memberKeys = members.map((m) => m.characterKey)
  const mainStatAssumptionLevel = teamOpt.assumeMaxMain ? 20 : 0
  const arts = Object.fromEntries(
    members
      .filter((m) => !m.isTc)
      .map((m) => [
        m.characterKey,
        Object.values(result.builds[m.characterKey] ?? {})
          .map((id) => (id ? database.arts.get(id) : undefined))
          .filter(notEmpty),
      ])
  ) as Partial<Record<CharacterKey, ICachedArtifact[]>>

  const weapons: Partial<Record<CharacterKey, ICachedWeapon>> = {}
  let weaponSimChanged = false
  for (const m of members) {
    const ck = m.characterKey
    const dbWeapon = m.isTc
      ? undefined
      : database.weapons.get(result.weapons?.[ck] ?? m.weaponId)
    const baseWeaponKey = (
      m.isTc
        ? database.buildTcs.get(m.loadoutDatum.buildTcId)?.weapon?.key
        : dbWeapon?.key
    ) as WeaponKey | undefined
    const sigRef = signatures?.[ck]
    const sigKey = sigRef ? signatureWeapons[ck] : undefined
    if (sigKey && sigRef) {
      if (weaponAffectsSimulation(baseWeaponKey, sigKey))
        weaponSimChanged = true
      weapons[ck] = {
        id: `__invest_sig_${ck}_${sigKey}_r${sigRef}`,
        key: sigKey as WeaponKey,
        level: 90,
        ascension: 6,
        refinement: Math.max(
          1,
          Math.min(5, Math.round(sigRef))
        ) as RefinementKey,
        location: '',
        lock: false,
      }
      continue
    }
    if (dbWeapon) weapons[ck] = dbWeapon
  }

  const characters: Partial<Record<CharacterKey, CharacterOverride>> = {}
  for (const [ck, constellation] of Object.entries(cons) as [
    CharacterKey,
    number,
  ][]) {
    characters[ck] = { constellation }
  }

  const bonusStats = teamOptBonusStats(teamOpt, memberKeys)
  let attacks = teamOpt.attacks
  let seconds = result.rotationTime ?? teamOpt.rotationTime

  if (
    needsRotationCalculation(memberKeys) &&
    signatures &&
    Object.keys(signatures).length > 0
  )
    weaponSimChanged = true

  const canSkipReplay =
    !text?.trim() && Object.keys(cons).length === 0 && !weaponSimChanged
  const activeText = text?.trim() || rotation?.text?.trim() || ''
  if (!canSkipReplay && activeText && rotation) {
    const baseGear = simTeamOf(members, database).gear
    const gear: Partial<Record<CharacterKey, SimGear>> = { ...baseGear }
    for (const m of members) {
      const ck = m.characterKey
      const sets: Record<string, number> = {}
      if (!m.isTc) {
        for (const art of arts[ck] ?? [])
          sets[art.setKey] = (sets[art.setKey] ?? 0) + 1
      } else {
        Object.assign(sets, baseGear[ck]?.sets ?? {})
      }
      const w = weapons[ck]
      gear[ck] = {
        sets,
        weapon: w?.key ?? baseGear[ck]?.weapon,
        refinement: w?.refinement ?? baseGear[ck]?.refinement,
      }
    }
    const replay = writtenTeamReplay({
      database,
      teamId,
      members,
      gender,
      names: rotation.names,
      teamOpt,
      text: activeText,
      opener: rotation.opener,
      timing: rotation.timing,
      frameData: rotation.frameData,
      includeEnergy: false,
    })
    if (replay) {
      const overrides = {
        arts,
        weapons,
        characters,
        mainStatAssumptionLevel,
        bonusStats,
      }
      const calculate = rotationCalculation(database, teamId, gender)
      const played = replay({
        gear,
        overrides,
        calculate,
        constellations: cons,
      })
      attacks = played.attacks
      if (played.rotationTime) seconds = played.rotationTime
    }
  }

  const finalAttacks = withAttackStates(attacks, result.attackStates)
  const extraConditionals = teamRuleConditionals(database, teamId, finalAttacks)
  const evaluated = evaluateTeamRotation(database, teamId, gender, {
    attacks: finalAttacks,
    arts,
    weapons,
    characters,
    mainStatAssumptionLevel,
    onField: teamOpt.onField,
    bonusStats,
    extraConditionals,
  })
  if (!evaluated) return undefined
  const unmet = Object.values(evaluated.unmet).some((u) => !!u?.length)
  return {
    team: evaluated.total,
    members: evaluated.members,
    seconds,
    builds: {},
    unmet,
  }
}
