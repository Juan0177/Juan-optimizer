import type { Team, TeamFightSettings } from '@genshin-optimizer/gi/db'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type { FightTeam } from '@genshin-optimizer/gi/ui'
import { enemyFreezeImmune, MOONGECKO } from '@genshin-optimizer/gi/ui'
import { alpha, Box, ButtonBase, InputBase, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PARTY_HEALERS } from '../TeamOptimize/fightTeam'
import { siteDecimal } from '../TeamOptimize/format'
import { focusSx, numSx, quickSx, tokens, type } from '../TeamOptimize/ui'
import { useSetEnemy } from './enemyScope'

/** A ward kept past its 35 s, as set: the most it can be given */
const NOT_IN_TIME = 60

/**
 * How the team plays the Radiant Moongecko, where its fight cannot tell: how long it takes to break
 * the Moonstone Anchor's ward, and to be healed to full after each Radiant Cocoon. Emptied: the
 * team's own (the written rotation's ward time, a healer's few seconds)
 */
export function MoongeckoSettings({
  teamId,
  team,
  fight,
  disabled,
}: {
  teamId: string
  team: Team
  fight?: FightTeam
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const setEnemy = useSetEnemy(teamId)
  const settings = team.fightSettings ?? {}
  const set = (key: 'wardSeconds' | 'healSeconds', value: number | undefined) =>
    setEnemy((team) => {
      const next: TeamFightSettings = { ...team.fightSettings }
      if (value === undefined) delete next[key]
      else next[key] = value
      team.fightSettings = Object.keys(next).length ? next : undefined
    })
  const ward = settings.wardSeconds
  const kept = ward !== undefined && ward > MOONGECKO.window
  const estimate = fight?.wardSeconds
  const wardAuto = !fight
    ? t('enemy.moongecko.wardLater', 'From the rotation, once there are builds')
    : estimate === undefined
      ? t('enemy.moongecko.wardAssumed', {
          defaultValue: 'Assumed {{s}} s (no written rotation)',
          s: MOONGECKO.wardDefault,
        })
      : Number.isFinite(estimate) && estimate <= MOONGECKO.window
        ? t('enemy.moongecko.wardRotation', {
            defaultValue: '≈ {{s}} s from the rotation’s Blunt hits',
            s: siteDecimal(estimate),
          })
        : t(
            'enemy.moongecko.wardRotationKept',
            'Not in time from the rotation’s Blunt hits'
          )
  const heal = settings.healSeconds
  const never = heal !== undefined && heal < 0
  // (a healer among the members: their kits heal the party)
  const healer = team.loadoutData.some((datum) => {
    const key = datum && database.teamChars.get(datum.teamCharId)?.key
    return !!key && PARTY_HEALERS.has(key)
  })
  const healAuto = healer
    ? t('enemy.moongecko.healAuto', {
        defaultValue: '{{s}} s: a healer in the team',
        s: MOONGECKO.heal,
      })
    : t('enemy.moongecko.healNone', 'Never: no healer in the team')
  return (
    <Box sx={{ display: 'grid', gap: 1.25 }}>
      <Row
        label={t('enemy.moongecko.ward', 'Ward broken in')}
        hint={kept ? undefined : ward === undefined ? wardAuto : undefined}
      >
        {!kept && (
          <SecondsField
            value={ward}
            max={MOONGECKO.window}
            min={1}
            placeholder={
              !fight
                ? '–'
                : estimate !== undefined && Number.isFinite(estimate)
                  ? Math.min(estimate, MOONGECKO.window).toFixed(1)
                  : String(MOONGECKO.wardDefault)
            }
            disabled={disabled}
            onChange={(v) => set('wardSeconds', v)}
            aria-label={t(
              'enemy.moongecko.wardLabel',
              'Seconds to break the Anchor’s ward'
            )}
          />
        )}
        <Toggle
          on={kept}
          disabled={disabled}
          onClick={() => set('wardSeconds', kept ? undefined : NOT_IN_TIME)}
        >
          {t('enemy.moongecko.notInTime', 'Not in 35 s')}
        </Toggle>
      </Row>
      <Row
        label={t('enemy.moongecko.heal', 'Healed to full')}
        hint={never ? undefined : heal === undefined ? healAuto : undefined}
      >
        {!never && (
          <SecondsField
            value={heal}
            min={0}
            max={MOONGECKO.stage}
            placeholder={healer ? String(MOONGECKO.heal) : '–'}
            disabled={disabled}
            onChange={(v) => set('healSeconds', v)}
            aria-label={t(
              'enemy.moongecko.healLabel',
              'Seconds after its roar until the team is healed to full'
            )}
            suffix={t('enemy.moongecko.afterRoar', 's after its roar')}
          />
        )}
        <Toggle
          on={never}
          disabled={disabled}
          onClick={() => set('healSeconds', never ? undefined : -1)}
        >
          {t('enemy.moongecko.never', 'Never')}
        </Toggle>
      </Row>
    </Box>
  )
}

/** A setting's line: its name, its field and toggle, and where its default comes from */
function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 1,
        rowGap: 0.5,
      }}
    >
      <Typography sx={{ ...type.label, minWidth: 108 }}>{label}</Typography>
      {children}
      {hint && (
        <Typography sx={{ ...type.label, fontWeight: 400, ...numSx }}>
          {hint}
        </Typography>
      )}
    </Box>
  )
}

/** A few seconds, to 0.1 s; emptied: the team's own (its placeholder) */
function SecondsField({
  value,
  min,
  max,
  placeholder,
  disabled,
  onChange,
  suffix,
  'aria-label': ariaLabel,
}: {
  value: number | undefined
  min: number
  max: number
  placeholder: string
  disabled?: boolean
  onChange: (value: number | undefined) => void
  suffix?: string
  'aria-label': string
}) {
  const { t } = useTranslation('page_team')
  const shown = value === undefined ? '' : String(value)
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])
  const save = () => {
    const trimmed = text.trim().replace(',', '.').replace(/s$/i, '')
    if (!trimmed) return value === undefined ? setText('') : onChange(undefined)
    const v = Number(trimmed)
    if (!Number.isFinite(v)) return setText(shown)
    const next = Math.round(Math.min(max, Math.max(min, v)) * 10) / 10
    if (next !== value) onChange(next)
    else setText(shown)
  }
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
      <InputBase
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') {
            setText(shown)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        inputProps={{ inputMode: 'decimal', 'aria-label': ariaLabel }}
        sx={{
          width: 64,
          height: 30,
          px: 1,
          borderRadius: tokens.radius.control,
          bgcolor: giTokens.panelDark,
          boxShadow: `inset 0 0 0 1px ${giTokens.hairlineStrong}`,
          fontSize: 14,
          fontWeight: 600,
          ...numSx,
          ...quickSx,
          '& input': { textAlign: 'right', p: 0 },
          '& input::placeholder': { fontWeight: 400, opacity: 0.55 },
          '&.Mui-focused': {
            boxShadow: `inset 0 0 0 1px ${alpha(giTokens.gold, 0.7)}`,
          },
        }}
      />
      <Typography sx={{ ...type.label, fontWeight: 400 }}>
        {suffix ?? t('enemy.moongecko.seconds', 's')}
      </Typography>
    </Box>
  )
}

/** An on/off choice beside a field (on: it replaces the field) */
function Toggle({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      sx={{
        px: 1,
        height: 26,
        borderRadius: tokens.radius.control,
        fontSize: 12.5,
        fontWeight: on ? 650 : 500,
        color: on ? 'text.primary' : 'text.secondary',
        bgcolor: on ? alpha(giTokens.gold, 0.16) : 'transparent',
        boxShadow: `inset 0 0 0 1px ${on ? alpha(giTokens.gold, 0.55) : giTokens.hairline}`,
        ...quickSx,
        ...focusSx,
        '&:hover': {
          bgcolor: on ? alpha(giTokens.gold, 0.22) : giTokens.panelHover,
        },
      }}
    >
      {children}
    </ButtonBase>
  )
}

/**
 * Whether the enemy can be frozen: as its boss preset is (a boss can't: gcsim's rule for the game's
 * boss type), or as picked here (picking the preset's own clears the choice)
 */
export function FreezeSetting({
  teamId,
  team,
  disabled,
}: {
  teamId: string
  team: Team
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const setEnemy = useSetEnemy(teamId)
  const immune = enemyFreezeImmune(team)
  const set = (value: boolean) =>
    setEnemy((enemy) => {
      if (value === enemyFreezeImmune({ enemyPreset: enemy.enemyPreset }))
        delete enemy.freezeImmune
      else enemy.freezeImmune = value
    })
  return (
    <Row
      label={t('enemy.freeze', 'Frozen')}
      hint={
        immune
          ? t(
              'enemy.freezeImmuneHint',
              'Hydro and Cryo still react, but it never becomes Frozen: no Shatter, nothing that needs it Frozen'
            )
          : undefined
      }
    >
      <Toggle on={!immune} disabled={disabled} onClick={() => set(false)}>
        {t('enemy.freezable', 'Can be frozen')}
      </Toggle>
      <Toggle on={immune} disabled={disabled} onClick={() => set(true)}>
        {t('enemy.freezeImmune', 'Can’t be frozen')}
      </Toggle>
    </Row>
  )
}

/**
 * A Stygian Onslaught fight's start: with no energy (as the game starts it: the first rotation
 * without its Bursts), or with full energy
 */
export function StartEnergySetting({
  teamId,
  team,
  disabled,
}: {
  teamId: string
  team: Team
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const setEnemy = useSetEnemy(teamId)
  const full = !!team.fightSettings?.fullEnergy
  const set = (fullEnergy: boolean) =>
    setEnemy((team) => {
      const next: TeamFightSettings = { ...team.fightSettings }
      if (fullEnergy) next.fullEnergy = true
      else delete next.fullEnergy
      team.fightSettings = Object.keys(next).length ? next : undefined
    })
  return (
    <Row
      label={t('enemy.startEnergy', 'Energy at the start')}
      hint={
        full
          ? undefined
          : t(
              'enemy.startEnergyNone',
              'The first rotation without Bursts, as the game starts it'
            )
      }
    >
      <Toggle on={!full} disabled={disabled} onClick={() => set(false)}>
        {t('enemy.startEnergyZero', 'None')}
      </Toggle>
      <Toggle on={full} disabled={disabled} onClick={() => set(true)}>
        {t('enemy.startEnergyFull', 'Full')}
      </Toggle>
    </Row>
  )
}
