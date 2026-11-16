import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOptEnergyCalculator,
  TeamOptEnergyMember,
  TeamOptEnergyRotationField,
} from '@genshin-optimizer/gi/db'
import { getCharEle, getCharStat } from '@genshin-optimizer/gi/stats'
import particleData from './energyCalcData.json'
import type { SimulationResult } from './rotation/simulate'
import type { SimHit } from './rotation/types'

/** Factual particle data and fixed-rotation equations from the user's ERC 7.3 workbook (v1.59.1). */
export const ENERGY_CALC_SOURCE =
  'https://docs.google.com/spreadsheets/d/1FQSiWb3Di5B8BexdzrbmTWXrONbo30JdBlUSkHfZxJA/edit#gid=613391376'
export const energyCalcData = particleData as Partial<
  Record<
    CharacterKey,
    {
      skills: {
        label: string
        particles: number
        flatEnergy: number
        variance: number
        perSecond: number
        duration: number
        cooldown: number
      }[]
      burstCost: number
      burstDiscount: number
      erDiscount: number
    }
  >
>

export interface EnergyCalcResult {
  targets: Partial<Record<CharacterKey, number>>
  members: Partial<
    Record<
      CharacterKey,
      {
        particleEnergy: number
        flatEnergy: number
        burstCost: number
        required: number
      }
    >
  >
  errors: string[]
}

/**
 * The energy weapons the calculator counts per trigger (a member's "energy weapon triggers"),
 * from their game text: the energy per trigger at R1–R5 (net, for those that cost some first), the
 * effect's cooldown in seconds (triggers per rotation are capped by it), and `team` when the
 * energy goes to each other party member instead of the wielder. Amenoma Kageuchi's trigger is one
 * Succession Seed; The Dockhand's Assistant's and Portable Power Saw's, a use with 3 Symbols.
 * (One weapon per line: the released build leaves out the beta ones.)
 */
const ENERGY_WEAPONS: Partial<
  Record<
    WeaponKey,
    {
      energy: number[]
      cooldown?: number
      team?: true
      /** It triggers on each of the wielder's Bursts (its triggers are its Bursts, not entered) */
      perBurst?: true
    }
  >
> = {
  AmenomaKageuchi: { energy: [6, 7.5, 9, 10.5, 12] },
  KatsuragikiriNagamasa: { energy: [6, 7.5, 9, 10.5, 12] },
  KitainCrossSpear: { energy: [6, 7.5, 9, 10.5, 12] },
  // (gcsim: 4–6 Energy every 2 s for 6 s after each of the wielder's Bursts, on the field)
  PrototypeAmber: { energy: [12, 13.5, 15, 16.5, 18], perBurst: true },
  EverlastingMoonglow: { energy: [0.6, 0.6, 0.6, 0.6, 0.6] },
  AngelosHeptades: { energy: [14, 15, 16, 17, 18], cooldown: 14 },
  BeyondTheChrysalis: { energy: [5, 5.5, 6, 6.5, 7], cooldown: 4 },
  BloodsoakedRuins: { energy: [12, 13, 14, 15, 16], cooldown: 14 },
  CranesEchoingCall: { energy: [2.5, 2.75, 3, 3.25, 3.5], cooldown: 0.7 },
  DialoguesOfTheDesertSages: { energy: [8, 10, 12, 14, 16], cooldown: 10 },
  ExaiphanesBlade: { energy: [3, 3, 5, 5, 5], cooldown: 5 },
  FlameForgedInsight: { energy: [12, 15, 18, 21, 24], cooldown: 15 },
  Frostbreath: { energy: [6, 7.5, 9, 10.5, 12], cooldown: 16, team: true },
  LumidouceElegy: { energy: [12, 13, 14, 15, 16], cooldown: 12 },
  NocturnesCurtainCall: { energy: [14, 15, 16, 17, 18], cooldown: 18 },
  PortablePowerSaw: { energy: [6, 7.5, 9, 10.5, 12], cooldown: 15 },
  RightfulReward: { energy: [8, 10, 12, 14, 16], cooldown: 10 },
  Silverdawn: { energy: [10, 10.5, 11, 11.5, 12], cooldown: 15 },
  SongOfTheVigil: { energy: [4, 5, 6, 7, 8], cooldown: 9 },
  TheDockhandsAssistant: { energy: [6, 7.5, 9, 10.5, 12], cooldown: 15 },
  TomeOfTheEternalFlow: { energy: [8, 9, 10, 11, 12], cooldown: 12 },
  WhitelakeFrostfeather: { energy: [4, 4.5, 5, 5.5, 6], cooldown: 3.5 },
}
const energyOf = (key: WeaponKey | undefined, refinement = 1) => {
  const weapon = key && ENERGY_WEAPONS[key]
  if (!weapon) return 0
  return weapon.energy[Math.min(5, Math.max(1, Math.round(refinement))) - 1]
}
/** A weapon whose energy the calculator counts per trigger */
export const isCalcEnergyWeapon = (key: WeaponKey | undefined) =>
  !!key && !!ENERGY_WEAPONS[key]
/** The energy a trigger gives its wielder (0 for a weapon whose energy goes to the others) */
export function energyWeaponFlat(
  key: WeaponKey | undefined,
  refinement = 1
): number {
  return key && ENERGY_WEAPONS[key]?.team ? 0 : energyOf(key, refinement)
}
/** The energy a trigger gives each other party member (Frostbreath) */
export const energyWeaponTeam = (key: WeaponKey | undefined, refinement = 1) =>
  key && ENERGY_WEAPONS[key]?.team ? energyOf(key, refinement) : 0
/** A weapon that triggers on each of its wielder's Bursts (Prototype Amber): no triggers to enter */
export const energyWeaponPerBurst = (key: WeaponKey | undefined) =>
  !!key && !!ENERGY_WEAPONS[key]?.perBurst
/** Triggers per rotation, at most as many as the weapon's cooldown allows */
export const energyWeaponTriggers = (
  key: WeaponKey | undefined,
  triggers: number,
  rotationTime: number
) => {
  const cooldown = key ? ENERGY_WEAPONS[key]?.cooldown : undefined
  return cooldown ? Math.min(triggers, rotationTime / cooldown) : triggers
}

export const isFavonius = (key: WeaponKey | undefined) =>
  !!key?.startsWith('Favonius')
/** A Favonius weapon triggers at most once per 12/10.5/9/7.5/6 s (R1–R5). */
export const favoniusCooldown = (refinement = 1) =>
  13.5 - 1.5 * Math.min(5, Math.max(1, Math.round(refinement)))

/** The constellation a skill option needs ("Constellation 2", "C2 proc"); 0 for any other. */
export const energySkillConstellation = (label: string) =>
  Number(/^(?:Constellation |C)(\d)\b/.exec(label)?.[1] ?? 0)

/** Validates all inputs so incomplete settings cannot silently produce an ER target. */
export function calculateEnergyRecharge(
  keys: readonly CharacterKey[],
  settings: TeamOptEnergyCalculator,
  /**
   * The members' actual weapons (KQM's picks): Favonius particles then count only for a
   * Favonius wielder (at most once per its cooldown), weapon flat energy only for an energy
   * weapon. Absent: Favonius triggers count as entered and no weapon gives flat energy.
   */
  weapons?: Partial<Record<CharacterKey, WeaponKey>>,
  refinements?: Partial<Record<CharacterKey, number>>,
  /**
   * The members' artifact sets (KQM's picks): The Exile's 4-piece gives the others energy on the
   * wearer's Burst. Absent: none.
   */
  sets?: Partial<Record<CharacterKey, Partial<Record<string, number>>>>
): EnergyCalcResult {
  const result: EnergyCalcResult = { targets: {}, members: {}, errors: [] }
  const finite = (n: number, min: number, max = Number.POSITIVE_INFINITY) =>
    Number.isFinite(n) && n >= min && n <= max
  if (
    !finite(settings.rotationTime, 0.1) ||
    !finite(settings.clearTime, 0.1) ||
    !finite(settings.enemyParticles, 0) ||
    !finite(settings.electroInterval, 0)
  )
    result.errors.push('Check rotation time, clear time and enemy particles.')
  const fieldSum = keys.reduce(
    (n, key) => n + (settings.members[key]?.fieldTime ?? 0),
    0
  )
  if (Math.abs(fieldSum - 100) > 0.1)
    result.errors.push('Field time must add up to 100%.')
  for (const key of keys) {
    const member = settings.members[key]
    const data = energyCalcData[key]
    if (!member || !data) {
      result.errors.push(`Particle data or inputs are missing for ${key}.`)
      continue
    }
    if (
      !finite(member.fieldTime, 0, 100) ||
      !finite(member.burstEvery, 0) ||
      !finite(member.skillUses, 0) ||
      !finite(member.secondaryUses, 0) ||
      !finite(member.funnelShare, 0, 100) ||
      !finite(member.favoniusProcs, 0) ||
      !finite(member.weaponEnergyTriggers ?? 0, 0) ||
      !Number.isFinite(member.flatEnergy) ||
      !Number.isInteger(member.skillMode) ||
      !data.skills[member.skillMode] ||
      !Number.isInteger(member.secondaryMode) ||
      !data.skills[member.secondaryMode] ||
      (member.catchBy && !keys.includes(member.catchBy)) ||
      (member.favoniusCatchBy && !keys.includes(member.favoniusCatchBy))
    )
      result.errors.push(`Check the energy inputs for ${key}.`)
  }
  if (result.errors.length) return result
  const rng = settings.rng === 'worst' ? 1 : settings.rng === 'safe' ? 0.5 : 0
  // Off field, a member gets 60% of a particle's energy in a party of 4 (70% of 3, 80% of 2).
  const offField = 1 - 0.1 * Math.min(4, Math.max(2, keys.length))
  /** A particle's share of its energy for a member on the field `caught` of the time */
  const share = (caught: number) => offField + (1 - offField) * caught
  // (elemental resonance needs a party of four)
  const hasElectroResonance =
    keys.length === 4 &&
    keys.filter((key) => getCharEle(key) === 'electro').length >= 2 &&
    keys.some((key) =>
      ['pyro', 'hydro', 'cryo', 'dendro'].includes(getCharEle(key))
    )
  for (const recipient of keys) {
    const own = settings.members[recipient]!
    const ownData = energyCalcData[recipient]!
    const field = own.fieldTime / 100
    // A skill's particles are of its element: 3 energy to a matching member, 1 to another.
    const elementValue = (source: CharacterKey) =>
      getCharEle(source) === getCharEle(recipient) ? 3 : 1
    let particles = 0
    for (const source of keys) {
      const member = settings.members[source]!
      const data = energyCalcData[source]!
      const modes = [
        { mode: member.skillMode, uses: member.skillUses },
        { mode: member.secondaryMode, uses: member.secondaryUses },
      ]
      let turretTime = 0
      for (const [i, { mode, uses }] of modes.entries()) {
        const skill = data.skills[mode]
        // Fischl's burst also summons Oz. Kokomi's refresh extends her existing turret.
        // (once per burst: with the primary skill only, even when the second one is the same)
        const burstSummons =
          i === 0 &&
          (source === 'Fischl' ||
            (source === 'SangonomiyaKokomi' && skill.label === 'Refresh')) &&
          member.burstEvery > 0
            ? 1 / member.burstEvery
            : 0
        const uptime = Math.min(
          skill.duration * (uses + burstSummons),
          Math.max(0, settings.rotationTime - turretTime)
        )
        const isTurret = skill.perSecond > 0
        if (isTurret) turretTime += uptime
        const count =
          (isTurret ? skill.perSecond * uptime : skill.particles * uses) *
          (1 - skill.variance * rng)
        const catchBy = member.catchBy ?? source
        const fed = member.funnelShare / 100
        const caught = isTurret
          ? field
          : (recipient === catchBy ? fed : 0) +
            (recipient === source ? 1 - fed : 0)
        particles += count * elementValue(source) * share(caught)
      }
      // A Favonius trigger makes 3 clear particles (2 energy each on the field) for whoever
      // is on the field then.
      const weapon = weapons?.[source]
      const favoniusProcs = !weapons
        ? member.favoniusProcs
        : isFavonius(weapon)
          ? Math.min(
              member.favoniusProcs,
              settings.rotationTime / favoniusCooldown(refinements?.[source])
            )
          : 0
      particles +=
        3 *
        favoniusProcs *
        2 *
        share(recipient === (member.favoniusCatchBy ?? source) ? 1 : 0)
    }
    particles +=
      (settings.enemyParticles * 2 * share(field) * settings.rotationTime) /
      settings.clearTime
    if (hasElectroResonance && settings.electroInterval > 0)
      particles +=
        (settings.rotationTime / Math.max(5, settings.electroInterval)) *
        (getCharEle(recipient) === 'electro' ? 3 : 1) *
        share(field)
    // Dori's A4 converts each skill use into energy that scales with her ER.
    if (recipient === 'Dori')
      particles += 5 * (own.skillUses + own.secondaryUses)
    // a weapon's energy per trigger: the wielder's own, and the energy given to the party by
    // the others' (Frostbreath)
    const weaponTriggers = (member: CharacterKey) => {
      // (Prototype Amber: once per Burst of its wielder, whatever was entered)
      if (energyWeaponPerBurst(weapons?.[member])) {
        const every = settings.members[member]?.burstEvery ?? 0
        return every > 0 ? 1 / every : 0
      }
      // (triggers set by hand, else the rotation's for the weapon it holds)
      const inputs = settings.members[member]
      const weapon = weapons?.[member]
      const entered =
        (inputs?.weaponEnergyTriggers ?? 0) > 0
          ? inputs!.weaponEnergyTriggers
          : ((weapon && inputs?.weaponTriggers?.[weapon]) ?? 0)
      return energyWeaponTriggers(weapon, entered, settings.rotationTime)
    }
    const teamWeaponEnergy = keys
      .filter((k) => k !== recipient)
      .reduce(
        (n, k) =>
          n +
          energyWeaponTeam(weapons?.[k], refinements?.[k]) * weaponTriggers(k),
        0
      )
    // The Exile (gcsim exile.go): the wearer's Burst gives every other member 2 Energy every 2 s
    // for 6 s; it does not stack (the most from one wearer)
    const exileEnergy = Math.max(
      0,
      ...keys
        .filter((k) => k !== recipient && (sets?.[k]?.['TheExile'] ?? 0) >= 4)
        .map((k) => {
          const every = settings.members[k]?.burstEvery ?? 0
          return every > 0 ? 6 / every : 0
        })
    )
    const flat =
      own.flatEnergy +
      exileEnergy +
      energyWeaponFlat(weapons?.[recipient], refinements?.[recipient]) *
        weaponTriggers(recipient) +
      teamWeaponEnergy +
      ownData.skills[own.skillMode].flatEnergy * own.skillUses +
      ownData.skills[own.secondaryMode].flatEnergy * own.secondaryUses
    const cost = Math.max(0, ownData.burstCost - ownData.burstDiscount)
    // (without the Burst, still the energy it spends: Varesa's Kablam is -30 a use)
    const needed =
      (own.burstEvery === 0 || cost === 0 ? 0 : cost / own.burstEvery) - flat
    const required =
      needed <= 0
        ? 100
        : particles > 0
          ? Math.max(100, (needed / particles - ownData.erDiscount) * 100)
          : Number.POSITIVE_INFINITY
    result.members[recipient] = {
      particleEnergy: particles,
      flatEnergy: flat,
      burstCost: cost,
      required,
    }
    if (!Number.isFinite(required))
      result.errors.push(
        `${recipient} has no particle energy. Add particle sources or disable its burst.`
      )
    else result.targets[recipient] = Math.ceil(required * 10 - 1e-9) / 10
  }
  return result
}

/**
 * Before KQM picks the weapons, the weapons an estimate assumes: per member, from the weapons it
 * may use, a Favonius one when it has Favonius triggers, else an energy weapon when it has
 * energy weapon triggers. With none allowed, those triggers count for nothing (as in the run).
 */
export function energyCalcWeapons(
  keys: readonly CharacterKey[],
  settings: TeamOptEnergyCalculator,
  allowed: (
    key: CharacterKey
  ) => readonly { key: WeaponKey; refinement: number }[]
) {
  const weapons: Partial<Record<CharacterKey, WeaponKey>> = {}
  const refinements: Partial<Record<CharacterKey, number>> = {}
  for (const key of keys) {
    const member = settings.members[key]
    if (!member) continue
    const candidates = allowed(key)
    // (Favonius triggers filled in from the rotation are what a Favonius would give: assumed
    // held only when set by hand; KQM's runs count it for the builds that do hold one)
    const weapon =
      (member.favoniusProcs > 0 && member.edited?.includes('favoniusProcs')
        ? candidates.find((w) => isFavonius(w.key))
        : undefined) ??
      ((member.weaponEnergyTriggers ?? 0) > 0
        ? candidates.find((w) => isCalcEnergyWeapon(w.key))
        : undefined)
    if (!weapon) continue
    weapons[key] = weapon.key
    refinements[key] = weapon.refinement
  }
  return { weapons, refinements }
}

/** Starting assumptions are visible and editable; skill uses are casts, not damage hits. */
export function defaultEnergyCalculator(
  keys: readonly CharacterKey[],
  rotationTime = 20,
  onField = keys[0],
  /** Per member; absent: KQM's standard (4★ C6, 5★ C0) */
  constellations?: Partial<Record<CharacterKey, number>>
): TeamOptEnergyCalculator {
  return {
    rotationTime,
    clearTime: 90,
    enemyParticles: 9,
    rng: 'safe',
    electroInterval: 0,
    members: Object.fromEntries(
      keys.map((key) => {
        const mode = defaultSkillMode(key, constellations?.[key])
        return [
          key,
          {
            fieldTime:
              keys.length === 1
                ? 100
                : key === onField
                  ? 50
                  : 50 / (keys.length - 1),
            burstEvery: energyCalcData[key]?.burstCost === 0 ? 0 : 1,
            skillMode: mode,
            skillUses: START_USES[key] ?? 1,
            secondaryMode: mode,
            secondaryUses: 0,
            catchBy: key,
            funnelShare: 100,
            favoniusProcs: 0,
            weaponEnergyTriggers: 0,
            favoniusCatchBy: key,
            flatEnergy: SKILL_FLAT_ENERGY[key] ?? START_BONUS[key] ?? 0,
          },
        ]
      })
    ),
  }
}

/** The "Constellation N" option for the member's constellation (others are extra uses, like "C2 proc") */
function defaultSkillMode(key: CharacterKey, constellation?: number) {
  const cons = constellation ?? (getCharStat(key).rarity === 4 ? 6 : 0)
  let mode = 0
  energyCalcData[key]?.skills.forEach((skill, i) => {
    if (
      skill.label.startsWith('Constellation ') &&
      energySkillConstellation(skill.label) <= cons
    )
      mode = i
  })
  return mode
}

/**
 * Saved calculator settings for the team as it is now: members added since get the starting
 * assumptions (and the field time is shared out again), catchers who left are replaced by the
 * member itself, and a skill option the member's constellation does not have by its default.
 */
export function syncEnergyCalculator(
  keys: readonly CharacterKey[],
  saved: TeamOptEnergyCalculator | undefined,
  rotationTime = 20,
  onField = keys[0],
  constellations?: Partial<Record<CharacterKey, number>>
): TeamOptEnergyCalculator {
  const defaults = defaultEnergyCalculator(
    keys,
    rotationTime,
    onField,
    constellations
  )
  if (!saved) return defaults
  const members: TeamOptEnergyCalculator['members'] = {}
  for (const key of keys) {
    const member = { ...(saved.members[key] ?? defaults.members[key]!) }
    const fallback = defaults.members[key]!
    const skills = energyCalcData[key]?.skills ?? []
    const cons = constellations?.[key]
    const usable = (mode: number) =>
      !!skills[mode] &&
      (cons === undefined ||
        energySkillConstellation(skills[mode].label) <= cons)
    if (!usable(member.skillMode)) member.skillMode = fallback.skillMode
    if (!usable(member.secondaryMode))
      member.secondaryMode = fallback.secondaryMode
    if (member.catchBy && !keys.includes(member.catchBy)) member.catchBy = key
    if (member.favoniusCatchBy && !keys.includes(member.favoniusCatchBy))
      member.favoniusCatchBy = key
    members[key] = member
  }
  const changed =
    keys.some((key) => !saved.members[key]) ||
    Object.keys(saved.members).some(
      (key) => !keys.includes(key as CharacterKey)
    )
  const total = keys.reduce((n, key) => n + members[key]!.fieldTime, 0)
  if (changed && Number.isFinite(total) && Math.abs(total - 100) > 0.1)
    for (const key of keys)
      members[key]!.fieldTime =
        total > 0
          ? (members[key]!.fieldTime / total) * 100
          : defaults.members[key]!.fieldTime
  return { ...saved, members }
}

/**
 * Sets a member's field time and shares the rest of the rotation among the others in proportion
 * to their field time (evenly if they had none), so the team's field time stays 100%.
 */
export function withFieldTime(
  settings: TeamOptEnergyCalculator,
  keys: readonly CharacterKey[],
  key: CharacterKey,
  fieldTime: number
): TeamOptEnergyCalculator {
  const member = settings.members[key]
  if (!member) return settings
  if (!Number.isFinite(fieldTime))
    return {
      ...settings,
      members: { ...settings.members, [key]: { ...member, fieldTime } },
    }
  const others = keys.filter((k) => k !== key && settings.members[k])
  const own = others.length ? Math.max(0, Math.min(100, fieldTime)) : 100
  const oldTotal = others.reduce(
    (n, k) => n + (settings.members[k]!.fieldTime || 0),
    0
  )
  const members = { ...settings.members, [key]: { ...member, fieldTime: own } }
  for (const other of others)
    members[other] = {
      ...settings.members[other]!,
      fieldTime:
        (100 - own) *
        (oldTotal > 0
          ? (settings.members[other]!.fieldTime || 0) / oldTotal
          : 1 / others.length),
    }
  return { ...settings, members }
}

/**
 * Energy a Skill use restores directly, not from particles (so not scaled by Energy Recharge): the
 * ERC sheet's "bonus non-particle energy" for these, at Skill level 9 (KQM's guides).
 * Durin: entering Confirmation of Purity or Denial of Darkness, once per 6 s (kqmsim's
 * skillEnergy; 33 at level 10).
 */
export const SKILL_FLAT_ENERGY: Partial<Record<CharacterKey, number>> = {
  Durin: 30,
}

/** gcsim's ParticleDelay: frames from the hit that makes a Skill's particles to their arrival */
const particleDelay = (key: CharacterKey) => (key === 'Bennett' ? 80 : 100)

/** The reactions that make Electro resonance's particle (gcsim's, every 5 s at most) */
const ELECTRO_RESONANCE_REACTIONS = [
  'overloaded',
  'superconduct',
  'stellarConduct',
  'electroCharged',
  'lunarCharged',
  'quicken',
  'aggravate',
  'hyperbloom',
]

/** What a written rotation says about each member's energy inputs (see `energyFromRotation`) */
export interface RotationEnergy {
  /** Seconds between Electro resonance particles (its Electro reactions, 5 s apart at least) */
  electroInterval?: number
  members: Partial<
    Record<
      CharacterKey,
      Partial<Pick<TeamOptEnergyMember, TeamOptEnergyRotationField>>
    >
  >
}

/**
 * Normal and Charged Attack energy (gcsim/kqmsim `SetupOnNormalHitEnergy`, the game's): a hit has
 * a chance to restore 1 flat Energy to its attacker. The chance starts at 0 (10% with a sword),
 * grows by the weapon's step with each miss and is reset by a success or by a swap; a success
 * starts a 12-frame pause for the whole party.
 */
const ATTACK_ENERGY: Record<string, { base: number; step: number }> = {
  sword: { base: 0.1, step: 0.05 },
  claymore: { base: 0, step: 0.1 },
  polearm: { base: 0, step: 0.04 },
  bow: { base: 0, step: 0.05 },
  catalyst: { base: 0, step: 0.1 },
}
/** Runs of the rotation's hits the random energy is averaged over (seeded: the same each time) */
const ATTACK_ENERGY_RUNS = 400

/**
 * Each member's expected Energy a rotation from its Normal and Charged Attack hits in the played
 * rotation (the random energy above, averaged over seeded runs of the same hits)
 */
export function attackEnergyFromRotation(
  sim: Pick<SimulationResult, 'start' | 'frames' | 'hits' | 'swaps'>,
  keys: readonly CharacterKey[],
  rotations = 1
): Partial<Record<CharacterKey, number>> {
  const start = sim.start
  const end = sim.start + sim.frames
  const hits = sim.hits
    .filter(
      (h) =>
        (h.tag === 'normal' || h.tag === 'charged') &&
        !h.path[0].startsWith('_') &&
        keys.includes(h.characterKey) &&
        h.t < end
    )
    .sort((a, b) => a.t - b.t)
  if (!hits.length) return {}
  const swaps = (sim.swaps ?? []).map((s) => s.start).sort((a, b) => a - b)
  const rule = (k: CharacterKey) =>
    ATTACK_ENERGY[getCharStat(k).weaponType] ?? ATTACK_ENERGY['sword']
  const totals = new Map<CharacterKey, number>()
  for (let run = 0; run < ATTACK_ENERGY_RUNS; run++) {
    // (a small seeded generator: mulberry32)
    let seed = (run + 1) * 0x9e3779b9
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296
    }
    const chance = new Map<CharacterKey, number>()
    let pauseUntil = Number.NEGATIVE_INFINITY
    let swap = 0
    for (const h of hits) {
      for (; swap < swaps.length && swaps[swap] <= h.t; swap++) chance.clear()
      if (h.t < pauseUntil) continue
      const k = h.characterKey
      const { base, step } = rule(k)
      const p = chance.get(k) ?? base
      if (random() > p) {
        chance.set(k, p + step)
        continue
      }
      chance.set(k, base)
      pauseUntil = h.t + 12
      if (h.t >= start) totals.set(k, (totals.get(k) ?? 0) + 1)
    }
  }
  const per = Math.max(1, rotations) * ATTACK_ENERGY_RUNS
  return Object.fromEntries(
    [...totals].map(([k, n]) => [k, Math.round((n / per) * 100) / 100])
  )
}

/**
 * Favonius, as the calculator assumes it from a written rotation: R5 (KQM's 4★ refinement: a
 * CRIT hit makes particles every time, once per 6 s), the wielder's hits CRIT half the time.
 * A smaller refinement's longer cooldown is applied by the calculator (`favoniusCooldown`).
 */
/**
 * The reactions that trigger Frostbreath ("a Cryo or Hydro-related elemental reaction", kqmsim's
 * list of events): the simulation's reaction marks, crystallize by the element it consumed
 */
const FROSTBREATH_REACTIONS = new Set([
  'melt',
  'vaporize',
  'frozen',
  'shattered',
  'superconduct',
  'cryoSwirl',
  'hydroSwirl',
  'electroCharged',
  'bloom',
  'lunarCharged',
  'lunarBloom',
  'lunarCrystallize',
  'stellarConduct',
  'stellarSwirl',
])
/** A reaction mark (`_reaction`) of the simulation that triggers Frostbreath */
export const isFrostbreathReaction = (h: SimHit) =>
  h.path[0] === '_reaction' &&
  (FROSTBREATH_REACTIONS.has(h.path[1] ?? '') ||
    (h.path[1] === 'crystallize' &&
      (h.element === 'cryo' || h.element === 'hydro')))

/**
 * Each member's energy weapon triggers a rotation if it held the weapon, as the played rotation
 * has them (the weapons whose trigger it plays), at most once per the weapon's cooldown:
 * Frostbreath, its own Cryo- or Hydro-related reactions
 */
export function weaponTriggersFromRotation(
  sim: Pick<SimulationResult, 'start' | 'frames' | 'hits'>,
  keys: readonly CharacterKey[],
  rotations = 1
): Partial<Record<CharacterKey, Partial<Record<WeaponKey, number>>>> {
  const start = sim.start
  const end = sim.start + sim.frames
  const cooldown = (ENERGY_WEAPONS['Frostbreath']?.cooldown ?? 16) * 60
  const out: Partial<Record<CharacterKey, Partial<Record<WeaponKey, number>>>> =
    {}
  for (const key of keys) {
    const times = sim.hits
      .filter(
        (h) => h.characterKey === key && h.t < end && isFrostbreathReaction(h)
      )
      .map((h) => h.t)
      .sort((a, b) => a - b)
    // (the cooldown runs from before the counted span: the earlier rotations' reactions)
    let ready = Number.NEGATIVE_INFINITY
    let triggers = 0
    for (const t of times) {
      if (t < ready) continue
      ready = t + cooldown
      if (t >= start) triggers++
    }
    out[key] = {
      Frostbreath: Math.round((triggers / Math.max(1, rotations)) * 10) / 10,
    }
  }
  return out
}

const FAVONIUS_ASSUMED = { cooldown: 360, crit: 0.5 }
const FAVONIUS_RUNS = 400

/**
 * Each member's expected Favonius triggers a rotation if it held a Favonius weapon (its own CRIT
 * hits in the played rotation, as `FAVONIUS_ASSUMED`), and who is on the field when the particles
 * of most of them arrive
 */
export function favoniusFromRotation(
  sim: Pick<SimulationResult, 'start' | 'frames' | 'hits'>,
  keys: readonly CharacterKey[],
  rotations = 1,
  onFieldAt: (t: number) => CharacterKey = (t) => keys[0] ?? ('' as never)
): Partial<
  Record<CharacterKey, { procs: number; catchBy: CharacterKey | undefined }>
> {
  const start = sim.start
  const end = sim.start + sim.frames
  const out: Partial<
    Record<CharacterKey, { procs: number; catchBy: CharacterKey | undefined }>
  > = {}
  for (const key of keys) {
    // (its own hits that can CRIT: not the simulation's markers, not the reactions that cannot)
    const hits = sim.hits
      .filter(
        (h) =>
          h.characterKey === key &&
          h.t < end &&
          !h.path[0].startsWith('_') &&
          !(h.path[0] === 'reaction' && !h.path[1]?.startsWith('lunar'))
      )
      .map((h) => h.t)
      .sort((a, b) => a - b)
    if (!hits.length) continue
    let procs = 0
    const caught = new Map<CharacterKey, number>()
    for (let run = 0; run < FAVONIUS_RUNS; run++) {
      // (a small seeded generator: mulberry32)
      let seed = (run + 1) * 0x85ebca6b
      const random = () => {
        seed = (seed + 0x6d2b79f5) | 0
        let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296
      }
      let ready = Number.NEGATIVE_INFINITY
      for (const t of hits) {
        if (t < ready || random() >= FAVONIUS_ASSUMED.crit) continue
        ready = t + FAVONIUS_ASSUMED.cooldown
        if (t < start) continue
        procs++
        const who = onFieldAt(t + particleDelay(key))
        caught.set(who, (caught.get(who) ?? 0) + 1)
      }
    }
    const per = Math.max(1, rotations) * FAVONIUS_RUNS
    const [catchBy] = [...caught].sort((a, b) => b[1] - a[1])[0] ?? []
    out[key] = { procs: Math.round((procs / per) * 10) / 10, catchBy }
  }
  return out
}

/**
 * The ER calculator's inputs as a played rotation has them, per written rotation (`rotations` of
 * them in the simulation's kept span):
 * - field time: how long each member is on the field;
 * - skill uses: each time its Skill's cooldown starts, pressed or held (the matching option);
 *   a "Burst" option (Emilie's case, replaced by her Burst) counts the Bursts;
 * - the particle catcher: who is on the field when a Skill's particles arrive (they give energy
 *   on arrival, `particleDelay` after the hit that makes them), and the share they catch;
 * - Burst cadence: unused without a Burst, otherwise once per its Bursts in a rotation;
 * - bonus energy a Skill use restores directly (`SKILL_FLAT_ENERGY`).
 * Turrets (particles over time) keep the catcher: the calculator shares them out by field time.
 */
export function energyFromRotation(
  sim: Pick<
    SimulationResult,
    'start' | 'frames' | 'hits' | 'swaps' | 'skillUses' | 'actions'
  >,
  keys: readonly CharacterKey[],
  rotations = 1,
  constellations?: Partial<Record<CharacterKey, number>>
): RotationEnergy {
  const start = sim.start
  const end = sim.start + sim.frames
  const per = Math.max(1, rotations)
  const swaps = [...(sim.swaps ?? [])].sort((a, b) => a.start - b.start)
  const first =
    swaps[0]?.from ??
    sim.actions.find((a) => a.start >= start)?.characterKey ??
    keys[0]
  /** Who is on the field at `t` (a swap's incoming member from its end) */
  const onFieldAt = (t: number) => {
    let who = first
    for (const s of swaps)
      if (s.start + s.frames <= t) who = s.to
      else break
    return who
  }
  const field = new Map<CharacterKey, number>()
  {
    let from = start
    let who = first
    for (const s of swaps) {
      const at = Math.min(end, Math.max(from, s.start + s.frames))
      field.set(who, (field.get(who) ?? 0) + at - from)
      from = at
      who = s.to
    }
    field.set(who, (field.get(who) ?? 0) + Math.max(0, end - from))
  }
  const total = keys.reduce((n, k) => n + (field.get(k) ?? 0), 0)
  // Electro resonance (a party of 4 with 2 Electro members): a particle on an Electro reaction,
  // 5 s apart at least
  let electroInterval: number | undefined
  if (
    keys.length === 4 &&
    keys.filter((k) => getCharEle(k) === 'electro').length >= 2
  ) {
    let last = Number.NEGATIVE_INFINITY
    let procs = 0
    for (const h of sim.hits)
      if (
        h.t >= start &&
        h.t < end &&
        h.path[0] === '_reaction' &&
        ELECTRO_RESONANCE_REACTIONS.includes(h.path[1]) &&
        h.t - last >= 300
      ) {
        procs++
        last = h.t
      }
    electroInterval = procs
      ? Math.round((sim.frames / 60 / procs) * 10) / 10
      : 0
  }
  // (the random Energy of Normal and Charged Attack hits, a member's own)
  const attackEnergy = attackEnergyFromRotation(sim, keys, per)
  // (Favonius: what each member's hits would trigger with one, counted only if it holds one)
  const favonius = favoniusFromRotation(sim, keys, per, onFieldAt)
  // (energy weapons: what each member would trigger with one, counted only if it holds one)
  const weaponTriggers = weaponTriggersFromRotation(sim, keys, per)
  const members: RotationEnergy['members'] = {}
  for (const key of keys) {
    const data = energyCalcData[key]
    if (!data) continue
    const cons =
      constellations?.[key] ?? (getCharStat(key).rarity === 4 ? 6 : 0)
    const usable = (i: number) =>
      energySkillConstellation(data.skills[i].label) <= cons
    const base = defaultSkillMode(key, constellations?.[key])
    const modeFor = (hold: boolean) => {
      const found = data.skills.findIndex(
        (skill, i) =>
          usable(i) && (hold ? /hold/i : /press|tap/i).test(skill.label)
      )
      return found >= 0 ? found : base
    }
    // a use per particle marker its kit sets (`particleMarker`: the hits that make them), or else
    // per start of its Skill cooldown
    const markers = sim.hits.filter(
      (h) =>
        h.characterKey === key &&
        h.t >= start &&
        h.t < end &&
        h.path[0] === '_marker' &&
        h.path[1] === 'particles'
    )
    const actionAt = (t: number) =>
      [...sim.actions]
        .reverse()
        .find((a) => a.characterKey === key && a.start <= t)
    // (a kit whose markers are single particles has its own sheet option for them: Flins)
    const markerOption = MARKER_OPTIONS[key]
      ? data.skills.findIndex((s) => s.label === MARKER_OPTIONS[key])
      : -1
    const uses: {
      t: number
      hold: boolean
      particlesAt?: number
      mode?: number
    }[] = markers.length
      ? markers.map((m) => ({
          t: m.t,
          hold: /^h/i.test(actionAt(m.t)?.text ?? ''),
          particlesAt: m.t,
          ...(markerOption >= 0 ? { mode: markerOption } : {}),
        }))
      : (sim.skillUses ?? []).filter(
          (u) => u.characterKey === key && u.t >= start && u.t < end
        )
    const byMode = new Map<number, number>()
    for (const u of uses) {
      const mode = u.mode ?? modeFor(u.hold)
      byMode.set(mode, (byMode.get(mode) ?? 0) + 1)
    }
    const modes = [...byMode].sort((a, b) => b[1] - a[1])
    const burstActions = sim.actions.filter(
      (a) =>
        a.characterKey === key &&
        a.start >= start &&
        a.start < end &&
        (a.frameKey ?? '').startsWith('burst')
    )
    // a special Burst that spends only part of the Energy (Varesa's Volcanic Kablam, Flins'
    // Thunderous Symphony): its sheet option, -30 a use, not the full Burst
    const short = SHORT_BURSTS[key]
    const shortOption = short
      ? data.skills.findIndex((s) => s.label === short.label)
      : -1
    const shortBursts =
      shortOption >= 0
        ? burstActions.filter((a) => a.variant?.key === short!.variant).length
        : 0
    const bursts = burstActions.length - shortBursts
    const member: Partial<TeamOptEnergyMember> = {
      fieldTime:
        total > 0 ? Math.round(((field.get(key) ?? 0) / total) * 1000) / 10 : 0,
      skillMode: modes[0]?.[0] ?? base,
      skillUses: (modes[0]?.[1] ?? 0) / per,
      secondaryMode: modes[1]?.[0] ?? modes[0]?.[0] ?? base,
      secondaryUses: (modes[1]?.[1] ?? 0) / per,
      burstEvery: bursts ? per / bursts : 0,
    }
    // (Emilie: her Burst replaces her Lumidouce Case, the sheet's "Burst" option)
    const burstOption = data.skills.findIndex((s) => s.label === 'Burst')
    if (burstOption >= 0 && !modes[1]) {
      member.secondaryMode = burstOption
      member.secondaryUses = bursts / per
    }
    if (shortOption >= 0 && !modes[1]) {
      member.secondaryMode = shortOption
      member.secondaryUses = shortBursts / per
    }
    if (SKILL_FLAT_ENERGY[key] !== undefined)
      member.flatEnergy = (SKILL_FLAT_ENERGY[key]! * uses.length) / per
    // energy on the party's reactions (Flins' C1: 8 on a Lunar-Charged, once per 5.5 s), counted
    // as the rotation triggers them
    const reactionEnergy = REACTION_ENERGY[key]
    if (reactionEnergy && cons >= reactionEnergy.constellation) {
      let last = Number.NEGATIVE_INFINITY
      let procs = 0
      for (const h of sim.hits)
        if (
          h.t >= start &&
          h.t < end &&
          h.path[0] === '_reaction' &&
          h.path[1] === reactionEnergy.reaction &&
          h.t > last + reactionEnergy.icd
        ) {
          procs++
          last = h.t
        }
      member.flatEnergy =
        (member.flatEnergy ?? 0) + (reactionEnergy.energy * procs) / per
    }
    if (weaponTriggers[key]) member.weaponTriggers = weaponTriggers[key]
    if (favonius[key]) {
      member.favoniusProcs = favonius[key]!.procs
      if (favonius[key]!.catchBy)
        member.favoniusCatchBy = favonius[key]!.catchBy
    }
    if (attackEnergy[key])
      member.flatEnergy =
        Math.round(((member.flatEnergy ?? 0) + attackEnergy[key]!) * 100) / 100
    // the catcher: who is on the field when each use's particles arrive (the first hit of the
    // member's Skill after the use, then the particles' travel)
    const primary = data.skills[member.skillMode!]
    if (primary && !(primary.perSecond > 0) && uses.length) {
      const caught = new Map<CharacterKey, number>()
      uses.forEach((u, i) => {
        const until = uses[i + 1]?.t ?? u.t + 20 * 60
        const made =
          u.particlesAt ??
          sim.hits.find(
            (h) =>
              h.characterKey === key &&
              h.t >= u.t &&
              h.t < until &&
              !h.path[0].startsWith('_') &&
              (h.tag === 'skill' || h.path[0] === 'skill')
          )?.t
        if (made === undefined) return
        const who = onFieldAt(made + particleDelay(key))
        caught.set(who, (caught.get(who) ?? 0) + 1)
      })
      const counted = [...caught.values()].reduce((n, c) => n + c, 0)
      const [catcher, count] = [...caught]
        .filter(([who]) => who !== key)
        .sort((a, b) => b[1] - a[1])[0] ?? [key, 0]
      member.catchBy = count ? catcher : key
      member.funnelShare =
        count && counted ? Math.round((count / counted) * 100) : 100
    }
    members[key] = member
  }
  return { members, ...(electroInterval !== undefined && { electroInterval }) }
}

/**
 * The calculator's settings with a rotation's inputs filled in, except those set by hand
 * (`TeamOptEnergyMember.edited`). Field time stays 100% in total: the members set by hand keep
 * theirs and the others share the rest as the rotation does.
 */
export function withRotationEnergy(
  settings: TeamOptEnergyCalculator,
  keys: readonly CharacterKey[],
  energy: RotationEnergy | undefined
): TeamOptEnergyCalculator {
  if (!energy) return settings
  const electro =
    energy.electroInterval !== undefined &&
    !settings.edited?.includes('electroInterval')
      ? { electroInterval: energy.electroInterval }
      : {}
  const members = { ...settings.members }
  for (const key of keys) {
    const member = members[key]
    const filled = energy.members[key]
    if (!member || !filled) continue
    const next: TeamOptEnergyMember = { ...member }
    // (a Burst cadence set by hand also keeps the partial-Energy Bursts out: Flins' Thunderous
    // Symphony, Varesa's Kablam are Bursts too, so the rotation's count of them would add to the
    // Bursts entered)
    const keepShort =
      !!SHORT_BURSTS[key] && !!member.edited?.includes('burstEvery')
    for (const [field, value] of Object.entries(filled) as [
      TeamOptEnergyRotationField,
      never,
    ][])
      if (
        field !== 'fieldTime' &&
        !member.edited?.includes(field) &&
        !(keepShort && (field === 'secondaryMode' || field === 'secondaryUses'))
      )
        next[field] = value
    members[key] = next
  }
  const auto = keys.filter(
    (k) =>
      members[k] &&
      energy.members[k]?.fieldTime !== undefined &&
      !members[k]!.edited?.includes('fieldTime')
  )
  if (auto.length) {
    const fixed = keys
      .filter((k) => !auto.includes(k))
      .reduce((n, k) => n + (members[k]?.fieldTime ?? 0), 0)
    const rest = Math.max(0, 100 - fixed)
    const sum = auto.reduce((n, k) => n + energy.members[k]!.fieldTime!, 0)
    for (const k of auto)
      members[k] = {
        ...members[k]!,
        fieldTime:
          Math.round(
            (sum > 0
              ? (energy.members[k]!.fieldTime! / sum) * rest
              : rest / auto.length) * 10
          ) / 10,
      }
  }
  return { ...settings, ...electro, members }
}

/**
 * Skill uses a member starts with in the calculator, where one is wrong. Sandrone: 1 particle on
 * a Cryo or Stellar-Conduct hit of her Charged Attack or Skill (2.5 s ICD), 5 in a rotation of 3
 * full Charged Attacks (the ERC sheet's note).
 */
const START_USES: Partial<Record<CharacterKey, number>> = { Sandrone: 5 }
/**
 * Bonus energy a member starts with: Sandrone's 5 in a rotation of 3 Charged Attacks (the ERC
 * sheet's note: her Charged Attacks' random energy; from a rotation, counted as played instead)
 */
const START_BONUS: Partial<Record<CharacterKey, number>> = { Sandrone: 5 }
/**
 * Special Bursts that spend only part of the Energy: the sheet option ("-30 a use") and the kit's
 * variant key of that Burst (one entry per line)
 */
/**
 * Energy a member gets when the party triggers a reaction, once per `icd` frames, from a
 * constellation (one entry per line)
 */
const REACTION_ENERGY: Partial<
  Record<
    CharacterKey,
    { constellation: number; reaction: string; energy: number; icd: number }
  >
> = {
  Flins: { constellation: 1, reaction: 'lunarCharged', energy: 8, icd: 330 },
}
/** The sheet option a kit's particle markers count as, when not its Skill's (one entry per line) */
const MARKER_OPTIONS: Partial<Record<CharacterKey, string>> = {
  Flins: 'Manifest Flame hit',
}
const SHORT_BURSTS: Partial<
  Record<CharacterKey, { label: string; variant: string }>
> = {
  Varesa: { label: 'Kablam', variant: 'apex' },
  Flins: { label: 'Thunderous Symphony', variant: 'symphony' },
}
