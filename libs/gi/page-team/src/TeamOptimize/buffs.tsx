import { evalIfFunc, valueString } from '@genshin-optimizer/common/util'
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactSetKeys, allWeaponKeys } from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  TeamOptAttack,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import type {
  CharacterSheet,
  DocumentConditional,
  DocumentSection,
  IFieldDisplay,
} from '@genshin-optimizer/gi/sheets'
import {
  getArtSheet,
  getMoonsignSheet,
  getWeaponSheet,
  hexereiSheet,
  MoonsignConditionalSection,
  reactionConditionals,
  resonanceSheets,
} from '@genshin-optimizer/gi/sheets'
import { getCharStat } from '@genshin-optimizer/gi/stats'
import type {
  BuffRef,
  KqmResult,
  TeamData,
  TeamDataOverrides,
} from '@genshin-optimizer/gi/ui'
import {
  buffRefKey,
  getTeamDataWith,
  resolveInfo,
  teamConditionals,
  teamOptBonusStats,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import { uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import { input } from '@genshin-optimizer/gi/wr'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTeamOpt } from './useTeamOpt'

/** A conditional that is on in the team, as Team Optimize lists it */
export interface TeamBuff {
  ref: BuffRef
  key: string
  /** The conditional's state */
  value: string
  /** Where it comes from: the talent, weapon, artifact set or resonance */
  title?: ReactNode
  icon?: ReactNode
  /** The conditional (and its state when it has several) */
  name: ReactNode
  /** The conditional, without its state */
  label?: ReactNode
  /** Its states, when it has several (one of them per attack) */
  states?: { value: string; name: ReactNode }[]
  /** What it gives in each state: the sheet's fields, as Team settings lists them */
  fields?: Partial<Record<string, IFieldDisplay[]>>
  /**
   * Why it does nothing now, whatever the attack: `gear`, its weapon or artifact set is not
   * equipped (it counts if Team Optimize picks them); `hidden`, its sheet hides it (an effect not
   * unlocked, a resonance the team does not have)
   */
  inactive?: 'gear' | 'hidden'
  /** Buffs the team (not only its owner) */
  teamBuff: boolean
  /**
   * No sheet section describes it (a switch the rotation sets for itself, as Bennett's field
   * recipient, or a leftover of a sheet that changed): named by its path only
   */
  unnamed?: true
  /**
   * The member's talent it comes from (`skill`, `burst`, `passive1`, `constellation2`…, or
   * `moonsign`): a character's buff is named by it ("Elemental Skill", "A1", "C2")
   */
  talent?: string
}

const samePath = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])

function isConditional(
  section: DocumentSection
): section is DocumentConditional {
  return 'states' in section && !!section.states
}

/** A sheet section, and whether it is in use now (its weapon or set equipped, its resonance active) */
interface SectionEntry {
  section: DocumentSection
  inUse?: { reason: 'gear' | 'hidden'; test: (data: UIData) => boolean }
  /** A character's: the talent it is in */
  talent?: string
}

const entries = (
  sections: readonly DocumentSection[],
  inUse?: SectionEntry['inUse'],
  talent?: string
): SectionEntry[] => sections.map((section) => ({ section, inUse, talent }))

/** The sections that may define the conditional at `ref` */
function sectionsFor(
  ref: BuffRef,
  teamData: TeamData
): { sections: SectionEntry[]; uiData?: UIData } {
  const [sheetKey] = ref.path
  if (ref.owner === 'team') {
    const uiData = Object.values(teamData)[0]?.target
    if (sheetKey === 'reaction')
      return { sections: entries(reactionConditionals), uiData }
    return {
      sections: [
        ...resonanceSheets.flatMap((r) =>
          entries(r.sections, { reason: 'hidden', test: r.canShow })
        ),
        ...entries(hexereiSheet.sections),
        ...entries(getMoonsignSheet(uiData).sections),
      ],
      uiData,
    }
  }
  const bundle = teamData[ref.owner]
  if (!bundle) return { sections: [] }
  const uiData = bundle.target
  if (allArtifactSetKeys.includes(sheetKey as ArtifactSetKey)) {
    const setKey = sheetKey as ArtifactSetKey
    const sheet = getArtSheet(setKey)
    return {
      sections: ([1, 2, 4] as const).flatMap((pieces) =>
        entries(sheet.setEffectDocument(pieces) ?? [], {
          reason: 'gear',
          test: (data) => (data.get(input.artSet[setKey]).value ?? 0) >= pieces,
        })
      ),
      uiData,
    }
  }
  if (allWeaponKeys.includes(sheetKey as WeaponKey))
    return {
      sections: entries(getWeaponSheet(sheetKey as WeaponKey).document, {
        reason: 'gear',
        test: (data) => data.get(input.weapon.key).value === sheetKey,
      }),
      uiData,
    }
  const characterSheet = bundle.characterSheet as CharacterSheet
  const characterKey = ref.owner as CharacterKey
  return {
    sections: [
      // as in Team settings: Nod-Krai characters have no such section
      ...(getCharStat(characterKey).region === 'nodKrai'
        ? []
        : entries(
            [MoonsignConditionalSection(characterKey, characterSheet)],
            undefined,
            'moonsign'
          )),
      ...Object.entries(characterSheet.talent).flatMap(([talent, t]) =>
        entries(t?.sections ?? [], undefined, talent)
      ),
    ],
    uiData,
  }
}

/** Why the conditional of `entry` does nothing now (undefined: it may do something) */
function inactiveIn(
  { section, inUse }: SectionEntry,
  uiData: UIData | undefined
): TeamBuff['inactive'] {
  if (!uiData) return undefined
  try {
    if (inUse && !inUse.test(uiData)) return inUse.reason
    // as Team settings: a section the sheet hides (an effect not unlocked)
    if (section.canShow && !uiData.get(section.canShow).value) return 'hidden'
  } catch {
    // cannot tell: listed as in use
  }
  return undefined
}

/**
 * Switches the rotation sets for itself that stand for a sheet conditional in one of its states:
 * the timeline names and describes them as that one
 */
const SHOWN_AS: Partial<
  Record<string, { path: readonly string[]; value: string }>
> = {
  // the member Bennett's field reached at its last tick: his "active character in the field"
  'Bennett.fieldRecipient': {
    path: ['Bennett', 'activeInArea'],
    value: 'activeInArea',
  },
}

/** `describe` for a buff the simulation timed: its own switches as the conditional they stand for */
export function describeTimed(
  ref: BuffRef,
  value: string,
  teamData: TeamData
): Omit<TeamBuff, 'ref' | 'key' | 'value'> {
  const shownAs = SHOWN_AS[ref.path.join('.')]
  if (!shownAs) return describe(ref, value, teamData)
  const shown = describe(
    { ...ref, path: [...shownAs.path] },
    shownAs.value,
    teamData
  )
  return {
    ...shown,
    ...(shown.fields && {
      fields: { [value]: shown.fields[shownAs.value] ?? [] },
    }),
  }
}

/** A conditional's name, source and states as its sheet gives them (by its path if it has none) */
export function describe(
  ref: BuffRef,
  value: string,
  teamData: TeamData
): Omit<TeamBuff, 'ref' | 'key' | 'value'> {
  try {
    return describeFromSheets(ref, value, teamData)
  } catch {
    // a sheet that cannot describe it: still listed, by its path
    return { name: ref.path.join(' · '), teamBuff: false, unnamed: true }
  }
}

function describeFromSheets(
  ref: BuffRef,
  value: string,
  teamData: TeamData
): Omit<TeamBuff, 'ref' | 'key' | 'value'> {
  const { sections, uiData } = sectionsFor(ref, teamData)
  for (const entry of sections) {
    const { section } = entry
    if (!isConditional(section)) continue
    const states = uiData
      ? evalIfFunc(section.states, uiData)
      : typeof section.states === 'function'
        ? {}
        : section.states
    const inactive = inactiveIn(entry, uiData)
    const header = {
      title: section.header?.title,
      icon: uiData ? evalIfFunc(section.header?.icon, uiData) : undefined,
      teamBuff: !!section.teamBuff,
      ...(inactive ? { inactive } : {}),
      ...(entry.talent ? { talent: entry.talent } : {}),
    }
    if ('path' in section && section.path) {
      if (!samePath(section.path, ref.path)) continue
      const entries = Object.entries(
        states as Record<string, { name?: ReactNode; fields?: IFieldDisplay[] }>
      )
      const all = entries.map(([key, state]) => ({
        value: key,
        name: state.name ?? key,
      }))
      const stateName = all.find((s) => s.value === value)?.name
      return {
        ...header,
        // a toggle's state ("on") says nothing: only states of a choice are named
        name:
          stateName && all.length > 1 ? (
            <>
              {section.name}: {stateName}
            </>
          ) : (
            section.name
          ),
        label: section.name,
        ...(all.length > 1 ? { states: all } : {}),
        fields: Object.fromEntries(
          entries.map(([key, state]) => [key, state.fields ?? []])
        ),
      }
    }
    for (const state of Object.values(
      states as Record<
        string,
        {
          path?: readonly string[]
          name?: ReactNode
          fields?: IFieldDisplay[]
        }
      >
    ))
      if (state.path && samePath(state.path, ref.path))
        return {
          ...header,
          name: state.name,
          fields: { [value]: state.fields ?? [] },
        }
  }
  // not found in the sheets (e.g. a leftover of a sheet that changed): its path is all there is
  return { name: ref.path.join(' · '), teamBuff: false, unnamed: true }
}

/** Every conditional that is on in the team, with its name */
export function teamBuffsOf(
  database: ArtCharDatabase,
  teamId: string,
  teamData: TeamData
): TeamBuff[] {
  return teamConditionals(database, teamId).map(({ ref, value }) => ({
    ref,
    key: buffRefKey(ref),
    value,
    ...describe(ref, value, teamData),
  }))
}

/**
 * The KQM tab's switches that are on, with their names, before it has builds: its members' kit
 * switches and its team switches (its own; not set up yet: the team's), no gear effects
 */
export function useKqmSwitchBuffs(
  teamId: string,
  teamData: TeamData | undefined,
  kqm: TeamOptKqm | undefined
): TeamBuff[] {
  const database = useDatabase()
  return useMemo(() => {
    if (!teamData) return []
    if (!kqm?.teamConditional)
      return teamBuffsOf(database, teamId, teamData).filter(
        (b) => b.inactive !== 'gear'
      )
    const out: { ref: BuffRef; value: string }[] = []
    for (const [ck, items] of Object.entries(kqm.passives ?? {}))
      for (const [item, conds] of Object.entries(items ?? {}))
        if (
          !(allWeaponKeys as readonly string[]).includes(item) &&
          !(allArtifactSetKeys as readonly string[]).includes(item)
        )
          for (const [cond, value] of Object.entries(conds ?? {}))
            if (value)
              out.push({
                ref: { owner: ck as CharacterKey, path: [item, cond] },
                value,
              })
    for (const [item, conds] of Object.entries(
      kqm.teamConditional as Record<string, Record<string, string>>
    ))
      for (const [cond, value] of Object.entries(conds ?? {}))
        if (value)
          out.push({ ref: { owner: 'team', path: [item, cond] }, value })
    return out.map(({ ref, value }) => ({
      ref,
      key: buffRefKey(ref),
      value,
      ...describe(ref, value, teamData),
    }))
  }, [database, teamId, teamData, kqm])
}

export function useTeamBuffs(teamId: string, teamData: TeamData | undefined) {
  const database = useDatabase()
  // `teamData` is recomputed whenever a conditional changes
  return useMemo(
    () => (teamData ? teamBuffsOf(database, teamId, teamData) : []),
    [database, teamId, teamData]
  )
}

/** One thing a buff gives, as its sheet shows it: a stat and its value, or a line of text */
export interface BuffEffect {
  /** Its field's place in the sheet */
  key: string
  name: ReactNode
  /** With its unit: "40%", "1,234" (none: a line of text) */
  value?: ReactNode
  /** The stat's colour (an element, a reaction) */
  variant?: string
  /** The stat's key ("atk", "electro_enemyRes_"): its short name */
  stat?: string
}

/** "90.0%" → "90%", "12.50" → "12.5": the value as the sheet gives it, without trailing zeros */
const tidy = (text: string) =>
  text.replace(/(\.\d*?)0+(?=\D*$)/, '$1').replace(/\.(?=\D*$)/, '')

/**
 * What `fields` (a buff's, in one state) show in `data`, like Team settings: the stats it gives
 * and their values. Values that are 0 or hidden there are left out; without any value, a line of
 * text that says what it does (e.g. "gains the Radiance effect"), not durations or cooldowns.
 */
export function buffEffects(
  fields: readonly IFieldDisplay[] | undefined,
  data: UIData | undefined
): BuffEffect[] {
  if (!fields?.length || !data) return []
  const values: BuffEffect[] = []
  const texts: BuffEffect[] = []
  fields.forEach((field, index) => {
    const key = `${index}`
    try {
      if (field.canShow && !field.canShow(data)) return
      if ('node' in field) {
        const calc = data.get(field.node)
        if (
          calc.isEmpty ||
          typeof calc.value !== 'number' ||
          !calc.value ||
          !Number.isFinite(calc.value)
        )
          return
        const { name, unit, fixed, variant, textSuffix, multi } = resolveInfo(
          calc.info
        )
        if (!name) return
        values.push({
          key,
          name: textSuffix ? (
            <>
              {name} {textSuffix}
            </>
          ) : (
            name
          ),
          value: `${multi ? `${multi}×` : ''}${tidy(valueString(calc.value, unit, fixed))}`,
          variant: variant && variant !== 'invalid' ? variant : undefined,
          stat: calc.info.path,
        })
      } else if (field.text) {
        const value = evalIfFunc(field.value, data)
        if (value === undefined || value === null || value === '')
          texts.push({ key, name: field.text })
      }
    } catch {
      // a field this data cannot compute: left out
    }
  })
  return values.length ? values : texts.slice(0, 1)
}

/**
 * The team's data during `attack`, as the rotation computes it: the buffs in the states it uses,
 * its member on the field, the extra buffs counted. Where the editor reads what each buff gives.
 * Built in the background (the editor opens first); `version` (the team's buffs) rebuilds it.
 */
export function useAttackTeamData(
  teamId: string,
  attack: TeamOptAttack,
  onField: CharacterKey,
  mainStatAssumptionLevel: number,
  version: unknown,
  /** Other builds than the members' own (KQM theorycrafting's: `kqmTeamOverrides`) */
  overrides?: TeamDataOverrides,
  /** Off: nothing is built (no builds to read it with: KQM theorycrafting without a result) */
  enabled = true
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [teamOpt] = useTeamOpt(teamId)
  const [teamData, setTeamData] = useState<
    Partial<Record<CharacterKey, { target: UIData }>> | undefined
  >()
  const statesKey = JSON.stringify(attack.states ?? [])
  const active = attack.onField ?? onField
  // biome-ignore lint/correctness/useExhaustiveDependencies: `statesKey` stands for `attack.states`, `version` for the team
  useEffect(() => {
    if (!enabled) {
      setTeamData(undefined)
      return undefined
    }
    const timer = setTimeout(() => {
      const keys = teamOptMembers(database, teamId).map((m) => m.characterKey)
      const data = getTeamDataWith(database, teamId, {
        ...overrides,
        states: attack.states ?? [],
        mainStatAssumptionLevel,
        bonusStats: overrides?.bonusStats ?? teamOptBonusStats(teamOpt, keys),
      })
      if (!data) return
      const onFieldNow = data[active] ? active : keys[0]
      if (!onFieldNow || !data[onFieldNow]) return
      // the member on the field first, as in the app (its data is the team's "active" one)
      const ordered = { [onFieldNow]: data[onFieldNow], ...data }
      setTeamData(uiDataForTeam(ordered, gender, onFieldNow))
    }, 0)
    return () => clearTimeout(timer)
  }, [
    database,
    teamId,
    gender,
    statesKey,
    active,
    mainStatAssumptionLevel,
    teamOpt.bonusStats,
    version,
    overrides,
    enabled,
  ])
  return enabled ? teamData : undefined
}

/**
 * KQM theorycrafting's buffs for the builds of `result` (`overrides`: `kqmTeamOverrides` of it):
 * the team's conditionals that are on, the gear effects it counts by rule, and every state its
 * played attacks use, named from the sheets with those builds. The passives of gear the builds do
 * not have are left out (the members' own gear never shows here).
 */
export function useKqmTeamBuffs(
  teamId: string,
  teamData: TeamData | undefined,
  overrides: TeamDataOverrides | undefined,
  result: Pick<KqmResult, 'assumed' | 'played' | 'builds'> | undefined
): TeamBuff[] {
  const database = useDatabase()
  const { gender } = useDBMeta()
  return useMemo(() => {
    if (!teamData || !overrides || !result) return []
    const data = getTeamDataWith(database, teamId, overrides)
    if (!data) return []
    const keys = Object.keys(data) as CharacterKey[]
    if (!keys.length) return []
    const ui = uiDataForTeam(data, gender, keys[0])
    // (the sheets are the members'; the calculation data the builds')
    const kqmData: TeamData = Object.fromEntries(
      keys.flatMap((ck) => {
        const bundle = teamData[ck]
        const target = ui[ck]?.target
        return bundle && target ? [[ck, { ...bundle, target }]] : []
      })
    )
    const refs = new Map<string, { ref: BuffRef; value: string }>()
    const add = (ref: BuffRef, value: string) => {
      const key = buffRefKey(ref)
      if (!refs.has(key)) refs.set(key, { ref, value })
    }
    // the switches the builds count: KQM's own (its members' and team's), never the team's own
    // once KQM has them (`kqmOwnSettings`)
    if (overrides.ownKit === false) {
      for (const [ck, items] of Object.entries(
        overrides.conditionalOverrides ?? {}
      ))
        for (const [item, conds] of Object.entries(items ?? {}))
          for (const [cond, value] of Object.entries(conds ?? {}))
            if (value)
              add({ owner: ck as CharacterKey, path: [item, cond] }, value)
      const teamSwitches = (overrides.teamConditional ??
        database.teams.get(teamId)?.conditional ??
        {}) as Record<string, Record<string, string>>
      for (const [item, conds] of Object.entries(teamSwitches))
        for (const [cond, value] of Object.entries(conds ?? {}))
          if (value) add({ owner: 'team', path: [item, cond] }, value)
    } else
      for (const { ref, value } of teamConditionals(database, teamId))
        add(ref, value)
    for (const [ck, list] of Object.entries(result.assumed ?? {}))
      for (const { path, value } of list ?? [])
        add({ owner: ck as CharacterKey, path }, value)
    for (const attacks of Object.values(result.played?.attacks ?? {}))
      for (const attack of attacks ?? [])
        for (const { owner, path, value } of attack.states ?? [])
          add({ owner, path }, value)
    return [...refs.values()]
      .map(({ ref, value }) => ({
        ref,
        key: buffRefKey(ref),
        value,
        ...describe(ref, value, kqmData),
      }))
      .filter(
        (buff) =>
          buff.inactive !== 'gear' && kqmBuildHas(result.builds, buff.ref)
      )
  }, [database, gender, teamId, teamData, overrides, result])
}

/**
 * A weapon's or set's effect belongs to the KQM build that has that item: the run also plays each
 * member's candidate items (their states are in its attacks and rules), and a member whose own
 * build lacks an item has no sheet section to tell it is not worn
 */
function kqmBuildHas(
  builds: KqmResult['builds'] | undefined,
  ref: BuffRef
): boolean {
  if (ref.owner === 'team') return true
  const [item] = ref.path
  const build = builds?.[ref.owner]
  if ((allArtifactSetKeys as readonly string[]).includes(item))
    return (build?.sets[item as ArtifactSetKey] ?? 0) >= 2
  if ((allWeaponKeys as readonly string[]).includes(item))
    return build?.weapon.key === item
  return true
}

/** The buffs that can change an attack of `characterKey`: its own, the team's, and teammates' team buffs */
export function buffsForAttacker(
  buffs: readonly TeamBuff[],
  characterKey: CharacterKey
) {
  return buffs.filter(
    (b) => b.ref.owner === characterKey || b.ref.owner === 'team' || b.teamBuff
  )
}
