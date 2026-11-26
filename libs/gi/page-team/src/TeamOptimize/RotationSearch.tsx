import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  BonusStats,
  FrameData,
  KqmResult,
  RotationCandidate,
  RotationEditKinds,
  RotationMember,
  RotationSearchProgress,
  RotationSearchResult,
  RotationTimingSettings,
  RotationWordStep,
  RunAttackState,
  TeamOptResult,
} from '@genshin-optimizer/gi/ui'
import {
  allRotationEdits,
  candidateRank,
  erCostOf,
  rotationSearchPlayer,
  rotationWords,
  searchRotations,
  useNumWorkers,
} from '@genshin-optimizer/gi/ui'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import {
  Alert,
  alpha,
  Box,
  Button,
  ButtonBase,
  Tooltip,
  Typography,
} from '@mui/material'
import type { TFunction } from 'i18next'
import {
  Fragment,
  memo,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { formatDamage } from './format'
import { MemberAvatar } from './MemberAvatar'
import { DialogHead } from './OptionTile'
import { Arrow, mono } from './RotationInline'
import { laneColor } from './RotationTimeline'
import { kqmRotationId, useRotationSettings } from './RotationWriter'
import { type FullSearchStage, fullRotationSearch } from './rotationSearchFull'
import {
  kqmSearchSource,
  type RotationSearchSource,
  teamSearchSource,
} from './rotationSearchSource'
import { kqmRollGains } from './TeamSensitivity'
import { focusSx, insetSx, numSx, quickSx, Segmented, tokens, type } from './ui'

/** How long a search may take (seconds) */
const BUDGETS = [30, 120, 300] as const
/** Rotations shown after a search */
const SHOWN = 25
/** The best rotations a search found that get builds of their own */
const CONFIRMED = 3
/** What the last search could change: the next one starts from it */
let lastKinds: RotationEditKinds = allRotationEdits
/** Quick: a time limit; Full: until nothing within reach is better (at most `FULL_MINUTES`) */
type SearchMode = 'quick' | 'full'
let lastMode: SearchMode = 'quick'
const FULL_MINUTES = 20
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** Portion of a Quick search budget reserved for confirming the best rotations' own builds (ms) */
export const confirmReserveMs = (budgetSeconds: number) =>
  Math.min(45_000, Math.max(10_000, Math.round(budgetSeconds * 1000 * 0.25)))

/** The builds a search starts from: the KQM tab's shown result, or Team optimize's team build */
export type RotationSearchBase =
  | {
      tab: 'kqm'
      result: KqmResult
      /** The settings it was run with */
      teamOpt: TeamOpt
      rotationKey?: string
    }
  | {
      tab: 'team'
      /** The team build shown (the result, or one of its next best) */
      result: TeamOptResult
      teamOpt: TeamOpt
      rotationKey?: string
      /** The bonus stats a run ranks builds with now (the fight's averaged buffs) */
      rankingBonusStats?: RefObject<
        Partial<Record<CharacterKey, BonusStats>> | undefined
      >
    }

/**
 * A tab's rotation search, from the rotation in the writer: thousands of rotations a change or a
 * few away, played with the builds shown (`searchRotations`), the best offered to use
 */
export function RotationSearchButton({
  tab,
  teamId,
  text,
  names,
  base,
  teamOpt,
  onUse,
  onSetup,
  compact,
  disabled,
  attackStates,
  savedOverride,
}: {
  /** The tab it is on: KQM theorycrafting's, or Team optimize's */
  tab: RotationSearchBase['tab']
  teamId: string
  text: string
  names: RotationMember[]
  /** The builds shown, as they played the rotation; absent: no current result */
  base: RotationSearchBase | undefined
  /** Current tab settings (for confirming builds with live ER/weapon/filter settings) */
  teamOpt?: TeamOpt
  onUse: (text: string) => void
  onSetup?: () => void
  /** The states a run gives every attack now (Wolf's Gravestone's uptime) */
  attackStates?: RefObject<readonly RunAttackState[] | undefined>
  /** Live modal rotation settings when launched from the Write rotation modal */
  savedOverride?: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  }
  /** On the rotation's line: a pill like its other settings */
  compact?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const [open, setOpen] = useState(false)
  const written = !!text.trim()
  const team = tab === 'team'
  const ready = base?.tab === tab && written && !disabled
  const tip = (
    <Box component="span" sx={{ display: 'grid', gap: 1 }}>
      <span>
        <Box component="strong" sx={{ display: 'block' }}>
          {t('teamOpt.search.title', 'Optimize rotation')}
        </Box>
        {team
          ? t(
              'teamOpt.search.teamTip',
              'Tries thousands of small changes to this rotation (step order, actions, Normal Attack lengths, kit options like Sandrone’s beams) and plays each with the builds of your last run. The best few then get builds from your own artifacts and weapons. Your main DPS keeps its Burst and field time.'
            )
          : t(
              'teamOpt.search.tip',
              'Tries thousands of small changes to this rotation (step order, actions, Normal Attack lengths, kit options like Sandrone’s beams) and plays each with the builds of the last KQM run. Your main DPS keeps its Burst and field time.'
            )}
      </span>
      {!ready && (
        <Box component="span" sx={{ color: 'warning.main' }}>
          {written
            ? team
              ? t(
                  'teamOpt.search.teamNeedsRun',
                  'Optimize the team first: the search starts from the builds it finds and uses them as its base.'
                )
              : t(
                  'teamOpt.search.needsRun',
                  'Generate builds first: the search starts from the rotation those builds were found for and uses them as its base.'
                )
            : t(
                'teamOpt.search.needsText',
                'Write a rotation first: the search starts from it.'
              )}
        </Box>
      )}
    </Box>
  )
  return (
    <>
      <Tooltip arrow title={tip} placement="top">
        <span>
          {compact ? (
            <ButtonBase
              disabled={disabled}
              onClick={() => setOpen(true)}
              sx={{
                ...quickSx,
                ...focusSx,
                height: 28,
                px: 0.875,
                gap: 0.5,
                borderRadius: 999,
                border: '1px solid transparent',
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: 'text.primary',
                '&:hover': {
                  bgcolor: alpha(giTokens.parchment, 0.05),
                  borderColor: tokens.hairlineStrong,
                },
                '&.Mui-disabled': { opacity: 0.5 },
              }}
            >
              <AutoFixHighIcon sx={{ fontSize: 15, color: tokens.gold }} />
              {t('teamOpt.search.rotations', 'Search rotations')}
            </ButtonBase>
          ) : (
            <Button
              size="small"
              color="inherit"
              disabled={disabled}
              startIcon={
                <AutoFixHighIcon sx={{ fontSize: '15px !important' }} />
              }
              onClick={() => setOpen(true)}
              sx={{
                fontSize: 12.5,
                whiteSpace: 'nowrap',
                color: 'text.secondary',
              }}
            >
              {t('teamOpt.search.rotations', 'Search rotations')}
            </Button>
          )}
        </span>
      </Tooltip>
      {open && ready && base?.tab === tab && (
        <RotationSearchDialog
          teamId={teamId}
          seed={text}
          names={names}
          base={base}
          teamOpt={teamOpt}
          attackStates={attackStates}
          savedOverride={savedOverride}
          onClose={() => setOpen(false)}
          onUse={(chosen) => {
            onUse(chosen)
            setOpen(false)
          }}
        />
      )}
      {open && !ready && (
        <ModalWrapper
          open
          onClose={() => setOpen(false)}
          aria-label={t('teamOpt.search.rotations', 'Search rotations')}
          containerProps={{ maxWidth: 'xs' }}
        >
          <CardThemed>
            <DialogHead
              title={t('teamOpt.search.rotations', 'Search rotations')}
              onClose={() => setOpen(false)}
            />
            <Box sx={{ p: 2, display: 'grid', gap: 1.5 }}>
              <Typography>
                {!written
                  ? t(
                      'teamOpt.search.needsText',
                      'Write a rotation first: the search starts from it.'
                    )
                  : team
                    ? t(
                        'teamOpt.search.gearRequired',
                        'Run gear optimization first. Rotation search uses those builds as a baseline.'
                      )
                    : t(
                        'teamOpt.search.kqmRequired',
                        'Generate KQM builds first to give rotation search a baseline.'
                      )}
              </Typography>
              {written && !base && onSetup && (
                <Button
                  variant="contained"
                  onClick={() => {
                    setOpen(false)
                    onSetup()
                  }}
                >
                  {t('teamOpt.run.gear', 'Optimize gear')}
                </Button>
              )}
            </Box>
          </CardThemed>
        </ModalWrapper>
      )}
    </>
  )
}

/**
 * Filter and rank candidate rotations for display: confirmed winners first (by their real DPS with
 * their own builds), dropping any confirmed rotation that failed requirements (`null`) or did not
 * beat `runDps`, followed by unconfirmed candidates whose estimate beats the seed.
 */
export function betterRotationCandidates({
  top,
  rowSeed,
  confirmed,
  fullDone,
  ended,
  from,
  runDps,
  limit = SHOWN,
}: {
  top: readonly RotationCandidate[] | undefined
  rowSeed: RotationCandidate | undefined
  confirmed: Readonly<Record<string, number | null>> | undefined
  fullDone: boolean
  ended?: RotationSearchResult['ended']
  from?: RotationCandidate
  runDps: number
  limit?: number
}): RotationCandidate[] {
  if (!rowSeed || !top) return []
  const own = (c: RotationCandidate) =>
    confirmed && c.text in confirmed ? confirmed[c.text] : undefined
  const beatsUnconfirmed = (c: RotationCandidate, base: RotationCandidate) =>
    c.estimate > base.estimate * (1 + 1e-4) &&
    candidateRank(c) > candidateRank(base) * (1 + 1e-4)
  // (stopped or out of time: those found without builds of their own yet after them)
  if (fullDone) {
    const base = from ?? rowSeed
    return [
      ...top
        .filter((c) => {
          const dps = own(c)
          return typeof dps === 'number' && dps > runDps * (1 + 1e-4)
        })
        .sort((a, b) => (own(b) as number) - (own(a) as number)),
      ...(ended === 'converged'
        ? []
        : top.filter((c) => own(c) === undefined && beatsUnconfirmed(c, base))),
    ].slice(0, limit)
  }
  const found = top
    .filter((c) => {
      const dps = own(c)
      return dps !== undefined
        ? dps !== null && dps > runDps * (1 + 1e-4)
        : beatsUnconfirmed(c, rowSeed)
    })
    .slice(0, limit)
  return [
    ...found
      .filter((c) => typeof own(c) === 'number')
      .sort((a, b) => (own(b) as number) - (own(a) as number)),
    ...found.filter((c) => own(c) === undefined),
  ]
}

function RotationSearchDialog({
  teamId,
  seed,
  names,
  base,
  teamOpt,
  attackStates,
  savedOverride,
  onClose,
  onUse,
}: {
  teamId: string
  seed: string
  names: RotationMember[]
  base: RotationSearchBase
  teamOpt?: TeamOpt
  attackStates?: RefObject<readonly RunAttackState[] | undefined>
  savedOverride?: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  }
  onClose: () => void
  onUse: (text: string) => void
}) {
  const { t, i18n } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [maxWorkers] = useNumWorkers()
  const team = base.tab === 'team'
  const stored = useRotationSettings(team ? teamId : kqmRotationId(teamId))
  const saved = savedOverride ?? stored
  // (what the search plays with, and how the tab finds builds of its own for a rotation)
  const source = useMemo<RotationSearchSource>(() => {
    const settings = {
      opener: saved.opener,
      timing: saved.timing,
      frameData: saved.frameData,
    }
    const states = () => attackStates?.current ?? undefined
    return base.tab === 'team'
      ? teamSearchSource({
          database,
          gender,
          teamId,
          names,
          teamOpt: base.teamOpt,
          liveTeamOpt: teamOpt,
          result: base.result,
          saved: settings,
          attackStates: states,
          rankingBonusStats: () => base.rankingBonusStats?.current ?? undefined,
          maxWorkers,
        })
      : kqmSearchSource({
          database,
          gender,
          i18n,
          teamId,
          names,
          teamOpt: base.teamOpt,
          result: base.result,
          saved: settings,
          attackStates: states,
          gains: kqmRollGains(base.result),
        })
  }, [
    base,
    teamOpt,
    database,
    gender,
    i18n,
    teamId,
    names,
    saved.opener,
    saved.timing,
    saved.frameData,
    attackStates,
    maxWorkers,
  ])
  const [budget, setBudget] = useState<(typeof BUDGETS)[number]>(120)
  const [run, setRun] = useState<SearchRun>()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RotationSearchProgress>()
  /** A full search's: `from`, what the last pass's estimates are against */
  const [result, setResult] = useState<
    RotationSearchResult & { from?: RotationCandidate }
  >()
  const [error, setError] = useState<string>()
  const [threads, setThreads] = useState(0)
  const [kinds, setKinds] = useState(lastKinds)
  const [mode, setMode] = useState(lastMode)
  /** The mode of the search shown */
  const [searched, setSearched] = useState<SearchMode>()
  /** A full search's stage, while it runs */
  const [stage, setStage] = useState<FullSearchStage>()
  /** The written rotation as the search played it */
  const [yours, setYours] = useState<RotationCandidate>()
  /** The best rotations' own KQM builds: their DPS (null: none found), as they are run */
  const [confirmed, setConfirmed] = useState<{
    total: number
    dps: Record<string, number | null>
  }>()
  const cancelled = useRef(false)
  const release = useRef<() => void>()
  const abortConfirm = useRef<() => void>()
  const stopAll = useCallback(() => {
    cancelled.current = true
    release.current?.()
    abortConfirm.current?.()
  }, [])
  useEffect(() => () => stopAll(), [stopAll])

  const startFull = () => {
    cancelled.current = false
    setResult(undefined)
    setError(undefined)
    setProgress(undefined)
    setConfirmed(undefined)
    setStage(undefined)
    setYours(undefined)
    setThreads(0)
    setSearched('full')
    setRun({ start: Date.now(), budget: FULL_MINUTES * 60 })
    setRunning(true)
    let shown = 0
    fullRotationSearch({
      database,
      names,
      source,
      seed,
      kinds,
      deadline: Date.now() + FULL_MINUTES * 60_000,
      pause,
      isCancelled: () => cancelled.current,
      onStage: setStage,
      onThreads: setThreads,
      onAbort: (abort) => {
        abortConfirm.current = abort
      },
      onConfirmed: (dps) =>
        setConfirmed({ total: Object.keys(dps).length, dps }),
      onProgress: (p) => {
        if (p.round === 0) setYours((y) => y ?? p.seed)
        const now = Date.now()
        if (
          now - shown < 200 &&
          p.roundPlayed > 0 &&
          p.roundPlayed < p.roundSize
        )
          return
        shown = now
        setProgress(p)
      },
    })
      .then((found) => {
        setYours(found.seed)
        setConfirmed({
          total: Object.keys(found.confirmed).length,
          dps: found.confirmed,
        })
        setResult(found)
      })
      .catch((e) => {
        if (!cancelled.current) setError(String((e as Error)?.message ?? e))
      })
      .finally(() => {
        abortConfirm.current = undefined
        setThreads(0)
        setRun((r) => r && { ...r, end: Date.now() })
        setRunning(false)
        setStage(undefined)
      })
  }

  const start = () => {
    if (mode === 'full') return startFull()
    cancelled.current = false
    setResult(undefined)
    setError(undefined)
    setProgress(undefined)
    setConfirmed(undefined)
    setStage(undefined)
    setYours(undefined)
    setThreads(0)
    setSearched('quick')
    setRun({ start: Date.now(), budget })
    setRunning(true)
    let player: ReturnType<typeof rotationSearchPlayer>
    try {
      player = rotationSearchPlayer(database, source.setup)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      setRunning(false)
      return
    }
    release.current = player.release
    setThreads(player.threads())
    let shown = 0
    let released = false
    const done = () => {
      if (released) return
      released = true
      player.release()
      release.current = undefined
      setThreads(0)
    }
    let confirmTimer: ReturnType<typeof setTimeout> | undefined
    ;(async () => {
      // (what Energy Recharge costs the builds: a rotation that needs less gains what it frees)
      const erCost = erCostOf(await source.prices(pause).catch(() => ({})))
      if (cancelled.current) return
      const startMs = Date.now()
      const totalDeadline = startMs + budget * 1000
      const searchDeadline = totalDeadline - confirmReserveMs(budget)
      setRun((r) => r && { ...r, start: startMs })
      const found = await searchRotations({
        seed,
        members: names,
        score: player.score,
        verify: player.verify,
        deadline: searchDeadline,
        funded: source.funded,
        erCost,
        kinds,
        constellations: source.setup.constellations,
        isCancelled: () => cancelled.current,
        onProgress: (p) => {
          const now = Date.now()
          if (
            now - shown < 200 &&
            p.roundPlayed > 0 &&
            p.roundPlayed < p.roundSize
          )
            return
          shown = now
          setProgress(p)
          setThreads(player.threads())
        },
      })
      setResult(found)
      done()
      // (the best get builds of their own, as the tab's run of the rotation would find them)
      const best = found.best
        .filter(
          (c) =>
            c.estimate > found.seed.estimate * (1 + 1e-4) &&
            candidateRank(c) > candidateRank(found.seed) * (1 + 1e-4)
        )
        .slice(0, CONFIRMED)
      const dps: Record<string, number | null> = {}
      let timedOutConfirm = false
      if (best.length && !cancelled.current) {
        const remaining = totalDeadline - Date.now()
        if (remaining <= 0) {
          timedOutConfirm = true
        } else {
          confirmTimer = setTimeout(() => {
            timedOutConfirm = true
            abortConfirm.current?.()
          }, remaining)
          const confirmStop = () =>
            cancelled.current || timedOutConfirm || Date.now() >= totalDeadline
          for (const c of best) {
            if (confirmStop()) {
              if (!cancelled.current) timedOutConfirm = true
              break
            }
            setConfirmed({ total: best.length, dps: { ...dps } })
            const run = await source
              .confirm(c.text, confirmStop, (abort) => {
                abortConfirm.current = abort
              })
              .catch(() => undefined)
            abortConfirm.current = undefined
            if (confirmStop()) {
              if (!cancelled.current) timedOutConfirm = true
              break
            }
            dps[c.text] = run ? run.dps : null
          }
          if (Object.keys(dps).length)
            setConfirmed({ total: Object.keys(dps).length, dps: { ...dps } })
          else setConfirmed(undefined)
        }
      }
      if (cancelled.current) setResult({ ...found, ended: 'cancelled' })
      else if (timedOutConfirm) setResult({ ...found, ended: 'time' })
    })()
      .catch((e) => setError(String((e as Error)?.message ?? e)))
      .finally(() => {
        if (confirmTimer !== undefined) clearTimeout(confirmTimer)
        abortConfirm.current = undefined
        done()
        setRun((r) => r && { ...r, end: Date.now() })
        setRunning(false)
      })
  }

  const funded = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(source.funded).map(([k, er]) => [k, Math.round(er ?? 0)])
      ) as Partial<Record<CharacterKey, number>>,
    [source]
  )
  const seedWords = useMemo(() => rotationWords(seed, names), [seed, names])
  const seedScore = yours ?? result?.seed ?? progress?.seed
  /** What the rows' estimates are against: the search's own start (a full search's pass's) */
  const rowSeed = (running ? progress?.seed : undefined) ?? seedScore
  const top = result?.best ?? progress?.top
  const runDps = source.dps
  const fullDone = searched === 'full' && !!result && !running
  const better = useMemo(
    () =>
      betterRotationCandidates({
        top,
        rowSeed,
        confirmed: confirmed?.dps,
        fullDone,
        ended: result?.ended,
        from: result?.from,
        runDps,
      }),
    [top, rowSeed, confirmed, fullDone, runDps, result]
  )
  const checking =
    searched === 'quick' &&
    running &&
    !!confirmed &&
    Object.keys(confirmed.dps).length < confirmed.total
  const list = useRef<HTMLDivElement>(null)
  useListMotion(list, better.map((c) => c.text).join('\n'))
  const ended = result?.ended
  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'md' }}
      aria-label={t('teamOpt.search.rotations', 'Search rotations')}
    >
      <CardThemed>
        <DialogHead
          title={t('teamOpt.search.rotations', 'Search rotations')}
          info={
            team
              ? t(
                  'teamOpt.search.teamHow',
                  'Plays thousands of rotations one change away from yours, then from the best ones (what you let it change: the order, members coming back on the field, attack strings, skills and kit options), with the builds of your last run. Your main DPS keeps its Burst and field time, and a rotation must not need more Energy Recharge than the builds can give. The best few then get builds from your own artifacts and weapons (a run of Team optimize with the rotation, your settings and requirements as they are), and are ranked by their DPS with them. Quick stops at its time limit. Full also plays your steps in every other order and the team’s templates, climbs from the best of them each on its own until no change to the best rotations is better and a wider round finds nothing either, and searches again with the best one’s own builds until it stays the best: the best rotation within reach of your plan (not every rotation there could be).'
                )
              : t(
                  'teamOpt.search.how',
                  'Plays thousands of rotations one change away from yours, then from the best ones (what you let it change: the order, members coming back on the field, attack strings, skills and kit options), with the KQM builds shown. A rotation that needs less Energy Recharge (a support played right before the member who catches its particles) gains the damage stats that frees, one that needs more pays for it. Your main DPS keeps its Burst and field time, and a rotation must not need more Energy Recharge than the builds can give. The best few then get their own KQM builds, and are ranked by their DPS with them. Quick stops at its time limit. Full also plays your steps in every other order and the team’s templates, climbs from the best of them each on its own until no change to the best rotations is better and a wider round finds nothing either, and searches again with the best one’s own builds until it stays the best: the best rotation within reach of your plan (not every rotation there could be).'
                )
          }
          onClose={onClose}
        />
        <Box
          sx={{
            px: { xs: 1.5, sm: 2.5 },
            py: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            maxHeight: { xs: 'calc(100dvh - 150px)', sm: '72vh' },
            overflowY: 'auto',
            '& > *': { flexShrink: 0 },
          }}
        >
          <Box sx={{ ...insetSx, p: 1.5, display: 'grid', gap: 1 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'baseline',
                gap: 0.75,
                minHeight: 23,
              }}
            >
              <Typography sx={{ ...type.label, flexGrow: 1 }}>
                {t('teamOpt.search.replayedRotation', 'Your rotation · replay')}
              </Typography>
              {seedScore && (
                <>
                  <Typography sx={type.stat}>
                    {formatDamage(seedScore.dps, true)}
                  </Typography>
                  <Typography sx={type.label}>DPS</Typography>
                </>
              )}
            </Box>
            <RotationView steps={seedWords} />
            {seedScore && (
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  columnGap: 1.5,
                  rowGap: 0.5,
                }}
              >
                <Typography sx={{ ...type.label, ...numSx }}>
                  {t('teamOpt.search.length', {
                    defaultValue: '{{seconds}} s rotation',
                    seconds: seedScore.time.toFixed(1),
                  })}
                </Typography>
                <ErLine
                  er={seedScore.er}
                  names={names}
                  funded={funded}
                  team={team}
                />
              </Box>
            )}
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexWrap: 'wrap',
            }}
          >
            <Typography sx={{ ...type.label, mr: 0.5 }}>
              {t('teamOpt.search.canChange', 'It may change')}
            </Typography>
            {editKinds(t).map(({ key, label, tip }) => (
              <KindPill
                key={key}
                label={label}
                tip={tip}
                on={kinds[key]}
                disabled={running}
                onClick={() =>
                  setKinds((k) => {
                    lastKinds = { ...k, [key]: !k[key] }
                    return lastKinds
                  })
                }
              />
            ))}
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexWrap: 'wrap',
            }}
          >
            <Segmented
              size="small"
              value={mode}
              onChange={(m: SearchMode) => {
                lastMode = m
                setMode(m)
              }}
              aria-label={t('teamOpt.search.mode', 'Search')}
              options={[
                {
                  value: 'quick' as const,
                  label: t('teamOpt.search.quick', 'Quick'),
                  disabled: running,
                },
                {
                  value: 'full' as const,
                  label: t('teamOpt.search.full', 'Full'),
                  disabled: running,
                },
              ]}
            />
            {mode === 'quick' ? (
              <>
                <Typography sx={type.label}>
                  {t('teamOpt.search.budget', 'Time limit')}
                </Typography>
                <Segmented
                  size="small"
                  value={budget}
                  onChange={setBudget}
                  aria-label={t('teamOpt.search.budget', 'Time limit')}
                  options={BUDGETS.map((s) => ({
                    value: s,
                    label: s < 60 ? `${s} s` : `${s / 60} min`,
                    disabled: running,
                  }))}
                />
              </>
            ) : (
              <Typography sx={{ ...type.label, maxWidth: 300 }}>
                {t(
                  team
                    ? 'teamOpt.search.teamFullNote'
                    : 'teamOpt.search.fullNote',
                  {
                    defaultValue: team
                      ? 'Until nothing within reach is better, each with builds from your inventory (up to {{minutes}} min)'
                      : 'Until nothing within reach is better, each with its own KQM builds (up to {{minutes}} min)',
                    minutes: FULL_MINUTES,
                  }
                )}
              </Typography>
            )}
            <Box sx={{ flexGrow: 1 }} />
            {running ? (
              <Button
                color="inherit"
                variant="outlined"
                onClick={stopAll}
                sx={{ minWidth: 128, borderColor: tokens.hairlineStrong }}
              >
                {t('teamOpt.search.stop', 'Stop')}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={start}
                disabled={!Object.values(kinds).some(Boolean)}
                startIcon={<AutoFixHighIcon />}
                sx={[{ minWidth: 128 }, giCtaSx]}
              >
                {result
                  ? t('teamOpt.search.again', 'Search again')
                  : t('teamOpt.search.start', 'Search')}
              </Button>
            )}
          </Box>
          {run && (
            <Box sx={{ display: 'grid', gap: 0.75 }}>
              <TimeBar run={run} running={running} />
              <Box
                sx={{
                  ...type.label,
                  ...numSx,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.75,
                  minHeight: 20,
                }}
              >
                {!running && ended && (
                  <CheckCircleRoundedIcon
                    sx={{ fontSize: 16, color: 'success.main' }}
                  />
                )}
                <Box component="span" sx={{ flexGrow: 1, minWidth: 0 }}>
                  {searched === 'full' && running && stage
                    ? fullStageText(t, stage, progress, team)
                    : checking && confirmed
                      ? t(
                          team
                            ? 'teamOpt.search.teamChecking'
                            : 'teamOpt.search.checking',
                          {
                            defaultValue: team
                              ? 'Finding builds from your inventory for the best {{total}} · {{done}} of {{total}}'
                              : 'Finding KQM builds for the best {{total}} · {{done}} of {{total}}',
                            total: confirmed.total,
                            done: Object.keys(confirmed.dps).length + 1,
                          }
                        )
                      : progress && (!running || progress.round > 0)
                        ? running
                          ? t('teamOpt.search.progress', {
                              defaultValue:
                                'Round {{round}} · {{played}} rotations played',
                              round: progress.round,
                              played: progress.played.toLocaleString(),
                            })
                          : `${t('teamOpt.search.played', {
                              defaultValue: '{{played}} rotations played',
                              played: (
                                result?.played ?? progress.played
                              ).toLocaleString(),
                            })}${
                              ended
                                ? ` · ${
                                    searched === 'full' && ended === 'converged'
                                      ? t(
                                          'teamOpt.search.fullConverged',
                                          'the best within reach'
                                        )
                                      : endedText(t, ended)
                                  }`
                                : ''
                            }`
                        : t('teamOpt.search.starting', 'Starting…')}
                </Box>
                {running &&
                  threads > 0 &&
                  !checking &&
                  stage?.phase !== 'builds' && (
                    <Box component="span" sx={{ whiteSpace: 'nowrap' }}>
                      {threads === 1
                        ? t('teamOpt.search.oneThread', '1 thread')
                        : t('teamOpt.search.threads', {
                            defaultValue: '{{threads}} threads',
                            threads,
                          })}
                    </Box>
                  )}
                <Clock run={run} running={running} />
              </Box>
            </Box>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {!!better.length && seedScore && (
            <Box sx={{ display: 'grid', gap: 1 }}>
              <Typography sx={type.label}>
                {running
                  ? t('teamOpt.search.soFar', 'Better rotations so far')
                  : t('teamOpt.search.better', 'Better rotations')}
              </Typography>
              <Box
                ref={list}
                sx={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 1,
                }}
              >
                {better.map((c, i) => (
                  <CandidateRow
                    key={c.text}
                    rank={i + 1}
                    candidate={c}
                    seed={(fullDone ? result?.from : undefined) ?? rowSeed!}
                    names={names}
                    funded={funded}
                    own={confirmed?.dps[c.text]}
                    runDps={runDps}
                    team={team}
                    onUse={onUse}
                  />
                ))}
              </Box>
            </Box>
          )}
          {!better.length && !running && result && (
            <Box
              sx={{
                ...insetSx,
                p: 1.5,
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                color: 'text.secondary',
              }}
            >
              <CheckCircleRoundedIcon
                sx={{ fontSize: 18, color: 'success.main' }}
              />
              <Typography>
                {searched === 'full' && ended !== 'converged'
                  ? t(
                      'teamOpt.search.noneStopped',
                      'Stopped before it found a better rotation.'
                    )
                  : searched === 'full'
                    ? team
                      ? t(
                          'teamOpt.search.teamNoneFull',
                          'No better rotation within reach: yours is the best with builds from your inventory.'
                        )
                      : t(
                          'teamOpt.search.noneFull',
                          'No better rotation within reach: yours is the best with its own KQM builds.'
                        )
                    : t(
                        'teamOpt.search.none',
                        'No better rotation one change away: yours is the best of its neighbours.'
                      )}
              </Typography>
            </Box>
          )}
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

/** A search: when it started, its time limit (s) and when it ended */
interface SearchRun {
  start: number
  budget: number
  end?: number
}

/** Where a full search is, as its status line says it */
const fullStageText = (
  t: TFunction,
  stage: FullSearchStage,
  progress: RotationSearchProgress | undefined,
  team: boolean
) =>
  stage.phase === 'builds'
    ? t(team ? 'teamOpt.search.teamFullBuilds' : 'teamOpt.search.fullBuilds', {
        defaultValue: team
          ? 'Pass {{pass}} · builds from your inventory for the best {{total}} · {{done}} of {{total}}'
          : 'Pass {{pass}} · KQM builds for the best {{total}} · {{done}} of {{total}}',
        pass: stage.pass,
        total: stage.total,
        done: (stage.done ?? 0) + 1,
      })
    : stage.phase === 'search'
      ? t('teamOpt.search.fullRound', {
          defaultValue:
            'Pass {{pass}} · start {{start}} of {{starts}} · round {{round}} · {{played}} rotations played',
          pass: stage.pass,
          start: (stage.done ?? 0) + 1,
          starts: stage.total,
          round: progress?.round ?? 0,
          played: (progress?.played ?? 0).toLocaleString(),
        })
      : stage.phase === 'starts'
        ? t('teamOpt.search.fullStarts', {
            defaultValue:
              'Pass {{pass}} · playing every other order and the templates',
            pass: stage.pass,
          })
        : t('teamOpt.search.fullStarting', {
            defaultValue: 'Pass {{pass}} · starting…',
            pass: stage.pass,
          })

const endedText = (t: TFunction, ended: RotationSearchResult['ended']) =>
  ended === 'converged'
    ? t('teamOpt.search.noFurtherGains', 'no further gains in the last pass')
    : ended === 'time'
      ? t('teamOpt.search.timeUp', 'time up')
      : ended === 'cancelled'
        ? t('teamOpt.search.stopped', 'stopped')
        : t('teamOpt.search.rounds', 'all rounds played')

/** What a search may change, as the dialog offers it */
const editKinds = (
  t: TFunction
): { key: keyof RotationEditKinds; label: string; tip: string }[] => [
  {
    key: 'order',
    label: t('teamOpt.search.kindOrder', 'Order'),
    tip: t(
      'teamOpt.search.kindOrderTip',
      'Members played in another order: two swapped, or one moved anywhere (a support right before the member who catches its particles)'
    ),
  },
  {
    key: 'visits',
    label: t('teamOpt.search.kindVisits', 'Coming back'),
    tip: t(
      'teamOpt.search.kindVisitsTip',
      'A member coming back on the field for a Skill or Burst (to refresh a buff), or a member’s extra visit left out'
    ),
  },
  {
    key: 'attacks',
    label: t('teamOpt.search.kindAttacks', 'Attack strings'),
    tip: t(
      'teamOpt.search.kindAttacksTip',
      'Normal Attack lengths, Charged Attacks and their kit options (Sandrone’s beams), plunges, and how often a group repeats'
    ),
  },
  {
    key: 'actions',
    label: t('teamOpt.search.kindActions', 'Skills & kit options'),
    tip: t(
      'teamOpt.search.kindActionsTip',
      'Skills, Bursts, dashes and jumps added, left out or moved in a member’s turn, and kit options (a held Skill)'
    ),
  },
]

/** One kind of change a search may make, on or off */
function KindPill({
  label,
  tip,
  on,
  disabled,
  onClick,
}: {
  label: string
  tip: string
  on: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip arrow title={tip} placement="top">
      <span>
        <ButtonBase
          role="checkbox"
          aria-checked={on}
          disabled={disabled}
          onClick={onClick}
          sx={{
            ...quickSx,
            ...focusSx,
            height: 28,
            px: 1,
            gap: 0.5,
            borderRadius: 999,
            border: `1px solid ${on ? alpha(giTokens.gold, 0.45) : tokens.hairlineStrong}`,
            bgcolor: on ? alpha(giTokens.gold, 0.1) : 'transparent',
            fontSize: 12.5,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            color: on ? 'text.primary' : 'text.secondary',
            '&:hover': {
              bgcolor: on
                ? alpha(giTokens.gold, 0.16)
                : alpha(giTokens.parchment, 0.05),
            },
            '&.Mui-disabled': { opacity: 0.6 },
          }}
        >
          {on && <CheckRoundedIcon sx={{ fontSize: 15, color: tokens.gold }} />}
          {label}
        </ButtonBase>
      </span>
    </Tooltip>
  )
}

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * The time limit's bar: the browser fills it over the time left (nothing re-renders per tick),
 * and it runs to the end when the search ends
 */
function TimeBar({ run, running }: { run: SearchRun; running: boolean }) {
  const bar = useRef<HTMLDivElement>(null)
  const last = useRef<string>()
  useLayoutEffect(() => {
    const el = bar.current
    if (!el || typeof el.animate !== 'function') return undefined
    if (!running) {
      if (last.current && !reducedMotion())
        el.animate([{ transform: last.current }, { transform: 'scaleX(1)' }], {
          duration: 280,
          easing: tokens.ease,
        })
      last.current = undefined
      return undefined
    }
    const total = run.budget * 1000
    const from = Math.min(1, Math.max(0, (Date.now() - run.start) / total))
    const fill = el.animate(
      [{ transform: `scaleX(${from})` }, { transform: 'scaleX(1)' }],
      {
        duration: Math.max(0, total * (1 - from)),
        easing: 'linear',
        fill: 'forwards',
      }
    )
    return () => {
      last.current = getComputedStyle(el).transform
      fill.cancel()
    }
  }, [running, run])
  return (
    <Box
      sx={{
        height: 4,
        borderRadius: 999,
        overflow: 'hidden',
        bgcolor: alpha(giTokens.parchment, 0.08),
      }}
    >
      <Box
        ref={bar}
        sx={{
          height: '100%',
          borderRadius: 999,
          bgcolor: tokens.gold,
          transformOrigin: 'left',
          transform: 'scaleX(1)',
          willChange: 'transform',
        }}
      />
    </Box>
  )
}

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** The time taken (and the limit, while it runs): only this re-renders each second */
function Clock({ run, running }: { run: SearchRun; running: boolean }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return undefined
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  const taken = ((running ? now : (run.end ?? now)) - run.start) / 1000
  return (
    <Box component="span" sx={{ ...numSx, whiteSpace: 'nowrap' }}>
      {clock(taken)}
      {running && ` / ${clock(run.budget)}`}
    </Box>
  )
}

/** Rows that move slide to their new place, new ones fade in (none with reduced motion) */
function useListMotion(ref: RefObject<HTMLElement>, order: string) {
  const tops = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) {
      tops.current = new Map()
      return
    }
    const still = reducedMotion()
    const next = new Map<string, number>()
    for (const row of Array.from(el.children) as HTMLElement[]) {
      const key = row.dataset['key']
      if (!key) continue
      next.set(key, row.offsetTop)
      if (still || typeof row.animate !== 'function') continue
      const before = tops.current.get(key)
      if (before === undefined)
        row.animate(
          [
            { opacity: 0, transform: 'translateY(6px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 220, easing: tokens.ease }
        )
      else if (Math.abs(before - row.offsetTop) > 1)
        row.animate(
          [
            { transform: `translateY(${before - row.offsetTop}px)` },
            { transform: 'none' },
          ],
          { duration: 260, easing: tokens.ease }
        )
    }
    tops.current = next
  }, [ref, order])
}

/** A rotation as the bar shows it: each member, then their actions */
/**
 * Per step, which of its words `from` doesn't have at the same member's same turn on the field
 * (those its words' longest common run leaves out): every word of a turn it doesn't have
 */
function changedWords(
  steps: readonly RotationWordStep[],
  from: readonly RotationWordStep[]
): boolean[][] {
  const seen = new Map<string, number>()
  return steps.map(({ characterKey, words }) => {
    const turn = seen.get(characterKey) ?? 0
    seen.set(characterKey, turn + 1)
    const before = from.filter((s) => s.characterKey === characterKey)[turn]
      ?.words
    if (!before) return words.map(() => true)
    // (the longest common run of the two, by dynamic programming, then walked back)
    const n = words.length
    const m = before.length
    const run = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        run[i][j] =
          words[i] === before[j]
            ? run[i + 1][j + 1] + 1
            : Math.max(run[i + 1][j], run[i][j + 1])
    const changed = words.map(() => true)
    for (let i = 0, j = 0; i < n && j < m; )
      if (words[i] === before[j]) {
        changed[i] = false
        i++
        j++
      } else if (run[i + 1][j] >= run[i][j + 1]) i++
      else j++
    return changed
  })
}

function RotationView({
  steps,
  from,
}: {
  steps: readonly RotationWordStep[]
  /** The rotation it is compared with: its words that differ, marked */
  from?: readonly RotationWordStep[]
}) {
  const changed = useMemo(
    () => from && changedWords(steps, from),
    [steps, from]
  )
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 0.75,
        rowGap: 0.5,
        minWidth: 0,
      }}
    >
      {steps.map((step, i) => (
        <Fragment key={i}>
          {i > 0 && <Arrow />}
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.625,
              minWidth: 0,
            }}
          >
            <MemberAvatar characterKey={step.characterKey} size={20} />
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                columnGap: 0.625,
                rowGap: 0.25,
                minWidth: 0,
              }}
            >
              <Box
                component="span"
                sx={(theme) => ({
                  color: laneColor(theme, step.characterKey),
                  fontWeight: 650,
                  fontSize: 13.5,
                  whiteSpace: 'nowrap',
                })}
              >
                {step.name}
              </Box>
              {step.words.map((word, k) => (
                <Box
                  key={k}
                  component="span"
                  sx={{
                    fontFamily: mono,
                    fontSize: 13.5,
                    letterSpacing: '0.01em',
                    color: 'text.primary',
                    // (a word your rotation doesn't have here: what this one changes)
                    ...(changed?.[i]?.[k] && {
                      color: tokens.gold,
                      fontWeight: 650,
                      px: 0.375,
                      mx: -0.375,
                      borderRadius: 0.75,
                      bgcolor: alpha(giTokens.gold, 0.14),
                    }),
                  }}
                >
                  {word}
                </Box>
              ))}
            </Box>
          </Box>
        </Fragment>
      ))}
    </Box>
  )
}

/** Each member's Energy Recharge need for the rotation, above its build's in amber */
function ErLine({
  er,
  names,
  funded,
  team,
}: {
  er: RotationCandidate['er']
  names: RotationMember[]
  funded: Partial<Record<CharacterKey, number>>
  /** Team optimize's builds (from the inventory), not KQM's */
  team: boolean
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={{
        ...type.label,
        ...numSx,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 1.25,
        rowGap: 0.5,
      }}
    >
      <span>{t('teamOpt.search.erNeeded', 'ER needed')}</span>
      {names.map(({ characterKey, name }) => {
        const need = er[characterKey]
        if (need === undefined) return null
        const has = funded[characterKey] ?? 0
        const over = need > has
        const item = (
          <Box
            key={characterKey}
            component="span"
            aria-label={name}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              whiteSpace: 'nowrap',
              color: over ? 'warning.main' : undefined,
              fontWeight: over ? 600 : undefined,
            }}
          >
            <MemberAvatar characterKey={characterKey} size={16} />
            {need}%
          </Box>
        )
        return over ? (
          <Tooltip
            key={characterKey}
            title={
              team
                ? t('teamOpt.search.teamErOver', {
                    defaultValue:
                      'More than the {{has}}% its build has: the builds found for it from your inventory need more',
                    has,
                  })
                : t('teamOpt.search.erOver', {
                    defaultValue:
                      'More than the {{has}}% its KQM build has: run KQM again to build for it',
                    has,
                  })
            }
          >
            {item}
          </Tooltip>
        ) : (
          <Fragment key={characterKey}>{item}</Fragment>
        )
      })}
    </Box>
  )
}

const CandidateRow = memo(function CandidateRow({
  rank,
  candidate,
  seed,
  names,
  funded,
  own,
  runDps,
  team,
  onUse,
}: {
  rank: number
  candidate: RotationCandidate
  seed: RotationCandidate
  names: RotationMember[]
  funded: Partial<Record<CharacterKey, number>>
  /** Its DPS with builds of its own (null: none found; absent: not run) */
  own?: number | null
  /** The run's DPS with its builds, for the rotation searched from */
  runDps: number
  /** Team optimize's builds (from the inventory), not KQM's */
  team: boolean
  onUse: (text: string) => void
}) {
  const { t } = useTranslation('page_team')
  const steps = useMemo(
    () => rotationWords(candidate.text, names),
    [candidate.text, names]
  )
  const seedSteps = useMemo(
    () => rotationWords(seed.text, names),
    [seed.text, names]
  )
  const checked = typeof own === 'number' && runDps > 0
  const erOver =
    !checked &&
    team &&
    Object.entries(candidate.er).some(
      ([k, need]) =>
        need !== undefined && need > (funded[k as CharacterKey] ?? 0)
    )
  const gain = checked
    ? own / runDps - 1
    : candidate.estimate / seed.estimate - 1
  const estimated = Math.abs(candidate.estimate - candidate.dps) > 0.5
  const tip = checked
    ? team
      ? t('teamOpt.search.teamOwnTip', {
          defaultValue:
            'With builds of its own from your inventory: {{own}} DPS, against {{run}} for your rotation’s. With your run’s builds it plays {{dps}} DPS.',
          own: formatDamage(own, true),
          run: formatDamage(runDps, true),
          dps: formatDamage(candidate.dps, true),
        })
      : t('teamOpt.search.ownTip', {
          defaultValue:
            'With its own KQM builds: {{own}} DPS, against {{run}} for your rotation’s. With your run’s builds it plays {{dps}} DPS.',
          own: formatDamage(own, true),
          run: formatDamage(runDps, true),
          dps: formatDamage(candidate.dps, true),
        })
    : estimated
      ? team
        ? t('teamOpt.search.teamEstimateTip', {
            defaultValue:
              'With your run’s builds it plays {{dps}} DPS; builds adjusted for its Energy Recharge needs would have about {{estimate}}.',
            dps: formatDamage(candidate.dps, true),
            estimate: formatDamage(candidate.estimate, true),
          })
        : t('teamOpt.search.estimateTip', {
            defaultValue:
              'With your KQM run’s builds it plays {{dps}} DPS; builds made for its Energy Recharge needs would have about {{estimate}}.',
            dps: formatDamage(candidate.dps, true),
            estimate: formatDamage(candidate.estimate, true),
          })
      : erOver
        ? t(
            'teamOpt.search.teamNeedsErTip',
            'Played with your run’s builds, which do not meet this rotation’s ER: optimizing builds for it may give lower DPS.'
          )
        : team
          ? t('teamOpt.search.teamPlayedTip', 'Played with your run’s builds.')
          : t('teamOpt.search.playedTip', 'Played with your KQM run’s builds.')
  return (
    <Box
      data-key={candidate.text}
      sx={{
        ...quickSx,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 1.5,
        rowGap: 1,
        p: 1.25,
        pl: { xs: 1.25, sm: 1 },
        borderRadius: tokens.radius.inset,
        bgcolor: tokens.inset,
        border: `1px solid ${
          rank === 1 ? alpha(giTokens.gold, 0.35) : giTokens.hairline
        }`,
        '&:hover': {
          bgcolor: tokens.hover,
          borderColor:
            rank === 1 ? alpha(giTokens.gold, 0.55) : tokens.hairlineStrong,
        },
      }}
    >
      <Box
        sx={{
          ...numSx,
          display: { xs: 'none', sm: 'block' },
          width: 18,
          alignSelf: 'flex-start',
          pt: 0.25,
          textAlign: 'center',
          fontSize: 12.5,
          fontWeight: 600,
          color: rank === 1 ? tokens.gold : 'text.secondary',
        }}
      >
        {rank}
      </Box>
      <Box sx={{ flex: '1 1 340px', minWidth: 0, display: 'grid', gap: 0.75 }}>
        <RotationView steps={steps} from={seedSteps} />
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 1.5,
            rowGap: 0.5,
          }}
        >
          <Typography sx={{ ...type.label, ...numSx }}>
            {t('teamOpt.search.length', {
              defaultValue: '{{seconds}} s rotation',
              seconds: candidate.time.toFixed(1),
            })}
          </Typography>
          <ErLine er={candidate.er} names={names} funded={funded} team={team} />
        </Box>
      </Box>
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Tooltip arrow title={tip} placement="top">
          <Box sx={{ textAlign: 'right' }}>
            <Typography
              sx={{
                ...type.stat,
                color: gain >= 0 ? 'success.main' : 'warning.main',
              }}
            >
              {!checked && estimated ? '≈' : ''}
              {gain >= 0 ? '+' : ''}
              {(gain * 100).toFixed(1)}%
            </Typography>
            <Typography
              sx={{
                ...type.label,
                ...numSx,
                whiteSpace: 'nowrap',
                color: erOver ? 'warning.main' : undefined,
              }}
            >
              {checked
                ? t('teamOpt.search.ownDps', {
                    defaultValue: '{{dps}} DPS · own builds',
                    dps: formatDamage(own, true),
                  })
                : estimated
                  ? t('teamOpt.search.estimateDps', {
                      defaultValue: '≈{{dps}} DPS',
                      dps: formatDamage(candidate.estimate, true),
                    })
                  : erOver
                    ? t('teamOpt.search.teamNeedsErDps', {
                        defaultValue: '{{dps}} DPS · needs more ER',
                        dps: formatDamage(candidate.dps, true),
                      })
                    : `${formatDamage(candidate.dps, true)} DPS`}
            </Typography>
            <Typography sx={{ ...type.label, ...numSx }}>
              {checked
                ? t(
                    'teamOpt.search.vsBuildRun',
                    'vs {{dps}} DPS · prior build run',
                    { dps: formatDamage(runDps, true) }
                  )
                : t('teamOpt.search.vsReplay', 'vs {{dps}} DPS · {{method}}', {
                    dps: formatDamage(seed.estimate, true),
                    method: estimated
                      ? t('teamOpt.search.estimate', 'estimate')
                      : t('teamOpt.search.replay', 'same builds'),
                  })}
            </Typography>
          </Box>
        </Tooltip>
        <Button
          size="small"
          onClick={() => onUse(candidate.text)}
          sx={{
            ...focusSx,
            minWidth: 64,
            color: tokens.gold,
            bgcolor: alpha(giTokens.gold, 0.1),
            border: `1px solid ${alpha(giTokens.gold, 0.3)}`,
            '&:hover': {
              bgcolor: alpha(giTokens.gold, 0.18),
              borderColor: alpha(giTokens.gold, 0.55),
            },
          }}
        >
          {t('teamOpt.search.use', 'Use')}
        </Button>
      </Box>
    </Box>
  )
})
