import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamEnergyTrace,
  TeamOptEnergyCalculator,
} from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import {
  energyCalcData,
  energyWeaponFlat,
  energyWeaponPerBurst,
  energyWeaponTeam,
  favoniusChance,
  favoniusCooldown,
  isCalcEnergyWeapon,
  isFavonius,
  particleDelay,
  SCALED_ENERGY,
} from './energyCalc'

type TeamValues<T> = Partial<Record<CharacterKey, T>>
export interface TrackedEnergyRequirement {
  required: number
  castTime?: number
}
type Requirements = TeamValues<TrackedEnergyRequirement>
type Loadout = {
  weapons?: TeamValues<WeaponKey>
  refinements?: TeamValues<number>
  sets?: TeamValues<Partial<Record<string, number>>>
}

/** On-field member when an event lands, after a same-frame swap. */
function catcherAt(trace: TeamEnergyTrace, frame: number) {
  const at = trace.repeat ? frame % trace.frames : frame
  let catcher = trace.members[0]
  for (const { frame, character } of trace.active) {
    if (frame > at) break
    catcher = character
  }
  return catcher
}

interface GaugeEvent {
  frame: number
  /** Arrivals are available to the cast. A cast's own immediate refunds follow it. */
  order: 0 | 1 | 2
  cost?: number
  minimum?: number
  flat?: number
  perEr?: number
  giver?: CharacterKey
}

function gaugeEvents(
  trace: TeamEnergyTrace,
  settings: TeamOptEnergyCalculator,
  { weapons, refinements, sets }: Loadout,
  opening: boolean
) {
  const keys = trace.members
  const by = new Map(keys.map((key) => [key, [] as GaugeEvent[]]))
  const elements = Object.fromEntries(keys.map((key) => [key, getCharEle(key)]))
  const offField = 1 - 0.1 * keys.length
  const rng = settings.rng === 'worst' ? 1 : settings.rng === 'safe' ? 0.5 : 0
  const frameInTrace = (frame: number) =>
    trace.repeat ? frame % trace.frames : frame
  const add = (character: CharacterKey, event: GaugeEvent) => {
    const frame = frameInTrace(event.frame)
    if (frame < trace.frames) by.get(character)?.push({ ...event, frame })
  }
  const flat = (
    character: CharacterKey,
    frame: number,
    amount: number,
    giver?: CharacterKey
  ) => {
    if (amount) add(character, { frame, order: 2, flat: amount, giver })
  }
  const particles = (
    frame: number,
    amount: number,
    catcher: CharacterKey,
    element?: string
  ) => {
    if (amount <= 0) return
    for (const character of keys) {
      const perEr =
        amount *
        (element ? (elements[character] === element ? 3 : 1) : 2) *
        (character === catcher ? 1 : offField)
      add(character, {
        frame,
        order: 0,
        perEr,
        flat: perEr * (energyCalcData[character]?.erDiscount ?? 0),
      })
    }
  }
  const burstRefunds: { frame: number; character: CharacterKey }[] = []
  const favonius = new Map<CharacterKey, number[]>()
  const electro = keys.filter((key) => elements[key] === 'electro')
  const resonance =
    keys.length === 4 &&
    electro.length >= 2 &&
    keys.some((key) =>
      ['pyro', 'hydro', 'cryo', 'dendro'].includes(elements[key])
    )
  for (const event of trace.events) {
    const { frame } = event
    switch (event.kind) {
      case 'particle':
        particles(
          frame,
          event.amount * (1 - (event.variance ?? 0) * rng),
          event.catcher,
          event.element
        )
        break
      case 'flat':
        flat(event.character, frame, event.amount, event.giver)
        break
      case 'burst': {
        const { character, amount } = event
        if (amount && event.drainDelay) {
          add(character, { frame, order: 1, minimum: amount })
          flat(character, frame + event.drainDelay, -amount)
        } else if (amount) add(character, { frame, order: 1, cost: amount })
        if (energyWeaponPerBurst(weapons?.[character]))
          for (const wait of [120, 240, 360])
            flat(
              character,
              frame + wait,
              energyWeaponFlat(weapons?.[character], refinements?.[character]) /
                3
            )
        if ((sets?.[character]?.['TheExile'] ?? 0) >= 4)
          burstRefunds.push({ frame, character })
        break
      }
      case 'weapon': {
        const { character, weapon } = event
        if (
          weapons?.[character] !== weapon ||
          (weapon === 'ExaiphanesBlade' && !character.startsWith('Traveler'))
        )
          break
        const own = energyWeaponFlat(weapon, refinements?.[character])
        if (
          weapon === 'KitainCrossSpear' ||
          weapon === 'KatsuragikiriNagamasa'
        ) {
          flat(character, frame, -3)
          for (const wait of [120, 240, 360])
            flat(character, frame + wait, (own + 3) / 3)
        } else flat(character, frame, own)
        for (const recipient of keys)
          if (recipient !== character)
            flat(
              recipient,
              frame,
              energyWeaponTeam(weapon, refinements?.[character])
            )
        break
      }
      case 'favonius': {
        if (!isFavonius(weapons?.[event.character])) break
        let hits = favonius.get(event.character)
        if (!hits) favonius.set(event.character, (hits = []))
        hits.push(frame)
        break
      }
      case 'resonance':
        if (resonance) particles(frame, 1, event.catcher, 'electro')
        break
      case 'nightsoul':
        for (const character of keys)
          if ((sets?.[character]?.['ScrollOfTheHeroOfCinderCity'] ?? 0) >= 2)
            flat(character, frame, 6)
        break
    }
  }
  // The native set ignores another activation while The Exile is still ticking.
  let exileReady = Number.NEGATIVE_INFINITY
  burstRefunds.sort((a, b) => a.frame - b.frame)
  const warmExile = trace.repeat ? Math.ceil(360 / trace.frames) + 1 : 0
  for (let cycle = -warmExile; cycle <= 0; cycle++)
    for (const burst of burstRefunds) {
      const frame = burst.frame + cycle * trace.frames
      if (frame < exileReady) continue
      exileReady = frame + 360
      if (cycle === 0)
        for (const wait of [120, 240, 360])
          for (const character of keys)
            if (character !== burst.character) flat(character, frame + wait, 2)
    }
  for (const [character, hits] of favonius) {
    hits.sort((a, b) => a - b)
    const refinement = refinements?.[character]
    const cooldown = favoniusCooldown(refinement) * 60
    const p = 0.5 * favoniusChance(refinement)
    const procs: { frame: number; chance: number }[] = []
    let expired = 0
    let unavailable = 0
    // Mutually exclusive proc probabilities during a single cooldown. Seed prior cycles so a proc
    // late in a loop can suppress the next loop's early proc. Each proc gives 3 clear particles.
    const warm = trace.repeat ? Math.ceil(cooldown / trace.frames) + 1 : 0
    for (let cycle = -warm; cycle <= 0; cycle++)
      for (const hit of hits) {
        const frame = hit + cycle * trace.frames
        while (
          expired < procs.length &&
          procs[expired].frame + cooldown <= frame
        )
          unavailable -= procs[expired++].chance
        const chance = Math.max(0, 1 - unavailable) * p
        procs.push({ frame, chance })
        unavailable += chance
        if (cycle === 0) {
          const arrival = hit + particleDelay(character)
          particles(arrival, 3 * chance, catcherAt(trace, arrival))
        }
      }
  }
  // The calculator exposes a drop rate, without damage thresholds or a drop schedule.
  // Integrate the expected rate over each active interval, at most a second per installment.
  if (!opening && settings.enemyParticles > 0)
    for (const [i, active] of trace.active.entries()) {
      const end = Math.min(
        trace.frames,
        trace.active[i + 1]?.frame ?? trace.frames
      )
      for (let from = active.frame; from < end; from += 60) {
        const span = Math.min(60, end - from)
        particles(
          from + span / 2,
          (settings.enemyParticles * span) / (60 * settings.clearTime),
          active.character
        )
      }
    }
  for (const events of by.values())
    events.sort((a, b) => a.frame - b.frame || a.order - b.order)
  return by
}

const EPSILON = 1e-8

/** Exact feasibility of the expected-event gauge, including overflow and drains that floor at 0. */
function gaugeRequirement(
  events: readonly GaugeEvent[],
  capacity: number,
  owner: CharacterKey,
  allyER: TeamValues<number>,
  repeat: boolean,
  empty: boolean
): TrackedEnergyRequirement {
  if (!events.some((event) => event.cost || event.minimum))
    return { required: 100 }
  const budget = (er: number, endEnergy: number) => {
    let need = endEnergy
    let frame: number | undefined
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event.cost) {
        if (need <= EPSILON) frame = event.frame
        need += event.cost
      } else if (event.minimum) {
        if (event.minimum > need) frame = event.frame
        need = Math.max(event.minimum, need)
      } else if (need > EPSILON) {
        const scale =
          event.giver === 'Dori'
            ? { flat: 0, perER: 1 }
            : event.giver
              ? SCALED_ENERGY[event.giver]
              : undefined
        const amount =
          event.giver === 'Dori'
            ? Math.min(15, (event.flat ?? 0) * er)
            : scale && event.giver
              ? (event.flat ?? 0) *
                (scale.flat +
                  scale.perER *
                    (event.giver === owner ? er : (allyER[event.giver] ?? 1)))
              : (event.flat ?? 0)
        need = Math.max(0, need - amount - (event.perEr ?? 0) * er)
      }
      if (need > capacity + EPSILON)
        return { need: Number.POSITIVE_INFINITY, frame }
    }
    return { need, frame }
  }
  const check = (er: number) => {
    // Back-propagate the minimum gauge to end the span at zero. The next copy must be able to
    // replenish that minimum. Each reversed step is a translation clamped at zero, so if that
    // requirement grows on the second pass, every further loop would run a deficit.
    const first = budget(er, 0)
    if (empty) return { ok: first.need <= EPSILON, frame: first.frame }
    if (!repeat || !Number.isFinite(first.need))
      return { ok: Number.isFinite(first.need), frame: first.frame }
    const next = budget(er, first.need)
    return {
      ok: next.need <= first.need + EPSILON,
      frame: next.frame ?? first.frame,
    }
  }
  if (check(1).ok) return { required: 100 }
  let low = 1
  let high = 2
  while (high < 1e7 && !check(high).ok) {
    low = high
    high *= 2
  }
  const atHigh = check(high)
  if (!atHigh.ok)
    return {
      required: Number.POSITIVE_INFINITY,
      castTime: (atHigh.frame ?? 0) / 60,
    }
  while (high - low > 0.000001) {
    const mid = (low + high) / 2
    if (check(mid).ok) high = mid
    else low = mid
  }
  return {
    required: Math.ceil((high - 0.000001) * 1000) / 10,
    castTime: (check(low).frame ?? 0) / 60,
  }
}

const cache = new WeakMap<TeamEnergyTrace, Map<string, Requirements>>()

/** For each Burst user, the lowest total ER that pays every required cast on the timeline. */
export function trackEnergyRecharge(
  trace: TeamEnergyTrace,
  settings: TeamOptEnergyCalculator,
  loadout: Loadout,
  opening: boolean
): Requirements {
  const signature = JSON.stringify([
    opening,
    settings.rng,
    settings.enemyParticles,
    settings.clearTime,
    trace.members.map((key) => {
      const weapon = loadout.weapons?.[key]
      return [
        isFavonius(weapon) || isCalcEnergyWeapon(weapon)
          ? [weapon, loadout.refinements?.[key]]
          : undefined,
        (loadout.sets?.[key]?.['TheExile'] ?? 0) >= 4,
        (loadout.sets?.[key]?.['ScrollOfTheHeroOfCinderCity'] ?? 0) >= 2,
      ]
    }),
  ])
  let entries = cache.get(trace)
  if (!entries) cache.set(trace, (entries = new Map()))
  const cached = entries.get(signature)
  if (cached) return cached
  const gauges = gaugeEvents(trace, settings, loadout, opening)
  let result: Requirements = {}
  let er: TeamValues<number> = {}
  const scaled = trace.events.some(
    (event) =>
      event.kind === 'flat' && event.giver && event.character !== event.giver
  )
  for (let pass = 0; pass < (scaled ? 8 : 1); pass++) {
    result = {}
    const next: TeamValues<number> = {}
    for (const [key, events] of gauges) {
      const data = energyCalcData[key]
      if (!data) continue
      const capacity = Math.max(0, data.burstCost - data.burstDiscount)
      const required = gaugeRequirement(
        events,
        capacity,
        key,
        er,
        trace.repeat,
        opening
      )
      result[key] = required
      if (Number.isFinite(required.required))
        next[key] = required.required / 100
    }
    if (trace.members.every((key) => er[key] === next[key])) break
    er = next
  }
  if (entries.size >= 96) entries.delete(entries.keys().next().value!)
  entries.set(signature, result)
  return result
}
