import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type {
  RotationAction,
  RotationMember,
  RotationWordStep,
} from './rotation'
import {
  actionVariants,
  kitModels,
  parseRotation,
  rotationWords,
  simulateRotation,
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
  /**
   * Timing-jitter-averaged estimate (`verify`), when checked: rotations that only win on a narrow
   * frame boundary or phase alignment drop here instead of winning the hill climb.
   */
  robustEstimate?: number
}

/** The ranking value of a candidate: its jitter-verified estimate when checked, else its estimate */
export const candidateRank = (c: RotationCandidate) =>
  c.robustEstimate ?? c.estimate

/**
 * Plays rotations with the search's builds, several at once; `stop` ends it early (the rotations
 * not played yet are undefined)
 */
export type RotationScorer = (
  texts: string[],
  progress?: (played: number) => void,
  stop?: () => boolean
) => Promise<(RotationScore | undefined)[]>

/**
 * Plays rotations at nearby swap-timing offsets to check whether a gain holds under small timing
 * shifts: one array of offset scores per rotation (undefined when stopped early)
 */
export type RotationVerifier = (
  texts: string[],
  stop?: () => boolean
) => Promise<((RotationScore | undefined)[] | undefined)[]>

/** Actions active attackers may get, besides those their own steps have */
const FIELD_COMMON_WORDS = [
  'N1',
  'N2',
  'N3',
  'N4',
  'CA',
  'E',
  'hE',
  'Q',
  'D',
  'J',
]
/** Actions pure off-field supports may get: no idle dashes, jumps or multi-hit NA/CA filler */
const SUPPORT_COMMON_WORDS = ['N1', 'E', 'hE', 'Q']
/** Kits whose dash is an elemental attack/infusion (alternate sprint) rather than a pure cancel */
const DASH_KIT_MEMBERS = new Set<CharacterKey>(['KamisatoAyaka', 'Mona'])
const GROUP = /^(\d+)\[(.*)\]$/
const isCancel = (word: string) => /^([DJ])(?![a-z])/i.test(word)
const isDash = (word: string) => /^D(?![a-z])/i.test(word)
const isJump = (word: string) => /^J(?![a-z])/i.test(word)
const isNormal = (word: string) => /^N[1-6](?![a-z])/i.test(word)
const isOptional = (word: string) => /\?/.test(word)
const edgeWord = (word: string, end: 'first' | 'last'): string => {
  const group = GROUP.exec(word)
  if (!group) return word
  const inner = groupWords(group[2])
  if (!inner.length) return word
  return edgeWord(inner[end === 'first' ? 0 : inner.length - 1], end)
}
/**
 * Count unplayable adjacent patterns inside a step or repeating group: consecutive Normal Attack
 * strings without an intervening cancel (`N2 N3`, `N4 N1`, `2[N3]`), back-to-back Bursts
 * (`Q Q`, `Q Q?`), or an optional action adjacent to the same action (`E E?`, `Q? Q`).
 */
function countBadAdjacentWords(
  words: readonly string[],
  cyclic = false
): number {
  const badPair = (a: string, b: string) => {
    const left = edgeWord(a, 'last')
    const right = edgeWord(b, 'first')
    if (isNormal(left) && isNormal(right)) return true
    const leftAct = actionOf(left)
    const rightAct = actionOf(right)
    if (leftAct === 'burst' && rightAct === 'burst') return true
    if (
      leftAct &&
      leftAct === rightAct &&
      (isOptional(left) || isOptional(right))
    )
      return true
    return false
  }
  let n = 0
  for (let k = 0; k + 1 < words.length; k++)
    if (badPair(words[k], words[k + 1])) n++
  if (cyclic && words.length > 0 && badPair(words[words.length - 1], words[0]))
    n++
  return n
}
/** Count consecutive steps belonging to the same member (including across the cyclic loop back) */
function countAdjacentSameMember(
  steps: readonly RotationWordStep[],
  loops: boolean
): number {
  const movable = loops ? steps.length - 1 : steps.length
  let n = 0
  for (let k = 0; k + 1 < movable; k++)
    if (steps[k].characterKey === steps[k + 1].characterKey) n++
  if (
    loops &&
    movable > 1 &&
    steps[0].characterKey === steps[movable - 1].characterKey
  )
    n++
  return n
}

const heldSkill = new Map<CharacterKey, boolean>()
/**
 * Whether a member's kit plays a held Skill otherwise than a tap (its hits or its length): a kit
 * without a held one plays "hE" as "E", so the search does not offer it
 */
export function holdsSkill(characterKey: CharacterKey): boolean {
  let holds = heldSkill.get(characterKey)
  if (holds === undefined && kitModels[characterKey]?.heldSkill) holds = true
  if (holds === undefined) {
    const play = (action: RotationAction) => {
      const sim = simulateRotation({
        rotation: {
          steps: [{ characterKey, actions: [action] }],
          loopsTo: characterKey,
          warnings: [],
        },
        members: [characterKey],
        elements: { [characterKey]: getCharEle(characterKey) } as never,
        constellations: {},
        repeats: 1,
        keep: 'all',
      })
      return JSON.stringify([
        sim.frames,
        sim.hits.map((h) => [h.t, h.path.join('.')]),
      ])
    }
    try {
      holds =
        play({ kind: 'skill', hold: true, text: 'hE' }) !==
        play({ kind: 'skill', text: 'E' })
    } catch {
      // (a kit that can't play its Skill alone: offered, as before)
      holds = true
    }
    heldSkill.set(characterKey, holds)
  }
  return holds
}
const groupWords = (inner: string) => inner.split(/\s+/).filter(Boolean)

const normalLength = new Map<CharacterKey, number>()
/**
 * The hits of a member's Normal Attack string as its kit plays it (6 when its kit can't be played
 * alone, as before): a longer "N" starts the string over, so the search offers none longer
 */
export function normalStringLength(characterKey: CharacterKey): number {
  let length = normalLength.get(characterKey)
  if (length === undefined) {
    let most = 0
    try {
      simulateRotation({
        rotation: {
          steps: [
            {
              characterKey,
              actions: [{ kind: 'normal', count: 1, text: 'N1' }],
            },
          ],
          loopsTo: characterKey,
          warnings: [],
        },
        members: [characterKey],
        elements: { [characterKey]: getCharEle(characterKey) } as never,
        constellations: {},
        repeats: 1,
        keep: 'all',
        normalStrings: (k, n) => {
          if (k === characterKey) most = Math.max(most, n)
        },
      })
    } catch {
      most = 0
    }
    length = most || 6
    normalLength.set(characterKey, length)
  }
  return length
}
/** The longest "N" a member's words write, inside groups too */
const longestNormal = (words: readonly string[]): number =>
  words.reduce((most, word) => {
    const group = GROUP.exec(word)
    if (group) return Math.max(most, longestNormal(groupWords(group[2])))
    const n = /^N([1-6])$/i.exec(word)
    return n ? Math.max(most, Number(n[1])) : most
  }, 0)
/** The longest "N" a search may write for a member: its string, or longer if its words are */
const normalMost = (characterKey: CharacterKey, words: readonly string[]) =>
  Math.max(normalStringLength(characterKey), longestNormal(words))

/** The field attacks (Normal, Charged and Plunging) a member's words make, a group's repeats counted */
export function fieldAttacks(words: readonly string[]): number {
  let n = 0
  for (const word of words) {
    const group = GROUP.exec(word)
    if (group) n += Number(group[1]) * fieldAttacks(groupWords(group[2]))
    else if (/^(N[1-6]|CA|C\d*F?|[HL]?P)(?![a-z])/i.test(word)) n++
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

/**
 * The Normal Attack string at every other length ("N3": "N1", "N2", "N4"…): a search reaches the
 * best length in one step, inside a repeated group too, where each change counts every repeat
 */
const otherStrings = (word: string, most = 6) => {
  const n = /^N([1-6])$/i.exec(word)
  if (!n) return []
  const hits = Number(n[1])
  return [1, 2, 3, 4, 5, 6]
    .filter((h) => h !== hits && h <= most)
    .map((h) => `N${h}`)
}

/**
 * The action a word plays whatever its options (a Charged Attack, a Skill, a plunge): another way
 * of writing it is tried in its place ("CA": "CA[beams=4]", "E": "hE", "P": "HP")
 */
function actionOf(word: string) {
  if (/^(CA|C\d*F?)(?![a-z])/i.test(word)) return 'charged'
  if (/^[th]?E(?![a-z])/i.test(word)) return 'skill'
  if (/^Q(?![a-z])/i.test(word)) return 'burst'
  if (/^[HL]?P(?![a-z])/i.test(word)) return 'plunge'
  return undefined
}

/** Whether `words[j]` is a jump immediately launching a plunge (`J HP`, `J P`) */
const isPlungeJump = (words: readonly string[], j: number) =>
  isJump(words[j]) &&
  j + 1 < words.length &&
  actionOf(edgeWord(words[j + 1], 'first')) === 'plunge'

/**
 * Whether a step's cancels (D / J) sit in meaningless delay positions: leading a step (unless an
 * alt-sprint dash), back-to-back cancels (`D D`, `D J`), or trailing a non-attack word (swap
 * already cancels skills/bursts without an extra dash/jump).
 */
function hasBadCancel(
  words: readonly string[],
  allowLeadingDash: boolean
): boolean {
  if (!words.length) return false
  if (isCancel(words[0]) && !(allowLeadingDash && isDash(words[0]))) return true
  for (let k = 0; k + 1 < words.length; k++)
    if (isCancel(words[k]) && isCancel(words[k + 1])) return true
  if (
    words.length > 1 &&
    isCancel(words[words.length - 1]) &&
    !attackWord(words[words.length - 2])
  )
    return true
  return false
}

/**
 * A group's words one change away: one left out, two in a row swapped, a string's length, an
 * action written another way (`alternatives`)
 */
function groupEdits(
  words: readonly string[],
  alternatives: (word: string) => string[],
  most = 6
): string[][] {
  const out: string[][] = []
  const baseBad = countBadAdjacentWords(words, true)
  const valid = (next: string[]) =>
    !hasBadCancel(next, false) && countBadAdjacentWords(next, true) <= baseBad
  words.forEach((word, j) => {
    if (words.length > 1 && !isPlungeJump(words, j)) {
      const next = [...words.slice(0, j), ...words.slice(j + 1)]
      if (valid(next)) out.push(next)
    }
    if (j + 1 < words.length && !isPlungeJump(words, j)) {
      const swapped = [...words]
      swapped[j] = words[j + 1]
      swapped[j + 1] = word
      if (valid(swapped)) out.push(swapped)
    }
    for (const other of [...otherStrings(word, most), ...alternatives(word)]) {
      const next = [...words.slice(0, j), other, ...words.slice(j + 1)]
      if (valid(next)) out.push(next)
    }
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
 * when it is the loop back, and loops back to whoever plays first.
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
  const baseSame = countAdjacentSameMember(steps, loops)
  const pushSteps = (next: RotationWordStep[]) => {
    if (countAdjacentSameMember(next, loops) <= baseSame) out.push(next)
  }
  for (let i = 0; kinds.order && i + 1 < movable; i++) {
    const swapped = [...steps]
    swapped[i] = steps[i + 1]
    swapped[i + 1] = steps[i]
    pushSteps(swapped)
  }
  for (let i = 0; kinds.order && i < movable; i++)
    for (let j = 0; j < movable; j++) {
      if (Math.abs(i - j) <= 1) continue
      const moved = steps.slice(0, movable).filter((_, k) => k !== i)
      moved.splice(j, 0, steps[i])
      pushSteps([...moved, ...tail])
    }
  const visits = new Map<CharacterKey, number>()
  for (const s of steps.slice(0, movable))
    if (s.words.length)
      visits.set(s.characterKey, (visits.get(s.characterKey) ?? 0) + 1)
  for (let i = 0; kinds.visits && i < movable; i++)
    if ((visits.get(steps[i].characterKey) ?? 0) > 1)
      pushSteps(steps.filter((_, k) => k !== i))
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
          (j < movable && steps[j].characterKey === characterKey) ||
          (loops && j === movable && steps[0]?.characterKey === characterKey) ||
          (loops &&
            j === 0 &&
            steps[movable - 1]?.characterKey === characterKey)
        )
          continue
        pushSteps([
          ...steps.slice(0, j),
          { characterKey, name, words: [word] },
          ...steps.slice(j),
        ])
      }
  }
  steps.forEach(({ characterKey, words }, i) => {
    if (!words.length) return
    const allowLeadingDash = DASH_KIT_MEMBERS.has(characterKey)
    const baseBad = countBadAdjacentWords(words)
    const most = normalMost(characterKey, memberWords(steps, characterKey))
    const alternatives = (word: string) => {
      const action = actionOf(word)
      return action
        ? (vocabulary[characterKey] ?? []).filter(
            (other) => other !== word && actionOf(other) === action
          )
        : []
    }
    words.forEach((word, j) => {
      if (words.length > 1 && wordKind(word) && !isPlungeJump(words, j)) {
        const next = [...words.slice(0, j), ...words.slice(j + 1)]
        if (
          !hasBadCancel(next, allowLeadingDash) &&
          countBadAdjacentWords(next) <= baseBad
        )
          out.push(withStep(i, next))
      }
      const replace = (as: string[]) => {
        const next = [...words.slice(0, j), ...as, ...words.slice(j + 1)]
        if (
          !hasBadCancel(next, allowLeadingDash) &&
          countBadAdjacentWords(next) <= baseBad
        )
          out.push(withStep(i, next))
      }
      for (const other of [...otherStrings(word, most), ...alternatives(word)])
        if (wordKind(word, other)) replace([other])
      const group = GROUP.exec(word)
      if (group && kinds.attacks) {
        const times = Number(group[1])
        for (const next of [times - 1, times + 1]) {
          if (next < 1 || next > 20) continue
          replace(next === 1 ? groupWords(group[2]) : [`${next}[${group[2]}]`])
        }
        for (const inner of groupEdits(
          groupWords(group[2]),
          alternatives,
          most
        ))
          replace([`${times}[${inner.join(' ')}]`])
      }
      if (
        j + 1 < words.length &&
        wordKind(word, words[j + 1]) &&
        !isPlungeJump(words, j)
      ) {
        const swapped = [...words]
        swapped[j] = words[j + 1]
        swapped[j + 1] = word
        if (
          !hasBadCancel(swapped, allowLeadingDash) &&
          countBadAdjacentWords(swapped) <= baseBad
        )
          out.push(withStep(i, swapped))
      }
    })
    for (const word of vocabulary[characterKey] ?? [])
      for (let j = 0; wordKind(word) && j <= words.length; j++) {
        const next = [...words.slice(0, j), word, ...words.slice(j)]
        if (isCancel(word) && hasBadCancel(next, allowLeadingDash)) continue
        if (countBadAdjacentWords(next) > baseBad) continue
        out.push(withStep(i, next))
      }
  })
  // (a loop back to the member who used to play first would add a swap to them at the end)
  return loops
    ? out.map((edit) => [
        ...edit.slice(0, -1),
        { characterKey: edit[0].characterKey, name: edit[0].name, words: [] },
      ])
    : out
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
  // (looping back to the first member, as `rotationEdits`' do)
  const back = tail.map(() => ({
    characterKey: first.characterKey,
    name: first.name,
    words: [],
  }))
  return orders.slice(1).map((order) => [...order, ...back])
}

/**
 * Each member's words to add: its own (not its waits, swaps or groups), common words appropriate
 * to its role (off-field supports get Skills, Bursts and N1 without idle dashes/jumps/multi-hit
 * combos), its kit's own ways of writing them (`actionVariants`), and every plunge for a member
 * that plunges
 */
export function rotationVocabulary(
  steps: readonly RotationWordStep[],
  constellations: Partial<Record<CharacterKey, number>> = {}
) {
  const vocabulary: Partial<Record<CharacterKey, string[]>> = {}
  const main = mainMember(steps)
  const onField = new Set<CharacterKey>()
  if (main) onField.add(main)
  // Secondary carries with a real multi-hit combo step (>= 3 field attacks) also keep full combos,
  // while supports with 1-2 weave NAs (e.g. Shenhe hE N1 Q, Zhongli N1 hE D, Xilonen E N2) stay
  // on support vocabulary so they don't get idle dashes, jumps, or multi-hit NA/CA filler.
  for (const { characterKey, words } of steps)
    if (fieldAttacks(words) >= 3) onField.add(characterKey)
  for (const { characterKey, words } of steps) {
    const list = (vocabulary[characterKey] ??= [])
    const most = normalMost(characterKey, memberWords(steps, characterKey))
    const plunges = words.some((w) => actionOf(w) === 'plunge')
      ? ['P', 'HP', 'LP', 'HP[collision]']
      : []
    const common = onField.has(characterKey)
      ? FIELD_COMMON_WORDS
      : DASH_KIT_MEMBERS.has(characterKey)
        ? [...SUPPORT_COMMON_WORDS, 'D']
        : SUPPORT_COMMON_WORDS
    for (const word of [
      ...words,
      ...common.filter(
        (w) =>
          (w !== 'hE' || holdsSkill(characterKey)) && longestNormal([w]) <= most
      ),
      ...actionVariants(characterKey, constellations[characterKey]),
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

/** The best rotations a search reports and keeps (the parents of a round are fewer, `keep`) */
const KEPT = 30

/** Two rotations that play the same: the same DPS and time */
export const samePlay = (a: RotationScore, b: RotationScore) =>
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
  verify,
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
  constellations,
  onProgress,
  isCancelled = () => false,
}: {
  seed: string
  members: readonly RotationMember[]
  score: RotationScorer
  /** Timing-jitter verifier for top candidates (prevents overfitting single-frame cliffs) */
  verify?: RotationVerifier
  deadline: number
  maxRounds?: number
  keep?: number
  erSlack?: number
  /** Each member's Energy Recharge with the builds the rotations are played with (%) */
  funded?: Partial<Record<CharacterKey, number>>
  /** The DPS the builds give up to have the Energy Recharge a rotation needs */
  erCost?: (score: RotationScore, base?: RotationScore) => number
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
  reference?: RotationScore & { text?: string; robustEstimate?: number }
  /** The members' constellations the rotations are played at: what their actions may be */
  constellations?: Partial<Record<CharacterKey, number>>
  onProgress?: (progress: RotationSearchProgress) => void
  isCancelled?: () => boolean
}): Promise<RotationSearchResult> {
  const seedSteps = rotationWords(seed, members)
  const seedText = wordsRotationText(seedSteps)
  const [seedScore] = await score([seedText])
  if (!seedScore || !(seedScore.dps > 0))
    throw new Error('The rotation could not be played.')
  const base = reference ?? seedScore
  const seedCost = erCost?.(base, base) ?? 0
  const estimate = (s: RotationScore) =>
    erCost ? s.dps + seedCost - erCost(s, base) : s.dps
  const start: RotationCandidate = {
    text: seedText,
    ...seedScore,
    estimate: estimate(seedScore),
  }
  const known = new Set(seedScore.warnings)
  const stop = () => isCancelled() || Date.now() > deadline
  const verified = new Map<string, number>()
  const seedKey = playedKey(seedText, members)
  if (verify) {
    if (
      reference?.text === seedText &&
      reference.robustEstimate !== undefined
    ) {
      start.robustEstimate = reference.robustEstimate
      verified.set(seedKey, reference.robustEstimate)
    } else if (!stop()) {
      const [offsets] = await verify([seedText], stop)
      if (offsets) {
        const valid = offsets.filter(
          (s): s is RotationScore => !!s && s.dps > 0
        )
        if (!reference)
          for (const s of valid) for (const w of s.warnings) known.add(w)
        const all = [seedScore, ...valid]
        start.robustEstimate =
          all.reduce((sum, s) => sum + estimate(s), 0) / all.length
        verified.set(seedKey, start.robustEstimate)
      }
    }
  }
  const baselineRank = reference?.robustEstimate ?? candidateRank(start)
  const verifyTop = async (
    list: RotationCandidate[],
    want: number
  ): Promise<RotationCandidate[]> => {
    if (!verify || stop()) return list
    const sortList = (items: RotationCandidate[]) =>
      items.sort(
        (a, b) =>
          candidateRank(b) - candidateRank(a) || a.text.length - b.text.length
      )
    sortList(list)
    // Up to two passes so if cliff-artifact candidates drop after jitter verification, the real
    // candidates that surface into the top `want` also get verified before becoming parents.
    for (let pass = 0; pass < 2 && !stop(); pass++) {
      const batchSize = pass === 0 ? Math.max(want * 2, 8) : want
      const todo: { candidate: RotationCandidate; key: string }[] = []
      for (const c of list) {
        if (todo.length >= batchSize) break
        const k = playedKey(c.text, members)
        if (verified.has(k)) {
          c.robustEstimate = verified.get(k)
          continue
        }
        if (todo.length >= want && c.estimate < baselineRank * 0.98) break
        todo.push({ candidate: c, key: k })
      }
      if (!todo.length) break
      const results = await verify(
        todo.map((t) => t.candidate.text),
        stop
      )
      let demoted = false
      todo.forEach(({ candidate: c, key }, idx) => {
        const offsets = results[idx]
        if (!offsets) return
        const fragile = offsets.some(
          (s) => s && !s.warnings.every((w) => known.has(w))
        )
        let robust: number
        if (fragile) {
          robust = Math.min(c.estimate, baselineRank)
        } else {
          const valid = offsets.filter(
            (s): s is RotationScore => !!s && s.dps > 0
          )
          const all = [c, ...valid]
          robust = all.reduce((sum, s) => sum + estimate(s), 0) / all.length
        }
        if (robust < c.estimate * (1 - 1e-4)) demoted = true
        c.robustEstimate = robust
        verified.set(key, robust)
      })
      sortList(list)
      if (!demoted) break
    }
    return list
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
  const ok = rotationGuard(
    plan === undefined ? seedSteps : rotationWords(plan, members)
  )
  const vocabulary = rotationVocabulary(seedSteps, constellations)
  const seen = new Set([seedKey])
  let pool = [start]
  let played = 1
  let stale = 0
  let round = 0
  let width = keep
  let ended: RotationSearchResult['ended'] = 'rounds'
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
    const bestBefore = candidateRank(pool[0])
    const top = pool.slice(0, KEPT)
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
      (a, b) =>
        candidateRank(b) - candidateRank(a) || a.text.length - b.text.length
    ))
      if (!merged.some((m) => samePlay(m, c))) merged.push(c)
    await verifyTop(merged, Math.max(width, 6))
    pool = merged.slice(0, Math.max(KEPT, widen ?? 0))
    onProgress?.({
      round,
      played,
      roundPlayed: texts.length,
      roundSize: texts.length,
      seed: start,
      best: pool[0],
      top: pool.slice(0, KEPT),
    })
    if (scores.some((s) => !s)) {
      ended = isCancelled() ? 'cancelled' : 'time'
      break
    }
    if (candidateRank(pool[0]) > bestBefore * (1 + 1e-4)) {
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
