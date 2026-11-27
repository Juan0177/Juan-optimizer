import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import { characterAsset, weaponAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allTravelerKeys,
  charKeyToLocGenderedCharKey,
  signatureWeapons,
} from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { getCharEle, getCharStat } from '@genshin-optimizer/gi/stats'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  ConsRotationHint,
  ConsRotationSuggestion,
  FoundConsRotation,
  HitElement,
  InvestmentChartData,
  KqmBuild,
  KqmResult,
  SimGear,
  TeamOptMember,
  TeamOptResult,
} from '@genshin-optimizer/gi/ui'
import {
  BETA_LABEL,
  CardImageDialog,
  CharacterName,
  COMPARE_CHART_HEIGHT,
  COMPARE_CHART_WIDTH,
  constellationHintOf,
  constellationRotationHints,
  FPS,
  findBestConstellationRotations,
  isAutoAdaptableHint,
  KEEP_BASE_ROTATION,
  kqmCardFace,
  kqmRotationSearchSetup,
  kqmTalentLevel,
  mergeMemberRotations,
  parseRotation,
  renderInvestmentChart,
  rotationScorer,
  safeName,
  simulateRotation,
  stepDiffSummary,
  suggestConstellationRotations,
  TeamOptCancelled,
  teamOptBonusStats,
  teamOptResultGear,
  teamRotationSearchSetup,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import StopRoundedIcon from '@mui/icons-material/StopRounded'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import TuneRoundedIcon from '@mui/icons-material/TuneRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Collapse,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Popover,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Fragment,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  type ComboRotation,
  ComboRotations,
  ConsRotations,
  type ConsRotationTexts,
  comboRotationOf,
  consRotationOf,
  readComboRotations,
  readConsRotations,
  writeComboRotations,
  writeConsRotations,
} from './ConsRotations'
import {
  type ConsPoint,
  dpsOf,
  evaluateInventoryInvestment,
  type InvestmentEval,
  type InvestmentPath,
  type InvestmentPlan,
  type InvestmentPlanProgress,
  type InvestmentState,
  investmentStateKey,
  kqmInvestmentConcurrency,
  planInvestments,
  refitConstellations,
} from './consInvestment'
import { formatGain, formatRateFull } from './format'
import { betaOf, shareStamp } from './KqmShareMenu'
import { kqmStandardText } from './KqmStandard'
import { MemberAvatar } from './MemberAvatar'
import {
  kqmRunRotation,
  teamRunRotation,
  useMemberNames,
} from './RotationWriter'
import {
  focusSx,
  hairline,
  insetSx,
  numSx,
  Panel,
  quickSx,
  tokens,
  type,
} from './ui'

const FREE_FIVE_STARS = new Set<string>([...allTravelerKeys, 'Aloy'])
const BUDGET_PRESETS = [1, 2, 3, 4, 6] as const
const MAX_CONS = 6

const isPullableFiveStar = (ck: CharacterKey) =>
  getCharStat(ck).rarity === 5 && !FREE_FIVE_STARS.has(ck)

const copiesOf = (ck: CharacterKey, cons: number) =>
  isPullableFiveStar(ck) ? cons + 1 : 0

type AutoRotationMap = Partial<
  Record<CharacterKey, Partial<Record<number, string>>>
>

interface CachedInvestment {
  /** Evaluated states keyed by `${stateKey}::${modeTag}` */
  evals: Map<string, InvestmentEval>
  /** Discovered winning auto-adapted rotations per member/constellation */
  autoRotations: AutoRotationMap
  last?: {
    plan: InvestmentPlan
    configKey: string
  }
}

const resultCache = new WeakMap<object, CachedInvestment>()

function cacheFor(subject: object): CachedInvestment {
  let hit = resultCache.get(subject)
  if (!hit) {
    hit = { evals: new Map(), autoRotations: {} }
    resultCache.set(subject, hit)
  }
  return hit
}

export interface TeamInvestmentProps {
  teamId: string
  members: TeamOptMember[]
  mode: 'kqm' | 'inventory'
  setup: TeamOpt
  result: KqmResult | TeamOptResult
  rotationTime?: number
  disabled?: boolean
  anchorId?: string
}

/**
 * Snappy, single-glance investment comparison panel (available in both Team Optimize and KQM
 * Theorycrafting): compares your team baseline against extra 5★ pulls across constellations,
 * R1 signature weapons, and optional conditional alternative rotations, streaming results live
 * from the parallel worker pool with zero layout shift.
 */
export function TeamInvestment({
  teamId,
  members,
  mode,
  setup,
  result,
  rotationTime,
  disabled = false,
  anchorId,
}: TeamInvestmentProps) {
  const { t, i18n } = useTranslation([
    'page_team',
    'charNames_gen',
    'weaponNames_gen',
  ])
  const database = useDatabase()
  const { gender } = useDBMeta()
  const team = useTeam(teamId)
  const names = useMemberNames(members)

  const kqmResult = mode === 'kqm' ? (result as KqmResult) : undefined
  const invResult = mode === 'inventory' ? (result as TeamOptResult) : undefined

  const keys = useMemo(
    () =>
      kqmResult
        ? members
            .map((m) => m.characterKey)
            .filter((k) => !!kqmResult.builds[k])
        : members.map((m) => m.characterKey),
    [members, kqmResult]
  )

  const charName = useCallback(
    (ck: CharacterKey) =>
      t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`),
    [t, gender]
  )

  const baseCons = useMemo(
    () =>
      keys.map((k) => {
        if (kqmResult) return kqmResult.constellations[k] ?? 0
        const m = members.find((x) => x.characterKey === k)
        if (!m) return 0
        return (
          (m.isTc
            ? database.buildTcs.get(m.loadoutDatum.buildTcId)?.character
                ?.constellation
            : database.chars.get(k)?.constellation) ?? 0
        )
      }),
    [keys, kqmResult, members, database]
  )

  const baseConsMap = useMemo(
    () =>
      Object.fromEntries(keys.map((k, i) => [k, baseCons[i]])) as Partial<
        Record<CharacterKey, number>
      >,
    [keys, baseCons]
  )

  const baseWeapons = useMemo(
    () =>
      keys.map((k) => {
        if (kqmResult) return kqmResult.builds[k]?.weapon
        const m = members.find((x) => x.characterKey === k)
        if (!m) return undefined
        const w = m.isTc
          ? database.buildTcs.get(m.loadoutDatum.buildTcId)?.weapon
          : database.weapons.get(invResult?.weapons?.[k] ?? m.weaponId)
        return w ? { key: w.key, refinement: w.refinement } : undefined
      }),
    [keys, kqmResult, invResult, members, database]
  )

  const baseSeconds =
    mode === 'kqm'
      ? (kqmResult?.played?.rotationTime ?? rotationTime)
      : (invResult?.rotationTime ?? rotationTime)

  const basePoint = useMemo(
    (): ConsPoint => ({
      team: result.after.total,
      members: result.after.members,
      seconds: baseSeconds,
      builds: kqmResult?.builds ?? {},
    }),
    [result, baseSeconds, kqmResult]
  )
  const baseDps = dpsOf(basePoint)

  const sigAvailable = useMemo(
    () =>
      keys.map((k, i) => {
        const sig = signatureWeapons[k]
        if (!sig || !isPullableFiveStar(k)) return false
        return baseWeapons[i]?.key !== sig
      }),
    [keys, baseWeapons]
  )

  const hasAnyFourStarRoom = useMemo(
    () =>
      keys.some(
        (k, i) => getCharStat(k).rarity === 4 && baseCons[i] < MAX_CONS
      ),
    [keys, baseCons]
  )

  const defaultIncluded = useMemo(() => {
    const fiveStarIds = keys.filter(
      (k, i) =>
        isPullableFiveStar(k) && (baseCons[i] < MAX_CONS || sigAvailable[i])
    )
    if (fiveStarIds.length) return new Set<CharacterKey>(fiveStarIds)
    return new Set<CharacterKey>(
      keys.filter(
        (k, i) =>
          !FREE_FIVE_STARS.has(k) && (baseCons[i] < MAX_CONS || sigAvailable[i])
      )
    )
  }, [keys, baseCons, sigAvailable])

  const teamKey = `${teamId}|${mode}|${keys.join(',')}`
  const [included, setIncluded] = useState<Set<CharacterKey>>(
    () => defaultIncluded
  )
  const [includeSig, setIncludeSig] = useState(true)
  const [autoAdapt, setAutoAdapt] = useState(true)
  const [includeFourStars, setIncludeFourStars] = useState(
    () =>
      defaultIncluded.size > 0 &&
      [...defaultIncluded].some((k) => getCharStat(k).rarity === 4)
  )
  const [budgetChoice, setBudgetChoice] = useState<number | 'all'>(3)
  const [optionsAnchor, setOptionsAnchor] = useState<HTMLElement | null>(null)
  const optionsDirtyRef = useRef(false)

  const lastTeamKey = useRef(teamKey)
  useEffect(() => {
    if (lastTeamKey.current === teamKey) return
    lastTeamKey.current = teamKey
    setIncluded(defaultIncluded)
    setIncludeFourStars(
      [...defaultIncluded].some((k) => getCharStat(k).rarity === 4)
    )
  }, [teamKey, defaultIncluded])

  // Conditional alternative rotations (persisted per team and tab scope)
  const rotDoc = team?.rotationDocuments?.[mode]
  const teamText = rotDoc?.UseAttacks === '1' ? '' : (rotDoc?.Text ?? '')

  const [rotationsOf, setRotationsOf] = useState<
    Partial<Record<CharacterKey, ConsRotationTexts>>
  >(() =>
    Object.fromEntries(
      keys.map((k) => [k, readConsRotations(database, teamId, k, mode)])
    )
  )
  const [combos, setCombosState] = useState<ComboRotation[]>(() =>
    readComboRotations(database, teamId, mode)
  )
  const [autoRotations, setAutoRotations] = useState<AutoRotationMap>(() => ({
    ...cacheFor(result).autoRotations,
  }))
  useEffect(() => {
    setRotationsOf(
      Object.fromEntries(
        keys.map((k) => [k, readConsRotations(database, teamId, k, mode)])
      )
    )
    setCombosState(readComboRotations(database, teamId, mode))
  }, [database, teamId, mode, keys])

  const setRotations = (ck: CharacterKey, next: ConsRotationTexts) => {
    setRotationsOf((r) => ({ ...r, [ck]: next }))
    writeConsRotations(database, teamId, ck, next, mode)
  }
  const setCombos = (next: ComboRotation[]) => {
    setCombosState(next)
    writeComboRotations(database, teamId, next, mode)
  }

  const [rotationsOpen, setRotationsOpen] = useState(false)
  const [rotTab, setRotTab] = useState<CharacterKey | 'combos'>(
    () => keys[0] ?? 'combos'
  )
  const [focusCons, setFocusCons] = useState<{
    ck: CharacterKey
    cons: number
    seq: number
  }>()
  const rotEditorRef = useRef<HTMLDivElement>(null)

  const activeRotTab: CharacterKey | 'combos' =
    rotTab === 'combos' || keys.includes(rotTab)
      ? rotTab
      : (keys[0] ?? 'combos')

  const openConsEditor = useCallback((ck: CharacterKey, cons: number) => {
    setRotTab(ck)
    setFocusCons((prev) => ({ ck, cons, seq: (prev?.seq ?? 0) + 1 }))
    setRotationsOpen(true)
    requestAnimationFrame(() => {
      rotEditorRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest',
      })
    })
  }, [])

  const savedRotMeta = useMemo(() => {
    try {
      const meta =
        mode === 'kqm'
          ? kqmRunRotation?.(database, gender, i18n, teamId)
          : teamRunRotation?.(database, gender, i18n, teamId)
      if (meta) return meta
    } catch {
      // fall back cleanly when rotation metadata is unavailable (e.g. unit tests)
    }
    return {
      text: teamText,
      opener: '',
      timing: { edits: {} },
      frameData: {},
      names,
    }
  }, [mode, database, gender, i18n, teamId, teamText, names])

  const memberHintsMap = useMemo(
    () =>
      Object.fromEntries(
        keys.map((ck, i) => [
          ck,
          constellationRotationHints(ck, baseCons[i], MAX_CONS),
        ])
      ) as Partial<Record<CharacterKey, ConsRotationHint[]>>,
    [keys, baseCons]
  )

  const verifiedSuggestions = useMemo(() => {
    const out: Partial<
      Record<CharacterKey, Partial<Record<number, ConsRotationSuggestion[]>>>
    > = {}
    if (!teamText.trim()) return out
    const simCtx = {
      members: keys,
      constellations: baseConsMap,
      opener: savedRotMeta.opener,
      timing: savedRotMeta.timing,
      frameData: savedRotMeta.frameData,
    }
    for (const ck of keys) {
      for (const hint of memberHintsMap[ck] ?? []) {
        if (!isAutoAdaptableHint(hint)) continue
        try {
          const suggs = suggestConstellationRotations(
            teamText,
            names,
            ck,
            hint.cons,
            simCtx
          )
          if (suggs.length) {
            out[ck] ??= {}
            out[ck]![hint.cons] = suggs
          }
        } catch {
          // ignore if simulation context isn't available
        }
      }
    }
    return out
  }, [teamText, keys, baseConsMap, savedRotMeta, memberHintsMap, names])

  const previewSimFor = useCallback(
    (ck: CharacterKey) => (cons: number, text: string) => {
      if (!text.trim()) return undefined
      try {
        const parsed = parseRotation(text, names)
        if (!parsed?.steps?.length) return { warnings: parsed?.warnings ?? [] }
        if (parsed.warnings?.length) return { warnings: parsed.warnings }
        const elements = Object.fromEntries(
          keys.map((k) => [k, getCharEle(k) as HitElement])
        ) as Partial<Record<CharacterKey, HitElement>>
        const sim = simulateRotation({
          rotation: parsed,
          members: keys,
          elements,
          constellations: { ...baseConsMap, [ck]: cons },
          repeats: 2,
          keep: 'middle',
          swapFrames: savedRotMeta.timing?.swapFrames,
          frameData: savedRotMeta.frameData,
        })
        return {
          time: sim.frames
            ? Math.round((sim.frames / FPS) * 10) / 10
            : undefined,
          warnings: sim.warnings,
        }
      } catch {
        return undefined
      }
    },
    [names, keys, baseConsMap, savedRotMeta]
  )

  const findBestFor = useCallback(
    (ck: CharacterKey) =>
      async (
        cons: number,
        isCancelled: () => boolean,
        onProgress: (played: number, bestGainPct: number) => void
      ): Promise<FoundConsRotation[]> => {
        if (!teamText.trim()) return []
        const targetConsMap: Partial<Record<CharacterKey, number>> = {
          ...baseConsMap,
          [ck]: cons,
        }
        const saved = {
          opener: savedRotMeta.opener,
          timing: savedRotMeta.timing,
          frameData: savedRotMeta.frameData,
        }
        if (mode === 'kqm' && kqmResult) {
          const nextKqm = {
            ...(setup.kqm ?? defaultTeamOptKqm),
            constellations: targetConsMap,
          }
          const searchSetup = kqmRotationSearchSetup(
            database,
            teamId,
            gender,
            names,
            { ...setup, kqm: nextKqm },
            { ...kqmResult, constellations: targetConsMap },
            saved
          )
          const score = rotationScorer(database, searchSetup)
          const funded = Object.fromEntries(
            Object.entries(kqmResult.energyRecharge).map(([k, er]) => [
              k,
              er?.value ?? 0,
            ])
          )
          const { candidates } = await findBestConstellationRotations({
            baseText: teamText,
            names,
            characterKey: ck,
            targetCons: cons,
            baseConstellations: baseConsMap,
            score,
            funded,
            isCancelled,
            onProgress,
          })
          return candidates
        }
        if (invResult) {
          const builds = teamOptResultGear(database, teamId, invResult)
          const gear: Partial<Record<CharacterKey, SimGear>> = {}
          for (const [k, arts] of Object.entries(builds.arts)) {
            const sets: Record<string, number> = {}
            for (const art of arts ?? [])
              sets[art.setKey] = (sets[art.setKey] ?? 0) + 1
            const weapon = builds.weapons[k as CharacterKey]
            gear[k as CharacterKey] = {
              sets,
              weapon: weapon?.key,
              refinement: weapon?.refinement,
            }
          }
          const baseSearchSetup = teamRotationSearchSetup(
            database,
            teamId,
            gender,
            names,
            setup,
            {
              ...builds,
              characters: { [ck]: { constellation: cons } },
              mainStatAssumptionLevel: setup.assumeMaxMain ? 20 : 0,
              bonusStats: teamOptBonusStats(setup, keys),
            },
            gear,
            saved,
            invResult.attackStates
          )
          const searchSetup = {
            ...baseSearchSetup,
            constellations: targetConsMap,
            sim: baseSearchSetup.sim
              ? {
                  ...baseSearchSetup.sim,
                  overrides: {
                    ...baseSearchSetup.sim.overrides,
                    characters: { [ck]: { constellation: cons } },
                  },
                }
              : undefined,
          }
          const score = rotationScorer(database, searchSetup)
          const { candidates } = await findBestConstellationRotations({
            baseText: teamText,
            names,
            characterKey: ck,
            targetCons: cons,
            baseConstellations: baseConsMap,
            score,
            isCancelled,
            onProgress,
          })
          return candidates
        }
        return []
      },
    [
      teamText,
      baseConsMap,
      savedRotMeta,
      mode,
      kqmResult,
      invResult,
      setup,
      database,
      teamId,
      gender,
      names,
      keys,
    ]
  )

  const computeScope = useCallback(
    (
      inc: Set<CharacterKey>,
      withSig: boolean,
      with4: boolean
    ): {
      effective: boolean[]
      maxCons: number[]
      canAddSig: boolean[]
      totalRoom: number
    } => {
      const effective = keys.map((k, i) => {
        if (FREE_FIVE_STARS.has(k)) return false
        const is4 = getCharStat(k).rarity === 4
        if (is4 && !with4) return false
        const hasRoom = baseCons[i] < MAX_CONS || (withSig && sigAvailable[i])
        return hasRoom && inc.has(k)
      })
      const nextMaxCons = keys.map((_, i) =>
        effective[i] ? MAX_CONS : baseCons[i]
      )
      const nextCanAddSig = keys.map(
        (_, i) => effective[i] && withSig && sigAvailable[i]
      )
      const room = keys.reduce(
        (sum, _, i) =>
          sum +
          Math.max(0, nextMaxCons[i] - baseCons[i]) +
          (nextCanAddSig[i] ? 1 : 0),
        0
      )
      return {
        effective,
        maxCons: nextMaxCons,
        canAddSig: nextCanAddSig,
        totalRoom: room,
      }
    },
    [keys, baseCons, sigAvailable]
  )

  const {
    effective: effectiveIncluded,
    maxCons,
    canAddSig,
    totalRoom,
  } = useMemo(
    () => computeScope(included, includeSig, includeFourStars),
    [computeScope, included, includeSig, includeFourStars]
  )

  const targetBudget =
    budgetChoice === 'all' ? totalRoom : Math.min(budgetChoice, totalRoom)

  const activeAutoCount = useMemo(() => {
    if (!autoAdapt) return 0
    let n = 0
    for (let i = 0; i < keys.length; i++) {
      const ck = keys[i]
      const autoMap = autoRotations[ck]
      if (!autoMap) continue
      for (const [cStr, text] of Object.entries(autoMap)) {
        const c = Number(cStr)
        if (!text || c <= baseCons[i]) continue
        const custom = consRotationOf(rotationsOf[ck] ?? {}, c, baseCons[i])
        if (!custom.text && !custom.pinnedBase) n++
      }
    }
    return n
  }, [autoAdapt, keys, autoRotations, baseCons, rotationsOf])

  const customRotationCount = useMemo(
    () =>
      keys.reduce(
        (n, k) =>
          n +
          Object.values(rotationsOf[k] ?? {}).filter(
            (v) => !!v?.trim() && v.trim() !== KEEP_BASE_ROTATION
          ).length,
        0
      ) + combos.filter((c) => c.text.trim()).length,
    [keys, rotationsOf, combos]
  )

  const altRotationCount = customRotationCount + activeAutoCount

  // Hints in scope for included members (used for idle callout and header indicator)
  const inScopeHints = useMemo(() => {
    if (!teamText.trim()) return []
    const out: (ConsRotationHint & {
      hasSuggestions: boolean
      hasCustom: boolean
      isPinned: boolean
      hasAuto: boolean
    })[] = []
    for (let i = 0; i < keys.length; i++) {
      if (!effectiveIncluded[i]) continue
      const ck = keys[i]
      const cap = Math.min(MAX_CONS, baseCons[i] + Math.max(targetBudget, 1))
      for (const hint of memberHintsMap[ck] ?? []) {
        if (hint.cons > cap) continue
        const custom = consRotationOf(
          rotationsOf[ck] ?? {},
          hint.cons,
          baseCons[i]
        )
        const hasSuggs = !!verifiedSuggestions[ck]?.[hint.cons]?.length
        const hasAuto = !!autoRotations[ck]?.[hint.cons]
        out.push({
          ...hint,
          hasSuggestions: hasSuggs,
          hasCustom: !!custom.text,
          isPinned: !!custom.pinnedBase,
          hasAuto,
        })
      }
    }
    return out
  }, [
    teamText,
    keys,
    effectiveIncluded,
    baseCons,
    targetBudget,
    memberHintsMap,
    rotationsOf,
    verifiedSuggestions,
    autoRotations,
  ])

  const hasAutoAdaptableHints = useMemo(
    () =>
      keys.some((ck) =>
        Object.values(verifiedSuggestions[ck] ?? {}).some((s) => !!s?.length)
      ),
    [keys, verifiedSuggestions]
  )

  const pendingHintCount = useMemo(
    () =>
      inScopeHints.filter(
        (h) =>
          !h.hasCustom &&
          !h.isPinned &&
          !(
            autoAdapt &&
            (h.hasAuto || (isAutoAdaptableHint(h) && h.hasSuggestions))
          )
      ).length,
    [inScopeHints, autoAdapt]
  )

  const rotationsKey = useMemo(
    () =>
      JSON.stringify([
        keys.map((k) => rotationsOf[k] ?? {}),
        combos,
        autoAdapt,
      ]),
    [keys, rotationsOf, combos, autoAdapt]
  )
  const configKey = useMemo(
    () =>
      JSON.stringify([
        keys,
        baseCons,
        maxCons,
        canAddSig,
        targetBudget,
        rotationsKey,
      ]),
    [keys, baseCons, maxCons, canAddSig, targetBudget, rotationsKey]
  )

  const [plan, setPlan] = useState<InvestmentPlan | undefined>(
    () => cacheFor(result).last?.plan
  )
  const [planConfigKey, setPlanConfigKey] = useState<string | undefined>(
    () => cacheFor(result).last?.configKey
  )
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<InvestmentPlanProgress>()
  const [error, setError] = useState<string>()
  const [selectedBudget, setSelectedBudget] = useState(1)
  const [shareOpen, setShareOpen] = useState(false)
  const cancelRef = useRef<() => void>(() => {})

  useEffect(() => {
    cancelRef.current()
    setRunning(false)
    setProgress(undefined)
    setError(undefined)
    const store = cacheFor(result)
    setAutoRotations({ ...store.autoRotations })
    const cached = store.last
    setPlan(cached?.plan)
    setPlanConfigKey(cached?.configKey)
    if (cached?.plan) {
      setSelectedBudget((b) =>
        Math.max(1, Math.min(b, cached.plan.maxBudget || 1))
      )
    }
  }, [result])

  useEffect(() => () => cancelRef.current(), [])

  const resolveForState = useCallback(
    (
      state: InvestmentState,
      activeRotations: Partial<Record<CharacterKey, ConsRotationTexts>>,
      activeCombos: readonly ComboRotation[],
      activeAuto: AutoRotationMap,
      useAutoAdapt: boolean
    ) => {
      const consObj = Object.fromEntries(
        keys.map((k, i) => [k, state.cons[i]])
      ) as Partial<Record<CharacterKey, number>>
      const comboText = comboRotationOf(activeCombos, consObj, baseConsMap)
      if (comboText) {
        return {
          text: comboText,
          label: t('teamOpt.invest.comboRotBadge', 'Combo rotation'),
          isAuto: false,
          autoCandidates: undefined as string[] | undefined,
          autoTarget: undefined as
            | { ck: CharacterKey; cons: number }
            | undefined,
        }
      }

      const memberEdits: {
        characterKey: CharacterKey
        text: string
        label: string
        isAuto: boolean
      }[] = []
      let pendingAuto:
        | { ck: CharacterKey; cons: number; candidates: string[] }
        | undefined

      for (let i = 0; i < keys.length; i++) {
        if (state.cons[i] <= baseCons[i]) continue
        const ck = keys[i]
        const custom = consRotationOf(
          activeRotations[ck] ?? {},
          state.cons[i],
          baseCons[i]
        )
        if (custom.text) {
          memberEdits.push({
            characterKey: ck,
            text: custom.text,
            label: t('teamOpt.invest.memberRotBadge', {
              defaultValue: '{{name}} C{{cons}} rot',
              name: charName(ck),
              cons: custom.from ?? state.cons[i],
            }),
            isAuto: false,
          })
          continue
        }
        if (custom.pinnedBase || !useAutoAdapt) continue

        // Reuse already-discovered auto-adapted rotation for `ck` at <= state.cons[i]
        const autoMap = activeAuto[ck]
        let autoFound: { text: string; cons: number } | undefined
        if (autoMap) {
          for (let c = state.cons[i]; c > baseCons[i]; c--) {
            if (autoMap[c]) {
              autoFound = { text: autoMap[c]!, cons: c }
              break
            }
          }
        }
        if (autoFound) {
          memberEdits.push({
            characterKey: ck,
            text: autoFound.text,
            label: t('teamOpt.invest.autoRotBadge', {
              defaultValue: 'Auto {{name}} C{{cons}} rot',
              name: charName(ck),
              cons: autoFound.cons,
            }),
            isAuto: true,
          })
          continue
        }

        // Otherwise provide simulator-verified candidates for deterministic rotation-changing cons
        const ckSuggs = verifiedSuggestions[ck]
        if (ckSuggs) {
          for (let c = state.cons[i]; c > baseCons[i]; c--) {
            const suggs = ckSuggs[c]
            if (suggs?.length) {
              if (!pendingAuto) {
                pendingAuto = {
                  ck,
                  cons: c,
                  candidates: suggs.map((s) => s.text),
                }
              }
              break
            }
          }
        }
      }

      if (memberEdits.length) {
        const merged = mergeMemberRotations(teamText, memberEdits, names)
        if (merged) {
          return {
            text: merged.text,
            label: merged.label,
            isAuto: merged.isAuto,
            autoCandidates: undefined,
            autoTarget: undefined,
          }
        }
      }

      if (pendingAuto) {
        return {
          text: undefined,
          label: undefined,
          isAuto: false,
          autoCandidates: pendingAuto.candidates,
          autoTarget: { ck: pendingAuto.ck, cons: pendingAuto.cons },
        }
      }

      return {
        text: undefined,
        label: undefined,
        isAuto: false,
        autoCandidates: undefined,
        autoTarget: undefined,
      }
    },
    [
      keys,
      baseConsMap,
      baseCons,
      verifiedSuggestions,
      teamText,
      names,
      t,
      charName,
    ]
  )

  const runComparison = async (overrides?: {
    budget?: number
    included?: Set<CharacterKey>
    includeSig?: boolean
    includeFourStars?: boolean
    autoAdapt?: boolean
    rotationsOf?: Partial<Record<CharacterKey, ConsRotationTexts>>
    combos?: ComboRotation[]
  }) => {
    const nextInc = overrides?.included ?? included
    const nextSig = overrides?.includeSig ?? includeSig
    const next4 = overrides?.includeFourStars ?? includeFourStars
    const nextAutoAdapt = overrides?.autoAdapt ?? autoAdapt
    const activeRotations = overrides?.rotationsOf ?? rotationsOf
    const activeCombos = overrides?.combos ?? combos
    const scope = computeScope(nextInc, nextSig, next4)
    const desired =
      overrides?.budget ??
      (budgetChoice === 'all' ? scope.totalRoom : budgetChoice)
    const runBudget = Math.min(desired, scope.totalRoom)
    if (runBudget <= 0 || disabled) return
    cancelRef.current()
    let cancelled = false
    cancelRef.current = () => {
      cancelled = true
    }
    setRunning(true)
    setError(undefined)
    setProgress(undefined)

    const store = cacheFor(result)
    const runAutoRotations: AutoRotationMap = {}
    if (nextAutoAdapt) {
      for (const [k, map] of Object.entries(store.autoRotations)) {
        if (map) runAutoRotations[k as CharacterKey] = { ...map }
      }
    }

    const modeTagOf = (res: ReturnType<typeof resolveForState>) =>
      res.text
        ? `rot:${res.text}`
        : res.autoCandidates?.length
          ? `auto:${res.autoCandidates.join('\0')}`
          : 'base'

    const stateCache = new Map<string, InvestmentEval>()
    for (const [compoundKey, ev] of store.evals) {
      const sep = compoundKey.indexOf('::')
      if (sep < 0) continue
      const sKey = compoundKey.slice(0, sep)
      const rTag = compoundKey.slice(sep + 2)
      const [cStr, sigStr] = sKey.split('|')
      if (!cStr || !sigStr) continue
      const cons = cStr.split(',').map(Number)
      const sig = [...sigStr].map((ch) => ch === '1')
      if (cons.length !== keys.length || sig.length !== keys.length) continue
      const expected = modeTagOf(
        resolveForState(
          { cons, sig },
          activeRotations,
          activeCombos,
          runAutoRotations,
          nextAutoAdapt
        )
      )
      if (rTag === expected) stateCache.set(sKey, ev)
    }

    const invRotMeta =
      mode === 'inventory'
        ? (teamRunRotation(database, gender, i18n, teamId) ?? {
            text: '',
            opener: '',
            timing: { edits: {} },
            frameData: {},
            names,
          })
        : undefined

    try {
      const nextPlan = await planInvestments({
        baseCons,
        maxCons: scope.maxCons,
        canAddSig: scope.canAddSig,
        baseDps,
        baseSeconds,
        basePoint,
        maxBudget: runBudget,
        topK: 5,
        margin: 0.015,
        most: mode === 'inventory' ? 12 : 6,
        concurrency: kqmInvestmentConcurrency(),
        cache: stateCache,
        isCancelled: () => cancelled,
        onProgress: (p) => {
          if (!cancelled) startTransition(() => setProgress(p))
        },
        onPartial: (partial) => {
          if (cancelled) return
          startTransition(() => {
            setAutoRotations({ ...store.autoRotations })
            setPlan((prev) => {
              if (!prev || partial.maxBudget >= prev.maxBudget) {
                setSelectedBudget((b) =>
                  Math.max(1, Math.min(b, partial.maxBudget))
                )
                return partial
              }
              return prev
            })
          })
        },
        evaluate: async (state) => {
          const res = resolveForState(
            state,
            activeRotations,
            activeCombos,
            runAutoRotations,
            nextAutoAdapt
          )
          const compoundKey = `${investmentStateKey(state)}::${modeTagOf(res)}`
          const hit = store.evals.get(compoundKey)
          if (hit) return hit

          const consOverrides: Partial<Record<CharacterKey, number>> = {}
          const sigOverrides: Partial<Record<CharacterKey, number>> = {}
          const startBuilds: Partial<Record<CharacterKey, KqmBuild>> = {}

          for (let i = 0; i < keys.length; i++) {
            const ck = keys[i]
            if (state.cons[i] > baseCons[i]) {
              consOverrides[ck] = state.cons[i]
              const singleState: InvestmentState = {
                cons: baseCons.map((b, j) => (j === i ? state.cons[i] : b)),
                sig: keys.map(() => false),
              }
              const sRes = resolveForState(
                singleState,
                activeRotations,
                activeCombos,
                runAutoRotations,
                nextAutoAdapt
              )
              const sBuild = store.evals.get(
                `${investmentStateKey(singleState)}::${modeTagOf(sRes)}`
              )?.point?.builds[ck]
              if (sBuild) startBuilds[ck] = sBuild
            }
            if (state.sig[i]) sigOverrides[ck] = 1
          }

          let point: ConsPoint | undefined
          if (mode === 'kqm' && kqmResult) {
            point = await refitConstellations({
              database,
              teamId,
              gender,
              i18n,
              setup,
              result: kqmResult,
              cons: consOverrides,
              signatures: Object.keys(sigOverrides).length
                ? sigOverrides
                : undefined,
              start: startBuilds,
              text: res.text,
              autoCandidates: res.autoCandidates,
              summaryOnly: true,
              isCancelled: () => cancelled,
            })
          } else if (invResult) {
            point = await evaluateInventoryInvestment({
              database,
              teamId,
              gender,
              members,
              teamOpt: setup,
              result: invResult,
              cons: consOverrides,
              signatures: Object.keys(sigOverrides).length
                ? sigOverrides
                : undefined,
              text: res.text,
              autoCandidates: res.autoCandidates,
              rotation: invRotMeta,
              isCancelled: () => cancelled,
            })
          }

          if (!point || cancelled) return undefined
          let finalLabel = res.label
          let finalAuto = res.isAuto
          let finalText = res.text
          if (point.autoRotation && res.autoTarget) {
            const { ck, cons: targetC } = res.autoTarget
            runAutoRotations[ck] = {
              ...(runAutoRotations[ck] ?? {}),
              [targetC]: point.autoRotation,
            }
            store.autoRotations[ck] = {
              ...(store.autoRotations[ck] ?? {}),
              [targetC]: point.autoRotation,
            }
            finalText = point.autoRotation
            finalAuto = true
            finalLabel = t('teamOpt.invest.autoRotBadge', {
              defaultValue: 'Auto {{name}} C{{cons}} rot',
              name: charName(ck),
              cons: targetC,
            })
          }
          const ev: InvestmentEval = {
            dps: dpsOf(point),
            seconds: point.seconds,
            rotationLabel: finalLabel,
            autoAdapted: finalAuto,
            rotationText: finalText,
            unmet: point.unmet,
            point,
          }
          store.evals.set(compoundKey, ev)
          if (point.autoRotation) {
            store.evals.set(
              `${investmentStateKey(state)}::rot:${point.autoRotation}`,
              ev
            )
          }
          return ev
        },
      })

      if (cancelled || !nextPlan) return
      const activeRotationsKey = JSON.stringify([
        keys.map((k) => activeRotations[k] ?? {}),
        activeCombos,
        nextAutoAdapt,
      ])
      const runConfigKey = JSON.stringify([
        keys,
        baseCons,
        scope.maxCons,
        scope.canAddSig,
        runBudget,
        activeRotationsKey,
      ])
      store.last = { plan: nextPlan, configKey: runConfigKey }
      setAutoRotations({ ...store.autoRotations })
      setPlan(nextPlan)
      setPlanConfigKey(runConfigKey)
      setSelectedBudget(runBudget)
      setProgress(undefined)
    } catch (e) {
      if (cancelled || e instanceof TeamOptCancelled) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (!cancelled) {
        setRunning(false)
        setProgress(undefined)
      }
    }
  }

  const sameNonBudgetConfig = useMemo(() => {
    if (!plan || !planConfigKey) return false
    try {
      const prev = JSON.parse(planConfigKey) as unknown[]
      const curr = JSON.parse(configKey) as unknown[]
      return (
        JSON.stringify(prev.slice(0, 4)) === JSON.stringify(curr.slice(0, 4)) &&
        prev[5] === curr[5]
      )
    } catch {
      return false
    }
  }, [plan, planConfigKey, configKey])

  // One-click budget handler: instant switch if already computed, or extends in place!
  const pickBudget = (choice: number | 'all') => {
    setBudgetChoice(choice)
    const numeric = choice === 'all' ? totalRoom : Math.min(choice, totalRoom)
    if (!plan) return
    if (sameNonBudgetConfig && numeric <= plan.maxBudget) {
      setSelectedBudget(Math.max(1, numeric))
    } else if (!running && numeric > 0) {
      void runComparison({ budget: numeric })
    }
  }

  // Smooth multi-checkbox editing inside Options popover: applies once when closed!
  const closeOptions = () => {
    setOptionsAnchor(null)
    if (optionsDirtyRef.current) {
      optionsDirtyRef.current = false
      if (totalRoom <= 0) {
        setPlan(undefined)
        setPlanConfigKey(undefined)
        return
      }
      if (plan && !running) void runComparison()
    }
  }

  const toggleMember = (ck: CharacterKey) => {
    optionsDirtyRef.current = true
    const is4 = getCharStat(ck).rarity === 4
    let next4 = includeFourStars
    const nextInc = new Set(included)
    if (is4 && !includeFourStars) {
      next4 = true
      nextInc.add(ck)
    } else if (nextInc.has(ck)) {
      nextInc.delete(ck)
    } else {
      nextInc.add(ck)
    }
    setIncludeFourStars(next4)
    setIncluded(nextInc)
  }

  const toggleSig = () => {
    optionsDirtyRef.current = true
    setIncludeSig((v) => !v)
  }

  const toggleAutoAdapt = () => {
    optionsDirtyRef.current = true
    setAutoAdapt((v) => !v)
  }

  const toggleFourStars = () => {
    optionsDirtyRef.current = true
    const next4 = !includeFourStars
    const nextInc = new Set(included)
    if (next4) {
      keys.forEach((k, i) => {
        if (getCharStat(k).rarity === 4 && baseCons[i] < MAX_CONS)
          nextInc.add(k)
      })
    }
    setIncludeFourStars(next4)
    setIncluded(nextInc)
  }

  const rotationsChanged = !!plan && !sameNonBudgetConfig

  const activeBudget = plan
    ? Math.max(1, Math.min(selectedBudget, plan.maxBudget || 1))
    : 1
  const activePaths = plan?.byBudget[activeBudget] ?? []
  const bestAtBudget = activePaths[0]
  const unitLabel = baseSeconds
    ? t('teamOpt.kqm.dpsUnit', 'DPS')
    : t('teamOpt.kqm.dmgUnit', 'DMG')

  const customOptionsCount =
    (!includeSig && sigAvailable.some(Boolean) ? 1 : 0) +
    (!autoAdapt && hasAutoAdaptableHints ? 1 : 0) +
    (includeFourStars && hasAnyFourStarRoom ? 1 : 0) +
    keys.filter((k) => defaultIncluded.has(k) !== included.has(k)).length

  // Best single +1 pull upgrade (to subtly highlight on the per-member strip)
  const bestSingleId = useMemo(() => {
    const top1 = plan?.byBudget[1]?.[0]
    if (!top1) return undefined
    for (let i = 0; i < keys.length; i++) {
      if (top1.sig[i]) return `${keys[i]}:sig`
      if (top1.cons[i] > baseCons[i]) return `${keys[i]}:c${top1.cons[i]}`
    }
    return undefined
  }, [plan, keys, baseCons])

  // Share PNG chart data (KQM mode)
  const shareChartData = useMemo((): InvestmentChartData | undefined => {
    if (mode !== 'kqm' || !plan || !kqmResult) return undefined
    const baseCost = keys.reduce((n, k, i) => n + copiesOf(k, baseCons[i]), 0)
    const talents = kqmTalentLevel(setup.kqm)
    const standard = t('page_team:teamOpt.kqm.share.standardTalents', {
      defaultValue: '{{standard}} · Talents {{talents}}',
      standard: kqmStandardText(t as never, setup.kqm, keys),
      talents: `${talents}/${talents}/${talents}`,
    })
    const beta = betaOf(
      keys.flatMap((k) => {
        const b = kqmResult.builds[k]
        return [
          k,
          ...(b ? [b.weapon.key, ...Object.keys(b.sets)] : []),
          ...(signatureWeapons[k] ? [signatureWeapons[k]!] : []),
        ]
      })
    )
    return {
      title: t(
        'page_team:teamOpt.invest.chartTitle',
        'Team investment comparison'
      ),
      subtitle: t('page_team:teamOpt.kqm.share.investSubtitle', {
        defaultValue: 'The best team DPS at each cost · {{standard}}',
        standard,
      }),
      members: keys.map((k) => ({
        ...kqmCardFace(k, gender),
        name: charName(k),
      })),
      rows: plan.bestByCost.map((row) => ({
        cost: baseCost + row.cost,
        cons: row.cons,
        sig: row.sig,
        value: row.dps,
        detail: formatRateFull(row.dps, undefined),
      })),
      beta: beta.length ? BETA_LABEL : undefined,
      labels: {
        cost: t('page_team:teamOpt.kqm.share.investCost', 'Cost'),
        dps: baseSeconds
          ? t('page_team:teamOpt.kqm.share.teamDps', 'Team DPS')
          : t('page_team:teamOpt.kqm.share.teamDmg', 'Team damage'),
        note: t(
          'page_team:teamOpt.invest.chartNote',
          'Cost counts 5★ pulls: base 5★ copies + 1 per extra constellation or R1 signature.'
        ),
        siteName: shareStamp(),
      },
    }
  }, [
    mode,
    plan,
    kqmResult,
    keys,
    baseCons,
    setup,
    gender,
    baseSeconds,
    t,
    charName,
  ])

  const shareRender = useMemo(
    () =>
      shareChartData ? () => renderInvestmentChart(shareChartData) : undefined,
    [shareChartData]
  )

  if (!keys.length) return null

  const progressText = (() => {
    if (!progress) return t('teamOpt.invest.starting', 'Preparing comparison…')
    if (progress.phase === 'singles' && progress.memberIndex !== undefined) {
      const ck = keys[progress.memberIndex]
      const what = progress.isSig ? 'R1' : `C${progress.targetCons}`
      return t('teamOpt.invest.progressSingle', {
        defaultValue: 'Evaluating {{name}} {{what}} ({{done}} of {{total}})',
        name: charName(ck),
        what,
        done: Math.min(progress.done + 1, progress.total),
        total: progress.total,
      })
    }
    return t('teamOpt.invest.progressPaths', {
      defaultValue: 'Ranking +{{cost}} pull paths ({{cost}} of {{max}})',
      cost: progress.cost ?? 1,
      max: progress.maxBudget ?? targetBudget,
    })
  })()

  const progressPct = progress
    ? progress.phase === 'singles'
      ? (progress.done / Math.max(1, progress.total)) * 55
      : 55 + ((progress.done + 0.5) / Math.max(1, progress.total)) * 45
    : 6

  /** Reusable Pull Budget segmented selector */
  const budgetSelector = totalRoom > 0 && (
    <Box
      role="group"
      aria-label={t('teamOpt.invest.budgetLabel', 'Pull budget')}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        p: '2px',
        borderRadius: tokens.radius.control,
        bgcolor: tokens.inset,
        border: hairline,
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize: 11.5,
          fontWeight: 600,
          color: 'text.secondary',
          px: 1,
          display: { xs: 'none', sm: 'inline' },
        }}
      >
        {t('teamOpt.invest.pullsLabel', 'Pulls')}
      </Typography>
      {BUDGET_PRESETS.filter((b) => b <= Math.max(1, totalRoom)).map((b) => {
        const active = plan
          ? activeBudget === b && sameNonBudgetConfig
          : budgetChoice === b
        return (
          <ButtonBase
            key={b}
            disabled={running}
            onClick={() => pickBudget(b)}
            sx={{
              minWidth: 32,
              height: 28,
              px: 0.875,
              borderRadius: 1,
              fontSize: 12.5,
              fontWeight: active ? 700 : 550,
              ...numSx,
              ...quickSx,
              ...focusSx,
              color: active ? giTokens.goldLight : 'text.secondary',
              bgcolor: active ? alpha(tokens.gold, 0.18) : 'transparent',
              '&:hover': {
                color: active ? giTokens.goldLight : 'text.primary',
                bgcolor: active
                  ? alpha(tokens.gold, 0.22)
                  : alpha(giTokens.parchment, 0.06),
              },
            }}
          >
            +{b}
          </ButtonBase>
        )
      })}
      {totalRoom > 6 &&
        (() => {
          const allActive = plan
            ? activeBudget === totalRoom && sameNonBudgetConfig
            : budgetChoice === 'all'
          return (
            <ButtonBase
              disabled={running}
              onClick={() => pickBudget('all')}
              sx={{
                height: 28,
                px: 1,
                borderRadius: 1,
                fontSize: 12.5,
                fontWeight: allActive ? 700 : 550,
                ...numSx,
                ...quickSx,
                ...focusSx,
                color: allActive ? giTokens.goldLight : 'text.secondary',
                bgcolor: allActive ? alpha(tokens.gold, 0.18) : 'transparent',
                '&:hover': {
                  color: allActive ? giTokens.goldLight : 'text.primary',
                  bgcolor: allActive
                    ? alpha(tokens.gold, 0.22)
                    : alpha(giTokens.parchment, 0.06),
                },
              }}
            >
              {t('teamOpt.invest.allShort', 'All')}
            </ButtonBase>
          )
        })()}
    </Box>
  )

  /** Clean inline upgrade description (unmistakable `C0→C2` / `R1` typography) */
  const renderUpgradeLine = (
    path: Pick<InvestmentPath, 'cons' | 'sig'>,
    highlight = false,
    showFrom = true
  ) => {
    const items: {
      key: string
      ck: CharacterKey
      fromC: number
      toC: number
      addedSig: boolean
    }[] = []
    for (let i = 0; i < keys.length; i++) {
      if (path.cons[i] > baseCons[i] || path.sig[i]) {
        items.push({
          key: `${keys[i]}-${path.cons[i]}-${path.sig[i]}`,
          ck: keys[i],
          fromC: baseCons[i],
          toC: path.cons[i],
          addedSig: path.sig[i],
        })
      }
    }
    if (!items.length) {
      return (
        <Typography sx={type.label}>
          {t('teamOpt.invest.baselineLabel', 'Current team')}
        </Typography>
      )
    }
    return (
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 1.125,
          rowGap: 0.375,
        }}
      >
        {items.map(({ key, ck, fromC, toC, addedSig }, idx) => {
          const sigKey = addedSig ? signatureWeapons[ck] : undefined
          return (
            <Fragment key={key}>
              {idx > 0 && (
                <Typography
                  component="span"
                  aria-hidden
                  sx={{ color: 'text.disabled', fontSize: 13 }}
                >
                  +
                </Typography>
              )}
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.625,
                }}
              >
                <MemberAvatar characterKey={ck} size={22} />
                <Typography
                  component="span"
                  sx={{
                    fontSize: 14,
                    fontWeight: highlight ? 650 : 550,
                    color: 'text.primary',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <CharacterName characterKey={ck} gender={gender} />
                </Typography>
                {toC > fromC && (
                  <Typography
                    component="span"
                    sx={{
                      fontSize: 13.5,
                      fontWeight: 700,
                      color: tokens.gold,
                      whiteSpace: 'nowrap',
                      ...numSx,
                    }}
                  >
                    {showFrom && (
                      <Box
                        component="span"
                        sx={{
                          fontWeight: 500,
                          fontSize: 12,
                          color: 'text.secondary',
                          mr: 0.125,
                        }}
                      >
                        C{fromC}→
                      </Box>
                    )}
                    C{toC}
                  </Typography>
                )}
                {addedSig && sigKey && (
                  <Tooltip arrow title={<WeaponName weaponKey={sigKey} />}>
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.375,
                        fontSize: 13.5,
                        fontWeight: 700,
                        color: giTokens.goldLight,
                        ...numSx,
                      }}
                    >
                      <Box
                        component="img"
                        src={weaponAsset(sigKey, true)}
                        alt=""
                        aria-hidden
                        sx={{ width: 17, height: 17, objectFit: 'contain' }}
                      />
                      R1
                    </Box>
                  </Tooltip>
                )}
              </Box>
            </Fragment>
          )
        })}
      </Box>
    )
  }

  const evaluatedMembers = plan
    ? keys
        .map((ck, i) => ({
          ck,
          index: i,
          sigEv: plan.singles.sig[i],
          consMap: plan.singles.cons[i] ?? {},
        }))
        .filter((m) => !!m.sigEv || Object.keys(m.consMap).length > 0)
    : []

  const bestGain = Math.max(bestAtBudget?.gainPct ?? 0, 0.001)

  const quietActionSx = {
    minHeight: 32,
    px: 1.25,
    borderRadius: tokens.radius.control,
    textTransform: 'none' as const,
    fontSize: 13,
    fontWeight: 550,
    color: 'text.secondary',
    ...quickSx,
    '&:hover': {
      color: 'text.primary',
      bgcolor: alpha(giTokens.parchment, 0.06),
    },
  }

  return (
    <Panel id={anchorId} sx={{ scrollMarginTop: 88, position: 'relative' }}>
      {/* ── Single clean Header Bar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 1.25,
          pb: 1.75,
          borderBottom: hairline,
        }}
      >
        <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography component="h2" sx={type.section}>
              {t('teamOpt.invest.title', 'Investment comparison')}
            </Typography>
            <InfoTooltipInline
              title={
                mode === 'kqm'
                  ? t(
                      'teamOpt.invest.tipKqm',
                      'Compare extra 5★ pulls (constellations and R1 signature weapons) from your current baseline. Upgraded members’ KQM stats, ER, and rotations are refitted automatically.'
                    )
                  : t(
                      'teamOpt.invest.tipInv',
                      'Compare extra 5★ pulls (constellations and R1 signature weapons) using this run’s artifacts. Written and conditional rotations replay automatically.'
                    )
              }
            />
          </Box>
          <Typography sx={{ ...type.label, mt: 0.25, ...numSx }}>
            {t('teamOpt.invest.subtitleClean', {
              defaultValue: 'From {{dps}} {{unit}} ({{setup}})',
              dps: formatRateFull(baseDps, undefined),
              unit: unitLabel,
              setup: keys
                .map((k, i) => `C${baseCons[i]} ${charName(k)}`)
                .join(' · '),
            })}
          </Typography>
        </Box>

        {/* Header controls (Pulls pill moves into header once results exist) */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 0.75,
            ml: 'auto',
          }}
        >
          {(plan || running) && budgetSelector}

          <Button
            size="small"
            color="inherit"
            disabled={running}
            startIcon={<TuneRoundedIcon sx={{ fontSize: 17 }} />}
            onClick={(e) => {
              optionsDirtyRef.current = false
              setOptionsAnchor(e.currentTarget)
            }}
            sx={{
              ...quietActionSx,
              ...(customOptionsCount > 0 && { color: giTokens.goldLight }),
            }}
          >
            {t('teamOpt.invest.options', 'Options')}
            {customOptionsCount > 0 && ` (${customOptionsCount})`}
          </Button>

          <Tooltip
            arrow
            describeChild
            title={t(
              'teamOpt.invest.consRotationsTip',
              'Customize or auto-adapt rotations for constellations that add extra skill casts or change combos'
            )}
          >
            <Button
              size="small"
              color="inherit"
              startIcon={<EditNoteRoundedIcon sx={{ fontSize: 18 }} />}
              onClick={() => setRotationsOpen((o) => !o)}
              sx={{
                ...quietActionSx,
                ...((rotationsOpen || altRotationCount > 0) && {
                  color: giTokens.goldLight,
                  bgcolor: rotationsOpen ? alpha(tokens.gold, 0.1) : undefined,
                }),
              }}
            >
              {altRotationCount > 0
                ? t('teamOpt.invest.consRotationsCount', {
                    defaultValue: 'Cons rotations ({{count}})',
                    count: altRotationCount,
                  })
                : t('teamOpt.invest.consRotations', 'Cons rotations')}
              {altRotationCount === 0 && pendingHintCount > 0 && (
                <Box
                  component="span"
                  aria-hidden
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: 'warning.main',
                    ml: 0.75,
                    flexShrink: 0,
                  }}
                />
              )}
            </Button>
          </Tooltip>

          {mode === 'kqm' && plan && shareRender && !running && (
            <Tooltip
              arrow
              title={t('teamOpt.invest.sharePng', 'Share investment chart')}
            >
              <Button
                size="small"
                color="inherit"
                startIcon={<IosShareRoundedIcon sx={{ fontSize: 16 }} />}
                onClick={() => setShareOpen(true)}
                sx={quietActionSx}
              >
                {t('teamOpt.kqm.share.button', 'Share')}
              </Button>
            </Tooltip>
          )}

          {running ? (
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<StopRoundedIcon sx={{ fontSize: 17 }} />}
              onClick={() => {
                cancelRef.current()
                setRunning(false)
                setProgress(undefined)
              }}
              sx={{
                minHeight: 32,
                px: 1.5,
                borderRadius: tokens.radius.control,
                textTransform: 'none',
                fontWeight: 600,
                fontSize: 13,
                borderColor: tokens.hairlineStrong,
              }}
            >
              {t('teamOpt.invest.stop', 'Stop')}
            </Button>
          ) : (
            plan &&
            rotationsChanged && (
              <Button
                size="small"
                variant="contained"
                disabled={disabled || totalRoom === 0}
                startIcon={<PlayArrowRoundedIcon sx={{ fontSize: 18 }} />}
                onClick={() => void runComparison()}
                sx={{
                  ...giCtaSx,
                  minHeight: 32,
                  px: 1.75,
                  fontSize: 13,
                  borderRadius: tokens.radius.control,
                }}
              >
                {t('teamOpt.invest.update', 'Update')}
              </Button>
            )
          )}
        </Box>
      </Box>

      {/* ── Options Popover (smooth multi-toggle, applies once on close) */}
      <Popover
        open={!!optionsAnchor}
        anchorEl={optionsAnchor}
        onClose={closeOptions}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75,
              p: 2,
              width: 284,
              borderRadius: tokens.radius.inset,
              bgcolor: tokens.raised,
              border: `1px solid ${tokens.hairlineStrong}`,
              boxShadow: '0 14px 36px rgba(0, 0, 0, 0.5)',
            },
          },
        }}
      >
        <Typography sx={{ ...type.title, fontSize: 13.5, mb: 1 }}>
          {t('teamOpt.invest.includeUpgrades', 'Include in comparison')}
        </Typography>
        <Box sx={{ display: 'grid', gap: 0.25 }}>
          {sigAvailable.some(Boolean) && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={includeSig}
                  onChange={toggleSig}
                />
              }
              label={
                <Typography sx={{ fontSize: 13 }}>
                  {t('teamOpt.invest.includeSig', 'R1 signatures (+1 pull)')}
                </Typography>
              }
              sx={{ m: 0 }}
            />
          )}
          {hasAnyFourStarRoom && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={includeFourStars}
                  onChange={toggleFourStars}
                />
              }
              label={
                <Typography sx={{ fontSize: 13 }}>
                  {t('teamOpt.invest.include4Star', '4★ constellations')}
                </Typography>
              }
              sx={{ m: 0 }}
            />
          )}
          {!!teamText.trim() && (
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={autoAdapt}
                  onChange={toggleAutoAdapt}
                />
              }
              label={
                <Box>
                  <Typography sx={{ fontSize: 13, lineHeight: 1.25 }}>
                    {t(
                      'teamOpt.invest.autoAdaptCons',
                      'Auto-adapt cons rotations'
                    )}
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                    {t(
                      'teamOpt.invest.autoAdaptConsDesc',
                      'Test extra skill/beam casts for cons like C1 +E'
                    )}
                  </Typography>
                </Box>
              }
              sx={{
                m: 0,
                alignItems: 'flex-start',
                '& .MuiCheckbox-root': { pt: 0.375 },
              }}
            />
          )}
        </Box>
        {(sigAvailable.some(Boolean) ||
          hasAnyFourStarRoom ||
          !!teamText.trim()) && (
          <Divider sx={{ my: 1.25, borderColor: tokens.hairline }} />
        )}
        <Typography sx={{ ...type.title, fontSize: 13.5, mb: 0.75 }}>
          {t('teamOpt.invest.membersPool', 'Members to pull for')}
        </Typography>
        <Box sx={{ display: 'grid', gap: 0.25 }}>
          {keys.map((ck, i) => {
            const free = FREE_FIVE_STARS.has(ck)
            const maxed =
              baseCons[i] >= MAX_CONS && !(includeSig && sigAvailable[i])
            const on = effectiveIncluded[i]
            return (
              <FormControlLabel
                key={ck}
                disabled={free || maxed}
                control={
                  <Checkbox
                    size="small"
                    checked={on}
                    onChange={() => toggleMember(ck)}
                  />
                }
                label={
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      fontSize: 13,
                    }}
                  >
                    <MemberAvatar characterKey={ck} size={20} />
                    <span>{charName(ck)}</span>
                    <Typography
                      component="span"
                      sx={{ ...type.label, fontSize: 11.5, ...numSx }}
                    >
                      C{baseCons[i]}
                      {maxed ? ` · ${t('teamOpt.invest.maxed', 'Maxed')}` : ''}
                    </Typography>
                  </Box>
                }
                sx={{ m: 0 }}
              />
            )
          })}
        </Box>
        {plan && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
            <Button
              size="small"
              variant="contained"
              onClick={closeOptions}
              sx={{ ...giCtaSx, textTransform: 'none', fontSize: 12.5 }}
            >
              {t('teamOpt.invest.done', 'Done')}
            </Button>
          </Box>
        )}
      </Popover>

      {/* ── Collapsible Conditional Alternative Rotations Editor */}
      <Collapse in={rotationsOpen} unmountOnExit>
        <Box
          ref={rotEditorRef}
          sx={{
            mt: 1.75,
            p: { xs: 1.5, sm: 2 },
            borderRadius: tokens.radius.inset,
            border: `1px solid ${alpha(tokens.gold, 0.28)}`,
            bgcolor: alpha(tokens.inset, 0.85),
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 1.5,
              flexWrap: 'wrap',
              mb: 1.5,
            }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ ...type.title, fontSize: 14.5 }}>
                {t(
                  'teamOpt.invest.altRotTitle',
                  'Conditional rotations for unlocked constellations'
                )}
              </Typography>
              <Typography sx={{ ...type.label, mt: 0.25, maxWidth: 680 }}>
                {t(
                  'teamOpt.invest.altRotDesc2',
                  'Extra skill charges and condensed beams auto-adapt during comparison. For custom or complex combo constellations, click any row below to edit or run Auto-find — higher constellations inherit it automatically.'
                )}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {plan && rotationsChanged && !running && (
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => {
                    setRotationsOpen(false)
                    void runComparison()
                  }}
                  sx={{ ...giCtaSx, textTransform: 'none', fontSize: 12.5 }}
                >
                  {t('teamOpt.invest.applyCompare', 'Apply & compare')}
                </Button>
              )}
              <Button
                size="small"
                color="inherit"
                onClick={() => setRotationsOpen(false)}
                sx={{ textTransform: 'none', color: 'text.secondary' }}
              >
                {t('teamOpt.invest.done', 'Done')}
              </Button>
            </Box>
          </Box>

          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              flexWrap: 'wrap',
              mb: 1.25,
            }}
          >
            {keys.map((k, idx) => {
              const customCnt = Object.values(rotationsOf[k] ?? {}).filter(
                (v) => !!v?.trim() && v.trim() !== KEEP_BASE_ROTATION
              ).length
              const autoCnt = autoAdapt
                ? Object.entries(autoRotations[k] ?? {}).filter(([cStr, v]) => {
                    const c = Number(cStr)
                    if (!v || c <= baseCons[idx]) return false
                    const cur = consRotationOf(
                      rotationsOf[k] ?? {},
                      c,
                      baseCons[idx]
                    )
                    return !cur.text && !cur.pinnedBase
                  }).length
                : 0
              const count = customCnt + autoCnt
              const hasPendingHint =
                !!teamText.trim() &&
                (memberHintsMap[k] ?? []).some((h) => {
                  const cur = consRotationOf(
                    rotationsOf[k] ?? {},
                    h.cons,
                    baseCons[idx]
                  )
                  if (cur.text || cur.pinnedBase) return false
                  if (
                    autoAdapt &&
                    (autoRotations[k]?.[h.cons] ||
                      (isAutoAdaptableHint(h) &&
                        !!verifiedSuggestions[k]?.[h.cons]?.length))
                  )
                    return false
                  return true
                })
              const active = activeRotTab === k
              return (
                <ButtonBase
                  key={k}
                  onClick={() => setRotTab(k)}
                  sx={{
                    height: 30,
                    pl: 0.625,
                    pr: 1.25,
                    gap: 0.625,
                    borderRadius: 999,
                    fontSize: 12.5,
                    fontWeight: active ? 650 : 550,
                    color: active ? giTokens.goldLight : 'text.secondary',
                    bgcolor: active
                      ? alpha(tokens.gold, 0.14)
                      : alpha(giTokens.parchment, 0.04),
                    border: `1px solid ${active ? alpha(tokens.gold, 0.45) : tokens.hairline}`,
                    ...quickSx,
                    ...focusSx,
                  }}
                >
                  <MemberAvatar characterKey={k} size={20} />
                  <span>{charName(k)}</span>
                  {count > 0 ? (
                    <Box
                      component="span"
                      sx={{
                        px: 0.5,
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        bgcolor: alpha(tokens.gold, 0.2),
                        color: tokens.gold,
                        ...numSx,
                      }}
                    >
                      {count}
                    </Box>
                  ) : (
                    hasPendingHint && (
                      <Box
                        component="span"
                        aria-hidden
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          bgcolor: 'warning.main',
                        }}
                      />
                    )
                  )}
                </ButtonBase>
              )
            })}
            <ButtonBase
              onClick={() => setRotTab('combos')}
              sx={{
                height: 30,
                px: 1.25,
                gap: 0.625,
                borderRadius: 999,
                fontSize: 12.5,
                fontWeight: activeRotTab === 'combos' ? 650 : 550,
                color:
                  activeRotTab === 'combos'
                    ? giTokens.goldLight
                    : 'text.secondary',
                bgcolor:
                  activeRotTab === 'combos'
                    ? alpha(tokens.gold, 0.14)
                    : alpha(giTokens.parchment, 0.04),
                border: `1px solid ${activeRotTab === 'combos' ? alpha(tokens.gold, 0.45) : tokens.hairline}`,
                ...quickSx,
                ...focusSx,
              }}
            >
              <span>
                {t('teamOpt.invest.combosTab', 'Multi-member combinations')}
              </span>
              {combos.length > 0 && (
                <Box
                  component="span"
                  sx={{
                    px: 0.5,
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    bgcolor: alpha(tokens.gold, 0.2),
                    color: tokens.gold,
                    ...numSx,
                  }}
                >
                  {combos.length}
                </Box>
              )}
            </ButtonBase>
          </Box>

          {activeRotTab === 'combos' ? (
            <ComboRotations
              keys={keys}
              base={baseConsMap}
              combos={combos}
              teamText={teamText}
              names={names}
              onChange={setCombos}
            />
          ) : (
            <ConsRotations
              characterKey={activeRotTab}
              ran={baseConsMap[activeRotTab] ?? 0}
              rotations={rotationsOf[activeRotTab] ?? {}}
              autoRotations={
                autoAdapt ? autoRotations[activeRotTab] : undefined
              }
              suggestionsOf={(c) =>
                verifiedSuggestions[activeRotTab]?.[c] ?? []
              }
              previewSim={previewSimFor(activeRotTab)}
              onFindBest={
                teamText.trim() ? findBestFor(activeRotTab) : undefined
              }
              focusCons={
                focusCons && focusCons.ck === activeRotTab
                  ? { cons: focusCons.cons, seq: focusCons.seq }
                  : undefined
              }
              teamText={teamText}
              names={names}
              gender={gender}
              aboveOnly
              onChange={(next) => setRotations(activeRotTab, next)}
              onSaveAndRun={
                plan && !running
                  ? (next) => {
                      const nextAll = { ...rotationsOf, [activeRotTab]: next }
                      setRotations(activeRotTab, next)
                      setRotationsOpen(false)
                      void runComparison({ rotationsOf: nextAll })
                    }
                  : undefined
              }
            />
          )}
        </Box>
      </Collapse>

      {/* ── Error state */}
      {error && (
        <Typography color="error" role="alert" sx={{ mt: 1.5, fontSize: 13 }}>
          {error}
        </Typography>
      )}

      {/* ── Sleek live progress bar (non-blocking: keeps existing or streaming results visible!) */}
      {running && (
        <Box
          role="status"
          aria-live="polite"
          sx={{ mt: 1.5, display: 'grid', gap: 0.75 }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Typography
              sx={{ fontSize: 13, fontWeight: 550, color: giTokens.goldLight }}
            >
              {progressText}
            </Typography>
            <Typography sx={{ ...type.label, ...numSx }}>
              {Math.round(progressPct)}%
            </Typography>
          </Box>
          <LinearProgress
            variant="determinate"
            value={progressPct}
            sx={{
              height: 3,
              borderRadius: 2,
              bgcolor: alpha(tokens.gold, 0.14),
              '& .MuiLinearProgress-bar': {
                bgcolor: tokens.gold,
                borderRadius: 2,
              },
            }}
          />
        </Box>
      )}

      {/* ── Initial skeleton during first run before first partial wave arrives */}
      {running && !plan && (
        <Box sx={{ mt: 2, display: 'grid', gap: 1 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={i}
              variant="rounded"
              height={46}
              sx={{
                borderRadius: tokens.radius.control,
                bgcolor: alpha(giTokens.parchment, 0.05),
              }}
            />
          ))}
        </Box>
      )}

      {/* ── Modern Inviting Idle Card (before first comparison) */}
      {!running && !plan && (
        <Box
          sx={{
            ...insetSx,
            borderColor: tokens.hairlineStrong,
            mt: 1.75,
            px: { xs: 2, sm: 2.5 },
            py: 2,
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            alignItems: { xs: 'flex-start', md: 'center' },
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
              <TrendingUpRoundedIcon sx={{ fontSize: 19 }} />
            </Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography
                sx={{ ...type.title, fontSize: 14.5, lineHeight: 1.3 }}
              >
                {t(
                  'teamOpt.invest.idleHeadline',
                  'Find your highest-value 5★ pulls'
                )}
              </Typography>
              <Typography
                sx={{
                  ...type.label,
                  mt: 0.375,
                  lineHeight: 1.45,
                  maxWidth: 500,
                }}
              >
                {totalRoom > 0
                  ? t('teamOpt.invest.readySimple', {
                      defaultValue:
                        'Rank constellations{{sigPart}} across {{members}} members for your pull budget{{invPart}}.',
                      members: effectiveIncluded.filter(Boolean).length,
                      sigPart: canAddSig.some(Boolean)
                        ? t(
                            'teamOpt.invest.readySigPart2',
                            ' and R1 signatures'
                          )
                        : '',
                      invPart:
                        mode === 'inventory'
                          ? t(
                              'teamOpt.invest.readyInvPart',
                              ' using this run’s artifacts'
                            )
                          : '',
                    })
                  : t(
                      'teamOpt.invest.noRoom',
                      'Select at least one member with available upgrades in Options.'
                    )}
              </Typography>
              {inScopeHints.length > 0 &&
                (() => {
                  const autoHints = inScopeHints.filter(
                    (h) =>
                      autoAdapt &&
                      !h.hasCustom &&
                      !h.isPinned &&
                      isAutoAdaptableHint(h) &&
                      h.hasSuggestions
                  )
                  const manualHints = inScopeHints.filter(
                    (h) =>
                      !h.hasCustom &&
                      !h.isPinned &&
                      !(autoAdapt && isAutoAdaptableHint(h) && h.hasSuggestions)
                  )
                  const lead = manualHints[0] ?? autoHints[0]
                  if (!lead) return null
                  return (
                    <Box
                      sx={{
                        mt: 0.75,
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 0.75,
                      }}
                    >
                      {autoHints.length > 0 && (
                        <Typography
                          sx={{
                            fontSize: 12,
                            color: 'text.secondary',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 0.5,
                          }}
                        >
                          <AutoAwesomeRoundedIcon
                            sx={{ fontSize: 13, color: tokens.gold }}
                          />
                          {t('teamOpt.invest.idleAutoHint', {
                            defaultValue:
                              'Auto-adapts {{list}} during comparison',
                            list: autoHints
                              .slice(0, 2)
                              .map(
                                (h) => `${charName(h.characterKey)} C${h.cons}`
                              )
                              .join(', '),
                          })}
                        </Typography>
                      )}
                      {manualHints.length > 0 && (
                        <Typography
                          sx={{
                            fontSize: 12,
                            color: 'warning.main',
                          }}
                        >
                          {t('teamOpt.invest.idleManualHint', {
                            defaultValue:
                              '{{name}} C{{cons}} alters rotation ({{cue}})',
                            name: charName(manualHints[0].characterKey),
                            cons: manualHints[0].cons,
                            cue: manualHints[0].cue,
                          })}
                        </Typography>
                      )}
                      <ButtonBase
                        onClick={() =>
                          openConsEditor(lead.characterKey, lead.cons)
                        }
                        sx={{
                          fontSize: 12,
                          fontWeight: 650,
                          color: giTokens.goldLight,
                          textDecoration: 'underline',
                          textUnderlineOffset: '2px',
                          borderRadius: 0.5,
                          px: 0.25,
                          ...focusSx,
                        }}
                      >
                        {manualHints.length > 0
                          ? t('teamOpt.invest.setConsRotShort', {
                              defaultValue: 'Set C{{cons}} rotation',
                              cons: manualHints[0].cons,
                            })
                          : t('teamOpt.invest.customizeShort', 'Customize')}
                      </ButtonBase>
                    </Box>
                  )
                })()}
            </Box>
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1.25,
              flexShrink: 0,
            }}
          >
            {budgetSelector}
            <Button
              size="small"
              variant="contained"
              disabled={disabled || totalRoom === 0}
              startIcon={<PlayArrowRoundedIcon sx={{ fontSize: 18 }} />}
              onClick={() => void runComparison()}
              sx={{
                ...giCtaSx,
                minHeight: 34,
                px: 2,
                fontSize: 13,
                borderRadius: tokens.radius.control,
              }}
            >
              {t('teamOpt.invest.compare', 'Compare investments')}
            </Button>
          </Box>
        </Box>
      )}

      {/* ── Unified Overall View (stays visibly mounted while updating: zero layout jump!) */}
      {plan && plan.maxBudget > 0 && (
        <Box
          sx={{
            mt: 2.25,
            display: 'grid',
            gap: 2.5,
            opacity: running ? 0.62 : 1,
            transition: 'opacity .18s',
          }}
        >
          {/* Primary Section: Optimal Ladder (when budget >= 2) beside Ranked Paths for +X pulls */}
          <Box
            sx={{
              display: 'grid',
              gap: 2.5,
              alignItems: 'start',
              gridTemplateColumns:
                plan.maxBudget > 1
                  ? {
                      xs: 'minmax(0, 1fr)',
                      lg: 'minmax(280px, 0.76fr) minmax(0, 1.24fr)',
                    }
                  : 'minmax(0, 1fr)',
            }}
          >
            {/* Left: Optimal Wishing Roadmap (+1 -> +2 -> +3 ...) — interactive budget switcher */}
            {plan.maxBudget > 1 && (
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  component="h3"
                  sx={{
                    fontSize: 12,
                    fontWeight: 650,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                    mb: 1,
                  }}
                >
                  {t('teamOpt.invest.optimalOrder', 'Best path by pull count')}
                </Typography>
                <Box
                  sx={{
                    ...insetSx,
                    borderColor: tokens.hairlineStrong,
                    overflow: 'hidden',
                  }}
                >
                  {plan.bestByCost.slice(1).map((row, i) => {
                    const prev = plan.bestByCost[i]
                    const stepGain =
                      prev && prev.dps > 0 ? row.dps / prev.dps - 1 : undefined
                    const active = activeBudget === row.cost
                    return (
                      <ButtonBase
                        key={row.cost}
                        onClick={() => setSelectedBudget(row.cost)}
                        sx={{
                          width: '100%',
                          textAlign: 'left',
                          display: 'grid',
                          gridTemplateColumns: '38px minmax(0, 1fr) auto 18px',
                          alignItems: 'center',
                          columnGap: 1,
                          pl: 1.5,
                          pr: 1,
                          py: 1.25,
                          borderTop: i > 0 ? hairline : 'none',
                          borderLeft: `2px solid ${active ? tokens.gold : 'transparent'}`,
                          bgcolor: active
                            ? alpha(tokens.gold, 0.1)
                            : 'transparent',
                          ...quickSx,
                          ...focusSx,
                          '& .invest-chevron': {
                            opacity: active ? 1 : 0,
                            transform: active
                              ? 'translateX(0)'
                              : 'translateX(-3px)',
                            transition: 'opacity .14s, transform .14s',
                          },
                          '&:hover': {
                            bgcolor: active
                              ? alpha(tokens.gold, 0.13)
                              : alpha(giTokens.parchment, 0.045),
                            '& .invest-chevron': {
                              opacity: active ? 1 : 0.65,
                              transform: 'translateX(0)',
                            },
                          },
                        }}
                      >
                        <Typography
                          sx={{
                            fontSize: 13.5,
                            fontWeight: 750,
                            color: active ? tokens.gold : 'text.secondary',
                            ...numSx,
                          }}
                        >
                          +{row.cost}
                        </Typography>
                        <Box sx={{ minWidth: 0 }}>
                          {renderUpgradeLine(row, active, false)}
                        </Box>
                        <Box sx={{ textAlign: 'right', ...numSx }}>
                          <Typography
                            sx={{
                              fontSize: 14,
                              fontWeight: 700,
                              color:
                                row.gainPct > 0.0005
                                  ? 'success.main'
                                  : 'text.secondary',
                              lineHeight: 1.2,
                            }}
                          >
                            {formatGain(row.gainPct)}
                          </Typography>
                          {row.cost > 1 && stepGain !== undefined && (
                            <Typography
                              sx={{
                                fontSize: 11.5,
                                color: 'text.secondary',
                                lineHeight: 1.25,
                              }}
                            >
                              {formatGain(stepGain)}{' '}
                              {t('teamOpt.invest.stepShort', 'step')}
                            </Typography>
                          )}
                        </Box>
                        <ChevronRightRoundedIcon
                          className="invest-chevron"
                          sx={{
                            fontSize: 18,
                            color: active ? tokens.gold : 'text.secondary',
                          }}
                        />
                      </ButtonBase>
                    )
                  })}
                </Box>
              </Box>
            )}

            {/* Right (or full width for +1): Ranked Top Paths for Selected Budget +X */}
            <Box sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 1,
                  mb: 1,
                }}
              >
                <Typography
                  component="h3"
                  sx={{
                    fontSize: 12,
                    fontWeight: 650,
                    letterSpacing: '0.04em',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                  }}
                >
                  {t('teamOpt.invest.topPathsFor', {
                    defaultValue: 'Top options for +{{cost}} {{pulls}}',
                    cost: activeBudget,
                    pulls:
                      activeBudget === 1
                        ? t('teamOpt.invest.pullOne', 'pull')
                        : t('teamOpt.invest.pullMany', 'pulls'),
                  })}
                </Typography>
                <Typography sx={{ ...type.label, fontSize: 12, ...numSx }}>
                  {t('teamOpt.invest.vsBaseline', {
                    defaultValue: 'vs {{dps}} {{unit}}',
                    dps: formatRateFull(baseDps, undefined),
                    unit: unitLabel,
                  })}
                </Typography>
              </Box>

              <Box
                sx={{
                  ...insetSx,
                  borderColor: tokens.hairlineStrong,
                  overflow: 'hidden',
                }}
              >
                {activePaths.map((path, idx) => {
                  const isWinner = idx === 0
                  const gainBarPct =
                    path.gainPct > 0
                      ? Math.max(
                          4,
                          Math.min(100, (path.gainPct / bestGain) * 100)
                        )
                      : 0
                  const timeDiff =
                    path.seconds &&
                    baseSeconds &&
                    Math.abs(path.seconds - baseSeconds) >= 0.15
                  return (
                    <Box
                      key={investmentStateKey(path)}
                      sx={{
                        px: { xs: 1.5, sm: 2 },
                        py: 1.375,
                        borderTop: idx > 0 ? hairline : 'none',
                        bgcolor: isWinner
                          ? alpha(tokens.gold, 0.06)
                          : undefined,
                        display: 'grid',
                        gap: { xs: 1, sm: 1.75 },
                        gridTemplateColumns: {
                          xs: 'minmax(0, 1fr) auto',
                          sm: '22px minmax(0, 1.35fr) minmax(110px, 0.7fr) auto',
                        },
                        alignItems: 'center',
                        ...quickSx,
                        '&:hover': {
                          bgcolor: isWinner
                            ? alpha(tokens.gold, 0.085)
                            : alpha(giTokens.parchment, 0.03),
                        },
                      }}
                    >
                      <Typography
                        sx={{
                          display: { xs: 'none', sm: 'block' },
                          fontSize: 13,
                          fontWeight: isWinner ? 750 : 550,
                          color: isWinner ? tokens.gold : 'text.disabled',
                          ...numSx,
                        }}
                      >
                        {idx + 1}
                      </Typography>

                      <Box sx={{ minWidth: 0, display: 'grid', gap: 0.375 }}>
                        {renderUpgradeLine(path, isWinner, true)}
                        {(() => {
                          const firstRaisedIdx = keys.findIndex(
                            (_, i) => path.cons[i] > baseCons[i]
                          )
                          const unconfiguredHint =
                            !path.rotationLabel && teamText.trim()
                              ? keys.flatMap((ck, i) =>
                                  path.cons[i] > baseCons[i]
                                    ? (memberHintsMap[ck] ?? []).filter((h) => {
                                        if (h.cons > path.cons[i]) return false
                                        const cur = consRotationOf(
                                          rotationsOf[ck] ?? {},
                                          h.cons,
                                          baseCons[i]
                                        )
                                        return !cur.text && !cur.pinnedBase
                                      })
                                    : []
                                )[0]
                              : undefined
                          if (
                            !path.rotationLabel &&
                            !timeDiff &&
                            !path.unmet &&
                            !unconfiguredHint
                          )
                            return null
                          const diffText =
                            path.rotationText && teamText.trim()
                              ? stepDiffSummary(
                                  teamText,
                                  path.rotationText,
                                  names
                                )
                              : undefined
                          return (
                            <Box
                              sx={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                gap: 1,
                                ...numSx,
                              }}
                            >
                              {path.rotationLabel && (
                                <Tooltip
                                  arrow
                                  title={
                                    <Box>
                                      {diffText && <div>{diffText}</div>}
                                      <div>
                                        {t(
                                          'teamOpt.invest.clickEditRot',
                                          'Click to edit or revert rotation'
                                        )}
                                      </div>
                                    </Box>
                                  }
                                >
                                  <ButtonBase
                                    onClick={() => {
                                      if (firstRaisedIdx >= 0) {
                                        const ck = keys[firstRaisedIdx]
                                        const baseC = baseCons[firstRaisedIdx]
                                        const targetC =
                                          path.cons[firstRaisedIdx]
                                        const custom = consRotationOf(
                                          rotationsOf[ck] ?? {},
                                          targetC,
                                          baseC
                                        )
                                        let openC = custom.from ?? targetC
                                        if (!custom.text && path.autoAdapted) {
                                          for (
                                            let c = targetC;
                                            c > baseC;
                                            c--
                                          ) {
                                            if (autoRotations[ck]?.[c]) {
                                              openC = c
                                              break
                                            }
                                          }
                                        }
                                        openConsEditor(ck, openC)
                                      } else {
                                        setRotationsOpen(true)
                                      }
                                    }}
                                    sx={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 0.375,
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      px: 0.75,
                                      py: 0.125,
                                      borderRadius: 999,
                                      color: giTokens.goldLight,
                                      bgcolor: alpha(tokens.gold, 0.12),
                                      border: `1px solid ${alpha(tokens.gold, 0.28)}`,
                                      ...quickSx,
                                      ...focusSx,
                                      '&:hover': {
                                        bgcolor: alpha(tokens.gold, 0.2),
                                      },
                                    }}
                                  >
                                    {path.autoAdapted && (
                                      <AutoAwesomeRoundedIcon
                                        sx={{
                                          fontSize: 12,
                                          color: tokens.gold,
                                        }}
                                      />
                                    )}
                                    <span>
                                      {path.rotationLabel}
                                      {path.seconds
                                        ? ` · ${path.seconds.toFixed(1)}s`
                                        : ''}
                                    </span>
                                  </ButtonBase>
                                </Tooltip>
                              )}
                              {!path.rotationLabel && unconfiguredHint && (
                                <Tooltip
                                  arrow
                                  title={`${unconfiguredHint.summary} — ${unconfiguredHint.cue}`}
                                >
                                  <ButtonBase
                                    onClick={() =>
                                      openConsEditor(
                                        unconfiguredHint.characterKey,
                                        unconfiguredHint.cons
                                      )
                                    }
                                    sx={{
                                      fontSize: 11,
                                      fontWeight: 650,
                                      px: 0.75,
                                      py: 0.125,
                                      borderRadius: 999,
                                      color: 'warning.main',
                                      bgcolor: (theme) =>
                                        alpha(theme.palette.warning.main, 0.12),
                                      ...quickSx,
                                      ...focusSx,
                                      '&:hover': {
                                        bgcolor: (theme) =>
                                          alpha(
                                            theme.palette.warning.main,
                                            0.22
                                          ),
                                      },
                                    }}
                                  >
                                    {t('teamOpt.invest.needsConsRot', {
                                      defaultValue:
                                        'Set {{name}} C{{cons}} rot',
                                      name: charName(
                                        unconfiguredHint.characterKey
                                      ),
                                      cons: unconfiguredHint.cons,
                                    })}
                                  </ButtonBase>
                                </Tooltip>
                              )}
                              {!path.rotationLabel && timeDiff && (
                                <Typography
                                  sx={{
                                    fontSize: 11.5,
                                    color: 'text.secondary',
                                  }}
                                >
                                  {baseSeconds?.toFixed(1)}s →{' '}
                                  {path.seconds?.toFixed(1)}s
                                </Typography>
                              )}
                              {path.unmet && (
                                <Tooltip
                                  arrow
                                  title={t(
                                    'teamOpt.invest.erUnmetTip',
                                    'A member missed an ER/stat target with this upgrade (e.g. swapping off an ER weapon).'
                                  )}
                                >
                                  <Box
                                    component="span"
                                    sx={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 0.375,
                                      fontSize: 11.5,
                                      fontWeight: 600,
                                      color: 'warning.main',
                                    }}
                                  >
                                    <WarningAmberRoundedIcon
                                      sx={{ fontSize: 13 }}
                                    />
                                    {t(
                                      'teamOpt.invest.erShortfall',
                                      'ER unmet'
                                    )}
                                  </Box>
                                </Tooltip>
                              )}
                            </Box>
                          )
                        })()}
                      </Box>

                      {/* Smooth animated gain-scaled bar */}
                      <Box
                        sx={{
                          display: { xs: 'none', sm: 'block' },
                          height: 6,
                          borderRadius: 999,
                          overflow: 'hidden',
                          bgcolor: alpha(giTokens.parchment, 0.08),
                        }}
                      >
                        {gainBarPct > 0 && (
                          <Box
                            sx={{
                              height: '100%',
                              width: `${gainBarPct}%`,
                              borderRadius: 999,
                              bgcolor: isWinner
                                ? tokens.gold
                                : alpha(tokens.gold, 0.45),
                              transition: `width .24s ${tokens.ease}`,
                              '@media (prefers-reduced-motion: reduce)': {
                                transition: 'none',
                              },
                            }}
                          />
                        )}
                      </Box>

                      <Box
                        sx={{
                          textAlign: 'right',
                          minWidth: { sm: 138 },
                          ...numSx,
                        }}
                      >
                        <Box
                          sx={{
                            display: 'inline-flex',
                            alignItems: 'baseline',
                            gap: 1,
                          }}
                        >
                          <Typography
                            sx={{
                              fontSize: 14,
                              fontWeight: 650,
                              color: 'text.primary',
                            }}
                          >
                            {formatRateFull(path.dps, undefined)}
                          </Typography>
                          <Typography
                            sx={{
                              fontSize: 14.5,
                              fontWeight: 750,
                              minWidth: 52,
                              color:
                                path.gainPct > 0.0005
                                  ? 'success.main'
                                  : 'text.secondary',
                            }}
                          >
                            {formatGain(path.gainPct)}
                          </Typography>
                        </Box>
                        <Typography
                          sx={{
                            fontSize: 11.5,
                            color: 'text.secondary',
                            lineHeight: 1.25,
                          }}
                        >
                          {path.dpsGain >= 0 ? '+' : '−'}
                          {formatRateFull(Math.abs(path.dpsGain), undefined)}
                          {activeBudget > 1 &&
                            ` · ${formatGain(path.gainPerPull)}/${t('teamOpt.invest.pullShort', 'pull')}`}
                        </Typography>
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          </Box>

          {/* Bottom Overview Strip: All members' individual upgrades side-by-side */}
          {evaluatedMembers.length > 0 && (
            <Box>
              <Typography
                component="h3"
                sx={{
                  fontSize: 12,
                  fontWeight: 650,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: 'text.secondary',
                  mb: 1,
                }}
              >
                {t('teamOpt.invest.memberImpact', 'Per-member upgrade value')}
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gap: 1.25,
                  gridTemplateColumns: {
                    xs: 'minmax(0, 1fr)',
                    sm: 'repeat(2, minmax(0, 1fr))',
                    lg: `repeat(${Math.min(4, evaluatedMembers.length)}, minmax(0, 1fr))`,
                  },
                }}
              >
                {evaluatedMembers.map(({ ck, index, sigEv, consMap }) => {
                  const baseC = baseCons[index]
                  const sigKey = signatureWeapons[ck]
                  const consLevels = Object.keys(consMap)
                    .map(Number)
                    .sort((a, b) => a - b)
                  let prevDps = baseDps
                  const entries: {
                    id: string
                    tagId: string
                    cons?: number
                    icon?: string
                    label: string
                    sub?: string
                    gainVsBase: number
                    stepGain: number
                    showStep: boolean
                    dps: number
                    rot?: string
                    rotText?: string
                    autoAdapted?: boolean
                    customOwn?: boolean
                    needsRotHint?: ConsRotationHint
                  }[] = []
                  if (sigEv && sigKey) {
                    const gain = baseDps > 0 ? sigEv.dps / baseDps - 1 : 0
                    entries.push({
                      id: 'sig',
                      tagId: `${ck}:sig`,
                      icon: weaponAsset(sigKey, true),
                      label: 'R1',
                      sub: t(`weaponNames_gen:${sigKey}`, sigKey),
                      gainVsBase: gain,
                      stepGain: gain,
                      showStep: false,
                      dps: sigEv.dps,
                      rot: sigEv.rotationLabel,
                    })
                  }
                  for (const c of consLevels) {
                    const ev = consMap[c]
                    const gain = baseDps > 0 ? ev.dps / baseDps - 1 : 0
                    const step = prevDps > 0 ? ev.dps / prevDps - 1 : 0
                    const customRot = consRotationOf(
                      rotationsOf[ck] ?? {},
                      c,
                      baseC
                    )
                    const exactHint = constellationHintOf(ck, c)
                    const needsRotHint =
                      exactHint &&
                      !ev.autoAdapted &&
                      !customRot.text &&
                      !customRot.pinnedBase &&
                      teamText.trim()
                        ? exactHint
                        : undefined
                    const autoOwn =
                      !!ev.autoAdapted &&
                      (!!autoRotations[ck]?.[c] ||
                        !Object.keys(autoRotations[ck] ?? {}).some(
                          (k) => Number(k) < c && Number(k) > baseC
                        ))
                    entries.push({
                      id: `c${c}`,
                      tagId: `${ck}:c${c}`,
                      cons: c,
                      icon:
                        characterAsset(
                          ck,
                          `constellation${c}` as 'constellation1',
                          gender
                        ) ?? undefined,
                      label: `C${c}`,
                      gainVsBase: gain,
                      stepGain: step,
                      showStep: c > baseC + 1,
                      dps: ev.dps,
                      rot: ev.rotationLabel,
                      rotText: ev.rotationText,
                      autoAdapted: autoOwn,
                      customOwn: !!customRot.text && customRot.from === c,
                      needsRotHint,
                    })
                    prevDps = ev.dps
                  }
                  return (
                    <Box
                      key={ck}
                      sx={{
                        ...insetSx,
                        borderColor: tokens.hairlineStrong,
                        px: 1.5,
                        py: 1.25,
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 0.75,
                      }}
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 0.875,
                          pb: 0.75,
                          borderBottom: hairline,
                        }}
                      >
                        <MemberAvatar characterKey={ck} size={24} />
                        <Typography
                          noWrap
                          sx={{ fontSize: 13.5, fontWeight: 650, flex: 1 }}
                        >
                          {charName(ck)}
                        </Typography>
                        <Typography
                          sx={{ ...type.label, fontSize: 12, ...numSx }}
                        >
                          C{baseC}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'grid', gap: 0.5 }}>
                        {entries.map((entry) => {
                          const isTop1 = bestSingleId === entry.tagId
                          const diffLine =
                            entry.rotText && teamText.trim()
                              ? stepDiffSummary(
                                  teamText,
                                  entry.rotText,
                                  names,
                                  ck
                                )
                              : undefined
                          return (
                            <Tooltip
                              key={entry.id}
                              arrow
                              placement="top"
                              title={
                                <Box sx={numSx}>
                                  <div>
                                    {entry.sub ?? entry.label}:{' '}
                                    {formatRateFull(entry.dps, undefined)}{' '}
                                    {unitLabel} ({formatGain(entry.gainVsBase)}{' '}
                                    vs base)
                                  </div>
                                  {entry.showStep && (
                                    <div>
                                      {t('teamOpt.invest.stepFromPrev', {
                                        defaultValue: '{{step}} over previous',
                                        step: formatGain(entry.stepGain),
                                      })}
                                    </div>
                                  )}
                                  {entry.rot && <div>{entry.rot}</div>}
                                  {diffLine && <div>{diffLine}</div>}
                                  {entry.needsRotHint && (
                                    <div>
                                      {entry.needsRotHint.summary} —{' '}
                                      {entry.needsRotHint.cue}
                                    </div>
                                  )}
                                </Box>
                              }
                            >
                              <Box
                                sx={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 0.625,
                                  py: 0.25,
                                  borderRadius: 1,
                                  cursor: 'default',
                                  '& .cons-edit-btn': { opacity: 0 },
                                  '&:hover .cons-edit-btn, &:focus-within .cons-edit-btn':
                                    { opacity: 0.85 },
                                }}
                              >
                                {entry.icon && (
                                  <Box
                                    component="img"
                                    src={entry.icon}
                                    alt=""
                                    aria-hidden
                                    sx={{
                                      width: 18,
                                      height: 18,
                                      objectFit: 'contain',
                                      flexShrink: 0,
                                    }}
                                  />
                                )}
                                <Typography
                                  sx={{
                                    fontSize: 13,
                                    fontWeight: isTop1 ? 750 : 650,
                                    color: isTop1
                                      ? tokens.gold
                                      : 'text.primary',
                                    minWidth: 26,
                                    ...numSx,
                                  }}
                                >
                                  {entry.label}
                                </Typography>
                                <Box
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                    flex: 1,
                                    minWidth: 0,
                                  }}
                                >
                                  {entry.sub && (
                                    <Typography
                                      noWrap
                                      sx={{
                                        ...type.label,
                                        fontSize: 11.5,
                                        minWidth: 0,
                                      }}
                                    >
                                      {entry.sub}
                                    </Typography>
                                  )}
                                  {isTop1 && (
                                    <Box
                                      component="span"
                                      sx={{
                                        fontSize: 10.5,
                                        fontWeight: 700,
                                        px: 0.625,
                                        py: 0.1,
                                        borderRadius: 999,
                                        flexShrink: 0,
                                        color: giTokens.goldLight,
                                        bgcolor: alpha(tokens.gold, 0.15),
                                      }}
                                    >
                                      {t('teamOpt.invest.bestOne', 'Best +1')}
                                    </Box>
                                  )}
                                  {entry.cons !== undefined &&
                                    entry.autoAdapted && (
                                      <ButtonBase
                                        onClick={() =>
                                          openConsEditor(ck, entry.cons!)
                                        }
                                        sx={{
                                          display: 'inline-flex',
                                          alignItems: 'center',
                                          gap: 0.25,
                                          fontSize: 10.5,
                                          fontWeight: 650,
                                          px: 0.625,
                                          py: 0.1,
                                          borderRadius: 999,
                                          flexShrink: 0,
                                          color: giTokens.goldLight,
                                          bgcolor: alpha(tokens.gold, 0.14),
                                          border: `1px solid ${alpha(tokens.gold, 0.3)}`,
                                          ...quickSx,
                                          ...focusSx,
                                          '&:hover': {
                                            bgcolor: alpha(tokens.gold, 0.24),
                                          },
                                        }}
                                      >
                                        <AutoAwesomeRoundedIcon
                                          sx={{
                                            fontSize: 11,
                                            color: tokens.gold,
                                          }}
                                        />
                                        {t(
                                          'teamOpt.invest.autoRotPill',
                                          'Auto rot'
                                        )}
                                      </ButtonBase>
                                    )}
                                  {entry.cons !== undefined &&
                                    !entry.autoAdapted &&
                                    entry.customOwn && (
                                      <ButtonBase
                                        onClick={() =>
                                          openConsEditor(ck, entry.cons!)
                                        }
                                        sx={{
                                          fontSize: 10.5,
                                          fontWeight: 650,
                                          px: 0.625,
                                          py: 0.1,
                                          borderRadius: 999,
                                          flexShrink: 0,
                                          color: giTokens.goldLight,
                                          bgcolor: alpha(tokens.gold, 0.14),
                                          ...quickSx,
                                          ...focusSx,
                                          '&:hover': {
                                            bgcolor: alpha(tokens.gold, 0.24),
                                          },
                                        }}
                                      >
                                        {t('teamOpt.invest.customRotPill', {
                                          defaultValue: 'C{{cons}} rot',
                                          cons: entry.cons,
                                        })}
                                      </ButtonBase>
                                    )}
                                  {entry.cons !== undefined &&
                                    entry.needsRotHint && (
                                      <ButtonBase
                                        onClick={() =>
                                          openConsEditor(ck, entry.cons!)
                                        }
                                        sx={{
                                          fontSize: 10.5,
                                          fontWeight: 700,
                                          px: 0.625,
                                          py: 0.1,
                                          borderRadius: 999,
                                          flexShrink: 0,
                                          color: 'warning.main',
                                          bgcolor: (theme) =>
                                            alpha(
                                              theme.palette.warning.main,
                                              0.14
                                            ),
                                          ...quickSx,
                                          ...focusSx,
                                          '&:hover': {
                                            bgcolor: (theme) =>
                                              alpha(
                                                theme.palette.warning.main,
                                                0.24
                                              ),
                                          },
                                        }}
                                      >
                                        {t(
                                          'teamOpt.invest.needsRotPill',
                                          'Needs rot'
                                        )}
                                      </ButtonBase>
                                    )}
                                  {entry.cons !== undefined &&
                                    !entry.autoAdapted &&
                                    !entry.customOwn &&
                                    !entry.needsRotHint &&
                                    !!teamText.trim() && (
                                      <IconButton
                                        className="cons-edit-btn"
                                        size="small"
                                        aria-label={t(
                                          'teamOpt.invest.editConsRotAria',
                                          {
                                            defaultValue:
                                              'Edit {{name}} C{{cons}} rotation',
                                            name: charName(ck),
                                            cons: entry.cons,
                                          }
                                        )}
                                        onClick={() =>
                                          openConsEditor(ck, entry.cons!)
                                        }
                                        sx={{
                                          p: 0.25,
                                          color: 'text.secondary',
                                          ...quickSx,
                                          '&:hover': { color: 'text.primary' },
                                        }}
                                      >
                                        <EditRoundedIcon
                                          sx={{ fontSize: 13 }}
                                        />
                                      </IconButton>
                                    )}
                                </Box>
                                {entry.showStep && (
                                  <Typography
                                    sx={{
                                      fontSize: 11.5,
                                      color: 'text.secondary',
                                      ...numSx,
                                    }}
                                  >
                                    ({formatGain(entry.stepGain)})
                                  </Typography>
                                )}
                                <Typography
                                  sx={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    minWidth: 46,
                                    textAlign: 'right',
                                    ...numSx,
                                    color:
                                      entry.gainVsBase > 0.0005
                                        ? 'success.main'
                                        : 'text.secondary',
                                  }}
                                >
                                  {formatGain(entry.gainVsBase)}
                                </Typography>
                              </Box>
                            </Tooltip>
                          )
                        })}
                      </Box>
                    </Box>
                  )
                })}
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* Shareable PNG chart dialog (KQM mode) */}
      {shareOpen && shareRender && (
        <CardImageDialog
          title={t('teamOpt.invest.chartTitle', 'Team investment comparison')}
          alt={t('teamOpt.invest.chartTitle', 'Team investment comparison')}
          fileName={`${safeName(team?.name || 'team')}-investment`}
          aspectRatio={`${COMPARE_CHART_WIDTH} / ${COMPARE_CHART_HEIGHT}`}
          render={shareRender}
          onClose={() => setShareOpen(false)}
        />
      )}
    </Panel>
  )
}
