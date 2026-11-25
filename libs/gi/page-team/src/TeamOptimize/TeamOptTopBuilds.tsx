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
  TeamOptPick,
  TeamOptPicks,
  TeamOptResult,
  TeamOptSession,
  TeamOptSetComparison,
} from '@genshin-optimizer/gi/ui'
import { teamOptSetKey } from '@genshin-optimizer/gi/ui'
import { Box, CircularProgress, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TopBuilds } from './KqmTopTeams'
import { TeamOptCompareSets } from './TeamOptCompareSets'
import { SubsectionTitle, tokens, type } from './ui'

const MAX = 50

/** A row: the team's gear, and the pick that shows it (none: the run's own team) */
interface TeamOptTopOption extends KqmTeamOption {
  pick?: TeamOptPick
  comparison?: TeamOptSetComparison
  changedMembers?: CharacterKey[]
  disabled?: boolean
  rank?: number
}

const assignmentKey = ({ sets }: TeamOptSetComparison) =>
  JSON.stringify(Object.entries(sets).sort())

export function TeamOptTopBuilds({
  members,
  result,
  picks,
  rotationTime,
  disabled,
  optionsRunning,
  comparison,
  session,
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
  comparison?: TeamOptSetComparison
  session: () => Promise<TeamOptSession | undefined>
  /** No member: the run's team */
  onPick: (characterKey?: CharacterKey, pick?: TeamOptPick) => void
  onCompare: (comparison: TeamOptSetComparison) => void
}) {
  const database = useDatabase()
  const [manual, setManual] = useState<TeamOptSetComparison[]>([])
  const { options, currentSets } = useMemo(() => {
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
    const currentSets: Partial<Record<CharacterKey, string>> = {}
    for (const ck of result.optimized) {
      const weapon = weaponOf(result.weapons[ck])
      if (!weapon) continue
      const sets = setsOf(result.builds[ck])
      own[ck] = { weapon, sets }
      currentSets[ck] = Object.keys(sets).find(
        (set) => sets[set as ArtifactSetKey] === 4
      )
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
    const pairs = new Map(
      [...(result.setComparisons ?? []), ...manual].map((item) => [
        assignmentKey(item),
        item,
      ])
    )
    for (const pair of pairs.values()) {
      if (
        !Object.values(pair.builds).every((b) =>
          Object.values(b ?? {}).every((id) => !id || database.arts.get(id))
        )
      )
        continue
      const changedMembers = result.optimized.filter((ck) => pair.sets[ck])
      const builds = { ...own }
      for (const ck of changedMembers) {
        if (own[ck]) builds[ck] = { ...own[ck], sets: setsOf(pair.builds[ck]) }
      }
      rows.push({
        comparison: pair,
        changedMembers,
        builds,
        total: pair.after.total,
      })
    }
    const base = { builds: own, total: result.after.total }
    rows.unshift(base)
    rows.sort((a, b) => b.total - a.total)
    rows.forEach((row, i) => {
      row.rank = i + 1
    })
    const top = rows.slice(0, MAX)
    const active =
      comparison &&
      rows.find(
        (row) =>
          row.comparison &&
          assignmentKey(row.comparison) === assignmentKey(comparison)
      )
    const extra = [base, active].filter(
      (row): row is TeamOptTopOption => !!row && !top.includes(row)
    )
    // Keep the original and the selected comparison available alongside the highest ranks.
    top.splice(MAX - extra.length, extra.length, ...extra)
    top.sort((a, b) => a.rank! - b.rank!)
    return { options: top, currentSets }
  }, [result, database, manual, optionsRunning, comparison])

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
      actions={
        result.optimized.length > 1 && (
          <TeamOptCompareSets
            members={result.optimized}
            currentSets={currentSets}
            session={session}
            disabled={disabled || optionsRunning}
            onCompared={(next) => {
              setManual((before) => [
                ...before
                  .filter((item) => assignmentKey(item) !== assignmentKey(next))
                  .slice(-5),
                next,
              ])
              onCompare(next)
            }}
          />
        )
      }
    />
  )
}

/**
 * Top builds' place while the members' other builds are ranked: as tall as the table, so it comes
 * in without moving the page
 */
export function TopBuildsPending({
  done,
  total,
}: {
  done: number
  total: number
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box
      component="section"
      aria-busy
      sx={{
        minWidth: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <SubsectionTitle>
        {t('teamOpt.kqm.topBuilds', 'Top builds')}
      </SubsectionTitle>
      <Box
        sx={{
          flex: 1,
          minHeight: 330,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          border: `1px solid ${tokens.hairlineStrong}`,
          borderRadius: tokens.radius.inset,
          color: 'text.secondary',
        }}
      >
        <CircularProgress size={14} thickness={5} sx={{ color: tokens.gold }} />
        <Typography sx={type.label}>
          {t('teamOpt.result.ranking', {
            defaultValue: 'Ranking other builds · {{done}} of {{total}}',
            done,
            total,
          })}
        </Typography>
      </Box>
    </Box>
  )
}
