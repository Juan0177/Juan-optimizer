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
import type { TeamKqmRunSummary, TeamOptKqm } from '@genshin-optimizer/gi/db'
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
import ChecklistRoundedIcon from '@mui/icons-material/ChecklistRounded'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import GridViewRoundedIcon from '@mui/icons-material/GridViewRounded'
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import SearchIcon from '@mui/icons-material/Search'
import SortRoundedIcon from '@mui/icons-material/SortRounded'
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import SubjectRoundedIcon from '@mui/icons-material/SubjectRounded'
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
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
  setShowInTeams,
  signatureOf,
  versionName,
  versionRoot,
  versionRotation,
  versionsOf,
} from './kqmVersions'
import { MemberAvatar, VersionPortrait } from './MemberAvatar'
import { RotationReadout } from './RotationInline'
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
import { VersionCombosDialog } from './VersionCombosDialog'

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
  selectedSx,
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
  /** Its own signature weapon choices */
  sig: Partial<Record<CharacterKey, number>>
  /** Whether this version is also shown on the main Teams tab */
  showInTeams: boolean
  /** juanlab: it keeps its teammates' gear from the original (`TeamOptKqm.keepTeammates`) */
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
    sig: signatureOf(database, id, members),
    showInTeams: !!team?.showInTeams,
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

/** The KQM entry point and result shortcut both open the team's variants drawer. */
export function VersionsButton({
  teamId,
  compare = false,
}: {
  teamId: string
  compare?: boolean
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  useDataManagerValues(database.teams)
  const queue = useVersionQueue()
  const rootId = versionRoot(database, teamId)
  const versionIds = versionsOf(database, rootId)
  const count = versionIds.length
  const running = queue.some((id) => id === rootId || versionIds.includes(id))
  const open = usePanelFor() === rootId
  const label = compare
    ? t('teamOpt.versions.compareVariants', 'Compare variants')
    : count
      ? t('teamOpt.versions.teamVariantsCount', {
          defaultValue: 'Team variants ({{count}})',
          count,
        })
      : t('teamOpt.versions.teamVariants', 'Team variants')
  return (
    <Button
      variant="outlined"
      color="inherit"
      startIcon={<CallSplitRoundedIcon sx={{ fontSize: '19px !important' }} />}
      onClick={() => setPanelFor(rootId)}
      aria-haspopup="dialog"
      aria-expanded={open}
      sx={{
        ...quickSx,
        ...focusSx,
        minHeight: { xs: 44, sm: 40 },
        px: 2,
        borderRadius: 999,
        textTransform: 'none',
        fontSize: 14,
        fontWeight: 650,
        borderColor: tokens.hairlineStrong,
        '& .MuiButton-startIcon': { mr: 0.75 },
      }}
    >
      {label}
      {running && (
        <CircularProgress aria-hidden size={14} thickness={5} sx={{ ml: 1 }} />
      )}
    </Button>
  )
}

/** The panel of a team's versions, once on the KQM tab (`VersionsButton` opens it) */
export function VersionsDrawer({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  useDataManagerValues(database.teams)
  const rootId = versionRoot(database, teamId)
  const open = usePanelFor() === rootId
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
      transitionDuration={{ enter: 220, exit: 180 }}
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-label': t('teamOpt.versions.teamVariants', 'Team variants'),
        sx: {
          width: { xs: '100%', md: 840, lg: 940 },
          maxWidth: '100%',
          bgcolor: tokens.panel,
          backgroundImage: 'none',
          borderLeft: hairline,
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      <KqmVersions teamId={teamId} onLeave={close} onClose={close} />
    </Drawer>
  )
}

type VersionSort = 'dps' | 'original'

/**
 * The team's versions (KQM): teams of their own with members swapped, under the
 * original's KQM settings, side by side with it. New ones run at once, one after another, in the
 * background; each row opens its team.
 */
export function KqmVersions({
  teamId,
  onLeave,
  onClose,
}: {
  teamId: string
  /** Another team's page is opened from it */
  onLeave?: () => void
  /** Closes the parent drawer (renders the unified header when provided) */
  onClose?: () => void
}) {
  const { t, i18n } = useTranslation(['page_team', 'charNames_gen'])
  const { gender } = useDBMeta()
  const database = useDatabase()
  const navigate = useNavigate()
  const teamsDirty = useDataManagerValues(database.teams)
  const results = useDataEntryBase(database.teamKqmResults)
  const queue = useVersionQueue()
  // the New version window, as a copy of a team of the family (Duplicate) or not
  const [creating, setCreating] = useState<{ from?: string }>()
  // the batch Combinations window (up to 8 characters)
  const [combining, setCombining] = useState(false)
  // the team whose rotation is open to edit here
  const [editing, setEditing] = useState<string>()
  // sidebar search, character filter, sort, rotation preview, and multi-select delete
  const [query, setQuery] = useState('')
  const [charFilter, setCharFilter] = useState<CharacterKey[]>([])
  const [sort, setSort] = useState<VersionSort>('dps')
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const [showRotations, setShowRotations] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)

  const rootId = versionRoot(database, teamId)
  const rootTeam = database.teams.get(rootId)
  const rootName = rootTeam?.name ?? ''
  const rootKqm = rootTeam?.teamOpt?.kqm

  // (made again when any team or result changes)
  const rows = useMemo(() => {
    const versions = versionsOf(database, rootId).map((id) =>
      rowOf(database, id, rootName)
    )
    // (the best first; those not run yet last, newest last)
    versions.sort((a, b) => (b.value ?? -1) - (a.value ?? -1))
    return { root: rowOf(database, rootId, rootName), versions }
  }, [database, rootId, rootName, teamsDirty, results])
  const all = useMemo(() => [rows.root, ...rows.versions], [rows])

  // True family rank & max DPS (independent of active search/filter)
  const { rankById, maxDps } = useMemo(() => {
    const scored = all
      .filter((r) => r.value !== undefined)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    const ranks = new Map<string, number>()
    scored.forEach((r, idx) => ranks.set(r.id, idx + 1))
    return { rankById: ranks, maxDps: scored[0]?.value }
  }, [all])

  // Characters that vary across versions (present in some teams, not all) for 1-click filtering
  const filterChars = useMemo(() => {
    if (all.length < 2) return []
    const counts = new Map<CharacterKey, number>()
    for (const r of all)
      for (const k of r.members) counts.set(k, (counts.get(k) ?? 0) + 1)
    return [...counts.entries()]
      .filter(([, count]) => count < all.length)
      .sort((a, b) => {
        const aInRoot = rows.root.members.includes(a[0]) ? 1 : 0
        const bInRoot = rows.root.members.includes(b[0]) ? 1 : 0
        if (b[1] !== a[1]) return b[1] - a[1]
        if (aInRoot !== bInRoot) return aInRoot - bInRoot
        return a[0].localeCompare(b[0])
      })
      .map(([key, count]) => ({ key, count }))
  }, [all, rows.root.members])

  // Keep active char filters pruned if a version was deleted
  const activeCharFilter = useMemo(
    () => charFilter.filter((k) => filterChars.some((fc) => fc.key === k)),
    [charFilter, filterChars]
  )

  const charName = (ck: CharacterKey) =>
    t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`)

  // Filtered and sorted rows for display
  const displayed = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = all.filter((r) => {
      if (
        activeCharFilter.length &&
        !activeCharFilter.every((ck) => r.members.includes(ck))
      )
        return false
      if (!q) return true
      if (r.name.toLowerCase().includes(q)) return true
      return r.members.some(
        (k) =>
          k.toLowerCase().includes(q) ||
          t(`charNames_gen:${charKeyToLocGenderedCharKey(k, gender)}`)
            .toLowerCase()
            .includes(q)
      )
    })
    const sorted = [...filtered]
    if (sort === 'dps') {
      sorted.sort((a, b) => {
        if (a.value !== undefined && b.value !== undefined)
          return b.value - a.value
        if (a.value !== undefined) return -1
        if (b.value !== undefined) return 1
        // Unrun: keep original before unrun versions
        if (a.id === rootId) return -1
        if (b.id === rootId) return 1
        return 0
      })
    } else {
      // original first, then versions by DPS
      sorted.sort((a, b) => {
        if (a.id === rootId) return -1
        if (b.id === rootId) return 1
        return (b.value ?? -1) - (a.value ?? -1)
      })
    }
    return sorted
  }, [all, activeCharFilter, query, sort, rootId, t, gender])

  // (a result found before runs were kept in brief: briefed once, after the panel shows)
  const unsummed = all
    .filter((r) => !r.summary)
    .map((r) => r.id)
    .join()
  useEffect(() => {
    if (!unsummed) return
    const id = setTimeout(() => {
      for (const tid of unsummed.split(',')) {
        const summary = savedRunSummary(database, tid)
        if (summary) database.teamKqmResults.setSummary(tid, summary)
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
  const hasActiveFilter = !!query.trim() || activeCharFilter.length > 0
  const deletableIds = useMemo(
    () => new Set(rows.versions.map((r) => r.id)),
    [rows.versions]
  )
  const activeSelectedIds = useMemo(
    () => [...selectedIds].filter((id) => deletableIds.has(id)),
    [selectedIds, deletableIds]
  )
  const displayedDeletableIds = useMemo(
    () => displayed.filter((r) => r.id !== rootId).map((r) => r.id),
    [displayed, rootId]
  )
  const allDisplayedSelected =
    displayedDeletableIds.length > 0 &&
    displayedDeletableIds.every((id) => selectedIds.has(id))
  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const exitSelecting = () => {
    setSelecting(false)
    setSelectedIds(new Set())
    setConfirmBulkDelete(false)
  }
  const deleteSelected = () => {
    const ids = activeSelectedIds
    if (!ids.length) return
    if (ids.some((id) => queue.includes(id))) stopVersionRuns(database)
    let deleteCurrent = false
    for (const id of ids) {
      if (id === teamId) {
        deleteCurrent = true
        continue
      }
      database.teams.remove(id)
    }
    exitSelecting()
    if (deleteCurrent) {
      removeOnLeaving = teamId
      navigate(`/teams/${rootId}/kqm`)
    }
  }
  const sortLabels: Record<VersionSort, string> = {
    dps: t('page_team:teamOpt.versions.sortDpsFull', 'Best DPS'),
    original: t('page_team:teamOpt.versions.sortOriginal', 'Original'),
  }

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* Unified header: title, count, primary actions, and drawer close */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateAreas: {
            xs: '"title close" "actions actions"',
            sm: '"title actions close"',
          },
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr) auto',
            sm: 'minmax(0, 1fr) auto auto',
          },
          alignItems: 'center',
          gap: 1,
          pl: { xs: 2, sm: 3 },
          pr: { xs: 1.25, sm: 2 },
          py: 1.25,
          minHeight: 60,
          borderBottom: hairline,
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            gridArea: 'title',
            minWidth: 0,
          }}
        >
          <Typography component="h2" sx={{ ...type.section, fontSize: 18 }}>
            {t('page_team:teamOpt.versions.teamVariants', 'Team variants')}
          </Typography>
          {hasVersions && (
            <Box
              component="span"
              sx={{
                ...type.label,
                ...numSx,
                fontSize: 12,
                px: 0.9,
                py: '1px',
                borderRadius: tokens.radius.pill,
                bgcolor: alpha(giTokens.parchment, 0.08),
              }}
            >
              {rows.versions.length}
            </Box>
          )}
        </Box>

        <Box
          sx={{
            gridArea: 'actions',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: { xs: 0.75, sm: 1 },
          }}
        >
          <Button
            size="small"
            variant={hasVersions ? 'outlined' : 'contained'}
            color={hasVersions ? 'inherit' : undefined}
            startIcon={<AddIcon />}
            onClick={() => setCreating({})}
            sx={{
              minHeight: { xs: 44, sm: 34 },
              px: { xs: 1, sm: 1.5 },
              flexShrink: 0,
              textTransform: 'none',
              fontWeight: 600,
              ...(hasVersions
                ? { borderColor: tokens.hairlineStrong }
                : giCtaSx),
            }}
          >
            {t('page_team:teamOpt.versions.newVariant', 'New variant')}
          </Button>
          {rows.root.members.length > 0 && (
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={
                <GridViewRoundedIcon sx={{ fontSize: '17px !important' }} />
              }
              onClick={() => setCombining(true)}
              sx={{
                minHeight: { xs: 44, sm: 34 },
                px: { xs: 1, sm: 1.5 },
                flexShrink: 0,
                textTransform: 'none',
                fontWeight: 600,
                borderColor: tokens.hairlineStrong,
                '& .MuiButton-startIcon': {
                  display: { xs: 'none', sm: 'flex' },
                },
              }}
            >
              {t(
                'page_team:teamOpt.versions.generateCombinations',
                'Generate combinations'
              )}
            </Button>
          )}
          {hasVersions && <VersionsShare rows={all} rootId={rootId} />}
        </Box>
        {onClose && (
          <IconButton
            onClick={onClose}
            aria-label={t('page_team:teamOpt.editor.close', 'Close')}
            sx={{
              ...quickSx,
              ...focusSx,
              gridArea: 'close',
              width: { xs: 44, sm: 40 },
              height: { xs: 44, sm: 40 },
            }}
          >
            <CloseIcon />
          </IconButton>
        )}
      </Box>

      {/* Compact search, sort, rotation toggle, and horizontal character filter strip */}
      {hasVersions && (
        <Box
          sx={{
            px: { xs: 2, sm: 3 },
            py: 1.25,
            borderBottom: hairline,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            flexShrink: 0,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <TextField
              size="small"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(
                'page_team:teamOpt.versions.searchPlaceholder',
                'Search character or name...'
              )}
              inputProps={{
                'aria-label': t(
                  'page_team:teamOpt.versions.searchPlaceholder',
                  'Search character or name...'
                ),
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 17, color: 'text.disabled' }} />
                  </InputAdornment>
                ),
                endAdornment: query ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => setQuery('')}
                      aria-label={t(
                        'page_team:teamOpt.versions.clearSearch',
                        'Clear search'
                      )}
                      sx={{ p: 0.25 }}
                    >
                      <CloseIcon sx={{ fontSize: 15 }} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              }}
              sx={{
                flex: 1,
                minWidth: 0,
                '& .MuiInputBase-root': { height: 34, fontSize: 13.5 },
              }}
            />
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={
                <SortRoundedIcon sx={{ fontSize: '16px !important' }} />
              }
              endIcon={
                <KeyboardArrowDownRoundedIcon
                  sx={{ fontSize: '16px !important', ml: -0.5 }}
                />
              }
              onClick={(e) => setSortAnchor(e.currentTarget)}
              aria-haspopup="menu"
              sx={{
                height: 34,
                px: 1.35,
                flexShrink: 0,
                textTransform: 'none',
                fontSize: 13,
                fontWeight: 600,
                color: 'text.secondary',
                borderColor: tokens.hairlineStrong,
              }}
            >
              {sortLabels[sort]}
            </Button>
            <Menu
              anchorEl={sortAnchor}
              open={!!sortAnchor}
              onClose={() => setSortAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              {(['dps', 'original'] as const).map((key) => (
                <MenuItem
                  key={key}
                  dense
                  selected={sort === key}
                  onClick={() => {
                    setSort(key)
                    setSortAnchor(null)
                  }}
                >
                  {sortLabels[key]}
                </MenuItem>
              ))}
            </Menu>
            <Tooltip
              arrow
              title={
                showRotations
                  ? t(
                      'page_team:teamOpt.versions.hideRotations',
                      'Hide rotation previews'
                    )
                  : t(
                      'page_team:teamOpt.versions.showRotations',
                      'Show rotation previews'
                    )
              }
            >
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                aria-pressed={showRotations}
                startIcon={
                  <SubjectRoundedIcon sx={{ fontSize: '17px !important' }} />
                }
                onClick={() => setShowRotations((v) => !v)}
                sx={{
                  height: 34,
                  px: { xs: 1, sm: 1.35 },
                  minWidth: 0,
                  flexShrink: 0,
                  textTransform: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.75 } },
                  ...(showRotations
                    ? {
                        color: giTokens.goldLight,
                        borderColor: alpha(giTokens.gold, 0.5),
                        bgcolor: alpha(giTokens.gold, 0.12),
                      }
                    : {
                        color: 'text.secondary',
                        borderColor: tokens.hairlineStrong,
                      }),
                }}
              >
                <Box
                  component="span"
                  sx={{ display: { xs: 'none', sm: 'inline' } }}
                >
                  {t('page_team:teamOpt.versions.rotationsToggle', 'Rotations')}
                </Box>
              </Button>
            </Tooltip>
            <Tooltip
              arrow
              title={
                selecting
                  ? t(
                      'page_team:teamOpt.versions.doneSelecting',
                      'Exit selection mode'
                    )
                  : t(
                      'page_team:teamOpt.versions.selectMultiple',
                      'Select versions to delete'
                    )
              }
            >
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                aria-pressed={selecting}
                startIcon={
                  <ChecklistRoundedIcon sx={{ fontSize: '17px !important' }} />
                }
                onClick={() => {
                  if (selecting) exitSelecting()
                  else {
                    setEditing(undefined)
                    setSelecting(true)
                  }
                }}
                sx={{
                  height: 34,
                  px: { xs: 1, sm: 1.35 },
                  minWidth: 0,
                  flexShrink: 0,
                  textTransform: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.75 } },
                  ...(selecting
                    ? {
                        color: giTokens.goldLight,
                        borderColor: alpha(giTokens.gold, 0.5),
                        bgcolor: alpha(giTokens.gold, 0.12),
                      }
                    : {
                        color: 'text.secondary',
                        borderColor: tokens.hairlineStrong,
                      }),
                }}
              >
                <Box
                  component="span"
                  sx={{ display: { xs: 'none', sm: 'inline' } }}
                >
                  {selecting
                    ? t('page_team:teamOpt.versions.selectDone', 'Done')
                    : t('page_team:teamOpt.versions.selectBtn', 'Select')}
                </Box>
              </Button>
            </Tooltip>
          </Box>

          {/* Single horizontal scrollable character filter strip (only when 3+ teams exist) */}
          {all.length >= 3 && filterChars.length > 0 && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.625,
                overflowX: 'auto',
                pb: 0.25,
                '&::-webkit-scrollbar': { height: 4 },
                '&::-webkit-scrollbar-thumb': {
                  bgcolor: tokens.hairlineStrong,
                  borderRadius: 4,
                },
              }}
            >
              {filterChars.map(({ key: ck, count }) => {
                const selected = activeCharFilter.includes(ck)
                return (
                  <ButtonBase
                    key={ck}
                    aria-pressed={selected}
                    onClick={() =>
                      setCharFilter((prev) =>
                        prev.includes(ck)
                          ? prev.filter((k) => k !== ck)
                          : [...prev, ck]
                      )
                    }
                    sx={(theme) => ({
                      ...focusSx,
                      ...quickSx,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.5,
                      height: 28,
                      pl: 0.5,
                      pr: 1,
                      flexShrink: 0,
                      borderRadius: tokens.radius.pill,
                      border: hairline,
                      bgcolor: tokens.inset,
                      color: 'text.secondary',
                      fontSize: 12.5,
                      fontWeight: 550,
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        borderColor: tokens.hairlineStrong,
                        color: 'text.primary',
                      },
                      ...(selected && {
                        ...selectedSx(theme),
                        color: giTokens.goldLight,
                        fontWeight: 650,
                      }),
                    })}
                  >
                    <MemberAvatar characterKey={ck} size={20} />
                    <span>{charName(ck)}</span>
                    <Box
                      component="span"
                      sx={{ ...numSx, opacity: 0.6, fontSize: 11.5 }}
                    >
                      {count}
                    </Box>
                  </ButtonBase>
                )
              })}
              {hasActiveFilter && (
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    setQuery('')
                    setCharFilter([])
                  }}
                  sx={{
                    minHeight: 26,
                    minWidth: 0,
                    px: 1,
                    fontSize: 12.5,
                    flexShrink: 0,
                    color: 'text.secondary',
                  }}
                >
                  {t('page_team:teamOpt.versions.clearFilters', 'Clear')}
                </Button>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Scrollable versions list */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          px: { xs: 1.5, sm: 3 },
          py: 2,
        }}
      >
        {hasActiveFilter && displayed.length > 0 && (
          <Typography sx={{ ...type.label, ...numSx, fontSize: 12, mb: 1 }}>
            {t('page_team:teamOpt.versions.showingCount', {
              defaultValue: 'Showing {{shown}} of {{total}}',
              shown: displayed.length,
              total: all.length,
            })}
          </Typography>
        )}
        <Box sx={{ ...insetSx, overflow: 'hidden' }}>
          {displayed.length === 0 ? (
            <Box
              sx={{
                px: 2,
                py: 4,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                textAlign: 'center',
              }}
            >
              <Typography sx={type.label}>
                {t(
                  'page_team:teamOpt.versions.noMatches',
                  'No versions match the current filter.'
                )}
              </Typography>
              <Button
                size="small"
                color="inherit"
                onClick={() => {
                  setQuery('')
                  setCharFilter([])
                }}
              >
                {t('page_team:teamOpt.versions.clearFilters', 'Clear')}
              </Button>
            </Box>
          ) : (
            displayed.map((row) => {
              const isOriginal = row.id === rootId
              return (
                <Fragment key={row.id}>
                  <VersionLine
                    row={row}
                    original={isOriginal}
                    current={row.id === teamId}
                    rootMembers={rows.root.members}
                    rootKqm={rootKqm}
                    rank={hasVersions ? rankById.get(row.id) : undefined}
                    maxDps={hasVersions ? maxDps : undefined}
                    showRotation={showRotations}
                    selecting={selecting}
                    selected={selectedIds.has(row.id)}
                    onToggleSelect={() => toggleSelectId(row.id)}
                    queued={queue.includes(row.id)}
                    editing={editing === row.id}
                    onOpen={() => open(row.id)}
                    onRun={() => run([row.id])}
                    onEdit={() =>
                      setEditing((now) => (now === row.id ? undefined : row.id))
                    }
                    onDuplicate={() => setCreating({ from: row.id })}
                    onToggleTeams={() =>
                      setShowInTeams(database, row.id, !row.showInTeams)
                    }
                    onMakeOriginal={() => {
                      if (!makeOriginal(database, row.id, { i18n, gender }))
                        return
                      setPanelFor(row.id)
                    }}
                    onDelete={() => {
                      if (queue.includes(row.id)) stopVersionRuns(database)
                      if (row.id !== teamId) {
                        database.teams.remove(row.id)
                        return
                      }
                      removeOnLeaving = row.id
                      navigate(`/teams/${rootId}/kqm`)
                    }}
                  />
                  <Collapse in={editing === row.id} timeout={180} unmountOnExit>
                    <VersionRotationEditor
                      teamId={row.id}
                      onClose={() => setEditing(undefined)}
                      onSaved={() => {
                        setEditing(undefined)
                        run([row.id])
                      }}
                    />
                  </Collapse>
                </Fragment>
              )
            })
          )}
          {!hasVersions && (
            <Typography
              sx={{ ...type.label, px: 2, py: 1.75, borderTop: hairline }}
            >
              {t(
                'page_team:teamOpt.versions.noVariants',
                'Create a variant to compare lineups, constellations, or signature weapons using this team’s KQM settings.'
              )}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Sticky footer: bulk delete bar while selecting, else run bar */}
      {selecting && hasVersions ? (
        <Box
          sx={{
            borderTop: hairline,
            bgcolor: tokens.panel,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            px: { xs: 1.5, sm: 3 },
            py: 1.25,
          }}
        >
          <Typography sx={{ ...type.body, fontWeight: 600, ...numSx }}>
            {t('page_team:teamOpt.versions.selectedCount', {
              defaultValue: '{{count}} selected',
              count: activeSelectedIds.length,
            })}
          </Typography>
          {displayedDeletableIds.length > 0 && (
            <Button
              size="small"
              color="inherit"
              onClick={() =>
                setSelectedIds((prev) => {
                  const next = new Set(prev)
                  if (allDisplayedSelected) {
                    for (const id of displayedDeletableIds) next.delete(id)
                  } else {
                    for (const id of displayedDeletableIds) next.add(id)
                  }
                  return next
                })
              }
              sx={{
                minHeight: 30,
                textTransform: 'none',
                color: 'text.secondary',
              }}
            >
              {allDisplayedSelected
                ? t('page_team:teamOpt.versions.deselectAll', 'Deselect all')
                : t('page_team:teamOpt.versions.selectAll', 'Select all')}
            </Button>
          )}
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            color="inherit"
            onClick={exitSelecting}
            sx={{ minHeight: 32, textTransform: 'none' }}
          >
            {t('page_team:teamOpt.versions.cancel', 'Cancel')}
          </Button>
          <Button
            size="small"
            color="error"
            variant="contained"
            disabled={activeSelectedIds.length === 0}
            startIcon={<DeleteOutlineIcon />}
            onClick={() => setConfirmBulkDelete(true)}
            sx={{ minHeight: 32, textTransform: 'none', fontWeight: 600 }}
          >
            {t('page_team:teamOpt.versions.deleteSelected', {
              defaultValue: 'Delete {{count}}',
              count: activeSelectedIds.length,
            })}
          </Button>
        </Box>
      ) : (
        (hasVersions || toRun.length > 0 || running) && (
          <Box
            sx={{
              position: 'relative',
              borderTop: hairline,
              bgcolor: tokens.panel,
              flexShrink: 0,
            }}
          >
            {running && (
              <LinearProgress
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  bgcolor: 'transparent',
                  '& .MuiLinearProgress-bar': { bgcolor: giTokens.gold },
                }}
              />
            )}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: { xs: 1.5, sm: 3 },
                py: 1.25,
              }}
            >
              <Typography sx={{ ...type.label, flex: 1, minWidth: 0 }}>
                {running
                  ? t('page_team:teamOpt.versions.running', {
                      defaultValue:
                        'Running {{count}} in the background: you can keep working',
                      count: queue.length,
                    })
                  : toRun.length > 0
                    ? t('page_team:teamOpt.versions.toRun', {
                        defaultValue: '{{count}} not run with these settings',
                        count: toRun.length,
                      })
                    : t(
                        'page_team:teamOpt.versions.allRun',
                        'All run with these settings'
                      )}
              </Typography>
              {running ? (
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => stopVersionRuns(database)}
                >
                  {t('page_team:teamOpt.versions.stop', 'Stop')}
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
                      {t('page_team:teamOpt.versions.runEvery', 'Run all')}
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
                      ? t('page_team:teamOpt.versions.runAll', {
                          defaultValue: 'Run {{count}}',
                          count: toRun.length,
                        })
                      : t('page_team:teamOpt.versions.runEvery', 'Run all')}
                  </Button>
                </>
              )}
            </Box>
          </Box>
        )
      )}

      {confirmBulkDelete && (
        <ModalWrapper
          open
          onClose={() => setConfirmBulkDelete(false)}
          containerProps={{ maxWidth: 'xs' }}
        >
          <CardThemed sx={{ p: 2 }}>
            <Typography sx={type.title}>
              {t('page_team:teamOpt.versions.bulkDeleteTitle', {
                defaultValue: 'Delete {{count}} versions?',
                count: activeSelectedIds.length,
              })}
            </Typography>
            <Typography sx={{ ...type.label, mt: 1 }}>
              {t(
                'page_team:teamOpt.versions.bulkDeleteText',
                'The selected versions, their rotations, and their results are permanently deleted. The original stays.'
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
              <Button
                color="inherit"
                onClick={() => setConfirmBulkDelete(false)}
              >
                {t('page_team:teamOpt.versions.cancel', 'Cancel')}
              </Button>
              <Button
                color="error"
                variant="contained"
                onClick={deleteSelected}
              >
                {t('page_team:teamOpt.versions.deleteSelected', {
                  defaultValue: 'Delete {{count}}',
                  count: activeSelectedIds.length,
                })}
              </Button>
            </Box>
          </CardThemed>
        </ModalWrapper>
      )}

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
            showInTeams,
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
              showInTeams,
              keepTeammates
            )
            if (id) run([id])
            return !!id
          }}
        />
      )}
      {combining && (
        <VersionCombosDialog
          teamId={rootId}
          onClose={() => setCombining(false)}
          onCreated={(ids) => run(ids)}
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
  rootKqm,
  rank,
  maxDps,
  showRotation,
  selecting,
  selected,
  onToggleSelect,
  queued,
  editing,
  onOpen,
  onRun,
  onEdit,
  onDuplicate,
  onToggleTeams,
  onMakeOriginal,
  onDelete,
}: {
  row: VersionRow
  original: boolean
  current: boolean
  rootMembers: CharacterKey[]
  rootKqm?: TeamOptKqm
  rank?: number
  maxDps?: number
  showRotation: boolean
  selecting: boolean
  selected: boolean
  onToggleSelect: () => void
  queued: boolean
  /** Its rotation is open to edit under it */
  editing: boolean
  onOpen: () => void
  onRun: () => void
  onEdit: () => void
  /** Opens the New version window as a copy of it */
  onDuplicate: () => void
  /** Pins or hides this version on the main Teams tab */
  onToggleTeams: () => void
  /** Makes it the family's original */
  onMakeOriginal: () => void
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation(['page_team', 'charNames_gen'])
  const { gender } = useDBMeta()
  const database = useDatabase()
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
    ? t('page_team:teamOpt.versions.statusRunning', {
        defaultValue: 'Running {{percent}}%',
        percent: Math.round((step?.progress ?? 0) * 100),
      })
    : queued
      ? t('page_team:teamOpt.versions.statusQueued', 'Waiting')
      : !shown
        ? t('page_team:teamOpt.versions.statusNew', 'Not run')
        : !row.fresh
          ? t('page_team:teamOpt.versions.statusStale', 'Out of date')
          : undefined

  // Auto-named versions display the clean 4-member roster on one line (highlighting changed
  // members) while constellation & signature badges live directly on the character portraits.
  const autoName = useMemo(
    () => versionName(row.members, row.cons, { i18n, gender }, row.sig),
    [row.members, row.cons, row.sig, i18n, gender]
  )
  const usesAutoName =
    !original && (row.name === autoName || row.name.startsWith(`${autoName} (`))
  const duplicateSuffix =
    usesAutoName && row.name.length > autoName.length
      ? row.name.slice(autoName.length)
      : ''

  const charName = (ck: CharacterKey) =>
    t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`)

  const barRatio =
    row.value !== undefined && maxDps && maxDps > 0
      ? Math.max(0, Math.min(1, row.value / maxDps))
      : undefined

  const rotationPreview = useMemo(() => {
    if (!showRotation) return undefined
    const rot = writtenRotationOf(database, kqmRotationId(row.id))
    if (!rot.text.trim()) return undefined
    return {
      rot,
      names: memberNamesOf(
        row.members.map((characterKey) => ({ characterKey })),
        i18n,
        gender
      ),
    }
  }, [showRotation, database, row.id, row.members, i18n, gender])

  const metaLine =
    status ??
    (shown?.rotationTime !== undefined
      ? t('page_team:teamOpt.versions.rotation', {
          defaultValue: '{{seconds}} s',
          seconds: shown.rotationTime.toFixed(1),
        })
      : t('page_team:teamOpt.versions.done', 'Up to date'))

  const progressPct = Math.round((step?.progress ?? 0) * 100)

  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        '& + &': { borderTop: hairline },
        ...(selecting && selected
          ? {
              bgcolor: alpha(theme.palette.error.main, 0.08),
              boxShadow: `inset 3px 0 0 ${alpha(theme.palette.error.main, 0.7)}`,
            }
          : current
            ? {
                bgcolor: alpha(theme.palette.primary.main, 0.065),
                boxShadow: `inset 3px 0 0 ${giTokens.gold}`,
              }
            : rowHoverSx),
        '& .ver-row-action': {
          opacity: editing ? 1 : 0.48,
          transition: 'opacity 140ms ease, color 140ms ease',
        },
        '&:hover .ver-row-action, &:focus-within .ver-row-action': {
          opacity: 1,
        },
      })}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          gap: 0.5,
        }}
      >
        {selecting && (
          <Box
            sx={{
              pl: { xs: 1, sm: 1.5 },
              pr: 0,
              mt: { xs: '12px', sm: 0 },
              display: 'flex',
              alignItems: 'center',
              flexShrink: 0,
            }}
          >
            <Checkbox
              size="small"
              disabled={original}
              checked={!original && selected}
              onChange={onToggleSelect}
              inputProps={{
                'aria-label': t('page_team:teamOpt.versions.selectRow', {
                  defaultValue: 'Select {{name}}',
                  name: row.name,
                }),
              }}
              sx={{
                p: 0.5,
                visibility: original ? 'hidden' : 'visible',
              }}
            />
          </Box>
        )}
        <ButtonBase
          onClick={
            selecting
              ? original
                ? undefined
                : onToggleSelect
              : current
                ? undefined
                : onOpen
          }
          disabled={selecting ? original : current}
          aria-label={row.name}
          sx={{
            ...focusSx,
            flex: 1,
            minWidth: 0,
            display: { xs: 'grid', sm: 'flex' },
            gridTemplateColumns: 'auto auto minmax(0, 1fr) auto',
            gridTemplateAreas: '"rank faces . value" "text text text text"',
            columnGap: 1.75,
            rowGap: 0.75,
            alignItems: 'center',
            justifyContent: 'flex-start',
            textAlign: 'left',
            pl: selecting ? 0.5 : { xs: 1.5, sm: 2 },
            pr: selecting ? 2 : 1,
            py: 1.35,
            borderRadius: 0,
          }}
        >
          {maxDps !== undefined && (
            <Typography
              component="span"
              sx={{
                gridArea: 'rank',
                width: 22,
                textAlign: 'right',
                flexShrink: 0,
                ...numSx,
                fontSize: rank === 1 ? 14 : 13,
                fontWeight: rank === 1 ? 750 : 550,
                color:
                  rank === 1 && row.fresh
                    ? giTokens.goldLight
                    : 'text.disabled',
              }}
            >
              {rank !== undefined ? rank : '–'}
            </Typography>
          )}
          <Box
            sx={{
              gridArea: 'faces',
              display: 'flex',
              gap: 0.75,
              flexShrink: 0,
            }}
          >
            {row.members.map((k) => {
              const effCons = row.cons[k] ?? kqmMemberConstellation(k, rootKqm)
              const ownCons = !original && k in row.cons
              const sigRef = row.sig[k]
              const highlighted =
                !original &&
                (!rootMembers.includes(k) || ownCons || sigRef !== undefined)
              const tipParts = [
                `${charName(k)} C${effCons}`,
                sigRef !== undefined ? (sigRef ? `R${sigRef}` : 'no sig') : '',
              ].filter(Boolean)
              return (
                <Tooltip key={k} arrow title={tipParts.join(' · ')}>
                  <Box sx={{ lineHeight: 0 }}>
                    <VersionPortrait
                      characterKey={k}
                      size={44}
                      constellation={effCons}
                      ownConstellation={ownCons}
                      signature={sigRef}
                      highlighted={highlighted}
                    />
                  </Box>
                </Tooltip>
              )
            })}
          </Box>
          <Box sx={{ gridArea: 'text', flex: 1, minWidth: 0 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.875,
                minWidth: 0,
              }}
            >
              {usesAutoName ? (
                <Typography
                  noWrap
                  title={row.name}
                  sx={{
                    fontSize: 14.5,
                    lineHeight: 1.35,
                    minWidth: 0,
                  }}
                >
                  {row.members.map((k, idx) => {
                    const changed =
                      !rootMembers.includes(k) || k in row.cons || k in row.sig
                    return (
                      <Fragment key={k}>
                        {idx > 0 && (
                          <Box
                            component="span"
                            sx={{ color: 'text.disabled', mx: 0.625 }}
                          >
                            ·
                          </Box>
                        )}
                        <Box
                          component="span"
                          sx={{
                            fontWeight: changed ? 650 : 500,
                            color: changed ? 'text.primary' : 'text.secondary',
                          }}
                        >
                          {charName(k)}
                        </Box>
                      </Fragment>
                    )
                  })}
                  {duplicateSuffix && (
                    <Box
                      component="span"
                      sx={{ color: 'text.secondary', fontWeight: 500 }}
                    >
                      {duplicateSuffix}
                    </Box>
                  )}
                </Typography>
              ) : (
                <Typography
                  noWrap
                  title={row.name}
                  sx={{
                    fontSize: 14.5,
                    fontWeight: 650,
                    lineHeight: 1.35,
                    color: 'text.primary',
                    minWidth: 0,
                  }}
                >
                  {row.name}
                </Typography>
              )}
              {original && (
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
                  {t('page_team:teamOpt.versions.original', 'Original')}
                </Box>
              )}
              {/* juanlab: a version whose teammates keep the original's gear */}
              {!original && row.keeps && (
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
                  {t(
                    'page_team:teamOpt.versions.keptTag',
                    "Teammates' gear kept"
                  )}
                </Box>
              )}
              {!original && row.showInTeams && (
                <Tooltip
                  arrow
                  title={t(
                    'page_team:teamOpt.versions.inTeamsTip',
                    'Shown on the main Teams tab'
                  )}
                >
                  <Box
                    component="span"
                    sx={{
                      ...type.label,
                      fontSize: 11,
                      px: 0.75,
                      py: '1px',
                      borderRadius: tokens.radius.pill,
                      border: hairline,
                      color: 'text.secondary',
                      flexShrink: 0,
                    }}
                  >
                    {t('page_team:teamOpt.versions.inTeams', 'In Teams')}
                  </Box>
                </Tooltip>
              )}
            </Box>
            <Typography
              noWrap
              sx={{ ...type.label, ...numSx, fontSize: 12.5, mt: 0.25 }}
            >
              {metaLine}
            </Typography>
          </Box>
          <Box
            sx={{
              gridArea: 'value',
              textAlign: 'right',
              flexShrink: 0,
              minWidth: 92,
            }}
          >
            {runningNow ? (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: 0.875,
                }}
                aria-live="polite"
              >
                {earlyValue !== undefined && (
                  <Typography
                    sx={{
                      fontSize: 15,
                      fontWeight: 600,
                      ...numSx,
                      color: 'text.secondary',
                    }}
                  >
                    ≈{formatRateFull(earlyValue, undefined, i18n?.language)}
                  </Typography>
                )}
                <Box
                  sx={{
                    position: 'relative',
                    display: 'inline-flex',
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                  }}
                >
                  <CircularProgress
                    variant="determinate"
                    value={100}
                    size={18}
                    thickness={5}
                    sx={{
                      color: alpha(giTokens.parchment, 0.14),
                      position: 'absolute',
                    }}
                  />
                  <CircularProgress
                    size={18}
                    thickness={5}
                    variant={progressPct >= 8 ? 'determinate' : 'indeterminate'}
                    value={progressPct}
                    sx={{ color: giTokens.gold }}
                  />
                </Box>
              </Box>
            ) : (
              <Typography
                sx={{
                  fontSize: 16,
                  lineHeight: 1.2,
                  letterSpacing: '-0.015em',
                  ...numSx,
                  fontWeight: 700,
                  color:
                    row.value === undefined
                      ? 'text.disabled'
                      : row.fresh
                        ? rank === 1
                          ? giTokens.goldLight
                          : 'text.primary'
                        : 'text.disabled',
                }}
              >
                {row.value !== undefined
                  ? formatRateFull(row.value, undefined, i18n?.language)
                  : '–'}
              </Typography>
            )}
          </Box>
        </ButtonBase>

        {/* Compact aligned right actions — hidden while bulk-selecting to keep focus clean */}
        {!selecting && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.25,
              pr: 1,
              mt: { xs: '10px', sm: 0 },
              flexShrink: 0,
            }}
          >
            {!runningNow && !queued && !row.fresh && (
              <Button size="small" onClick={onRun} sx={{ minWidth: 0, px: 1 }}>
                {t('page_team:teamOpt.versions.run', 'Run')}
              </Button>
            )}
            {!narrow && (
              <Tooltip
                title={t(
                  'page_team:teamOpt.versions.editRotation',
                  'Edit its rotation'
                )}
              >
                <IconButton
                  className="ver-row-action"
                  size="small"
                  onClick={onEdit}
                  aria-label={t(
                    'page_team:teamOpt.versions.editRotation',
                    'Edit its rotation'
                  )}
                  aria-expanded={editing}
                  sx={{ color: editing ? 'primary.main' : 'text.secondary' }}
                >
                  <EditOutlinedIcon sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
            )}
            <IconButton
              className="ver-row-action"
              size="small"
              onClick={(e) => setMenu(e.currentTarget)}
              aria-label={t('page_team:teamOpt.versions.more', 'More')}
              aria-haspopup="menu"
              sx={{
                color: editing && narrow ? 'primary.main' : 'text.secondary',
                '&:hover': { color: 'text.primary' },
              }}
            >
              <MoreVertRoundedIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Box>
        )}
      </Box>

      {/* Recessed rotation preview strip */}
      {rotationPreview && !editing && (
        <Box
          sx={{
            ml:
              maxDps !== undefined ? { xs: 1.5, sm: 6.25 } : { xs: 1.5, sm: 2 },
            mr: { xs: 1.5, sm: 2 },
            mb: 1.25,
            px: 1.25,
            py: 0.625,
            borderRadius: tokens.radius.control,
            bgcolor: alpha(giTokens.parchment, 0.028),
            border: hairline,
            '& span': { fontSize: '12.5px !important' },
          }}
        >
          <RotationReadout
            text={rotationPreview.rot.text}
            opener={rotationPreview.rot.opener}
            counted={false}
            names={rotationPreview.names}
          />
        </Box>
      )}

      {/* Subtle proportional DPS bar */}
      {barRatio !== undefined && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 2,
            pointerEvents: 'none',
          }}
        >
          <Box
            sx={{
              height: '100%',
              width: `${barRatio * 100}%`,
              bgcolor:
                rank === 1 && row.fresh
                  ? alpha(giTokens.gold, 0.5)
                  : alpha(giTokens.parchment, row.fresh ? 0.1 : 0.045),
              transition: `width 240ms ${tokens.ease}`,
            }}
          />
        </Box>
      )}

      <Menu
        anchorEl={menu}
        open={!!menu}
        onClose={() => setMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {canRerun && (
          <MenuItem
            onClick={() => {
              setMenu(null)
              onRun()
            }}
          >
            <ListItemIcon>
              <ReplayRoundedIcon fontSize="small" />
            </ListItemIcon>
            {t('page_team:teamOpt.versions.runAgain', 'Run again')}
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
            {t('page_team:teamOpt.versions.editRotation', 'Edit its rotation')}
          </MenuItem>
        )}
        {!original && (
          <MenuItem
            onClick={() => {
              setMenu(null)
              onToggleTeams()
            }}
          >
            <ListItemIcon>
              {row.showInTeams ? (
                <VisibilityOffOutlinedIcon fontSize="small" />
              ) : (
                <VisibilityOutlinedIcon fontSize="small" />
              )}
            </ListItemIcon>
            {row.showInTeams
              ? t(
                  'page_team:teamOpt.versions.hideFromTeams',
                  'Hide from Teams tab'
                )
              : t(
                  'page_team:teamOpt.versions.showInTeams',
                  'Show in Teams tab'
                )}
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
          {t('page_team:teamOpt.versions.duplicate', 'Duplicate')}
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
            {t(
              'page_team:teamOpt.versions.makeOriginal',
              'Make it the original'
            )}
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
            {t('page_team:teamOpt.versions.delete', 'Delete this version')}
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
              {t('page_team:teamOpt.versions.deleteTitle', {
                defaultValue: 'Delete “{{name}}”?',
                name: row.name,
              })}
            </Typography>
            <Typography sx={{ ...type.label, mt: 1 }}>
              {t(
                'page_team:teamOpt.versions.deleteText',
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
                {t('page_team:teamOpt.versions.cancel', 'Cancel')}
              </Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => {
                  setConfirm(false)
                  onDelete()
                }}
              >
                {t('page_team:teamOpt.versions.deleteConfirm', 'Delete')}
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
    showInTeams?: boolean,
    /** juanlab: its teammates keep the original's builds */
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
  const [showInTeams, setShowInTeams] = useState(false)
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
                  : t('teamOpt.versions.newVariant', 'New variant')}
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
              flexWrap: 'wrap',
              gap: 1,
              mt: 2,
            }}
          >
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  disabled={busy}
                  checked={showInTeams}
                  onChange={(_, checked) => setShowInTeams(checked)}
                />
              }
              label={t(
                'teamOpt.versions.showInTeamsOption',
                'Also show in Teams tab'
              )}
              sx={{
                mr: 'auto',
                ml: -0.5,
                '& .MuiFormControlLabel-label': { ...type.label },
              }}
            />
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
                    showInTeams,
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
export function VersionNote({
  rootId,
  teamId,
}: {
  rootId: string
  teamId?: string
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const navigate = useNavigate()
  useDataManagerValues(database.teams)
  const name = database.teams.get(rootId)?.name ?? ''
  const shownInTeams = teamId
    ? !!database.teams.get(teamId)?.showInTeams
    : false
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
      {teamId && (
        <Tooltip
          arrow
          title={
            shownInTeams
              ? t(
                  'teamOpt.versions.hideFromTeamsTip',
                  'Shown on the main Teams tab — click to keep it only in Versions.'
                )
              : t(
                  'teamOpt.versions.showInTeamsTip',
                  'Hidden from the main Teams tab — click to also list it there.'
                )
          }
        >
          <Button
            size="small"
            color="inherit"
            variant="outlined"
            startIcon={
              shownInTeams ? (
                <VisibilityOutlinedIcon sx={{ fontSize: '16px !important' }} />
              ) : (
                <VisibilityOffOutlinedIcon
                  sx={{ fontSize: '16px !important' }}
                />
              )
            }
            onClick={() => setShowInTeams(database, teamId, !shownInTeams)}
            sx={{
              minHeight: 30,
              textTransform: 'none',
              borderColor: shownInTeams
                ? alpha(giTokens.gold, 0.5)
                : tokens.hairlineStrong,
              color: shownInTeams ? giTokens.goldLight : 'text.secondary',
              bgcolor: shownInTeams ? alpha(giTokens.gold, 0.1) : 'transparent',
            }}
          >
            {shownInTeams
              ? t('teamOpt.versions.inTeams', 'In Teams')
              : t('teamOpt.versions.showInTeams', 'Show in Teams tab')}
          </Button>
        </Tooltip>
      )}
      <Button
        size="small"
        endIcon={<ArrowForwardIcon />}
        onClick={() => navigate(`/teams/${rootId}/kqm`)}
        sx={{ minHeight: 30 }}
      >
        {t('teamOpt.versions.openOriginal', 'Open the original')}
      </Button>
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
        // juanlab: the damage per rotation too, when the figure is per second
        dpr: time ? formatRateFull(summary.total, undefined) : undefined,
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
        dpr: 'DPR',
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
            ? {
                ...m,
                details: kqmCardDetails(t as unknown as TFunction, ms, locale),
              }
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
              height: 34,
              px: 1.5,
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
  const { t, i18n } = useTranslation('page_team')
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
                        ? formatRateFull(row.value, undefined, i18n?.language)
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
export function RotationFields({
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
