import {
  useDataManagerEntries,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  StatFilters,
  TeamOpt,
  TeamOptEnergyCalculator,
} from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { RotationEnergy, TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  canWield,
  isCalcEnergyWeapon,
  isFavonius,
  isWeaponExcludedFor,
  syncEnergyCalculator,
  teamCalculatorTargets,
  teamEnergyAuto,
  teamOptCurrentWeapons,
  teamOptWeaponCandidates,
  withRotationEnergy,
} from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import { Box, Button, Drawer, IconButton, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EnergyGear } from './KqmEnergyCalculator'
import {
  calculatorDrawerZ,
  energyEstimate,
  KqmEnergyCalculator,
} from './KqmEnergyCalculator'
import {
  teamBurstEvery,
  teamRotationEnergy,
  useAppliedRotation,
  useMemberNames,
  useRotationSettings,
  useSimTeam,
} from './RotationWriter'
import { focusSx, hairline, quickSx, tokens, type } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

const ER_PATH = JSON.stringify(['basic', 'enerRech_'])

/** How a ticked energy weapon changes a member's Min ER (shown under Min ER in RunDialog) */
export interface MemberErHint {
  /** Lower ER reached when a ticked energy/Favonius weapon is held */
  lower?: {
    target: number
    diff: number
    weaponKey: WeaponKey
    holder?: CharacterKey
  }
  /** Higher ER needed if a currently-held energy/Favonius weapon is swapped out */
  higher?: {
    target: number
    weaponKey: WeaponKey
    holder: CharacterKey
  }
}

/** A member's Optimize settings with its minimum Energy Recharge set (undefined: none) */
export function setOptConfigEr(
  database: ArtCharDatabase,
  optConfigId: string,
  value: number | undefined
) {
  const statFilters: StatFilters =
    database.optConfigs.get(optConfigId)?.statFilters ?? {}
  const others = (statFilters[ER_PATH] ?? []).filter(
    (f, i, all) => f.disabled || all.findIndex((x) => !x.disabled) !== i
  )
  const next = { ...statFilters }
  if (value === undefined) {
    if (others.length) next[ER_PATH] = others
    else delete next[ER_PATH]
  } else next[ER_PATH] = [{ value, disabled: false }, ...others]
  database.optConfigs.set(optConfigId, { statFilters: next })
}

/**
 * Team optimize's Energy Recharge, Automatic or Manual as chosen. Automatic: the ER calculator, as
 * KQM theorycrafting has it, filled in from the written rotation (played with the members' own
 * constellations and gear) unless set by hand, applied by itself once a rotation is written, and
 * worked out in a run for the weapons each build holds. Manual: each member's own minimum.
 */
export function useTeamEnergy(
  teamId: string,
  members: TeamOptMember[],
  teamOpt: TeamOpt,
  setTeamOpt: (update: TeamOptUpdate) => void
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const inventoryWeapons = useDataManagerValues(database.weapons)
  const optConfigs = useDataManagerEntries(database.optConfigs)
  const keys = useMemo(() => members.map((m) => m.characterKey), [members])
  const own = useSimTeam(members)
  // the weapons a member may hold in a run: its own, or (weapons chosen too) those it may wield
  const gear = useMemo<EnergyGear>(() => {
    const locations = new Set(members.map((m) => m.location as string))
    return {
      constellation: (key) => own.constellations[key] ?? 0,
      weapons: (key) => {
        const member = members.find((m) => m.characterKey === key)
        if (!member) return []
        const current = database.weapons.get(member.weaponId)
        const list =
          teamOpt.optimizeWeapons && !member.isTc && !teamOpt.keep.includes(key)
            ? teamOptWeaponCandidates(
                database,
                member,
                member.weaponId,
                teamOpt,
                locations,
                new Set()
              )
            : current
              ? [current]
              : []
        return list.map((w) => ({ key: w.key, refinement: w.refinement }))
      },
    }
  }, [database, members, own, teamOpt])

  // the written rotation's inputs, worked out after the page shows (it is a full replay)
  const text = useAppliedRotation(teamId)
  const { opener, timing, frameData } = useRotationSettings(teamId)
  const names = useMemberNames(members)
  const written = text.trim()
    ? `${text.trim()}|${JSON.stringify([opener, timing, frameData])}`
    : ''
  const burstEvery = useMemo(() => teamBurstEvery(teamOpt), [teamOpt])
  const playKey = `${written}|${JSON.stringify(own.constellations)}|${JSON.stringify(burstEvery ?? {})}`
  const [worked, setWorked] = useState<{
    for: string
    energy?: RotationEnergy
    rotationTime?: number
  }>()
  const latest = useRef({ own, names, members, burstEvery })
  latest.current = { own, names, members, burstEvery }
  useEffect(() => {
    if (!written) {
      setWorked(undefined)
      return
    }
    let cancelled = false
    const id = setTimeout(() => {
      let result: ReturnType<typeof teamRotationEnergy>
      try {
        result = teamRotationEnergy({
          database,
          teamId,
          members: latest.current.members,
          gender,
          names: latest.current.names,
          team: latest.current.own,
          burstEvery: latest.current.burstEvery,
        })
      } catch {
        result = undefined
      }
      if (!cancelled)
        setWorked({
          for: playKey,
          energy: result?.energy,
          rotationTime: result?.rotationTime,
        })
    }, 0)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [database, teamId, gender, written, playKey])
  const ready = !!written && worked?.for === playKey && !!worked.energy
  const energy = ready ? worked?.energy : undefined
  const playedTime = ready ? worked?.rotationTime : undefined

  const calculatorOf = useCallback(
    (saved: TeamOptEnergyCalculator | undefined) => ({
      ...withRotationEnergy(
        syncEnergyCalculator(
          keys,
          saved,
          teamOpt.rotationTime ?? 20,
          teamOpt.onField ?? keys[0],
          own.constellations
        ),
        keys,
        energy
      ),
      rotationTime: playedTime || (teamOpt.rotationTime ?? 20),
    }),
    [keys, teamOpt.rotationTime, teamOpt.onField, own, energy, playedTime]
  )

  // Automatic ER follows the rotation and the members: it applies by itself once a rotation is
  // written, for a team that never chose (Manual, chosen, stays Manual)
  const lastWritten = useRef<string>()
  useEffect(() => {
    const source = teamOpt.energySource
    if (source === 'manual') return
    const newRotation = ready && teamOpt.energyRotation !== written
    if (source !== 'calculator' && !(ready && !source)) return
    const applied = teamOpt.energyCalculator
    const energyCalculator = calculatorOf(applied)
    const json = JSON.stringify(energyCalculator)
    if (
      source === 'calculator' &&
      !newRotation &&
      json === JSON.stringify(applied)
    )
      return
    // (written once per change: if the saved settings come back different, the same inputs are
    // not written again, or it would loop)
    const key = `${json}|${ready ? written : ''}`
    if (key === lastWritten.current) return
    lastWritten.current = key
    setTeamOpt((o) => {
      o.energySource = 'calculator'
      o.energyCalculator = energyCalculator
      if (ready) o.energyRotation = written
    })
  }, [teamOpt, ready, written, calculatorOf, setTeamOpt])

  const calculated = teamEnergyAuto(teamOpt)
  // (the members' targets with the weapons they hold now; a run works them out per weapon)
  const currentWeapons = useMemo(
    () => teamOptCurrentWeapons(database, members),
    [database, members]
  )
  const targets = useMemo(
    () =>
      calculated
        ? teamCalculatorTargets(keys, currentWeapons, teamOpt)
        : undefined,
    [calculated, keys, currentWeapons, teamOpt]
  )
  // Per member, how a ticked energy / Favonius weapon shifts their ER requirement during a run
  const erHints = useMemo<Partial<Record<CharacterKey, MemberErHint>>>(() => {
    if (!teamOpt.optimizeWeapons) return {}
    const hints: Partial<Record<CharacterKey, MemberErHint>> = {}
    if (calculated && targets) {
      const locations = new Set(members.map((m) => m.location as string))
      for (const m of members) {
        if (m.isTc || teamOpt.keep.includes(m.characterKey)) continue
        const candidates = teamOptWeaponCandidates(
          database,
          m,
          m.weaponId,
          teamOpt,
          locations,
          new Set()
        )
        const current = currentWeapons[m.characterKey]
        const energyCands = candidates.filter(
          (w) => isFavonius(w.key) || isCalcEnergyWeapon(w.key)
        )
        for (const w of energyCands) {
          if (
            current &&
            current.key === w.key &&
            current.refinement === w.refinement
          )
            continue
          const alt = teamCalculatorTargets(
            keys,
            { ...currentWeapons, [m.characterKey]: w },
            teamOpt
          )
          if (!alt) continue
          for (const ck of keys) {
            const base = targets[ck]
            const next = alt[ck]
            if (base === undefined || next === undefined) continue
            const diff = Math.round((base - next) * 10) / 10
            if (diff >= 0.1) {
              const prev = hints[ck]?.lower
              if (!prev || next < prev.target)
                hints[ck] = {
                  ...hints[ck],
                  lower: {
                    target: next,
                    diff,
                    weaponKey: w.key,
                    holder: m.characterKey,
                  },
                }
            }
          }
        }
        // If this member currently holds an energy/Fav weapon and another non-energy weapon is
        // allowed, show the higher ER needed when they switch off it.
        const nonEnergy =
          current &&
          (isFavonius(current.key) || isCalcEnergyWeapon(current.key))
            ? candidates.find(
                (w) => !isFavonius(w.key) && !isCalcEnergyWeapon(w.key)
              )
            : undefined
        if (current && nonEnergy) {
          const alt = teamCalculatorTargets(
            keys,
            { ...currentWeapons, [m.characterKey]: nonEnergy },
            teamOpt
          )
          if (alt)
            for (const ck of keys) {
              const base = targets[ck]
              const next = alt[ck]
              if (base === undefined || next === undefined) continue
              if (next - base >= 0.1) {
                const prev = hints[ck]?.higher
                if (!prev || next > prev.target)
                  hints[ck] = {
                    ...hints[ck],
                    higher: {
                      target: next,
                      weaponKey: current.key,
                      holder: m.characterKey,
                    },
                  }
              }
            }
        }
      }
      return hints
    }
    // Manual ER mode: relief configured on any ticked inventory weapon that a member can wield
    const usableWeapons = inventoryWeapons.filter((w) =>
      members.some(
        (m) =>
          !m.isTc &&
          !teamOpt.keep.includes(m.characterKey) &&
          canWield(m.characterKey, w) &&
          !isWeaponExcludedFor(m.characterKey, w.id, teamOpt) &&
          Object.keys(teamOpt.weaponEnergy[w.id] ?? {}).length > 0
      )
    )
    const configMap = new Map(optConfigs)
    for (const m of members) {
      if (m.isTc) continue
      const saved = configMap
        .get(m.teamChar.optConfigId)
        ?.statFilters[ER_PATH]?.find((f) => !f.disabled)?.value
      if (!(saved && saved > 100)) continue
      for (const w of usableWeapons) {
        const relief = teamOpt.weaponEnergy[w.id]?.[m.characterKey] ?? 0
        if (!(relief > 0)) continue
        const target = Math.max(100, Math.round((saved - relief) * 10) / 10)
        const diff = Math.round((saved - target) * 10) / 10
        if (diff >= 0.1) {
          const prev = hints[m.characterKey]?.lower
          if (!prev || target < prev.target)
            hints[m.characterKey] = {
              lower: { target, diff, weaponKey: w.key },
            }
        }
      }
    }
    return hints
  }, [
    calculated,
    targets,
    teamOpt,
    members,
    database,
    currentWeapons,
    keys,
    inventoryWeapons,
    optConfigs,
  ])

  const [draft, setDraft] = useState<TeamOptEnergyCalculator>()
  const openCalculator = () =>
    setDraft(structuredClone(calculatorOf(teamOpt.energyCalculator)))
  const closeCalculator = () => setDraft(undefined)
  const applyCalculator = () => {
    if (!draft) return
    setTeamOpt((o) => {
      o.energySource = 'calculator'
      o.energyCalculator = structuredClone(draft)
      if (ready) o.energyRotation = written
    })
    setDraft(undefined)
  }
  /** Automatic ER: the calculator's targets, filled in from the rotation unless set by hand */
  const toAuto = () =>
    setTeamOpt((o) => {
      o.energySource = 'calculator'
      o.energyCalculator = calculatorOf(o.energyCalculator)
      if (ready) o.energyRotation = written
    })
  /** Manual ER: each member's own minimum, and what energy weapons save them (as set on each) */
  const toManual = () =>
    setTeamOpt((o) => {
      o.energySource = 'manual'
    })
  return {
    calculated,
    targets,
    erHints,
    gear,
    fromRotation: ready,
    draft,
    setDraft,
    draftErrors: draft ? energyEstimate(keys, draft, gear).errors : [],
    openCalculator,
    closeCalculator,
    applyCalculator,
    toAuto,
    toManual,
  }
}

export type TeamEnergy = ReturnType<typeof useTeamEnergy>

/** The ER calculator in a side panel, as the KQM tab opens it; Apply uses its targets */
export function TeamEnergyDrawer({
  members,
  energy,
}: {
  members: TeamOptMember[]
  energy: TeamEnergy
}) {
  const { t } = useTranslation('page_team')
  const { draft, setDraft } = energy
  // (the panel keeps its content while it slides out)
  const shown = useRef(draft)
  if (draft) shown.current = draft
  const settings = draft ?? shown.current
  const title = t('teamOpt.kqm.calc.tab', 'ER calculator')
  return (
    <Drawer
      anchor="right"
      open={!!draft}
      onClose={energy.closeCalculator}
      // (over the run window it opens from)
      sx={(theme) => ({ zIndex: calculatorDrawerZ(theme) })}
      PaperProps={{
        role: 'dialog',
        'aria-modal': true,
        'aria-label': title,
        sx: {
          width: { xs: '100%', md: 880 },
          maxWidth: '100%',
          bgcolor: tokens.panel,
          backgroundImage: 'none',
          borderLeft: hairline,
        },
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: { xs: 2, sm: 2.5 },
          pr: 1.25,
          minHeight: 60,
          borderBottom: hairline,
          flexShrink: 0,
        }}
      >
        <Typography
          component="h2"
          sx={{
            ...type.section,
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            flex: 1,
            minWidth: 0,
          }}
        >
          {title}
          <InfoTooltipInline
            title={t(
              'teamOpt.energy.intro',
              'Confirm skill uses, particle catching and field time for one rotation. ER is calculated for the whole team, then worked out in the run for the weapons each build holds. Extra energy from abilities or effects goes in Bonus flat energy.'
            )}
          />
        </Typography>
        <IconButton
          onClick={energy.closeCalculator}
          aria-label={t('teamOpt.editor.close', 'Close')}
          sx={{ ...quickSx, ...focusSx }}
        >
          <CloseIcon />
        </IconButton>
      </Box>
      <Box sx={{ p: { xs: 1.5, sm: 2.5 }, overflowY: 'auto', flex: 1 }}>
        {settings && (
          <KqmEnergyCalculator
            members={members}
            kqm={undefined}
            gear={energy.gear}
            fromRotation={energy.fromRotation}
            settings={settings}
            setSettings={(update) =>
              setDraft((previous) => (previous ? update(previous) : previous))
            }
          />
        )}
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          px: { xs: 2, sm: 2.5 },
          py: 1.5,
          borderTop: hairline,
          flexShrink: 0,
        }}
      >
        <Typography
          role="status"
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: 12.5,
            color: 'warning.main',
          }}
        >
          {energy.draftErrors[0] ?? ''}
        </Typography>
        <Button
          variant="contained"
          sx={giCtaSx}
          disabled={!!energy.draftErrors.length}
          onClick={energy.applyCalculator}
        >
          {t('teamOpt.kqm.calc.apply', 'Apply ER targets')}
        </Button>
      </Box>
    </Drawer>
  )
}
