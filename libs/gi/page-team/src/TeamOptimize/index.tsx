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
  KqmResult,
  RunAttackState,
  RunEnemy,
  SimGear,
  TeamData,
  TeamOptEvaluation,
  TeamOptMember,
  TeamOptResult,
} from '@genshin-optimizer/gi/ui'
import {
  appliedStygianPreset,
  CharacterName,
  enemyFight,
  evaluateTeamRotation,
  fightBuffShare,
  kqmTeamOverrides,
  MOONGECKO_BOSS,
  sameEnemy,
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
  useTeamBuffs,
} from './buffs'
import { ExtraBuffs } from './ExtraBuffs'
import { expandStore } from './expandStore'
import {
  fightTeamOf,
  useCocoonEvaluations,
  useRotationApplications,
} from './fightTeam'
import { defaultRotationTime, formatDamage, formatRate } from './format'
import { KqmProgress, KqmResults, KqmSettings } from './KqmMode'
import { KqmTimeline } from './KqmTimeline'
import { kqmOwnSetUp } from './kqmOwn'
import { MemberAvatar } from './MemberAvatar'
import { MemberRotation } from './MemberRotation'
import { RotationInline, RotationsSetting } from './RotationInline'
import { RotationTransfer } from './RotationTransfer'
import {
  copyRotationFromKqm,
  copyRotationToKqm,
  RotationConfigureButton,
  rotationIdOf,
  useAppliedRotation,
  useRotationWriter,
  useSameRotations,
  useSimTeam,
} from './RotationWriter'
import { RunDialog } from './RunDialog'
import { sameBuildRoster, teamRoster } from './runScope'
import { TeamOptimizeStart, useManualStart } from './TeamOptimizeStart'
import { TeamEquipUndo, TeamOptResults } from './TeamOptResults'
import { TeamSensitivity } from './TeamSensitivity'
import {
  Disclosure,
  FieldLabel,
  hairline,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  StatTile,
  StepTitle,
  stepAccentSx,
  stepSurfaceSx,
  tokens,
  type,
  VDivider,
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
    !!enemy &&
    !!enemyTeam &&
    !sameEnemy(enemy.enemyOverride, enemyTeam.enemyOverride)
  const [storedTeamOpt, setStoredTeamOpt] = useTeamOpt(teamId)
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
  // `teamData` is recomputed whenever a member, a build or a conditional changes
  const members = useMemo(
    () => teamOptMembers(database, teamId),
    [database, teamId, team, teamData]
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
  const buffs = useTeamBuffs(teamId, teamData)
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
  const { state, status, run, cancel, clear, requirementsKey } =
    useTeamOptRun(teamId)
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
  const poolSize = usePoolSize(members, teamOpt)
  const [runDialog, setRunDialog] = useState(false)
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
        setTeamOpt((o) => {
          o.attacks[characterKey] = update(o.attacks[characterKey] ?? [])
        })
      },
    [setTeamOpt, running]
  )
  // a result for another line-up is of no use
  const result =
    state.type === 'done' &&
    sameBuildRoster(state.result.builds, memberKeys) &&
    (state.roster === undefined || state.roster === roster)
      ? state
      : undefined
  // which of the result's team builds is shown (the best, or one of the next ones)
  const [pick, setPick] = useState(0)
  const builds = result ? teamBuilds(result.result) : []
  const shown = builds[Math.min(pick, builds.length - 1)]
  useEffect(() => setPick(0), [result?.result])
  // the shown builds' rotation timeline: the written rotation played with their weapons and sets,
  // an attack's figures read with their builds (as the run counted them)
  const shownGear = useMemo(
    () => (shown ? teamOptResultGear(database, teamId, shown) : undefined),
    [database, teamId, shown]
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
  const shownTeamOpt = result?.teamOpt ?? teamOpt
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
  // a new result: the rotation folds away (it opens again with a click) and the result, below it,
  // comes into view
  useEffect(() => {
    if (mode !== 'inventory' || !result) return
    rotationOpen.set(false)
    requestAnimationFrame(() =>
      document
        .getElementById(`teamopt-results-${teamId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    )
  }, [mode, result, teamId, rotationOpen])

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
          gap: 2,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1.5,
            rowGap: 1.25,
            minHeight: 36,
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
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mr: 0.5 }}
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
            <RotationConfigureButton
              teamId={teamId}
              writer={writer}
              disabled={running}
            />
          )}
          <Box sx={{ flexGrow: 1 }} />
          {!!attackCount && mode === 'inventory' && (
            <HeaderStats
              total={evaluation?.total}
              rotationTime={rotationTime}
              current={
                !result || !shown
                  ? undefined
                  : members.every(
                        (m) => m.loadoutDatum.buildType === 'equipped'
                      )
                    ? 'equipped'
                    : 'builds'
              }
            />
          )}
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
        {((mode === 'kqm' && showStart) ||
          canCopyInventoryRotation ||
          canCopyKqmRotation) && (
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 1,
            }}
          >
            {mode === 'kqm' && showStart && (
              <Typography variant="body2" color="text.secondary">
                {t(
                  'teamOpt.kqm.separateRotation',
                  'KQM uses its own rotation. You can copy the current Team optimize rotation here.'
                )}
              </Typography>
            )}
            {canCopyInventoryRotation && (
              <Button
                size="small"
                onClick={copyInventoryRotation}
                disabled={running}
              >
                {t('teamOpt.kqm.copyRotation', 'Copy from Team optimize')}
              </Button>
            )}
            {canCopyKqmRotation && (
              <Button size="small" onClick={copyKqmRotation} disabled={running}>
                {t('teamOpt.copyKqmRotation', 'Copy from KQM Theorycrafting')}
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
                      (kqmAttacks ?? teamOpt.attacks)[member.characterKey] ?? []
                    }
                    setAttacks={setAttacks(member.characterKey)}
                    evaluation={
                      mode === 'inventory' ? evaluation : kqmShown?.after
                    }
                    figures={mode === 'inventory'}
                    played={kqmPlayed}
                    overrides={kqmOverrides}
                    buffs={buffsForAttacker(rotationBuffs, member.characterKey)}
                    mainStatAssumptionLevel={teamOpt.assumeMaxMain ? 20 : 0}
                    members={members}
                    onField={onField ?? member.characterKey}
                    rotationTime={kqmRotationTime ?? rotationTime}
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
          onStart={() => run(lowHp?.states, fightBuffs)}
          teamId={teamId}
          members={members}
          teamData={teamData}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          poolSize={poolSize}
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
          />
        </Box>
      )}
      {/* the run's result, below what it was run with (the rotation) */}
      {mode === 'inventory' && !result && <TeamEquipUndo teamId={teamId} />}
      {mode === 'inventory' && state.type === 'error' && (
        <Alert severity="error" onClose={clear}>
          {state.setRulesUnmet?.length ? (
            <SetRulesUnmet characterKeys={state.setRulesUnmet} />
          ) : (
            <>
              {t('teamOpt.run.error', 'Team Optimize stopped:')} {state.message}
            </>
          )}
        </Alert>
      )}
      {mode === 'inventory' && result && shown && builds.length > 1 && (
        <TeamBuildPicker
          builds={builds}
          value={builds.indexOf(shown)}
          onChange={setPick}
          rotationTime={rotationTime}
        />
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
            seconds={result.seconds}
            runTeamOpt={result.teamOpt}
            rotationTime={rotationTime}
            onDiscard={clear}
            teamData={teamData}
            stale={
              result.requirementsKey !== requirementsKey ||
              teamOptRunKey(result.teamOpt) !== teamOptRunKey(teamOpt) ||
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
                kqmAttacks={result.teamOpt.attacks}
                kqmDamage={shown.after.attacks}
                overrides={shownOverrides}
                onField={onField}
                mainStatAssumptionLevel={result.teamOpt.assumeMaxMain ? 20 : 0}
              />
            }
          />
        </Box>
      )}
      {/* what one more roll, talent level or level on each member would add */}
      {mode === 'inventory' && result && shown && (
        <TeamSensitivity
          teamId={teamId}
          members={members}
          // (the result's: its rotation and settings, as it was found)
          teamOpt={result.teamOpt}
          result={shown}
          savedAt={result.savedAt}
          index={Math.min(pick, builds.length - 1)}
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
          onRun={() => setRunDialog(true)}
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

/** The rotation's damage and its DPS, side by side */
function HeaderStats({
  total,
  rotationTime,
  current,
}: {
  total: number | undefined
  rotationTime: number
  /**
   * A result is on screen too: say these are the members' builds now (all equipped, or some saved
   * builds, as after Save as builds)
   */
  current?: 'equipped' | 'builds'
}) {
  const { t } = useTranslation('page_team')
  const tip =
    current === 'builds'
      ? t('teamOpt.header.currentTip', 'With the builds the team uses now')
      : t('teamOpt.header.equippedTip', 'With the builds equipped now')
  // (the figures keep their width while they change: nothing beside them moves)
  const valueSx = { '& .MuiTypography-root': { minWidth: '7.5ch' } } as const
  return (
    <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 2 }}>
      <StatTile
        label={
          current === 'builds'
            ? t('teamOpt.header.currentTotal', 'Current DMG')
            : current
              ? t('teamOpt.header.equippedTotal', 'Equipped DMG')
              : t('teamOpt.header.total', 'Rotation DMG')
        }
        tip={tip}
        value={formatDamage(total, true)}
        sx={valueSx}
      />
      <VDivider />
      <StatTile
        label={
          current === 'builds'
            ? t('teamOpt.header.currentDps', 'Current DPS')
            : current
              ? t('teamOpt.header.equippedDps', 'Equipped DPS')
              : t('teamOpt.header.dps', 'DPS')
        }
        tip={tip}
        value={formatRate(total, rotationTime, true)}
        sx={valueSx}
      />
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
  const blocked = !attackCount
    ? t('teamOpt.run.noAttacks', 'Add the rotation’s attacks first.')
    : tcCount === members.length
      ? t(
          'teamOpt.run.allTc',
          'Every member uses a TC build, which Team optimize keeps as it is. Switch members to their equipped builds, or use KQM Theorycrafting.'
        )
      : undefined
  // every member switched off: the button still opens Optimize team, where they are switched on
  const allOff =
    !blocked && !optimizable.length
      ? t(
          'teamOpt.run.allSwitchedOff',
          'Every member is switched off: turn members on in Optimize team.'
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
          {t('teamOpt.run.button', 'Optimize team')}
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
  const total = Number.isFinite(status.total) ? status.total : 0
  // (the GPU's sweep before the exact total: a share of every combination, not a count of builds)
  const upper = status.upper && Number.isFinite(status.upper) ? status.upper : 0
  const done = status.tested + status.skipped
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
              ` · ${t('teamOpt.run.weapon', {
                defaultValue: 'weapon {{weapon}}/{{weapons}}',
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
          {' · '}
          {!total && upper
            ? t('teamOpt.run.share', {
                defaultValue: 'searching · {{percent}}%',
                percent: Math.floor(Math.min(1, done / upper) * 100),
              })
            : !total
              ? t('teamOpt.run.setup', 'setting up the search')
              : !done
                ? t('teamOpt.run.searching', {
                    defaultValue: 'searching {{total}} builds',
                    total: formatDamage(total),
                  })
                : t('teamOpt.run.builds', {
                    defaultValue: '{{done}} of {{total}} builds',
                    done: formatDamage(done),
                    total: formatDamage(total),
                  })}
        </Box>
      </Typography>
      <ProgressLine
        value={total && done ? Math.min(100, (done / total) * 100) : undefined}
      />
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
  useEffect(() => {
    if (!teamData) return undefined
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
  }, [database, teamId, gender, teamOpt, teamData, attackStates])
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

/**
 * A result's team builds as results of their own: the best one, then its alternatives (see
 * `TeamOptResult.alternatives`). One object each, kept with the result: the views cache their
 * work by it, and one made again on every render would restart them.
 */
const teamBuildsOf = new WeakMap<TeamOptResult, TeamOptResult[]>()
function teamBuilds(result: TeamOptResult): TeamOptResult[] {
  let list = teamBuildsOf.get(result)
  if (!list) {
    list = [
      result,
      ...(result.alternatives ?? []).map(({ builds, after }) => ({
        ...result,
        builds,
        after,
        alternatives: undefined,
      })),
    ]
    teamBuildsOf.set(result, list)
  }
  return list
}

/** Picks which of a result's team builds is shown: #1 (the best), #2... with their damage */
function TeamBuildPicker({
  builds,
  value,
  onChange,
  rotationTime,
}: {
  builds: TeamOptResult[]
  value: number
  onChange: (index: number) => void
  rotationTime?: number
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const best = builds[0].after.total
  const alternatives = builds[0].alternatives ?? []
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 1,
      }}
    >
      <FieldLabel>{t('teamOpt.result.builds', 'Team builds')}</FieldLabel>
      <Box sx={{ maxWidth: '100%', overflowX: 'auto' }}>
        <Segmented
          size="small"
          aria-label={t('teamOpt.result.builds', 'Team builds')}
          value={value}
          onChange={onChange}
          options={builds.map((build, i) => {
            const changed = i > 0 ? alternatives[i - 1]?.changed : undefined
            return {
              value: i,
              tip: changed ? (
                <>
                  {t(
                    'teamOpt.result.buildChanges',
                    'The best build, with other artifacts on'
                  )}{' '}
                  <CharacterName characterKey={changed} gender={gender} />
                </>
              ) : (
                t('teamOpt.result.buildBest', 'The best build found')
              ),
              label: (
                <Box component="span" sx={{ ...numSx }}>
                  #{i + 1} {formatRate(build.after.total, rotationTime)}
                  {i > 0 && (
                    <Box
                      component="span"
                      sx={{ color: 'text.secondary', fontWeight: 500 }}
                    >
                      {/* (the difference itself: next best builds are often within 0.1%) */}{' '}
                      −{formatRate(best - build.after.total, rotationTime)}
                    </Box>
                  )}
                </Box>
              ),
            }
          })}
        />
      </Box>
    </Box>
  )
}
