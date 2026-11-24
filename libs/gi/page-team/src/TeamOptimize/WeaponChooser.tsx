import {
  useDataManagerEntries,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { useBoolState } from '@genshin-optimizer/common/react-util'
import {
  CardThemed,
  ImgIcon,
  ModalWrapper,
  NumberInputLazy,
  SuspenseTooltip,
} from '@genshin-optimizer/common/ui'
import {
  deepClone,
  deletePropPath,
  layeredAssignment,
  objClearEmpties,
  objPathValue,
} from '@genshin-optimizer/common/util'
import { imgAssets, weaponAsset } from '@genshin-optimizer/gi/assets'
import type {
  CharacterKey,
  WeaponKey,
  WeaponTypeKey,
} from '@genshin-optimizer/gi/consts'
import type {
  ICachedWeapon,
  TeamOpt,
  TeamOptEnergyCalculator,
  TeamOptEnergyMember,
} from '@genshin-optimizer/gi/db'
import {
  defaultInitialWeaponKey,
  initialWeapon,
} from '@genshin-optimizer/gi/db'
import {
  useDatabase,
  useDBMeta,
  useOptConfig,
  useTeamChar,
} from '@genshin-optimizer/gi/db-ui'
import type { DocumentConditional } from '@genshin-optimizer/gi/sheets'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { getCharWeaponType, getWeaponStat } from '@genshin-optimizer/gi/stats'
import type {
  TeamData,
  TeamOptMember,
  WeaponCalculatorImpact,
} from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  canAssignTeamWeapons,
  energyWeaponPerBurst,
  hasEnergyRequirement,
  isCalcEnergyWeapon,
  isEnergyWeapon,
  isFavonius,
  LocationName,
  teamOptCurrentWeapons,
  updateEnergyCalcMember,
  WeaponEditor,
  WeaponName,
  WeaponSelectionModal,
  weaponCalculatorImpact,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import AddIcon from '@mui/icons-material/Add'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import BoltIcon from '@mui/icons-material/Bolt'
import CalculateOutlinedIcon from '@mui/icons-material/CalculateOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import RemoveIcon from '@mui/icons-material/Remove'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import type { SxProps, Theme } from '@mui/material'
import {
  Alert,
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  InputBase,
  Menu,
  MenuItem,
  Select,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import {
  createContext,
  Fragment,
  memo,
  useCallback,
  Suspense,
  startTransition,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import {
  DialogHead,
  floatSx,
  OptionTile,
  stackedBackdrop,
  TileAction,
} from './OptionTile'
import type { TeamEnergy as TeamEnergyHook } from './TeamEnergy'
import {
  FieldLabel,
  focusSx,
  hairline,
  numSx,
  Pill,
  quickSx,
  tokens,
  type as typo,
  useBatches,
} from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/** ER calculator state passed to WeaponGroup when ER is calculated per weapon */
export interface WeaponCalcEnergyConfig {
  calculator: TeamOptEnergyCalculator
  baseWeapons?: Partial<Record<CharacterKey, WeaponKey>>
  baseRefinements?: Partial<Record<CharacterKey, number>>
  updateMember: (
    characterKey: CharacterKey,
    values: Partial<TeamOptEnergyMember>
  ) => void
  onOpenCalculator?: () => void
}

const ER_FILTER_PATH = JSON.stringify(['basic', 'enerRech_'])

/** Whether a weapon is usable by at least one current wielder of its type */
function isWeaponTicked(
  weaponId: string,
  wielders: readonly TeamOptMember[],
  excluded: ReadonlySet<string>,
  excludedMembers?: Record<string, readonly CharacterKey[] | undefined>
) {
  if (excluded.has(weaponId)) return false
  const blocked = excludedMembers?.[weaponId]
  return (
    !blocked?.length || wielders.some((m) => !blocked.includes(m.characterKey))
  )
}

/** The inventory's weapons the members can wield, by weapon type (best first) */
function useTeamWeapons(members: TeamOptMember[]) {
  const database = useDatabase()
  // (subscribed: a weapon added or removed here, or anywhere, shows at once)
  const inventory = useDataManagerValues(database.weapons)
  return useMemo(() => {
    const types = [
      ...new Set(members.map((m) => getCharWeaponType(m.characterKey))),
    ] as WeaponTypeKey[]
    return types.map((type) => ({
      type,
      members: members.filter(
        (m) => getCharWeaponType(m.characterKey) === type
      ),
      weapons: inventory
        .filter((w) => getWeaponStat(w.key)?.weaponType === type)
        .sort(
          (a, b) =>
            getWeaponStat(b.key).rarity - getWeaponStat(a.key).rarity ||
            b.level - a.level ||
            b.refinement - a.refinement
        ),
    }))
  }, [inventory, members])
}

/** Whether to choose the members' weapons too, and which ones may be chosen */
export function WeaponSettings({
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  energy,
  disabled,
}: {
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  energy?: TeamEnergyHook
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const groups = useTeamWeapons(members)
  const [show, onShow, onHide] = useBoolState()
  const total = groups.reduce((n, g) => n + g.weapons.length, 0)
  const excluded = new Set(teamOpt.excludedWeapons)
  const allowed = groups.reduce(
    (n, g) =>
      n +
      g.weapons.filter((w) =>
        isWeaponTicked(w.id, g.members, excluded, teamOpt.excludedWeaponMembers)
      ).length,
    0
  )
  return (
    <>
      <OptionTile
        label={t('teamOpt.weapons.toggle', 'Weapons too')}
        checked={teamOpt.optimizeWeapons}
        disabled={disabled}
        onChange={() =>
          setTeamOpt((o) => {
            o.optimizeWeapons = !o.optimizeWeapons
          })
        }
        action={
          teamOpt.optimizeWeapons && (
            <Tooltip
              arrow
              title={t('teamOpt.weapons.title', 'Weapons to choose from')}
            >
              <span style={{ display: 'inline-flex' }}>
                <TileAction
                  onClick={(e) => {
                    // (not the tile's toggle)
                    e.preventDefault()
                    onShow()
                  }}
                  disabled={disabled}
                  aria-label={t(
                    'teamOpt.weapons.title',
                    'Weapons to choose from'
                  )}
                >
                  {t('teamOpt.weapons.count', {
                    defaultValue: '{{allowed}}/{{total}} weapons',
                    allowed,
                    total,
                  })}
                </TileAction>
              </span>
            </Tooltip>
          )
        }
      />
      {show && (
        <WeaponChooserModal
          groups={groups}
          members={members}
          teamData={teamData}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          energy={energy}
          onClose={onHide}
        />
      )}
    </>
  )
}

/** The weapons left out, for all members or some */
type Exclusions = Pick<TeamOpt, 'excludedWeapons' | 'excludedWeaponMembers'>

function WeaponChooserModal({
  groups,
  members,
  teamData,
  teamOpt,
  setTeamOpt,
  energy,
  onClose,
}: {
  groups: ReturnType<typeof useTeamWeapons>
  members: TeamOptMember[]
  teamData: TeamData | undefined
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  energy?: TeamEnergyHook
  onClose: () => void
}) {
  const { t } = useTranslation(['page_team', 'page_weapon'])
  const database = useDatabase()
  const optConfigs = useDataManagerEntries(database.optConfigs)
  // Clicks are kept here and saved once, when the dialog closes (or the page is left): a save
  // writes the team's whole settings, its rotation's attacks with them, too slow for every click
  const [pending, setPending] = useState<Exclusions>()
  const clicked: Exclusions = pending ?? {
    excludedWeapons: teamOpt.excludedWeapons,
    excludedWeaponMembers: teamOpt.excludedWeaponMembers,
  }
  const excluded = new Set(clicked.excludedWeapons)
  const excludedMembers = clicked.excludedWeaponMembers
  const clickedRef = useRef(clicked)
  clickedRef.current = clicked
  const queue = useRef<((o: Exclusions) => void)[]>([])
  const save = useRef(setTeamOpt)
  save.current = setTeamOpt
  const flush = useCallback(() => {
    const changes = queue.current
    if (!changes.length) return
    queue.current = []
    save.current((o) => {
      for (const change of changes) change(o)
    })
  }, [])
  useEffect(() => {
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      // (the dialog closes first, then the save)
      requestAnimationFrame(() => setTimeout(flush))
    }
  }, [flush])
  const update = (change: (o: Exclusions) => void) => {
    const view = structuredClone(clickedRef.current)
    change(view)
    clickedRef.current = view
    queue.current.push(change)
    setPending(view)
  }
  const all = groups.flatMap((g) => g.weapons)
  const keys = useMemo(() => members.map((m) => m.characterKey), [members])
  // (the weapon cards keep the handlers they were drawn with: these read the latest ones)
  const latest = useRef({ energy, onClose })
  latest.current = { energy, onClose }
  const openCalculator = useMemo(
    () =>
      energy
        ? () => {
            latest.current.onClose()
            latest.current.energy?.openCalculator()
          }
        : undefined,
    [!!energy]
  )
  const setExcluded = (ids: string[], clearMembersFor?: Iterable<string>) =>
    update((o) => {
      const nextIds = [...new Set(ids)]
      o.excludedWeapons = nextIds
      if (o.excludedWeaponMembers) {
        const next = { ...o.excludedWeaponMembers }
        for (const id of nextIds) delete next[id]
        if (clearMembersFor) for (const id of clearMembersFor) delete next[id]
        if (Object.keys(next).length) o.excludedWeaponMembers = next
        else delete o.excludedWeaponMembers
      }
    })
  const toggle = (weapon: ICachedWeapon, wielders: TeamOptMember[]) =>
    update((o) => {
      const currentlyExcluded = new Set(o.excludedWeapons)
      const ticked = isWeaponTicked(
        weapon.id,
        wielders,
        currentlyExcluded,
        o.excludedWeaponMembers
      )
      o.excludedWeapons = ticked
        ? [...new Set([...o.excludedWeapons, weapon.id])]
        : o.excludedWeapons.filter((id) => id !== weapon.id)
      if (o.excludedWeaponMembers?.[weapon.id]) {
        const next = { ...o.excludedWeaponMembers }
        delete next[weapon.id]
        if (Object.keys(next).length) o.excludedWeaponMembers = next
        else delete o.excludedWeaponMembers
      }
    })
  const toggleMember = (
    weapon: ICachedWeapon,
    wielders: TeamOptMember[],
    characterKey: CharacterKey
  ) =>
    update((o) => {
      const currentlyExcluded = new Set(o.excludedWeapons)
      const ticked = isWeaponTicked(
        weapon.id,
        wielders,
        currentlyExcluded,
        o.excludedWeaponMembers
      )
      const nextMap = { ...o.excludedWeaponMembers }
      if (!ticked) {
        // Clicking a character on an unticked weapon ticks it for that character only
        o.excludedWeapons = o.excludedWeapons.filter((id) => id !== weapon.id)
        const others = wielders
          .map((m) => m.characterKey)
          .filter((k) => k !== characterKey)
        if (others.length) nextMap[weapon.id] = others
        else delete nextMap[weapon.id]
      } else {
        const blocked = new Set(nextMap[weapon.id] ?? [])
        if (blocked.has(characterKey)) blocked.delete(characterKey)
        else blocked.add(characterKey)
        const remaining = wielders.some((m) => !blocked.has(m.characterKey))
        if (!remaining) {
          o.excludedWeapons = [...new Set([...o.excludedWeapons, weapon.id])]
          delete nextMap[weapon.id]
        } else if (blocked.size) {
          nextMap[weapon.id] = [...blocked]
        } else {
          delete nextMap[weapon.id]
        }
      }
      if (Object.keys(nextMap).length) o.excludedWeaponMembers = nextMap
      else delete o.excludedWeaponMembers
    })
  // (saved settings come back as new objects: the calculator's content stands for it)
  const calculatorKey = JSON.stringify(teamOpt.energyCalculator ?? null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `calculatorKey` stands for the calculator
  const calcEnergy = useMemo<WeaponCalcEnergyConfig | undefined>(() => {
    if (teamOpt.energySource !== 'calculator' || !teamOpt.energyCalculator)
      return undefined
    const current = teamOptCurrentWeapons(database, members)
    const baseWeapons = Object.fromEntries(
      Object.entries(current)
        .filter(([, w]) => !!w)
        .map(([k, w]) => [k, w!.key])
    ) as Partial<Record<CharacterKey, WeaponKey>>
    const baseRefinements = Object.fromEntries(
      Object.entries(current)
        .filter(([, w]) => !!w)
        .map(([k, w]) => [k, w!.refinement])
    ) as Partial<Record<CharacterKey, number>>
    return {
      calculator: teamOpt.energyCalculator,
      baseWeapons,
      baseRefinements,
      updateMember: (characterKey, values) =>
        setTeamOpt((o) => {
          if (!o.energyCalculator) return
          o.energyCalculator = updateEnergyCalcMember(
            o.energyCalculator,
            keys,
            characterKey,
            values
          )
        }),
      onOpenCalculator: openCalculator,
    }
  }, [
    teamOpt.energySource,
    calculatorKey,
    database,
    members,
    keys,
    setTeamOpt,
    openCalculator,
  ])
  const memberMinEr = useMemo<Partial<Record<CharacterKey, number>>>(() => {
    const map = new Map(optConfigs)
    const out: Partial<Record<CharacterKey, number>> = {}
    for (const m of members) {
      const val = map
        .get(m.teamChar.optConfigId)
        ?.statFilters[ER_FILTER_PATH]?.find((f) => !f.disabled)?.value
      if (val && val > 100) out[m.characterKey] = val
    }
    return out
  }, [optConfigs, members])
  // the dialog shows at once (its frame and placeholders); its rows fill in right after
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      startTransition(() => setReady(true))
    )
    return () => cancelAnimationFrame(id)
  }, [])
  // the quick picks: lit when the ticks are exactly theirs (and for "All", no member restrictions)
  const hasRestrictions = (exceptIds: ReadonlySet<string>) =>
    groups.some((g) =>
      g.weapons.some(
        (w) =>
          !exceptIds.has(w.id) &&
          g.members.some((m) =>
            excludedMembers?.[w.id]?.includes(m.characterKey)
          )
      )
    )
  const sameAs = (ids: string[], checkRestrictions = false) =>
    ids.length === excluded.size &&
    ids.every((id) => excluded.has(id)) &&
    (!checkRestrictions || !hasRestrictions(new Set(ids)))
  const below5 = all
    .filter((w) => getWeaponStat(w.key).rarity < 5)
    .map((w) => w.id)
  const below80 = all.filter((w) => w.level < 80).map((w) => w.id)
  const picks = [
    {
      key: 'all',
      label: t('teamOpt.weapons.all', 'All'),
      ids: [],
      clearAll: true,
    },
    {
      key: '5',
      label: t('teamOpt.weapons.fiveStar', 'Only 5★'),
      ids: below5,
      clearAll: false,
    },
    {
      key: '80',
      label: t('teamOpt.weapons.leveled', 'Level 80 and up'),
      ids: below80,
      clearAll: false,
    },
    // none ticked: a start for ticking only the few wanted
    {
      key: 'none',
      label: t('teamOpt.weapons.pickNone', 'None'),
      ids: all.map((w) => w.id),
      clearAll: true,
    },
  ]
  const allowedCount = groups.reduce(
    (n, g) =>
      n +
      g.weapons.filter((w) =>
        isWeaponTicked(w.id, g.members, excluded, excludedMembers)
      ).length,
    0
  )
  // (rows come in batches: the first screenful at once, the rest a batch per frame)
  const shown = useBatches(ready ? all.length : 0, 24, 12)
  let left = shown
  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'md' }}
      // (over the run dialog, already dimmed: a light backdrop, not a second dark one)
      slotProps={stackedBackdrop}
    >
      <CardThemed sx={floatSx}>
        <DialogHead
          title={t('teamOpt.weapons.title', 'Weapons to choose from')}
          info={
            calcEnergy
              ? t(
                  'teamOpt.weapons.descCalc',
                  'Each member tries the ticked weapons allowed for them, along with their artifacts. A passive counts only when it is on for that character. ER is calculated per weapon by the ER calculator: click ⚡ on Favonius or an energy weapon to view its savings or adjust its triggers.'
                )
              : t(
                  'teamOpt.weapons.desc',
                  'Each member tries the ticked weapons allowed for them, along with their artifacts. A passive counts only when it is on for that character. An energy weapon in the team lowers each member’s Energy Recharge requirement by what you set for them: click ⚡ on it.'
                )
          }
          actions={
            <Typography sx={{ ...typo.label, ...numSx, whiteSpace: 'nowrap' }}>
              {t('teamOpt.weapons.groupCount', {
                defaultValue: '{{allowed}} of {{total}}',
                allowed: allowedCount,
                total: all.length,
              })}
            </Typography>
          }
          onClose={onClose}
        />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 0.75,
            px: { xs: 1.5, sm: 2.5 },
            py: 1.25,
            borderBottom: hairline,
          }}
        >
          {picks.map((p) => (
            <Pill
              key={p.key}
              selected={sameAs(p.ids, p.key === 'all')}
              onClick={() =>
                setExcluded(
                  p.ids,
                  p.clearAll ? all.map((w) => w.id) : undefined
                )
              }
            >
              {p.label}
            </Pill>
          ))}
          {calcEnergy && (
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
              <Tooltip
                arrow
                title={t(
                  'teamOpt.weapons.calcModeTip',
                  'ER requirements are recalculated per weapon by the ER calculator (including Favonius). Click ⚡ on Favonius or an energy weapon to adjust its triggers, or open the ER calculator.'
                )}
              >
                <ButtonBase
                  onClick={openCalculator}
                  disabled={!openCalculator}
                  sx={(theme) => ({
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    height: 28,
                    px: 1.125,
                    borderRadius: tokens.radius.pill,
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: 'text.secondary',
                    bgcolor: alpha(theme.palette.text.primary, 0.05),
                    border: hairline,
                    ...quickSx,
                    ...focusSx,
                    ...(openCalculator && {
                      '&:hover': {
                        color: 'text.primary',
                        bgcolor: alpha(theme.palette.text.primary, 0.09),
                        borderColor: tokens.hairlineStrong,
                      },
                    }),
                  })}
                >
                  <BoltIcon sx={{ fontSize: 14, color: 'primary.main' }} />
                  {t('teamOpt.kqm.erFromCalc', 'ER from the calculator')}
                </ButtonBase>
              </Tooltip>
            </Box>
          )}
        </Box>
        <Box
          sx={{
            px: { xs: 1.5, sm: 2.5 },
            py: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            maxHeight: { xs: 'calc(100dvh - 170px)', sm: '70vh' },
            overflowY: 'auto',
          }}
        >
          {!ready &&
            groups.map((group) => (
              <Box key={group.type}>
                <Skeleton variant="text" width={180} height={34} />
                <Box sx={{ mt: 1, ...rowGridSx }}>
                  {group.weapons.slice(0, 6).map((w) => (
                    <Skeleton
                      key={w.id}
                      variant="rounded"
                      height={98}
                      sx={{ borderRadius: tokens.radius.inset }}
                    />
                  ))}
                </Box>
              </Box>
            ))}
          {ready &&
            groups.map((group) => {
              const visible = Math.max(0, Math.min(group.weapons.length, left))
              left -= group.weapons.length
              return (
                <WeaponGroup
                  key={group.type}
                  {...group}
                  visible={visible}
                  teamData={teamData}
                  excluded={excluded}
                  excludedMembers={excludedMembers}
                  onToggle={(weapon) => toggle(weapon, group.members)}
                  onToggleMember={(weapon, characterKey) =>
                    toggleMember(weapon, group.members, characterKey)
                  }
                  onTickAll={(tick) => {
                    const ids = new Set(group.weapons.map((w) => w.id))
                    setExcluded(
                      [
                        ...clicked.excludedWeapons.filter((id) => !ids.has(id)),
                        ...(tick ? [] : ids),
                      ],
                      ids
                    )
                  }}
                  teamMembers={members}
                  weaponEnergy={teamOpt.weaponEnergy}
                  setWeaponEnergy={(id, characterKey, value) =>
                    setTeamOpt((o) => {
                      const perMember = { ...o.weaponEnergy[id] }
                      if (value > 0) perMember[characterKey] = value
                      else delete perMember[characterKey]
                      if (Object.keys(perMember).length)
                        o.weaponEnergy[id] = perMember
                      else delete o.weaponEnergy[id]
                    })
                  }
                  memberMinEr={memberMinEr}
                  calcEnergy={calcEnergy}
                  onOpenCalculator={openCalculator}
                  typeName={t(
                    `page_weapon:weaponType.${group.type}`,
                    group.type
                  )}
                />
              )
            })}
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

/** Weapon cards side by side (one column on phones) */
const rowGridSx = {
  display: 'grid',
  gap: 1,
  alignItems: 'stretch',
  gridTemplateColumns: {
    xs: 'minmax(0, 1fr)',
    sm: 'repeat(2, minmax(0, 1fr))',
  },
} as const

/** A weapon type: its weapons, and (passives being per character) whose passives are shown */
export function WeaponGroup({
  type,
  typeName,
  members,
  teamMembers,
  weapons,
  allWeapons,
  teamData,
  excluded,
  excludedMembers,
  lockedMembers,
  onToggle,
  onToggleMember,
  onTickAll,
  weaponEnergy,
  setWeaponEnergy,
  memberMinEr,
  calcEnergy,
  onOpenCalculator,
  virtual = false,
  tooFew,
  minTicked,
  note,
  sourceOf,
  onRefinement,
  visible,
  selectionCounts,
}: {
  /** Fewer ticked than this shows `tooFew` (default: one per member, KQM's one) */
  minTicked?: number
  /** A line under the header */
  note?: ReactNode
  selectionCounts?: { allowed: number; total: number }
  /** Only the first rows are rendered (the rest come in later batches) */
  visible?: number
  /** Weapons that are not the inventory's (KQM mode's): no adding, deleting or wielders */
  virtual?: boolean
  sourceOf?: (weapon: ICachedWeapon) => ReactNode
  onRefinement?: (weapon: ICachedWeapon, refinement: number) => void
  /** The warning when fewer are ticked than members wield the type (default: Team Optimize's) */
  tooFew?: string
  type: WeaponTypeKey
  typeName: ReactNode
  /** The members who wield this type */
  members: TeamOptMember[]
  teamMembers: TeamOptMember[]
  weapons: ICachedWeapon[]
  /** Unfiltered weapons of this type (used for counts and warnings while searching) */
  allWeapons?: ICachedWeapon[]
  teamData: TeamData | undefined
  excluded: Set<string>
  /** Per weapon id, members excluded from wielding it */
  excludedMembers?: Record<string, readonly CharacterKey[] | undefined>
  /** Members locked to a single weapon (KQM mode) */
  lockedMembers?: Partial<Record<CharacterKey, WeaponKey>>
  onToggle: (weapon: ICachedWeapon) => void
  onToggleMember?: (weapon: ICachedWeapon, characterKey: CharacterKey) => void
  /** Ticks (or unticks) every weapon of the type at once (absent: no All/None for the type) */
  onTickAll?: (tick: boolean) => void
  weaponEnergy: TeamOpt['weaponEnergy']
  setWeaponEnergy: (
    weaponId: string,
    characterKey: CharacterKey,
    value: number
  ) => void
  /** Manual Min ER per member (used in manual energy mode to preview reduced ER) */
  memberMinEr?: Partial<Record<CharacterKey, number>>
  /** ER calculator config when ER is calculated per weapon (replaces manual weaponEnergy UI) */
  calcEnergy?: WeaponCalcEnergyConfig
  /** Opens the ER calculator drawer/tab (offered as a shortcut in manual energy panels) */
  onOpenCalculator?: () => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const pool = allWeapons ?? weapons
  const isAllowedFor = (ck: CharacterKey, weaponId: string) =>
    !excluded.has(weaponId) && !excludedMembers?.[weaponId]?.includes(ck)
  const ticked =
    selectionCounts?.allowed ??
    pool.filter((w) => isWeaponTicked(w.id, members, excluded, excludedMembers))
      .length
  const memberCounts = useMemo(
    () =>
      Object.fromEntries(
        members.map((m) => [
          m.characterKey,
          pool.filter(
            (w) =>
              !excluded.has(w.id) &&
              !excludedMembers?.[w.id]?.includes(m.characterKey)
          ).length,
        ])
      ) as Partial<Record<CharacterKey, number>>,
    [members, pool, excluded, excludedMembers]
  )
  const unlocked = members.filter((m) => !lockedMembers?.[m.characterKey])
  const emptyMembers = unlocked.filter(
    (m) => (memberCounts[m.characterKey] ?? 0) === 0
  )
  const canAssign = virtual
    ? emptyMembers.length === 0
    : canAssignTeamWeapons(
        unlocked.map((m) => m.characterKey),
        pool,
        isAllowedFor
      )
  const tooFewTicked =
    emptyMembers.length > 0 ||
    (minTicked !== undefined ? ticked < minTicked : !canAssign)
  const allUnrestricted =
    ticked === pool.length &&
    pool.every((w) => !excludedMembers?.[w.id]?.length)
  return (
    <Box component="section">
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          minHeight: 32,
          mb: 1,
        }}
      >
        <ImgIcon size={1.5} src={imgAssets.weaponTypes?.[type]} />
        <Typography component="h3" sx={typo.title}>
          {typeName}
        </Typography>
        {/* the members who wield this type (with per-member counts when 2+ share the type) */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          {members.map((m) => {
            const count = memberCounts[m.characterKey] ?? 0
            const lockedKey = lockedMembers?.[m.characterKey]
            const showCount = members.length > 1 && !!onToggleMember
            const warn = showCount && !lockedKey && count === 0
            if (!showCount)
              return (
                <MemberAvatar
                  key={m.characterKey}
                  characterKey={m.characterKey}
                  size={22}
                />
              )
            return (
              <SuspenseTooltip
                key={m.characterKey}
                arrow
                title={
                  <>
                    <CharacterName
                      characterKey={m.characterKey}
                      gender={gender}
                    />
                    {': '}
                    {lockedKey ? (
                      <>
                        {t('teamOpt.kqm.weaponLockedShort', 'locked to')}{' '}
                        <WeaponName weaponKey={lockedKey} />
                      </>
                    ) : (
                      t('teamOpt.weapons.memberAllowedCount', {
                        defaultValue_one: '{{count}} weapon allowed',
                        defaultValue_other: '{{count}} weapons allowed',
                        count,
                      })
                    )}
                  </>
                }
              >
                <Box
                  component="span"
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.375,
                    pr: 0.75,
                    pl: 0.25,
                    height: 24,
                    borderRadius: tokens.radius.pill,
                    border: hairline,
                    bgcolor: tokens.inset,
                    fontSize: 12,
                    fontWeight: 600,
                    ...numSx,
                    color: warn ? 'warning.main' : 'text.secondary',
                    ...(warn && {
                      borderColor: (theme) =>
                        alpha(theme.palette.warning.main, 0.5),
                    }),
                  }}
                >
                  <MemberAvatar characterKey={m.characterKey} size={18} />
                  {lockedKey ? (
                    <LockOutlinedIcon
                      sx={{ fontSize: 12, color: 'primary.main' }}
                    />
                  ) : (
                    count
                  )}
                </Box>
              </SuspenseTooltip>
            )
          })}
        </Box>
        <Box sx={{ flexGrow: 1 }} />
        {/* the type's own quick picks: every weapon of it, or none (to tick a few) */}
        {onTickAll && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Pill selected={allUnrestricted} onClick={() => onTickAll(true)}>
              {t('teamOpt.weapons.all', 'All')}
            </Pill>
            <Pill selected={ticked === 0} onClick={() => onTickAll(false)}>
              {t('teamOpt.weapons.pickNone', 'None')}
            </Pill>
          </Box>
        )}
        <Typography
          sx={{
            ...typo.label,
            ...numSx,
            color: tooFewTicked ? 'warning.main' : 'text.secondary',
          }}
        >
          {t('teamOpt.weapons.groupCount', {
            defaultValue: '{{allowed}} of {{total}}',
            allowed: ticked,
            total: selectionCounts?.total ?? weapons.length,
          })}
        </Typography>
        {!virtual && <AddWeaponButton type={type} />}
      </Box>
      {note && (
        <Box sx={{ ...typo.label, fontWeight: 400, mb: 1.5 }}>{note}</Box>
      )}
      {tooFewTicked && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            mb: 1,
            fontSize: 13,
            color: 'warning.main',
          }}
        >
          <WarningAmberRoundedIcon sx={{ fontSize: 16, flexShrink: 0 }} />
          <span>
            {emptyMembers.length > 0 && members.length > 1 ? (
              <>
                {emptyMembers.map((m, i) => (
                  <Fragment key={m.characterKey}>
                    {i > 0 && ', '}
                    <CharacterName
                      characterKey={m.characterKey}
                      gender={gender}
                    />
                  </Fragment>
                ))}
                {': '}
                {virtual
                  ? t(
                      'teamOpt.kqm.memberNoWeapon',
                      'select at least one weapon for them before generating builds.'
                    )
                  : t(
                      'teamOpt.weapons.memberNoWeapon',
                      'no weapons ticked for them — they keep their current weapon.'
                    )}
              </>
            ) : (
              (tooFew ??
              t(
                'teamOpt.weapons.tooFewTicked',
                'Tick one for each member: a member left without one keeps its current weapon.'
              ))
            )}
          </span>
        </Box>
      )}
      <Box sx={rowGridSx}>
        {(visible === undefined ? weapons : weapons.slice(0, visible)).map(
          (weapon) => (
            <WeaponRow
              key={weapon.id}
              weapon={weapon}
              allowed={isWeaponTicked(
                weapon.id,
                members,
                excluded,
                excludedMembers
              )}
              excludedFor={excludedMembers?.[weapon.id]}
              lockedMembers={lockedMembers}
              onToggle={() => onToggle(weapon)}
              onToggleMember={
                onToggleMember &&
                ((ck: CharacterKey) => onToggleMember(weapon, ck))
              }
              wielders={members}
              teamData={teamData}
              teamMembers={teamMembers}
              energy={weaponEnergy[weapon.id]}
              setEnergy={(characterKey, value) =>
                setWeaponEnergy(weapon.id, characterKey, value)
              }
              memberMinEr={memberMinEr}
              calcEnergy={calcEnergy}
              onOpenCalculator={onOpenCalculator}
              virtual={virtual}
              source={sourceOf?.(weapon)}
              onRefinement={
                onRefinement && ((r: number) => onRefinement(weapon, r))
              }
            />
          )
        )}
      </Box>
    </Box>
  )
}

export const isConditional = (
  section: unknown
): section is DocumentConditional =>
  !!section && typeof section === 'object' && 'states' in section

/**
 * Two weapon cards' props draw the same card: their values alike (handlers are left out: each
 * reads the latest settings when called), so a click redraws only the card it changed
 */
function sameWeaponRow(
  a: Parameters<typeof WeaponRowCard>[0],
  b: Parameters<typeof WeaponRowCard>[0]
) {
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key as keyof typeof a]
    const y = b[key as keyof typeof b]
    if (x === y) continue
    if (typeof x === 'function' && typeof y === 'function') continue
    if (
      (key === 'excludedFor' ||
        key === 'energy' ||
        key === 'lockedMembers' ||
        key === 'memberMinEr') &&
      JSON.stringify(x) === JSON.stringify(y)
    )
      continue
    return false
  }
  return true
}
const WeaponRow = memo(WeaponRowCard, sameWeaponRow)

function WeaponRowCard({
  weapon,
  allowed,
  excludedFor,
  lockedMembers,
  onToggle,
  onToggleMember,
  wielders,
  teamData,
  teamMembers,
  energy,
  setEnergy,
  memberMinEr,
  calcEnergy,
  onOpenCalculator,
  virtual = false,
  source,
  onRefinement,
}: {
  virtual?: boolean
  /** Where it comes from (KQM mode's weapons) */
  source?: ReactNode
  /** Its refinement can be chosen (KQM mode's weapons) */
  onRefinement?: (refinement: number) => void
  weapon: ICachedWeapon
  allowed: boolean
  /** Members excluded from using this weapon */
  excludedFor?: readonly CharacterKey[]
  /** Members locked to a single weapon (KQM mode) */
  lockedMembers?: Partial<Record<CharacterKey, WeaponKey>>
  onToggle: () => void
  onToggleMember?: (characterKey: CharacterKey) => void
  /** The members who could wield it: its passives are set for each */
  wielders: TeamOptMember[]
  teamData: TeamData | undefined
  teamMembers: TeamOptMember[]
  /** Per member, how much less Energy Recharge it needs with this weapon in the team */
  energy: Partial<Record<CharacterKey, number>> | undefined
  setEnergy: (characterKey: CharacterKey, value: number) => void
  memberMinEr?: Partial<Record<CharacterKey, number>>
  calcEnergy?: WeaponCalcEnergyConfig
  onOpenCalculator?: () => void
}) {
  const { t } = useTranslation('page_team')
  const nameId = useId()
  const { rarity } = getWeaponStat(weapon.key)
  // what it saves each member's Energy Recharge: opened from its ⚡
  const [energyOpen, setEnergyOpen] = useState(false)
  const passives = useMemo(
    () => (getWeaponSheet(weapon.key)?.document ?? []).filter(isConditional),
    [weapon.key]
  )
  const energySet = teamMembers.filter(
    ({ characterKey }) => (energy?.[characterKey] ?? 0) > 0
  )
  const isCalcWeapon = isFavonius(weapon.key) || isCalcEnergyWeapon(weapon.key)
  const isEnergy = calcEnergy
    ? isCalcWeapon
    : isEnergyWeapon(weapon.key) || !!energySet.length
  const allowedFor = (ck: CharacterKey) => allowed && !excludedFor?.includes(ck)
  // Wielders relevant for calculator ER impact: the allowed ones (or all if unticked)
  const calcWielders = useMemo(() => {
    const unlocked = wielders.filter(
      (m) =>
        !lockedMembers?.[m.characterKey] ||
        lockedMembers[m.characterKey] === weapon.key
    )
    const active = allowed
      ? unlocked.filter((m) => !excludedFor?.includes(m.characterKey))
      : unlocked
    return active.length ? active : wielders
  }, [wielders, lockedMembers, weapon.key, allowed, excludedFor])
  const teamKeys = useMemo(
    () => teamMembers.map((m) => m.characterKey),
    [teamMembers]
  )
  const calcImpacts = useMemo(() => {
    if (!calcEnergy || !isCalcWeapon || (!allowed && !energyOpen)) return []
    return calcWielders.map((m) => ({
      member: m,
      impact: weaponCalculatorImpact(
        teamKeys,
        calcEnergy.calculator,
        m.characterKey,
        weapon.key,
        weapon.refinement,
        calcEnergy.baseWeapons,
        calcEnergy.baseRefinements
      ),
    }))
  }, [
    calcEnergy,
    isCalcWeapon,
    allowed,
    energyOpen,
    calcWielders,
    teamKeys,
    weapon.key,
    weapon.refinement,
  ])
  const rowIcon = {
    color: 'text.disabled',
    ...quickSx,
    '[data-weapon-id]:hover &, [data-weapon-id]:focus-within &': {
      color: 'text.secondary',
    },
  }
  return (
    <Box
      data-weapon-id={weapon.id}
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        // (hundreds of cards: those out of view are not laid out, so a click lays out a few)
        contentVisibility: 'auto',
        containIntrinsicSize: 'auto 120px',
        borderRadius: tokens.radius.inset,
        bgcolor: tokens.inset,
        border: hairline,
        // (not ticked: quiet, readable again under the pointer)
        opacity: allowed ? 1 : 0.5,
        transition: 'opacity .12s, border-color .12s',
        '&:hover': {
          opacity: allowed ? 1 : 0.85,
          borderColor: alpha(theme.palette.text.primary, 0.14),
        },
        '&:focus-within': { opacity: 1 },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      })}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 0.75,
          pr: 0.5,
          py: 0.75,
        }}
      >
        <Checkbox
          size="small"
          checked={allowed}
          onChange={onToggle}
          sx={{ p: 0.5 }}
          inputProps={{ 'aria-labelledby': nameId }}
        />
        {/* (its picture and name tick it too) */}
        <Box
          component="img"
          src={weaponAsset(weapon.key, weapon.ascension >= 2)}
          alt=""
          onClick={onToggle}
          className={`grad-${rarity}star`}
          sx={{
            width: 38,
            height: 38,
            borderRadius: 1.5,
            flexShrink: 0,
            cursor: 'pointer',
          }}
        />
        <Box sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography
            id={nameId}
            onClick={onToggle}
            sx={{
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.35,
              minWidth: 0,
              cursor: 'pointer',
            }}
            noWrap
          >
            <WeaponName weaponKey={weapon.key} />
          </Typography>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              minHeight: 20,
              color: 'text.secondary',
              fontSize: 12.5,
              minWidth: 0,
              ...numSx,
            }}
          >
            {onRefinement ? (
              <Box
                component="span"
                sx={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <Select
                  variant="standard"
                  disableUnderline
                  value={weapon.refinement}
                  onChange={(e) => onRefinement(Number(e.target.value))}
                  inputProps={{
                    'aria-label': t('teamOpt.kqm.refinement', 'Refinement'),
                  }}
                  sx={{
                    fontSize: 12.5,
                    color: 'text.secondary',
                    '&:hover': { color: 'text.primary' },
                  }}
                >
                  {[1, 2, 3, 4, 5].map((r) => (
                    <MenuItem key={r} value={r}>
                      R{r}
                    </MenuItem>
                  ))}
                </Select>
              </Box>
            ) : (
              <Box component="span" sx={{ flexShrink: 0 }}>
                {t('teamOpt.weapons.levelRef', {
                  defaultValue: 'Lv. {{level}} · R{{refinement}}',
                  level: weapon.level,
                  refinement: weapon.refinement,
                })}
              </Box>
            )}
            {source && (
              <Box component="span" sx={{ flexShrink: 0 }}>
                · {source}
              </Box>
            )}
            {/* (on this line, so that the name keeps its room) */}
            {isEnergy &&
              (calcEnergy ? (
                <CalcEnergyTag
                  weapon={weapon}
                  allowed={allowed}
                  wielders={calcWielders}
                  impacts={calcImpacts}
                  calculator={calcEnergy.calculator}
                  open={energyOpen}
                  onClick={() => setEnergyOpen((o) => !o)}
                />
              ) : (
                <EnergyTag
                  members={energySet}
                  energy={energy}
                  open={energyOpen}
                  onClick={() => setEnergyOpen((o) => !o)}
                />
              ))}
            {weapon.location && !virtual && (
              <>
                <span>·</span>
                <WielderButton weapon={weapon} />
              </>
            )}
          </Box>
        </Box>
        {!virtual && <RemoveWeaponButton weapon={weapon} iconSx={rowIcon} />}
        {!calcEnergy && !isEnergy && (
          <Tooltip
            arrow
            title={t(
              'teamOpt.weapons.energyAdd',
              'Gives energy: set how much less Energy Recharge each member needs'
            )}
          >
            <IconButton
              size="small"
              onClick={() => setEnergyOpen((o) => !o)}
              aria-expanded={energyOpen}
              aria-label={t('teamOpt.weapons.energy', 'Energy')}
              sx={{
                ...rowIcon,
                ...(energyOpen && { color: 'text.primary' }),
                '&:hover': { color: 'text.primary' },
              }}
            >
              <BoltIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {/* When 2+ team members share this weapon type: limit who may equip this weapon */}
      {wielders.length > 1 && onToggleMember && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.375,
            minHeight: 36,
            borderTop: hairline,
            bgcolor: (theme) => alpha(theme.palette.text.primary, 0.02),
          }}
        >
          <FieldLabel
            tip={t(
              'teamOpt.weapons.usableByTip',
              'Who may equip this weapon. Click a character to allow or exclude them.'
            )}
            sx={{ fontSize: 12.5, flex: '1 1 auto' }}
          >
            {t('teamOpt.weapons.usableBy', 'Usable by')}
          </FieldLabel>
          <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, ml: 'auto' }}>
            {wielders.map((member) => {
              const lockedKey = lockedMembers?.[member.characterKey]
              const on = lockedKey
                ? lockedKey === weapon.key
                : allowedFor(member.characterKey)
              return (
                <UsableAvatarToggle
                  key={member.characterKey}
                  member={member}
                  weaponKey={weapon.key}
                  on={on}
                  locked={lockedKey}
                  onClick={() => onToggleMember(member.characterKey)}
                />
              )
            })}
          </Box>
        </Box>
      )}
      {/* (on every card, so that cards side by side line up) */}
      <Box
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          px: 1.5,
          py: 0.5,
          borderTop: hairline,
        }}
      >
        <PassiveLines
          weaponKey={weapon.key}
          passives={passives}
          wielders={wielders}
          data={wielders[0] && teamData?.[wielders[0].characterKey]?.target}
        />
      </Box>
      <Collapse in={energyOpen} timeout={180} unmountOnExit>
        <Box sx={{ px: 1.5, py: 1, borderTop: hairline }}>
          {calcEnergy && isCalcWeapon ? (
            <CalcWeaponEnergy
              weapon={weapon}
              wielders={calcWielders}
              teamMembers={teamMembers}
              impacts={calcImpacts}
              calcEnergy={calcEnergy}
            />
          ) : (
            <TeamEnergy
              members={teamMembers}
              energy={energy}
              setEnergy={setEnergy}
              memberMinEr={memberMinEr}
              onOpenCalculator={onOpenCalculator}
            />
          )}
        </Box>
      </Collapse>
    </Box>
  )
}

/** Per-weapon member allow/exclude toggle button (aligned with passive toggles below) */
function UsableAvatarToggle({
  member,
  weaponKey,
  on,
  locked,
  onClick,
}: {
  member: TeamOptMember
  weaponKey: WeaponKey
  on: boolean
  locked?: WeaponKey
  onClick: () => void
}) {
  const { t } = useTranslation([
    'page_team',
    'charNames_gen',
    'weaponNames_gen',
  ])
  const { gender } = useDBMeta()
  const charLabel = t(
    `charNames_gen:${member.characterKey}`,
    member.characterKey
  )
  const weaponLabel = t(`weaponNames_gen:${weaponKey}`, weaponKey)
  return (
    <SuspenseTooltip
      arrow
      title={
        <>
          <CharacterName characterKey={member.characterKey} gender={gender} />
          {': '}
          {locked ? (
            <>
              {t('teamOpt.kqm.weaponLockedShort', 'locked to')}{' '}
              <WeaponName weaponKey={locked} />
            </>
          ) : on ? (
            t('teamOpt.weapons.usableOn', 'allowed — click to exclude')
          ) : (
            t('teamOpt.weapons.usableOff', 'excluded — click to allow')
          )}
        </>
      }
    >
      <span style={{ display: 'inline-flex' }}>
        <ButtonBase
          disabled={!!locked}
          onClick={onClick}
          aria-pressed={on}
          aria-label={t('teamOpt.weapons.usableByAria', {
            defaultValue: 'Allow {{character}} to use {{weapon}}',
            character: charLabel,
            weapon: weaponLabel,
          })}
          data-usable-member={member.characterKey}
          sx={(theme) => ({
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: '50%',
            border: on
              ? `1.5px solid ${theme.palette.primary.main}`
              : `1px dashed ${tokens.hairlineStrong}`,
            backgroundColor: on
              ? alpha(theme.palette.primary.main, 0.16)
              : 'transparent',
            opacity: locked ? 0.45 : on ? 1 : 0.35,
            filter: on ? 'none' : 'grayscale(1)',
            transition:
              'opacity .12s, border-color .12s, background-color .12s',
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            '&:hover': { opacity: locked ? 0.45 : on ? 1 : 0.8 },
            '&.Mui-focusVisible': {
              outline: `2px solid ${tokens.gold}`,
              outlineOffset: 1,
            },
          })}
        >
          <MemberAvatar characterKey={member.characterKey} size={22} />
        </ButtonBase>
      </span>
    </SuspenseTooltip>
  )
}

/** Energy tag in ER calculator mode: shows live ER savings, or "0 triggers" if not yet configured */
function CalcEnergyTag({
  weapon,
  allowed,
  wielders,
  impacts,
  calculator,
  open,
  onClick,
}: {
  weapon: ICachedWeapon
  allowed: boolean
  wielders: TeamOptMember[]
  impacts: { member: TeamOptMember; impact?: WeaponCalculatorImpact }[]
  calculator: TeamOptEnergyCalculator
  open: boolean
  onClick: () => void
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const { gender } = useDBMeta()
  const fav = isFavonius(weapon.key)
  const perBurst = energyWeaponPerBurst(weapon.key)
  const triggersOf = (ck: CharacterKey) => {
    const m = calculator.members[ck]
    if (!m) return 0
    if (fav) return m.favoniusProcs
    if (perBurst) return m.burstEvery > 0 ? 1 / m.burstEvery : 0
    return (m.weaponEnergyTriggers ?? 0) > 0
      ? m.weaponEnergyTriggers
      : (m.weaponTriggers?.[weapon.key] ?? 0)
  }
  const anyTriggers = wielders.some((m) => triggersOf(m.characterKey) > 0)
  const singleChanges =
    impacts.length === 1 ? (impacts[0]?.impact?.changes ?? []) : []
  const warnZero = allowed && !perBurst && !anyTriggers
  const tooltip = (
    <Box sx={{ py: 0.25 }}>
      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block' }}>
        {t(
          'teamOpt.weapons.calcEnergyTitle',
          'Calculated by the ER calculator'
        )}
      </Typography>
      {impacts.map(({ member, impact }) => (
        <Typography
          key={member.characterKey}
          variant="caption"
          component="div"
          sx={{ color: 'text.secondary', ...numSx }}
        >
          <CharacterName characterKey={member.characterKey} gender={gender} />
          {': '}
          {impact?.changes.length
            ? impact.changes
                .map(
                  ({ characterKey: ck, to, diff }) =>
                    `${t(`charNames_gen:${ck}`, ck)} ${to}% (−${diff}%)`
                )
                .join(', ')
            : !perBurst && triggersOf(member.characterKey) <= 0
              ? t('teamOpt.weapons.zeroTriggersShort', '0 triggers')
              : t('teamOpt.weapons.noErChangeShort', 'no ER change')}
        </Typography>
      ))}
      <Typography
        variant="caption"
        component="div"
        sx={{ mt: 0.5, color: 'text.secondary' }}
      >
        {t(
          'teamOpt.weapons.calcEnergyClickHint',
          'Click to view ER impact or adjust triggers.'
        )}
      </Typography>
    </Box>
  )
  return (
    <Tooltip arrow title={tooltip}>
      <ButtonBase
        onClick={onClick}
        aria-expanded={open}
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          height: 20,
          px: 0.75,
          borderRadius: 1,
          fontSize: 12,
          fontWeight: 600,
          ...numSx,
          color: warnZero
            ? 'warning.main'
            : singleChanges.length || open
              ? 'text.primary'
              : 'text.secondary',
          backgroundColor: warnZero
            ? alpha(theme.palette.warning.main, 0.14)
            : alpha(theme.palette.text.primary, open ? 0.12 : 0.07),
          flexShrink: 0,
          ...quickSx,
          ...focusSx,
          '&:hover': {
            color: warnZero ? 'warning.light' : 'text.primary',
            backgroundColor: warnZero
              ? alpha(theme.palette.warning.main, 0.2)
              : alpha(theme.palette.text.primary, 0.12),
          },
        })}
      >
        <BoltIcon sx={{ fontSize: 13 }} />
        {singleChanges.length > 0
          ? singleChanges.map(({ characterKey, diff }) => (
              <Box
                key={characterKey}
                component="span"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
              >
                <MemberAvatar characterKey={characterKey} size={14} />
                {`−${diff}`}
              </Box>
            ))
          : warnZero
            ? t('teamOpt.weapons.zeroTriggersShort', '0 triggers')
            : t('teamOpt.weapons.calcTag', 'ER calc')}
      </ButtonBase>
    </Tooltip>
  )
}

/** Inline ER calculator controls on an energy/Favonius weapon card (synced directly to ER calculator) */
function CalcWeaponEnergy({
  weapon,
  wielders,
  teamMembers,
  impacts,
  calcEnergy,
}: {
  weapon: ICachedWeapon
  wielders: TeamOptMember[]
  teamMembers: TeamOptMember[]
  impacts: { member: TeamOptMember; impact?: WeaponCalculatorImpact }[]
  calcEnergy: WeaponCalcEnergyConfig
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const { gender } = useDBMeta()
  const fav = isFavonius(weapon.key)
  const perBurst = energyWeaponPerBurst(weapon.key)
  const { calculator, updateMember, onOpenCalculator } = calcEnergy
  const impactByKey = new Map(
    impacts.map((x) => [x.member.characterKey, x.impact])
  )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <FieldLabel
          tip={t(
            'teamOpt.weapons.calcPanelTip',
            'Recalculated per build by the ER calculator whenever this member holds this weapon. Changes here update the ER calculator directly.'
          )}
        >
          {t('teamOpt.weapons.calcPanelTitle', 'ER calculator (per build)')}
        </FieldLabel>
        {onOpenCalculator && (
          <Button
            size="small"
            color="inherit"
            startIcon={
              <CalculateOutlinedIcon sx={{ fontSize: '14px !important' }} />
            }
            onClick={onOpenCalculator}
            sx={{
              minHeight: 24,
              py: 0,
              px: 0.75,
              fontSize: 12,
              color: 'text.secondary',
              '&:hover': { color: 'text.primary' },
            }}
          >
            {t('teamOpt.kqm.calc.tab', 'ER calculator')}
          </Button>
        )}
      </Box>
      {wielders.map((member) => {
        const ck = member.characterKey
        const calcMember = calculator.members[ck]
        if (!calcMember) return null
        const impact = impactByKey.get(ck)
        const triggers = fav
          ? calcMember.favoniusProcs
          : (calcMember.weaponEnergyTriggers ?? 0) > 0
            ? calcMember.weaponEnergyTriggers
            : (calcMember.weaponTriggers?.[weapon.key] ?? 0)
        const caughtShares =
          fav &&
          !calcMember.edited?.includes('favoniusCatchBy') &&
          calcMember.favoniusCatchShares
            ? Object.entries(calcMember.favoniusCatchShares).filter(
                ([k, v]) =>
                  teamMembers.some((m) => m.characterKey === k) && (v ?? 0) > 0
              )
            : []
        const sharesTotal = caughtShares.reduce((s, [, v]) => s + (v ?? 0), 0)
        return (
          <Box
            key={ck}
            sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 0.75,
              }}
            >
              <Box
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  minWidth: 0,
                }}
              >
                <MemberAvatar characterKey={ck} size={20} />
                {wielders.length > 1 && (
                  <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
                    <CharacterName characterKey={ck} gender={gender} />
                  </Typography>
                )}
              </Box>
              {perBurst ? (
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  {t(
                    'teamOpt.weapons.perBurstAuto',
                    'Counts automatically on each Burst'
                  )}
                </Typography>
              ) : (
                <CompactTriggerStepper
                  value={triggers}
                  ariaLabel={t('teamOpt.weapons.triggersAria', {
                    defaultValue: '{{character}} triggers per rotation',
                    character: ck,
                  })}
                  onChange={(next) => {
                    if (fav) updateMember(ck, { favoniusProcs: next })
                    else updateMember(ck, { weaponEnergyTriggers: next })
                  }}
                />
              )}
              {fav && (
                <>
                  <Typography
                    sx={{
                      fontSize: 12,
                      color: 'text.secondary',
                      flexShrink: 0,
                    }}
                  >
                    {t('teamOpt.kqm.calc.caughtBy', 'caught by')}
                  </Typography>
                  <Select
                    size="small"
                    value={calcMember.favoniusCatchBy ?? ck}
                    onChange={(e) =>
                      updateMember(ck, {
                        favoniusCatchBy: e.target.value as CharacterKey,
                      })
                    }
                    inputProps={{
                      'aria-label': `${ck}: ${t('teamOpt.kqm.calc.favCatcher', 'Favonius catcher')}`,
                    }}
                    sx={{
                      height: 28,
                      fontSize: 12.5,
                      borderRadius: tokens.radius.control,
                      '& .MuiSelect-select': {
                        py: 0,
                        display: 'flex',
                        alignItems: 'center',
                      },
                    }}
                  >
                    {teamMembers.map((m) => (
                      <MenuItem key={m.characterKey} value={m.characterKey}>
                        <Box
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.75,
                          }}
                        >
                          <MemberAvatar
                            characterKey={m.characterKey}
                            size={18}
                          />
                          <CharacterName
                            characterKey={m.characterKey}
                            gender={gender}
                          />
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </>
              )}
            </Box>
            {caughtShares.length >= 2 && sharesTotal > 0 && (
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>
                {t('teamOpt.kqm.calc.asPlayed', {
                  defaultValue: 'As played: {{shares}}',
                  shares: caughtShares
                    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
                    .map(
                      ([k, v]) =>
                        `${t(`charNames_gen:${k}`, k)} ${Math.round(((v ?? 0) / sharesTotal) * 100)}%`
                    )
                    .join(' · '),
                })}
              </Typography>
            )}
            <Typography
              sx={{ fontSize: 12, color: 'text.secondary', ...numSx }}
            >
              {impact?.changes.length ? (
                impact.changes.map(
                  ({ characterKey: rec, from, to, diff }, i) => (
                    <Fragment key={rec}>
                      {i > 0 && ' · '}
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.375,
                        }}
                      >
                        <MemberAvatar characterKey={rec} size={14} />
                        <span>
                          {from}% →{' '}
                          <Box
                            component="span"
                            sx={{ color: 'text.primary', fontWeight: 600 }}
                          >
                            {to}%
                          </Box>{' '}
                          (−{diff}%)
                        </span>
                      </Box>
                    </Fragment>
                  )
                )
              ) : !perBurst && triggers <= 0 ? (
                <Box component="span" sx={{ color: 'warning.main' }}>
                  {t(
                    'teamOpt.weapons.setTriggersHint',
                    'Set triggers above 0 to count this weapon’s energy.'
                  )}
                </Box>
              ) : (
                t(
                  'teamOpt.weapons.allAtBaseEr',
                  'No ER saved (all members already at 100% ER).'
                )
              )}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

/** Compact trigger count stepper (supports decimals and clearing while typing) */
function CompactTriggerStepper({
  value,
  ariaLabel,
  onChange,
}: {
  value: number
  ariaLabel: string
  onChange: (value: number) => void
}) {
  const [text, setText] = useState(`${+value.toFixed(2)}`)
  useEffect(() => setText(`${+value.toFixed(2)}`), [value])
  const step = (delta: number) =>
    onChange(Math.max(0, Math.round((value + delta) * 100) / 100))
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        height: 28,
        px: 0.25,
        borderRadius: tokens.radius.control,
        border: hairline,
        bgcolor: (theme) => alpha(theme.palette.text.primary, 0.03),
      }}
    >
      <IconButton
        size="small"
        disabled={value <= 0}
        aria-label={`${ariaLabel} −1`}
        onClick={() => step(-1)}
        sx={{ p: 0.25, color: 'text.secondary' }}
      >
        <RemoveIcon sx={{ fontSize: 14 }} />
      </IconButton>
      <InputBase
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value.replace(',', '.'))
          if (e.target.value.trim() && Number.isFinite(n) && n >= 0) onChange(n)
        }}
        onBlur={() => setText(`${+value.toFixed(2)}`)}
        inputProps={{
          inputMode: 'decimal',
          'aria-label': ariaLabel,
          style: { textAlign: 'center', padding: 0 },
        }}
        startAdornment={
          <Box
            component="span"
            sx={{ ...typo.label, fontSize: 11.5, mr: 0.25 }}
          >
            ×
          </Box>
        }
        sx={{ width: 42, fontSize: 12.5, fontWeight: 600, ...numSx }}
      />
      <IconButton
        size="small"
        aria-label={`${ariaLabel} +1`}
        onClick={() => step(1)}
        sx={{ p: 0.25, color: 'text.secondary' }}
      >
        <AddIcon sx={{ fontSize: 14 }} />
      </IconButton>
    </Box>
  )
}

/** An energy weapon's tag: what it saves each member (if set), opening its settings */
function EnergyTag({
  members,
  energy,
  open,
  onClick,
}: {
  /** The members it saves Energy Recharge */
  members: TeamOptMember[]
  energy: Partial<Record<CharacterKey, number>> | undefined
  /** Its settings are open */
  open?: boolean
  onClick: () => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Tooltip
      arrow
      title={
        members.length
          ? t(
              'teamOpt.weapons.energySetHint',
              'Less Energy Recharge each member needs while someone in the team wields it. Click to change.'
            )
          : t(
              'teamOpt.weapons.energyHint',
              'Gives energy or particles: click to set how much less Energy Recharge each member needs with it in the team.'
            )
      }
    >
      <ButtonBase
        onClick={onClick}
        aria-expanded={open}
        sx={(theme) => ({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          height: 20,
          px: 0.75,
          borderRadius: 1,
          fontSize: 12,
          fontWeight: 600,
          ...numSx,
          color: members.length || open ? 'text.primary' : 'text.secondary',
          backgroundColor: alpha(
            theme.palette.text.primary,
            open ? 0.12 : 0.07
          ),
          flexShrink: 0,
          ...quickSx,
          ...focusSx,
          '&:hover': {
            color: 'text.primary',
            backgroundColor: alpha(theme.palette.text.primary, 0.12),
          },
        })}
      >
        <BoltIcon sx={{ fontSize: 13 }} />
        {members.length
          ? members.map(({ characterKey }) => (
              <Box
                key={characterKey}
                component="span"
                sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
              >
                <MemberAvatar characterKey={characterKey} size={14} />
                {`−${energy?.[characterKey]}`}
              </Box>
            ))
          : t('teamOpt.weapons.energy', 'Energy')}
      </ButtonBase>
    </Tooltip>
  )
}

/**
 * What an energy weapon saves each member (manual ER mode): its particles or energy reach the
 * whole team, each member differently, so each gets its own Energy Recharge reduction, with a
 * live preview of their resulting Min ER and a shortcut to the ER calculator.
 */
function TeamEnergy({
  members,
  energy,
  setEnergy,
  memberMinEr,
  onOpenCalculator,
}: {
  members: TeamOptMember[]
  energy: Partial<Record<CharacterKey, number>> | undefined
  setEnergy: (characterKey: CharacterKey, value: number) => void
  memberMinEr?: Partial<Record<CharacterKey, number>>
  onOpenCalculator?: () => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
        }}
      >
        <FieldLabel
          tip={t(
            'teamOpt.weapons.teamEnergyHint',
            'How much less Energy Recharge each member needs while someone in the team wields this weapon.'
          )}
        >
          {t('teamOpt.weapons.lessEr', 'Less ER')}
        </FieldLabel>
        {onOpenCalculator && (
          <Tooltip
            arrow
            title={t(
              'teamOpt.weapons.useCalculatorTip',
              'Calculate Favonius and energy weapon ER automatically instead of entering reductions by hand.'
            )}
          >
            <Button
              size="small"
              color="inherit"
              startIcon={
                <CalculateOutlinedIcon sx={{ fontSize: '14px !important' }} />
              }
              onClick={onOpenCalculator}
              sx={{
                minHeight: 24,
                py: 0,
                px: 0.75,
                fontSize: 12,
                color: 'text.secondary',
                '&:hover': { color: 'text.primary' },
              }}
            >
              {t('teamOpt.kqm.calc.open', 'Calculate ER')}
            </Button>
          </Tooltip>
        )}
      </Box>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(156px, 1fr))',
          gap: 0.75,
        }}
      >
        {members.map((member) => (
          <MemberEnergy
            key={member.characterKey}
            member={member}
            value={energy?.[member.characterKey] ?? 0}
            minEr={memberMinEr?.[member.characterKey]}
            setValue={(value) => setEnergy(member.characterKey, value)}
          />
        ))}
      </Box>
    </Box>
  )
}

/** A member's avatar, ER reduction input (−X%), and live resulting Min ER preview */
function MemberEnergy({
  member: { characterKey, teamChar },
  value,
  minEr,
  setValue,
}: {
  member: TeamOptMember
  value: number
  minEr?: number
  setValue: (value: number) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const optConfig = useOptConfig(teamChar.optConfigId)
  const effectiveMinEr =
    minEr ??
    optConfig?.statFilters[ER_FILTER_PATH]?.find((f) => !f.disabled)?.value
  const needsEnergy =
    (effectiveMinEr !== undefined && effectiveMinEr > 100) ||
    hasEnergyRequirement(optConfig?.statFilters)
  const reduced =
    effectiveMinEr !== undefined && effectiveMinEr > 100
      ? Math.max(100, Math.round((effectiveMinEr - value) * 10) / 10)
      : undefined
  return (
    <Box
      component="label"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        minWidth: 0,
      }}
    >
      <SuspenseTooltip
        title={
          <>
            <CharacterName characterKey={characterKey} gender={gender} />
            {!needsEnergy &&
              t(
                'teamOpt.weapons.noEnergyNeedHint',
                ': no Min ER set yet — set Min ER on this member to apply this reduction'
              )}
          </>
        }
      >
        <Box
          sx={{
            display: 'flex',
            flexShrink: 0,
            opacity: needsEnergy ? 1 : 0.45,
            filter: needsEnergy ? 'none' : 'grayscale(1)',
          }}
        >
          <MemberAvatar characterKey={characterKey} size={22} />
        </Box>
      </SuspenseTooltip>
      <NumberInputLazy
        size="small"
        float
        // Positive input with a − prefix; typing 26 or -26 both mean 26% less
        value={value}
        onChange={(v) => setValue(Math.min(Math.abs(v), 500))}
        InputProps={{
          startAdornment: (
            <InputAdornment
              position="start"
              sx={{
                mr: 0.25,
                '& .MuiTypography-root': {
                  fontSize: 12.5,
                  color: value > 0 ? 'text.primary' : 'text.disabled',
                },
              }}
            >
              −
            </InputAdornment>
          ),
          endAdornment: (
            <InputAdornment position="end" sx={{ ml: 0.25 }}>
              %
            </InputAdornment>
          ),
        }}
        inputProps={{
          'aria-label': t('teamOpt.weapons.lessErAria', {
            defaultValue: '{{character}} ER reduction (%)',
            character: characterKey,
          }),
          sx: {
            width: '3em',
            textAlign: 'right',
            py: 0.25,
            px: 0,
            ...numSx,
          },
        }}
        sx={{
          flexShrink: 0,
          '& .MuiOutlinedInput-root': { pl: 0.75, pr: 0.75 },
        }}
      />
      <Typography
        noWrap
        sx={{
          fontSize: 11.5,
          color: value > 0 && reduced ? 'text.primary' : 'text.disabled',
          ...numSx,
        }}
      >
        {effectiveMinEr && effectiveMinEr > 100
          ? value > 0
            ? `→ ${reduced}%`
            : `${+effectiveMinEr.toFixed(1)}%`
          : t('teamOpt.weapons.noMinErShort', 'No min ER')}
      </Typography>
    </Box>
  )
}

/**
 * A weapon's conditional passives, for one member: on only when the user turns them on (some
 * characters cannot trigger some of them). Stored on the member's loadout, like on its pages.
 */
/** A weapon passive's switch: one value at `path`, or one of several states */
type PassiveLine = {
  label: ReactNode
  path: readonly string[]
  /** One state: on or off; several: a choice */
  states: [string, ReactNode][]
}

/**
 * A weapon's passives, one line each: its name, then for each member who could wield it (each sets
 * it apart: one may trigger it and another not) a toggle on its avatar, or its state.
 */
export function PassiveLines({
  weaponKey,
  passives,
  wielders,
  data,
}: {
  /** The weapon's (or artifact set's) key: the passives' paths start with it */
  weaponKey: WeaponKey | string
  passives: DocumentConditional[]
  wielders: TeamOptMember[]
  /** Where states that depend on the character are read */
  data: UIData | undefined
}) {
  const lines = useMemo(() => {
    const out: PassiveLine[] = []
    for (const section of passives) {
      const states =
        typeof section.states === 'function'
          ? data
            ? section.states(data)
            : {}
          : section.states
      const entries = Object.entries(states) as [
        string,
        { name?: ReactNode; path?: readonly string[] },
      ][]
      if ('path' in section && section.path) {
        if (section.path[0] !== weaponKey) continue
        out.push({
          label: section.name,
          path: section.path,
          states: entries.map(([key, state]) => [key, state.name ?? key]),
        })
      } else
        for (const [key, state] of entries)
          if (state.path && state.path[0] === weaponKey)
            out.push({
              label: state.name ?? (section as { name?: ReactNode }).name,
              path: state.path,
              states: [[key, state.name ?? key]],
            })
    }
    return out
  }, [passives, data, weaponKey])
  const { t } = useTranslation('page_team')
  if (!lines.length || !wielders.length)
    return (
      <Typography
        sx={{ fontSize: 13, lineHeight: '32px', color: 'text.disabled' }}
      >
        {t('teamOpt.weapons.noPassive', 'No passive effects')}
      </Typography>
    )
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column' }}>
      {lines.map((line) => (
        <Box
          key={line.path.join('.')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            columnGap: 1,
            rowGap: 0.25,
            minHeight: 34,
          }}
        >
          <Typography
            sx={{
              flex: '1 1 150px',
              minWidth: 0,
              fontSize: 13,
              lineHeight: 1.4,
              color: 'text.secondary',
            }}
          >
            {line.label}
          </Typography>
          {line.states.length <= 1 ? (
            // (the members' switches stay together: beside it, or all under it)
            <Box sx={{ display: 'flex', gap: 1, flexShrink: 0, ml: 'auto' }}>
              {wielders.map((member) => (
                <PassiveAvatarToggle
                  key={member.characterKey}
                  member={member}
                  line={line}
                />
              ))}
            </Box>
          ) : (
            // (choices of a state: a row of their own under it, in even columns)
            <Box
              sx={{
                flexBasis: '100%',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                columnGap: 1.5,
                rowGap: 0.5,
              }}
            >
              {wielders.map((member) => (
                <PassiveAvatarStates
                  key={member.characterKey}
                  member={member}
                  line={line}
                />
              ))}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  )
}

/**
 * Where the passive switches read and write: by default the member's loadout conditionals; KQM
 * mode's windows give their own (its settings, over the loadout's and the rule-based ones)
 */
export interface PassiveStore {
  get: (member: TeamOptMember, path: readonly string[]) => string | undefined
  set: (
    member: TeamOptMember,
    path: readonly string[],
    next: string | undefined
  ) => void
}
export const PassiveStoreContext = createContext<PassiveStore | undefined>(
  undefined
)

/** A member's value of a passive (its loadout's conditional), and its setter */
function usePassive(member: TeamOptMember, path: readonly string[]) {
  const database = useDatabase()
  const teamChar = useTeamChar(member.teamCharId)
  const store = useContext(PassiveStoreContext)
  if (store)
    return [
      store.get(member, path),
      (next?: string) => store.set(member, path, next),
    ] as const
  const value = objPathValue(
    (teamChar?.conditional ?? {}) as Record<string, unknown>,
    path as string[]
  ) as string | undefined
  const set = (next?: string) =>
    database.teamChars.set(member.teamCharId, (tc) => {
      const conditional = deepClone(tc.conditional) as Record<string, unknown>
      if (next) layeredAssignment(conditional, path as string[], next)
      else {
        deletePropPath(conditional, path as string[])
        // (no empty weapon entry left behind)
        objClearEmpties(conditional)
      }
      tc.conditional = conditional as typeof tc.conditional
    })
  return [value, set] as const
}

/** A passive on or off for a member: its avatar, lit when on */
function PassiveAvatarToggle({
  member,
  line,
}: {
  member: TeamOptMember
  line: PassiveLine
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const [value, set] = usePassive(member, line.path)
  const stateKey = line.states[0]?.[0]
  const on = !!stateKey && value === stateKey
  return (
    <SuspenseTooltip
      arrow
      title={
        <>
          <CharacterName characterKey={member.characterKey} gender={gender} />
          {on
            ? t('teamOpt.weapons.passiveOn', ': on')
            : t('teamOpt.weapons.passiveOff', ': off')}
        </>
      }
    >
      <ButtonBase
        onClick={() => set(on ? undefined : stateKey)}
        aria-pressed={on}
        data-member={member.characterKey}
        sx={(theme) => ({
          flexShrink: 0,
          width: 30,
          height: 30,
          borderRadius: '50%',
          border: `1.5px solid ${on ? theme.palette.primary.main : 'transparent'}`,
          backgroundColor: on
            ? alpha(theme.palette.primary.main, 0.16)
            : 'transparent',
          opacity: on ? 1 : 0.4,
          filter: on ? 'none' : 'grayscale(1)',
          transition: 'opacity .12s, border-color .12s, background-color .12s',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          '&:hover': { opacity: on ? 1 : 0.8 },
          '&.Mui-focusVisible': {
            outline: `2px solid ${tokens.gold}`,
            outlineOffset: 1,
          },
        })}
      >
        <MemberAvatar characterKey={member.characterKey} size={22} />
      </ButtonBase>
    </SuspenseTooltip>
  )
}

/** A passive with several states (stacks…) for a member: its avatar and a compact choice */
function PassiveAvatarStates({
  member,
  line,
}: {
  member: TeamOptMember
  line: PassiveLine
}) {
  const { t } = useTranslation('page_team')
  const [value, set] = usePassive(member, line.path)
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        minWidth: 0,
        opacity: value ? 1 : 0.55,
      }}
    >
      {/* (gray when off, as the on/off avatars) */}
      <Box sx={{ display: 'flex', filter: value ? 'none' : 'grayscale(1)' }}>
        <MemberAvatar characterKey={member.characterKey} size={22} />
      </Box>
      <Select
        variant="standard"
        disableUnderline
        data-member={member.characterKey}
        displayEmpty
        value={value ?? ''}
        onChange={(e) => set((e.target.value as string) || undefined)}
        sx={{
          fontSize: 13,
          minWidth: 48,
          flex: '0 1 auto',
          color: value ? 'text.primary' : 'text.secondary',
          ...quickSx,
          '&:hover': { color: 'text.primary' },
        }}
      >
        <MenuItem value="">{t('teamOpt.weapons.off', 'Off')}</MenuItem>
        {line.states.map(([key, name]) => (
          <MenuItem key={key} value={key}>
            {name}
          </MenuItem>
        ))}
      </Select>
    </Box>
  )
}

/**
 * In a weapon type's header: adds a weapon of that type (picked as on the Weapons page), then
 * opens it in the weapon editor for its level and refinement. A new weapon is ticked.
 */
function AddWeaponButton({ type }: { type: WeaponTypeKey }) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState<string>()
  return (
    <>
      <Button
        size="small"
        color="inherit"
        variant="outlined"
        onClick={() => setPicking(true)}
        aria-label={t('teamOpt.weapons.add', 'Add')}
        startIcon={<AddIcon sx={{ fontSize: '16px !important' }} />}
        sx={{
          minHeight: 28,
          py: 0,
          pl: 1,
          pr: 1.25,
          fontSize: 12.5,
          color: 'text.secondary',
          '& .MuiButton-startIcon': { mr: 0.5 },
          '&:hover': { color: 'text.primary' },
        }}
      >
        {t('teamOpt.weapons.add', 'Add')}
      </Button>
      <Suspense fallback={false}>
        <WeaponSelectionModal
          show={picking}
          onHide={() => setPicking(false)}
          weaponTypeFilter={type}
          onSelect={(key) => {
            setPicking(false)
            setEditing(database.weapons.new(initialWeapon(key)))
          }}
        />
      </Suspense>
      {editing && (
        <Suspense fallback={false}>
          <WeaponEditor
            weaponId={editing}
            footer
            onClose={() => setEditing(undefined)}
          />
        </Suspense>
      )}
    </>
  )
}

/**
 * A weapon's wielder: a click lists the weapons of that type to give them another one right here
 * (equipping swaps, as in the game: the other one's wielder, if any, gets this one).
 */
function WielderButton({ weapon }: { weapon: ICachedWeapon }) {
  const { t } = useTranslation('page_team')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const location = weapon.location
  if (!location) return null
  return (
    <>
      <Tooltip arrow title={t('teamOpt.weapons.swap', 'Change weapon')}>
        <ButtonBase
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={!!anchor}
          sx={(theme) => ({
            minWidth: 0,
            gap: 0.25,
            pl: 0.5,
            pr: 0.25,
            mx: -0.5,
            height: 22,
            borderRadius: 1,
            color: 'inherit',
            ...quickSx,
            ...focusSx,
            '&:hover': {
              color: 'text.primary',
              backgroundColor: alpha(theme.palette.text.primary, 0.07),
            },
          })}
        >
          <LocationName location={location} variant="caption" noWrap />
          <ArrowDropDownIcon sx={{ fontSize: 16, opacity: 0.7 }} />
        </ButtonBase>
      </Tooltip>
      {anchor && (
        <SwapMenu
          anchor={anchor}
          weapon={weapon}
          location={location}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  )
}

/** The weapons of a type, best first: picking one equips it on `location` */
function SwapMenu({
  anchor,
  weapon,
  location,
  onClose,
}: {
  anchor: HTMLElement
  weapon: ICachedWeapon
  location: NonNullable<ICachedWeapon['location']>
  onClose: () => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const inventory = useDataManagerValues(database.weapons)
  const type = getWeaponStat(weapon.key).weaponType
  const weapons = useMemo(
    () =>
      inventory
        .filter((w) => getWeaponStat(w.key)?.weaponType === type)
        .sort(
          (a, b) =>
            getWeaponStat(b.key).rarity - getWeaponStat(a.key).rarity ||
            b.level - a.level ||
            b.refinement - a.refinement
        ),
    [inventory, type]
  )
  return (
    <Menu
      open
      anchorEl={anchor}
      onClose={onClose}
      slotProps={{ paper: { sx: { maxHeight: 400, minWidth: 280 } } }}
    >
      {/* (what picking does: whose weapon changes) */}
      <Box
        component="li"
        aria-hidden
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.5,
          pt: 0.5,
          pb: 0.75,
          ...typo.label,
        }}
      >
        {t('teamOpt.weapons.swap', 'Change weapon')}
        {location && (
          <Box component="span" sx={{ color: 'text.primary' }}>
            <CharacterName
              characterKey={database.chars.LocationToCharacterKey(location)}
              gender={gender}
            />
          </Box>
        )}
      </Box>
      {weapons.map((w) => (
        <MenuItem
          key={w.id}
          selected={w.id === weapon.id}
          onClick={() => {
            if (w.id !== weapon.id) database.weapons.set(w.id, { location })
            onClose()
          }}
          sx={{ gap: 1.25, py: 0.75 }}
        >
          <Box
            component="img"
            src={weaponAsset(w.key, w.ascension >= 2)}
            alt=""
            className={`grad-${getWeaponStat(w.key).rarity}star`}
            sx={{ width: 28, height: 28, borderRadius: 1, flexShrink: 0 }}
          />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              <WeaponName weaponKey={w.key} />
            </Typography>
            <Typography
              component="div"
              sx={{ ...typo.label, ...numSx, fontWeight: 400 }}
            >
              {t('teamOpt.weapons.levelRef', {
                defaultValue: 'Lv. {{level}} · R{{refinement}}',
                level: w.level,
                refinement: w.refinement,
              })}
            </Typography>
          </Box>
          {/* who holds it now: they would get this row's weapon */}
          {w.location && w.id !== weapon.id && (
            <MemberAvatar
              characterKey={database.chars.LocationToCharacterKey(w.location)}
              size={22}
            />
          )}
        </MenuItem>
      ))}
    </Menu>
  )
}

/**
 * Deletes a weapon from the inventory, after asking. Every character holds a weapon: one that is
 * equipped is replaced on its wielder by its type's basic weapon (the dialog says so), and the
 * basic weapon itself, equipped, cannot be deleted (it would only come back).
 */
function RemoveWeaponButton({
  weapon,
  iconSx,
}: {
  weapon: ICachedWeapon
  /** The row's icon colour (quiet until the row is hovered) */
  iconSx?: SxProps<Theme>
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [asking, setAsking] = useState(false)
  const type = getWeaponStat(weapon.key).weaponType
  const replacement = defaultInitialWeaponKey(type)
  const wielder = weapon.location
    ? database.chars.LocationToCharacterKey(weapon.location)
    : undefined
  const wielderName = wielder && (
    <CharacterName characterKey={wielder} gender={gender} />
  )
  const blocked = !!wielder && weapon.key === replacement
  const remove = () => {
    setAsking(false)
    if (weapon.location) {
      // its wielder gets the basic weapon (equipping it unequips this one)
      database.weapons.new({
        ...initialWeapon(replacement),
        location: weapon.location,
      })
    }
    database.weapons.remove(weapon.id)
  }
  return (
    <>
      <SuspenseTooltip
        title={
          blocked ? (
            <>
              {t('teamOpt.weapons.deleteHeld', 'Equipped by')} {wielderName}
              {t(
                'teamOpt.weapons.deleteHeldHint',
                ': give them another weapon first'
              )}
            </>
          ) : (
            t('teamOpt.weapons.delete', 'Delete')
          )
        }
      >
        {/* (a span: a disabled button gets no hover) */}
        <span>
          <IconButton
            size="small"
            disabled={blocked}
            onClick={() => setAsking(true)}
            aria-label={t(
              'teamOpt.weapons.deleteLabel',
              'Delete from inventory'
            )}
            sx={[
              ...(Array.isArray(iconSx) ? iconSx : [iconSx]),
              { '&:hover': { color: 'error.main' } },
            ]}
          >
            <DeleteOutlineIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </span>
      </SuspenseTooltip>
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        maxWidth="xs"
        fullWidth
        // (over the weapons' dialog: a light backdrop)
        slotProps={stackedBackdrop}
      >
        <DialogTitle sx={{ ...typo.title, fontSize: 16, pb: 0.5 }}>
          {t('teamOpt.weapons.deleteTitle', 'Delete')}{' '}
          <WeaponName weaponKey={weapon.key} />?
        </DialogTitle>
        <DialogContent>
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1.25, mt: 0.5 }}
          >
            <Box
              component="img"
              src={weaponAsset(weapon.key, weapon.ascension >= 2)}
              alt=""
              className={`grad-${getWeaponStat(weapon.key).rarity}star`}
              sx={{ width: 36, height: 36, borderRadius: 1.5, flexShrink: 0 }}
            />
            <Typography component="div" sx={{ ...typo.label, ...numSx }}>
              {t('teamOpt.weapons.levelRef', {
                defaultValue: 'Lv. {{level}} · R{{refinement}}',
                level: weapon.level,
                refinement: weapon.refinement,
              })}
              {weapon.lock && (
                <Box component="span" sx={{ color: 'warning.main' }}>
                  {' · '}
                  {t('teamOpt.weapons.locked', 'Locked')}
                </Box>
              )}
            </Typography>
          </Box>
          {wielder && (
            <Alert severity="warning" sx={{ mt: 1.5, py: 0.25 }}>
              {t('teamOpt.weapons.deleteEquipped', 'Equipped by')}{' '}
              <strong>{wielderName}</strong>
              {t('teamOpt.weapons.deleteReplaced', ', who gets')}{' '}
              <strong>
                <WeaponName weaponKey={replacement} />
              </strong>{' '}
              {t('teamOpt.weapons.deleteInstead', 'instead.')}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, gap: 0.5 }}>
          <Button color="inherit" onClick={() => setAsking(false)} autoFocus>
            {t('teamOpt.weapons.deleteCancel', 'Cancel')}
          </Button>
          <Button variant="contained" color="error" onClick={remove}>
            {t('teamOpt.weapons.deleteConfirm', 'Delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
