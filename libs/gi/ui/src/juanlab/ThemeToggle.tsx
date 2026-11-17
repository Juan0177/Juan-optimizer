// juanlab: scelta del tema in Impostazioni (Notte JuanLab, Genshin Optimizer classico, Stellar). Il tema si salva nel
// browser e la pagina si ricarica per applicarlo.
import type { ThemeChoice } from '@genshin-optimizer/gi/theme'
import {
  getThemeChoice,
  setThemeChoice,
  themeChoices,
} from '@genshin-optimizer/gi/theme'
import { ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'

export function ThemeToggle() {
  const { t } = useTranslation('juanlab')
  const current = getThemeChoice()
  return (
    <>
      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
        {t('theme.title')}
      </Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        value={current}
        onChange={(_e, next: ThemeChoice | null) =>
          next && next !== current && setThemeChoice(next)
        }
        aria-label={t('theme.title')}
      >
        {themeChoices.map((choice) => (
          <ToggleButton key={choice} value={choice}>
            {t(`theme.${choice}`)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </>
  )
}
