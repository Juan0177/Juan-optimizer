import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOptAttack } from '@genshin-optimizer/gi/db'
import {
  ArtCharDatabase,
  initTeamOpt,
  validateTeamOpt,
} from '@genshin-optimizer/gi/db'
import { describe, expect, it, vi } from 'vitest'
import { evaluateTeamRotation, teamOptRotationForRun } from '../'
import { energyFromRotation } from '../util/teamOpt/energyCalc'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
  simulateRotationSamples,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

function baizhu() {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set('Baizhu', {
    key: 'Baizhu',
    level: 90,
    ascension: 6,
    constellation: 0,
    talent: { auto: 9, skill: 9, burst: 9 },
  })
  const teamCharId = db.teamChars.new('Baizhu', {})
  const buildTcId = db.buildTcs.new({
    characterKey: 'Baizhu',
    character: {
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 9, skill: 9, burst: 9 },
    },
    weapon: { key: 'PrototypeAmber', level: 90, ascension: 6, refinement: 1 },
    artifact: {
      slots: {},
      substats: { type: 'max', stats: {}, rarity: 5 },
      sets: { OceanHuedClam: 4 },
    },
  } as never)
  const teamId = db.teams.new({
    loadoutData: [{ teamCharId, buildType: 'tc', buildTcId }] as LoadoutDatum[],
  } as never)
  return { db, teamId, buildTcId }
}

it('gains Pale Flame only from eligible skill damage, shares the gain cooldown and expires refreshed stacks on the wearer clock', () => {
  const kit: KitModel = {
    characterKey: 'Razor',
    element: 'electro',
    source: 'test',
    act(c) {
      for (const t of [0, 10, 18, 500])
        c.hit(t, {
          path: ['skill', 'press'],
          tag: 'skill',
          element: 'electro',
          label: `Skill ${t}`,
        })
      c.hit(300, {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        element: 'physical',
        animationPause: 10,
        label: 'Pause',
      })
      for (const t of [1, 11, 19, 447, 448, 501])
        c.hit(t, {
          path: ['normal', '0'],
          tag: 'normal',
          element: 'physical',
          label: `Normal ${t}`,
        })
      return { frames: 600 }
    },
  }
  const sim = simulateRotation({
    rotation: parseRotation('Razor E', [
      { characterKey: 'Razor', name: 'Razor' },
    ]),
    members: ['Razor'],
    constellations: {},
    elements: { Razor: 'electro' },
    kits: { Razor: kit },
    gear: { Razor: { sets: { PaleFlame: 4 } } },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
  })
  const attacks = rotationAttacks(sim, () => '2').Razor!
  const stacks = (label: string) =>
    attacks
      .find((a) => a.description === label)
      ?.states?.find((s) => s.path[0] === 'PaleFlame')?.value ?? ''
  expect(stacks('Skill 0')).toBe('')
  expect(stacks('Skill 18')).toBe('1')
  expect([1, 11, 19, 447, 448, 501].map((t) => stacks(`Normal ${t}`))).toEqual([
    '1',
    '1',
    '',
    '',
    '',
    '1',
  ])
  expect(
    attacks
      .find((a) => a.description === 'Normal 19')
      ?.limits?.filter((l) => l.path[0] === 'PaleFlame')
  ).toEqual([]) // two stacks match saved defaults
  expect(
    attacks.find((a) => a.description === 'Normal 448')?.limits
  ).toContainEqual({ owner: 'Razor', path: ['PaleFlame', 'stacks'], hits: 0 })
})
const foam = (count: number): TeamOptAttack => ({
  path: ['artifact:OceanHuedClam', 'heal'],
  hits: 1,
  hitMode: 'avgHit',
  healing: [{ path: ['skill', 'heal'], count }],
})
const damage = (db: ArtCharDatabase, teamId: string, attack: TeamOptAttack) =>
  evaluateTeamRotation(db, teamId, 'F', {
    arts: {},
    attacks: { Baizhu: [attack] },
  })!.total

describe('Sea-Dyed Foam', () => {
  it('persists healing contributions and rejects malformed amounts', () => {
    expect(
      validateTeamOpt({ attacks: { Baizhu: [foam(4)] } })?.attacks.Baizhu?.[0]
        .healing
    ).toEqual(foam(4).healing)
    for (const count of [0, -1, Number.POSITIVE_INFINITY, Number.NaN])
      expect(
        validateTeamOpt({ attacks: { Baizhu: [foam(count)] } })?.attacks
          .Baizhu?.[0].healing
      ).toBeUndefined()
  })

  it('keeps a healing-based Clam rotation through a GOOD export and import', () => {
    const { db, teamId } = baizhu()
    db.teams.set(teamId, {
      teamOpt: {
        ...validateTeamOpt({}),
        attacks: { Baizhu: [foam(4)] },
      } as never,
    })
    const next = new ArtCharDatabase(2, new SandboxStorage({}))
    next.importGOOD(db.exportGOOD(), false, false, false)
    expect(
      next.teams.get(teamId)?.teamOpt?.attacks.Baizhu?.[0].healing
    ).toEqual(foam(4).healing)
    expect(
      damage(next, teamId, next.teams.get(teamId)!.teamOpt!.attacks.Baizhu![0])
    ).toBeCloseTo(damage(db, teamId, foam(4)), 8)
  })

  it('scales with healing stats, caps accumulated healing, and deals no damage without four Clam pieces', () => {
    const { db, teamId, buildTcId } = baizhu()
    const low = damage(db, teamId, foam(1))
    expect(low).toBeGreaterThan(0)
    db.buildTcs.set(buildTcId, (tc) => {
      tc.artifact.substats.stats = { hp: 30000 }
    })
    const high = damage(db, teamId, foam(1))
    expect(high).toBeGreaterThan(low)
    const capped = damage(db, teamId, foam(100))
    expect(capped).toBeCloseTo(27000 * 0.9, 5) // the default enemy has 10% Physical RES
    db.buildTcs.set(buildTcId, (tc) => {
      tc.artifact.sets = {}
    })
    expect(damage(db, teamId, foam(100))).toBe(0)
  })

  it('includes healing contributions in rotation grouping and does not merge different bubbles', () => {
    const heal = foam(1).healing!
    const sim = {
      hits: [1, 2].map((count) => ({
        t: count,
        characterKey: 'Baizhu' as const,
        path: foam(1).path,
        tag: 'other' as const,
        element: 'physical' as const,
        label: 'Sea-Dyed Foam',
        healing: [{ ...heal[0], count }],
      })),
      frames: 100,
      start: 0,
      buffWindows: [],
      countedBuffs: [],
      actions: [],
      notes: [],
      warnings: [],
      unsupported: [],
    }
    expect(
      rotationAttacks(sim).Baizhu?.map((a) => a.healing?.[0].count)
    ).toEqual([1, 2])
  })

  it('collects Baizhu heals into bubbles with a three-second duration and 3.5-second cooldown', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Baizhu E Q W10', [
        { characterKey: 'Baizhu', name: 'Baizhu' },
      ]),
      members: ['Baizhu'],
      constellations: {},
      elements: { Baizhu: 'dendro' },
      repeats: 1,
      gear: { Baizhu: { sets: { OceanHuedClam: 4 } } },
    })
    const bubbles = sim.hits.filter((h) => h.label === 'Sea-Dyed Foam')
    expect(bubbles.length).toBeGreaterThan(1)
    expect(bubbles[0].t).toBe(160 + 180 + 1)
    expect(bubbles.every((h) => h.healing?.length)).toBe(true)
    expect(bubbles.slice(1).every((h, i) => h.t - bubbles[i].t >= 210)).toBe(
      true
    )
  })
})

describe('rotation gear activation', () => {
  it('activates Desert Pavilion only after charged damage and expires it after fifteen seconds', () => {
    const kit: KitModel = {
      characterKey: 'Varka',
      element: 'anemo',
      source: 'test',
      act(c) {
        for (const t of [0, 10, 20, 920])
          c.hit(t, {
            path: t === 10 ? ['charged', 'dmg1'] : ['normal', 'na1'],
            tag: t === 10 ? 'charged' : 'normal',
            element: 'physical',
            label: `Probe ${t}`,
          })
        return { frames: 1000 }
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation('Varka E', [
        { characterKey: 'Varka', name: 'Varka' },
      ]),
      members: ['Varka'],
      elements: { Varka: 'anemo' },
      constellations: {},
      repeats: 1,
      kits: { Varka: kit },
      gear: { Varka: { sets: { DesertPavilionChronicle: 4 } } },
    })
    const attacks = rotationAttacks(sim).Varka!
    const state = (name: string) =>
      attacks
        .find((a) => a.description === name)
        ?.states?.find((s) => s.path[0] === 'DesertPavilionChronicle')?.value
    expect(state('Probe 0') ?? '').toBe('')
    expect(state('Probe 10') ?? '').toBe('')
    expect(state('Probe 20')).toBe('on')
    expect(state('Probe 920') ?? '').toBe('')
  })
  it('refreshes the whole Marechaussee stack duration after HP changes', () => {
    const party = ['Neuvillette'] as const
    const kit: KitModel = {
      characterKey: 'Neuvillette',
      element: 'hydro',
      source: 'test',
      act(ctx) {
        for (const t of [0, 100, 200, 450, 800])
          ctx.hit(t, {
            path: ['_marker', 'hpChange'],
            tag: 'other',
            element: 'hydro',
            label: 'HP',
          })
        return { frames: 1200 }
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation(
        'Neuvillette E',
        party.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members: [...party],
      constellations: {},
      elements: { Neuvillette: 'hydro' },
      repeats: 1,
      kits: { Neuvillette: kit },
      gear: { Neuvillette: { sets: { MarechausseeHunter: 4 } } },
    })
    const windows = sim.buffWindows.filter(
      (w) => w.path[0] === 'MarechausseeHunter'
    )
    expect(windows.map((w) => [w.start, w.end, w.value])).toEqual([
      [0, 300, '1'],
      [100, 400, '2'],
      [200, 500, '3'],
      [450, 750, '3'],
      [800, 1100, '1'],
    ])
  })

  it('starts Reverie at full strength, decays without Burning, and recovers while off field', () => {
    const members: CharacterKey[] = ['Emilie', 'Amber']
    const kit: KitModel = {
      characterKey: 'Emilie',
      element: 'dendro',
      source: 'test',
      act(ctx) {
        ctx.hit(800, {
          path: ['normal', '0'],
          tag: 'normal',
          element: 'dendro',
          applies: true,
          label: 'Dendro',
        })
        ctx.hit(810, {
          characterKey: 'Amber',
          path: ['normal', '0'],
          tag: 'normal',
          element: 'pyro',
          applies: true,
          label: 'Burning',
        })
        return { frames: 1 }
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation(
        'Emilie E -> Amber W18',
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      constellations: {},
      elements: { Emilie: 'dendro', Amber: 'pyro' },
      repeats: 1,
      kits: {
        Emilie: kit,
        Amber: { ...kit, characterKey: 'Amber', act: () => ({ frames: 1 }) },
      },
      gear: { Emilie: { sets: { UnfinishedReverie: 4 } } },
    })
    const stacks = sim.buffWindows.filter(
      (w) => w.path[0] === 'UnfinishedReverie'
    )
    expect(stacks.slice(0, 6).map((w) => [w.start, w.value])).toEqual([
      [0, '5'],
      [360, '4'],
      [450, '3'],
      [540, '2'],
      [630, '1'],
      [720, ''],
    ])
    expect(stacks.some((w) => w.start >= 810 && w.value === '1')).toBe(true)
    expect(stacks.some((w) => w.start >= 900 && Number(w.value) >= 2)).toBe(
      true
    )
  })

  describe('Sacrificial weapons', () => {
    it('replays a weapon comparison without carrying over Sacrificial hits', () => {
      const database = new ArtCharDatabase(1, new SandboxStorage({}))
      const teamCharId = database.teamChars.new('Xingqiu')
      const teamId = database.teams.new({ loadoutData: [{ teamCharId }] })
      const options = {
        level: 90,
        ascension: 6,
        refinement: 5,
        lock: false,
      } as const
      const sac = database.weapons.new({
        ...options,
        key: 'SacrificialSword',
        location: 'Xingqiu',
      })
      const fav = database.weapons.new({
        ...options,
        key: 'FavoniusSword',
        location: '',
      })
      const replay = teamOptRotationForRun(database, {
        teamId,
        gender: 'F',
        teamOpt: { ...initTeamOpt(), optimizeWeapons: true },
        rotation: {
          names: [{ characterKey: 'Xingqiu', name: 'Xingqiu' }],
          text: 'Xingqiu E E?',
          opener: '',
          timing: { rotations: 1, edits: {} },
          frameData: {},
        },
      })
      const withSac = replay?.forWeapons?.({
        Xingqiu: database.weapons.get(sac),
      })
      const withFav = replay?.forWeapons?.({
        Xingqiu: database.weapons.get(fav),
      })
      const hits = (result: typeof withSac) =>
        (result?.attacks.Xingqiu ?? []).reduce(
          (sum, attack) => sum + (attack.hits ?? 1),
          0
        )
      expect(hits(withSac)).toBeGreaterThan(3)
      expect(hits(withFav)).toBe(2)
      expect(replay?.forWeapons?.({ Xingqiu: database.weapons.get(fav) })).toBe(
        withFav
      )
    })

    it('skips a missed extra Skill immediately and omits its hits and particles', () => {
      const config = {
        rotation: parseRotation('Xingqiu E E?', [
          { characterKey: 'Xingqiu', name: 'Xingqiu' },
        ]),
        members: ['Xingqiu'] as CharacterKey[],
        constellations: {},
        elements: { Xingqiu: 'hydro' as const },
        repeats: 1,
        gear: { Xingqiu: { weapon: 'SacrificialSword', refinement: 5 } },
      }
      const miss = simulateRotation({
        ...config,
        sacrificialRandom: () => 0.99,
      })
      const hit = simulateRotation({ ...config, sacrificialRandom: () => 0.79 })
      const baseline = simulateRotation({ ...config, sacrificial: false })
      expect(miss.frames).toBe(baseline.frames)
      expect(miss.stalls).toEqual({})
      expect(miss.optionalSkills?.map((step) => step.played)).toEqual([false])
      expect(hit.optionalSkills?.map((step) => step.played)).toEqual([true])
      expect(hit.skillUses).toHaveLength(2)
      expect(miss.skillUses).toHaveLength(1)
      expect(hit.hits.filter((event) => event.tag === 'skill')).toHaveLength(4)
      expect(miss.hits.filter((event) => event.tag === 'skill')).toHaveLength(2)
      expect(
        energyFromRotation(hit, config.members).members.Xingqiu?.skillUses
      ).toBe(2)
      expect(
        energyFromRotation(miss, config.members).members.Xingqiu?.skillUses
      ).toBe(1)
    })

    it.each([
      [1, 0.64],
      [5, 0.96],
    ])('rolls each Xingqiu hit independently at R%i', (refinement, expected) => {
      const result = simulateRotationSamples(
        {
          rotation: parseRotation('Xingqiu E E?', [
            { characterKey: 'Xingqiu', name: 'Xingqiu' },
          ]),
          members: ['Xingqiu'],
          constellations: {},
          elements: { Xingqiu: 'hydro' },
          repeats: 1,
          gear: { Xingqiu: { weapon: 'SacrificialSword', refinement } },
        },
        256
      )
      const chance = result.samples!.reduce(
        (sum, sample) =>
          sum +
          (sample.result.optionalSkills?.[0]?.played ? sample.probability : 0),
        0
      )
      expect(Math.abs(chance - expected)).toBeLessThan(0.05)
    })

    it('restores a charge even if Sucrose can already use her Skill', () => {
      const config = {
        rotation: parseRotation('Sucrose E E E?', [
          { characterKey: 'Sucrose', name: 'Sucrose' },
        ]),
        members: ['Sucrose'] as CharacterKey[],
        constellations: { Sucrose: 1 },
        elements: { Sucrose: 'anemo' as const },
        repeats: 1,
        gear: { Sucrose: { weapon: 'SacrificialFragments', refinement: 5 } },
      }
      const hit = simulateRotation({ ...config, sacrificialRandom: () => 0 })
      expect(hit.skillUses).toHaveLength(3)
      expect(hit.stalls).toEqual({})
      expect(
        simulateRotation({ ...config, sacrificial: false }).skillUses
      ).toHaveLength(2)
    })

    it('can spend the weapon cooldown on a delayed on-field hit with no Skill to reset', () => {
      const kit: KitModel = {
        characterKey: 'Mona',
        element: 'hydro',
        source: 'test',
        act(ctx, _state, action) {
          if (action.kind === 'burst') return { frames: 40 }
          for (const delay of [1, 12])
            ctx.hit(delay, {
              path: ['skill', 'test'],
              tag: 'skill',
              element: 'hydro',
              label: 'Delayed damage',
            })
          return {
            frames: 20,
            cooldown: { key: 'skill', frames: 480, delay: 8 },
          }
        },
      }
      const result = simulateRotation({
        rotation: parseRotation('Mona E Q E?', [
          { characterKey: 'Mona', name: 'Mona' },
        ]),
        members: ['Mona'],
        constellations: {},
        elements: { Mona: 'hydro' },
        repeats: 1,
        kits: { Mona: kit },
        gear: { Mona: { weapon: 'SacrificialFragments', refinement: 3 } },
        sacrificialRandom: () => 0,
      })
      expect(result.optionalSkills?.[0]?.played).toBe(false)
    })

    it('keeps the weapon cooldown across loops', () => {
      const config = {
        rotation: parseRotation('Diona hE hE? W12 -> Diona', [
          { characterKey: 'Diona', name: 'Diona' },
        ]),
        members: ['Diona'] as CharacterKey[],
        constellations: {},
        elements: { Diona: 'cryo' as const },
        repeats: 3,
        keep: 'all' as const,
        gear: { Diona: { weapon: 'SacrificialBow', refinement: 1 } },
        sacrificialRandom: () => 0,
      }
      const played = simulateRotation(config)
      expect(played.optionalSkills?.map((step) => step.played)).toEqual([
        true,
        false,
        true,
      ])
    })

    it('skips rolls when Diona swaps before her paws land', () => {
      const roll = vi.fn(() => 0)
      const members: CharacterKey[] = ['Diona', 'Bennett']
      const sim = simulateRotation({
        rotation: parseRotation(
          'Diona hE -> Bennett E -> Diona hE?',
          members.map((characterKey) => ({ characterKey, name: characterKey }))
        ),
        members,
        constellations: {},
        elements: { Diona: 'cryo', Bennett: 'pyro' },
        repeats: 1,
        swapFrames: 0,
        gear: { Diona: { weapon: 'SacrificialBow', refinement: 5 } },
        sacrificialRandom: roll,
      })
      expect(sim.hits.filter((hit) => hit.label === 'Icy Paw')).toHaveLength(5)
      expect(roll).not.toHaveBeenCalled()
      expect(sim.optionalSkills?.[0]?.played).toBe(false)
    })
  })
})

describe('Hakushin Ring', () => {
  it('expires after six seconds and overrides a saved always-on conditional', () => {
    const kit: KitModel = {
      characterKey: 'Nahida',
      element: 'dendro',
      source: 'test',
      act(ctx) {
        ctx.hit(0, {
          path: ['_reaction', 'quicken'],
          tag: 'other',
          element: 'dendro',
          label: 'Quicken',
        })
        for (const t of [20, 400])
          ctx.hit(t, {
            path: ['skill', 'press'],
            tag: 'skill',
            element: 'dendro',
            label: 'Skill',
          })
        return { frames: 500 }
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation('Nahida E', [
        { characterKey: 'Nahida', name: 'Nahida' },
      ]),
      members: ['Nahida'],
      constellations: {},
      elements: { Nahida: 'dendro' },
      repeats: 1,
      kits: { Nahida: kit },
      reactions: { onHit() {} },
      gear: { Nahida: { weapon: 'HakushinRing', refinement: 5 } },
    })
    const attacks = rotationAttacks(sim, () => 'dendro').Nahida!
    expect(attacks).toHaveLength(2)
    expect(
      attacks[0].limits?.filter((l) => l.path[0] === 'HakushinRing')
    ).toEqual([])
    expect(attacks[1].limits).toContainEqual({
      owner: 'Nahida',
      path: ['HakushinRing', 'SakuraSaiguu'],
      hits: 0,
    })
  })
})
