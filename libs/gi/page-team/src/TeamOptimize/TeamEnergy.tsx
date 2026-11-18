import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
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
  syncEnergyCalculator,
  teamCalculatorTargets,
  teamOptCurrentWeapons,
  teamOptWeaponCandidates,
  withRotationEnergy,
} from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import { Box, Button, Drawer, IconButton, Typography } from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EnergyGear } from './KqmEnergyCalculator'
import { energyEstimate, KqmEnergyCalculator } from './KqmEnergyCalculator'
import {
  teamRotationEnergy,
  useMemberNames,
  useRotationSettings,
  useRotationText,
  useSimTeam,
} from './RotationWriter'
import { focusSx, hairline, quickSx, tokens, type } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

const ER_PATH = JSON.stringify(['basic', 'enerRech_'])

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
 * Team optimize's ER calculator, as KQM theorycrafting has it: filled in from the written rotation
 * (played with the members' own constellations and gear) unless set by hand, applied by itself
 * when the rotation is written or changed, and worked out in a run for the weapons each build
 * holds. Typing a member's minimum switches the team to its own requirements (`manual`).
 */
export function useTeamEnergy(
  teamId: string,
  members: TeamOptMember[],
  teamOpt: TeamOpt,
  setTeamOpt: (update: TeamOptUpdate) => void
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
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
  const { applied: text } = useRotationText(teamId)
  const { opener, timing, frameData } = useRotationSettings(teamId)
  const names = useMemberNames(members)
  const written = text.trim()
    ? `${text.trim()}|${JSON.stringify([opener, timing, frameData])}`
    : ''
  const playKey = `${written}|${JSON.stringify(own.constellations)}`
  const [worked, setWorked] = useState<{
    for: string
    energy?: RotationEnergy
    rotationTime?: number
  }>()
  const latest = useRef({ own, names, members })
  latest.current = { own, names, members }
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

  // Applied targets follow the rotation and the members; they apply by themselves with a written
  // rotation, for a team that never chose its own, and when the rotation is written or changed
  // (over ones typed by hand: those were for the rotation before)
  const lastWritten = useRef<string>()
  useEffect(() => {
    const source = teamOpt.energySource
    if (source === 'manual' && ready && teamOpt.energyRotation === undefined) {
      setTeamOpt((o) => {
        o.energyRotation = written
      })
      return
    }
    const newRotation = ready && teamOpt.energyRotation !== written
    if (source !== 'calculator' && !(ready && (!source || newRotation))) return
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

  const calculated =
    teamOpt.energySource === 'calculator' && !!teamOpt.energyCalculator
  // (the members' targets with the weapons they hold now; a run works them out per weapon)
  const targets = useMemo(
    () =>
      calculated
        ? teamCalculatorTargets(
            keys,
            teamOptCurrentWeapons(database, members),
            teamOpt
          )
        : undefined,
    [calculated, keys, database, members, teamOpt]
  )

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
  /** A minimum typed for a member: every member's requirement its own from now on */
  const toManual = (characterKey: CharacterKey, value: number | undefined) => {
    for (const m of members) {
      if (m.isTc) continue
      const target =
        m.characterKey === characterKey ? value : targets?.[m.characterKey]
      setOptConfigEr(
        database,
        m.teamChar.optConfigId,
        target !== undefined && target > 100 ? target : undefined
      )
    }
    setTeamOpt((o) => {
      o.energySource = 'manual'
    })
  }
  return {
    calculated,
    targets,
    gear,
    fromRotation: ready,
    draft,
    setDraft,
    draftErrors: draft ? energyEstimate(keys, draft, gear).errors : [],
    openCalculator,
    closeCalculator,
    applyCalculator,
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
      sx={(theme) => ({ zIndex: theme.zIndex.modal + 10 })}
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
