import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type { ArtifactSetKey, CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  BonusStats,
  BurstCadence,
  BurstMemberConfig,
  CustomScenarioInput,
  RotationMember,
  RotationScenario,
  RotationWordStep,
  RunAttackState,
} from '@genshin-optimizer/gi/ui'
import {
  ArtifactSetName,
  BURST_CADENCES,
  buildRotationScenarios,
  detectBurstMembers,
  kqmBurstEvery,
  MAX_COMPARISON_SCENARIOS,
  rankScenarioResults,
  rotationWords,
  teamBurstEvery,
  useNumWorkers,
  validateInsteadAction,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Alert,
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  CircularProgress,
  Collapse,
  IconButton,
  InputBase,
  LinearProgress,
  Snackbar,
  Tooltip,
  Typography,
} from '@mui/material'
import type { TFunction } from 'i18next'
import {
  Fragment,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { formatGain, formatRateFull } from './format'
import { MemberAvatar } from './MemberAvatar'
import { DialogHead } from './OptionTile'
import { Arrow, mono } from './RotationInline'
import type { RotationSearchBase } from './RotationSearch'
import { laneColor } from './RotationTimeline'
import { kqmRotationId, useRotationSettings } from './RotationWriter'
import {
  applyRotationScenario,
  baselineScenarioResult,
  previewRotationScenario,
  runRotationScenario,
  type ScenarioCompareMode,
  type ScenarioLiveStep,
  type ScenarioPreview,
  type ScenarioRunContext,
  type ScenarioRunResult,
} from './rotationScenarioRun'
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
import type { TeamOptUpdate } from './useTeamOpt'

/** Human-readable label for a Burst cadence choice. */
function cadenceLabel(t: TFunction, cadence: BurstCadence, short = false) {
  switch (cadence) {
    case 1:
      return short
        ? t('teamOpt.compare.everyShort', 'Every')
        : t('teamOpt.compare.every', 'Every')
    case 2:
      return short
        ? t('teamOpt.compare.every2Short', '2nd')
        : t('teamOpt.compare.every2', 'Every 2nd')
    case 3:
      return short
        ? t('teamOpt.compare.every3Short', '3rd')
        : t('teamOpt.compare.every3', 'Every 3rd')
    case 0:
      return t('teamOpt.compare.skip', 'Skip')
  }
}

/** Compact summary string for toast & progress line. */
function scenarioTitle(
  t: TFunction,
  scenario: RotationScenario,
  names: readonly RotationMember[],
  varying: ReadonlySet<CharacterKey>
): string {
  if (scenario.kind === 'custom')
    return scenario.label || t('teamOpt.compare.customLabel', 'Custom rotation')
  const nameOf = (ck: CharacterKey) =>
    names.find((n) => n.characterKey === ck)?.name ?? ck
  const entries = Object.entries(scenario.choices) as [
    CharacterKey,
    { cadence: BurstCadence; instead?: string },
  ][]
  const shown =
    varying.size > 0 ? entries.filter(([ck]) => varying.has(ck)) : entries
  return shown
    .map(([ck, ch]) => {
      const base = `${nameOf(ck)} ${cadenceLabel(t, ch.cadence)}`
      return ch.cadence !== 1 && ch.instead ? `${base} (→ ${ch.instead})` : base
    })
    .join(' · ')
}

/**
 * Compact trigger button on the rotation bar (and inside the Rotation Writer) to compare
 * multiple Burst cadences, fallback actions (e.g. `N4` instead of `Q`), and custom variants
 * starting from the active tab's already-optimized builds.
 */
export function RotationCompareButton({
  tab,
  teamId,
  text,
  names,
  teamOpt,
  setTeamOpt,
  base,
  baseStale,
  attackStates,
  rankingBonusStats,
  onApplied,
  compact,
  disabled,
}: {
  tab: 'team' | 'kqm'
  teamId: string
  text: string
  names: RotationMember[]
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  /** The active tab's latest optimization result; absent until the user runs optimization once */
  base: RotationSearchBase | undefined
  /** True when rotation/settings changed since `base` was computed */
  baseStale?: boolean
  attackStates?: RefObject<readonly RunAttackState[] | undefined>
  rankingBonusStats?: RefObject<
    Partial<Record<CharacterKey, BonusStats>> | undefined
  >
  /** Called with the applied rotation text (e.g. to sync an open writer dialog) */
  onApplied?: (text: string) => void
  compact?: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string>()
  const written = !!text.trim()
  const hasBase = base?.tab === tab
  const ready = hasBase && written && !disabled

  const tip = (
    <Box component="span" sx={{ display: 'grid', gap: 0.75 }}>
      <span>
        <Box component="strong" sx={{ display: 'block' }}>
          {t('teamOpt.compare.title', 'Burst scenarios')}
        </Box>
        {t(
          'teamOpt.compare.tip',
          'Compare Burst every rotation vs every 2nd or skipped (with an optional fallback like N4), recalculate ER requirements for each scenario, optimize builds, and rank them by team DPS.'
        )}
      </span>
      {!written ? (
        <Box component="span" sx={{ color: 'warning.main' }}>
          {t(
            'teamOpt.compare.needsText',
            'Write a rotation first to compare Burst scenarios.'
          )}
        </Box>
      ) : !hasBase ? (
        <Box component="span" sx={{ color: 'warning.main' }}>
          {tab === 'team'
            ? t(
                'teamOpt.compare.teamNeedsRun',
                'Optimize the team first: scenarios start from those builds and reuse your baseline run.'
              )
            : t(
                'teamOpt.compare.kqmNeedsRun',
                'Generate KQM builds first: scenarios start from those builds and reuse your baseline run.'
              )}
        </Box>
      ) : null}
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
              <CompareArrowsRoundedIcon
                sx={{ fontSize: 16, color: 'text.secondary' }}
              />
              {t('teamOpt.compare.button', 'Burst scenarios')}
            </ButtonBase>
          ) : (
            <Button
              size="small"
              color="inherit"
              disabled={!ready}
              startIcon={
                <CompareArrowsRoundedIcon
                  sx={{ fontSize: '16px !important' }}
                />
              }
              onClick={() => setOpen(true)}
              sx={{
                fontSize: 12.5,
                whiteSpace: 'nowrap',
                color: 'text.secondary',
              }}
            >
              {t('teamOpt.compare.button', 'Burst scenarios')}
            </Button>
          )}
        </span>
      </Tooltip>
      {open && hasBase && (
        <RotationCompareDialog
          tab={tab}
          teamId={teamId}
          baseText={text}
          names={names}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          base={base}
          baseStale={baseStale}
          attackStates={attackStates}
          rankingBonusStats={rankingBonusStats}
          onClose={() => setOpen(false)}
          onApplied={(appliedText, label) => {
            onApplied?.(appliedText)
            setToast(label)
            setOpen(false)
          }}
        />
      )}
      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(undefined)}
        message={
          toast
            ? t('teamOpt.compare.appliedToast', {
                defaultValue: 'Applied scenario: {{label}}',
                label: toast,
              })
            : undefined
        }
      />
    </>
  )
}

function RotationCompareDialog({
  tab,
  teamId,
  baseText,
  names,
  teamOpt,
  setTeamOpt,
  base,
  baseStale,
  attackStates,
  rankingBonusStats,
  onClose,
  onApplied,
}: {
  tab: 'team' | 'kqm'
  teamId: string
  baseText: string
  names: RotationMember[]
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  base: RotationSearchBase
  baseStale?: boolean
  attackStates?: RefObject<readonly RunAttackState[] | undefined>
  rankingBonusStats?: RefObject<
    Partial<Record<CharacterKey, BonusStats>> | undefined
  >
  onClose: () => void
  onApplied: (text: string, label: string) => void
}) {
  const { t, i18n } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [maxWorkers] = useNumWorkers()
  const isKqm = tab === 'kqm'
  const saved = useRotationSettings(isKqm ? kqmRotationId(teamId) : teamId)

  const currentBurstEvery = useMemo(
    () => (isKqm ? kqmBurstEvery(teamOpt.kqm) : teamBurstEvery(teamOpt)),
    [isKqm, teamOpt]
  )

  const burstMembers = useMemo(
    () => detectBurstMembers(baseText, names, currentBurstEvery),
    [baseText, names, currentBurstEvery]
  )

  const [configs, setConfigs] = useState<BurstMemberConfig[]>(() =>
    burstMembers.map((m) => ({
      characterKey: m.characterKey,
      cadences: m.defaultCadences,
      instead: m.defaultInstead,
    }))
  )

  const [customs, setCustoms] = useState<CustomScenarioInput[]>([])
  const [addingCustom, setAddingCustom] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [customText, setCustomText] = useState(baseText)
  const [disabledIds, setDisabledIds] = useState<Set<string>>(() => new Set())
  const [expandedId, setExpandedId] = useState<string>()

  // Validation for each member's "Instead of Q" action
  const insteadErrors = useMemo(() => {
    const errors: Partial<Record<CharacterKey, string>> = {}
    for (const cfg of configs) {
      const info = burstMembers.find((m) => m.characterKey === cfg.characterKey)
      if (!info) continue
      const needsAlt = cfg.cadences.some((c) => c !== 1)
      if (!needsAlt || !cfg.instead.trim()) continue
      const v = validateInsteadAction(cfg.characterKey, info.name, cfg.instead)
      if (!v.valid && v.error) errors[cfg.characterKey] = v.error
    }
    return errors
  }, [configs, burstMembers])
  const hasInvalidInstead = Object.keys(insteadErrors).length > 0

  const baselineBurstEvery = useMemo(
    () =>
      Object.fromEntries(
        burstMembers.map((m) => [m.characterKey, m.baselineCadence])
      ) as Partial<Record<CharacterKey, number>>,
    [burstMembers]
  )

  const { scenarios, totalCount, truncated } = useMemo(
    () =>
      buildRotationScenarios({
        baseText,
        names,
        configs,
        baselineBurstEvery,
        customScenarios: customs,
      }),
    [baseText, names, configs, baselineBurstEvery, customs]
  )

  const enabledScenarios = useMemo(
    () => scenarios.filter((s) => !disabledIds.has(s.id)),
    [scenarios, disabledIds]
  )

  // Which members actually vary across the generated scenarios (keeps badges ultra-scannable)
  const varyingMembers = useMemo(() => {
    const set = new Set<CharacterKey>()
    for (const cfg of configs)
      if (cfg.cadences.length > 1) set.add(cfg.characterKey)
    return set
  }, [configs])

  const ctx = useMemo<ScenarioRunContext>(
    () => ({
      tab,
      database,
      gender,
      i18n,
      teamId,
      names,
      teamOpt,
      base,
      baseStale,
      baselineBurstEvery,
      saved: {
        opener: saved.opener,
        timing: saved.timing,
        frameData: saved.frameData,
      },
      attackStates: attackStates?.current ?? undefined,
      rankingBonusStats: rankingBonusStats?.current ?? undefined,
      maxWorkers,
    }),
    [
      tab,
      database,
      gender,
      i18n,
      teamId,
      names,
      teamOpt,
      base,
      baseStale,
      baselineBurstEvery,
      saved.opener,
      saved.timing,
      saved.frameData,
      attackStates,
      rankingBonusStats,
      maxWorkers,
    ]
  )

  // Instant pre-run ER & rotation time previews (deferred after paint so dialog opens smoothly)
  const [previews, setPreviews] = useState<Record<string, ScenarioPreview>>({})
  const scenarioSig = useMemo(
    () =>
      scenarios
        .map((s) => `${s.id}|${s.text}|${JSON.stringify(s.burstEvery)}`)
        .join(';;'),
    [scenarios]
  )
  useEffect(() => {
    if (hasInvalidInstead || !scenarios.length) return
    let cancelled = false
    const timer = setTimeout(() => {
      const next: Record<string, ScenarioPreview> = {}
      for (const sc of scenarios) {
        if (cancelled) return
        next[sc.id] = previewRotationScenario(ctx, sc)
      }
      if (!cancelled) setPreviews(next)
    }, 30)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [ctx, scenarios, scenarioSig, hasInvalidInstead])

  // Optimization run state
  const [compareMode, setCompareMode] = useState<ScenarioCompareMode>('fast')
  const [running, setRunning] = useState(false)
  const [runStartedAt, setRunStartedAt] = useState<number>()
  const [results, setResults] = useState<Record<string, ScenarioRunResult>>({})
  const [progress, setProgress] = useState<{
    done: number
    total: number
    activeId: string
    currentLabel: string
    step?: ScenarioLiveStep
  }>()
  const cancelledRef = useRef(false)
  useEffect(
    () => () => {
      cancelledRef.current = true
    },
    []
  )

  const startCompare = async () => {
    if (!enabledScenarios.length || hasInvalidInstead) return
    cancelledRef.current = false
    setRunStartedAt(Date.now())
    setRunning(true)

    // Pre-seed warm-start builds directly from the active tab's existing optimization run
    let teamSeed: ScenarioRunResult['teamSeed'] =
      base.tab === 'team'
        ? { builds: base.result.builds, weapons: base.result.weapons }
        : undefined
    let kqmSeed: ScenarioRunResult['kqmSeed'] =
      base.tab === 'kqm' ? base.result.builds : undefined

    // Reuse the baseline scenario instantaneously (0 ms) whenever the base run is fresh
    const initial: Record<string, ScenarioRunResult> = {}
    const toRun: RotationScenario[] = []
    for (const sc of enabledScenarios) {
      const reused = baselineScenarioResult(ctx, sc)
      if (reused) {
        initial[sc.id] = reused
        if (reused.teamSeed) teamSeed = reused.teamSeed
        if (reused.kqmSeed) kqmSeed = reused.kqmSeed
      } else {
        toRun.push(sc)
      }
    }
    setResults(initial)

    const reusedCount = Object.keys(initial).length
    const total = enabledScenarios.length
    for (let i = 0; i < toRun.length; i++) {
      if (cancelledRef.current) break
      const sc = toRun[i]
      const currentLabel = scenarioTitle(t, sc, names, varyingMembers)
      setProgress({
        done: reusedCount + i,
        total,
        activeId: sc.id,
        currentLabel,
        step: {
          fraction: 0.02,
          detail: t('teamOpt.compare.starting', 'Preparing scenario…'),
        },
      })
      // Yield a paint frame so the progress bar updates cleanly before each solve
      await new Promise((r) => setTimeout(r, 0))
      if (cancelledRef.current) break
      const res = await runRotationScenario(
        ctx,
        sc,
        () => cancelledRef.current,
        {
          mode: compareMode,
          fromTeam: teamSeed,
          fromKqm: kqmSeed,
          keepKqmWorkers: true,
          onStep: (step) => {
            if (cancelledRef.current) return
            setProgress((prev) => {
              if (!prev || prev.activeId !== sc.id) return prev
              const prevFrac = prev.step?.fraction ?? 0
              const fraction = Math.min(0.99, Math.max(prevFrac, step.fraction))
              return {
                ...prev,
                step: fraction === step.fraction ? step : { ...step, fraction },
              }
            })
          },
        }
      )
      if (cancelledRef.current) break
      if (!teamSeed && res.teamSeed) teamSeed = res.teamSeed
      if (!kqmSeed && res.kqmSeed) kqmSeed = res.kqmSeed
      setResults((prev) => ({ ...prev, [sc.id]: res }))
    }
    setProgress(undefined)
    setRunStartedAt(undefined)
    setRunning(false)
  }

  const toggleCadence = (ck: CharacterKey, cadence: BurstCadence) => {
    setConfigs((prev) =>
      prev.map((cfg) => {
        if (cfg.characterKey !== ck) return cfg
        const has = cfg.cadences.includes(cadence)
        if (has && cfg.cadences.length <= 1) return cfg
        const next = has
          ? cfg.cadences.filter((c) => c !== cadence)
          : BURST_CADENCES.filter(
              (c) => c === cadence || cfg.cadences.includes(c)
            )
        return { ...cfg, cadences: next }
      })
    )
    setResults({})
  }

  const setInstead = (ck: CharacterKey, value: string) => {
    setConfigs((prev) =>
      prev.map((cfg) =>
        cfg.characterKey === ck ? { ...cfg, instead: value } : cfg
      )
    )
    setResults({})
  }

  const addCustom = () => {
    const trimmed = customText.trim()
    if (!trimmed) return
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    setCustoms((prev) => [
      ...prev,
      {
        id,
        label:
          customLabel.trim() ||
          t('teamOpt.compare.customNumber', {
            defaultValue: 'Variant {{n}}',
            n: prev.length + 1,
          }),
        text: trimmed,
      },
    ])
    setCustomLabel('')
    setCustomText(baseText)
    setAddingCustom(false)
    setResults({})
  }

  const removeCustom = (customId: string) => {
    setCustoms((prev) => prev.filter((c) => `custom:${c.id}` !== customId))
    setResults({})
  }

  const hasResults = Object.keys(results).length > 0
  const baselineScenario = scenarios.find((s) => s.isBaseline) ?? scenarios[0]
  const baselinePreview = baselineScenario
    ? previews[baselineScenario.id]
    : undefined
  const baselineResult = baselineScenario
    ? results[baselineScenario.id]
    : undefined

  // Once any results arrive, rank completed ones best-first and keep pending ones below
  const orderedScenarios = useMemo(() => {
    if (!hasResults) return scenarios
    const done = scenarios
      .map((s) => results[s.id])
      .filter((r): r is ScenarioRunResult => !!r)
    const ranked = rankScenarioResults(done).map((r) => r.scenario)
    const pending = scenarios.filter((s) => !results[s.id])
    return [...ranked, ...pending]
  }, [scenarios, results, hasResults])

  const rankById = useMemo(() => {
    const done = Object.values(results)
    const ranked = rankScenarioResults(done)
    return new Map(ranked.map((r, i) => [r.scenario.id, i + 1]))
  }, [results])

  const handleApply = (sc: RotationScenario) => {
    const ok = applyRotationScenario({
      ctx,
      scenario: sc,
      setTeamOpt,
    })
    if (ok) {
      onApplied(sc.text, scenarioTitle(t, sc, names, varyingMembers))
    }
  }

  const canRun = enabledScenarios.length >= 2 && !hasInvalidInstead && !running
  const overallPct =
    progress && progress.total > 0
      ? Math.min(
          100,
          Math.round(
            ((progress.done + (progress.step?.fraction ?? 0)) /
              progress.total) *
              100
          )
        )
      : 0

  return (
    <ModalWrapper
      open
      onClose={running ? undefined : onClose}
      containerProps={{ maxWidth: 'md' }}
    >
      <CardThemed
        sx={{
          bgcolor: giTokens.panel,
          border: `1px solid ${tokens.hairlineStrong}`,
          borderRadius: tokens.radius.panel,
          overflow: 'hidden',
        }}
      >
        <DialogHead
          title={t('teamOpt.compare.title', 'Burst scenarios')}
          info={t(
            'teamOpt.compare.dialogInfo',
            'Select multiple Burst frequencies for any character (and an optional fallback like N4 when Q is skipped). Starts from your current optimized builds, reuses the baseline run when up to date, and recalculates ER & builds for every variant.'
          )}
          onClose={() => {
            if (!running) onClose()
          }}
        />

        <Box sx={{ p: { xs: 2, sm: 2.5 }, display: 'grid', gap: 2.25 }}>
          {/* Zone 1: Burst frequency matrix */}
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 1,
                flexWrap: 'wrap',
              }}
            >
              <Typography sx={type.label}>
                {t('teamOpt.compare.burstSection', 'Burst frequency')}
              </Typography>
              <Button
                size="small"
                color="inherit"
                disabled={running}
                startIcon={
                  <AddRoundedIcon sx={{ fontSize: '16px !important' }} />
                }
                onClick={() => setAddingCustom((v) => !v)}
                sx={{
                  fontSize: 12.5,
                  color: 'text.secondary',
                  py: 0.25,
                  px: 1,
                  borderRadius: tokens.radius.control,
                }}
              >
                {t('teamOpt.compare.addCustom', 'Custom rotation')}
              </Button>
            </Box>

            {burstMembers.length > 0 ? (
              <Box sx={{ ...insetSx, overflow: 'hidden' }}>
                {burstMembers.map((m, idx) => {
                  const cfg = configs.find(
                    (c) => c.characterKey === m.characterKey
                  )
                  if (!cfg) return null
                  const showInstead = cfg.cadences.some((c) => c !== 1)
                  const err = insteadErrors[m.characterKey]
                  return (
                    <Box
                      key={m.characterKey}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: '1fr',
                          sm: '132px minmax(0, 1fr) auto',
                        },
                        alignItems: 'center',
                        columnGap: 1.5,
                        rowGap: 1,
                        px: 1.75,
                        py: 1.125,
                        ...(idx > 0 && { borderTop: hairline }),
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.875,
                          minWidth: 0,
                        }}
                      >
                        <MemberAvatar characterKey={m.characterKey} size={24} />
                        <Typography
                          noWrap
                          sx={(theme) => ({
                            fontSize: 13.5,
                            fontWeight: 600,
                            color: laneColor(theme, m.characterKey),
                          })}
                        >
                          {m.name}
                        </Typography>
                      </Box>

                      <Box
                        sx={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 0.625,
                        }}
                      >
                        {BURST_CADENCES.map((cadence) => {
                          const on = cfg.cadences.includes(cadence)
                          return (
                            <CadencePill
                              key={cadence}
                              label={cadenceLabel(t, cadence)}
                              on={on}
                              disabled={running}
                              onClick={() =>
                                toggleCadence(m.characterKey, cadence)
                              }
                            />
                          )
                        })}
                      </Box>

                      {showInstead ? (
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.875,
                            justifySelf: { xs: 'start', sm: 'end' },
                          }}
                        >
                          <Typography
                            sx={{ ...type.label, whiteSpace: 'nowrap' }}
                          >
                            {t('teamOpt.compare.insteadOfQ', 'Instead of Q')}
                          </Typography>
                          <Tooltip
                            arrow
                            title={
                              err ||
                              t(
                                'teamOpt.compare.insteadTip',
                                'Action to play on rotations where Q is skipped (e.g. N4, N2 CA). Leave empty to simply skip Q.'
                              )
                            }
                            placement="top"
                          >
                            <InputBase
                              value={cfg.instead}
                              disabled={running}
                              onChange={(e) =>
                                setInstead(m.characterKey, e.target.value)
                              }
                              placeholder={t(
                                'teamOpt.compare.insteadPlaceholder',
                                'Skip'
                              )}
                              inputProps={{
                                'aria-label': `${m.name} ${t('teamOpt.compare.insteadOfQ', 'Instead of Q')}`,
                              }}
                              sx={{
                                width: 96,
                                height: 30,
                                px: 1,
                                borderRadius: tokens.radius.control,
                                fontFamily: mono,
                                fontSize: 12.5,
                                bgcolor: giTokens.panel,
                                border: `1px solid ${
                                  err
                                    ? 'warning.main'
                                    : cfg.instead.trim()
                                      ? alpha(giTokens.gold, 0.48)
                                      : tokens.hairlineStrong
                                }`,
                                '&.Mui-focused': {
                                  borderColor: err
                                    ? 'warning.main'
                                    : tokens.gold,
                                },
                              }}
                            />
                          </Tooltip>
                        </Box>
                      ) : (
                        <Box sx={{ display: { xs: 'none', sm: 'block' } }} />
                      )}
                    </Box>
                  )
                })}
              </Box>
            ) : (
              <Box sx={{ ...insetSx, px: 1.75, py: 1.25 }}>
                <Typography sx={type.label}>
                  {t(
                    'teamOpt.compare.noBursts',
                    'No Burst (Q) found in this rotation — add a custom rotation variant to compare.'
                  )}
                </Typography>
              </Box>
            )}

            {/* Optional custom rotation form */}
            <Collapse in={addingCustom} timeout={180}>
              <Box
                sx={{
                  ...insetSx,
                  p: 1.5,
                  display: 'grid',
                  gap: 1,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 1,
                    alignItems: 'center',
                  }}
                >
                  <InputBase
                    value={customLabel}
                    onChange={(e) => setCustomLabel(e.target.value)}
                    placeholder={t(
                      'teamOpt.compare.customNamePlaceholder',
                      'Label (e.g. Extra N4)'
                    )}
                    sx={{
                      width: { xs: '100%', sm: 184 },
                      height: 34,
                      px: 1.25,
                      borderRadius: tokens.radius.control,
                      fontSize: 13,
                      bgcolor: giTokens.panel,
                      border: `1px solid ${tokens.hairlineStrong}`,
                    }}
                  />
                  <InputBase
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder={baseText}
                    sx={{
                      flex: '1 1 280px',
                      height: 34,
                      px: 1.25,
                      borderRadius: tokens.radius.control,
                      fontFamily: mono,
                      fontSize: 12.5,
                      bgcolor: giTokens.panel,
                      border: `1px solid ${tokens.hairlineStrong}`,
                    }}
                  />
                  <Button
                    size="small"
                    variant="contained"
                    onClick={addCustom}
                    disabled={!customText.trim()}
                    sx={{ height: 34, px: 2 }}
                  >
                    {t('teamOpt.compare.add', 'Add')}
                  </Button>
                </Box>
              </Box>
            </Collapse>
          </Box>

          {/* Action bar */}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1.25,
            }}
          >
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 0.875,
              }}
            >
              <Typography sx={{ ...type.label, ...numSx, fontWeight: 600 }}>
                {t('teamOpt.compare.count', {
                  defaultValue: '{{count}} scenarios',
                  count: enabledScenarios.length,
                })}
              </Typography>
              {enabledScenarios.length < 2 && !truncated && (
                <Typography
                  sx={{
                    fontSize: 12.5,
                    color: 'text.secondary',
                    opacity: 0.85,
                  }}
                >
                  ·{' '}
                  {t(
                    'teamOpt.compare.pickMore',
                    'Select a 2nd option on any character to compare'
                  )}
                </Typography>
              )}
              {truncated && (
                <Typography sx={{ fontSize: 12.5, color: 'warning.main' }}>
                  ·{' '}
                  {t('teamOpt.compare.capped', {
                    defaultValue: 'Showing first {{max}} of {{total}}',
                    max: MAX_COMPARISON_SCENARIOS,
                    total: totalCount,
                  })}
                </Typography>
              )}
            </Box>

            <Box sx={{ flexGrow: 1 }} />

            <Segmented
              size="small"
              aria-label={t('teamOpt.compare.modeLabel', 'Comparison speed')}
              value={compareMode}
              onChange={(next) => {
                if (!running) setCompareMode(next)
              }}
              options={[
                {
                  value: 'fast',
                  label: t('teamOpt.compare.modeFast', 'Fast'),
                  disabled: running,
                  tip: t(
                    'teamOpt.compare.modeFastTip',
                    'Reuses your current builds & rankings: refits ER shifts, Favonius/team-gear swaps, and top weapons & sets across 2 rounds (much faster).'
                  ),
                },
                {
                  value: 'full',
                  label: t('teamOpt.compare.modeFull', 'Full'),
                  disabled: running,
                  tip: t(
                    'teamOpt.compare.modeFullTip',
                    'Re-optimizes every member, weapon, and artifact set from scratch for each scenario.'
                  ),
                },
              ]}
            />

            {running ? (
              <Button
                color="inherit"
                variant="outlined"
                onClick={() => {
                  cancelledRef.current = true
                }}
                sx={{ minWidth: 128, borderColor: tokens.hairlineStrong }}
              >
                {t('teamOpt.compare.stop', 'Stop')}
              </Button>
            ) : (
              <Button
                variant="contained"
                disabled={!canRun}
                onClick={startCompare}
                startIcon={<CompareArrowsRoundedIcon />}
                sx={[{ minWidth: 176 }, giCtaSx]}
              >
                {hasResults
                  ? t('teamOpt.compare.rerun', 'Compare again')
                  : t('teamOpt.compare.run', {
                      defaultValue: 'Compare {{count}} scenarios',
                      count: enabledScenarios.length,
                    })}
              </Button>
            )}
          </Box>

          {/* Progress strip */}
          {running && progress && (
            <Box
              sx={{
                ...insetSx,
                px: 1.75,
                py: 1.25,
                display: 'grid',
                gap: 0.875,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 1.5,
                  minWidth: 0,
                }}
              >
                <Typography
                  noWrap
                  sx={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'text.primary',
                    ...numSx,
                    minWidth: 0,
                  }}
                >
                  {t('teamOpt.compare.progress', {
                    defaultValue:
                      'Optimizing {{current}} of {{total}} · {{label}}',
                    current: progress.done + 1,
                    total: progress.total,
                    label: progress.currentLabel,
                  })}
                </Typography>
                <Box
                  sx={{
                    ...type.label,
                    ...numSx,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 1.25,
                    flexShrink: 0,
                  }}
                >
                  <Box
                    component="span"
                    sx={{ color: tokens.gold, fontWeight: 650 }}
                  >
                    {overallPct}%
                  </Box>
                  {runStartedAt !== undefined && (
                    <ElapsedClock startedAt={runStartedAt} />
                  )}
                </Box>
              </Box>
              <LinearProgress
                variant="determinate"
                value={overallPct}
                sx={{
                  height: 5,
                  borderRadius: 999,
                  bgcolor: alpha(giTokens.parchment, 0.08),
                  '& .MuiLinearProgress-bar': {
                    bgcolor: tokens.gold,
                    transition: 'transform 180ms linear',
                  },
                }}
              />
              {progress.step?.detail && (
                <Typography noWrap sx={{ ...type.label, ...numSx }}>
                  {progress.step.detail}
                </Typography>
              )}
            </Box>
          )}

          {hasInvalidInstead && (
            <Alert severity="warning" sx={{ py: 0.5 }}>
              {Object.values(insteadErrors)[0]}
            </Alert>
          )}

          {/* Zone 2: Scenarios & Ranked Comparison Cards */}
          <Box sx={{ display: 'grid', gap: 1.25 }}>
            {orderedScenarios.map((sc) => {
              const res = results[sc.id]
              const prev = previews[sc.id]
              const rank = rankById.get(sc.id)
              const enabled = !disabledIds.has(sc.id)
              return (
                <ScenarioRow
                  key={sc.id}
                  scenario={sc}
                  names={names}
                  varying={varyingMembers}
                  enabled={enabled}
                  disabledToggle={running}
                  onToggle={() =>
                    setDisabledIds((prevSet) => {
                      const next = new Set(prevSet)
                      if (next.has(sc.id)) next.delete(sc.id)
                      else next.add(sc.id)
                      return next
                    })
                  }
                  onRemoveCustom={
                    sc.kind === 'custom' && !running
                      ? () => removeCustom(sc.id)
                      : undefined
                  }
                  preview={prev}
                  baselinePreview={baselinePreview}
                  result={res}
                  baselineResult={baselineResult}
                  rank={rank}
                  activeStep={
                    running && progress?.activeId === sc.id
                      ? progress.step
                      : undefined
                  }
                  queued={
                    running && enabled && !res && progress?.activeId !== sc.id
                  }
                  expanded={expandedId === sc.id}
                  onToggleExpand={() =>
                    setExpandedId((id) => (id === sc.id ? undefined : sc.id))
                  }
                  onApply={() => handleApply(sc)}
                  running={running}
                />
              )
            })}
          </Box>
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

/** Live ticking elapsed clock while scenarios optimize (isolated so only this re-renders per second). */
function ElapsedClock({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  return (
    <Box
      component="span"
      sx={{ ...numSx, whiteSpace: 'nowrap', flexShrink: 0 }}
    >
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}
    </Box>
  )
}

/** Multi-select pill matching ui.tsx Pill rhythm. */
function CadencePill({
  label,
  on,
  disabled,
  onClick,
}: {
  label: string
  on: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <ButtonBase
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      sx={{
        ...quickSx,
        ...focusSx,
        height: 30,
        px: 1.25,
        gap: 0.5,
        borderRadius: 999,
        border: `1px solid ${on ? alpha(giTokens.gold, 0.48) : tokens.hairlineStrong}`,
        bgcolor: on ? alpha(giTokens.gold, 0.1) : 'transparent',
        fontSize: 12.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color: on ? 'text.primary' : 'text.secondary',
        '&:hover': {
          color: 'text.primary',
          bgcolor: on
            ? alpha(giTokens.gold, 0.16)
            : alpha(giTokens.parchment, 0.05),
        },
        '&.Mui-disabled': { opacity: 0.55 },
      }}
    >
      {on && <CheckRoundedIcon sx={{ fontSize: 14, color: tokens.gold }} />}
      {label}
    </ButtonBase>
  )
}

/** Clean, scannable rotation strip inside expanded scenario details. */
function CompactRotationSteps({
  steps,
}: {
  steps: readonly RotationWordStep[]
}) {
  const stepKeys = useMemo(() => {
    const seen: Record<string, number> = {}
    return steps.map((step) => {
      const n = (seen[step.characterKey] ?? 0) + 1
      seen[step.characterKey] = n
      const wordSeen: Record<string, number> = {}
      const words = step.words.map((w) => {
        const wn = (wordSeen[w] ?? 0) + 1
        wordSeen[w] = wn
        return { w, key: `${w}#${wn}` }
      })
      return { step, key: `${step.characterKey}#${n}`, words }
    })
  }, [steps])

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 0.875,
        rowGap: 0.625,
      }}
    >
      {stepKeys.map(({ step, key, words }, i) => (
        <Fragment key={key}>
          {i > 0 && <Arrow />}
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <MemberAvatar characterKey={step.characterKey} size={18} />
            <Box
              component="span"
              sx={(theme) => ({
                color: laneColor(theme, step.characterKey),
                fontWeight: 600,
                fontSize: 13,
                mr: 0.125,
              })}
            >
              {step.name}
            </Box>
            {words.map(({ w, key: wKey }) => {
              const isFallback = w.includes('/')
              return (
                <Box
                  key={wKey}
                  component="span"
                  sx={{
                    fontFamily: mono,
                    fontSize: 12.5,
                    fontWeight: isFallback ? 600 : 500,
                    color: isFallback ? tokens.gold : 'text.primary',
                    ...(isFallback && {
                      px: 0.5,
                      py: 0.05,
                      borderRadius: 0.75,
                      bgcolor: alpha(giTokens.gold, 0.1),
                    }),
                  }}
                >
                  {w}
                </Box>
              )
            })}
          </Box>
        </Fragment>
      ))}
    </Box>
  )
}

/** One scenario card: instant ER preview before running, ranked DPS & structured breakdown after running. */
function ScenarioRow({
  scenario,
  names,
  varying,
  enabled,
  disabledToggle,
  onToggle,
  onRemoveCustom,
  preview,
  baselinePreview,
  result,
  baselineResult,
  rank,
  activeStep,
  queued,
  expanded,
  onToggleExpand,
  onApply,
  running,
}: {
  scenario: RotationScenario
  names: RotationMember[]
  varying: ReadonlySet<CharacterKey>
  enabled: boolean
  disabledToggle: boolean
  onToggle: () => void
  onRemoveCustom?: () => void
  preview?: ScenarioPreview
  baselinePreview?: ScenarioPreview
  result?: ScenarioRunResult
  baselineResult?: ScenarioRunResult
  rank?: number
  activeStep?: ScenarioLiveStep
  queued?: boolean
  expanded: boolean
  onToggleExpand: () => void
  onApply: () => void
  running: boolean
}) {
  const { t } = useTranslation('page_team')
  const isActive = !!activeStep
  const isWinner =
    rank === 1 && !!result && !result.error && result.unmetCount === 0
  const steps = useMemo(
    () => (expanded ? rotationWords(scenario.text, names) : []),
    [expanded, scenario.text, names]
  )

  const rotTime = result?.rotationTime || preview?.rotationTime
  const erTargets = result ? result.erTargets : (preview?.erTargets ?? {})
  const erAchieved = result?.erAchieved ?? {}
  const baseEr = baselineResult?.erTargets ?? baselinePreview?.erTargets ?? {}

  const gain =
    result && baselineResult && baselineResult.dps > 0 && !result.error
      ? result.dps / baselineResult.dps - 1
      : undefined

  // Sort member breakdown by DPS descending so damage share bars cascade cleanly
  const orderedBreakdown = useMemo(() => {
    if (!result || result.error) return names
    return [...names].sort(
      (a, b) =>
        (result.memberDps[b.characterKey] ?? 0) -
        (result.memberDps[a.characterKey] ?? 0)
    )
  }, [names, result])

  // Chips showing each varying member's cadence & fallback
  const choiceEntries = Object.entries(scenario.choices) as [
    CharacterKey,
    { cadence: BurstCadence; instead?: string },
  ][]
  const shownChoices =
    varying.size > 0
      ? choiceEntries.filter(([ck]) => varying.has(ck))
      : choiceEntries

  const stalls = result?.stalls ?? preview?.stalls ?? []

  return (
    <Box
      sx={{
        ...quickSx,
        borderRadius: tokens.radius.inset,
        bgcolor: isActive ? alpha(giTokens.gold, 0.04) : tokens.inset,
        opacity: enabled || result ? 1 : 0.5,
        border: `1px solid ${
          isWinner || isActive
            ? alpha(giTokens.gold, isWinner ? 0.42 : 0.35)
            : giTokens.hairline
        }`,
        overflow: 'hidden',
      }}
    >
      {/* Top summary band (clicking the row surface toggles expanded breakdown) */}
      <Box
        onClick={onToggleExpand}
        sx={{
          ...rowHoverSx,
          cursor: 'pointer',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 1.75,
          rowGap: 1,
          px: { xs: 1.5, sm: 2 },
          py: 1.5,
        }}
      >
        {/* Left: Rank badge (after run), active spinner (while running), or include checkbox */}
        {rank !== undefined ? (
          <Box
            sx={{
              ...numSx,
              width: 28,
              height: 28,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
              color: isWinner ? tokens.gold : 'text.secondary',
              bgcolor: isWinner
                ? alpha(giTokens.gold, 0.14)
                : alpha(giTokens.parchment, 0.05),
              border: `1px solid ${
                isWinner ? alpha(giTokens.gold, 0.42) : tokens.hairline
              }`,
            }}
          >
            {rank}
          </Box>
        ) : isActive ? (
          <Box
            sx={{
              width: 28,
              height: 28,
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <CircularProgress
              size={18}
              thickness={5}
              sx={{ color: tokens.gold }}
            />
          </Box>
        ) : (
          <Checkbox
            size="small"
            checked={enabled}
            disabled={disabledToggle}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggle}
            sx={{ p: 0.25 }}
          />
        )}

        {/* Middle: Scenario chips + rotation length + ER targets */}
        <Box
          sx={{ flex: '1 1 320px', minWidth: 0, display: 'grid', gap: 0.875 }}
        >
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 0.75,
            }}
          >
            {scenario.kind === 'custom' ? (
              <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
                {scenario.label ||
                  t('teamOpt.compare.customLabel', 'Custom rotation')}
              </Typography>
            ) : (
              shownChoices.map(([ck, ch]) => {
                const name =
                  names.find((n) => n.characterKey === ck)?.name ?? ck
                return (
                  <Box
                    key={ck}
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.625,
                      px: 1,
                      py: 0.35,
                      borderRadius: 1.5,
                      bgcolor: alpha(giTokens.parchment, 0.045),
                      border: `1px solid ${tokens.hairline}`,
                      fontSize: 13,
                      lineHeight: 1.25,
                    }}
                  >
                    <MemberAvatar characterKey={ck} size={17} />
                    <Box
                      component="span"
                      sx={(theme) => ({
                        fontWeight: 600,
                        color: laneColor(theme, ck),
                      })}
                    >
                      {name}
                    </Box>
                    <Box component="span" sx={{ color: 'text.primary' }}>
                      {cadenceLabel(t, ch.cadence)}
                    </Box>
                    {ch.cadence !== 1 && ch.instead && (
                      <Box
                        component="span"
                        sx={{
                          fontFamily: mono,
                          fontSize: 12,
                          fontWeight: 600,
                          color: tokens.gold,
                        }}
                      >
                        → {ch.instead}
                      </Box>
                    )}
                  </Box>
                )
              })
            )}

            {scenario.isBaseline && (
              <Box
                component="span"
                sx={{
                  px: 0.875,
                  py: 0.25,
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: 'text.secondary',
                  border: `1px solid ${tokens.hairlineStrong}`,
                }}
              >
                {t('teamOpt.compare.baseline', 'Current')}
              </Box>
            )}
            {result && result.unmetCount > 0 && (
              <Tooltip
                arrow
                title={t(
                  'teamOpt.compare.unmetTip',
                  'No build met all ER or stat requirements for this scenario.'
                )}
              >
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.375,
                    px: 0.875,
                    py: 0.2,
                    borderRadius: 999,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: 'warning.main',
                    bgcolor: alpha('#f59e0b', 0.12),
                  }}
                >
                  <WarningAmberRoundedIcon sx={{ fontSize: 13 }} />
                  {t('teamOpt.compare.erUnmet', 'Requirements unmet')}
                </Box>
              </Tooltip>
            )}
          </Box>

          {/* Meta telemetry line: rotation length | ER needed per member */}
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
            {rotTime !== undefined && rotTime > 0 && (
              <Box
                component="span"
                sx={{ color: 'text.primary', fontWeight: 500, opacity: 0.88 }}
              >
                {rotTime.toFixed(1)} s
              </Box>
            )}
            {rotTime !== undefined &&
              rotTime > 0 &&
              Object.keys(erTargets).length > 0 && (
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    width: '1px',
                    height: 12,
                    bgcolor: tokens.hairlineStrong,
                  }}
                />
              )}
            {Object.keys(erTargets).length > 0 && (
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  columnGap: 1.25,
                  rowGap: 0.35,
                }}
              >
                <Box component="span" sx={{ opacity: 0.8 }}>
                  {t('teamOpt.compare.erLabel', 'ER')}
                </Box>
                {names.map(({ characterKey, name }) => {
                  const need = erTargets[characterKey]
                  if (need === undefined) return null
                  const base = baseEr[characterKey]
                  const diff =
                    !scenario.isBaseline && base !== undefined
                      ? Math.round(need - base)
                      : 0
                  const got = erAchieved[characterKey]
                  const short = got !== undefined && got + 1 < need
                  return (
                    <Tooltip
                      key={characterKey}
                      arrow
                      title={
                        got !== undefined
                          ? `${name}: ${Math.round(need)}% needed · ${got}% achieved`
                          : `${name}: ${Math.round(need)}% ER needed`
                      }
                    >
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.45,
                          whiteSpace: 'nowrap',
                          color: short ? 'warning.main' : 'text.primary',
                          fontWeight: short ? 600 : 500,
                          opacity: short ? 1 : 0.85,
                        }}
                      >
                        <MemberAvatar characterKey={characterKey} size={16} />
                        {Math.round(need)}%
                        {diff !== 0 && (
                          <Box
                            component="span"
                            sx={{
                              fontSize: 11.5,
                              fontWeight: 600,
                              color: diff < 0 ? 'success.main' : 'warning.main',
                            }}
                          >
                            {diff > 0 ? '+' : '−'}
                            {Math.abs(diff)}%
                          </Box>
                        )}
                      </Box>
                    </Tooltip>
                  )
                })}
              </Box>
            )}
            {(result?.error || preview?.error) && (
              <Typography sx={{ fontSize: 12, color: 'error.main' }}>
                {result?.error || preview?.error}
              </Typography>
            )}
          </Box>
        </Box>

        {/* Right: DPS + Delta + Apply (or live active status / Queued) + Expand */}
        <Box
          sx={{
            ml: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
          }}
        >
          {isActive && activeStep && (
            <Box sx={{ textAlign: 'right', mr: 0.25 }}>
              <Typography
                sx={{
                  ...numSx,
                  fontSize: 13.5,
                  fontWeight: 650,
                  color: tokens.gold,
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.round(activeStep.fraction * 100)}%
              </Typography>
              <Typography
                sx={{
                  ...type.label,
                  fontSize: 11.5,
                  whiteSpace: 'nowrap',
                  maxWidth: 240,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {activeStep.detail}
              </Typography>
            </Box>
          )}
          {queued && (
            <Typography
              sx={{
                ...type.label,
                fontSize: 12,
                mr: 0.5,
                whiteSpace: 'nowrap',
              }}
            >
              {t('teamOpt.compare.queued', 'Queued')}
            </Typography>
          )}
          {result && !result.error && (
            <Box
              sx={{
                textAlign: 'right',
                display: 'grid',
                justifyItems: 'end',
                gap: 0.35,
              }}
            >
              <Typography
                sx={{
                  ...numSx,
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: '-0.015em',
                  lineHeight: 1.15,
                  color: isWinner ? tokens.gold : 'text.primary',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatRateFull(result.dps, undefined)}{' '}
                <Box
                  component="span"
                  sx={{
                    fontSize: 12.5,
                    fontWeight: 500,
                    color: 'text.secondary',
                  }}
                >
                  DPS
                </Box>
              </Typography>
              {scenario.isBaseline ? (
                <Typography sx={{ ...type.label, fontSize: 12 }}>
                  {t('teamOpt.compare.baselineDps', 'Baseline')}
                </Typography>
              ) : gain !== undefined ? (
                <Box
                  component="span"
                  sx={{
                    ...numSx,
                    px: 0.75,
                    py: 0.1,
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1.4,
                    color:
                      gain > 0.0005
                        ? 'success.main'
                        : gain < -0.0005
                          ? 'warning.main'
                          : 'text.secondary',
                    bgcolor:
                      gain > 0.0005
                        ? alpha('#22c55e', 0.12)
                        : gain < -0.0005
                          ? alpha('#f59e0b', 0.12)
                          : alpha(giTokens.parchment, 0.06),
                  }}
                >
                  {formatGain(gain)}
                </Box>
              ) : null}
            </Box>
          )}

          {result && !result.error && (
            <Button
              size="small"
              disabled={running}
              onClick={(e) => {
                e.stopPropagation()
                onApply()
              }}
              sx={{
                ...focusSx,
                height: 32,
                px: 1.5,
                minWidth: 68,
                borderRadius: tokens.radius.control,
                fontSize: 13,
                fontWeight: 600,
                color: isWinner ? tokens.gold : 'text.primary',
                bgcolor: isWinner
                  ? alpha(giTokens.gold, 0.12)
                  : alpha(giTokens.parchment, 0.05),
                border: `1px solid ${
                  isWinner ? alpha(giTokens.gold, 0.4) : tokens.hairlineStrong
                }`,
                '&:hover': {
                  bgcolor: isWinner
                    ? alpha(giTokens.gold, 0.2)
                    : alpha(giTokens.parchment, 0.1),
                },
              }}
            >
              {t('teamOpt.compare.apply', 'Apply')}
            </Button>
          )}

          {onRemoveCustom && !result && (
            <IconButton
              size="small"
              aria-label={t('teamOpt.compare.removeCustom', 'Remove')}
              onClick={(e) => {
                e.stopPropagation()
                onRemoveCustom()
              }}
              sx={{ color: 'text.secondary' }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          )}

          <IconButton
            size="small"
            aria-label={t('teamOpt.compare.details', 'Details')}
            aria-expanded={expanded}
            onClick={(e) => {
              e.stopPropagation()
              onToggleExpand()
            }}
            sx={{
              color: 'text.secondary',
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 180ms ease',
            }}
          >
            <ExpandMoreRoundedIcon fontSize="small" />
          </IconButton>
        </Box>
      </Box>

      {/* Expanded breakdown: separated rotation inset + structured 4-column member table + cooldown waits */}
      <Collapse in={expanded} timeout={180}>
        <Box
          sx={{
            px: { xs: 1.5, sm: 2 },
            pt: 1.5,
            pb: 1.75,
            borderTop: hairline,
            display: 'grid',
            gap: 1.5,
            bgcolor: alpha(giTokens.parchment, 0.015),
          }}
        >
          {/* Rotation sequence inset */}
          <Box
            sx={{
              bgcolor: giTokens.panelDark,
              border: hairline,
              borderRadius: tokens.radius.inset,
              px: 1.5,
              py: 1.125,
              display: 'grid',
              gap: 0.75,
            }}
          >
            <Typography sx={{ ...type.label, fontSize: 11.5 }}>
              {t('teamOpt.compare.rotationLabel', 'Rotation')}
            </Typography>
            <CompactRotationSteps steps={steps} />
          </Box>

          {/* Structured 4-column member breakdown table */}
          {result && !result.error && (
            <Box
              sx={{
                bgcolor: giTokens.panelDark,
                border: hairline,
                borderRadius: tokens.radius.inset,
                overflow: 'hidden',
              }}
            >
              {/* Column header row (desktop/tablet) */}
              <Box
                sx={{
                  display: { xs: 'none', sm: 'grid' },
                  gridTemplateColumns: '132px 152px minmax(0, 1fr) 128px',
                  columnGap: 2,
                  alignItems: 'center',
                  px: 1.5,
                  py: 0.875,
                  borderBottom: hairline,
                  bgcolor: alpha(giTokens.parchment, 0.025),
                  ...type.label,
                  fontSize: 11.5,
                }}
              >
                <Box>{t('teamOpt.compare.colMember', 'Member')}</Box>
                <Box sx={{ textAlign: 'right' }}>
                  {t('teamOpt.compare.colDamage', 'Damage')}
                </Box>
                <Box>{t('teamOpt.compare.colBuild', 'Build')}</Box>
                <Box sx={{ textAlign: 'right' }}>
                  {t('teamOpt.compare.colEr', 'ER')}
                </Box>
              </Box>

              {orderedBreakdown.map(({ characterKey, name }, rowIdx) => {
                const dps = result.memberDps[characterKey] ?? 0
                const share =
                  result.dps > 0 ? Math.round((dps / result.dps) * 100) : 0
                const weapon = result.weapons[characterKey]
                const setEntries = Object.entries(
                  result.sets[characterKey] ?? {}
                )
                  .filter(([, n]) => (n ?? 0) >= 2)
                  .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) as [
                  ArtifactSetKey,
                  number,
                ][]
                const targetEr = result.erTargets[characterKey]
                const gotEr = result.erAchieved[characterKey]
                const erMet =
                  targetEr !== undefined &&
                  gotEr !== undefined &&
                  gotEr + 1 >= targetEr
                const erShort =
                  targetEr !== undefined &&
                  gotEr !== undefined &&
                  gotEr + 1 < targetEr

                return (
                  <Box
                    key={characterKey}
                    sx={{
                      ...rowHoverSx,
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr',
                        sm: '132px 152px minmax(0, 1fr) 128px',
                      },
                      columnGap: 2,
                      rowGap: 0.75,
                      alignItems: 'center',
                      px: 1.5,
                      py: 1.125,
                      ...(rowIdx > 0 && { borderTop: hairline }),
                      ...numSx,
                    }}
                  >
                    {/* Col 1: Member avatar & name */}
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.875,
                        minWidth: 0,
                      }}
                    >
                      <MemberAvatar characterKey={characterKey} size={24} />
                      <Typography
                        noWrap
                        sx={(theme) => ({
                          fontSize: 13.5,
                          fontWeight: 600,
                          color: laneColor(theme, characterKey),
                        })}
                      >
                        {name}
                      </Typography>
                    </Box>

                    {/* Col 2: Clean tabular DPS + share % + subtle element share bar */}
                    <Box sx={{ display: 'grid', gap: 0.5 }}>
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: {
                            xs: 'space-between',
                            sm: 'flex-end',
                          },
                          gap: 0.875,
                        }}
                      >
                        <Box
                          component="span"
                          sx={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'text.primary',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatRateFull(dps, undefined)}
                        </Box>
                        <Box
                          component="span"
                          sx={{
                            fontSize: 12,
                            color: 'text.secondary',
                            minWidth: 32,
                            textAlign: 'right',
                          }}
                        >
                          {share}%
                        </Box>
                      </Box>
                      <Box
                        sx={{
                          height: 3,
                          borderRadius: 999,
                          bgcolor: alpha(giTokens.parchment, 0.08),
                          overflow: 'hidden',
                        }}
                      >
                        <Box
                          sx={(theme) => ({
                            height: '100%',
                            width: `${Math.max(share > 0 ? 3 : 0, Math.min(100, share))}%`,
                            borderRadius: 999,
                            bgcolor: laneColor(theme, characterKey),
                            opacity: 0.85,
                          })}
                        />
                      </Box>
                    </Box>

                    {/* Col 3: Build — Weapon on line 1, Artifact sets on line 2 (never collides with ER) */}
                    <Box sx={{ minWidth: 0, display: 'grid', gap: 0.25 }}>
                      {weapon && (
                        <Box
                          sx={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: 0.625,
                            minWidth: 0,
                          }}
                        >
                          <Box
                            component="span"
                            sx={{
                              fontSize: 13,
                              fontWeight: 500,
                              color: 'text.primary',
                            }}
                          >
                            <WeaponName weaponKey={weapon.key} />
                          </Box>
                          <Box
                            component="span"
                            sx={{
                              fontSize: 11,
                              fontWeight: 600,
                              lineHeight: 1.4,
                              px: 0.625,
                              py: 0.05,
                              borderRadius: 0.75,
                              color: 'text.secondary',
                              bgcolor: alpha(giTokens.parchment, 0.07),
                            }}
                          >
                            R{weapon.refinement}
                          </Box>
                        </Box>
                      )}
                      {setEntries.length > 0 && (
                        <Box
                          sx={{
                            fontSize: 12,
                            color: 'text.secondary',
                            lineHeight: 1.4,
                          }}
                        >
                          {setEntries.map(([sk, n], idx) => (
                            <Fragment key={sk}>
                              {idx > 0 && ' · '}
                              <Box
                                component="span"
                                sx={{
                                  fontWeight: 600,
                                  color: alpha(giTokens.parchment, 0.78),
                                }}
                              >
                                {n >= 4 ? '4×' : '2×'}
                              </Box>{' '}
                              <ArtifactSetName setKey={sk} />
                            </Fragment>
                          ))}
                        </Box>
                      )}
                    </Box>

                    {/* Col 4: Achieved / Target ER + status icon */}
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: {
                          xs: 'flex-start',
                          sm: 'flex-end',
                        },
                        gap: 0.5,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {targetEr !== undefined && (
                        <>
                          <Box
                            component="span"
                            sx={{
                              fontSize: 13,
                              fontWeight: 600,
                              color: erShort ? 'warning.main' : 'text.primary',
                            }}
                          >
                            {gotEr !== undefined
                              ? `${gotEr}%`
                              : `${Math.round(targetEr)}%`}
                          </Box>
                          {gotEr !== undefined && (
                            <Box
                              component="span"
                              sx={{ fontSize: 12, color: 'text.secondary' }}
                            >
                              / {Math.round(targetEr)}%
                            </Box>
                          )}
                          {erMet && (
                            <CheckCircleRoundedIcon
                              sx={{
                                fontSize: 15,
                                color: 'success.main',
                                flexShrink: 0,
                              }}
                            />
                          )}
                          {erShort && (
                            <WarningAmberRoundedIcon
                              sx={{
                                fontSize: 15,
                                color: 'warning.main',
                                flexShrink: 0,
                              }}
                            />
                          )}
                        </>
                      )}
                    </Box>
                  </Box>
                )
              })}
            </Box>
          )}

          {/* Refined cooldown waits callout */}
          {stalls.length > 0 && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 0.875,
                px: 1.5,
                py: 0.875,
                borderRadius: tokens.radius.inset,
                bgcolor: alpha('#f59e0b', 0.07),
                border: `1px solid ${alpha('#f59e0b', 0.2)}`,
                fontSize: 12.5,
                ...numSx,
              }}
            >
              <WarningAmberRoundedIcon
                sx={{ fontSize: 15, color: 'warning.main', flexShrink: 0 }}
              />
              <Box
                component="span"
                sx={{ fontWeight: 600, color: 'warning.main' }}
              >
                {t('teamOpt.compare.stalls', 'Cooldown waits')}
              </Box>
              <Box
                component="span"
                sx={{ color: 'text.secondary', display: 'flex', gap: 1 }}
              >
                {stalls.map((s) => (
                  <Box
                    key={`${s.label}-${s.seconds}`}
                    component="span"
                    sx={{ whiteSpace: 'nowrap' }}
                  >
                    {s.label}{' '}
                    <Box component="span" sx={{ color: 'warning.main' }}>
                      {s.seconds.toFixed(1)} s
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  )
}
