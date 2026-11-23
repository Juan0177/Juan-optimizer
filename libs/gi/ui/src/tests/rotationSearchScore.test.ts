import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  kqmRotationSearchSetup,
  optimizeTeamKqm,
  parseFrameData,
  parseTiming,
  rotationScorer,
} from '../'

const ayaka: CharacterKey = 'KamisatoAyaka'
const shenhe: CharacterKey = 'Shenhe'

describe('a rotation search’s player', () => {
  it('scores the same when what it keeps starts over before every rotation', async () => {
    const database = new ArtCharDatabase(1, new SandboxStorage({}))
    for (const key of [ayaka, shenhe])
      database.chars.set(key, {
        key,
        level: 90,
        ascension: 6,
        talent: { auto: 9, skill: 9, burst: 9 },
        constellation: 0,
      })
    const teamId = database.teams.new({
      loadoutData: [
        { teamCharId: database.teamChars.new(ayaka) },
        { teamCharId: database.teamChars.new(shenhe) },
      ] as LoadoutDatum[],
    })
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      kqm: { refinement5: 1, refinement4: 5, talents: 10 },
      attacks: {
        [ayaka]: [{ path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' }],
        [shenhe]: [{ path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' }],
      },
    }
    const result = (await optimizeTeamKqm({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      maxRounds: 2,
    }))!
    const setup = kqmRotationSearchSetup(
      database,
      teamId,
      'F',
      [
        { characterKey: ayaka, name: 'Ayaka' },
        { characterKey: shenhe, name: 'Shenhe' },
      ],
      teamOpt,
      result,
      {
        opener: '',
        timing: parseTiming(null),
        frameData: parseFrameData(null),
      }
    )
    const kept = rotationScorer(database, setup)
    const anew = rotationScorer(database, setup, 0)
    const texts = [
      'Shenhe E Q -> Ayaka E Q N2 CA',
      'Shenhe Q E -> Ayaka Q E N2 CA',
      'Shenhe E Q -> Ayaka E Q N2 CA',
      'Shenhe E -> Ayaka E N2 CA -> Shenhe Q -> Ayaka Q N2',
    ]
    for (const text of texts) {
      const score = kept(text)
      expect(score?.dps).toBeGreaterThan(0)
      expect(anew(text)).toEqual(score)
    }
  })
})
