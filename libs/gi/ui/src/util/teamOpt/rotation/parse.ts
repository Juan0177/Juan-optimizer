import type { CharacterKey } from '@genshin-optimizer/gi/consts'

/**
 * A rotation written the way players write them:
 *   "bina EQ -> illuga EQ -> linnea E -> Zibai E N1 E N4 E N4 Q E N2 E -> bina"
 * Steps are separated by `->` (also `→`, `>`, `,`, `;` or a new line); each starts with who acts
 * (a member's name, a nickname, or the start of either) and lists that member's actions, with or
 * without spaces between them:
 *   E / tE  Elemental Skill, tapped          hE   Elemental Skill, held
 *   Q       Elemental Burst                  N1–N6  a Normal Attack string of that many hits
 *   CA / C  Charged Attack                   P    Plunging Attack
 *   CA[beams=2]  Sandrone's charge released after 2 condensed beams (3 by default; up to 6 from C1)
 *   C3 / C3F / CF  Mavuika's Flamestrider Charged Attack held for 3 spins (1 by default), then
 *                its finisher waited for (F): KQM's "C3FD C3FD CF"
 *   D       dash                             J    jump
 *   4[N5 CD] / 4N5CD  a group written once with how many times (1 to 20)
 *   W1.5    wait 1.5 s (W90f: 90 frames; Mualani in her blessing walks on Sharky meanwhile)
 *   E? / Q?  only when ready (left out, not waited for, when it is not: "Sucrose N1 E? D")
 *   entry / swap  swap in and straight out again (a name alone mid-rotation is the same): her
 *                swap-in effects only, e.g. Danica's Entry Skill once Will to Cleanse is full
 * A trailing step with no actions ("-> bina") marks the swap back to that member: where the
 * rotation loops. "A/B" alternatives take the first one; "(…)" comments are ignored.
 */

export type RotationActionKind =
  | 'skill'
  | 'burst'
  | 'normal'
  | 'charged'
  | 'plunge'
  | 'dash'
  | 'jump'
  | 'wait'
  /** Swap in and do nothing else ("Danica" alone, or "Danica entry"): her swap-in effects only */
  | 'swap'

export interface RotationAction {
  kind: RotationActionKind
  /** Skill: tapped or held */
  hold?: boolean
  /** Normal: how many hits of the string (N4 = 4); wait: seconds */
  count?: number
  /** Used only when ready ("E?", "Q?"): left out, not waited for, when it is not */
  optional?: boolean
  /** Charged: Sandrone's condensed beams before she releases it ("CA[beams=2]") */
  beams?: number
  /** Charged: Mavuika's Flamestrider spins held ("C3": 3) */
  spins?: number
  /** Charged: Mavuika's Flamestrider finisher, waited for ("C3F", "CF") */
  final?: boolean
  /** As written (for messages) */
  text: string
}

export interface RotationStep {
  characterKey: CharacterKey
  actions: RotationAction[]
}

export interface ParsedRotation {
  steps: RotationStep[]
  /**
   * The first rotation, written apart: played in place of the rotation's first copy. Counted when
   * rotations are counted from the start; otherwise a setup played before the loops, not counted
   */
  opener?: RotationStep[]
  /** The rotation loops back to this member (a trailing step without actions) */
  loopsTo?: CharacterKey
  warnings: string[]
}

export interface RotationMember {
  characterKey: CharacterKey
  /** The member's displayed name (any language), for matching */
  name: string
}

/** Short names players use, by character key (matched as whole words, case-insensitive) */
const NICKNAMES: Partial<Record<CharacterKey, string[]>> = {
  Columbina: ['bina', 'colu', 'columbina'],
  Valeriy: ['val', 'valeriy'],
  Anastasya: ['ana', 'tsaritsa', 'anastasya'],
  AratakiItto: ['itto'],
  RaidenShogun: ['raiden', 'ei'],
  KaedeharaKazuha: ['kazuha'],
  KamisatoAyaka: ['ayaka'],
  KamisatoAyato: ['ayato'],
  SangonomiyaKokomi: ['kokomi'],
  YumemizukiMizuki: ['mizuki'],
  Alhaitham: ['haitham'],
  Furina: ['furina'],
  Neuvillette: ['neuv', 'neuvi'],
  Wriothesley: ['wrio'],
  Xianyun: ['xy', 'cloud retainer'],
  Arlecchino: ['arle'],
  Chasca: ['chasca'],
  Citlali: ['cit', 'citlali'],
  Mavuika: ['mav', 'mavuika'],
}

/**
 * A name as compared: letters and digits of any script (Инеффа, 茜特菈莉, Ayaka), accents and case
 * ignored ("Ëlise" = "elise")
 */
const norm = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

/** The member a word (or a few words) names exactly: its key, displayed name or a nickname */
function exactMember(
  word: string,
  members: readonly RotationMember[]
): CharacterKey | undefined {
  const w = norm(word)
  if (!w) return undefined
  const found = members.filter(
    (m) =>
      norm(m.characterKey) === w ||
      norm(m.name) === w ||
      (NICKNAMES[m.characterKey] ?? []).some((n) => norm(n) === w)
  )
  return found.length === 1 ? found[0].characterKey : undefined
}

/**
 * A part written without arrows ("Ineffa Q E Columbina E Q"): a new step starts at every later
 * word (or two or three) that names a member exactly; words in parentheses (notes) never do
 */
function splitOnNames(
  part: string,
  members: readonly RotationMember[]
): string[] {
  const words = part.split(/\s+/)
  /** How many words from `i` name a member exactly (the longest), 0 if none */
  const nameAt = (i: number) =>
    [3, 2, 1].find(
      (n) =>
        i + n <= words.length &&
        !words.slice(i, i + n).some((w) => /[()]/.test(w)) &&
        !!exactMember(words.slice(i, i + n).join(' '), members)
    ) ?? 0
  const parts: string[][] = [[]]
  let depth = 0
  // (the words of a name just matched: "Kaedehara Kazuha" is one name, not two steps)
  let inName = nameAt(0)
  for (let i = 0; i < words.length; i++) {
    const word = words[i]
    if (i > 0 && depth === 0 && inName <= 0) {
      const n = nameAt(i)
      if (n) {
        parts.push([])
        inName = n
      }
    }
    parts[parts.length - 1].push(word)
    inName--
    depth = Math.max(
      0,
      depth +
        (word.match(/\(/g)?.length ?? 0) -
        (word.match(/\)/g)?.length ?? 0)
    )
  }
  return parts.map((p) => p.join(' ')).filter(Boolean)
}

/** Which member a step's name refers to (undefined: none, or ambiguous) */
export function matchMember(
  word: string,
  members: readonly RotationMember[]
): CharacterKey | undefined {
  const w = norm(word)
  if (!w) return undefined
  const exact = exactMember(word, members)
  if (exact) return exact
  if (w.length < 3) return undefined
  const prefix = members.filter(
    (m) =>
      norm(m.characterKey).startsWith(w) ||
      norm(m.name).startsWith(w) ||
      m.name.split(/\s+/).some((part) => norm(part).startsWith(w))
  )
  return prefix.length === 1 ? prefix[0].characterKey : undefined
}

/** Members whose Charged Attack takes a number of beams ("CA[beams=2]"), and the most it can take */
const CHARGE_BEAMS: Partial<Record<CharacterKey, number>> = { Sandrone: 6 }
/** The Charged Attacks held for spins with a finisher (KQM's "C3F"), at most this many spins */
const CHARGE_SPINS: Partial<Record<CharacterKey, number>> = { Mavuika: 8 }

/** The most times one group is repeated ("4[N5CD]", "4N5CD") */
const MAX_REPEAT = 20

/**
 * A group written once with how many times, as players write it: "4[N5 CD]" (KQM's notation) or
 * "4N5CD" (the number glued to a word) is the group that many times. The number starts a word, so
 * Sandrone's "CA[beams=2]" stays as it is.
 */
export function expandRepeats(
  text: string,
  warnings: string[] = [],
  who = ''
): string {
  const repeat = (
    match: string,
    before: string,
    times: string,
    group: string
  ) => {
    const n = Number(times)
    if (n >= 1 && n <= MAX_REPEAT)
      return before + Array(n).fill(group.trim()).join(' ')
    warnings.push(
      `${who}: "${match.trim()}": 1 to ${MAX_REPEAT} times (played once)`
    )
    return before + group.trim()
  }
  return text
    .replace(/(^|\s)(\d+)\s*\[([^[\]]+)\]/g, (m, before, times, group) =>
      /^\s*beams\s*=/i.test(group) ? m : repeat(m, before, times, group)
    )
    .replace(/(^|\s)(\d+)([a-z]\S*)/gi, repeat)
}

/** One step's actions: "EQ", "E N1 E N4", "tE CA", "N1E", "W1.5" (seconds), "W90f" (frames) */
function parseActions(
  text: string,
  warnings: string[],
  who: string,
  characterKey?: CharacterKey
): RotationAction[] {
  const actions: RotationAction[] = []
  // alternatives: the first one
  const cleaned = text
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((word) => word.split('/')[0])
    .join(' ')
  const token =
    /\s*(?:(w)\s*([\d.]+f?)|(h|t)?(e)(\?)?|(q)(\?)?|(n)\s*([1-6])|(ca|c)(\d+)?(f)?(?:\[\s*beams\s*=\s*(\d+)\s*\])?|(p)|(d)|(j))/iy
  let i = 0
  const s = expandRepeats(cleaned, warnings, who).trim()
  while (i < s.length) {
    // "entry" / "swap": swap in for the member's swap-in effects only (Danica's Entry Skill)
    const swapWord = /\s*(entry|swap)(?![a-z])/iy
    swapWord.lastIndex = i
    const sw = swapWord.exec(s)
    if (sw) {
      actions.push({ kind: 'swap', text: sw[1] })
      i = swapWord.lastIndex
      continue
    }
    token.lastIndex = i
    const m = token.exec(s)
    if (!m || m[0].length === 0) {
      // skip one unknown character (e.g. a stray "+"), say so once per step
      const bad = s.slice(i).trim().split(/\s+/)[0]
      if (bad) warnings.push(`${who}: "${bad}" is not an action (skipped)`)
      const next = s.indexOf(' ', i + 1)
      i = next < 0 ? s.length : next
      continue
    }
    i = token.lastIndex
    const raw = m[0].trim()
    if (m[1]) {
      // seconds, or frames with an "f" (W1.5 = W90f)
      const count = /f$/i.test(m[2])
        ? Number(m[2].slice(0, -1)) / 60
        : Number(m[2])
      // ("W." or "W1..5" while typing: no length, not a wait; it never reaches the simulation)
      if (Number.isFinite(count) && count >= 0)
        actions.push({ kind: 'wait', count, text: raw })
      else
        warnings.push(
          `${who}: "${raw}" is not a wait: write its length, as W1.5 or W90f (skipped)`
        )
    } else if (m[4])
      actions.push({
        kind: 'skill',
        hold: m[3]?.toLowerCase() === 'h',
        text: raw,
        ...(m[5] && { optional: true }),
      })
    else if (m[6])
      actions.push({
        kind: 'burst',
        text: raw,
        ...(m[7] && { optional: true }),
      })
    else if (m[8])
      actions.push({ kind: 'normal', count: Number(m[9]), text: raw })
    else if (m[10] && (m[11] !== undefined || m[12])) {
      // (KQM's held Charged Attack: "C3F" spins 3 times, then its finisher)
      const spins = m[11] !== undefined ? Number(m[11]) : 1
      const most = characterKey && CHARGE_SPINS[characterKey]
      if (!most) {
        warnings.push(
          `${who}: "${raw}": spins and a finisher are Mavuika's Flamestrider Charged Attack only (played as a Charged Attack)`
        )
        actions.push({ kind: 'charged', text: raw })
      } else if (spins < 1 || spins > most) {
        warnings.push(
          `${who}: "${raw}": 1 to ${most} spins (played as a Charged Attack)`
        )
        actions.push({ kind: 'charged', text: raw })
      } else
        actions.push({
          kind: 'charged',
          spins,
          ...(m[12] && { final: true }),
          text: raw,
        })
    } else if (m[10]) {
      const beams = m[13] !== undefined ? Number(m[13]) : undefined
      const most = characterKey && CHARGE_BEAMS[characterKey]
      if (beams === undefined) actions.push({ kind: 'charged', text: raw })
      else if (!most) {
        warnings.push(
          `${who}: "${raw}": only Sandrone's Charged Attack has beams (played as a plain Charged Attack)`
        )
        actions.push({ kind: 'charged', text: raw })
      } else if (beams < 1 || beams > most) {
        warnings.push(
          `${who}: "${raw}": 1 to ${most} beams (played as a plain Charged Attack)`
        )
        actions.push({ kind: 'charged', text: raw })
      } else actions.push({ kind: 'charged', beams, text: raw })
    } else if (m[14]) actions.push({ kind: 'plunge', text: raw })
    else if (m[15]) actions.push({ kind: 'dash', text: raw })
    else if (m[16]) actions.push({ kind: 'jump', text: raw })
  }
  return actions
}

export function parseRotation(
  text: string,
  members: readonly RotationMember[]
): ParsedRotation {
  const warnings: string[] = []
  const steps: RotationStep[] = []
  let loopsTo: CharacterKey | undefined
  const parts = text
    .split(/->|→|=>|>|,|;|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitOnNames(p, members))
  parts.forEach((part, index) => {
    // the name is the first word, or the longest start of the part that names a member
    const words = part.split(/\s+/)
    let characterKey: CharacterKey | undefined
    let rest = ''
    for (let n = Math.min(words.length, 3); n >= 1 && !characterKey; n--) {
      const candidate = words.slice(0, n).join(' ')
      characterKey = matchMember(candidate, members)
      if (characterKey) rest = words.slice(n).join(' ')
    }
    if (!characterKey) {
      // "Zibai" glued to actions is not supported: say which step was skipped
      warnings.push(`"${part}": no team member with that name (step skipped)`)
      return
    }
    const actions = parseActions(rest, warnings, words[0], characterKey)
    if (!actions.length) {
      if (index === parts.length - 1) {
        loopsTo = characterKey
        return
      }
      // a name alone mid-rotation: swap in and out (Danica's Entry Skill once Will to Cleanse is full)
      actions.push({ kind: 'swap', text: 'swap' })
    }
    steps.push({ characterKey, actions })
  })
  return { steps, loopsTo, warnings }
}

/** What a piece of rotation text is, as the writer colours it */
export type RotationSpanKind =
  /** `->`, `→`, `>`, `,`, `;` or a new line */
  | 'separator'
  /** A member's name (its `characterKey`) */
  | 'member'
  | 'action'
  /** W1.5, W90f */
  | 'wait'
  /** (a note in parentheses), or an alternative after "/" */
  | 'note'
  /** Skipped by the parser: not an action, or a step naming no member */
  | 'unknown'
export interface RotationSpan {
  from: number
  to: number
  kind: RotationSpanKind
  characterKey?: CharacterKey
}

/**
 * The rotation text in pieces, read as `parseRotation` reads it: separators, each step's member
 * name, its actions (an unknown one marked), waits and notes. The spaces between are left out.
 */
export function rotationSpans(
  text: string,
  members: readonly RotationMember[]
): RotationSpan[] {
  const spans: RotationSpan[] = []
  const part = (from: number, to: number) => {
    const words = [...text.slice(from, to).matchAll(/\S+/g)].map((m) => ({
      word: m[0],
      from: from + (m.index ?? 0),
      to: from + (m.index ?? 0) + m[0].length,
    }))
    let depth = 0
    let key: CharacterKey | undefined
    /** Whether the step being read named a member */
    let named = false
    /** Words left of the name just matched */
    let inName = 0
    /** A repeated group's words ("4[N5 CD]"): its last word and how it reads */
    let group: { last: number; kind: RotationSpanKind } | undefined
    const nameAt = (i: number, exact: boolean) => {
      for (let n = Math.min(3, words.length - i); n >= 1; n--) {
        const slice = words.slice(i, i + n)
        if (slice.some((w) => /[()]/.test(w.word))) continue
        const candidate = slice.map((w) => w.word).join(' ')
        const found = exact
          ? exactMember(candidate, members)
          : matchMember(candidate, members)
        if (found) return { n, found }
      }
      return undefined
    }
    words.forEach((w, i) => {
      const opens = w.word.match(/\(/g)?.length ?? 0
      const closes = w.word.match(/\)/g)?.length ?? 0
      if (depth === 0 && inName <= 0 && !/^\(/.test(w.word)) {
        // the part's first words name its member; a later exact name starts a new step
        const name = nameAt(i, i > 0)
        if (name) {
          key = name.found
          named = true
          inName = name.n
        } else if (i === 0) named = false
      }
      if (inName > 0) {
        spans.push({
          from: w.from,
          to: w.to,
          kind: 'member',
          characterKey: key,
        })
        inName--
      } else if (depth > 0 || opens) {
        spans.push({ from: w.from, to: w.to, kind: 'note' })
      } else if (!named) {
        spans.push({ from: w.from, to: w.to, kind: 'unknown' })
      } else if (group && i <= group.last) {
        // (a repeated group written with spaces, "4[N5 CD]": read as one)
        spans.push({ from: w.from, to: w.to, kind: group.kind })
      } else if (/^\d+\s*\[/.test(w.word) && !w.word.includes(']')) {
        const last = words.findIndex((x, j) => j > i && x.word.includes(']'))
        const joined = words
          .slice(i, last < 0 ? words.length : last + 1)
          .map((x) => x.word)
          .join(' ')
        const problems: string[] = []
        parseActions(joined, problems, '', key)
        group = {
          last: last < 0 ? words.length - 1 : last,
          kind: last < 0 || problems.length ? 'unknown' : 'action',
        }
        spans.push({ from: w.from, to: w.to, kind: group.kind })
      } else {
        // (an alternative: the first one is played, the rest is a note)
        const slash = w.word.indexOf('/')
        const played = slash > 0 ? w.word.slice(0, slash) : w.word
        const problems: string[] = []
        parseActions(played, problems, '', key)
        spans.push({
          from: w.from,
          to: w.from + played.length,
          kind: problems.length
            ? 'unknown'
            : /^w\s*[\d.]+f?$/i.test(played)
              ? 'wait'
              : 'action',
        })
        if (slash > 0)
          spans.push({ from: w.from + slash, to: w.to, kind: 'note' })
      }
      depth = Math.max(0, depth + opens - closes)
    })
  }
  let at = 0
  for (const m of text.matchAll(/->|→|=>|>|,|;|\n/g)) {
    const index = m.index ?? 0
    part(at, index)
    spans.push({ from: index, to: index + m[0].length, kind: 'separator' })
    at = index + m[0].length
  }
  part(at, text.length)
  return spans
}

/** At most this many written rotations are played as one (members bursting every 2nd and 3rd: 6) */
const MAX_LOOPS = 6
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/**
 * The rotation as played when some members use their Elemental Burst only every Nth rotation
 * (KQM's ER calculator, "Burst: Every 2nd"): `loops` written rotations in a row, each such member's
 * Burst kept in one of every N of them (a step left with nothing to do is left out, no swap to
 * it). `index` is each played action's position in the written rotation (for its timing edits).
 * Undefined when no member that bursts in the rotation bursts less than every rotation.
 */
export function everyNthBursts(
  rotation: ParsedRotation,
  burstEvery: Partial<Record<CharacterKey, number>>
): { rotation: ParsedRotation; loops: number; index: number[] } | undefined {
  const every = (ck: CharacterKey) => {
    const n = Math.round(burstEvery[ck] ?? 1)
    return n >= 2 ? n : 1
  }
  const ns = [
    ...new Set(
      rotation.steps
        .filter((s) => s.actions.some((a) => a.kind === 'burst'))
        .map((s) => every(s.characterKey))
        .filter((n) => n > 1)
    ),
  ]
  if (!ns.length) return undefined
  let loops = ns.reduce((l, n) => (l * n) / gcd(l, n), 1)
  if (loops > MAX_LOOPS) loops = Math.max(...ns)
  const steps: RotationStep[] = []
  const index: number[] = []
  for (let k = 0; k < loops; k++) {
    let i = 0
    for (const step of rotation.steps) {
      const actions: RotationAction[] = []
      for (const action of step.actions) {
        if (action.kind !== 'burst' || k % every(step.characterKey) === 0) {
          actions.push(action)
          index.push(i)
        }
        i++
      }
      if (actions.length) steps.push({ ...step, actions })
    }
  }
  return { rotation: { ...rotation, steps }, loops, index }
}
