import type { TeamOptKqm } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import {
  KQM_ROLLS,
  kqmPieceCap,
  kqmRollBudget,
} from '@genshin-optimizer/gi/solver'
import { Box, MenuItem, TextField } from '@mui/material'
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

/** A standard's name: KQM Standard, Good, Great, Top, else its number of rolls */
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

const CUSTOM = 'custom'
export function KqmArtifactStandard({
  kqm,
  setTeamOpt,
}: {
  kqm: TeamOptKqm | undefined
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const rolls = kqmRollBudget(kqm?.rolls)
  const isPreset = (KQM_ROLL_PRESETS as readonly number[]).includes(rolls)
  const [custom, setCustom] = useState(!isPreset)
  const [text, setText] = useState(`${rolls}`)
  useEffect(() => {
    setText(`${rolls}`)
    if (!(KQM_ROLL_PRESETS as readonly number[]).includes(rolls))
      setCustom(true)
  }, [rolls])
  const save = (n: number) =>
    setTeamOpt((o) => {
      const settings = (o.kqm ??= { ...defaultTeamOptKqm })
      settings.rolls = n === KQM_ROLLS ? undefined : n
    })
  const typed = Number(text)
  const invalid =
    custom &&
    !(
      Number.isInteger(typed) &&
      typed >= KQM_CUSTOM_ROLLS.min &&
      typed <= KQM_CUSTOM_ROLLS.max
    )
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FieldLabel
        tip={t(
          'teamOpt.kqm.standardTip',
          'How many substat rolls each build places for damage, on top of 2 fixed rolls of every substat. KQM Standards place 20, at most 2 on a piece per stat; a higher standard places more, and up to one more per piece for every 10 rolls (at most 5). Every roll is an average roll; a 4★ piece has 2 fewer.'
        )}
      >
        {t('teamOpt.kqm.standard', 'Artifacts')}
      </FieldLabel>
      <TextField
        select
        size="small"
        value={custom ? CUSTOM : rolls}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true)
            return
          }
          setCustom(false)
          save(Number(e.target.value))
        }}
        SelectProps={{
          renderValue: (v) =>
            v === CUSTOM
              ? kqmStandardName(t, 0)
              : `${kqmStandardName(t, Number(v))} (${v})`,
        }}
        inputProps={{
          'aria-label': t('teamOpt.kqm.standard', 'Artifacts'),
        }}
        sx={{
          minWidth: 150,
          '& .MuiInputBase-root': { fontSize: 13 },
          '& .MuiSelect-select': { py: 0.5 },
        }}
      >
        {KQM_ROLL_PRESETS.map((n) => (
          <MenuItem key={n} value={n} sx={{ display: 'block' }}>
            <Box component="span" sx={{ display: 'block' }}>
              {kqmStandardName(t, n)} ({n})
            </Box>
            <Box component="span" sx={{ ...type.label, display: 'block' }}>
              {kqmStandardDetail(t, n)}
            </Box>
          </MenuItem>
        ))}
        <MenuItem value={CUSTOM}>{kqmStandardName(t, 0)}</MenuItem>
      </TextField>
      {custom && (
        <TextField
          size="small"
          value={text}
          error={invalid}
          helperText={
            invalid
              ? t('teamOpt.kqm.standardRange', {
                  defaultValue: '{{min}} to {{max}}',
                  ...KQM_CUSTOM_ROLLS,
                })
              : undefined
          }
          onChange={(e) => {
            setText(e.target.value)
            const n = Number(e.target.value)
            if (
              Number.isInteger(n) &&
              n >= KQM_CUSTOM_ROLLS.min &&
              n <= KQM_CUSTOM_ROLLS.max
            )
              save(n)
          }}
          inputProps={{
            inputMode: 'numeric',
            'aria-label': t('teamOpt.kqm.standardRolls', 'Rolls placed'),
          }}
          sx={{
            width: 72,
            '& .MuiInputBase-root': { fontSize: 13 },
            '& .MuiInputBase-input': { py: 0.5, textAlign: 'right', ...numSx },
          }}
        />
      )}
    </Box>
  )
}
