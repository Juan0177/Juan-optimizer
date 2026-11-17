import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack, TeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  KqmBuild,
  SimHit,
  TeamData,
  TeamDataOverrides,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import { rotationAttacks } from '@genshin-optimizer/gi/ui'
import { Box, Typography } from '@mui/material'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AttackEditor } from './AttackEditor'
import type { TeamBuff } from './buffs'
import { buffsForAttacker } from './buffs'
import type { TimelineMoment } from './RotationTimeline'
import { RotationTimeline } from './RotationTimeline'
import {
  simulateWritten,
  useMemberNames,
  useRotationSettings,
  useRotationText,
  useSimTeam,
  writtenSeconds,
} from './RotationWriter'
import { useMomentFigures } from './TimelineFigures'
import type { AuraKey } from './timelineModel'
import { aurasAt } from './timelineModel'
import { numSx, SubsectionTitle, subsectionSx, type } from './ui'

/** No step of the written rotation is edited here (the timeline only shows it) */
const NONE: ReadonlySet<number> = new Set()
const noop = () => undefined
/** The talent an action is (E, tE, hE: the Skill; Q: the Burst; N4: Normal Attacks…), if one */
function talentOf(text: string) {
  const action = text.replace(/^[a-z]+(?=[A-Z])/, '')
  if (action.startsWith('E')) return 'skill'
  if (action.startsWith('Q')) return 'burst'
  if (action.startsWith('CA')) return 'charged'
  if (action.startsWith('N')) return 'normal'
  if (action.startsWith('P')) return 'plunging'
  return undefined
}
/** An attack as one of a member's: everything but its hit count (and where it may land) */
const sameAttack = (a: TeamOptAttack, b: TeamOptAttack) => {
  const {
    hits: _a,
    limits: _al,
    ...restA
  } = a as TeamOptAttack & {
    limits?: unknown
  }
  const {
    hits: _b,
    limits: _bl,
    ...restB
  } = b as TeamOptAttack & {
    limits?: unknown
  }
  return JSON.stringify(restA) === JSON.stringify(restB)
}

/**
 * The written rotation as these builds play it, under the results: the simple timeline (each
 * member's actions, swaps and the buffs that matter), at the KQM constellations with the shown
 * builds' weapons and sets, never the members' own. A bar opens its attack: its damage and the
 * buffs during it.
 */
export function KqmTimeline({
  teamId,
  members,
  teamData,
  kqm,
  kqmBuilds,
  kqmBuffs,
  kqmAttacks,
  overrides,
  onField,
  mainStatAssumptionLevel = 0,
}: {
  teamId: string
  members: TeamOptMember[]
  teamData?: TeamData
  kqm: TeamOptKqm
  /** The builds shown: their weapon and set effects are played */
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
  kqmBuffs?: TeamBuff[]
  /**
   * The run's attacks as the page lists them (played: per rotation): a bar opens its attack among
   * these, as the rotation's member rows do
   */
  kqmAttacks?: Partial<Record<CharacterKey, TeamOptAttack[]>>
  /** The KQM builds shown (an attack's figures are read with them, never the members' own) */
  overrides?: TeamDataOverrides
  /** Who is on the field by default */
  onField?: CharacterKey
  mainStatAssumptionLevel?: number
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
            // (the enemy's auras: an attack's window says which were on when it hit)
            auraTimeline: true,
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
  // each hit of the timeline's play, its attack (the play shown, its first sample)
  const mapping = useMemo(() => {
    if (!result?.sim) return undefined
    const hitAttacks = new Map<
      SimHit,
      { characterKey: CharacterKey; index: number }
    >()
    const attacks = rotationAttacks(
      { ...result.sim, samples: undefined },
      result.own,
      [],
      hitAttacks
    )
    return { attacks, hitAttacks }
  }, [result])
  // the attack a bar opened: among the run's, the one it is (else the first of its talent)
  const [opened, setOpened] = useState<{
    characterKey: CharacterKey
    attack: TeamOptAttack
    moment: { seconds: number; auras: AuraKey[] }
  }>()
  const openAction = ({
    characterKey,
    start,
    text,
  }: {
    characterKey: CharacterKey
    start: number
    frames: number
    text: string
  }) => {
    const sim = result?.sim
    if (!sim || !mapping) return
    // its hits: the member's from the action's start until its next action (damage lands after
    // the action itself: projectiles, pulses, a summon's hits), the action's own talent first
    const nextStart = Math.min(
      sim.start + sim.frames,
      ...sim.actions
        .filter((x) => x.characterKey === characterKey && x.start > start)
        .map((x) => x.start)
    )
    const hits = sim.hits.filter(
      (h) =>
        h.characterKey === characterKey &&
        h.t >= start &&
        h.t < nextStart &&
        mapping.hitAttacks.has(h)
    )
    const talent = talentOf(text)
    const hit = (talent && hits.find((h) => h.path[0] === talent)) ?? hits[0]
    // (a swap, an entry or a buff with no hit of its own: nothing to open)
    const at = hit && mapping.hitAttacks.get(hit)
    const mine = at && mapping.attacks[at.characterKey]?.[at.index]
    if (!mine) return
    const listed = kqmAttacks?.[characterKey] ?? []
    const samePath = listed.filter(
      (x) => JSON.stringify(x.path) === JSON.stringify(mine.path)
    )
    const attack = samePath.find((x) => sameAttack(x, mine)) ?? samePath[0]
    setOpened({
      characterKey,
      attack: attack ?? mine,
      moment: { seconds: (hit.t - sim.start) / 60, auras: aurasAt(sim, hit.t) },
    })
  }
  // the members' stats at the moment shown and what each buff up then gives, with these builds
  const [moment, setMoment] = useState<TimelineMoment>()
  const { stats, effects } = useMomentFigures(teamId, moment, {
    enabled: !!overrides,
    teamData,
    overrides,
    mainStatAssumptionLevel,
  })
  if (!result?.sim) return null
  // (one written rotation's length, as the writer shows it)
  const length =
    writtenSeconds(result as NonNullable<typeof result>) ??
    result.sim.frames / 60
  return (
    <Box component="section" sx={{ ...subsectionSx, minWidth: 0 }}>
      <SubsectionTitle
        dense
        actions={
          <Typography
            component="span"
            sx={{ ...type.label, ...numSx, display: 'inline-flex', gap: 0.5 }}
          >
            {t('teamOpt.kqm.rotationLength', 'Rotation')}
            <Box
              component="span"
              sx={{ color: 'text.primary', fontWeight: 650 }}
            >
              {length.toFixed(1)} s
            </Box>
          </Typography>
        }
        info={t(
          'teamOpt.kqm.timelineTip',
          'The written rotation as these builds play it: each member’s actions and swaps, at the KQM constellations with these weapons and artifact sets. Pick an attack to see its damage and the buffs during it.'
        )}
      >
        {t('teamOpt.kqm.timeline', 'Rotation timeline')}
      </SubsectionTitle>
      <RotationTimeline
        members={members.map((m) => m.characterKey)}
        rotation={result.rotation}
        sim={result.sim}
        edited={NONE}
        onSelect={noop}
        onAction={openAction}
        teamData={teamData}
        buffs={kqmBuffs}
        stats={stats}
        effects={effects}
        onMoment={overrides ? setMoment : undefined}
      />
      {/* the attack a bar opened: its damage and the buffs during it, as the KQM builds have them */}
      {opened && (
        <AttackEditor
          open
          readOnly
          overrides={overrides}
          onClose={() => setOpened(undefined)}
          teamId={teamId}
          characterKey={opened.characterKey}
          data={teamData?.[opened.characterKey]?.target}
          attack={opened.attack}
          moment={opened.moment}
          buffs={buffsForAttacker(kqmBuffs ?? [], opened.characterKey)}
          mainStatAssumptionLevel={mainStatAssumptionLevel}
          members={members}
          onField={onField ?? opened.characterKey}
          onChange={noop}
          onDuplicate={noop}
          onRemove={noop}
        />
      )}
    </Box>
  )
}
