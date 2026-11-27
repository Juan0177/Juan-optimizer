import { characterAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type {
  ConsRotationSuggestion,
  FoundConsRotation,
  RotationMember,
} from '@genshin-optimizer/gi/ui'
import {
  constellationHintOf,
  KEEP_BASE_ROTATION,
  parseRotation,
} from '@genshin-optimizer/gi/ui'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded'
import CheckRoundedIcon from '@mui/icons-material/CheckRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import ReplayRoundedIcon from '@mui/icons-material/ReplayRounded'
import StopRoundedIcon from '@mui/icons-material/StopRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatGain } from './format'
import { RotationReadout } from './RotationInline'
import { editorSx } from './RotationWriter'
import { focusSx, hairline, insetSx, numSx, quickSx, tokens, type } from './ui'

export const CONSTELLATIONS = [0, 1, 2, 3, 4, 5, 6] as const

/** The rotations written for a member's constellations (one text each; absent: the team's) */
export type ConsRotationTexts = Partial<Record<number, string>>
export type ConsRotationScope = 'kqm' | 'inventory'

const rotationDocId = (teamId: string, scope: ConsRotationScope) =>
  scope === 'kqm' ? `${teamId}_kqm` : teamId

function allConsRotations(
  database: ArtCharDatabase,
  teamId: string,
  scope: ConsRotationScope = 'kqm'
) {
  try {
    const data = JSON.parse(
      database.teams.getRotationField(
        rotationDocId(teamId, scope),
        'ConstellationRotations'
      ) ?? '{}'
    )
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Partial<Record<CharacterKey, ConsRotationTexts>>)
      : {}
  } catch {
    return {}
  }
}

export function readConsRotations(
  database: ArtCharDatabase,
  teamId: string,
  ck: CharacterKey,
  scope: ConsRotationScope = 'kqm'
): ConsRotationTexts {
  const rotations = allConsRotations(database, teamId, scope)[ck]
  return Object.fromEntries(
    CONSTELLATIONS.flatMap((cons) => {
      const text = rotations?.[cons]
      return typeof text === 'string' ? [[cons, text]] : []
    })
  )
}

export function writeConsRotations(
  database: ArtCharDatabase,
  teamId: string,
  ck: CharacterKey,
  rotations: ConsRotationTexts,
  scope: ConsRotationScope = 'kqm'
) {
  const all = allConsRotations(database, teamId, scope) ?? {}
  if (Object.keys(rotations).length) all[ck] = rotations
  else delete all[ck]
  database.teams.setRotationField(
    rotationDocId(teamId, scope),
    'ConstellationRotations',
    Object.keys(all).length ? JSON.stringify(all) : null
  )
}

/**
 * The rotation a constellation plays: its own, else the nearest lower constellation's own (down to
 * the run's constellation, which plays the team's), else the team's (`text` absent). `from`: the
 * constellation whose own it is. `pinnedBase`: explicitly pinned to the team's base rotation
 * (opting out of inherited or auto-adapted rotations).
 */
export function consRotationOf(
  rotations: ConsRotationTexts,
  cons: number,
  ran: number
): { text?: string; from?: number; pinnedBase?: boolean } {
  for (let k = cons; k >= 0; k--) {
    if (k === ran) return {}
    const own = rotations[k]?.trim()
    if (!own) continue
    if (own === KEEP_BASE_ROTATION) return { from: k, pinnedBase: true }
    return { text: own, from: k }
  }
  return {}
}

const shortcut =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘ Enter'
    : 'Ctrl+Enter'

/**
 * A member's rotation at each constellation, read as steps. A constellation plays its own, else
 * the one below it does (a change at C2 carries to C3–C6 unless they have their own), else the
 * auto-adapted rotation (if any), else the team's (`consRotationOf`). A row opens as text to
 * change (with kit hints, 1-click deterministic suggestions, live preview, and optional fast
 * auto-find search for complex combo constellations).
 */
export function ConsRotations({
  characterKey: ck,
  ran,
  rotations,
  teamText,
  names,
  gender,
  aboveOnly = false,
  autoRotations,
  suggestionsOf,
  previewSim,
  onFindBest,
  focusCons,
  onSaveAndRun,
  onChange,
}: {
  characterKey: CharacterKey
  /** the constellation the run used */
  ran: number
  rotations: ConsRotationTexts
  teamText: string
  names: RotationMember[]
  gender: GenderKey
  /** Only show `ran` and higher constellations (for investment planning above baseline) */
  aboveOnly?: boolean
  /** Auto-adapted rotations active for this member's constellations */
  autoRotations?: Partial<Record<number, string>>
  /** Simulator-verified deterministic suggestions for a constellation */
  suggestionsOf?: (cons: number) => ConsRotationSuggestion[]
  /** Live simulation preview (rotation length & warnings) while editing */
  previewSim?: (
    cons: number,
    text: string
  ) => { time?: number; warnings: string[] } | undefined
  /** Fast single-member rotation finder at `cons` */
  onFindBest?: (
    cons: number,
    isCancelled: () => boolean,
    onProgress: (played: number, bestGainPct: number) => void
  ) => Promise<FoundConsRotation[]>
  /** Imperatively open and focus a specific constellation row */
  focusCons?: { cons: number; seq: number }
  /** Save and immediately re-run the investment comparison */
  onSaveAndRun?: (next: ConsRotationTexts) => void
  onChange: (next: ConsRotationTexts) => void
}) {
  const { t } = useTranslation('page_team')
  const [editing, setEditing] = useState<number>()
  const [draft, setDraft] = useState('')
  const [finding, setFinding] = useState(false)
  const [findProgress, setFindProgress] = useState<{
    played: number
    bestGainPct: number
  }>()
  const [found, setFound] = useState<FoundConsRotation[]>()
  const findCancelRef = useRef<() => void>(() => {})

  const played = (cons: number) => consRotationOf(rotations, cons, ran)
  /** What a constellation would play without its own explicit entry */
  const below = (cons: number) => {
    const { [cons]: _, ...rest } = rotations
    return consRotationOf(rest, cons, ran)
  }
  /** Effective auto-adapted rotation (only when no custom override or base pin applies) */
  const autoOf = (cons: number): { text?: string; from?: number } => {
    if (!autoRotations || cons <= ran) return {}
    for (let k = cons; k > ran; k--) {
      const text = autoRotations[k]?.trim()
      if (text) return { text, from: k }
    }
    return {}
  }

  const stopFind = useCallback(() => {
    findCancelRef.current()
    findCancelRef.current = () => {}
    setFinding(false)
    setFindProgress(undefined)
  }, [])

  useEffect(() => () => findCancelRef.current(), [])

  const open = (cons: number) => {
    stopFind()
    setFound(undefined)
    setEditing(cons)
    const p = played(cons)
    const auto = p.text || p.pinnedBase ? {} : autoOf(cons)
    setDraft(p.text ?? auto.text ?? teamText)
  }

  // Open requested constellation when clicked directly from results or idle hints
  const lastFocusSeq = useRef(0)
  useEffect(() => {
    if (!focusCons || focusCons.seq === lastFocusSeq.current) return
    lastFocusSeq.current = focusCons.seq
    if (focusCons.cons > ran) {
      stopFind()
      setFound(undefined)
      setEditing(focusCons.cons)
      const p = consRotationOf(rotations, focusCons.cons, ran)
      let autoText: string | undefined
      if (!p.text && !p.pinnedBase && autoRotations) {
        for (let k = focusCons.cons; k > ran; k--) {
          const text = autoRotations[k]?.trim()
          if (text) {
            autoText = text
            break
          }
        }
      }
      setDraft(p.text ?? autoText ?? teamText)
    }
  }, [focusCons, ran, rotations, autoRotations, teamText, stopFind])

  // Close editor cleanly when switching member tabs
  const prevCk = useRef(ck)
  useEffect(() => {
    if (prevCk.current !== ck) {
      prevCk.current = ck
      stopFind()
      setFound(undefined)
      setEditing(undefined)
    }
  }, [ck, stopFind])

  const commit = (next: ConsRotationTexts, runAfter: boolean) => {
    if (runAfter && onSaveAndRun) onSaveAndRun(next)
    else onChange(next)
  }

  /** Save `text` (default `draft`) for `cons`, using `KEEP_BASE_ROTATION` when reverting an auto/inherited rotation back to base */
  const save = (cons: number, runAfter = false, overrideText?: string) => {
    stopFind()
    const next = { ...rotations }
    const text = (overrideText ?? draft).trim()
    const inherited = below(cons)
    const hasAuto = !!autoOf(cons).text
    const baseTrim = teamText.trim()
    if (!text || text === baseTrim) {
      if (inherited.text || hasAuto) next[cons] = KEEP_BASE_ROTATION
      else delete next[cons]
    } else if (
      text === (inherited.text ?? (hasAuto ? '' : baseTrim)).trim() &&
      !inherited.pinnedBase
    ) {
      delete next[cons]
    } else {
      next[cons] = text
    }
    commit(next, runAfter)
    setEditing(undefined)
    setFound(undefined)
  }

  const reset = (cons: number, runAfter = false) => {
    stopFind()
    const next = { ...rotations }
    delete next[cons]
    commit(next, runAfter)
  }

  const pinBase = (cons: number, runAfter = false) => {
    stopFind()
    const next = { ...rotations, [cons]: KEEP_BASE_ROTATION }
    commit(next, runAfter)
    setEditing(undefined)
    setFound(undefined)
  }

  const runFindBest = async (cons: number) => {
    if (!onFindBest || finding) return
    stopFind()
    let cancelled = false
    findCancelRef.current = () => {
      cancelled = true
    }
    setFinding(true)
    setFound(undefined)
    setFindProgress({ played: 0, bestGainPct: 0 })
    try {
      const results = await onFindBest(
        cons,
        () => cancelled,
        (playedCount, bestGainPct) => {
          if (!cancelled) setFindProgress({ played: playedCount, bestGainPct })
        }
      )
      if (!cancelled) setFound(results)
    } catch {
      if (!cancelled) setFound([])
    } finally {
      if (!cancelled) {
        setFinding(false)
        setFindProgress(undefined)
      }
    }
  }

  const livePreview = useMemo(() => {
    if (editing === undefined || !draft.trim()) return undefined
    const parsed = parseRotation(draft, names)
    if (parsed.warnings?.length) return { warnings: parsed.warnings }
    return previewSim?.(editing, draft) ?? { warnings: [] }
  }, [editing, draft, names, previewSim])

  const warnings = livePreview?.warnings ?? []

  const icon = (cons: number) =>
    characterAsset(
      ck,
      cons ? (`constellation${cons}` as 'constellation1') : 'icon',
      gender
    ) ?? ''

  const status = (cons: number) => {
    if (cons === ran) return t('teamOpt.kqm.share.consRun', 'Run')
    const { from, pinnedBase } = played(cons)
    if (from === cons && pinnedBase)
      return t('teamOpt.kqm.share.consBasePinned', 'Base (pinned)')
    if (from === cons) return t('teamOpt.kqm.share.consOwn', 'Own rotation')
    if (from !== undefined && pinnedBase)
      return t('teamOpt.kqm.share.consBaseAs', {
        defaultValue: 'Base (from C{{cons}})',
        cons: from,
      })
    if (from !== undefined)
      return t('teamOpt.kqm.share.consAs', {
        defaultValue: 'Same as C{{cons}}',
        cons: from,
      })
    const auto = autoOf(cons)
    if (auto.from === cons)
      return t('teamOpt.kqm.share.consAuto', 'Auto-adapted')
    if (auto.from !== undefined)
      return t('teamOpt.kqm.share.consAutoAs', {
        defaultValue: 'Auto (C{{cons}})',
        cons: auto.from,
      })
    return t('teamOpt.kqm.share.consTeam', 'Team rotation')
  }

  const shownCons = aboveOnly
    ? CONSTELLATIONS.filter((c) => c >= ran)
    : CONSTELLATIONS

  return (
    <Box sx={{ ...insetSx, overflow: 'hidden' }}>
      {shownCons.map((cons, i) => {
        const { text: written, from, pinnedBase } = played(cons)
        const auto = written || pinnedBase ? {} : autoOf(cons)
        const text = written ?? auto.text ?? teamText
        const other = (from !== undefined && !pinnedBase) || !!auto.text
        const mine = from === cons
        const isAutoOwn = !written && !pinnedBase && auto.from === cons
        const isOpen = editing === cons
        const hint = cons > ran ? constellationHintOf(ck, cons) : undefined
        const suggestions = isOpen ? (suggestionsOf?.(cons) ?? []) : []
        const needsHintTag =
          !!hint && !other && !pinnedBase && !!teamText.trim()

        const head = (
          <>
            <Box
              component="img"
              src={icon(cons)}
              alt=""
              aria-hidden
              sx={{ width: 30, height: 30, objectFit: 'contain' }}
            />
            <Box sx={{ display: 'grid', gap: 0.25 }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1 }}>
                C{cons}
              </Typography>
              <Typography
                sx={{
                  ...type.label,
                  fontSize: 11.5,
                  lineHeight: 1.1,
                  whiteSpace: 'nowrap',
                  color:
                    mine && !pinnedBase
                      ? tokens.gold
                      : isAutoOwn
                        ? giTokens.goldLight
                        : 'text.secondary',
                }}
              >
                {status(cons)}
              </Typography>
            </Box>
          </>
        )
        return (
          <Box
            key={cons}
            sx={{
              borderTop: i ? hairline : 'none',
              bgcolor: isOpen ? tokens.raised : undefined,
            }}
          >
            {isOpen ? (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '30px 104px minmax(0, 1fr)',
                  columnGap: 1.25,
                  alignItems: 'start',
                  px: 1.75,
                  py: 1.5,
                }}
              >
                {head}
                <Box sx={{ display: 'grid', gap: 1 }}>
                  {hint && (
                    <Box
                      sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 1,
                        px: 1.125,
                        py: 0.75,
                        borderRadius: tokens.radius.control,
                        bgcolor: alpha(tokens.gold, 0.08),
                        border: `1px solid ${alpha(tokens.gold, 0.22)}`,
                      }}
                    >
                      <Typography
                        sx={{ fontSize: 12.5, color: 'text.primary' }}
                      >
                        <Box
                          component="strong"
                          sx={{ color: giTokens.goldLight, mr: 0.5 }}
                        >
                          C{cons}:
                        </Box>
                        {hint.summary}
                        <Box
                          component="span"
                          sx={{ color: 'text.secondary', ml: 0.75 }}
                        >
                          · {hint.cue}
                        </Box>
                      </Typography>
                    </Box>
                  )}

                  {/* Quick 1-click deterministic suggestions + Auto-find button */}
                  {(suggestions.length > 0 ||
                    (onFindBest && !!teamText.trim())) && (
                    <Box
                      sx={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 0.75,
                      }}
                    >
                      {suggestions.map((s) => {
                        const applied = draft.trim() === s.text.trim()
                        return (
                          <Tooltip
                            key={s.text}
                            arrow
                            describeChild
                            title={s.diff}
                          >
                            <Button
                              size="small"
                              variant={applied ? 'contained' : 'outlined'}
                              color={applied ? 'primary' : 'inherit'}
                              startIcon={
                                applied ? (
                                  <CheckRoundedIcon sx={{ fontSize: 15 }} />
                                ) : (
                                  <AutoAwesomeRoundedIcon
                                    sx={{ fontSize: 14, color: tokens.gold }}
                                  />
                                )
                              }
                              onClick={() => setDraft(s.text)}
                              sx={{
                                textTransform: 'none',
                                fontSize: 12,
                                minHeight: 28,
                                px: 1,
                                borderColor: applied
                                  ? undefined
                                  : alpha(tokens.gold, 0.35),
                                color: applied ? undefined : giTokens.goldLight,
                              }}
                            >
                              {s.tag}
                              {s.rotationTime
                                ? ` · ${s.rotationTime.toFixed(1)}s`
                                : ''}
                            </Button>
                          </Tooltip>
                        )
                      })}

                      {onFindBest && !!teamText.trim() && (
                        <Button
                          size="small"
                          variant="outlined"
                          color="inherit"
                          startIcon={
                            finding ? (
                              <StopRoundedIcon sx={{ fontSize: 15 }} />
                            ) : (
                              <AutoFixHighRoundedIcon
                                sx={{ fontSize: 15, color: tokens.gold }}
                              />
                            )
                          }
                          onClick={() =>
                            finding ? stopFind() : void runFindBest(cons)
                          }
                          sx={{
                            textTransform: 'none',
                            fontSize: 12,
                            minHeight: 28,
                            px: 1.125,
                            borderColor: tokens.hairlineStrong,
                          }}
                        >
                          {finding
                            ? t('teamOpt.kqm.share.consStopFind', 'Stop search')
                            : t('teamOpt.kqm.share.consAutoFind', {
                                defaultValue: 'Auto-find C{{cons}} rotation',
                                cons,
                              })}
                        </Button>
                      )}

                      {finding && findProgress && (
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.75,
                            ...numSx,
                          }}
                        >
                          <CircularProgress
                            size={13}
                            sx={{ color: tokens.gold }}
                          />
                          <Typography
                            sx={{ fontSize: 12, color: 'text.secondary' }}
                          >
                            {findProgress.played > 0
                              ? t('teamOpt.kqm.share.consFindingStats', {
                                  defaultValue: 'Tested {{count}}{{best}}…',
                                  count: findProgress.played,
                                  best:
                                    findProgress.bestGainPct > 0.002
                                      ? ` · best ${formatGain(findProgress.bestGainPct)}`
                                      : '',
                                })
                              : t(
                                  'teamOpt.kqm.share.consFinding',
                                  'Testing variations…'
                                )}
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  )}

                  {/* Auto-find candidate results */}
                  {found && (
                    <Box sx={{ display: 'grid', gap: 0.625 }}>
                      {found.length > 0 ? (
                        found.map((cand) => {
                          const selected = draft.trim() === cand.text.trim()
                          return (
                            <Box
                              key={cand.text}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                                px: 1.125,
                                py: 0.625,
                                borderRadius: tokens.radius.control,
                                border: `1px solid ${
                                  selected
                                    ? alpha(tokens.gold, 0.5)
                                    : tokens.hairline
                                }`,
                                bgcolor: selected
                                  ? alpha(tokens.gold, 0.1)
                                  : tokens.inset,
                              }}
                            >
                              <Typography
                                sx={{
                                  fontSize: 12.5,
                                  fontWeight: 700,
                                  color: 'success.main',
                                  flexShrink: 0,
                                  ...numSx,
                                }}
                              >
                                {formatGain(cand.gainPct)}
                              </Typography>
                              <Typography
                                sx={{
                                  fontSize: 11.5,
                                  color: 'text.secondary',
                                  flexShrink: 0,
                                  ...numSx,
                                }}
                              >
                                {cand.time.toFixed(1)}s
                              </Typography>
                              <Typography
                                noWrap
                                title={cand.diff}
                                sx={{
                                  fontSize: 12,
                                  color: 'text.primary',
                                  flex: 1,
                                  minWidth: 0,
                                  fontFamily: 'monospace',
                                }}
                              >
                                {cand.diff}
                              </Typography>
                              <Button
                                size="small"
                                variant={selected ? 'contained' : 'text'}
                                onClick={() => setDraft(cand.text)}
                                sx={{
                                  textTransform: 'none',
                                  fontSize: 12,
                                  minHeight: 24,
                                  px: 1,
                                  flexShrink: 0,
                                }}
                              >
                                {selected
                                  ? t('teamOpt.kqm.share.consLoaded', 'Loaded')
                                  : t('teamOpt.kqm.share.consUse', 'Use')}
                              </Button>
                            </Box>
                          )
                        })
                      ) : (
                        <Typography
                          sx={{ fontSize: 12, color: 'text.secondary' }}
                        >
                          {t(
                            'teamOpt.kqm.share.consAutoFindNone',
                            'No single-member variation beat the current rotation within ER limits — you can still edit it manually below.'
                          )}
                        </Typography>
                      )}
                    </Box>
                  )}

                  <TextField
                    autoFocus
                    multiline
                    minRows={2}
                    fullWidth
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => {
                      const end = e.target.value.length
                      e.target.setSelectionRange(end, end)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        // (closes the editor, not the dialog)
                        e.stopPropagation()
                        stopFind()
                        setEditing(undefined)
                      } else if (
                        e.key === 'Enter' &&
                        (e.metaKey || e.ctrlKey)
                      ) {
                        e.preventDefault()
                        save(cons, !!onSaveAndRun)
                      }
                    }}
                    inputProps={{
                      'aria-label': t('teamOpt.kqm.share.consRotationLabel', {
                        defaultValue: 'Rotation at C{{cons}}',
                        cons,
                      }),
                      spellCheck: false,
                    }}
                    sx={editorSx}
                  />
                  {warnings.length > 0 ? (
                    <Typography sx={{ fontSize: 12.5, color: 'warning.main' }}>
                      {warnings[0]}
                    </Typography>
                  ) : (
                    livePreview?.time !== undefined && (
                      <Typography
                        sx={{
                          fontSize: 12,
                          color: 'text.secondary',
                          ...numSx,
                        }}
                      >
                        {t('teamOpt.kqm.share.consPreviewLen', {
                          defaultValue: 'Simulated rotation: {{time}}s',
                          time: livePreview.time.toFixed(1),
                        })}
                      </Typography>
                    )
                  )}
                  <Box
                    sx={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 1,
                    }}
                  >
                    <Tooltip title={shortcut} arrow describeChild>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => save(cons, !!onSaveAndRun)}
                      >
                        {onSaveAndRun
                          ? t(
                              'teamOpt.kqm.share.consSaveUpdate',
                              'Save & update'
                            )
                          : t('teamOpt.kqm.share.consSave', 'Save')}
                      </Button>
                    </Tooltip>
                    {isAutoOwn || autoOf(cons).text ? (
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => pinBase(cons, !!onSaveAndRun)}
                      >
                        {t(
                          'teamOpt.kqm.share.consKeepBase',
                          'Use base rotation'
                        )}
                      </Button>
                    ) : (
                      <Button
                        size="small"
                        color="inherit"
                        onClick={() => setDraft(teamText)}
                        disabled={draft.trim() === teamText.trim()}
                      >
                        {t('teamOpt.kqm.share.consFromTeam', 'Team rotation')}
                      </Button>
                    )}
                    <Box sx={{ flex: 1 }} />
                    <Button
                      size="small"
                      color="inherit"
                      onClick={() => {
                        stopFind()
                        setEditing(undefined)
                      }}
                    >
                      {t('teamOpt.kqm.share.consCancel', 'Cancel')}
                    </Button>
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  pr: 1,
                  ...quickSx,
                  '&:hover': {
                    bgcolor: cons === ran ? undefined : alpha('#ece5d8', 0.035),
                  },
                }}
              >
                <ButtonBase
                  disabled={cons === ran}
                  onClick={() => open(cons)}
                  aria-label={t('teamOpt.kqm.share.consEdit', {
                    defaultValue: 'Edit the rotation at C{{cons}}',
                    cons,
                  })}
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    display: 'grid',
                    gridTemplateColumns: '30px 104px minmax(0, 1fr)',
                    columnGap: 1.25,
                    alignItems: 'center',
                    textAlign: 'left',
                    justifyItems: 'start',
                    pl: 1.75,
                    py: 1.25,
                    borderRadius: 0,
                    ...focusSx,
                  }}
                >
                  {head}
                  <Box
                    sx={{
                      minWidth: 0,
                      width: '100%',
                      display: 'grid',
                      gap: 0.375,
                    }}
                  >
                    {hint && (
                      <Box
                        sx={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          gap: 0.625,
                        }}
                      >
                        {needsHintTag && (
                          <Box
                            component="span"
                            sx={{
                              fontSize: 10.5,
                              fontWeight: 700,
                              px: 0.625,
                              py: 0.1,
                              borderRadius: 999,
                              color: 'warning.main',
                              bgcolor: (theme) =>
                                alpha(theme.palette.warning.main, 0.14),
                            }}
                          >
                            {t(
                              'teamOpt.kqm.share.consChangesRot',
                              'Changes rot'
                            )}
                          </Box>
                        )}
                        <Typography
                          noWrap
                          sx={{
                            fontSize: 11.5,
                            color: needsHintTag
                              ? 'text.primary'
                              : 'text.secondary',
                          }}
                        >
                          {hint.summary}
                        </Typography>
                      </Box>
                    )}
                    <Box
                      sx={{
                        minWidth: 0,
                        // (the team's rotation faint: a constellation's own or auto-adapted stands out)
                        opacity: other ? 1 : 0.55,
                      }}
                    >
                      {text.trim() ? (
                        <RotationReadout
                          text={text}
                          opener=""
                          counted={false}
                          names={names}
                        />
                      ) : (
                        <Typography sx={type.label}>
                          {t(
                            'teamOpt.kqm.share.consRotationNone',
                            'The team’s attacks'
                          )}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                </ButtonBase>
                <Box sx={{ display: 'flex', gap: 0.25 }}>
                  {mine && (
                    <Tooltip
                      arrow
                      title={
                        pinnedBase
                          ? t(
                              'teamOpt.kqm.share.consUnpinBase',
                              'Re-enable auto/inherited rotation'
                            )
                          : below(cons).from !== undefined
                            ? t('teamOpt.kqm.share.consResetTo', {
                                defaultValue: 'Use C{{cons}}’s rotation',
                                cons: below(cons).from,
                              })
                            : t(
                                'teamOpt.kqm.share.consReset',
                                'Use the team’s rotation'
                              )
                      }
                    >
                      <IconButton
                        size="small"
                        onClick={() => reset(cons, !!onSaveAndRun)}
                      >
                        <ReplayRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {isAutoOwn && (
                    <Tooltip
                      arrow
                      title={t(
                        'teamOpt.kqm.share.consRevertAuto',
                        'Revert to team’s base rotation'
                      )}
                    >
                      <IconButton
                        size="small"
                        onClick={() => pinBase(cons, !!onSaveAndRun)}
                      >
                        <ReplayRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                  {cons !== ran && (
                    <Tooltip
                      arrow
                      title={t('teamOpt.kqm.share.consEditShort', 'Edit')}
                    >
                      <IconButton size="small" onClick={() => open(cons)}>
                        <EditRoundedIcon sx={{ fontSize: 18 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * A rotation written for a combination of constellations (several members raised at once: Flins
 * C2 with Danica C1 plays differently from either alone)
 */
export interface ComboRotation {
  /** the members raised and to which constellation (at least two) */
  cons: Partial<Record<CharacterKey, number>>
  text: string
}
export function readComboRotations(
  database: ArtCharDatabase,
  teamId: string,
  scope: ConsRotationScope = 'kqm'
): ComboRotation[] {
  try {
    const saved = JSON.parse(
      database.teams.getRotationField(
        rotationDocId(teamId, scope),
        'CombinationRotations'
      ) ?? '[]'
    )
    return Array.isArray(saved)
      ? saved.filter(
          (x): x is ComboRotation =>
            !!x &&
            typeof x === 'object' &&
            typeof x.text === 'string' &&
            !!x.cons &&
            typeof x.cons === 'object' &&
            !Array.isArray(x.cons)
        )
      : []
  } catch {
    return []
  }
}
export function writeComboRotations(
  database: ArtCharDatabase,
  teamId: string,
  combos: ComboRotation[],
  scope: ConsRotationScope = 'kqm'
) {
  database.teams.setRotationField(
    rotationDocId(teamId, scope),
    'CombinationRotations',
    combos.length ? JSON.stringify(combos) : null
  )
}
/** A combination's members raised above the run's constellations */
const raisedOf = (
  combo: ComboRotation,
  base: Partial<Record<CharacterKey, number>>
) =>
  (Object.entries(combo.cons) as [CharacterKey, number][]).filter(
    ([k, c]) => c > (base[k] ?? 0)
  )
/**
 * The rotation written for a combination that the team's constellations include: every member it
 * raises at least that high (Flins C2 + Danica C1 also covers Flins C3 + Danica C1, as a
 * constellation's rotation carries to the higher ones), the one with the most constellations
 * first; none: undefined
 */
export function comboRotationOf(
  combos: readonly ComboRotation[],
  cons: Partial<Record<CharacterKey, number>>,
  base: Partial<Record<CharacterKey, number>>
) {
  let best: { text: string; size: number } | undefined
  for (const combo of combos) {
    const raised = raisedOf(combo, base)
    if (raised.length < 2 || !combo.text.trim()) continue
    if (!raised.every(([k, c]) => (cons[k] ?? base[k] ?? 0) >= c)) continue
    const size = raised.reduce((n, [k, c]) => n + c - (base[k] ?? 0), 0)
    if (!best || size > best.size) best = { text: combo.text.trim(), size }
  }
  return best?.text
}

/**
 * Rotations for combinations of constellations (advanced): each one the members it raises (a
 * constellation each, at least two) and the rotation the team plays with them, used for those
 * constellations and any higher ones in the team's investment chart
 */
export function ComboRotations({
  keys,
  base,
  combos,
  teamText,
  names,
  onChange,
}: {
  keys: CharacterKey[]
  /** each member's constellation in the run */
  base: Partial<Record<CharacterKey, number>>
  combos: ComboRotation[]
  teamText: string
  names: RotationMember[]
  onChange: (next: ComboRotation[]) => void
}) {
  const { t } = useTranslation('page_team')
  const [editing, setEditing] = useState<number>()
  const [draft, setDraft] = useState('')
  const nameOf = (k: CharacterKey) =>
    names.find((n) => n.characterKey === k)?.name ?? k
  const set = (i: number, next: ComboRotation) =>
    onChange(combos.map((c, j) => (j === i ? next : c)))
  const add = () => {
    onChange([...combos, { cons: {}, text: teamText }])
    setEditing(combos.length)
    setDraft(teamText)
  }
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {combos.map((combo, i) => {
        const raised = raisedOf(combo, base)
        const isOpen = editing === i
        return (
          <Box key={i} sx={{ ...insetSx, p: 1.25, display: 'grid', gap: 1 }}>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 1,
              }}
            >
              {keys.map((k) => {
                const from = base[k] ?? 0
                const value = combo.cons[k] ?? from
                return (
                  <TextField
                    key={k}
                    select
                    size="small"
                    value={value}
                    onChange={(e) => {
                      const c = Number(e.target.value)
                      const cons = { ...combo.cons }
                      if (c > from) cons[k] = c
                      else delete cons[k]
                      set(i, { ...combo, cons })
                    }}
                    label={nameOf(k)}
                    sx={{
                      width: 116,
                      '& .MuiInputBase-root': {
                        color: value > from ? tokens.gold : undefined,
                        fontWeight: value > from ? 700 : 400,
                      },
                    }}
                  >
                    {CONSTELLATIONS.filter((c) => c >= from).map((c) => (
                      <MenuItem key={c} value={c}>
                        {c === from
                          ? t('teamOpt.kqm.share.comboAsRun', {
                              defaultValue: 'C{{cons}} (run)',
                              cons: c,
                            })
                          : `C${c}`}
                      </MenuItem>
                    ))}
                  </TextField>
                )
              })}
              <Box sx={{ flex: 1 }} />
              <Tooltip
                arrow
                title={t('teamOpt.kqm.share.comboRemove', 'Remove')}
              >
                <IconButton
                  size="small"
                  onClick={() => {
                    onChange(combos.filter((_, j) => j !== i))
                    setEditing(undefined)
                  }}
                  aria-label={t('teamOpt.kqm.share.comboRemove', 'Remove')}
                >
                  <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Box>
            {raised.length < 2 && (
              <Typography sx={{ ...type.label, fontSize: 12 }}>
                {t(
                  'teamOpt.kqm.share.comboPick',
                  'Raise at least two members above the run’s constellations.'
                )}
              </Typography>
            )}
            {isOpen ? (
              <Box sx={{ display: 'grid', gap: 1 }}>
                <TextField
                  autoFocus
                  multiline
                  minRows={2}
                  fullWidth
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation()
                      setEditing(undefined)
                    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      set(i, { ...combo, text: draft.trim() })
                      setEditing(undefined)
                    }
                  }}
                  inputProps={{
                    'aria-label': t(
                      'teamOpt.kqm.share.comboRotation',
                      'Rotation for this combination'
                    ),
                    spellCheck: false,
                  }}
                  sx={editorSx}
                />
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Tooltip title={shortcut} arrow>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => {
                        set(i, { ...combo, text: draft.trim() })
                        setEditing(undefined)
                      }}
                    >
                      {t('teamOpt.kqm.share.consSave', 'Save')}
                    </Button>
                  </Tooltip>
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => setEditing(undefined)}
                  >
                    {t('teamOpt.kqm.share.consCancel', 'Cancel')}
                  </Button>
                </Box>
              </Box>
            ) : (
              <ButtonBase
                onClick={() => {
                  setEditing(i)
                  setDraft(combo.text || teamText)
                }}
                aria-label={t(
                  'teamOpt.kqm.share.comboEdit',
                  'Edit the rotation for this combination'
                )}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 1,
                  textAlign: 'left',
                  borderRadius: 1,
                  p: 0.5,
                  ...focusSx,
                  '&:hover': { bgcolor: alpha('#ece5d8', 0.035) },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <RotationReadout
                    text={combo.text || teamText}
                    opener=""
                    counted={false}
                    names={names}
                  />
                </Box>
                <EditRoundedIcon
                  sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }}
                />
              </ButtonBase>
            )}
          </Box>
        )
      })}
      <Box>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<AddRoundedIcon />}
          onClick={add}
        >
          {t('teamOpt.kqm.share.comboAdd', 'Add a combination')}
        </Button>
      </Box>
    </Box>
  )
}
