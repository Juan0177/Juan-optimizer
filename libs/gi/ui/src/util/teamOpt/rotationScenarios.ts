import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptEnergyCalculator } from '@genshin-optimizer/gi/db'
import type { RotationMember, RotationWordStep } from './rotation'
import { parseRotation, rotationWords, wordsRotationText } from './rotation'

/**
 * How often a member casts their Elemental Burst in a scenario:
 * 1 = every rotation, 2 = every 2nd rotation, 3 = every 3rd rotation, 0 = skip completely.
 */
export type BurstCadence = 1 | 2 | 3 | 0

/** All cadence choices offered in order. */
export const BURST_CADENCES: readonly BurstCadence[] = [1, 2, 3, 0]

/** Guardrail so a Cartesian product of choices stays snappy to run. */
export const MAX_COMPARISON_SCENARIOS = 16

/** What the written rotation tells us about one member who casts Q. */
export interface BurstMemberInfo {
  characterKey: CharacterKey
  name: string
  /** Current cadence from the ER calculator (or 2 if written as Q? / Q/alt, else 1) */
  baselineCadence: BurstCadence
  /** Initial checked cadences when the dialog opens */
  defaultCadences: BurstCadence[]
  /** Fallback action already written in the rotation (e.g. "N4" from "Q/N4"), if any */
  defaultInstead: string
  /** Whether the rotation text already had Q? or Q/alt for this member */
  optionalInText: boolean
}

/** User configuration for one bursting member inside the scenario comparator. */
export interface BurstMemberConfig {
  characterKey: CharacterKey
  cadences: BurstCadence[]
  /** Action(s) to play instead of Q when Q is skipped (e.g. "N4" or "N2 CA"). Empty = omit Q. */
  instead: string
}

/** Choice chosen for one bursting member in a concrete scenario. */
export interface ScenarioMemberChoice {
  cadence: BurstCadence
  instead?: string
}

/** Optional user-typed extra rotation variant to compare alongside cadence scenarios. */
export interface CustomScenarioInput {
  id: string
  label: string
  text: string
}

/** One concrete scenario ready to preview, optimize, and rank. */
export interface RotationScenario {
  id: string
  kind: 'cadence' | 'custom'
  label?: string
  /** Rotation text played for this scenario */
  text: string
  /** Explicit Burst cadence overrides for the ER calculator & everyNthBursts */
  burstEvery: Partial<Record<CharacterKey, number>>
  /** Per-member cadence + fallback choices (for cadence scenarios) */
  choices: Partial<Record<CharacterKey, ScenarioMemberChoice>>
  /** Matches the user's current rotation & ER cadence */
  isBaseline: boolean
}

const BURST_WORD = /^Q(\?)?(?:\/(.+))?$/i
const EQ_ALT_WORD = /^([th]?E)(Q\??)\/(.+)$/i
const GROUP_WORD = /^(\d+)\[(.*)\]$/

/** Collapse spaces inside an `/alternative` token so `takeAlternative()` parses every action. */
export function compactAlternative(instead: string): string {
  return instead.trim().replace(/\s+/g, '')
}

/** Normalize fallback text for standalone insertion (e.g. when Burst is skipped completely). */
export function cleanAlternative(instead: string): string {
  return instead.trim().replace(/\s+/g, ' ')
}

/** Extract any `/alt` fallback written on a member's Burst tokens (e.g. `Q/N4` -> `N4`). */
function burstAltInWord(word: string): {
  isBurst: boolean
  optional: boolean
  alt?: string
} {
  const m = BURST_WORD.exec(word)
  if (m) return { isBurst: true, optional: !!(m[1] || m[2]), alt: m[2] }
  const eq = EQ_ALT_WORD.exec(word)
  if (eq) {
    // "EQ/E" -> E is kept, Q is skipped with no replacement; "EQ/EN4" -> alt "N4"
    const prefix = eq[1]
    const rawAlt = eq[3]
    const stripped = rawAlt.toLowerCase().startsWith(prefix.toLowerCase())
      ? rawAlt.slice(prefix.length)
      : rawAlt
    return { isBurst: true, optional: true, alt: stripped || undefined }
  }
  return { isBurst: false, optional: false }
}

/** Split a group word (`2[N4 Q]`) or return single words. */
function inspectWords(words: readonly string[], visit: (word: string) => void) {
  for (const w of words) {
    const g = GROUP_WORD.exec(w)
    if (g) inspectWords(g[2].split(/\s+/).filter(Boolean), visit)
    else visit(w)
  }
}

/**
 * Detect every team member who casts Elemental Burst (`Q`) in the written rotation,
 * in the order they appear, along with their current cadence and any written `/alt` fallback.
 */
export function detectBurstMembers(
  text: string,
  names: readonly RotationMember[],
  currentBurstEvery?: Partial<Record<CharacterKey, number>>
): BurstMemberInfo[] {
  const steps = rotationWords(text, names)
  const parsed = parseRotation(text, names)
  const seen = new Map<CharacterKey, BurstMemberInfo>()
  const nameByKey = new Map(names.map((n) => [n.characterKey, n.name]))

  // Check parsed steps so we only include members that actually have a burst action
  const hasBurstInParsed = new Set(
    parsed.steps
      .filter((s) => s.actions.some((a) => a.kind === 'burst'))
      .map((s) => s.characterKey)
  )

  for (const step of steps) {
    if (!step.words.length || !hasBurstInParsed.has(step.characterKey)) continue
    let foundBurst = false
    let optionalInText = false
    let foundAlt = ''
    inspectWords(step.words, (w) => {
      const info = burstAltInWord(w)
      if (!info.isBurst) return
      foundBurst = true
      if (info.optional) optionalInText = true
      if (!foundAlt && info.alt) foundAlt = info.alt
    })
    if (!foundBurst) continue

    const existing = seen.get(step.characterKey)
    if (existing) {
      if (optionalInText) existing.optionalInText = true
      if (!existing.defaultInstead && foundAlt)
        existing.defaultInstead = foundAlt
      continue
    }

    const rawCurrent = currentBurstEvery?.[step.characterKey]
    const current: BurstCadence =
      rawCurrent === 0
        ? 0
        : rawCurrent === 2 || rawCurrent === 3
          ? rawCurrent
          : rawCurrent === 1
            ? 1
            : optionalInText
              ? 2
              : 1

    const defaultCadences: BurstCadence[] =
      current !== 1 ? [1, current] : optionalInText ? [1, 2] : [1]

    seen.set(step.characterKey, {
      characterKey: step.characterKey,
      name: nameByKey.get(step.characterKey) ?? step.name,
      baselineCadence: current,
      defaultCadences,
      defaultInstead: foundAlt,
      optionalInText,
    })
  }

  return [...seen.values()]
}

/** Validate a user's "Instead of Q" action string (empty is valid = omit Q). */
export function validateInsteadAction(
  characterKey: CharacterKey,
  name: string,
  instead: string
): { valid: boolean; error?: string } {
  const cleaned = cleanAlternative(instead)
  if (!cleaned) return { valid: true }
  const parsed = parseRotation(`${name} ${cleaned}`, [{ characterKey, name }])
  if (parsed.warnings.length > 0)
    return { valid: false, error: parsed.warnings[0] }
  const actions = parsed.steps[0]?.actions ?? []
  if (!actions.length)
    return { valid: false, error: `"${cleaned}" is not a valid action` }
  return { valid: true }
}

/** Rewrite one word (or repeat group) for a member's chosen Burst cadence & fallback. */
function rewriteWord(word: string, choice: ScenarioMemberChoice): string[] {
  const group = GROUP_WORD.exec(word)
  if (group) {
    const inner = group[2]
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((w) => rewriteWord(w, choice))
    return inner.length ? [`${group[1]}[${inner.join(' ')}]`] : []
  }

  const eq = EQ_ALT_WORD.exec(word)
  if (eq) {
    const prefix = eq[1]
    const tail = rewriteWord(eq[2] + (eq[3] ? `/${eq[3]}` : ''), choice)
    return [prefix, ...tail]
  }

  if (!BURST_WORD.test(word)) return [word]

  const alt = cleanAlternative(choice.instead ?? '')
  const compact = compactAlternative(choice.instead ?? '')
  if (choice.cadence === 1) return ['Q']
  if (choice.cadence === 2 || choice.cadence === 3)
    return [compact ? `Q/${compact}` : 'Q']
  // cadence === 0 (Skip): replace Q with fallback action(s), or drop Q
  return alt ? alt.split(' ') : []
}

/**
 * Rewrite a written rotation according to per-member Burst cadence & fallback choices:
 * - Every (1): plain `Q` (clears `?` / `/alt` so ER calc counts every rotation)
 * - Every 2nd / 3rd (2 / 3): `Q/<alt>` if a fallback is set, else plain `Q` (thinned by `everyNthBursts`)
 * - Skip (0): replaces `Q` with `<alt>` or drops `Q` (and drops any step left empty, fixing loop-back)
 */
export function rewriteBurstRotation(
  baseText: string,
  names: readonly RotationMember[],
  choices: Partial<Record<CharacterKey, ScenarioMemberChoice>>
): string {
  const steps = rotationWords(baseText, names)
  if (!steps.length) return baseText.trim()

  const last = steps[steps.length - 1]
  const hasLoop = last.words.length === 0
  const body = hasLoop ? steps.slice(0, -1) : steps

  const nextBody: RotationWordStep[] = []
  for (const step of body) {
    const choice = choices[step.characterKey]
    if (!choice) {
      nextBody.push(step)
      continue
    }
    const words = step.words.flatMap((w) => rewriteWord(w, choice))
    if (words.length > 0) nextBody.push({ ...step, words })
  }

  if (!nextBody.length) return baseText.trim()

  if (hasLoop) {
    const stillPresent = nextBody.some(
      (s) => s.characterKey === last.characterKey
    )
    nextBody.push(
      stillPresent
        ? last
        : {
            characterKey: nextBody[0].characterKey,
            name: nextBody[0].name,
            words: [],
          }
    )
  }

  return wordsRotationText(nextBody)
}

/**
 * Generate the Cartesian product of selected Burst cadences plus any custom rotation scenarios.
 * Returns total count and caps generated cadence scenarios at `MAX_COMPARISON_SCENARIOS`.
 */
export function buildRotationScenarios({
  baseText,
  names,
  configs,
  baselineBurstEvery,
  customScenarios = [],
}: {
  baseText: string
  names: readonly RotationMember[]
  configs: readonly BurstMemberConfig[]
  baselineBurstEvery?: Partial<Record<CharacterKey, number>>
  customScenarios?: readonly CustomScenarioInput[]
}): {
  scenarios: RotationScenario[]
  totalCount: number
  truncated: boolean
} {
  const activeConfigs = configs.map((c) => ({
    ...c,
    cadences: c.cadences.length ? c.cadences : ([1] as BurstCadence[]),
  }))

  const cartesianTotal = activeConfigs.reduce(
    (prod, c) => prod * c.cadences.length,
    1
  )
  const validCustoms = customScenarios.filter((c) => c.text.trim().length > 0)
  const totalCount = cartesianTotal + validCustoms.length
  const truncated = cartesianTotal > MAX_COMPARISON_SCENARIOS

  // Build combinations in deterministic order up to the cap
  let combos: Partial<Record<CharacterKey, ScenarioMemberChoice>>[] = [{}]
  for (const cfg of activeConfigs) {
    const next: Partial<Record<CharacterKey, ScenarioMemberChoice>>[] = []
    const instead = cleanAlternative(cfg.instead) || undefined
    for (const prefix of combos) {
      for (const cadence of cfg.cadences) {
        if (next.length >= MAX_COMPARISON_SCENARIOS) break
        next.push({
          ...prefix,
          [cfg.characterKey]: {
            cadence,
            ...(cadence !== 1 && instead ? { instead } : {}),
          },
        })
      }
      if (next.length >= MAX_COMPARISON_SCENARIOS) break
    }
    combos = next
  }

  const seen = new Set<string>()
  const scenarios: RotationScenario[] = []

  for (const choices of combos) {
    const text = rewriteBurstRotation(baseText, names, choices)
    const burstEvery: Partial<Record<CharacterKey, number>> = {}
    for (const [ck, ch] of Object.entries(choices) as [
      CharacterKey,
      ScenarioMemberChoice,
    ][]) {
      burstEvery[ck] = ch.cadence
    }
    const sig = `${text}|${JSON.stringify(burstEvery)}`
    if (seen.has(sig)) continue
    seen.add(sig)

    const isBaseline = activeConfigs.every((cfg) => {
      const ch = choices[cfg.characterKey]
      const base = baselineBurstEvery?.[cfg.characterKey] ?? 1
      return ch?.cadence === base
    })

    const id =
      activeConfigs
        .map((cfg) => {
          const ch = choices[cfg.characterKey]!
          return `${cfg.characterKey}:${ch.cadence}${ch.instead ? `:${compactAlternative(ch.instead)}` : ''}`
        })
        .join('|') || 'base'

    scenarios.push({
      id,
      kind: 'cadence',
      text,
      burstEvery,
      choices,
      isBaseline,
    })
  }

  // Ensure baseline appears first before optimization runs
  scenarios.sort((a, b) => Number(b.isBaseline) - Number(a.isBaseline))

  for (const custom of validCustoms) {
    scenarios.push({
      id: `custom:${custom.id}`,
      kind: 'custom',
      label: custom.label.trim() || undefined,
      text: custom.text.trim(),
      burstEvery: {},
      choices: {},
      isBaseline: false,
    })
  }

  return { scenarios, totalCount, truncated }
}

/**
 * Pin explicit per-member Burst cadences onto an ER calculator config.
 * When `pinAll` is true (during scenario calculation), every member in `burstEvery` gets
 * `'burstEvery'` marked edited so `withRotationEnergy` preserves the scenario's exact cadence.
 * When `pinAll` is false (when applying to the user's team), only `cadence !== 1` stays pinned.
 */
export function withScenarioBurstEvery(
  calculator: TeamOptEnergyCalculator,
  burstEvery: Partial<Record<CharacterKey, number>>,
  pinAll = true
): TeamOptEnergyCalculator {
  const members = { ...calculator.members }
  for (const [ck, cadence] of Object.entries(burstEvery) as [
    CharacterKey,
    number | undefined,
  ][]) {
    if (cadence === undefined) continue
    const member = members[ck]
    if (!member) continue
    const edited = new Set(member.edited ?? [])
    if (pinAll || cadence !== 1) edited.add('burstEvery')
    else edited.delete('burstEvery')
    members[ck] = {
      ...member,
      burstEvery: cadence,
      edited: edited.size ? [...edited] : undefined,
    }
  }
  return { ...calculator, members }
}

/**
 * Rank scenario results best-first:
 * 1) Feasible builds (all ER/stat constraints met, DPS > 0) ahead of unmet/failed builds
 * 2) Higher team DPS first
 * 3) Fewer unmet requirements when both are infeasible
 */
export function rankScenarioResults<
  T extends { dps: number; unmetCount: number; error?: string },
>(results: readonly T[]): T[] {
  return [...results].sort((a, b) => {
    const aOk = !a.error && a.dps > 0 && a.unmetCount === 0
    const bOk = !b.error && b.dps > 0 && b.unmetCount === 0
    if (aOk !== bOk) return aOk ? -1 : 1
    if (!!a.error !== !!b.error) return a.error ? 1 : -1
    if (a.unmetCount !== b.unmetCount) return a.unmetCount - b.unmetCount
    return b.dps - a.dps
  })
}
