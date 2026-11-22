import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  KqmResult,
  RotationCandidate,
  RotationMember,
  RotationSearchProgress,
  RotationSearchResult,
  RotationWordStep,
} from '@genshin-optimizer/gi/ui'
import {
  kqmRotationSearchSetup,
  rotationSearchPlayer,
  rotationWords,
  searchRotations,
} from '@genshin-optimizer/gi/ui'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
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
import { focusSx, insetSx, numSx, quickSx, Segmented, tokens, type } from './ui'

/** How long a search may take (seconds) */
const BUDGETS = [30, 120, 300] as const
/** Rotations shown after a search */
const SHOWN = 5

/**
 * The KQM tab's rotation search, from the rotation in the writer: thousands of rotations a change
 * or a few away, played with the KQM builds shown (`searchRotations`), the best offered to use
 */
export function RotationSearchButton({
  teamId,
  text,
  names,
  kqmResult,
  kqmTeamOpt,
  onUse,
  compact,
  disabled,
}: {
  teamId: string
  text: string
  names: RotationMember[]
  /** The KQM builds shown, as they played the rotation; absent: no current result */
  kqmResult: KqmResult | undefined
  /** The settings that result was run with */
  kqmTeamOpt: TeamOpt | undefined
  onUse: (text: string) => void
  /** On the rotation's line: a pill like its other settings */
  compact?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const [open, setOpen] = useState(false)
  const written = !!text.trim()
  const ready = !!kqmResult && !!kqmTeamOpt && written && !disabled
  const tip = (
    <Box component="span" sx={{ display: 'grid', gap: 1 }}>
      <span>
        <Box component="strong" sx={{ display: 'block' }}>
          {t('teamOpt.search.title', 'Optimize rotation')}
        </Box>
        {t(
          'teamOpt.search.tip',
          'Tries thousands of small changes to this rotation (step order, actions, Normal Attack lengths, kit options like Sandrone’s beams) and plays each with the builds of the last KQM run. Your main DPS keeps its Burst and field time.'
        )}
      </span>
      {!ready && (
        <Box component="span" sx={{ color: 'warning.main' }}>
          {written
            ? t(
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
              disabled={!ready}
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
              {t('teamOpt.search.button', 'Optimize')}
            </ButtonBase>
          ) : (
            <Button
              size="small"
              color="inherit"
              disabled={!ready}
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
              {t('teamOpt.search.button', 'Optimize')}
            </Button>
          )}
        </span>
      </Tooltip>
      {open && kqmResult && kqmTeamOpt && (
        <RotationSearchDialog
          teamId={teamId}
          seed={text}
          names={names}
          kqmResult={kqmResult}
          kqmTeamOpt={kqmTeamOpt}
          onClose={() => setOpen(false)}
          onUse={(chosen) => {
            onUse(chosen)
            setOpen(false)
          }}
        />
      )}
    </>
  )
}

function RotationSearchDialog({
  teamId,
  seed,
  names,
  kqmResult,
  kqmTeamOpt,
  onClose,
  onUse,
}: {
  teamId: string
  seed: string
  names: RotationMember[]
  kqmResult: KqmResult
  kqmTeamOpt: TeamOpt
  onClose: () => void
  onUse: (text: string) => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const saved = useRotationSettings(kqmRotationId(teamId))
  const [budget, setBudget] = useState<(typeof BUDGETS)[number]>(120)
  const [run, setRun] = useState<SearchRun>()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RotationSearchProgress>()
  const [result, setResult] = useState<RotationSearchResult>()
  const [error, setError] = useState<string>()
  const [threads, setThreads] = useState(0)
  const cancelled = useRef(false)
  const release = useRef<() => void>()
  useEffect(
    () => () => {
      cancelled.current = true
      release.current?.()
    },
    []
  )

  const start = () => {
    cancelled.current = false
    setResult(undefined)
    setError(undefined)
    setProgress(undefined)
    setRun({ start: Date.now(), budget })
    setRunning(true)
    let player: ReturnType<typeof rotationSearchPlayer>
    try {
      player = rotationSearchPlayer(
        database,
        kqmRotationSearchSetup(
          database,
          teamId,
          gender,
          names,
          kqmTeamOpt,
          kqmResult,
          {
            opener: saved.opener,
            timing: saved.timing,
            frameData: saved.frameData,
          }
        )
      )
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
      setRunning(false)
      return
    }
    release.current = player.release
    setThreads(player.threads())
    let shown = 0
    searchRotations({
      seed,
      members: names,
      score: player.score,
      deadline: Date.now() + budget * 1000,
      funded: Object.fromEntries(
        Object.entries(kqmResult.energyRecharge).map(([k, er]) => [
          k,
          er?.value ?? 0,
        ])
      ) as Partial<Record<CharacterKey, number>>,
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
      .then(setResult)
      .catch((e) => setError(String((e as Error)?.message ?? e)))
      .finally(() => {
        player.release()
        release.current = undefined
        setRun((r) => r && { ...r, end: Date.now() })
        setRunning(false)
      })
  }

  const funded = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(kqmResult.energyRecharge).map(([k, er]) => [
          k,
          Math.round(er?.value ?? 0),
        ])
      ) as Partial<Record<CharacterKey, number>>,
    [kqmResult]
  )
  const seedWords = useMemo(() => rotationWords(seed, names), [seed, names])
  const seedScore = result?.seed ?? progress?.seed
  const top = result?.best ?? progress?.top
  const better = useMemo(
    () =>
      seedScore && top
        ? top.filter((c) => c.dps > seedScore.dps * (1 + 1e-4)).slice(0, SHOWN)
        : [],
    [top, seedScore]
  )
  const list = useRef<HTMLDivElement>(null)
  useListMotion(list, better.map((c) => c.text).join('\n'))
  const ended = result?.ended
  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'md' }}
      aria-label={t('teamOpt.search.title', 'Optimize rotation')}
    >
      <CardThemed>
        <DialogHead
          title={t('teamOpt.search.title', 'Optimize rotation')}
          info={t(
            'teamOpt.search.how',
            'Plays thousands of rotations one change away from yours, then from the best ones (step order, actions, Normal Attack lengths, repeats, kit options), with the KQM builds shown. Your main DPS keeps its Burst and field time, and a rotation must not need more Energy Recharge than the builds can give. After using one, run KQM again for its own builds.'
          )}
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
                {t('teamOpt.search.yours', 'Your rotation')}
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
              <ErLine er={seedScore.er} names={names} funded={funded} />
            )}
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexWrap: 'wrap',
            }}
          >
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
            <Box sx={{ flexGrow: 1 }} />
            {running ? (
              <Button
                color="inherit"
                variant="outlined"
                onClick={() => {
                  cancelled.current = true
                }}
                sx={{ minWidth: 128, borderColor: tokens.hairlineStrong }}
              >
                {t('teamOpt.search.stop', 'Stop')}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={start}
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
                  {progress && (!running || progress.round > 0)
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
                        })}${ended ? ` · ${endedText(t, ended)}` : ''}`
                    : t('teamOpt.search.starting', 'Starting…')}
                </Box>
                {threads > 0 && (
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
                    seed={seedScore}
                    names={names}
                    funded={funded}
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
                {t(
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

const endedText = (t: TFunction, ended: RotationSearchResult['ended']) =>
  ended === 'converged'
    ? t('teamOpt.search.converged', 'nothing better nearby')
    : ended === 'time'
      ? t('teamOpt.search.timeUp', 'time up')
      : ended === 'cancelled'
        ? t('teamOpt.search.stopped', 'stopped')
        : t('teamOpt.search.rounds', 'all rounds played')

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
    const from = Math.min(1, (Date.now() - run.start) / total)
    const fill = el.animate(
      [{ transform: `scaleX(${from})` }, { transform: 'scaleX(1)' }],
      { duration: total * (1 - from), easing: 'linear', fill: 'forwards' }
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
function RotationView({ steps }: { steps: readonly RotationWordStep[] }) {
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

/** Each member's Energy Recharge need for the rotation, above its KQM build's in amber */
function ErLine({
  er,
  names,
  funded,
}: {
  er: RotationCandidate['er']
  names: RotationMember[]
  funded: Partial<Record<CharacterKey, number>>
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
            title={t('teamOpt.search.erOver', {
              defaultValue:
                'More than the {{has}}% its KQM build has: run KQM again to build for it',
              has,
            })}
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
  onUse,
}: {
  rank: number
  candidate: RotationCandidate
  seed: RotationCandidate
  names: RotationMember[]
  funded: Partial<Record<CharacterKey, number>>
  onUse: (text: string) => void
}) {
  const { t } = useTranslation('page_team')
  const steps = useMemo(
    () => rotationWords(candidate.text, names),
    [candidate.text, names]
  )
  const gain = candidate.dps / seed.dps - 1
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
        <RotationView steps={steps} />
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
          <ErLine er={candidate.er} names={names} funded={funded} />
        </Box>
      </Box>
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ ...type.stat, color: 'success.main' }}>
            +{(gain * 100).toFixed(1)}%
          </Typography>
          <Typography sx={{ ...type.label, ...numSx, whiteSpace: 'nowrap' }}>
            {formatDamage(candidate.dps, true)} DPS
          </Typography>
        </Box>
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
