import { iconInlineProps } from '@genshin-optimizer/common/svgicons'
import { ColorText } from '@genshin-optimizer/common/ui'
import type { ElementWithPhyKey } from '@genshin-optimizer/gi/consts'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import { ElementIcon } from '@genshin-optimizer/gi/svgicons'
import { Box } from '@mui/material'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { StygianPhaseKey, StygianRes } from './stygianBosses'

/** A boss's name, as the game names its Fearless/Dire stage */
export const stygianBossName = (t: TFunction, id: number) =>
  t(`stygian:boss.${id}`, { defaultValue: `${id}` })

/**
 * The stage's name, as the boss's own and the stage's ("Wavebinder" and "Stormfang"): split at its
 * last separator (": ", " — ", " - "; "Name（Stage）" in Japanese); none: the whole of it
 */
export function stygianBossTitle(t: TFunction, id: number) {
  const title = stygianBossName(t, id)
  const paren = title.match(/^(.*?)[（(]([^（(]+)[）)]$/)
  if (paren) return { name: paren[1].trim(), stage: paren[2].trim() }
  let at = -1
  let length = 0
  for (const sep of [' — ', ' – ', ' - ', ': ', '：', ' · ']) {
    const i = title.lastIndexOf(sep)
    if (i > at) {
      at = i
      length = sep.length
    }
  }
  return at > 0
    ? {
        name: title.slice(0, at).trim(),
        stage: title.slice(at + length).trim(),
      }
    : { name: title, stage: '' }
}

/** A phase's name */
export function stygianPhaseName(t: TFunction, key: StygianPhaseKey) {
  const names: Record<StygianPhaseKey, string> = {
    regular: 'Regular',
    shielded: 'Shielded',
    stunned: 'Stunned',
    weakened: 'Weakened',
    recovered: 'Recovered',
    enhanced: 'Enhanced',
    rage: 'Rage',
    geohuman: 'Geohuman form',
    molten: 'Molten Dragon',
    lowEnergy: 'Low Energy',
    nightsoul: 'Nightsoul state',
    hat: 'Hat on',
    ducks: 'Ducks out',
    dullCarapace: 'Dull Carapace',
    opening: 'Start of the fight',
    recording: 'Recording',
    initial: 'No stacks',
    stacks2: '2 stacks',
    stacks3: '3 stacks',
  }
  return t(`page_team:enemyEditor.stygian.phase.${key}`, names[key])
}

/** What sets a phase apart: its RES other than 10% (all 10%: "All 10%") */
export function StygianResSummary({ res }: { res: StygianRes }) {
  const { t } = useTranslation('page_team')
  // (the value most elements have: "All 70%" first, then the exceptions)
  const counts = new Map<number | 'immune', number>()
  for (const e of allElementWithPhyKeys)
    counts.set(res[e], (counts.get(res[e]) ?? 0) + 1)
  const common = [...counts].sort((a, b) => b[1] - a[1])[0][0]
  const others = allElementWithPhyKeys.filter((e) => res[e] !== common)
  const value = (v: number | 'immune') =>
    v === 'immune'
      ? t('enemyEditor.stygian.immune', 'immune')
      : `${v < 0 ? '−' : ''}${Math.abs(v)}%`
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 1,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {common !== 10 || !others.length ? (
        <span>
          {t('enemyEditor.stygian.all', {
            defaultValue: 'All {{value}}',
            value: value(common),
          })}
        </span>
      ) : null}
      {others.map((e: ElementWithPhyKey) => (
        <ColorText key={e} color={e}>
          <ElementIcon ele={e} iconProps={iconInlineProps} /> {value(res[e])}
        </ColorText>
      ))}
    </Box>
  )
}
