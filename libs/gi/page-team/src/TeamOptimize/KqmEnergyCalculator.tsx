import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOptEnergyCalculator,
  TeamOptEnergyMember,
  TeamOptEnergyRotationField,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { teamOptEnergyRotationFields } from '@genshin-optimizer/gi/db'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  CharacterName,
  calculateEnergyRecharge,
  ENERGY_CALC_SOURCE,
  ENERGY_HELP,
  energyCalcData,
  energyCalcWeapons,
  energySkillConstellation,
  energyWeaponPerBurst,
  isCalcEnergyWeapon,
  isFavonius,
  kqmMemberConstellation,
  kqmWeapons,
  shortBurstOf,
  turretParticlesOf,
  WeaponName,
  weaponCalculatorImpact,
  withFieldTime,
} from '@genshin-optimizer/gi/ui'
import AddIcon from '@mui/icons-material/Add'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import RemoveIcon from '@mui/icons-material/Remove'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import {
  alpha,
  Box,
  ButtonBase,
  IconButton,
  InputBase,
  Link,
  MenuItem,
  Select,
  Slider,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import type { Theme } from '@mui/material/styles'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { localizeDecimal } from './format'
import { MemberAvatar } from './MemberAvatar'
import {
  EmptyLine,
  focusSx,
  insetSx,
  numSx,
  quickSx,
  Segmented,
  selectedSx,
  tokens,
  type,
} from './ui'

type EnergyCalcEstimate = ReturnType<typeof calculateEnergyRecharge>

/**
 * The calculator's ER targets before KQM picks the weapons: Favonius and energy weapon triggers
 * count for a member that may use such a weapon in KQM (the run then counts them per weapon).
 * The members' own equipped weapons play no part: KQM builds use KQM's weapons.
 */
/** The calculator's drawer: over the run window it opens from (`TeamEnergyDrawer`) */
export const calculatorDrawerZ = (theme: Theme) => theme.zIndex.modal + 10
/** The selects' menus: over the drawer (at the modal layer they opened behind it) */
const menuProps = {
  sx: (theme: Theme) => ({ zIndex: calculatorDrawerZ(theme) + 10 }),
}

export function kqmEnergyEstimate(
  keys: readonly CharacterKey[],
  settings: TeamOptEnergyCalculator,
  kqm: TeamOptKqm | undefined
) {
  return energyEstimate(keys, settings, kqmEnergyGear(kqm))
}

/** What the calculator knows of the members: their constellations, the weapons each may hold */
export interface EnergyGear {
  constellation: (key: CharacterKey) => number
  weapons: (
    key: CharacterKey
  ) => readonly { key: WeaponKey; refinement: number }[]
}
/** KQM's: its constellations and the weapons its builds may take */
export const kqmEnergyGear = (kqm: TeamOptKqm | undefined): EnergyGear => ({
  constellation: (key) => kqmMemberConstellation(key, kqm),
  weapons: (key) => kqmWeapons(key, kqm),
})
/** The ER targets before the weapons are picked: Favonius and energy weapons as `energyCalcWeapons` assumes them */
export function energyEstimate(
  keys: readonly CharacterKey[],
  settings: TeamOptEnergyCalculator,
  gear: EnergyGear
) {
  const { weapons, refinements } = energyCalcWeapons(
    keys,
    settings,
    gear.weapons
  )
  return calculateEnergyRecharge(keys, settings, weapons, refinements)
}

/**
 * The KQM ER calculator. The members first, as tabs, each with the ER it needs; then the chosen
 * member's energy, nothing folded away: where its energy comes from against what its Bursts spend
 * (why it needs that much), its skills and Burst, its time on the field and who catches its
 * particles, and the extra energy (Favonius, energy weapons, bonus); then the opponent the whole
 * team faces, and last a tip for filling it in for that character. The numbers follow ERC 7.3.
 */
export function KqmEnergyCalculator({
  members,
  kqm,
  gear: gearProp,
  settings,
  setSettings,
  fromRotation = false,
}: {
  members: TeamOptMember[]
  /** KQM's settings: the members' constellations and the weapons they may use */
  kqm: TeamOptKqm | undefined
  /** Instead of KQM's: the members' constellations and weapons (Team optimize: their own) */
  gear?: EnergyGear
  /** The written rotation fills in the inputs not set by hand */
  fromRotation?: boolean
  settings: TeamOptEnergyCalculator
  setSettings: (
    update: (previous: TeamOptEnergyCalculator) => TeamOptEnergyCalculator
  ) => void
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const keys = members.map((m) => m.characterKey)
  const [chosen, setChosen] = useState<CharacterKey | undefined>(keys[0])
  const shown = chosen && keys.includes(chosen) ? chosen : keys[0]
  const gear = useMemo(() => gearProp ?? kqmEnergyGear(kqm), [gearProp, kqm])
  const estimate = useMemo(
    () =>
      energyEstimate(
        members.map((m) => m.characterKey),
        settings,
        gear
      ),
    [members, settings, gear]
  )
  const updateMember = (
    key: CharacterKey,
    values: Partial<TeamOptEnergyMember>
  ) =>
    setSettings((previous) => {
      const { fieldTime, ...rest } = values
      const member = previous.members[key]!
      // (set by hand: the written rotation no longer fills these in)
      const edited = [
        ...new Set([
          ...(member.edited ?? []),
          ...(Object.keys(values) as TeamOptEnergyRotationField[]).filter(
            (field) => teamOptEnergyRotationFields.includes(field)
          ),
        ]),
      ]
      const next = {
        ...previous,
        members: {
          ...previous.members,
          [key]: {
            ...member,
            ...rest,
            ...(edited.length ? { edited } : {}),
          },
        },
      }
      // Keep the full rotation assigned while someone adjusts a character's field time.
      return fieldTime === undefined
        ? next
        : withFieldTime(next, keys, key, fieldTime)
    })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* the members, as tabs: what each one needs, the answer first */}
      <Box
        role="tablist"
        aria-label={t('teamOpt.kqm.calc.members', 'Members')}
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: `repeat(${Math.min(4, Math.max(1, members.length))}, minmax(0, 1fr))`,
          },
        }}
      >
        {members.map(({ characterKey }) => (
          <NeedTile
            key={characterKey}
            characterKey={characterKey}
            estimate={estimate}
            selected={characterKey === shown}
            onClick={() => setChosen(characterKey)}
          />
        ))}
      </Box>

      {shown && (
        <MemberEnergy
          key={shown}
          characterKey={shown}
          keys={keys}
          gear={gear}
          isKqm={!!kqm}
          settings={settings}
          member={settings.members[shown]}
          rotationTime={settings.rotationTime}
          estimate={estimate}
          updateMember={updateMember}
          fromRotation={fromRotation}
          onUseRotation={() =>
            setSettings((previous) => {
              const { edited: _edited, ...member } = previous.members[shown]!
              return {
                ...previous,
                members: { ...previous.members, [shown]: member },
              }
            })
          }
        />
      )}

      <Opponent settings={settings} setSettings={setSettings} />

      {/* the chosen member's tip, last */}
      {shown && <CharacterTip characterKey={shown} />}
    </Box>
  )
}

/** A field's name, above it: an ⓘ for its details (no underline: the page stays quiet) */
function Label({
  children,
  tip,
  aside,
}: {
  children: ReactNode
  tip?: string
  /** something small on its right (a value, a tag) */
  aside?: ReactNode
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        minHeight: 18,
        mb: 0.625,
      }}
    >
      <Typography
        component="span"
        sx={{
          fontSize: 12.5,
          fontWeight: 550,
          color: 'text.secondary',
          letterSpacing: '0.005em',
        }}
      >
        {children}
      </Typography>
      {tip && (
        <Tooltip arrow title={tip}>
          <InfoOutlinedIcon
            tabIndex={0}
            aria-label={tip}
            sx={{
              fontSize: 13,
              color: 'text.secondary',
              opacity: 0.7,
              cursor: 'help',
              '&:hover, &:focus-visible': { opacity: 1, outline: 'none' },
            }}
          />
        </Tooltip>
      )}
      {aside && <Box sx={{ ml: 'auto', minWidth: 0 }}>{aside}</Box>}
    </Box>
  )
}

/** A small tag beside a control (a state, a reason it does not count) */
function Tag({
  children,
  tone = 'muted',
}: {
  children: ReactNode
  tone?: 'muted' | 'warning'
}) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        px: 0.875,
        borderRadius: 1,
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        color: tone === 'warning' ? 'warning.main' : 'text.secondary',
        bgcolor:
          tone === 'warning'
            ? alpha(theme.palette.warning.main, 0.12)
            : alpha(theme.palette.text.primary, 0.06),
      })}
    >
      {children}
    </Box>
  )
}

/** A card of related settings: its title (and a summary on the right), then its fields */
function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <Box
      component="section"
      sx={{
        ...insetSx,
        borderRadius: 1.5,
        px: { xs: 1.5, sm: 2 },
        pt: 1.5,
        pb: 1.75,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 1,
          mb: 1.5,
          minWidth: 0,
        }}
      >
        <Typography
          component="h3"
          sx={{ fontSize: 14, fontWeight: 650, letterSpacing: '-0.005em' }}
        >
          {title}
        </Typography>
        {aside && (
          <Box
            sx={{
              ml: 'auto',
              minWidth: 0,
              fontSize: 12.5,
              color: 'text.secondary',
              textAlign: 'right',
              ...numSx,
            }}
          >
            {aside}
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'grid', gap: 1.75 }}>{children}</Box>
    </Box>
  )
}

/** How to fill the calculator for a character (its `ENERGY_HELP`), as a card at the end */
function CharacterTip({ characterKey }: { characterKey: CharacterKey }) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const help = ENERGY_HELP[characterKey]
  if (!help) return null
  return (
    <Box
      component="aside"
      sx={(theme) => ({
        position: 'relative',
        overflow: 'hidden',
        display: 'grid',
        gridTemplateColumns: '32px minmax(0, 1fr)',
        columnGap: 1.5,
        alignItems: 'start',
        pl: { xs: 1.75, sm: 2.25 },
        pr: { xs: 1.5, sm: 2 },
        py: 1.5,
        borderRadius: 1.5,
        background: alpha(theme.palette.primary.main, 0.06), // juanlab: piatto
        boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.18)}`,
        // (a gold edge on the left)
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          bgcolor: tokens.gold,
          opacity: 0.85,
        },
      })}
    >
      <Box
        sx={(theme) => ({
          width: 32,
          height: 32,
          borderRadius: 999,
          display: 'grid',
          placeItems: 'center',
          bgcolor: alpha(theme.palette.primary.main, 0.16),
        })}
      >
        <LightbulbOutlinedIcon sx={{ fontSize: 17, color: tokens.gold }} />
      </Box>
      <Box sx={{ minWidth: 0, display: 'grid', gap: 0.5 }}>
        <Typography
          sx={{ fontSize: 13.5, fontWeight: 650, color: tokens.gold }}
        >
          {t('teamOpt.kqm.calc.tipFor', 'Tip for')}{' '}
          <CharacterName characterKey={characterKey} gender={gender} />
        </Typography>
        <Typography
          sx={{
            fontSize: 13.5,
            lineHeight: 1.6,
            color: 'text.primary',
            opacity: 0.88,
            maxWidth: '70ch',
          }}
        >
          {help}
        </Typography>
      </Box>
    </Box>
  )
}

/** The opponent the whole team faces: its settings in one row, the data's source */
function Opponent({
  settings,
  setSettings,
}: {
  settings: TeamOptEnergyCalculator
  setSettings: (
    update: (previous: TeamOptEnergyCalculator) => TeamOptEnergyCalculator
  ) => void
}) {
  const { t } = useTranslation('page_team')
  const rngName = (rng: TeamOptEnergyCalculator['rng']) =>
    t(
      `teamOpt.kqm.calc.${rng}`,
      { average: 'Average', safe: 'Safe', worst: 'Worst case' }[rng]
    )
  return (
    <Section
      title={t('teamOpt.kqm.calc.opponent', 'Opponent')}
      aside={
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25 }}>
          <span>{t('teamOpt.kqm.calc.wholeTeam', 'Whole team')}</span>
          <Link
            href={ENERGY_CALC_SOURCE}
            target="_blank"
            rel="noreferrer"
            underline="hover"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              color: 'text.secondary',
              ...quickSx,
              '&:hover': { color: 'text.primary' },
            }}
          >
            ERC 7.3 <OpenInNewIcon sx={{ fontSize: 13 }} />
          </Link>
        </Box>
      }
    >
      <Box
        sx={{
          display: 'grid',
          columnGap: 1.5,
          rowGap: 1.5,
          gridTemplateColumns: {
            xs: 'repeat(2, minmax(0, 1fr))',
            sm: 'repeat(4, minmax(0, 1fr))',
          },
        }}
      >
        <Box>
          <Label
            tip={t(
              'teamOpt.kqm.calc.clearTip',
              'How long the chamber takes: the enemy particles below drop over this time.'
            )}
          >
            {t('teamOpt.kqm.calc.clear', 'Clear time')}
          </Label>
          <NumberField
            value={settings.clearTime}
            unit="s"
            min={0.1}
            ariaLabel={t('teamOpt.kqm.calc.clear', 'Clear time')}
            onChange={(clearTime) => setSettings((s) => ({ ...s, clearTime }))}
          />
        </Box>
        <Box>
          <Label
            tip={t(
              'teamOpt.kqm.calc.enemyTip',
              'Neutral particles the enemies drop over the clear time.'
            )}
          >
            {t('teamOpt.kqm.calc.enemy', 'Enemy particles')}
          </Label>
          <NumberField
            value={settings.enemyParticles}
            ariaLabel={t('teamOpt.kqm.calc.enemy', 'Enemy particles')}
            onChange={(enemyParticles) =>
              setSettings((s) => ({ ...s, enemyParticles }))
            }
          />
        </Box>
        <Box>
          <Label>{t('teamOpt.kqm.calc.rng', 'Particle RNG')}</Label>
          <Select
            size="small"
            fullWidth
            MenuProps={menuProps}
            value={settings.rng}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                rng: e.target.value as TeamOptEnergyCalculator['rng'],
              }))
            }
            inputProps={{
              'aria-label': t('teamOpt.kqm.calc.rng', 'Particle RNG'),
            }}
            sx={selectSx}
          >
            {(['average', 'safe', 'worst'] as const).map((value) => (
              <MenuItem key={value} value={value}>
                {rngName(value)}
              </MenuItem>
            ))}
          </Select>
        </Box>
        <Box>
          <Label
            tip={t(
              'teamOpt.kqm.calc.electroTip',
              'Electro resonance particles (two Electro members): one every this many seconds, at least 5. 0: none.'
            )}
          >
            {t('teamOpt.kqm.calc.electro', 'Electro interval')}
          </Label>
          <NumberField
            value={settings.electroInterval}
            unit="s"
            ariaLabel={t('teamOpt.kqm.calc.electro', 'Electro interval')}
            onChange={(electroInterval) =>
              setSettings((s) => ({
                ...s,
                electroInterval,
                // (set by hand: the written rotation no longer fills it in)
                edited: ['electroInterval'],
              }))
            }
          />
        </Box>
      </Box>
    </Section>
  )
}

/** A member's needed Energy Recharge: a tab of the calculator (gold ring when chosen) */
function NeedTile({
  characterKey,
  estimate,
  selected,
  onClick,
}: {
  characterKey: CharacterKey
  estimate: EnergyCalcEstimate
  selected: boolean
  onClick: () => void
}) {
  const { gender } = useDBMeta()
  // (the target as applied: the required ER rounded up to 0.1%)
  const required = estimate.targets[characterKey]
  return (
    <ButtonBase
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      sx={(theme) => ({
        ...insetSx,
        borderRadius: 1.5,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 1.25,
        px: 1.25,
        py: 1,
        textAlign: 'left',
        minWidth: 0,
        ...quickSx,
        ...focusSx,
        '&:hover': { bgcolor: alpha(theme.palette.text.primary, 0.05) },
        ...(selected ? selectedSx(theme) : {}),
      })}
    >
      <MemberAvatar characterKey={characterKey} size={32} />
      <Box sx={{ minWidth: 0, lineHeight: 1.2 }}>
        <Typography
          noWrap
          sx={{
            fontSize: 12.5,
            fontWeight: 550,
            color: selected ? 'text.primary' : 'text.secondary',
          }}
        >
          <CharacterName characterKey={characterKey} gender={gender} />
        </Typography>
        <Typography sx={{ ...type.stat, fontSize: 19 }}>
          {required !== undefined ? `${required}%` : '—'}
        </Typography>
      </Box>
    </ButtonBase>
  )
}

/** The energy sources' colors in the balance (the member's own skills in gold) */
const SOURCE_COLORS = {
  own: '#d3bc8e',
  team: '#9a958a',
  favonius: '#8fc0a0',
  enemies: '#8ea7c9',
  resonance: '#b9a3d9',
  flat: '#ece5d8',
} as const

/**
 * Why a member needs the ER it needs, as one bar: what it gets per rotation at 100% ER, by source,
 * against a mark where its Bursts' cost is. ER multiplies the particles (not the flat energy) to
 * close the gap.
 */
function EnergyBalance({
  result,
  short,
  shortUses,
}: {
  result: EnergyCalcEstimate['members'][CharacterKey]
  /** its partial-Energy Burst, when it has one: what those spend */
  short?: { label: string }
  shortUses: number
}) {
  const { t, i18n } = useTranslation('page_team')
  if (!result) return null
  const { sources, burstSpend } = result
  // (a partial Burst spends energy: its skills' flat energy below zero)
  const partialSpend = Math.max(0, -sources.skills)
  const needs = burstSpend + partialSpend
  const flat = sources.bonus + sources.gear + Math.max(0, sources.skills)
  const parts = [
    {
      key: 'own',
      label: t('teamOpt.kqm.calc.srcOwn', 'Own skills'),
      value: sources.own,
      color: SOURCE_COLORS.own,
    },
    {
      key: 'team',
      label: t('teamOpt.kqm.calc.srcTeam', 'Teammates'),
      value: sources.team,
      color: SOURCE_COLORS.team,
    },
    {
      key: 'favonius',
      label: 'Favonius',
      value: sources.favonius,
      color: SOURCE_COLORS.favonius,
    },
    {
      key: 'enemies',
      label: t('teamOpt.kqm.calc.srcEnemies', 'Enemies'),
      value: sources.enemies,
      color: SOURCE_COLORS.enemies,
    },
    {
      key: 'resonance',
      label: t('teamOpt.kqm.calc.srcResonance', 'Resonance'),
      value: sources.resonance,
      color: SOURCE_COLORS.resonance,
    },
    {
      key: 'flat',
      label: t('teamOpt.kqm.calc.srcFlat', 'Flat'),
      value: flat,
      color: SOURCE_COLORS.flat,
    },
  ].filter((p) => p.value > 0.05)
  const gets = parts.reduce((n, p) => n + p.value, 0)
  const scale = Math.max(needs, gets, 1) * 1.06
  const n = (v: number) => +v.toFixed(1)
  const mark = needs > 0 ? (needs / scale) * 100 : undefined
  const spends = [
    burstSpend > 0 &&
      t('teamOpt.kqm.calc.spendBurst', {
        defaultValue: 'Burst {{value}}',
        value: n(burstSpend),
      }),
    partialSpend > 0 &&
      `${short?.label ?? t('teamOpt.kqm.calc.partial', 'Partial Bursts')} ×${localizeDecimal(`${+shortUses.toFixed(2)}`, i18n?.language)} ${localizeDecimal(`${n(partialSpend)}`, i18n?.language)}`,
  ].filter(Boolean)
  return (
    <Section
      title={t('teamOpt.kqm.calc.balance', 'Energy per rotation')}
      aside={
        needs > 0
          ? t('teamOpt.kqm.calc.balanceAside', {
              defaultValue: 'needs {{needs}} · gets {{gets}} at 100% ER',
              needs: n(needs),
              gets: n(gets),
            })
          : t('teamOpt.kqm.calc.spendNone', 'No Burst used')
      }
    >
      <Box sx={{ position: 'relative', pt: mark !== undefined ? 2.5 : 0 }}>
        {/* the Bursts' cost: a mark over the bar, named */}
        {mark !== undefined && (
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              bottom: -4,
              left: `${mark}%`,
              width: 0,
              borderLeft: '2px solid',
              borderColor: 'text.primary',
              zIndex: 1,
            }}
          >
            <Typography
              sx={{
                position: 'absolute',
                top: -2,
                ...(mark > 60 ? { right: 6 } : { left: 6 }),
                fontSize: 12,
                fontWeight: 650,
                whiteSpace: 'nowrap',
                lineHeight: 1.2,
                ...numSx,
              }}
            >
              {spends.join(' + ')}
            </Typography>
          </Box>
        )}
        <Box
          sx={(theme) => ({
            height: 14,
            borderRadius: 999,
            bgcolor: alpha(theme.palette.text.primary, 0.07),
            overflow: 'hidden',
            display: 'flex',
          })}
        >
          {parts.map((p) => (
            <Tooltip key={p.key} arrow title={`${p.label}: ${n(p.value)}`}>
              <Box
                sx={{
                  width: `${(p.value / scale) * 100}%`,
                  bgcolor: p.color,
                  '& + &': { borderLeft: '2px solid rgba(20, 20, 26, 0.7)' },
                }}
              />
            </Tooltip>
          ))}
        </Box>
      </Box>
      {/* the sources, named with their share */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          columnGap: 2,
          rowGap: 0.75,
          mt: -0.5,
        }}
      >
        {parts.map((p) => (
          <Box
            key={p.key}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}
          >
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: 0.75,
                bgcolor: p.color,
              }}
            />
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              {p.label}
            </Typography>
            <Typography sx={{ fontSize: 12.5, fontWeight: 650, ...numSx }}>
              {n(p.value)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Section>
  )
}

/** One member's energy, all of it: why it needs what it needs, then its settings by section */
export function MemberEnergy({
  characterKey,
  keys,
  gear,
  isKqm,
  settings,
  member,
  rotationTime,
  estimate,
  updateMember,
  fromRotation,
  onUseRotation,
  lockFieldTime = false,
}: {
  characterKey: CharacterKey
  /** Its field time is shown, not edited (KQM Compare: the leaving member's) */
  lockFieldTime?: boolean
  /** The written rotation fills in the inputs not set by hand */
  fromRotation: boolean
  /** Lets the rotation fill in all of this member's inputs again */
  onUseRotation: () => void
  keys: CharacterKey[]
  gear: EnergyGear
  isKqm: boolean
  settings: TeamOptEnergyCalculator
  member: TeamOptEnergyMember | undefined
  /** The rotation every count is per (s) */
  rotationTime: number
  estimate: EnergyCalcEstimate
  updateMember: (
    key: CharacterKey,
    values: Partial<TeamOptEnergyMember>
  ) => void
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const { gender } = useDBMeta()
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'))
  const [secondOpen, setSecondOpen] = useState(false)
  const data = energyCalcData[characterKey]
  // (a turret counted as the rotation plays it: its uses no longer count)
  const turretMade =
    member && data ? turretParticlesOf(member, data) : undefined
  const name = t(`charNames_gen:${characterKey}`, characterKey)
  // Favonius and energy weapon triggers count only with such a weapon, which the run picks from
  // these: shown when it may hold one (or something was entered)
  const allowedWeapons = useMemo(
    () => gear.weapons(characterKey),
    [gear, characterKey]
  )
  const bestFavonius = useMemo(
    () =>
      allowedWeapons
        .filter((w) => isFavonius(w.key))
        .sort((a, b) => b.refinement - a.refinement)[0],
    [allowedWeapons]
  )
  const bestEnergyWeapon = useMemo(
    () =>
      allowedWeapons
        .filter((w) => isCalcEnergyWeapon(w.key))
        .sort((a, b) => b.refinement - a.refinement)[0],
    [allowedWeapons]
  )
  // Live ER impact of this member holding their best allowed Favonius / energy weapon
  const { weapons: previewWeapons, refinements: previewRefinements } = useMemo(
    () => energyCalcWeapons(keys, settings, gear.weapons),
    [keys, settings, gear]
  )
  const favoniusImpact = useMemo(
    () =>
      member && bestFavonius && member.favoniusProcs > 0
        ? weaponCalculatorImpact(
            keys,
            settings,
            characterKey,
            bestFavonius.key,
            bestFavonius.refinement,
            previewWeapons,
            previewRefinements
          )
        : undefined,
    [
      bestFavonius,
      member,
      keys,
      settings,
      characterKey,
      previewWeapons,
      previewRefinements,
    ]
  )
  const energyWeaponImpact = useMemo(() => {
    if (!member || !bestEnergyWeapon) return undefined
    const hasTriggers =
      energyWeaponPerBurst(bestEnergyWeapon.key) ||
      (member.weaponEnergyTriggers ?? 0) > 0 ||
      (member.weaponTriggers?.[bestEnergyWeapon.key] ?? 0) > 0
    return hasTriggers
      ? weaponCalculatorImpact(
          keys,
          settings,
          characterKey,
          bestEnergyWeapon.key,
          bestEnergyWeapon.refinement,
          previewWeapons,
          previewRefinements
        )
      : undefined
  }, [
    bestEnergyWeapon,
    member,
    keys,
    settings,
    characterKey,
    previewWeapons,
    previewRefinements,
  ])
  if (!member || !data)
    return (
      <Box sx={{ ...insetSx, p: 1.25 }}>
        <EmptyLine sx={{ minHeight: 48 }}>
          <MemberAvatar characterKey={characterKey} size={24} />
          {name}: {t('teamOpt.kqm.calc.noData', 'Use a manual ER target.')}
        </EmptyLine>
      </Box>
    )
  const result = estimate.members[characterKey]
  const required = estimate.targets[characterKey]
  // (who caught its particles as the rotation played, when the catcher and its share can't say
  // it: the calculator counts these until a catcher is set by hand)
  const playedShares = (
    shares: Partial<Record<CharacterKey, number>> | undefined,
    least: number,
    others = false
  ) => {
    const caught = (
      Object.entries(shares ?? {}) as [CharacterKey, number][]
    ).filter(([k, v]) => keys.includes(k) && v > 0)
    const total = caught.reduce((n, [, v]) => n + v, 0)
    if (caught.filter(([k]) => !others || k !== characterKey).length < least)
      return undefined
    return caught
      .sort((a, b) => b[1] - a[1])
      .map(
        ([k, v]) =>
          `${t(`charNames_gen:${k}`, k)} ${Math.round((v / total) * 100)}%`
      )
      .join(' · ')
  }
  const typed = member.edited ?? []
  const skillShares =
    typed.includes('catchBy') || typed.includes('funnelShare')
      ? undefined
      : playedShares(member.catchShares, 2, true)
  const favoniusShares = typed.includes('favoniusCatchBy')
    ? undefined
    : playedShares(member.favoniusCatchShares, 2)
  const turretShares =
    turretMade === undefined
      ? undefined
      : playedShares(member.turretCatchShares, 1)
  const asPlayed = (shares: string) => (
    <Typography sx={{ mt: 0.5, fontSize: 12.5, color: 'text.secondary' }}>
      {t('teamOpt.kqm.calc.asPlayed', {
        defaultValue: 'As played: {{shares}}',
        shares,
      })}
    </Typography>
  )
  // (a partial-Energy Burst: its own field, as it is used, not a second skill to find)
  const short = shortBurstOf(characterKey)
  const shortUses =
    short && member.secondaryMode === short.index ? member.secondaryUses : 0
  const cons = gear.constellation(characterKey)
  // the skill's ways (above the KQM build's constellation left out, unless chosen), each with its particles
  const skillOptions = data.skills
    .map((skill, index) => ({ skill, index }))
    .filter(
      ({ skill, index }) =>
        energySkillConstellation(skill.label) <= cons ||
        index === member.skillMode ||
        index === member.secondaryMode
    )
  const mayFavonius = !!bestFavonius
  const mayEnergyWeapon = !!bestEnergyWeapon
  const showFavonius = mayFavonius || member.favoniusProcs > 0
  const showEnergyWeapon =
    mayEnergyWeapon || (member.weaponEnergyTriggers ?? 0) > 0
  // a second skill: folded until used (the partial Burst has its own field)
  const secondIsShort = !!short && member.secondaryMode === short.index
  const secondUsed = !secondIsShort && member.secondaryUses > 0
  const showSecond = secondUsed || secondOpen
  const particles = (skill: (typeof data.skills)[number]) =>
    skill.perSecond > 0
      ? t('teamOpt.kqm.calc.perSecond', {
          defaultValue: '{{value}} particles/s',
          value: skill.perSecond,
        })
      : skill.particles === 1
        ? t('teamOpt.kqm.calc.perUseOne', '1 particle')
        : t('teamOpt.kqm.calc.perUse', {
            defaultValue: '{{value}} particles',
            value: skill.particles,
          })
  const modeSelect = (secondary: boolean) => (
    <Select
      size="small"
      fullWidth
      MenuProps={menuProps}
      value={secondary ? member.secondaryMode : member.skillMode}
      onChange={(e) =>
        updateMember(characterKey, {
          [secondary ? 'secondaryMode' : 'skillMode']: Number(e.target.value),
        })
      }
      inputProps={{
        'aria-label': `${name}: ${
          secondary
            ? t('teamOpt.kqm.calc.secondary', 'Second skill')
            : t('teamOpt.kqm.calc.skill', 'Skill')
        }`,
      }}
      renderValue={(value) => {
        const skill = data.skills[value as number]
        return skill ? (
          <Box
            component="span"
            sx={{
              display: 'flex',
              gap: 0.75,
              minWidth: 0,
              alignItems: 'baseline',
            }}
          >
            <Box
              component="span"
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {skill.label}
            </Box>
            <Box
              component="span"
              sx={{
                fontSize: 12,
                color: 'text.secondary',
                flexShrink: 0,
                display: { xs: 'none', sm: 'inline' },
                ...numSx,
              }}
            >
              {particles(skill)}
            </Box>
          </Box>
        ) : (
          ''
        )
      }}
      sx={selectSx}
    >
      {skillOptions
        .filter(({ index }) => !short || index !== short.index || secondary)
        .map(({ skill, index }) => (
          <MenuItem
            key={skill.label}
            value={index}
            sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
          >
            <span>{skill.label}</span>
            <Box
              component="span"
              sx={{ fontSize: 12, color: 'text.secondary', ...numSx }}
            >
              {particles(skill)}
            </Box>
          </MenuItem>
        ))}
    </Select>
  )
  const catcherSelect = (favonius: boolean) => (
    <Select
      size="small"
      fullWidth
      MenuProps={menuProps}
      value={
        (favonius ? member.favoniusCatchBy : member.catchBy) ?? characterKey
      }
      onChange={(e) =>
        updateMember(characterKey, {
          [favonius ? 'favoniusCatchBy' : 'catchBy']: e.target
            .value as CharacterKey,
        })
      }
      inputProps={{
        'aria-label': `${name}: ${
          favonius
            ? t('teamOpt.kqm.calc.favCatcher', 'Favonius catcher')
            : t('teamOpt.kqm.calc.catcher', 'Particle catcher')
        }`,
      }}
      sx={selectSx}
    >
      {keys.map((key) => (
        <MenuItem key={key} value={key}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <MemberAvatar characterKey={key} size={20} />
            <CharacterName characterKey={key} gender={gender} />
          </Box>
        </MenuItem>
      ))}
    </Select>
  )
  const burstOptions = [
    { value: 1, label: t('teamOpt.kqm.calc.burstEvery1', 'Every') },
    {
      value: 2,
      label: phone
        ? t('teamOpt.kqm.calc.burstEvery2Short', '2nd')
        : t('teamOpt.kqm.calc.burstEvery2', 'Every 2nd'),
    },
    {
      value: 3,
      label: phone
        ? t('teamOpt.kqm.calc.burstEvery3Short', '3rd')
        : t('teamOpt.kqm.calc.burstEvery3', 'Every 3rd'),
    },
    {
      value: 0,
      label: phone
        ? t('teamOpt.kqm.calc.unusedShort', 'Off')
        : t('teamOpt.kqm.calc.unused', 'Unused'),
    },
    ...([0, 1, 2, 3].includes(member.burstEvery)
      ? []
      : [
          {
            value: member.burstEvery,
            label:
              member.burstEvery < 1
                ? t('teamOpt.kqm.calc.burstTimes', {
                    defaultValue: '{{n}} per rotation',
                    n: +(1 / member.burstEvery).toFixed(1),
                  })
                : t('teamOpt.kqm.calc.burstEveryN', {
                    defaultValue: 'Every {{n}}th',
                    n: +member.burstEvery.toFixed(1),
                  }),
          },
        ]),
  ]
  const usesTip = t('teamOpt.kqm.calc.usesTip', 'Uses per rotation')

  return (
    <Box
      id={`er-member-${characterKey}`}
      role="tabpanel"
      sx={{ display: 'grid', gap: 1.25 }}
    >
      {/* who, what it needs, where its inputs come from; its tip */}
      <Box sx={{ display: 'grid', gap: 1, px: 0.5, py: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <MemberAvatar characterKey={characterKey} size={44} />
          <Box sx={{ flex: 1, minWidth: 0, display: 'grid', gap: 0.5 }}>
            <Typography
              sx={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.01em' }}
              noWrap
            >
              <CharacterName characterKey={characterKey} gender={gender} />
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 0.75,
              }}
            >
              <Tag>C{cons}</Tag>
              <Tag>
                {t('teamOpt.kqm.calc.rotationSeconds', {
                  defaultValue: '{{seconds}} s rotation',
                  seconds: +rotationTime.toFixed(1),
                })}
              </Tag>
              {fromRotation &&
                (member.edited?.length ? (
                  <Tooltip
                    arrow
                    title={t(
                      'teamOpt.kqm.calc.editedTip',
                      'You changed some of these inputs, so the written rotation no longer fills them in. Use the rotation’s values again.'
                    )}
                  >
                    <ButtonBase
                      onClick={onUseRotation}
                      sx={(theme) => ({
                        height: 22,
                        px: 0.875,
                        borderRadius: 1,
                        gap: 0.5,
                        fontSize: 11.5,
                        fontWeight: 650,
                        color: tokens.gold,
                        bgcolor: alpha(theme.palette.primary.main, 0.12),
                        ...focusSx,
                        '&:hover': {
                          bgcolor: alpha(theme.palette.primary.main, 0.2),
                        },
                      })}
                    >
                      <SyncRoundedIcon sx={{ fontSize: 14 }} />
                      {t('teamOpt.kqm.calc.useRotation', 'Use rotation')}
                    </ButtonBase>
                  </Tooltip>
                ) : (
                  <Tooltip
                    arrow
                    title={t(
                      'teamOpt.kqm.calc.fromRotationTip',
                      'Field time, skill uses, Burst cadence and the particle catcher come from the written rotation (particles count when they arrive, about 1.7 s after the hit). Change any of them to set it yourself.'
                    )}
                  >
                    <Box component="span" sx={{ cursor: 'help' }}>
                      <Tag>
                        {t('teamOpt.kqm.calc.fromRotation', 'From rotation')}
                      </Tag>
                    </Box>
                  </Tooltip>
                ))}
            </Box>
          </Box>
          <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
            <Typography
              sx={{
                ...type.figure,
                fontSize: 30,
                fontWeight: 700,
                color:
                  required !== undefined ? 'text.primary' : 'text.secondary',
              }}
            >
              {required !== undefined ? `${required}%` : '—'}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {t('teamOpt.kqm.calc.erNeeded', 'ER needed')}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* why: what it gets against what its Bursts cost */}
      <EnergyBalance result={result} short={short} shortUses={shortUses} />

      <Section title={t('teamOpt.kqm.calc.groupUses', 'Skill and Burst')}>
        <Box>
          <Label>{t('teamOpt.kqm.calc.skill', 'Skill')}</Label>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>{modeSelect(false)}</Box>
            <Stepper
              value={member.skillUses}
              onChange={(skillUses) =>
                updateMember(characterKey, { skillUses })
              }
              ariaLabel={`${name}: ${t('teamOpt.kqm.calc.uses', 'Skill uses')}`}
              prefix="×"
              tip={usesTip}
            />
          </Box>
          {turretMade !== undefined && (
            <Typography
              sx={{ mt: 0.5, fontSize: 12.5, color: 'text.secondary' }}
            >
              {t('teamOpt.kqm.calc.turretMade', {
                defaultValue:
                  'Its turret: {{value}} particles a rotation, as the rotation plays it',
                value: turretMade,
              })}
              {turretShares &&
                `, ${t('teamOpt.kqm.calc.caughtBy', 'caught by')} ${turretShares}`}
            </Typography>
          )}
          {!showSecond && (
            <ButtonBase
              onClick={() => setSecondOpen(true)}
              sx={{
                mt: 0.75,
                gap: 0.5,
                fontSize: 12.5,
                fontWeight: 600,
                color: 'text.secondary',
                borderRadius: 1,
                px: 0.5,
                ml: -0.5,
                ...focusSx,
                '&:hover': { color: 'text.primary' },
              }}
            >
              <AddIcon sx={{ fontSize: 15 }} />
              {t('teamOpt.kqm.calc.addSecond', 'Second skill')}
            </ButtonBase>
          )}
        </Box>
        {showSecond && (
          <Box>
            <Label
              tip={t(
                'teamOpt.kqm.calc.secondaryTip',
                'Another way the skill is used in the rotation (hold and press, another form), with its own uses.'
              )}
              aside={
                <IconButton
                  size="small"
                  aria-label={t(
                    'teamOpt.kqm.calc.removeSecond',
                    'Remove the second skill'
                  )}
                  onClick={() => {
                    setSecondOpen(false)
                    if (member.secondaryUses > 0 && !secondIsShort)
                      updateMember(characterKey, { secondaryUses: 0 })
                  }}
                  sx={{ p: 0.25, color: 'text.secondary' }}
                >
                  <CloseRoundedIcon sx={{ fontSize: 15 }} />
                </IconButton>
              }
            >
              {t('teamOpt.kqm.calc.secondary', 'Second skill')}
            </Label>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>{modeSelect(true)}</Box>
              <Stepper
                value={secondIsShort ? 0 : member.secondaryUses}
                onChange={(secondaryUses) =>
                  updateMember(characterKey, { secondaryUses })
                }
                ariaLabel={`${name}: ${t('teamOpt.kqm.calc.secondaryUses', 'Second skill uses')}`}
                prefix="×"
                tip={usesTip}
              />
            </Box>
          </Box>
        )}
        <Box
          sx={{
            display: 'grid',
            gap: 1.75,
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              sm: short ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)',
            },
            alignItems: 'end',
          }}
        >
          <Box sx={{ minWidth: 0 }}>
            <Label
              aside={
                // (the full Burst and the partial ones in one rotation: Flins' first Q before his
                // E, or an E after Manifest Flame ended; the ER it needs jumps by the full 80)
                !!short &&
                shortUses > 0 &&
                member.burstEvery > 0 && (
                  <Tooltip
                    arrow
                    title={t('teamOpt.kqm.calc.fullWithShortTip', {
                      defaultValue:
                        'This rotation uses the full Burst as well as {{name}}, so the ER needed counts its full Energy cost too. Usually only {{name}} is played: set Burst to Unused if that full Burst is not meant (for Flins, a Q before his E or after Manifest Flame has ended).',
                      name: short.label,
                    })}
                  >
                    <Box component="span" sx={{ cursor: 'help' }}>
                      <Tag tone="warning">
                        {t('teamOpt.kqm.calc.fullWithShort', {
                          defaultValue: 'Full Burst + {{name}}',
                          name: short.label,
                        })}
                      </Tag>
                    </Box>
                  </Tooltip>
                )
              }
            >
              {t('teamOpt.kqm.calc.burst', 'Burst')}
            </Label>
            <Box sx={{ overflowX: 'auto' }}>
              <Segmented
                size="small"
                value={member.burstEvery}
                aria-label={`${name}: ${t('teamOpt.kqm.calc.burst', 'Burst')}`}
                options={burstOptions.map((o) => ({
                  value: o.value,
                  label: o.label,
                  tip:
                    o.value === 0
                      ? t('teamOpt.kqm.calc.unusedTip', 'The burst is not used')
                      : t('teamOpt.kqm.calc.burstEveryTip', {
                          defaultValue: 'Burst used every {{n}} rotation(s)',
                          n: o.value,
                        }),
                }))}
                onChange={(burstEvery) =>
                  updateMember(characterKey, { burstEvery })
                }
              />
            </Box>
          </Box>
          {short && (
            <Box>
              <Label
                tip={t('teamOpt.kqm.calc.shortBurstTip', {
                  defaultValue:
                    '{{name}} per rotation: a Burst that spends 30 Energy.',
                  name: short.label,
                })}
              >
                {short.label}
              </Label>
              <Stepper
                value={shortUses}
                onChange={(secondaryUses) =>
                  updateMember(characterKey, {
                    secondaryMode: short.index,
                    secondaryUses,
                  })
                }
                ariaLabel={`${name}: ${short.label}`}
                prefix="×"
                tip={usesTip}
              />
            </Box>
          )}
        </Box>
      </Section>

      <Section title={t('teamOpt.kqm.calc.groupField', 'Field and particles')}>
        <Box>
          <Label
            tip={t(
              'teamOpt.kqm.calc.fieldTimeTip',
              'Share of the rotation this member is on the field (the others share the rest). Turret particles and catching follow it.'
            )}
          >
            {t('teamOpt.kqm.calc.fieldTime', 'Field time')}
          </Label>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Slider
              size="small"
              disabled={lockFieldTime}
              value={Number.isFinite(member.fieldTime) ? member.fieldTime : 0}
              onChange={(_, value) =>
                updateMember(characterKey, { fieldTime: value as number })
              }
              aria-label={`${name}: ${t('teamOpt.kqm.calc.fieldTime', 'Field time')}`}
              sx={{ flex: 1, py: 1, ml: 0.75 }}
            />
            <NumberField
              value={+member.fieldTime.toFixed(1)}
              unit="%"
              width={84}
              ariaLabel={`${name}: ${t('teamOpt.kqm.calc.fieldTime', 'Field time')}`}
              disabled={lockFieldTime}
              onChange={(fieldTime) =>
                updateMember(characterKey, { fieldTime })
              }
            />
          </Box>
        </Box>
        <Box>
          <Label
            tip={t(
              'teamOpt.kqm.calc.catcherTip',
              'Who is on the field when this member’s skill particles arrive; the % beside it is how many go there (Fed to catcher), the rest to this member. When the rotation gave them to several members, “As played” lists each one’s share, counted until you set these by hand.'
            )}
          >
            {t('teamOpt.kqm.calc.catcher', 'Particle catcher')}
          </Label>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1, minWidth: 0 }}>{catcherSelect(false)}</Box>
            <NumberField
              value={member.funnelShare}
              unit="%"
              width={84}
              ariaLabel={`${name}: ${t('teamOpt.kqm.calc.feed', 'Fed to catcher')}`}
              onChange={(funnelShare) =>
                updateMember(characterKey, { funnelShare })
              }
            />
          </Box>
          {skillShares && asPlayed(skillShares)}
        </Box>
      </Section>

      <Section title={t('teamOpt.kqm.calc.groupExtra', 'Extra energy')}>
        {showFavonius && (
          <Box>
            <Label
              tip={t(
                'teamOpt.kqm.calc.favProcsTip',
                'Per rotation, while this member holds a Favonius weapon (counted per weapon during optimization). Each makes 3 clear particles: 6 Energy for the catcher, less for the others. At most one per 12 s (R1) to 6 s (R5).'
              )}
              aside={
                !mayFavonius ? (
                  <Tooltip
                    arrow
                    title={
                      isKqm
                        ? t(
                            'teamOpt.kqm.calc.noFavoniusTipKqm',
                            'Not counted until a Favonius weapon is allowed for this member in Weapons.'
                          )
                        : t(
                            'teamOpt.kqm.calc.noFavoniusTipTeam',
                            'Not counted until this member can hold a Favonius weapon (turn on Weapons too and tick one for them, or equip one).'
                          )
                    }
                  >
                    <Box component="span" sx={{ cursor: 'help' }}>
                      <Tag tone="warning">
                        {t(
                          'teamOpt.kqm.calc.noFavoniusShort',
                          'No Favonius selected'
                        )}
                      </Tag>
                    </Box>
                  </Tooltip>
                ) : (
                  member.favoniusProcs > 0 &&
                  !member.edited?.includes('favoniusProcs') && (
                    // (from the rotation: what a Favonius would give, counted by the run for the
                    // builds that hold one; the estimate above assumes none)
                    <Tooltip
                      arrow
                      title={t(
                        'teamOpt.kqm.calc.favoniusIfHeld',
                        'Counted for the builds that hold a Favonius weapon, not in the estimate above.'
                      )}
                    >
                      <Box component="span" sx={{ cursor: 'help' }}>
                        <Tag>
                          {t(
                            'teamOpt.kqm.calc.favoniusBuilds',
                            'Favonius builds only'
                          )}
                        </Tag>
                      </Box>
                    </Tooltip>
                  )
                )
              }
            >
              {t('teamOpt.kqm.calc.favProcs', 'Favonius triggers')}
            </Label>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Stepper
                value={member.favoniusProcs}
                onChange={(favoniusProcs) =>
                  updateMember(characterKey, { favoniusProcs })
                }
                ariaLabel={`${name}: ${t('teamOpt.kqm.calc.favProcs', 'Favonius triggers')}`}
                prefix="×"
                tip={usesTip}
              />
              <Typography
                sx={{ fontSize: 12.5, color: 'text.secondary', flexShrink: 0 }}
              >
                {t('teamOpt.kqm.calc.caughtBy', 'caught by')}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>{catcherSelect(true)}</Box>
            </Box>
            {favoniusShares && asPlayed(favoniusShares)}
            {mayFavonius &&
              bestFavonius &&
              (member.favoniusProcs > 0 ? (
                favoniusImpact && (
                  <Typography
                    sx={{
                      mt: 0.5,
                      fontSize: 12.5,
                      color: 'text.secondary',
                      ...numSx,
                    }}
                  >
                    {t('teamOpt.kqm.calc.withFavonius', {
                      defaultValue: 'With Favonius (R{{r}}):',
                      r: bestFavonius.refinement,
                    })}{' '}
                    {favoniusImpact.changes.length
                      ? favoniusImpact.changes
                          .map(
                            ({ characterKey: ck, to, diff }) =>
                              `${t(`charNames_gen:${ck}`, ck)} ${to}% (−${diff}%)`
                          )
                          .join(' · ')
                      : t(
                          'teamOpt.kqm.calc.noErChange',
                          'no ER change (all at 100%)'
                        )}
                  </Typography>
                )
              ) : (
                <Typography
                  sx={{ mt: 0.5, fontSize: 12.5, color: 'text.secondary' }}
                >
                  {t(
                    'teamOpt.kqm.calc.favZeroHint',
                    'Set triggers above 0 to count Favonius particles when this member holds one.'
                  )}
                </Typography>
              ))}
          </Box>
        )}
        <Box
          sx={{
            display: 'grid',
            gap: 1.75,
            gridTemplateColumns: showEnergyWeapon
              ? 'repeat(2, minmax(0, 1fr))'
              : 'minmax(0, 1fr)',
          }}
        >
          {showEnergyWeapon && (
            <Box>
              <Label
                tip={t(
                  'teamOpt.kqm.calc.weaponTriggersTip',
                  "Per rotation, while this member holds an energy weapon other than Favonius (Lumidouce Elegy, Dialogues of the Desert Sages…): the energy follows the weapon and its refinement, at most once per its cooldown. Frostbreath's goes to the other members. Prototype Amber counts by itself, once per Burst."
                )}
                aside={
                  !mayEnergyWeapon && (
                    <Tag tone="warning">
                      {t(
                        'teamOpt.kqm.calc.noEnergyWeaponShort',
                        'None selected'
                      )}
                    </Tag>
                  )
                }
              >
                {t('teamOpt.kqm.calc.weaponShort', 'Energy weapon')}
              </Label>
              <Stepper
                value={member.weaponEnergyTriggers ?? 0}
                onChange={(weaponEnergyTriggers) =>
                  updateMember(characterKey, { weaponEnergyTriggers })
                }
                ariaLabel={`${name}: ${t('teamOpt.kqm.calc.weaponTriggers', 'Energy weapon triggers')}`}
                prefix="×"
                tip={usesTip}
              />
              {mayEnergyWeapon &&
                bestEnergyWeapon &&
                energyWeaponImpact &&
                energyWeaponImpact.changes.length > 0 && (
                  <Typography
                    sx={{
                      mt: 0.5,
                      fontSize: 12.5,
                      color: 'text.secondary',
                      ...numSx,
                    }}
                  >
                    <WeaponName weaponKey={bestEnergyWeapon.key} />{' '}
                    {`(R${bestEnergyWeapon.refinement}): `}
                    {energyWeaponImpact.changes
                      .map(
                        ({ characterKey: ck, to, diff }) =>
                          `${t(`charNames_gen:${ck}`, ck)} ${to}% (−${diff}%)`
                      )
                      .join(' · ')}
                  </Typography>
                )}
            </Box>
          )}
          <Box>
            <Label
              tip={t(
                'teamOpt.kqm.calc.flatTip',
                'Energy per rotation from character abilities or effects shared by every build. From a written rotation it includes the Energy that constellations and passives restore as the rotation plays them, and the random Energy of the member’s Normal and Charged Attack hits.'
              )}
            >
              {t('teamOpt.kqm.calc.flat', 'Bonus energy')}
            </Label>
            <NumberField
              value={member.flatEnergy}
              min={Number.NEGATIVE_INFINITY}
              width={112}
              ariaLabel={`${name}: ${t('teamOpt.kqm.calc.flat', 'Bonus energy')}`}
              onChange={(flatEnergy) =>
                updateMember(characterKey, { flatEnergy })
              }
            />
            {Object.entries(member.scaledEnergy ?? {}).map(([giver, value]) => (
              <Typography
                key={giver}
                sx={{ mt: 0.5, fontSize: 12.5, color: 'text.secondary' }}
              >
                {t('teamOpt.kqm.calc.scaledEnergy', {
                  defaultValue:
                    'And {{value}} from {{name}} a rotation at 100% ER, more with their Energy Recharge',
                  value: +(value ?? 0).toFixed(1),
                  name: t(`charNames_gen:${giver}`, giver),
                })}
              </Typography>
            ))}
          </Box>
        </Box>
      </Section>
    </Box>
  )
}

/** The compact controls' look: 32 px, a hairline, gold when focused */
const controlSx = (theme: Theme) => ({
  height: 32,
  borderRadius: tokens.radius.control,
  fontSize: 13.5,
  bgcolor: alpha(theme.palette.text.primary, 0.03),
  boxShadow: `inset 0 0 0 1px ${tokens.hairlineStrong}`,
  ...quickSx,
  '&:hover': {
    boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.28)}`,
  },
  '&.Mui-focused': {
    boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}, 0 0 0 3px ${alpha(theme.palette.primary.main, 0.16)}`,
  },
  '&.Mui-error': { boxShadow: `inset 0 0 0 1px ${theme.palette.error.main}` },
})
const selectSx = (theme: Theme) => ({
  ...controlSx(theme),
  '& .MuiOutlinedInput-notchedOutline': { border: 0 },
  '& .MuiSelect-select': {
    py: 0,
    pl: 1.25,
    display: 'flex',
    alignItems: 'center',
  },
})

/** A number typed in (committed as typed; red while it is not a number) */
function NumberField({
  value,
  onChange,
  unit,
  min = 0,
  ariaLabel,
  width,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  unit?: string
  min?: number
  ariaLabel: string
  width?: number
  disabled?: boolean
}) {
  const [text, setText] = useState(() =>
    Number.isFinite(value) ? `${+value.toFixed(4)}` : ''
  )
  useEffect(
    () => setText(Number.isFinite(value) ? `${+value.toFixed(4)}` : ''),
    [value]
  )
  return (
    <InputBase
      value={text}
      onChange={(e) => {
        const next = e.target.value
        setText(next)
        onChange(next.trim() ? Number(next.replace(',', '.')) : Number.NaN)
      }}
      error={!Number.isFinite(value) || value < min}
      disabled={disabled}
      inputProps={{
        inputMode: 'decimal',
        'aria-label': ariaLabel,
        style: { textAlign: 'right' },
      }}
      endAdornment={
        unit ? (
          <Box component="span" sx={{ ...type.label, fontSize: 12, ml: 0.5 }}>
            {unit}
          </Box>
        ) : undefined
      }
      sx={(theme) => ({
        ...controlSx(theme),
        px: 1.25,
        width: width ?? '100%',
        flexShrink: 0,
        ...numSx,
      })}
    />
  )
}

/** A count with − and + (whole steps; typing any number works too) */
function Stepper({
  value,
  onChange,
  ariaLabel,
  prefix,
  tip,
}: {
  value: number
  onChange: (value: number) => void
  ariaLabel: string
  prefix?: string
  tip?: string
}) {
  const [text, setText] = useState(`${+value.toFixed(2)}`)
  useEffect(() => setText(`${+value.toFixed(2)}`), [value])
  const step = (d: number) =>
    onChange(Math.max(0, Math.round((value + d) * 100) / 100))
  const button = (d: number, icon: ReactNode, label: string) => (
    <IconButton
      size="small"
      aria-label={label}
      onClick={() => step(d)}
      disabled={d < 0 && value <= 0}
      sx={{
        p: 0.375,
        borderRadius: 1,
        color: 'text.secondary',
        '&:hover': { color: 'text.primary' },
      }}
    >
      {icon}
    </IconButton>
  )
  const control = (
    <Box
      sx={(theme) => ({
        ...controlSx(theme),
        display: 'inline-flex',
        alignItems: 'center',
        px: 0.25,
        flexShrink: 0,
        '&:focus-within': {
          boxShadow: `inset 0 0 0 1px ${theme.palette.primary.main}, 0 0 0 3px ${alpha(theme.palette.primary.main, 0.16)}`,
        },
      })}
    >
      {button(-1, <RemoveIcon sx={{ fontSize: 16 }} />, `${ariaLabel} −1`)}
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
          prefix ? (
            <Box
              component="span"
              sx={{ ...type.label, fontSize: 12, mr: 0.25 }}
            >
              {prefix}
            </Box>
          ) : undefined
        }
        sx={{ width: 44, fontSize: 13.5, fontWeight: 600, ...numSx }}
      />
      {button(1, <AddIcon sx={{ fontSize: 16 }} />, `${ariaLabel} +1`)}
    </Box>
  )
  return tip ? (
    <Tooltip arrow title={tip}>
      {control}
    </Tooltip>
  ) : (
    control
  )
}
