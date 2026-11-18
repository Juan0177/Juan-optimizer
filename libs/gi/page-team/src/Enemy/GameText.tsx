import type { ElementKey } from '@genshin-optimizer/gi/consts'
import { ElementIcon } from '@genshin-optimizer/gi/svgicons'
import { giTokens } from '@genshin-optimizer/gi/theme'
import { Box } from '@mui/material'
import { Fragment, type ReactNode } from 'react'

/**
 * The game's sprite presets for elements, and for reactions (two elements' icons): its
 * SpriteTagExcelConfigData's sprites (UI_Buff_Element02_Frost, …_Roach: Rock; the Stygian
 * Onslaught icons UI_LeyLineChallenge_Icon_ElectIce, …)
 */
const SPRITE_ELEMENTS: Record<string, ElementKey[]> = {
  '11001': ['cryo'],
  '11002': ['hydro'],
  '11003': ['pyro'],
  '11004': ['electro'],
  '11005': ['anemo'],
  '11006': ['geo'],
  '11007': ['dendro'],
  '11021': ['electro', 'dendro'],
  '11022': ['electro', 'cryo'],
  '11023': ['electro', 'geo'],
  '11024': ['electro', 'anemo'],
  '11025': ['pyro', 'electro'],
  '11026': ['pyro', 'dendro'],
  '11027': ['pyro', 'cryo'],
  '11028': ['pyro', 'anemo'],
  '11029': ['dendro', 'hydro'],
  '11030': ['cryo', 'geo'],
  '11031': ['cryo', 'hydro'],
  '11032': ['cryo', 'anemo'],
  '11033': ['geo', 'pyro'],
  '11034': ['hydro', 'electro'],
  '11035': ['hydro', 'pyro'],
  '11036': ['hydro', 'geo'],
  '11037': ['anemo', 'hydro'],
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
      const elements = SPRITE_ELEMENTS[m[2]]
      if (elements)
        out.push(
          <Box
            component="span"
            key={`${key}.${i++}`}
            sx={{ display: 'inline-flex', verticalAlign: '-0.2em' }}
          >
            {elements.map((element) => (
              <ElementIcon
                key={element}
                ele={element}
                iconProps={{ sx: { fontSize: '1.15em' } }}
              />
            ))}
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
