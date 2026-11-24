import {
  useDataManagerEntries,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type { ArtifactSlotKey, MainStatKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  artSlotMainKeys,
} from '@genshin-optimizer/gi/consts'
import type { StatFilters, TeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamCharacterContextObj } from '@genshin-optimizer/gi/db-ui'
import {
  TeamCharacterContext,
  useDatabase,
  useDBMeta,
  useOptConfig,
  useTeam,
} from '@genshin-optimizer/gi/db-ui'
import { SlotIcon } from '@genshin-optimizer/gi/svgicons'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { TeamData, TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  teamOptPool,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import BoltIcon from '@mui/icons-material/Bolt'
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TuneIcon from '@mui/icons-material/Tune'
import {
  Alert,
  alpha,
  Box,
  Button,
  ButtonBase,
  IconButton,
  InputAdornment,
  Skeleton,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MainStatSelectionCard from '../CharacterDisplay/Tabs/TabOptimize/Components/MainStatSelectionCard'
import { formatDamage } from './format'
import { MemberAvatar } from './MemberAvatar'
import { DialogHead } from './OptionTile'
import { useTimedSetEffects } from './RotationWriter'
import type { MemberErHint, TeamEnergy } from './TeamEnergy'
import { setOptConfigEr, TeamEnergyDrawer, useTeamEnergy } from './TeamEnergy'
import {
  PoolSettings,
  type Requirement,
  RequirementsModal,
  RequirementTag,
  shortStat,
  useRequirements,
} from './TeamOptSettings'
import {
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  PanelHeader,
  quickSx,
  Segmented,
  tokens,
  type,
} from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/**
 * Before a run: what it searches. The inventory and weapons, then each member: whether it is
 * optimized, the size of its search, its sets, set effects, main stats and minimum ER (all by
 * default; fewer make its search smaller, so the run faster). Then how it searches, and Start.
 */
export function RunDialog({
  open,
  onClose,
  onStart,
  teamId,
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  poolSize,
  evaluateOnly,
}: {
  open: boolean
  onClose: () => void
  onStart: () => void
  teamId: string
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  poolSize: number
  /** With no member to optimize, Start still computes the team as it is (an imported team's builds) */
  evaluateOnly?: boolean
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  // (the set effects the rotation times in a run: their switches play no part)
  const timed = useTimedSetEffects(teamId, teamOpt, open)
  const artifacts = useDataManagerValues(database.arts)
  const configs = new Map(useDataManagerEntries(database.optConfigs))
  const toOptimize = members.filter(
    (m) => !m.isTc && !teamOpt.keep.includes(m.characterKey)
  )
  const locations = new Set(members.map((member) => member.location as string))
  const reserved = new Set(
    members
      .filter((m) => !toOptimize.includes(m))
      .flatMap((m) => Object.values(m.artifactIds))
      .filter((id): id is string => !!id)
  )
  const eligible = toOptimize.every((member) => {
    const config = configs.get(member.teamChar.optConfigId)
    if (!config) return false
    const pool = teamOptPool(
      artifacts,
      member,
      config,
      teamOpt,
      locations,
      reserved
    )
    return allArtifactSlotKeys.every((slot) =>
      pool.some((art) => art.slotKey === slot)
    )
  })
  const asItIs = !!evaluateOnly && !toOptimize.length
  const canStart = (toOptimize.length > 0 && eligible) || asItIs
  const energy = useTeamEnergy(teamId, members, teamOpt, setTeamOpt)
  const notice = asItIs
    ? t(
        'teamOpt.runDialog.asItIs',
        'Every member is on its imported build: Start computes the team as it is. Pick My builds on the page to optimize your own pieces.'
      )
    : toOptimize.length && !eligible
      ? artifacts.length
        ? t(
            'teamOpt.runDialog.incompleteInventory',
            'At least one member is missing an eligible artifact slot. Adjust the inventory filters or keep that member’s current build.'
          )
        : t(
            'teamOpt.runDialog.emptyInventory',
            'Add or import artifacts before optimizing the team.'
          )
      : undefined
  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      containerProps={{
        maxWidth: false,
        sx: { p: { xs: 1 }, maxWidth: 1340 },
      }}
      aria-label={t('teamOpt.runDialog.title', 'Optimize team')}
    >
      <CardThemed>
        <DialogHead
          title={t('teamOpt.runDialog.title', 'Optimize team')}
          info={t(
            'teamOpt.run.how',
            'Each member is optimized in turn for the whole rotation’s damage, the others fixed, the biggest damage dealer first. Rounds repeat until no build changes; then members trade pieces and weapons where the team gains.'
          )}
          onClose={onClose}
        />
        <Box
          sx={{
            px: { xs: 1.5, sm: 3 },
            pt: 2.5,
            pb: 3,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            maxHeight: { xs: 'calc(100dvh - 150px)', sm: '76vh' },
            overflowY: 'auto',
            // (a scrolling column: its children keep their height)
            '& > *': { flexShrink: 0 },
          }}
        >
          {/* the inventory and weapons first: whether weapons are chosen too is a run's first choice */}
          <PoolSettings
            members={members}
            teamData={teamData}
            teamOpt={teamOpt}
            setTeamOpt={setTeamOpt}
            poolSize={poolSize}
            energy={energy}
          />
          <Box component="section">
            <PanelHeader
              title={t('teamOpt.runDialog.members', 'Members')}
              info={t(
                'teamOpt.runDialog.sizeHint',
                'Builds to search: the combinations of the artifacts a member may use with these settings (sets not counted). Fewer main stats make it smaller, so the run faster.'
              )}
              actions={
                <>
                  <FieldLabel
                    tip={t(
                      'teamOpt.energy.modeTip',
                      'Automatic: the ER calculator works out each member’s minimum ER from the rotation, again for the weapons each build holds (Favonius and other energy weapons counted). Manual: each member’s own minimum, lowered by what you set on energy weapons in Weapons.'
                    )}
                  >
                    {t('teamOpt.energy.mode', 'ER')}
                  </FieldLabel>
                  <Segmented
                    size="small"
                    aria-label={t(
                      'teamOpt.energy.modeLabel',
                      'ER requirements'
                    )}
                    value={energy.calculated ? 'auto' : 'manual'}
                    onChange={(value) =>
                      value === 'auto' ? energy.toAuto() : energy.toManual()
                    }
                    options={[
                      {
                        value: 'auto',
                        label: t('teamOpt.energy.auto', 'Automatic'),
                      },
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
                    onClick={energy.openCalculator}
                  >
                    {t('teamOpt.kqm.calc.open', 'Calculate ER')}
                  </Button>
                </>
              }
              // (a gap between the title and its ⓘ)
              sx={{ mb: 1, '& h3': { gap: '6px' } }}
            />
            <Box
              sx={{
                ...insetSx,
                overflow: 'hidden',
                containerType: 'inline-size',
              }}
            >
              <MembersHead />
              {members.map((member) => (
                <MemberRunRow
                  key={member.characterKey}
                  teamId={teamId}
                  member={member}
                  members={members}
                  teamData={teamData}
                  teamOpt={teamOpt}
                  setTeamOpt={setTeamOpt}
                  energy={energy}
                  timed={timed?.[member.characterKey]}
                />
              ))}
            </Box>
          </Box>
        </Box>
        <Box sx={{ px: { xs: 1.5, sm: 3 }, py: 1.5, borderTop: hairline }}>
          {notice && (
            <Alert severity="info" role="status" sx={{ mb: 1.5 }}>
              {notice}
            </Alert>
          )}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              columnGap: 3,
              rowGap: 1,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FieldLabel
                tip={t(
                  'teamOpt.run.searchTip',
                  'Quick first narrows each slot to the artifacts that can matter, then searches those exactly: much faster, and it rarely misses the best build (by a little when it does). Full searches every artifact.'
                )}
              >
                {t('teamOpt.kqm.search', 'Search')}
              </FieldLabel>
              <Segmented
                size="small"
                aria-label={t('teamOpt.kqm.search', 'Search')}
                value={teamOpt.fullSearch ? 'full' : 'quick'}
                onChange={(search) =>
                  setTeamOpt((o) => {
                    if (search === 'full') o.fullSearch = true
                    else delete o.fullSearch
                  })
                }
                options={[
                  {
                    value: 'quick',
                    label: t('teamOpt.kqm.searchQuick', 'Quick'),
                  },
                  {
                    value: 'full',
                    label: t('teamOpt.kqm.searchFull', 'Full'),
                  },
                ]}
              />
            </Box>
            <Box sx={{ flexGrow: 1 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {/* (phones: the title bar's close is the cancel) */}
              <Button
                color="inherit"
                onClick={onClose}
                sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
              >
                {t('teamOpt.runDialog.cancel', 'Cancel')}
              </Button>
              <Button
                variant="contained"
                startIcon={<TrendingUpIcon />}
                // (no member switched on: nothing to optimize yet)
                disabled={!canStart}
                onClick={() => {
                  onClose()
                  onStart()
                }}
                sx={[{ px: 2.5 }, canStart && giCtaSx]}
              >
                {t('teamOpt.runDialog.start', 'Start')}
              </Button>
            </Box>
          </Box>
        </Box>
        <TeamEnergyDrawer members={members} energy={energy} />
      </CardThemed>
    </ModalWrapper>
  )
}

const mainSlots = ['sands', 'goblet', 'circlet'] as const
const slotNames = { sands: 'Sands', goblet: 'Goblet', circlet: 'Circlet' }

/**
 * The members table's layout, by the table's own width: one line per member with a header row
 * (wide), two lines (narrower), stacked (phones). The cells name themselves where there is no
 * header row.
 */
const WIDE = '@container (min-width: 1000px)'
const MID = '@container (min-width: 600px)'
const wideColumns = {
  display: 'grid',
  gridTemplateColumns: '256px 128px 124px minmax(0, 1fr) 96px 32px',
  gridTemplateAreas: '"member sets effects mains er req"',
} as const
const rowSx = {
  display: 'grid',
  alignItems: 'center',
  columnGap: 2,
  rowGap: 1.25,
  px: 2,
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  gridTemplateAreas:
    '"member member req" "sets effects effects" "mains mains mains" "er er er"',
  [MID]: {
    gridTemplateColumns: 'auto auto minmax(0, 1fr) auto auto',
    gridTemplateAreas:
      '"member member member er req" "sets effects mains mains mains"',
  },
  [WIDE]: wideColumns,
} as const
const cellSx = (area: string) =>
  ({
    gridArea: area,
    display: 'flex',
    alignItems: 'center',
    minWidth: 0,
  }) as const

/** The table's column names (wide only: narrower, each cell names itself) */
function MembersHead() {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={{
        ...rowSx,
        display: 'none',
        [WIDE]: { ...wideColumns },
        minHeight: 38,
        borderBottom: hairline,
        bgcolor: alpha('#000', 0.12),
      }}
    >
      <FieldLabel sx={{ gridArea: 'member' }}>
        {t('teamOpt.runDialog.memberHead', 'Member')}
      </FieldLabel>
      <FieldLabel sx={{ gridArea: 'sets' }}>
        {t('teamOpt.member.sets', 'Sets')}
      </FieldLabel>
      <FieldLabel
        sx={{ gridArea: 'effects' }}
        tip={t(
          'teamOpt.member.noEffectsHint',
          'Set effects count only when on: click to turn them on'
        )}
      >
        {t('teamOpt.member.effects', 'Set effects')}
      </FieldLabel>
      <FieldLabel sx={{ gridArea: 'mains' }}>
        {t('teamOpt.requirements.mainStats', 'Main stats')}
      </FieldLabel>
      <FieldLabel sx={{ gridArea: 'er' }}>
        {t('teamOpt.kqm.minEr', 'Min ER')}
      </FieldLabel>
    </Box>
  )
}

/**
 * A cell's name where the table has no header row (on phones only where its control doesn't
 * name itself: the minimum ER)
 */
function CellLabel({
  children,
  phone,
}: {
  children: ReactNode
  phone?: boolean
}) {
  return (
    <Box
      component="span"
      sx={{
        ...type.label,
        whiteSpace: 'nowrap',
        mr: 1,
        display: phone ? 'inline' : 'none',
        [MID]: { display: 'inline' },
        [WIDE]: { display: 'none' },
      }}
    >
      {children}
    </Box>
  )
}

/**
 * A member's line: optimized or kept, the size of its search, its sets and set effects, its main
 * stats (chosen as on its Optimize page: the same card and settings, so what is unticked here is
 * unticked there), its minimum ER and its other requirements
 */
function MemberRunRow({
  teamId,
  member,
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  energy,
  timed,
}: {
  teamId: string
  member: TeamOptMember
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  energy: TeamEnergy
  /** Its set effects the rotation times (`teamTimedSetEffects`) */
  timed?: ReadonlySet<string>
}) {
  const { t } = useTranslation(['page_team', 'artifact'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  const team = useTeam(teamId)
  const { characterKey, isTc, teamCharId, loadoutDatum } = member
  const teamChar = database.teamChars.get(teamCharId) ?? member.teamChar
  const optConfig = useOptConfig(teamChar.optConfigId)
  const kept = isTc || teamOpt.keep.includes(characterKey)
  const requirements = useRequirements(member, teamData, timed)
  const sets = requirements.find((r) => r.kind === 'sets')
  const effects = requirements.find((r) => r.kind === 'effects')
  // (its minimum ER has its own box on the line)
  const minimums = requirements.filter(
    (r) => r.kind === 'stat' && !r.key.startsWith(`${ER_PATH}:`)
  )
  // the Optimize page's main stat card reads the member from this context
  const teamCharContext = useMemo<TeamCharacterContextObj | undefined>(
    () => team && { teamId, team, teamCharId, teamChar, loadoutDatum },
    [teamId, team, teamCharId, teamChar, loadoutDatum]
  )
  const locations = useMemo(
    () => new Set(members.map((m) => m.location as string)),
    [members]
  )
  // its search: the builds of its artifacts these settings allow (sets not counted)
  const { size, emptySlots } = useMemo(() => {
    if (!optConfig || kept) return { size: 0, emptySlots: [] }
    const pool = teamOptPool(
      database.arts.values,
      member,
      optConfig,
      teamOpt,
      locations,
      new Set()
    )
    const perSlot = Object.fromEntries(
      allArtifactSlotKeys.map((s) => [s, 0])
    ) as Record<ArtifactSlotKey, number>
    for (const art of pool) perSlot[art.slotKey]++
    return {
      size: Object.values(perSlot).reduce((a, b) => a * b, 1),
      // (a slot with nothing to choose from: no build can be made for it)
      emptySlots: allArtifactSlotKeys.filter((slot) => !perSlot[slot]),
    }
  }, [database, member, optConfig, teamOpt, locations, kept])

  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<'all' | 'sets'>()
  const expanded = open && !kept && !!teamCharContext
  // the main stats it may use, per slot (none ticked, or all: any)
  const mainStats = optConfig?.mainStatKeys as
    | Partial<Record<ArtifactSlotKey, MainStatKey[]>>
    | undefined

  const meta = isTc ? (
    t('teamOpt.member.tc', 'TC build: kept as it is')
  ) : kept ? (
    t('teamOpt.member.kept', 'Keeps its build')
  ) : emptySlots.length ? (
    // nothing to choose from in a slot: what to change (else the run keeps its build)
    <Tooltip
      arrow
      title={t(
        'teamOpt.runDialog.emptySlotsFix',
        'Turn on Other characters’ artifacts or allow lower levels.'
      )}
    >
      <Box component="span" sx={{ color: 'warning.main' }}>
        {emptySlots.length === allArtifactSlotKeys.length
          ? t('teamOpt.runDialog.noArtifacts', 'No artifacts to choose from')
          : t('teamOpt.runDialog.emptySlotsShort', {
              defaultValue: 'No {{slots}} to choose from',
              slots: emptySlots
                .map((slot) => t(`artifact:slotName.${slot}`, slot))
                .join(', '),
            })}
      </Box>
    </Tooltip>
  ) : (
    t('teamOpt.runDialog.size', {
      defaultValue: '≈ {{size}} builds to search',
      size: formatDamage(size),
    })
  )

  return (
    <Box sx={{ '& + &': { borderTop: hairline } }}>
      <Box sx={{ ...rowSx, py: 1.25, minHeight: 64 }}>
        <Box
          sx={{
            gridArea: 'member',
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            minWidth: 0,
          }}
        >
          <Tooltip
            arrow
            title={
              isTc
                ? t('teamOpt.member.tc', 'TC build: kept as it is')
                : t('teamOpt.member.optimize', 'Optimize artifacts')
            }
          >
            <Box
              sx={{
                display: 'flex',
                ml: -0.75,
                borderRadius: tokens.radius.pill,
                // (the switch's keyboard focus: the same ring as the other controls)
                '&:has(.Mui-focusVisible)': {
                  outline: `2px solid ${tokens.gold}`,
                  outlineOffset: -2,
                },
              }}
            >
              <Switch
                size="small"
                checked={!kept}
                disabled={isTc}
                onChange={() =>
                  setTeamOpt((o) => {
                    o.keep = o.keep.includes(characterKey)
                      ? o.keep.filter((k) => k !== characterKey)
                      : [...o.keep, characterKey]
                  })
                }
                inputProps={{
                  'aria-label': t(
                    'teamOpt.member.optimize',
                    'Optimize artifacts'
                  ),
                }}
              />
            </Box>
          </Tooltip>
          <Box
            sx={{
              display: 'flex',
              filter: kept ? 'grayscale(1)' : 'none',
              opacity: kept ? 0.55 : 1,
              ...quickSx,
            }}
          >
            <MemberAvatar characterKey={characterKey} size={36} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography
              noWrap
              sx={{
                fontSize: 14.5,
                fontWeight: 600,
                lineHeight: 1.35,
                color: kept ? 'text.secondary' : 'text.primary',
              }}
            >
              <CharacterName characterKey={characterKey} gender={gender} />
            </Typography>
            <Typography
              component="div"
              noWrap
              sx={{ ...type.label, fontSize: 12, lineHeight: 1.4, ...numSx }}
            >
              {meta}
            </Typography>
          </Box>
        </Box>
        {!kept && (
          <>
            {sets && (
              <Box sx={cellSx('sets')}>
                <CellLabel>{t('teamOpt.member.sets', 'Sets')}</CellLabel>
                <RequirementTag
                  req={sets}
                  onClick={() => setSettings('sets')}
                />
              </Box>
            )}
            {effects && (
              <Box sx={cellSx('effects')}>
                <CellLabel>
                  {t('teamOpt.member.effects', 'Set effects')}
                </CellLabel>
                <RequirementTag
                  req={effects}
                  onClick={() => setSettings('sets')}
                />
              </Box>
            )}
            <Box sx={cellSx('mains')}>
              <CellLabel>
                {t('teamOpt.requirements.mainStats', 'Main stats')}
              </CellLabel>
              <ButtonBase
                onClick={() => setOpen((v) => !v)}
                disabled={!teamCharContext}
                aria-expanded={expanded}
                aria-label={t(
                  'teamOpt.runDialog.mainStatsEdit',
                  'Choose main stats'
                )}
                sx={(theme) => ({
                  maxWidth: '100%',
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-start',
                  gap: 1.75,
                  height: 32,
                  pl: 1.25,
                  pr: 0.75,
                  borderRadius: tokens.radius.control,
                  border: `1px solid ${
                    expanded ? tokens.hairlineStrong : tokens.hairline
                  }`,
                  bgcolor: expanded
                    ? 'action.selected'
                    : alpha(theme.palette.text.primary, 0.03),
                  ...quickSx,
                  ...focusSx,
                  '&:hover': {
                    bgcolor: alpha(theme.palette.text.primary, 0.07),
                    borderColor: tokens.hairlineStrong,
                  },
                })}
              >
                {mainSlots.map((slot) => (
                  <MainStatSummary
                    key={slot}
                    slot={slot}
                    keys={mainStats?.[slot] ?? []}
                  />
                ))}
                <ExpandMoreIcon
                  sx={{
                    ml: -0.5,
                    fontSize: 18,
                    color: 'text.secondary',
                    transition: `transform .18s ${tokens.ease}`,
                    transform: expanded ? 'rotate(180deg)' : 'none',
                  }}
                />
              </ButtonBase>
            </Box>
            {optConfig && (
              <Box
                sx={{
                  ...cellSx('er'),
                  flexDirection: 'column',
                  alignItems: { xs: 'flex-start', sm: 'flex-end' },
                  gap: 0.25,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <CellLabel phone>
                    {t('teamOpt.kqm.minEr', 'Min ER')}
                  </CellLabel>
                  <MinErField
                    characterKey={characterKey}
                    optConfigId={teamChar.optConfigId}
                    statFilters={optConfig.statFilters}
                    calculated={
                      !energy.calculated
                        ? undefined
                        : energy.targets
                          ? (energy.targets[characterKey] ?? 100)
                          : Number.NaN
                    }
                  />
                </Box>
                <ErWeaponHint
                  hint={energy.erHints[characterKey]}
                  calculated={energy.calculated}
                />
              </Box>
            )}
            <Box sx={{ gridArea: 'req', justifySelf: 'end' }}>
              <RequirementsButton
                minimums={minimums}
                onClick={() => setSettings('all')}
              />
            </Box>
          </>
        )}
      </Box>
      {expanded && teamCharContext && (
        <Suspense fallback={<Skeleton height={120} sx={{ mx: 2 }} />}>
          <MemberCustomize
            member={member}
            teamOpt={teamOpt}
            teamCharContext={teamCharContext}
            locations={locations}
          />
        </Suspense>
      )}
      {settings && (
        <RequirementsModal
          teamId={teamId}
          member={member}
          teamData={teamData}
          setsOnly={settings === 'sets'}
          timed={timed}
          onClose={() => setSettings(undefined)}
        />
      )}
    </Box>
  )
}

/** A member's stat constraints (minimums besides ER): their count on the button, the editor on a click */
function RequirementsButton({
  minimums,
  onClick,
}: {
  minimums: Requirement[]
  onClick: () => void
}) {
  const { t } = useTranslation('page_team')
  const label = t('teamOpt.member.constraints', 'Constraints')
  return (
    <Tooltip
      arrow
      title={
        <Box sx={{ py: 0.25 }}>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
          {minimums.map(
            (r) =>
              r.kind === 'stat' && (
                <Typography
                  key={r.key}
                  variant="caption"
                  component="div"
                  sx={{ color: 'text.secondary' }}
                >
                  {r.name} {r.text}
                </Typography>
              )
          )}
        </Box>
      }
    >
      <IconButton
        size="small"
        onClick={onClick}
        aria-label={label}
        aria-haspopup="dialog"
        sx={{
          position: 'relative',
          mr: -0.5,
          color: minimums.length ? 'primary.light' : 'text.secondary',
          '&:hover': { color: 'text.primary' },
        }}
      >
        <TuneIcon sx={{ fontSize: 19 }} />
        {!!minimums.length && (
          <Box
            component="span"
            sx={{
              position: 'absolute',
              top: 0,
              right: -1,
              minWidth: 15,
              height: 15,
              px: '4px',
              borderRadius: tokens.radius.pill,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: '15px',
              textAlign: 'center',
              bgcolor: 'primary.main',
              color: 'primary.contrastText',
              ...numSx,
            }}
          >
            {minimums.length}
          </Box>
        )}
      </IconButton>
    </Tooltip>
  )
}

const ER_PATH = JSON.stringify(['basic', 'enerRech_'])
/** Every character's Energy Recharge: a minimum at or below it is none */
const BASE_ER = 100

/**
 * A member's minimum Energy Recharge, on its line: the same requirement as its Optimize settings
 * (empty: none). Saved when the field is left or Enter is pressed.
 */
function MinErField({
  characterKey,
  optConfigId,
  statFilters,
  calculated,
}: {
  characterKey: TeamOptMember['characterKey']
  optConfigId: string
  statFilters: StatFilters
  /** Automatic ER: the calculator's target for it, shown (not typed); NaN: it has none */
  calculated?: number
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const saved = statFilters[ER_PATH]?.find((f) => !f.disabled)?.value
  // (every character has 100% ER: no minimum reads as 100)
  const shown =
    calculated !== undefined
      ? Math.max(calculated, BASE_ER)
      : (saved ?? BASE_ER)
  const shownText = `${+shown.toFixed(1)}`
  const [text, setText] = useState(shownText)
  useEffect(() => setText(shownText), [shownText])
  const parsed = text.trim() === '' ? undefined : Number(text)
  const invalid =
    parsed !== undefined && !(Number.isFinite(parsed) && parsed >= 0)
  const commit = () => {
    if (invalid || text === shownText) return
    const value = parsed !== undefined && parsed > BASE_ER ? parsed : undefined
    setOptConfigEr(database, optConfigId, value)
    setText(`${+(value ?? BASE_ER).toFixed(1)}`)
  }
  if (calculated !== undefined)
    return (
      <Tooltip
        arrow
        title={
          Number.isNaN(calculated)
            ? t(
                'teamOpt.energy.autoMissing',
                'The ER calculator cannot work out a target yet: open Calculate ER to finish it.'
              )
            : t(
                'teamOpt.energy.autoTarget',
                'Worked out by the ER calculator for the weapons each build holds. Choose Manual to set your own.'
              )
        }
      >
        <Box
          component="span"
          tabIndex={0}
          aria-label={t('teamOpt.kqm.erInput', {
            defaultValue: '{{character}} minimum ER (%)',
            character: characterKey,
          })}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 0.5,
            width: 96,
            height: 32,
            px: 1,
            borderRadius: tokens.radius.control,
            fontSize: 13.5,
            fontWeight: 600,
            color: 'text.secondary',
            bgcolor: tokens.inset,
            cursor: 'default',
            ...numSx,
            ...focusSx,
          }}
        >
          {Number.isNaN(calculated) ? (
            '—'
          ) : (
            <>
              {shownText}
              <Box component="span" sx={{ ...type.label, fontSize: 12 }}>
                %
              </Box>
            </>
          )}
        </Box>
      </Tooltip>
    )
  return (
    <TextField
      size="small"
      value={text}
      error={invalid}
      placeholder={`${BASE_ER}`}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
      inputProps={{
        inputMode: 'decimal',
        'aria-label': t('teamOpt.kqm.erInput', {
          defaultValue: '{{character}} minimum ER (%)',
          character: characterKey,
        }),
      }}
      InputProps={{
        endAdornment: (
          <InputAdornment position="end">
            <Box component="span" sx={{ ...type.label, fontSize: 12 }}>
              %
            </Box>
          </InputAdornment>
        ),
      }}
      sx={{
        width: 96,
        '& .MuiInputBase-root': {
          fontSize: 13.5,
          height: 32,
          pl: 1.25,
          pr: 1,
          borderRadius: tokens.radius.control,
        },
        '& .MuiInputAdornment-positionEnd': { ml: 0.5 },
        '& .MuiInputBase-input': { py: 0, textAlign: 'right', ...numSx },
        '& .MuiInputBase-input::placeholder': { opacity: 0.55 },
      }}
    />
  )
}

/** Live note under a member's Min ER showing how a ticked energy/Favonius weapon shifts it */
function ErWeaponHint({
  hint,
  calculated,
}: {
  hint: MemberErHint | undefined
  calculated: boolean
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  if (!hint?.lower && !hint?.higher) return null
  const fmt = (n: number) => `${+n.toFixed(1)}%`
  const lower = hint.lower
  const higher = hint.higher
  const tip = lower ? (
    <>
      {fmt(lower.target)}{' '}
      {lower.holder ? (
        <>
          {t('teamOpt.energy.whenHolds', 'when')}{' '}
          <CharacterName characterKey={lower.holder} gender={gender} />{' '}
          {t('teamOpt.energy.holds', 'holds')}{' '}
          <WeaponName weaponKey={lower.weaponKey} />
        </>
      ) : (
        <>
          {t('teamOpt.energy.withWeapon', 'with')}{' '}
          <WeaponName weaponKey={lower.weaponKey} />
        </>
      )}
      {` (−${+lower.diff.toFixed(1)}%)`}
      {calculated &&
        t(
          'teamOpt.energy.perWeaponNote',
          '. Recalculated per weapon during optimization.'
        )}
    </>
  ) : (
    higher && (
      <>
        {t('teamOpt.energy.withoutWeapon', {
          defaultValue: 'Up to {{er}} without',
          er: fmt(higher.target),
        })}{' '}
        <CharacterName characterKey={higher.holder} gender={gender} />{' '}
        <WeaponName weaponKey={higher.weaponKey} />
        {t(
          'teamOpt.energy.perWeaponNote',
          '. Recalculated per weapon during optimization.'
        )}
      </>
    )
  )
  return (
    <Tooltip arrow title={tip}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.25,
          fontSize: 11.5,
          fontWeight: 600,
          lineHeight: 1.2,
          color: 'text.secondary',
          cursor: 'help',
          whiteSpace: 'nowrap',
          ...numSx,
        }}
      >
        <BoltIcon sx={{ fontSize: 12.5, color: 'primary.main' }} />
        {lower
          ? fmt(lower.target)
          : higher &&
            t('teamOpt.energy.upTo', {
              defaultValue: 'up to {{er}}',
              er: fmt(higher.target),
            })}
      </Box>
    </Tooltip>
  )
}

/** A slot's main stats on a member's line: its icon, then up to two stats, a count, or Any */
function MainStatSummary({
  slot,
  keys,
}: {
  slot: (typeof mainSlots)[number]
  keys: MainStatKey[]
}) {
  const { t } = useTranslation('page_team')
  const any = !keys.length || keys.length >= artSlotMainKeys[slot].length
  const shortNames = keys.map((k) => shortStat(k, t)).join(', ')
  return (
    <Tooltip
      arrow
      title={`${t(`teamOpt.slot.${slot}`, slotNames[slot])}: ${
        any ? t('teamOpt.runDialog.anyMain', 'Any') : shortNames
      }`}
    >
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.625,
          minWidth: 0,
          flexShrink: keys.length > 2 ? 0 : 1,
          fontSize: 13,
          fontWeight: 500,
          color: any ? 'text.secondary' : 'text.primary',
        }}
      >
        <SlotIcon
          slotKey={slot}
          iconProps={{ sx: { fontSize: 15, color: 'text.secondary' } }}
        />
        <Box
          component="span"
          sx={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {any
            ? t('teamOpt.runDialog.anyMain', 'Any')
            : keys.length > 2
              ? t('teamOpt.runDialog.statsCount', {
                  defaultValue_one: '{{count}} stat',
                  defaultValue_other: '{{count}} stats',
                  count: keys.length,
                })
              : shortNames}
        </Box>
      </Box>
    </Tooltip>
  )
}

/** A member's main stats, opened from its row */
function MemberCustomize({
  member,
  teamOpt,
  teamCharContext,
  locations,
}: {
  member: TeamOptMember
  teamOpt: TeamOpt
  teamCharContext: TeamCharacterContextObj
  locations: Set<string>
}) {
  const database = useDatabase()
  const optConfig = useOptConfig(teamCharContext.teamChar.optConfigId)
  // the counts next to the main stats: the artifacts it could use, whatever main stats are ticked
  const filteredArtIdMap = useMemo(() => {
    if (!optConfig) return {}
    const anyMain = {
      ...optConfig,
      mainStatKeys: { sands: [], goblet: [], circlet: [] },
    } as typeof optConfig
    return Object.fromEntries(
      teamOptPool(
        database.arts.values,
        member,
        anyMain,
        teamOpt,
        locations,
        new Set()
      ).map((a) => [a.id, true])
    )
  }, [database, member, optConfig, teamOpt, locations])
  return (
    <Box sx={{ px: 2, pb: 2, maxWidth: 880 }}>
      <TeamCharacterContext.Provider value={teamCharContext}>
        <MainStatSelectionCard filteredArtIdMap={filteredArtIdMap} />
      </TeamCharacterContext.Provider>
    </Box>
  )
}
