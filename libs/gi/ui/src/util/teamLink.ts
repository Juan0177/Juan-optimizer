import { objKeyMap } from '@genshin-optimizer/common/util'
import type {
  ArtifactRarity,
  ArtifactSlotKey,
  AscensionKey,
  CharacterKey,
  MainStatKey,
  RefinementKey,
  SubstatKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allCharacterKeys,
  allElementWithPhyKeys,
  allMainStatKeys,
  allSubstatKeys,
  allWeaponKeys,
  artMaxLevel,
  artSlotMainKeys,
  validateCharLevelAsc,
  validateWeaponLevelAsc,
} from '@genshin-optimizer/gi/consts'
import type {
  ArtCharDatabase,
  BuildTc,
  LoadoutDatum,
  Team,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import {
  defaultInitialWeaponKey,
  defaultTeamOptKqm,
  initCharTC,
  initTeamOpt,
} from '@genshin-optimizer/gi/db'
import { getCharWeaponType, getWeaponStat } from '@genshin-optimizer/gi/stats'
import { deflateSync, Inflate, strFromU8, strToU8 } from 'fflate'

/**
 * Team links: a team (its members, their builds, its rotation) from another site, in a link that
 * opens Stellar Optimizer's import page (`#/teams/import?data=…`). Everything rides in the link
 * after the `#`, so it never reaches a server. The format is documented on the site
 * (Documentation › Team link) and kept backward compatible: a new field is optional and ignored by
 * older versions, a change that is not gets a new `version`, and every version stays readable.
 */
export const TEAM_LINK_FORMAT = 'stellar-team'
export const TEAM_LINK_VERSION = 1
/** The import page's route, and the link's query parameter */
export const TEAM_LINK_PATH = '/teams/import'
export const TEAM_LINK_PARAM = 'data'
export const TEAM_LINK_LIMITS = {
  /** Characters of the encoded data in a link */
  payload: 60_000,
  /** Bytes of the JSON once decoded */
  json: 512_000,
  teams: 10,
  members: 4,
  name: 60,
  description: 2_000,
  rotation: 5_000,
  url: 500,
} as const

export interface TeamLinkMemberJson {
  character: string
  level?: number
  ascension?: number
  constellation?: number
  talents?: { auto?: number; skill?: number; burst?: number }
  weapon?: {
    key: string
    level?: number
    ascension?: number
    refinement?: number
  }
  artifacts?: {
    sets?: Record<string, number>
    mainStats?: { sands?: string; goblet?: string; circlet?: string }
    substats?: Record<string, number>
    pieces?: Partial<
      Record<ArtifactSlotKey, { rarity?: number; level?: number }>
    >
  }
  minEnergyRecharge?: number
  extensions?: Record<string, unknown>
}
export interface TeamLinkTeamJson {
  name?: string
  description?: string
  url?: string
  members: TeamLinkMemberJson[]
  rotation?: {
    text: string
    opener?: string
    ping?: number
    rotations?: 'steady' | number
    countOpener?: boolean
  }
  enemy?: {
    level?: number
    resistance?: number
    resistances?: Partial<Record<string, number>>
    defenseReduction?: number
    defenseIgnore?: number
    hp?: number
  }
  buffs?: Record<string, Record<string, number>>
  reference?: {
    dps?: number
    damage?: number
    rotationSeconds?: number
    note?: string
  }
  extensions?: Record<string, unknown>
}
export interface TeamLinkJson {
  format: typeof TEAM_LINK_FORMAT
  version: number
  source?: { name?: string; url?: string }
  teams: TeamLinkTeamJson[]
  extensions?: Record<string, unknown>
}

/**
 * Something wrong with a link or a team in it. An error keeps the team (or the whole link, without
 * `team`) from being imported; a warning says what was changed or left out.
 */
export interface TeamLinkProblem {
  level: 'error' | 'warning'
  code:
    | 'payload'
    | 'format'
    | 'version'
    | 'teams'
    | 'members'
    | 'character'
    | 'duplicate'
    | 'weapon'
    | 'weaponType'
    | 'set'
    | 'setCount'
    | 'mainStat'
    | 'stat'
    | 'number'
    | 'text'
    | 'url'
    | 'unused'
  /** Where, as a path into the JSON ("teams[0].members[1].weapon.key") */
  at: string
  /** The value at fault, or what was used instead */
  value?: string
  used?: string
  /** Which team it is about (absent: the whole link) */
  team?: number
}

export interface TeamLinkBuild {
  weapon: {
    key: WeaponKey
    level: number
    ascension: AscensionKey
    refinement: RefinementKey
  }
  sets: Partial<Record<string, 1 | 2 | 4>>
  mainStats: Record<'sands' | 'goblet' | 'circlet', MainStatKey>
  substats: Record<SubstatKey, number>
  pieces: Record<ArtifactSlotKey, { rarity: ArtifactRarity; level: number }>
}
export interface TeamLinkMember {
  characterKey: CharacterKey
  level: number
  ascension: AscensionKey
  constellation: number
  talent: { auto: number; skill: number; burst: number }
  /** Absent: the member plays with the player's own equipped weapon and artifacts */
  build?: TeamLinkBuild
  minEnergyRecharge?: number
}
export interface TeamLinkTeam {
  name: string
  description: string
  url?: string
  members: TeamLinkMember[]
  rotation?: {
    text: string
    opener: string
    pingMs?: number
    rotations?: number
    countOpener?: boolean
  }
  enemy?: { enemyOverride: Team['enemyOverride']; enemyHp?: number }
  buffs?: NonNullable<TeamOpt['bonusStats']>
  reference?: {
    dps?: number
    damage?: number
    rotationSeconds?: number
    note?: string
  }
}
export interface TeamLink {
  source?: { name?: string; url?: string }
  /** The teams read, each with its problems; one with an error cannot be imported */
  teams: {
    team?: TeamLinkTeam
    /** Its name, also when it cannot be imported */
    name?: string
    problems: TeamLinkProblem[]
  }[]
  /** Problems with the link as a whole (an error: nothing in it can be imported) */
  problems: TeamLinkProblem[]
}

const toBase64Url = (bytes: Uint8Array) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromBase64Url = (text: string) => {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A team link's data for a link: `z.` + base64url of its JSON compressed (raw DEFLATE) */
export function encodeTeamLink(data: TeamLinkJson): string {
  return `z.${toBase64Url(deflateSync(strToU8(JSON.stringify(data)), { level: 9 }))}`
}

/**
 * A link's data read back: `z.` (raw DEFLATE) or `j.` (plain JSON), base64url. Undefined when it is
 * not one, or larger than the limits.
 */
export function decodeTeamLink(payload: string): unknown {
  const text = payload.trim()
  if (!text || text.length > TEAM_LINK_LIMITS.payload) return undefined
  const dot = text.indexOf('.')
  const kind = text.slice(0, dot)
  const body = text.slice(dot + 1)
  if (dot < 0 || !/^[A-Za-z0-9_-]*$/.test(body)) return undefined
  try {
    const bytes = fromBase64Url(body)
    const raw =
      kind === 'z' ? inflated(bytes) : kind === 'j' ? bytes : undefined
    if (!raw || raw.length > TEAM_LINK_LIMITS.json) return undefined
    return JSON.parse(strFromU8(raw))
  } catch {
    return undefined
  }
}

/** Raw DEFLATE inflated, stopping past the JSON limit (a small link must not unpack to a huge one) */
function inflated(bytes: Uint8Array): Uint8Array | undefined {
  const chunks: Uint8Array[] = []
  let size = 0
  const inflater = new Inflate((chunk) => {
    size += chunk.length
    if (size > TEAM_LINK_LIMITS.json) throw new Error('too large')
    chunks.push(chunk)
  })
  inflater.push(bytes, true)
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** A link to `site`'s import page with this data */
export const teamLinkUrl = (site: string, payload: string) =>
  `${site.replace(/\/+$/, '')}/#${TEAM_LINK_PATH}?${TEAM_LINK_PARAM}=${payload}`

/** The data of a team link pasted whole (its URL), or of the JSON itself; undefined if neither */
export function teamLinkFromText(text: string): unknown {
  const trimmed = text.trim()
  const match = trimmed.match(/[?&]data=([A-Za-z0-9_.-]+)/)
  if (match && trimmed.includes(TEAM_LINK_PATH)) return decodeTeamLink(match[1])
  if (!trimmed.startsWith('{')) return undefined
  try {
    const data = JSON.parse(trimmed)
    return isObject(data) && data['format'] === TEAM_LINK_FORMAT
      ? data
      : undefined
  } catch {
    return undefined
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const BUFF_STATS: ReadonlySet<string> = new Set([
  ...allSubstatKeys,
  ...allMainStatKeys,
])
const SLOTS = ['flower', 'plume', 'sands', 'goblet', 'circlet'] as const

/** Reads a link's data (`decodeTeamLink`'s) into teams to import, with what is wrong with them */
export function readTeamLink(data: unknown): TeamLink {
  const linkProblems: TeamLinkProblem[] = []
  const fail = (code: TeamLinkProblem['code'], at = '', value?: string) => ({
    teams: [],
    problems: [{ level: 'error' as const, code, at, value }],
  })
  if (data === undefined) return fail('payload')
  if (!isObject(data) || data['format'] !== TEAM_LINK_FORMAT)
    return fail('format', 'format')
  const version = data['version']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1)
    return fail('format', 'version')
  if (version > TEAM_LINK_VERSION)
    return fail('version', 'version', String(version))
  unused(
    data,
    ['format', 'version', 'source', 'teams', 'extensions'],
    '',
    linkProblems
  )
  const source = isObject(data['source'])
    ? {
        name: text(data['source']['name'], TEAM_LINK_LIMITS.name),
        url: url(data['source']['url'], 'source.url', linkProblems),
      }
    : undefined
  const teams = data['teams']
  if (!Array.isArray(teams) || !teams.length) return fail('teams', 'teams')
  if (teams.length > TEAM_LINK_LIMITS.teams)
    linkProblems.push({
      level: 'warning',
      code: 'teams',
      at: 'teams',
      value: String(teams.length),
      used: String(TEAM_LINK_LIMITS.teams),
    })
  return {
    ...(source?.name || source?.url ? { source } : {}),
    teams: teams
      .slice(0, TEAM_LINK_LIMITS.teams)
      .map((raw, i) => readTeam(raw, i)),
    problems: linkProblems,
  }
}

function text(value: unknown, limit: number) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : undefined
}

function url(value: unknown, at: string, problems: TeamLinkProblem[]) {
  if (value === undefined) return undefined
  if (
    typeof value === 'string' &&
    value.length <= TEAM_LINK_LIMITS.url &&
    /^https:\/\/[^\s]+$/i.test(value)
  )
    return value
  problems.push({ level: 'warning', code: 'url', at, value: String(value) })
  return undefined
}

function unused(
  object: Record<string, unknown>,
  known: readonly string[],
  at: string,
  problems: TeamLinkProblem[],
  team?: number
) {
  for (const key of Object.keys(object))
    if (!known.includes(key))
      problems.push({
        level: 'warning',
        code: 'unused',
        at: at ? `${at}.${key}` : key,
        ...(team !== undefined ? { team } : {}),
      })
}

function readTeam(raw: unknown, index: number): TeamLink['teams'][number] {
  const problems: TeamLinkProblem[] = []
  const base = `teams[${index}]`
  const problem = (p: Omit<TeamLinkProblem, 'team'>) =>
    problems.push({ ...p, team: index })
  /** A number in [min, max] (rounded when `integer`), else the default, with a warning */
  const num = (
    value: unknown,
    at: string,
    min: number,
    max: number,
    fallback: number,
    integer = true
  ): number => {
    if (value === undefined) return fallback
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      problem({
        level: 'warning',
        code: 'number',
        at,
        value: String(value),
        used: String(fallback),
      })
      return fallback
    }
    const used = Math.min(
      max,
      Math.max(min, integer ? Math.round(value) : value)
    )
    if (used !== value)
      problem({
        level: 'warning',
        code: 'number',
        at,
        value: String(value),
        used: String(used),
      })
    return used
  }
  if (!isObject(raw)) {
    problem({ level: 'error', code: 'members', at: base })
    return { problems }
  }
  const name = text(raw['name'], TEAM_LINK_LIMITS.name) || undefined
  unused(
    raw,
    [
      'name',
      'description',
      'url',
      'members',
      'rotation',
      'enemy',
      'buffs',
      'reference',
      'extensions',
    ],
    base,
    problems,
    index
  )
  const rawMembers = raw['members']
  if (
    !Array.isArray(rawMembers) ||
    !rawMembers.length ||
    rawMembers.length > TEAM_LINK_LIMITS.members
  ) {
    problem({
      level: 'error',
      code: 'members',
      at: `${base}.members`,
      value: Array.isArray(rawMembers) ? String(rawMembers.length) : undefined,
    })
    return { name, problems }
  }
  const members: TeamLinkMember[] = []
  rawMembers.forEach((m, i) => {
    const at = `${base}.members[${i}]`
    if (!isObject(m)) {
      problem({ level: 'error', code: 'character', at })
      return
    }
    unused(
      m,
      [
        'character',
        'level',
        'ascension',
        'constellation',
        'talents',
        'weapon',
        'artifacts',
        'minEnergyRecharge',
        'extensions',
      ],
      at,
      problems,
      index
    )
    const characterKey = m['character'] as CharacterKey
    if (!allCharacterKeys.includes(characterKey)) {
      problem({
        level: 'error',
        code: 'character',
        at: `${at}.character`,
        value: String(m['character']),
      })
      return
    }
    if (members.some((x) => x.characterKey === characterKey)) {
      problem({
        level: 'error',
        code: 'duplicate',
        at: `${at}.character`,
        value: characterKey,
      })
      return
    }
    const level = num(m['level'], `${at}.level`, 1, 100, 90)
    const { level: charLevel, ascension } = validateCharLevelAsc(
      level,
      num(m['ascension'], `${at}.ascension`, 0, 6, 0) as AscensionKey
    )
    const talents = isObject(m['talents']) ? m['talents'] : {}
    const talent = objKeyMap(['auto', 'skill', 'burst'] as const, (k) =>
      num(talents[k], `${at}.talents.${k}`, 1, 10, 10)
    )
    const member: TeamLinkMember = {
      characterKey,
      level: charLevel,
      ascension,
      constellation: num(m['constellation'], `${at}.constellation`, 0, 6, 0),
      talent,
    }
    if (m['minEnergyRecharge'] !== undefined)
      member.minEnergyRecharge = num(
        m['minEnergyRecharge'],
        `${at}.minEnergyRecharge`,
        0,
        1000,
        0,
        false
      )
    if (m['weapon'] !== undefined || m['artifacts'] !== undefined) {
      const build = readBuild(characterKey, m, at, problem, num)
      if (!build) return
      member.build = build
    }
    members.push(member)
  })
  if (members.length !== rawMembers.length) return { name, problems }

  const team: TeamLinkTeam = {
    name: name ?? members.map((m) => m.characterKey).join(' / '),
    description: text(raw['description'], TEAM_LINK_LIMITS.description) ?? '',
    members,
  }
  const teamUrl = url(raw['url'], `${base}.url`, problems)
  if (teamUrl) team.url = teamUrl

  const rotation = raw['rotation']
  if (rotation !== undefined) {
    const at = `${base}.rotation`
    if (!isObject(rotation) || typeof rotation['text'] !== 'string') {
      problem({ level: 'warning', code: 'text', at: `${at}.text` })
    } else {
      unused(
        rotation,
        ['text', 'opener', 'ping', 'rotations', 'countOpener'],
        at,
        problems,
        index
      )
      const long = (v: unknown, field: string) => {
        const s = typeof v === 'string' ? v : ''
        if (s.length > TEAM_LINK_LIMITS.rotation)
          problem({
            level: 'warning',
            code: 'text',
            at: `${at}.${field}`,
            value: String(s.length),
            used: String(TEAM_LINK_LIMITS.rotation),
          })
        return s.slice(0, TEAM_LINK_LIMITS.rotation).trim()
      }
      const counted = rotation['rotations']
      team.rotation = {
        text: long(rotation['text'], 'text'),
        opener: long(rotation['opener'], 'opener'),
        ...(rotation['ping'] !== undefined
          ? { pingMs: num(rotation['ping'], `${at}.ping`, 0, 500, 100) }
          : {}),
        ...(counted !== undefined && counted !== 'steady'
          ? { rotations: num(counted, `${at}.rotations`, 1, 6, 1) }
          : {}),
        ...(rotation['countOpener'] === true ? { countOpener: true } : {}),
      }
      if (!team.rotation.text) delete team.rotation
    }
  }

  const enemy = raw['enemy']
  if (isObject(enemy)) {
    const at = `${base}.enemy`
    unused(
      enemy,
      [
        'level',
        'resistance',
        'resistances',
        'defenseReduction',
        'defenseIgnore',
        'hp',
      ],
      at,
      problems,
      index
    )
    const all = num(
      enemy['resistance'],
      `${at}.resistance`,
      -200,
      200,
      10,
      false
    )
    const each = isObject(enemy['resistances']) ? enemy['resistances'] : {}
    for (const key of Object.keys(each))
      if (!(allElementWithPhyKeys as readonly string[]).includes(key))
        problem({
          level: 'warning',
          code: 'unused',
          at: `${at}.resistances.${key}`,
        })
    const enemyOverride: Team['enemyOverride'] = {
      enemyLevel: num(enemy['level'], `${at}.level`, 1, 200, 100),
      enemyDefRed_: num(
        enemy['defenseReduction'],
        `${at}.defenseReduction`,
        0,
        100,
        0,
        false
      ),
      enemyDefIgn_: num(
        enemy['defenseIgnore'],
        `${at}.defenseIgnore`,
        0,
        100,
        0,
        false
      ),
    }
    for (const ele of allElementWithPhyKeys)
      enemyOverride[`${ele}_enemyRes_`] = num(
        each[ele],
        `${at}.resistances.${ele}`,
        -200,
        200,
        all,
        false
      )
    team.enemy = { enemyOverride }
    if (enemy['hp'] !== undefined) {
      const hp = num(enemy['hp'], `${at}.hp`, 1, 1e12, 0)
      if (hp > 0) team.enemy.enemyHp = hp
    }
  }

  const buffs = raw['buffs']
  if (isObject(buffs)) {
    const out: NonNullable<TeamOpt['bonusStats']> = {}
    for (const [who, stats] of Object.entries(buffs)) {
      const at = `${base}.buffs.${who}`
      if (who !== 'team' && !members.some((m) => m.characterKey === who)) {
        problem({ level: 'warning', code: 'character', at, value: who })
        continue
      }
      if (!isObject(stats)) continue
      for (const [stat, value] of Object.entries(stats)) {
        if (!BUFF_STATS.has(stat)) {
          problem({
            level: 'warning',
            code: 'stat',
            at: `${at}.${stat}`,
            value: stat,
          })
          continue
        }
        const v = num(value, `${at}.${stat}`, -100_000, 100_000, 0, false)
        if (!v) continue
        const bucket = (out[who as CharacterKey | 'team'] ??= {})
        ;(bucket as Record<string, number>)[stat] = v
      }
    }
    if (Object.keys(out).length) team.buffs = out
  }

  const reference = raw['reference']
  if (isObject(reference)) {
    const at = `${base}.reference`
    const r: NonNullable<TeamLinkTeam['reference']> = {}
    for (const key of ['dps', 'damage', 'rotationSeconds'] as const)
      if (reference[key] !== undefined)
        r[key] = num(reference[key], `${at}.${key}`, 0, 1e15, 0, false)
    const note = text(reference['note'], 200)
    if (note) r.note = note
    if (Object.keys(r).length) team.reference = r
  }
  return {
    ...(problems.some((p) => p.level === 'error') ? {} : { team }),
    name: team.name,
    problems,
  }
}

function readBuild(
  characterKey: CharacterKey,
  m: Record<string, unknown>,
  at: string,
  problem: (p: Omit<TeamLinkProblem, 'team'>) => void,
  num: (
    value: unknown,
    at: string,
    min: number,
    max: number,
    fallback: number,
    integer?: boolean
  ) => number
): TeamLinkBuild | undefined {
  const weaponType = getCharWeaponType(characterKey)
  const rawWeapon = isObject(m['weapon']) ? m['weapon'] : undefined
  let weaponKey = rawWeapon?.['key'] as WeaponKey | undefined
  if (rawWeapon) {
    if (!allWeaponKeys.includes(weaponKey as WeaponKey)) {
      problem({
        level: 'error',
        code: 'weapon',
        at: `${at}.weapon.key`,
        value: String(rawWeapon['key']),
      })
      return undefined
    }
    if (getWeaponStat(weaponKey!).weaponType !== weaponType) {
      problem({
        level: 'error',
        code: 'weaponType',
        at: `${at}.weapon.key`,
        value: weaponKey,
      })
      return undefined
    }
  } else weaponKey = defaultInitialWeaponKey(weaponType)
  const rarity = getWeaponStat(weaponKey!).rarity
  const { level, ascension } = validateWeaponLevelAsc(
    num(rawWeapon?.['level'], `${at}.weapon.level`, 1, 90, 90),
    num(
      rawWeapon?.['ascension'],
      `${at}.weapon.ascension`,
      0,
      6,
      0
    ) as AscensionKey,
    rarity
  )
  const refinement = num(
    rawWeapon?.['refinement'],
    `${at}.weapon.refinement`,
    1,
    5,
    1
  ) as RefinementKey

  const arts = isObject(m['artifacts']) ? m['artifacts'] : {}
  const sets: TeamLinkBuild['sets'] = {}
  let pieces = 0
  for (const [key, count] of Object.entries(
    isObject(arts['sets']) ? arts['sets'] : {}
  )) {
    if (!(allArtifactSetKeys as readonly string[]).includes(key)) {
      problem({
        level: 'error',
        code: 'set',
        at: `${at}.artifacts.sets.${key}`,
        value: key,
      })
      return undefined
    }
    if (count !== 2 && count !== 4) {
      problem({
        level: 'error',
        code: 'setCount',
        at: `${at}.artifacts.sets.${key}`,
        value: String(count),
      })
      return undefined
    }
    sets[key] = count
    pieces += count
  }
  if (pieces > 5) {
    problem({
      level: 'error',
      code: 'setCount',
      at: `${at}.artifacts.sets`,
      value: String(pieces),
    })
    return undefined
  }
  const rawMains = isObject(arts['mainStats']) ? arts['mainStats'] : {}
  const mainStats = {} as TeamLinkBuild['mainStats']
  for (const slot of ['sands', 'goblet', 'circlet'] as const) {
    const key = rawMains[slot] ?? 'atk_'
    if (!(artSlotMainKeys[slot] as readonly string[]).includes(key as string)) {
      problem({
        level: 'error',
        code: 'mainStat',
        at: `${at}.artifacts.mainStats.${slot}`,
        value: String(key),
      })
      return undefined
    }
    mainStats[slot] = key as MainStatKey
  }
  const rawSubs = isObject(arts['substats']) ? arts['substats'] : {}
  const substats = objKeyMap(allSubstatKeys, () => 0)
  for (const [key, value] of Object.entries(rawSubs)) {
    if (!(allSubstatKeys as readonly string[]).includes(key)) {
      problem({
        level: 'error',
        code: 'stat',
        at: `${at}.artifacts.substats.${key}`,
        value: key,
      })
      return undefined
    }
    substats[key as SubstatKey] = num(
      value,
      `${at}.artifacts.substats.${key}`,
      0,
      100_000,
      0,
      false
    )
  }
  const rawPieces = isObject(arts['pieces']) ? arts['pieces'] : {}
  const piecesOut = objKeyMap(SLOTS, (slot) => {
    const p = isObject(rawPieces[slot]) ? rawPieces[slot] : {}
    const r = num(p['rarity'], `${at}.artifacts.pieces.${slot}.rarity`, 3, 5, 5)
    const rarity = r as ArtifactRarity
    return {
      rarity,
      level: num(
        p['level'],
        `${at}.artifacts.pieces.${slot}.level`,
        0,
        artMaxLevel[rarity],
        artMaxLevel[rarity]
      ),
    }
  })
  return {
    weapon: { key: weaponKey!, level, ascension, refinement },
    sets,
    mainStats,
    substats,
    pieces: piecesOut,
  }
}

/** A member's build from a link as a theorycraft build (its name and description aside) */
export function teamLinkBuildTc(
  member: TeamLinkMember,
  build: TeamLinkBuild
): Omit<BuildTc, 'name' | 'description'> {
  const base = initCharTC(member.characterKey, build.weapon.key)
  const slot = (slotKey: ArtifactSlotKey, statKey: MainStatKey) => ({
    ...build.pieces[slotKey],
    statKey,
  })
  return {
    ...base,
    character: {
      level: member.level,
      ascension: member.ascension,
      constellation: member.constellation,
      talent: { ...member.talent },
    },
    weapon: { ...build.weapon },
    artifact: {
      slots: {
        flower: slot('flower', 'hp'),
        plume: slot('plume', 'atk'),
        sands: slot('sands', build.mainStats.sands),
        goblet: slot('goblet', build.mainStats.goblet),
        circlet: slot('circlet', build.mainStats.circlet),
      },
      substats: { type: 'mid', rarity: 5, stats: { ...build.substats } },
      sets: { ...build.sets } as BuildTc['artifact']['sets'],
    },
  }
}

const ER_FILTER = JSON.stringify(['basic', 'enerRech_'])

/**
 * A new team from a link's team: each member a loadout of its own, on the link's build as a
 * theorycraft build (else the player's own gear), its Energy Recharge requirement, the enemy and
 * extra buffs; KQM's settings take the constellations, talents, ER, enemy and buffs too. The
 * rotation is not played here (the page does it): `rotation` stays for it. Returns the team's id.
 */
export function createTeamFromLink(
  database: ArtCharDatabase,
  team: TeamLinkTeam,
  { buildName, source }: { buildName: string; source?: TeamLink['source'] }
): string {
  const added = team.members
    .map((m) => m.characterKey)
    .filter((ck) => !database.chars.get(ck))
  const loadoutData: LoadoutDatum[] = team.members.map((member) => {
    const ck = member.characterKey
    database.chars.getWithInitWeapon(ck)
    const teamCharId = database.teamChars.new(ck)
    if (member.minEnergyRecharge !== undefined) {
      const optConfigId = database.teamChars.get(teamCharId)!.optConfigId
      const statFilters =
        database.optConfigs.get(optConfigId)?.statFilters ?? {}
      database.optConfigs.set(optConfigId, {
        statFilters: {
          ...statFilters,
          [ER_FILTER]: [{ value: member.minEnergyRecharge, disabled: false }],
        },
      })
    }
    const loadout: LoadoutDatum = {
      teamCharId,
      buildType: 'equipped',
      buildId: '',
      buildTcId: '',
      compare: false,
      compareType: 'equipped',
      compareBuildId: '',
      compareBuildTcId: '',
    }
    if (!member.build) return loadout
    const buildTcId = database.buildTcs.new({
      ...teamLinkBuildTc(member, member.build),
      name: buildName,
      description: [source?.name, team.url ?? source?.url]
        .filter(Boolean)
        .join(' · '),
      srcTeamCharId: teamCharId,
    } as BuildTc)
    return buildTcId ? { ...loadout, buildType: 'tc', buildTcId } : loadout
  })
  const keys = team.members.map((m) => m.characterKey)
  const talents = new Set(
    team.members.flatMap((m) => [m.talent.auto, m.talent.skill, m.talent.burst])
  )
  const [talent] = [...talents]
  const energyRecharge = Object.fromEntries(
    team.members.flatMap((m) =>
      m.minEnergyRecharge !== undefined
        ? [[m.characterKey, m.minEnergyRecharge]]
        : []
    )
  )
  const teamOpt: TeamOpt = {
    ...initTeamOpt(),
    ...(team.buffs ? { bonusStats: structuredClone(team.buffs) } : {}),
    kqm: {
      ...defaultTeamOptKqm,
      constellations: Object.fromEntries(
        team.members.map((m) => [m.characterKey, m.constellation])
      ),
      ...(talents.size === 1 && (talent === 9 || talent === 10)
        ? { talents: talent }
        : {}),
      ...(Object.keys(energyRecharge).length
        ? { energySource: 'manual' as const, energyRecharge }
        : {}),
      ...(team.enemy
        ? {
            enemy: {
              enemyOverride: { ...team.enemy.enemyOverride },
              ...(team.enemy.enemyHp ? { enemyHp: team.enemy.enemyHp } : {}),
            },
          }
        : {}),
      ...(team.buffs ? { bonusStats: structuredClone(team.buffs) } : {}),
    },
  }
  const description = [
    team.description,
    [source?.name, team.url ?? source?.url].filter(Boolean).join(' · '),
  ]
    .filter(Boolean)
    .join('\n\n')
  const importedFrom: NonNullable<Team['importedFrom']> = {}
  if (source?.name) importedFrom.name = source.name
  if (team.url ?? source?.url) importedFrom.url = team.url ?? source?.url
  if (added.length) importedFrom.added = added
  return database.teams.new({
    name: team.name,
    description,
    importedFrom,
    loadoutData,
    ...(team.enemy
      ? {
          enemyOverride: { ...team.enemy.enemyOverride },
          ...(team.enemy.enemyHp ? { enemyHp: team.enemy.enemyHp } : {}),
        }
      : {}),
    teamOpt: { ...teamOpt, onField: keys[0] },
    lastEdit: Date.now(),
  })
}

/**
 * Whether the player has the character, for an imported team: they had it before the import (it
 * did not add it), or have equipped artifacts on it since
 */
function hasOwnCharacter(
  database: ArtCharDatabase,
  characterKey: CharacterKey,
  added: readonly CharacterKey[]
): boolean {
  const char = database.chars.get(characterKey)
  return (
    !!char &&
    (!added.includes(characterKey) ||
      Object.values(char.equippedArtifacts).some(Boolean))
  )
}

/**
 * An imported team's members that came with a build: still on it (as a theorycraft build), those
 * the player has (`switchable`, to their own gear) or not (`missing`, kept on it), and those moved
 * to their own gear (`onOwn`, which can go back). Empty for a team that was not imported.
 */
export function teamLinkOwnGear(
  database: ArtCharDatabase,
  teamId: string
): {
  switchable: CharacterKey[]
  missing: CharacterKey[]
  onOwn: CharacterKey[]
} {
  const team = database.teams.get(teamId)
  const out = {
    switchable: [] as CharacterKey[],
    missing: [] as CharacterKey[],
    onOwn: [] as CharacterKey[],
  }
  if (!team?.importedFrom) return out
  for (const datum of team.loadoutData) {
    if (!datum?.buildTcId || !database.buildTcs.get(datum.buildTcId)) continue
    const characterKey = database.teamChars.get(datum.teamCharId)?.key
    if (!characterKey) continue
    if (datum.buildType !== 'tc') {
      if (datum.buildType === 'equipped') out.onOwn.push(characterKey)
    } else if (
      hasOwnCharacter(database, characterKey, team.importedFrom.added ?? [])
    )
      out.switchable.push(characterKey)
    else out.missing.push(characterKey)
  }
  return out
}

/**
 * Moves an imported team's members the player has onto their own characters, weapons and
 * artifacts (equipped), so Optimize team searches their pieces. The imported builds stay in each
 * member's theorycraft builds, to switch back to. Returns who was moved.
 */
export function teamLinkUseOwnGear(
  database: ArtCharDatabase,
  teamId: string
): CharacterKey[] {
  const { switchable } = teamLinkOwnGear(database, teamId)
  if (!switchable.length) return []
  database.teams.set(teamId, (team) => {
    team.loadoutData = team.loadoutData.map((datum) => {
      const key = datum && database.teamChars.get(datum.teamCharId)?.key
      return datum && key && switchable.includes(key)
        ? { ...datum, buildType: 'equipped' }
        : datum
    })
  })
  return switchable
}

/** Moves an imported team's members on their own gear back to the imported builds; who moved */
export function teamLinkUseImported(
  database: ArtCharDatabase,
  teamId: string
): CharacterKey[] {
  const { onOwn } = teamLinkOwnGear(database, teamId)
  if (!onOwn.length) return []
  database.teams.set(teamId, (team) => {
    team.loadoutData = team.loadoutData.map((datum) => {
      const key = datum && database.teamChars.get(datum.teamCharId)?.key
      return datum && key && onOwn.includes(key)
        ? { ...datum, buildType: 'tc' }
        : datum
    })
  })
  return onOwn
}
