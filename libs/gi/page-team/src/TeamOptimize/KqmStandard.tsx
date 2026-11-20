import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamOptKqm } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { kqmMemberRolls } from '@genshin-optimizer/gi/ui'
import {
  KQM_ROLLS,
  kqmPieceCap,
  kqmRollBudget,
} from '@genshin-optimizer/gi/solver'
import {
  Box,
  InputAdornment,
  MenuItem,
  TextField,
  Tooltip,
} from '@mui/material'
import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FieldLabel, numSx, type } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/**
 * The artifact standard: how many rolls KQM mode places for damage on top of the 2 fixed rolls
 * of every substat. KQM Standards' 20 (at most 2 a piece per stat), higher presets, or a custom
 * number; the per-piece cap grows one per 10 rolls (`kqmPieceCap`).
 */
export const KQM_ROLL_PRESETS = [20, 25, 30, 40] as const
/** A custom standard's range */
export const KQM_CUSTOM_ROLLS = { min: 10, max: 50 } as const

/** A standard's name: KQM Standard, Good, Great, Top, else Custom */
export function kqmStandardName(t: TFunction, rolls: number) {
  switch (rolls) {
    case 20:
      return t('teamOpt.kqm.standard20', 'KQM Standard')
    case 25:
      return t('teamOpt.kqm.standard25', 'Good')
    case 30:
      return t('teamOpt.kqm.standard30', 'Great')
    case 40:
      return t('teamOpt.kqm.standard40', 'Top')
    default:
      return t('teamOpt.kqm.standardCustom', 'Custom')
  }
}
/** A standard's name in a member's row: KQMS for KQM Standard */
const kqmStandardShort = (t: TFunction, rolls: number) =>
  rolls === KQM_ROLLS
    ? t('teamOpt.kqm.standard20Short', 'KQMS')
    : kqmStandardName(t, rolls)
/** "20 rolls, at most 2 a piece per stat" */
export const kqmStandardDetail = (t: TFunction, rolls: number) =>
  t('teamOpt.kqm.standardDetail', {
    defaultValue: '{{rolls}} rolls, at most {{cap}} a piece per stat',
    rolls,
    cap: kqmPieceCap(rolls),
  })

/** A team's artifact standard: its distributed rolls (KQMS: 20) */
export const kqmStandardRolls = (kqm: Pick<TeamOptKqm, 'rolls'> | undefined) =>
  kqmRollBudget(kqm?.rolls)

/** Whether a team's KQM settings use KQM Standards' artifacts */
export const isKqmStandard = (kqm: Pick<TeamOptKqm, 'rolls'> | undefined) =>
  kqmRollBudget(kqm?.rolls) === KQM_ROLLS

const isPreset = (rolls: number) =>
  (KQM_ROLL_PRESETS as readonly number[]).includes(rolls)
const validCustom = (n: number) =>
  Number.isInteger(n) && n >= KQM_CUSTOM_ROLLS.min && n <= KQM_CUSTOM_ROLLS.max

/** The members' distributed rolls, in their order */
const memberRolls = (
  kqm: Pick<TeamOptKqm, 'rolls' | 'memberRolls'> | undefined,
  keys: readonly CharacterKey[]
) => keys.map((k) => kqmMemberRolls(k, kqm))

/** Whether the members' artifact standards differ */
export function kqmRollsMixed(
  kqm: Pick<TeamOptKqm, 'rolls' | 'memberRolls'> | undefined,
  keys: readonly CharacterKey[]
) {
  const all = memberRolls(kqm, keys)
  return all.some((n) => n !== all[0])
}

/** The members' distributed rolls as one figure: "30", or "20–40" when they differ */
export function kqmRollsText(
  kqm: Pick<TeamOptKqm, 'rolls' | 'memberRolls'> | undefined,
  keys: readonly CharacterKey[]
) {
  const all = memberRolls(kqm, keys)
  if (!all.length) return `${kqmStandardRolls(kqm)}`
  const min = Math.min(...all)
  const max = Math.max(...all)
  return min === max ? `${min}` : `${min}–${max}`
}

/**
 * Whether the rolls are typed in, one box per member: Custom was picked, or a member's rolls are
 * not a preset
 */
export function useKqmCustomRolls(
  kqm: Pick<TeamOptKqm, 'rolls' | 'memberRolls'> | undefined,
  keys: readonly CharacterKey[]
) {
  const typed = memberRolls(kqm, keys).some((n) => !isPreset(n))
  const [picked, setPicked] = useState(typed)
  return [picked || typed, setPicked] as const
}

/** Every member at `rolls` */
function setAllRolls(o: TeamOpt, rolls: number) {
  const settings = (o.kqm ??= { ...defaultTeamOptKqm })
  settings.rolls = rolls === KQM_ROLLS ? undefined : rolls
  settings.memberRolls = undefined
}
/** One member at `rolls` (all the same again: one standard for the team) */
function setMemberRolls(
  o: TeamOpt,
  keys: readonly CharacterKey[],
  characterKey: CharacterKey,
  rolls: number
) {
  const settings = (o.kqm ??= { ...defaultTeamOptKqm })
  const next = {
    ...settings,
    memberRolls: { ...settings.memberRolls, [characterKey]: rolls },
  }
  const all = memberRolls(next, keys)
  if (all.every((n) => n === all[0])) setAllRolls(o, all[0])
  else settings.memberRolls = next.memberRolls
}

const CUSTOM = 'custom'
const MIXED = 'mixed'

/** The presets with what each places, then Custom: a standard menu's items */
function standardItems(t: TFunction) {
  return [
    ...KQM_ROLL_PRESETS.map((n) => (
      <MenuItem key={n} value={n} sx={{ display: 'block' }}>
        <Box component="span" sx={{ display: 'block' }}>
          {kqmStandardName(t, n)} ({n})
        </Box>
        <Box component="span" sx={{ ...type.label, display: 'block' }}>
          {kqmStandardDetail(t, n)}
        </Box>
      </MenuItem>
    )),
    <MenuItem key={CUSTOM} value={CUSTOM} sx={{ display: 'block' }}>
      <Box component="span" sx={{ display: 'block' }}>
        {kqmStandardName(t, 0)}
      </Box>
      <Box component="span" sx={{ ...type.label, display: 'block' }}>
        {t('teamOpt.kqm.standardCustomDetail', {
          defaultValue: 'Type each member’s rolls, {{min}} to {{max}}',
          ...KQM_CUSTOM_ROLLS,
        })}
      </Box>
    </MenuItem>,
  ]
}

/** The artifact standard for every member at once (Mixed while they differ) */
export function KqmArtifactStandard({
  kqm,
  members,
  custom,
  setCustom,
  setTeamOpt,
}: {
  kqm: TeamOptKqm | undefined
  members: readonly CharacterKey[]
  /** The rolls are typed in, per member (`useKqmCustomRolls`) */
  custom: boolean
  setCustom: (custom: boolean) => void
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const mixed = kqmRollsMixed(kqm, members)
  const rolls = members.length
    ? kqmMemberRolls(members[0], kqm)
    : kqmStandardRolls(kqm)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FieldLabel
        tip={t(
          'teamOpt.kqm.standardAllTip',
          'Sets every member’s artifacts; each can be changed in its row. How many substat rolls a build places for damage, on top of 2 fixed rolls of every substat: KQM Standards place 20, at most 2 on a piece per stat; a higher standard places more, and up to one more per piece for every 10 rolls (at most 5). Every roll is an average roll; a 4★ piece has 2 fewer.'
        )}
      >
        {t('teamOpt.kqm.standard', 'Artifacts')}
      </FieldLabel>
      <TextField
        select
        size="small"
        value={custom ? CUSTOM : mixed ? MIXED : rolls}
        onChange={(e) => {
          if (e.target.value === CUSTOM) return setCustom(true)
          setCustom(false)
          setTeamOpt((o) => setAllRolls(o, Number(e.target.value)))
        }}
        SelectProps={{
          renderValue: (v) =>
            v === CUSTOM
              ? kqmStandardName(t, 0)
              : v === MIXED
                ? t('teamOpt.kqm.standardMixed', 'Mixed')
                : `${kqmStandardName(t, Number(v))} (${v})`,
        }}
        inputProps={{
          'aria-label': t(
            'teamOpt.kqm.standardAll',
            'Every member’s artifacts'
          ),
        }}
        sx={{
          minWidth: 150,
          '& .MuiInputBase-root': { fontSize: 13 },
          '& .MuiSelect-select': { py: 0.5 },
        }}
      >
        {standardItems(t)}
        <MenuItem value={MIXED} sx={{ display: 'none' }} />
      </TextField>
    </Box>
  )
}

/** A member's artifact standard in its row: a preset, or its rolls typed in (Custom) */
export function KqmMemberRolls({
  characterKey,
  members,
  kqm,
  custom,
  setCustom,
  setTeamOpt,
}: {
  characterKey: CharacterKey
  members: readonly CharacterKey[]
  kqm: TeamOptKqm | undefined
  custom: boolean
  setCustom: (custom: boolean) => void
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const rolls = kqmMemberRolls(characterKey, kqm)
  const [text, setText] = useState(`${rolls}`)
  useEffect(() => setText(`${rolls}`), [rolls])
  const save = (n: number) =>
    setTeamOpt((o) => setMemberRolls(o, members, characterKey, n))
  const label = t('teamOpt.kqm.memberArtifacts', {
    defaultValue: '{{character}} artifacts',
    character: characterKey,
  })
  const fieldSx = {
    '& .MuiInputBase-root': { fontSize: 14 },
    '& .MuiSelect-select': { py: 0.875, ...numSx },
  }
  if (!custom)
    return (
      <TextField
        select
        size="small"
        fullWidth
        value={rolls}
        onChange={(e) => {
          if (e.target.value === CUSTOM) return setCustom(true)
          save(Number(e.target.value))
        }}
        SelectProps={{
          renderValue: (v) => `${kqmStandardShort(t, Number(v))} (${v})`,
        }}
        inputProps={{ 'aria-label': label }}
        sx={fieldSx}
      >
        {standardItems(t)}
      </TextField>
    )
  const invalid = !validCustom(Number(text))
  return (
    <Tooltip
      arrow
      title={
        invalid
          ? t('teamOpt.kqm.standardRange', {
              defaultValue: '{{min}} to {{max}}',
              ...KQM_CUSTOM_ROLLS,
            })
          : kqmStandardDetail(t, rolls)
      }
    >
      <TextField
        size="small"
        fullWidth
        value={text}
        error={invalid}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (validCustom(n)) save(n)
        }}
        inputProps={{
          inputMode: 'numeric',
          'aria-label': t('teamOpt.kqm.memberRollsInput', {
            defaultValue: '{{character}} artifact rolls',
            character: characterKey,
          }),
        }}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <Box component="span" sx={type.label}>
                {t('teamOpt.kqm.rollsUnit', 'rolls')}
              </Box>
            </InputAdornment>
          ),
        }}
        sx={{
          '& .MuiInputBase-root': { fontSize: 14, px: { xs: 1, sm: 1.25 } },
          '& .MuiInputBase-input': {
            py: 0.875,
            px: 0,
            textAlign: 'right',
            ...numSx,
          },
        }}
      />
    </Tooltip>
  )
}
