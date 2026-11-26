import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocCharKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type { RotationTemplate } from '@genshin-optimizer/gi/ui'
import {
  kqmMemberConstellation,
  mainPart,
  mainPartSuggestions,
  memberSteps,
  parseRotation,
  rotationTemplates,
  supportPart,
  supportPartSuggestions,
  teamOptMembers,
  templatesForTeam,
} from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import type { VersionSwap } from './kqmVersions'
import {
  signatureOf,
  versionRoot,
  versionRotation,
  versionsOf,
} from './kqmVersions'
import { templateText } from './RotationTemplates'
import {
  kqmRotationId,
  memberNamesOf,
  writtenRotationOf,
} from './RotationWriter'

/** Maximum total characters allowed in the batch combinations pool (original + flex) */
export const MAX_COMBO_POOL = 8

/** Canonical member-set signature (order-independent) for deduplicating team combinations */
export function memberSetKey(members: readonly CharacterKey[]): string {
  return [...members].sort().join(',')
}

/**
 * Canonical identity of a combination including each member's effective constellation (and optional
 * signature refinement) so raising a character's constellation is recognized as a distinct version.
 */
export function comboIdentityKey(
  members: readonly CharacterKey[],
  consOf: (k: CharacterKey) => number,
  sigOf?: (k: CharacterKey) => number | undefined
): string {
  return [...members]
    .sort()
    .map((k) => {
      const r = sigOf?.(k)
      return `${k}:C${consOf(k)}${r !== undefined ? `:R${r}` : ''}`
    })
    .join(',')
}

/** Member-set keys already present in the family (original + all existing versions) */
export function existingFamilyMemberSets(
  database: ArtCharDatabase,
  teamId: string
): Set<string> {
  const rootId = versionRoot(database, teamId)
  const out = new Set<string>()
  for (const id of [rootId, ...versionsOf(database, rootId)]) {
    const keys = teamOptMembers(database, id).map((m) => m.characterKey)
    if (keys.length) out.add(memberSetKey(keys))
  }
  return out
}

/** Effective member + constellation + signature keys already present in the family */
export function existingFamilyComboKeys(
  database: ArtCharDatabase,
  teamId: string
): Set<string> {
  const rootId = versionRoot(database, teamId)
  const rootKqm = database.teams.get(rootId)?.teamOpt?.kqm
  const out = new Set<string>()
  for (const id of [rootId, ...versionsOf(database, rootId)]) {
    const keys = teamOptMembers(database, id).map((m) => m.characterKey)
    if (!keys.length) continue
    const ownCons = database.teams.get(id)?.versionCons ?? {}
    const ownSig = signatureOf(database, id, keys)
    out.add(
      comboIdentityKey(
        keys,
        (k) => ownCons[k] ?? kqmMemberConstellation(k, rootKqm),
        (k) => ownSig[k]
      )
    )
  }
  return out
}

/**
 * The original team's main DPS: the member with the most actions in its KQM rotation, or slot 0
 * when no rotation is written yet.
 */
export function comboMainMember(
  database: ArtCharDatabase,
  rootId: string,
  names: { i18n: i18n; gender: GenderKey }
): CharacterKey | undefined {
  const members = teamOptMembers(database, rootId).map((m) => m.characterKey)
  if (!members.length) return undefined
  const { text } = writtenRotationOf(database, kqmRotationId(rootId))
  if (!text.trim()) return members[0]
  const memberNames = memberNamesOf(
    members.map((characterKey) => ({ characterKey })),
    names.i18n,
    names.gender
  )
  const actions = new Map<CharacterKey, number>()
  for (const step of parseRotation(text, memberNames).steps)
    actions.set(
      step.characterKey,
      (actions.get(step.characterKey) ?? 0) + step.actions.length
    )
  let best = members[0]
  let most = actions.get(best) ?? 0
  for (const k of members.slice(1)) {
    const count = actions.get(k) ?? 0
    if (count > most) {
      best = k
      most = count
    }
  }
  return best
}

/**
 * Learns each non-original character's most recently written step from existing versions of this
 * family so newly generated combinations reuse the user's preferred actions automatically.
 */
export function familyPartHints(
  database: ArtCharDatabase,
  rootId: string,
  names: { i18n: i18n; gender: GenderKey }
): Partial<Record<CharacterKey, string>> {
  const hints: Partial<Record<CharacterKey, string>> = {}
  const versionIds = versionsOf(database, rootId)
  // newest first so the user's most recent edit wins
  for (let i = versionIds.length - 1; i >= 0; i--) {
    const id = versionIds[i]
    const members = teamOptMembers(database, id).map((m) => m.characterKey)
    const { text } = writtenRotationOf(database, kqmRotationId(id))
    if (!text.trim() || !members.length) continue
    const memberNames = memberNamesOf(
      members.map((characterKey) => ({ characterKey })),
      names.i18n,
      names.gender
    )
    for (const k of members) {
      if (hints[k]) continue
      const steps = memberSteps(text, memberNames, k)
      if (steps[0]?.trim()) hints[k] = steps[0].trim()
    }
  }
  return hints
}

/**
 * Ordered 1-click rotation part suggestions for an added pool character: any step learned from
 * existing family versions first, then template support parts (and main-DPS parts if the original
 * main DPS is unlocked so this character could serve as main DPS).
 */
export function characterPartSuggestions(
  characterKey: CharacterKey,
  {
    familyHint,
    includeMain = false,
  }: { familyHint?: string; includeMain?: boolean } = {}
): string[] {
  const out: string[] = []
  const add = (part?: string) => {
    const trimmed = part?.trim()
    if (trimmed && !out.includes(trimmed)) out.push(trimmed)
  }
  add(familyHint)
  for (const p of supportPartSuggestions(characterKey, 4)) add(p)
  if (includeMain) for (const p of mainPartSuggestions(characterKey, 2)) add(p)
  return out.slice(0, 6)
}

/**
 * Generates all `size`-character combinations from `pool` that include every member in `locked`
 * and have distinct character locations (so two Traveler elements never end up on the same team).
 * Ordered by fewest swaps from `rootMembers` first so closest variants appear at the top.
 */
export function generatePoolCombinations(
  pool: readonly CharacterKey[],
  locked: readonly CharacterKey[],
  size: number,
  rootMembers: readonly CharacterKey[]
): CharacterKey[][] {
  if (size <= 0 || pool.length < size) return []
  const lockedSet = new Set(locked.filter((k) => pool.includes(k)))
  if (lockedSet.size > size) return []
  // Check locked characters don't collide on Traveler location
  const lockedLocs = new Set<string>()
  for (const k of lockedSet) {
    const loc = charKeyToLocCharKey(k)
    if (lockedLocs.has(loc)) return []
    lockedLocs.add(loc)
  }
  const lockedList = pool.filter((k) => lockedSet.has(k))
  const flex = pool.filter((k) => !lockedSet.has(k))
  const need = size - lockedList.length
  const results: CharacterKey[][] = []
  const chosen: CharacterKey[] = []

  const pick = (start: number, locs: Set<string>) => {
    if (chosen.length === need) {
      results.push([...lockedList, ...chosen])
      return
    }
    const left = need - chosen.length
    for (let i = start; i <= flex.length - left; i++) {
      const k = flex[i]
      const loc = charKeyToLocCharKey(k)
      if (locs.has(loc)) continue
      chosen.push(k)
      locs.add(loc)
      pick(i + 1, locs)
      locs.delete(loc)
      chosen.pop()
    }
  }
  pick(0, new Set(lockedLocs))

  const rootSet = new Set(rootMembers)
  const swapCount = (combo: readonly CharacterKey[]) =>
    combo.reduce((n, k) => n + (rootSet.has(k) ? 0 : 1), 0)
  results.sort((a, b) => swapCount(a) - swapCount(b))
  return results
}

/**
 * Maps a generated combination onto the original team's slots as `VersionSwap[]`:
 * - Original members staying in the combination keep their slots.
 * - If the original main DPS is swapped out, pair it with an incoming carry (one with a template
 *   `mainPart`, preferring a template match with the combo) so it receives the main-DPS field time.
 * - Remaining supports are paired by matching element first so aura/buff order stays natural.
 */
export function swapsForCombo(
  rootMembers: readonly CharacterKey[],
  comboMembers: readonly CharacterKey[],
  mainDps?: CharacterKey
): VersionSwap[] {
  const outs = rootMembers.filter((k) => !comboMembers.includes(k))
  const ins = comboMembers.filter((k) => !rootMembers.includes(k))
  if (!outs.length || outs.length !== ins.length) return []

  const remainingOuts = [...outs]
  const remainingIns = [...ins]
  const swaps: VersionSwap[] = []

  // 1. Pair outgoing main DPS with best incoming carry candidate
  if (mainDps && remainingOuts.includes(mainDps)) {
    const exactMatch = templatesForTeam([...comboMembers]).find(
      (tm) =>
        tm.members.length === comboMembers.length &&
        tm.members.every((m) => comboMembers.includes(m)) &&
        remainingIns.includes(tm.characterKey)
    )
    const carry =
      exactMatch?.characterKey ??
      remainingIns.find((k) => !!mainPart(k)) ??
      remainingIns[0]
    if (carry) {
      swaps.push({ from: mainDps, to: carry })
      remainingOuts.splice(remainingOuts.indexOf(mainDps), 1)
      remainingIns.splice(remainingIns.indexOf(carry), 1)
    }
  }

  // 2. Pair remaining members by same element first
  for (let i = 0; i < remainingOuts.length; ) {
    const out = remainingOuts[i]
    const outEle = getCharEle(out)
    const matchIdx = remainingIns.findIndex((k) => getCharEle(k) === outEle)
    if (matchIdx >= 0) {
      swaps.push({ from: out, to: remainingIns[matchIdx] })
      remainingOuts.splice(i, 1)
      remainingIns.splice(matchIdx, 1)
    } else {
      i++
    }
  }

  // 3. Pair the rest in order
  for (let i = 0; i < remainingOuts.length; i++)
    swaps.push({ from: remainingOuts[i], to: remainingIns[i] })

  // Keep swaps ordered by original slot order for predictable display
  swaps.sort(
    (a, b) => rootMembers.indexOf(a.from) - rootMembers.indexOf(b.from)
  )
  return swaps
}

export interface ComboRotationPreview {
  text: string
  opener: string
  /** Whether the auto-filled rotation came from swapping the original or an exact template */
  source: 'swapped' | 'template'
  template?: RotationTemplate
  /** Exact 4-member templates available as 1-click choices for this combination */
  exactTemplates: RotationTemplate[]
  /** The smart-swapped version of the original rotation (for switching back from a template) */
  swapped: { text: string; opener: string }
}

/**
 * Computes the smart auto-filled rotation for a generated combination:
 * - Preserves the original rotation (swapping only replaced slots with `partOverrides` /
 *   `supportPart` / `mainPart`) when the original main DPS remains in the team.
 * - Prefers an exact matching template when the original main DPS was swapped out (unless the user
 *   explicitly customized the incoming main DPS's part) or when the original has no rotation yet.
 * - Always exposes any exact templates for 1-click switching.
 */
export function comboAutoRotation(
  database: ArtCharDatabase,
  rootId: string,
  rootMembers: readonly CharacterKey[],
  swaps: readonly VersionSwap[],
  names: { i18n: i18n; gender: GenderKey },
  {
    partOverrides = {},
    userEditedParts = new Set<CharacterKey>(),
    mainDps,
  }: {
    partOverrides?: Partial<Record<CharacterKey, string>>
    userEditedParts?: ReadonlySet<CharacterKey>
    mainDps?: CharacterKey
  } = {}
): ComboRotationPreview {
  const teamMembers = rootMembers.map(
    (k) => swaps.find((s) => s.from === k)?.to ?? k
  )
  const memberNames = memberNamesOf(
    teamMembers.map((characterKey) => ({ characterKey })),
    names.i18n,
    names.gender
  )
  const mainSwap = mainDps ? swaps.find((s) => s.from === mainDps) : undefined
  const effectiveOverrides: Partial<Record<CharacterKey, string>> = {
    ...partOverrides,
  }
  // When an added character replaces the main DPS and the user hasn't explicitly edited its part,
  // let `versionRotation` use `mainPart(to)` instead of its default support part.
  if (mainSwap && !userEditedParts.has(mainSwap.to))
    delete effectiveOverrides[mainSwap.to]
  const swapped = versionRotation(
    database,
    rootId,
    swaps,
    names,
    effectiveOverrides
  )
  const exactTemplates = templatesForTeam(teamMembers).filter(
    (tm) =>
      tm.members.length === teamMembers.length &&
      tm.members.every((m) => teamMembers.includes(m))
  )
  const shouldPreferTemplate =
    exactTemplates.length > 0 &&
    (!swapped.text.trim() || (!!mainSwap && !userEditedParts.has(mainSwap.to)))

  if (shouldPreferTemplate) {
    const tm = exactTemplates[0]
    return {
      text: templateText(tm.text, memberNames),
      opener: tm.opener ? templateText(tm.opener, memberNames) : '',
      source: 'template',
      template: tm,
      exactTemplates,
      swapped,
    }
  }
  return {
    text: swapped.text,
    opener: swapped.opener,
    source: 'swapped',
    exactTemplates,
    swapped,
  }
}

/** Helper to default part for a newly added character in the combinations pool */
export function defaultComboPart(
  characterKey: CharacterKey,
  familyHint?: string
): string {
  return familyHint?.trim() || supportPart(characterKey)
}

/**
 * Common teammates to suggest for 1-click pool addition, ranked by co-occurrence with the team's
 * main DPS and current pool members in built-in KQM rotation templates.
 */
export function suggestedPoolAdditions(
  pool: readonly CharacterKey[],
  mainDps?: CharacterKey,
  limit = 6
): CharacterKey[] {
  const inPool = new Set(pool)
  const scores = new Map<CharacterKey, number>()
  for (const tm of rotationTemplates) {
    const isMainTeam = !!mainDps && tm.characterKey === mainDps
    const overlap = tm.members.filter((m) => inPool.has(m)).length
    if (!isMainTeam && overlap < 2) continue
    const weight = isMainTeam ? 3 + overlap : overlap
    for (const m of tm.members) {
      if (inPool.has(m)) continue
      scores.set(m, (scores.get(m) ?? 0) + weight)
    }
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([k]) => k)
}
