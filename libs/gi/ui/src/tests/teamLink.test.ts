import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { deflateSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { TeamLinkJson } from '../'
import {
  createTeamFromLink,
  decodeTeamLink,
  encodeTeamLink,
  readTeamLink,
  teamLinkFromText,
  teamLinkOwnGear,
  teamLinkUrl,
  teamLinkUseImported,
  teamLinkUseOwnGear,
  teamOptMembers,
} from '../'

const link = (): TeamLinkJson => ({
  format: 'stellar-team',
  version: 1,
  source: { name: 'Example calcs', url: 'https://example.com/raiden' },
  teams: [
    {
      name: 'Raiden National',
      url: 'https://example.com/raiden#national',
      members: [
        {
          character: 'RaidenShogun',
          constellation: 2,
          talents: { auto: 9, skill: 10, burst: 10 },
          weapon: { key: 'TheCatch', refinement: 5 },
          artifacts: {
            sets: { EmblemOfSeveredFate: 4 },
            mainStats: {
              sands: 'enerRech_',
              goblet: 'electro_dmg_',
              circlet: 'critRate_',
            },
            substats: { critRate_: 19.9, critDMG_: 46.2, enerRech_: 22 },
          },
          minEnergyRecharge: 250,
        },
        { character: 'Bennett', constellation: 6 },
        {
          character: 'Xingqiu',
          weapon: { key: 'SacrificialSword', refinement: 3 },
          artifacts: {
            sets: { EmblemOfSeveredFate: 2, NoblesseOblige: 2 },
            pieces: { flower: { rarity: 4, level: 16 } },
          },
        },
        { character: 'Xiangling' },
      ],
      rotation: {
        text: 'Xingqiu E D Q N1 -> Bennett Q N1 E -> Xiangling N1 Q N1 E D -> Raiden Q N4 E N4 -> Xingqiu',
        ping: 60,
      },
      enemy: { level: 95, resistance: 10, resistances: { electro: 50 } },
      buffs: { team: { atk_: 20 }, RaidenShogun: { critRate_: 15 } },
      reference: { dps: 41234, rotationSeconds: 21 },
    },
  ],
})

describe('team links', () => {
  it('packs a team into a link and reads it back, compressed or plain', () => {
    const data = link()
    const payload = encodeTeamLink(data)
    expect(payload.startsWith('z.')).toBe(true)
    expect(payload).toMatch(/^z\.[A-Za-z0-9_-]+$/)
    expect(decodeTeamLink(payload)).toEqual(data)
    const plain = `j.${btoa(JSON.stringify(data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
    expect(decodeTeamLink(plain)).toEqual(data)
    // the whole link pasted, or the JSON
    const url = teamLinkUrl('https://stellaroptimizer.com/', payload)
    expect(url).toBe(
      `https://stellaroptimizer.com/#/teams/import?data=${payload}`
    )
    expect(teamLinkFromText(url)).toEqual(data)
    expect(teamLinkFromText(JSON.stringify(data))).toEqual(data)
    expect(teamLinkFromText('{"teamExportVersion":2}')).toBeUndefined()
    // a short link stays short: a 4-member team with its rotation in about 1 KB
    expect(url.length).toBeLessThan(1500)
  })

  it('refuses what is not a team link, and a small link that would unpack to a huge one', () => {
    expect(decodeTeamLink('')).toBeUndefined()
    expect(decodeTeamLink('z.not*base64')).toBeUndefined()
    expect(decodeTeamLink('x.AAAA')).toBeUndefined()
    expect(decodeTeamLink('z.AAAA')).toBeUndefined()
    const bomb = deflateSync(strToU8(`"${'a'.repeat(5_000_000)}"`))
    let binary = ''
    for (const b of bomb) binary += String.fromCharCode(b)
    const payload = `z.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`
    expect(payload.length).toBeLessThan(20_000)
    expect(decodeTeamLink(payload)).toBeUndefined()
    expect(readTeamLink(undefined).problems[0].code).toBe('payload')
    expect(readTeamLink({ teams: [] }).problems[0].code).toBe('format')
    expect(readTeamLink({ ...link(), version: 2 }).problems[0]).toMatchObject({
      level: 'error',
      code: 'version',
      value: '2',
    })
  })

  it('reads the teams with their defaults, and says what was changed or left out', () => {
    const data = link()
    const raiden = data.teams[0].members[0]
    raiden.constellation = 9
    ;(raiden as Record<string, unknown>)['constelation'] = 2
    const { teams, problems, source } = readTeamLink(data)
    expect(problems).toEqual([])
    expect(source).toEqual({
      name: 'Example calcs',
      url: 'https://example.com/raiden',
    })
    const [{ team, problems: teamProblems }] = teams
    expect(teamProblems).toEqual([
      {
        level: 'warning',
        code: 'unused',
        at: 'teams[0].members[0].constelation',
        team: 0,
      },
      {
        level: 'warning',
        code: 'number',
        at: 'teams[0].members[0].constellation',
        value: '9',
        used: '6',
        team: 0,
      },
    ])
    expect(team!.members[0]).toMatchObject({
      characterKey: 'RaidenShogun',
      level: 90,
      ascension: 6,
      constellation: 6,
      talent: { auto: 9, skill: 10, burst: 10 },
      minEnergyRecharge: 250,
      build: {
        weapon: { key: 'TheCatch', level: 90, ascension: 6, refinement: 5 },
        mainStats: {
          sands: 'enerRech_',
          goblet: 'electro_dmg_',
          circlet: 'critRate_',
        },
      },
    })
    expect(team!.members[0].build!.substats).toMatchObject({
      critRate_: 19.9,
      atk: 0,
    })
    // no weapon or artifacts: the player's own gear
    expect(team!.members[1]).toEqual({
      characterKey: 'Bennett',
      level: 90,
      ascension: 6,
      constellation: 6,
      talent: { auto: 10, skill: 10, burst: 10 },
    })
    // a 4★ flower at +16, the other pieces 5★ at +20; main stats default to ATK%
    expect(team!.members[2].build!.pieces.flower).toEqual({
      rarity: 4,
      level: 16,
    })
    expect(team!.members[2].build!.pieces.plume).toEqual({
      rarity: 5,
      level: 20,
    })
    expect(team!.members[2].build!.mainStats).toEqual({
      sands: 'atk_',
      goblet: 'atk_',
      circlet: 'atk_',
    })
    expect(team!.rotation).toEqual({
      text: data.teams[0].rotation!.text,
      opener: '',
      pingMs: 60,
    })
    expect(team!.enemy!.enemyOverride).toMatchObject({
      enemyLevel: 95,
      electro_enemyRes_: 50,
      pyro_enemyRes_: 10,
      physical_enemyRes_: 10,
    })
    expect(team!.buffs).toEqual({
      team: { atk_: 20 },
      RaidenShogun: { critRate_: 15 },
    })
  })

  it('refuses a team with what this site does not know, or what cannot be', () => {
    const errorOf = (edit: (data: TeamLinkJson) => void) => {
      const data = link()
      edit(data)
      const [{ team, problems }] = readTeamLink(data).teams
      expect(team).toBeUndefined()
      return problems.find((p) => p.level === 'error')
    }
    expect(
      errorOf((d) => {
        d.teams[0].members[3].character = 'NotACharacter'
      })
    ).toMatchObject({ code: 'character', value: 'NotACharacter' })
    expect(
      errorOf((d) => {
        d.teams[0].members[3].character = 'Bennett'
      })
    ).toMatchObject({ code: 'duplicate', value: 'Bennett' })
    expect(
      errorOf((d) => {
        d.teams[0].members[0].weapon!.key = 'WolfsGravestone'
      })
    ).toMatchObject({
      code: 'weaponType',
      at: 'teams[0].members[0].weapon.key',
    })
    expect(
      errorOf((d) => {
        d.teams[0].members[0].artifacts!.mainStats!.sands = 'critRate_'
      })
    ).toMatchObject({ code: 'mainStat', value: 'critRate_' })
    expect(
      errorOf((d) => {
        d.teams[0].members[0].artifacts!.sets = {
          NoblesseOblige: 4,
          Instructor: 2,
        }
      })
    ).toMatchObject({ code: 'setCount', value: '6' })
    expect(
      errorOf((d) => {
        d.teams[0].members[0].artifacts!.sets = { NoblesseOblige: 1 }
      })
    ).toMatchObject({ code: 'setCount', value: '1' })
    expect(
      errorOf((d) => {
        d.teams[0].members.push({ character: 'Fischl' })
      })
    ).toMatchObject({ code: 'members', value: '5' })
  })

  it('creates the team: theorycraft builds at the link’s constellations and talents, its ER, enemy and buffs', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    const [{ team }] = readTeamLink(link()).teams
    const teamId = createTeamFromLink(database, team!, {
      buildName: 'From Example calcs',
      source: { name: 'Example calcs' },
    })
    const saved = database.teams.get(teamId)!
    expect(saved.name).toBe('Raiden National')
    expect(saved.description).toContain('https://example.com/raiden#national')
    expect(saved.enemyOverride.electro_enemyRes_).toBe(50)
    expect(saved.teamOpt!.bonusStats).toEqual({
      team: { atk_: 20 },
      RaidenShogun: { critRate_: 15 },
    })
    expect(saved.teamOpt!.kqm!.constellations).toEqual({
      RaidenShogun: 2,
      Bennett: 6,
      Xingqiu: 0,
      Xiangling: 0,
    })
    expect(saved.teamOpt!.kqm!.energyRecharge).toEqual({ RaidenShogun: 250 })
    const members = teamOptMembers(database, teamId)
    expect(members.map((m) => [m.characterKey, m.isTc])).toEqual([
      ['RaidenShogun', true],
      ['Bennett', false],
      ['Xingqiu', true],
      ['Xiangling', false],
    ])
    const raidenTc = database.buildTcs.get(members[0].loadoutDatum.buildTcId)!
    expect(raidenTc.name).toBe('From Example calcs')
    expect(raidenTc.character).toEqual({
      level: 90,
      ascension: 6,
      constellation: 2,
      talent: { auto: 9, skill: 10, burst: 10 },
    })
    expect(raidenTc.weapon).toMatchObject({ key: 'TheCatch', refinement: 5 })
    expect(raidenTc.artifact.sets).toEqual({ EmblemOfSeveredFate: 4 })
    expect(raidenTc.artifact.slots.sands.statKey).toBe('enerRech_')
    expect(raidenTc.artifact.substats.stats.critDMG_).toBe(46.2)
    const filters = database.optConfigs.get(
      members[0].teamChar.optConfigId
    )!.statFilters
    expect(filters[JSON.stringify(['basic', 'enerRech_'])]).toEqual([
      { value: 250, disabled: false },
    ])
    // the members it has no build for, the player's own (created if they had none)
    expect(database.chars.get('Bennett')).toBeDefined()
  })

  it('tags the team as imported, and Optimize team moves the members the player has to their own gear', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    // the player has Raiden (built), not Xingqiu (the import adds a level-1 entry for it)
    database.chars.set('RaidenShogun', {
      key: 'RaidenShogun',
      level: 90,
      ascension: 6,
      talent: { auto: 6, skill: 9, burst: 10 },
      constellation: 1,
    })
    const [{ team }] = readTeamLink(link()).teams
    const teamId = createTeamFromLink(database, team!, {
      buildName: 'From Example calcs',
      source: { name: 'Example calcs' },
    })
    expect(database.teams.get(teamId)!.importedFrom).toEqual({
      name: 'Example calcs',
      url: 'https://example.com/raiden#national',
      added: ['Bennett', 'Xingqiu', 'Xiangling'],
    })
    // Bennett and Xiangling already play with the player's own gear (no build in the link)
    expect(teamLinkOwnGear(database, teamId)).toEqual({
      switchable: ['RaidenShogun'],
      missing: ['Xingqiu'],
      onOwn: [],
    })
    const tcId = teamOptMembers(database, teamId)[0].loadoutDatum.buildTcId
    expect(teamLinkUseOwnGear(database, teamId)).toEqual(['RaidenShogun'])
    const [raiden, , xingqiu] = teamOptMembers(database, teamId)
    expect(raiden.isTc).toBe(false)
    expect(raiden.loadoutDatum.buildType).toBe('equipped')
    // the imported build stays, to switch back to; the player's own Raiden is untouched
    expect(database.buildTcs.get(tcId)?.weapon.key).toBe('TheCatch')
    expect(database.chars.get('RaidenShogun')!.constellation).toBe(1)
    expect(xingqiu.isTc).toBe(true)
    expect(teamLinkOwnGear(database, teamId)).toEqual({
      switchable: [],
      missing: ['Xingqiu'],
      onOwn: ['RaidenShogun'],
    })
    // and back to the imported build
    expect(teamLinkUseImported(database, teamId)).toEqual(['RaidenShogun'])
    expect(teamOptMembers(database, teamId)[0].loadoutDatum).toMatchObject({
      buildType: 'tc',
      buildTcId: tcId,
    })
    // a team made here is never moved
    const own = database.teams.new({})
    expect(teamLinkOwnGear(database, own)).toEqual({
      switchable: [],
      missing: [],
      onOwn: [],
    })
  })
})
