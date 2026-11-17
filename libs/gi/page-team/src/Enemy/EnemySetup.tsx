import { useBoolState } from '@genshin-optimizer/common/react-util'
import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import { useDatabase, useTeam } from '@genshin-optimizer/gi/db-ui'
import type { FightTeam } from '@genshin-optimizer/gi/ui'
import {
  appliedStygianPreset,
  currentStygianSeason,
  StygianDefeatTime,
  stygianBosses,
  stygianDifficulties,
  stygianEnemy,
  stygianPresetKey,
} from '@genshin-optimizer/gi/ui'
import { Box, Button, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { hairline, insetSx, Segmented, type } from '../TeamOptimize/ui'
import { EnemyDialog } from './EnemyDialog'
import { BossCard, EnemyHeadline, levelOf } from './EnemyPanel'

/**
 * The enemy as a part of a setup (KQM theorycrafting's): what the builds are made against, how
 * long they take to defeat a Stygian boss, and its editor
 */
export function EnemySetup({
  teamId,
  fight,
  disabled,
}: {
  teamId: string
  /** The builds in the fight (their DPS, applications): how long they take */
  fight?: FightTeam
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const team = useTeam(teamId)
  const [open, onOpen, onClose] = useBoolState()
  if (!team) return null
  const stygian = appliedStygianPreset(team)
  const season = currentStygianSeason()
  return (
    <Box sx={{ ...insetSx, overflow: 'hidden', minWidth: 0, height: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 1.5,
          pr: 1,
          py: 0.75,
          minHeight: 48,
          borderBottom: hairline,
        }}
      >
        <Typography
          component="h3"
          sx={{
            ...type.title,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            flexGrow: 1,
          }}
        >
          {t('enemy.title', 'Enemy')}
          <InfoTooltipInline
            title={t(
              'enemy.setupTip',
              'The builds are made for this enemy: its level and RES (a Stygian Onslaught boss sets them at once). It is the team’s, shared with Team optimize and the members’ own pages.'
            )}
          />
        </Typography>
        <Button
          size="small"
          color="inherit"
          variant="outlined"
          onClick={onOpen}
          disabled={disabled}
        >
          {stygian
            ? t('enemy.change', 'Change')
            : t('enemy.pickBoss', 'Pick a boss')}
        </Button>
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, px: 1.5, py: 1.5 }}>
        <EnemyHeadline team={team} large />
        {stygian ? (
          <>
            {/* its difficulty, at once */}
            <Segmented
              size="small"
              value={stygian.difficulty}
              onChange={(key) =>
                database.teams.set(teamId, (team) => {
                  team.enemyOverride.enemyLevel = levelOf(key)
                })
              }
              aria-label={t('enemy.difficulty', 'Difficulty')}
              options={stygianDifficulties.map((d) => ({
                value: d.key,
                label:
                  d.key === 'fearless'
                    ? t('enemy.fearless', {
                        defaultValue: 'Fearless · Lv. {{level}}',
                        level: d.level,
                      })
                    : t('enemy.dire', {
                        defaultValue: 'Dire · Lv. {{level}}',
                        level: d.level,
                      }),
              }))}
            />
            {/* (its HP is in the line above: the time it takes, once there are builds) */}
            {fight ? (
              <Typography component="div" sx={{ fontSize: 13.5 }}>
                <StygianDefeatTime enemy={team} team={fight} hideHp />
              </Typography>
            ) : (
              <Typography sx={{ ...type.label, fontWeight: 400 }}>
                {t(
                  'enemy.defeatAfterRun',
                  'How long the builds take to defeat it shows once they are generated for it.'
                )}
              </Typography>
            )}
          </>
        ) : (
          season && (
            /* this season's bosses: one click away */
            <Box sx={{ display: 'grid', gap: 0.75 }}>
              <Typography sx={type.label}>
                {t('enemy.thisSeason', {
                  defaultValue: 'This season · {{season}}',
                  season: t(`stygian:season.${season.id}`, ''),
                })}
              </Typography>
              {stygianBosses
                .filter((b) => season.bosses.includes(b.id))
                .map((b) => (
                  <BossCard
                    key={b.id}
                    boss={b}
                    selected={false}
                    difficulty="dire"
                    onClick={() =>
                      database.teams.set(teamId, (team) => {
                        Object.assign(
                          team.enemyOverride,
                          stygianEnemy(b.id, b.main, levelOf('dire'))
                        )
                        team.enemyPreset = stygianPresetKey(b.id, b.main)
                      })
                    }
                  />
                ))}
            </Box>
          )
        )}
      </Box>
      <EnemyDialog teamId={teamId} open={open} onClose={onClose} />
    </Box>
  )
}
