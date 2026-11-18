import { useTeam } from '@genshin-optimizer/gi/db-ui'
import { giTokens } from '@genshin-optimizer/gi/theme'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import { Box, ButtonBase, Collapse, Typography } from '@mui/material'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { focusSx, hairline, quickSx, tokens, type } from '../TeamOptimize/ui'
import { EnemyHeadline, EnemyPanel } from './EnemyPanel'

/**
 * The team's enemy on its settings page: in one line (the boss, or a custom enemy, its level and
 * RES), opening on its editor
 */
export function EnemyCard({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const team = useTeam(teamId)
  const [open, setOpen] = useState(false)
  const panelId = useId()
  if (!team) return null
  const { enemyDefRed_ = 0, enemyDefIgn_ = 0 } = team.enemyOverride
  return (
    <Box
      component="section"
      sx={{
        borderRadius: tokens.radius.panel,
        bgcolor: giTokens.panel,
        border: hairline,
        overflow: 'hidden',
      }}
    >
      <ButtonBase
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 1.5,
          px: { xs: 1.5, sm: 2 },
          py: 1.25,
          textAlign: 'left',
          ...quickSx,
          ...focusSx,
          '&:hover': { bgcolor: giTokens.panelHover },
        }}
      >
        <Typography
          component="h2"
          sx={{ ...type.title, flexShrink: 0, color: 'text.secondary' }}
        >
          {t('enemy.title', 'Enemy')}
        </Typography>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <EnemyHeadline team={team} />
        </Box>
        {(enemyDefRed_ > 0 || enemyDefIgn_ > 0) && (
          <Typography
            sx={{ ...type.label, display: { xs: 'none', sm: 'block' } }}
          >
            {[
              enemyDefRed_ > 0 &&
                t('enemy.defRedShort', {
                  defaultValue: 'DEF −{{value}}%',
                  value: enemyDefRed_,
                }),
              enemyDefIgn_ > 0 &&
                t('enemy.defIgnShort', {
                  defaultValue: '{{value}}% DEF ignored',
                  value: enemyDefIgn_,
                }),
            ]
              .filter(Boolean)
              .join(' · ')}
          </Typography>
        )}
        <KeyboardArrowDownRoundedIcon
          sx={{
            color: 'text.secondary',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform .18s',
          }}
        />
      </ButtonBase>
      <Collapse in={open} timeout={200} unmountOnExit>
        <Box
          id={panelId}
          sx={{ px: { xs: 1.5, sm: 2 }, pb: 2, pt: 1.5, borderTop: hairline }}
        >
          <EnemyPanel teamId={teamId} />
        </Box>
      </Collapse>
    </Box>
  )
}
