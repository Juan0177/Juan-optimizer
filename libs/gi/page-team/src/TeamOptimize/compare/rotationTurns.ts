import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { RotationMember } from '@genshin-optimizer/gi/ui'
import { parseRotation, splitOnNames } from '@genshin-optimizer/gi/ui'

/*
 * juanlab: a rotation's turns as the KQM sheet shows them (cut where the parser cuts it), and
 * where a member's first turn is: the comparison card marks the members that changed
 */

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

/** The steps in which `member` acts, and the trailing no-action step looping back to it, if any */
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
 * `member`'s first turn in `text`: its index among the turns the parser cuts it into (the KQM
 * sheet's rotation); undefined when it does not act there
 */
export function memberTurn(
  text: string,
  names: RotationMember[],
  member: CharacterKey
): number | undefined {
  const c = cut(text, names)
  const [i] = find(c, member, names).acts
  if (i === undefined) return undefined
  return c.steps.filter((k) => k < i && c.parts[k].trim()).length
}
