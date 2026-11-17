import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  KqmBuild,
  TeamData,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import { Box } from '@mui/material'
import { useDeferredValue, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TeamBuff } from './buffs'
import { RotationTimeline } from './RotationTimeline'
import {
  simulateWritten,
  useMemberNames,
  useRotationSettings,
  useRotationText,
  useSimTeam,
} from './RotationWriter'
import { FieldLabel } from './ui'

/** No step of the written rotation is edited here (the timeline only shows it) */
const NONE: ReadonlySet<number> = new Set()

/**
 * The written rotation as these builds play it, under the results: the simple timeline (each
 * member's actions, swaps and the buffs that matter), at the KQM constellations with the shown
 * builds' weapons and sets, never the members' own. A bar opens the rotation's writer.
 */
export function KqmTimeline({
  teamId,
  members,
  teamData,
  kqm,
  kqmBuilds,
  kqmBuffs,
  onEdit,
}: {
  teamId: string
  members: TeamOptMember[]
  teamData?: TeamData
  kqm: TeamOptKqm
  /** The builds shown: their weapon and set effects are played */
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
  kqmBuffs?: TeamBuff[]
  /** Opens the rotation's writer (a bar's step to edit) */
  onEdit?: () => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  const { applied } = useRotationText(teamId)
  const { opener, timing, frameData } = useRotationSettings(teamId)
  const team = useSimTeam(members, kqm, kqmBuilds)
  const names = useMemberNames(members)
  // (a heavy team's play takes a moment: the page first, the timeline once it is played)
  const deferredTeam = useDeferredValue(team)
  const result = useMemo(
    () =>
      applied.trim()
        ? simulateWritten({
            text: applied,
            opener,
            timing,
            frameData,
            team: deferredTeam,
            names,
            members,
            database,
            teamId,
            gender,
            openerWarning: (warning) => warning,
          })
        : undefined,
    [
      applied,
      opener,
      timing,
      frameData,
      deferredTeam,
      names,
      members,
      database,
      teamId,
      gender,
    ]
  )
  if (!result?.sim) return null
  return (
    <Box component="section" sx={{ mt: 3, minWidth: 0 }}>
      <FieldLabel
        tip={t(
          'teamOpt.kqm.timelineTip',
          'The written rotation as these builds play it: each member’s actions and swaps, at the KQM constellations with these weapons and artifact sets. Pick an action to edit the rotation.'
        )}
        sx={{ mb: 0.75 }}
      >
        {t('teamOpt.kqm.timeline', 'Rotation timeline')}
      </FieldLabel>
      <RotationTimeline
        members={members.map((m) => m.characterKey)}
        rotation={result.rotation}
        sim={result.sim}
        edited={NONE}
        onSelect={() => onEdit?.()}
        teamData={teamData}
        buffs={kqmBuffs}
      />
    </Box>
  )
}
