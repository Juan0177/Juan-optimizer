import { ColorText } from '@genshin-optimizer/common/ui'
import { allElementWithPhyKeys } from '@genshin-optimizer/gi/consts'
import { elementalData } from '@genshin-optimizer/gi/keymap'
import { Box } from '@mui/material'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { BuffEffect } from './buffs'
import { numSx } from './ui'

/**
 * Where a buff comes from, short: a character's talent ("Elemental Skill", "Elemental Burst",
 * "A1", "A4", "C2"), else its weapon, artifact set or the team's effect (a resonance, the
 * Polestar Field). Its condition ("After hitting an opponent with…") is for its tooltip.
 */
export function talentLabel(
  t: TFunction<'page_team'>,
  talent: string | undefined
): string | undefined {
  if (!talent) return undefined
  const cons = /^constellation(\d)$/.exec(talent)
  if (cons) return `C${cons[1]}`
  switch (talent) {
    case 'skill':
      return t('teamOpt.buff.skill', 'Elemental Skill')
    case 'burst':
      return t('teamOpt.buff.burst', 'Elemental Burst')
    case 'auto':
      return t('teamOpt.buff.auto', 'Normal Attack')
    case 'sprint':
      return t('teamOpt.buff.sprint', 'Sprint')
    case 'passive1':
      return 'A1'
    case 'passive2':
      return 'A4'
    case 'moonsign':
      return t('teamOpt.buff.moonsign', 'Moonsign')
    default:
      return t('teamOpt.buff.passive', 'Passive')
  }
}

/** A buff's short name: its talent, else its item or the team effect it is (see `talentLabel`) */
export function useBuffSource() {
  const { t } = useTranslation('page_team')
  return (buff: {
    talent?: string
    title?: ReactNode
    label?: ReactNode
    name?: ReactNode
  }): ReactNode =>
    talentLabel(t, buff.talent) ?? buff.title ?? buff.label ?? buff.name
}

const ELEMENTS: readonly string[] = allElementWithPhyKeys
/**
 * A stat's short name in English ("Electro RES" for "Enemy Electro DMG RES", "Electro DMG" for
 * "Electro DMG Bonus"); other languages keep the sheet's own
 */
function shortStatName(
  stat: string | undefined,
  language: string
): string | undefined {
  if (!stat || !language.startsWith('en')) return undefined
  const [element, kind] = stat.split('_')
  if (!ELEMENTS.includes(element)) return undefined
  const name = elementalData[element as keyof typeof elementalData]?.name
  if (!name) return undefined
  if (stat === `${element}_enemyRes_`) return `${name} RES`
  if (stat === `${element}_dmg_` && kind === 'dmg') return `${name} DMG`
  return undefined
}

/** "+400", "−30%": a value with its sign (as the sheet gives it, unsigned when positive) */
function signedValue(value: ReactNode): ReactNode {
  if (typeof value !== 'string') return value
  if (/^[-−]/.test(value)) return `−${value.slice(1)}`
  if (/^[+\d]/.test(value) && !value.includes('×'))
    return value.startsWith('+') ? value : `+${value}`
  return value
}

/** What a buff gives, value first: "+400 ATK", "−30% Electro RES" (else a line of what it does) */
export function EffectText({
  effect,
  dim = false,
}: {
  effect: BuffEffect
  dim?: boolean
}) {
  const { i18n } = useTranslation()
  if (effect.value === undefined)
    return (
      <Box
        component="span"
        sx={{ color: 'text.secondary', opacity: dim ? 0.55 : 1 }}
      >
        {effect.name}
      </Box>
    )
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 0.5,
        minWidth: 0,
        maxWidth: '100%',
        whiteSpace: 'nowrap',
        opacity: dim ? 0.55 : 1,
      }}
    >
      <Box
        component="span"
        sx={{ flexShrink: 0, fontWeight: 650, color: 'text.primary', ...numSx }}
      >
        {signedValue(effect.value)}
      </Box>
      <Box
        component="span"
        sx={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          color: 'text.secondary',
        }}
      >
        <ColorText color={effect.variant}>
          {shortStatName(effect.stat, i18n.language ?? 'en') ?? effect.name}
        </ColorText>
      </Box>
    </Box>
  )
}
