// @vitest-environment jsdom
import { SandboxStorage } from '@genshin-optimizer/common/database'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import type { TeamLinkJson } from '@genshin-optimizer/gi/ui'
import {
  evaluateTeamRotation,
  readTeamLink,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import { describe, expect, it } from 'vitest'
import { kqmRotationId, writtenRotationOf } from './TeamOptimize/RotationWriter'
import { importTeamFromLink } from './teamLinkApply'

const i18n = { t: (k: string) => k.split(':').pop() } as never

const link: TeamLinkJson = {
  format: 'stellar-team',
  version: 1,
  source: { name: 'Example calcs' },
  teams: [
    {
      name: 'Raiden National',
      members: [
        {
          character: 'RaidenShogun',
          constellation: 2,
          weapon: { key: 'TheCatch', refinement: 5 },
          artifacts: {
            sets: { EmblemOfSeveredFate: 4 },
            mainStats: {
              sands: 'enerRech_',
              goblet: 'electro_dmg_',
              circlet: 'critRate_',
            },
            substats: { critRate_: 26.5, critDMG_: 52.9, atk_: 9.9 },
          },
        },
        {
          character: 'Bennett',
          constellation: 6,
          weapon: { key: 'SapwoodBlade', refinement: 5 },
          artifacts: { sets: { NoblesseOblige: 4 } },
        },
        {
          character: 'Xingqiu',
          constellation: 6,
          weapon: { key: 'SacrificialSword', refinement: 5 },
          artifacts: {
            sets: { EmblemOfSeveredFate: 4 },
            mainStats: { goblet: 'hydro_dmg_', circlet: 'critRate_' },
            substats: { critRate_: 26.5, critDMG_: 52.9 },
          },
        },
        {
          character: 'Xiangling',
          constellation: 6,
          weapon: { key: 'TheCatch', refinement: 5 },
          artifacts: {
            sets: { EmblemOfSeveredFate: 4 },
            mainStats: { goblet: 'pyro_dmg_', circlet: 'critRate_' },
            substats: { critRate_: 26.5, critDMG_: 52.9 },
          },
        },
      ],
      rotation: {
        text: 'Xingqiu E D Q N1 -> Bennett Q N1 E -> Xiangling N1 Q N1 E D -> Bennett N1 E -> Raiden N1 Q N4 E N4 D N4 D N4 -> Bennett N2 E -> Xingqiu',
        opener:
          'Raiden E -> Xingqiu E D Q N1 -> Bennett Q N1 E -> Xiangling N1 Q N1 E D -> Bennett N1 E -> Raiden N1 Q N4 E N4 D N4 D N4',
        ping: 60,
      },
    },
  ],
}

describe('a team link imported', () => {
  it('plays its rotation on both tabs, with its builds and constellations', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    const [{ team }] = readTeamLink(link).teams
    const teamId = importTeamFromLink(database, team!, {
      i18n,
      gender: 'F',
      buildName: 'From Example calcs',
      source: { name: 'Example calcs' },
    })
    const saved = database.teams.get(teamId)!
    // the rotation, written and played: every member attacks, on Team optimize and on KQM
    expect(writtenRotationOf(database, teamId).text).toBe(
      link.teams[0].rotation!.text
    )
    expect(writtenRotationOf(database, kqmRotationId(teamId)).opener).toBe(
      link.teams[0].rotation!.opener
    )
    expect(
      JSON.parse(writtenRotationOf(database, teamId).timing)
    ).toMatchObject({
      pingMs: 60,
      swapFrames: 7,
    })
    for (const attacks of [
      saved.teamOpt!.attacks,
      saved.teamOpt!.kqm!.attacks!,
    ])
      expect(Object.keys(attacks).sort()).toEqual(
        ['Bennett', 'RaidenShogun', 'Xiangling', 'Xingqiu'].sort()
      )
    expect(saved.teamOpt!.rotationTime).toBeGreaterThan(15)
    // its damage, read with the links' builds (theorycraft) at their constellations
    const members = teamOptMembers(database, teamId)
    expect(members.every((m) => m.isTc)).toBe(true)
    const total = evaluateTeamRotation(database, teamId, 'F', {
      arts: {},
      attacks: saved.teamOpt!.attacks,
      onField: saved.teamOpt!.onField,
    })!.total
    expect(total).toBeGreaterThan(100_000)
    // the player's own characters were not touched (the builds carry their own levels)
    expect(database.chars.get('RaidenShogun')?.constellation ?? 0).toBe(0)
  })
})
