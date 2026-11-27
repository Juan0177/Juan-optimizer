import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import { characterAsset, weaponAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import {
  allTravelerKeys,
  charKeyToLocGenderedCharKey,
  signatureWeapons,
} from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { getCharStat } from '@genshin-optimizer/gi/stats'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  InvestmentChartData,
  KqmBuild,
  KqmResult,
  TeamOptMember,
  TeamOptResult,
} from '@genshin-optimizer/gi/ui'
import {
  BETA_LABEL,
  CardImageDialog,
  CharacterName,
  COMPARE_CHART_HEIGHT,
  COMPARE_CHART_WIDTH,
  kqmCardFace,
  kqmTalentLevel,
  renderInvestmentChart,
  safeName,
  TeamOptCancelled,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded'
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded'
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded'
import StopRoundedIcon from '@mui/icons-material/StopRounded'
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
  LinearProgress,
  Popover,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Fragment,
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
  planInvestments,
  refitConstellations,
} from './consInvestment'
import { formatGain, formatRateFull } from './format'
import { betaOf, shareStamp } from './KqmShareMenu'
import { kqmStandardText } from './KqmStandard'
import { MemberAvatar } from './MemberAvatar'
import { teamRunRotation, useMemberNames } from './RotationWriter'
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

interface CachedInvestment {
  /** Evaluated states keyed by `${stateKey}::${rotText}` */
  evals: Map<string, InvestmentEval>
  last?: {
    plan: InvestmentPlan
    configKey: string
  }
}

const resultCache = new WeakMap<object, CachedInvestment>()

function cacheFor(subject: object): CachedInvestment {
  let hit = resultCache.get(subject)
  if (!hit) {
    hit = { evals: new Map() }
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
 * Clean, single-glance investment comparison panel (available in both Team Optimize and KQM
 * Theorycrafting): compares your team baseline against extra 5★ pulls across constellations,
 * R1 signature weapons, and optional conditional alternative rotations.
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
  const [includeFourStars, setIncludeFourStars] = useState(
    () =>
      defaultIncluded.size > 0 &&
      [...defaultIncluded].some((k) => getCharStat(k).rarity === 4)
  )
  const [budgetChoice, setBudgetChoice] = useState<number | 'all'>(3)
  const [optionsAnchor, setOptionsAnchor] = useState<HTMLElement | null>(null)

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

  const altRotationCount = useMemo(
    () =>
      keys.reduce((n, k) => n + Object.keys(rotationsOf[k] ?? {}).length, 0) +
      combos.filter((c) => c.text.trim()).length,
    [keys, rotationsOf, combos]
  )

  const [rotationsOpen, setRotationsOpen] = useState(false)
  const [rotTab, setRotTab] = useState<CharacterKey | 'combos'>(
    () => keys[0] ?? 'combos'
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

  const rotationsKey = useMemo(
    () => JSON.stringify([keys.map((k) => rotationsOf[k] ?? {}), combos]),
    [keys, rotationsOf, combos]
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
    const cached = cacheFor(result).last
    setPlan(cached?.plan)
    setPlanConfigKey(cached?.configKey)
    if (cached?.plan) {
      setSelectedBudget((b) =>
        Math.max(1, Math.min(b, cached.plan.maxBudget || 1))
      )
    }
  }, [result])

  useEffect(() => () => cancelRef.current(), [])

  const resolveRotation = useCallback(
    (state: InvestmentState) => {
      const consObj = Object.fromEntries(
        keys.map((k, i) => [k, state.cons[i]])
      ) as Partial<Record<CharacterKey, number>>
      const comboText = comboRotationOf(combos, consObj, baseConsMap)
      if (comboText)
        return {
          text: comboText,
          label: t('teamOpt.invest.comboRotBadge', 'Combo rotation'),
        }
      for (let i = 0; i < keys.length; i++) {
        if (state.cons[i] <= baseCons[i]) continue
        const ck = keys[i]
        const { text, from } = consRotationOf(
          rotationsOf[ck] ?? {},
          state.cons[i],
          baseCons[i]
        )
        if (text) {
          return {
            text,
            label: t('teamOpt.invest.memberRotBadge', {
              defaultValue: '{{name}} C{{cons}} rot',
              name: charName(ck),
              cons: from ?? state.cons[i],
            }),
          }
        }
      }
      return { text: undefined, label: undefined }
    },
    [keys, combos, baseConsMap, baseCons, rotationsOf, t, charName]
  )

  const runComparison = async (overrides?: {
    budget?: number
    included?: Set<CharacterKey>
    includeSig?: boolean
    includeFourStars?: boolean
  }) => {
    const nextInc = overrides?.included ?? included
    const nextSig = overrides?.includeSig ?? includeSig
    const next4 = overrides?.includeFourStars ?? includeFourStars
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
    const stateCache = new Map<string, InvestmentEval>()
    for (const [compoundKey, ev] of store.evals) {
      const sep = compoundKey.indexOf('::')
      if (sep < 0) continue
      const sKey = compoundKey.slice(0, sep)
      const rText = compoundKey.slice(sep + 2)
      const [cStr, sigStr] = sKey.split('|')
      if (!cStr || !sigStr) continue
      const cons = cStr.split(',').map(Number)
      const sig = [...sigStr].map((ch) => ch === '1')
      if (cons.length !== keys.length || sig.length !== keys.length) continue
      const expected = resolveRotation({ cons, sig }).text ?? ''
      if (rText === expected) stateCache.set(sKey, ev)
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
        margin: 0.025,
        most: mode === 'inventory' ? 14 : 8,
        cache: stateCache,
        isCancelled: () => cancelled,
        onProgress: (p) => {
          if (!cancelled) setProgress(p)
        },
        evaluate: async (state) => {
          const { text, label } = resolveRotation(state)
          const compoundKey = `${investmentStateKey(state)}::${text ?? ''}`
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
              const sRot = resolveRotation(singleState).text ?? ''
              const sBuild = store.evals.get(
                `${investmentStateKey(singleState)}::${sRot}`
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
              text,
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
              text,
              rotation: invRotMeta,
            })
          }

          if (!point || cancelled) return undefined
          const ev: InvestmentEval = {
            dps: dpsOf(point),
            seconds: point.seconds,
            rotationLabel: label,
            unmet: point.unmet,
            point,
          }
          store.evals.set(compoundKey, ev)
          return ev
        },
      })

      if (cancelled || !nextPlan) return
      const runConfigKey = JSON.stringify([
        keys,
        baseCons,
        scope.maxCons,
        scope.canAddSig,
        runBudget,
        rotationsKey,
      ])
      store.last = { plan: nextPlan, configKey: runConfigKey }
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

  // One-click budget handler: switches immediately if already computed, or extends in place!
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

  const toggleMember = (ck: CharacterKey) => {
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
    if (plan && !running)
      void runComparison({ included: nextInc, includeFourStars: next4 })
  }

  const toggleSig = () => {
    const next = !includeSig
    setIncludeSig(next)
    if (plan && !running) void runComparison({ includeSig: next })
  }

  const toggleFourStars = () => {
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
    if (plan && !running)
      void runComparison({ included: nextInc, includeFourStars: next4 })
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

  // Count how many options are non-default so Options button shows a quiet dot if customized
  const customOptionsCount =
    (!includeSig && sigAvailable.some(Boolean) ? 1 : 0) +
    (includeFourStars && hasAnyFourStarRoom ? 1 : 0) +
    keys.filter((k) => defaultIncluded.has(k) !== included.has(k)).length

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
        done: progress.done + 1,
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
    : 5

  /** Clean inline upgrade description (no heavy bordered pills!) */
  const renderUpgradeLine = (
    path: Pick<InvestmentPath, 'cons' | 'sig'>,
    highlight = false
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
          columnGap: 1.25,
          rowGap: 0.5,
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
                      ...numSx,
                    }}
                  >
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

  // Members that actually have single-member results to show in the bottom overview strip
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
    <Panel id={anchorId} sx={{ scrollMarginTop: 88 }}>
      {/* ── Single clean Header Bar: Title + Budget pills + quiet Options / Alt rotations / Action */}
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

        {/* Controls: Pull budget + quiet Options + Alt rotations + Share + Run/Stop */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 0.75,
            ml: 'auto',
          }}
        >
          {/* Compact Pull Budget pill group */}
          {totalRoom > 0 && (
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
                mr: 0.5,
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
              {BUDGET_PRESETS.filter((b) => b <= Math.max(1, totalRoom)).map(
                (b) => {
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
                        bgcolor: active
                          ? alpha(tokens.gold, 0.18)
                          : 'transparent',
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
                }
              )}
              {totalRoom > 6 && (
                <ButtonBase
                  disabled={running}
                  onClick={() => pickBudget('all')}
                  sx={{
                    height: 28,
                    px: 1,
                    borderRadius: 1,
                    fontSize: 12.5,
                    fontWeight: budgetChoice === 'all' ? 700 : 550,
                    ...numSx,
                    ...quickSx,
                    ...focusSx,
                    color:
                      budgetChoice === 'all'
                        ? giTokens.goldLight
                        : 'text.secondary',
                    bgcolor:
                      budgetChoice === 'all'
                        ? alpha(tokens.gold, 0.18)
                        : 'transparent',
                    '&:hover': {
                      color:
                        budgetChoice === 'all'
                          ? giTokens.goldLight
                          : 'text.primary',
                      bgcolor: alpha(giTokens.parchment, 0.06),
                    },
                  }}
                >
                  {t('teamOpt.invest.allShort', 'All')}
                </ButtonBase>
              )}
            </Box>
          )}

          {/* Options popover (R1 signatures, 4★ cons, member filter) */}
          <Button
            size="small"
            color="inherit"
            disabled={running}
            startIcon={<TuneRoundedIcon sx={{ fontSize: 17 }} />}
            onClick={(e) => setOptionsAnchor(e.currentTarget)}
            sx={{
              ...quietActionSx,
              ...(customOptionsCount > 0 && { color: giTokens.goldLight }),
            }}
          >
            {t('teamOpt.invest.options', 'Options')}
            {customOptionsCount > 0 && ` (${customOptionsCount})`}
          </Button>

          {/* Conditional Alt Rotations toggle */}
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
              ? t('teamOpt.invest.altRotationsCount', {
                  defaultValue: 'Alt rotations ({{count}})',
                  count: altRotationCount,
                })
              : t('teamOpt.invest.altRotations', 'Alt rotations')}
          </Button>

          {/* Share PNG (KQM mode once computed) */}
          {mode === 'kqm' && plan && shareRender && (
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

          {/* Primary CTA (only shown before first run, when stopping, or when rotations changed) */}
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
            (!plan || rotationsChanged) && (
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
                {plan
                  ? t('teamOpt.invest.update', 'Update')
                  : t('teamOpt.invest.compare', 'Compare investments')}
              </Button>
            )
          )}
        </Box>
      </Box>

      {/* ── Options Popover (keeps main UI clean while covering every general use case) */}
      <Popover
        open={!!optionsAnchor}
        anchorEl={optionsAnchor}
        onClose={() => setOptionsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: {
            sx: {
              mt: 0.75,
              p: 2,
              width: 280,
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
        </Box>
        {(sigAvailable.some(Boolean) || hasAnyFourStarRoom) && (
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
      </Popover>

      {/* ── Collapsible Conditional Alternative Rotations Editor */}
      <Collapse in={rotationsOpen} unmountOnExit>
        <Box
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
              <Typography sx={{ ...type.label, mt: 0.25, maxWidth: 660 }}>
                {t(
                  'teamOpt.invest.altRotDesc',
                  'For constellations that unlock extra skill casts, faster ATK SPD, or longer combos, set an alternative rotation below. Higher constellations inherit it automatically.'
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
            {keys.map((k) => {
              const count = Object.keys(rotationsOf[k] ?? {}).length
              const active = rotTab === k
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
                  {count > 0 && (
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
                fontWeight: rotTab === 'combos' ? 650 : 550,
                color:
                  rotTab === 'combos' ? giTokens.goldLight : 'text.secondary',
                bgcolor:
                  rotTab === 'combos'
                    ? alpha(tokens.gold, 0.14)
                    : alpha(giTokens.parchment, 0.04),
                border: `1px solid ${rotTab === 'combos' ? alpha(tokens.gold, 0.45) : tokens.hairline}`,
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

          {rotTab === 'combos' ? (
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
              characterKey={rotTab}
              ran={baseConsMap[rotTab] ?? 0}
              rotations={rotationsOf[rotTab] ?? {}}
              teamText={teamText}
              names={names}
              gender={gender}
              aboveOnly
              onChange={(next) => setRotations(rotTab, next)}
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

      {/* ── Running progress */}
      {running && (
        <Box sx={{ mt: 2, display: 'grid', gap: 0.875 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Typography sx={{ fontSize: 13.5, fontWeight: 550 }}>
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
              height: 4,
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

      {/* ── Clean Idle State (before first click) */}
      {!running && !plan && (
        <Box
          sx={{
            mt: 1.75,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 1.5,
          }}
        >
          <Typography sx={{ ...type.label, lineHeight: 1.55 }}>
            {totalRoom > 0
              ? t('teamOpt.invest.readySimple', {
                  defaultValue:
                    'Find the highest-value ways to spend up to +{{budget}} 5★ pulls across {{members}} members{{sigPart}}.',
                  budget: targetBudget,
                  members: effectiveIncluded.filter(Boolean).length,
                  sigPart: canAddSig.some(Boolean)
                    ? t('teamOpt.invest.readySigShort', ' (cons & R1 sigs)')
                    : '',
                })
              : t(
                  'teamOpt.invest.noRoom',
                  'Select at least one member with available upgrades in Options.'
                )}
          </Typography>
          {mode === 'inventory' && totalRoom > 0 && (
            <Typography sx={{ ...type.label, fontSize: 12, opacity: 0.8 }}>
              {t(
                'teamOpt.invest.invNote',
                'Uses this run’s artifacts · KQM tab refits stats per upgrade'
              )}
            </Typography>
          )}
        </Box>
      )}

      {/* ── Unified Overall View (No tabs! Everything readable in one glance!) */}
      {!running && plan && plan.maxBudget > 0 && (
        <Box sx={{ mt: 2.25, display: 'grid', gap: 2.5 }}>
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
                      lg: 'minmax(270px, 0.72fr) minmax(0, 1.28fr)',
                    }
                  : 'minmax(0, 1fr)',
            }}
          >
            {/* Left: Optimal Wishing Roadmap (+1 -> +2 -> +3 ...), also acts as instant budget switcher */}
            {plan.maxBudget > 1 && (
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  component="h3"
                  sx={{
                    fontSize: 12.5,
                    fontWeight: 650,
                    letterSpacing: '0.03em',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                    mb: 1,
                  }}
                >
                  {t('teamOpt.invest.optimalOrder', 'Best path by pull count')}
                </Typography>
                <Box sx={{ ...insetSx, overflow: 'hidden' }}>
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
                          gridTemplateColumns: '42px minmax(0, 1fr) auto',
                          alignItems: 'center',
                          columnGap: 1.25,
                          px: 1.5,
                          py: 1.25,
                          borderTop: i > 0 ? hairline : 'none',
                          borderLeft: `2px solid ${active ? tokens.gold : 'transparent'}`,
                          bgcolor: active
                            ? alpha(tokens.gold, 0.09)
                            : 'transparent',
                          ...quickSx,
                          ...focusSx,
                          '&:hover': {
                            bgcolor: active
                              ? alpha(tokens.gold, 0.12)
                              : alpha(giTokens.parchment, 0.04),
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
                          {renderUpgradeLine(row, active)}
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
                    fontSize: 12.5,
                    fontWeight: 650,
                    letterSpacing: '0.03em',
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

              <Box sx={{ ...insetSx, overflow: 'hidden' }}>
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
                          ? alpha(tokens.gold, 0.055)
                          : undefined,
                        display: 'grid',
                        gap: { xs: 1, sm: 1.75 },
                        gridTemplateColumns: {
                          xs: 'minmax(0, 1fr) auto',
                          sm: '22px minmax(0, 1.35fr) minmax(110px, 0.7fr) auto',
                        },
                        alignItems: 'center',
                      }}
                    >
                      {/* Clean numeric rank */}
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

                      {/* Upgrade path + optional rotation/unmet note */}
                      <Box sx={{ minWidth: 0, display: 'grid', gap: 0.375 }}>
                        {renderUpgradeLine(path, isWinner)}
                        {(path.rotationLabel || timeDiff || path.unmet) && (
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
                              <Typography
                                sx={{
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  color: giTokens.goldLight,
                                }}
                              >
                                {path.rotationLabel}
                                {path.seconds
                                  ? ` · ${path.seconds.toFixed(1)}s`
                                  : ''}
                              </Typography>
                            )}
                            {!path.rotationLabel && timeDiff && (
                              <Typography
                                sx={{ fontSize: 11.5, color: 'text.secondary' }}
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
                                  {t('teamOpt.invest.erShortfall', 'ER unmet')}
                                </Box>
                              </Tooltip>
                            )}
                          </Box>
                        )}
                      </Box>

                      {/* Gain-scaled comparison bar (shows relative gain clearly!) */}
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
                            }}
                          />
                        )}
                      </Box>

                      {/* Clean, uncluttered figures */}
                      <Box
                        sx={{
                          textAlign: 'right',
                          minWidth: { sm: 136 },
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
                                  : path.gainPct < -0.0005
                                    ? 'text.secondary'
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

          {/* Bottom Overview Strip: All members' individual upgrades side-by-side (zero tab switching!) */}
          {evaluatedMembers.length > 0 && (
            <Box>
              <Typography
                component="h3"
                sx={{
                  fontSize: 12.5,
                  fontWeight: 650,
                  letterSpacing: '0.03em',
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
                    icon?: string
                    label: string
                    sub?: string
                    gainVsBase: number
                    stepGain: number
                    dps: number
                    rot?: string
                  }[] = []
                  if (sigEv && sigKey) {
                    const gain = baseDps > 0 ? sigEv.dps / baseDps - 1 : 0
                    entries.push({
                      id: 'sig',
                      icon: weaponAsset(sigKey, true),
                      label: 'R1',
                      sub: t(`weaponNames_gen:${sigKey}`, sigKey),
                      gainVsBase: gain,
                      stepGain: gain,
                      dps: sigEv.dps,
                      rot: sigEv.rotationLabel,
                    })
                  }
                  for (const c of consLevels) {
                    const ev = consMap[c]
                    const gain = baseDps > 0 ? ev.dps / baseDps - 1 : 0
                    const step = prevDps > 0 ? ev.dps / prevDps - 1 : 0
                    entries.push({
                      id: `c${c}`,
                      icon:
                        characterAsset(
                          ck,
                          `constellation${c}` as 'constellation1',
                          gender
                        ) ?? undefined,
                      label: `C${c}`,
                      gainVsBase: gain,
                      stepGain: step,
                      dps: ev.dps,
                      rot: ev.rotationLabel,
                    })
                    prevDps = ev.dps
                  }
                  return (
                    <Box
                      key={ck}
                      sx={{
                        ...insetSx,
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
                        {entries.map((entry) => (
                          <Tooltip
                            key={entry.id}
                            arrow
                            placement="top"
                            title={
                              <Box sx={numSx}>
                                <div>
                                  {entry.sub ?? entry.label}:{' '}
                                  {formatRateFull(entry.dps, undefined)}{' '}
                                  {unitLabel} ({formatGain(entry.gainVsBase)} vs
                                  base)
                                </div>
                                {entry.id !== 'sig' &&
                                  entry.label !== `C${baseC + 1}` && (
                                    <div>
                                      {t('teamOpt.invest.stepFromPrev', {
                                        defaultValue: '{{step}} over previous',
                                        step: formatGain(entry.stepGain),
                                      })}
                                    </div>
                                  )}
                                {entry.rot && <div>{entry.rot}</div>}
                              </Box>
                            }
                          >
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                                py: 0.25,
                                cursor: 'default',
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
                                  fontWeight: 650,
                                  minWidth: 26,
                                  ...numSx,
                                }}
                              >
                                {entry.label}
                              </Typography>
                              {entry.sub && (
                                <Typography
                                  noWrap
                                  sx={{
                                    ...type.label,
                                    fontSize: 11.5,
                                    flex: 1,
                                    minWidth: 0,
                                  }}
                                >
                                  {entry.sub}
                                </Typography>
                              )}
                              {!entry.sub && <Box sx={{ flex: 1 }} />}
                              <Typography
                                sx={{
                                  fontSize: 13,
                                  fontWeight: 700,
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
                        ))}
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
