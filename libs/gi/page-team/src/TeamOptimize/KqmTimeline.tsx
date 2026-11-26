import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSetKeys, allWeaponKeys } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack, TeamOptKqm } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  KqmBuild,
  SimBuffOwner,
  SimGear,
  SimHit,
  TeamData,
  TeamDataOverrides,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  GEAR_KEYS,
  ownConditional,
  rotationAttacks,
} from '@genshin-optimizer/gi/ui'
import { alpha, Box, ButtonBase, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useDeferredValue, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AttackEditor } from './AttackEditor'
import { AttackName } from './AttackName'
import type { TeamBuff } from './buffs'
import { buffsForAttacker } from './buffs'
import type { TimelineMoment } from './RotationTimeline'
import { RotationTimeline } from './RotationTimeline'
import {
  kqmBurstEvery,
  rotationIdOf,
  simulateWritten,
  useAppliedRotation,
  useMemberNames,
  useRotationSettings,
  useSimTeam,
  writtenSeconds,
} from './RotationWriter'
import { useMomentFigures } from './TimelineFigures'
import type { AuraKey } from './timelineModel'
import { aurasAt } from './timelineModel'
import {
  focusSx,
  numSx,
  SubsectionTitle,
  subsectionSx,
  tokens,
  type,
} from './ui'

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
const WEAPON_KEYS: ReadonlySet<string> = new Set(allWeaponKeys)
const SET_KEYS: ReadonlySet<string> = new Set(allArtifactSetKeys)

/**
 * Keep only kit/team entries and entries for gear the shown builds actually hold: `kqmAttacks`
 * includes states/limits for candidate gear from the replay, while the timeline plays only the
 * shown builds.
 */
function filterHeldRefs<T extends { owner: string; path: string[] }>(
  list: readonly T[] | undefined,
  held: Partial<Record<CharacterKey, SimGear>> | undefined
) {
  if (!list?.length) return []
  return list.filter((entry) => {
    if (entry.owner === 'team') return true
    const gear = held?.[entry.owner as CharacterKey]
    const key = entry.path[0]
    if (!gear || !key) return true
    if (WEAPON_KEYS.has(key)) return gear.weapon === key
    if (SET_KEYS.has(key)) return !!gear.sets?.[key]
    return true
  })
}

/** An attack as one of a member's: matches buff states and exclusions for held gear */
const sameAttack = (
  a: TeamOptAttack,
  b: TeamOptAttack,
  held?: Partial<Record<CharacterKey, SimGear>>
) => {
  const normalize = (x: TeamOptAttack) => {
    const {
      hits: _hits,
      limits,
      states,
      ...rest
    } = x as TeamOptAttack & {
      limits?: NonNullable<TeamOptAttack['limits']>
    }
    const total = x.hits || 1
    return {
      ...rest,
      states: filterHeldRefs(states, held)
        .map((s) => `${s.owner}|${s.path.join('.')}=${s.value}`)
        .sort(),
      limits: filterHeldRefs(limits, held)
        .map(
          (l) =>
            `${l.owner}|${l.path.join('.')}=${l.hits <= 0 ? '0' : (l.hits / total).toFixed(3)}`
        )
        .sort(),
    }
  }
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

/**
 * The written rotation as these builds play it, under the results: the simple timeline (each
 * member's actions, swaps and the buffs that matter). KQM's: at its constellations with the shown
 * builds' weapons and sets, never the members' own; Team optimize's: the members' own, with the
 * result's weapons and sets (`gear`). A bar opens its attack: its damage and the buffs during it.
 */
export function KqmTimeline({
  teamId,
  members,
  teamData,
  kqm,
  kqmBuilds,
  gear,
  kqmBuffs,
  kqmAttacks,
  kqmDamage,
  overrides,
  onField,
  mainStatAssumptionLevel = 0,
}: {
  teamId: string
  members: TeamOptMember[]
  teamData?: TeamData
  /** KQM theorycrafting's settings (absent: Team optimize's builds, the members' own) */
  kqm?: TeamOptKqm
  /** The builds shown: their weapon and set effects are played */
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
  /** Team optimize: the result's weapons and sets, played instead of the members' own */
  gear?: Partial<Record<CharacterKey, SimGear>>
  kqmBuffs?: TeamBuff[]
  /**
   * The run's attacks as the page lists them (played: per rotation): a bar opens its attack among
   * these, as the rotation's member rows do
   */
  kqmAttacks?: Partial<Record<CharacterKey, TeamOptAttack[]>>
  /**
   * Each of those attacks' damage in the run (per member, in their order): an action's hits are
   * listed most damage first, and the window opens on that one
   */
  kqmDamage?: Partial<Record<CharacterKey, number[]>>
  /** The KQM builds shown (an attack's figures are read with them, never the members' own) */
  overrides?: TeamDataOverrides
  /** Who is on the field by default */
  onField?: CharacterKey
  mainStatAssumptionLevel?: number
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { gender } = useDBMeta()
  // (the tab's own rotation: the KQM tab's, or Team optimize's)
  const rotationId = rotationIdOf(teamId, kqm)
  const applied = useAppliedRotation(rotationId)
  const { opener, timing, frameData } = useRotationSettings(rotationId)
  const simTeam = useSimTeam(members, kqm, kqmBuilds)
  const burstEvery = useMemo(() => kqmBurstEvery(kqm), [kqm])
  const team = useMemo(
    () => (gear ? { ...simTeam, gear: { ...simTeam.gear, ...gear } } : simTeam),
    [simTeam, gear]
  )
  const names = useMemberNames(members)
  // (a heavy team's play takes a moment: the page first, the timeline once it is played)
  const deferredTeam = useDeferredValue(team)
  const isKqm = !!kqm
  // Match `writtenKqmReplay`'s baseline conditionals when KQM overrides are given, so hits with a
  // timed buff off (e.g. TTDS on cooldown) carry the same `limits` as `kqmAttacks`.
  const current = useMemo(() => {
    if (!isKqm || !overrides) return undefined
    return (owner: SimBuffOwner, path: string[]) => {
      if (owner === 'team') {
        const switches = overrides.teamConditional as
          | Record<string, Record<string, string>>
          | undefined
        return switches
          ? switches[path[0]]?.[path[1]] || undefined
          : ownConditional(database, teamId, members, owner, path)
      }
      const kqmSwitch =
        overrides.conditionalOverrides?.[owner]?.[path[0]]?.[path[1]]
      if (kqmSwitch !== undefined) return kqmSwitch || undefined
      if (
        overrides.ownKit !== false &&
        !(overrides.ownBuild === false && GEAR_KEYS.has(path[0]))
      ) {
        const own = ownConditional(database, teamId, members, owner, path)
        if (own !== undefined) return own
      }
      return (
        overrides.extraConditionals?.[owner] as
          | Record<string, Record<string, string>>
          | undefined
      )?.[path[0]]?.[path[1]]
    }
  }, [isKqm, overrides, database, teamId, members])
  const result = useMemo(
    () =>
      applied.trim()
        ? simulateWritten({
            kqm: isKqm,
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
            current,
            // (the enemy's auras: an attack's window says which were on when it hit)
            auraTimeline: true,
            openerWarning: (warning) => warning,
            // (a Burst every 2nd rotation, as the run plays it)
            ...(burstEvery && { burstEvery }),
          })
        : undefined,
    [
      isKqm,
      applied,
      opener,
      timing,
      frameData,
      deferredTeam,
      burstEvery,
      names,
      members,
      database,
      teamId,
      gender,
      current,
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
  // the action a bar opened: its hits' attacks (among the run's, else the play's own), one shown
  type Part = {
    attack: TeamOptAttack
    moment: { seconds: number; auras: AuraKey[] }
  }
  const [opened, setOpened] = useState<{
    characterKey: CharacterKey
    parts: Part[]
    index: number
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
    // the action itself: projectiles, pulses, a summon's hits); of its own talent when it has any
    // (Mitya's Gradient Detonation: its ATK hit and its Stellar-Conduct one)
    const nextStart = Math.min(
      sim.start + sim.frames,
      ...sim.actions
        .filter((x) => x.characterKey === characterKey && x.start > start)
        .map((x) => x.start)
    )
    const all = sim.hits.filter(
      (h) =>
        h.characterKey === characterKey &&
        h.t >= start &&
        h.t < nextStart &&
        mapping.hitAttacks.has(h)
    )
    const talent = talentOf(text)
    // (its own talent's hits until that talent's next use: Mitya's Burst hit lands after his next
    // action has started)
    const nextOwn = Math.min(
      sim.start + sim.frames,
      ...sim.actions
        .filter(
          (x) =>
            x.characterKey === characterKey &&
            x.start > start &&
            talentOf(x.text) === talent
        )
        .map((x) => x.start)
    )
    const own = talent
      ? sim.hits.filter(
          (h) =>
            h.characterKey === characterKey &&
            h.t >= start &&
            h.t < nextOwn &&
            h.path[0] === talent &&
            mapping.hitAttacks.has(h)
        )
      : []
    const hits = own.length ? own : all
    const listed = kqmAttacks?.[characterKey] ?? []
    const parts: Part[] = []
    for (const hit of hits) {
      const part = partOf(hit, true)
      // (one part an attack: at its first hit here)
      if (part && !parts.some((p) => p.attack === part.attack)) parts.push(part)
    }
    // most damage in the rotation first (Mitya's Gradient Detonation: its Stellar-Conduct hit
    // before its ATK one); the play's order otherwise
    const damage = (part: Part) => {
      const i = listed.indexOf(part.attack)
      return i < 0 ? 0 : (kqmDamage?.[characterKey]?.[i] ?? 0)
    }
    parts.sort((a, b) => damage(b) - damage(a))
    // (a swap, an entry or a buff with no hit of its own: nothing to open)
    if (parts.length) setOpened({ characterKey, parts, index: 0 })
  }
  /**
   * A hit's attack: the run's same one, else the play's own (`loose`: else the run's first of the
   * same name, as a bar's window lists the run's attacks)
   */
  const partOf = (hit: SimHit, loose = false): Part | undefined => {
    const sim = result?.sim
    const at = mapping?.hitAttacks.get(hit)
    const mine = at && mapping?.attacks[at.characterKey]?.[at.index]
    if (!sim || !at || !mine) return undefined
    const samePath = (kqmAttacks?.[at.characterKey] ?? []).filter(
      (x) => JSON.stringify(x.path) === JSON.stringify(mine.path)
    )
    return {
      attack:
        samePath.find((x) => sameAttack(x, mine, deferredTeam.gear)) ??
        (loose ? samePath[0] : undefined) ??
        mine,
      moment: {
        seconds: (hit.t - sim.start) / 60,
        auras: aurasAt(sim, hit.t),
      },
    }
  }
  // a hit's mark clicked (an off-field member's too, which has no bar): its attack, as it landed
  const openHit = (hit: SimHit) => {
    const part = partOf(hit)
    if (part)
      setOpened({ characterKey: hit.characterKey, parts: [part], index: 0 })
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
        info={
          kqm
            ? t(
                'teamOpt.kqm.timelineTip',
                'The written rotation as these builds play it: each member’s actions and swaps, at the KQM constellations with these weapons and artifact sets. Pick an attack to see its damage and the buffs during it.'
              )
            : t(
                'teamOpt.result.timelineTip',
                'The written rotation as these builds play it: each member’s actions and swaps, with these weapons and artifact sets. Pick an attack to see its damage and the buffs during it.'
              )
        }
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
        onHit={openHit}
        teamData={teamData}
        buffs={kqmBuffs}
        stats={stats}
        effects={effects}
        onMoment={overrides ? setMoment : undefined}
      />
      {/* the attack a bar opened: its damage and the buffs during it, as the KQM builds have them */}
      {opened && (
        <AttackEditor
          key={opened.index}
          open
          readOnly
          overrides={overrides}
          onClose={() => setOpened(undefined)}
          teamId={teamId}
          characterKey={opened.characterKey}
          data={teamData?.[opened.characterKey]?.target}
          attack={opened.parts[opened.index].attack}
          moment={opened.parts[opened.index].moment}
          switcher={
            opened.parts.length > 1 &&
            opened.parts.map((part, i) => (
              <PartTab
                key={part.attack.path.join('.')}
                selected={i === opened.index}
                onClick={() => setOpened({ ...opened, index: i })}
              >
                <AttackName
                  data={teamData?.[opened.characterKey]?.target}
                  path={part.attack.path}
                  oneLine
                />
              </PartTab>
            ))
          }
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

/** One of an action's hits, in its window's switcher */
function PartTab({
  selected,
  onClick,
  children,
}: {
  selected: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <ButtonBase
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      sx={(theme) => ({
        minWidth: 0,
        maxWidth: '100%',
        px: 1.25,
        py: 0.5,
        borderRadius: 999,
        border: `1px solid ${selected ? alpha(tokens.gold, 0.55) : theme.palette.divider}`,
        bgcolor: selected ? alpha(tokens.gold, 0.1) : 'transparent',
        opacity: selected ? 1 : 0.8,
        transition: 'background-color .12s, border-color .12s, opacity .12s',
        '&:hover': {
          opacity: 1,
          bgcolor: alpha(theme.palette.text.primary, 0.05),
        },
        ...focusSx,
      })}
    >
      {children}
    </ButtonBase>
  )
}
