import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { RotationMember, RotationWordStep } from './rotation'
import {
  actionVariants,
  parseRotation,
  rotationWords,
  wordsRotationText,
} from './rotation'

/** A rotation as a rotation search plays it, with the builds it searches for */
export interface RotationScore {
  dps: number
  /** Seconds per rotation */
  time: number
  /** The Energy Recharge each member needs for it (%), as the ER calculator works it out */
  er: Partial<Record<CharacterKey, number>>
  /** The parser's and the simulation's warnings */
  warnings: string[]
  /** What each rotation waits for to be ready, seconds */
  waits?: { label: string; seconds: number }[]
}
export interface RotationCandidate extends RotationScore {
  text: string
}

/**
 * Plays rotations with the search's builds, several at once; `stop` ends it early (the rotations
 * not played yet are undefined)
 */
export type RotationScorer = (
  texts: string[],
  progress?: (played: number) => void,
  stop?: () => boolean
) => Promise<(RotationScore | undefined)[]>

/** Actions every member may get, besides those its own steps have */
const COMMON_WORDS = ['N1', 'N2', 'N3', 'N4', 'CA', 'E', 'hE', 'Q', 'D', 'J']
const GROUP = /^(\d+)\[(.*)\]$/
const groupWords = (inner: string) => inner.split(/\s+/).filter(Boolean)

/** The field attacks (Normal, Charged and Plunging) a member's words make, a group's repeats counted */
export function fieldAttacks(words: readonly string[]): number {
  let n = 0
  for (const word of words) {
    const group = GROUP.exec(word)
    if (group) n += Number(group[1]) * fieldAttacks(groupWords(group[2]))
    else if (/^(N[1-6]|CA|C\d|CF|[HL]?P)(?![a-z])/i.test(word)) n++
  }
  return n
}
const hasBurst = (words: readonly string[]) =>
  words.some((w) => /(^|[\s[])Q/i.test(w))
const memberWords = (steps: readonly RotationWordStep[], key: CharacterKey) =>
  steps.flatMap((s) => (s.characterKey === key ? s.words : []))

/** Who plays the rotation on the field: the member with the most field attacks */
export function mainMember(
  steps: readonly RotationWordStep[]
): CharacterKey | undefined {
  let main: CharacterKey | undefined
  let most = 0
  for (const key of new Set(steps.map((s) => s.characterKey))) {
    const n = fieldAttacks(memberWords(steps, key))
    if (n > most) {
      main = key
      most = n
    }
  }
  return main
}

/** A Normal Attack string one hit shorter and one longer ("N3": "N2", "N4") */
const otherStrings = (word: string) => {
  const n = /^N([1-6])$/i.exec(word)
  if (!n) return []
  const hits = Number(n[1])
  return [hits - 1, hits + 1]
    .filter((h) => h >= 1 && h <= 6)
    .map((h) => `N${h}`)
}

/**
 * The action a word plays whatever its options (a Charged Attack, a Skill, a plunge): another way
 * of writing it is tried in its place ("CA": "CA[beams=4]", "E": "hE", "P": "HP")
 */
function actionOf(word: string) {
  if (/^(CA|C\d*F?)(?![a-z])/i.test(word)) return 'charged'
  if (/^[th]?E(?![a-z])/i.test(word)) return 'skill'
  if (/^[HL]?P(?![a-z])/i.test(word)) return 'plunge'
  return undefined
}

/**
 * A group's words one change away: one left out, two in a row swapped, a string's length, an
 * action written another way (`alternatives`)
 */
function groupEdits(
  words: readonly string[],
  alternatives: (word: string) => string[]
): string[][] {
  const out: string[][] = []
  words.forEach((word, j) => {
    if (words.length > 1)
      out.push([...words.slice(0, j), ...words.slice(j + 1)])
    if (j + 1 < words.length) {
      const swapped = [...words]
      swapped[j] = words[j + 1]
      swapped[j + 1] = word
      out.push(swapped)
    }
    for (const other of [...otherStrings(word), ...alternatives(word)])
      out.push([...words.slice(0, j), other, ...words.slice(j + 1)])
  })
  return out
}

/**
 * The rotations one change away: two steps in a row swapped, a word left out (a step keeps one),
 * two words in a row swapped, a Normal Attack string a hit shorter or longer, an action written
 * another way of the member's `vocabulary` (a Charged Attack's beams, a held Skill), a group
 * repeated once more or once less or its own words changed so, or a word of the member's
 * `vocabulary` added anywhere in its step. The last step stays last when it is the loop back.
 */
export function rotationEdits(
  steps: readonly RotationWordStep[],
  vocabulary: Partial<Record<CharacterKey, string[]>>
): RotationWordStep[][] {
  const out: RotationWordStep[][] = []
  const loops = !steps[steps.length - 1]?.words.length
  const movable = loops ? steps.length - 1 : steps.length
  const withStep = (i: number, words: string[]) =>
    steps.map((s, j) => (j === i ? { ...s, words } : s))
  for (let i = 0; i + 1 < movable; i++) {
    const swapped = [...steps]
    swapped[i] = steps[i + 1]
    swapped[i + 1] = steps[i]
    out.push(swapped)
  }
  steps.forEach(({ characterKey, words }, i) => {
    if (!words.length) return
    const alternatives = (word: string) => {
      const action = actionOf(word)
      return action
        ? (vocabulary[characterKey] ?? []).filter(
            (other) => other !== word && actionOf(other) === action
          )
        : []
    }
    words.forEach((word, j) => {
      if (words.length > 1)
        out.push(withStep(i, [...words.slice(0, j), ...words.slice(j + 1)]))
      const replace = (as: string[]) =>
        out.push(
          withStep(i, [...words.slice(0, j), ...as, ...words.slice(j + 1)])
        )
      for (const other of [...otherStrings(word), ...alternatives(word)])
        replace([other])
      const group = GROUP.exec(word)
      if (group) {
        const times = Number(group[1])
        for (const next of [times - 1, times + 1]) {
          if (next < 1 || next > 20) continue
          replace(next === 1 ? groupWords(group[2]) : [`${next}[${group[2]}]`])
        }
        for (const inner of groupEdits(groupWords(group[2]), alternatives))
          replace([`${times}[${inner.join(' ')}]`])
      }
      if (j + 1 < words.length) {
        const swapped = [...words]
        swapped[j] = words[j + 1]
        swapped[j + 1] = word
        out.push(withStep(i, swapped))
      }
    })
    for (const word of vocabulary[characterKey] ?? [])
      for (let j = 0; j <= words.length; j++)
        out.push(withStep(i, [...words.slice(0, j), word, ...words.slice(j)]))
  })
  return out
}

/**
 * Each member's words to add: its own (not its waits, swaps or groups), the common ones, its kit's
 * own ways of writing them (`actionVariants`), and every plunge for a member that plunges
 */
export function rotationVocabulary(steps: readonly RotationWordStep[]) {
  const vocabulary: Partial<Record<CharacterKey, string[]>> = {}
  for (const { characterKey, words } of steps) {
    const list = (vocabulary[characterKey] ??= [])
    const plunges = words.some((w) => actionOf(w) === 'plunge')
      ? ['P', 'HP', 'LP', 'HP[collision]']
      : []
    for (const word of [
      ...words,
      ...COMMON_WORDS,
      ...actionVariants(characterKey),
      ...plunges,
    ])
      if (
        !list.includes(word) &&
        !GROUP.test(word) &&
        !/^(w|entry|swap)/i.test(word)
      )
        list.push(word)
  }
  return vocabulary
}

/**
 * Which rotations a search keeps to, from the one it starts from: the main DPS (`mainMember`)
 * keeps its Burst and at least half its field attacks, and no other member takes more than 2
 * field attacks over its own, so the team's plan stays the same
 */
export function rotationGuard(seed: readonly RotationWordStep[]) {
  const main = mainMember(seed)
  const mainWords = main ? memberWords(seed, main) : []
  const needBurst = hasBurst(mainWords)
  const needAttacks = Math.ceil(fieldAttacks(mainWords) / 2)
  const most = new Map(
    [...new Set(seed.map((s) => s.characterKey))].map((k) => [
      k,
      fieldAttacks(memberWords(seed, k)) + 2,
    ])
  )
  return (steps: readonly RotationWordStep[]) => {
    for (const [key, limit] of most) {
      const words = memberWords(steps, key)
      if (key === main) {
        if (needBurst && !hasBurst(words)) return false
        if (fieldAttacks(words) < needAttacks) return false
      } else if (fieldAttacks(words) > limit) return false
    }
    return true
  }
}

/**
 * Whether a rotation's Energy Recharge needs can be funded: each member's at most what its build
 * has (`funded`), or `slack` points over what the rotation the search starts from needs (or over
 * 100%). The simulation plays every Burst whatever the energy, so without it a search adds Bursts
 * the team cannot fund.
 */
export function energyFits(
  seed: RotationScore,
  slack = 20,
  funded: Partial<Record<CharacterKey, number>> = {}
) {
  return (score: RotationScore) =>
    Object.entries(score.er).every(([key, need]) => {
      const k = key as CharacterKey
      return (
        (need ?? 0) <=
        Math.max(funded[k] ?? 0, Math.max(seed.er[k] ?? 100, 100) + slack)
      )
    })
}

/** Two rotations that play the same: the same DPS and time */
const samePlay = (a: RotationScore, b: RotationScore) =>
  a.time === b.time && Math.abs(a.dps - b.dps) <= 1e-9 * Math.max(a.dps, b.dps)

/** What a rotation plays, as the parser reads it: rotations written differently that play the same are one */
function playedKey(text: string, members: readonly RotationMember[]) {
  const { steps, loopsTo } = parseRotation(text, members)
  return JSON.stringify([
    steps.map((s) => [s.characterKey, ...s.actions.map((a) => a.text)]),
    loopsTo,
  ])
}

export interface RotationSearchProgress {
  round: number
  /** Rotations played so far */
  played: number
  /** Of this round */
  roundPlayed: number
  roundSize: number
  seed: RotationCandidate
  best: RotationCandidate
}
export interface RotationSearchResult {
  seed: RotationCandidate
  /** The best rotations found, best first (the seed among them when nothing beat it) */
  best: RotationCandidate[]
  played: number
  rounds: number
  /** Why it ended */
  ended: 'converged' | 'time' | 'rounds' | 'cancelled'
}

/**
 * A hill climb from a written rotation: each round plays every rotation one change away from the
 * best few so far (`rotationEdits`, kept to `rotationGuard`), keeps those whose Energy Recharge
 * needs fit (`energyFits`) and that bring no warning the seed does not have, and stops when three
 * rounds in a row find nothing better, at `deadline` (ms) or after `maxRounds`
 */
export async function searchRotations({
  seed,
  members,
  score,
  deadline,
  maxRounds = 12,
  keep = 4,
  erSlack = 20,
  funded,
  onProgress,
  isCancelled = () => false,
}: {
  seed: string
  members: readonly RotationMember[]
  score: RotationScorer
  deadline: number
  maxRounds?: number
  keep?: number
  erSlack?: number
  /** Each member's Energy Recharge with the builds the rotations are played with (%) */
  funded?: Partial<Record<CharacterKey, number>>
  onProgress?: (progress: RotationSearchProgress) => void
  isCancelled?: () => boolean
}): Promise<RotationSearchResult> {
  const seedSteps = rotationWords(seed, members)
  const seedText = wordsRotationText(seedSteps)
  const [seedScore] = await score([seedText])
  if (!seedScore || !(seedScore.dps > 0))
    throw new Error('The rotation could not be played.')
  const start: RotationCandidate = { text: seedText, ...seedScore }
  const fits = energyFits(seedScore, erSlack, funded)
  const known = new Set(seedScore.warnings)
  const ok = rotationGuard(seedSteps)
  const vocabulary = rotationVocabulary(seedSteps)
  const seen = new Set([playedKey(seedText, members)])
  let pool = [start]
  let played = 1
  let stale = 0
  let round = 0
  let ended: RotationSearchResult['ended'] = 'rounds'
  const stop = () => isCancelled() || Date.now() > deadline
  while (round < maxRounds) {
    if (stop()) {
      ended = isCancelled() ? 'cancelled' : 'time'
      break
    }
    round++
    const texts: string[] = []
    for (const parent of pool.slice(0, keep))
      for (const steps of rotationEdits(
        rotationWords(parent.text, members),
        vocabulary
      )) {
        if (!ok(steps)) continue
        const text = wordsRotationText(steps)
        const key = playedKey(text, members)
        if (seen.has(key)) continue
        seen.add(key)
        texts.push(text)
      }
    if (!texts.length) {
      ended = 'converged'
      break
    }
    const bestBefore = pool[0].dps
    const scores = await score(
      texts,
      (n) =>
        onProgress?.({
          round,
          played: played + n,
          roundPlayed: n,
          roundSize: texts.length,
          seed: start,
          best: pool[0],
        }),
      stop
    )
    const found: RotationCandidate[] = []
    scores.forEach((s, i) => {
      if (!s) return
      played++
      if (s.dps > 0 && fits(s) && s.warnings.every((w) => known.has(w)))
        found.push({ text: texts[i], ...s })
    })
    // (rotations that play the same, as an action written that changes nothing: the shortest)
    const merged: RotationCandidate[] = []
    for (const c of [...pool, ...found].sort(
      (a, b) => b.dps - a.dps || a.text.length - b.text.length
    ))
      if (!merged.some((m) => samePlay(m, c))) merged.push(c)
    pool = merged.slice(0, keep * 6)
    onProgress?.({
      round,
      played,
      roundPlayed: texts.length,
      roundSize: texts.length,
      seed: start,
      best: pool[0],
    })
    if (scores.some((s) => !s)) {
      ended = isCancelled() ? 'cancelled' : 'time'
      break
    }
    stale = pool[0].dps > bestBefore * (1 + 1e-4) ? 0 : stale + 1
    if (stale >= 3) {
      ended = 'converged'
      break
    }
  }
  return { seed: start, best: pool, played, rounds: round, ended }
}
