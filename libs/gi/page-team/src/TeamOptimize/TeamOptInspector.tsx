import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  KqmSets,
  TeamOptMemberOptions,
  TeamOptOption,
  TeamOptPick,
  TeamOptPicks,
  TeamOptPickView,
  TeamOptResult,
  TeamOptSession,
  TeamOptSetChoice,
} from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  teamOptSetKey,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import LeaderboardRoundedIcon from '@mui/icons-material/LeaderboardRounded'
import UndoIcon from '@mui/icons-material/Undo'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  alpha,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { startTransition, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatGain, formatRateFull } from './format'
import { SetLines } from './KqmBuildView'
import {
  CopyRankingButton,
  compactFieldSx,
  RankList,
  type RankOption,
  RankTabs,
  WeaponLabel,
} from './KqmComparison'
import { MemberAvatar } from './MemberAvatar'
import { insetSx, numSx, quickSx, tokens, type } from './ui'

/** Per result: a pick set's team and each member's rankings under it */
const worked = new WeakMap<
  TeamOptResult,
  Map<string, TeamOptPickView & { rankings?: TeamOptMemberOptions }>
>()
const picksKey = (picks: TeamOptPicks, characterKey: CharacterKey) =>
  `${JSON.stringify(Object.entries(picks))}#${characterKey}`

/** A Team optimize option as the KQM tab's rankings show one */
type Ranked = RankOption & { option: TeamOptOption }

function pickedSets({ set, setPair }: TeamOptSetChoice): KqmSets {
  const sets: KqmSets = {}
  if (set) sets[set as ArtifactSetKey] = 4
  for (const key of setPair ?? []) sets[key] = 2
  return sets
}

/**
 * The set rankings with the build the team has (found with any sets) among them when it is not 4
 * pieces of one set, best first: the best is then the build the team has, not the best 4 pieces
 */
export function withFoundBuild<
  T extends { total: number; sets: Partial<Record<string, number>> },
>(rows: readonly T[], found: T | undefined): T[] {
  const own =
    found && !Object.values(found.sets).some((n) => n === 4) ? [found] : []
  return [...own, ...rows].sort((a, b) => b.total - a.total)
}

/**
 * A member's equipment, as the KQM tab's inspector: pick a weapon or an artifact set (or both) and
 * its build is searched again from the inventory for it, teammates keeping the run's builds; the
 * page's figures follow. Beside it, the rankings under the pick: each weapon (with the set
 * picked), each set (with the weapon picked). Picks on several members add up.
 */
export function TeamOptInspector({
  characterKey,
  result,
  optionsRunning,
  onRank,
  session,
  picks,
  onPicks,
  view,
  onView,
  rotationTime,
}: {
  characterKey: CharacterKey
  /** The run's best team build */
  result: TeamOptResult
  /** Its first rankings are still being searched */
  optionsRunning: boolean
  onRank?: () => void
  session: () => Promise<TeamOptSession | undefined>
  picks: TeamOptPicks
  onPicks: (picks: TeamOptPicks) => void
  /** The team with the picks (undefined: the run's) */
  view: TeamOptPickView | undefined
  onView: (view: TeamOptPickView | undefined) => void
  rotationTime?: number
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const own: TeamOptPick = { weaponId: result.weapons[characterKey] ?? '' }
  const none = !Object.keys(picks).length
  const key = picksKey(picks, characterKey)
  // (the pick as soon as it is made: the page's update, heavier, comes after it)
  const [optimistic, setOptimistic] = useState<TeamOptPick>()
  useEffect(() => setOptimistic(undefined), [key])
  const pick = optimistic ??
    picks[characterKey] ?? {
      weaponId: (view?.weapons ?? result.weapons)[characterKey] ?? '',
    }
  const [rankings, setRankings] = useState<TeamOptMemberOptions | undefined>(
    () =>
      none
        ? result.options?.[characterKey]
        : worked.get(result)?.get(key)?.rankings
  )
  const [pending, setPending] = useState<'figures' | 'rankings'>()
  const [category, setCategory] = useState(0)

  // (the page's figures follow in the background: the inspector answers first)
  const show = useCallback(
    (next: TeamOptPickView | undefined) => startTransition(() => onView(next)),
    [onView]
  )
  useEffect(() => {
    if (none) {
      show(undefined)
      setRankings(result.options?.[characterKey])
      setPending(undefined)
      return undefined
    }
    const cache = worked.get(result) ?? new Map()
    worked.set(result, cache)
    const hit = cache.get(key)
    if (hit) {
      show(hit)
      if (hit.rankings) {
        setRankings(hit.rankings)
        setPending(undefined)
        return undefined
      }
    }
    let cancelled = false
    setPending(hit ? 'rankings' : 'figures')
    session()
      .then((s) =>
        s?.pick(picks, characterKey, {
          isCancelled: () => cancelled,
          onFigures: (next) => {
            if (cancelled) return
            cache.set(key, next)
            show(next)
            setPending('rankings')
          },
        })
      )
      .then((found) => {
        if (cancelled) return
        setPending(undefined)
        if (!found) return
        cache.set(key, found)
        setRankings(found.rankings)
      })
      .catch(() => !cancelled && setPending(undefined))
    return () => {
      cancelled = true
    }
  }, [key, none, result, characterKey, session, show, picks])

  const choose = (next: TeamOptPick) => {
    const rest = { ...picks }
    if (next.weaponId === own.weaponId && !teamOptSetKey(next))
      delete rest[characterKey]
    else rest[characterKey] = next
    setOptimistic(next)
    setPending(Object.keys(rest).length ? 'figures' : undefined)
    startTransition(() => onPicks(rest))
  }
  // (as the KQM rankings show them: the team's damage, its weapon and sets)
  const ranked = (options: TeamOptOption[] | undefined): Ranked[] =>
    (options ?? []).flatMap((option) => {
      const weapon = database.weapons.get(option.weaponId)
      if (!weapon) return []
      const sets = pickedSets(option)
      if (!teamOptSetKey(option)) {
        const count: Record<string, number> = {}
        for (const id of Object.values(option.artifactIds ?? {})) {
          const setKey = id ? database.arts.get(id)?.setKey : undefined
          if (setKey) count[setKey] = (count[setKey] ?? 0) + 1
        }
        for (const [setKey, n] of Object.entries(count))
          if (n >= 2) sets[setKey as ArtifactSetKey] = n >= 4 ? 4 : 2
      }
      return [
        {
          option,
          weapon: {
            key: weapon.key as WeaponKey,
            refinement: weapon.refinement,
          },
          sets,
          // (the run's team value as shown: options ranked on its scale)
          total:
            rankings && Number.isFinite(option.value)
              ? (option.value / rankings.best) * result.after.total
              : 0,
          unmet: !!option.unmet || !option.artifactIds,
        },
      ]
    })
  const weapons = ranked(rankings?.weapons)
  const total = (view ?? result).after.total
  const setRows = ranked(rankings?.sets)
  const found =
    rankings && !teamOptSetKey(pick)
      ? ranked([
          {
            weaponId: pick.weaponId,
            artifactIds: (view ?? result).builds[characterKey] as
              | TeamOptOption['artifactIds']
              | undefined,
            value: (rankings.best * total) / result.after.total,
          },
        ])[0]
      : undefined
  const represented =
    found &&
    setRows.some(({ option }) =>
      option.setPair?.every((key) => found.sets[key] === 2)
    )
  const sets = withFoundBuild(setRows, represented ? undefined : found)
  const list = category === 0 ? weapons : sets
  const busy = !!pending || (!rankings && optionsRunning)
  const changed = !!picks[characterKey]
  const weaponIds = [
    ...new Set([pick.weaponId, ...weapons.map((o) => o.option.weaponId)]),
  ]
  const setChoices = new Map<string, TeamOptSetChoice>()
  for (const { set, setPair } of [pick, ...sets.map(({ option }) => option)]) {
    const choice = { set, setPair }
    const key = teamOptSetKey(choice)
    if (key) setChoices.set(key, choice)
  }
  const shortfalls = (view ?? result).after.shortfalls?.[characterKey] ?? []
  const equipment = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <TextField
        select
        size="small"
        label={t('teamOpt.kqm.weaponLabel', 'Weapon')}
        value={pick.weaponId}
        disabled={weaponIds.length < 2}
        sx={compactFieldSx}
        SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 380 } } } }}
        onChange={(e) => choose({ ...pick, weaponId: e.target.value })}
      >
        {weaponIds.map((id) => {
          const weapon = database.weapons.get(id)
          return (
            weapon && (
              <MenuItem key={id} value={id}>
                <Box
                  component="span"
                  sx={{ color: 'text.secondary', mr: 0.75, ...numSx }}
                >
                  R{weapon.refinement}
                </Box>
                <WeaponName weaponKey={weapon.key as WeaponKey} />
              </MenuItem>
            )
          )
        })}
      </TextField>
      <TextField
        select
        size="small"
        label={t('teamOpt.kqm.setLabel', 'Artifact set')}
        value={teamOptSetKey(pick)}
        sx={compactFieldSx}
        InputLabelProps={{ shrink: true }}
        SelectProps={{
          displayEmpty: true,
          MenuProps: { PaperProps: { sx: { maxHeight: 380 } } },
        }}
        onChange={(e) =>
          choose({ weaponId: pick.weaponId, ...setChoices.get(e.target.value) })
        }
      >
        <MenuItem value="">
          {t('teamOpt.inspect.bestSet', 'Best of any set')}
        </MenuItem>
        {[...setChoices].map(([key, choice]) => (
          <MenuItem key={key} value={key}>
            <SetLines sets={pickedSets(choice)} />
          </MenuItem>
        ))}
      </TextField>
    </Box>
  )

  return (
    <Box
      component="section"
      aria-label={t('teamOpt.kqm.compareEquipment', 'Compare equipment')}
      sx={{ scrollMarginTop: 88 }}
    >
      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, lg: 2.5 },
          alignItems: 'start',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            lg: 'minmax(300px, 0.85fr) minmax(0, 1.55fr)',
          },
        }}
      >
        {/* the inspector: this member's build with the chosen weapon and set */}
        <Box
          sx={{
            ...insetSx,
            p: { xs: 1.5, sm: 2 },
            minWidth: 0,
            // (dimmed until the pick's build is found)
            opacity: pending === 'figures' ? 0.6 : 1,
            transition: 'opacity .18s',
          }}
        >
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mb: 1.75 }}
          >
            <MemberAvatar characterKey={characterKey} size={40} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography component="h3" noWrap sx={type.title}>
                <CharacterName characterKey={characterKey} gender={gender} />
              </Typography>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  columnGap: 0.75,
                }}
              >
                <Typography sx={type.stat}>
                  {formatRateFull(total, rotationTime)}
                </Typography>
                <Typography sx={{ ...type.label, fontSize: 12 }}>
                  {rotationTime
                    ? t('teamOpt.kqm.teamDps', 'team DPS')
                    : t('teamOpt.kqm.teamDmg', 'team DMG')}
                </Typography>
                {!none && (
                  <Typography
                    sx={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      ...numSx,
                      color:
                        total >= result.after.total
                          ? 'success.main'
                          : 'text.secondary',
                    }}
                  >
                    {formatGain(total / result.after.total - 1)}
                  </Typography>
                )}
              </Box>
            </Box>
            {changed && (
              <Button
                size="small"
                variant="text"
                color="inherit"
                startIcon={<UndoIcon sx={{ fontSize: 16 }} />}
                onClick={() => choose(own)}
                sx={{ color: 'text.secondary', ...quickSx }}
              >
                {t('teamOpt.kqm.resetShort', 'Reset')}
              </Button>
            )}
          </Box>
          {equipment}
          {!!view?.teammatesEr?.length && (
            <Tooltip
              arrow
              title={t(
                'teamOpt.kqm.teammatesErHelp',
                'The Energy Recharge the teammates need with this pick, and before it: its energy (Favonius particles, a weapon’s or set’s energy) changes theirs, and their artifacts are searched again'
              )}
            >
              <Box
                sx={{
                  mt: 1.5,
                  cursor: 'help',
                  width: 'fit-content',
                  maxWidth: '100%',
                }}
              >
                <Typography
                  sx={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: 'text.secondary',
                  }}
                >
                  {t('teamOpt.kqm.teammatesEr', 'Teammates’ ER required')}
                </Typography>
                {view.teammatesEr.map(({ characterKey: ck, from, to }) => (
                  <Box
                    key={ck}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 1,
                      color: 'text.secondary',
                      fontSize: 12.5,
                      lineHeight: 1.7,
                    }}
                  >
                    <Box component="span" sx={{ minWidth: 0 }}>
                      <CharacterName characterKey={ck} gender={gender} />
                    </Box>
                    <Box component="span" sx={{ ...numSx, flexShrink: 0 }}>
                      {from.toFixed(1)}% →{' '}
                      <Box
                        component="span"
                        sx={{
                          fontWeight: 600,
                          color: to < from ? 'success.main' : 'warning.main',
                        }}
                      >
                        {to.toFixed(1)}%
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Tooltip>
          )}
          {!!shortfalls.length && (
            <Typography
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                color: 'warning.main',
                fontSize: 12.5,
                mt: 1.5,
              }}
            >
              <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
              {t('teamOpt.kqm.requirementsUnmet', 'Requirements unmet')}
            </Typography>
          )}
        </Box>
        {/* the rankings: each row is the team with that weapon (or set) on this member */}
        <Box sx={{ minWidth: 0 }} aria-busy={busy}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              mb: 0.75,
            }}
          >
            <RankTabs
              value={category}
              onChange={setCategory}
              characterKey={characterKey}
              label={t('teamOpt.kqm.rankings', 'Equipment rankings')}
            />
            <InfoTooltipInline
              title={t(
                'teamOpt.inspect.compareTip',
                'Choose a set to re-rank weapons, or a weapon to re-rank sets. Its artifacts are searched again from your inventory. Teammates keep the builds from this run.'
              )}
            />
            <Box sx={{ flex: 1 }} />
            {list.length > 0 && (
              <CopyRankingButton
                options={list}
                kind={category === 0 ? 'weapons' : 'sets'}
                rotationTime={rotationTime}
              />
            )}
          </Box>
          {/* (a thin line while existing rankings update; its space is kept when a list is shown) */}
          {!!rankings && (
            <Box sx={{ height: 2, mb: 0.5 }}>
              {busy && (
                <LinearProgress
                  aria-label={t(
                    'teamOpt.kqm.updatingRankings',
                    'Updating rankings'
                  )}
                  sx={{ height: 2, borderRadius: 1 }}
                />
              )}
            </Box>
          )}
          <Box
            role="tabpanel"
            id={`kqm-${characterKey}-ranking`}
            aria-labelledby={`kqm-${characterKey}-${category === 0 ? 'weapons' : 'sets'}`}
            sx={{
              opacity: busy && rankings ? 0.55 : 1,
              transition: 'opacity .18s',
            }}
          >
            {!rankings && !busy && onRank ? (
              <Box
                sx={{
                  ...insetSx,
                  borderColor: tokens.hairlineStrong,
                  minHeight: 136,
                  px: { xs: 2, sm: 2.5 },
                  py: 2.25,
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  alignItems: { xs: 'flex-start', sm: 'center' },
                  justifyContent: 'space-between',
                  gap: 2,
                  backgroundImage: `radial-gradient(420px 180px at 0% 0%, ${alpha(tokens.gold, 0.08)}, transparent 70%)`,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 1.5,
                    minWidth: 0,
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: 2,
                      flexShrink: 0,
                      display: 'grid',
                      placeItems: 'center',
                      color: tokens.gold,
                      bgcolor: alpha(tokens.gold, 0.1),
                      border: `1px solid ${alpha(tokens.gold, 0.24)}`,
                    }}
                  >
                    <LeaderboardRoundedIcon sx={{ fontSize: 19 }} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      sx={{
                        fontSize: 14.5,
                        fontWeight: 650,
                        letterSpacing: '-0.005em',
                        lineHeight: 1.3,
                      }}
                    >
                      {t(
                        'teamOpt.inspect.rankTitle',
                        'Rank weapons & artifact sets'
                      )}
                    </Typography>
                    <Typography
                      sx={{
                        ...type.label,
                        mt: 0.4,
                        lineHeight: 1.45,
                        maxWidth: 420,
                      }}
                    >
                      {t(
                        'teamOpt.inspect.rankBody',
                        'Compare alternative weapons and artifact sets from your inventory while teammates keep their builds.'
                      )}
                    </Typography>
                  </Box>
                </Box>
                <Button
                  size="small"
                  onClick={onRank}
                  startIcon={<LeaderboardRoundedIcon sx={{ fontSize: 16 }} />}
                  sx={{
                    flexShrink: 0,
                    px: 1.75,
                    py: 0.75,
                    borderRadius: tokens.radius.control,
                    fontSize: 13,
                    fontWeight: 600,
                    textTransform: 'none',
                    color: tokens.gold,
                    bgcolor: alpha(tokens.gold, 0.12),
                    border: `1px solid ${alpha(tokens.gold, 0.38)}`,
                    ...quickSx,
                    '&:hover': {
                      bgcolor: alpha(tokens.gold, 0.2),
                      borderColor: alpha(tokens.gold, 0.65),
                    },
                  }}
                >
                  {t('teamOpt.result.rankEquipment', 'Rank equipment')}
                </Button>
              </Box>
            ) : !rankings && busy ? (
              <Box
                sx={{
                  ...insetSx,
                  borderColor: tokens.hairlineStrong,
                  minHeight: 136,
                  px: { xs: 2, sm: 2.5 },
                  py: 2.25,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                }}
              >
                <CircularProgress
                  size={20}
                  thickness={4.5}
                  sx={{ color: tokens.gold, flexShrink: 0 }}
                />
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                    {t('teamOpt.kqm.updatingRankings', 'Updating rankings')}
                  </Typography>
                  <Typography sx={{ ...type.label, mt: 0.25 }}>
                    {t(
                      'teamOpt.inspect.rankingWait',
                      'Searching alternative weapons and artifact sets from your inventory…'
                    )}
                  </Typography>
                </Box>
              </Box>
            ) : !rankings ? (
              <Box
                sx={{
                  ...insetSx,
                  minHeight: 136,
                  px: { xs: 2, sm: 2.5 },
                  py: 2.25,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Typography sx={type.label}>
                  {t(
                    'teamOpt.inspect.rankStale',
                    'Run Team optimize again to rank equipment for these settings.'
                  )}
                </Typography>
              </Box>
            ) : (
              <RankList
                key={category}
                options={list}
                rotationTime={rotationTime}
                selected={(o) =>
                  category === 0
                    ? o.option.weaponId === pick.weaponId
                    : teamOptSetKey(o.option) === teamOptSetKey(pick)
                }
                onSelect={(o) =>
                  choose(
                    category === 0
                      ? { ...pick, weaponId: o.option.weaponId }
                      : {
                          weaponId: pick.weaponId,
                          set: o.option.set,
                          setPair: o.option.setPair,
                        }
                  )
                }
                disabled={false}
                label={(o) => {
                  const weapon = database.weapons.get(o.option.weaponId)
                  return category === 0 && weapon ? (
                    <WeaponLabel weapon={weapon} />
                  ) : (
                    <SetLines sets={o.sets} tooltipPlacement="left" />
                  )
                }}
              />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
