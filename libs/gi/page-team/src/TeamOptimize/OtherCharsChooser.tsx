import { useDataManagerValues } from '@genshin-optimizer/common/database-ui'
import { useBoolState } from '@genshin-optimizer/common/react-util'
import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type {
  CharacterKey,
  ElementKey,
  LocationCharacterKey,
} from '@genshin-optimizer/gi/consts'
import {
  allElementKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { ElementIcon } from '@genshin-optimizer/gi/svgicons'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import { CharacterName } from '@genshin-optimizer/gi/ui'
import { alpha, Box, Checkbox, Tooltip, Typography } from '@mui/material'
import { useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MemberAvatar } from './MemberAvatar'
import {
  DialogHead,
  floatSx,
  OptionTile,
  stackedBackdrop,
  TileAction,
} from './OptionTile'
import { hairline, numSx, Pill, tokens, type as typo } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/** A character outside the team with artifacts on: whose they are, and how many */
interface Owner {
  location: LocationCharacterKey
  characterKey: CharacterKey
  element: ElementKey
  count: number
}

/** The characters outside the team who have artifacts equipped (most artifacts first) */
function useOtherOwners(members: TeamOptMember[]): Owner[] {
  const database = useDatabase()
  // (subscribed: an artifact equipped or taken off anywhere shows at once)
  const arts = useDataManagerValues(database.arts)
  return useMemo(() => {
    const team = new Set<string>(members.map((m) => m.location))
    const counts = new Map<LocationCharacterKey, number>()
    for (const art of arts) {
      if (!art.location || team.has(art.location)) continue
      counts.set(art.location, (counts.get(art.location) ?? 0) + 1)
    }
    return [...counts]
      .map(([location, count]) => {
        const characterKey = database.chars.LocationToCharacterKey(location)
        return {
          location,
          characterKey,
          element: getCharEle(characterKey),
          count,
        }
      })
      .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location))
  }, [arts, database, members])
}

/**
 * "Other characters' artifacts": whether Team Optimize takes artifacts equipped on characters
 * outside the team, and (like the weapons' chooser) from which of them.
 */
export function OtherCharsSettings({
  members,
  teamOpt,
  setTeamOpt,
  disabled,
}: {
  members: TeamOptMember[]
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const owners = useOtherOwners(members)
  const [show, onShow, onHide] = useBoolState()
  const notFrom = new Set<string>(teamOpt.excludedLocations ?? [])
  const allowed = owners.filter((o) => !notFrom.has(o.location)).length
  const title = t('teamOpt.others.title', 'Characters to take artifacts from')
  return (
    <>
      <OptionTile
        label={t('teamOpt.pool.others', 'Other characters’ artifacts')}
        checked={teamOpt.useOtherChars}
        disabled={disabled}
        onChange={() =>
          setTeamOpt((o) => {
            o.useOtherChars = !o.useOtherChars
          })
        }
        action={
          teamOpt.useOtherChars &&
          !!owners.length && (
            <Tooltip arrow title={title}>
              <span style={{ display: 'inline-flex' }}>
                <TileAction
                  onClick={(e) => {
                    // (not the tile's toggle)
                    e.preventDefault()
                    onShow()
                  }}
                  disabled={disabled}
                  aria-label={title}
                >
                  {t('teamOpt.pool.othersCount', {
                    defaultValue: '{{allowed}}/{{total}} characters',
                    allowed,
                    total: owners.length,
                  })}
                </TileAction>
              </span>
            </Tooltip>
          )
        }
      />
      {show && (
        <OtherCharsModal
          owners={owners}
          teamOpt={teamOpt}
          setTeamOpt={setTeamOpt}
          onClose={onHide}
        />
      )}
    </>
  )
}

function OtherCharsModal({
  owners,
  teamOpt,
  setTeamOpt,
  onClose,
}: {
  owners: Owner[]
  teamOpt: TeamOpt
  setTeamOpt: (update: TeamOptUpdate) => void
  onClose: () => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const notFrom = new Set<string>(teamOpt.excludedLocations ?? [])
  const listed = owners.map((o) => o.location)
  // (only the listed ones are set: a character left out with no artifacts on stays left out)
  const setNotFrom = (locations: LocationCharacterKey[]) =>
    setTeamOpt((o) => {
      const kept = (o.excludedLocations ?? []).filter(
        (l) => !listed.includes(l)
      )
      const next = [...new Set([...kept, ...locations])]
      if (next.length) o.excludedLocations = next
      else delete o.excludedLocations
    })
  const toggle = (location: LocationCharacterKey) =>
    setNotFrom(
      notFrom.has(location)
        ? listed.filter((l) => l !== location && notFrom.has(l))
        : [...listed.filter((l) => notFrom.has(l)), location]
    )
  // the characters in any team (all of them other teams: this team's members are not listed)
  const inTeams = useMemo(() => {
    const keys = new Set<LocationCharacterKey>()
    for (const team of database.teams.values)
      for (const datum of team.loadoutData) {
        const key = datum && database.teamChars.get(datum.teamCharId)?.key
        if (key) keys.add(charKeyToLocCharKey(key))
      }
    return keys
  }, [database])
  // the quick picks: lit when the ticks are exactly theirs
  const sameAs = (locations: LocationCharacterKey[]) =>
    locations.length === listed.filter((l) => notFrom.has(l)).length &&
    locations.every((l) => notFrom.has(l))
  const picks = [
    { key: 'all', label: t('teamOpt.weapons.all', 'All'), locations: [] },
    {
      key: 'free',
      label: t('teamOpt.others.notInTeams', 'Not in other teams'),
      locations: listed.filter((l) => inTeams.has(l)),
    },
    {
      key: 'none',
      label: t('teamOpt.weapons.pickNone', 'None'),
      locations: listed,
    },
  ]
  const allowedCount = listed.filter((l) => !notFrom.has(l)).length
  const groups = allElementKeys
    .map((element) => ({
      element,
      owners: owners.filter((o) => o.element === element),
    }))
    .filter((g) => g.owners.length)
  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'md' }}
      // (over the run dialog, already dimmed: a light backdrop, not a second dark one)
      slotProps={stackedBackdrop}
    >
      <CardThemed sx={floatSx}>
        <DialogHead
          title={t('teamOpt.others.title', 'Characters to take artifacts from')}
          info={t(
            'teamOpt.others.desc',
            'The team can take the artifacts equipped on the ticked characters. Its own members’ artifacts are always used. A character who equips artifacts later is ticked, as in the Optimize tab.'
          )}
          actions={
            <Typography sx={{ ...typo.label, ...numSx, whiteSpace: 'nowrap' }}>
              {t('teamOpt.weapons.groupCount', {
                defaultValue: '{{allowed}} of {{total}}',
                allowed: allowedCount,
                total: listed.length,
              })}
            </Typography>
          }
          onClose={onClose}
        />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 0.75,
            px: { xs: 1.5, sm: 2.5 },
            py: 1.25,
            borderBottom: hairline,
          }}
        >
          {picks.map((p) => (
            <Pill
              key={p.key}
              selected={sameAs(p.locations)}
              onClick={() => setNotFrom(p.locations)}
            >
              {p.label}
            </Pill>
          ))}
        </Box>
        <Box
          sx={{
            px: { xs: 1.5, sm: 2.5 },
            py: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 2.5,
            maxHeight: { xs: 'calc(100dvh - 170px)', sm: '70vh' },
            overflowY: 'auto',
          }}
        >
          {groups.map((group) => {
            const locations = group.owners.map((o) => o.location)
            const ticked = locations.filter((l) => !notFrom.has(l)).length
            return (
              <Box component="section" key={group.element}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    minHeight: 32,
                    mb: 1,
                  }}
                >
                  <ElementIcon
                    ele={group.element}
                    iconProps={{ sx: { fontSize: 22 } }}
                  />
                  <Box sx={{ flexGrow: 1 }} />
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Pill
                      selected={ticked === locations.length}
                      onClick={() =>
                        setNotFrom(
                          listed.filter(
                            (l) => notFrom.has(l) && !locations.includes(l)
                          )
                        )
                      }
                    >
                      {t('teamOpt.weapons.all', 'All')}
                    </Pill>
                    <Pill
                      selected={ticked === 0}
                      onClick={() =>
                        setNotFrom([
                          ...listed.filter((l) => notFrom.has(l)),
                          ...locations,
                        ])
                      }
                    >
                      {t('teamOpt.weapons.pickNone', 'None')}
                    </Pill>
                  </Box>
                  <Typography sx={{ ...typo.label, ...numSx }}>
                    {t('teamOpt.weapons.groupCount', {
                      defaultValue: '{{allowed}} of {{total}}',
                      allowed: ticked,
                      total: locations.length,
                    })}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1,
                    gridTemplateColumns: {
                      xs: 'minmax(0, 1fr)',
                      sm: 'repeat(2, minmax(0, 1fr))',
                      md: 'repeat(3, minmax(0, 1fr))',
                    },
                  }}
                >
                  {group.owners.map((owner) => (
                    <OwnerRow
                      key={owner.location}
                      owner={owner}
                      allowed={!notFrom.has(owner.location)}
                      inTeam={inTeams.has(owner.location)}
                      onToggle={() => toggle(owner.location)}
                    />
                  ))}
                </Box>
              </Box>
            )
          })}
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

function OwnerRow({
  owner,
  allowed,
  inTeam,
  onToggle,
}: {
  owner: Owner
  allowed: boolean
  /** In another team: said under the name */
  inTeam: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const nameId = useId()
  return (
    <Box
      component="label"
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minWidth: 0,
        pl: 0.5,
        pr: 1,
        py: 0.75,
        cursor: 'pointer',
        borderRadius: tokens.radius.inset,
        bgcolor: tokens.inset,
        border: hairline,
        // (not ticked: quiet, readable again under the pointer)
        opacity: allowed ? 1 : 0.5,
        transition: 'opacity .12s, border-color .12s',
        '&:hover': {
          opacity: allowed ? 1 : 0.85,
          borderColor: alpha(theme.palette.text.primary, 0.14),
        },
        '&:focus-within': { opacity: 1 },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      })}
    >
      <Checkbox
        size="small"
        checked={allowed}
        onChange={onToggle}
        sx={{ p: 0.5 }}
        inputProps={{ 'aria-labelledby': nameId }}
      />
      <MemberAvatar characterKey={owner.characterKey} size={34} />
      <Box sx={{ minWidth: 0 }}>
        <Typography
          id={nameId}
          noWrap
          sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}
        >
          <CharacterName characterKey={owner.characterKey} gender={gender} />
        </Typography>
        <Typography
          noWrap
          sx={{ fontSize: 12.5, color: 'text.secondary', ...numSx }}
        >
          {t('teamOpt.others.count', {
            defaultValue_one: '{{count}} artifact',
            defaultValue_other: '{{count}} artifacts',
            count: owner.count,
          })}
          {inTeam && ` · ${t('teamOpt.others.inTeam', 'in another team')}`}
        </Typography>
      </Box>
    </Box>
  )
}
