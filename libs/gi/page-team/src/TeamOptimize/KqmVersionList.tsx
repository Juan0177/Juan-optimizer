import {
  useDataEntryBase,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import { artifactDefIcon, weaponAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  charKeyToLocGenderedCharKey,
  signatureWeapons,
} from '@genshin-optimizer/gi/consts'
import type { TeamKqmRunSummary } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { kqmStandardOf } from '@genshin-optimizer/gi/solver'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  RotationMember,
  VersionsCardData,
  VersionsCardTeam,
} from '@genshin-optimizer/gi/ui'
import {
  BETA_LABEL,
  CardImageDialog,
  CharacterName,
  CharacterSingleSelectionModal,
  currentRelease,
  kqmCardFace,
  kqmEnergyRequirement,
  kqmMemberConstellation,
  kqmTalentLevel,
  parseRotation,
  renderVersionsCard,
  rotationTemplateKinds,
  safeName,
  teamOptMembers,
  templatesForTeam,
  versionsCardHeight,
  versionsCardWidth,
} from '@genshin-optimizer/gi/ui'
import AddIcon from '@mui/icons-material/Add'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import CallSplitRoundedIcon from '@mui/icons-material/CallSplitRounded'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  CircularProgress,
  Drawer,
  FormControlLabel,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import {
  Fragment,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { formatRateFull } from './format'
import { rotationTurns } from './KqmShareMenu'
import {
  betaOf,
  ER_NOTE,
  kqmCardDetails,
  kqmCardFileName,
  type KqmCardView,
  kqmMembersStats,
  readKqmCardView,
  shareStamp,
  writeKqmCardView,
} from './kqmTeamCard'
import { kqmStandardName } from './KqmStandard'
import {
  queueVersionRuns,
  stopVersionRuns,
  useVersionQueue,
} from './kqmVersionRun'
import type { VersionSwap } from './kqmVersions'
import {
  createVersion,
  keepsTeammates,
  kqmRunFresh,
  makeOriginal,
  pickVersionMember,
  signatureOf,
  versionName,
  versionRoot,
  versionRotation,
  versionsOf,
} from './kqmVersions'
import { MemberAvatar } from './MemberAvatar'
import { templateText } from './RotationTemplates'
import { firstRotations, STEADY_RANGE } from './RotationTiming'
import {
  applySavedRotation,
  insertWord,
  kqmRotationId,
  memberNamesOf,
  savedTimingOf,
  setWrittenRotation,
  WriterQuickRow,
  writtenRotationOf,
} from './RotationWriter'

const mono =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Cascadia Mono", "Liberation Mono", monospace'

import {
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  rowHoverSx,
  Segmented,
  tokens,
  type,
} from './ui'
import { savedRunOf } from './savedRun'
import { savedRunSummary, useKqmProgress, useKqmRun } from './useKqmRun'

/** A team of the family as its row shows it: its members, last run and whether it still holds */
interface VersionRow {
  id: string
  name: string
  members: CharacterKey[]
  summary?: TeamKqmRunSummary
  /** Its last run is for its settings, rotation and members now */
  fresh: boolean
  /** Team DPS (damage per rotation without a rotation time) */
  value?: number
  /** Its own constellations, over the family's */
  cons: Partial<Record<CharacterKey, number>>
  /** It keeps its teammates' gear from the original (`TeamOptKqm.keepTeammates`) */
  keeps: boolean
}

function rowOf(
  database: ReturnType<typeof useDatabase>,
  id: string,
  rootName: string
): VersionRow {
  const team = database.teams.get(id)
  const members = teamOptMembers(database, id).map((m) => m.characterKey)
  const summary = database.teamKqmResults.getSummary(id)
  const fresh = kqmRunFresh(database, id)
  const prefix = `${rootName} · `
  const name = team?.name ?? ''
  return {
    id,
    name: name.startsWith(prefix) ? name.slice(prefix.length) : name,
    members,
    summary,
    fresh,
    cons: team?.versionCons ?? {},
    keeps: keepsTeammates(database, id),
    value: summary
      ? summary.rotationTime
        ? summary.total / summary.rotationTime
        : summary.total
      : undefined,
  }
}

/*
 * The versions panel's state, outside the page's results (a result coming in remakes them): open
 * for a family (its original's id), so it stays open on another of its pages (after deleting the
 * one shown) and not on an unrelated one
 */
let panelFor: string | undefined
const panelListeners = new Set<() => void>()
function setPanelFor(rootId: string | undefined) {
  panelFor = rootId
  for (const l of panelListeners) l()
}
/** The team shown when it was deleted: removed by the next page's panel, once that page shows */
let removeOnLeaving: string | undefined
function usePanelFor() {
  return useSyncExternalStore(
    (onChange) => {
      panelListeners.add(onChange)
      return () => {
        panelListeners.delete(onChange)
      }
    },
    () => panelFor
  )
}

/**
 * "Versions" beside the KQM result's Share (and on a version's page): opens the panel of the
 * team's versions (`VersionsDrawer`), with their count, and a spinner while some run
 */
export function VersionsButton({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  useDataManagerValues(database.teams)
  const queue = useVersionQueue()
  const rootId = versionRoot(database, teamId)
  const count = versionsOf(database, rootId).length
  return (
    <Button
      variant="outlined"
      color="inherit"
      startIcon={<CallSplitRoundedIcon sx={{ fontSize: '19px !important' }} />}
      onClick={() => setPanelFor(rootId)}
      aria-haspopup="dialog"
      sx={{
        ...quickSx,
        ...focusSx,
        height: 40,
        px: 2,
        borderRadius: 999,
        textTransform: 'none',
        fontSize: 14,
        fontWeight: 650,
        borderColor: tokens.hairlineStrong,
        '& .MuiButton-startIcon': { mr: 0.75 },
      }}
    >
      {t('teamOpt.versions.title', 'Versions')}
      {queue.length > 0 ? (
        <CircularProgress size={14} thickness={5} sx={{ ml: 1 }} />
      ) : (
        count > 0 && (
          <Box
            component="span"
            sx={{ ml: 0.75, color: 'text.secondary', ...numSx }}
          >
            {count}
          </Box>
        )
      )}
    </Button>
  )
}

/** The panel of a team's versions, once on the KQM tab (`VersionsButton` opens it) */
export function VersionsDrawer({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  useDataManagerValues(database.teams)
  const open = usePanelFor() === versionRoot(database, teamId)
  const close = () => setPanelFor(undefined)
  useEffect(() => {
    const id = removeOnLeaving
    if (!id || id === teamId) return
    removeOnLeaving = undefined
    database.teams.remove(id)
  }, [database, teamId])
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={close}
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-label': t('teamOpt.versions.title', 'Versions'),
        sx: {
          width: { xs: '100%', md: 640 },
          maxWidth: '100%',
          bgcolor: tokens.panel,
          backgroundImage: 'none',
          borderLeft: hairline,
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: { xs: 2, sm: 2.5 },
          pr: 1.25,
          minHeight: 60,
          borderBottom: hairline,
          flexShrink: 0,
        }}
      >
        <Typography
          component="h2"
          sx={{ ...type.section, flex: 1, minWidth: 0 }}
        >
          {t('teamOpt.versions.title', 'Versions')}
        </Typography>
        <IconButton
          onClick={close}
          aria-label={t('teamOpt.editor.close', 'Close')}
          sx={{ ...quickSx, ...focusSx }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <Box sx={{ p: { xs: 1.5, sm: 2.5 }, overflowY: 'auto', flex: 1 }}>
        <KqmVersions teamId={teamId} onLeave={close} />
      </Box>
    </Drawer>
  )
}

/**
 * The team's versions (KQM): teams of their own with members swapped, under the
 * original's KQM settings, side by side with it. New ones run at once, one after another, in the
 * background; each row opens its team.
 */
export function KqmVersions({
  teamId,
  onLeave,
}: {
  teamId: string
  /** Another team's page is opened from it */
  onLeave?: () => void
}) {
  const { t, i18n } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const database = useDatabase()
  const navigate = useNavigate()
  const teamsDirty = useDataManagerValues(database.teams)
  const results = useDataEntryBase(database.teamKqmResults)
  const queue = useVersionQueue()
  // the New version window, as a copy of a team of the family (Duplicate) or not
  const [creating, setCreating] = useState<{ from?: string }>()
  // the team whose rotation is open to edit here
  const [editing, setEditing] = useState<string>()
  const rootId = versionRoot(database, teamId)
  const rootName = database.teams.get(rootId)?.name ?? ''
  // (made again when any team or result changes)
  const rows = useMemo(() => {
    const versions = versionsOf(database, rootId).map((id) =>
      rowOf(database, id, rootName)
    )
    // (the best first; those not run yet last, newest last)
    versions.sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    return { root: rowOf(database, rootId, rootName), versions }
  }, [database, rootId, rootName, teamsDirty, results])
  const all = [rows.root, ...rows.versions]
  // (a result found before runs were kept in brief: briefed once, after the panel shows)
  const unsummed = all
    .filter((r) => !r.summary)
    .map((r) => r.id)
    .join()
  useEffect(() => {
    if (!unsummed) return
    const id = setTimeout(() => {
      for (const teamId of unsummed.split(',')) {
        const summary = savedRunSummary(database, teamId)
        if (summary) database.teamKqmResults.setSummary(teamId, summary)
      }
    }, 50)
    return () => clearTimeout(id)
  }, [database, unsummed])
  const toRun = all.filter((r) => !r.fresh && !queue.includes(r.id))
  const running = queue.length > 0
  const run = (ids: string[]) => queueVersionRuns(database, gender, i18n, ids)
  const open = (id: string) => {
    onLeave?.()
    navigate(`/teams/${id}/kqm`)
  }
  const hasVersions = rows.versions.length > 0
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1.5,
          mb: 2,
        }}
      >
        <Button
          size="small"
          variant={hasVersions ? 'outlined' : 'contained'}
          startIcon={<AddIcon />}
          onClick={() => setCreating({})}
          sx={{
            minHeight: 34,
            flexShrink: 0,
            ...(hasVersions ? {} : giCtaSx),
          }}
        >
          {t('teamOpt.versions.new', 'New version')}
        </Button>
        {hasVersions && <VersionsShare rows={all} rootId={rootId} />}
      </Box>
      <Box sx={{ ...insetSx, overflow: 'hidden' }}>
        {all.map((row, i) => (
          <Fragment key={row.id}>
            <VersionLine
              row={row}
              original={i === 0}
              current={row.id === teamId}
              rootMembers={rows.root.members}
              queued={queue.includes(row.id)}
              editing={editing === row.id}
              onOpen={() => open(row.id)}
              onRun={() => run([row.id])}
              onEdit={() =>
                setEditing((now) => (now === row.id ? undefined : row.id))
              }
              onDuplicate={() => setCreating({ from: row.id })}
              onMakeOriginal={() => {
                if (!makeOriginal(database, row.id, { i18n, gender })) return
                // (the panel is the family's: open under its new original)
                setPanelFor(row.id)
              }}
              onDelete={() => {
                if (queue.includes(row.id)) stopVersionRuns(database)
                if (row.id !== teamId) {
                  database.teams.remove(row.id)
                  return
                }
                // (the team shown: its original's page first, the panel still open; deleted once
                // that page shows, or the team page, without its team, goes to the teams list)
                removeOnLeaving = row.id
                navigate(`/teams/${rootId}/kqm`)
              }}
            />
            {editing === row.id && (
              <VersionRotationEditor
                teamId={row.id}
                onClose={() => setEditing(undefined)}
                onSaved={() => {
                  setEditing(undefined)
                  run([row.id])
                }}
              />
            )}
          </Fragment>
        ))}
        {!hasVersions && (
          <Typography
            sx={{ ...type.label, px: 1.5, py: 1.25, borderTop: hairline }}
          >
            {t(
              'teamOpt.versions.none',
              'No versions yet: swap members to see how the team compares.'
            )}
          </Typography>
        )}
        {(hasVersions || toRun.length > 0 || running) && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 1.5,
              py: 1,
              borderTop: hairline,
            }}
          >
            <Typography sx={{ ...type.label, flex: 1, minWidth: 0 }}>
              {running
                ? t('teamOpt.versions.running', {
                    defaultValue:
                      'Running {{count}} in the background: you can keep working',
                    count: queue.length,
                  })
                : toRun.length > 0
                  ? t('teamOpt.versions.toRun', {
                      defaultValue: '{{count}} not run with these settings',
                      count: toRun.length,
                    })
                  : t('teamOpt.versions.allRun', 'All run with these settings')}
            </Typography>
            {running ? (
              <Button
                size="small"
                color="inherit"
                onClick={() => stopVersionRuns(database)}
              >
                {t('teamOpt.versions.stop', 'Stop')}
              </Button>
            ) : (
              <>
                {toRun.length > 0 && toRun.length < all.length && (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => run(all.map((r) => r.id))}
                    sx={{ minHeight: 32 }}
                  >
                    {t('teamOpt.versions.runEvery', 'Run all')}
                  </Button>
                )}
                <Button
                  size="small"
                  variant="contained"
                  endIcon={<ArrowForwardIcon />}
                  onClick={() =>
                    run((toRun.length > 0 ? toRun : all).map((r) => r.id))
                  }
                  sx={{ ...giCtaSx, minHeight: 32 }}
                >
                  {toRun.length > 0
                    ? t('teamOpt.versions.runAll', {
                        defaultValue: 'Run {{count}}',
                        count: toRun.length,
                      })
                    : t('teamOpt.versions.runEvery', 'Run all')}
                </Button>
              </>
            )}
          </Box>
        )}
      </Box>
      {creating && (
        <NewVersionDialog
          teamId={rootId}
          from={creating.from}
          onClose={() => setCreating(undefined)}
          onCreate={(
            swaps,
            rotation,
            constellations,
            name,
            signature,
            keepTeammates
          ) => {
            const id = createVersion(
              database,
              rootId,
              swaps,
              { i18n, gender },
              rotation,
              constellations,
              name,
              creating.from,
              signature,
              keepTeammates
            )
            if (id) run([id])
            return !!id
          }}
        />
      )}
    </Box>
  )
}

function VersionLine({
  row,
  original,
  current,
  rootMembers,
  queued,
  editing,
  onOpen,
  onRun,
  onEdit,
  onDuplicate,
  onMakeOriginal,
  onDelete,
}: {
  row: VersionRow
  original: boolean
  current: boolean
  rootMembers: CharacterKey[]
  queued: boolean
  /** Its rotation is open to edit under it */
  editing: boolean
  onOpen: () => void
  onRun: () => void
  onEdit: () => void
  /** Opens the New version window as a copy of it */
  onDuplicate: () => void
  /** Makes it the family's original */
  onMakeOriginal: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('page_team')
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const { state } = useKqmRun(row.id)
  const step = useKqmProgress(row.id)
  const [confirm, setConfirm] = useState(false)
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const runningNow = state.type === 'running'
  const canRerun = !runningNow && !queued && row.fresh
  const early = runningNow ? state.early : undefined
  const earlyValue =
    early &&
    (early.runTeamOpt.rotationTime
      ? early.result.after.total / early.runTeamOpt.rotationTime
      : early.result.after.total)
  const shown = row.summary
  const status = runningNow
    ? t('teamOpt.versions.statusRunning', {
        defaultValue: 'Running {{percent}}%',
        percent: Math.round((step?.progress ?? 0) * 100),
      })
    : queued
      ? t('teamOpt.versions.statusQueued', 'Waiting')
      : !shown
        ? t('teamOpt.versions.statusNew', 'Not run')
        : !row.fresh
          ? t('teamOpt.versions.statusStale', 'Out of date')
          : undefined
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: { xs: 'flex-start', sm: 'center' },
        gap: 1,
        '& + &': { borderTop: hairline },
        ...(current
          ? { bgcolor: alpha(theme.palette.primary.main, 0.06) }
          : rowHoverSx),
      })}
    >
      <ButtonBase
        onClick={current ? undefined : onOpen}
        disabled={current}
        aria-label={row.name}
        sx={{
          ...focusSx,
          flex: 1,
          minWidth: 0,
          display: { xs: 'grid', sm: 'flex' },
          gridTemplateColumns: 'auto minmax(0, 1fr) auto auto',
          gridTemplateAreas: '"faces . value chevron" "text text text text"',
          columnGap: 1.5,
          rowGap: 0.75,
          alignItems: 'center',
          justifyContent: 'flex-start',
          textAlign: 'left',
          px: 1.5,
          py: { xs: 1.25, sm: 1 },
          borderRadius: 0,
        }}
      >
        <Box sx={{ gridArea: 'faces', display: 'flex', flexShrink: 0 }}>
          {row.members.map((k) => {
            const swapped =
              !original && (!rootMembers.includes(k) || k in row.cons)
            return (
              <Box
                key={k}
                sx={(theme) => ({
                  ml: { xs: '-9px', sm: '-4px' },
                  '&:first-of-type': { ml: 0 },
                  borderRadius: '50%',
                  lineHeight: 0,
                  boxShadow: swapped
                    ? `0 0 0 2px ${theme.palette.primary.main}`
                    : `0 0 0 2px ${tokens.inset}`,
                  zIndex: swapped ? 1 : 0,
                })}
              >
                <MemberAvatar characterKey={k} size={28} />
              </Box>
            )
          })}
        </Box>
        <Box sx={{ gridArea: 'text', flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography
              sx={{
                ...type.body,
                fontWeight: 600,
                lineHeight: 1.3,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                overflowWrap: 'anywhere',
              }}
            >
              {row.name}
            </Typography>
            {(original || row.keeps) && (
              <Box
                component="span"
                sx={{
                  ...type.label,
                  fontSize: 11,
                  px: 0.75,
                  py: '1px',
                  borderRadius: tokens.radius.pill,
                  border: hairline,
                  flexShrink: 0,
                }}
              >
                {original
                  ? t('teamOpt.versions.original', 'Original')
                  : t('teamOpt.versions.keptTag', "Teammates' gear kept")}
              </Box>
            )}
          </Box>
          <Typography noWrap sx={{ ...type.label, ...numSx }}>
            {status ??
              (shown?.rotationTime !== undefined
                ? t('teamOpt.versions.rotation', {
                    defaultValue: '{{seconds}} s',
                    seconds: shown.rotationTime.toFixed(1),
                  })
                : t('teamOpt.versions.done', 'Up to date'))}
          </Typography>
        </Box>
        <Box sx={{ gridArea: 'value', textAlign: 'right', flexShrink: 0 }}>
          {runningNow ? (
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
              aria-live="polite"
            >
              {earlyValue !== undefined && (
                <Typography
                  sx={{ ...type.body, ...numSx, color: 'text.secondary' }}
                >
                  ≈{formatRateFull(earlyValue, undefined)}
                </Typography>
              )}
              <CircularProgress
                size={16}
                thickness={5}
                variant={step?.progress ? 'determinate' : 'indeterminate'}
                value={(step?.progress ?? 0) * 100}
              />
            </Box>
          ) : (
            <Typography
              sx={{
                ...type.body,
                ...numSx,
                fontWeight: 650,
                color: row.fresh ? 'text.primary' : 'text.disabled',
              }}
            >
              {row.value !== undefined
                ? formatRateFull(row.value, undefined)
                : '–'}
            </Typography>
          )}
        </Box>
        <ChevronRightIcon
          fontSize="small"
          sx={{
            gridArea: 'chevron',
            color: 'text.disabled',
            flexShrink: 0,
            visibility: current ? 'hidden' : undefined,
          }}
        />
      </ButtonBase>
      {canRerun && !narrow && (
        <Tooltip title={t('teamOpt.versions.runAgain', 'Run again')}>
          <IconButton
            size="small"
            onClick={onRun}
            aria-label={t('teamOpt.versions.runAgain', 'Run again')}
            sx={{ color: 'text.disabled' }}
          >
            <ReplayRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      {!runningNow && !queued && !row.fresh && (
        <Button
          size="small"
          onClick={onRun}
          sx={{ minWidth: 0, mr: -0.5, mt: { xs: '9px', sm: 0 } }}
        >
          {t('teamOpt.versions.run', 'Run')}
        </Button>
      )}
      {!narrow && (
        <Tooltip
          title={t('teamOpt.versions.editRotation', 'Edit its rotation')}
        >
          <IconButton
            size="small"
            onClick={onEdit}
            aria-label={t('teamOpt.versions.editRotation', 'Edit its rotation')}
            aria-expanded={editing}
            sx={{ color: editing ? 'primary.main' : 'text.disabled' }}
          >
            <EditOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <IconButton
        size="small"
        onClick={(e) => setMenu(e.currentTarget)}
        aria-label={t('teamOpt.versions.more', 'More')}
        aria-haspopup="menu"
        sx={{
          mr: 1,
          mt: { xs: '10px', sm: 0 },
          color: editing && narrow ? 'primary.main' : 'text.disabled',
        }}
      >
        <MoreVertRoundedIcon fontSize="small" />
      </IconButton>
      <Menu
        anchorEl={menu}
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {narrow && canRerun && (
          <MenuItem
            onClick={() => {
              setMenu(null)
              onRun()
            }}
          >
            <ListItemIcon>
              <ReplayRoundedIcon fontSize="small" />
            </ListItemIcon>
            {t('teamOpt.versions.runAgain', 'Run again')}
          </MenuItem>
        )}
        {narrow && (
          <MenuItem
            onClick={() => {
              setMenu(null)
              onEdit()
            }}
            selected={editing}
          >
            <ListItemIcon>
              <EditOutlinedIcon fontSize="small" />
            </ListItemIcon>
            {t('teamOpt.versions.editRotation', 'Edit its rotation')}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            setMenu(null)
            onDuplicate()
          }}
        >
          <ListItemIcon>
            <ContentCopyRoundedIcon fontSize="small" />
          </ListItemIcon>
          {t('teamOpt.versions.duplicate', 'Duplicate')}
        </MenuItem>
        {!original && (
          <MenuItem
            onClick={() => {
              setMenu(null)
              onMakeOriginal()
            }}
          >
            <ListItemIcon>
              <StarOutlineRoundedIcon fontSize="small" />
            </ListItemIcon>
            {t('teamOpt.versions.makeOriginal', 'Make it the original')}
          </MenuItem>
        )}
        {!original && (
          <MenuItem
            onClick={() => {
              setMenu(null)
              setConfirm(true)
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon sx={{ color: 'inherit' }}>
              <DeleteOutlineIcon fontSize="small" />
            </ListItemIcon>
            {t('teamOpt.versions.delete', 'Delete this version')}
          </MenuItem>
        )}
      </Menu>
      {confirm && (
        <ModalWrapper
          open
          onClose={() => setConfirm(false)}
          containerProps={{ maxWidth: 'xs' }}
        >
          <CardThemed sx={{ p: 2 }}>
            <Typography sx={type.title}>
              {t('teamOpt.versions.deleteTitle', {
                defaultValue: 'Delete “{{name}}”?',
                name: row.name,
              })}
            </Typography>
            <Typography sx={{ ...type.label, mt: 1 }}>
              {t(
                'teamOpt.versions.deleteText',
                'The version is a team of its own: its team, rotation and results are deleted. The original stays.'
              )}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 1,
                mt: 2,
              }}
            >
              <Button color="inherit" onClick={() => setConfirm(false)}>
                {t('teamOpt.versions.cancel', 'Cancel')}
              </Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => {
                  setConfirm(false)
                  onDelete()
                }}
              >
                {t('teamOpt.versions.deleteConfirm', 'Delete')}
              </Button>
            </Box>
          </CardThemed>
        </ModalWrapper>
      )}
    </Box>
  )
}

/**
 * Picks the members of the original to swap, and who takes their places; as a copy of a team of
 * the family (`from`), starting from its members, constellations and rotation
 */
function NewVersionDialog({
  teamId,
  from,
  onClose,
  onCreate,
}: {
  teamId: string
  from?: string
  onClose: () => void
  /**
   * Creates it (and starts its run), with its rotation as chosen (absent: the original's swapped,
   * or the copied team's); false when it could not be
   */
  onCreate: (
    swaps: VersionSwap[],
    rotation?: { text: string; opener: string },
    constellations?: Partial<Record<CharacterKey, number>>,
    name?: string,
    signature?: Partial<Record<CharacterKey, number>>,
    keepTeammates?: boolean
  ) => boolean
}) {
  const { t, i18n } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const database = useDatabase()
  const team = database.teams.get(teamId)
  const members = teamOptMembers(database, teamId).map((m) => m.characterKey)
  // (a copy: the copied team's members as swaps of the original's, its own constellations)
  const [copied] = useState(() => {
    if (!from) return undefined
    const own = teamOptMembers(database, from).map((m) => m.characterKey)
    const tos = own.filter((k) => !members.includes(k))
    const swaps = members
      .filter((k) => !own.includes(k))
      .slice(0, tos.length)
      .map((k, i) => ({ from: k, to: tos[i] }))
    return {
      swaps,
      cons: { ...database.teams.get(from)?.versionCons },
      sig: signatureOf(database, from),
      keep: keepsTeammates(database, from),
      name: database.teams.get(from)?.name ?? '',
      rotation: writtenRotationOf(database, kqmRotationId(from)),
    }
  })
  const [swaps, setSwapsNow] = useState<VersionSwap[]>(copied?.swaps ?? [])
  const [picking, setPicking] = useState<CharacterKey>()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  // its rotation: the copied team's, the original's swapped, or a template's, as chosen; then as
  // edited
  const firstChoice = copied ? 'copy' : 'own'
  const [choice, setChoice] = useState(firstChoice)
  const [edited, setEdited] = useState<{ text: string; opener: string }>()
  const setSwaps = (update: (list: VersionSwap[]) => VersionSwap[]) => {
    setSwapsNow(update)
    setChoice('own')
    setEdited(undefined)
  }
  // its own constellations, by the member (the family's for the rest)
  const rootKqm = team?.teamOpt?.kqm
  const [cons, setCons] = useState<Partial<Record<CharacterKey, number>>>(
    copied?.cons ?? {}
  )
  const consOf = (k: CharacterKey) =>
    cons[k] ?? kqmMemberConstellation(k, rootKqm)
  const setConsOf = (k: CharacterKey, n: number) =>
    setCons((now) => {
      const next = { ...now }
      if (n === kqmMemberConstellation(k, rootKqm)) delete next[k]
      else next[k] = n
      return next
    })
  // its members' signature weapons (none chosen: the family's weapon settings)
  const [sig, setSig] = useState<Partial<Record<CharacterKey, number>>>(
    copied?.sig ?? {}
  )
  const setSigOf = (k: CharacterKey, r: number | undefined) =>
    setSig((now) => {
      const next = { ...now }
      if (r === undefined) delete next[k]
      else next[k] = r
      return next
    })
  // (its teammates keep the original's builds: only the changed members are searched)
  const [keep, setKeep] = useState(copied?.keep ?? false)
  const swapOf = (from: CharacterKey) => swaps.find((s) => s.from === from)
  const shown = members.map((k) => swapOf(k)?.to ?? k)
  const inTeam = ([k]: [string, unknown]) => shown.includes(k as CharacterKey)
  // (a copy may keep its team: another rotation)
  const changed =
    !!copied ||
    swaps.length > 0 ||
    Object.entries(cons).some(inTeam) ||
    Object.entries(sig).some(inTeam)
  // its name: its members' (`versionName`, numbered when the family has it) until one is typed
  const [name, setName] = useState<string>()
  const familyNames = useMemo(
    () =>
      new Set(
        [teamId, ...versionsOf(database, teamId)].map(
          (id) => database.teams.get(id)?.name ?? ''
        )
      ),
    [database, teamId]
  )
  const membersName = versionName(
    shown,
    Object.fromEntries(Object.entries(cons).filter(inTeam)),
    { i18n, gender },
    Object.fromEntries(Object.entries(sig).filter(inTeam))
  )
  let defaultName = membersName
  for (let n = 2; familyNames.has(defaultName); n++)
    defaultName = `${membersName} (${n})`
  const teamKey = shown.join()
  const copiedKey =
    copied &&
    members.map((k) => copied.swaps.find((s) => s.from === k)?.to ?? k).join()
  const names2 = useMemo(
    () =>
      memberNamesOf(
        teamKey.split(',').map((k) => ({ characterKey: k as CharacterKey })),
        i18n,
        gender
      ),
    [teamKey, i18n, gender]
  )
  const choices = useMemo(() => {
    if (!changed) return []
    const own = versionRotation(database, teamId, swaps, { i18n, gender })
    return [
      // (the copied team's, while it has its members)
      ...(copied && copiedKey === teamKey
        ? [
            {
              id: 'copy',
              label: t('teamOpt.versions.fromCopy', 'Copied'),
              text: copied.rotation.text,
              opener: copied.rotation.opener,
            },
          ]
        : []),
      // (a copy keeping the original's members: the copy's alone)
      ...(copied && !swaps.length
        ? []
        : [
            {
              id: 'own',
              label: copied
                ? t('teamOpt.versions.fromOriginal', 'Original’s')
                : t('teamOpt.versions.fromTeam', 'This team’s'),
              ...own,
            },
          ]),
      ...templatesForTeam(names2.map((n) => n.characterKey))
        .filter(
          (tm) =>
            tm.members.length === names2.length &&
            tm.members.every((m) => names2.some((n) => n.characterKey === m))
        )
        .map((tm) => ({
          id: tm.id,
          label: t(
            `teamOpt.templates.kind.${tm.kind}`,
            rotationTemplateKinds[tm.kind]
          ),
          source: tm.source.name,
          text: templateText(tm.text, names2),
          opener: tm.opener ? templateText(tm.opener, names2) : '',
        })),
    ]
  }, [
    database,
    teamId,
    swaps,
    changed,
    names2,
    i18n,
    gender,
    t,
    copied,
    copiedKey,
    teamKey,
  ])
  const chosen = choices.find((c) => c.id === choice) ?? choices[0]
  const rotation = edited ?? chosen
  return (
    <>
      <ModalWrapper open onClose={onClose} containerProps={{ maxWidth: 'sm' }}>
        <CardThemed sx={{ p: { xs: 1.5, sm: 2 } }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={type.title}>
                {copied
                  ? t('teamOpt.versions.duplicateTitle', {
                      defaultValue: 'Duplicate “{{name}}”',
                      name: copied.name,
                    })
                  : t('teamOpt.versions.newTitle', 'New version')}
              </Typography>
            </Box>
            <IconButton
              size="small"
              onClick={onClose}
              aria-label={t('teamOpt.versions.cancel', 'Cancel')}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' },
              gap: 1,
              mt: 2,
            }}
          >
            {members.map((k) => {
              const swap = swapOf(k)
              const member = swap?.to ?? k
              const memberName =
                names2.find((n) => n.characterKey === member)?.name ?? ''
              const sigKey = signatureWeapons[member]
              const sigIcon = sigKey
                ? weaponAsset(sigKey as never, true)
                : undefined
              return (
                <Box key={k} sx={{ position: 'relative' }}>
                  <ButtonBase
                    disabled={busy}
                    onClick={() => setPicking(k)}
                    sx={(theme) => ({
                      ...focusSx,
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 0.75,
                      p: 1.25,
                      borderRadius: tokens.radius.inset,
                      border: hairline,
                      bgcolor: tokens.inset,
                      transition: 'border-color .12s, background-color .12s',
                      '&:hover': { borderColor: tokens.hairlineStrong },
                      ...(swap && {
                        borderColor: theme.palette.primary.main,
                        bgcolor: alpha(theme.palette.primary.main, 0.08),
                      }),
                    })}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center' }}>
                      <Box
                        sx={{
                          opacity: swap ? 0.4 : 1,
                          filter: swap ? 'grayscale(1)' : 'none',
                          lineHeight: 0,
                        }}
                      >
                        <MemberAvatar characterKey={k} size={swap ? 28 : 44} />
                      </Box>
                      {swap && (
                        <>
                          <ArrowForwardIcon
                            sx={{
                              fontSize: 14,
                              mx: 0.25,
                              color: 'text.secondary',
                            }}
                          />
                          <MemberAvatar characterKey={swap.to} size={44} />
                        </>
                      )}
                    </Box>
                    <Typography
                      noWrap
                      sx={{
                        ...type.label,
                        color: 'text.primary',
                        maxWidth: '100%',
                      }}
                    >
                      <CharacterName
                        characterKey={swap?.to ?? k}
                        gender={gender}
                      />
                    </Typography>
                    <Typography sx={{ ...type.label, fontSize: 11.5 }}>
                      {swap ? (
                        <>
                          {t('teamOpt.versions.for', 'for')}{' '}
                          <CharacterName characterKey={k} gender={gender} />
                        </>
                      ) : (
                        t('teamOpt.versions.swap', 'Swap')
                      )}
                    </Typography>
                  </ButtonBase>
                  {swap && (
                    <IconButton
                      size="small"
                      disabled={busy}
                      aria-label={t(
                        'teamOpt.versions.undoSwap',
                        'Keep this member'
                      )}
                      onClick={() => {
                        setCons((now) => {
                          const next = { ...now }
                          delete next[swap.to]
                          return next
                        })
                        setSigOf(swap.to, undefined)
                        setSwaps((list) => list.filter((s) => s.from !== k))
                      }}
                      sx={{ position: 'absolute', top: 2, right: 2, p: 0.25 }}
                    >
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  )}
                  <Box
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'center',
                      gap: 0.5,
                      mt: 0.75,
                    }}
                  >
                    <OptionPill
                      value={`${consOf(member)}`}
                      options={[0, 1, 2, 3, 4, 5, 6].map((n) => ({
                        value: `${n}`,
                        label: `C${n}`,
                      }))}
                      own={member in cons}
                      disabled={busy}
                      label={t('teamOpt.versions.consOf', {
                        defaultValue: 'Constellation of {{name}}',
                        name: memberName,
                      })}
                      icon={<StarRoundedIcon sx={{ fontSize: 15 }} />}
                      onChange={(v) => setConsOf(member, Number(v))}
                    />
                    {sigKey && (
                      <OptionPill
                        value={`${sig[member] ?? 'any'}`}
                        options={[
                          {
                            value: 'any',
                            label: t('teamOpt.versions.sigAny', 'Any'),
                            icon: sigIcon,
                          },
                          {
                            value: '0',
                            label: t('teamOpt.versions.sigNone', 'No sig'),
                            icon: sigIcon,
                            dim: true,
                          },
                          ...[1, 2, 3, 4, 5].map((r) => ({
                            value: `${r}`,
                            label: `R${r}`,
                            icon: sigIcon,
                          })),
                        ]}
                        own={sig[member] !== undefined}
                        disabled={busy}
                        label={t('teamOpt.versions.sigOf', {
                          defaultValue: 'Signature weapon of {{name}}',
                          name: memberName,
                        })}
                        heading={t(`weaponNames_gen:${sigKey}`)}
                        onChange={(v) =>
                          setSigOf(member, v === 'any' ? undefined : Number(v))
                        }
                      />
                    )}
                  </Box>
                </Box>
              )
            })}
          </Box>
          {changed && (
            <TextField
              fullWidth
              size="small"
              label={t('teamOpt.versions.name', 'Name')}
              value={name ?? defaultName}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ mt: 2 }}
            />
          )}
          {rotation && (
            <Box sx={{ mt: 2 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 0.75,
                  mb: 1,
                }}
              >
                <Typography sx={{ ...type.title, fontSize: 14, mr: 0.5 }}>
                  {t('teamOpt.versions.rotationTitle', 'Rotation')}
                </Typography>
                {choices.length > 1 &&
                  choices.map((c) => (
                    <Tooltip
                      key={c.id}
                      arrow
                      title={'source' in c ? c.source : ''}
                    >
                      <Chip
                        size="small"
                        label={
                          'source' in c
                            ? c.id.endsWith('-optimized')
                              ? t('teamOpt.versions.templateOptimized', {
                                  defaultValue: 'Template: {{kind}}, optimized',
                                  kind: c.label,
                                })
                              : t('teamOpt.versions.template', {
                                  defaultValue: 'Template: {{kind}}',
                                  kind: c.label,
                                })
                            : c.label
                        }
                        variant={c.id === chosen?.id ? 'filled' : 'outlined'}
                        color={c.id === chosen?.id ? 'primary' : 'default'}
                        onClick={() => {
                          setChoice(c.id)
                          setEdited(undefined)
                        }}
                        disabled={busy}
                      />
                    </Tooltip>
                  ))}
                {edited && (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => setEdited(undefined)}
                    disabled={busy}
                    sx={{ ml: 'auto', minHeight: 26, py: 0 }}
                  >
                    {t('teamOpt.versions.resetRotation', 'Undo edits')}
                  </Button>
                )}
              </Box>
              <RotationFields
                names={names2}
                value={rotation}
                disabled={busy}
                onChange={setEdited}
              />
            </Box>
          )}
          <FormControlLabel
            sx={{ mt: 1.5, mr: 0, alignItems: 'flex-start' }}
            control={
              <Checkbox
                size="small"
                checked={keep}
                disabled={busy}
                onChange={(e) => setKeep(e.target.checked)}
                sx={{ py: 0.25 }}
              />
            }
            label={
              <Box>
                <Typography sx={{ ...type.body, fontWeight: 600 }}>
                  {t('teamOpt.versions.keepTeammates', "Keep teammates' gear")}
                </Typography>
                <Typography sx={{ ...type.label }}>
                  {t(
                    'teamOpt.versions.keepTeammatesHint',
                    "The members it shares with the original keep the original's builds (weapon, sets, stats): only the changed ones are searched. Run the original first."
                  )}
                </Typography>
              </Box>
            }
          />
          {failed && (
            <Typography sx={{ ...type.label, color: 'error.main', mt: 1.5 }}>
              {t(
                'teamOpt.versions.failed',
                'That version could not be made: pick members that are not in the team yet.'
              )}
            </Typography>
          )}
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 1,
              mt: 2,
            }}
          >
            <Button color="inherit" onClick={onClose} disabled={busy}>
              {t('teamOpt.versions.cancel', 'Cancel')}
            </Button>
            <Button
              variant="contained"
              disabled={!changed || busy}
              endIcon={
                busy ? (
                  <CircularProgress size={14} color="inherit" />
                ) : (
                  <ArrowForwardIcon />
                )
              }
              sx={giCtaSx}
              onClick={() => {
                setBusy(true)
                setFailed(false)
                // (after the busy state paints: making it plays its rotation)
                setTimeout(() => {
                  const ok = onCreate(
                    swaps,
                    chosen?.id === firstChoice && !edited
                      ? undefined
                      : rotation,
                    cons,
                    name ?? defaultName,
                    Object.fromEntries(Object.entries(sig).filter(inTeam)),
                    keep
                  )
                  setBusy(false)
                  if (ok) onClose()
                  else setFailed(true)
                }, 30)
              }}
            >
              {t('teamOpt.versions.create', 'Create and run')}
            </Button>
          </Box>
        </CardThemed>
      </ModalWrapper>
      <Suspense fallback={false}>
        <CharacterSingleSelectionModal
          show={!!picking}
          onHide={() => setPicking(undefined)}
          onSelect={(to) => {
            const from = picking
            setPicking(undefined)
            const next = from && pickVersionMember(members, swaps, from, to)
            if (next) setSwaps(() => next)
          }}
          teamKeys={shown}
          selectedIndex={picking ? members.indexOf(picking) : -1}
        />
      </Suspense>
    </>
  )
}

/** On a version's KQM tab: whose version it is, and that their settings are shared */
export function VersionNote({ rootId }: { rootId: string }) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const navigate = useNavigate()
  const name = database.teams.get(rootId)?.name ?? ''
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 1,
        rowGap: 0.5,
        px: { xs: 1.5, sm: 2 },
        py: 1,
        border: hairline,
        borderRadius: tokens.radius.panel,
        bgcolor: tokens.panel,
      }}
    >
      <Typography sx={{ ...type.label, flex: '1 1 240px', minWidth: 0 }}>
        {t('teamOpt.versions.note', {
          defaultValue:
            'A version of {{name}}: its KQM settings are shared with it and its other versions.',
          name,
        })}
      </Typography>
      <Button
        size="small"
        endIcon={<ArrowForwardIcon />}
        onClick={() => navigate(`/teams/${rootId}/kqm`)}
        sx={{ minHeight: 30 }}
      >
        {t('teamOpt.versions.openOriginal', 'Open the original')}
      </Button>
      <VersionsButton teamId={rootId} />
    </Box>
  )
}

/**
 * "Share" in the versions panel: the original and its versions with a current run, as one picture
 * to post (best first; each team's members, weapons, sets, damage and rotation)
 */
function VersionsShare({
  rows,
  rootId,
}: {
  rows: VersionRow[]
  rootId: string
}) {
  const { t, i18n } = useTranslation([
    'page_team',
    'charNames_gen',
    'weaponNames_gen',
    'artifactNames_gen',
    // (juanlab: the detailed sheet's stat names)
    'keymap',
  ])
  const locale = i18n?.language
  const { gender } = useDBMeta()
  const database = useDatabase()
  const [open, setOpen] = useState(false)
  // juanlab: the usual sheet, or with each member's main stats and stats out of combat (the KQM
  // team card's choice, kept in this browser)
  const [view, setViewState] = useState<KqmCardView>(readKqmCardView)
  const setView = (v: KqmCardView) => {
    setViewState(v)
    writeKqmCardView(v)
  }
  // the teams' order on it: best first, or as arranged
  const [order, setOrder] = useState<'dps' | 'custom'>('dps')
  const [arranged, setArranged] = useState<string[]>([])
  const [left, setLeft] = useState<string[]>([])
  const shown = rows.filter((r) => r.fresh && r.summary)
  // (made when the picture opens, from the runs then)
  // biome-ignore lint/correctness/useExhaustiveDependencies: made when the picture opens
  const sheet = useMemo(() => {
    if (!open) return undefined
    const root = database.teams.get(rootId)
    const kqm = root?.teamOpt?.kqm
    const charName = (ck: CharacterKey) =>
      t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`)
    const keys: string[] = []
    const best = [...shown].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    const teams = best.map((row): VersionsCardTeam => {
      const summary = row.summary!
      const time = summary.rotationTime
      // (its own settings: constellations, the ER calculator's field time, its ER targets)
      const teamKqm = database.teams.get(row.id)?.teamOpt?.kqm
      const calc = teamKqm?.energyCalculator
      // (a run kept in brief before its ER needed was: its full result's, else the team's target)
      const saved = summary.er
        ? undefined
        : database.teamKqmResults.getRun(row.id)
      const savedEr =
        saved?.savedAt === summary.savedAt
          ? (
              saved.run.result as {
                energyRecharge?: Record<string, { minimum?: number }>
              }
            ).energyRecharge
          : undefined
      return {
        original: row.id === rootId,
        members: row.members.map((ck) => {
          const gear = summary.gear[ck]
          const damage = summary.memberTotals[ck] ?? 0
          keys.push(
            ck,
            ...(gear ? [gear.weapon, ...Object.keys(gear.sets)] : [])
          )
          return {
            ...kqmCardFace(ck, gender),
            name: charName(ck),
            constellation: kqmMemberConstellation(ck, teamKqm),
            ...(gear && signatureWeapons[ck] === gear.weapon
              ? { signature: gear.refinement }
              : {}),
            weapon: {
              name: gear ? t(`weaponNames_gen:${gear.weapon}`) : '–',
              refinement: gear?.refinement ?? 1,
              icon: gear ? weaponAsset(gear.weapon as never, true) : undefined,
            },
            sets: Object.keys(gear?.sets ?? {}).map((key) => ({
              name: t(`artifactNames_gen:${key}`),
              icon: artifactDefIcon(key as never),
            })),
            share:
              summary.total > 0
                ? `${((damage / summary.total) * 100).toFixed(0)}%`
                : '–',
            field:
              summary.field?.[ck] !== undefined
                ? `${summary.field[ck].toFixed(1)}s`
                : time !== undefined &&
                    calc?.members[ck]?.fieldTime !== undefined
                  ? `${((calc.members[ck]!.fieldTime / 100) * time).toFixed(1)}s`
                  : undefined,
            er: `${Math.round(
              summary.er?.[ck] ??
                savedEr?.[ck]?.minimum ??
                kqmEnergyRequirement(teamKqm, ck)
            )}%`,
          }
        }),
        dps: formatRateFull(summary.total, time),
        seconds: time !== undefined ? `${time.toFixed(1)} s` : undefined,
        rotation: rotationTurns(
          writtenRotationOf(database, kqmRotationId(row.id)).text
        ),
      }
    })
    const talents = kqmTalentLevel(kqm)
    const timing = savedTimingOf(database, kqmRotationId(rootId))
    const first = firstRotations(timing)
    const entries = best.map((row, i) => ({ row, team: teams[i] }))
    return {
      entries,
      notes: [
        t('page_team:teamOpt.kqm.share.standardTalents', {
          defaultValue: '{{standard}} · Talents {{talents}}',
          // (the family's: its members differ, so one set per member reads as Mixed)
          standard: Object.keys(kqm?.memberStandards ?? {}).length
            ? t('page_team:teamOpt.kqm.standardMixed', 'Mixed')
            : kqmStandardName(
                t as unknown as TFunction,
                kqmStandardOf(kqm?.standard)
              ),
          talents: `${talents}/${talents}/${talents}`,
        }),
        first === undefined
          ? t('page_team:teamOpt.timing.steady', {
              defaultValue: 'Steady DPS (rot {{from}}–{{to}})',
              ...STEADY_RANGE,
            })
          : t('page_team:teamOpt.timing.firstN', {
              defaultValue: 'First {{count}}',
              count: first,
            }),
        t('page_team:teamOpt.versions.enemyLevel', {
          defaultValue: 'Enemy Lv. {{level}}',
          level: kqm?.enemy?.enemyOverride?.enemyLevel ?? 100,
        }),
      ].join('  ·  '),
      beta: betaOf(keys).length ? BETA_LABEL : undefined,
      labels: {
        dps: shown.some((r) => r.summary?.rotationTime) ? 'DPS' : 'DPR',
        rotation: t('page_team:teamOpt.kqm.share.rotation', 'Rotation'),
        original: t('page_team:teamOpt.versions.original', 'Original'),
        share: t('page_team:teamOpt.versions.cellShare', 'Share'),
        field: t('page_team:teamOpt.versions.cellField', 'FT'),
        er: t('page_team:teamOpt.versions.cellEr', 'ER req'),
        stamp: shareStamp(locale),
      },
    }
  }, [open])
  // juanlab: each team's members' stats out of combat, from its saved run (the one its row shows:
  // the same save), at the family's KQM talents; worked out once per opening and view
  // biome-ignore lint/correctness/useExhaustiveDependencies: from the runs when the picture opens
  const stats = useMemo(() => {
    if (!sheet || view !== 'detailed') return undefined
    const talent = kqmTalentLevel(database.teams.get(rootId)?.teamOpt?.kqm)
    return new Map(
      sheet.entries.map(({ row }) => {
        const saved = database.teamKqmResults.getRun(row.id)
        const result =
          saved && saved.savedAt === row.summary?.savedAt
            ? savedRunOf(saved).result
            : undefined
        return [
          row.id,
          result
            ? kqmMembersStats(
                database,
                row.members.map((key) => ({
                  key,
                  build: result.builds[key],
                  constellation: result.constellations?.[key] ?? 0,
                })),
                talent
              )
            : {},
        ] as const
      })
    )
  }, [sheet, view])
  const data = useMemo((): VersionsCardData | undefined => {
    if (!sheet) return undefined
    const { entries, ...rest } = sheet
    const byId = new Map(entries.map((e) => [e.row.id, e]))
    const ids = (
      order === 'custom' && arranged.length
        ? arranged.filter((id) => byId.has(id))
        : entries.map((e) => e.row.id)
    ).filter((id) => !left.includes(id))
    // juanlab: on the detailed sheet, each member's block, and what its stats leave out
    const withDetails = ({ row, team }: (typeof entries)[number]) => {
      const own = stats?.get(row.id)
      if (!own) return team
      return {
        ...team,
        members: team.members.map((m, i) => {
          const ms = own[row.members[i]]
          return ms
            ? { ...m, details: kqmCardDetails(t as unknown as TFunction, ms, locale) }
            : m
        }),
      }
    }
    return {
      ...rest,
      notes: stats
        ? `${rest.notes}\n${t('page_team:teamOpt.card.erNote', ER_NOTE)}`
        : rest.notes,
      teams: ids.map((id) => withDetails(byId.get(id)!)),
      ranked: order === 'dps',
    }
  }, [sheet, stats, order, arranged, left, t, locale])
  const render = useMemo(
    () => (data ? () => renderVersionsCard(data) : undefined),
    [data]
  )
  const rootName = database.teams.get(rootId)?.name ?? ''
  return (
    <>
      <Tooltip
        title={
          shown.length < 2
            ? t(
                'page_team:teamOpt.versions.shareNeeds',
                'Run at least two of them first'
              )
            : ''
        }
      >
        <span>
          <Button
            variant="outlined"
            startIcon={
              <IosShareRoundedIcon sx={{ fontSize: '18px !important' }} />
            }
            disabled={shown.length < 2}
            onClick={() => setOpen(true)}
            sx={{
              height: 36,
              px: 1.75,
              borderRadius: 999,
              textTransform: 'none',
              fontWeight: 650,
              color: giTokens.goldLight,
              borderColor: alpha(giTokens.gold, 0.5),
              bgcolor: alpha(giTokens.gold, 0.1),
              '&:hover': {
                borderColor: giTokens.gold,
                bgcolor: alpha(giTokens.gold, 0.18),
              },
            }}
          >
            {t('page_team:teamOpt.kqm.share.button', 'Share')}
          </Button>
        </span>
      </Tooltip>
      {open && data && (
        <CardImageDialog
          title={t(
            'page_team:teamOpt.versions.shareDialog',
            'Versions compared'
          )}
          alt={t('page_team:teamOpt.versions.shareAlt', {
            defaultValue: '{{team}} and its versions, compared',
            team: rootName,
          })}
          fileName={kqmCardFileName(`${safeName(rootName)}-versions`, view)}
          aspectRatio={`${versionsCardWidth(data.teams.length)} / ${versionsCardHeight(data.teams.length, data)}`}
          render={render}
          watermark={() => ({
            app: 'Juan-optimizer',
            version: currentRelease.version,
            generatedAt: new Date().toISOString(),
            site: globalThis.location?.host,
            picture: 'versions',
            view,
            gender,
            settings: database.teams.get(rootId)?.teamOpt?.kqm && {
              ...database.teams.get(rootId)!.teamOpt!.kqm!,
              attacks: undefined,
            },
            teams: shown
              .filter((r) => !left.includes(r.id))
              .map((r) => ({
                id: r.id,
                name: database.teams.get(r.id)?.name,
                members: r.members,
                rotation: writtenRotationOf(database, kqmRotationId(r.id)),
                summary: r.summary,
              })),
          })}
          onClose={() => setOpen(false)}
          header={
            <Segmented<KqmCardView>
              size="small"
              value={view}
              aria-label={t('page_team:teamOpt.card.view.label', 'Card view')}
              options={[
                {
                  value: 'normal',
                  label: t('page_team:teamOpt.card.view.normal', 'Normal'),
                },
                {
                  value: 'detailed',
                  label: t('page_team:teamOpt.card.view.detailed', 'Detailed'),
                },
              ]}
              onChange={setView}
            />
          }
        >
          {sheet && (
            <PictureTeams
              rows={sheet.entries.map((e) => e.row)}
              rootId={rootId}
              order={order}
              arranged={
                arranged.length ? arranged : sheet.entries.map((e) => e.row.id)
              }
              left={left}
              onOrder={setOrder}
              onArrange={setArranged}
              onLeave={setLeft}
            />
          )}
        </CardImageDialog>
      )}
    </>
  )
}

/** The teams on the picture (ticked) and their order: best first, or arranged by hand */
function PictureTeams({
  rows,
  rootId,
  order,
  arranged,
  left,
  onOrder,
  onArrange,
  onLeave,
}: {
  /** best first */
  rows: VersionRow[]
  rootId: string
  order: 'dps' | 'custom'
  arranged: string[]
  /** left off the picture */
  left: string[]
  onOrder: (order: 'dps' | 'custom') => void
  onArrange: (ids: string[]) => void
  onLeave: (ids: string[]) => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const byId = new Map(rows.map((r) => [r.id, r]))
  const custom = order === 'custom'
  const ids = custom ? arranged : rows.map((r) => r.id)
  const onPicture = ids.filter((id) => byId.has(id) && !left.includes(id))
  const move = (i: number, by: number) => {
    const next = [...arranged]
    const [id] = next.splice(i, 1)
    next.splice(i + by, 0, id)
    onArrange(next)
  }
  return (
    <Box sx={{ mt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography sx={type.label}>
          {t('teamOpt.versions.order', 'Order')}
        </Typography>
        <Segmented
          size="small"
          value={order}
          onChange={onOrder}
          aria-label={t('teamOpt.versions.order', 'Order')}
          options={[
            { value: 'dps', label: t('teamOpt.versions.orderDps', 'By DPS') },
            {
              value: 'custom',
              label: t('teamOpt.versions.orderCustom', 'Your order'),
            },
          ]}
        />
      </Box>
      <Box sx={{ ...insetSx, mt: 1.25, overflow: 'hidden' }}>
        {ids.map((id, i) => {
          const row = byId.get(id)
          if (!row) return null
          const on = !left.includes(id)
          const name =
            id === rootId ? (database.teams.get(rootId)?.name ?? '') : row.name
          return (
            <Box
              key={id}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                pl: 0.5,
                pr: 1,
                minHeight: 44,
                '& + &': { borderTop: hairline },
              }}
            >
              <Box
                component="label"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  flex: 1,
                  minWidth: 0,
                  cursor: 'pointer',
                }}
              >
                <Checkbox
                  size="small"
                  checked={on}
                  disabled={on && onPicture.length === 1}
                  onChange={() =>
                    onLeave(on ? [...left, id] : left.filter((x) => x !== id))
                  }
                  inputProps={{
                    'aria-label': t('teamOpt.versions.onPicture', {
                      defaultValue: '{{team}} on the picture',
                      team: name,
                    }),
                  }}
                  sx={{ p: 0.75 }}
                />
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    flex: 1,
                    minWidth: 0,
                    opacity: on ? 1 : 0.45,
                  }}
                >
                  <Box sx={{ display: 'flex', flexShrink: 0 }}>
                    {row.members.map((k) => (
                      <Box
                        key={k}
                        sx={{
                          ml: { xs: '-10px', sm: '-6px' },
                          '&:first-of-type': { ml: 0 },
                        }}
                      >
                        <MemberAvatar characterKey={k} size={24} />
                      </Box>
                    ))}
                  </Box>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' },
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      gap: { xs: 0.25, sm: 1.25 },
                      flex: 1,
                      minWidth: 0,
                      py: { xs: 0.75, sm: 0 },
                    }}
                  >
                    <Typography
                      sx={{
                        ...type.body,
                        flex: { sm: 1 },
                        minWidth: 0,
                        maxWidth: '100%',
                        lineHeight: 1.3,
                        overflow: 'hidden',
                        overflowWrap: 'anywhere',
                        display: { xs: '-webkit-box', sm: 'block' },
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        whiteSpace: { sm: 'nowrap' },
                        textOverflow: { sm: 'ellipsis' },
                      }}
                    >
                      {name}
                    </Typography>
                    <Typography sx={{ ...type.label, ...numSx }}>
                      {row.value !== undefined
                        ? formatRateFull(row.value, undefined)
                        : '–'}
                    </Typography>
                  </Box>
                </Box>
              </Box>
              {custom && (
                <>
                  <IconButton
                    size="small"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    aria-label={t('teamOpt.versions.moveUp', 'Move up')}
                  >
                    <ArrowUpwardRoundedIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={i === arranged.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label={t('teamOpt.versions.moveDown', 'Move down')}
                  >
                    <ArrowDownwardRoundedIcon fontSize="small" />
                  </IconButton>
                </>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/** A choice of a member's option pill */
type PillOption = { value: string; label: string; icon?: string; dim?: boolean }

/**
 * A member's option under its tile: a compact pill (its icon, the value, a caret) that opens a menu
 * of the choices; gold when the version sets its own
 */
function OptionPill({
  value,
  options,
  own,
  disabled,
  label,
  icon,
  heading,
  onChange,
}: {
  value: string
  options: PillOption[]
  own: boolean
  disabled: boolean
  label: string
  /** before the value: the option's own icon, else this */
  icon?: ReactNode
  /** a line over the choices (the signature weapon's name) */
  heading?: ReactNode
  onChange: (value: string) => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const chosen = options.find((o) => o.value === value) ?? options[0]
  return (
    <>
      <ButtonBase
        disabled={disabled}
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={label}
        aria-haspopup="menu"
        sx={{
          ...focusSx,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          height: 28,
          pl: 0.75,
          pr: 0.5,
          borderRadius: 999,
          border: hairline,
          bgcolor: tokens.inset,
          color: 'text.secondary',
          fontSize: 12.5,
          fontWeight: 700,
          ...numSx,
          transition: 'border-color .12s, background-color .12s',
          '&:hover': { borderColor: tokens.hairlineStrong },
          ...(own && {
            color: giTokens.goldLight,
            borderColor: alpha(giTokens.gold, 0.5),
            bgcolor: alpha(giTokens.gold, 0.12),
            '&:hover': { borderColor: giTokens.gold },
          }),
        }}
      >
        {chosen.icon ? (
          <Box
            component="img"
            src={chosen.icon}
            alt=""
            sx={{
              width: 18,
              height: 18,
              objectFit: 'contain',
              ...(chosen.dim && { filter: 'grayscale(1)', opacity: 0.45 }),
            }}
          />
        ) : (
          icon
        )}
        {chosen.label}
        <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16, opacity: 0.7 }} />
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        transformOrigin={{ vertical: 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { minWidth: 150 } } }}
      >
        {heading && (
          <Box
            sx={{
              px: 2,
              pt: 0.5,
              pb: 1,
              fontSize: 12,
              fontWeight: 700,
              color: 'text.secondary',
            }}
          >
            {heading}
          </Box>
        )}
        {options.map((o) => (
          <MenuItem
            key={o.value}
            selected={o.value === value}
            dense
            onClick={() => {
              setAnchor(null)
              onChange(o.value)
            }}
            sx={{ gap: 1, fontSize: 13.5, fontWeight: 600, ...numSx }}
          >
            {o.icon && (
              <Box
                component="img"
                src={o.icon}
                alt=""
                sx={{
                  width: 20,
                  height: 20,
                  objectFit: 'contain',
                  ...(o.dim && { filter: 'grayscale(1)', opacity: 0.45 }),
                }}
              />
            )}
            {o.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/**
 * A rotation and its first rotation to edit, as the writer's boxes: the members' names and the
 * action words a click away (into the box last in focus), what does not read in amber under them
 */
function RotationFields({
  names,
  value,
  disabled,
  onChange,
}: {
  /** the team's members, as their names are written */
  names: RotationMember[]
  value: { text: string; opener: string }
  disabled?: boolean
  onChange: (value: { text: string; opener: string }) => void
}) {
  const { t } = useTranslation('page_team')
  const loopRef = useRef<HTMLTextAreaElement>(null)
  const openerRef = useRef<HTMLTextAreaElement>(null)
  const [target, setTarget] = useState<'loop' | 'opener'>('loop')
  const warnings = useMemo(() => {
    const opener = value.opener.trim()
      ? parseRotation(value.opener, names).warnings
      : []
    return [
      ...(value.text.trim()
        ? []
        : [
            t(
              'teamOpt.versions.noRotation',
              'No rotation: there are no attacks to run until one is written.'
            ),
          ]),
      ...parseRotation(value.text, names).warnings,
      ...opener,
    ]
  }, [value, names, t])
  const field = {
    '& .MuiInputBase-input': {
      fontFamily: mono,
      fontSize: 13,
      lineHeight: 1.6,
    },
  }
  const openerLabel = t('teamOpt.writer.opener', 'First rotation only')
  return (
    <Box>
      <TextField
        fullWidth
        multiline
        minRows={2}
        maxRows={6}
        value={value.text}
        disabled={disabled}
        inputRef={loopRef}
        onFocus={() => setTarget('loop')}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        inputProps={{
          'aria-label': t('teamOpt.versions.rotationTitle', 'Rotation'),
          spellCheck: false,
        }}
        sx={field}
      />
      <TextField
        fullWidth
        size="small"
        multiline
        maxRows={3}
        label={openerLabel}
        placeholder={t(
          'teamOpt.versions.openerNone',
          'None: the first rotation plays as the others'
        )}
        InputLabelProps={{ shrink: true }}
        value={value.opener}
        disabled={disabled}
        inputRef={openerRef}
        onFocus={() => setTarget('opener')}
        onChange={(e) => onChange({ ...value, opener: e.target.value })}
        inputProps={{ spellCheck: false }}
        sx={{ ...field, mt: 2 }}
      />
      <Box sx={{ mt: 1 }}>
        <WriterQuickRow
          members={names}
          into={target === 'opener' ? openerLabel : undefined}
          onInsert={(word) =>
            target === 'opener'
              ? insertWord(openerRef.current, value.opener, word, (opener) =>
                  onChange({ ...value, opener })
                )
              : insertWord(loopRef.current, value.text, word, (text) =>
                  onChange({ ...value, text })
                )
          }
        />
      </Box>
      {warnings.length > 0 && (
        <Typography sx={{ ...type.label, mt: 0.75, color: 'warning.main' }}>
          {warnings.slice(0, 2).join(' · ')}
        </Typography>
      )}
    </Box>
  )
}

/** A team's KQM rotation edited in the versions list: saved, it is used and runs again */
function VersionRotationEditor({
  teamId,
  onClose,
  onSaved,
}: {
  teamId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation('page_team')
  const { i18n } = useTranslation('charNames_gen')
  const { gender } = useDBMeta()
  const database = useDatabase()
  const rid = kqmRotationId(teamId)
  const [saved] = useState(() => {
    const { text, opener } = writtenRotationOf(database, rid)
    return { text, opener }
  })
  const [value, setValue] = useState(saved)
  const names = useMemo(
    () => memberNamesOf(teamOptMembers(database, teamId), i18n, gender),
    [database, teamId, i18n, gender]
  )
  const changed = value.text !== saved.text || value.opener !== saved.opener
  return (
    <Box sx={{ px: 1.5, pt: 1.25, pb: 1.5, borderTop: hairline }}>
      <RotationFields names={names} value={value} onChange={setValue} />
      <Box
        sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1.5 }}
      >
        <Button size="small" color="inherit" onClick={onClose}>
          {t('teamOpt.versions.cancel', 'Cancel')}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!changed}
          endIcon={<ArrowForwardIcon />}
          sx={giCtaSx}
          onClick={() => {
            setWrittenRotation(database, rid, value)
            applySavedRotation(database, teamId, { kqm: true, i18n, gender })
            onSaved()
          }}
        >
          {t('teamOpt.versions.saveRun', 'Save and run')}
        </Button>
      </Box>
    </Box>
  )
}
