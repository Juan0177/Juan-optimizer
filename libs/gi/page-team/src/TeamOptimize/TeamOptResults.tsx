import { useDataManagerEntries } from '@genshin-optimizer/common/database-ui'
import { aboveBottomBar, BootstrapTooltip } from '@genshin-optimizer/common/ui'
import { clamp, getUnitStr, objPathValue } from '@genshin-optimizer/common/util'
import { artifactAsset, weaponAsset } from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  CharacterKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type {
  ICachedWeapon,
  StatFilters,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { KeyMap } from '@genshin-optimizer/gi/keymap'
import {
  getCharEle,
  getWeaponStat,
  weaponHasRefinement,
} from '@genshin-optimizer/gi/stats'
import { StatIcon } from '@genshin-optimizer/gi/svgicons'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  RunEnemy,
  TeamData,
  TeamOptMember,
  TeamOptResult,
  TeamOptShortfall,
} from '@genshin-optimizer/gi/ui'
import {
  ArtifactCardPico,
  ArtifactSetName,
  ArtifactSetTooltip,
  CharacterName,
  calculateEnergyRecharge,
  EnemyDefeatTime,
  EnemySummary,
  ExcludeIcon,
  isCalcEnergyWeapon,
  isFavonius,
  resolveInfo,
  sameRunEnemy,
  statName,
  teamEnergyNeeds,
  WeaponDetails,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import type { CalcResult, UIData } from '@genshin-optimizer/gi/uidata'
import {
  artDisplayValue,
  getMainStatDisplayStr,
} from '@genshin-optimizer/gi/util'
import BoltIcon from '@mui/icons-material/Bolt'
import CheckIcon from '@mui/icons-material/Check'
import CheckroomIcon from '@mui/icons-material/Checkroom'
import CloseIcon from '@mui/icons-material/Close'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import SaveIcon from '@mui/icons-material/Save'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded'
import UndoIcon from '@mui/icons-material/Undo'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Popover,
  Snackbar,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ReactNode } from 'react'
import {
  Fragment,
  memo,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { FightTimeline } from '../Enemy/FightTimeline'
import {
  changedMembers,
  DEFAULT_BUILD_NAME_FORMAT,
  equipChanges,
  equipTeamResult,
  formatSavedBuildName,
  inferBuildNameFormat,
  restoreTeamBuilds,
  saveTeamResult,
  undoTeamEquip,
} from './apply'
import type { CocoonEvaluations, FightApplications } from './fightTeam'
import { fightTeamOf } from './fightTeam'
import { formatGain, formatRate, formatRateFull } from './format'
import { MemberAvatar } from './MemberAvatar'
import type { ResultDetailsData } from './ResultDetails'
import { MemberDetails, useResultDetails } from './ResultDetails'
import { useSavedBuildNameFormat } from './savedBuildNameFormat'
import { TcBuildGear } from './TcBuildGear'
import { TeamCardButton } from './TeamCardButton'
import {
  focusSx,
  hairline,
  insetSx,
  numSx,
  Panel,
  quickSx,
  selectedSx,
  stepAccentSx,
  tokens,
  type,
} from './ui'
import { useTeamOpt } from './useTeamOpt'

/** Open and close: the design's quick Collapse */
const COLLAPSE_MS = 180

/** What Equip or Save as builds did, in place of its button */
function AppliedStatus({ children }: { children: ReactNode }) {
  return (
    <Typography
      role="status"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0.5,
        minHeight: 36,
        px: 1,
        fontSize: 14,
        fontWeight: 600,
        color: 'success.main',
      }}
    >
      <CheckIcon sx={{ fontSize: 18 }} />
      {children}
    </Typography>
  )
}

/** What Team Optimize found: the rotation's damage before and after, and each member's build */
export function TeamOptResults({
  teamId,
  members,
  result,
  seconds,
  runTeamOpt,
  rotationTime,
  onCompareInvestments,
  onDiscard,
  teamData,
  stale,
  onRunAgain,
  timeline,
  enemy,
  enemyNow,
  applications,
  cocoon,
  selected,
  onSelect,
  inspector,
  picked,
  onResetPicks,
  fresh,
  supplement,
}: {
  teamId: string
  /** Below the inspector: the top builds and how the team's damage splits */
  supplement?: ReactNode
  /** The member whose equipment is compared (`inspector`), and choosing one */
  selected?: CharacterKey
  onSelect?: (characterKey: CharacterKey | undefined) => void
  /** Its equipment inspector, under the members */
  inspector?: ReactNode
  /** `result` is the team with equipment picked in the inspector, and back to the run's */
  picked?: boolean
  onResetPicks?: () => void
  /** The run just finished: its result is revealed (the figure counts up, the cards come in) */
  fresh?: boolean
  /** The written rotation's element applications per second (a Stygian boss's mechanics) */
  applications?: FightApplications
  /** The builds' damage in the Moongecko's Radiant Cocoon and Disentangled (its fight) */
  cocoon?: CocoonEvaluations
  members: TeamOptMember[]
  result: TeamOptResult
  seconds: number
  /** The enemy it was found for (absent: found before this was kept) */
  enemy?: RunEnemy
  /** The team's enemy now, when it is not the same: shown after the run's */
  enemyNow?: RunEnemy
  /** The team's data now: what names the members' requirements */
  teamData: TeamData | undefined
  /** The rotation or the settings changed since the run: the result does not include it */
  stale?: boolean
  onRunAgain?: () => void
  /** The written rotation as these builds play it (its timeline), under the members */
  timeline?: ReactNode
  /** The settings the result was found with (its rotation) */
  runTeamOpt: TeamOpt
  /** How long one rotation takes (seconds): damage is then shown per second */
  rotationTime?: number
  /** Scroll to / focus the interactive Investment comparison panel */
  onCompareInvestments?: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const team = useTeam(teamId)
  const [savedFormat, setSavedFormat] = useSavedBuildNameFormat()
  const [saveAnchor, setSaveAnchor] = useState<HTMLElement | null>(null)
  const [saveName, setSaveName] = useState('')
  const [rememberFormat, setRememberFormat] = useState(false)
  const [editingFormat, setEditingFormat] = useState(false)
  const [formatDraft, setFormatDraft] = useState(savedFormat)
  const saveGroupRef = useRef<HTMLDivElement>(null)
  const saveInputRef = useRef<HTMLInputElement>(null)
  const formatInputRef = useRef<HTMLInputElement>(null)
  const { before, after } = result
  // (once, as it appears: not again when the page re-renders it)
  const [reveal] = useState(() => !!fresh && !prefersReducedMotion())
  // the enemy the builds are for: the team's now while it takes the same damage (its preset and
  // HP too: the builds do not depend on them), else the one they were found for
  const fightEnemy = useMemo(
    () => (enemy && team && sameRunEnemy(enemy, team) ? team : enemy),
    [enemy, team]
  )
  const fight = useMemo(
    () =>
      enemy &&
      fightTeamOf({
        members: members.map((m) => m.characterKey),
        evaluation: after,
        attacks: runTeamOpt.attacks,
        teamData,
        rotationTime,
        enemyOverride: enemy.enemyOverride,
        applications,
        cocoon,
      }),
    [
      enemy,
      members,
      after,
      runTeamOpt.attacks,
      teamData,
      rotationTime,
      applications,
      cocoon,
    ]
  )
  const { gender } = useDBMeta()
  const gain = before.total > 0 ? after.total / before.total - 1 : 0
  // recomputed with the database: an applied result has no changes left
  const changed = useMemo(
    () => changedMembers(database, teamId, result),
    [database, teamId, result, team]
  )
  // the members Equip changes (a member on a saved build too, even with the same gear)
  const toEquip = useMemo(
    () => equipChanges(database, teamId, result),
    [database, teamId, result, team]
  )
  const [confirm, setConfirm] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const discardTitleId = useId()
  const [equipped, setEquipped] = useState(false)
  const saved = team?.savedOptimization
  const usingSaved =
    !!saved &&
    !changed.length &&
    Object.keys(saved).length > 0 &&
    Object.entries(saved).every(([id, choice]) =>
      team?.loadoutData.some(
        (datum) =>
          datum?.teamCharId === id &&
          datum.buildType === 'real' &&
          datum.buildId === choice.savedBuildId
      )
    )
  const applied =
    equipped && team?.equipmentUndo && !toEquip.length
      ? 'equip'
      : usingSaved
        ? 'save'
        : undefined
  // artifacts excluded from this team's optimization (from here or the settings)
  const [liveTeamOpt, setTeamOpt] = useTeamOpt(teamId)
  const optConfigs = useDataManagerEntries(database.optConfigs)
  // Each member's ER requirement for this result's weapons (calculator or manual), plus any
  // reduction from team energy weapons and any change in live settings since the run
  const erMeta = useMemo<Partial<Record<CharacterKey, MemberErMeta>>>(() => {
    const keys = members.map((m) => m.characterKey)
    const configMap = new Map(optConfigs)
    const baseFilters: Partial<Record<CharacterKey, StatFilters>> = {}
    const resultWeapons: Partial<Record<CharacterKey, ICachedWeapon>> = {}
    for (const m of members) {
      baseFilters[m.characterKey] = m.isTc
        ? {}
        : (configMap.get(m.teamChar.optConfigId)?.statFilters ?? {})
      const wid = result.weapons?.[m.characterKey] ?? m.weaponId
      const w = wid ? database.weapons.get(wid) : undefined
      if (w) resultWeapons[m.characterKey] = w
    }
    const needs = teamEnergyNeeds(baseFilters, resultWeapons, runTeamOpt)
    const fromCalc =
      runTeamOpt.energySource === 'calculator' && !!runTeamOpt.energyCalculator
    const withoutEnergy =
      fromCalc && runTeamOpt.energyCalculator
        ? calculateEnergyRecharge(keys, runTeamOpt.energyCalculator, {}, {})
        : undefined
    const calcEnergyWeaponIds = fromCalc
      ? [
          ...new Set(
            Object.values(resultWeapons)
              .filter(
                (w): w is ICachedWeapon =>
                  !!w && (isFavonius(w.key) || isCalcEnergyWeapon(w.key))
              )
              .map((w) => w.id)
          ),
        ]
      : []
    const liveNeeds = stale
      ? teamEnergyNeeds(baseFilters, resultWeapons, liveTeamOpt)
      : undefined
    const out: Partial<Record<CharacterKey, MemberErMeta>> = {}
    for (const m of members) {
      const ck = m.characterKey
      const need = needs[ck]
      const manualEnergy = result.energy?.[ck]
      const calcBase =
        withoutEnergy && !withoutEnergy.errors.length
          ? withoutEnergy.targets[ck]
          : undefined
      const calcReduced =
        fromCalc &&
        need !== undefined &&
        calcBase !== undefined &&
        calcBase - need >= 0.1
      const liveNeed = liveNeeds?.[ck]
      out[ck] = {
        need,
        fromCalc,
        burstUnused:
          fromCalc &&
          runTeamOpt.energyCalculator?.members[ck]?.burstEvery === 0,
        ...(calcReduced
          ? {
              base: calcBase,
              relief: Math.round((calcBase - need) * 10) / 10,
              energyWeaponIds: calcEnergyWeaponIds,
            }
          : manualEnergy && need !== undefined
            ? {
                base: Math.round((need + manualEnergy.relief) * 10) / 10,
                relief: manualEnergy.relief,
                energyWeaponIds: manualEnergy.weaponIds,
              }
            : {}),
        ...(liveNeed !== undefined &&
          (need === undefined || Math.abs(liveNeed - need) >= 0.05) && {
            liveNeed,
          }),
      }
    }
    return out
  }, [
    members,
    database,
    optConfigs,
    result.weapons,
    result.energy,
    runTeamOpt,
    stale,
    liveTeamOpt,
  ])
  const excludedArts = useMemo(
    () => new Set(liveTeamOpt.excludedArts),
    [liveTeamOpt.excludedArts]
  )
  const [lastExcluded, setLastExcluded] = useState<string>()
  const toggleExcluded = (id: string) => {
    const exclude = !excludedArts.has(id)
    setTeamOpt((o) => {
      o.excludedArts = exclude
        ? [...o.excludedArts, id]
        : o.excludedArts.filter((x) => x !== id)
    })
    setLastExcluded(exclude ? id : undefined)
  }
  const noChange = !changed.length
  // every card opens at once (side by side, the members' stats line up)
  const [showDetails, setShowDetails] = useState(false)
  // the toggles answer at once; the cards' stats and damage render after, in the background
  const detailsShown = useDeferredValue(showDetails)
  // the members' changes against their equipped builds: off by default (less to read)
  const [compare, setCompare] = useState(false)
  const details = useResultDetails(
    teamId,
    runTeamOpt,
    result,
    showDetails,
    applied
  )
  // a result below the current builds: says so (even when not comparing), and why
  const belowNow = after.total < before.total * (1 - 1e-4)
  const startUnmet = result.optimized.filter((ck) => !!before.unmet[ck]?.length)
  const discardLabel = t('teamOpt.result.discard', 'Discard')

  return (
    <Panel sx={{ ...stepAccentSx('result'), ...(reveal && sheenSx) }}>
      {/* the headline (the rotation's damage), the actions, and discard in the corner */}
      <Box
        sx={(theme) => ({
          display: 'grid',
          alignItems: 'center',
          columnGap: 2,
          rowGap: 1.5,
          pb: 2,
          borderBottom: hairline,
          gridTemplateColumns: 'minmax(0, 1fr) auto',
          gridTemplateAreas: '"head close" "actions actions"',
          [theme.breakpoints.up('md')]: {
            gridTemplateColumns: 'minmax(0, 1fr) auto auto',
            gridTemplateAreas: '"head actions close"',
          },
        })}
      >
        <Box sx={{ gridArea: 'head', minWidth: 0 }}>
          {/* the figure, then what to know about it as pills on its row (no extra lines: the
              header keeps its height), the whole story in each pill's tooltip */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 1.25,
              rowGap: 0.75,
            }}
          >
            <Typography
              component="p"
              sx={{
                ...numSx,
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 0.875,
                fontSize: { xs: 30, sm: 38 },
                fontWeight: 700,
                letterSpacing: '-0.035em',
                lineHeight: 1,
                fontFeatureSettings: '"tnum", "ss01"',
              }}
            >
              <CountUp
                value={after.total}
                animate={reveal}
                format={(v) => formatRateFull(v, rotationTime)}
              />
              <Box
                component="span"
                sx={{
                  fontSize: 14,
                  fontWeight: 550,
                  letterSpacing: '-0.005em',
                  color: 'text.secondary',
                }}
              >
                {rotationTime
                  ? t('teamOpt.result.dps', 'Team DPS')
                  : t('teamOpt.result.total', 'Rotation damage')}
              </Box>
            </Typography>
            {compare && (
              <HeadPill
                tone={gain > 0.0005 ? 'success' : 'neutral'}
                tip={t('teamOpt.result.from', {
                  defaultValue: 'from {{value}}',
                  value: formatRate(before.total, rotationTime, true),
                })}
              >
                {formatGain(gain)}
              </HeadPill>
            )}
            {stale && (
              <HeadPill
                tone="warning"
                icon={<WarningAmberRoundedIcon />}
                tip={t(
                  'teamOpt.result.stale',
                  'Found with an earlier rotation or settings: what changed since is not in it.'
                )}
                action={
                  onRunAgain && {
                    label: t('teamOpt.result.runAgain', 'Run again'),
                    onClick: onRunAgain,
                  }
                }
              >
                {t('teamOpt.result.staleShort', 'Earlier settings')}
              </HeadPill>
            )}
            {belowNow && (
              <HeadPill
                tone="warning"
                icon={<TrendingDownIcon />}
                tip={
                  <>
                    {t('teamOpt.result.belowNow', {
                      defaultValue: 'Below your current builds ({{value}})',
                      value: formatRate(before.total, rotationTime, true),
                    })}
                    {!!startUnmet.length && (
                      <>
                        {': '}
                        <Names keys={startUnmet} gender={gender} />{' '}
                        {t('teamOpt.result.belowNowUnmet', {
                          count: startUnmet.length,
                          defaultValue:
                            'can’t keep their current build: it misses their requirements (e.g. Min ER)',
                        })}
                      </>
                    )}
                    {!!result.startBreaksSetRules?.length && (
                      <>
                        {startUnmet.length ? '; ' : ': '}
                        <Names
                          keys={result.startBreaksSetRules}
                          gender={gender}
                        />{' '}
                        {t('teamOpt.result.belowNowSets', {
                          count: result.startBreaksSetRules.length,
                          defaultValue:
                            'can’t keep their current build: it breaks their allowed sets (Requirements → Artifact sets)',
                        })}
                      </>
                    )}
                    {!!result.startUntickedWeapons?.length && (
                      <>
                        {startUnmet.length || result.startBreaksSetRules?.length
                          ? '; '
                          : ': '}
                        <Names
                          keys={result.startUntickedWeapons}
                          gender={gender}
                        />{' '}
                        {t('teamOpt.result.belowNowWeapons', {
                          count: result.startUntickedWeapons.length,
                          defaultValue:
                            'can’t keep their current weapon: it isn’t ticked in Weapons to choose from',
                        })}
                      </>
                    )}
                  </>
                }
              >
                {t('teamOpt.result.belowNowShort', {
                  defaultValue: 'Below current · {{value}}',
                  value: formatRate(before.total, rotationTime, true),
                })}
              </HeadPill>
            )}
            {picked && onResetPicks && (
              <HeadPill
                tone="accent"
                tip={t(
                  'teamOpt.inspect.showingPicks',
                  'With the equipment you picked'
                )}
                action={{
                  label: t('teamOpt.inspect.reset', 'Reset'),
                  onClick: onResetPicks,
                }}
              >
                {t('teamOpt.inspect.picksShort', 'Your picks')}
              </HeadPill>
            )}
            {noChange && !applied && (
              <HeadPill
                tone="success"
                icon={<CheckIcon />}
                tip={
                  result.optimized.length
                    ? t(
                        'teamOpt.result.noChange',
                        'The current builds are already the best ones found for this rotation.'
                      )
                    : t(
                        'teamOpt.result.asItIs',
                        'Run as it is: no build was searched.'
                      )
                }
              >
                {result.optimized.length
                  ? t('teamOpt.result.noChangeShort', 'Already the best')
                  : t('teamOpt.result.asItIsShort', 'Run as it is')}
              </HeadPill>
            )}
            <EquipUndoPill teamId={teamId} />
          </Box>
          {/* one quiet line: how it was found, and the enemy it is for */}
          <Typography
            component="div"
            sx={{
              ...type.label,
              ...numSx,
              fontWeight: 400,
              mt: 1,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: 0.75,
            }}
          >
            <span>
              {t('teamOpt.result.meta', {
                defaultValue: 'Found in {{seconds}} s, {{count}} rounds',
                seconds:
                  seconds < 10 ? seconds.toFixed(1) : Math.round(seconds),
                count: result.rounds,
              })}
            </span>
            {enemy && (
              <>
                <Box component="span" aria-hidden sx={{ opacity: 0.5 }}>
                  ·
                </Box>
                <span>{t('teamOpt.result.enemy', 'For')}</span>
                <EnemySummary enemy={enemy} />
                {fightEnemy && (
                  <EnemyDefeatTime enemy={fightEnemy} team={fight} />
                )}
                {enemyNow && (
                  <Box
                    component="span"
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      columnGap: 0.75,
                      color: 'warning.main',
                    }}
                  >
                    {t('teamOpt.result.enemyNow', '→ now')}
                    <EnemySummary enemy={enemyNow} />
                  </Box>
                )}
              </>
            )}
          </Typography>
        </Box>

        <Box
          sx={{
            gridArea: 'actions',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1.5,
            rowGap: 1,
          }}
        >
          <FormControlLabel
            sx={{
              m: 0,
              gap: 0.5,
              pl: 0.75,
              pr: 1.25,
              minHeight: 34,
              borderRadius: tokens.radius.control,
              border: `1px solid ${compare ? tokens.hairlineStrong : tokens.hairline}`,
              bgcolor: compare
                ? alpha(giTokens.parchment, 0.07)
                : alpha(giTokens.parchment, 0.02),
              flexBasis: { xs: '100%', md: 'auto' },
              ...quickSx,
              '&:hover': {
                borderColor: tokens.hairlineStrong,
                bgcolor: alpha(giTokens.parchment, 0.06),
              },
              '& .MuiSwitch-root': { ml: -0.25 },
            }}
            control={
              <Switch
                size="small"
                checked={compare}
                onChange={() => setCompare((c) => !c)}
              />
            }
            label={
              <Typography
                component="span"
                sx={{
                  fontSize: 13,
                  fontWeight: 550,
                  color: compare ? 'text.primary' : 'text.secondary',
                  ...quickSx,
                }}
              >
                {t('teamOpt.result.compare', 'Compare with equipped')}
              </Typography>
            }
          />
          <Box
            aria-hidden
            sx={{
              display: { xs: 'none', md: 'block' },
              width: '1px',
              height: 22,
              bgcolor: tokens.hairlineStrong,
            }}
          />
          {/* on phones: one row, the buttons sharing it (their icons dropped to fit) */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.875,
              flex: { xs: '1 1 100%', md: '0 0 auto' },
              '& > *': { flex: { xs: '1 1 auto', md: '0 0 auto' } },
              '& .MuiButton-root': {
                minHeight: 34,
                fontSize: 13,
                fontWeight: 600,
                borderRadius: tokens.radius.control,
                whiteSpace: 'nowrap',
                px: { xs: 1.25, sm: 1.75 },
              },
              '& .MuiButton-outlinedInherit': {
                borderColor: tokens.hairlineStrong,
                '&:hover': {
                  borderColor: alpha(giTokens.parchment, 0.28),
                  bgcolor: alpha(giTokens.parchment, 0.06),
                },
              },
              // (the tooltip's wrapper takes the room; its button fills it)
              '& > span > .MuiButton-root': { width: '100%' },
              '& .MuiButton-startIcon': {
                display: { xs: 'none', sm: 'inherit' },
              },
            }}
          >
            {onCompareInvestments && (
              <Tooltip
                arrow
                title={t(
                  'teamOpt.invest.jumpTip',
                  'Compare pull budgets across constellations, R1 signatures, and conditional rotations'
                )}
              >
                <Button
                  variant="outlined"
                  color="inherit"
                  startIcon={<TrendingUpRoundedIcon sx={{ fontSize: 17 }} />}
                  onClick={onCompareInvestments}
                  sx={{
                    borderColor: alpha(tokens.gold, 0.4),
                    color: giTokens.goldLight,
                    bgcolor: alpha(tokens.gold, 0.08),
                    '&:hover': {
                      borderColor: alpha(tokens.gold, 0.7),
                      bgcolor: alpha(tokens.gold, 0.16),
                    },
                  }}
                >
                  {t('teamOpt.invest.buttonShort', 'Investments')}
                </Button>
              </Tooltip>
            )}
            <TeamCardButton
              teamId={teamId}
              result={result}
              runTeamOpt={runTeamOpt}
              rotationTime={rotationTime}
            />
            {applied === 'equip' ? (
              <AppliedStatus>
                {t('teamOpt.result.equipped', 'Equipped')}
              </AppliedStatus>
            ) : (
              <>
                {applied === 'save' ? (
                  <>
                    <AppliedStatus>
                      {t('teamOpt.result.usingSaved', 'Using saved builds')}
                    </AppliedStatus>
                    <RestoreTeamBuildsButton teamId={teamId} />
                  </>
                ) : (
                  <Box
                    ref={saveGroupRef}
                    sx={{ display: 'inline-flex', alignItems: 'stretch' }}
                  >
                    <Tooltip
                      arrow
                      describeChild
                      title={t('teamOpt.result.saveAsHint', {
                        defaultValue:
                          'Save as “{{name}}” for each changed member. Nothing moves between characters.',
                        name: formatSavedBuildName(
                          savedFormat,
                          team?.name ?? ''
                        ),
                      })}
                    >
                      <span>
                        <Button
                          variant="outlined"
                          color="inherit"
                          startIcon={<SaveIcon />}
                          disabled={noChange || stale}
                          onClick={() => {
                            saveTeamResult(
                              database,
                              teamId,
                              result,
                              formatSavedBuildName(
                                savedFormat,
                                team?.name ?? ''
                              )
                            )
                          }}
                          sx={{
                            borderTopRightRadius: 0,
                            borderBottomRightRadius: 0,
                            borderColor: tokens.hairlineStrong,
                            '&:hover': {
                              borderColor: alpha(giTokens.parchment, 0.28),
                              bgcolor: alpha(giTokens.parchment, 0.06),
                              zIndex: 1,
                            },
                          }}
                        >
                          {t(
                            'teamOpt.result.saveAndUse',
                            'Save and use on this team'
                          )}
                        </Button>
                      </span>
                    </Tooltip>
                    <Tooltip
                      arrow
                      title={t(
                        'teamOpt.result.customizeSaveName',
                        'Customize build name or default format'
                      )}
                    >
                      <span>
                        <Button
                          variant="outlined"
                          color="inherit"
                          disabled={noChange || stale}
                          aria-label={t(
                            'teamOpt.result.customizeSaveName',
                            'Customize build name or default format'
                          )}
                          aria-haspopup="dialog"
                          aria-expanded={!!saveAnchor}
                          onClick={(e) => {
                            setSaveName(
                              formatSavedBuildName(
                                savedFormat,
                                team?.name ?? ''
                              )
                            )
                            setRememberFormat(false)
                            setEditingFormat(false)
                            setFormatDraft(savedFormat)
                            setSaveAnchor(
                              saveGroupRef.current ?? e.currentTarget
                            )
                          }}
                          sx={{
                            minWidth: 30,
                            height: '100%',
                            px: 0.625,
                            ml: '-1px',
                            borderTopLeftRadius: 0,
                            borderBottomLeftRadius: 0,
                            borderColor: tokens.hairlineStrong,
                            '&:hover': {
                              borderColor: alpha(giTokens.parchment, 0.28),
                              bgcolor: alpha(giTokens.parchment, 0.06),
                              zIndex: 1,
                            },
                          }}
                        >
                          <ExpandMoreIcon
                            sx={{
                              fontSize: 18,
                              transform: saveAnchor ? 'rotate(180deg)' : 'none',
                              transition: 'transform 140ms ease',
                            }}
                          />
                        </Button>
                      </span>
                    </Tooltip>
                  </Box>
                )}
                <Popover
                  open={!!saveAnchor}
                  anchorEl={saveAnchor}
                  onClose={() => setSaveAnchor(null)}
                  anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                  transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                  TransitionProps={{
                    onEntered: () => {
                      const el = saveInputRef.current
                      if (el) {
                        el.focus()
                        const end = el.value.length
                        el.setSelectionRange(end, end)
                      }
                    },
                  }}
                  slotProps={{
                    paper: {
                      sx: {
                        mt: 0.75,
                        p: 2,
                        width: 368,
                        maxWidth: 'calc(100vw - 24px)',
                        borderRadius: tokens.radius.inset,
                        bgcolor: tokens.raised,
                        border: `1px solid ${tokens.hairlineStrong}`,
                        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.55)',
                      },
                    },
                  }}
                >
                  {(() => {
                    const teamName = team?.name?.trim() ?? ''
                    const defaultExpanded = formatSavedBuildName(
                      savedFormat,
                      teamName
                    )
                    const trimmedName = saveName.trim()
                    const nameChanged =
                      !!trimmedName && trimmedName !== defaultExpanded
                    const inferredFormat = inferBuildNameFormat(
                      trimmedName,
                      teamName
                    )
                    const applyFormatDraft = (next: string) => {
                      setFormatDraft(next)
                      setSaveName(formatSavedBuildName(next, teamName))
                    }
                    const commitFormat = () => {
                      const clean =
                        formatDraft.trim() || DEFAULT_BUILD_NAME_FORMAT
                      setSavedFormat(clean)
                      setFormatDraft(clean)
                      setSaveName(formatSavedBuildName(clean, teamName))
                      setRememberFormat(false)
                      setEditingFormat(false)
                    }
                    return (
                      <Box
                        component="form"
                        onSubmit={(e) => {
                          e.preventDefault()
                          if (!trimmedName) return
                          if (editingFormat) {
                            const clean =
                              formatDraft.trim() || DEFAULT_BUILD_NAME_FORMAT
                            setSavedFormat(clean)
                          } else if (rememberFormat && nameChanged) {
                            setSavedFormat(inferredFormat)
                          }
                          saveTeamResult(database, teamId, result, trimmedName)
                          setSaveAnchor(null)
                        }}
                        sx={{ display: 'grid', gap: 1.5 }}
                      >
                        <Box>
                          <Typography sx={{ ...type.title, fontSize: 14.5 }}>
                            {t(
                              'teamOpt.result.saveTitle',
                              'Save builds for team'
                            )}
                          </Typography>
                          <Typography
                            sx={{ ...type.label, mt: 0.375, lineHeight: 1.4 }}
                          >
                            {t('teamOpt.result.saveCountHint', {
                              count: changed.length,
                              defaultValue:
                                'Creates {{count}} new builds used by this team. Equipped gear is untouched.',
                            })}
                          </Typography>
                        </Box>

                        <TextField
                          autoFocus
                          inputRef={saveInputRef}
                          size="small"
                          fullWidth
                          label={t(
                            'teamOpt.result.buildNameLabel',
                            'Build name'
                          )}
                          value={saveName}
                          onChange={(e) => setSaveName(e.target.value)}
                          InputProps={{
                            endAdornment: saveName ? (
                              <InputAdornment position="end">
                                <IconButton
                                  size="small"
                                  aria-label={t(
                                    'teamOpt.result.clearName',
                                    'Clear build name'
                                  )}
                                  onClick={() => {
                                    setSaveName('')
                                    saveInputRef.current?.focus()
                                  }}
                                  sx={{
                                    p: 0.25,
                                    color: 'text.secondary',
                                    '&:hover': { color: 'text.primary' },
                                  }}
                                >
                                  <CloseIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </InputAdornment>
                            ) : undefined,
                          }}
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              bgcolor: tokens.inset,
                              borderRadius: tokens.radius.control,
                              '&.Mui-focused .MuiOutlinedInput-notchedOutline':
                                {
                                  borderColor: alpha(tokens.gold, 0.7),
                                },
                            },
                            '& .MuiInputLabel-root.Mui-focused': {
                              color: giTokens.goldLight,
                            },
                          }}
                        />

                        {nameChanged && !editingFormat && (
                          <FormControlLabel
                            control={
                              <Checkbox
                                size="small"
                                checked={rememberFormat}
                                onChange={(_, checked) =>
                                  setRememberFormat(checked)
                                }
                                sx={{
                                  py: 0.25,
                                  color: 'text.secondary',
                                  '&.Mui-checked': { color: tokens.gold },
                                }}
                              />
                            }
                            label={
                              <Box sx={{ lineHeight: 1.3 }}>
                                <Typography
                                  sx={{
                                    fontSize: 12.5,
                                    color: 'text.primary',
                                  }}
                                >
                                  {t(
                                    'teamOpt.result.rememberFormat',
                                    'Save as default format for future saves'
                                  )}
                                </Typography>
                                <Typography
                                  sx={{
                                    fontSize: 11.5,
                                    color: 'text.secondary',
                                    fontFamily: 'monospace',
                                  }}
                                >
                                  {inferredFormat}
                                </Typography>
                              </Box>
                            }
                            sx={{
                              m: 0,
                              alignItems: 'flex-start',
                            }}
                          />
                        )}

                        <Divider sx={{ borderColor: tokens.hairline }} />

                        {editingFormat ? (
                          <Box sx={{ display: 'grid', gap: 1 }}>
                            <TextField
                              inputRef={formatInputRef}
                              size="small"
                              fullWidth
                              label={t(
                                'teamOpt.result.defaultFormatLabel',
                                'Default name format'
                              )}
                              placeholder={DEFAULT_BUILD_NAME_FORMAT}
                              value={formatDraft}
                              onChange={(e) => applyFormatDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  commitFormat()
                                }
                              }}
                              helperText={t(
                                'teamOpt.result.defaultFormatHelp',
                                'Use {team} to insert the current team’s name.'
                              )}
                              FormHelperTextProps={{
                                sx: { mx: 0, mt: 0.5, fontSize: 11.5 },
                              }}
                              sx={{
                                '& .MuiOutlinedInput-root': {
                                  bgcolor: tokens.inset,
                                  borderRadius: tokens.radius.control,
                                  fontFamily: 'monospace',
                                  fontSize: 12.5,
                                  '&.Mui-focused .MuiOutlinedInput-notchedOutline':
                                    {
                                      borderColor: alpha(tokens.gold, 0.7),
                                    },
                                },
                                '& .MuiInputLabel-root.Mui-focused': {
                                  color: giTokens.goldLight,
                                },
                              }}
                            />
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.75,
                                flexWrap: 'wrap',
                              }}
                            >
                              <ButtonBase
                                onClick={() => {
                                  const next = formatDraft.includes('{team}')
                                    ? formatDraft
                                    : formatDraft
                                      ? `{team} ${formatDraft}`
                                      : '{team}'
                                  applyFormatDraft(next)
                                  formatInputRef.current?.focus()
                                }}
                                sx={{
                                  px: 0.875,
                                  py: 0.25,
                                  borderRadius: 999,
                                  fontSize: 11.5,
                                  fontFamily: 'monospace',
                                  fontWeight: 600,
                                  color: giTokens.goldLight,
                                  bgcolor: alpha(tokens.gold, 0.12),
                                  border: `1px solid ${alpha(tokens.gold, 0.3)}`,
                                  ...quickSx,
                                  '&:hover': {
                                    bgcolor: alpha(tokens.gold, 0.2),
                                  },
                                }}
                              >
                                + {'{team}'}
                              </ButtonBase>
                              {formatDraft.trim() !==
                                DEFAULT_BUILD_NAME_FORMAT && (
                                <Button
                                  size="small"
                                  color="inherit"
                                  onClick={() =>
                                    applyFormatDraft(DEFAULT_BUILD_NAME_FORMAT)
                                  }
                                  sx={{
                                    textTransform: 'none',
                                    fontSize: 12,
                                    minWidth: 0,
                                    px: 0.75,
                                    color: 'text.secondary',
                                  }}
                                >
                                  {t('teamOpt.result.resetFormat', 'Reset')}
                                </Button>
                              )}
                              <Box sx={{ flex: 1 }} />
                              <Button
                                size="small"
                                color="inherit"
                                onClick={commitFormat}
                                sx={{
                                  textTransform: 'none',
                                  fontSize: 12,
                                  minWidth: 0,
                                  px: 1,
                                  color: giTokens.goldLight,
                                }}
                              >
                                {t('teamOpt.invest.done', 'Done')}
                              </Button>
                            </Box>
                          </Box>
                        ) : (
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 1,
                            }}
                          >
                            <Typography
                              noWrap
                              title={savedFormat}
                              sx={{
                                fontSize: 12,
                                color: 'text.secondary',
                                minWidth: 0,
                              }}
                            >
                              {t('teamOpt.result.formatPrefix', 'Format:')}{' '}
                              <Box
                                component="span"
                                sx={{
                                  fontFamily: 'monospace',
                                  color: 'text.primary',
                                }}
                              >
                                {savedFormat}
                              </Box>
                            </Typography>
                            <Button
                              size="small"
                              color="inherit"
                              onClick={() => {
                                setFormatDraft(savedFormat)
                                setEditingFormat(true)
                                requestAnimationFrame(() =>
                                  formatInputRef.current?.focus()
                                )
                              }}
                              sx={{
                                textTransform: 'none',
                                fontSize: 12,
                                minWidth: 0,
                                px: 0.75,
                                py: 0.125,
                                flexShrink: 0,
                                color: giTokens.goldLight,
                              }}
                            >
                              {t('teamOpt.result.editFormat', 'Edit format')}
                            </Button>
                          </Box>
                        )}

                        <Box
                          sx={{
                            display: 'flex',
                            justifyContent: 'flex-end',
                            gap: 1,
                          }}
                        >
                          <Button
                            size="small"
                            color="inherit"
                            onClick={() => setSaveAnchor(null)}
                            sx={{
                              textTransform: 'none',
                              color: 'text.secondary',
                            }}
                          >
                            {t('teamOpt.runDialog.cancel', 'Cancel')}
                          </Button>
                          <Button
                            type="submit"
                            size="small"
                            variant="contained"
                            disabled={!trimmedName}
                            startIcon={<SaveIcon sx={{ fontSize: 16 }} />}
                            sx={{
                              ...giCtaSx,
                              px: 1.75,
                              textTransform: 'none',
                              borderRadius: tokens.radius.control,
                            }}
                          >
                            {t('teamOpt.result.saveConfirm', 'Save')}
                          </Button>
                        </Box>
                      </Box>
                    )
                  })()}
                </Popover>
                <Button
                  variant="contained"
                  color="secondary"
                  startIcon={<CheckroomIcon />}
                  disabled={!toEquip.length || stale}
                  aria-expanded={confirm}
                  onClick={() => setConfirm((c) => !c)}
                >
                  {t('teamOpt.result.equip', 'Equip')}
                </Button>
              </>
            )}
          </Box>
        </Box>

        <Tooltip arrow title={discardLabel}>
          <IconButton
            onClick={() => setConfirmDiscard(true)}
            aria-label={discardLabel}
            sx={{
              gridArea: 'close',
              alignSelf: { xs: 'start', md: 'center' },
              justifySelf: 'end',
              width: 34,
              height: 34,
              borderRadius: tokens.radius.control,
              color: 'text.secondary',
              ...quickSx,
              '&:hover': {
                color: 'text.primary',
                bgcolor: alpha(giTokens.parchment, 0.07),
              },
            }}
          >
            <CloseIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Dialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        aria-labelledby={discardTitleId}
      >
        <DialogTitle id={discardTitleId}>
          {t('teamOpt.result.discardTitle', 'Discard this result?')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t(
              'teamOpt.result.discardInfo',
              'Run gear optimization again to calculate a result. Any builds you saved or equipped are kept.'
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button autoFocus onClick={() => setConfirmDiscard(false)}>
            {t('teamOpt.runDialog.cancel', 'Cancel')}
          </Button>
          <Button
            color="error"
            onClick={() => {
              setConfirmDiscard(false)
              onDiscard()
            }}
          >
            {discardLabel}
          </Button>
        </DialogActions>
      </Dialog>

      <Collapse
        in={confirm && applied !== 'equip' && !stale}
        timeout={COLLAPSE_MS}
        unmountOnExit
      >
        <Notice
          icon={<CheckroomIcon />}
          actions={
            <>
              <Button
                size="small"
                variant="text"
                color="inherit"
                onClick={() => setConfirm(false)}
              >
                {t('teamOpt.result.cancel', 'Cancel')}
              </Button>
              <Button
                size="small"
                variant="contained"
                color="secondary"
                onClick={() => {
                  equipTeamResult(database, teamId, result)
                  setConfirm(false)
                  setEquipped(true)
                }}
              >
                {t('teamOpt.result.equipConfirm', 'Equip')}
              </Button>
            </>
          }
        >
          {t('teamOpt.result.equipWarnMove', {
            defaultValue:
              'Equips the new builds on {{count}} members. Artifacts and weapons move from whoever has them now, and a member on a saved build switches to its equipped build.',
            count: toEquip.length,
          })}{' '}
          <Names
            keys={toEquip.map((member) => member.characterKey)}
            gender={gender}
          />
        </Notice>
      </Collapse>
      {/* each member: its build and its own damage */}
      <Box sx={{ containerType: 'inline-size', mt: 2 }}>
        <Box
          sx={{
            display: 'grid',
            gap: 1.5,
            gridTemplateColumns: 'minmax(0, 1fr)',
            '@container (min-width: 520px)': {
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            },
            '@container (min-width: 1040px)': {
              gridTemplateColumns: `repeat(${detailsShown ? 2 : 4}, minmax(0, 1fr))`,
            },
            // expanded: four in a row only where each artifact's stats stay readable
            ...(detailsShown && {
              '@container (min-width: 1600px)': {
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              },
            }),
          }}
        >
          {members.map((member, i) => (
            <MemberResult
              key={member.characterKey}
              revealDelay={reveal ? 140 + i * 80 : undefined}
              member={member}
              result={result}
              teamData={teamData}
              rotationTime={rotationTime}
              runTeamOpt={runTeamOpt}
              showDetails={detailsShown}
              detailsToggled={showDetails}
              onToggleDetails={() => setShowDetails((v) => !v)}
              details={details}
              erMeta={erMeta[member.characterKey]}
              compare={compare}
              excludedArts={excludedArts}
              onToggleExcluded={toggleExcluded}
              selected={selected === member.characterKey}
              onSelect={
                onSelect && result.optimized.includes(member.characterKey)
                  ? () => onSelect(member.characterKey)
                  : undefined
              }
            />
          ))}
        </Box>
        {/* the rotation as these builds play it, then the enemy's HP over the fight (a Stygian
            boss: its states too), as KQM theorycrafting's results show them */}
        {/* (the member picked above: its equipment, as the KQM tab's inspector, below the tiles) */}
        {inspector && <Box sx={{ mt: 2 }}>{inspector}</Box>}
        {supplement}
        {timeline}
        {fightEnemy && <FightTimeline enemy={fightEnemy} team={fight} />}
      </Box>
      <Snackbar
        open={!!lastExcluded}
        autoHideDuration={8000}
        sx={{ bottom: { xs: aboveBottomBar(8), sm: aboveBottomBar(24) } }}
        onClose={(_, reason) =>
          reason !== 'clickaway' && setLastExcluded(undefined)
        }
      >
        {/* a toast floats: raised, with a shadow */}
        <Box
          role="status"
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1.25,
            rowGap: 0.5,
            maxWidth: 560,
            minHeight: 44,
            pl: 1.5,
            pr: 1,
            py: 0.75,
            borderRadius: 2.5,
            bgcolor: tokens.raised,
            border: `1px solid ${tokens.hairlineStrong}`,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
            fontSize: 13.5,
          }}
        >
          <ExcludeIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Box component="span" sx={{ flex: '1 1 220px', minWidth: 0 }}>
            {t(
              'teamOpt.result.excludedToast',
              'Excluded from this team. Run again to find builds without it.'
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.75, ml: 'auto' }}>
            <Button
              size="small"
              variant="text"
              color="inherit"
              onClick={() => lastExcluded && toggleExcluded(lastExcluded)}
            >
              {t('teamOpt.result.undo', 'Undo')}
            </Button>
            {onRunAgain && (
              <Button
                size="small"
                variant="contained"
                color="secondary"
                onClick={() => {
                  setLastExcluded(undefined)
                  onRunAgain()
                }}
              >
                {t('teamOpt.result.runAgain', 'Run again')}
              </Button>
            )}
          </Box>
        </Box>
      </Snackbar>
    </Panel>
  )
}

/**
 * A short fact about the result on the figure's row (a warning, the picks, a change): small, its
 * whole text in the tooltip, an action at its end when it has one
 */
function HeadPill({
  tone,
  icon,
  tip,
  action,
  children,
}: {
  tone: 'warning' | 'success' | 'accent' | 'neutral'
  icon?: ReactNode
  tip?: ReactNode
  action?: { label: ReactNode; onClick: () => void } | false
  children: ReactNode
}) {
  const pill = (
    <Box
      component="span"
      sx={(theme) => {
        const color =
          tone === 'warning'
            ? theme.palette.warning.main
            : tone === 'success'
              ? theme.palette.success.main
              : tone === 'accent'
                ? theme.palette.primary.main
                : theme.palette.text.secondary
        return {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          height: 24,
          pl: icon ? 0.75 : 1,
          pr: action ? 0.25 : 1,
          borderRadius: tokens.radius.pill,
          fontSize: 12.5,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          color,
          bgcolor: alpha(color, 0.1),
          boxShadow: `inset 0 0 0 1px ${alpha(color, 0.3)}`,
          cursor: tip ? 'help' : undefined,
          '& > svg': { fontSize: 14 },
          ...numSx,
        }
      }}
    >
      {icon}
      {children}
      {action && (
        <ButtonBase
          onClick={action.onClick}
          sx={{
            ml: 0.25,
            px: 0.75,
            height: 20,
            borderRadius: tokens.radius.pill,
            fontSize: 12,
            fontWeight: 650,
            color: 'text.primary',
            bgcolor: 'action.hover',
            ...quickSx,
            ...focusSx,
            '&:hover': { bgcolor: 'action.selected' },
          }}
        >
          {action.label}
        </ButtonBase>
      )}
    </Box>
  )
  return tip ? (
    <Tooltip arrow title={tip}>
      {pill}
    </Tooltip>
  ) : (
    pill
  )
}

/** Undo the last Equip on this team, as a pill on the figure's row */
function EquipUndoPill({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const undo = useTeam(teamId)?.equipmentUndo
  const [failed, setFailed] = useState(false)
  if (!undo) return null
  return (
    <HeadPill
      tone={failed ? 'warning' : 'neutral'}
      icon={<UndoIcon />}
      tip={
        failed
          ? t(
              'teamOpt.result.undoEquipConflict',
              'Gear or saved builds changed since equipping. Review the affected equipment before restoring it.'
            )
          : t(
              'teamOpt.result.undoEquipHelp',
              'Restore the equipment and saved builds from before the last Equip action on this team.'
            )
      }
      action={{
        label: t('teamOpt.result.undoEquip', 'Undo equip'),
        onClick: () => setFailed(!undoTeamEquip(database, teamId)),
      }}
    >
      {t('teamOpt.result.equippedShort', 'Equipped')}
    </HeadPill>
  )
}

export function TeamEquipUndo({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const undo = useTeam(teamId)?.equipmentUndo
  const [failed, setFailed] = useState(false)
  if (!undo) return null
  return (
    <Notice
      icon={<CheckroomIcon />}
      actions={
        <Button onClick={() => setFailed(!undoTeamEquip(database, teamId))}>
          {t('teamOpt.result.undoEquip', 'Undo equip')}
        </Button>
      }
    >
      {failed
        ? t(
            'teamOpt.result.undoEquipConflict',
            'Gear or saved builds changed since equipping. Review the affected equipment before restoring it.'
          )
        : t(
            'teamOpt.result.undoEquipHelp',
            'Restore the equipment and saved builds from before the last Equip action on this team.'
          )}
    </Notice>
  )
}

export function RestoreTeamBuildsButton({ teamId }: { teamId: string }) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const saved = useTeam(teamId)?.savedOptimization
  const [failed, setFailed] = useState(false)
  if (!saved) return null
  return (
    <>
      <Button
        size="small"
        color="inherit"
        onClick={() => setFailed(!restoreTeamBuilds(database, teamId))}
      >
        {t('teamOpt.result.restoreBuilds', 'Restore previous builds')}
      </Button>
      {failed && (
        <Typography role="alert" color="warning.main" sx={type.label}>
          {t(
            'teamOpt.result.restoreBuildsConflict',
            'The team selection or previous builds changed after saving. Review the affected builds to restore them.'
          )}
        </Typography>
      )}
    </>
  )
}

/** Characters' names, bold, separated by commas */
function Names({
  keys,
  gender,
}: {
  keys: readonly CharacterKey[]
  gender: 'F' | 'M'
}) {
  return (
    <>
      {keys.map((ck, i) => (
        <Fragment key={ck}>
          {i > 0 && ', '}
          <strong>
            <CharacterName characterKey={ck} gender={gender} />
          </strong>
        </Fragment>
      ))}
    </>
  )
}

/**
 * A line to read before using the result: an icon, the words, and its actions on the right.
 * Warning: something to fix or know (amber); otherwise a neutral raised strip (a confirmation).
 */
function Notice({
  tone = 'neutral',
  icon,
  actions,
  children,
}: {
  tone?: 'warning' | 'neutral'
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    // (the top space is inside: a Collapse opens it with the line, without a jump)
    <Box sx={{ pt: 1.25 }}>
      <Box
        role={tone === 'warning' ? 'alert' : undefined}
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          columnGap: 1.5,
          rowGap: 0.75,
          minHeight: 40,
          px: 1.5,
          py: 0.875,
          borderRadius: tokens.radius.inset,
          fontSize: 13.5,
          lineHeight: 1.45,
          ...(tone === 'warning'
            ? {
                bgcolor: alpha(theme.palette.warning.main, 0.07),
                border: `1px solid ${alpha(theme.palette.warning.main, 0.28)}`,
              }
            : {
                bgcolor: tokens.raised,
                border: `1px solid ${tokens.hairlineStrong}`,
              }),
        })}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 1,
            flex: '1 1 280px',
            minWidth: 0,
            '& > svg': {
              fontSize: 18,
              mt: '1px',
              flexShrink: 0,
              color: tone === 'warning' ? 'warning.main' : 'text.secondary',
            },
          }}
        >
          {icon ?? <WarningAmberRoundedIcon />}
          <Box component="span" sx={{ minWidth: 0 }}>
            {children}
          </Box>
        </Box>
        {actions && (
          <Box sx={{ display: 'flex', gap: 0.75, ml: 'auto' }}>{actions}</Box>
        )}
      </Box>
    </Box>
  )
}

/**
 * The requirements a member's build does not meet, each with its stat, what the build reaches and
 * what it needs. Why, on hover: no build of the member gets there with its settings (this is the
 * closest one), or it was kept as it is.
 */
export function Shortfalls({
  shortfalls,
  data,
  optimized,
  why,
}: {
  shortfalls: TeamOptShortfall[]
  /** The member's data: what names its requirements */
  data: UIData | undefined
  optimized: boolean
  /** Why no build reaches them (default: Team Optimize's reasons) */
  why?: string
}) {
  const { t } = useTranslation('page_team')
  return (
    <Tooltip
      arrow
      placement="top"
      title={
        why ??
        (optimized
          ? t(
              'teamOpt.result.unmetWhy',
              'No build reaches it with this member’s settings: its main stats, the sets it may use, the artifact levels and the weapons ticked. This build gets the closest. Lower the requirement, or allow more.'
            )
          : t(
              'teamOpt.result.unmetKept',
              'Kept as it is: its build does not reach it.'
            ))
      }
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 0.75,
          alignSelf: 'flex-start',
          maxWidth: '100%',
          cursor: 'help',
          color: 'warning.main',
        }}
      >
        <WarningAmberRoundedIcon
          sx={{ fontSize: 16, mt: '1px', flexShrink: 0 }}
        />
        <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          {shortfalls.map(({ path, value, min }) => {
            const node =
              data &&
              (objPathValue(data.getDisplay(), path) as CalcResult | undefined)
            const info = node?.info && resolveInfo(node.info)
            const percent = info?.unit === '%'
            // (the user's own figures: 130%, not 130.0000001%)
            const format = (x: number) =>
              percent
                ? `${+(x * 100).toFixed(1)}%`
                : `${+x.toFixed(Math.abs(x) >= 100 ? 0 : 1)}`
            return (
              <Typography
                key={path.join('.')}
                sx={{ ...numSx, fontSize: 12.5, lineHeight: 1.5 }}
              >
                {info?.name ?? path.at(-1)}{' '}
                {t('teamOpt.result.reachesNeeds', {
                  defaultValue: '{{value}}, needs {{min}}',
                  value: format(value),
                  min: format(min),
                })}
              </Typography>
            )
          })}
        </Box>
      </Box>
    </Tooltip>
  )
}

/** A member's colour: its element's, from the theme */
export const elementColor = (theme: Theme, characterKey: CharacterKey) =>
  (theme.palette as unknown as Record<string, { main?: string } | undefined>)[
    getCharEle(characterKey)
  ]?.main ?? theme.palette.text.secondary

/** A member's ER requirement for a result (and any energy-weapon relief or live-setting change) */
interface MemberErMeta {
  /** Effective ER requirement (%) with the result's weapons (undefined: none set) */
  need?: number
  /** ER requirement (%) before team energy weapons lowered it */
  base?: number
  /** Percent points lowered by team energy weapons */
  relief?: number
  /** Whether `need` comes from the ER calculator vs manual Min ER */
  fromCalc: boolean
  /** Calculator mode: Burst set to Unused */
  burstUnused?: boolean
  /** Team energy weapons that lowered the requirement */
  energyWeaponIds?: string[]
  /** Current ER requirement (%) from live settings, when different from this result's */
  liveNeed?: number
}

/** Format an ER percentage cleanly: whole when integer, else 1 decimal */
const formatErPct = (value: number) =>
  Math.abs(value - Math.round(value)) < 0.05
    ? `${Math.round(value)}%`
    : `${+value.toFixed(1)}%`

/** Compact pill showing a member's ER requirement (and warning when the build falls short) */
function MemberErPill({
  meta,
  shortfall,
  actualEr,
}: {
  meta: MemberErMeta | undefined
  shortfall?: TeamOptShortfall
  /** Reached ER (%) when Final stats have loaded */
  actualEr?: number
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const need = shortfall ? shortfall.min * 100 : meta?.need
  const isShort = !!shortfall
  const reliefWeapons = (meta?.energyWeaponIds ?? [])
    .map((id) => database.weapons.get(id))
    .filter((w): w is ICachedWeapon => !!w)

  const tip = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.375 }}>
      <Box component="span" sx={{ fontWeight: 600 }}>
        {isShort
          ? t('teamOpt.result.erShortTip', {
              defaultValue: 'ER {{value}} / {{min}} required (not met)',
              value: formatErPct(shortfall.value * 100),
              min: formatErPct(shortfall.min * 100),
            })
          : need !== undefined
            ? t('teamOpt.result.erReqTip', {
                defaultValue: 'ER requirement: {{value}}',
                value: formatErPct(need),
              })
            : t('teamOpt.result.erNoneTip', 'No Energy Recharge requirement')}
      </Box>
      {actualEr !== undefined && !isShort && (
        <Box component="span" sx={{ opacity: 0.85 }}>
          {t('teamOpt.result.erReachedTip', {
            defaultValue: 'Build reaches {{value}}',
            value: formatErPct(actualEr),
          })}
        </Box>
      )}
      {meta?.burstUnused && (
        <Box component="span" sx={{ opacity: 0.8 }}>
          {t('teamOpt.result.erBurstUnused', 'Burst unused in ER calculator')}
        </Box>
      )}
      {meta?.relief !== undefined &&
        meta.relief > 0 &&
        meta.base !== undefined && (
          <Box component="span" sx={{ opacity: 0.85 }}>
            {t('teamOpt.result.erReducedTip', {
              defaultValue: 'Lowered −{{relief}}% from {{base}}',
              relief: +meta.relief.toFixed(1),
              base: formatErPct(meta.base),
            })}
            {reliefWeapons.length > 0 && (
              <>
                {' ('}
                {reliefWeapons.map((w, i) => (
                  <Fragment key={w.id}>
                    {i > 0 && ', '}
                    <WeaponName weaponKey={w.key} />
                  </Fragment>
                ))}
                {')'}
              </>
            )}
          </Box>
        )}
      {meta?.liveNeed !== undefined && (
        <Box component="span" sx={{ color: 'warning.main' }}>
          {t('teamOpt.result.erNowTip', {
            defaultValue: 'Current setting: {{value}}',
            value: formatErPct(meta.liveNeed),
          })}
        </Box>
      )}
    </Box>
  )

  const active = need !== undefined && need > 100
  const label = isShort
    ? `${formatErPct(shortfall.value * 100)} / ${formatErPct(shortfall.min * 100)}`
    : need !== undefined
      ? t('teamOpt.result.erPill', {
          defaultValue: 'ER {{value}}',
          value: formatErPct(need),
        })
      : t('teamOpt.result.erNoneShort', 'No ER')

  return (
    <Tooltip arrow title={tip}>
      <Box
        component="span"
        aria-label={
          need !== undefined
            ? t('teamOpt.result.erReqTip', {
                defaultValue: 'ER requirement: {{value}}',
                value: formatErPct(need),
              })
            : t('teamOpt.result.erNoneTip', 'No Energy Recharge requirement')
        }
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.375,
          height: 20,
          px: 0.75,
          borderRadius: tokens.radius.pill,
          flexShrink: 0,
          fontSize: 11.5,
          fontWeight: 600,
          lineHeight: 1,
          cursor: 'help',
          ...numSx,
          '& svg': { fontSize: 12, flexShrink: 0 },
          ...(isShort
            ? {
                color: 'warning.main',
                bgcolor: alpha(theme.palette.warning.main, 0.14),
                boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.warning.main, 0.45)}`,
              }
            : active
              ? {
                  color: 'text.primary',
                  bgcolor: alpha(giTokens.parchment, 0.085),
                  boxShadow: `inset 0 0 0 1px ${tokens.hairlineStrong}`,
                }
              : {
                  color: 'text.secondary',
                  bgcolor: alpha(giTokens.parchment, 0.05),
                }),
        })}
      >
        <StatIcon statKey="enerRech_" />
        {label}
      </Box>
    </Tooltip>
  )
}

/** A small pill next to a member's name (constellation, "Kept", "TC") */
const tagSx: SxProps<Theme> = {
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  height: 20,
  px: 0.75,
  borderRadius: tokens.radius.pill,
  fontSize: 11.5,
  fontWeight: 650,
  lineHeight: 1,
  color: 'text.secondary',
  bgcolor: alpha(giTokens.parchment, 0.065),
  ...numSx,
}

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** A member's card coming in: a fade and a short rise, after its turn (`animationDelay`) */
const cardInSx = {
  '@keyframes teamOptCardIn': {
    from: { opacity: 0, transform: 'translateY(14px) scale(.98)' },
    to: { opacity: 1, transform: 'none' },
  },
  animation: 'teamOptCardIn .55s cubic-bezier(.2,.7,.2,1) both',
} as const

/** A light that sweeps the result's panel once as it appears */
const sheenSx = {
  position: 'relative',
  '&::after': {
    content: '""',
    position: 'absolute',
    inset: 0,
    borderRadius: 'inherit',
    pointerEvents: 'none',
    background:
      'linear-gradient(105deg, transparent 35%, rgba(255, 236, 190, .09) 50%, transparent 65%)',
    backgroundSize: '260% 100%',
    animation: 'teamOptSheen 1.2s cubic-bezier(.3,.6,.3,1) .1s both',
  },
  '@keyframes teamOptSheen': {
    from: { backgroundPosition: '130% 0', opacity: 1 },
    to: { backgroundPosition: '-30% 0', opacity: 0 },
  },
} as const

/** `value` counting up from 0 when `animate` (once, as it first shows), else as it is */
function CountUp({
  value,
  animate,
  format,
}: {
  value: number
  animate: boolean
  format: (value: number) => string
}) {
  const [shown, setShown] = useState(animate ? 0 : value)
  const counted = useRef(!animate)
  useEffect(() => {
    if (counted.current) return setShown(value)
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const k = clamp((now - start) / COUNT_UP_MS, 0, 1)
      setShown(value * (1 - (1 - k) ** 3))
      if (k < 1) frame = requestAnimationFrame(step)
      else counted.current = true
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value])
  return format(shown)
}
const COUNT_UP_MS = 900

function MemberResult({
  member,
  revealDelay,
  result,
  teamData,
  rotationTime,
  runTeamOpt,
  showDetails,
  detailsToggled,
  onToggleDetails,
  details,
  erMeta,
  compare,
  excludedArts,
  onToggleExcluded,
  selected,
  onSelect,
}: {
  member: TeamOptMember
  /** It comes in after this long (ms), as a fresh result is revealed */
  revealDelay?: number
  result: TeamOptResult
  teamData: TeamData | undefined
  rotationTime?: number
  runTeamOpt: TeamOpt
  /** Its final stats and each attack's damage are shown */
  showDetails: boolean
  /** ...or are about to be (its toggle's state, at once) */
  detailsToggled: boolean
  onToggleDetails: () => void
  details: ResultDetailsData | undefined
  /** ER requirement metadata for this member in this result */
  erMeta: MemberErMeta | undefined
  /** Its changes against its equipped build are shown */
  compare: boolean
  /** Artifacts excluded from the team's optimization, and the toggle */
  excludedArts: ReadonlySet<string>
  onToggleExcluded: (id: string) => void
  /** Its equipment is compared below (the inspector), and choosing it */
  selected?: boolean
  onSelect?: () => void
}) {
  const {
    characterKey,
    artifactIds,
    weaponId: currentWeaponId,
    isTc,
    loadoutDatum,
  } = member
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const constellation = isTc
    ? database.buildTcs.get(loadoutDatum.buildTcId)?.character?.constellation
    : database.chars.get(characterKey)?.constellation
  const build = result.builds[characterKey]
  const tcBuild = isTc
    ? database.buildTcs.get(loadoutDatum.buildTcId)
    : undefined
  const optimized = result.optimized.includes(characterKey)
  const before = result.before.members[characterKey] ?? 0
  const after = result.after.members[characterKey] ?? 0
  const sets = useMemo(() => {
    const count: Partial<Record<ArtifactSetKey, number>> = {}
    for (const id of Object.values(build ?? {})) {
      const setKey = id ? database.arts.get(id)?.setKey : undefined
      if (setKey) count[setKey] = (count[setKey] ?? 0) + 1
    }
    return Object.entries(count)
      .filter(([, n]) => n >= 2)
      .sort(([, a], [, b]) => b - a) as [ArtifactSetKey, number][]
  }, [build, database])
  // no build of its artifacts keeps to its set rules: it kept the one it had
  const unmet = result.after.unmet[characterKey]
  const shortfalls = result.after.shortfalls?.[characterKey]
  const erShortfall = shortfalls?.find(
    (s) => s.path[0] === 'basic' && s.path[1] === 'enerRech_'
  )
  const actualErNode = details?.after[characterKey]?.find(
    ([k]) => k === 'enerRech_'
  )?.[1]
  const actualEr =
    actualErNode !== undefined ? actualErNode.value * 100 : undefined
  const weaponId = result.weapons?.[characterKey]
  const weapon = weaponId ? database.weapons.get(weaponId) : undefined
  const newWeapon =
    compare && optimized && !!weaponId && weaponId !== currentWeaponId
  // none of the ticked weapons was free for it: it kept one that is not ticked
  const unticked = !!result.untickedWeapons?.includes(characterKey)
  /** What the team's energy weapons lowered its Energy Recharge requirement by */
  const energy = result.energy?.[characterKey]
  /** Its part of the team's damage */
  const share = result.after.total > 0 ? after / result.after.total : 0
  const ownChange = before > 0 ? after / before - 1 : 0
  const sharePct = share * 100
  const shareDisplay =
    sharePct >= 10 || sharePct === 0
      ? `${Math.round(sharePct)}%`
      : `${sharePct < 0.1 ? '<0.1' : sharePct.toFixed(1)}%`

  return (
    <Box
      sx={(theme) => ({
        ...insetSx,
        borderRadius: 2.5,
        p: 1.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        minWidth: 0,
        border: `1px solid ${selected ? 'transparent' : tokens.hairline}`,
        ...quickSx,
        ...(selected
          ? selectedSx(theme)
          : onSelect && {
              '&:hover': {
                borderColor: tokens.hairlineStrong,
              },
            }),
        ...(revealDelay !== undefined && {
          ...cardInSx,
          animationDelay: `${revealDelay}ms`,
        }),
      })}
    >
      {/* Identity + KPI header; clicking picks the member for the equipment inspector below */}
      <Box
        {...(onSelect && {
          component: ButtonBase,
          role: 'tab',
          'aria-selected': !!selected,
          onClick: onSelect,
        })}
        sx={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          borderRadius: tokens.radius.control,
          ...(onSelect && {
            m: -0.75,
            p: 0.75,
            width: 'calc(100% + 12px)',
            ...quickSx,
            ...focusSx,
            '&:hover': { bgcolor: alpha(giTokens.parchment, 0.04) },
          }),
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Box
            sx={(theme) => ({
              flexShrink: 0,
              borderRadius: '50%',
              p: '2px',
              boxShadow: `inset 0 0 0 1.5px ${alpha(elementColor(theme, characterKey), 0.4)}`,
            })}
          >
            <MemberAvatar characterKey={characterKey} size={36} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              sx={{
                fontSize: 14.5,
                fontWeight: 650,
                letterSpacing: '-0.01em',
                lineHeight: 1.25,
                minWidth: 0,
              }}
              noWrap
            >
              <CharacterName characterKey={characterKey} gender={gender} />
            </Typography>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 0.5,
                mt: 0.5,
                minWidth: 0,
              }}
            >
              {constellation !== undefined && (
                <Tooltip
                  arrow
                  title={t('teamOpt.result.constellation', {
                    defaultValue: 'Constellation {{value}}',
                    value: constellation,
                  })}
                >
                  <Box
                    component="span"
                    sx={{
                      ...tagSx,
                      ...(constellation > 0 && {
                        color: 'text.primary',
                        bgcolor: alpha(giTokens.parchment, 0.12),
                        boxShadow: `inset 0 0 0 1px ${tokens.hairlineStrong}`,
                      }),
                    }}
                  >
                    C{constellation}
                  </Box>
                </Tooltip>
              )}
              <MemberErPill
                meta={erMeta}
                shortfall={erShortfall}
                actualEr={actualEr}
              />
              {!optimized && (
                <Tooltip
                  arrow
                  title={
                    isTc
                      ? t(
                          'teamOpt.result.tcTip',
                          'A theorycraft build: run as it is'
                        )
                      : ''
                  }
                >
                  <Box component="span" sx={tagSx}>
                    {isTc
                      ? t('teamOpt.result.tcShort', 'TC')
                      : t('teamOpt.result.kept', 'Kept')}
                  </Box>
                </Tooltip>
              )}
            </Box>
          </Box>
        </Box>

        {/* Prominent DPS figure & team share aligned cleanly over the element bar */}
        <Box sx={{ mt: 1.25 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              columnGap: 1,
              rowGap: 0.25,
            }}
          >
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 0.625,
                minWidth: 0,
                ...numSx,
              }}
            >
              <Typography
                component="span"
                sx={{
                  ...numSx,
                  fontSize: 19,
                  fontWeight: 700,
                  letterSpacing: '-0.025em',
                  lineHeight: 1.15,
                }}
              >
                {formatRate(after, rotationTime)}
              </Typography>
              <Typography
                component="span"
                sx={{ fontSize: 12, fontWeight: 500, color: 'text.secondary' }}
              >
                {rotationTime
                  ? t('teamOpt.result.dpsUnit', 'DPS')
                  : t('teamOpt.result.own', 'own damage')}
              </Typography>
              {compare && before > 0 && Math.abs(ownChange) >= 0.0005 && (
                <Typography
                  component="span"
                  sx={{
                    ...numSx,
                    fontSize: 12,
                    fontWeight: 650,
                    color: after > before ? 'success.main' : 'warning.main',
                  }}
                >
                  {formatGain(ownChange)}
                </Typography>
              )}
            </Box>
            <Tooltip
              arrow
              title={
                rotationTime
                  ? t('teamOpt.result.shareDps', 'Its share of the team’s DPS')
                  : t('teamOpt.result.share', 'Its share of the team’s damage')
              }
            >
              <Box
                component="span"
                sx={{
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: 0.5,
                  flexShrink: 0,
                  cursor: 'default',
                  ...numSx,
                }}
              >
                <Typography
                  component="span"
                  sx={{ ...numSx, fontSize: 13.5, fontWeight: 650 }}
                >
                  {shareDisplay}
                </Typography>
                <Typography
                  component="span"
                  sx={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: 'text.secondary',
                  }}
                >
                  {t('teamOpt.result.shareLabel', 'of team')}
                </Typography>
              </Box>
            </Tooltip>
          </Box>
          <Box
            sx={{
              mt: 0.75,
              height: 4,
              borderRadius: 2,
              overflow: 'hidden',
              bgcolor: alpha(giTokens.parchment, 0.08),
            }}
          >
            <Box
              sx={(theme) => ({
                height: '100%',
                width: `${clamp(share, 0, 1) * 100}%`,
                borderRadius: 2,
                bgcolor: alpha(elementColor(theme, characterKey), 0.88),
                transition: `width .35s ${tokens.ease}`,
                '@media (prefers-reduced-motion: reduce)': {
                  transition: 'none',
                },
              })}
            />
          </Box>
        </Box>
      </Box>

      {/* (a theorycraft build: its pieces, weapon and sets as they are) */}
      {!build && tcBuild && <TcBuildGear buildTc={tcBuild} />}
      {build && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 0.625,
          }}
        >
          {allArtifactSlotKeys.map((slotKey) => {
            const id = build[slotKey]
            const isNew = compare && optimized && id !== artifactIds[slotKey]
            const excluded = !!id && excludedArts.has(id)
            const excludeLabel = excluded
              ? t('teamOpt.result.include', 'Use it again')
              : t(
                  'teamOpt.result.exclude',
                  "Exclude from this team's optimization"
                )
            return (
              <Box
                key={slotKey}
                sx={(theme) => ({
                  position: 'relative',
                  minWidth: 0,
                  // the exclude button: on hover or focus, always on touch screens and once excluded
                  '& .exclude-art': { opacity: excluded ? 1 : 0 },
                  '&:hover .exclude-art, &:focus-within .exclude-art': {
                    opacity: 1,
                  },
                  '@media (hover: none)': { '& .exclude-art': { opacity: 1 } },
                  borderRadius: 1.5,
                  overflow: 'hidden',
                  boxShadow: `inset 0 0 0 1px ${alpha(giTokens.parchment, 0.08)}`,
                  // new to the member (comparing): a gold ring
                  outline: isNew
                    ? `2px solid ${alpha(theme.palette.primary.main, 0.8)}`
                    : undefined,
                  outlineOffset: 1,
                  // expanded: one tile, the icon over its stats
                  ...(showDetails && {
                    border: hairline,
                    bgcolor: alpha(giTokens.parchment, 0.025),
                  }),
                })}
              >
                <Box sx={{ position: 'relative' }}>
                  <Box
                    sx={{
                      opacity: excluded ? 0.35 : 1,
                      filter: excluded ? 'grayscale(1)' : undefined,
                      transition: 'opacity .12s, filter .12s',
                    }}
                  >
                    <ArtifactCardPico
                      artifactObj={id ? database.arts.get(id) : undefined}
                      slotKey={slotKey}
                    />
                  </Box>
                  {excluded && (
                    <Typography
                      sx={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        textAlign: 'center',
                        fontSize: 12,
                        fontWeight: 650,
                        lineHeight: 1.1,
                        pointerEvents: 'none',
                        textShadow: '0 0 4px rgba(0,0,0,0.9)',
                      }}
                    >
                      {t('teamOpt.result.excluded', 'Excluded')}
                    </Typography>
                  )}
                </Box>
                {id && (
                  <Tooltip arrow title={excludeLabel}>
                    <IconButton
                      className="exclude-art"
                      size="small"
                      aria-label={excludeLabel}
                      aria-pressed={excluded}
                      onClick={() => onToggleExcluded(id)}
                      sx={{
                        position: 'absolute',
                        top: 2,
                        right: 2,
                        p: 0.25,
                        zIndex: 1,
                        transition:
                          'opacity .12s, color .12s, background-color .12s',
                        color: excluded ? 'warning.main' : 'text.primary',
                        bgcolor: alpha(tokens.raised, 0.88),
                        '&:hover': { bgcolor: tokens.hover },
                        ...focusSx,
                        '@media (prefers-reduced-motion: reduce)': {
                          transition: 'none',
                        },
                        // (a finger needs about 40 px: the button stays small, its touch area not)
                        '@media (pointer: coarse)': {
                          p: 0.5,
                          '&::after': {
                            content: '""',
                            position: 'absolute',
                            inset: -8,
                          },
                        },
                      }}
                    >
                      {excluded ? (
                        <UndoIcon sx={{ fontSize: 16 }} />
                      ) : (
                        <ExcludeIcon sx={{ fontSize: 16 }} />
                      )}
                    </IconButton>
                  </Tooltip>
                )}
                {id && (
                  <Collapse
                    in={showDetails}
                    timeout={COLLAPSE_MS}
                    unmountOnExit
                  >
                    <ArtifactStats artifactId={id} />
                  </Collapse>
                )}
              </Box>
            )
          })}
        </Box>
      )}

      {/* the weapon (details on hover), the sets, the energy weapons' help */}
      {(weapon || !!sets.length || energy) && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 0.875,
            pt: 1.125,
            borderTop: hairline,
          }}
        >
          {weapon && (
            <BootstrapTooltip
              placement="top"
              disableInteractive
              title={<WeaponDetails weapon={weapon} />}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  alignSelf: 'flex-start',
                  maxWidth: '100%',
                  cursor: 'default',
                }}
              >
                <WeaponThumb weapon={weapon} highlight={newWeapon} size={40} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography
                    sx={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      letterSpacing: '-0.005em',
                      lineHeight: 1.3,
                    }}
                    noWrap
                  >
                    <WeaponName weaponKey={weapon.key} />
                  </Typography>
                  <Typography
                    sx={{
                      ...type.label,
                      ...numSx,
                      fontSize: 12,
                      fontWeight: 450,
                      lineHeight: 1.35,
                      color: unticked ? 'warning.main' : 'text.secondary',
                    }}
                  >
                    {unticked
                      ? t(
                          'teamOpt.result.untickedWeapon',
                          'Not ticked: kept, no ticked weapon was free'
                        )
                      : !compare
                        ? t('teamOpt.weapons.levelRef', {
                            defaultValue: 'Lv. {{level}} · R{{refinement}}',
                            level: weapon.level,
                            refinement: weapon.refinement,
                          })
                        : newWeapon
                          ? t('teamOpt.result.newWeapon', 'New weapon')
                          : t('teamOpt.result.sameWeapon', 'Same weapon')}
                  </Typography>
                </Box>
              </Box>
            </BootstrapTooltip>
          )}
          {!!sets.length && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 0.5,
              }}
            >
              {sets.map(([setKey, n]) => (
                <ArtifactSetTooltip key={setKey} setKey={setKey} numInSet={n}>
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 0.625,
                      px: 0.875,
                      py: 0.375,
                      maxWidth: '100%',
                      borderRadius: 1.5,
                      bgcolor: alpha(giTokens.parchment, 0.04),
                      border: hairline,
                      cursor: 'default',
                    }}
                  >
                    <Box
                      component="img"
                      src={artifactAsset(setKey, 'flower')}
                      alt=""
                      sx={{ width: 16, height: 16, flexShrink: 0 }}
                    />
                    <Typography
                      sx={{
                        ...type.label,
                        fontSize: 12,
                        fontWeight: 450,
                        lineHeight: 1.3,
                        ...numSx,
                      }}
                      noWrap
                    >
                      <Box
                        component="span"
                        sx={{ fontWeight: 650, color: 'text.primary' }}
                      >
                        {n >= 4 ? 4 : 2}×
                      </Box>{' '}
                      <ArtifactSetName setKey={setKey} />
                    </Typography>
                  </Box>
                </ArtifactSetTooltip>
              ))}
            </Box>
          )}
          {energy && (
            <Typography
              sx={{
                ...type.label,
                fontSize: 12,
                fontWeight: 450,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                minWidth: 0,
              }}
            >
              <BoltIcon
                sx={{ fontSize: 15, color: 'text.secondary', flexShrink: 0 }}
              />
              <Box
                component="span"
                sx={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('teamOpt.result.energy', {
                  defaultValue: 'ER requirement −{{value}}%',
                  value: energy.relief,
                })}
                {' · '}
                {energy.weaponIds.map((id, j) => {
                  const energyWeapon = database.weapons.get(id)
                  return (
                    energyWeapon && (
                      <Fragment key={id}>
                        {j ? ', ' : ''}
                        <WeaponName weaponKey={energyWeapon.key} />
                      </Fragment>
                    )
                  )
                })}
              </Box>
            </Typography>
          )}
        </Box>
      )}
      {shortfalls?.length ? (
        <Shortfalls
          shortfalls={shortfalls}
          data={teamData?.[characterKey]?.target}
          optimized={optimized}
        />
      ) : (
        // (a result saved before the requirements were detailed)
        !!unmet?.length && (
          <Typography
            sx={{
              fontSize: 12.5,
              color: 'warning.main',
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
            }}
          >
            <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />
            {t('teamOpt.result.unmet', {
              defaultValue: '{{count}} requirement not met',
              count: unmet.length,
            })}
          </Typography>
        )
      )}
      <Collapse in={showDetails} timeout={COLLAPSE_MS} unmountOnExit>
        <Box sx={{ pt: 1.25, borderTop: hairline }}>
          <MemberDetails
            characterKey={characterKey}
            details={details}
            teamOpt={runTeamOpt}
            rotationTime={rotationTime}
            compare={compare}
          />
        </Box>
      </Collapse>
      {/* pushed to the card's foot: the cards' toggles line up */}
      <Box sx={{ flexGrow: 1, mt: -1.25 }} />
      <ButtonBase
        onClick={onToggleDetails}
        aria-expanded={detailsToggled}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          mx: -1.5,
          mb: -1.5,
          minHeight: 36,
          borderTop: hairline,
          borderBottomLeftRadius: 'inherit',
          borderBottomRightRadius: 'inherit',
          color: detailsToggled ? 'text.primary' : 'text.secondary',
          fontSize: 12.5,
          fontWeight: 600,
          ...quickSx,
          '&:hover': {
            color: 'text.primary',
            bgcolor: alpha(giTokens.parchment, 0.045),
          },
          ...focusSx,
        }}
      >
        {detailsToggled
          ? t('teamOpt.result.hideDetails', 'Hide stats and damage')
          : t('teamOpt.result.showDetails', 'Stats and damage')}
        <ExpandMoreIcon
          sx={{
            fontSize: 18,
            transform: detailsToggled ? 'rotate(180deg)' : 'none',
            transition: `transform .18s ${tokens.ease}`,
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        />
      </ButtonBase>
    </Box>
  )
}

/**
 * Under an artifact's icon in an expanded result: its main stat, then its substats (in their roll
 * colors), icons left and values right so the five tiles read as one table. A line's stat is named
 * on hover.
 */
const ArtifactStats = memo(function ArtifactStats({
  artifactId,
}: {
  artifactId: string
}) {
  const database = useDatabase()
  const art = database.arts.get(artifactId)
  if (!art) return null
  const { mainStatKey, rarity, level, substats, unactivatedSubstats } = art
  const mainVariant = KeyMap.getVariant(mainStatKey)
  return (
    <Box
      sx={{
        // (sized to the tile: narrow when four results share the row)
        containerType: 'inline-size',
        px: 0.625,
        pt: 0.75,
        pb: 0.875,
        display: 'flex',
        flexDirection: 'column',
        gap: '3px',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <StatLine
        statKey={mainStatKey}
        value={getMainStatDisplayStr(mainStatKey, rarity, level)}
        color={mainVariant ? `${mainVariant}.main` : 'text.primary'}
        main
      />
      <Box sx={{ height: '1px', bgcolor: 'divider', my: '2px' }} />
      {substats.map(
        ({ key, value, rolls }) =>
          !!(key && value) && (
            <StatLine
              key={key}
              statKey={key}
              value={`${artDisplayValue(value, getUnitStr(key))}${getUnitStr(key)}`}
              color={`roll${clamp(rolls.length, 1, 6)}.main`}
            />
          )
      )}
      {unactivatedSubstats?.map(
        ({ key, value }) =>
          !!(key && value) && (
            <StatLine
              key={key}
              statKey={key}
              value={`${artDisplayValue(value, getUnitStr(key))}${getUnitStr(key)}`}
              color="text.disabled"
            />
          )
      )}
    </Box>
  )
})

/**
 * A stat line of an artifact tile, styled as in the artifact's tooltip: icon and value in the
 * line's color (bold, "+" on substats). A narrow tile gets smaller type. Named in a hover title.
 */
function StatLine({
  statKey,
  value,
  color,
  main = false,
}: {
  statKey: MainStatKey | SubstatKey
  value: string
  color: string
  main?: boolean
}) {
  return (
    <Box
      title={statName(statKey)}
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '4px',
        minWidth: 0,
        color,
        // the tooltip's sizes (16 / 13 px) where the tile has room; smaller to fit a narrow tile
        fontSize: main
          ? 'clamp(10px, calc((100cqi - 4px) / 5), 1rem)'
          : 'clamp(10px, calc((100cqi - 4px) / 5.4), 0.8125rem)',
        fontWeight: 700,
        lineHeight: main ? 1.3 : 1.4,
        whiteSpace: 'nowrap',
        letterSpacing: 0,
        '& svg': { fontSize: '1.1em', flexShrink: 0 },
        '@container (max-width: 56px)': { '& .plus': { display: 'none' } },
      }}
    >
      <StatIcon statKey={statKey} />
      <span>
        {!main && <span className="plus">+</span>}
        {value}
      </span>
    </Box>
  )
}

/** A weapon's icon, with its refinement (outlined when it is new to the member) */
export function WeaponThumb({
  weapon,
  highlight,
  size = 44,
}: {
  weapon: ICachedWeapon
  highlight: boolean
  size?: number
}) {
  const { rarity } = getWeaponStat(weapon.key)
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 1.5,
        overflow: 'hidden',
        boxShadow: `inset 0 0 0 1px ${alpha(giTokens.parchment, 0.12)}`,
        outline: highlight
          ? `2px solid ${alpha(theme.palette.primary.main, 0.8)}`
          : undefined,
        outlineOffset: 1,
      })}
      className={`grad-${rarity}star`}
    >
      <Box
        component="img"
        src={weaponAsset(weapon.key, weapon.ascension >= 2)}
        alt=""
        sx={{ width: '100%', height: '100%', display: 'block' }}
      />
      {weaponHasRefinement(weapon.key) && (
        <Typography
          component="span"
          sx={{
            position: 'absolute',
            right: 2,
            bottom: 0,
            fontSize: '0.625rem',
            fontWeight: 700,
            textShadow:
              '0 0 3px rgba(0, 0, 0, 0.9), 0 1px 2px rgba(0, 0, 0, 0.8)',
          }}
        >
          R{weapon.refinement}
        </Typography>
      )}
    </Box>
  )
}

// (moved to gi/ui so the Teams page can show the same tooltip)
// (the weapon tooltip lives in gi/ui now; this file's users still take it from here)
export { WeaponDetails }
