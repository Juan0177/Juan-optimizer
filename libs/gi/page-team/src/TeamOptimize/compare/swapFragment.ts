import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { RotationMember } from '@genshin-optimizer/gi/ui'
import {
  matchMember,
  parseRotation,
  splitOnNames,
} from '@genshin-optimizer/gi/ui'
import type { RotationTimingSettings } from '../RotationTiming'

export type SwapFragmentError =
  | 'notFound'
  | 'repeated'
  | 'emptyFragment'
  /** The leaving member acts in the opener too: its actions there are still to write */
  | 'emptyOpenerFragment'

export type SwapFragmentResult =
  | {
      ok: true
      text: string
      opener: string
      where: 'text' | 'opener'
      /** The step that was replaced, as written (trimmed) */
      replaced: string
      /** The step put in its place */
      inserted: string
      /** The replaced step's first action: its position among the actions of `where` */
      firstAction: number
      /** The replaced step's actions */
      replacedActions: number
      /** The actions put in its place, less the replaced ones */
      delta: number
      /**
       * The replaced step's turn: its index among the turns of `text` as the parser cuts it (the
       * KQM sheet's rotation); absent when it is in the opener
       */
      turn?: number
      /** The entering member's turn in the new `text` (its first, if the fragment has several) */
      insertedTurn?: number
      /**
       * The leaving member acts in the rotation and in the opener: the opener's step, replaced too
       * (with `openerFragment`), as written, and the step put in its place
       */
      openerReplaced?: string
      openerInserted?: string
    }
  | { ok: false; error: SwapFragmentError; count: number }

/** The separators the parser cuts a rotation at (parse.ts), kept so it can be rebuilt as written */
const SEPARATORS = /(->|→|=>|>|,|;|\n)/

/**
 * A rotation cut exactly as the parser cuts it: at its separators, then at each bare member name.
 * `parts` joins back to the input; `steps` are the indexes of the parts that are one parser step
 */
export function cut(
  s: string,
  names: RotationMember[]
): { parts: string[]; steps: number[] } {
  const parts: string[] = []
  const steps: number[] = []
  s.split(SEPARATORS).forEach((piece, k) => {
    if (k % 2 === 1 || !piece.trim()) return void parts.push(piece)
    // whitespace and words alternate; the parser's name-split groups consecutive words
    const tokens = piece.split(/(\s+)/)
    let t = 0
    for (const group of splitOnNames(piece.trim(), names)) {
      let n = group.split(/\s+/).length
      while (t < tokens.length && !tokens[t].trim()) parts.push(tokens[t++])
      let raw = ''
      while (n-- > 0) {
        raw += tokens[t++]
        if (n > 0) raw += tokens[t++]
      }
      steps.push(parts.length)
      parts.push(raw)
    }
    while (t < tokens.length) parts.push(tokens[t++])
  })
  return { parts, steps }
}

type Cut = ReturnType<typeof cut>

/** The steps in which `out` acts, and the trailing no-action step looping back to it, if any */
function find(c: Cut, out: CharacterKey, names: RotationMember[]) {
  const acts: number[] = []
  let loop: number | undefined
  c.steps.forEach((i, k) => {
    const p = parseRotation(c.parts[i], names)
    if (p.steps[0]?.characterKey === out) acts.push(i)
    else if (!p.steps.length && p.loopsTo === out && k === c.steps.length - 1)
      loop = i
  })
  return { acts, loop }
}

/** Where the leaving member acts: its steps in the rotation and in the opener */
export function leavingSteps(
  text: string,
  opener: string,
  names: RotationMember[],
  out: CharacterKey
) {
  return {
    inText: find(cut(text, names), out, names).acts.length,
    inOpener: find(cut(opener, names), out, names).acts.length,
  }
}

/**
 * Replaces the leaving member's step of a written rotation with the entering member's fragment,
 * leaving every other step, separator and space as written. A trailing "-> Leaving" (the loop back
 * to them) becomes "-> Entering". The leaving member may act once in the rotation and once in the
 * opener (the opener's first-rotation step: built-in templates have one for every member); the
 * opener's step is then replaced with `openerFragment`, its actions there.
 *
 * `same`: the leaving member re-entering. Its fragment is filled in from that step, so with the
 * fragment empty a missing or repeated step is said first (why nothing was filled in).
 */
export function swapFragment({
  text,
  opener,
  names,
  out,
  inName,
  fragment,
  openerFragment = '',
  same = false,
}: {
  text: string
  opener: string
  names: RotationMember[]
  out: CharacterKey
  inName: string
  fragment: string
  /** The entering member's actions in the opener, when the leaving member acts there too */
  openerFragment?: string
  same?: boolean
}): SwapFragmentResult {
  const frag = fragment.trim()
  if (!frag && !same) return { ok: false, error: 'emptyFragment', count: 0 }
  const t = cut(text, names)
  const o = cut(opener, names)
  const ft = find(t, out, names)
  const fo = find(o, out, names)
  const count = ft.acts.length + fo.acts.length
  // (once in the rotation, once in the opener at most)
  const repeated = ft.acts.length > 1 || fo.acts.length > 1
  if (!frag && count >= 1 && !repeated)
    return { ok: false, error: 'emptyFragment', count: 0 }
  if (count === 0) return { ok: false, error: 'notFound', count }
  if (repeated) return { ok: false, error: 'repeated', count }
  const both = ft.acts.length === 1 && fo.acts.length === 1
  const openerFrag = openerFragment.trim()
  if (both && !openerFrag)
    return { ok: false, error: 'emptyOpenerFragment', count: 0 }

  const name = inName.trim()
  const inserted = `${name} ${frag}`
  const where = ft.acts.length ? 'text' : 'opener'
  const target = where === 'text' ? t : o
  const i = (where === 'text' ? ft : fo).acts[0]
  const replaced = target.parts[i].trim()
  // (where its actions are: the actions before it, its own; the entering member's, named as the
  // leaving member was, for counting)
  const actions = (s: string, members = names) =>
    parseRotation(s, members).steps.reduce((n, st) => n + st.actions.length, 0)
  const firstAction = actions(target.parts.slice(0, i).join(''))
  const replacedActions = actions(target.parts[i])
  // (team B's names: the entering member's in place of the leaving member's)
  const namesB = names.map((m) => (m.characterKey === out ? { ...m, name } : m))
  const delta = actions(inserted, namesB) - replacedActions
  // (its turn: by position, however its member is written; on B's side, the turns before it cut
  // with B's names)
  const turns = (s: string, members: RotationMember[]) => {
    const c = cut(s, members)
    return c.steps.filter((k) => c.parts[k].trim()).length
  }
  const turn =
    where === 'text' ? turns(t.parts.slice(0, i).join(''), names) : undefined
  const insertedTurn =
    where === 'text' ? turns(t.parts.slice(0, i).join(''), namesB) : undefined
  target.parts[i] = inserted
  // (in the opener too: its own actions there)
  const openerReplaced = both ? o.parts[fo.acts[0]].trim() : undefined
  const openerInserted = both ? `${name} ${openerFrag}` : undefined
  if (both) o.parts[fo.acts[0]] = openerInserted!
  if (ft.loop !== undefined) t.parts[ft.loop] = name
  if (fo.loop !== undefined) o.parts[fo.loop] = name
  return {
    ok: true,
    text: t.parts.join(''),
    opener: o.parts.join(''),
    where,
    replaced,
    inserted,
    firstAction,
    replacedActions,
    delta,
    ...(turn !== undefined && { turn, insertedTurn }),
    ...(both && { openerReplaced, openerInserted }),
  }
}

/** A step's actions as written, without the member's name (the start that names it, as read) */
function stepActions(step: string, names: RotationMember[], out: CharacterKey) {
  const words = step.trim().split(/\s+/)
  for (let n = Math.min(words.length, 3); n >= 1; n--)
    if (matchMember(words.slice(0, n).join(' '), names) === out)
      return words.slice(n).join(' ')
  return undefined
}

/** The leaving member's steps, when the comparison takes them: once in the rotation and/or the opener */
function leavingStepsText(
  text: string,
  opener: string,
  names: RotationMember[],
  out: CharacterKey
) {
  const t = cut(text, names)
  const o = cut(opener, names)
  const ft = find(t, out, names)
  const fo = find(o, out, names)
  if (!ft.acts.length && !fo.acts.length) return undefined
  if (ft.acts.length > 1 || fo.acts.length > 1) return undefined
  return {
    text: ft.acts.length ? t.parts[ft.acts[0]] : undefined,
    opener: fo.acts.length ? o.parts[fo.acts[0]] : undefined,
  }
}

/**
 * The actions of the leaving member's step, as written, without its name: what it does in A's
 * rotation ("E E E"), or in its opener when it acts only there. Undefined when it acts in no step,
 * or in more than one of the rotation or of the opener (the comparison refuses those).
 */
export function memberActions(
  text: string,
  opener: string,
  names: RotationMember[],
  out: CharacterKey
): string | undefined {
  const steps = leavingStepsText(text, opener, names, out)
  const step = steps?.text ?? steps?.opener
  return step === undefined ? undefined : stepActions(step, names, out)
}

/**
 * The leaving member's actions in the opener, when it acts in the rotation too (its opener's step
 * is replaced as well): what it does in A's first rotation ("E")
 */
export function memberOpenerActions(
  text: string,
  opener: string,
  names: RotationMember[],
  out: CharacterKey
): string | undefined {
  const steps = leavingStepsText(text, opener, names, out)
  return steps?.text !== undefined && steps.opener !== undefined
    ? stepActions(steps.opener, names, out)
    : undefined
}

/**
 * The team's frame-timing edits for team B's rotation. They are kept by the action's position in
 * the written rotation (the opener has none): after the replaced step they move by the change in
 * actions, so each stays on its own action; the replaced step's own are dropped.
 */
export function timingForSwap(
  timing: RotationTimingSettings,
  swapped: Extract<SwapFragmentResult, { ok: true }>
): RotationTimingSettings {
  if (swapped.where !== 'text') return timing
  const { firstAction: first, replacedActions, delta } = swapped
  const edits: RotationTimingSettings['edits'] = {}
  for (const [k, edit] of Object.entries(timing.edits)) {
    const i = Number(k)
    if (i < first) edits[i] = edit
    else if (i >= first + replacedActions) edits[i + delta] = edit
  }
  return { ...timing, edits }
}
