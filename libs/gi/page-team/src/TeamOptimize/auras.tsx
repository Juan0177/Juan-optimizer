import { alpha, Box } from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { useTranslation } from 'react-i18next'
import type { AuraKey } from './timelineModel'

const AURA_ELEMENT: Record<AuraKey, string> = {
  pyro: 'pyro',
  hydro: 'hydro',
  electro: 'electro',
  cryo: 'cryo',
  dendro: 'dendro',
  quicken: 'dendro',
  frozen: 'cryo',
  burning: 'pyro',
}
export const AURA_NAME: Record<AuraKey, string> = {
  pyro: 'Pyro',
  hydro: 'Hydro',
  electro: 'Electro',
  cryo: 'Cryo',
  dendro: 'Dendro',
  quicken: 'Quicken',
  frozen: 'Frozen',
  burning: 'Burning',
}
export const auraColor = (theme: Theme, aura: AuraKey) => {
  const palette = theme.palette as unknown as Record<string, { main: string }>
  return (palette[aura] ?? palette[AURA_ELEMENT[aura]])?.main ?? '#999'
}

/** The enemy's auras at a moment, a chip each in its element's colour */
export function AuraChips({ auras }: { auras: AuraKey[] }) {
  const { t } = useTranslation('page_team')
  return (
    <>
      {auras.map((aura) => (
        <Box
          key={aura}
          component="span"
          sx={(theme) => ({
            px: 0.75,
            borderRadius: 999,
            fontSize: 11.5,
            fontWeight: 650,
            lineHeight: '18px',
            whiteSpace: 'nowrap',
            color: auraColor(theme, aura),
            bgcolor: alpha(auraColor(theme, aura), 0.14),
            boxShadow: `inset 0 0 0 1px ${alpha(auraColor(theme, aura), 0.4)}`,
          })}
        >
          {t(`teamOpt.timeline.aura.${aura}`, AURA_NAME[aura])}
        </Box>
      ))}
    </>
  )
}
