import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamKqmSavedRun,
  TeamOpt,
  TeamOptEnergyMember,
  TeamOptEnergyRotationField,
} from '@genshin-optimizer/gi/db'
import { teamOptEnergyRotationFields } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { Box } from '@mui/material'
import type { i18n as I18n } from 'i18next'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { kqmEnergyEstimate, MemberEnergy } from '../KqmEnergyCalculator'
import { EmptyLine } from '../ui'
import type { SwapIn } from './compareSwapKqm'
import { swapSettings } from './compareSwapKqm'
import { WarningLine } from './compareUi'

/**
 * The entering member's ER calculator inputs: as team B's rotation fills them in (the same
 * settings the comparison runs with), the ones changed here kept over the rotation's. Its field
 * time is the leaving member's.
 */
export function EnteringEnergy({
  teamId,
  saved,
  out,
  swapIn,
  text,
  opener,
  fragment,
  ready,
  own,
  setOwn,
}: {
  teamId: string
  saved: TeamKqmSavedRun
  out: CharacterKey | undefined
  swapIn: SwapIn | undefined
  text: string
  opener: string
  fragment: string
  ready: boolean
  own: TeamOptEnergyMember | undefined
  setOwn: (
    update: (
      previous: TeamOptEnergyMember | undefined
    ) => TeamOptEnergyMember | undefined
  ) => void
}) {
  const { t, i18n } = useTranslation(['juanlab', 'charNames_gen'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [settings, setSettings] = useState<
    { teamOpt: TeamOpt; keys: CharacterKey[] } | { message: string } | undefined
  >()
  // (a copy of the database and a replay: after the panel shows, again when the swap changes)
  useEffect(() => {
    if (!ready || !out || !swapIn) {
      setSettings(undefined)
      return
    }
    let cancelled = false
    const id = setTimeout(() => {
      let next: typeof settings
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
            : result
      } catch (e) {
        next = { message: String((e as Error)?.message ?? e) }
      }
      if (!cancelled) setSettings(next)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(id)
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
  ])
  const key = swapIn?.key
  const calc =
    settings && 'teamOpt' in settings
      ? settings.teamOpt.kqm?.energyCalculator
      : undefined
  const filled = key ? calc?.members[key] : undefined
  const member = useMemo(
    () => filled && own && { ...filled, ...own, fieldTime: filled.fieldTime },
    [filled, own]
  )
  const estimate = useMemo(
    () =>
      settings && 'teamOpt' in settings && calc
        ? kqmEnergyEstimate(settings.keys, calc, settings.teamOpt.kqm)
        : undefined,
    [settings, calc]
  )
  if (!ready || !key)
    return <EmptyLine>{t('kqmCompare.settingsNeedSwap')}</EmptyLine>
  if (settings && 'message' in settings)
    return (
      <Box sx={{ color: 'warning.main', fontSize: 13 }}>
        <WarningLine>{settings.message}</WarningLine>
      </Box>
    )
  if (!settings || !calc || !estimate)
    return <EmptyLine>{t('kqmCompare.settingsLoading')}</EmptyLine>
  return (
    <MemberEnergy
      characterKey={key}
      keys={settings.keys}
      kqm={settings.teamOpt.kqm}
      member={member ?? filled}
      rotationTime={calc.rotationTime}
      estimate={estimate}
      fromRotation
      lockFieldTime
      onUseRotation={() => setOwn(() => undefined)}
      updateMember={(_key, values) =>
        setOwn((previous) => {
          const base = previous ?? filled
          if (!base) return previous
          const { fieldTime: _fieldTime, ...rest } = values
          // (set here: the rotation no longer fills these in)
          const edited = [
            ...new Set([
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
