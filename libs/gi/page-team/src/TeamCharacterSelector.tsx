import { useBoolState } from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  ModalWrapper,
  TextFieldLazy,
  useOptimisticValue,
} from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import {
  CharAvatarSide,
  CharacterName,
  TeamIcon,
} from '@genshin-optimizer/gi/ui'
import BorderColorIcon from '@mui/icons-material/BorderColor'
import CloseIcon from '@mui/icons-material/Close'
import GroupsIcon from '@mui/icons-material/Groups'
import PersonIcon from '@mui/icons-material/Person'
import type { Theme } from '@mui/material'
import {
  alpha,
  Box,
  CardContent,
  CardHeader,
  CircularProgress,
  Divider,
  IconButton,
  Link,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { visuallyHidden } from '@mui/utils'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { kqmTheorycraftingEnabled } from './featureFlags'
import { TeamActions } from './TeamActions'
import { TeamOptimizeIcon, TheorycraftIcon } from './TeamOptimize/icons'
import { BetaBadge } from './TeamOptimize/ui'
import { useKqmProgress, useKqmRunning } from './TeamOptimize/useKqmRun'
export default function TeamCharacterSelector({
  teamId,
  characterKey,
  tab = '',
  teamBuildMode,
  actions,
}: {
  teamId: string
  characterKey?: CharacterKey
  tab?: string
  /** The open team build workflow. */
  teamBuildMode?: 'inventory' | 'kqm' | 'kqm-compare'
  /** more header actions, before the team's (e.g. the open member's build card) */
  actions?: ReactNode
}) {
  const { t } = useTranslation(['page_team', 'ui', 'juanlab'])
  const compact = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'))
  const navigate = useNavigate()
  const database = useDatabase()

  const { gender } = useDBMeta()
  const team = useTeam(teamId)!
  const { loadoutData } = team
  const [showEditor, onShowEditor, onHideEditor] = useBoolState()
  const [selected, select] = useOptimisticValue<string | number>(
    teamBuildMode === 'kqm'
      ? 'kqm'
      : teamBuildMode === 'kqm-compare'
        ? 'kqm-compare'
        : teamBuildMode === 'inventory'
          ? 'teamOpt'
          : (characterKey ?? 'team')
  )

  return (
    // the page header of a team: the same type and spacing as PageHeader on the other pages
    <Box
      component="header"
      sx={{ px: 0.5, pt: { xs: 1.5, md: 3 }, pb: { xs: 1.5, md: 2 } }}
    >
      <TeamEditorModal
        teamId={teamId}
        show={showEditor}
        onClose={onHideEditor}
      />
      {/* back to the team list */}
      <Link
        component={RouterLink}
        to="/teams"
        underline="hover"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          mb: 0.5,
          color: 'text.secondary',
          fontSize: '0.8125rem',
          fontWeight: 600,
          '&:hover': { color: 'text.primary' },
        }}
      >
        <TeamIcon sx={{ fontSize: 16 }} />
        {t('ui:tabs.teams')}
      </Link>
      {/* title row: the team's name is the page title, renamed in place */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          minWidth: 0,
          mb: 2,
        }}
      >
        <Typography
          variant="h4"
          component="h1"
          noWrap
          sx={{
            fontSize: { xs: '1.5rem', md: '1.875rem' },
            lineHeight: 1.2,
            minWidth: 0,
          }}
        >
          {team.name}
        </Typography>
        <Tooltip title={t('team.editNameDesc')}>
          <IconButton
            size="small"
            onClick={onShowEditor}
            aria-label={t('team.editNameDesc')}
            sx={{ color: 'text.secondary' }}
          >
            <BorderColorIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        {!!team.description && (
          <Typography
            color="text.secondary"
            noWrap
            sx={{ ml: 1, minWidth: 0, display: { xs: 'none', md: 'block' } }}
          >
            {team.description}
          </Typography>
        )}
        <Box sx={{ flexGrow: 1 }} />
        {actions}
        <TeamActions teamId={teamId} />
      </Box>
      {/* juanlab: schede squadrate come in Genshin Optimizer, ognuna col colore dell'elemento del personaggio */}
      <Tabs
        value={selected}
        // the clicked pill turns gold at once; the member renders in the navigation's transition
        onChange={(_e, clicked: string | number) => select(clicked)}
        // (phones: every tab in view, in two rows, never scrolled off: the members as their
        // avatars, then Team optimize and KQM)
        variant={compact ? 'standard' : 'scrollable'}
        scrollButtons="auto"
        TabIndicatorProps={{ sx: { display: 'none' } }}
        sx={{
          minHeight: 0,
          '& .MuiTabs-flexContainer': {
            gap: 0.5,
            flexWrap: { xs: 'wrap', sm: 'nowrap' },
          },
          // spazio per l'icona del personaggio, che sporge un poco in alto come in GO
          '& .MuiTabs-scroller': { pt: '12px' },
        }}
      >
        <Tab
          icon={<GroupsIcon />}
          iconPosition="start"
          value={'team'}
          label={
            compact
              ? t('teamSettings.tab.teamShort', 'Team')
              : t('teamSettings.tab.team')
          }
          aria-label={t('teamSettings.tab.team')}
          onClick={() => navigate(`/teams/${teamId}/`)}
          sx={memberTabSx}
        />
        {loadoutData.map((loadoutDatum, ind) => {
          const teamCharKey =
            loadoutDatum &&
            database.teamChars.get(loadoutDatum?.teamCharId)?.key
          const ele = teamCharKey ? getCharEle(teamCharKey) : undefined
          return (
            <Tab
              icon={
                teamCharKey ? (
                  <CharAvatarSide characterKey={teamCharKey} />
                ) : (
                  <PersonIcon />
                )
              }
              sx={(theme) => ({
                ...memberTabSx(theme, ele && theme.palette[ele].main),
                // (phones: the avatar alone, its name read out)
                ...(compact && { minWidth: 0, px: 1 }),
              })}
              iconPosition="start"
              value={teamCharKey ?? ind}
              key={ind}
              disabled={!loadoutData[ind]}
              aria-label={
                teamCharKey
                  ? undefined
                  : t('teamSettings.tab.char', { count: ind + 1 })
              }
              label={
                teamCharKey ? (
                  // (phones: the avatar alone; its name still read out)
                  <Box
                    component="span"
                    sx={compact ? visuallyHidden : undefined}
                  >
                    <CharacterName characterKey={teamCharKey} gender={gender} />
                  </Box>
                ) : compact ? undefined : (
                  t('teamSettings.tab.char', { count: ind + 1 })
                )
              }
              onClick={() =>
                // conserve the current tab when switching to another character
                teamCharKey &&
                navigate(`/teams/${teamId}/${teamCharKey}/${tab}`)
              }
            />
          )
        })}
        {/* the whole team at once: set apart from the members */}
        <Tab
          icon={<TeamOptimizeIcon />}
          iconPosition="start"
          value="teamOpt"
          label={t('teamOpt.tab')}
          disabled={loadoutData.every((datum) => !datum)}
          onClick={() => navigate(`/teams/${teamId}/optimize`)}
          sx={(theme) => ({ ...memberTabSx(theme), ml: { xs: 0, sm: 1.5 } })}
        />
        {kqmTheorycraftingEnabled && (
          <Tab
            icon={<KqmTabIcon teamId={teamId} />}
            iconPosition="start"
            value="kqm"
            label={
              <>
                {compact
                  ? t('teamOpt.kqm.shortTab', 'KQM')
                  : t('teamOpt.kqm.tab', 'KQM Theorycrafting')}
                <BetaBadge
                  label={t('teamOpt.kqm.beta', 'Beta')}
                  tip={t(
                    'teamOpt.kqm.betaTip',
                    'New and still being refined: results may change between versions.'
                  )}
                />
              </>
            }
            aria-label={t('teamOpt.kqm.tabBeta', 'KQM Theorycrafting (beta)')}
            disabled={loadoutData.every((datum) => !datum)}
            onClick={() => navigate(`/teams/${teamId}/kqm`)}
            sx={memberTabSx}
          />
        )}
        {kqmTheorycraftingEnabled && (
          <Tab
            icon={<TheorycraftIcon />}
            iconPosition="start"
            value="kqm-compare"
            label={
              <>
                {t('juanlab:kqmCompare.tab')}
                <BetaBadge
                  label={t('juanlab:kqmCompare.alpha')}
                  tip={t('juanlab:kqmCompare.alphaTip')}
                />
              </>
            }
            aria-label={t('juanlab:kqmCompare.tabAlpha')}
            disabled={loadoutData.every((datum) => !datum)}
            onClick={() => navigate(`/teams/${teamId}/kqm-compare`)}
            sx={memberTabSx}
          />
        )}
      </Tabs>
    </Box>
  )
}

/**
 * The KQM tab's icon, or while a KQM run of the team is in progress (it goes on on other pages
 * and tabs) a ring with how far it is
 */
function KqmTabIcon({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const running = useKqmRunning(teamId)
  const step = useKqmProgress(teamId)
  if (!running) return <TheorycraftIcon />
  const percent = Math.round((step?.progress ?? 0) * 100)
  return (
    <Box
      component="span"
      sx={{
        position: 'relative',
        display: 'inline-flex',
        width: 18,
        height: 18,
        flexShrink: 0,
      }}
    >
      {/* (the ring's track) */}
      <CircularProgress
        variant="determinate"
        value={100}
        size={18}
        thickness={5}
        aria-hidden
        sx={(theme) => ({
          position: 'absolute',
          color: alpha(theme.palette.text.primary, 0.14),
        })}
      />
      <CircularProgress
        variant={step ? 'determinate' : 'indeterminate'}
        value={percent}
        size={18}
        thickness={5}
        aria-label={t('teamOpt.kqm.runningTab', {
          defaultValue: 'KQM builds running: {{percent}}%',
          percent,
        })}
        sx={{ color: 'primary.main' }}
      />
    </Box>
  )
}

/**
 * juanlab: una scheda (membro, impostazioni squadra, ottimizzazione) squadrata come in Genshin Optimizer: bordo e
 * tinta del colore dell'elemento del personaggio (oro per le altre), e una barra in basso su quella aperta.
 */
function memberTabSx(theme: Theme, color?: string) {
  const { primary, text } = theme.palette
  const c = color ?? primary.main
  return {
    minHeight: 44,
    py: 0.75,
    px: 1.75,
    borderRadius: 1,
    overflow: 'visible',
    fontWeight: 600,
    color: text.secondary,
    backgroundColor: alpha(c, 0.08),
    // WCAG 2.1 (1.4.11): il bordo pieno dell'elemento resta sopra 3:1 sul pannello per ogni elemento
    border: `1px solid ${c}`,
    transition:
      'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
    '&:hover': {
      color: text.primary,
      backgroundColor: alpha(c, 0.16),
    },
    // focus da tastiera ben visibile (WCAG 2.4.7)
    '&.Mui-focusVisible': {
      outline: `2px solid ${text.primary}`,
      outlineOffset: 2,
    },
    '&.Mui-selected': {
      color: `${text.primary} !important`,
      backgroundColor: alpha(c, 0.28),
      boxShadow: `inset 0 -3px 0 ${c}`,
    },
    '&.Mui-disabled': { opacity: 0.45 },
  }
}
function TeamEditorModal({
  teamId,
  show,
  onClose,
}: {
  teamId: string
  show: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const team = useTeam(teamId)!
  const handleName = (teamName: string): void => {
    database.teams.set(teamId, { name: teamName })
  }
  const handleDesc = (teamDesc: string): void => {
    database.teams.set(teamId, { description: teamDesc })
  }
  return (
    <ModalWrapper open={show} onClose={onClose}>
      <CardThemed>
        <CardHeader
          title={t('team.editNameDesc')}
          avatar={<TeamIcon />}
          titleTypographyProps={{ variant: 'h6' }}
          action={
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
          }
        />
        <Divider />
        <CardContent>
          <Box display="flex" flexDirection="column" gap={2} sx={{ mt: 2 }}>
            <TextFieldLazy
              label={t('team.name')}
              value={team.name}
              onChange={(teamName) => handleName(teamName)}
              autoFocus
            />
            <TextFieldLazy
              label={t('team.desc')}
              value={team.description}
              onChange={(teamDesc) => handleDesc(teamDesc)}
              multiline
              minRows={4}
            />
          </Box>
        </CardContent>
      </CardThemed>
    </ModalWrapper>
  )
}
