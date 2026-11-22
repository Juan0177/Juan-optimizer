// @vitest-environment jsdom
/**
 * KQM versions: a team of its own with members swapped, compared with its original
 * under the original's KQM settings (the user's ask: apples to apples).
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import {
  ArtCharDatabase,
  defaultTeamOptKqm,
  initTeamOpt,
} from '@genshin-optimizer/gi/db'
import { mainPart, supportPart, teamOptMembers } from '@genshin-optimizer/gi/ui'
import type { i18n } from 'i18next'
import { describe, expect, it } from 'vitest'
import {
  createVersion,
  KQM_SHARED,
  kqmSharedKey,
  makeOriginal,
  pickVersionMember,
  pushVersionSettings,
  syncVersion,
  versionRoot,
  versionsOf,
} from './kqmVersions'
import { kqmRotationId, writtenRotationOf } from './RotationWriter'

const MEMBERS: CharacterKey[] = ['Mavuika', 'Bennett', 'Citlali', 'Rosaria']
const TEXT =
  'Mavuika E -> Bennett E Q -> Citlali E Q -> Rosaria E N1 Q -> Mavuika Q 6[C2D] -> Mavuika'
// (names as the page gives them: the keys here)
const names = {
  i18n: {
    t: (key: string, options?: { defaultValue?: string } & object) =>
      options?.defaultValue
        ? options.defaultValue.replace(
            /{{(\w+)}}/g,
            (_, k: string) => (options as Record<string, string>)[k] ?? ''
          )
        : (key.split(':').pop() ?? key),
  } as unknown as i18n,
  gender: 'F' as const,
}

function setup() {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  const ids = MEMBERS.map((k) => database.teamChars.new(k))
  const teamId = database.teams.new({
    name: 'Melt',
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
  })
  const teamOpt = initTeamOpt()
  teamOpt.kqm = {
    ...defaultTeamOptKqm,
    talents: 9,
    rolls: 25,
    constellations: { Bennett: 6, Citlali: 2 },
    excludedSets: ['GladiatorsFinale'],
    energySource: 'calculator',
    energyRecharge: { Bennett: 220 },
    energyRotation: 'old',
    attacks: {},
  }
  database.teams.set(teamId, { teamOpt })
  for (const rid of [teamId, kqmRotationId(teamId)]) {
    database.teams.setRotationField(rid, 'Text', TEXT)
    database.teams.setRotationField(rid, 'Timing', '{"edits":{},"rotations":4}')
  }
  return { database, teamId }
}
const keysOf = (database: ArtCharDatabase, teamId: string) =>
  teamOptMembers(database, teamId).map((m) => m.characterKey)

describe('KQM versions', () => {
  it('a version is a team of its own: a member swapped in its slot, its part played in its place', () => {
    const { database, teamId } = setup()
    const id = createVersion(
      database,
      teamId,
      [{ from: 'Rosaria', to: 'KaedeharaKazuha' }],
      names
    )
    expect(id).toBeTruthy()
    const team = database.teams.get(id)!
    expect(team.versionOf).toBe(teamId)
    expect(team.name).toBe('Mavuika | Bennett | Citlali | KaedeharaKazuha')
    expect(keysOf(database, id)).toEqual([
      'Mavuika',
      'Bennett',
      'Citlali',
      'KaedeharaKazuha',
    ])
    // (the original is untouched)
    expect(keysOf(database, teamId)).toEqual(MEMBERS)
    expect(writtenRotationOf(database, kqmRotationId(teamId)).text).toBe(TEXT)
    const part = supportPart('KaedeharaKazuha')
    expect(writtenRotationOf(database, kqmRotationId(id)).text).toBe(
      `Mavuika E -> Bennett E Q -> Citlali E Q -> KaedeharaKazuha ${part} -> Mavuika Q 6[C2D] -> Mavuika`
    )
    // its rotation is used on both tabs: the newcomer's attacks are there, the one gone's not
    const kqm = team.teamOpt!.kqm!
    expect(kqm.attacks?.KaedeharaKazuha?.length).toBeGreaterThan(0)
    expect(kqm.attacks?.Rosaria).toBeUndefined()
    expect(team.teamOpt!.attacks.KaedeharaKazuha?.length).toBeGreaterThan(0)
    // the shared settings are the original's; its ER targets are worked out for its own rotation
    for (const key of KQM_SHARED)
      expect(kqm[key]).toEqual(database.teams.get(teamId)!.teamOpt!.kqm![key])
    expect(kqm.energyRecharge).toBeUndefined()
    expect(kqm.energyRotation).toBeUndefined()
    // (it is listed with its original, and its original is found from it)
    expect(versionsOf(database, teamId)).toEqual([id])
    expect(versionRoot(database, id)).toBe(teamId)
  })

  it('two members at once, and a version of a version is the original’s', () => {
    const { database, teamId } = setup()
    const first = createVersion(
      database,
      teamId,
      [{ from: 'Rosaria', to: 'KaedeharaKazuha' }],
      names
    )
    const second = createVersion(
      database,
      first,
      [
        { from: 'Rosaria', to: 'Xilonen' },
        { from: 'Bennett', to: 'Xiangling' },
      ],
      names
    )
    expect(database.teams.get(second)?.versionOf).toBe(teamId)
    expect(keysOf(database, second)).toEqual([
      'Mavuika',
      'Xiangling',
      'Citlali',
      'Xilonen',
    ])
    expect(versionsOf(database, teamId)).toEqual([first, second])
  })

  it('refuses swaps that do not fit the team', () => {
    const { database, teamId } = setup()
    const tries: { from: CharacterKey; to: CharacterKey }[][] = [
      [],
      [{ from: 'Xilonen', to: 'Furina' }],
      [{ from: 'Rosaria', to: 'Bennett' }],
      [
        { from: 'Rosaria', to: 'Furina' },
        { from: 'Rosaria', to: 'Xilonen' },
      ],
      [
        { from: 'Rosaria', to: 'Furina' },
        { from: 'Bennett', to: 'Furina' },
      ],
    ]
    for (const swaps of tries)
      expect(createVersion(database, teamId, swaps, names)).toBe('')
    expect(versionsOf(database, teamId)).toEqual([])
  })

  it('follows the original’s shared settings and timing, never its own rotation', () => {
    const { database, teamId } = setup()
    const id = createVersion(
      database,
      teamId,
      [{ from: 'Rosaria', to: 'Xilonen' }],
      names
    )
    expect(syncVersion(database, id, names)).toBe(false)
    const before = kqmSharedKey(database, teamId)
    database.teams.set(teamId, (team) => {
      team.teamOpt!.kqm!.talents = 10
      team.teamOpt!.kqm!.constellations = { Bennett: 6, Citlali: 0 }
    })
    database.teams.setRotationField(
      kqmRotationId(teamId),
      'Timing',
      '{"edits":{},"rotations":6}'
    )
    expect(kqmSharedKey(database, teamId)).not.toBe(before)
    expect(syncVersion(database, id, names)).toBe(true)
    const kqm = database.teams.get(id)!.teamOpt!.kqm!
    expect(kqm.talents).toBe(10)
    expect(kqm.constellations).toEqual({ Bennett: 6, Citlali: 0 })
    expect(writtenRotationOf(database, kqmRotationId(id)).timing).toBe(
      '{"edits":{},"rotations":6}'
    )
    expect(syncVersion(database, id, names)).toBe(false)
    // (its own rotation changing is not the shared settings changing)
    const shared = kqmSharedKey(database, id)
    database.teams.setRotationField(kqmRotationId(id), 'Text', 'Xilonen E')
    expect(kqmSharedKey(database, id)).toBe(shared)
  })

  it('settings changed on a version are its original’s, so the whole family’s', () => {
    const { database, teamId } = setup()
    const first = createVersion(
      database,
      teamId,
      [{ from: 'Rosaria', to: 'Xilonen' }],
      names
    )
    const second = createVersion(
      database,
      teamId,
      [{ from: 'Rosaria', to: 'KaedeharaKazuha' }],
      names
    )
    expect(pushVersionSettings(database, first, names)).toBe(false)
    database.teams.set(first, (team) => {
      team.teamOpt!.kqm!.rolls = 40
      // (a newcomer's own setting: kept for it in the family's)
      team.teamOpt!.kqm!.constellations = {
        ...team.teamOpt!.kqm!.constellations,
        Xilonen: 2,
      }
    })
    expect(pushVersionSettings(database, first, names)).toBe(true)
    expect(database.teams.get(teamId)!.teamOpt!.kqm!.rolls).toBe(40)
    expect(
      database.teams.get(teamId)!.teamOpt!.kqm!.constellations?.Xilonen
    ).toBe(2)
    expect(syncVersion(database, second, names)).toBe(true)
    expect(database.teams.get(second)!.teamOpt!.kqm!.rolls).toBe(40)
    // (an original's own changes are not pushed anywhere)
    expect(pushVersionSettings(database, teamId, names)).toBe(false)
  })

  it('takes the rotation chosen for it, on both tabs', () => {
    const { database, teamId } = setup()
    const text =
      'Mavuika E -> Bennett E Q -> Citlali E Q -> Xilonen E N2 -> Mavuika Q 6[C2D] -> Mavuika'
    const id = createVersion(
      database,
      teamId,
      [{ from: 'Rosaria', to: 'Xilonen' }],
      names,
      { text, opener: 'Xilonen E' }
    )
    for (const rid of [id, kqmRotationId(id)]) {
      expect(writtenRotationOf(database, rid).text).toBe(text)
      expect(writtenRotationOf(database, rid).opener).toBe('Xilonen E')
    }
    expect(
      database.teams.get(id)!.teamOpt!.kqm!.attacks?.Xilonen?.length
    ).toBeGreaterThan(0)
  })

  it("gives one swapped in for the main DPS that character's own main part", () => {
    const { database, teamId } = setup()
    const id = createVersion(
      database,
      teamId,
      [{ from: 'Mavuika', to: 'Varesa' }],
      names
    )
    const part = mainPart('Varesa')
    expect(part).toBeTruthy()
    expect(writtenRotationOf(database, kqmRotationId(id)).text).toBe(
      `Bennett E Q -> Citlali E Q -> Rosaria E N1 Q -> Varesa ${part} -> Bennett`
    )
  })

  it('swaps as many members as asked, all four too', () => {
    const { database, teamId } = setup()
    const id = createVersion(
      database,
      teamId,
      [
        { from: 'Mavuika', to: 'Arlecchino' },
        { from: 'Bennett', to: 'Xiangling' },
        { from: 'Citlali', to: 'Furina' },
        { from: 'Rosaria', to: 'Xilonen' },
      ],
      names
    )
    expect(keysOf(database, id)).toEqual([
      'Arlecchino',
      'Xiangling',
      'Furina',
      'Xilonen',
    ])
    expect(database.teams.get(id)?.versionOf).toBe(teamId)
  })

  it('a version with other constellations only: its own, the rest shared', () => {
    const { database, teamId } = setup()
    const id = createVersion(database, teamId, [], names, undefined, {
      Bennett: 4,
      // (the family's already: not its own)
      Citlali: 2,
    })
    expect(id).toBeTruthy()
    const team = database.teams.get(id)!
    expect(team.name).toBe('Mavuika | Bennett C4 | Citlali | Rosaria')
    expect(team.versionCons).toEqual({ Bennett: 4 })
    expect(keysOf(database, id)).toEqual(MEMBERS)
    expect(team.teamOpt!.kqm!.constellations).toEqual({
      Bennett: 4,
      Citlali: 2,
    })
    // (nothing changed at all: no version)
    expect(
      createVersion(database, teamId, [], names, undefined, { Bennett: 6 })
    ).toBe('')
    // the family's change reaches it, its own stays
    database.teams.set(teamId, (t) => {
      t.teamOpt!.kqm!.constellations = { Bennett: 6, Citlali: 0 }
    })
    expect(syncVersion(database, id, names)).toBe(true)
    expect(database.teams.get(id)!.teamOpt!.kqm!.constellations).toEqual({
      Bennett: 4,
      Citlali: 0,
    })
    // changed on its page: its own stays its own, the rest goes to the family
    database.teams.set(id, (t) => {
      t.teamOpt!.kqm!.constellations = { Bennett: 5, Citlali: 1 }
    })
    expect(pushVersionSettings(database, id, names)).toBe(true)
    expect(database.teams.get(id)!.versionCons).toEqual({ Bennett: 5 })
    expect(database.teams.get(teamId)!.teamOpt!.kqm!.constellations).toEqual({
      Bennett: 6,
      Citlali: 1,
    })
    // (its run depends on its own constellations too)
    const key = kqmSharedKey(database, id)
    database.teams.set(id, (t) => {
      t.versionCons = { Bennett: 3 }
    })
    expect(kqmSharedKey(database, id)).not.toBe(key)
  })

  it('another team made the original: every team keeps what it plays at, its results still hold', () => {
    const { database, teamId } = setup()
    const swapped = createVersion(
      database,
      teamId,
      [{ from: 'Rosaria', to: 'Xilonen' }],
      names
    )
    const lowered = createVersion(database, teamId, [], names, undefined, {
      Bennett: 4,
    })
    const ids = [teamId, swapped, lowered]
    const before = ids.map((id) => kqmSharedKey(database, id))
    expect(makeOriginal(database, lowered, names)).toBe(true)
    expect(database.teams.get(lowered)?.versionOf).toBeUndefined()
    expect(database.teams.get(lowered)?.versionCons).toBeUndefined()
    expect(database.teams.get(teamId)?.versionOf).toBe(lowered)
    expect(database.teams.get(swapped)?.versionOf).toBe(lowered)
    // (the old original and the other version keep their Bennett C6, now their own)
    expect(database.teams.get(teamId)?.versionCons).toEqual({ Bennett: 6 })
    expect(database.teams.get(swapped)?.versionCons).toEqual({ Bennett: 6 })
    expect(versionsOf(database, lowered).sort()).toEqual(
      [teamId, swapped].sort()
    )
    expect(ids.map((id) => kqmSharedKey(database, id))).toEqual(before)
    // (the original itself: nothing to do)
    expect(makeOriginal(database, lowered, names)).toBe(false)
  })

  it('a member at its default stays there when the new original sets it', () => {
    const { database, teamId } = setup()
    // (Mavuika: no constellation set in the family, her default C0)
    const raised = createVersion(database, teamId, [], names, undefined, {
      Mavuika: 1,
    })
    const before = kqmSharedKey(database, teamId)
    makeOriginal(database, raised, names)
    expect(database.teams.get(teamId)?.versionCons).toEqual({ Mavuika: 0 })
    expect(kqmSharedKey(database, teamId)).toBe(before)
    expect(syncVersion(database, teamId, names)).toBe(true)
    expect(
      database.teams.get(teamId)!.teamOpt!.kqm!.constellations?.Mavuika
    ).toBe(0)
  })

  it('a version made the original takes the family’s settings it had not followed yet', () => {
    const { database, teamId } = setup()
    const id = createVersion(
      database,
      teamId,
      [{ from: 'Rosaria', to: 'Xilonen' }],
      names
    )
    database.teams.set(teamId, (team) => {
      team.teamOpt!.kqm!.talents = 10
    })
    database.teams.setRotationField(
      kqmRotationId(teamId),
      'Timing',
      '{"edits":{},"rotations":6}'
    )
    const before = kqmSharedKey(database, teamId)
    makeOriginal(database, id, names)
    expect(database.teams.get(id)!.teamOpt!.kqm!.talents).toBe(10)
    expect(writtenRotationOf(database, kqmRotationId(id)).timing).toBe(
      '{"edits":{},"rotations":6}'
    )
    expect(kqmSharedKey(database, teamId)).toBe(before)
  })

  it('Duplicate: a copy of a version, its team, switches and rotations, changed as asked', () => {
    const { database, teamId } = setup()
    const id = createVersion(
      database,
      teamId,
      [{ from: 'Rosaria', to: 'Xilonen' }],
      names,
      undefined,
      { Bennett: 5 }
    )
    database.teams.set(id, (team) => {
      team.teamOpt!.kqm!.passives = {
        ...team.teamOpt!.kqm!.passives,
        Xilonen: { FavoniusSword: { passive: 'on' } },
      }
    })
    const kqmText = 'Xilonen E -> Bennett E Q -> Mavuika E Q N1'
    database.teams.setRotationField(kqmRotationId(id), 'Text', kqmText)
    const copy = createVersion(
      database,
      teamId,
      [{ from: 'Rosaria', to: 'Xilonen' }],
      names,
      undefined,
      { Bennett: 5 },
      undefined,
      id
    )
    expect(copy).not.toBe('')
    expect(copy).not.toBe(id)
    expect(database.teams.get(copy)?.versionOf).toBe(teamId)
    expect(keysOf(database, copy)).toEqual(keysOf(database, id))
    expect(database.teams.get(copy)?.versionCons).toEqual({ Bennett: 5 })
    // (a switch set by hand is kept; the rest follow its rotation, played again)
    expect(
      database.teams.get(copy)?.teamOpt?.kqm?.passives?.['Xilonen']?.[
        'FavoniusSword'
      ]
    ).toEqual({ passive: 'on' })
    expect(writtenRotationOf(database, kqmRotationId(copy)).text).toBe(kqmText)
    expect(writtenRotationOf(database, copy).text).toBe(
      writtenRotationOf(database, id).text
    )
    // (another member for one of its slots, its own constellation dropped)
    const other = createVersion(
      database,
      teamId,
      [
        { from: 'Rosaria', to: 'Xilonen' },
        { from: 'Citlali', to: 'Chevreuse' },
      ],
      names,
      { text: 'Chevreuse E', opener: '' },
      {},
      undefined,
      id
    )
    expect(keysOf(database, other)).toEqual([
      'Mavuika',
      'Bennett',
      'Chevreuse',
      'Xilonen',
    ])
    expect(database.teams.get(other)?.versionCons).toBeUndefined()
    expect(database.teams.get(other)?.teamOpt?.kqm?.constellations).toEqual({
      Bennett: 6,
      Citlali: 2,
    })
    expect(writtenRotationOf(database, kqmRotationId(other)).text).toBe(
      'Chevreuse E'
    )
  })

  it('Duplicate of the original: the same team for another rotation', () => {
    const { database, teamId } = setup()
    // (without a copy, no change makes no version)
    expect(createVersion(database, teamId, [], names)).toBe('')
    const copy = createVersion(
      database,
      teamId,
      [],
      names,
      { text: 'Mavuika E Q', opener: '' },
      {},
      'Melt, short',
      teamId
    )
    expect(database.teams.get(copy)?.versionOf).toBe(teamId)
    expect(database.teams.get(copy)?.name).toBe('Melt, short')
    expect(keysOf(database, copy)).toEqual(MEMBERS)
    expect(writtenRotationOf(database, kqmRotationId(copy)).text).toBe(
      'Mavuika E Q'
    )
    expect(kqmSharedKey(database, copy)).toBe(kqmSharedKey(database, teamId))
  })

  it('a version’s signature weapons: its own, in its name and its freshness, never its original’s', () => {
    const { database, teamId } = setup()
    // (Mavuika's A Thousand Blazing Suns at R1; Citlali's Starcaller's Watch left out)
    const id = createVersion(
      database,
      teamId,
      [],
      names,
      undefined,
      {},
      undefined,
      undefined,
      { Mavuika: 1, Citlali: 0, Rosaria: 3 }
    )
    expect(id).not.toBe('')
    expect(database.teams.get(id)?.teamOpt?.kqm?.signature).toEqual({
      Mavuika: 1,
      Citlali: 0,
    })
    expect(database.teams.get(id)?.name).toBe(
      'Mavuika R1 | Bennett | Citlali no sig | Rosaria'
    )
    expect(kqmSharedKey(database, id)).not.toBe(kqmSharedKey(database, teamId))
    // (the family's settings follow; its own signature choices stay its own)
    database.teams.set(teamId, (team) => {
      team.teamOpt!.kqm!.talents = 10
    })
    syncVersion(database, id, names)
    expect(database.teams.get(id)?.teamOpt?.kqm?.signature).toEqual({
      Mavuika: 1,
      Citlali: 0,
    })
    pushVersionSettings(database, id, names)
    expect(database.teams.get(teamId)?.teamOpt?.kqm?.signature).toBeUndefined()
  })
})

describe('picking a member in the New version and Duplicate windows', () => {
  const root: CharacterKey[] = ['Anastasya', 'Mitya', 'Odette', 'Danica']
  const yae = [{ from: 'Mitya', to: 'YaeMiko' }] as const
  const pick = (from: CharacterKey, to: CharacterKey) =>
    pickVersionMember(root, yae, from, to)

  it('one the copied version swapped out goes in any slot, the swapped-in one moving to its place', () => {
    expect(pick('Odette', 'Mitya')).toEqual([{ from: 'Odette', to: 'YaeMiko' }])
    expect(pick('Danica', 'Mitya')).toEqual([{ from: 'Danica', to: 'YaeMiko' }])
  })

  it('the original member picked for its own slot undoes the swap', () => {
    expect(pick('Mitya', 'Mitya')).toEqual([])
  })

  it('one shown in another slot moves there, leaving that slot to its original member', () => {
    expect(pick('Danica', 'YaeMiko')).toEqual([
      { from: 'Danica', to: 'YaeMiko' },
    ])
  })

  it('a new member takes the slot, the other swaps kept', () => {
    expect(pick('Odette', 'Furina')).toEqual([
      { from: 'Mitya', to: 'YaeMiko' },
      { from: 'Odette', to: 'Furina' },
    ])
    expect(pick('Mitya', 'Furina')).toEqual([{ from: 'Mitya', to: 'Furina' }])
  })

  it('nothing changes for one already in the team at its own slot', () => {
    expect(pick('Odette', 'Danica')).toBeUndefined()
    expect(pick('Mitya', 'YaeMiko')).toBeUndefined()
    expect(pickVersionMember(root, [], 'Odette', 'Odette')).toBeUndefined()
  })

  it('with several swaps, each one swapped in stays where it was put when it can', () => {
    const swaps = [
      { from: 'Anastasya', to: 'Furina' },
      { from: 'Odette', to: 'YaeMiko' },
    ] as const
    expect(pickVersionMember(root, swaps, 'Danica', 'Anastasya')).toEqual([
      { from: 'Odette', to: 'YaeMiko' },
      { from: 'Danica', to: 'Furina' },
    ])
  })

  it('what it makes is the team shown, each member keeping a loadout the teams have', () => {
    const { database, teamId } = setup()
    const xiangling = [{ from: 'Bennett', to: 'Xiangling' }] as const
    const copied = createVersion(database, teamId, xiangling, names)
    const swaps = pickVersionMember(MEMBERS, xiangling, 'Citlali', 'Bennett')!
    const id = createVersion(
      database,
      teamId,
      swaps,
      names,
      undefined,
      {},
      undefined,
      copied
    )
    expect(keysOf(database, id)).toEqual([
      'Mavuika',
      'Bennett',
      'Xiangling',
      'Rosaria',
    ])
    const charOf = (team: string, k: CharacterKey) =>
      teamOptMembers(database, team).find((m) => m.characterKey === k)
        ?.teamCharId
    expect(charOf(id, 'Bennett')).toBe(charOf(teamId, 'Bennett'))
    expect(charOf(id, 'Xiangling')).toBe(charOf(copied, 'Xiangling'))
  })
})
