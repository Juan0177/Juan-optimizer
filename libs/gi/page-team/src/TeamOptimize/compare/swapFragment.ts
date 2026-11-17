import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { RotationMember } from '@genshin-optimizer/gi/ui'
import { parseRotation, splitOnNames } from '@genshin-optimizer/gi/ui'

export type SwapFragmentError = 'notFound' | 'repeated' | 'emptyFragment'

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
    }
  | { ok: false; error: SwapFragmentError; count: number }

/** The separators the parser cuts a rotation at (parse.ts), kept so it can be rebuilt as written */
const SEPARATORS = /(->|→|=>|>|,|;|\n)/

/**
 * A rotation cut exactly as the parser cuts it: at its separators, then at each bare member name.
 * `parts` joins back to the input; `steps` are the indexes of the parts that are one parser step
 */
function cut(
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

/**
 * Replaces the leaving member's single step of a written rotation (the opener counts too) with the
 * entering member's fragment, leaving every other step, separator and space as written. A trailing
 * "-> Leaving" (the loop back to them) becomes "-> Entering".
 */
export function swapFragment({
  text,
  opener,
  names,
  out,
  inName,
  fragment,
}: {
  text: string
  opener: string
  names: RotationMember[]
  out: CharacterKey
  inName: string
  fragment: string
}): SwapFragmentResult {
  const frag = fragment.trim()
  if (!frag) return { ok: false, error: 'emptyFragment', count: 0 }
  const t = cut(text, names)
  const o = cut(opener, names)
  const ft = find(t, out, names)
  const fo = find(o, out, names)
  const count = ft.acts.length + fo.acts.length
  if (count === 0) return { ok: false, error: 'notFound', count }
  if (count > 1) return { ok: false, error: 'repeated', count }

  const name = inName.trim()
  const inserted = `${name} ${frag}`
  const where = ft.acts.length ? 'text' : 'opener'
  const target = where === 'text' ? t : o
  const i = (where === 'text' ? ft : fo).acts[0]
  const replaced = target.parts[i].trim()
  target.parts[i] = inserted
  if (ft.loop !== undefined) t.parts[ft.loop] = name
  if (fo.loop !== undefined) o.parts[fo.loop] = name
  return {
    ok: true,
    text: t.parts.join(''),
    opener: o.parts.join(''),
    where,
    replaced,
    inserted,
  }
}
