import {
  useDataEntryBase,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import {
  useBoolState,
  useMediaQueryUp,
} from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  EmptyState,
  ModalWrapper,
  notePendingNavigation,
  PageHeader,
  SortByButton,
  useInfScroll,
  useTitle,
} from '@genshin-optimizer/common/ui'
import { filterFunction, sortFunction } from '@genshin-optimizer/common/util'
import type { TeamSortKey } from '@genshin-optimizer/gi/db'
import {
  teamSortKeys,
  validateCustomMultiTarget,
} from '@genshin-optimizer/gi/db'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { preloadNamespaces } from '@genshin-optimizer/gi/i18n'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import { CharacterMultiAutocomplete, TeamCard } from '@genshin-optimizer/gi/ui'
import AddIcon from '@mui/icons-material/Add'
import GroupsIcon from '@mui/icons-material/Groups'
import SearchIcon from '@mui/icons-material/Search'
import UploadIcon from '@mui/icons-material/Upload'
import {
  Alert,
  Box,
  Button,
  CardContent,
  CardHeader,
  Divider,
  InputAdornment,
  Skeleton,
  TextField,
  Typography,
} from '@mui/material'
import type { ChangeEvent } from 'react'
import {
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { teamFilterConfigs, teamSortConfigs, teamSortMap } from './TeamSort'

const numToShowMap = { xs: 6, sm: 12, md: 18, lg: 24, xl: 24 }

export default function PageTeams() {
  // The team cards also use 'statKey_gen'; fetch it together with the page's namespaces.
  preloadNamespaces(['statKey_gen', 'elementalResonance_gen'])
  const { t } = useTranslation([
    'page_team',
    'page_teams',
    // Always load these 2 so character names are loaded for searching/sorting
    'charNames_gen',
  ])
  const database = useDatabase()
  const navigate = useNavigate()
  const location = useLocation()

  // Account for the case of switching from a team -> teams page, since they have the same base /teams url
  useTitle()

  const onAdd = () => {
    const newid = database.teams.new()
    // the new team page opens its member picker straight away
    navigate(newid, { state: { openQuickSetup: true } })
  }
  const [showImport, onShowImport, onHideImportModal] = useBoolState()
  const [data, setData] = useState('')
  // why the pasted data could not be imported (shown in the dialog, which stays open)
  const [importError, setImportError] = useState<string>()
  const onHideImport = useCallback(() => {
    setImportError(undefined)
    onHideImportModal()
  }, [onHideImportModal])
  // Automatically open the import modal if the state indicates to do so
  useEffect(() => {
    if (location.state?.openImportModal) {
      setData(location.state?.teamData)
      onShowImport()
    }
  }, [location.state, onShowImport, setData])
  const importData = () => {
    let dataObj: unknown
    try {
      dataObj = JSON.parse(data)
    } catch (e) {
      setImportError(`${t('importForm.error.import')} ${e}`)
      return
    }
    try {
      const imported = database.teams.import(dataObj)
      if (imported) {
        setData('')
        onHideImport()
        navigate(imported)
        return
      }
    } catch (e) {
      console.error(e)
    }
    // (a character's multi-target setup, copied from its Optimize tab: imported there, not here)
    setImportError(
      validateCustomMultiTarget(dataObj)
        ? t('importForm.error.multiOpt')
        : t('importForm.error.verifi')
    )
  }
  const displayTeam = useDataEntryBase(database.displayTeam)
  const { sortType, ascending, charKeys } = displayTeam

  const [searchTerm, setSearchTerm] = useState(displayTeam.searchTerm)
  const deferredSearchTerm = useDeferredValue(searchTerm)
  useEffect(() => {
    database.displayTeam.set({ searchTerm: deferredSearchTerm })
  }, [database, deferredSearchTerm])

  const teamsDirty = useDataManagerValues(database.teams)
  const totalTeamNum = teamsDirty.length
  const filteredTeamIds = useMemo(
    () =>
      teamsDirty &&
      database.teams.keys
        .filter(
          filterFunction(
            { charKeys, name: deferredSearchTerm },
            teamFilterConfigs(database)
          )
        )
        .sort((k1, k2) => {
          return sortFunction(
            teamSortMap[sortType],
            ascending,
            teamSortConfigs()
          )(database.teams.get(k1)!, database.teams.get(k2)!)
        }),
    [teamsDirty, database, charKeys, deferredSearchTerm, sortType, ascending]
  )
  const brPt = useMediaQueryUp()

  const { numShow, setTriggerElement } = useInfScroll(
    numToShowMap[brPt],
    filteredTeamIds.length
  )

  const TeamIdsToShow = useMemo(
    () => filteredTeamIds.slice(0, numShow),
    [filteredTeamIds, numShow]
  )

  const filtered = filteredTeamIds.length !== totalTeamNum

  return (
    <Box display="flex" flexDirection="column" gap={2}>
      <PageHeader
        title={t('ui:tabs.teams')}
        count={totalTeamNum}
        actions={
          <>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={<UploadIcon />}
              onClick={onShowImport}
            >
              {t('page_teams:header.import')}
            </Button>
            <Button sx={giCtaSx} startIcon={<AddIcon />} onClick={onAdd}>
              {t('page_teams:header.create')}
            </Button>
          </>
        }
      />
      {/* one quiet row: find a team by name or by who is in it, then order the list */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <TextField
          autoFocus={brPt !== 'xs' && brPt !== 'sm'}
          size="small"
          value={searchTerm}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
            setSearchTerm(e.target.value)
          }
          placeholder={t('page_teams:toolbar.search', 'Search teams')}
          inputProps={{ 'aria-label': t('searchLabel.team') }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{ width: { xs: '100%', sm: 280 } }}
        />
        <CharacterMultiAutocomplete
          teamIds={filteredTeamIds}
          charKeys={charKeys}
          setCharKey={(charKeys) => database.displayTeam.set({ charKeys })}
          acProps={{
            size: 'small',
            sx: { flexGrow: 1, minWidth: 240, maxWidth: { lg: 560 } },
          }}
        />
        <Box
          sx={{
            ml: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            flexWrap: 'wrap',
          }}
        >
          {filtered && (
            <Typography color="text.secondary" sx={{ fontSize: '0.875rem' }}>
              {t('page_teams:toolbar.filtered', {
                defaultValue: '{{count}} of {{total}} teams',
                count: filteredTeamIds.length,
                total: totalTeamNum,
              })}
            </Typography>
          )}
          <SortByButton
            size="small"
            sortKeys={[...teamSortKeys]}
            value={sortType}
            onChange={(sortType: TeamSortKey) =>
              database.displayTeam.set({ sortType })
            }
            ascending={ascending}
            onChangeAsc={(ascending: boolean) =>
              database.displayTeam.set({ ascending })
            }
          />
        </Box>
      </Box>

      <ModalWrapper open={showImport} onClose={onHideImport}>
        <CardThemed>
          <CardHeader title={t('importForm.title')} />
          <Divider />
          <CardContent
            sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
          >
            <Typography>{t('importForm.desc')}</Typography>
            <TextField
              fullWidth
              label={t('importForm.label')}
              placeholder={t('importForm.placeholder')}
              value={data}
              onChange={(e) => {
                setData(e.target.value)
                setImportError(undefined)
              }}
              multiline
              rows={4}
            />
            {importError && <Alert severity="error">{importError}</Alert>}
            <Button
              startIcon={<UploadIcon />}
              disabled={!data}
              onClick={importData}
            >
              {t('importForm.importBtn')}
            </Button>
          </CardContent>
        </CardThemed>
      </ModalWrapper>
      {totalTeamNum === 0 && (
        <EmptyState
          icon={<GroupsIcon />}
          title={t('page_teams:empty.title')}
          description={t('page_teams:empty.description')}
          actions={
            <>
              <Button onClick={onAdd} startIcon={<AddIcon />}>
                {t('page_teams:empty.create')}
              </Button>
              <Button
                variant="outlined"
                color="inherit"
                onClick={onShowImport}
                startIcon={<UploadIcon />}
              >
                {t('page_teams:empty.import')}
              </Button>
            </>
          }
        />
      )}
      {totalTeamNum > 0 && filteredTeamIds.length === 0 && (
        <EmptyState
          icon={<SearchIcon />}
          title={t('page_teams:empty.noMatches', 'No matching teams')}
          description={t(
            'page_teams:empty.noMatchesDesc',
            'Try a different name or clear the selected characters.'
          )}
          actions={
            <Button
              onClick={() => {
                setSearchTerm('')
                database.displayTeam.set({ searchTerm: '', charKeys: [] })
              }}
            >
              {t('page_teams:empty.clear', 'Clear filters')}
            </Button>
          }
        />
      )}
      <Suspense
        fallback={
          <Skeleton
            variant="rectangular"
            sx={{ width: '100%', height: '100%', minHeight: 5000 }}
          />
        }
      >
        {/* auto-fill: a wider page gets more cards per row, not wider cards */}
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns:
              'repeat(auto-fill, minmax(min(520px, 100%), 1fr))',
          }}
        >
          {TeamIdsToShow.map((tid) => (
            <Box key={tid} sx={{ minWidth: 0 }}>
              <Suspense
                fallback={
                  <Skeleton variant="rectangular" width="100%" height={150} />
                }
              >
                <TeamCard
                  teamId={tid}
                  bgt="light"
                  onClick={(cid) => {
                    // the team page takes a moment to render: show the progress bar meanwhile
                    notePendingNavigation()
                    navigate(`${tid}${cid ? `/${cid}` : ''}`)
                  }}
                />
              </Suspense>
            </Box>
          ))}
        </Box>
      </Suspense>
      {filteredTeamIds.length !== TeamIdsToShow.length && (
        <Skeleton
          ref={(node) => {
            if (!node) return
            setTriggerElement(node)
          }}
          sx={{ borderRadius: 1 }}
          variant="rectangular"
          width="100%"
          height={100}
        />
      )}
    </Box>
  )
}
