import { objPathValue } from '@genshin-optimizer/common/util'
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamKqmSavedRun,
  TeamOpt,
  TeamOptEnergyMember,
  TeamOptEnergyRotationField,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { teamOptEnergyRotationFields } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getArtSheet, getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import type { KqmSets, TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  ArtifactSetName,
  isEnergyWeapon,
  kqmSets,
  kqmWeapons,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import { Box, InputAdornment, TextField, Typography } from '@mui/material'
import type { i18n as I18n, TFunction } from 'i18next'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  kqmEnergyEstimate,
  kqmEnergyGear,
  MemberEnergy,
} from '../KqmEnergyCalculator'
import { EmptyLine, FieldLabel, hairline, insetSx, numSx } from '../ui'
import type { PassiveStore } from '../WeaponChooser'
import {
  isConditional,
  PassiveLines,
  PassiveStoreContext,
} from '../WeaponChooser'
import { compareFailureText } from './compareError'
import type { SwapIn } from './compareSwapKqm'
import { swapSettings } from './compareSwapKqm'
import { WarningLine } from './compareUi'

/*
 * The entering member's own KQM settings in KQM Compare: what KQM Theorycrafting offers for a
 * member (its ER target or ER calculator inputs, its weapon and set effects, the energy weapons'
 * ER relief), kept in KQM Compare's state and passed to the comparison in `SwapIn.kqm`.
 */

/** The entering member's weapon and set effects (`TeamOptKqm.passives` for it): item → state */
export type EnteringPassives = Record<string, Record<string, string>>
/** What each energy weapon saves the entering member (`TeamOptKqm.weaponEnergy` for it), % */
export type EnteringWeaponEnergy = Partial<Record<WeaponKey, number>>

/** Team B's settings as the comparison runs them, worked out after the swap stops changing */
type SwapSettings =
  | {
      teamOpt: TeamOpt
      keys: CharacterKey[]
      rules: Record<string, unknown>
      /** The swap it was worked out for */
      for: string
      swapIn: SwapIn
    }
  | { message: string }

function useSwapSettings({
  teamId,
  saved,
  out,
  swapIn,
  text,
  opener,
  fragment,
  ready,
}: {
  teamId: string
  saved: TeamKqmSavedRun
  out: CharacterKey | undefined
  swapIn: SwapIn | undefined
  text: string
  opener: string
  fragment: string
  ready: boolean
}) {
  const { t, i18n } = useTranslation(['juanlab', 'charNames_gen'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [settings, setSettings] = useState<SwapSettings>()
  const id = `${out}|${fragment}|${text}|${opener}`
  // (a copy of the database and a replay: after the panel shows, again when the swap changes)
  useEffect(() => {
    if (!ready || !out || !swapIn) {
      setSettings(undefined)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      let next: SwapSettings
      try {
        const result = swapSettings({
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
        })
        next =
          'error' in result
            ? { message: t('kqmCompare.error.unsupported') }
            : { ...result, for: id, swapIn }
      } catch (e) {
        // (a known failure in the user's language)
        next = {
          message: compareFailureText(e, t as unknown as TFunction, (ck) =>
            t(`charNames_gen:${charKeyToLocGenderedCharKey(ck, gender)}`)
          ),
        }
      }
      if (!cancelled) setSettings(next)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [
    database,
    teamId,
    gender,
    i18n,
    saved,
    out,
    swapIn,
    text,
    opener,
    fragment,
    ready,
    t,
    id,
  ])
  // (worked out for this very swap: what the comparison would run with)
  const current =
    !!settings &&
    'teamOpt' in settings &&
    settings.for === id &&
    settings.swapIn === swapIn
  return { settings, current }
}

/** The entering member's KQM settings: ER, weapon and set effects, energy weapons */
export function EnteringSettings({
  teamId,
  saved,
  out,
  swapIn,
  text,
  opener,
  fragment,
  ready,
  calculator,
  erText,
  setErText,
  erInvalid,
  calcOwn,
  setCalcOwn,
  passives,
  setPassives,
  weaponEnergy,
  setWeaponEnergy,
  data,
  teammateWeapons,
  teamKqm,
  pick,
  disabled,
}: {
  teamId: string
  saved: TeamKqmSavedRun
  out: CharacterKey | undefined
  swapIn: SwapIn | undefined
  text: string
  opener: string
  fragment: string
  /** B's rotation is ready (the fragment fits) */
  ready: boolean
  /** The team's ER targets come from the ER calculator */
  calculator: boolean
  erText: string
  setErText: (text: string) => void
  erInvalid: boolean
  calcOwn: TeamOptEnergyMember | undefined
  setCalcOwn: (
    update: (
      previous: TeamOptEnergyMember | undefined
    ) => TeamOptEnergyMember | undefined
  ) => void
  passives: EnteringPassives
  setPassives: (
    update: (previous: EnteringPassives) => EnteringPassives
  ) => void
  weaponEnergy: EnteringWeaponEnergy
  setWeaponEnergy: (
    update: (previous: EnteringWeaponEnergy) => EnteringWeaponEnergy
  ) => void
  /** Where effect states that depend on the character are read (a teammate's, as KQM's set list) */
  data: UIData | undefined
  /** The weapons the teammates hold in A (and in B) */
  teammateWeapons: WeaponKey[]
  teamKqm: TeamOptKqm | undefined
  /** The entering member's weapon and sets, when not Auto */
  pick: { weapon: WeaponKey; sets: KqmSets } | undefined
  disabled: boolean
}) {
  const { t } = useTranslation('juanlab')
  const { settings, current } = useSwapSettings({
    teamId,
    saved,
    out,
    swapIn,
    text,
    opener,
    fragment,
    ready,
  })
  const key = swapIn?.key
  const ok = settings && 'teamOpt' in settings ? settings : undefined
  // (B's settings: the pick allowed; else the team's)
  const kqm = ok?.teamOpt.kqm ?? teamKqm
  const notReady = !ready || !key
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Section title={t('kqmCompare.erSection')}>
        {calculator ? (
          notReady ? (
            <EmptyLine>{t('kqmCompare.settingsNeedSwap')}</EmptyLine>
          ) : settings && 'message' in settings ? (
            <Box sx={{ color: 'warning.main', fontSize: 13 }}>
              <WarningLine>{settings.message}</WarningLine>
            </Box>
          ) : !ok ? (
            <EmptyLine>{t('kqmCompare.settingsLoading')}</EmptyLine>
          ) : (
            <EnteringEnergy
              characterKey={key}
              teamOpt={ok.teamOpt}
              keys={ok.keys}
              current={current}
              own={calcOwn}
              setOwn={setCalcOwn}
            />
          )
        ) : (
          <TextField
            size="small"
            label={t('kqmCompare.erTarget')}
            value={erText}
            placeholder="100"
            disabled={disabled}
            onChange={(e) => setErText(e.target.value)}
            error={erInvalid}
            InputProps={{
              endAdornment: <InputAdornment position="end">%</InputAdornment>,
            }}
            inputProps={{ inputMode: 'decimal', style: { textAlign: 'right' } }}
            sx={{ width: 160, ...numSx }}
          />
        )}
      </Section>
      {key && (
        <Section
          title={t('kqmCompare.effects')}
          tip={t('kqmCompare.effectsTip')}
        >
          {notReady ? (
            <EmptyLine>{t('kqmCompare.settingsNeedSwap')}</EmptyLine>
          ) : !ok ? (
            <EmptyLine>{t('kqmCompare.settingsLoading')}</EmptyLine>
          ) : (
            <EnteringEffects
              characterKey={key}
              kqm={kqm}
              pick={pick}
              rules={ok.rules}
              passives={passives}
              setPassives={setPassives}
              data={data}
            />
          )}
        </Section>
      )}
      {key && (
        <Section
          title={t('kqmCompare.weaponEnergy')}
          tip={t('kqmCompare.weaponEnergyTip')}
        >
          <EnteringWeaponEnergyList
            weapons={[
              ...new Set([
                ...(pick
                  ? [pick.weapon]
                  : kqmWeapons(key, kqm).map((w) => w.key)),
                ...teammateWeapons,
              ]),
            ]}
            value={weaponEnergy}
            setValue={setWeaponEnergy}
            disabled={disabled}
          />
        </Section>
      )}
    </Box>
  )
}

function Section({
  title,
  tip,
  children,
}: {
  title: ReactNode
  tip?: ReactNode
  children: ReactNode
}) {
  return (
    <Box
      component="section"
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
    >
      <Typography component="h4" sx={{ m: 0 }}>
        <FieldLabel tip={tip}>{title}</FieldLabel>
      </Typography>
      {children}
    </Box>
  )
}

/**
 * The entering member's ER calculator inputs: as team B's rotation fills them in (the same
 * settings the comparison runs with), the ones changed here kept over the rotation's. Its field
 * time is the leaving member's.
 */
function EnteringEnergy({
  characterKey,
  teamOpt,
  keys,
  current,
  own,
  setOwn,
}: {
  characterKey: CharacterKey
  teamOpt: TeamOpt
  keys: CharacterKey[]
  /** `teamOpt` is for the swap as it is now (not one being worked out again) */
  current: boolean
  own: TeamOptEnergyMember | undefined
  setOwn: (
    update: (
      previous: TeamOptEnergyMember | undefined
    ) => TeamOptEnergyMember | undefined
  ) => void
}) {
  const calc = teamOpt.kqm?.energyCalculator
  const filled = calc?.members[characterKey]
  // B's inputs already hold the ones set here; while they are worked out again, the ones just
  // set are shown over them (the others are the rotation's, about to change)
  const member = useMemo(() => {
    if (!filled) return undefined
    if (current || !own) return filled
    const kept = (Object.keys(own) as (keyof TeamOptEnergyMember)[]).filter(
      (field) =>
        field !== 'fieldTime' &&
        (!(teamOptEnergyRotationFields as readonly string[]).includes(field) ||
          own.edited?.includes(field as TeamOptEnergyRotationField))
    )
    return {
      ...filled,
      ...Object.fromEntries(kept.map((field) => [field, own[field]])),
    } as TeamOptEnergyMember
  }, [filled, own, current])
  const estimate = useMemo(
    () => calc && kqmEnergyEstimate(keys, calc, teamOpt.kqm),
    [keys, calc, teamOpt.kqm]
  )
  if (!calc || !estimate) return null
  return (
    <MemberEnergy
      characterKey={characterKey}
      keys={keys}
      gear={kqmEnergyGear(teamOpt.kqm)}
      member={member}
      rotationTime={calc.rotationTime}
      estimate={estimate}
      fromRotation
      lockFieldTime
      onUseRotation={() => setOwn(() => undefined)}
      updateMember={(_key, values) =>
        setOwn((previous) => {
          // (from what is shown: the rotation's inputs as they are now)
          const base = member ?? previous
          if (!base) return previous
          const { fieldTime: _fieldTime, ...rest } = values
          // (set here: the rotation no longer fills these in)
          const edited = [
            ...new Set([
              ...(previous?.edited ?? []),
              ...(base.edited ?? []),
              ...(Object.keys(rest) as TeamOptEnergyRotationField[]).filter(
                (field) => teamOptEnergyRotationFields.includes(field)
              ),
            ]),
          ]
          return { ...base, ...rest, ...(edited.length && { edited }) }
        })
      }
    />
  )
}

/** A stand-in team member for the effect switches (they read and write through the store only) */
const memberOf = (characterKey: CharacterKey) =>
  ({
    characterKey,
    teamCharId: '',
    teamChar: { key: characterKey, conditional: {} },
  }) as unknown as TeamOptMember

const weaponPassives = (key: WeaponKey) =>
  (getWeaponSheet(key)?.document ?? []).filter(isConditional)
const setPassives = (key: ArtifactSetKey, pieces: number[]) =>
  pieces.flatMap((n) =>
    (getArtSheet(key)?.setEffectDocument(n as 2 | 4) ?? []).filter(
      isConditional
    )
  )

/**
 * The entering member's weapon and set effects, as KQM Theorycrafting shows a member's: for its
 * weapon and sets, or (Auto) every one the KQM search may give it. A switch sets the entering
 * member's own state; unset, the rule-based state (B's) is shown, as the run counts it.
 */
function EnteringEffects({
  characterKey,
  kqm,
  pick,
  rules,
  passives,
  setPassives: setOwn,
  data,
}: {
  characterKey: CharacterKey
  kqm: TeamOptKqm | undefined
  pick: { weapon: WeaponKey; sets: KqmSets } | undefined
  rules: Record<string, unknown>
  passives: EnteringPassives
  setPassives: (
    update: (previous: EnteringPassives) => EnteringPassives
  ) => void
  data: UIData | undefined
}) {
  const { t } = useTranslation('juanlab')
  const wielders = useMemo(() => [memberOf(characterKey)], [characterKey])
  const store: PassiveStore = useMemo(
    () => ({
      get: (_member, path) => {
        const [item, cond] = [path[0], path[path.length - 1]]
        const own = passives[item]?.[cond]
        if (own !== undefined) return own || undefined
        return objPathValue(rules, path as string[]) as string | undefined
      },
      set: (_member, path, next) => {
        const [item, cond] = [path[0], path[path.length - 1]]
        setOwn((previous) => ({
          ...previous,
          [item]: { ...previous[item], [cond]: next ?? '' },
        }))
      },
    }),
    [passives, rules, setOwn]
  )
  const weapons = useMemo(
    () =>
      (pick ? [pick.weapon] : kqmWeapons(characterKey, kqm).map((w) => w.key))
        .map((key) => ({ key, passives: weaponPassives(key) }))
        .filter((w) => w.passives.length),
    [pick, characterKey, kqm]
  )
  const sets = useMemo(() => {
    const excluded = new Set(kqm?.excludedSets ?? [])
    const list: [ArtifactSetKey, number[]][] = pick
      ? (Object.entries(pick.sets) as [ArtifactSetKey, number][])
          .filter(([, n]) => n)
          .map(([key, n]) => [key, n >= 4 ? [2, 4] : [2]])
      : kqmSets()
          .filter((key) => !excluded.has(key))
          .map((key) => [key, [2, 4]])
    return list
      .map(([key, pieces]) => ({ key, passives: setPassives(key, pieces) }))
      .filter((s) => s.passives.length)
  }, [pick, kqm])
  if (!weapons.length && !sets.length)
    return <EmptyLine>{t('kqmCompare.noEffects')}</EmptyLine>
  return (
    <PassiveStoreContext.Provider value={store}>
      <Box
        role="list"
        aria-label={t('kqmCompare.effects')}
        sx={{ ...insetSx, display: 'flex', flexDirection: 'column' }}
      >
        {[
          ...weapons.map((w) => ({
            id: w.key,
            name: <WeaponName weaponKey={w.key} />,
            passives: w.passives,
          })),
          ...sets.map((s) => ({
            id: s.key,
            name: <ArtifactSetName setKey={s.key} />,
            passives: s.passives,
          })),
        ].map((item, i) => (
          <Box
            role="listitem"
            key={item.id}
            sx={{ px: 1.25, py: 0.75, borderTop: i ? hairline : undefined }}
          >
            <Typography sx={{ fontSize: 13.5, fontWeight: 600 }}>
              {item.name}
            </Typography>
            <PassiveLines
              weaponKey={item.id}
              passives={item.passives}
              wielders={wielders}
              data={data}
            />
          </Box>
        ))}
      </Box>
    </PassiveStoreContext.Provider>
  )
}

/**
 * How much less Energy Recharge the entering member needs while someone in team B wields each
 * energy weapon (its own, or a teammate's), as KQM Theorycrafting's weapon list sets per member
 */
function EnteringWeaponEnergyList({
  weapons,
  value,
  setValue,
  disabled,
}: {
  weapons: WeaponKey[]
  value: EnteringWeaponEnergy
  setValue: (
    update: (previous: EnteringWeaponEnergy) => EnteringWeaponEnergy
  ) => void
  disabled: boolean
}) {
  const { t } = useTranslation(['juanlab', 'weaponNames_gen'])
  const shown = weapons.filter((w) => isEnergyWeapon(w) || (value[w] ?? 0) > 0)
  if (!shown.length)
    return <EmptyLine>{t('kqmCompare.noEnergyWeapons')}</EmptyLine>
  return (
    <Box
      role="list"
      aria-label={t('kqmCompare.weaponEnergy')}
      sx={{ ...insetSx, display: 'flex', flexDirection: 'column' }}
    >
      {shown.map((w, i) => (
        <Box
          role="listitem"
          key={w}
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            px: 1.25,
            py: 0.75,
            minHeight: 40,
            borderTop: i ? hairline : undefined,
          }}
        >
          <Typography sx={{ fontSize: 13.5, flex: '1 1 160px', minWidth: 0 }}>
            <WeaponName weaponKey={w} />
          </Typography>
          <EnergyField
            label={t('kqmCompare.weaponEnergyField', {
              weapon: t(`weaponNames_gen:${w}`, w),
            })}
            value={value[w] ?? 0}
            disabled={disabled}
            onChange={(v) =>
              setValue((previous) => {
                const next = { ...previous }
                if (v > 0) next[w] = v
                else delete next[w]
                return next
              })
            }
          />
        </Box>
      ))}
    </Box>
  )
}

/** A percentage typed as it is (20 or −20 both mean 20% less, as KQM Theorycrafting's) */
function EnergyField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  disabled: boolean
}) {
  const [text, setText] = useState(value ? String(value) : '')
  useEffect(() => {
    setText((previous) =>
      Math.abs(Number(previous.replace(',', '.')) || 0) === value
        ? previous
        : value
          ? String(value)
          : ''
    )
  }, [value])
  return (
    <TextField
      size="small"
      value={text}
      placeholder="0"
      disabled={disabled}
      onChange={(e) => {
        setText(e.target.value)
        const n = Math.abs(Number(e.target.value.replace(',', '.')))
        onChange(Number.isFinite(n) ? Math.min(n, 500) : 0)
      }}
      InputProps={{
        startAdornment: <InputAdornment position="start">−</InputAdornment>,
        endAdornment: <InputAdornment position="end">%</InputAdornment>,
      }}
      inputProps={{
        inputMode: 'decimal',
        'aria-label': label,
        style: { textAlign: 'right' },
      }}
      sx={{ width: 120, ...numSx }}
    />
  )
}
