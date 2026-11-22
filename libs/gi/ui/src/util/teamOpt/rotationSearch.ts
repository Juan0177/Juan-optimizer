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
  /**
   * Its DPS with builds that fund its Energy Recharge needs instead of the seed's (`erCost`): the
   * damage stats a lower need frees or a higher one takes. Without a cost, its DPS.
   */
  estimate: number
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
 * What a search may change: the members' order (`order`), a member coming back on the field or an
 * extra visit left out (`visits`), Normal, Charged and Plunging Attacks and their repeats
 * (`attacks`), and the other actions and kits' ways of writing them (`actions`)
 */
export interface RotationEditKinds {
  order: boolean
  visits: boolean
  attacks: boolean
  actions: boolean
}
export const allRotationEdits: RotationEditKinds = {
  order: true,
  visits: true,
  attacks: true,
  actions: true,
}
/** A field attack word, or a group of them */
const attackWord = (word: string) =>
  GROUP.test(word) || fieldAttacks([word]) > 0

/** A Skill or Burst word: what a member comes back on the field to do */
const visitWord = (word: string) =>
  actionOf(word) === 'skill' || /^Q(?![a-z])/i.test(word)

/**
 * The rotations one change away: two steps in a row swapped, a step moved anywhere else (a
 * support played right before the member who catches its particles), a member coming back on the
 * field for a Skill or Burst of its `vocabulary` (to refresh a buff), a member's extra visit left
 * out, a word left out (a step keeps one), two words in a row swapped, a Normal Attack string a
 * hit shorter or longer, an action written another way of the member's `vocabulary` (a Charged
 * Attack's beams, a held Skill), a group repeated once more or once less or its own words changed
 * so, or a word of the member's `vocabulary` added anywhere in its step. The last step stays last
 * when it is the loop back.
 */
export function rotationEdits(
  steps: readonly RotationWordStep[],
  vocabulary: Partial<Record<CharacterKey, string[]>>,
  kinds: RotationEditKinds = allRotationEdits
): RotationWordStep[][] {
  const out: RotationWordStep[][] = []
  const wordKind = (...words: string[]) =>
    words.some(attackWord) ? kinds.attacks : kinds.actions
  const loops = !steps[steps.length - 1]?.words.length
  const movable = loops ? steps.length - 1 : steps.length
  const withStep = (i: number, words: string[]) =>
    steps.map((s, j) => (j === i ? { ...s, words } : s))
  const tail = steps.slice(movable)
  for (let i = 0; kinds.order && i + 1 < movable; i++) {
    const swapped = [...steps]
    swapped[i] = steps[i + 1]
    swapped[i + 1] = steps[i]
    out.push(swapped)
  }
  for (let i = 0; kinds.order && i < movable; i++)
    for (let j = 0; j < movable; j++) {
      if (Math.abs(i - j) <= 1) continue
      const moved = steps.slice(0, movable).filter((_, k) => k !== i)
      moved.splice(j, 0, steps[i])
      out.push([...moved, ...tail])
    }
  const visits = new Map<CharacterKey, number>()
  for (const s of steps.slice(0, movable))
    if (s.words.length)
      visits.set(s.characterKey, (visits.get(s.characterKey) ?? 0) + 1)
  for (let i = 0; kinds.visits && i < movable; i++)
    if ((visits.get(steps[i].characterKey) ?? 0) > 1)
      out.push(steps.filter((_, k) => k !== i))
  for (const [characterKey, words] of Object.entries(vocabulary) as [
    CharacterKey,
    string[],
  ][]) {
    const name = steps.find((s) => s.characterKey === characterKey)?.name
    if (!name || !kinds.visits) continue
    // (a Burst again would wait out its cooldown: only for a member that has none in the rotation)
    const bursts = hasBurst(memberWords(steps, characterKey))
    for (const word of words.filter(
      (w) => visitWord(w) && !(bursts && /^Q/i.test(w))
    ))
      for (let j = 0; j <= movable; j++) {
        if (
          steps[j - 1]?.characterKey === characterKey ||
          (j < movable && steps[j].characterKey === characterKey)
        )
          continue
        out.push([
          ...steps.slice(0, j),
          { characterKey, name, words: [word] },
          ...steps.slice(j),
        ])
      }
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
      if (words.length > 1 && wordKind(word))
        out.push(withStep(i, [...words.slice(0, j), ...words.slice(j + 1)]))
      const replace = (as: string[]) =>
        out.push(
          withStep(i, [...words.slice(0, j), ...as, ...words.slice(j + 1)])
        )
      for (const other of [...otherStrings(word), ...alternatives(word)])
        if (wordKind(word, other)) replace([other])
      const group = GROUP.exec(word)
      if (group && kinds.attacks) {
        const times = Number(group[1])
        for (const next of [times - 1, times + 1]) {
          if (next < 1 || next > 20) continue
          replace(next === 1 ? groupWords(group[2]) : [`${next}[${group[2]}]`])
        }
        for (const inner of groupEdits(groupWords(group[2]), alternatives))
          replace([`${times}[${inner.join(' ')}]`])
      }
      if (j + 1 < words.length && wordKind(word, words[j + 1])) {
        const swapped = [...words]
        swapped[j] = words[j + 1]
        swapped[j + 1] = word
        out.push(withStep(i, swapped))
      }
    })
    for (const word of vocabulary[characterKey] ?? [])
      for (let j = 0; wordKind(word) && j <= words.length; j++)
        out.push(withStep(i, [...words.slice(0, j), word, ...words.slice(j)]))
  })
  return out
}

/**
 * The rotation's steps in every other order, one of each that only loops from another step
 * (those play alike): for rotations of at most `most` steps, the loop back kept last
 */
export function stepOrders(
  steps: readonly RotationWordStep[],
  most = 6
): RotationWordStep[][] {
  const loops = !steps[steps.length - 1]?.words.length
  const movable = steps.slice(0, loops ? -1 : undefined)
  const tail = steps.slice(movable.length)
  if (movable.length < 3 || movable.length > most) return []
  // (each order from the first step's place: the others are its loops)
  const [first, ...rest] = movable
  const orders: RotationWordStep[][] = []
  const permute = (left: RotationWordStep[], done: RotationWordStep[]) => {
    if (!left.length) {
      orders.push([first, ...done])
      return
    }
    left.forEach((step, i) =>
      permute([...left.slice(0, i), ...left.slice(i + 1)], [...done, step])
    )
  }
  permute(rest, [])
  return orders.slice(1).map((order) => [...order, ...tail])
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

/** Lets the page paint and take input between slices of a round's work on its thread */
const yieldToPage = (): Promise<void> =>
  (
    globalThis as { scheduler?: { yield?: () => Promise<void> } }
  ).scheduler?.yield?.() ?? new Promise((resolve) => setTimeout(resolve, 0))

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
  /** The best rotations so far, best first (the seed among them until something beats it) */
  top: RotationCandidate[]
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
 * rounds in a row find nothing better (and, with `widen`, a round from more of the best does not
 * either), at `deadline` (ms) or after `maxRounds`. Rotations are
 * ranked by their `estimate`: with `erCost`, the Energy Recharge a rotation needs is paid in the
 * damage stats it takes from the builds (one that lowers a need gains what it frees).
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
  erCost,
  kinds = allRotationEdits,
  plan,
  widen,
  reference,
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
  /** The DPS the builds give up to have the Energy Recharge a rotation needs */
  erCost?: (score: RotationScore) => number
  /** What it may change (`rotationEdits`) */
  kinds?: RotationEditKinds
  /** The rotation whose plan every rotation keeps to (`rotationGuard`); the seed by default */
  plan?: string
  /** When the best few find nothing better, one more round from this many of the best */
  widen?: number
  /**
   * What estimates and Energy Recharge fits are measured from (several searches from different
   * starts, compared): the seed's play by default
   */
  reference?: RotationScore
  onProgress?: (progress: RotationSearchProgress) => void
  isCancelled?: () => boolean
}): Promise<RotationSearchResult> {
  const seedSteps = rotationWords(seed, members)
  const seedText = wordsRotationText(seedSteps)
  const [seedScore] = await score([seedText])
  if (!seedScore || !(seedScore.dps > 0))
    throw new Error('The rotation could not be played.')
  const base = reference ?? seedScore
  const seedCost = erCost?.(base) ?? 0
  const estimate = (s: RotationScore) =>
    erCost ? s.dps + seedCost - erCost(s) : s.dps
  const start: RotationCandidate = {
    text: seedText,
    ...seedScore,
    estimate: estimate(seedScore),
  }
  onProgress?.({
    round: 0,
    played: 1,
    roundPlayed: 1,
    roundSize: 1,
    seed: start,
    best: start,
    top: [start],
  })
  const fits = energyFits(base, erSlack, funded)
  const known = new Set(seedScore.warnings)
  const ok = rotationGuard(
    plan === undefined ? seedSteps : rotationWords(plan, members)
  )
  const vocabulary = rotationVocabulary(seedSteps)
  const seen = new Set([playedKey(seedText, members)])
  let pool = [start]
  let played = 1
  let stale = 0
  let round = 0
  let width = keep
  let ended: RotationSearchResult['ended'] = 'rounds'
  const stop = () => isCancelled() || Date.now() > deadline
  while (round < maxRounds) {
    if (stop()) {
      ended = isCancelled() ? 'cancelled' : 'time'
      break
    }
    round++
    const texts: string[] = []
    let slice = performance.now()
    for (const parent of pool.slice(0, width))
      for (const steps of rotationEdits(
        rotationWords(parent.text, members),
        vocabulary,
        kinds
      )) {
        if (performance.now() - slice > 8) {
          await yieldToPage()
          slice = performance.now()
        }
        if (!ok(steps)) continue
        const text = wordsRotationText(steps)
        const key = playedKey(text, members)
        if (seen.has(key)) continue
        seen.add(key)
        texts.push(text)
      }
    if (!texts.length) {
      if (widen && width < widen) {
        width = widen
        continue
      }
      ended = 'converged'
      break
    }
    const bestBefore = pool[0].estimate
    const top = pool.slice(0, keep * 2)
    onProgress?.({
      round,
      played,
      roundPlayed: 0,
      roundSize: texts.length,
      seed: start,
      best: pool[0],
      top,
    })
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
          top,
        }),
      stop
    )
    const found: RotationCandidate[] = []
    scores.forEach((s, i) => {
      if (!s) return
      played++
      if (s.dps > 0 && fits(s) && s.warnings.every((w) => known.has(w)))
        found.push({ text: texts[i], ...s, estimate: estimate(s) })
    })
    // (rotations that play the same, as an action written that changes nothing: the shortest)
    const merged: RotationCandidate[] = []
    for (const c of [...pool, ...found].sort(
      (a, b) => b.estimate - a.estimate || a.text.length - b.text.length
    ))
      if (!merged.some((m) => samePlay(m, c))) merged.push(c)
    pool = merged.slice(0, Math.max(keep * 6, widen ?? 0))
    onProgress?.({
      round,
      played,
      roundPlayed: texts.length,
      roundSize: texts.length,
      seed: start,
      best: pool[0],
      top: pool.slice(0, keep * 2),
    })
    if (scores.some((s) => !s)) {
      ended = isCancelled() ? 'cancelled' : 'time'
      break
    }
    if (pool[0].estimate > bestBefore * (1 + 1e-4)) {
      stale = 0
      width = keep
    } else stale++
    if (stale >= 3) {
      // (before it ends: once from more of the best, which may lead somewhere the best few do not)
      if (widen && width < widen) {
        width = widen
        stale = 2
        continue
      }
      ended = 'converged'
      break
    }
  }
  return { seed: start, best: pool, played, rounds: round, ended }
}
