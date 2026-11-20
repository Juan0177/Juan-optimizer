import type { CharacterKey } from '@genshin-optimizer/gi/consts'

/**
 * A rotation written the way players write them:
 *   "bina EQ -> illuga EQ -> linnea E -> Zibai E N1 E N4 E N4 Q E N2 E -> bina"
 * Steps are separated by `->` (also `→`, `>`, `,`, `;`, `，`, `；` or a new line); each starts with who acts
 * (a member's name, a nickname, or the start of either) and lists that member's actions, with or
 * without spaces between them:
 *   E / tE  Elemental Skill, tapped          hE   Elemental Skill, held
 *   Q       Elemental Burst                  N1–N6  a Normal Attack string of that many hits
 *   CA / C  Charged Attack                   P    Plunging Attack
 *   HP / LP  a high or low plunge (P: the kit's usual one); HP[collision] adds the hit on the way
 *                down (HP[collision=0.5]: on half of them, as gcsim's collision=rand()>0.5)
 *   CA[beams=2]  Sandrone's charge released after 2 condensed beams (3 by default; up to 6 from C1)
 *   CA[bullets=4]  Chasca's Shadowhunt fired after loading 4 bullets (6 by default)
 *   CA[weakspot]  an aimed shot that hits a weak point (Prototype Crescent's passive)
 *   CA[cancel]  Arlecchino's Charged Attack cancelled early: she absorbs the Blood-Debt Directive
 *                and the attack never hits (gcsim's charge[early_cancel=1], also accepted)
 *   C3 / C3F / CF  Mavuika's Flamestrider Charged Attack held for 3 spins (1 by default), then
 *                its finisher waited for (F): KQM's "C3FD C3FD CF"
 *   D       dash                             J    jump
 *   4[N5 CD] / 4N5CD  a group written once with how many times (1 to 20)
 *   W1.5    wait 1.5 s (W90f: 90 frames; Mualani in her blessing walks on Sharky meanwhile)
 *   WK / WK11f  walk (gcsim's walk: 1 frame by default; Tartaglia's next Skill is his walking one)
 *   E? / Q?  only when ready (left out, not waited for, when it is not: "Sucrose N1 E? D")
 *   D? / D?/CA  a dash only when the kit allows it (Wanderer: Descent up), else left out or the
 *                alternative
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
  /** Wait: a walk ("WK", gcsim's walk), not idle time */
  walk?: boolean
  /** Used only when ready ("E?", "Q?"): left out, not waited for, when it is not */
  optional?: boolean
  /** An optional action's alternative ("Q?/N3", "E?/N2 CA"): played instead when it is not ready */
  otherwise?: RotationAction[]
  /** Charged: Sandrone's condensed beams before she releases it ("CA[beams=2]") */
  beams?: number
  /** Charged: Chasca's Shadowhunt bullets loaded before she fires ("CA[bullets=4]") */
  bullets?: number
  /** Charged: Mavuika's Flamestrider spins held ("C3": 3) */
  spins?: number
  /** Charged: Mavuika's Flamestrider finisher, waited for ("C3F", "CF") */
  final?: boolean
  /** Charged: Arlecchino's cancelled before it hits ("CA[cancel]"): only its directive absorption */
  cancel?: boolean
  /** Charged: an aimed shot at a weak point ("CA[weakspot]", gcsim's aim[weakspot=1]) */
  weakspot?: boolean
  /** Plunge: high or low ("HP", "LP"; a plain "P" is the kit's usual one) */
  height?: 'high' | 'low'
  /** Plunge: its collision hit on the way down, the share of plunges that get one ("HP[collision]": 1) */
  collision?: number
  /** As written (for messages) */
  text: string
  /**
   * A Burst every Nth rotation, in a copy without it (KQM's ER calculator): played only when it is
   * the member's short Burst (Varesa's Volcanic Kablam, Flins' Thunderous Symphony)
   */
  onlyShort?: boolean
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
export function splitOnNames(
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
/** Members whose Charged Attack loads a number of bullets ("CA[bullets=4]"), and the most */
const CHARGE_BULLETS: Partial<Record<CharacterKey, number>> = { Chasca: 6 }
/** The Charged Attacks held for spins with a finisher (KQM's "C3F"), at most this many spins */
const CHARGE_SPINS: Partial<Record<CharacterKey, number>> = { Mavuika: 8 }
/** Members whose Charged Attack can be cancelled before it hits ("CA[cancel]") */
const CHARGE_CANCEL: Partial<Record<CharacterKey, true>> = { Arlecchino: true }

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
  // ("12[J HP[collision]]": a group's own brackets are matched, not the first "]")
  const bracketed = (s: string): string => {
    const open = /(^|\s)(\d+)\s*\[/g
    let out = ''
    let at = 0
    for (let m = open.exec(s); m; m = open.exec(s)) {
      let depth = 1
      let end = open.lastIndex
      for (; end < s.length && depth; end++)
        if (s[end] === '[') depth++
        else if (s[end] === ']') depth--
      if (depth) break
      const group = s.slice(open.lastIndex, end - 1)
      const whole = s.slice(m.index, end)
      out +=
        s.slice(at, m.index) +
        (/^\s*(?:beams\s*=|bullets\s*=|cancel\s*$|early_cancel\s*=|collision\b|weakspot\b)/i.test(
          group
        )
          ? whole
          : repeat(whole, m[1], m[2], bracketed(group)))
      at = end
      open.lastIndex = end
    }
    return out + s.slice(at)
  }
  return bracketed(text).replace(/(^|\s)(\d+)([a-z]\S*)/gi, repeat)
}

/** A Skill or Burst with an alternative after "/" ("Q?/N3", "Q/N3", "hE/N2CA"): the alternative is played when it is not ready */
const SKILL_BURST_ALT = /^(?:(?:[ht]?e|q)\??|d\?)\/./i

/** One step's actions: "EQ", "E N1 E N4", "tE CA", "N1E", "W1.5" (seconds), "W90f" (frames) */
function parseActions(
  text: string,
  warnings: string[],
  who: string,
  characterKey?: CharacterKey
): RotationAction[] {
  const actions: RotationAction[] = []
  // alternatives: the first one, unless it is a Skill's or Burst's ("Q?/N3" or "Q/N3": N3 when Q
  // is not ready)
  const cleaned = text
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .map((word) => (SKILL_BURST_ALT.test(word) ? word : word.split('/')[0]))
    .join(' ')
  const token =
    /\s*(?:(w)\s*((?:k\s*)?[\d.]+f?|k)|(h|t)?(e)(\?)?|(q)(\?)?|(n)\s*([1-6])|(ca|c)(\d+)?(f)?(?:\[\s*(?:((?:beams|bullets)\s*=\s*\d+)|(cancel|early_cancel\s*=\s*1)|(weakspot(?:\s*=\s*1)?))\s*\])?|([hl])?(p)(\[\s*collision(?:\s*=\s*([\d.]+))?\s*\])?|(d)(\?)?|(j))/iy
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
    /** What follows "/" up to the next space, as actions (undefined: none) */
    const takeAlternative = () => {
      const end = s.indexOf(' ', i)
      const alt = s.slice(i + 1, end < 0 ? s.length : end)
      i = end < 0 ? s.length : end
      const otherwise = parseActions(alt, warnings, who, characterKey)
      if (otherwise.length) return otherwise
      warnings.push(`${who}: "${raw}/${alt}": no action after "/" (skipped)`)
      return undefined
    }
    if (m[1]) {
      // seconds, or frames with an "f" (W1.5 = W90f); a walk ("WK") is 1 frame unless given
      const walk = /^k/i.test(m[2])
      const length = m[2].replace(/^k\s*/i, '')
      const count =
        walk && !length
          ? 1 / 60
          : /f$/i.test(length)
            ? Number(length.slice(0, -1)) / 60
            : Number(length)
      // ("W." or "W1..5" while typing: no length, not a wait; it never reaches the simulation)
      if (Number.isFinite(count) && count >= 0)
        actions.push({
          kind: 'wait',
          count,
          ...(walk && { walk: true }),
          text: raw,
        })
      else
        warnings.push(
          `${who}: "${raw}" is not a wait: write its length, as W1.5 or W90f (skipped)`
        )
    } else if (m[4] || m[6]) {
      // its alternative: what follows "/" up to the next space ("Q?/N3", "E?/N2CA"; without the "?"
      // too, "Q/N3": an alternative makes it optional)
      const hasAlt = s[i] === '/'
      const optional = !!(m[4] ? m[5] : m[7]) || hasAlt
      const otherwise = hasAlt ? takeAlternative() : undefined
      actions.push({
        ...(m[4]
          ? { kind: 'skill' as const, hold: m[3]?.toLowerCase() === 'h' }
          : { kind: 'burst' as const }),
        text: otherwise
          ? `${raw}/${otherwise.map((a) => a.text).join(' ')}`
          : raw,
        ...(optional && { optional: true }),
        ...(otherwise && { otherwise }),
      })
    } else if (m[8])
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
    } else if (m[10] && m[15])
      actions.push({ kind: 'charged', weakspot: true, text: raw })
    else if (m[10] && m[14]) {
      if (characterKey && CHARGE_CANCEL[characterKey])
        actions.push({ kind: 'charged', cancel: true, text: raw })
      else {
        warnings.push(
          `${who}: "${raw}": only Arlecchino's Charged Attack is cancelled early (played as a plain Charged Attack)`
        )
        actions.push({ kind: 'charged', text: raw })
      }
    } else if (m[10]) {
      const [, option, n] = /^(\w+)\s*=\s*(\d+)$/.exec(m[13] ?? '') ?? []
      const bullets = option?.toLowerCase() === 'bullets'
      const count = n !== undefined ? Number(n) : undefined
      const most =
        characterKey && (bullets ? CHARGE_BULLETS : CHARGE_BEAMS)[characterKey]
      const what = bullets ? 'bullets' : 'beams'
      if (count === undefined) actions.push({ kind: 'charged', text: raw })
      else if (!most) {
        warnings.push(
          `${who}: "${raw}": only ${bullets ? "Chasca's" : "Sandrone's"} Charged Attack has ${what} (played as a plain Charged Attack)`
        )
        actions.push({ kind: 'charged', text: raw })
      } else if (count < 1 || count > most) {
        warnings.push(
          `${who}: "${raw}": 1 to ${most} ${what} (played as a plain Charged Attack)`
        )
        actions.push({ kind: 'charged', text: raw })
      } else
        actions.push({
          kind: 'charged',
          ...(bullets ? { bullets: count } : { beams: count }),
          text: raw,
        })
    } else if (m[17]) {
      const collision = m[18]
        ? Math.min(1, Math.max(0, m[19] !== undefined ? Number(m[19]) : 1))
        : undefined
      actions.push({
        kind: 'plunge',
        ...(m[16] && {
          height: m[16].toLowerCase() === 'h' ? 'high' : 'low',
        }),
        ...(collision ? { collision } : {}),
        text: raw,
      })
    } else if (m[20]) {
      // "D?": only when the kit allows it (Wanderer: Descent up), "D?/CA": else a Charged Attack
      const otherwise = m[21] && s[i] === '/' ? takeAlternative() : undefined
      actions.push({
        kind: 'dash',
        text: otherwise
          ? `${raw}/${otherwise.map((a) => a.text).join(' ')}`
          : raw,
        ...(m[21] && { optional: true }),
        ...(otherwise && { otherwise }),
      })
    } else if (m[22]) actions.push({ kind: 'jump', text: raw })
  }
  return actions
}

/** Between steps: `->`, `→`, `=>`, `>`, `,`, `;` (or their full-width forms) or a new line */
const SEPARATOR = /->|→|=>|>|,|;|，|；|\n/

export function parseRotation(
  text: string,
  members: readonly RotationMember[]
): ParsedRotation {
  const warnings: string[] = []
  const steps: RotationStep[] = []
  // steps naming no member: said once, with every name that was not found
  const unknown: string[] = []
  let loopsTo: CharacterKey | undefined
  const parts = text
    .split(SEPARATOR)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitOnNames(p, members))
  parts.forEach((part, index) => {
    // the name is the first word, or the longest start of the part that names a member
    const words = part.split(/\s+/)
    let characterKey: CharacterKey | undefined
    let name = ''
    let rest = ''
    for (let n = Math.min(words.length, 3); n >= 1 && !characterKey; n--) {
      const candidate = words.slice(0, n).join(' ')
      characterKey = matchMember(candidate, members)
      if (characterKey) {
        name = candidate
        rest = words.slice(n).join(' ')
      }
    }
    if (!characterKey) {
      unknown.push(words[0])
      return
    }
    const actions = parseActions(rest, warnings, name, characterKey)
    // (gcsim's charge[early_cancel=1]: only a dash or jump cancels it)
    actions.forEach((action, i) => {
      const next = actions[i + 1]?.kind
      if (!action.cancel || next === 'dash' || next === 'jump') return
      warnings.push(
        `${name}: "${action.text}": a dash or jump cancels it, as "CA[cancel] D" (played as a plain Charged Attack)`
      )
      delete action.cancel
    })
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
  if (unknown.length) {
    const names = [...new Set(unknown)].map((n) => `"${n}"`).join(', ')
    warnings.unshift(
      unknown.length === 1
        ? `${names}: no team member with that name (step skipped)`
        : `${names}: no team member with that name (${unknown.length} steps skipped)`
    )
  }
  return { steps, loopsTo, warnings }
}

/** What a piece of rotation text is, as the writer colours it */
export type RotationSpanKind =
  /** `SEPARATOR`: `->`, `→`, `>`, `,`, `;` (or full-width) or a new line */
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
        // (an alternative: the first one is played, the rest is a note; an optional action's
        // alternative, "Q?/N3", is played too)
        const optionalAlt = SKILL_BURST_ALT.test(w.word)
        const slash = optionalAlt ? -1 : w.word.indexOf('/')
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
  for (const m of text.matchAll(new RegExp(SEPARATOR.source, 'g'))) {
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
        // (a Burst out of its copy stays as "short only": the simulation knows which one is
        // Varesa's Kablam or Flins' Symphony, and leaves the full ones out)
        actions.push(
          action.kind !== 'burst' || k % every(step.characterKey) === 0
            ? action
            : { ...action, onlyShort: true }
        )
        index.push(i)
        i++
      }
      // (a step left with nothing but such Bursts is left out, its swap too)
      // (an alternative, "Q/N1", is played instead: the step stays)
      if (actions.some((a) => !a.onlyShort || a.otherwise?.length))
        steps.push({ ...step, actions })
      else index.splice(index.length - actions.length, actions.length)
    }
  }
  return { rotation: { ...rotation, steps }, loops, index }
}
