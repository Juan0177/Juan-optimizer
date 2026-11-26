import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import type {
  KqmSets,
  KqmTeamOption,
  TeamOptGearComparison,
  TeamOptPick,
  TeamOptPicks,
  TeamOptResult,
} from '@genshin-optimizer/gi/ui'
import { teamOptSetKey } from '@genshin-optimizer/gi/ui'
import { Box, Button, CircularProgress, Typography } from '@mui/material'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { TopBuilds } from './KqmTopTeams'
import { tokens, type } from './ui'

const MAX = 50

/** A row: the team's gear, and the pick that shows it (none: the run's own team) */
interface TeamOptTopOption extends KqmTeamOption {
  pick?: TeamOptPick
  comparison?: TeamOptGearComparison
  changedMembers?: CharacterKey[]
  disabled?: boolean
  rank?: number
  rotationTime?: number
  id?: string
}

const assignmentKey = ({ changed, builds, weapons }: TeamOptGearComparison) =>
  JSON.stringify([...changed].sort().map((ck) => [ck, weapons[ck], builds[ck]]))

export function TeamOptTopBuilds({
  members,
  result,
  picks,
  rotationTime,
  disabled,
  optionsRunning,
  comparison,
  onPick,
  onCompare,
}: {
  /** The team's members, in its order (the table's columns: the optimized ones) */
  members: CharacterKey[]
  /** The run's best team build */
  result: TeamOptResult
  /** The equipment picked by hand now */
  picks: TeamOptPicks
  rotationTime?: number
  disabled?: boolean
  optionsRunning?: boolean
  comparison?: TeamOptGearComparison
  /** No member: the run's team */
  onPick: (characterKey?: CharacterKey, pick?: TeamOptPick) => void
  onCompare: (comparison: TeamOptGearComparison) => void
}) {
  const database = useDatabase()
  const options = useMemo(() => {
    const weaponOf = (id: string | undefined) => {
      const weapon = id ? database.weapons.get(id) : undefined
      return weapon
        ? { key: weapon.key as WeaponKey, refinement: weapon.refinement }
        : undefined
    }
    const setsOf = (
      ids: Partial<Record<ArtifactSlotKey, string | undefined>> | undefined
    ) => {
      const count: Partial<Record<ArtifactSetKey, number>> = {}
      for (const id of Object.values(ids ?? {})) {
        const setKey = id ? database.arts.get(id)?.setKey : undefined
        if (setKey) count[setKey] = (count[setKey] ?? 0) + 1
      }
      const sets: KqmSets = {}
      for (const [setKey, n] of Object.entries(count))
        if (n >= 2) sets[setKey as ArtifactSetKey] = n >= 4 ? 4 : 2
      return sets
    }
    const own: KqmTeamOption['builds'] = {}
    for (const ck of result.optimized) {
      const weapon = weaponOf(result.weapons[ck])
      if (!weapon) continue
      const sets = setsOf(result.builds[ck])
      own[ck] = { weapon, sets }
    }
    const gear = (b: KqmTeamOption['builds'][CharacterKey]) =>
      b
        ? `${b.weapon.key}@${b.weapon.refinement}|${Object.entries(b.sets)
            .sort()
            .join()}`
        : ''
    const rows: TeamOptTopOption[] = []
    for (const ck of result.optimized) {
      const ranked = result.options?.[ck]
      if (!ranked?.best || !own[ck]) continue
      const seen = new Set([gear(own[ck])])
      for (const option of [...ranked.weapons, ...ranked.sets]) {
        if (option.unmet || !option.artifactIds) continue
        if (!Number.isFinite(option.value)) continue
        const weapon = weaponOf(option.weaponId)
        if (!weapon) continue
        const build = { weapon, sets: setsOf(option.artifactIds) }
        const id = gear(build)
        if (seen.has(id)) continue
        seen.add(id)
        rows.push({
          changed: ck,
          disabled: optionsRunning,
          builds: { ...own, [ck]: build },
          // (the run's value as shown: the options are ranked on its scale)
          total: (option.value / ranked.best) * result.after.total,
          pick: {
            weaponId: option.weaponId,
            set: option.set,
            setPair: option.setPair,
          },
        })
      }
    }
    const comparisons: TeamOptTopOption[] = []
    for (const pair of result.gearComparisons ?? []) {
      if (
        !Object.values(pair.builds).every((b) =>
          Object.values(b ?? {}).every((id) => !id || database.arts.get(id))
        )
      )
        continue
      const changedMembers = result.optimized.filter((ck) =>
        pair.changed.includes(ck)
      )
      const builds = { ...own }
      for (const ck of changedMembers) {
        const weapon = weaponOf(pair.weapons[ck])
        if (weapon) builds[ck] = { weapon, sets: setsOf(pair.builds[ck]) }
      }
      comparisons.push({
        comparison: pair,
        changedMembers,
        builds,
        total: pair.after.total,
        rotationTime: pair.rotationTime,
        id: assignmentKey(pair),
      })
    }
    const base = { builds: own, total: result.after.total }
    rows.unshift(base)
    const rateOf = (row: TeamOptTopOption) =>
      row.total / (row.rotationTime ?? rotationTime ?? 1)
    const compareDps = (a: TeamOptTopOption, b: TeamOptTopOption) => {
      const first = rateOf(a)
      const second = rateOf(b)
      const diff = second - first
      return Math.abs(diff) <=
        Math.max(Math.abs(first), Math.abs(second)) * 1e-9
        ? 0
        : diff
    }
    const top = rows.sort(compareDps).slice(0, MAX)
    if (!top.includes(base)) top[MAX - 1] = base
    return [...top, ...comparisons].sort(compareDps).map((row, i) => ({
      ...row,
      rank: i + 1,
    }))
  }, [result, database, optionsRunning, rotationTime])

  const picked = Object.entries(picks) as [CharacterKey, TeamOptPick][]
  const current = comparison
    ? options.findIndex(
        (row) =>
          row.comparison &&
          assignmentKey(row.comparison) === assignmentKey(comparison)
      )
    : picked.length === 0
      ? options.findIndex((row) => !row.changed && !row.comparison)
      : picked.length === 1
        ? options.findIndex(
            (o) =>
              o.changed === picked[0][0] &&
              o.pick?.weaponId === picked[0][1].weaponId &&
              teamOptSetKey(o.pick) === teamOptSetKey(picked[0][1])
          )
        : -1
  return (
    <TopBuilds
      options={options}
      members={members.filter((ck) => result.optimized.includes(ck))}
      current={current}
      rotationTime={rotationTime}
      disabled={disabled}
      inventory
      onPick={(option) =>
        option.comparison
          ? onCompare(option.comparison)
          : onPick(option.changed, option.pick)
      }
    />
  )
}

/** Progress and cancellation live with the optional equipment rankings. */
export function GearRankingControls({
  done,
  total,
  running,
  error,
  onStart,
  onStop,
}: {
  done: number
  total: number
  running: boolean
  error?: string
  onStart: () => void
  onStop: () => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        flexWrap: 'wrap',
        alignItems: 'center',
        mb: 1,
      }}
    >
      {running && (
        <CircularProgress size={14} thickness={5} sx={{ color: tokens.gold }} />
      )}
      <Typography role="status" sx={type.label}>
        {running || done > 0
          ? t(
              'teamOpt.result.rankingReady',
              '{{done}} of {{total}} members ranked',
              { done, total }
            )
          : t(
              'teamOpt.result.rankOptional',
              'Compare alternative weapons and sets for this result.'
            )}
      </Typography>
      <Button
        size="small"
        variant="outlined"
        color="inherit"
        onClick={running ? onStop : onStart}
      >
        {running
          ? t('teamOpt.result.stopRanking', 'Stop ranking')
          : t('teamOpt.result.rankEquipment', 'Rank equipment')}
      </Button>
      {error && (
        <Typography
          role="alert"
          color="warning.main"
          sx={{ ...type.label, width: '100%' }}
        >
          {error}
        </Typography>
      )}
    </Box>
  )
}
