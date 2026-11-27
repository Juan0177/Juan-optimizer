import {
  InfoTooltipInline,
  SuspenseTooltip,
} from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  TeamOpt,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { StatIcon } from '@genshin-optimizer/gi/svgicons'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  FightEnemy,
  FightTeam,
  KqmResult,
  KqmTeamOption,
  RotationEnergy,
  RunEnemy,
  TeamData,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  appliedStygianPreset,
  CharacterName,
  EnemyDefeatTime,
  EnemySummary,
  KQM_ER_DEFAULT,
  KQM_TALENT_DEFAULT,
  kqmBuildThreads,
  kqmBuildThreadsAuto,
  kqmBuildThreadsMax,
  kqmConstellation,
  kqmDefaultExcludedWeapons,
  kqmEnergyRequirement,
  kqmExcludedWeapons,
  kqmHasEnergyRequirement,
  kqmLockedWeapon,
  kqmMemberConstellation,
  kqmMemberStandard,
  kqmTalentLevel,
  kqmTeamOverrides,
  kqmWeapons,
  MOONGECKO_BOSS,
  sameRunEnemy,
  setKqmBuildThreads,
  startsWithoutEnergy,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'
import CloseIcon from '@mui/icons-material/Close'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Drawer,
  IconButton,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Select,
  type SxProps,
  TextField,
  type Theme,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
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
import { EnemySetup } from '../Enemy/EnemySetup'
import { EnemyScopeContext, kqmEnemyTeam } from '../Enemy/enemyScope'
import { FightTimeline } from '../Enemy/FightTimeline'
import { DamageShare } from './DamageShare'
import type { FightApplications } from './fightTeam'
import { fightTeamOf, useCocoonEvaluations } from './fightTeam'
import { formatRateFull } from './format'
import { KqmGearIcons, KqmRollLine } from './KqmBuildView'
import {
  KqmPool,
  KqmSetChooser,
  KqmWeaponChooser,
  kqmChooserCounts,
} from './KqmChoosers'
import { KqmCompare, setKqmPicks } from './KqmComparison'
import { KqmEnergyCalculator, kqmEnergyEstimate } from './KqmEnergyCalculator'
import { KqmShareMenu } from './KqmShareMenu'
import {
  KqmArtifactStandard,
  KqmMemberStandard,
  kqmStandardName,
  kqmStandardsMixed,
  kqmStandardText,
  useKqmCustom,
} from './KqmStandard'
import { KqmTopTeams } from './KqmTopTeams'
import { KqmWeaponLock } from './KqmWeaponLock'
import {
  kqmEnergyUpdate,
  kqmRotationEnergyOf,
  teamCalculator,
} from './kqmEnergy'
import { MemberAvatar } from './MemberAvatar'
import {
  kqmRotationId,
  playedRotationKey,
  useAppliedRotation,
  useRotationSettings,
} from './RotationWriter'
import { conditionsKey } from './rotationConditionsStore'
import { elementColor } from './TeamOptResults'
import {
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  StepTitle,
  selectedSx,
  subsectionSx,
  tokens,
  type,
} from './ui'
import { useKqmProgress } from './useKqmRun'
import type { TeamOptUpdate } from './useTeamOpt'

/**
 * A member row's columns: name, constellation, artifacts, minimum ER (one line from `sm`; phones:
 * the name above the fields)
 */
const memberGrid = {
  display: 'grid',
  alignItems: 'center',
  columnGap: { xs: 1, sm: 1.5 },
  rowGap: 1,
  gridTemplateColumns: {
    // (phones: room for "ER 139.8 %" whole)
    xs: '70px minmax(0, 1fr) 122px',
    sm: 'minmax(120px, 1fr) 84px 124px 128px',
  },
  gridTemplateAreas: {
    xs: '"name name name" "cons arts er"',
    sm: '"name cons arts er"',
  },
} as const

/** A compact outlined field: 36 px tall, tabular numbers */
const compactFieldSx = {
  '& .MuiInputBase-root': { fontSize: 14 },
  '& .MuiInputBase-input': { py: 0.875, ...numSx },
  '& .MuiSelect-select': { py: 0.875, ...numSx },
} as const

type RotationWorked = {
  for: string
  replayKey: string
  energy?: RotationEnergy
  rotationTime?: number
}
const workedReplays = new WeakMap<
  ArtCharDatabase,
  Map<string, { key: string; sources: unknown[]; worked: RotationWorked }>
>()
const replaySources = (database: ArtCharDatabase, teamId: string) => [
  database.teams.get(teamId),
  ...teamOptMembers(database, teamId).flatMap((m) => [
    m.teamChar,
    database.weapons.get(m.weaponId),
    ...Object.values(m.artifactIds).map((id) =>
      id ? database.arts.get(id) : undefined
    ),
  ]),
]
function cachedReplay(database: ArtCharDatabase, teamId: string, key: string) {
  const hit = workedReplays.get(database)?.get(teamId)
  if (!hit || hit.key !== key) return undefined
  const sources = replaySources(database, teamId)
  return sources.length === hit.sources.length &&
    sources.every((s, i) => s === hit.sources[i])
    ? hit.worked
    : undefined
}

/**
 * The ER calculator's inputs as KQM plays the written rotation (at its constellations, see
 * `energyFromRotation`): worked out after the panel shows (it is a full replay), again when the
 * rotation, the members, their constellations or the Burst cadence change. Nothing written:
 * undefined.
 */
function useRotationEnergy(
  teamId: string,
  members: TeamOptMember[],
  teamOpt: TeamOpt
): {
  text: string
  /**
   * The rotation as played: its text, opener and timing settings (an opener or timing change is
   * a new rotation too); empty: nothing written
   */
  rotation: string
  energy?: RotationEnergy
  for?: string
  /** The rotation's length as KQM plays it (s): what the inputs above are per */
  rotationTime?: number
} {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const { i18n } = useTranslation()
  // (with the rotation text it was worked out for: a newer text's is still on its way)
  const [worked, setWorked] = useState<RotationWorked>()
  const latest = useRef({ teamOpt, members })
  latest.current = { teamOpt, members }
  const text = useAppliedRotation(kqmRotationId(teamId))
  const team = useTeam(teamId)
  const zeroEnergy = startsWithoutEnergy(teamOpt.kqm?.enemy ?? team)
  const constellations = JSON.stringify(
    members.map((m) => kqmMemberConstellation(m.characterKey, teamOpt.kqm))
  )
  const calculator = teamOpt.kqm?.energyCalculator
  const cadence = JSON.stringify(
    teamOpt.kqm?.energySource === 'calculator'
      ? members.map((m) => calculator?.members[m.characterKey]?.burstEvery)
      : []
  )
  const keys = members.map((m) => m.characterKey).join()
  // (each member's KQM weapons as candidates, as a run plays them: an energy weapon's refunds are
  // counted for the weapon a build holds)
  const weapons = JSON.stringify(
    members.map((m) =>
      kqmWeapons(m.characterKey, teamOpt.kqm).map((w) => w.key)
    )
  )
  // (the opener and the timing settings too: the replay plays them)
  const { opener, timing, frameData } = useRotationSettings(
    kqmRotationId(teamId)
  )
  const written = playedRotationKey(text, opener, timing, frameData)
  const rotation = written && zeroEnergy ? `${written}|0 Energy` : written
  const replayKey = JSON.stringify([
    gender,
    i18n?.language,
    rotation,
    constellations,
    cadence,
    keys,
    weapons,
  ])
  // (shown again with nothing it reads changed: the last replay at once)
  const [cached] = useState(() =>
    rotation ? cachedReplay(database, teamId, replayKey) : undefined
  )
  const shown =
    worked?.replayKey === replayKey
      ? worked
      : cached?.replayKey === replayKey
        ? cached
        : undefined
  useEffect(() => {
    if (!rotation) {
      setWorked(undefined)
      return
    }
    const hit = cachedReplay(database, teamId, replayKey)
    if (hit) {
      setWorked(hit)
      return
    }
    let cancelled = false
    const run = () => {
      const { energy: next, rotationTime: seconds } = kqmRotationEnergyOf(
        database,
        gender,
        i18n,
        teamId,
        latest.current.teamOpt,
        latest.current.members
      )
      if (cancelled) return
      const result = {
        for: rotation,
        replayKey,
        energy: next,
        rotationTime: seconds,
      }
      const byTeam = workedReplays.get(database) ?? new Map()
      workedReplays.set(database, byTeam)
      byTeam.set(teamId, {
        key: replayKey,
        sources: replaySources(database, teamId),
        worked: result,
      })
      setWorked(result)
    }
    // (after the page paints: a full replay)
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 1000 })
      return () => {
        cancelled = true
        cancelIdleCallback(id)
      }
    }
    const id = setTimeout(run, 50)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [database, gender, i18n, teamId, rotation, replayKey])
  return {
    text,
    rotation,
    energy: shown?.energy,
    for: shown?.for,
    rotationTime: shown?.energy ? shown.rotationTime : undefined,
  }
}

/** KQM assumptions and equipment, saved with the team as they change. */
/** The talent level last picked on any team (localStorage): new teams start with it */
const TALENTS_KEY = 'kqm_talents_last'
function lastKqmTalents(): 9 | 10 | undefined {
  try {
    const value = globalThis.localStorage?.getItem(TALENTS_KEY)
    return value === '9' ? 9 : value === '10' ? 10 : undefined
  } catch {
    // (no storage: nothing remembered)
    return undefined
  }
}
function rememberKqmTalents(level: 9 | 10) {
  try {
    globalThis.localStorage?.setItem(TALENTS_KEY, `${level}`)
  } catch {
    // (no storage: the team keeps its own setting all the same)
  }
}

export function KqmSettings({
  disabled = false,
  active = true,
  hasResult = false,
  canRun,
  onStart,
  teamId,
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  fight,
}: {
  /** The builds shown, in their fight (a Stygian boss: how long they take to defeat it) */
  fight?: FightTeam
  disabled?: boolean
  active?: boolean
  /** There are results: its action runs again */
  hasResult?: boolean
  canRun: boolean
  onStart: (settings: TeamOpt) => void
  teamId: string
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const titleId = useId()
  const [tab, setTab] = useState(0)
  const kqm = teamOpt.kqm ?? defaultTeamOptKqm
  const memberKeys = useMemo(
    () => members.map((m) => m.characterKey),
    [members]
  )
  const [customStandards, setCustomStandards] = useKqmCustom(kqm, memberKeys)
  // a team never set to a talent level takes the one last picked on any team (else KQM's 10)
  const unsetTalents = teamOpt.kqm?.talents === undefined
  useEffect(() => {
    if (!unsetTalents || disabled) return
    const last = lastKqmTalents()
    if (!last || last === KQM_TALENT_DEFAULT) return
    setTeamOpt((o) => {
      const settings = (o.kqm ??= { ...defaultTeamOptKqm })
      if (settings.talents === undefined) settings.talents = last
    })
  }, [unsetTalents, disabled, setTeamOpt])
  const counts = useMemo(
    () => kqmChooserCounts(members, teamOpt.kqm),
    [members, teamOpt.kqm]
  )
  // every member gets a KQM build (the KQM standard is for the whole team)
  const optimized = members
  const [calculatorInputs, setCalculatorDraft] = useState(() =>
    structuredClone(
      teamCalculator(members, teamOpt, teamOpt.kqm?.energyCalculator)
    )
  )
  // (the written rotation fills in the inputs not set by hand)
  const {
    rotation: writtenRotation,
    energy: rotationEnergy,
    for: energyFor,
    rotationTime: playedTime,
  } = useRotationEnergy(teamId, members, teamOpt)
  // The rotation length above is shared by both workflows and the ER calculator; with a written
  // rotation, the length KQM plays it at (the inputs it fills in are per that rotation, as in the
  // run)
  const rotationTime = playedTime ?? teamOpt.rotationTime ?? 20
  const calculatorDraft = useMemo(
    () => ({
      ...teamCalculator(members, teamOpt, calculatorInputs, rotationEnergy),
      rotationTime,
    }),
    [members, teamOpt, calculatorInputs, rotationTime, rotationEnergy]
  )
  const [calculatorDirty, setCalculatorDirty] = useState(false)
  // (recomputed when the calculator or the KQM weapons change, not on every keystroke; the same
  // estimate as the calculator shows)
  const calculatorEstimate = useMemo(
    () =>
      kqmEnergyEstimate(
        members.map((m) => m.characterKey),
        calculatorDraft,
        kqm
      ),
    [members, calculatorDraft, kqm]
  )
  /** Automatic ER: the calculator's targets (its settings as they are now) */
  const toAuto = () => {
    setTeamOpt((o) => {
      o.kqm = {
        ...(o.kqm ?? defaultTeamOptKqm),
        energySource: 'calculator',
        energyCalculator: structuredClone(calculatorDraft),
        energyRecharge: { ...calculatorEstimate.targets },
      }
    })
    setCalculatorDirty(false)
  }
  /** Manual ER: the targets typed below (they start from the calculator's) */
  const toManual = () =>
    setTeamOpt((o) => {
      const settings = (o.kqm ??= { ...defaultTeamOptKqm })
      settings.energySource = 'manual'
    })
  const applyCalculator = () => {
    toAuto()
    setTab(0)
  }
  const leaveCalculator = () => {
    setCalculatorDraft(
      structuredClone(teamCalculator(members, teamOpt, kqm.energyCalculator))
    )
    setCalculatorDirty(false)
    setTab(0)
  }
  const missingWeapons = useMemo(
    () => optimized.filter((m) => !kqmWeapons(m.characterKey, kqm).length),
    [optimized, kqm]
  )
  const [erText, setErText] = useState<Partial<Record<CharacterKey, string>>>(
    () =>
      Object.fromEntries(
        members.map(({ characterKey }) => [
          characterKey,
          kqmEnergyRequirement(teamOpt.kqm, characterKey).toString(),
        ])
      )
  )
  // a target typed below 100% (an empty field is the 100% default, no requirement)
  const erTextInvalid = (text = '') =>
    !!text.trim() && !kqmHasEnergyRequirement(Number(text.replace(',', '.')))
  const missingEr = members.filter((m) => erTextInvalid(erText[m.characterKey]))
  const openingAtZero =
    kqm.energySource !== 'manual' &&
    energyFor === writtenRotation &&
    Object.values(calculatorEstimate.opening ?? {}).some(
      (check) => check.castTime === 0 && !Number.isFinite(check.required)
    )
  const blocked =
    !optimized.length ||
    !!missingWeapons.length ||
    !!missingEr.length ||
    openingAtZero
  const setEr = (characterKey: CharacterKey, text: string) => {
    setErText((previous) => ({ ...previous, [characterKey]: text }))
    const value = text.trim() ? Number(text.replace(',', '.')) : undefined
    setTeamOpt((o) => {
      const settings = (o.kqm ??= { ...defaultTeamOptKqm })
      const requirements = (settings.energyRecharge ??= {})
      if (kqmHasEnergyRequirement(value)) requirements[characterKey] = value
      else delete requirements[characterKey]
    })
  }
  const appliedEr = teamOpt.kqm?.energyRecharge
  const erSource = teamOpt.kqm?.energySource
  useEffect(() => {
    if (erSource === 'calculator')
      setErText(
        Object.fromEntries(
          members.map(({ characterKey }) => [
            characterKey,
            kqmEnergyRequirement(
              { energyRecharge: appliedEr },
              characterKey
            ).toString(),
          ])
        )
      )
  }, [appliedEr, erSource, members])
  // Applied ER targets stay current when the common rotation length or the written rotation's
  // inputs change. They also apply by themselves: with a written rotation (its energy worked
  // out), for a team that has not typed its own, and whenever the rotation is saved or changed
  // (over ones typed by hand: those were for the rotation before)
  const lastWritten = useRef<string>()
  useEffect(() => {
    const written = writtenRotation
    const update = kqmEnergyUpdate({
      members,
      teamOpt,
      written,
      ready: !!written && energyFor === written && !!rotationEnergy,
      rotationEnergy,
      playedTime,
    })
    if (!update) return
    // (written once per change: if the saved settings come back different, e.g. a value the
    // database does not keep, the same inputs are not written again, or it would loop)
    if (update.key !== undefined) {
      if (update.key === lastWritten.current) return
      lastWritten.current = update.key
    }
    setTeamOpt((o) => {
      o.kqm = { ...(o.kqm ?? defaultTeamOptKqm), ...update.kqm }
    })
  }, [
    teamOpt,
    members,
    setTeamOpt,
    rotationEnergy,
    energyFor,
    writtenRotation,
    playedTime,
  ])
  const problem = !canRun
    ? t('teamOpt.kqm.addAttacks', 'Add rotation attacks above')
    : !optimized.length
      ? t('teamOpt.empty.title', 'Add the team’s members first')
      : missingWeapons.length
        ? t('teamOpt.kqm.noWeaponsShort', 'Select weapons')
        : calculatorDirty
          ? t('teamOpt.kqm.calc.review', 'Apply ER changes')
          : openingAtZero
            ? t(
                'teamOpt.kqm.calc.openingAtZero',
                'Add energy before the first Burst'
              )
            : missingEr.length
              ? t('teamOpt.kqm.erInvalidShort', {
                  defaultValue: '{{count}} ER targets below 100%',
                  count: missingEr.length,
                })
              : ''
  // the first problem is ER targets below 100%: one click sets them to 100% (no requirement)
  const problemIsEr =
    !!canRun &&
    !!optimized.length &&
    !missingWeapons.length &&
    !openingAtZero &&
    !calculatorDirty &&
    !!missingEr.length
  const fillMissingEr = () => {
    for (const { characterKey } of missingEr) setEr(characterKey, '100')
  }
  const closePanel = () => (tab === 3 ? leaveCalculator() : setTab(0))
  // (the drawer keeps its content while it slides out)
  const lastTab = useRef(tab || 1)
  if (tab) lastTab.current = tab
  const panelTab = tab || lastTab.current
  const panelTitle =
    panelTab === 1
      ? t('teamOpt.kqm.weaponsList', 'Weapons')
      : panelTab === 2
        ? t('teamOpt.kqm.sets', 'Artifact sets')
        : t('teamOpt.kqm.calc.tab', 'ER calculator')
  const panelInfo =
    panelTab === 1
      ? t(
          'teamOpt.kqm.weaponHelp',
          'Select weapons to compare. Adjust refinement, effects and energy contribution below each weapon.'
        )
      : panelTab === 2
        ? t(
            'teamOpt.kqm.setHelp',
            'Choose sets and configure their effects for each member. Their existing set rules still apply. Clear all to compare without a set bonus.'
          )
        : t(
            'teamOpt.kqm.calc.intro',
            'Confirm skill uses, particle catching and field time for one rotation. ER is calculated for the whole team, then applied to KQM. Extra energy from abilities or effects goes in Bonus flat energy.'
          )
  const weaponsLabel = t('teamOpt.kqm.weaponsCount', {
    defaultValue: '{{count}} weapons',
    count: counts.weapons.allowed,
  })
  const setsLabel = t('teamOpt.kqm.setsCount', {
    defaultValue: '{{count}} artifact sets',
    count: counts.sets.allowed,
  })
  const calculated = kqm.energySource === 'calculator' && !calculatorDirty
  return (
    <Box
      component="fieldset"
      id={`kqm-settings-${teamId}`}
      disabled={disabled}
      aria-labelledby={titleId}
      sx={{
        border: 0,
        m: 0,
        p: { xs: 1, sm: 2 },
        minWidth: 0,
        scrollMarginTop: 88,
        opacity: disabled ? 0.55 : 1,
        pointerEvents: disabled ? 'none' : undefined,
        transition: 'opacity .18s',
      }}
    >
      {/* the title and its rules; the one main action, with what still blocks it */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 1.5,
          mb: 2,
        }}
      >
        <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
          <StepTitle step={2} id={titleId}>
            {t('teamOpt.kqm.setupStep', 'Setup')}
          </StepTitle>
          <KqmAssumptions
            talents={kqmTalentLevel(kqm)}
            standard={kqmStandardText(t, kqm, memberKeys)}
          />
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            ml: 'auto',
          }}
        >
          {!!problem && (
            <Box
              role="status"
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                fontSize: 13,
                color: 'warning.main',
              }}
            >
              <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
              <span>{problem}</span>
              {problemIsEr && (
                <Button
                  size="small"
                  variant="contained"
                  color="warning"
                  onClick={fillMissingEr}
                  sx={{ minWidth: 0, px: 1, py: 0.25, ml: 0.25 }}
                >
                  {t('teamOpt.kqm.erFill', 'Set 100%')}
                </Button>
              )}
            </Box>
          )}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <FieldLabel
              tip={t(
                'teamOpt.kqm.searchTipQuick',
                'Quick tries every allowed weapon and artifact set in the first round, then only the ones near each member’s best, and lists the rest as screened out instead of ranked. Full tries all of them in every round.'
              )}
            >
              {t('teamOpt.kqm.search', 'Search')}
            </FieldLabel>
            <Segmented
              size="small"
              value={kqm.fullSearch ? 'full' : 'quick'}
              aria-label={t('teamOpt.kqm.search', 'Search')}
              options={[
                {
                  value: 'quick',
                  label: t('teamOpt.kqm.searchQuick', 'Quick'),
                },
                { value: 'full', label: t('teamOpt.kqm.searchFull', 'Full') },
              ]}
              onChange={(search) =>
                setTeamOpt((o) => {
                  const settings = (o.kqm ??= { ...defaultTeamOptKqm })
                  if (search === 'full') settings.fullSearch = true
                  else delete settings.fullSearch
                })
              }
            />
          </Box>
          <KqmThreads />
          <Button
            variant="contained"
            disabled={disabled || !canRun || blocked || calculatorDirty}
            endIcon={<ArrowForwardIcon />}
            sx={{ ...giCtaSx, minHeight: 38, px: 2.25 }}
            onClick={() => {
              setTab(0)
              onStart(teamOpt)
            }}
          >
            {hasResult
              ? t('teamOpt.result.runAgain', 'Run again')
              : t('teamOpt.kqm.generateShort', 'Generate builds')}
          </Button>
        </Box>
      </Box>

      {/* the members (their constellation and the Energy Recharge each needs) and, beside them on
          wide screens, the enemy the builds are made for */}
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          alignItems: 'stretch',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            lg: 'minmax(0, 1.4fr) minmax(340px, 1fr)',
          },
        }}
      >
        {/* one row per member: its build, constellation and the Energy Recharge it needs */}
        <Box sx={{ ...insetSx, overflow: 'hidden' }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1,
              pl: 1.5,
              pr: 1,
              py: 0.75,
              minHeight: 48,
              borderBottom: hairline,
            }}
          >
            <Typography
              component="h3"
              sx={{
                ...type.title,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                flexGrow: 1,
              }}
            >
              {t('teamOpt.kqm.membersAll', 'Members')}
              <InfoTooltipInline
                title={t('teamOpt.kqm.membersAllHelpStandard', {
                  defaultValue:
                    'Every member gets a KQM build at the constellation shown: level 90, the talent levels set here, five +20 artifacts at the standard set here ({{standard}}).',
                  standard: kqmStandardText(t, kqm, memberKeys),
                })}
              />
            </Typography>
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 0.5 }}
            >
              <FieldLabel
                tip={t(
                  'teamOpt.kqm.talentsTipStandard',
                  'Every member’s talent levels (normal attack, skill, burst; constellations add theirs on top). KQM Standards use 10/10/10. Your last pick is used for new teams.'
                )}
              >
                {t('teamOpt.kqm.talents', 'Talents')}
              </FieldLabel>
              <Segmented
                size="small"
                value={kqmTalentLevel(kqm)}
                aria-label={t('teamOpt.kqm.talents', 'Talents')}
                options={[9, 10].map((level) => ({
                  value: level as 9 | 10,
                  label: `${level}/${level}/${level}`,
                }))}
                onChange={(level) => {
                  // (saved on the team, and remembered for teams not set yet)
                  rememberKqmTalents(level)
                  setTeamOpt((o) => {
                    const settings = (o.kqm ??= { ...defaultTeamOptKqm })
                    settings.talents = level
                  })
                }}
              />
            </Box>
            <KqmArtifactStandard
              kqm={kqm}
              members={memberKeys}
              custom={customStandards}
              setCustom={setCustomStandards}
              setTeamOpt={setTeamOpt}
            />
            <FieldLabel
              tip={t(
                'teamOpt.kqm.energyModeTip',
                'Automatic: the ER calculator works out each member’s minimum ER from the rotation, again for each weapon a build tries (Favonius and other energy weapons counted). Manual: the targets you type below.'
              )}
            >
              {t('teamOpt.energy.mode', 'ER')}
            </FieldLabel>
            <Segmented
              size="small"
              aria-label={t('teamOpt.energy.modeLabel', 'ER requirements')}
              value={kqm.energySource === 'calculator' ? 'auto' : 'manual'}
              onChange={(value) => (value === 'auto' ? toAuto() : toManual())}
              options={[
                { value: 'auto', label: t('teamOpt.energy.auto', 'Automatic') },
                {
                  value: 'manual',
                  label: t('teamOpt.energy.manual', 'Manual'),
                },
              ]}
            />
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={<CalculateOutlinedIcon />}
              onClick={() => setTab(3)}
            >
              {t('teamOpt.kqm.calc.open', 'Calculate ER')}
            </Button>
          </Box>
          {/* column labels (phones: each field says what it is) */}
          <Box
            sx={{
              ...memberGrid,
              display: { xs: 'none', sm: 'grid' },
              px: 1.5,
              pt: 1,
            }}
          >
            <FieldLabel
              sx={{ gridArea: 'cons' }}
              tip={t(
                'teamOpt.kqm.consTip',
                'Constellation of this KQM build. KQM standard: C6 for 4★, C0 for 5★.'
              )}
            >
              {t('teamOpt.kqm.consColumn', 'Constellation')}
            </FieldLabel>
            <FieldLabel
              sx={{ gridArea: 'arts' }}
              tip={t(
                'teamOpt.kqm.artifactsColumnTipStandard',
                'This member’s artifacts: KQM Standard, a tier (Good, Great, Top, Perfect), or Custom: how many of its 45 rolls land on wanted stats. Artifacts above sets every member’s.'
              )}
            >
              {t('teamOpt.kqm.artifactsLabel', 'Artifacts')}
            </FieldLabel>
            <FieldLabel
              sx={{ gridArea: 'er', justifySelf: 'end' }}
              tip={t(
                'teamOpt.kqm.erHelp',
                'Total ER% each member needs, or calculate it for this rotation. 100% (the default) means no extra ER. The optimizer meets ER first, then uses the remaining rolls for damage.'
              )}
            >
              {t('teamOpt.kqm.minEr', 'Min ER')}
            </FieldLabel>
          </Box>
          {members.map(({ characterKey }, index) => {
            const text = erText[characterKey] ?? ''
            const invalid = erTextInvalid(text)
            // (marked only when the invalid targets are what blocks Generate)
            const missing =
              problemIsEr &&
              missingEr.some((m) => m.characterKey === characterKey)
            const cons = kqmMemberConstellation(characterKey, kqm)
            const standard = kqmConstellation(characterKey)
            return (
              <Box
                key={characterKey}
                sx={{
                  ...memberGrid,
                  px: 1.5,
                  py: 1,
                  borderTop: index > 0 ? hairline : undefined,
                }}
              >
                <Box
                  sx={{
                    gridArea: 'name',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    minWidth: 0,
                  }}
                >
                  <MemberAvatar characterKey={characterKey} size={32} />
                  <Typography sx={{ fontSize: 14, fontWeight: 600 }} noWrap>
                    <CharacterName
                      characterKey={characterKey}
                      gender={gender}
                    />
                  </Typography>
                  <Box sx={{ ml: 'auto', pl: 0.5, display: 'flex' }}>
                    <KqmWeaponLock
                      compact
                      characterKey={characterKey}
                      members={members}
                      kqm={kqm}
                      setTeamOpt={setTeamOpt}
                    />
                  </Box>
                </Box>
                <Box sx={{ gridArea: 'cons', minWidth: 0 }}>
                  <KqmConstellationSelect
                    value={cons}
                    standard={standard}
                    characterKey={characterKey}
                    onChange={(value) =>
                      setTeamOpt((o) => {
                        const settings = (o.kqm ??= { ...defaultTeamOptKqm })
                        const next = { ...(settings.constellations ?? {}) }
                        if (value === standard) delete next[characterKey]
                        else next[characterKey] = value
                        settings.constellations = Object.keys(next).length
                          ? next
                          : undefined
                      })
                    }
                  />
                </Box>
                <Box sx={{ gridArea: 'arts', minWidth: 0 }}>
                  <KqmMemberStandard
                    characterKey={characterKey}
                    members={memberKeys}
                    kqm={kqm}
                    custom={customStandards}
                    setCustom={setCustomStandards}
                    setTeamOpt={setTeamOpt}
                  />
                </Box>
                <Box sx={{ gridArea: 'er', minWidth: 0 }}>
                  {kqm.energySource === 'calculator' ? (
                    <Tooltip
                      arrow
                      title={t(
                        'teamOpt.kqm.erAutoTarget',
                        'Worked out by the ER calculator for this rotation, and again for each weapon a build tries. Choose Manual to type your own.'
                      )}
                    >
                      <Box
                        component="span"
                        tabIndex={0}
                        aria-label={t('teamOpt.kqm.erInput', {
                          defaultValue: '{{character}} minimum ER (%)',
                          character: characterKey,
                        })}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          gap: 0.5,
                          height: 36,
                          px: { xs: 1, sm: 1.25 },
                          borderRadius: tokens.radius.control,
                          fontSize: 14,
                          fontWeight: 600,
                          color: 'text.secondary',
                          bgcolor: tokens.inset,
                          cursor: 'default',
                          ...numSx,
                          ...focusSx,
                        }}
                      >
                        <Box
                          component="span"
                          sx={{
                            ...type.label,
                            mr: 'auto',
                            display: { sm: 'none' },
                          }}
                        >
                          {t('teamOpt.kqm.erShort', 'ER')}
                        </Box>
                        {text || KQM_ER_DEFAULT}
                        <Box component="span" sx={type.label}>
                          %
                        </Box>
                      </Box>
                    </Tooltip>
                  ) : (
                    <Tooltip
                      arrow
                      title={
                        invalid
                          ? t('teamOpt.kqm.erInvalid', 'Enter 100 or more')
                          : ''
                      }
                    >
                      <TextField
                        size="small"
                        fullWidth
                        value={text}
                        error={invalid}
                        placeholder={`${KQM_ER_DEFAULT}`}
                        onChange={(e) => setEr(characterKey, e.target.value)}
                        inputProps={{
                          inputMode: 'decimal',
                          'aria-label': t('teamOpt.kqm.erInput', {
                            defaultValue: '{{character}} minimum ER (%)',
                            character: characterKey,
                          }),
                        }}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment
                              position="start"
                              sx={{ display: { sm: 'none' } }}
                            >
                              <Box component="span" sx={type.label}>
                                {t('teamOpt.kqm.erShort', 'ER')}
                              </Box>
                            </InputAdornment>
                          ),
                          endAdornment: (
                            <InputAdornment position="end">%</InputAdornment>
                          ),
                        }}
                        sx={(theme) => ({
                          ...compactFieldSx,
                          '& .MuiInputBase-root': {
                            fontSize: 14,
                            px: { xs: 1, sm: 1.25 },
                          },
                          '& .MuiInputAdornment-positionStart': {
                            mr: { xs: 0.5, sm: 1 },
                          },
                          '& .MuiInputBase-input': {
                            py: 0.875,
                            textAlign: 'right',
                            ...numSx,
                          },
                          ...(missing && {
                            '& .MuiOutlinedInput-notchedOutline': {
                              borderColor: alpha(
                                theme.palette.warning.main,
                                0.55
                              ),
                            },
                          }),
                        })}
                      />
                    </Tooltip>
                  )}
                </Box>
              </Box>
            )
          })}
        </Box>
        <EnemyScopeContext.Provider value="kqm">
          <EnemySetup teamId={teamId} fight={fight} disabled={disabled} />
        </EnemyScopeContext.Provider>
      </Box>
      {/* what the builds may use: the weapon groups, and the drawers that choose one by one */}
      <KqmPool
        members={members}
        teamOpt={teamOpt}
        setTeamOpt={setTeamOpt}
        onWeapons={() => setTab(1)}
        onSets={() => setTab(2)}
      />
      <Drawer
        anchor="right"
        open={active && !disabled && tab !== 0}
        onClose={closePanel}
        PaperProps={{
          role: 'dialog',
          'aria-modal': true,
          'aria-label': panelTitle,
          sx: {
            width: { xs: '100%', md: 880 },
            maxWidth: '100%',
            bgcolor: tokens.panel,
            backgroundImage: 'none',
            borderLeft: hairline,
          },
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: { xs: 2, sm: 2.5 },
            pr: 1.25,
            minHeight: 60,
            borderBottom: hairline,
            flexShrink: 0,
          }}
        >
          <Typography
            component="h2"
            sx={{
              ...type.section,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              flex: 1,
              minWidth: 0,
            }}
          >
            {panelTitle}
            <InfoTooltipInline title={panelInfo} />
          </Typography>
          <IconButton
            onClick={closePanel}
            aria-label={t('teamOpt.editor.close', 'Close')}
            sx={{ ...quickSx, ...focusSx }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
        <Box sx={{ p: { xs: 1.5, sm: 2.5 }, overflowY: 'auto', flex: 1 }}>
          {panelTab === 1 && (
            <>
              <KqmWeaponChooser
                embedded
                teamId={teamId}
                members={members}
                teamData={teamData}
                teamOpt={teamOpt}
                setTeamOpt={setTeamOpt}
                onOpenCalculator={() => setTab(3)}
                onClose={closePanel}
              />
            </>
          )}
          {panelTab === 2 && (
            <KqmSetChooser
              embedded
              teamId={teamId}
              members={members}
              teamData={teamData}
              teamOpt={teamOpt}
              setTeamOpt={setTeamOpt}
              onClose={closePanel}
            />
          )}
          {panelTab === 3 && (
            <KqmEnergyCalculator
              members={members}
              kqm={kqm}
              fromRotation={!!rotationEnergy}
              settings={calculatorDraft}
              setSettings={(update) => {
                setCalculatorDraft((previous) =>
                  update(teamCalculator(members, teamOpt, previous))
                )
                setCalculatorDirty(true)
              }}
            />
          )}
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: { xs: 2, sm: 2.5 },
            py: 1.5,
            borderTop: hairline,
            flexShrink: 0,
          }}
        >
          {panelTab === 3 ? (
            <>
              <Typography
                role="status"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12.5,
                  color: 'warning.main',
                }}
              >
                {calculatorEstimate.errors[0] ?? ''}
              </Typography>
              <Button
                variant="contained"
                sx={giCtaSx}
                disabled={!!calculatorEstimate.errors.length}
                onClick={applyCalculator}
              >
                {t('teamOpt.kqm.calc.apply', 'Apply ER targets')}
              </Button>
            </>
          ) : (
            <>
              <Typography sx={{ ...type.label, ...numSx, flex: 1 }}>
                {panelTab === 1 ? weaponsLabel : setsLabel}
              </Typography>
              <Button variant="contained" sx={giCtaSx} onClick={closePanel}>
                {t('teamOpt.kqm.done', 'Done')}
              </Button>
            </>
          )}
        </Box>
      </Drawer>
    </Box>
  )
}

/** The build rules under the title, in one muted line (the full rule in its tooltip) */
function KqmAssumptions({
  talents,
  standard,
}: {
  talents: 9 | 10
  /** The artifact standard's name (Mixed when set per member) */
  standard: string
}) {
  const { t } = useTranslation('page_team')
  const labels = [
    t('teamOpt.kqm.ruleLevel', 'Lv. 90'),
    t('teamOpt.kqm.ruleConsDefaults', '4★ C6 · 5★ C0–C2'),
    t('teamOpt.kqm.ruleTalentsLevel', {
      defaultValue: 'Talents {{level}}/{{level}}/{{level}}',
      level: talents,
    }),
    t('teamOpt.kqm.ruleArtifactsStandard', {
      defaultValue: '+20 artifacts: {{standard}}',
      standard,
    }),
  ]
  return (
    <FieldLabel
      // (under the step's title, aligned with its text)
      sx={{ mt: 0.75, pl: '38px', lineHeight: 1.5 }}
      tip={t('teamOpt.kqm.subtitleConsStandard', {
        defaultValue:
          'Standard KQM builds for this rotation: level 90; 4★ C6, standard 5★ C2, 5★ from the free constellation event C1, other 5★ C0 (each can be changed below); the talent levels set below; five +20 artifacts at the standard set below ({{standard}}).',
        standard,
      })}
    >
      {labels.join('  ·  ')}
    </FieldLabel>
  )
}

/**
 * What a KQM run is set up with, or was run with: each member's constellation and minimum ER,
 * the weapons and sets it compares, where its ER comes from. With `now`, what has changed since
 * is shown as it is now (→).
 */
/**
 * Whether the weapons a run compares were changed from KQM mode's own: the list (ticked or left
 * out) or a refinement
 */
function kqmWeaponsCustom(kqm: TeamOptKqm) {
  const excluded = kqmExcludedWeapons(kqm)
  const standard = new Set(kqmDefaultExcludedWeapons())
  const list =
    excluded.size !== standard.size ||
    [...excluded].some((key) => !standard.has(key))
  const refinements =
    (kqm.refinement5 ?? 1) !== 1 ||
    (kqm.refinement4 ?? 5) !== 5 ||
    (kqm.refinementStandard5 ?? 1) !== 1 ||
    (kqm.refinementBp ?? 1) !== 1 ||
    (kqm.refinementStandard4 ?? 5) !== 5 ||
    Object.keys(kqm.refinements ?? {}).length > 0
  const memberRestrictions =
    Object.keys(kqm.excludedWeaponMembers ?? {}).length > 0
  return list || refinements || memberRestrictions
}
/** Whether any artifact set was left out of a run's choice */
const kqmSetsCustom = (kqm: TeamOptKqm) => !!kqm.excludedSets?.length

export function KqmSetupSummary({
  members,
  settings,
  now,
  rotation,
  enemy,
  enemyNow,
  fight,
  sx,
}: {
  members: TeamOptMember[]
  settings: TeamOpt
  /** The builds in the fight (a Stygian boss: how long they take to defeat it) */
  fight?: FightTeam
  /** The setup as it is now */
  now?: TeamOpt
  /** The enemy the run was for (absent: run before this was kept; a custom one's HP: now's) */
  enemy?: FightEnemy
  /** The team's enemy now, when it is not the same */
  enemyNow?: RunEnemy
  /** Its rotation's attacks: the written rotation as KQM played it, or the attacks entered */
  rotation?: 'played' | 'entered'
  sx?: SxProps<Theme>
}) {
  const { t } = useTranslation(['page_team', 'weaponNames_gen'])
  const { gender } = useDBMeta()
  const kqm = settings.kqm ?? defaultTeamOptKqm
  const nowKqm = now ? (now.kqm ?? defaultTeamOptKqm) : undefined
  const fromCalculator = kqm.energySource === 'calculator'
  const keys = members.map((m) => m.characterKey)
  // (members at different standards, in the run or now: each member's pill shows its own)
  const standardsMixed =
    kqmStandardsMixed(kqm, keys) ||
    (!!nowKqm && kqmStandardsMixed(nowKqm, keys))
  const standard = kqmStandardText(t, kqm, keys)
  const nowStandard = nowKqm && kqmStandardText(t, nowKqm, keys)
  /** What it is now, if that changed */
  const nowIs = (value: ReactNode) => (
    <Box component="span" sx={{ color: tokens.gold, fontWeight: 600 }}>
      {' → '}
      {value}
    </Box>
  )
  const item = { display: 'inline-flex', alignItems: 'center', gap: 0.75 }
  /** The weapons or sets: as KQM mode picks them, or changed by hand */
  const choiceLabel = (custom: boolean) =>
    custom
      ? t('teamOpt.kqm.custom', 'Custom')
      : t('teamOpt.kqm.default', 'Default')
  /** The ER targets: from the ER calculator, or typed in */
  const erLabel = (calculated: boolean) =>
    calculated
      ? t('teamOpt.kqm.erAuto', 'Auto-calculated')
      : t('teamOpt.kqm.custom', 'Custom')
  return (
    <Box
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 2.5,
          rowGap: 1.25,
          ...numSx,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {/* the members: each a pill, its constellation and the ER it was built to */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {members.map(({ characterKey }) => {
          const cons = kqmMemberConstellation(characterKey, kqm)
          const nowCons = nowKqm && kqmMemberConstellation(characterKey, nowKqm)
          const er = kqmEnergyRequirement(kqm, characterKey)
          const nowEr = nowKqm && kqmEnergyRequirement(nowKqm, characterKey)
          const lock = kqmLockedWeapon(characterKey, kqm)
          const memberStandard = kqmMemberStandard(characterKey, kqm)
          const nowMemberStandard =
            nowKqm && kqmMemberStandard(characterKey, nowKqm)
          return (
            <SuspenseTooltip
              key={characterKey}
              arrow
              title={
                <>
                  <CharacterName characterKey={characterKey} gender={gender} />
                  {`: C${cons}, ${t('teamOpt.kqm.minEr', 'Min ER')} ${er}%`}
                  {standardsMixed && `, ${kqmStandardName(t, memberStandard)}`}
                  {lock &&
                    `, ${t(`weaponNames_gen:${lock.key}`, lock.key)} R${lock.refinement} (${t('teamOpt.kqm.weaponLocked', 'Weapon locked')})`}
                </>
              }
            >
              <Box
                component="span"
                sx={{
                  ...item,
                  gap: 0.75,
                  height: 32,
                  pl: 0.375,
                  pr: 1.25,
                  borderRadius: 999,
                  bgcolor: alpha(giTokens.parchment, 0.035),
                  boxShadow: `inset 0 0 0 1px ${tokens.hairline}`,
                  fontSize: 13,
                }}
              >
                <MemberAvatar characterKey={characterKey} size={24} />
                <Box
                  component="span"
                  sx={{ color: 'text.primary', fontWeight: 650 }}
                >
                  C{cons}
                </Box>
                {nowCons !== undefined &&
                  nowCons !== cons &&
                  nowIs(`C${nowCons}`)}
                <Box component="span" sx={{ color: 'text.secondary' }}>
                  {er}% {t('teamOpt.kqm.erShort', 'ER')}
                </Box>
                {nowKqm && nowEr !== er && nowIs(`${nowEr}%`)}
                {standardsMixed &&
                  nowMemberStandard !== undefined &&
                  nowMemberStandard !== memberStandard &&
                  nowIs(kqmStandardName(t, nowMemberStandard))}
                {lock && (
                  <LockOutlinedIcon
                    aria-label={t('teamOpt.kqm.weaponLocked', 'Weapon locked')}
                    sx={{ fontSize: 14, color: 'primary.main', ml: -0.25 }}
                  />
                )}
              </Box>
            </SuspenseTooltip>
          )
        })}
      </Box>
      {/* the run's settings: small labelled figures, hairlines between them */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'stretch',
          rowGap: 1,
          '& > *': { px: 1.75, borderLeft: `1px solid ${tokens.hairline}` },
          '& > *:first-of-type': { pl: { xs: 0, md: 1.75 } },
          '@media (max-width: 899.95px)': {
            '& > *:first-of-type': { borderLeft: 0 },
          },
        }}
      >
        <SpecStat label={t('teamOpt.kqm.search', 'Search')}>
          {kqm.fullSearch
            ? t('teamOpt.kqm.searchFull', 'Full')
            : t('teamOpt.kqm.searchQuick', 'Quick')}
          {nowKqm &&
            !!nowKqm.fullSearch !== !!kqm.fullSearch &&
            nowIs(
              nowKqm.fullSearch
                ? t('teamOpt.kqm.searchFull', 'Full')
                : t('teamOpt.kqm.searchQuick', 'Quick')
            )}
        </SpecStat>
        <SpecStat label={t('teamOpt.kqm.talents', 'Talents')}>
          {`${kqmTalentLevel(kqm)}/${kqmTalentLevel(kqm)}/${kqmTalentLevel(kqm)}`}
          {nowKqm &&
            kqmTalentLevel(nowKqm) !== kqmTalentLevel(kqm) &&
            nowIs(
              `${kqmTalentLevel(nowKqm)}/${kqmTalentLevel(nowKqm)}/${kqmTalentLevel(nowKqm)}`
            )}
        </SpecStat>
        <SpecStat label={t('teamOpt.kqm.artifactsLabel', 'Artifacts')}>
          {standard}
          {nowStandard && nowStandard !== standard && nowIs(nowStandard)}
        </SpecStat>
        <SpecStat label={t('teamOpt.kqm.weaponsLabel', 'Weapons')}>
          {choiceLabel(kqmWeaponsCustom(kqm))}
          {nowKqm &&
            kqmWeaponsCustom(nowKqm) !== kqmWeaponsCustom(kqm) &&
            nowIs(choiceLabel(kqmWeaponsCustom(nowKqm)))}
        </SpecStat>
        <SpecStat label={t('teamOpt.kqm.setsLabel', 'Artifact sets')}>
          {choiceLabel(kqmSetsCustom(kqm))}
          {nowKqm &&
            kqmSetsCustom(nowKqm) !== kqmSetsCustom(kqm) &&
            nowIs(choiceLabel(kqmSetsCustom(nowKqm)))}
        </SpecStat>
        <SpecStat label={t('teamOpt.kqm.erLabel', 'ER target')}>
          {erLabel(fromCalculator)}
          {nowKqm &&
            nowKqm.energySource !== kqm.energySource &&
            nowIs(erLabel(nowKqm.energySource === 'calculator'))}
        </SpecStat>
        {enemy && (
          <SpecStat label={t('teamOpt.enemy.label', 'Enemy')}>
            <EnemySummary enemy={enemy} />
            <EnemyDefeatTime enemy={enemy} team={fight} />
            {enemyNow && nowIs(<EnemySummary enemy={enemyNow} />)}
          </SpecStat>
        )}
        {rotation === 'played' && (
          <Tooltip
            arrow
            title={t(
              'teamOpt.kqm.rotationPlayedTip',
              'The written rotation played for these builds: at these constellations, with their weapons and artifact sets, counting the rotations chosen beside it (Steady DPS unless you chose others).'
            )}
          >
            <Box sx={{ display: 'grid', cursor: 'help' }}>
              <SpecStat label={t('teamOpt.kqm.rotationLabel', 'Rotation')}>
                {t(
                  'teamOpt.kqm.rotationPlayedValue',
                  'Played for these builds'
                )}
              </SpecStat>
            </Box>
          </Tooltip>
        )}
      </Box>
    </Box>
  )
}

/** One of the run's settings: a small label over its value */
function SpecStat({
  label,
  children,
}: {
  label: ReactNode
  children: ReactNode
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr)',
        alignContent: 'start',
        gap: 0.25,
        minWidth: 0,
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize: 11.5,
          fontWeight: 500,
          color: 'text.secondary',
          lineHeight: 1.2,
        }}
      >
        {label}
      </Typography>
      <Typography
        component="span"
        sx={{
          fontSize: 13.5,
          fontWeight: 650,
          lineHeight: 1.3,
          display: 'inline-flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 0.75,
          rowGap: 0.25,
          minHeight: 22,
          overflowWrap: 'anywhere',
          ...numSx,
        }}
      >
        {children}
      </Typography>
    </Box>
  )
}

/**
 * What to know about the run, as chips at the bar's right: the waits a rotation keeps hitting, the
 * rotation or the setup changed since
 */
function KqmRunNotes({
  stalls,
  rotationChanged,
  stale,
}: {
  stalls?: { label: string; seconds: number }[]
  rotationChanged?: boolean
  stale?: boolean
}) {
  const { t } = useTranslation('page_team')
  const warn = useTheme().palette.warning.main
  const chip = (tone: string) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.625,
    height: 28,
    px: 1.25,
    borderRadius: 999,
    fontSize: 12.5,
    fontWeight: 600,
    color: tone,
    bgcolor: alpha(tone, 0.1),
    boxShadow: `inset 0 0 0 1px ${alpha(tone, 0.28)}`,
    whiteSpace: 'nowrap',
  })
  return (
    <>
      {!!stalls?.length && (
        <Tooltip
          arrow
          title={
            <Box>
              {t(
                'teamOpt.kqm.stallsTip',
                'Played several times in a row, the rotation reaches these before they are ready again, and waits each time (its time and DPS include the wait). Write them with a ? to use them only when ready ("Sucrose N1 E? D"), or use something else there (a Charged Attack).'
              )}
              {stalls.map(({ label, seconds }) => (
                <Box key={label} sx={{ mt: 0.5, ...numSx }}>
                  {stallLabel(label)}: {seconds.toFixed(1)} s
                </Box>
              ))}
            </Box>
          }
        >
          <Box
            component="span"
            sx={{ ...chip(warn), cursor: 'help', ...numSx }}
          >
            <WarningAmberRoundedIcon sx={{ fontSize: 15 }} />
            {t('teamOpt.kqm.stalls', {
              defaultValue: 'Waits {{seconds}} s per rotation',
              seconds: stalls.reduce((n, s) => n + s.seconds, 0).toFixed(1),
            })}
          </Box>
        </Tooltip>
      )}
      {rotationChanged && (
        <Box component="span" sx={chip(giTokens.gold)}>
          {t('teamOpt.kqm.rotationChanged', 'Rotation changed')}
        </Box>
      )}
      {stale && (
        <Box component="span" role="status" sx={chip(warn)}>
          <WarningAmberRoundedIcon sx={{ fontSize: 15 }} />
          {t('teamOpt.kqm.staleShort', 'Setup changed. Run again to refresh.')}
        </Box>
      )}
    </>
  )
}
/** A wait's label: `<member> <action>` (the member's name, then the action) or `swap <member>` */
function StallLabel({ label }: { label: string }) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const [first, ...rest] = label.split(' ')
  const swap = first === 'swap'
  const characterKey = (swap ? rest[0] : first) as CharacterKey
  return (
    <>
      {swap && `${t('teamOpt.kqm.stallSwap', 'swap to')} `}
      <CharacterName characterKey={characterKey} gender={gender} />
      {!swap && ` ${rest.join(' ')}`}
    </>
  )
}
const stallLabel = (label: string) => <StallLabel label={label} />

/** A member's KQM constellation: the standard one (marked) or any other, C0–C6 */
function KqmConstellationSelect({
  value,
  standard,
  disabled,
  characterKey,
  onChange,
}: {
  value: number
  standard: number
  disabled?: boolean
  characterKey: CharacterKey
  onChange: (value: number) => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Select
      size="small"
      fullWidth
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      inputProps={{
        'aria-label': t('teamOpt.kqm.consLabel', {
          defaultValue: '{{character}} constellation',
          character: characterKey,
        }),
      }}
      renderValue={(v) => `C${v}`}
      MenuProps={{ PaperProps: { sx: { minWidth: 180 } } }}
      sx={(theme) => ({
        ...compactFieldSx,
        // (another constellation than the standard one: an edited value)
        ...(value !== standard && {
          color: 'primary.main',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: alpha(theme.palette.primary.main, 0.6),
          },
        }),
      })}
    >
      {[0, 1, 2, 3, 4, 5, 6].map((c) => (
        <MenuItem key={c} value={c} sx={numSx}>
          C{c}
          {c === standard && (
            <Box component="span" sx={{ ...type.label, ml: 'auto', pl: 2 }}>
              {t('teamOpt.kqm.consStandard', 'KQM standard')}
            </Box>
          )}
        </MenuItem>
      ))}
    </Select>
  )
}

const compactCount = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/**
 * A KQM run's progress in the run bar: the round, the member and what is being searched for it
 * (weapons, then artifacts), then the rankings; the members done; the estimated progress line
 */
export function KqmProgress({
  teamId,
  members,
  startTime,
}: {
  teamId: string
  members: CharacterKey[]
  startTime: number
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const step = useKqmProgress(teamId)
  const [, rerender] = useState(0)
  // the elapsed time ticks on its own
  useInterval(() => rerender((n) => n + 1), 1000)
  const seconds = Math.round((performance.now() - startTime) / 1000)
  const percent = Math.round((step?.progress ?? 0) * 100)
  const ranking = step?.phase === 'ranking'
  const at = step ? members.indexOf(step.characterKey) : -1
  const memberState = (i: number) =>
    !step
      ? 'pending'
      : ranking
        ? i < step.step
          ? 'done'
          : 'pending'
        : i < at
          ? 'done'
          : i === at
            ? 'current'
            : 'pending'
  const counts =
    step?.total !== undefined && step.total > 0
      ? ` ${Math.min(step.done ?? 0, step.total)}/${step.total}`
      : ''
  const what = !step
    ? t('teamOpt.kqm.progress.start', 'Building the team')
    : ranking
      ? `${t('teamOpt.kqm.progress.ranking', 'Ranking sets and weapons')}${counts}`
      : step.stage === 'artifacts'
        ? `${t('teamOpt.kqm.progress.artifacts', 'searching artifacts')}${counts}`
        : `${t('teamOpt.kqm.progress.weapons', 'trying weapons')}${counts}`
  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          minWidth: 0,
          flexGrow: 1,
        }}
        role="status"
        aria-live="polite"
      >
        <Box
          sx={{ display: { xs: 'none', sm: 'flex' }, gap: 0.5, flexShrink: 0 }}
          aria-hidden
        >
          {members.map((ck, i) => {
            const state = memberState(i)
            return (
              <Box
                key={ck}
                sx={{
                  display: 'flex',
                  borderRadius: '50%',
                  opacity: state === 'pending' ? 0.4 : 1,
                  boxShadow:
                    state === 'current' ? `0 0 0 2px ${tokens.gold}` : 'none',
                  transition: 'opacity .2s, box-shadow .2s',
                  '@media (prefers-reduced-motion: reduce)': {
                    transition: 'none',
                  },
                }}
              >
                <MemberAvatar characterKey={ck} size={26} />
              </Box>
            )
          })}
        </Box>
        {step && !ranking && (
          <Box sx={{ display: { xs: 'flex', sm: 'none' }, flexShrink: 0 }}>
            <MemberAvatar characterKey={step.characterKey} size={24} />
          </Box>
        )}
        <Typography noWrap sx={{ ...type.body, ...numSx, minWidth: 0 }}>
          {step && !ranking && (
            <>
              <Box component="span" sx={{ fontWeight: 600 }}>
                {step.improving
                  ? t('teamOpt.kqm.progress.improving', 'Improving')
                  : t('teamOpt.kqm.progress.round', {
                      defaultValue: 'Round {{round}}',
                      round: step.round,
                    })}
                {' · '}
                <CharacterName
                  characterKey={step.characterKey}
                  gender={gender}
                />
              </Box>
              {' · '}
            </>
          )}
          <Box
            component="span"
            sx={{ fontWeight: ranking || !step ? 600 : 400 }}
          >
            {what}
          </Box>
        </Typography>
        <Tooltip
          title={t('teamOpt.kqm.progress.tried', {
            defaultValue: '{{count}} builds tried',
            count: step?.tried ?? 0,
          })}
        >
          <Box
            component="span"
            sx={{
              ...type.label,
              ...numSx,
              flexShrink: 0,
              ml: 'auto',
              pl: 1,
              whiteSpace: 'nowrap',
            }}
          >
            {percent}%
            <Box
              component="span"
              sx={{ display: { xs: 'none', md: 'inline' } }}
            >
              {' · '}
              {t('teamOpt.kqm.progress.builds', {
                defaultValue: '{{n}} builds',
                n: compactCount.format(step?.tried ?? 0),
                count: step?.tried ?? 0,
              })}
            </Box>
            {' · '}
            {seconds} s
          </Box>
        </Tooltip>
      </Box>
      <LinearProgress
        aria-hidden
        variant="determinate"
        value={percent}
        sx={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 2,
          bgcolor: 'transparent',
        }}
      />
    </>
  )
}

function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const timer = setInterval(() => ref.current(), ms)
    return () => clearInterval(timer)
  }, [ms])
}

/** A compact team overview; the selected member is explored in a single inspector. */
/** A member's constellation as a pill: gold from C1, quiet at C0 */
/** A member's Energy Recharge as a tag: amber below its requirement (the requirement on hover) */
function ErTag({ er }: { er: { value: number; minimum: number } }) {
  const { t } = useTranslation('page_team')
  const short = er.value + 1e-6 < er.minimum
  const label = t('teamOpt.kqm.erResult', {
    defaultValue: 'ER {{value}}% / {{minimum}}% required',
    value: +er.value.toFixed(1),
    minimum: +er.minimum.toFixed(1),
  })
  return (
    <Tooltip arrow title={label}>
      <Box
        component="span"
        aria-label={label}
        sx={(theme) => {
          const tone = short ? theme.palette.warning.main : giTokens.parchment
          return {
            // (as the constellation pill beside it)
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.375,
            height: 18,
            pl: 0.625,
            pr: 0.75,
            borderRadius: 999,
            flexShrink: 0,
            fontSize: 11.5,
            fontWeight: 650,
            letterSpacing: 0.2,
            cursor: 'help',
            color: short ? 'warning.main' : 'text.secondary',
            bgcolor: alpha(tone, short ? 0.14 : 0.07),
            ...(short && {
              boxShadow: `inset 0 0 0 1px ${alpha(tone, 0.5)}`,
            }),
            '& svg': { fontSize: 12 },
            ...numSx,
          }
        }}
      >
        <StatIcon statKey="enerRech_" />
        {er.value.toFixed(0)}%
      </Box>
    </Tooltip>
  )
}

/** Like 70%; under 10%, one decimal (1.5%) */
function shareText(share: number) {
  const pct = share * 100
  if (pct >= 10 || pct === 0) return `${Math.round(pct)}%`
  return `${pct < 0.1 ? '<0.1' : pct.toFixed(1)}%`
}

/** A damage figure in full, large, with its unit small beside it: 63,592 DPS */
function DamageFigure({ value, unit }: { value: string; unit: string }) {
  return (
    <Typography
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 0.75,
        whiteSpace: 'nowrap',
        lineHeight: 1.15,
        ...numSx,
      }}
    >
      <Box
        component="span"
        sx={{
          fontSize: { xs: 19, sm: 24 },
          fontWeight: 700,
          letterSpacing: '-0.02em',
        }}
      >
        {value}
      </Box>
      <Box
        component="span"
        sx={{
          display: { xs: 'none', sm: 'inline' },
          fontSize: 12,
          fontWeight: 500,
          color: 'text.secondary',
        }}
      >
        {unit}
      </Box>
    </Typography>
  )
}

/** A member's share of the team's damage, as a figure: 70% of team */
function ShareFigure({
  share,
  rotationTime,
}: {
  share: number
  rotationTime?: number
}) {
  const { t } = useTranslation('page_team')
  const tip = rotationTime
    ? t('teamOpt.result.shareDps', 'Its share of the team’s DPS')
    : t('teamOpt.result.share', 'Its share of the team’s damage')
  const text = shareText(share)
  return (
    <Tooltip arrow title={tip}>
      <Box
        component="span"
        aria-label={`${text}: ${tip}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 0.5,
          whiteSpace: 'nowrap',
          cursor: 'default',
          ...numSx,
        }}
      >
        <Box
          component="span"
          sx={{ fontSize: { xs: 13, sm: 14 }, fontWeight: 650 }}
        >
          {text}
        </Box>
        <Box
          component="span"
          sx={{
            display: { xs: 'none', sm: 'inline' },
            fontSize: 12,
            fontWeight: 500,
            color: 'text.secondary',
          }}
        >
          {t('teamOpt.result.shareLabel', 'of team')}
        </Box>
      </Box>
    </Tooltip>
  )
}

/** A member's share of the team's damage, as a bar in its element's colour */
function ShareBar({
  characterKey,
  share,
}: {
  characterKey: CharacterKey
  share: number
}) {
  return (
    <Box
      aria-hidden
      sx={{
        mt: 1,
        height: 4,
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: alpha(giTokens.parchment, 0.08),
      }}
    >
      <Box
        sx={(theme) => ({
          height: '100%',
          width: `${Math.min(1, Math.max(0, share)) * 100}%`,
          borderRadius: 2,
          bgcolor: alpha(elementColor(theme, characterKey), 0.85),
          // (it moves when a pick changes the team)
          transition: 'width .35s cubic-bezier(.2,.7,.2,1)',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      />
    </Box>
  )
}

function ConstellationPill({ value }: { value: number }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        height: 18,
        px: 0.75,
        borderRadius: 999,
        fontSize: 11.5,
        fontWeight: 700,
        letterSpacing: 0.2,
        ...numSx,
        ...(value > 0
          ? {
              color: theme.palette.primary.main,
              bgcolor: alpha(theme.palette.primary.main, 0.16),
              boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.5)}`,
            }
          : {
              color: 'text.secondary',
              bgcolor: alpha(theme.palette.text.primary, 0.07),
            }),
      })}
    >
      C{value}
    </Box>
  )
}

/**
 * How many background threads build a run's formulas on this device: automatic (by its memory and
 * cores), or chosen. Kept per device, not with the team.
 */
function KqmThreads() {
  const { t } = useTranslation('page_team')
  const [threads, setThreads] = useState(kqmBuildThreads)
  const auto = kqmBuildThreadsAuto()
  const most = kqmBuildThreadsMax()
  const label = t('teamOpt.kqm.threads', 'Threads')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      <FieldLabel
        tip={t(
          'teamOpt.kqm.threadsTip',
          'Background threads that build the team’s formulas during a run. More finish sooner; each uses about 200 MB of memory while a run lasts. Auto picks from this device’s memory and cores.'
        )}
      >
        {label}
      </FieldLabel>
      <Select
        size="small"
        value={threads === undefined ? 'auto' : String(Math.min(threads, most))}
        inputProps={{ 'aria-label': label }}
        onChange={(e) => {
          const next =
            e.target.value === 'auto' ? undefined : Number(e.target.value)
          setKqmBuildThreads(next)
          setThreads(next)
        }}
        sx={{ minWidth: 92, '& .MuiSelect-select': { py: 0.5 } }}
      >
        <MenuItem value="auto">
          {t('teamOpt.kqm.threadsAuto', {
            defaultValue: 'Auto ({{n}})',
            n: auto,
          })}
        </MenuItem>
        {Array.from({ length: most }, (_, i) => i + 1).map((n) => (
          <MenuItem key={n} value={String(n)}>
            {n}
          </MenuItem>
        ))}
      </Select>
    </Box>
  )
}

/**
 * Above preliminary results: they are the run's best so far, not final (with its progress), and
 * once its result replaces them, a moment, that they are final. Its own component: the progress
 * redraws it, not the results.
 */
function KqmPreliminary({ teamId, final }: { teamId: string; final: boolean }) {
  const { t } = useTranslation('page_team')
  const step = useKqmProgress(teamId)
  const percent = Math.round((step?.progress ?? 0) * 100)
  const tone = final ? 'success.main' : tokens.gold
  return (
    <Box
      role="status"
      aria-live="polite"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        mb: 2,
        px: 1.5,
        py: 1,
        borderRadius: tokens.radius.inset,
        border: '1px solid',
        borderColor: final
          ? (theme) => alpha(theme.palette.success.main, 0.4)
          : alpha(tokens.gold, 0.45),
        bgcolor: final
          ? (theme) => alpha(theme.palette.success.main, 0.08)
          : alpha(tokens.gold, 0.08),
      }}
    >
      {final ? (
        <CheckCircleOutlineIcon sx={{ fontSize: 18, color: tone }} />
      ) : (
        <CircularProgress size={14} thickness={5} sx={{ color: tone }} />
      )}
      <Typography sx={{ ...type.body, fontWeight: 600, color: tone }}>
        {final
          ? t('teamOpt.kqm.finalBuilds', 'Final builds')
          : t('teamOpt.kqm.preliminary', 'Preliminary builds')}
      </Typography>
      {!final && (
        <>
          <Typography sx={type.label}>
            {t('teamOpt.kqm.stillImproving', 'still improving')}
          </Typography>
          <InfoTooltipInline
            title={t(
              'teamOpt.kqm.preliminaryTip',
              'The best builds found so far. The run is still trying better weapons, sets and teammates’ builds: the figures, builds and rankings here can still change, and update when it finds better ones.'
            )}
          />
          <Typography sx={{ ...type.label, ...numSx, ml: 'auto' }}>
            {percent}%
          </Typography>
          <LinearProgress
            aria-hidden
            variant="determinate"
            value={percent}
            sx={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: 2,
              bgcolor: 'transparent',
              '& .MuiLinearProgress-bar': { bgcolor: tokens.gold },
            }}
          />
        </>
      )}
    </Box>
  )
}

export function KqmResults({
  teamId,
  runSettings,
  members,
  result,
  seconds,
  rotationTime,
  stale,
  now,
  setup,
  rotation,
  stalls,
  running,
  improving,
  onDiscard,
  actions,
  onCompareInvestments,
  onView,
  teamData,
  timeline,
  enemy,
  enemyNow,
  applications,
}: {
  teamId: string
  runSettings: TeamOpt
  /** The written rotation's element applications per second (a Stygian boss's mechanics) */
  applications?: FightApplications
  /** The enemy it was found for (absent: found before this was kept) */
  enemy?: RunEnemy
  /** The team's enemy now, when it is not the same */
  enemyNow?: RunEnemy
  /** Under the results: the written rotation's timeline as these builds play it */
  timeline?: ReactNode
  /** The members' data: only which element each attack deals (the damage share by element) */
  teamData?: TeamData
  /** The setup as it is now (what changed since the run is shown) */
  now?: TeamOpt
  /** The setup as it was set for the run (`runSettings` has the rotation it played) */
  setup?: TeamOpt
  /** The rotation's attacks: the written rotation as KQM played it, or the attacks entered */
  rotation?: 'played' | 'entered'
  /** What each rotation waited for to be ready, played as KQM plays it */
  stalls?: { label: string; seconds: number }[]
  members: TeamOptMember[]
  result: KqmResult
  seconds: number
  rotationTime?: number
  stale?: boolean
  running?: boolean
  /** The run's builds so far: it is still looking for better ones (its members can be viewed) */
  improving?: boolean
  onDiscard: () => void
  /** More actions beside Share (the team's versions) */
  actions?: ReactNode
  /** Scroll to / focus the interactive Investment comparison panel */
  onCompareInvestments?: () => void
  /** The builds shown now: the run's, or the team with other equipment picked here */
  onView?: (view: KqmResult) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const database = useDatabase()
  const team = useTeam(teamId)
  const kqmTeam = useMemo(() => team && kqmEnemyTeam(team), [team])
  const [shown, setShown] = useState<CharacterKey | undefined>(
    result.optimized[0]
  )
  // Fight settings follow the live enemy while it takes the same damage.
  const fightEnemy = useMemo(
    () => (enemy && kqmTeam && sameRunEnemy(enemy, kqmTeam) ? kqmTeam : enemy),
    [enemy, kqmTeam]
  )
  const opening = startsWithoutEnergy(fightEnemy)
    ? applications?.opening
    : undefined
  // the builds in the Moongecko's Radiant Cocoon and Disentangled, when the run's enemy is it
  const cocoonSettings = useMemo(
    () =>
      enemy && (appliedStygianPreset(enemy) || opening)
        ? (() => {
            const overrides = kqmTeamOverrides(
              database,
              teamId,
              runSettings,
              result
            )
            return {
              ...overrides,
              arts: overrides.arts ?? {},
              attacks: runSettings.attacks,
            }
          })()
        : undefined,
    [enemy, opening, database, teamId, runSettings, result]
  )
  const moongecko =
    !!enemy && appliedStygianPreset(enemy)?.boss.id === MOONGECKO_BOSS
  const cocoon = useCocoonEvaluations(teamId, cocoonSettings, {
    cocoon: moongecko,
    opening: opening?.attacks,
  })
  const compared =
    shown && result.optimized.includes(shown) ? shown : result.optimized[0]
  // (the member tiles' icons a size smaller on a phone)
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  // other equipment picked in the inspector: the team as it plays with it (the figures above follow)
  const [comparing, setComparing] = useState<KqmResult>()
  // a top team picked: its inspector compares on the run's own team (not on other picks), while
  // the figures shown stay until its team is worked out
  const [fromRun, setFromRun] = useState(false)
  const showView = useCallback((next: KqmResult | undefined) => {
    setFromRun(false)
    setComparing(next)
  }, [])
  // (a new run starts from its own builds)
  useEffect(() => setComparing(undefined), [result])
  const view = comparing ?? result
  const dataEnemy = team?.enemyOverride
  const fight = useMemo(
    () =>
      // (the Moongecko's fight needs its cocoon evaluations: no estimate without them)
      enemy && (!moongecko || cocoon)
        ? fightTeamOf({
            members: members.map((m) => m.characterKey),
            evaluation: result.after,
            attacks: runSettings.attacks,
            teamData,
            rotationTime,
            enemyOverride: enemy.enemyOverride,
            dataEnemy,
            applications,
            cocoon,
          })
        : undefined,
    [
      enemy,
      moongecko,
      members,
      result.after,
      runSettings.attacks,
      teamData,
      rotationTime,
      dataEnemy,
      applications,
      cocoon,
    ]
  )
  useEffect(() => onView?.(view), [onView, view])
  // a top team picked: its member's equipment, as picked in the inspector (the others the run's)
  const [picked, setPicked] = useState(0)
  const pickTeam = (option: KqmTeamOption) => {
    setKqmPicks(
      result,
      option.changed ? { [option.changed]: option.builds[option.changed]! } : {}
    )
    setFromRun(true)
    if (option.changed) setShown(option.changed)
    // (the inspector reads the picks when it opens: open it again)
    setPicked((n) => n + 1)
  }
  const unit = rotationTime
    ? t('teamOpt.kqm.dpsUnit', 'DPS')
    : t('teamOpt.kqm.dmgUnit', 'DMG')
  // the run's result replacing its preliminary builds: said for a moment
  const [finished, setFinished] = useState(false)
  const wasImproving = useRef(improving)
  useEffect(() => {
    const was = wasImproving.current
    wasImproving.current = improving
    if (!was || improving) return
    setFinished(true)
    const id = setTimeout(() => setFinished(false), 4000)
    return () => clearTimeout(id)
  }, [improving])
  return (
    <Box
      id={`kqm-results-${teamId}`}
      sx={{
        p: { xs: 1, sm: 2 },
        scrollMarginTop: 88,
        containerType: 'inline-size',
      }}
    >
      {/* the team's result, and what to do with it */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          columnGap: 2,
          rowGap: 1.5,
          flexWrap: 'wrap',
          mb: 2,
        }}
      >
        <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
          <StepTitle step={3} result>
            {t('teamOpt.kqm.teamBuilds', 'Team builds')}
          </StepTitle>
          {/* the headline figure, under the step's title and aligned with its text */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              columnGap: 1,
              rowGap: 0.25,
              mt: 1,
              pl: '38px',
              flexWrap: 'wrap',
            }}
          >
            <Typography sx={{ ...type.figure, fontSize: { xs: 28, sm: 34 } }}>
              {formatRateFull(view.after.total, rotationTime)}
            </Typography>
            <Typography sx={type.label}>
              {improving
                ? rotationTime
                  ? t('teamOpt.kqm.teamDpsSoFar', 'team DPS so far')
                  : t('teamOpt.kqm.teamDmgSoFar', 'team DMG so far')
                : rotationTime
                  ? t('teamOpt.kqm.teamDps', 'team DPS')
                  : t('teamOpt.kqm.teamDmg', 'team DMG')}
            </Typography>
            {comparing && (
              <Tooltip
                arrow
                title={t('teamOpt.kqm.vsBestTip', {
                  defaultValue: 'The run’s best builds: {{total}}',
                  total: formatRateFull(result.after.total, rotationTime),
                })}
              >
                <Typography
                  sx={{
                    ...type.label,
                    ...numSx,
                    cursor: 'help',
                    color:
                      comparing.after.total >= result.after.total
                        ? 'success.main'
                        : 'text.secondary',
                  }}
                >
                  {t('teamOpt.kqm.vsBest', {
                    defaultValue: '{{diff}} vs best',
                    diff: `${comparing.after.total >= result.after.total ? '+' : '−'}${Math.abs((comparing.after.total / result.after.total - 1) * 100).toFixed(1)}%`,
                  })}
                </Typography>
              </Tooltip>
            )}
          </Box>
        </Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            ml: 'auto',
          }}
        >
          {actions}
          {onCompareInvestments && (
            <Tooltip
              arrow
              title={t(
                'teamOpt.invest.jumpTip',
                'Compare pull budgets across constellations, R1 signatures, and conditional rotations'
              )}
            >
              <span>
                <Button
                  variant="outlined"
                  color="inherit"
                  disabled={running}
                  startIcon={<TrendingUpRoundedIcon sx={{ fontSize: 18 }} />}
                  onClick={onCompareInvestments}
                  sx={{
                    height: 40,
                    px: 1.75,
                    borderRadius: 999,
                    textTransform: 'none',
                    fontSize: 13.5,
                    fontWeight: 600,
                    borderColor: tokens.hairlineStrong,
                    color: 'text.primary',
                    bgcolor: alpha(giTokens.parchment, 0.04),
                    ...quickSx,
                    ...focusSx,
                    '&:hover': {
                      borderColor: alpha(tokens.gold, 0.6),
                      bgcolor: alpha(tokens.gold, 0.1),
                      color: giTokens.goldLight,
                    },
                  }}
                >
                  {t('teamOpt.invest.buttonShort', 'Investments')}
                </Button>
              </span>
            </Tooltip>
          )}
          <KqmShareMenu
            teamId={teamId}
            result={result}
            shown={view}
            setup={setup ?? runSettings}
            members={members}
            characterKey={compared}
            rotationTime={rotationTime}
            disabled={running || stale}
          />
          <Tooltip arrow title={t('teamOpt.result.discard', 'Discard')}>
            <span>
              <IconButton
                size="small"
                disabled={running}
                onClick={onDiscard}
                aria-label={t('teamOpt.result.discard', 'Discard')}
                sx={{ ...quickSx, ...focusSx }}
              >
                <CloseIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>
      {/* while the run improves on them: these are not final; then, a moment, that they are (under
          the step's title, which leads the step as the others do) */}
      {(improving || finished) && (
        <KqmPreliminary teamId={teamId} final={!improving} />
      )}
      {/* what these builds were run with (what has changed since: → now), and what to know about the
          run, as chips at its right */}
      <Box
        sx={{
          ...insetSx,
          display: 'grid',
          gap: 1.25,
          px: { xs: 1.5, sm: 2 },
          py: 1.5,
          mt: -0.5,
          mb: 2.5,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1,
            rowGap: 0.75,
            minHeight: 28,
          }}
        >
          <FieldLabel
            tip={t(
              'teamOpt.kqm.runWithTip',
              'The setup these builds were made with. A value after → is what it is now: run again to use it.'
            )}
          >
            {t('teamOpt.kqm.runWith', 'Run with')}
          </FieldLabel>
          <Box
            sx={{
              ml: 'auto',
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              gap: 0.75,
            }}
          >
            <KqmRunNotes
              stalls={stalls}
              stale={stale}
              rotationChanged={
                !!stale &&
                !!now &&
                JSON.stringify(now.attacks) !==
                  JSON.stringify((setup ?? runSettings).attacks)
              }
            />
          </Box>
        </Box>
        <KqmSetupSummary
          members={members}
          settings={setup ?? runSettings}
          now={stale ? now : undefined}
          rotation={rotation}
          enemy={fightEnemy}
          enemyNow={enemyNow}
          fight={fight}
        />
      </Box>
      {/* one tile per member: pick whose build to inspect */}
      <Box
        role="tablist"
        aria-label={t('teamOpt.kqm.teamBuilds', 'Team builds')}
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            md: `repeat(${Math.min(4, members.length)}, minmax(0, 1fr))`,
          },
          gap: 1,
          mb: 2,
        }}
      >
        {members.map(({ characterKey }) => {
          // (with the equipment picked in the inspector, when it is not the run's)
          const build = view.builds[characterKey]
          const er = view.energyRecharge[characterKey]
          const share =
            view.after.total > 0
              ? (view.after.members[characterKey] ?? 0) / view.after.total
              : 0
          const selected = compared === characterKey
          return (
            <ButtonBase
              key={characterKey}
              role="tab"
              aria-selected={selected}
              aria-label={characterKey}
              disabled={!build || (running && !improving)}
              onClick={() => setShown(characterKey)}
              sx={(theme) => ({
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                textAlign: 'left',
                p: { xs: 1.5, sm: 2 },
                borderRadius: tokens.radius.inset,
                minWidth: 0,
                border: `1px solid ${selected ? 'transparent' : tokens.hairlineStrong}`,
                ...(selected && selectedSx(theme)),
                ...quickSx,
                ...focusSx,
                '&:hover': {
                  bgcolor: selected
                    ? alpha(theme.palette.primary.main, 0.14)
                    : alpha(theme.palette.text.primary, 0.035),
                },
                '&.Mui-disabled': { opacity: build ? 0.6 : 0.5 },
              })}
            >
              {/* who: its name, constellation and ER; its weapon and sets (on a phone the name
                  below, its whole width) */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: { xs: 'wrap', sm: 'nowrap' },
                  columnGap: 1.25,
                  rowGap: 1,
                  minWidth: 0,
                }}
              >
                <MemberAvatar
                  characterKey={characterKey}
                  size={narrow ? 30 : 38}
                />
                <Box
                  sx={{
                    minWidth: 0,
                    flex: { xs: '1 0 100%', sm: '1 1 0' },
                    order: { xs: 3, sm: 0 },
                  }}
                >
                  <Typography
                    noWrap
                    sx={{
                      fontSize: { xs: 13, sm: 14 },
                      fontWeight: 600,
                      lineHeight: 1.3,
                      letterSpacing: '-0.005em',
                    }}
                  >
                    <CharacterName
                      characterKey={characterKey}
                      gender={gender}
                    />
                  </Typography>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: 0.5,
                      mt: 0.5,
                    }}
                  >
                    <ConstellationPill
                      value={result.constellations[characterKey] ?? 0}
                    />
                    {er && <ErTag er={er} />}
                    {!build && (
                      <Typography
                        sx={{ ...type.label, fontSize: 12, lineHeight: 1.4 }}
                      >
                        {t('teamOpt.result.kept', 'Kept')}
                      </Typography>
                    )}
                  </Box>
                </Box>
                {build && (
                  <Box
                    sx={{ flexShrink: 0, alignSelf: 'flex-start', ml: 'auto' }}
                  >
                    <KqmGearIcons
                      characterKey={characterKey}
                      build={build}
                      size={narrow ? 28 : 36}
                    />
                  </Box>
                )}
              </Box>
              {/* its damage and its share of the team's: the figures, then the bar (the bars
                  line up across the members) */}
              <Box sx={{ mt: { xs: 1.5, sm: 2 } }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    columnGap: 1,
                  }}
                >
                  <DamageFigure
                    value={formatRateFull(
                      view.after.members[characterKey],
                      rotationTime
                    )}
                    unit={unit}
                  />
                  <ShareFigure share={share} rotationTime={rotationTime} />
                </Box>
                <ShareBar characterKey={characterKey} share={share} />
              </Box>
              {/* where its substat rolls went (fixed + distributed), at the tile's foot */}
              {build && (
                <Box sx={{ mt: 'auto', pt: { xs: 1.5, sm: 1.75 } }}>
                  <Box sx={{ pt: 1.25, borderTop: hairline }}>
                    <KqmRollLine build={build} />
                  </Box>
                </Box>
              )}
            </ButtonBase>
          )
        })}
      </Box>
      {compared && (
        <KqmCompare
          key={`${compared}-${seconds}-${picked}`}
          teamId={teamId}
          runSettings={runSettings}
          disabled={stale || running}
          result={result}
          characterKey={compared}
          rotationTime={rotationTime}
          base={fromRun ? undefined : comparing}
          onView={showView}
        />
      )}
      {/* (supplemental, below the inspector: the best teams that change one member, and how the
          shown team's damage splits; side by side where there is room, else one under the other) */}
      <Box
        sx={{
          ...subsectionSx,
          display: 'grid',
          columnGap: 3,
          rowGap: 4,
          alignItems: 'stretch',
          gridTemplateColumns:
            'repeat(auto-fit, minmax(min(100%, 440px), 1fr))',
        }}
      >
        <KqmTopTeams
          result={result}
          view={view}
          rotationTime={rotationTime}
          disabled={stale || running}
          onPick={pickTeam}
        />
        <DamageShare
          members={members.map((m) => m.characterKey)}
          evaluation={view.after}
          attacks={view.played?.attacks ?? runSettings.attacks}
          teamData={teamData}
          rotationTime={view.played?.rotationTime ?? rotationTime}
          conditionsKey={conditionsKey(teamId, 'kqm')}
        />
      </Box>
      {timeline}
      {/* the enemy's HP over the fight (a Stygian boss: its states too) */}
      {fightEnemy && <FightTimeline enemy={fightEnemy} team={fight} />}
    </Box>
  )
}
