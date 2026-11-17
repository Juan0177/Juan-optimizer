import type { ElementKey } from '@genshin-optimizer/gi/consts'
import { ElementIcon } from '@genshin-optimizer/gi/svgicons'
import { giTokens } from '@genshin-optimizer/gi/theme'
import { Box } from '@mui/material'
import { Fragment, type ReactNode } from 'react'

/** The game's sprite presets for elements (its ElementType: 1 Fire … 8 Rock) */
const SPRITE_ELEMENTS: Record<string, ElementKey> = {
  '11001': 'pyro',
  '11002': 'hydro',
  '11003': 'dendro',
  '11004': 'electro',
  '11005': 'cryo',
  '11007': 'anemo',
  '11008': 'geo',
}

/** One line of the game's text: its element icons, and its highlights in gold */
function line(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = []
  // <color=#FFD780FF>…</color> (highlights) and {SPRITE_PRESET#11004} (an element's icon)
  const re =
    /<color=#[0-9a-fA-F]{6,8}>([\s\S]*?)<\/color>|\{SPRITE_PRESET#(\d+)\}/gi
  let last = 0
  let i = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push(text.slice(last, m.index))
    if (m[1] !== undefined)
      out.push(
        <Box
          component="span"
          key={`${key}.${i++}`}
          sx={{ color: giTokens.gold, fontWeight: 600 }}
        >
          {m[1]}
        </Box>
      )
    else {
      const element = SPRITE_ELEMENTS[m[2]]
      if (element)
        out.push(
          <Box
            component="span"
            key={`${key}.${i++}`}
            sx={{ display: 'inline-flex', verticalAlign: '-0.2em' }}
          >
            <ElementIcon
              ele={element}
              iconProps={{ sx: { fontSize: '1.15em' } }}
            />
          </Box>
        )
    }
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** The game's own text (a boss's mechanics, its lore), as the game shows it */
export function GameText({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((l, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a text's lines, in order, never reordered
        <Fragment key={i}>
          {line(l, String(i))}
          {i < lines.length - 1 && <br />}
        </Fragment>
      ))}
    </>
  )
}
