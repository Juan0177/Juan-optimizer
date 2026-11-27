// @vitest-environment jsdom
/**
 * An automatic opener omits Bursts. A written opener can require a Burst at a particular time.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import {
  ArtCharDatabase,
  defaultTeamOptKqm,
  initTeamOpt,
  validateTeamOpt,
} from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  solverEnergyTargets,
  teamOptMembers,
  UNREACHABLE_OPENING_ER,
  withRotationEnergy,
  writtenKqmReplay,
} from '@genshin-optimizer/gi/ui'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { simulateWritten, teamRotationEnergy } from './RotationWriter'

const MEMBERS: CharacterKey[] = ['Bennett', 'Sucrose']
const stored = new Map<string, string>()
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, String(v)),
      removeItem: (k: string) => stored.delete(k),
      clear: () => stored.clear(),
      key: (i: number) => [...stored.keys()][i] ?? null,
      get length() {
        return stored.size
      },
    },
  })
})
afterAll(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
})

describe('the first rotation from no energy', () => {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const key of MEMBERS)
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 0,
    })
  const ids = MEMBERS.map((k) => database.teamChars.new(k))
  const teamId = database.teams.new({
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
  })
  const members = teamOptMembers(database, teamId)
  const playArgs = {
    timing: { edits: {} },
    frameData: {},
    team: {
      members: MEMBERS,
      constellations: {},
      elements: Object.fromEntries(
        MEMBERS.map((m) => [m, getCharEle(m)])
      ) as never,
      gear: {},
    },
    names: MEMBERS.map((characterKey) => ({
      characterKey,
      name: characterKey,
    })),
    members,
    database: database as never,
    teamId,
    gender: 'F' as const,
    openerWarning: (w: string) => w,
  }
  const play = (text: string, withoutBursts: boolean) =>
    simulateWritten({
      ...playArgs,
      text,
      opener: '',
      repeats: 1,
      keep: 'all',
      withoutBursts,
    })!
  it('leaves out a Skill not ready again, instead of waiting for it', () => {
    const text = 'Bennett E Q E -> Sucrose N1'
    const opening = play(text, true)
    const skills = opening.sim!.actions.filter(
      (a) => a.characterKey === 'Bennett' && a.text === 'E'
    )
    expect(skills.length).toBe(1)
    expect(Object.keys(opening.sim!.stalls ?? {})).toEqual([])
    // (with its Burst it waits for the Skill, as written)
    const played = play(text, false)
    expect(
      played.sim!.actions.filter(
        (a) => a.characterKey === 'Bennett' && a.text === 'E'
      ).length
    ).toBe(2)
  })
  it('plays a Burst’s alternative ("Q/N1") in its place', () => {
    const opening = play('Bennett E Q/N1 -> Sucrose N1', true)
    expect(
      opening.sim!.actions.some(
        (a) => a.characterKey === 'Bennett' && a.text === 'N1'
      )
    ).toBe(true)
    expect(opening.sim!.actions.some((a) => a.text === 'Q')).toBe(false)
  })
  it('plays the explicit zero-Energy opener instead of stripping its required Burst', () => {
    const opening = simulateWritten({
      ...playArgs,
      text: 'Bennett N1 W10',
      opener: 'Bennett E W2 Q',
      startingEmpty: 'first',
      repeats: 1,
    })
    expect(opening?.sim?.actions.map((a) => a.text)).toEqual(['E', 'Q'])
  })

  const estimate = (opener: string, fullEnergy: boolean) => {
    database.teams.set(teamId, { fightSettings: { fullEnergy } })
    const replay = teamRotationEnergy({
      ...playArgs,
      text: 'Bennett E W6 E W2 Q W12 -> Sucrose N1',
      saved: { opener, timing: playArgs.timing, frameData: {} },
    })!
    const calculator = withRotationEnergy(
      {
        ...defaultEnergyCalculator(MEMBERS, replay.rotationTime),
        enemyParticles: 0,
      },
      MEMBERS,
      replay.energy
    )
    return calculateEnergyRecharge(MEMBERS, calculator, {})
  }

  it('raises ER to the timed opener requirement for a custom enemy', () => {
    const startFull = estimate('Bennett E W2 Q', true)
    const startEmpty = estimate('Bennett E W2 Q', false)
    expect(startFull.opening).toBeUndefined()
    expect(startEmpty.opening?.Bennett?.castTime).toBeGreaterThan(2)
    expect(startEmpty.opening?.Bennett?.required).toBeGreaterThan(
      startFull.targets.Bennett!
    )
    expect(startEmpty.targets.Bennett).toBeGreaterThan(
      startFull.targets.Bennett!
    )
  })

  it('requires the particles to arrive before the cast and permits a fallback', () => {
    const tooEarly = estimate('Bennett E Q', false)
    expect(tooEarly.opening?.Bennett?.required).toBe(Number.POSITIVE_INFINITY)
    expect(tooEarly.targets.Bennett).toBeUndefined()
    expect(solverEnergyTargets(tooEarly).Bennett).toBe(UNREACHABLE_OPENING_ER)
    const fallback = estimate('Bennett E Q/N1 W2', false)
    expect(fallback.targets.Bennett).toBeGreaterThanOrEqual(100)
  })

  it('uses the KQM tab’s custom enemy and preserves the timed requirements in saved settings', () => {
    database.teams.set(teamId, { fightSettings: { fullEnergy: true } })
    const teamOpt = {
      ...initTeamOpt(),
      kqm: {
        ...defaultTeamOptKqm,
        enemy: { enemyOverride: {}, fightSettings: { fullEnergy: false } },
      },
    }
    const replay = writtenKqmReplay({
      ...playArgs,
      teamOpt,
      text: 'Bennett E W6 E W2 Q W12 -> Sucrose N1',
      opener: 'Bennett E W2 Q',
      frameData: {},
    })!({ constellations: {}, gear: {}, overrides: {} })
    const calculator = withRotationEnergy(
      defaultEnergyCalculator(MEMBERS, replay.rotationTime),
      MEMBERS,
      replay.energy
    )
    const restored = validateTeamOpt({
      ...teamOpt,
      kqm: { ...teamOpt.kqm, energyCalculator: calculator },
    })
    expect(restored?.kqm?.energyCalculator?.opening?.[0]).toMatchObject({
      characterKey: 'Bennett',
      cost: 60,
    })
    expect(
      calculateEnergyRecharge(MEMBERS, restored!.kqm!.energyCalculator!, {})
        .opening?.Bennett?.required
    ).toBeGreaterThan(100)
  })
})
