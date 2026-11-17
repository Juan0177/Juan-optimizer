import {
  BootstrapTooltip,
  InfoTooltipInline,
} from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ICachedWeapon, TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { preloadNamespaces } from '@genshin-optimizer/gi/i18n'
import type {
  KqmBuild,
  KqmCatchUp,
  KqmOption,
  KqmRanking,
  KqmResult,
} from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  compareTeamKqm,
  KQM_SUBSTAT_ROLLS,
  kqmSetsId,
  kqmWeaponData,
  quickTooltipProps,
  statName,
  WeaponName,
  weaponSheetNs,
} from '@genshin-optimizer/gi/ui'
import CheckIcon from '@mui/icons-material/Check'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import UndoIcon from '@mui/icons-material/Undo'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Collapse,
  LinearProgress,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  formatGain,
  formatRate,
  formatRateFull,
  localizeDecimal,
} from './format'
import { artifactStatValue, KqmBuildView, SetLines } from './KqmBuildView'
import { kqmStandardRolls } from './KqmStandard'
import { MemberAvatar } from './MemberAvatar'
import { WeaponDetails, WeaponThumb } from './TeamOptResults'
import {
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  selectedSx,
  tokens,
  type,
} from './ui'
import { type KqmRotation, kqmReplayOf } from './useKqmRun'

const cache = new WeakMap<KqmResult, Map<string, KqmResult>>()
const choices = new WeakMap<
  KqmResult,
  Partial<Record<CharacterKey, Pick<KqmBuild, 'weapon' | 'sets'>>>
>()
const weaponId = (build: Pick<KqmBuild, 'weapon'>) =>
  `${build.weapon.key}@${build.weapon.refinement}`
const choiceId = (ck: CharacterKey, build: Pick<KqmBuild, 'weapon' | 'sets'>) =>
  `${ck}|${weaponId(build)}|${kqmSetsId(build.sets)}`

/**
 * Sets a run's picks as if made in the inspectors (a member without one: the run's own). An
 * inspector reads them when it opens: give it a new key to apply them to one already open.
 */
export function setKqmPicks(
  result: KqmResult,
  picks: Partial<Record<CharacterKey, Pick<KqmBuild, 'weapon' | 'sets'>>>
) {
  choices.set(result, picks)
}

/** Both lists hold the opposite selection fixed; only this member's main stats/rolls are searched. */
export function KqmCompare({
  teamId,
  runSettings,
  result,
  characterKey,
  rotationTime,
  disabled = false,
  base: baseProp,
  onView,
  rotation,
  headingLevel = 3,
}: {
  teamId: string
  runSettings: TeamOpt
  result: KqmResult
  characterKey: CharacterKey
  rotationTime?: number
  disabled?: boolean
  /**
   * The team with the other members' picks (from their inspectors): this member's options are
   * compared on top of it, so picks for several members add up
   */
  base?: KqmResult
  /** The team as it plays with the equipment picked (undefined: the run's own builds) */
  onView?: (view: KqmResult | undefined) => void
  /**
   * The rotation the picks are played with (KQM Compare's team B: its own), kept the same while
   * shown; absent: the team's written one
   */
  rotation?: KqmRotation
  /** The level of its member's heading (default: 3) */
  headingLevel?: 3 | 4 | 5 | 6
}) {
  const { t, i18n } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const original = result.builds[characterKey]!
  const [choice, setChoice] = useState<Pick<KqmBuild, 'weapon' | 'sets'>>(
    () => choices.get(result)?.[characterKey] ?? original
  )
  // the team this member's options are compared on: as it was when this inspector opened (the
  // other members' picks), not followed while picking here
  const [base] = useState(() => baseProp ?? result)
  // every member at the run's own equipment: the run itself, exactly
  const allOriginal = Object.entries({
    ...choices.get(result),
    [characterKey]: choice,
  }).every(
    ([ck, c]) =>
      !c ||
      choiceId(ck as CharacterKey, c) ===
        choiceId(ck as CharacterKey, result.builds[ck as CharacterKey]!)
  )
  const [view, setView] = useState(base)
  const key = choiceId(characterKey, choice)
  // what is still being worked out for the pick: the team's figures, then this member's rankings
  // (from the start when the pick opened with is not worked out yet: the page keeps the
  // figures it shows until it is)
  const [pending, setPending] = useState<'figures' | 'rankings' | undefined>(
    () =>
      !disabled &&
      !allOriginal &&
      !cache.get(base)?.has(key) &&
      !(base === result && key === choiceId(characterKey, original))
        ? 'figures'
        : undefined
  )
  const busy = !!pending
  // the rankings last shown: kept while the pick's are worked out (the list stays where it is)
  const [listed, setListed] = useState<KqmRanking>()
  const [error, setError] = useState('')
  const [category, setCategory] = useState(0)
  // the page's figures follow the picks (back to the run's when every pick is the original);
  // while a pick's team is worked out, they stay as they are
  useEffect(() => {
    if (pending === 'figures') return
    onView?.(view !== result ? view : undefined)
  }, [view, result, onView, pending])
  useEffect(() => {
    if (disabled) return
    let cancelled = false
    const show = (next: KqmResult) => {
      setView(next)
      const ranked = next.rankings[characterKey]
      if (ranked) setListed(ranked)
    }
    if (allOriginal) {
      show(result)
      setPending(undefined)
      setError('')
      return
    }
    const saved = cache.get(base) ?? new Map<string, KqmResult>()
    cache.set(base, saved)
    if (base === result) saved.set(choiceId(characterKey, original), result)
    const hit = saved.get(key)
    setError('')
    if (hit) {
      show(hit)
      setPending(undefined)
      return
    }
    setPending('figures')
    compareTeamKqm({
      database,
      teamId,
      gender,
      teamOpt: runSettings,
      result: base,
      characterKey,
      ...choice,
      // (played again with the picked gear: what its effects change for the whole team)
      replay: kqmReplayOf(
        database,
        gender,
        i18n,
        teamId,
        runSettings,
        rotation?.text,
        rotation?.opener,
        rotation?.timing
      ),
      isCancelled: () => cancelled,
      // (the figures as soon as the pick's build is found; the rankings after)
      onPreview: (preview) => {
        if (cancelled) return
        setView(preview)
        setPending('rankings')
      },
    })
      .then((next) => {
        if (cancelled || !next) return
        saved.set(key, next)
        show(next)
      })
      .catch((reason) => {
        if (!cancelled) setError(String(reason?.message ?? reason))
      })
      .finally(() => {
        if (!cancelled) setPending(undefined)
      })
    return () => {
      cancelled = true
    }
  }, [
    database,
    teamId,
    gender,
    runSettings,
    result,
    base,
    characterKey,
    original,
    key,
    choice,
    disabled,
    allOriginal,
    i18n,
    rotation,
  ])
  // (a team with other members' picks ranks this member's options once compared on it; while a
  // pick's are worked out, the ones shown before)
  const ranking =
    view.rankings[characterKey] ?? listed ?? result.rankings[characterKey]
  const build = view.builds[characterKey]!
  // the rows' tooltips (passives, set bonuses) have their texts before the first hover: no
  // placeholder while they load
  useEffect(
    () =>
      preloadNamespaces([
        'weaponNames_gen',
        'artifactNames_gen',
        'sheet',
        ...(ranking?.weapons ?? []).map((o) => weaponSheetNs(o.weapon.key)),
        ...(ranking?.sets ?? []).flatMap((o) =>
          Object.keys(o.sets).map((k) => `artifact_${k}_gen`)
        ),
      ]),
    [ranking]
  )
  if (!ranking) return null
  // (a pick while another is worked out replaces it)
  const choose = (next: Pick<KqmBuild, 'weapon' | 'sets'>) => {
    if (disabled || choiceId(characterKey, next) === key) return
    choices.set(result, { ...choices.get(result), [characterKey]: next })
    setChoice(next)
  }
  const changed = key !== choiceId(characterKey, original)
  const setOptions = [...ranking.sets]
  if (!setOptions.some((o) => kqmSetsId(o.sets) === kqmSetsId(choice.sets)))
    setOptions.unshift({ ...build, sets: choice.sets, total: 0, unmet: false })
  const weaponOptions = [...ranking.weapons]
  if (!weaponOptions.some((o) => weaponId(o) === weaponId(choice)))
    weaponOptions.unshift({
      ...build,
      weapon: choice.weapon,
      total: 0,
      unmet: false,
    })
  const er = view.energyRecharge[characterKey]
  const list = category === 0 ? ranking.weapons : ranking.sets
  const selectSx = compactFieldSx
  const equipment = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <TextField
        select
        size="small"
        label={t('teamOpt.kqm.weaponLabel', 'Weapon')}
        value={weaponId(choice)}
        disabled={disabled}
        sx={selectSx}
        SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 380 } } } }}
        onChange={(e) => {
          const option = weaponOptions.find(
            (o) => weaponId(o) === e.target.value
          )
          if (option) choose({ weapon: option.weapon, sets: choice.sets })
        }}
      >
        {weaponOptions.map((o) => (
          <MenuItem key={weaponId(o)} value={weaponId(o)}>
            <Box
              component="span"
              sx={{ color: 'text.secondary', mr: 0.75, ...numSx }}
            >
              R{o.weapon.refinement}
            </Box>
            <WeaponName weaponKey={o.weapon.key} />
          </MenuItem>
        ))}
      </TextField>
      <TextField
        select
        size="small"
        label={t('teamOpt.kqm.setLabel', 'Artifact set')}
        value={kqmSetsId(choice.sets)}
        disabled={disabled}
        sx={selectSx}
        SelectProps={{ MenuProps: { PaperProps: { sx: { maxHeight: 380 } } } }}
        onChange={(e) => {
          const option = setOptions.find(
            (o) => kqmSetsId(o.sets) === e.target.value
          )
          if (option) choose({ weapon: choice.weapon, sets: option.sets })
        }}
      >
        {setOptions.map((o) => (
          <MenuItem key={kqmSetsId(o.sets)} value={kqmSetsId(o.sets)}>
            <SetLines sets={o.sets} />
          </MenuItem>
        ))}
      </TextField>
    </Box>
  )
  const shortfalls = view.after.shortfalls?.[characterKey] ?? []
  const erMet = !!er && er.value + 1e-6 >= er.minimum
  return (
    <Box
      component="section"
      aria-label={t('teamOpt.kqm.compareEquipment', 'Compare equipment')}
      sx={{ scrollMarginTop: 88 }}
    >
      {error && (
        <Box
          role="alert"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mb: 1.5,
            fontSize: 13,
            color: 'error.main',
          }}
        >
          <ErrorOutlineIcon sx={{ fontSize: 16 }} />
          {error}
        </Box>
      )}
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
              <Typography component={`h${headingLevel}`} noWrap sx={type.title}>
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
                  {formatRateFull(
                    view.after.total,
                    rotationTime,
                    i18n?.language
                  )}
                </Typography>
                <Typography sx={{ ...type.label, fontSize: 12 }}>
                  {rotationTime
                    ? t('teamOpt.kqm.teamDps', 'team DPS')
                    : t('teamOpt.kqm.teamDmg', 'team DMG')}
                </Typography>
                {changed && (
                  <Typography
                    sx={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      ...numSx,
                      color:
                        view.after.total >= result.after.total
                          ? 'success.main'
                          : 'text.secondary',
                    }}
                  >
                    {formatGain(
                      view.after.total / result.after.total - 1,
                      i18n?.language
                    )}
                  </Typography>
                )}
              </Box>
            </Box>
            {changed && (
              <Button
                size="small"
                variant="text"
                color="inherit"
                disabled={disabled}
                startIcon={<UndoIcon sx={{ fontSize: 16 }} />}
                onClick={() => choose(original)}
                sx={{ color: 'text.secondary', ...quickSx }}
              >
                {t('teamOpt.kqm.resetShort', 'Reset')}
              </Button>
            )}
          </Box>
          <KqmBuildView
            characterKey={characterKey}
            build={build}
            equipment={equipment}
            rolls={kqmStandardRolls(runSettings.kqm)}
          />
          {er && (
            <Tooltip
              arrow
              title={t('teamOpt.kqm.erResult', {
                defaultValue: 'ER {{value}}% / {{minimum}}% required',
                value: +er.value.toFixed(1),
                minimum: +er.minimum.toFixed(1),
              })}
            >
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 1,
                  mt: 1.5,
                  pt: 1.25,
                  borderTop: hairline,
                  cursor: 'help',
                  color: erMet ? 'success.main' : 'warning.main',
                }}
              >
                <Typography
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    fontSize: 12.5,
                    fontWeight: 500,
                  }}
                >
                  {erMet ? (
                    <CheckCircleOutlineIcon sx={{ fontSize: 16 }} />
                  ) : (
                    <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
                  )}
                  {t('teamOpt.kqm.erCheck', 'ER check')}
                </Typography>
                <Typography sx={{ fontSize: 13.5, fontWeight: 600, ...numSx }}>
                  {localizeDecimal(er.value.toFixed(1), i18n?.language)}%
                  <Box
                    component="span"
                    sx={{ color: 'text.secondary', fontWeight: 500 }}
                  >
                    {' / '}
                    {localizeDecimal(er.minimum.toFixed(1), i18n?.language)}%
                  </Box>
                </Typography>
              </Box>
            </Tooltip>
          )}
          {!!shortfalls.length && (
            <Tooltip
              arrow
              title={shortfalls
                .map(
                  (s) =>
                    `${statName(s.path.at(-1) ?? '')}: ${artifactStatValue(s.path.at(-1) ?? '', s.value)} / ${artifactStatValue(s.path.at(-1) ?? '', s.min)}`
                )
                .join(' · ')}
            >
              <Typography
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  color: 'warning.main',
                  fontSize: 12.5,
                  mt: 1,
                  cursor: 'help',
                }}
              >
                <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
                {t('teamOpt.kqm.requirementsUnmet', 'Requirements unmet')}
              </Typography>
            </Tooltip>
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
                'teamOpt.kqm.linkedCompareTip',
                'Choose a set to re-rank weapons, or a weapon to re-rank sets. Main stats and substats are optimized again. Teammates keep the builds from this run.'
              )}
            />
            <Box sx={{ flex: 1 }} />
            <CopyRankingButton
              options={list}
              kind={category === 0 ? 'weapons' : 'sets'}
              rotationTime={rotationTime}
            />
          </Box>
          {/* (a thin line while the rankings update; its space is always kept) */}
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
          <Box
            role="tabpanel"
            id={`kqm-${characterKey}-ranking`}
            aria-labelledby={`kqm-${characterKey}-${category === 0 ? 'weapons' : 'sets'}`}
            sx={{
              // (the rankings shown before, until the pick's: still to pick from)
              opacity: busy ? 0.55 : 1,
              transition: 'opacity .18s',
            }}
          >
            <RankList
              key={category}
              options={list}
              rotationTime={rotationTime}
              selected={(o) =>
                category === 0
                  ? weaponId(o) === weaponId(choice)
                  : kqmSetsId(o.sets) === kqmSetsId(choice.sets)
              }
              onSelect={(o) =>
                choose(
                  category === 0
                    ? { weapon: o.weapon, sets: choice.sets }
                    : { weapon: choice.weapon, sets: o.sets }
                )
              }
              disabled={disabled}
              label={(o) =>
                category === 0 ? (
                  <WeaponLabel weapon={kqmWeaponData(o.weapon, characterKey)} />
                ) : (
                  <SetLines sets={o.sets} tooltipPlacement="left" />
                )
              }
            />
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

/** A ranked weapon: its icon and name, its details (stats, passive) on hover */
function WeaponLabel({ weapon }: { weapon: ICachedWeapon }) {
  return (
    <BootstrapTooltip
      // (beside the list, not over it: the other rows stay readable)
      placement="left"
      disableInteractive
      title={<WeaponDetails weapon={weapon} />}
      {...quickTooltipProps}
    >
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          minWidth: 0,
          maxWidth: '100%',
          verticalAlign: 'middle',
        }}
      >
        <Box
          sx={{
            transform: 'scale(0.7)',
            transformOrigin: 'left center',
            width: 32,
            height: 32,
            flexShrink: 0,
          }}
        >
          <WeaponThumb weapon={weapon} highlight={false} />
        </Box>
        <Typography sx={{ fontSize: 13.5, lineHeight: 1.4 }}>
          <WeaponName weaponKey={weapon.key} />
        </Typography>
      </Box>
    </BootstrapTooltip>
  )
}

/** Weapons or artifact sets: two tabs on a segmented track */
function RankTabs({
  value,
  onChange,
  characterKey,
  label,
}: {
  value: number
  onChange: (value: number) => void
  characterKey: CharacterKey
  label: string
}) {
  const { t } = useTranslation('page_team')
  const tabs = [
    ['weapons', t('teamOpt.kqm.weaponsList', 'Weapons')],
    ['sets', t('teamOpt.kqm.sets', 'Artifact sets')],
  ] as const
  return (
    <Box
      role="tablist"
      aria-label={label}
      sx={(theme) => ({
        display: 'inline-grid',
        gridAutoFlow: 'column',
        p: 0.375,
        gap: 0.25,
        borderRadius: tokens.radius.control,
        bgcolor: alpha(theme.palette.text.primary, 0.05),
      })}
    >
      {tabs.map(([id, name], i) => {
        const active = value === i
        return (
          <ButtonBase
            key={id}
            role="tab"
            id={`kqm-${characterKey}-${id}`}
            aria-selected={active}
            aria-controls={`kqm-${characterKey}-ranking`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(i)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
              e.preventDefault()
              const next = (i + 1) % tabs.length
              onChange(next)
              ;(
                e.currentTarget.parentElement?.children[next] as
                  | HTMLElement
                  | undefined
              )?.focus()
            }}
            sx={{
              px: 1.5,
              minHeight: 30,
              borderRadius: 1.25,
              fontSize: 13,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: active ? 'text.primary' : 'text.secondary',
              bgcolor: active ? tokens.raised : 'transparent',
              boxShadow: active
                ? `0 1px 2px ${alpha('#000', 0.45)}, inset 0 0 0 1px ${tokens.hairlineStrong}`
                : 'none',
              ...quickSx,
              ...focusSx,
              '&:hover': { color: 'text.primary' },
            }}
          >
            {name}
          </ButtonBase>
        )
      })}
    </Box>
  )
}

/** A substat's short name in the "+N stat" detail (English; `teamOpt.kqm.short.*` in the site's language) */
const shortStat: Record<string, string> = {
  critRate_: 'CR',
  critDMG_: 'CD',
  enerRech_: 'ER',
  eleMas: 'EM',
  atk_: 'ATK',
  atk: 'ATK',
  hp_: 'HP',
  hp: 'HP',
  def_: 'DEF',
  def: 'DEF',
}
/** A translation: its key, its English text, the values it takes */
type Translate = (
  key: string,
  english: string,
  values?: Record<string, unknown>
) => string

/** How far an option is behind the ranking's best, in substat rolls: one line */
export function behindText(
  tr: Translate,
  gap: KqmCatchUp | undefined,
  rank: number
): string {
  if (rank === 0) return tr('teamOpt.kqm.best', 'Best')
  if (!gap) return '—'
  if (gap.status === 'tied') return tr('teamOpt.kqm.tie', 'Tie')
  if (gap.status === 'limit')
    return tr('teamOpt.kqm.outOfReach', 'Out of reach')
  return tr('teamOpt.kqm.rollsBehind', '{{count}} rolls behind', {
    count: Number((Math.ceil(gap.count * 10) / 10).toFixed(1)),
  })
}

function Behind({ gap, rank }: { gap?: KqmCatchUp; rank: number }) {
  const { t } = useTranslation('page_team')
  const text = behindText(
    (key, english, values) =>
      t(key, { defaultValue: english, ...values }) as string,
    gap,
    rank
  )
  const quiet = (
    <Typography
      sx={{
        fontSize: 12.5,
        color: rank === 0 ? 'text.secondary' : 'text.disabled',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </Typography>
  )
  if (rank === 0 || !gap) return quiet
  const detail = Object.entries(gap.rolls)
    .filter(([, n]) => n > 1e-5)
    .map(
      ([key, n]) =>
        `+${artifactStatValue(key, n * KQM_SUBSTAT_ROLLS[key as keyof typeof KQM_SUBSTAT_ROLLS])} ${shortStat[key] ? t(`teamOpt.kqm.short.${key}`, shortStat[key]) : statName(key)}`
    )
    .join(' · ')
  return (
    <Tooltip
      arrow
      title={
        <Box sx={{ maxWidth: 280 }}>
          {gap.status === 'limit'
            ? t(
                'teamOpt.kqm.outOfReachTip',
                'Even with the most rolls each substat can take, it does not match #1.'
              )
            : gap.status === 'tied'
              ? t('teamOpt.kqm.tieTip', 'As good as #1.')
              : t('teamOpt.kqm.matchBest', 'Matches #1 with')}
          {gap.status === 'matched' && detail && (
            <Box sx={{ mt: 0.25, fontWeight: 600, ...numSx }}>{detail}</Box>
          )}
          <Box sx={{ mt: 0.75, color: 'text.secondary' }}>
            {t(
              'teamOpt.kqm.behindTip',
              'Average substat rolls on top of the KQM budget, same teammates. ER requirements and per-substat caps still apply.'
            )}
          </Box>
        </Box>
      }
    >
      <Typography
        sx={{
          cursor: 'help',
          fontSize: 13,
          fontWeight: gap.status === 'matched' ? 600 : 500,
          color: gap.status === 'matched' ? 'text.primary' : 'text.secondary',
          whiteSpace: 'nowrap',
          ...numSx,
        }}
      >
        {text}
      </Typography>
    </Tooltip>
  )
}

/** Copies a ranking as a Markdown table (Discord, sheets, docs) */
function CopyRankingButton({
  options,
  kind,
  rotationTime,
}: {
  options: KqmOption[]
  kind: 'weapons' | 'sets'
  rotationTime?: number
}) {
  const { t, i18n } = useTranslation([
    'page_team',
    'weaponNames_gen',
    'artifactNames_gen',
  ])
  const [copied, setCopied] = useState(false)
  const best = options.find((o) => !o.unmet)?.total ?? options[0]?.total ?? 0
  const copy = () => {
    const name = (o: KqmOption) =>
      kind === 'weapons'
        ? `${i18n.t(`weaponNames_gen:${o.weapon.key}`)} R${o.weapon.refinement}`
        : Object.entries(o.sets).length
          ? Object.entries(o.sets)
              .map(
                ([k, n]) =>
                  `${t('teamOpt.kqm.copyPieces', { defaultValue: '{{n}}pc', n })} ${i18n.t(`artifactNames_gen:${k}`)}`
              )
              .join(' + ')
          : t('teamOpt.kqm.noSetBonus', 'No set bonus')
    const head = [
      '#',
      kind === 'weapons'
        ? t('teamOpt.kqm.weaponLabel', 'Weapon')
        : t('teamOpt.kqm.setLabel', 'Artifact set'),
      rotationTime
        ? t('teamOpt.kqm.teamDpsHeader', 'Team DPS')
        : t('teamOpt.kqm.teamDmgHeader', 'Team DMG'),
      '%',
      t('page_team:teamOpt.kqm.vsBestHeader', 'vs best'),
    ]
    const rows = options.map((o, i) => [
      String(i + 1),
      name(o) + (o.unmet ? ' ⚠' : ''),
      formatRate(o.total, rotationTime, true),
      best
        ? `${((o.total / best) * 100).toLocaleString(i18n?.language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
        : '',
      o.unmet
        ? ''
        : behindText(
            (key, english, values) =>
              t(`page_team:${key}`, {
                defaultValue: english,
                ...values,
              }) as string,
            o.behind,
            i
          ),
    ])
    const line = (cells: string[]) => `| ${cells.join(' | ')} |`
    const text = [
      line(head),
      line(head.map(() => '---')),
      ...rows.map(line),
    ].join('\n')
    const done = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    }
    // (a selected textarea when the Clipboard API is missing or refused)
    const fallback = () => {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      if (ok) done()
    }
    if (navigator.clipboard?.writeText)
      navigator.clipboard.writeText(text).then(done, fallback)
    else fallback()
  }
  return (
    <Button
      size="small"
      variant="text"
      color="inherit"
      onClick={copy}
      aria-label={t('teamOpt.kqm.copyRanking', 'Copy as a table')}
      startIcon={
        copied ? (
          <CheckIcon sx={{ fontSize: 17 }} />
        ) : (
          <ContentCopyIcon sx={{ fontSize: 16 }} />
        )
      }
      sx={{
        minWidth: 0,
        whiteSpace: 'nowrap',
        color: copied ? 'success.main' : 'text.secondary',
        ...quickSx,
        ...focusSx,
        '&:hover': { color: copied ? 'success.main' : 'text.primary' },
        '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.75 }, ml: 0 },
      }}
    >
      <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
        {copied
          ? t('teamOpt.kqm.copied', 'Copied')
          : t('teamOpt.kqm.copyRanking', 'Copy as a table')}
      </Box>
    </Button>
  )
}

/** The first rows shown; the rest open below them */
const FIRST_ROWS = 8

function RankList({
  options,
  rotationTime,
  label,
  selected,
  onSelect,
  disabled,
}: {
  options: KqmOption[]
  rotationTime?: number
  label: (option: KqmOption) => ReactNode
  selected: (option: KqmOption) => boolean
  onSelect: (option: KqmOption) => void
  disabled: boolean
}) {
  const { t, i18n } = useTranslation('page_team')
  const [expanded, setExpanded] = useState(false)
  const best = options.find((o) => !o.unmet)?.total ?? options[0]?.total ?? 0
  const columns = {
    xs: '22px minmax(0, 1fr) 76px',
    sm: '28px minmax(0, 1fr) 88px 136px',
  }
  const row = (option: KqmOption, i: number) => {
    const active = selected(option)
    const ratio = best > 0 ? option.total / best : 0
    return (
      <ButtonBase
        key={`${weaponId(option)}|${kqmSetsId(option.sets)}`}
        aria-pressed={active}
        disabled={disabled}
        onClick={() => onSelect(option)}
        sx={(theme) => ({
          display: 'grid',
          gridTemplateColumns: columns,
          alignItems: 'center',
          columnGap: 1,
          rowGap: 0.5,
          px: 1.25,
          py: 1,
          minHeight: 54,
          width: '100%',
          textAlign: 'left',
          borderRadius: tokens.radius.control,
          // (a hairline between rows; the selected row's ring replaces it)
          boxShadow: i > 0 ? `inset 0 1px 0 ${tokens.hairline}` : 'none',
          ...(active && selectedSx(theme)),
          ...quickSx,
          '&:hover': {
            bgcolor: active
              ? alpha(theme.palette.primary.main, 0.14)
              : alpha(theme.palette.text.primary, 0.035),
          },
          '&.Mui-focusVisible': {
            outline: `2px solid ${tokens.gold}`,
            outlineOffset: -2,
          },
        })}
      >
        <Typography
          sx={{
            fontSize: 12.5,
            fontWeight: active ? 600 : 500,
            color: active ? 'primary.main' : 'text.secondary',
            ...numSx,
          }}
        >
          {i + 1}
        </Typography>
        <Box sx={{ minWidth: 0 }}>{label(option)}</Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ fontSize: 14.5, fontWeight: 600, ...numSx }}>
            {formatRate(option.total, rotationTime)}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', ...numSx }}>
            {localizeDecimal((ratio * 100).toFixed(1), i18n?.language)}%
          </Typography>
        </Box>
        <Box
          sx={{
            gridColumn: { xs: '2 / -1', sm: 'auto' },
            pl: { sm: 1 },
            display: 'flex',
            alignItems: 'center',
            minWidth: 0,
          }}
        >
          {option.unmet ? (
            <Tooltip
              arrow
              title={(option.shortfalls ?? [])
                .map(
                  (s) =>
                    `${statName(s.path.at(-1) ?? '')}: ${artifactStatValue(s.path.at(-1) ?? '', s.value)} / ${artifactStatValue(s.path.at(-1) ?? '', s.min)}`
                )
                .join(' · ')}
            >
              <Typography
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: 12.5,
                  color: 'warning.main',
                }}
              >
                <WarningAmberRoundedIcon sx={{ fontSize: 15 }} />
                {t('teamOpt.kqm.requirementsUnmet', 'Requirements unmet')}
              </Typography>
            </Tooltip>
          ) : (
            <Behind gap={option.behind} rank={i} />
          )}
        </Box>
      </ButtonBase>
    )
  }
  return (
    <Box sx={{ minWidth: 0 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: columns,
          columnGap: 1,
          px: 1.25,
          pb: 0.75,
          alignItems: 'center',
          borderBottom: hairline,
          mb: 0.25,
        }}
      >
        <Typography sx={{ ...type.label, fontSize: 12 }}>#</Typography>
        <Typography sx={{ ...type.label, fontSize: 12 }}>
          {t('teamOpt.kqm.equipment', 'Equipment')}
        </Typography>
        <Typography sx={{ ...type.label, fontSize: 12, textAlign: 'right' }}>
          {rotationTime
            ? t('teamOpt.kqm.teamDpsHeader', 'Team DPS')
            : t('teamOpt.kqm.teamDmgHeader', 'Team DMG')}
        </Typography>
        <Box
          sx={{
            display: { xs: 'none', sm: 'flex' },
            alignItems: 'center',
            gap: 0.5,
            pl: 1,
          }}
        >
          <Typography sx={{ ...type.label, fontSize: 12 }}>
            {t('teamOpt.kqm.vsBestHeader', 'vs best')}
          </Typography>
          <InfoTooltipInline
            title={t(
              'teamOpt.kqm.vsBestHeaderTip',
              'How many extra substat rolls each option needs to match #1.'
            )}
          />
        </Box>
      </Box>
      {options.slice(0, FIRST_ROWS).map(row)}
      {options.length > FIRST_ROWS && (
        <>
          <Collapse in={expanded} timeout={180} unmountOnExit>
            {options
              .slice(FIRST_ROWS)
              .map((option, i) => row(option, i + FIRST_ROWS))}
          </Collapse>
          <Button
            fullWidth
            size="small"
            variant="text"
            color="inherit"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            endIcon={
              <ExpandMoreIcon
                sx={{
                  transition: `transform .18s ${tokens.ease}`,
                  transform: expanded ? 'rotate(180deg)' : 'none',
                  '@media (prefers-reduced-motion: reduce)': {
                    transition: 'none',
                  },
                }}
              />
            }
            sx={{
              mt: 0.5,
              minHeight: 34,
              color: 'text.secondary',
              borderTop: hairline,
              borderRadius: 0,
              ...quickSx,
              ...focusSx,
              '&:hover': { color: 'text.primary' },
            }}
          >
            {expanded
              ? t('teamOpt.kqm.showLess', 'Show less')
              : t('teamOpt.kqm.showAll', {
                  defaultValue: 'Show all {{count}}',
                  count: options.length,
                })}
          </Button>
        </>
      )}
    </Box>
  )
}

/** A compact outlined field: 36 px tall */
const compactFieldSx = {
  '& .MuiInputBase-root': { fontSize: 13.5 },
  '& .MuiInputLabel-root': { fontSize: 13.5 },
  '& .MuiSelect-select': { py: 0.875 },
} as const
