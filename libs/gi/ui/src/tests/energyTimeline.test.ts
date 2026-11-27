import type { TeamEnergyEvent, TeamEnergyTrace } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  solverEnergyTargets,
  timedEnergyStatus,
  UNREACHABLE_OPENING_ER,
} from '../util/teamOpt/energyCalc'
import { trackEnergyRecharge } from '../util/teamOpt/energyTimeline'

const members = ['Bennett'] as const
const cast = (frame: number, drainDelay?: number): TeamEnergyEvent => ({
  kind: 'burst',
  frame,
  character: 'Bennett',
  amount: 60,
  drainDelay,
})
const particles = (frame: number, amount: number): TeamEnergyEvent => ({
  kind: 'particle',
  frame,
  amount,
  catcher: 'Bennett',
  element: 'pyro',
})
const trace = (events: TeamEnergyEvent[], repeat = true): TeamEnergyTrace => ({
  members: [...members],
  frames: 600,
  repeat,
  active: [{ frame: 0, character: 'Bennett' }],
  events,
})
const settings = () => ({
  ...defaultEnergyCalculator(members, 10),
  enemyParticles: 0,
})

describe('the written rotation Energy gauge', () => {
  it('sizes ER for the tightest interval across the loop boundary', () => {
    const rotation = trace([
      cast(0),
      particles(100, 10),
      cast(290),
      particles(500, 5),
    ])
    expect(
      trackEnergyRecharge(rotation, settings(), {}, false).Bennett?.required
    ).toBe(400)
  })

  it('requires enough for the input and only releases capacity at the drain frame', () => {
    const events = [
      particles(10, 10),
      cast(70, 36),
      particles(90, 20),
      cast(220),
    ]
    const opening = trace(events, false)
    expect(
      trackEnergyRecharge(opening, settings(), {}, true).Bennett?.required
    ).toBe(Number.POSITIVE_INFINITY)
    const later = trace(
      [particles(10, 10), cast(70, 36), particles(120, 20), cast(220)],
      false
    )
    expect(
      trackEnergyRecharge(later, settings(), {}, true).Bennett?.required
    ).toBe(200)
  })

  it('rejects gradual Energy loss in a repeating partial-Burst rotation', () => {
    const rotation = trace([
      { ...cast(50), amount: 30 } as TeamEnergyEvent,
      particles(300, 5),
    ])
    expect(
      trackEnergyRecharge(rotation, settings(), {}, false).Bennett?.required
    ).toBe(200)
  })

  it('applies the timed minimum and retains the averaged target for comparison', () => {
    const rotation = trace([
      cast(0),
      particles(100, 10),
      cast(290),
      particles(500, 5),
    ])
    const config = settings()
    config.rng = 'average'
    config.members.Bennett!.skillUses = 6
    config.members.Bennett!.burstEvery = 0.5
    const previous = calculateEnergyRecharge(members, config)
    config.timeline = { rotation }
    expect(calculateEnergyRecharge(members, config)).toEqual(previous)
    config.method = 'timed'
    const next = calculateEnergyRecharge(members, config)
    expect(next.targets.Bennett).toBe(400)
    expect(next.averageTargets).toEqual(previous.targets)
    config.members.Bennett!.edited = ['skillUses']
    expect(calculateEnergyRecharge(members, config).targets).toEqual(
      previous.targets
    )
  })

  it('keeps overrides and only uses a timed trace for the current team and Burst schedule', () => {
    const config = settings()
    config.method = 'timed'
    const rotation = trace([particles(10, 10), cast(70)])
    config.timeline = { rotation }
    expect(timedEnergyStatus(['Bennett', 'Sucrose'], config)).toBe('noRotation')
    config.edited = ['electroInterval']
    expect(timedEnergyStatus(members, config)).toBe('editedSources')
    config.edited = undefined
    rotation.pendingOptional = ['Bennett']
    expect(timedEnergyStatus(members, config)).toBe('pendingCadence')
    config.members.Bennett!.edited = ['burstEvery']
    config.members.Bennett!.burstEvery = 1
    expect(timedEnergyStatus(members, config)).toBe('ready')
    config.members.Bennett!.burstEvery = 3
    expect(timedEnergyStatus(members, config)).toBe('pendingCadence')
    rotation.cadence = { Bennett: 3 }
    expect(timedEnergyStatus(members, config)).toBe('ready')
    config.members.Bennett!.burstEvery = 0
    expect(timedEnergyStatus(members, config)).toBe('skippedBurst')
  })

  it('lets a full starting gauge pay an early Burst and rejects the same empty start', () => {
    const opening = trace([cast(0), particles(200, 20)], false)
    const config = { ...settings(), method: 'timed' as const }
    const full = calculateEnergyRecharge(members, {
      ...config,
      timeline: { rotation: opening },
    })
    expect(full.targets.Bennett).toBe(100)
    const empty = calculateEnergyRecharge(members, {
      ...config,
      timeline: { opening },
    })
    expect(empty.targets.Bennett).toBeUndefined()
    expect(solverEnergyTargets(empty).Bennett).toBe(UNREACHABLE_OPENING_ER)
  })

  it('credits a particle on the cast frame and respects the selected particle RNG', () => {
    const opening = trace(
      [{ ...particles(180, 20), variance: 0.25 } as TeamEnergyEvent, cast(180)],
      false
    )
    const config = {
      ...settings(),
      method: 'timed' as const,
      timeline: { opening },
    }
    const average = calculateEnergyRecharge(members, {
      ...config,
      rng: 'average',
    })
    expect(average.opening?.Bennett).toEqual({ required: 100, castTime: 3 })
    const worst = calculateEnergyRecharge(members, { ...config, rng: 'worst' })
    expect(worst.targets.Bennett).toBe(133.4)
  })

  it('counts only timely, equipped Favonius procs and applies refinement', () => {
    const opening = trace(
      [
        particles(30, 10),
        { kind: 'favonius', frame: 60, character: 'Bennett' },
        cast(240),
        { kind: 'favonius', frame: 260, character: 'Bennett' },
      ],
      false
    )
    const bare = trackEnergyRecharge(opening, settings(), {}, true)
    const favonius = { weapons: { Bennett: 'FavoniusSword' as const } }
    const first = trackEnergyRecharge(
      opening,
      settings(),
      { ...favonius, refinements: { Bennett: 1 } },
      true
    )
    const fifth = trackEnergyRecharge(
      opening,
      settings(),
      { ...favonius, refinements: { Bennett: 5 } },
      true
    )
    expect(bare.Bennett?.required).toBe(200)
    expect(first.Bennett?.required).toBe(188.7)
    expect(fifth.Bennett?.required).toBe(181.9)
  })

  it('floors the weapon drain at zero and credits only the refund ticks before the Burst', () => {
    const opening: TeamEnergyTrace = {
      members: ['Xiangling'],
      frames: 600,
      repeat: false,
      active: [{ frame: 0, character: 'Xiangling' }],
      events: [
        {
          kind: 'weapon',
          frame: 0,
          character: 'Xiangling',
          weapon: 'KitainCrossSpear',
        },
        { ...particles(150, 10), catcher: 'Xiangling', kind: 'particle' },
        { kind: 'burst', frame: 300, character: 'Xiangling', amount: 80 },
      ],
    }
    const config = {
      ...defaultEnergyCalculator(opening.members, 10),
      enemyParticles: 0,
    }
    expect(
      trackEnergyRecharge(opening, config, {}, true).Xiangling?.required
    ).toBe(266.7)
    expect(
      trackEnergyRecharge(
        opening,
        config,
        {
          weapons: { Xiangling: 'KitainCrossSpear' },
          refinements: { Xiangling: 5 },
        },
        true
      ).Xiangling?.required
    ).toBe(233.4)
  })
})
