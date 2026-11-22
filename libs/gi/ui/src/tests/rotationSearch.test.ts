import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import type {
  KqmBuild,
  RotationDamageCache,
  RotationScore,
  RotationSearchProgress,
} from '../'
import {
  allRotationEdits,
  energyFits,
  erCostOf,
  evaluateTeamNodes,
  fieldAttacks,
  kqmArtData,
  kqmWeaponData,
  kqmWeapons,
  mainMember,
  rotationDamage,
  rotationEdits,
  rotationGuard,
  rotationVocabulary,
  rotationWords,
  searchRotations,
  stepOrders,
  teamRotationNodes,
  wordsRotationText,
} from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const names = (keys: CharacterKey[]) =>
  keys.map((characterKey) => ({ characterKey, name: characterKey }))

describe('a rotation as words', () => {
  const members = names(['Furina', 'Neuvillette', 'KaedeharaKazuha'])
  it('one action a word: glued ones apart, groups kept whole', () => {
    const steps = rotationWords(
      'Furina EQ -> Kazuha E P (a note) -> Neuvillette 3[CA J] 2N3CA N1 -> Furina',
      members
    )
    expect(steps.map((s) => [s.characterKey, s.name, s.words])).toEqual([
      ['Furina', 'Furina', ['E', 'Q']],
      ['KaedeharaKazuha', 'Kazuha', ['E', 'P']],
      ['Neuvillette', 'Neuvillette', ['3[CA J]', '2[N3 CA]', 'N1']],
      ['Furina', 'Furina', []],
    ])
    expect(wordsRotationText(steps)).toBe(
      'Furina E Q -> Kazuha E P -> Neuvillette 3[CA J] 2[N3 CA] N1 -> Furina'
    )
  })
  it('field attacks count a group’s repeats', () => {
    expect(fieldAttacks(['E', '3[CA J]', '2[N3 CA]', 'N1', 'Q'])).toBe(8)
  })
})

describe('the rotations one change away', () => {
  const members = names(['Furina', 'Neuvillette'])
  const steps = rotationWords(
    'Furina E Q -> Neuvillette 2[N3 CA] -> Furina',
    members
  )
  const texts = rotationEdits(steps, { Furina: ['D'] }).map(wordsRotationText)
  it('steps swapped, the loop back kept last', () => {
    expect(texts).toContain('Neuvillette 2[N3 CA] -> Furina E Q -> Furina')
    expect(texts.every((t) => t.endsWith('-> Furina'))).toBe(true)
  })
  it('words left out, swapped and added', () => {
    expect(texts).toContain('Furina Q -> Neuvillette 2[N3 CA] -> Furina')
    expect(texts).toContain('Furina Q E -> Neuvillette 2[N3 CA] -> Furina')
    expect(texts).toContain('Furina E D Q -> Neuvillette 2[N3 CA] -> Furina')
  })
  it('a group repeated once more or less, and its own words changed', () => {
    expect(texts).toContain('Furina E Q -> Neuvillette 3[N3 CA] -> Furina')
    expect(texts).toContain('Furina E Q -> Neuvillette N3 CA -> Furina')
    expect(texts).toContain('Furina E Q -> Neuvillette 2[N2 CA] -> Furina')
    expect(texts).toContain('Furina E Q -> Neuvillette 2[CA N3] -> Furina')
  })
  it('a step keeps one word', () => {
    const one = rotationWords('Furina E -> Neuvillette CA', members)
    expect(
      rotationEdits(one, {})
        .map(wordsRotationText)
        .some((t) => /Furina\s*->/.test(t))
    ).toBe(false)
  })
})

describe('the members’ order and visits (a player request)', () => {
  const members = names(['Furina', 'Neuvillette', 'KaedeharaKazuha', 'Xianyun'])
  const steps = rotationWords(
    'Furina E Q -> Kazuha E P -> Xianyun E -> Neuvillette 2[N3 CA] -> Furina',
    members
  )
  const vocabulary = rotationVocabulary(steps)
  const texts = (kinds = allRotationEdits) =>
    rotationEdits(steps, vocabulary, kinds).map(wordsRotationText)
  it('a step moved anywhere: a support played right before the member who catches its particles', () => {
    expect(texts()).toContain(
      'Kazuha E P -> Xianyun E -> Furina E Q -> Neuvillette 2[N3 CA] -> Furina'
    )
    expect(texts()).toContain(
      'Xianyun E -> Furina E Q -> Kazuha E P -> Neuvillette 2[N3 CA] -> Furina'
    )
    expect(
      texts().every(
        (t) =>
          t.endsWith('-> Neuvillette 2[N3 CA] -> Furina') ||
          t.endsWith('-> Furina')
      )
    ).toBe(true)
  })
  it('a member back on the field for a Skill or Burst, to refresh a buff', () => {
    expect(texts()).toContain(
      'Furina E Q -> Kazuha E P -> Xianyun E -> Furina E -> Neuvillette 2[N3 CA] -> Furina'
    )
    expect(texts()).toContain(
      'Furina E Q -> Kazuha E P -> Xianyun E -> Neuvillette 2[N3 CA] -> Kazuha E -> Furina'
    )
    // (no second Burst for a member that has one: it would wait out its cooldown)
    expect(texts()).toContain(
      'Furina E Q -> Kazuha E P -> Xianyun E -> Kazuha Q -> Neuvillette 2[N3 CA] -> Furina'
    )
    expect(texts()).not.toContain(
      'Furina E Q -> Kazuha E P -> Xianyun E -> Furina Q -> Neuvillette 2[N3 CA] -> Furina'
    )
    // (never next to its own step: that is a word added to it)
    expect(texts()).not.toContain(
      'Furina E Q -> Furina E -> Kazuha E P -> Xianyun E -> Neuvillette 2[N3 CA] -> Furina'
    )
  })
  it('an extra visit left out, never a member’s only one', () => {
    const twice = rotationWords(
      'Furina E Q -> Kazuha E P -> Furina E -> Neuvillette 2[N3 CA]',
      members
    )
    const edits = rotationEdits(twice, {}).map(wordsRotationText)
    expect(edits).toContain('Kazuha E P -> Furina E -> Neuvillette 2[N3 CA]')
    expect(edits).toContain('Furina E Q -> Kazuha E P -> Neuvillette 2[N3 CA]')
    expect(edits).not.toContain(
      'Furina E Q -> Furina E -> Neuvillette 2[N3 CA]'
    )
  })
  it('only the kinds of change chosen', () => {
    const none = { order: false, visits: false, attacks: false, actions: false }
    expect(texts(none)).toEqual([])
    const order = texts({ ...none, order: true })
    expect(order).toContain(
      'Kazuha E P -> Furina E Q -> Xianyun E -> Neuvillette 2[N3 CA] -> Furina'
    )
    expect(order.every((t) => t.split(' -> ').length === 5)).toBe(true)
    const attacks = texts({ ...none, attacks: true })
    expect(attacks).toContain(
      'Furina E Q -> Kazuha E P -> Xianyun E -> Neuvillette 3[N3 CA] -> Furina'
    )
    expect(attacks).toContain(
      'Furina E Q -> Kazuha E HP -> Xianyun E -> Neuvillette 2[N3 CA] -> Furina'
    )
    expect(attacks).not.toContain(
      'Furina Q -> Kazuha E P -> Xianyun E -> Neuvillette 2[N3 CA] -> Furina'
    )
    const actions = texts({ ...none, actions: true })
    expect(actions).toContain(
      'Furina Q -> Kazuha E P -> Xianyun E -> Neuvillette 2[N3 CA] -> Furina'
    )
    expect(actions).toContain(
      'Furina E Q -> Kazuha hE P -> Xianyun E -> Neuvillette 2[N3 CA] -> Furina'
    )
    expect(actions).not.toContain(
      'Furina E Q -> Kazuha E P -> Xianyun E -> Neuvillette 3[N3 CA] -> Furina'
    )
    const visits = texts({ ...none, visits: true })
    expect(visits.length).toBeGreaterThan(0)
    expect(visits.every((t) => t.split(' -> ').length === 6)).toBe(true)
  })
})

describe('every order of the steps', () => {
  const members = names(['Furina', 'Neuvillette', 'KaedeharaKazuha', 'Xianyun'])
  it('one of each that only loops from another, the loop back kept last', () => {
    const orders = stepOrders(
      rotationWords(
        'Furina E Q -> Kazuha E P -> Xianyun E -> Neuvillette 2[N3 CA] -> Furina',
        members
      )
    ).map(wordsRotationText)
    // (3 others after the first step: 3! orders, the written one left out)
    expect(orders).toHaveLength(5)
    expect(orders).toContain(
      'Furina E Q -> Xianyun E -> Kazuha E P -> Neuvillette 2[N3 CA] -> Furina'
    )
    expect(orders).toContain(
      'Furina E Q -> Neuvillette 2[N3 CA] -> Xianyun E -> Kazuha E P -> Furina'
    )
    expect(
      orders.every((t) => t.startsWith('Furina E Q') && t.endsWith('-> Furina'))
    ).toBe(true)
  })
})

describe('a kit’s own ways of writing an action', () => {
  const members = names(['Sandrone', 'Beidou', 'Xianyun'])
  const steps = rotationWords(
    'Xianyun E -> Beidou hE -> Sandrone E 2[CA N1] HP',
    members
  )
  const vocabulary = rotationVocabulary(steps)
  const texts = rotationEdits(steps, vocabulary).map(wordsRotationText)
  it('are in the members’ vocabulary', () => {
    expect(vocabulary.Sandrone).toContain('CA[beams=6]')
    expect(vocabulary.Beidou).toContain('hE[stacks=1]')
    expect(vocabulary.Sandrone).toContain('LP')
    expect(vocabulary.Xianyun).not.toContain('LP')
  })
  it('are tried in place of the action, in groups too', () => {
    expect(texts).toContain(
      'Xianyun E -> Beidou hE -> Sandrone E 2[CA[beams=4] N1] HP'
    )
    expect(texts).toContain(
      'Xianyun E -> Beidou hE[stacks=1] -> Sandrone E 2[CA N1] HP'
    )
    expect(texts).toContain('Xianyun hE -> Beidou hE -> Sandrone E 2[CA N1] HP')
    expect(texts).toContain('Xianyun E -> Beidou hE -> Sandrone E 2[CA N1] LP')
  })
})

describe('what a search keeps to', () => {
  const members = names(['Furina', 'Neuvillette', 'Xianyun'])
  const seed = rotationWords(
    'Furina E Q -> Xianyun E -> Neuvillette Q E CA CA CA CA',
    members
  )
  const ok = rotationGuard(seed)
  const words = (text: string) => rotationWords(text, members)
  it('the main DPS is the member with the most field attacks', () => {
    expect(mainMember(seed)).toBe('Neuvillette')
  })
  it('the main DPS keeps its Burst and half its field attacks', () => {
    expect(ok(words('Furina E Q -> Xianyun E -> Neuvillette Q E CA CA'))).toBe(
      true
    )
    expect(ok(words('Furina E Q -> Xianyun E -> Neuvillette E CA CA CA'))).toBe(
      false
    )
    expect(ok(words('Furina E Q -> Xianyun E -> Neuvillette Q E CA'))).toBe(
      false
    )
  })
  it('the others take at most 2 field attacks over their own', () => {
    expect(
      ok(words('Furina E Q N1 N1 -> Xianyun E -> Neuvillette Q E CA CA CA CA'))
    ).toBe(true)
    expect(
      ok(
        words('Furina E Q N1 N1 N1 -> Xianyun E -> Neuvillette Q E CA CA CA CA')
      )
    ).toBe(false)
  })
  it('Energy Recharge within what the builds have or the seed’s needs and a slack', () => {
    const seedScore: RotationScore = {
      dps: 1,
      time: 20,
      er: { Furina: 150, Xianyun: 100 },
      warnings: [],
    }
    const fits = energyFits(seedScore, 20, { Furina: 200 })
    const score = (er: RotationScore['er']) => ({ ...seedScore, er })
    expect(fits(score({ Furina: 200, Xianyun: 120 }))).toBe(true)
    expect(fits(score({ Furina: 201, Xianyun: 100 }))).toBe(false)
    expect(fits(score({ Furina: 150, Xianyun: 121 }))).toBe(false)
  })
})

describe('the hill climb', () => {
  const members = names(['Furina', 'Neuvillette'])
  // (a made-up DPS: each CA of Neuvillette's counts up to 4, a longer rotation less; "Furina D"
  // warns)
  const score = async (texts: string[]) =>
    texts.map((text): RotationScore => {
      const steps = rotationWords(text, members)
      const neuv = steps.flatMap((s) =>
        s.characterKey === 'Neuvillette' ? s.words : []
      )
      const all = steps.flatMap((s) => s.words)
      return {
        dps:
          (1 +
            Math.min(4, fieldAttacks(neuv.filter((w) => w.includes('CA'))))) /
          all.length,
        time: all.length,
        er: {},
        warnings: /Furina[^>]*\bD\b/.test(text) ? ['Furina: dash'] : [],
      }
    })
  it('climbs to a better rotation, kept to the guard and without new warnings', async () => {
    const result = await searchRotations({
      seed: 'Furina E Q -> Neuvillette Q E N1 CA',
      members,
      score,
      deadline: Date.now() + 60_000,
    })
    expect(result.best[0].dps).toBeGreaterThan(result.seed.dps)
    expect(result.ended).toBe('converged')
    const ok = rotationGuard(rotationWords(result.seed.text, members))
    for (const c of result.best) {
      expect(ok(rotationWords(c.text, members))).toBe(true)
      expect(c.warnings).toEqual([])
    }
  })
  it('reports the seed, each round as it starts and the best so far, best first', async () => {
    const reports: RotationSearchProgress[] = []
    const result = await searchRotations({
      seed: 'Furina E Q -> Neuvillette Q E N1 CA',
      members,
      score,
      deadline: Date.now() + 60_000,
      onProgress: (p) => reports.push(p),
    })
    expect(reports[0]).toMatchObject({ round: 0, played: 1 })
    expect(reports[0].top).toEqual([result.seed])
    expect(reports[1]).toMatchObject({ round: 1, roundPlayed: 0 })
    for (const p of reports) {
      expect(p.top[0]).toBe(p.best)
      expect(p.top.map((c) => c.dps)).toEqual(
        [...p.top.map((c) => c.dps)].sort((a, b) => b - a)
      )
    }
    expect(reports.at(-1)?.best).toBe(result.best[0])
  })
  it('measures from a reference: searches from different starts compare', async () => {
    const reference: RotationScore = {
      dps: 0.5,
      time: 1,
      er: { Neuvillette: 150 },
      warnings: [],
    }
    const result = await searchRotations({
      seed: 'Furina E Q -> Neuvillette Q E N1 CA',
      members,
      score,
      deadline: Date.now() + 60_000,
      reference,
      erCost: (s) => (s.er.Neuvillette ?? 100) / 1000,
    })
    // (its own seed against the reference's Energy Recharge cost, 0.15)
    expect(result.seed.estimate).toBeCloseTo(result.seed.dps + 0.15 - 0.1)
  })
  it('stops at its deadline', async () => {
    const result = await searchRotations({
      seed: 'Furina E Q -> Neuvillette Q E N1 CA',
      members,
      score,
      deadline: Date.now() - 1,
    })
    expect(result.ended).toBe('time')
    expect(result.played).toBe(1)
  })
})

describe('Energy Recharge a rotation frees, priced in damage stats', () => {
  const members = names(['Furina', 'Neuvillette', 'KaedeharaKazuha'])
  // (the same DPS whatever the order; Neuvillette needs less ER when Kazuha's particles come to
  // him, played right before him)
  const score = async (texts: string[]) =>
    texts.map(
      (text): RotationScore => ({
        dps: 100,
        time: 20,
        er: {
          Neuvillette: /Kazuha E\s*->\s*Neuvillette/.test(text) ? 120 : 150,
        },
        warnings: [],
      })
    )
  const seed = 'Kazuha E -> Furina E Q -> Neuvillette Q E CA CA'
  const kinds = { order: true, visits: false, attacks: false, actions: false }
  it('a need a roll lower gains what the roll gives as a damage stat', () => {
    const cost = erCostOf({ Neuvillette: { roll: 3, er: 5, floor: 110 } })
    const at = (need: number) =>
      cost({ dps: 0, time: 1, er: { Neuvillette: need }, warnings: [] })
    expect(at(150) - at(120)).toBeCloseTo((30 / 5) * 3)
    expect(at(100)).toBe(0)
  })
  it('finds the order that funnels particles, which the builds alone do not reward', async () => {
    const plain = await searchRotations({
      seed,
      members,
      score,
      deadline: Date.now() + 60_000,
      kinds,
    })
    expect(plain.best[0].text).toBe(plain.seed.text)
    const priced = await searchRotations({
      seed,
      members,
      score,
      deadline: Date.now() + 60_000,
      kinds,
      erCost: erCostOf({ Neuvillette: { roll: 3, er: 5, floor: 110 } }),
    })
    expect(priced.best[0].text).toBe(
      'Furina E Q -> Kazuha E -> Neuvillette Q E CA CA'
    )
    expect(priced.best[0].dps).toBe(100)
    expect(priced.best[0].estimate).toBeCloseTo(100 + (30 / 5) * 3)
    expect(priced.seed.estimate).toBe(100)
  })
})

describe('the rotation’s damage, each run of hits worked out once', () => {
  const teams: {
    members: CharacterKey[]
    text: string
    cons?: Partial<Record<CharacterKey, number>>
  }[] = [
    {
      members: ['YumemizukiMizuki', 'Odette', 'Anastasya', 'TravelerCryo'],
      text: 'Anastasya E Q -> TravelerCryo E CA Q -> Odette E E -> YumemizukiMizuki E W10 -> Anastasya',
      cons: { YumemizukiMizuki: 2, TravelerCryo: 6 },
    },
    {
      members: ['HuTao', 'Xingqiu', 'Yelan', 'Zhongli'],
      text: 'Zhongli hE -> Xingqiu E Q -> Yelan E Q -> HuTao E N1 CA N1 CA N1 CA N1 CA N1 CA Q -> Zhongli',
    },
    {
      members: ['Eula', 'RaidenShogun', 'Rosaria', 'Zhongli'],
      text: 'Zhongli hE -> RaidenShogun E -> Rosaria E Q -> Eula E Q N3 N3 N3 hE -> Zhongli',
    },
  ]
  for (const { members, text, cons = {} } of teams)
    it(`${members.join(', ')}: as evaluateTeamNodes totals teamRotationNodes`, () => {
      const database = new ArtCharDatabase(1, new SandboxStorage({}))
      for (const key of members)
        database.chars.set(key, {
          key,
          level: 90,
          ascension: 6,
          talent: { auto: 9, skill: 9, burst: 9 },
          constellation: cons[key] ?? 0,
        })
      const ids = members.map((k) => database.teamChars.new(k))
      const teamId = database.teams.new({
        loadoutData: ids.map((teamCharId) => ({
          teamCharId,
        })) as LoadoutDatum[],
      })
      const builds = Object.fromEntries(
        members.map((k): [CharacterKey, KqmBuild] => [
          k,
          {
            weapon: kqmWeapons(k, undefined, { all: true })[0],
            sets: { NoblesseOblige: 4 },
            mains: { sands: 'atk_', goblet: 'atk_', circlet: 'critRate_' },
            rolls: { critRate_: 6, critDMG_: 6, atk_: 4, enerRech_: 4 },
          },
        ])
      ) as Record<CharacterKey, KqmBuild>
      const attacks = rotationAttacks(
        simulateRotation({
          rotation: parseRotation(text, names(members)),
          members,
          constellations: cons,
          elements: Object.fromEntries(
            members.map((m) => [m, getCharEle(m)])
          ) as never,
          gear: Object.fromEntries(
            members.map((k) => [
              k,
              { weapon: builds[k].weapon.key, sets: builds[k].sets },
            ])
          ),
        })
      )
      const settings = {
        arts: Object.fromEntries(
          members.map((k) => [k, kqmArtData(builds[k])])
        ),
        weapons: Object.fromEntries(
          members.map((k) => [k, kqmWeaponData(builds[k].weapon, k)])
        ),
        attacks,
      }
      const nodes = teamRotationNodes(database, teamId, 'F', settings)!
      const expected = evaluateTeamNodes(database, teamId, attacks, nodes)
      const cache: RotationDamageCache = new Map()
      const first = rotationDamage(database, teamId, 'F', settings, cache)!
      const size = cache.size
      const again = rotationDamage(database, teamId, 'F', settings, cache)!
      expect(expected.total).toBeGreaterThan(0)
      expect(first.total).toBeCloseTo(expected.total, 6)
      for (const k of members)
        expect(first.members[k] ?? 0).toBeCloseTo(expected.members[k] ?? 0, 6)
      expect(again.total).toBe(first.total)
      expect(cache.size).toBe(size)
    })
})
