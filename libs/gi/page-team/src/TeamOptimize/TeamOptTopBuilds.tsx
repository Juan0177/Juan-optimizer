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
} from '@genshin-optimizer/gi/ui'
import { Box, CircularProgress, Typography } from '@mui/material'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { TopBuilds } from './KqmTopTeams'
import { SubsectionTitle, tokens, type } from './ui'

const MAX = 50

/** A row: the team's gear, and the pick that shows it (none: the run's own team) */
interface TeamOptTopOption extends KqmTeamOption {
  pick?: TeamOptPick
}

/**
 * The KQM tab's Top builds for a Team optimize run: its team, then the best builds that change one
 * member's weapon or set (each member's rankings, `TeamOptResult.options`), by team damage. Picking
 * one picks that member's equipment, as its inspector does.
 */
export function TeamOptTopBuilds({
  members,
  result,
  picks,
  rotationTime,
  disabled,
  onPick,
}: {
  /** The team's members, in its order (the table's columns: the optimized ones) */
  members: CharacterKey[]
  /** The run's best team build */
  result: TeamOptResult
  /** The equipment picked by hand now */
  picks: TeamOptPicks
  rotationTime?: number
  disabled?: boolean
  /** No member: the run's team */
  onPick: (characterKey?: CharacterKey, pick?: TeamOptPick) => void
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
      if (weapon) own[ck] = { weapon, sets: setsOf(result.builds[ck]) }
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
          builds: { ...own, [ck]: build },
          // (the run's value as shown: the options are ranked on its scale)
          total: (option.value / ranked.best) * result.after.total,
          pick: {
            weaponId: option.weaponId,
            ...(option.set && { set: option.set }),
          },
        })
      }
    }
    rows.sort((a, b) => b.total - a.total)
    return [
      { builds: own, total: result.after.total },
      ...rows.slice(0, MAX - 1),
    ] as TeamOptTopOption[]
  }, [result, database])

  const picked = Object.entries(picks) as [CharacterKey, TeamOptPick][]
  const current =
    picked.length === 0
      ? 0
      : picked.length === 1
        ? options.findIndex(
            (o) =>
              o.changed === picked[0][0] &&
              o.pick?.weaponId === picked[0][1].weaponId &&
              o.pick?.set === picked[0][1].set
          )
        : -1
  return (
    <TopBuilds
      options={options}
      members={members.filter((ck) => result.optimized.includes(ck))}
      current={current}
      rotationTime={rotationTime}
      disabled={disabled}
      onPick={(option) => onPick(option.changed, option.pick)}
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
