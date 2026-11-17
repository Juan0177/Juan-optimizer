export const TURN_SEPARATOR = '  >  '

/**
 * A rotation's turns over as many lines as the width needs, never cutting one: each line holds
 * whole turns, joined with ` > ` (a line that continues ends with the `>`). A turn wider than a
 * line stands alone on its own.
 */
export function wrapTurns(
  turns: string[],
  measure: (text: string) => number,
  maxWidth: number
): string[] {
  const lines: string[] = []
  let line = ''
  for (const turn of turns) {
    const next = line ? `${line}${TURN_SEPARATOR}${turn}` : turn
    // (room kept for the `>` that ends a line that continues)
    if (!line || measure(`${next}${TURN_SEPARATOR.trimEnd()}`) <= maxWidth) {
      line = next
    } else {
      lines.push(`${line}${TURN_SEPARATOR.trimEnd()}`)
      line = turn
    }
  }
  if (line) lines.push(line)
  return lines
}
