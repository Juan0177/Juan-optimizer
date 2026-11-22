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
} from '@genshin-optimizer/gi/ui'
import {
  kqmRotationSearchSetup,
  rotationSearchPlayer,
  searchRotations,
} from '@genshin-optimizer/gi/ui'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import {
  Alert,
  alpha,
  Box,
  Button,
  ButtonBase,
  LinearProgress,
  Tooltip,
  Typography,
} from '@mui/material'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDamage } from './format'
import { DialogHead } from './OptionTile'
import { kqmRotationId, useRotationSettings } from './RotationWriter'
import {
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  tokens,
} from './ui'

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
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RotationSearchProgress>()
  const [result, setResult] = useState<RotationSearchResult>()
  const [error, setError] = useState<string>()
  const [threads, setThreads] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const cancelled = useRef(false)
  const release = useRef<() => void>()
  useEffect(
    () => () => {
      cancelled.current = true
      release.current?.()
    },
    []
  )
  useEffect(() => {
    if (!running) return
    const start = Date.now()
    const timer = setInterval(
      () => setElapsed((Date.now() - start) / 1000),
      250
    )
    return () => clearInterval(timer)
  }, [running])

  const start = () => {
    cancelled.current = false
    setResult(undefined)
    setError(undefined)
    setProgress(undefined)
    setElapsed(0)
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
        if (now - shown < 200 && p.roundPlayed < p.roundSize) return
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
        setRunning(false)
      })
  }

  const funded = Object.fromEntries(
    Object.entries(kqmResult.energyRecharge).map(([k, er]) => [
      k,
      Math.round(er?.value ?? 0),
    ])
  ) as Partial<Record<CharacterKey, number>>
  const best = result?.best ?? (progress ? [progress.best] : [])
  const seedScore = result?.seed ?? progress?.seed
  const better = seedScore
    ? best.filter((c) => c.dps > seedScore.dps * (1 + 1e-4)).slice(0, SHOWN)
    : []
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
            'Plays thousands of rotations one change away from yours, then from the best ones (step order, actions, Normal Attack lengths, repeats), with the KQM builds shown. Your main DPS keeps its Burst and field time, and a rotation must not need more Energy Recharge than the builds can give.'
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
          <RotationLine
            label={t('teamOpt.search.from', 'From')}
            text={seed}
            dps={seedScore?.dps}
            er={
              seedScore && (
                <ErNeeds er={seedScore.er} names={names} funded={funded} />
              )
            }
          />
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexWrap: 'wrap',
            }}
          >
            <Typography variant="caption" color="text.secondary">
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
                onClick={() => {
                  cancelled.current = true
                }}
              >
                {t('teamOpt.search.stop', 'Stop')}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={start}
                sx={[{ px: 2.25 }, giCtaSx]}
              >
                {result
                  ? t('teamOpt.search.again', 'Search again')
                  : t('teamOpt.search.start', 'Search')}
              </Button>
            )}
          </Box>
          {(running || progress) && (
            <Box>
              <LinearProgress
                variant="determinate"
                value={running ? Math.min(100, (elapsed / budget) * 100) : 100}
                sx={{ borderRadius: 1, mb: 0.75 }}
              />
              <Typography variant="caption" color="text.secondary" sx={numSx}>
                {progress
                  ? `${t('teamOpt.search.progress', {
                      defaultValue:
                        'Round {{round}} · {{played}} rotations played',
                      round: progress.round,
                      played: progress.played.toLocaleString(),
                    })} · ${
                      threads === 1
                        ? t('teamOpt.search.oneThread', '1 thread')
                        : t('teamOpt.search.threads', {
                            defaultValue: '{{threads}} threads',
                            threads,
                          })
                    }`
                  : t('teamOpt.search.starting', 'Starting…')}
                {result &&
                  ` · ${
                    result.ended === 'converged'
                      ? t('teamOpt.search.converged', 'nothing better nearby')
                      : result.ended === 'time'
                        ? t('teamOpt.search.timeUp', 'time up')
                        : result.ended === 'cancelled'
                          ? t('teamOpt.search.stopped', 'stopped')
                          : t('teamOpt.search.rounds', 'all rounds played')
                  }`}
              </Typography>
            </Box>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {seedScore &&
            (better.length ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {better.map((c) => (
                  <Candidate
                    key={c.text}
                    candidate={c}
                    seed={seedScore}
                    names={names}
                    funded={funded}
                    onUse={running ? undefined : () => onUse(c.text)}
                  />
                ))}
              </Box>
            ) : (
              !running &&
              result && (
                <Typography color="text.secondary">
                  {t(
                    'teamOpt.search.none',
                    'No better rotation one change away: yours is the best of its neighbours.'
                  )}
                </Typography>
              )
            ))}
          {!!better.length && !running && (
            <Typography variant="caption" color="text.secondary">
              {t(
                'teamOpt.search.after',
                'DPS with the KQM builds shown. After using one, run KQM again for its own builds.'
              )}
            </Typography>
          )}
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

function RotationLine({
  label,
  text,
  dps,
  er,
}: {
  label: string
  text: string
  dps: number | undefined
  er?: ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline' }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ width: 40, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box
          sx={{
            fontFamily: 'monospace',
            fontSize: 13,
            overflowWrap: 'anywhere',
          }}
        >
          {text}
        </Box>
        {er}
      </Box>
      <Typography sx={{ ...numSx, flexShrink: 0, fontWeight: 600 }}>
        {dps ? formatDamage(dps, true) : '–'}
      </Typography>
    </Box>
  )
}

/**
 * The Energy Recharge each member needs for a rotation: above what the starting one needs in
 * bold, above what its KQM build has in amber (KQM builds more ER for it when run again)
 */
function ErNeeds({
  er,
  names,
  funded,
  seed,
}: {
  er: RotationCandidate['er']
  names: RotationMember[]
  funded: Partial<Record<CharacterKey, number>>
  seed?: RotationCandidate['er']
}) {
  const { t } = useTranslation('page_team')
  return (
    <Typography
      component="div"
      variant="caption"
      color="text.secondary"
      sx={{ ...numSx, display: 'flex', flexWrap: 'wrap', columnGap: 1.25 }}
    >
      <span>{t('teamOpt.search.erNeeded', 'ER needed')}</span>
      {names.map(({ characterKey, name }) => {
        const need = er[characterKey]
        if (need === undefined) return null
        const has = funded[characterKey] ?? 0
        const over = need > has
        const more = seed && need > Math.max(seed[characterKey] ?? 100, 100)
        const item = (
          <Box
            component="span"
            sx={{
              whiteSpace: 'nowrap',
              color: over ? 'warning.main' : more ? 'text.primary' : undefined,
              fontWeight: over || more ? 650 : undefined,
            }}
          >
            {name} {need}%
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
          <Box component="span" key={characterKey}>
            {item}
          </Box>
        )
      })}
    </Typography>
  )
}

function Candidate({
  candidate,
  seed,
  names,
  funded,
  onUse,
}: {
  candidate: RotationCandidate
  seed: RotationCandidate
  names: RotationMember[]
  funded: Partial<Record<CharacterKey, number>>
  onUse: (() => void) | undefined
}) {
  const { t } = useTranslation('page_team')
  const gain = candidate.dps / seed.dps - 1
  return (
    <Box
      sx={{
        ...insetSx,
        p: 1.25,
        display: 'flex',
        gap: 1.5,
        alignItems: 'center',
        border: hairline,
        borderRadius: tokens.radius.inset,
      }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box
          sx={{
            fontFamily: 'monospace',
            fontSize: 13,
            overflowWrap: 'anywhere',
          }}
        >
          {candidate.text}
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ ...numSx, display: 'block', mt: 0.5 }}
        >
          {formatDamage(candidate.dps, true)} DPS · {candidate.time.toFixed(1)}{' '}
          s
        </Typography>
        <ErNeeds
          er={candidate.er}
          names={names}
          funded={funded}
          seed={seed.er}
        />
      </Box>
      <Typography
        sx={{
          ...numSx,
          fontWeight: 650,
          color: 'success.main',
          flexShrink: 0,
        }}
      >
        +{(gain * 100).toFixed(1)}%
      </Typography>
      <Button
        size="small"
        variant="outlined"
        disabled={!onUse}
        onClick={onUse}
        sx={{ flexShrink: 0 }}
      >
        {t('teamOpt.search.use', 'Use')}
      </Button>
    </Box>
  )
}
