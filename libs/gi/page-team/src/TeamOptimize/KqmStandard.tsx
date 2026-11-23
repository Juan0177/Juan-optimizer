import type { CharacterKey, KqmStandardKey } from '@genshin-optimizer/gi/consts'
import { allKqmStandardKeys } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamOptKqm } from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm } from '@genshin-optimizer/gi/db'
import { kqmMemberStandard } from '@genshin-optimizer/gi/ui'
import { kqmStandardOf } from '@genshin-optimizer/gi/solver'
import { Box, MenuItem, TextField } from '@mui/material'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import { FieldLabel, numSx, type } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

/*
 * The artifact standard: KQM Standards (2 fixed rolls of every substat and 20 placed), or a tier
 * built piece by piece as the game makes artifacts, up to Perfect, the best the game can make
 */

/** A standard's name */
export function kqmStandardName(t: TFunction, standard: KqmStandardKey) {
  switch (standard) {
    case 'good':
      return t('teamOpt.kqm.tierGood', 'Good')
    case 'great':
      return t('teamOpt.kqm.tierGreat', 'Great')
    case 'top':
      return t('teamOpt.kqm.tierTop', 'Top')
    case 'perfect':
      return t('teamOpt.kqm.tierPerfect', 'Perfect')
    default:
      return t('teamOpt.kqm.standard20', 'KQM Standard')
  }
}
/** A standard's name in a member's row: KQMS for KQM Standard */
const kqmStandardShort = (t: TFunction, standard: KqmStandardKey) =>
  standard === 'kqms'
    ? t('teamOpt.kqm.standard20Short', 'KQMS')
    : kqmStandardName(t, standard)
/** What a standard's artifacts are, in a line */
export function kqmStandardDetail(t: TFunction, standard: KqmStandardKey) {
  switch (standard) {
    case 'good':
      return t(
        'teamOpt.kqm.tierGoodDetail',
        '8 rolls a piece: 2 of its 4 lines on wanted stats, 3 of its 4 upgrades on them'
      )
    case 'great':
      return t(
        'teamOpt.kqm.tierGreatDetail',
        '9 rolls a piece: 3 of its 4 lines on wanted stats, 4 of its 5 upgrades on them'
      )
    case 'top':
      return t(
        'teamOpt.kqm.tierTopDetail',
        '9 rolls a piece: every line on a wanted stat, every upgrade on them'
      )
    case 'perfect':
      return t(
        'teamOpt.kqm.tierPerfectDetail',
        'Top with every roll at its highest value: the best the game can make'
      )
    default:
      return t(
        'teamOpt.kqm.tierKqmsDetail',
        '2 rolls of every substat and 20 placed, at most 2 a piece per stat'
      )
  }
}

/** The members' standards, in their order */
const memberStandards = (
  kqm: Pick<TeamOptKqm, 'standard' | 'memberStandards'> | undefined,
  keys: readonly CharacterKey[]
) => keys.map((k) => kqmMemberStandard(k, kqm))

/** Whether the members' artifact standards differ */
export function kqmStandardsMixed(
  kqm: Pick<TeamOptKqm, 'standard' | 'memberStandards'> | undefined,
  keys: readonly CharacterKey[]
) {
  const all = memberStandards(kqm, keys)
  return all.some((s) => s !== all[0])
}

/** The members' standard by name, or Mixed when they differ */
export function kqmStandardText(
  t: TFunction,
  kqm: Pick<TeamOptKqm, 'standard' | 'memberStandards'> | undefined,
  keys: readonly CharacterKey[]
) {
  return kqmStandardsMixed(kqm, keys)
    ? t('teamOpt.kqm.standardMixed', 'Mixed')
    : kqmStandardName(
        t,
        keys.length
          ? kqmMemberStandard(keys[0], kqm)
          : kqmStandardOf(kqm?.standard)
      )
}

/** Every member at `standard` */
function setAllStandards(o: TeamOpt, standard: KqmStandardKey) {
  const settings = (o.kqm ??= { ...defaultTeamOptKqm })
  settings.standard = standard === 'kqms' ? undefined : standard
  settings.memberStandards = undefined
}
/** One member at `standard` (all the same again: one standard for the team) */
function setMemberStandard(
  o: TeamOpt,
  keys: readonly CharacterKey[],
  characterKey: CharacterKey,
  standard: KqmStandardKey
) {
  const settings = (o.kqm ??= { ...defaultTeamOptKqm })
  const next = {
    ...settings,
    memberStandards: { ...settings.memberStandards, [characterKey]: standard },
  }
  const all = memberStandards(next, keys)
  if (all.every((s) => s === all[0])) setAllStandards(o, all[0])
  else settings.memberStandards = next.memberStandards
}

const MIXED = 'mixed'

/** The standards with what each one's artifacts are: a standard menu's items */
function standardItems(t: TFunction) {
  return allKqmStandardKeys.map((standard) => (
    <MenuItem
      key={standard}
      value={standard}
      sx={{ display: 'block', maxWidth: 360, whiteSpace: 'normal' }}
    >
      <Box component="span" sx={{ display: 'block' }}>
        {kqmStandardName(t, standard)}
      </Box>
      <Box component="span" sx={{ ...type.label, display: 'block' }}>
        {kqmStandardDetail(t, standard)}
      </Box>
    </MenuItem>
  ))
}

/** The artifact standard for every member at once (Mixed while they differ) */
export function KqmArtifactStandard({
  kqm,
  members,
  setTeamOpt,
}: {
  kqm: TeamOptKqm | undefined
  members: readonly CharacterKey[]
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const mixed = kqmStandardsMixed(kqm, members)
  const standard = members.length
    ? kqmMemberStandard(members[0], kqm)
    : kqmStandardOf(kqm?.standard)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FieldLabel
        tip={t(
          'teamOpt.kqm.standardAllTip',
          'Sets every member’s artifacts; each can be changed in its row. KQM Standard is KQM’s own: 2 rolls of every substat and 20 placed for damage, at most 2 a piece per stat. Good, Great, Top and Perfect are this site’s: each piece is built as the game makes one (4 different lines, never its main stat, and 4 or 5 upgrades), with more of its lines and upgrades on the stats the build wants at each step. Perfect is the best five artifacts the game can make. A 4★ piece has 2 fewer rolls, each 0.8 of a 5★ one.'
        )}
      >
        {t('teamOpt.kqm.standard', 'Artifacts')}
      </FieldLabel>
      <TextField
        select
        size="small"
        value={mixed ? MIXED : standard}
        onChange={(e) =>
          setTeamOpt((o) => setAllStandards(o, kqmStandardOf(e.target.value)))
        }
        SelectProps={{
          renderValue: (v) =>
            v === MIXED
              ? t('teamOpt.kqm.standardMixed', 'Mixed')
              : kqmStandardName(t, kqmStandardOf(v as string)),
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

/** A member's artifact standard in its row */
export function KqmMemberStandard({
  characterKey,
  members,
  kqm,
  setTeamOpt,
}: {
  characterKey: CharacterKey
  members: readonly CharacterKey[]
  kqm: TeamOptKqm | undefined
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const standard = kqmMemberStandard(characterKey, kqm)
  return (
    <TextField
      select
      size="small"
      fullWidth
      value={standard}
      onChange={(e) =>
        setTeamOpt((o) =>
          setMemberStandard(
            o,
            members,
            characterKey,
            kqmStandardOf(e.target.value)
          )
        )
      }
      SelectProps={{
        renderValue: (v) => kqmStandardShort(t, kqmStandardOf(v as string)),
      }}
      inputProps={{
        'aria-label': t('teamOpt.kqm.memberArtifacts', {
          defaultValue: '{{character}} artifacts',
          character: characterKey,
        }),
      }}
      sx={{
        '& .MuiInputBase-root': { fontSize: 14 },
        '& .MuiSelect-select': { py: 0.875, ...numSx },
      }}
    >
      {standardItems(t)}
    </TextField>
  )
}
