import { useBoolState } from '@genshin-optimizer/common/react-util'
import { useTeam } from '@genshin-optimizer/gi/db-ui'
import type { FightTeam } from '@genshin-optimizer/gi/ui'
import { EnemyDefeatTime, EnemySummary } from '@genshin-optimizer/gi/ui'
import { Box, Button } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { EnemyDialog } from '../Enemy/EnemyDialog'
import { FieldLabel } from './ui'

/**
 * The enemy the damage is for (the team's, as set on its Team Settings tab): one line, and its
 * editor in a window (a Stygian Onslaught boss, or the level and RES by hand)
 */
export function EnemyRow({
  teamId,
  fight,
  disabled,
}: {
  teamId: string
  /** The team as the panel shows it (a Stygian boss: how long it takes to defeat it) */
  fight?: FightTeam
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const team = useTeam(teamId)
  const [open, onOpen, onClose] = useBoolState()
  if (!team) return null
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 1.5,
        rowGap: 0.5,
        fontSize: 13.5,
        color: 'text.secondary',
      }}
    >
      <FieldLabel
        tip={t(
          'teamOpt.enemy.tip',
          'Every hit’s damage is for this enemy: its level and RES (and DEF shred), the team’s, as set on its Team Settings tab. A Stygian Onslaught boss sets them at once.'
        )}
      >
        {t('teamOpt.enemy.label', 'Enemy')}
      </FieldLabel>
      <Box
        sx={{
          minWidth: 0,
          flex: '1 1 auto',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 1.5,
          rowGap: 0.25,
        }}
      >
        <EnemySummary enemy={team} />
        <EnemyDefeatTime enemy={team} team={fight} />
      </Box>
      <Button
        size="small"
        color="inherit"
        variant="outlined"
        onClick={onOpen}
        disabled={disabled}
        sx={{ flexShrink: 0 }}
      >
        {t('teamOpt.enemy.edit', 'Change')}
      </Button>
      <EnemyDialog teamId={teamId} open={open} onClose={onClose} />
    </Box>
  )
}
