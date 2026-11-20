import { useDataEntryBase } from '@genshin-optimizer/common/database-ui'
import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  TeamKqmSavedRun,
  TeamOpt,
  TeamOptEnergyMember,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type {
  KqmPlayed,
  KqmResult,
  KqmSets,
  KqmStep,
  TeamData,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  ArtifactSetName,
  CharacterName,
  kitModels,
  kqmMemberConstellation,
  kqmSets,
  kqmSimGear,
  kqmWeapons,
  parseRotation,
  teamOptMembers,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import {
  Autocomplete,
  alpha,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  InputLabel,
  LinearProgress,
  MenuItem,
  Radio,
  RadioGroup,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import type { i18n as I18n, TFunction } from 'i18next'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { KqmResults } from '../KqmMode'
import { MemberAvatar } from '../MemberAvatar'
import { readKqmRotation } from '../RotationWriter'
import { useSimText } from '../simText'
import {
  BetaBadge,
  Disclosure,
  EmptyLine,
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  Panel,
  PanelHeader,
  Segmented,
  tokens,
  type,
} from '../ui'
import {
  type KqmRotation,
  kqmReplayOf,
  kqmShownView,
  useKqmRunning,
} from '../useKqmRun'
import { CompareCardButton } from './CompareCardButton'
import { Overview } from './CompareOverview'
import { compareFailureText } from './compareError'
import type { CompareSwapPreview, Side, SwapIn } from './compareSwapKqm'
import { compareSwapKqm } from './compareSwapKqm'
import { srOnly, WarningLine } from './compareUi'
import type { EnteringPassives, EnteringWeaponEnergy } from './EnteringSettings'
import { EnteringSettings } from './EnteringSettings'
import type { SavedKqmRun } from './savedRun'
import { savedRunOf } from './savedRun'
import {
  leavingSteps,
  memberActions,
  memberOpenerActions,
  swapFragment,
} from './swapFragment'

/*
 * KQM Compare (Alpha): KQM Theorycrafting's last result (A) against the same team with one member
 * swapped (B). Everything here is read only or kept in this screen's state: nothing is written to
 * the database, the team's settings, its saved KQM result or its rotation.
 */

/**
 * KQM Theorycrafting's saved run for the team, as that tab shows it: a finished run, for the
 * team's current members (undefined once they changed)
 */
export function savedRunFor(
  database: ArtCharDatabase,
  teamId: string
): TeamKqmSavedRun | undefined {
  const saved = database.teamKqmResults.getRun(teamId)
  if (!saved) return undefined
  const run = savedRunOf(saved)
  if (run.type !== 'done' || !run.result || !run.teamOpt) return undefined
  const members = teamOptMembers(database, teamId).map(
    (m) => m.characterKey as string
  )
  if (
    saved.members.length !== members.length ||
    !saved.members.every((k) => members.includes(k))
  )
    return undefined
  return saved
}

/**
 * The saved run as KQM Theorycrafting's results show it: with the weapons and sets picked in its
 * inspector (in this visit), the team as it plays with them (its damage, ER, rotation played)
 */
export function withShownPicks(
  teamId: string,
  saved: TeamKqmSavedRun | undefined
): TeamKqmSavedRun | undefined {
  if (!saved) return saved
  const view = kqmShownView(teamId, saved.savedAt)
  if (!view) return saved
  return { ...saved, run: { ...saved.run, result: view } as never }
}

const setsId = (sets: KqmSets) =>
  Object.entries(sets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, n]) => `${k}:${n}`)
    .join('+')

/** The members whose weapon or sets A has as picked in KQM Theorycrafting, not as its run found */
export function pickedMembers(
  saved: TeamKqmSavedRun | undefined,
  original: TeamKqmSavedRun | undefined
): CharacterKey[] {
  const picked = saved && savedRunOf(saved).result
  const own = original && savedRunOf(original).result
  if (!picked || !own || picked === own) return []
  return (Object.keys(picked.builds) as CharacterKey[]).filter((k) => {
    const a = picked.builds[k]
    const b = own.builds[k]
    return (
      !!a &&
      !!b &&
      (a.weapon.key !== b.weapon.key ||
        a.weapon.refinement !== b.weapon.refinement ||
        setsId(a.sets) !== setsId(b.sets))
    )
  })
}

/**
 * Team B's KQM result as its results screen shows it: on B's throwaway copy of the database
 * (never the user's), with B's settings and rotation (kept the same objects while shown)
 */
interface ResultsB {
  result: KqmResult
  database: ArtCharDatabase
  teamOpt: TeamOpt
  rotation: KqmRotation
  members: TeamOptMember[]
  /** Since the run started (its inspector opens again for each new result) */
  seconds: number
}

type RunState =
  | { type: 'idle' }
  | { type: 'running' }
  | {
      type: 'done'
      a: Side
      b: Side
      out: CharacterKey
      in: CharacterKey
      /** The settings it was worked out with (`inputs`) */
      for: string
      /** B's KQM result (absent: the run gave none) */
      resultsB?: ResultsB
      /**
       * The entering member's rankings: still worked out after the headline, done, cancelled
       * (the headline kept), or failed (`rankingError`, the headline kept)
       */
      rankings: 'pending' | 'done' | 'cancelled' | 'failed'
      rankingError?: string
      /** The run's progress (0 to 1) when the headline came: where its rankings start */
      rankingFrom: number
    }
  | { type: 'error'; message: string }

const PROGRESS_MS = 120

/**
 * Two plays of a rotation alike: the same time, each member's hits of each attack (however its buff
 * windows are split), within rounding
 */
function samePlay(x: KqmPlayed, y: KqmPlayed) {
  if (Math.abs((x.rotationTime ?? 0) - (y.rotationTime ?? 0)) > 0.15)
    return false
  const hits = (p: KqmPlayed) => {
    const out = new Map<string, number>()
    for (const [k, attacks] of Object.entries(p.attacks ?? {}))
      for (const a of attacks ?? []) {
        const id = `${k}|${a.path.join('.')}|${a.hitMode}|${a.reaction ?? ''}`
        out.set(id, (out.get(id) ?? 0) + a.hits)
      }
    return out
  }
  const hx = hits(x)
  const hy = hits(y)
  for (const id of new Set([...hx.keys(), ...hy.keys()])) {
    const a = hx.get(id) ?? 0
    const b = hy.get(id) ?? 0
    if (Math.abs(a - b) > Math.max(0.05, 0.02 * Math.max(a, b))) return false
  }
  return true
}

export default function KqmCompare({
  teamId,
  teamData,
}: {
  teamId: string
  /** The team's data: where the entering member's effect states that depend on a character are read */
  teamData?: TeamData
}) {
  const simText = useSimText()
  const { t, i18n } = useTranslation(['juanlab', 'charNames_gen'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  const navigate = useNavigate()
  const titleId = useId()

  // KQM Theorycrafting's result, read again when one of its runs ends (or saves a result) and
  // when Confronta finds it changed; Confronta waits while a run goes on (in any tab)
  const kqmRunning = useKqmRunning(teamId)
  const results = useDataEntryBase(database.teamKqmResults)
  const [reread, setReread] = useState(0)
  // (A: the team as KQM Theorycrafting's results show it, the weapons and sets picked there
  // included)
  const original = useMemo(
    () => savedRunFor(database, teamId),
    [database, teamId, kqmRunning, results, reread]
  )
  const saved = useMemo(
    () => withShownPicks(teamId, original),
    [teamId, original]
  )
  const picked = useMemo(
    () => pickedMembers(saved, original),
    [saved, original]
  )
  const run: SavedKqmRun | undefined = saved && savedRunOf(saved)
  const teamKqm: TeamOptKqm | undefined = run?.teamOpt?.kqm
  const members = useMemo(
    () => teamOptMembers(database, teamId).map((m) => m.characterKey),
    [database, teamId]
  )
  // (KQM Theorycrafting's written rotation, read only)
  const { text, opener } = useMemo(
    () => readKqmRotation(database, teamId),
    [database, teamId]
  )
  // (as KQM plays the rotation: the names in the user's language)
  const nameOf = useCallback(
    (ck: CharacterKey) =>
      t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`),
    [t, gender]
  )

  // the swap (this screen's state only)
  const [out, setOut] = useState<CharacterKey>()
  const [inKey, setInKey] = useState<CharacterKey | null>(null)
  const [constellation, setConstellation] = useState(0)
  const [auto, setAuto] = useState(true)
  const [weapon, setWeapon] = useState<WeaponKey | ''>('')
  const [refinement, setRefinement] = useState(1)
  const [setKey, setSetKey] = useState<ArtifactSetKey | ''>('')
  /** 4 pieces of one set, or 2 + 2 */
  const [setMode, setSetMode] = useState<'4' | '2+2'>('4')
  const [setKey2, setSetKey2] = useState<ArtifactSetKey | ''>('')
  const [passives, setPassives] = useState<EnteringPassives>({})
  const [weaponEnergy, setWeaponEnergy] = useState<EnteringWeaponEnergy>({})
  const [erText, setErText] = useState('')
  const [calcOwn, setCalcOwn] = useState<TeamOptEnergyMember>()
  const [fragment, setFragment] = useState('')
  /** What the fragment was filled in with (the leaving member's actions), while it holds it */
  const [prefilled, setPrefilled] = useState<string>()
  /** The entering member's actions in the opener, when the leaving member acts there too */
  const [openerFragment, setOpenerFragment] = useState('')
  const [prefilledOpener, setPrefilledOpener] = useState<string>()
  /** The result confirmed final (its `savedAt`): a confirmation is for that result only */
  const [confirmedAt, setConfirmedAt] = useState<number>()
  const confirmed = !!saved && confirmedAt === saved.savedAt
  /** Confirmed, then KQM Theorycrafting's result changed */
  const resultChanged = confirmedAt !== undefined && !confirmed
  const [settingsOpen, setSettingsOpen] = useState(false)

  // the members' names as A's rotation is read
  const namesA = useMemo(
    () => members.map((ck) => ({ characterKey: ck, name: nameOf(ck) })),
    [members, nameOf]
  )
  /**
   * The entering member picked: its settings start from nothing, or, for the leaving member
   * entering again, from A's (its constellation in A's result, its KQM settings), so B differs
   * from A only in what is changed here. The fragment is filled in with the leaving member's
   * actions in A's rotation when it is empty or still holds what was filled in; a fragment the
   * user wrote is kept.
   */
  const chooseIn = (key: CharacterKey | null) => {
    if (key === inKey) return
    setInKey(key)
    const same = !!key && key === out
    const own = same ? teamKqm : undefined
    // (A's result's, as A's members show it, also for a run saved without KQM settings)
    setConstellation(
      !key
        ? 0
        : same
          ? (run?.result?.constellations?.[key] ??
            kqmMemberConstellation(key, teamKqm))
          : kqmMemberConstellation(key, undefined)
    )
    setWeapon('')
    setSetKey('')
    setSetKey2('')
    const er = key ? own?.energyRecharge?.[key] : undefined
    setErText(er !== undefined ? String(er) : '')
    setCalcOwn(key ? own?.energyCalculator?.members[key] : undefined)
    setPassives((key && own?.passives?.[key]) || {})
    setWeaponEnergy(
      key && own?.weaponEnergy
        ? Object.fromEntries(
            Object.entries(own.weaponEnergy).flatMap(([w, byMember]) => {
              const v = byMember?.[key]
              return v !== undefined ? [[w, v]] : []
            })
          )
        : {}
    )
    const actions = same ? memberActions(text, opener, namesA, key) : undefined
    if (!fragment.trim() || fragment === prefilled) {
      setFragment(actions ?? '')
      setPrefilled(actions)
    } else setPrefilled(undefined)
    // (its opener step too, when it acts there as well)
    const openerActions = same
      ? memberOpenerActions(text, opener, namesA, key)
      : undefined
    if (!openerFragment.trim() || openerFragment === prefilledOpener) {
      setOpenerFragment(openerActions ?? '')
      setPrefilledOpener(openerActions)
    } else setPrefilledOpener(undefined)
  }
  /** Who leaves: an entering member that is a teammate again (the one leaving before) goes */
  const chooseOut = (key: CharacterKey) => {
    setOut(key)
    if (inKey && inKey !== key && members.includes(inKey)) chooseIn(null)
  }

  const weapons = useMemo(
    () => (inKey ? kqmWeapons(inKey, teamKqm, { all: true }) : []),
    [inKey, teamKqm]
  )
  const sets = useMemo(() => kqmSets(), [])
  const candidates = useMemo(
    () =>
      (Object.keys(kitModels) as CharacterKey[])
        // (the leaving member too: the same member at another constellation, weapon or sets)
        .filter((k) => !members.includes(k) || k === out)
        .map((k) => ({ key: k, name: nameOf(k) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [members, nameOf, out]
  )

  const calculator = teamKqm?.energySource === 'calculator'
  const erValue = erText.trim() ? Number(erText.replace(',', '.')) : undefined
  const erInvalid =
    erValue !== undefined && !(Number.isFinite(erValue) && erValue >= 100)

  // the fixed sets: 4 pieces, or 2 + 2 of two different sets
  const pickedSets: KqmSets | undefined = useMemo(
    () =>
      setMode === '4'
        ? setKey
          ? { [setKey]: 4 }
          : undefined
        : setKey && setKey2 && setKey !== setKey2
          ? { [setKey]: 2, [setKey2]: 2 }
          : undefined,
    [setMode, setKey, setKey2]
  )
  const swapIn: SwapIn | undefined = useMemo(() => {
    if (!inKey) return undefined
    if (!auto && (!weapon || !pickedSets)) return undefined
    // (0 too: A's, for the leaving member entering again)
    const energyEntries = Object.entries(weaponEnergy).filter(
      ([, v]) => v !== undefined
    )
    const own: Partial<TeamOptKqm> = {
      ...(Object.keys(passives).length && { passives: { [inKey]: passives } }),
      ...(energyEntries.length && {
        weaponEnergy: Object.fromEntries(
          energyEntries.map(([w, v]) => [w, { [inKey]: v }])
        ),
      }),
      ...(!calculator &&
        erValue !== undefined &&
        !erInvalid && { energyRecharge: { [inKey]: erValue } }),
      ...(calculator &&
        calcOwn &&
        teamKqm?.energyCalculator && {
          energyCalculator: {
            ...teamKqm.energyCalculator,
            members: { [inKey]: calcOwn },
          },
        }),
    }
    return {
      key: inKey,
      constellation,
      weapon: auto ? 'auto' : { key: weapon as WeaponKey, refinement },
      sets: auto ? 'auto' : pickedSets!,
      build: 'kqm',
      kqm: own,
    }
  }, [
    inKey,
    auto,
    weapon,
    pickedSets,
    refinement,
    constellation,
    calculator,
    erValue,
    erInvalid,
    calcOwn,
    teamKqm,
    passives,
    weaponEnergy,
  ])

  // B's rotation, as the comparison will play it
  const swapped = useMemo(() => {
    if (!out || !inKey || !text.trim()) return undefined
    return swapFragment({
      text,
      opener,
      names: namesA,
      out,
      inName: nameOf(inKey),
      fragment,
      openerFragment,
      same: inKey === out,
    })
  }, [out, inKey, text, opener, namesA, fragment, openerFragment, nameOf])
  /** The leaving member acts in the rotation and in the opener: both steps are replaced */
  const inBoth = useMemo(() => {
    if (!out) return false
    const steps = leavingSteps(text, opener, namesA, out)
    return steps.inText === 1 && steps.inOpener === 1
  }, [out, text, opener, namesA])
  const warnings = useMemo(() => {
    if (!swapped?.ok || !out || !inKey) return []
    const names = members.map((ck) => {
      const key = ck === out ? inKey : ck
      return { characterKey: key, name: nameOf(key) }
    })
    return [
      ...parseRotation(swapped.opener, names).warnings,
      ...parseRotation(swapped.text, names).warnings,
    ]
  }, [swapped, members, out, inKey, nameOf])

  // the run
  const [state, setState] = useState<RunState>({ type: 'idle' })
  const [step, setStep] = useState<KqmStep>()
  const job = useRef<{ cancelled: boolean }>()
  // leaving the tab cancels the run
  useEffect(
    () => () => {
      if (job.current) job.current.cancelled = true
    },
    []
  )
  const running = state.type === 'running'
  /** The headline shown, B's rankings still worked out */
  const ranking = state.type === 'done' && state.rankings === 'pending'
  // Cancel's button goes once pressed: the focus goes to B's section title (cancelled while
  // ranking), else back to Confronta
  const resultsTitle = useRef<HTMLElement>(null)
  const runButton = useRef<HTMLButtonElement>(null)
  const refocus = useRef<'results' | 'run'>()
  useEffect(() => {
    const to = refocus.current
    if (!to) return
    refocus.current = undefined
    ;(to === 'results' ? resultsTitle : runButton).current?.focus()
  }, [state])
  // (cancelled while ranking: the headline and B's builds stay, without rankings)
  const cancel = () => {
    if (job.current) job.current.cancelled = true
    job.current = undefined
    refocus.current = ranking ? 'results' : 'run'
    setState((s) =>
      s.type === 'done' && s.rankings === 'pending'
        ? { ...s, rankings: 'cancelled' }
        : { type: 'idle' }
    )
  }

  const outName = out ? nameOf(out) : ''
  const inName = inKey ? nameOf(inKey) : ''
  const fragmentError =
    swapped &&
    !swapped.ok &&
    swapped.error !== 'emptyFragment' &&
    swapped.error !== 'emptyOpenerFragment'
      ? swapped.error === 'notFound'
        ? t('kqmCompare.error.notFound', { name: outName })
        : t('kqmCompare.error.repeated', {
            name: outName,
            count: swapped.count,
          })
      : undefined
  // (a refused fragment before an empty one: for the leaving member re-entering, it says why its
  // fragment was not filled in)
  const problem = !saved
    ? t('kqmCompare.noResult')
    : kqmRunning
      ? t('kqmCompare.kqmRunning')
      : !text.trim()
        ? t('kqmCompare.error.noRotation')
        : !out
          ? t('kqmCompare.need.out')
          : !inKey
            ? t('kqmCompare.need.in')
            : !auto && (!weapon || !pickedSets)
              ? t('kqmCompare.need.gear')
              : erInvalid
                ? t('kqmCompare.need.er')
                : fragmentError
                  ? fragmentError
                  : !fragment.trim()
                    ? t('kqmCompare.need.fragment', { name: inName })
                    : inBoth && !openerFragment.trim()
                      ? t('kqmCompare.need.fragmentOpener', { name: inName })
                      : !confirmed
                        ? t('kqmCompare.need.confirm')
                        : ''
  const canRun =
    !problem &&
    !running &&
    !kqmRunning &&
    !!saved &&
    !!out &&
    !!swapIn &&
    !!swapped?.ok
  /** What a result is for: when these change, it is the previous settings' */
  const inputs = JSON.stringify([
    saved?.savedAt,
    out,
    swapIn,
    text,
    opener,
    fragment,
    openerFragment,
  ])

  const start = async () => {
    if (!canRun || !saved || !out || !swapIn) return
    // (KQM Theorycrafting may have saved another result meanwhile, in another tab: A is read
    // again, and confirmed again)
    if (savedRunFor(database, teamId)?.savedAt !== saved.savedAt) {
      setReread((n) => n + 1)
      return
    }
    const runFor = inputs
    // (a run going on, its rankings included, is replaced; its B and sandbox dropped)
    if (job.current) job.current.cancelled = true
    const mine = { cancelled: false }
    job.current = mine
    setState({ type: 'running' })
    setStep(undefined)
    // (progress a few times a second, not on every step)
    let last = 0
    let pending: ReturnType<typeof setTimeout> | undefined
    let latest: KqmStep | undefined
    const onStep = (s: KqmStep) => {
      latest = s
      if (pending) return
      const wait = Math.max(0, PROGRESS_MS - (performance.now() - last))
      pending = setTimeout(() => {
        pending = undefined
        last = performance.now()
        if (!mine.cancelled) setStep(latest)
      }, wait)
    }
    const startTime = performance.now()
    /** B's results screen, from the headline or the final result (its rotation kept the same) */
    const resultsOf = (
      p: Partial<CompareSwapPreview>,
      before?: ResultsB
    ): ResultsB | undefined => {
      if (!p.resultB || !p.sandbox || !p.teamOptB || !p.rotationB)
        return undefined
      const same = before?.database === p.sandbox
      return {
        result: p.resultB,
        database: p.sandbox,
        teamOpt: p.teamOptB,
        rotation: same ? before.rotation : p.rotationB,
        members: same ? before.members : teamOptMembers(p.sandbox, teamId),
        seconds: (performance.now() - startTime) / 1000,
      }
    }
    let previewed = false
    // (the running state paints first)
    await new Promise((resolve) => setTimeout(resolve, 0))
    // (cancelled or the tab left meanwhile: nothing starts)
    if (mine.cancelled) return
    try {
      const result = await compareSwapKqm({
        database,
        teamId,
        gender,
        i18n: i18n as I18n,
        saved,
        out,
        swapIn,
        text,
        opener,
        fragment,
        openerFragment,
        onStep,
        isCancelled: () => mine.cancelled,
        // (the summary as soon as B's build is known: the rankings follow)
        onPreview: (preview) => {
          if (mine.cancelled) return
          previewed = true
          setState({
            type: 'done',
            a: preview.a,
            b: preview.b,
            out,
            in: swapIn.key,
            for: runFor,
            resultsB: resultsOf(preview),
            rankings: 'pending',
            rankingFrom: latest?.progress ?? 0,
          })
        },
      })
      if (mine.cancelled) return
      if ('error' in result)
        setState(
          result.error === 'cancelled'
            ? { type: 'idle' }
            : {
                type: 'error',
                message: errorText(result.error, result.count),
              }
        )
      else
        setState((s) => ({
          type: 'done',
          a: result.a,
          b: result.b,
          out,
          in: swapIn.key,
          for: runFor,
          resultsB: resultsOf(
            result,
            s.type === 'done' ? s.resultsB : undefined
          ),
          rankings: 'done',
          rankingFrom: s.type === 'done' ? s.rankingFrom : 0,
        }))
    } catch (e) {
      if (mine.cancelled) return
      console.error(e)
      // (a known failure in the user's language)
      const message = compareFailureText(e, t as unknown as TFunction, nameOf)
      // (after the headline: it stays, B's rankings said failed)
      setState((s) =>
        previewed && s.type === 'done'
          ? { ...s, rankings: 'failed', rankingError: message }
          : { type: 'error', message }
      )
    } finally {
      if (pending) clearTimeout(pending)
      if (job.current === mine) job.current = undefined
    }
  }
  const errorText = (error: string, count?: number) =>
    error === 'inTeam'
      ? t('kqmCompare.error.inTeam', { name: inName })
      : error === 'notFound'
        ? t('kqmCompare.error.notFound', { name: outName })
        : error === 'repeated'
          ? t('kqmCompare.error.repeated', { name: outName, count })
          : error === 'emptyFragment'
            ? t('kqmCompare.need.fragment', { name: inName })
            : error === 'emptyOpenerFragment'
              ? t('kqmCompare.need.fragmentOpener', { name: inName })
              : t('kqmCompare.error.unsupported')

  const savedAt = saved ? formatWhen(saved.savedAt, i18n.language) : ''
  // the written rotation changed since A: it plays differently now from how A played it (with
  // A's settings, constellations, weapons and sets), or the ER was worked out for another one
  const [playsDifferently, setPlaysDifferently] = useState(false)
  useEffect(() => {
    setPlaysDifferently(false)
    const result = run?.result
    const played = result?.played
    const settings = run?.teamOpt
    if (run?.rotation !== 'played' || !result || !played || !settings) return
    if (!text.trim()) return
    let cancelled = false
    // (a play takes tens of ms: after the page shows)
    const id = setTimeout(() => {
      let changed = false
      try {
        const now = kqmReplayOf(
          database,
          gender,
          i18n as I18n,
          teamId,
          settings,
          text,
          opener
        )?.({
          constellations: result.constellations ?? {},
          gear: Object.fromEntries(
            Object.entries(result.builds).flatMap(([k, b]) =>
              b ? [[k, kqmSimGear(b)]] : []
            )
          ),
          overrides: {},
        })
        changed = !!now && !samePlay(now, played)
      } catch {
        changed = false
      }
      if (!cancelled) setPlaysDifferently(changed)
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [run, database, gender, i18n, teamId, text, opener])
  // (recorded as "text|opener and timing" (KqmMode's useRotationEnergy): its text against the
  // written one; an opener or timing change shows in how the rotation plays, above)
  const recorded = run?.teamOpt?.kqm?.energyRotation?.split('|')[0]
  const rotationChanged =
    playsDifferently ||
    (recorded !== undefined && recorded.trim() !== text.trim())
  // (A's damage is for the attacks entered, not the written rotation played)
  const notPlayed = !!run && run.rotation !== 'played'
  /** The result shown is for settings changed since */
  const stale = state.type === 'done' && state.for !== inputs
  // (while ranking: the rankings' own progress, from the headline to the end)
  const from = state.type === 'done' ? state.rankingFrom : 0
  const progress = ranking
    ? from < 1
      ? Math.max(0, ((step?.progress ?? 0) - from) / (1 - from))
      : 0
    : (step?.progress ?? 0)
  const percent = Math.round(progress * 100)
  const busy = running || ranking
  const statusText = running
    ? t('kqmCompare.running', { percent })
    : ranking
      ? t('kqmCompare.ranking', { percent })
      : state.type === 'done' && state.resultsB
        ? state.rankings === 'done'
          ? t('kqmCompare.results.ready')
          : state.rankings === 'cancelled'
            ? t('kqmCompare.results.cancelled')
            : ''
        : ''

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Panel component="section" sx={{ position: 'relative' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 0.5,
            mb: 0.5,
          }}
        >
          <Typography id={titleId} component="h2" sx={type.section}>
            {t('kqmCompare.title')}
          </Typography>
          <BetaBadge
            label={t('kqmCompare.alpha')}
            tip={t('kqmCompare.alphaTip')}
          />
          <InfoTooltipInline title={t('kqmCompare.info')} />
        </Box>

        {!saved ? (
          <EmptyLine
            info={t('kqmCompare.noResultTip')}
            action={
              <Button
                size="small"
                color="inherit"
                onClick={() => navigate(`/teams/${teamId}/kqm`)}
                sx={{ ml: 1, ...focusSx }}
              >
                {t('kqmCompare.openKqm')}
              </Button>
            }
            sx={{ my: 1 }}
          >
            {t('kqmCompare.noResult')}
          </EmptyLine>
        ) : (
          <Typography sx={{ ...type.label, mb: 2 }}>
            {t('kqmCompare.resultOf', { date: savedAt })}
            {/* (the weapons or sets picked in KQM Theorycrafting's results: A plays with them) */}
            {picked.length > 0 && (
              <>
                <br />
                {t('kqmCompare.withPicks', {
                  names: picked.map(nameOf).join(', '),
                })}
              </>
            )}
          </Typography>
        )}

        {saved && (
          <Box
            component="fieldset"
            disabled={running}
            aria-labelledby={titleId}
            sx={{
              border: 0,
              m: 0,
              p: 0,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            {/* who leaves; the others stay as they are in A */}
            <Row label={t('kqmCompare.out')}>
              <Segmented
                aria-label={t('kqmCompare.out')}
                value={out}
                onChange={chooseOut}
                wrap
                options={members.map((key) => ({
                  value: key,
                  label: (
                    <Box
                      component="span"
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.75,
                      }}
                    >
                      <MemberAvatar characterKey={key} size={20} />
                      <CharacterName characterKey={key} gender={gender} />
                    </Box>
                  ),
                }))}
              />
            </Row>
            {out && (
              <Row
                label={
                  <FieldLabel tip={t('kqmCompare.fixedTip')}>
                    {t('kqmCompare.fixed')}
                  </FieldLabel>
                }
              >
                <FixedMembers
                  label={t('kqmCompare.fixed')}
                  keys={members.filter((k) => k !== out)}
                  run={run}
                  locked={t('kqmCompare.locked')}
                />
              </Row>
            )}

            {/* who enters: everything about it is open */}
            <Row label={t('kqmCompare.in')}>
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 1.5,
                  minWidth: 0,
                }}
              >
                <Autocomplete
                  size="small"
                  options={candidates}
                  value={candidates.find((c) => c.key === inKey) ?? null}
                  onChange={(_e, value) => chooseIn(value?.key ?? null)}
                  getOptionLabel={(o) => o.name}
                  isOptionEqualToValue={(o, v) => o.key === v.key}
                  renderOption={(props, o) => (
                    <Box
                      component="li"
                      {...props}
                      key={o.key}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                    >
                      <MemberAvatar characterKey={o.key} size={22} />
                      {o.name}
                    </Box>
                  )}
                  renderInput={(params) => (
                    <TextField {...params} label={t('kqmCompare.character')} />
                  )}
                  sx={{ width: { xs: '100%', sm: 220 } }}
                />
                <FormControl size="small" sx={{ width: 88 }}>
                  <InputLabel id={`${titleId}-cons`}>
                    {t('kqmCompare.constellation')}
                  </InputLabel>
                  <Select
                    labelId={`${titleId}-cons`}
                    label={t('kqmCompare.constellation')}
                    value={constellation}
                    disabled={!inKey || running}
                    onChange={(e) => setConstellation(Number(e.target.value))}
                    sx={numSx}
                  >
                    {[0, 1, 2, 3, 4, 5, 6].map((c) => (
                      <MenuItem key={c} value={c}>
                        C{c}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
            </Row>
            {inKey && (
              <Row label={t('kqmCompare.gear')}>
                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 1.5,
                    minWidth: 0,
                  }}
                >
                  <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={auto}
                          onChange={(e) => setAuto(e.target.checked)}
                        />
                      }
                      label={t('kqmCompare.auto')}
                      sx={{ mr: 0 }}
                    />
                    <InfoTooltipInline title={t('kqmCompare.autoTip')} />
                  </Box>
                  <FormControl
                    size="small"
                    sx={{ width: { xs: '100%', sm: 240 } }}
                  >
                    <InputLabel id={`${titleId}-weapon`}>
                      {t('kqmCompare.weapon')}
                    </InputLabel>
                    <Select
                      labelId={`${titleId}-weapon`}
                      label={t('kqmCompare.weapon')}
                      value={auto ? '' : weapon}
                      disabled={auto || running}
                      onChange={(e) => {
                        const key = e.target.value as WeaponKey
                        setWeapon(key)
                        setRefinement(
                          weapons.find((w) => w.key === key)?.refinement ?? 1
                        )
                      }}
                    >
                      {weapons.map((w) => (
                        <MenuItem key={w.key} value={w.key}>
                          <WeaponName weaponKey={w.key} />
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" sx={{ width: 80 }}>
                    <InputLabel id={`${titleId}-ref`}>
                      {t('kqmCompare.refinement')}
                    </InputLabel>
                    <Select
                      labelId={`${titleId}-ref`}
                      label={t('kqmCompare.refinement')}
                      value={refinement}
                      disabled={auto || running}
                      onChange={(e) => setRefinement(Number(e.target.value))}
                      sx={numSx}
                    >
                      {[1, 2, 3, 4, 5].map((r) => (
                        <MenuItem key={r} value={r}>
                          R{r}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <Segmented
                    size="small"
                    aria-label={t('kqmCompare.setMode')}
                    value={setMode}
                    onChange={setSetMode}
                    options={[
                      {
                        value: '4',
                        label: t('kqmCompare.sets4'),
                        disabled: auto || running,
                      },
                      {
                        value: '2+2',
                        label: t('kqmCompare.sets22'),
                        disabled: auto || running,
                      },
                    ]}
                  />
                  {(setMode === '4' ? [0] : [0, 1]).map((i) => (
                    <FormControl
                      key={i}
                      size="small"
                      sx={{ width: { xs: '100%', sm: 220 } }}
                    >
                      <InputLabel id={`${titleId}-sets${i}`}>
                        {i ? t('kqmCompare.sets2') : t('kqmCompare.sets')}
                      </InputLabel>
                      <Select
                        labelId={`${titleId}-sets${i}`}
                        label={i ? t('kqmCompare.sets2') : t('kqmCompare.sets')}
                        value={auto ? '' : i ? setKey2 : setKey}
                        disabled={auto || running}
                        onChange={(e) =>
                          (i ? setSetKey2 : setSetKey)(
                            e.target.value as ArtifactSetKey
                          )
                        }
                      >
                        {sets
                          .filter(
                            (s) =>
                              setMode === '4' || s !== (i ? setKey : setKey2)
                          )
                          .map((s) => (
                            <MenuItem key={s} value={s}>
                              <ArtifactSetName setKey={s} />
                            </MenuItem>
                          ))}
                      </Select>
                    </FormControl>
                  ))}
                </Box>
              </Row>
            )}
            {inKey && (
              <Row label={t('kqmCompare.build')}>
                <RadioGroup
                  row
                  aria-label={t('kqmCompare.build')}
                  value="kqm"
                  sx={{ alignItems: 'center' }}
                >
                  {/* (one choice for now: shown, not changed) */}
                  <FormControlLabel
                    value="kqm"
                    control={<Radio size="small" readOnly />}
                    label={t('kqmCompare.buildKqm')}
                  />
                  <FormControlLabel
                    value="existing"
                    disabled
                    control={<Radio size="small" readOnly />}
                    label={t('kqmCompare.buildExisting')}
                    sx={{ mr: 0 }}
                  />
                  <InfoTooltipInline title={t('kqmCompare.buildExistingTip')} />
                </RadioGroup>
              </Row>
            )}
            {inKey && (
              <Disclosure
                label={t('kqmCompare.settings', { name: inName })}
                info={t('kqmCompare.settingsTip')}
                open={settingsOpen}
                onToggle={() => setSettingsOpen((o) => !o)}
              >
                <EnteringSettings
                  teamId={teamId}
                  saved={saved}
                  out={out}
                  swapIn={swapIn}
                  text={text}
                  opener={opener}
                  fragment={fragment}
                  openerFragment={openerFragment}
                  ready={!!swapped?.ok}
                  calculator={calculator}
                  erText={erText}
                  setErText={setErText}
                  erInvalid={erInvalid}
                  calcOwn={calcOwn}
                  setCalcOwn={setCalcOwn}
                  passives={passives}
                  setPassives={setPassives}
                  weaponEnergy={weaponEnergy}
                  setWeaponEnergy={setWeaponEnergy}
                  data={
                    out
                      ? teamData?.[members.find((k) => k !== out) ?? out]
                          ?.target
                      : undefined
                  }
                  teammateWeapons={members
                    .filter((k) => k !== out)
                    .flatMap((k) => {
                      const w = run?.result?.builds[k]?.weapon.key
                      return w ? [w] : []
                    })}
                  teamKqm={teamKqm}
                  pick={
                    !auto && weapon && pickedSets
                      ? { weapon, sets: pickedSets }
                      : undefined
                  }
                  disabled={running}
                />
              </Disclosure>
            )}

            {/* the entering member's actions, in place of the leaving member's step */}
            <Row
              label={
                <FieldLabel tip={t('kqmCompare.fragmentTip')}>
                  {t('kqmCompare.fragmentLabel')}
                </FieldLabel>
              }
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <TextField
                  size="small"
                  label={t('kqmCompare.fragment', {
                    name: inName || '…',
                  })}
                  value={fragment}
                  disabled={!inKey}
                  onChange={(e) => setFragment(e.target.value)}
                  sx={{ width: { xs: '100%', sm: 320 } }}
                  inputProps={{ spellCheck: false, autoComplete: 'off' }}
                />
                {/* (the leaving member acts in the opener too: its step there, replaced as well) */}
                {inBoth && (
                  <TextField
                    size="small"
                    label={t('kqmCompare.fragmentOpener', {
                      name: inName || '…',
                    })}
                    helperText={t('kqmCompare.fragmentOpenerTip', {
                      name: outName,
                    })}
                    value={openerFragment}
                    disabled={!inKey}
                    onChange={(e) => setOpenerFragment(e.target.value)}
                    sx={{ width: { xs: '100%', sm: 320 }, mt: 1.5 }}
                    inputProps={{ spellCheck: false, autoComplete: 'off' }}
                  />
                )}
                <Preview
                  label={t('kqmCompare.preview')}
                  openerLabel={t('kqmCompare.opener')}
                  swapped={swapped?.ok ? swapped : undefined}
                />
              </Box>
            </Row>

            {(!!fragmentError || !!warnings.length || !text.trim()) && (
              <Box
                role="status"
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  color: 'warning.main',
                  fontSize: 13,
                }}
              >
                {!text.trim() && (
                  <WarningLine>{t('kqmCompare.error.noRotation')}</WarningLine>
                )}
                {fragmentError && (
                  <span id={`${titleId}-refusal`}>
                    <WarningLine>{fragmentError}</WarningLine>
                  </span>
                )}
                {warnings.map((w) => (
                  <WarningLine key={w}>{simText(w)}</WarningLine>
                ))}
              </Box>
            )}
          </Box>
        )}
        {/* A is KQM Theorycrafting's result: confirmed before anything runs (outside the form,
            which is disabled while it runs: Cancel stays reachable) */}
        {saved && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 2,
              rowGap: 1,
              mt: 2,
              pt: 1.5,
              borderTop: hairline,
            }}
          >
            <FormControlLabel
              control={
                <Checkbox
                  checked={confirmed}
                  onChange={(e) =>
                    setConfirmedAt(e.target.checked ? saved.savedAt : undefined)
                  }
                />
              }
              label={t('kqmCompare.confirm', { date: savedAt })}
              sx={{ mr: 0 }}
            />
            {(rotationChanged || notPlayed || resultChanged) && (
              <Box
                role="status"
                sx={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.5,
                  color: 'warning.main',
                  fontSize: 13,
                }}
              >
                {resultChanged && (
                  <WarningLine>
                    {t('kqmCompare.error.resultChanged')}
                  </WarningLine>
                )}
                {rotationChanged && (
                  <WarningLine>{t('kqmCompare.rotationChanged')}</WarningLine>
                )}
                {notPlayed && (
                  <WarningLine>{t('kqmCompare.notPlayed')}</WarningLine>
                )}
              </Box>
            )}
            <Box
              sx={{
                ml: 'auto',
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
              }}
            >
              {/* (a refused fragment is said once, under the fragment) */}
              {!!problem && !running && problem !== fragmentError && (
                <Typography
                  id={`${titleId}-problem`}
                  role="status"
                  sx={{ ...type.label, color: 'text.secondary' }}
                >
                  {problem}
                </Typography>
              )}
              {(running || ranking) && (
                <Button color="inherit" onClick={cancel}>
                  {t('kqmCompare.cancel')}
                </Button>
              )}
              <Button
                ref={runButton}
                variant="contained"
                disabled={!canRun}
                aria-describedby={
                  running || !problem
                    ? undefined
                    : problem === fragmentError
                      ? `${titleId}-refusal`
                      : `${titleId}-problem`
                }
                endIcon={<ArrowForwardIcon />}
                onClick={start}
                sx={{ ...giCtaSx, minHeight: 38, px: 2.25 }}
              >
                {t('kqmCompare.run')}
              </Button>
            </Box>
          </Box>
        )}
        {!saved && (
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
            <Button
              variant="contained"
              disabled
              endIcon={<ArrowForwardIcon />}
              sx={{ ...giCtaSx, minHeight: 38, px: 2.25 }}
            >
              {t('kqmCompare.run')}
            </Button>
          </Box>
        )}
        {/* one status region, always there: the run's progress, then its rankings', then how they
            ended (ready or cancelled; a failure is an alert), so each change is announced */}
        <Box sx={busy ? { mt: 1.5 } : undefined}>
          {busy && (
            <LinearProgress
              variant={step ? 'determinate' : 'indeterminate'}
              value={percent}
              aria-hidden
              sx={{
                height: 3,
                borderRadius: 1,
                bgcolor: alpha(tokens.gold, 0.16),
                '& .MuiLinearProgress-bar': { bgcolor: tokens.gold },
              }}
            />
          )}
          <Typography
            role="status"
            sx={busy ? { ...type.label, mt: 0.75 } : srOnly}
          >
            {statusText}
          </Typography>
        </Box>
        {state.type === 'error' && (
          <Box role="alert" sx={{ mt: 1.5, color: 'warning.main' }}>
            <WarningLine>{state.message}</WarningLine>
          </Box>
        )}
      </Panel>

      {state.type === 'done' && (
        <Panel title={t('kqmCompare.table.title')}>
          {stale && (
            <Box
              role="status"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                mb: 1,
                color: 'warning.main',
                fontSize: 13,
              }}
            >
              <WarningLine>{t('kqmCompare.staleResult')}</WarningLine>
              <InfoTooltipInline title={t('kqmCompare.staleResultTip')} />
            </Box>
          )}
          <Overview
            a={state.a}
            b={state.b}
            out={state.out}
            inKey={state.in}
            nameOf={nameOf}
            language={i18n.language}
          />
          <Box sx={{ mt: 1.5 }}>
            <CompareCardButton
              teamId={teamId}
              a={state.a}
              b={state.b}
              out={state.out}
              inKey={state.in}
              sandbox={state.resultsB?.database}
              disabled={stale}
            />
          </Box>
        </Panel>
      )}

      {/* B's KQM results, as KQM Theorycrafting shows a result: on B's sandbox, read only */}
      {state.type === 'done' && state.resultsB && (
        <Panel component="section" sx={{ p: 0 }}>
          <Box sx={{ px: { xs: 1, sm: 2 }, pt: { xs: 1.5, sm: 2 } }}>
            <PanelHeader
              title={
                // (where the focus goes when its rankings are cancelled)
                <Box component="span" ref={resultsTitle} tabIndex={-1}>
                  {t('kqmCompare.results.title')}
                </Box>
              }
              info={t('kqmCompare.results.titleTip', {
                name: nameOf(state.in),
              })}
              sx={{ mb: 0 }}
            />
            {/* (announced by the status region above) */}
            {state.rankings === 'cancelled' && (
              <Typography sx={{ ...type.label, mt: 0.5 }}>
                {t('kqmCompare.results.cancelled')}
              </Typography>
            )}
            {state.rankings === 'failed' && (
              <Box
                role="alert"
                sx={{ mt: 0.5, color: 'warning.main', fontSize: 13 }}
              >
                <WarningLine>
                  {t('kqmCompare.results.rankingFailed', {
                    message: state.rankingError,
                  })}
                </WarningLine>
              </Box>
            )}
          </Box>
          <KqmResults
            teamId={teamId}
            database={state.resultsB.database}
            readOnly
            replayRotation={state.resultsB.rotation}
            members={state.resultsB.members}
            result={state.resultsB.result}
            runSettings={state.resultsB.teamOpt}
            setup={state.resultsB.teamOpt}
            rotation={state.resultsB.result.played ? 'played' : 'entered'}
            stalls={state.resultsB.result.played?.stalls}
            seconds={state.resultsB.seconds}
            rotationTime={state.b.rotationTime || undefined}
            stale={stale}
            running={ranking}
            improving={ranking}
            progress={ranking ? progress : undefined}
            // (its progress said by the status line above; its banner's words its own)
            preliminary="quiet"
            preliminaryLabel={t('kqmCompare.results.rankingLabel')}
            preliminaryFinalLabel={t('kqmCompare.results.readyLabel')}
            unfinished={
              state.rankings === 'cancelled' || state.rankings === 'failed'
            }
            // (below this section's h3)
            headingLevel={4}
            heldLabel={t('kqmCompare.results.locked')}
            inspectorNote={{
              label: t('kqmCompare.results.retune'),
              tip: t('kqmCompare.results.retuneTip', {
                name: nameOf(state.in),
              }),
            }}
          />
        </Panel>
      )}
    </Box>
  )
}

/** When the saved result was found, in the user's language */
function formatWhen(time: number, language: string) {
  try {
    return new Intl.DateTimeFormat(language, {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(time)
  } catch {
    return new Date(time).toLocaleString()
  }
}

/** A labelled row of the form: the label on the left (above, on phones) */
function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: '96px minmax(0, 1fr)',
        },
        alignItems: 'center',
        columnGap: 1.5,
        rowGap: 0.75,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {typeof label === 'string' ? <FieldLabel>{label}</FieldLabel> : label}
      </Box>
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  )
}

/** The members who stay: A's builds, shown and locked */
function FixedMembers({
  label,
  keys,
  run,
  locked,
}: {
  label: string
  keys: CharacterKey[]
  run: SavedKqmRun | undefined
  locked: string
}) {
  const { gender } = useDBMeta()
  const kqm = run?.teamOpt?.kqm
  return (
    <Box
      component="ul"
      role="list"
      aria-label={label}
      sx={{
        ...insetSx,
        listStyle: 'none',
        m: 0,
        p: 0,
        overflow: 'hidden',
      }}
    >
      {keys.map((key, i) => {
        const build = run?.result?.builds[key]
        const cons =
          run?.result?.constellations?.[key] ?? kqmMemberConstellation(key, kqm)
        return (
          <Box
            component="li"
            key={key}
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 1.25,
              rowGap: 0.25,
              px: 1.25,
              py: 0.75,
              minHeight: 40,
              borderTop: i ? hairline : undefined,
              fontSize: 13.5,
            }}
          >
            <LockOutlinedIcon
              aria-hidden
              sx={{ fontSize: 16, color: 'text.secondary' }}
            />
            <Box component="span" sx={srOnly}>
              {locked}
            </Box>
            <MemberAvatar characterKey={key} size={22} />
            <Box component="span" sx={{ fontWeight: 600 }}>
              <CharacterName characterKey={key} gender={gender} />
            </Box>
            <Box component="span" sx={{ ...numSx, color: 'text.secondary' }}>
              C{cons}
            </Box>
            {build && (
              <Box
                component="span"
                sx={{ color: 'text.secondary', minWidth: 0 }}
              >
                <WeaponName weaponKey={build.weapon.key} /> R
                {build.weapon.refinement}
                {' · '}
                {Object.entries(build.sets)
                  .filter(([, n]) => n)
                  .map(([s, n], j) => (
                    <span key={s}>
                      {j ? ' + ' : ''}
                      <ArtifactSetName setKey={s as ArtifactSetKey} /> ({n})
                    </span>
                  ))}
              </Box>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

/** B's rotation, the entering member's step marked */
function Preview({
  label,
  openerLabel,
  swapped,
}: {
  label: string
  openerLabel: string
  swapped:
    | {
        text: string
        opener: string
        where: 'text' | 'opener'
        inserted: string
        openerInserted?: string
      }
    | undefined
}) {
  const marked = (s: string, inserted = swapped!.inserted) => {
    const i = s.indexOf(inserted)
    if (i < 0) return s
    return (
      <>
        {s.slice(0, i)}
        {/* (raised and bold, not gold: gold marks only the main action and selections) */}
        <Box
          component="mark"
          sx={{
            color: 'text.primary',
            bgcolor: tokens.raised,
            boxShadow: `inset 0 0 0 1px ${tokens.hairlineStrong}`,
            borderRadius: 0.5,
            px: 0.5,
            fontWeight: 700,
          }}
        >
          {inserted}
        </Box>
        {s.slice(i + inserted.length)}
      </>
    )
  }
  return (
    <Box
      role="group"
      aria-label={label}
      sx={{
        ...insetSx,
        mt: 1,
        px: 1.25,
        py: 1,
        minHeight: 40,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.6,
        overflowWrap: 'anywhere',
      }}
    >
      <Box
        component="span"
        sx={{ fontWeight: 700, mr: 1, color: 'text.secondary' }}
        aria-hidden
      >
        B
      </Box>
      {swapped ? (
        <>
          {!!swapped.opener.trim() && (
            <Box component="span" sx={{ display: 'block' }}>
              <Box component="span" sx={{ ...type.label, mr: 0.75 }}>
                {openerLabel}
              </Box>
              {swapped.where === 'opener'
                ? marked(swapped.opener)
                : swapped.openerInserted
                  ? marked(swapped.opener, swapped.openerInserted)
                  : swapped.opener}
            </Box>
          )}
          {swapped.where === 'text' ? marked(swapped.text) : swapped.text}
        </>
      ) : (
        <Box component="span" sx={{ color: 'text.secondary' }}>
          –
        </Box>
      )}
    </Box>
  )
}
