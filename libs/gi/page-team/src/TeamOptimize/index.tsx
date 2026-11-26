import { InfoTooltipInline, useBottomBar } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOpt,
  TeamOptAttack,
  TeamRotation,
} from '@genshin-optimizer/gi/db'
import {
  applyTeamRotation,
  defaultTeamOptKqm,
  initTeamOpt,
} from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  BonusStats,
  KqmResult,
  RunAttackState,
  RunEnemy,
  SimGear,
  TeamData,
  TeamOptEvaluation,
  TeamOptGearComparison,
  TeamOptMember,
  TeamOptPicks,
  TeamOptPickView,
  TeamOptShortfall,
} from '@genshin-optimizer/gi/ui'
import {
  appliedStygianPreset,
  CharacterName,
  enemyFight,
  evaluateTeamRotation,
  fightBuffShare,
  kqmResultStandardChanged,
  kqmTeamOverrides,
  MOONGECKO_BOSS,
  sameRunEnemy,
  teamEnergyAuto,
  teamLinkOwnGear,
  teamLinkUseImported,
  teamLinkUseOwnGear,
  teamOptBonusStats,
  teamOptCurrentWeapons,
  teamOptMembers,
  teamOptPool,
  teamOptResultGear,
  teamStatFilters,
  withAttackStates,
  wolfsGravestoneStates,
  wolfsGravestoneUptime,
} from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import GroupsIcon from '@mui/icons-material/Groups'
import SyncAltRoundedIcon from '@mui/icons-material/SyncAltRounded'
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import {
  Alert,
  alpha,
  Box,
  Button,
  InputBase,
  LinearProgress,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { EnemySetup } from '../Enemy/EnemySetup'
import { kqmEnemyTeam } from '../Enemy/enemyScope'
import { kqmTheorycraftingEnabled } from '../featureFlags'
import {
  buffsForAttacker,
  useKqmSwitchBuffs,
  useKqmTeamBuffs,
  useTeamOptBuffs,
} from './buffs'
import { DamageShare } from './DamageShare'
import { ExtraBuffs } from './ExtraBuffs'
import { expandStore } from './expandStore'
import {
  fightTeamOf,
  useCocoonEvaluations,
  useRotationApplications,
} from './fightTeam'
import { defaultRotationTime, formatDamage, formatRateFull } from './format'
import { KqmProgress, KqmResults, KqmSettings } from './KqmMode'
import { KqmTimeline } from './KqmTimeline'
import { VersionNote, VersionsButton, VersionsDrawer } from './KqmVersionList'
import { kqmOwnSetUp } from './kqmOwn'
import { pushVersionSettings, syncVersion, versionRoot } from './kqmVersions'
import { MemberAvatar } from './MemberAvatar'
import { MemberRotation } from './MemberRotation'
import { RotationCompareButton } from './RotationCompare'
import { RotationInline, RotationsSetting } from './RotationInline'
import { type RotationSearchBase, RotationSearchButton } from './RotationSearch'
import { starterRotation } from './RotationTemplates'
import { RotationTransfer } from './RotationTransfer'
import {
  copyRotationFromKqm,
  copyRotationToKqm,
  RotationConfigureButton,
  rotationIdOf,
  type SearchButton,
  setRotationDraft,
  useAppliedRotation,
  useMemberNames,
  useRotationWriter,
  useSameRotations,
  useSimTeam,
} from './RotationWriter'
import { RunDialog } from './RunDialog'
import { sameBuildRoster, teamRoster } from './runScope'
import { TeamOptInspector } from './TeamOptInspector'
import { TeamOptimizeStart, useManualStart } from './TeamOptimizeStart'
import {
  RestoreTeamBuildsButton,
  Shortfalls,
  TeamEquipUndo,
  TeamOptResults,
} from './TeamOptResults'
import { GearRankingControls, TeamOptTopBuilds } from './TeamOptTopBuilds'
import { TeamSensitivity } from './TeamSensitivity'
import {
  Disclosure,
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  StepTitle,
  stepAccentSx,
  stepSurfaceSx,
  subsectionSx,
  tokens,
  type,
} from './ui'
import type { KqmRunState } from './useKqmRun'
import { useKqmRun } from './useKqmRun'
import {
  kqmRotationSetUp,
  kqmRotationUpdate,
  kqmRotationView,
  kqmRunKey,
  type TeamOptUpdate,
  teamOptRunKey,
  useTeamOpt,
} from './useTeamOpt'
import type { TeamOptRunState, TeamOptStatus } from './useTeamOptRun'
import { useTeamOptRun } from './useTeamOptRun'

/** A section of the page: its own panel on the page's ink, as the results are */
const sectionSx = {
  bgcolor: tokens.panel,
  border: hairline,
  borderRadius: tokens.radius.panel,
  p: tokens.pad,
  minWidth: 0,
} as const

/** A result this new (ms) was just found: it is revealed (see `TeamOptResults`) */
const FRESH_MS = 4000

/** A result appears once: a short fade and rise (none with reduced motion) */
const revealSx = {
  '@keyframes teamOptReveal': {
    from: { opacity: 0, transform: 'translateY(6px)' },
    to: { opacity: 1, transform: 'none' },
  },
  animation: 'teamOptReveal .22s cubic-bezier(.2,.7,.2,1)',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
} as const

/** One shared team rotation, with separate inventory and KQM build workflows. */
export default function TeamBuildWorkspace({
  teamId,
  teamData,
  mode,
}: {
  teamId: string
  teamData: TeamData | undefined
  mode: 'inventory' | 'kqm'
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const team = useTeam(teamId)
  // the enemy the tab is for: the team's, or the KQM tab's own
  const enemyTeam = useMemo(
    () => team && (mode === 'kqm' ? kqmEnemyTeam(team) : team),
    [team, mode]
  )
  // a result found for another enemy than the tab's now (one found before enemies were kept with
  // results: not known, not flagged)
  const enemyChanged = (enemy?: RunEnemy) =>
    !!enemy && !!enemyTeam && !sameRunEnemy(enemy, enemyTeam)
  const [storedTeamOpt, setStoredTeamOpt] = useTeamOpt(teamId)
  // A version (KQM): its shared settings are its original's when it is shown, and changed here
  // they are the original's too (so its whole family's)
  const { i18n: namesI18n } = useTranslation('charNames_gen')
  const { gender } = useDBMeta()
  const rootId = versionRoot(database, teamId)
  const versionOf = rootId !== teamId ? rootId : undefined
  useEffect(() => {
    if (mode !== 'kqm' || !versionOf) return
    const names = { i18n: namesI18n, gender }
    syncVersion(database, teamId, names)
    return database.teams.follow(teamId, () =>
      pushVersionSettings(database, teamId, names)
    )
  }, [database, mode, teamId, versionOf, namesI18n, gender])
  // Each tab has its own rotation: on the KQM tab the page reads and changes KQM's (its attacks
  // and rotation time), at its constellations; the rest of the settings are shared
  const teamOpt = useMemo(
    () => (mode === 'kqm' ? kqmRotationView(storedTeamOpt) : storedTeamOpt),
    [mode, storedTeamOpt]
  )
  const setTeamOpt = useCallback(
    (update: TeamOptUpdate) =>
      setStoredTeamOpt(mode === 'kqm' ? kqmRotationUpdate(update) : update),
    [mode, setStoredTeamOpt]
  )
  // `teamData` is recomputed whenever a member, a build or a conditional changes (never for Team
  // optimize's own settings, which are saved on the team too: the members stay the same object,
  // and what is worked out from them, the timeline's play, is not done again)
  const loadouts = JSON.stringify(team?.loadoutData)
  const members = useMemo(
    () => teamOptMembers(database, teamId),
    [database, teamId, loadouts, teamData]
  )
  // (the KQM tab's rotation, the first time: a copy of Team optimize's)
  const kqmSetUp = storedTeamOpt.kqm?.attacks !== undefined
  const ownConstellations = useSimTeam(members).constellations
  useEffect(() => {
    if (mode !== 'kqm' || kqmSetUp) return
    copyRotationToKqm(database, teamId, ownConstellations)
    database.teams.initializeSettings(teamId, (team) => {
      team.teamOpt ??= initTeamOpt()
      kqmRotationSetUp(team.teamOpt)
    })
  }, [database, mode, kqmSetUp, teamId, ownConstellations])
  // (its own switches and enemy too, once: a copy of the team's)
  const kqmOwnReady =
    storedTeamOpt.kqm?.teamConditional !== undefined &&
    storedTeamOpt.kqm?.enemy !== undefined
  useEffect(() => {
    if (mode !== 'kqm' || !kqmSetUp || kqmOwnReady) return
    kqmOwnSetUp(database, teamId)
  }, [mode, kqmSetUp, kqmOwnReady, database, teamId])
  // (Team optimize's: its switches, and the buffs its rotation times)
  const buffs = useTeamOptBuffs(teamId, teamData, storedTeamOpt.attacks)
  const kqmSwitchBuffs = useKqmSwitchBuffs(
    teamId,
    teamData,
    mode === 'kqm' ? storedTeamOpt.kqm : undefined
  )
  // the rotation with the builds equipped now: Team optimize's only (KQM theorycrafting never
  // counts or shows the members' own builds)
  // (Wolf's Gravestone's uptime against the enemy, as a run counts it: from the fight below)
  const [wolfStates, setWolfStates] = useState<RunAttackState[]>()
  const [evaluation, evaluationSettings] = useCurrentEvaluation(
    teamId,
    teamOpt,
    mode === 'inventory' ? teamData : undefined,
    wolfStates
  )
  const {
    state,
    status,
    run,
    cancel,
    clear,
    requirementsKey,
    sessionOf,
    rankEquipment,
  } = useTeamOptRun(teamId)
  const kqm = useKqmRun(teamId)
  const kqmRunning = kqm.state.type === 'running'
  // either run in progress: the settings stay as they are
  const running = state.type === 'running' || kqmRunning
  const rotationTitleId = useId()
  const rotationBodyId = useId()
  // (as set for this team, else the default: damage is also shown per second)
  const rotationTime = teamOpt.rotationTime ?? defaultRotationTime
  // who is on the field by default: as chosen, else the team's first member (as in the app)
  const onField =
    teamOpt.onField && members.some((m) => m.characterKey === teamOpt.onField)
      ? teamOpt.onField
      : members[0]?.characterKey

  const attackCount = members.reduce(
    (n, m) => n + (teamOpt.attacks[m.characterKey]?.length ?? 0),
    0
  )
  // the first visit (no attacks, no written rotation, no choice made yet): the start screen
  const writtenRotation = useAppliedRotation(
    rotationIdOf(teamId, mode === 'kqm')
  )
  const { manual, chooseManual } = useManualStart(teamId, mode === 'kqm')
  // (each tab: its own rotation)
  const showStart = !attackCount && !writtenRotation && !manual
  const importAttacks = (rotation: TeamRotation) => {
    if (running) return
    database.teams.set(teamId, (team) => {
      const draft = structuredClone(team.teamOpt ?? initTeamOpt())
      const update: TeamOptUpdate = (view) => {
        applyTeamRotation(
          view,
          rotation,
          members.map((member) => member.characterKey)
        )
      }
      const updateTab = mode === 'kqm' ? kqmRotationUpdate(update) : update
      team.teamOpt = updateTab(draft) ?? draft
      const document = ((team.rotationDocuments ??= {})[mode] ??= {})
      if (document.Text) document.UseAttacks = '1'
    })
  }
  // (each tab can take the other's rotation, when the other has one and it is not the same)
  const sameRotations = useSameRotations(teamId)
  const hasAttacks = (attacks: TeamOpt['attacks'] | undefined) =>
    members.some(({ characterKey }) => !!attacks?.[characterKey]?.length)
  const canCopyInventoryRotation =
    mode === 'kqm' && !sameRotations && hasAttacks(storedTeamOpt.attacks)
  const canCopyKqmRotation =
    mode !== 'kqm' && !sameRotations && hasAttacks(storedTeamOpt.kqm?.attacks)
  const copyKqmRotation = () => {
    if (
      (attackCount || writtenRotation) &&
      !window.confirm(
        t(
          'teamOpt.replaceWithKqmRotation',
          'Replace the Team optimize rotation with the KQM Theorycrafting rotation?'
        )
      )
    )
      return
    copyRotationFromKqm(database, teamId)
    setStoredTeamOpt((draft) => {
      const kqm = draft.kqm
      if (!kqm?.attacks) return
      draft.attacks = structuredClone(kqm.attacks)
      if (kqm.rotationTime === undefined) delete draft.rotationTime
      else draft.rotationTime = kqm.rotationTime
      if (kqm.onField === undefined) delete draft.onField
      else draft.onField = kqm.onField
    })
  }
  const copyInventoryRotation = () => {
    if (
      (attackCount || writtenRotation || team?.rotationDocuments?.kqm?.Draft) &&
      !window.confirm(
        t(
          'teamOpt.kqm.replaceRotation',
          'Replace the KQM rotation with the current Team optimize rotation?'
        )
      )
    )
      return
    copyRotationToKqm(database, teamId, ownConstellations, true)
    setStoredTeamOpt((draft) => {
      draft.kqm = {
        ...defaultTeamOptKqm,
        ...draft.kqm,
        attacks: structuredClone(draft.attacks),
        rotationTime: draft.rotationTime,
        onField: draft.onField,
      }
    })
  }

  const optimizable = members.filter(
    (m) => !m.isTc && !teamOpt.keep.includes(m.characterKey)
  )
  // an imported team's members on its builds: those the player has run on their own gear
  const ownGear = team?.importedFrom
    ? teamLinkOwnGear(database, teamId)
    : undefined
  const poolSize = usePoolSize(members, teamOpt)
  const [runDialog, setRunDialog] = useState(false)
  const startedHere = useRef<{ previous?: number; scroll: number }>()
  useEffect(() => setRunDialog(false), [mode])
  // (the members' attacks shown: a flag of its own, so flipping it doesn't re-render the page)
  const [rotationOpen] = useState(() => expandStore(!attackCount))
  // a written rotation just applied to an empty team: its members' long attack lists fold away
  // (the written rotation says it all; a click opens them)
  const hadAttacks = useRef(attackCount > 0)
  useEffect(() => {
    if (!hadAttacks.current && attackCount > 0 && writtenRotation)
      rotationOpen.set(false)
    hadAttacks.current = attackCount > 0
  }, [attackCount, writtenRotation, rotationOpen])
  // Extra buffs: their count, and the section open when there are some
  const extraCount = Object.values(teamOpt.bonusStats ?? {}).reduce(
    (n, stats) => n + Object.values(stats ?? {}).filter((v) => !!v).length,
    0
  )
  const [extraOpen, setExtraOpen] = useState(() => extraCount > 0)
  // (while it runs: its builds so far once it has some, else the last result)
  const roster = teamRoster(database, teamId)
  const memberKeys = members.map((m) => m.characterKey)
  // (a run's builds: its members not on a theorycraft build, which it keeps as they are)
  const inventoryKeys = members
    .filter((m) => !m.isTc)
    .map((m) => m.characterKey)
  const kqmEarly = kqm.state.type === 'running' ? kqm.state.early : undefined
  const kqmDone =
    kqm.state.type === 'done'
      ? kqm.state
      : kqmRunning
        ? (kqmEarly ?? kqm.lastResult)
        : undefined
  const kqmResult =
    kqmDone &&
    sameBuildRoster(kqmDone.result.builds, memberKeys) &&
    (kqmDone.roster === undefined || kqmDone.roster === roster)
      ? kqmDone
      : undefined
  // the results shown when they come (a run's early builds, else its result), once a run
  const revealedRun = useRef<number | undefined>(undefined)
  useEffect(() => {
    const shown = kqm.state.type === 'done' ? kqm.state : kqmEarly
    if (!shown) return
    if (shown.startTime !== undefined) {
      if (revealedRun.current === shown.startTime) return
      revealedRun.current = shown.startTime
    }
    rotationOpen.set(false)
    if (mode === 'kqm')
      requestAnimationFrame(() =>
        document
          .getElementById(`kqm-results-${teamId}`)
          ?.scrollIntoView({ block: 'start' })
      )
  }, [kqm.state, kqmEarly, mode, teamId, rotationOpen])
  // KQM theorycrafting's own rotation, while its result is for the rotation as it is: the attacks
  // it played for its builds (at its constellations, with their gear), with their damage
  const kqmRotation =
    mode === 'kqm' &&
    kqmResult &&
    kqmRunKey(kqmResult.teamOpt) === kqmRunKey(teamOpt) &&
    !kqmResultStandardChanged(kqmResult.result, teamOpt.kqm) &&
    (kqmResult.rotation === 'played') === !!writtenRotation.trim() &&
    !enemyChanged(kqmResult.enemy)
      ? kqmResult
      : undefined
  // the builds shown in the KQM results (the run's, or other equipment picked there): the rotation
  // they played, its damage, and each attack's buffs, read with those builds
  const [kqmView, setKqmView] = useState<KqmResult>()
  useEffect(() => setKqmView(undefined), [kqmResult?.result])
  const kqmShown = kqmRotation ? (kqmView ?? kqmRotation.result) : undefined
  const kqmPlayed = kqmRotation?.rotation === 'played'
  const kqmAttacks =
    kqmRotation &&
    (kqmPlayed && kqmShown?.played
      ? kqmShown.played.attacks
      : kqmRotation.runTeamOpt.attacks)
  const kqmRotationTime = kqmRotation
    ? ((kqmPlayed ? kqmShown?.played?.rotationTime : undefined) ??
      kqmRotation.runTeamOpt.rotationTime)
    : undefined
  // (its attacks, played or entered, are read with the KQM builds shown)
  const kqmOverrides = useMemo(
    () =>
      kqmRotation && kqmShown
        ? kqmTeamOverrides(database, teamId, kqmRotation.runTeamOpt, kqmShown)
        : undefined,
    [kqmRotation, kqmShown, database, teamId]
  )
  const kqmBuffs = useKqmTeamBuffs(teamId, teamData, kqmOverrides, kqmShown)
  // (the weapon and sets each KQM build holds: the played attacks' other gear names no part)
  const kqmGear = useMemo(
    () =>
      kqmPlayed && kqmShown
        ? Object.fromEntries(
            Object.entries(kqmShown.builds).map(([ck, build]) => [
              ck,
              { weapon: build!.weapon.key, sets: build!.sets },
            ])
          )
        : undefined,
    [kqmPlayed, kqmShown]
  )
  // a result for another line-up is of no use
  const result =
    state.type === 'done' &&
    sameBuildRoster(state.result.builds, inventoryKeys) &&
    (state.roster === undefined || state.roster === roster)
      ? state
      : undefined
  const picked = result?.result
  // equipment picked by hand in a member's inspector (the best team build's), and the team with it
  const [picks, setPicks] = useState<TeamOptPicks>({})
  const [pickView, setPickView] = useState<TeamOptPickView>()
  const [gearComparison, setGearComparison] = useState<TeamOptGearComparison>()
  const [inspected, setInspected] = useState<CharacterKey>()
  const sessionOfResult = useCallback(
    () => (result ? sessionOf(result) : Promise.resolve(undefined)),
    [result, sessionOf]
  )
  const firstOptimized = result?.result.optimized[0]
  // biome-ignore lint/correctness/useExhaustiveDependencies: another result shown
  useEffect(() => {
    setPicks({})
    setPickView(undefined)
    setGearComparison(undefined)
    // (the biggest damage dealer's, as the KQM tab opens on its first member)
    setInspected(firstOptimized)
  }, [result?.savedAt])
  // the result's settings with the attacks its run played (`TeamOptResult.attacks`); no result: the
  // tab's
  const resultAttacks =
    gearComparison?.attacks ?? pickView?.attacks ?? result?.result.attacks
  const savedSettings = result?.teamOpt
  const resultSettings = savedSettings ?? teamOpt
  const baseResultTime =
    picked?.rotationTime ?? resultSettings.rotationTime ?? rotationTime
  const shownResultTime =
    gearComparison?.rotationTime ?? pickView?.rotationTime ?? baseResultTime
  const resultSettingsChanged = useMemo(
    () =>
      !!savedSettings &&
      teamOptRunKey(savedSettings) !== teamOptRunKey(teamOpt),
    [savedSettings, teamOpt]
  )
  const shownTeamOpt = useMemo(
    () => ({
      ...resultSettings,
      ...(resultAttacks && { attacks: resultAttacks }),
      rotationTime: shownResultTime,
    }),
    [resultAttacks, shownResultTime, resultSettings]
  )
  const hasPicks = !!gearComparison || Object.keys(picks).length > 0
  const shown =
    picked && gearComparison
      ? { ...picked, ...gearComparison }
      : pickView && picked && Object.keys(picks).length
        ? { ...picked, ...pickView }
        : picked
  // (each tab's rotation search, on the rotation's line and in its writer: with the builds shown;
  // a rotation it finds opens in the writer, to be played there and used)
  const kqmRunTeamOpt = kqmRotation?.runTeamOpt
  const memberNames = useMemberNames(members)
  /** The states a run gives every attack now (`lowHp`, set once it is worked out below) */
  const attackStatesNow = useRef<readonly RunAttackState[]>()
  /** The bonus stats a run ranks builds with now (`fightBuffs`, set once worked out below) */
  const fightBuffsNow = useRef<Partial<Record<CharacterKey, BonusStats>>>()
  const kqmSearchBase = useMemo<RotationSearchBase | undefined>(
    () =>
      kqmShown && kqmRunTeamOpt
        ? {
            tab: 'kqm',
            result: kqmShown,
            teamOpt: kqmRunTeamOpt,
            rotationKey: kqmResult?.rotationKey,
          }
        : undefined,
    [kqmShown, kqmRunTeamOpt, kqmResult?.rotationKey]
  )
  const teamSearchBase = useMemo<RotationSearchBase | undefined>(
    () =>
      result && shown
        ? {
            tab: 'team',
            result: shown,
            teamOpt: shownTeamOpt,
            rotationKey: result.rotationKey,
            rankingBonusStats: fightBuffsNow,
          }
        : undefined,
    [result, shown, shownTeamOpt]
  )
  const kqmBaseStale =
    !!kqmResult &&
    (kqmRunKey(kqmResult.teamOpt) !== kqmRunKey(teamOpt) ||
      kqmResultStandardChanged(kqmResult.result, teamOpt.kqm) ||
      (kqmResult.rotation === 'played') !== !!writtenRotation.trim() ||
      enemyChanged(kqmResult.enemy))
  const teamBaseStale =
    !!result &&
    (result.requirementsKey !== requirementsKey ||
      resultSettingsChanged ||
      enemyChanged(result.enemy))
  // The Team optimize result for the current rotation & settings (absent when none or stale)
  const teamShown =
    mode === 'inventory' && result && shown && !teamBaseStale
      ? shown
      : undefined
  const teamShownTime = teamShown ? shownResultTime : rotationTime
  const searchBase = mode === 'kqm' ? kqmSearchBase : teamSearchBase
  const searchBaseStale = mode === 'kqm' ? kqmBaseStale : teamBaseStale
  const searchButton = useCallback<SearchButton>(
    ({ text, names, setText, saved, close }) => (
      <>
        <RotationCompareButton
          tab={mode === 'kqm' ? 'kqm' : 'team'}
          teamId={teamId}
          text={text}
          names={names}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          base={searchBase}
          baseStale={searchBaseStale}
          attackStates={attackStatesNow}
          rankingBonusStats={fightBuffsNow}
          savedOverride={saved}
          onApplied={setText}
        />
        <RotationSearchButton
          tab={mode === 'kqm' ? 'kqm' : 'team'}
          teamId={teamId}
          text={text}
          names={names}
          base={searchBase}
          teamOpt={teamOpt}
          attackStates={attackStatesNow}
          savedOverride={saved}
          onUse={setText}
          onSetup={
            mode === 'inventory' && attackCount
              ? () => {
                  close()
                  setRunDialog(true)
                }
              : undefined
          }
        />
      </>
    ),
    [
      teamId,
      teamOpt,
      setTeamOpt,
      searchBase,
      searchBaseStale,
      mode,
      attackCount,
    ]
  )
  // the rotation written as text (inline), and its writer dialog with Undo
  const writer = useRotationWriter({
    teamId,
    members,
    setTeamOpt,
    teamData,
    kqm: mode === 'kqm' ? (teamOpt.kqm ?? defaultTeamOptKqm) : undefined,
    kqmBuilds: mode === 'kqm' ? kqmShown?.builds : undefined,
    kqmBuffs: mode === 'kqm' && kqmRotation ? kqmBuffs : undefined,
    kqmOverrides: mode === 'kqm' ? kqmOverrides : undefined,
    searchButton,
  })
  // (the rotation's time: at the end of the written rotation's line; without one, attacks entered by
  // hand, in the row below)
  // attacks entered by hand: who is on the field for them, by default
  const handOnField =
    !!onField &&
    members.length > 1 &&
    members.some((m) =>
      teamOpt.attacks[m.characterKey]?.some((a) => !a.onField)
    )
  const rotationTimeInput = (compact: boolean) => (
    <RotationTimeInput
      compact={compact}
      // (KQM's: the time of the rotation it played, which it counts)
      value={
        kqmRotation?.rotation === 'played'
          ? (kqmRotationTime ?? rotationTime)
          : rotationTime
      }
      disabled={running}
      played={kqmRotation?.rotation === 'played'}
      onChange={(seconds) =>
        setTeamOpt((o) => {
          if (seconds && seconds !== defaultRotationTime)
            o.rotationTime = seconds
          else delete o.rotationTime
        })
      }
    />
  )
  // how long the team takes to defeat the enemy: a Stygian Onslaught boss, its fight's mechanics
  // counted where they are known (with the written rotation's element applications); an enemy set
  // by hand, its HP ÷ the team's DPS
  // (one object while the enemy stays: the fight's evaluations are kept for the settings they ran with)
  const stygian = useMemo(
    () => enemyTeam && appliedStygianPreset(enemyTeam),
    [enemyTeam]
  )
  const applications = useRotationApplications(
    teamId,
    members,
    !!stygian || !!enemyTeam?.enemyHp,
    mode === 'kqm' ? (teamOpt.kqm ?? defaultTeamOptKqm) : undefined,
    mode === 'kqm' ? kqmShown?.builds : undefined
  )
  // the Moongecko's Radiant Cocoon and Disentangled: the damage shown evaluated in them too (the
  // equipped builds', or the KQM builds' played)
  const cocoonSettings = useMemo(
    () =>
      !stygian
        ? undefined
        : mode === 'kqm'
          ? kqmOverrides && kqmAttacks
            ? {
                ...kqmOverrides,
                arts: kqmOverrides.arts ?? {},
                attacks: kqmAttacks,
              }
            : undefined
          : evaluationSettings,
    [stygian, mode, kqmOverrides, kqmAttacks, evaluationSettings]
  )
  const cocoonNow = useCocoonEvaluations(teamId, cocoonSettings, {
    cocoon: stygian?.boss.id === MOONGECKO_BOSS,
    opening: applications?.opening?.attacks,
  })
  const fightNow = useMemo(
    () =>
      team &&
      enemyTeam &&
      (stygian || enemyTeam.enemyHp) &&
      // (the Moongecko's fight needs its cocoon evaluations: no estimate without them)
      (stygian?.boss.id !== MOONGECKO_BOSS || cocoonNow)
        ? fightTeamOf({
            members: members.map((m) => m.characterKey),
            // (the damage shown: the equipped builds', or the KQM builds' played)
            evaluation: mode === 'kqm' ? kqmShown?.after : evaluation,
            attacks: (mode === 'kqm' ? kqmAttacks : teamOpt.attacks) ?? {},
            teamData,
            rotationTime:
              mode === 'kqm' ? (kqmRotationTime ?? rotationTime) : rotationTime,
            enemyOverride: enemyTeam.enemyOverride,
            dataEnemy: team.enemyOverride,
            applications,
            cocoon: cocoonNow,
          })
        : undefined,
    [
      team,
      enemyTeam,
      stygian,
      members,
      mode,
      kqmShown,
      evaluation,
      kqmAttacks,
      teamOpt.attacks,
      teamData,
      kqmRotationTime,
      rotationTime,
      applications,
      cocoonNow,
    ]
  )
  // Wolf's Gravestone's passive (enemies under 30% HP) for the share of the fight it is on against
  // the team's enemy, from the fight shown (the equipped builds', or the KQM result's): every
  // attack of a run gets it. Without HP its member's own switch stays (KQM: off).
  const lowHp = useMemo(() => {
    const wolf = wolfsGravestoneUptime(
      enemyTeam && fightNow ? enemyFight(enemyTeam, fightNow) : undefined
    )
    return wolf
      ? {
          wolf,
          states: wolfsGravestoneStates(
            members.map((m) => m.characterKey),
            wolf.state
          ),
        }
      : undefined
  }, [enemyTeam, fightNow, members])
  attackStatesNow.current = lowHp?.states
  // the equipped builds' figures with that uptime too, as a run's: the fight they make sets it, so
  // it settles in a step or two (two states taking turns: the first kept)
  const wolfHistory = useRef<string[]>([])
  useEffect(() => {
    const next = lowHp?.states
    const key = JSON.stringify(next ?? null)
    const history = wolfHistory.current
    if (key === history[history.length - 1]) return
    if (key === history[history.length - 2]) return
    history.push(key)
    if (history.length > 4) history.shift()
    setWolfStates(next)
  }, [lowHp])
  // the Moongecko's Disentangled (+15% CRIT Rate, +50% DMG Bonus) averaged over the fight's damage
  // time, added while a run ranks builds: a build then leaves room for its CRIT Rate
  const fightBuffs = useMemo(() => {
    const share = fightBuffShare(
      enemyTeam && fightNow ? enemyFight(enemyTeam, fightNow) : undefined
    )
    return share
      ? Object.fromEntries(
          members.map((m) => [m.characterKey, { ...share.bonus }])
        )
      : undefined
  }, [enemyTeam, fightNow, members])
  fightBuffsNow.current = fightBuffs
  // The buffs an attack lists: the KQM builds' when a KQM result is shown; on the KQM tab
  // without one, the team's own without the passives of gear (KQM never shows the members' own
  // builds)
  const rotationBuffs = useMemo(
    () => (mode === 'kqm' ? (kqmRotation ? kqmBuffs : kqmSwitchBuffs) : buffs),
    [mode, kqmRotation, kqmBuffs, kqmSwitchBuffs, buffs]
  )
  const setAttacks = useCallback(
    (characterKey: CharacterKey) =>
      (update: (attacks: TeamOptAttack[]) => TeamOptAttack[]) => {
        if (running) return
        const shownList = teamShown
          ? shownTeamOpt.attacks[characterKey]
          : undefined
        setTeamOpt((o) => {
          o.attacks[characterKey] = update(
            shownList ?? o.attacks[characterKey] ?? []
          )
        })
      },
    [setTeamOpt, running, teamShown, shownTeamOpt.attacks]
  )
  // the shown builds' rotation timeline: the written rotation played with their weapons and sets,
  // an attack's figures read with their builds (as the run counted them)
  const shownBuilds = shown?.builds
  const shownWeapons = shown?.weapons
  const shownGear = useMemo(
    () =>
      shownBuilds && shownWeapons
        ? teamOptResultGear(database, teamId, {
            builds: shownBuilds,
            weapons: shownWeapons,
          })
        : undefined,
    [database, teamId, shownBuilds, shownWeapons]
  )
  const shownSimGear = useMemo(() => {
    if (!shownGear) return undefined
    const gear: Partial<Record<CharacterKey, SimGear>> = {}
    for (const [ck, arts] of Object.entries(shownGear.arts)) {
      const sets: Record<string, number> = {}
      for (const art of arts ?? [])
        sets[art.setKey] = (sets[art.setKey] ?? 0) + 1
      const weapon = shownGear.weapons[ck as CharacterKey]
      gear[ck as CharacterKey] = {
        sets,
        weapon: weapon?.key,
        refinement: weapon?.refinement,
      }
    }
    return gear
  }, [shownGear])
  const shownOverrides = useMemo(
    () =>
      shownGear && {
        ...shownGear,
        mainStatAssumptionLevel: shownTeamOpt.assumeMaxMain ? 20 : 0,
        bonusStats: teamOptBonusStats(
          shownTeamOpt,
          members.map((m) => m.characterKey)
        ),
      },
    [shownGear, shownTeamOpt, members]
  )
  // the shown builds in the Moongecko's Radiant Cocoon and Disentangled, when the run's enemy is it
  const resultCocoonSettings = useMemo(
    () =>
      shownOverrides && result?.enemy && appliedStygianPreset(result.enemy)
        ? { ...shownOverrides, attacks: shownTeamOpt.attacks }
        : undefined,
    [shownOverrides, result?.enemy, shownTeamOpt.attacks]
  )
  const resultCocoon = useCocoonEvaluations(teamId, resultCocoonSettings, {
    cocoon:
      !!result?.enemy &&
      appliedStygianPreset(result.enemy)?.boss.id === MOONGECKO_BOSS,
    opening: applications?.opening?.attacks,
  })
  // Reveal only a result that this visit started. Rankings and restored results stay in place.
  const resultTime = result?.savedAt
  useEffect(() => {
    if (mode !== 'inventory') startedHere.current = undefined
    if (
      !startedHere.current ||
      resultTime === undefined ||
      resultTime === startedHere.current.previous
    )
      return
    const { scroll } = startedHere.current
    startedHere.current = undefined
    const frame = requestAnimationFrame(() => {
      if (
        document.hidden ||
        document.activeElement?.matches(':focus-visible') ||
        Math.abs(window.scrollY - scroll) > 80
      )
        return
      rotationOpen.set(false)
      document.getElementById(`teamopt-results-${teamId}`)?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [mode, resultTime, teamId, rotationOpen])

  if (!members.length) return <EmptyTeam teamId={teamId} />

  return (
    // each section is its own panel on the page; KQM's are steps (rotation, setup, builds), further apart
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: mode === 'kqm' ? { xs: 2.5, sm: 3.5 } : 2,
      }}
    >
      {/* the rotation: what it is with its actions and figures, then its settings, then the team */}
      <Box
        component="section"
        aria-labelledby={rotationTitleId}
        sx={{
          ...sectionSx,
          ...stepAccentSx('rotation'),
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1.25,
            rowGap: 1.25,
            minHeight: 36,
            ...(!showStart && { pb: 1.5, borderBottom: hairline }),
          }}
        >
          {mode === 'kqm' ? (
            <Box sx={{ mr: 0.25 }}>
              <StepTitle
                step={1}
                accent="rotation"
                id={rotationTitleId}
                info={t(
                  'teamOpt.rotation.info',
                  'Add each member’s attacks and how often they hit in one rotation. The buffs are the ones that are on in Team settings and on the characters’ tabs: open an attack to turn off one that is not up during it, to put it in another state, or to limit one to its first hits (Shenhe’s quills, a buff that runs out).'
                )}
              >
                {t('teamOpt.rotation.title', 'Rotation')}
              </StepTitle>
            </Box>
          ) : (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                mr: 0.25,
              }}
            >
              <Typography
                id={rotationTitleId}
                component="h2"
                sx={{ ...type.section, whiteSpace: 'nowrap' }}
              >
                {t('teamOpt.rotation.title', 'Rotation')}
              </Typography>
              <InfoTooltipInline
                title={t(
                  'teamOpt.rotation.info',
                  'Add each member’s attacks and how often they hit in one rotation. The buffs are the ones that are on in Team settings and on the characters’ tabs: open an attack to turn off one that is not up during it, to put it in another state, or to limit one to its first hits (Shenhe’s quills, a buff that runs out).'
                )}
              />
            </Box>
          )}
          {/* (the start screen has its own ways in: write, add attacks, import) */}
          {!showStart && (
            <RotationConfigureButton writer={writer} disabled={running} />
          )}
          {!showStart && canCopyInventoryRotation && (
            <Tooltip
              arrow
              title={t(
                'teamOpt.kqm.copyRotationTip',
                'Replace the KQM rotation with the Team optimize rotation'
              )}
            >
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  startIcon={<SyncAltRoundedIcon />}
                  onClick={copyInventoryRotation}
                  disabled={running}
                  sx={copyRotationSx}
                >
                  {t('teamOpt.kqm.copyRotation', 'Copy from Team optimize')}
                </Button>
              </span>
            </Tooltip>
          )}
          {!showStart && canCopyKqmRotation && (
            <Tooltip
              arrow
              title={t(
                'teamOpt.copyKqmRotationTip',
                'Replace the Team optimize rotation with the KQM Theorycrafting rotation'
              )}
            >
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  color="inherit"
                  startIcon={<SyncAltRoundedIcon />}
                  onClick={copyKqmRotation}
                  disabled={running}
                  sx={copyRotationSx}
                >
                  {t('teamOpt.copyKqmRotation', 'Copy from KQM Theorycrafting')}
                </Button>
              </span>
            </Tooltip>
          )}
          <Box sx={{ flexGrow: 1 }} />
          {!!attackCount &&
            (mode === 'inventory' ? (
              <HeaderStats
                total={teamShown ? teamShown.after.total : evaluation?.total}
                rotationTime={teamShownTime}
                source={
                  teamShown
                    ? hasPicks
                      ? 'picked'
                      : 'optimized'
                    : result && teamBaseStale
                      ? 'currentStale'
                      : 'current'
                }
              />
            ) : (
              kqmShown && (
                <HeaderStats
                  total={kqmShown.after.total}
                  rotationTime={kqmRotationTime ?? rotationTime}
                  source={kqmView ? 'picked' : 'optimized'}
                />
              )
            ))}
          {/* (moving the rotation in and out: at the right end, apart from writing it) */}
          {!showStart && (
            <RotationTransfer
              members={members}
              teamOpt={teamOpt}
              onImport={importAttacks}
              hasWrittenRotation={!!writtenRotation}
              disabled={running}
            />
          )}
        </Box>
        {writer.element}
        {mode === 'kqm' && showStart && (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {t(
                'teamOpt.kqm.separateRotation',
                'KQM uses its own rotation. You can copy the current Team optimize rotation here.'
              )}
            </Typography>
            {canCopyInventoryRotation && (
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                startIcon={<SyncAltRoundedIcon />}
                onClick={copyInventoryRotation}
                disabled={running}
                sx={copyRotationSx}
              >
                {t('teamOpt.kqm.copyRotation', 'Copy from Team optimize')}
              </Button>
            )}
          </Box>
        )}
        {showStart ? (
          // the first visit: how to start (write the rotation, or enter attacks by hand)
          <TeamOptimizeStart
            members={members.map((m) => m.characterKey)}
            onWrite={writer.openWriter}
            onTemplate={writer.openTemplate}
            onStarter={() => {
              setRotationDraft(
                database,
                rotationIdOf(teamId, mode === 'kqm'),
                starterRotation(memberNames)
              )
              writer.openWriter()
            }}
            onManual={chooseManual}
            disabled={running}
            footer={
              <RotationTransfer
                importOnly
                members={members}
                teamOpt={teamOpt}
                onImport={importAttacks}
                hasWrittenRotation={false}
                disabled={running}
              />
            }
          />
        ) : (
          <>
            {/* the rotation as text: read as its steps (a click opens the writer), its time at
                the end */}
            <RotationInline
              trailing={
                <>
                  <RotationCompareButton
                    compact
                    tab={mode === 'kqm' ? 'kqm' : 'team'}
                    teamId={teamId}
                    text={writtenRotation}
                    names={memberNames}
                    teamOpt={teamOpt}
                    setTeamOpt={setTeamOpt}
                    base={searchBase}
                    baseStale={searchBaseStale}
                    attackStates={attackStatesNow}
                    rankingBonusStats={fightBuffsNow}
                    disabled={running}
                  />
                  <RotationSearchButton
                    compact
                    tab={mode === 'kqm' ? 'kqm' : 'team'}
                    teamId={teamId}
                    text={writtenRotation}
                    names={memberNames}
                    base={searchBase}
                    teamOpt={teamOpt}
                    attackStates={attackStatesNow}
                    disabled={running}
                    onSetup={
                      mode === 'inventory' && attackCount
                        ? () => setRunDialog(true)
                        : undefined
                    }
                    onUse={(chosen) => {
                      setRotationDraft(
                        database,
                        rotationIdOf(teamId, mode === 'kqm'),
                        chosen
                      )
                      writer.openWriter()
                    }}
                  />
                  <Box
                    aria-hidden
                    sx={{
                      width: '1px',
                      height: 16,
                      mx: 0.375,
                      bgcolor: tokens.hairlineStrong,
                      flexShrink: 0,
                    }}
                  />
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      maxWidth: '100%',
                      minWidth: 0,
                    }}
                  >
                    <RotationsSetting
                      compact
                      teamId={teamId}
                      members={members}
                      setTeamOpt={setTeamOpt}
                      writer={writer}
                      disabled={running}
                      kqm={
                        mode === 'kqm'
                          ? (teamOpt.kqm ?? defaultTeamOptKqm)
                          : undefined
                      }
                    />
                    {rotationTimeInput(true)}
                  </Box>
                </>
              }
              teamId={teamId}
              members={members}
              setTeamOpt={setTeamOpt}
              writer={writer}
              replaces={!!attackCount}
              disabled={running}
              kqm={
                mode === 'kqm' ? (teamOpt.kqm ?? defaultTeamOptKqm) : undefined
              }
              kqmBuilds={mode === 'kqm' ? kqmShown?.builds : undefined}
            />
            {/* the rotation's settings, in one row of labelled controls (with a written rotation its
                time and count are on its line: only what is left, if anything) */}
            {(!writtenRotation.trim() || handOnField) && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  columnGap: 2,
                  rowGap: 1,
                  minHeight: 34,
                }}
              >
                {!writtenRotation.trim() && rotationTimeInput(false)}
                {/* (a written rotation says who is on the field for each of its attacks: only
                    attacks entered by hand use this) */}
                {handOnField && onField && (
                  <OnFieldPicker
                    members={members}
                    value={onField}
                    disabled={running}
                    onChange={(characterKey) =>
                      setTeamOpt((o) => {
                        if (characterKey === members[0]?.characterKey)
                          delete o.onField
                        else o.onField = characterKey
                      })
                    }
                  />
                )}
              </Box>
            )}
            {/* one panel for the team: folded, a line per member; open, a column per member with
              hairlines between them */}
            <Box
              sx={{
                ...insetSx,
                overflow: 'hidden',
                containerType: 'inline-size',
              }}
            >
              <Box
                id={rotationBodyId}
                sx={{
                  minWidth: 0,
                  display: 'grid',
                  gap: '1px',
                  // (the hairlines between the members: the grid's gaps over this colour)
                  bgcolor: tokens.hairline,
                  gridTemplateColumns: 'minmax(0, 1fr)',
                  '@container (min-width: 520px)': {
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  },
                  '@container (min-width: 1040px)': {
                    gridTemplateColumns: `repeat(${Math.min(4, members.length)}, minmax(0, 1fr))`,
                  },
                }}
              >
                {members.map((member) => (
                  <MemberRotation
                    key={member.characterKey}
                    teamId={teamId}
                    member={member}
                    teamData={teamData}
                    attacks={
                      (mode === 'kqm'
                        ? (kqmAttacks ?? teamOpt.attacks)
                        : teamShown
                          ? shownTeamOpt.attacks
                          : teamOpt.attacks)[member.characterKey] ?? []
                    }
                    setAttacks={setAttacks(member.characterKey)}
                    evaluation={
                      mode === 'inventory'
                        ? (teamShown?.after ?? evaluation)
                        : kqmShown?.after
                    }
                    figures={mode === 'inventory'}
                    played={kqmPlayed}
                    overrides={
                      mode === 'kqm'
                        ? kqmOverrides
                        : teamShown
                          ? shownOverrides
                          : undefined
                    }
                    gear={
                      mode === 'kqm'
                        ? kqmGear
                        : teamShown
                          ? shownSimGear
                          : undefined
                    }
                    buffs={buffsForAttacker(rotationBuffs, member.characterKey)}
                    mainStatAssumptionLevel={teamOpt.assumeMaxMain ? 20 : 0}
                    members={members}
                    onField={onField ?? member.characterKey}
                    rotationTime={
                      mode === 'kqm'
                        ? (kqmRotationTime ?? rotationTime)
                        : teamShownTime
                    }
                    expandStore={rotationOpen}
                    onToggle={attackCount ? rotationOpen.toggle : undefined}
                    disabled={running}
                  />
                ))}
              </Box>
            </Box>
            {/* the enemy the damage is for (the team's), as KQM's setup shows it: above the extra
                buffs, in the footer (KQM: in its setup, beside the members) */}
            {mode !== 'kqm' && (
              <Box sx={{ pt: 1.25, mt: 0.25, borderTop: hairline }}>
                <EnemySetup
                  teamId={teamId}
                  fight={fightNow}
                  disabled={running}
                />
              </Box>
            )}
            {/* buffs the game data does not have (food, an Abyss blessing…): the panel's footer */}
            <Disclosure
              label={t(
                'teamOpt.bonus.advanced',
                'Extra buffs (food, blessings…)'
              )}
              count={
                extraCount > 0
                  ? t('teamOpt.extra.count', {
                      defaultValue: '{{count}} buffs',
                      count: extraCount,
                    })
                  : undefined
              }
              info={t(
                'teamOpt.extra.info',
                'Buffs the game data does not have, like food, an Abyss blessing or your own numbers. For the whole team or one member: they count on its hits and in its stats and requirements.'
              )}
              open={extraOpen}
              onToggle={() => setExtraOpen((open) => !open)}
              sx={{ ml: -0.25, pt: 1.5, borderTop: hairline }}
            >
              <ExtraBuffs
                members={members}
                teamOpt={teamOpt}
                setTeamOpt={setTeamOpt}
                disabled={running}
              />
            </Disclosure>
          </>
        )}
      </Box>

      {/* (only on the KQM tab: kept mounted there while its results show, to keep its drafts) */}
      {kqmTheorycraftingEnabled && mode === 'kqm' && versionOf && (
        <VersionNote rootId={versionOf} teamId={teamId} />
      )}
      {/* (once on the tab, outside the results: a result coming in leaves it open) */}
      {kqmTheorycraftingEnabled && mode === 'kqm' && (
        <VersionsDrawer teamId={teamId} />
      )}
      {kqmTheorycraftingEnabled && mode === 'kqm' && (
        <Box sx={{ ...sectionSx, ...stepAccentSx('setup'), p: 0 }}>
          <KqmSettings
            active={mode === 'kqm'}
            hasResult={!!kqmResult}
            disabled={running}
            canRun={!!attackCount}
            onStart={(settings) => kqm.run(settings, lowHp?.states)}
            teamId={teamId}
            members={members}
            teamData={teamData}
            teamOpt={teamOpt}
            setTeamOpt={setTeamOpt}
            fight={fightNow}
          />
        </Box>
      )}
      {/* before a run: what it searches (main stats, inventory, weapons, builds) */}
      {mode === 'inventory' && runDialog && (
        <RunDialog
          open
          onClose={() => setRunDialog(false)}
          onStart={() => {
            startedHere.current = {
              previous: resultTime,
              scroll: window.scrollY,
            }
            void run(lowHp?.states, fightBuffs)
          }}
          teamId={teamId}
          members={members}
          teamData={teamData}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          poolSize={poolSize}
          // (an imported team: its builds can be run as they are)
          evaluateOnly={!!team?.importedFrom}
        />
      )}

      {mode === 'kqm' && kqm.state.type === 'error' && (
        <Alert severity="error" onClose={kqm.clear}>
          {t('teamOpt.kqm.error', 'KQM builds stopped:')} {kqm.state.message}
        </Alert>
      )}
      {mode === 'kqm' && kqmResult && (
        // (one run's early builds and its result: the same results, updated in place)
        <Box
          key={kqmResult.startTime ?? kqmResult.seconds}
          sx={{ ...revealSx, ...stepSurfaceSx(true), p: 0 }}
        >
          <KqmResults
            teamId={teamId}
            running={running}
            improving={!!kqmEarly && kqmResult === kqmEarly}
            runSettings={kqmResult.runTeamOpt ?? kqmResult.teamOpt}
            setup={kqmResult.teamOpt}
            rotation={kqmResult.rotation}
            stalls={kqmResult.stalls}
            members={members}
            result={kqmResult.result}
            seconds={kqmResult.seconds}
            // (the run's: the written rotation at the KQM constellations takes its own time)
            rotationTime={
              (kqmResult.runTeamOpt ?? kqmResult.teamOpt).rotationTime ??
              rotationTime
            }
            stale={
              kqmRunKey(kqmResult.teamOpt) !== kqmRunKey(teamOpt) ||
              kqmResultStandardChanged(kqmResult.result, teamOpt.kqm) ||
              (kqmResult.rotation === 'played') !== !!writtenRotation.trim() ||
              enemyChanged(kqmResult.enemy)
            }
            now={teamOpt}
            enemy={kqmResult.enemy}
            enemyNow={enemyChanged(kqmResult.enemy) ? enemyTeam : undefined}
            applications={applications}
            onView={setKqmView}
            teamData={teamData}
            timeline={
              <KqmTimeline
                teamId={teamId}
                members={members}
                teamData={teamData}
                kqm={teamOpt.kqm ?? defaultTeamOptKqm}
                kqmBuilds={kqmShown?.builds}
                kqmBuffs={kqmBuffs}
                kqmAttacks={kqmAttacks}
                kqmDamage={kqmShown?.after.attacks}
                overrides={kqmOverrides}
                onField={onField}
                mainStatAssumptionLevel={teamOpt.assumeMaxMain ? 20 : 0}
              />
            }
            onDiscard={() => {
              kqm.clear()
              rotationOpen.set(true)
            }}
            actions={<VersionsButton teamId={teamId} />}
          />
        </Box>
      )}
      {/* the run's result, below what it was run with (the rotation) */}
      {mode === 'inventory' && !result && <TeamEquipUndo teamId={teamId} />}
      {mode === 'inventory' &&
        !result &&
        !running &&
        !!team?.savedOptimization && (
          <Box sx={{ alignSelf: 'flex-start' }}>
            <RestoreTeamBuildsButton teamId={teamId} />
          </Box>
        )}
      {mode === 'inventory' && state.type === 'error' && (
        <Alert severity="error" onClose={clear}>
          {state.setRulesUnmet?.length ? (
            <SetRulesUnmet characterKeys={state.setRulesUnmet} />
          ) : state.requirementsUnmet ? (
            <RequirementsUnmet
              shortfalls={state.requirementsUnmet}
              teamData={teamData}
              automaticEr={teamEnergyAuto(teamOpt)}
            />
          ) : (
            <>
              {t('teamOpt.run.error', 'Team Optimize stopped:')} {state.message}
            </>
          )}
        </Alert>
      )}
      {mode === 'inventory' && result && shown && (
        <Box
          key={result.seconds + (result.teamOpt ? '' : '-')}
          id={`teamopt-results-${teamId}`}
          sx={{ ...revealSx, scrollMarginTop: 88 }}
        >
          <TeamOptResults
            teamId={teamId}
            members={members}
            result={shown}
            fresh={
              result.savedAt !== undefined &&
              Date.now() - result.savedAt < FRESH_MS
            }
            seconds={result.seconds}
            runTeamOpt={shownTeamOpt}
            rotationTime={shownResultTime}
            // (trying other equipment)
            selected={inspected}
            onSelect={setInspected}
            picked={hasPicks}
            onResetPicks={() => {
              setPicks({})
              setPickView(undefined)
              setGearComparison(undefined)
            }}
            inspector={
              inspected &&
              picked &&
              !gearComparison && (
                <TeamOptInspector
                  key={inspected}
                  characterKey={inspected}
                  result={result.result}
                  optionsRunning={!!result.optionsRunning}
                  onRank={
                    teamBaseStale ? undefined : () => void rankEquipment(result)
                  }
                  session={sessionOfResult}
                  picks={picks}
                  onPicks={setPicks}
                  view={pickView}
                  onView={setPickView}
                  rotationTime={shownResultTime}
                />
              )
            }
            supplement={
              // (as the KQM tab: the best teams that change one member, and how the shown team's
              // damage splits; side by side where there is room)
              shown && (
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
                  <Box sx={{ minWidth: 0 }}>
                    {!teamBaseStale &&
                      !result.result.rankingsComplete &&
                      !!result.result.optimized.length && (
                        <GearRankingControls
                          done={result.result.rankedMembers?.length ?? 0}
                          total={result.result.optimized.length}
                          running={!!result.optionsRunning}
                          error={result.optionsError}
                          onStart={() => void rankEquipment(result)}
                          onStop={cancel}
                        />
                      )}
                    {result.result.options ||
                    result.result.gearComparisons?.length ? (
                      <TeamOptTopBuilds
                        key={result.savedAt ?? result.seconds}
                        members={members.map((m) => m.characterKey)}
                        result={result.result}
                        picks={picks}
                        optionsRunning={result.optionsRunning}
                        comparison={gearComparison}
                        rotationTime={baseResultTime}
                        onPick={(characterKey, next) => {
                          setGearComparison(undefined)
                          setPicks(
                            characterKey && next ? { [characterKey]: next } : {}
                          )
                          if (characterKey) setInspected(characterKey)
                        }}
                        onCompare={(next) => {
                          setPicks({})
                          setPickView(undefined)
                          setGearComparison(next)
                        }}
                      />
                    ) : null}
                  </Box>
                  <DamageShare
                    members={members.map((m) => m.characterKey)}
                    evaluation={shown.after}
                    attacks={shownTeamOpt.attacks}
                    teamData={teamData}
                    rotationTime={shownResultTime}
                  />
                </Box>
              )
            }
            onDiscard={clear}
            teamData={teamData}
            stale={
              result.requirementsKey !== requirementsKey ||
              resultSettingsChanged ||
              enemyChanged(result.enemy)
            }
            enemy={result.enemy}
            enemyNow={enemyChanged(result.enemy) ? team : undefined}
            applications={applications}
            cocoon={resultCocoon}
            onRunAgain={() => setRunDialog(true)}
            timeline={
              <KqmTimeline
                teamId={teamId}
                members={members}
                teamData={teamData}
                gear={shownSimGear}
                kqmBuffs={rotationBuffs}
                kqmAttacks={shownTeamOpt.attacks}
                kqmDamage={shown.after.attacks}
                overrides={shownOverrides}
                onField={onField}
                mainStatAssumptionLevel={shownTeamOpt.assumeMaxMain ? 20 : 0}
              />
            }
          />
        </Box>
      )}
      {/* what one more roll, talent level or level on each member would add */}
      {/* (not while the run's other builds are ranked: computed, and shown, once they are) */}
      {mode === 'inventory' && result && shown && !result.optionsRunning && (
        <TeamSensitivity
          teamId={teamId}
          members={members}
          // (the result's: its rotation and settings, as it was found)
          teamOpt={shownTeamOpt}
          result={shown}
          savedAt={result.savedAt}
          index={0}
        />
      )}
      {/* (KQM's: for its builds shown, while its result is for the rotation as it is; saved with
          the run for its own builds, not for other equipment picked) */}
      {mode === 'kqm' && kqmRotation && kqmShown && (
        <TeamSensitivity
          teamId={teamId}
          members={members}
          teamOpt={kqmRotation.runTeamOpt}
          result={{ kqm: kqmShown }}
          savedAt={
            kqmShown === kqmRotation.result ? kqmRotation.savedAt : undefined
          }
          index={0}
        />
      )}
      {/* last on the page: it stays pinned to the window's foot while anything above scrolls */}
      {((mode === 'inventory' && !showStart) || running) && (
        <RunBar
          teamId={teamId}
          state={state}
          status={status}
          members={members}
          attackCount={attackCount}
          optimizable={optimizable}
          ownGear={ownGear}
          onRun={() => setRunDialog(true)}
          onBuilds={(own) =>
            own
              ? teamLinkUseOwnGear(database, teamId)
              : teamLinkUseImported(database, teamId)
          }
          onCancel={cancel}
          kqmState={kqm.state}
          onKqmCancel={kqm.cancel}
        />
      )}
    </Box>
  )
}

/** A team without members: what to do first, and the way there */
function EmptyTeam({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const navigate = useNavigate()
  return (
    <Box sx={{ p: { xs: 1.5, md: 2 } }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 1.5,
          px: 3,
          py: { xs: 5, md: 7 },
          borderRadius: tokens.radius.panel,
          border: `1px dashed ${tokens.hairlineStrong}`,
        }}
      >
        <Box
          aria-hidden
          sx={{
            display: 'grid',
            placeItems: 'center',
            width: 48,
            height: 48,
            borderRadius: '50%',
            bgcolor: tokens.raised,
            color: 'text.secondary',
          }}
        >
          <GroupsIcon />
        </Box>
        <Typography
          component="h2"
          sx={{
            ...type.title,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          {t('teamOpt.empty.title', 'Add the team’s members first')}
          <InfoTooltipInline
            title={t(
              'teamOpt.empty.desc',
              'Team Optimize finds artifacts for the whole team at once, for one rotation of their attacks.'
            )}
          />
        </Typography>
        <Button
          variant="contained"
          startIcon={<GroupsIcon />}
          sx={giCtaSx}
          onClick={() => navigate(`/teams/${teamId}`)}
        >
          {t('teamOpt.empty.action', 'Team settings')}
        </Button>
      </Box>
    </Box>
  )
}

/** How long one rotation takes, in seconds, for the DPS (empty: back to the default) */
function RotationTimeInput({
  value,
  onChange,
  disabled,
  played,
  compact,
}: {
  value: number
  onChange: (seconds: number | undefined) => void
  disabled?: boolean
  /** The time the rotation took as played (KQM's): shown, not edited */
  played?: boolean
  /** A chip at the end of the rotation's line: its icon for the label, the help on hover */
  compact?: boolean
}) {
  const { t } = useTranslation('page_team')
  const [text, setText] = useState(`${value}`)
  useEffect(() => setText(`${value}`), [value])
  const commit = () => {
    const seconds = Number.parseFloat(text.replace(',', '.'))
    const next =
      Number.isFinite(seconds) && seconds > 0
        ? Math.min(seconds, 600)
        : undefined
    setText(`${next ?? defaultRotationTime}`)
    if (next !== value) onChange(next)
  }
  const info = t(
    'teamOpt.rotationTime.info',
    'How long one rotation takes, for the DPS. Saved for this team.'
  )
  const unit = (
    <Typography
      component="span"
      sx={{ ...type.label, ml: 0.25, pointerEvents: 'none' }}
    >
      s
    </Typography>
  )
  if (played) {
    const readout = (
      <Box
        component="span"
        aria-label={`${t('teamOpt.rotationTime.label', 'Rotation time')}: ${value} s`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 28,
          px: compact ? 0.875 : 0,
          ...timeSx,
        }}
      >
        {compact && (
          <TimerOutlinedIcon
            sx={{ fontSize: 15, color: 'text.secondary', mr: 0.5 }}
          />
        )}
        {value}
        {unit}
      </Box>
    )
    const playedInfo = t(
      'teamOpt.rotationTime.playedInfo',
      'How long one rotation takes as played, for the DPS.'
    )
    return compact ? (
      <Tooltip arrow title={playedInfo} placement="top">
        {readout}
      </Tooltip>
    ) : (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FieldLabel tip={playedInfo}>
          {t('teamOpt.rotationTime.label', 'Rotation time')}
        </FieldLabel>
        {readout}
      </Box>
    )
  }
  if (compact)
    return (
      <Tooltip arrow title={info} placement="top">
        <InputBase
          value={text}
          placeholder={`${defaultRotationTime}`}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
          inputProps={{
            inputMode: 'decimal',
            'aria-label': t('teamOpt.rotationTime.label', 'Rotation time'),
          }}
          startAdornment={
            <TimerOutlinedIcon
              sx={{ fontSize: 15, color: 'text.secondary', mr: 0.5 }}
            />
          }
          endAdornment={unit}
          sx={{
            height: 28,
            pl: 0.875,
            pr: 1,
            borderRadius: 999,
            border: '1px solid transparent',
            ...timeSx,
            ...quickSx,
            '&:hover': {
              bgcolor: alpha(giTokens.parchment, 0.05),
              borderColor: tokens.hairlineStrong,
            },
            '&.Mui-focused': {
              borderColor: tokens.gold,
              bgcolor: tokens.inset,
            },
            '&.Mui-disabled': { opacity: 0.7 },
            '& input': { width: '2.4em', textAlign: 'right', p: 0 },
          }}
        />
      </Tooltip>
    )
  return (
    <Box
      component="label"
      sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
    >
      <FieldLabel tip={info}>
        {t('teamOpt.rotationTime.label', 'Rotation time')}
      </FieldLabel>
      <InputBase
        value={text}
        placeholder={`${defaultRotationTime}`}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        inputProps={{
          inputMode: 'decimal',
          'aria-label': t('teamOpt.rotationTime.label', 'Rotation time'),
        }}
        endAdornment={unit}
        sx={{
          height: 30,
          pl: 1,
          pr: 0.875,
          borderRadius: tokens.radius.control,
          border: `1px solid ${tokens.hairlineStrong}`,
          bgcolor: tokens.inset,
          ...timeSx,
          ...quickSx,
          '&:hover': { borderColor: alpha(giTokens.parchment, 0.3) },
          '&.Mui-focused': { borderColor: tokens.gold },
          '&.Mui-disabled': { opacity: 0.7 },
          '& input': { width: '2.5em', textAlign: 'right', p: 0 },
        }}
      />
    </Box>
  )
}

/** A rotation time's figures: bright and tabular, the unit beside them quiet */
const timeSx = {
  fontSize: 14,
  fontWeight: 650,
  color: 'text.primary',
  ...numSx,
  '& input.Mui-disabled': { WebkitTextFillColor: 'currentColor' },
} as const

/** Quiet secondary button in the Rotation header bar (matches Write rotation's 30px height) */
const copyRotationSx = {
  height: 30,
  px: 1.125,
  fontSize: 12.5,
  fontWeight: 550,
  whiteSpace: 'nowrap',
  color: 'text.secondary',
  borderColor: tokens.hairlineStrong,
  bgcolor: alpha(giTokens.parchment, 0.02),
  ...quickSx,
  ...focusSx,
  '&:hover': {
    color: 'text.primary',
    borderColor: alpha(giTokens.parchment, 0.28),
    bgcolor: alpha(giTokens.parchment, 0.055),
  },
  '& .MuiButton-startIcon': { mr: 0.5 },
  '& .MuiButton-startIcon svg': { fontSize: 15 },
} as const

/** The rotation's Team DPS and total damage, blended inline into the Rotation header */
function HeaderStats({
  total,
  rotationTime,
  source = 'current',
}: {
  total: number | undefined
  rotationTime: number
  /** Which builds the figures represent (always the active builds on screen, never stale equipped) */
  source?: 'optimized' | 'picked' | 'current' | 'currentStale'
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        flexWrap: 'wrap',
        columnGap: 1.125,
        rowGap: 0.25,
        mr: 0.5,
      }}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 0.625,
        }}
      >
        <Typography
          component="span"
          sx={{
            ...numSx,
            fontSize: { xs: 19, sm: 21 },
            fontWeight: 700,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            fontFeatureSettings: '"tnum", "ss01"',
            color: 'text.primary',
          }}
        >
          {formatRateFull(total, rotationTime)}
        </Typography>
        <Box
          component="span"
          sx={{
            fontSize: 12.5,
            fontWeight: 550,
            letterSpacing: '-0.005em',
            lineHeight: 1,
            color: 'text.secondary',
            whiteSpace: 'nowrap',
          }}
        >
          {source === 'currentStale'
            ? t('teamOpt.header.currentDps', 'Current DPS')
            : t('teamOpt.header.teamDps', 'Team DPS')}
        </Box>
      </Box>
      <Box
        component="span"
        aria-hidden
        sx={{
          color: 'text.secondary',
          opacity: 0.35,
          fontSize: 13,
          lineHeight: 1,
          userSelect: 'none',
        }}
      >
        ·
      </Box>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'baseline',
          gap: 0.5,
        }}
      >
        <Typography
          component="span"
          sx={{
            ...numSx,
            fontSize: 13.5,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            lineHeight: 1,
            fontFeatureSettings: '"tnum", "ss01"',
            color: alpha(giTokens.parchment, 0.78),
          }}
        >
          {formatDamage(total)}
        </Typography>
        <Box
          component="span"
          sx={{
            fontSize: 12,
            fontWeight: 500,
            lineHeight: 1,
            color: 'text.secondary',
            opacity: 0.85,
            whiteSpace: 'nowrap',
          }}
        >
          {t('teamOpt.header.dmgShort', 'DMG')}
        </Box>
      </Box>
    </Box>
  )
}

/**
 * Who is on the field during the rotation's hits, unless an attack says otherwise: buffs for the
 * active character (e.g. Mitya's C1 CRIT DMG) go to them
 */
function OnFieldPicker({
  members,
  value,
  onChange,
  disabled,
}: {
  members: TeamOptMember[]
  value: CharacterKey
  onChange: (characterKey: CharacterKey) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FieldLabel
        tip={t(
          'teamOpt.onField.info',
          'Who is on the field during the rotation’s hits, unless an attack says otherwise (open it to change it). Buffs for the active character, like Mitya’s C1 CRIT DMG, go to them, and the ones for off-field characters to the others. Elsewhere the app counts the team’s first member as on the field.'
        )}
      >
        {t('teamOpt.onField.label', 'On field')}
      </FieldLabel>
      <Segmented
        size="small"
        aria-label={t('teamOpt.onField.label', 'On field')}
        value={value}
        // (the one already on the field: nothing to change)
        onChange={(characterKey) =>
          characterKey !== value && onChange(characterKey)
        }
        options={members.map((m) => ({
          value: m.characterKey,
          disabled,
          tip: <CharacterName characterKey={m.characterKey} gender={gender} />,
          label: (
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                // the others, quieter: the one on the field stands out
                opacity: m.characterKey === value ? 1 : 0.7,
                filter: m.characterKey === value ? 'none' : 'saturate(.7)',
                transition: 'opacity .12s, filter .12s',
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                },
                '*:hover > &': { opacity: 1, filter: 'none' },
              }}
            >
              <MemberAvatar characterKey={m.characterKey} size={22} />
            </Box>
          ),
        }))}
      />
    </Box>
  )
}

/** The page's one main action (Cancel while running), with the run's progress */
function RunBar({
  teamId,
  state,
  status,
  members,
  attackCount,
  optimizable,
  ownGear,
  onBuilds,
  onRun,
  onCancel,
  kqmState,
  onKqmCancel,
}: {
  state: TeamOptRunState
  status: TeamOptStatus
  members: TeamOptMember[]
  attackCount: number
  optimizable: TeamOptMember[]
  /** An imported team's members that came with builds (`teamLinkOwnGear`) */
  ownGear?: {
    switchable: CharacterKey[]
    missing: CharacterKey[]
    onOwn: CharacterKey[]
  }
  /** An imported team: its builds (false) or the player's own (true) */
  onBuilds: (own: boolean) => void
  /** Opens the run's dialog (it starts the run) */
  onRun: () => void
  onCancel: () => void
  kqmState: KqmRunState
  onKqmCancel: () => void
  teamId: string
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const barRef = useBottomBar<HTMLDivElement>()
  const kqmRunning = kqmState.type === 'running'
  const running = state.type === 'running' || kqmRunning
  // (members on a TC build are kept as they are: Team optimize picks real artifacts)
  const tcCount = members.filter((m) => m.isTc).length
  // can't run at all: nothing to play, or nothing it could ever optimize
  // an imported team: on the builds it came with, or on the player's own (those they have)
  const imported = !!ownGear
  const builds =
    ownGear && (ownGear.switchable.length || ownGear.onOwn.length)
      ? ownGear.switchable.length || !ownGear.onOwn.length
        ? 'imported'
        : 'own'
      : undefined
  const blocked = !attackCount
    ? t('teamOpt.run.noAttacks', 'Add the rotation’s attacks first.')
    : tcCount === members.length && !imported
      ? t(
          'teamOpt.run.allTc',
          'Every member uses a TC build, which Team optimize keeps as it is. Switch members to their equipped builds, or use KQM Theorycrafting.'
        )
      : undefined
  const ownGearNote =
    imported && tcCount === members.length
      ? t(
          'teamOpt.run.importedBuilds',
          'Runs the imported builds as they are: their damage, what raises it, the team card. My builds optimizes your own pieces.'
        )
      : imported && ownGear?.missing.length && builds === 'own'
        ? t('teamOpt.run.importedMissing', {
            defaultValue_one:
              '{{count}} member you don’t have keeps the imported build.',
            defaultValue_other:
              '{{count}} members you don’t have keep the imported build.',
            count: ownGear.missing.length,
          })
        : undefined
  // every member switched off: the button still opens Optimize team, where they are switched on
  const allOff =
    !blocked && !optimizable.length
      ? t(
          'teamOpt.run.allSwitchedOff',
          'Every member is switched off: turn members on in Optimize gear.'
        )
      : undefined

  return (
    <Box
      ref={barRef}
      sx={{
        position: 'sticky',
        bottom: { xs: 8, sm: 12 },
        zIndex: 3,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        minHeight: 56,
        pl: { xs: 1.5, sm: 2 },
        pr: 1,
        py: 1,
        borderRadius: tokens.radius.panel,
        overflow: 'hidden',
        // it floats over the page while scrolling: raised, with a shadow
        bgcolor: alpha(tokens.raised, 0.94),
        backdropFilter: 'blur(8px)',
        border: `1px solid ${tokens.hairlineStrong}`,
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
      }}
    >
      <Box
        sx={{
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
        }}
      >
        {kqmRunning ? (
          <KqmProgress
            teamId={teamId}
            members={members.map((m) => m.characterKey)}
            startTime={kqmState.startTime}
          />
        ) : state.type === 'running' ? (
          <RunProgress state={state} status={status} gender={gender} />
        ) : (
          <>
            {!blocked && (
              <Box
                sx={{ display: { xs: 'none', sm: 'flex' }, gap: 0.5 }}
                aria-hidden
              >
                {members.map(({ characterKey }) => {
                  const on = optimizable.some(
                    (m) => m.characterKey === characterKey
                  )
                  return (
                    <Box
                      key={characterKey}
                      sx={{
                        display: 'flex',
                        opacity: on ? 1 : 0.3,
                        filter: on ? 'none' : 'grayscale(1)',
                      }}
                    >
                      <MemberAvatar characterKey={characterKey} size={26} />
                    </Box>
                  )
                })}
              </Box>
            )}
            {builds && (
              <Segmented
                size="small"
                aria-label={t('teamOpt.run.buildsLabel', 'Builds')}
                value={builds}
                onChange={(value) => onBuilds(value === 'own')}
                options={[
                  {
                    value: 'imported',
                    label: t('teamOpt.run.buildsImported', 'Imported builds'),
                  },
                  {
                    value: 'own',
                    label: t('teamOpt.run.buildsOwn', 'My builds'),
                  },
                ]}
              />
            )}
            <Typography
              sx={{
                ...type.body,
                ...numSx,
                fontWeight: blocked || allOff ? 400 : 500,
                color: blocked || allOff ? 'text.secondary' : 'text.primary',
                fontSize: { xs: 13.5, sm: 14 },
                lineHeight: 1.35,
                // (one line; a reason it can't run may take more)
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp:
                  blocked || allOff ? { xs: 4, sm: 2 } : { xs: 2, sm: 1 },
                overflow: 'hidden',
              }}
            >
              {blocked ??
                ownGearNote ??
                allOff ??
                t('teamOpt.run.toOptimize', {
                  defaultValue: '{{count}} of {{total}} to optimize',
                  count: optimizable.length,
                  total: members.length,
                })}
            </Typography>
          </>
        )}
      </Box>

      {running ? (
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<CloseIcon />}
          onClick={kqmRunning ? onKqmCancel : onCancel}
          sx={{ flexShrink: 0, minHeight: 36, ...quickSx }}
        >
          {t('teamOpt.run.cancel', 'Cancel')}
        </Button>
      ) : (
        <Button
          variant="contained"
          color="inherit"
          startIcon={<TrendingUpIcon />}
          disabled={!!blocked}
          onClick={onRun}
          sx={[
            { flexShrink: 0, minHeight: 36, px: 2, fontWeight: 650 },
            !blocked && giCtaSx,
          ]}
        >
          {t('teamOpt.run.gear', 'Optimize gear')}
        </Button>
      )}
    </Box>
  )
}

/** The thin gold line along the run bar's foot (measured when `value` is given) */
function ProgressLine({ value }: { value?: number }) {
  return (
    <LinearProgress
      aria-hidden
      variant={value === undefined ? 'indeterminate' : 'determinate'}
      value={value}
      sx={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 2,
        bgcolor: 'transparent',
      }}
    />
  )
}

/** A run without a result: no team build keeps these members to their allowed sets */
function SetRulesUnmet({ characterKeys }: { characterKeys: CharacterKey[] }) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  return (
    <>
      {t('teamOpt.run.setRulesUnmet', 'No team build fits the allowed sets of')}{' '}
      {characterKeys.map((ck, i) => (
        <Fragment key={ck}>
          {i > 0 && ', '}
          <strong>
            <CharacterName characterKey={ck} gender={gender} />
          </strong>
        </Fragment>
      ))}
      {'. '}
      <InfoTooltipInline
        title={t(
          'teamOpt.run.setRulesUnmetWhy',
          'Even with the pieces the other members hold, no build of the artifacts they may use keeps to the sets allowed on their Optimize tab (Requirements → Artifact sets), with their main stats and the inventory settings. Allow more sets, or free up pieces of the sets they need.'
        )}
      />
    </>
  )
}

/** A run without a result: no team build gets these members to their minimums */
function RequirementsUnmet({
  shortfalls,
  teamData,
  automaticEr,
}: {
  shortfalls: Partial<Record<CharacterKey, TeamOptShortfall[]>>
  teamData: TeamData | undefined
  automaticEr: boolean
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const why = t(
    'teamOpt.run.requirementsUnmetWhy',
    'The search uses the allowed sets, main stats, artifact levels and weapons. To change a manual minimum, open the member’s Optimize tab.'
  )
  return (
    <>
      {t(
        'teamOpt.run.requirementsUnmet',
        'The search did not find a build that meets the minimums for'
      )}{' '}
      {Object.keys(shortfalls).map((ck, i) => (
        <Fragment key={ck}>
          {i > 0 && ', '}
          <strong>
            <CharacterName characterKey={ck as CharacterKey} gender={gender} />
          </strong>
        </Fragment>
      ))}
      {'.'}
      {Object.entries(shortfalls).map(([ck, missed]) => (
        <Box key={ck} sx={{ mt: 0.75 }}>
          <Shortfalls
            shortfalls={missed ?? []}
            data={teamData?.[ck as CharacterKey]?.target}
            optimized
            why={why}
          />
        </Box>
      ))}
      {automaticEr &&
        Object.values(shortfalls).some((missed) =>
          missed?.some(({ path }) => path.at(-1) === 'enerRech_')
        ) && (
          <Box sx={{ mt: 0.75 }}>
            {t(
              'teamOpt.run.automaticErShortfall',
              'Automatic ER gets its target from the team’s ER calculator. It can change with the rotation and the team’s weapons.'
            )}
          </Box>
        )}
    </>
  )
}

function RunProgress({
  state,
  status,
  gender,
}: {
  state: Extract<TeamOptRunState, { type: 'running' }>
  status: TeamOptStatus
  gender: 'F' | 'M'
}) {
  const { t } = useTranslation('page_team')
  // the solver's counters are updated in place: poll them
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 300)
    return () => clearInterval(timer)
  }, [])
  // the run's step, kept with its counters (see `TeamOptStatus.step`)
  const step = status.step ?? state.step
  const seconds = (performance.now() - state.startTime) / 1000
  return (
    <>
      <Typography noWrap sx={{ ...type.body, ...numSx, minWidth: 0 }}>
        {step ? (
          <Box component="span" sx={{ fontWeight: 600 }}>
            {step.alternatives
              ? t('teamOpt.run.alternatives', 'Next best builds')
              : t('teamOpt.run.round', {
                  defaultValue: 'Round {{round}}',
                  round: step.round,
                })}
            {' · '}
            <CharacterName characterKey={step.characterKey} gender={gender} /> (
            {step.step}/{step.steps})
            {!!step.weapons &&
              !!step.weapon &&
              ` · ${t('teamOpt.run.weaponCandidate', {
                defaultValue: 'weapon candidate {{weapon}}/{{weapons}}',
                weapon: step.weapon,
                weapons: step.weapons,
              })}`}
            {step.exchange &&
              ` · ${t('teamOpt.run.exchange', 'exchanges between members')}`}
            {step.energyFor && (
              <>
                {' · '}
                {t('teamOpt.run.energyFor', 'energy check:')}{' '}
                <CharacterName characterKey={step.energyFor} gender={gender} />
              </>
            )}
          </Box>
        ) : (
          t('teamOpt.run.preparing', 'Preparing…')
        )}
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {' · '}
          {t('teamOpt.run.elapsed', {
            defaultValue: '{{seconds}} s',
            seconds: Math.round(seconds),
          })}
        </Box>
      </Typography>
      <ProgressLine />
    </>
  )
}

/** The rotation's damage with the members' current builds, recomputed shortly after a change */
function useCurrentEvaluation(
  teamId: string,
  teamOpt: TeamOpt,
  teamData: TeamData | undefined,
  /** States every attack gets, as a run sets them (Wolf's Gravestone's uptime) */
  attackStates?: readonly RunAttackState[]
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [current, setCurrent] = useState<{
    evaluation: TeamOptEvaluation | undefined
    settings: Parameters<typeof evaluateTeamRotation>[3]
  }>()
  // (evaluated again only when what it reads changes: not for a weapon ticked in Weapons)
  const latestTeamOpt = useRef(teamOpt)
  latestTeamOpt.current = teamOpt
  const readKey = useMemo(
    () =>
      JSON.stringify([
        teamOpt.attacks,
        teamOpt.assumeMaxMain,
        teamOpt.onField,
        teamOpt.bonusStats,
        teamOpt.energySource,
        teamOpt.energyCalculator,
        teamOpt.weaponEnergy,
      ]),
    [teamOpt]
  )
  useEffect(() => {
    if (!teamData) return undefined
    const teamOpt = latestTeamOpt.current
    const timer = setTimeout(() => {
      const members = teamOptMembers(database, teamId)
      // with what the team's energy weapons save each member
      const statFilters = teamStatFilters(
        Object.fromEntries(
          members.map((m) => [
            m.characterKey,
            database.optConfigs.get(m.teamChar.optConfigId)?.statFilters ?? {},
          ])
        ),
        teamOptCurrentWeapons(database, members),
        teamOpt
      )
      const settings = {
        arts: {},
        attacks: withAttackStates(teamOpt.attacks, attackStates),
        mainStatAssumptionLevel: teamOpt.assumeMaxMain ? 20 : 0,
        statFilters,
        onField: teamOpt.onField,
        bonusStats: teamOptBonusStats(
          teamOpt,
          members.map((m) => m.characterKey)
        ),
      }
      setCurrent({
        evaluation: evaluateTeamRotation(database, teamId, gender, settings),
        settings,
      })
    }, 120)
    return () => clearTimeout(timer)
  }, [database, teamId, gender, readKey, teamData, attackStates])
  // (and the settings it was found with: the Moongecko's cocoon evaluates the same)
  return [current?.evaluation, current?.settings] as const
}

/** How many artifacts the team may use (any member, before main-stat filters) */
function usePoolSize(members: TeamOptMember[], teamOpt: TeamOpt) {
  const database = useDatabase()
  return useMemo(() => {
    const member = members[0]
    if (!member) return 0
    const anyConfig = {
      mainStatKeys: { sands: [], goblet: [], circlet: [] },
      artExclusion: [],
    } as never
    const locations = new Set(members.map((m) => m.location as string))
    return teamOptPool(
      database.arts.values,
      member,
      anyConfig,
      teamOpt,
      locations,
      new Set()
    ).length
  }, [database, members, teamOpt])
}
