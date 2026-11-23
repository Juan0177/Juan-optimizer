import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOptEnergyCalculator,
  TeamOptEnergyMember,
  TeamOptEnergyRotationField,
} from '@genshin-optimizer/gi/db'
import {
  getCharEle,
  getCharStat,
  getWeaponStat,
} from '@genshin-optimizer/gi/stats'
import particleData from './energyCalcData.json'
import type { SimulationResult } from './rotation/simulate'
import type { SimHit } from './rotation/types'
import { healedBy, isReactionEvent } from './rotation/weaponEffects'
import { isLunarHit } from './rotation/weapons/catalyst4'

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
        /**
         * Where the energy comes from, per rotation: particle energy at 100% ER by source (its own
         * skills, the other members' skills, Favonius, the enemies, Electro resonance), and the flat
         * energy by kind (bonus entered, weapons and sets, skills: negative for a partial Burst)
         */
        sources: {
          own: number
          team: number
          favonius: number
          enemies: number
          resonance: number
          bonus: number
          gear: number
          skills: number
        }
        /** Energy its Bursts spend per rotation (the Burst cost over its cadence) */
        burstSpend: number
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
  KatsuragikiriNagamasa: { energy: [6, 7.5, 9, 10.5, 12], cooldown: 10 },
  KitainCrossSpear: { energy: [6, 7.5, 9, 10.5, 12], cooldown: 10 },
  // (per Energy restore the simulation marks: its module applies its rules)
  JadefallsSplendor: { energy: [4.5, 5, 5.5, 6, 6.5] },
  // (gcsim: 4–6 Energy every 2 s for 6 s after each of the wielder's Bursts, on the field)
  PrototypeAmber: { energy: [12, 13.5, 15, 16.5, 18], perBurst: true },
  EverlastingMoonglow: { energy: [0.6, 0.6, 0.6, 0.6, 0.6], cooldown: 0.1 },
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
/** A Favonius weapon's chance on a CRIT hit: 60/70/80/90/100% (R1–R5) */
export const favoniusChance = (refinement = 1) =>
  0.5 + 0.1 * Math.min(5, Math.max(1, Math.round(refinement)))

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
  /**
   * The part of a source's particles each member catches, as the rotation played them (shares of
   * members no longer in the team left out); undefined without any
   */
  const caughtOf = (
    shares: Partial<Record<CharacterKey, number>> | undefined
  ) => {
    const total = keys.reduce((n, k) => n + (shares?.[k] ?? 0), 0)
    return shares && total > 0
      ? (k: CharacterKey) => (shares[k] ?? 0) / total
      : undefined
  }
  // (elemental resonance needs a party of four)
  const hasElectroResonance =
    keys.length === 4 &&
    keys.filter((key) => getCharEle(key) === 'electro').length >= 2 &&
    keys.some((key) =>
      ['pyro', 'hydro', 'cryo', 'dendro'].includes(getCharEle(key))
    )
  // Energy that grows with its giver's ER (Raiden's Musou Isshin, Sara's A4): the giver's own in
  // step with its ER, the others' at the giver's ER the previous pass found (100% at first). A
  // giver's own needs come first, so a few passes settle.
  const scaled = keys.some((k) =>
    Object.keys(settings.members[k]?.scaledEnergy ?? {}).some(
      (g) =>
        SCALED_ENERGY[g as CharacterKey] && keys.includes(g as CharacterKey)
    )
  )
  let giverER: Partial<Record<CharacterKey, number>> = {}
  for (let pass = 0; pass < (scaled ? 3 : 1); pass++) {
    if (pass > 0) {
      giverER = Object.fromEntries(
        keys.map((k) => {
          const target = result.targets[k]
          return [
            k,
            target !== undefined && Number.isFinite(target)
              ? Math.max(1, target / 100)
              : 1,
          ]
        })
      )
      result.members = {}
      result.targets = {}
      result.errors = []
    }
    for (const recipient of keys) {
      const own = settings.members[recipient]!
      const ownData = energyCalcData[recipient]!
      const field = own.fieldTime / 100
      // A skill's particles are of its element: 3 energy to a matching member, 1 to another.
      const elementValue = (source: CharacterKey) =>
        getCharEle(source) === getCharEle(recipient) ? 3 : 1
      let particles = 0
      const sources = {
        own: 0,
        team: 0,
        favonius: 0,
        enemies: 0,
        resonance: 0,
        bonus: 0,
        gear: 0,
        skills: 0,
      }
      for (const source of keys) {
        const member = settings.members[source]!
        const data = energyCalcData[source]!
        const modes = [
          { mode: member.skillMode, uses: member.skillUses },
          { mode: member.secondaryMode, uses: member.secondaryUses },
        ]
        let turretTime = 0
        // (who caught its particles as the rotation played: in place of the catcher and the share
        // fed, unless one of those is set by hand)
        const typed = member.edited ?? []
        const skillCaught =
          typed.includes('catchBy') || typed.includes('funnelShare')
            ? undefined
            : caughtOf(member.catchShares)
        // (the particles its turret made as the rotation played: all its Skill's, in place of the
        // options' rate for their uses; caught by whoever was on the field as each one arrived)
        const made = turretParticlesOf(member, data)
        if (made !== undefined) {
          const turretCaught = caughtOf(member.turretCatchShares)
          const energy =
            made *
            (1 - (data.skills[member.skillMode]?.variance ?? 0) * rng) *
            elementValue(source) *
            share(turretCaught ? turretCaught(recipient) : field)
          particles += energy
          if (source === recipient) sources.own += energy
          else sources.team += energy
        }
        for (const [i, { mode, uses }] of (made === undefined
          ? modes
          : []
        ).entries()) {
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
            : skillCaught
              ? skillCaught(recipient)
              : (recipient === catchBy ? fed : 0) +
                (recipient === source ? 1 - fed : 0)
          const energy = count * elementValue(source) * share(caught)
          particles += energy
          if (source === recipient) sources.own += energy
          else sources.team += energy
        }
        // A Favonius trigger makes 3 clear particles (2 energy each on the field) for whoever
        // is on the field then.
        const weapon = weapons?.[source]
        const favoniusProcs = !weapons
          ? member.favoniusProcs
          : isFavonius(weapon)
            ? Math.min(
                // (counted from the rotation at R5: a smaller refinement's chance; a typed count has it)
                member.favoniusProcs *
                  (member.edited?.includes('favoniusProcs')
                    ? 1
                    : favoniusChance(refinements?.[source])),
                settings.rotationTime / favoniusCooldown(refinements?.[source])
              )
            : 0
        const favoniusCaught = typed.includes('favoniusCatchBy')
          ? undefined
          : caughtOf(member.favoniusCatchShares)
        const favonius =
          3 *
          favoniusProcs *
          2 *
          share(
            favoniusCaught
              ? favoniusCaught(recipient)
              : recipient === (member.favoniusCatchBy ?? source)
                ? 1
                : 0
          )
        particles += favonius
        sources.favonius += favonius
      }
      const enemies =
        (settings.enemyParticles * 2 * share(field) * settings.rotationTime) /
        settings.clearTime
      particles += enemies
      sources.enemies = enemies
      if (hasElectroResonance && settings.electroInterval > 0) {
        const resonance =
          (settings.rotationTime / Math.max(5, settings.electroInterval)) *
          (getCharEle(recipient) === 'electro' ? 3 : 1) *
          share(field)
        particles += resonance
        sources.resonance = resonance
      }
      // Dori's A4 converts each skill use into energy that scales with her ER.
      if (recipient === 'Dori') {
        particles += 5 * (own.skillUses + own.secondaryUses)
        sources.own += 5 * (own.skillUses + own.secondaryUses)
      }
      // a weapon's energy per trigger: the wielder's own, and the energy given to the party by
      // the others' (Frostbreath)
      const weaponTriggers = (member: CharacterKey) => {
        // (Exaiphanes Blade gives its Energy to the Traveler only: kqmsim exaiphanesblade.go)
        if (
          weapons?.[member] === 'ExaiphanesBlade' &&
          !member.startsWith('Traveler')
        )
          return 0
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
            energyWeaponTeam(weapons?.[k], refinements?.[k]) *
              weaponTriggers(k),
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
      // Scroll of the Hero of Cinder City (2 pieces): 6 Energy on each Nightsoul Burst in the party
      const scrollEnergy =
        (sets?.[recipient]?.['ScrollOfTheHeroOfCinderCity'] ?? 0) >= 2
          ? 6 * (settings.nightsoulBursts ?? 0)
          : 0
      sources.bonus = own.flatEnergy
      sources.gear =
        exileEnergy +
        scrollEnergy +
        energyWeaponFlat(weapons?.[recipient], refinements?.[recipient]) *
          weaponTriggers(recipient) +
        teamWeaponEnergy
      sources.skills =
        ownData.skills[own.skillMode].flatEnergy * own.skillUses +
        ownData.skills[own.secondaryMode].flatEnergy * own.secondaryUses
      for (const [giver, base] of Object.entries(own.scaledEnergy ?? {}) as [
        CharacterKey,
        number,
      ][]) {
        const scale = SCALED_ENERGY[giver]
        if (!scale || !keys.includes(giver)) continue
        if (giver === recipient) {
          sources.skills += base * scale.flat
          particles += base * scale.perER
          sources.own += base * scale.perER
        } else
          sources.skills +=
            base * (scale.flat + scale.perER * (giverER[giver] ?? 1))
      }
      const flat = sources.bonus + sources.gear + sources.skills
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
        sources,
        burstSpend:
          own.burstEvery === 0 || cost === 0 ? 0 : cost / own.burstEvery,
      }
      if (!Number.isFinite(required))
        result.errors.push(
          `${recipient} has no particle energy. Add particle sources or disable its burst.`
        )
      else result.targets[recipient] = Math.ceil(required * 10 - 1e-9) / 10
    }
  }
  return result
}

/**
 * Energy that grows with its giver's Energy Recharge (`TeamOptEnergyMember.scaledEnergy`): at ER
 * (1 = 100%), the base amount times `flat + perER × ER`
 */
const SCALED_ENERGY: Partial<
  Record<CharacterKey, { flat: number; perER: number }>
> = {
  // A4: 0.6% more Musou Isshin restoration per 1% ER above 100%
  RaidenShogun: { flat: 0.4, perER: 0.6 },
  // A4: 1.2 Energy for every 100% ER
  KujouSara: { flat: 0, perER: 1 },
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
    // (Favonius and energy-weapon triggers filled in from the rotation are what such a weapon
    // would give: assumed held only when set by hand; KQM's runs count them for the builds that
    // do hold one)
    const weapon =
      (member.favoniusProcs > 0 && member.edited?.includes('favoniusProcs')
        ? candidates.find((w) => isFavonius(w.key))
        : undefined) ??
      ((member.weaponEnergyTriggers ?? 0) > 0 &&
      // (set by hand: other than the rotation's last fill, as `withRotationEnergy` tells it)
      member.weaponEnergyTriggers !==
        filledWeaponTriggers(key, member.weaponTriggers)
        ? candidates.find((w) => isCalcEnergyWeapon(w.key))
        : undefined)
    if (!weapon) continue
    weapons[key] = weapon.key
    refinements[key] = weapon.refinement
  }
  return { weapons, refinements }
}

/**
 * The particles a member's turret made a rotation as the written rotation played it
 * (`TeamOptEnergyMember.turretParticles`), when they count: a turret option, its Skill not set
 * by hand
 */
export function turretParticlesOf(
  member: TeamOptEnergyMember,
  data: { skills: { perSecond: number }[] }
): number | undefined {
  if (member.turretParticles === undefined) return undefined
  if (!((data.skills[member.skillMode]?.perSecond ?? 0) > 0)) return undefined
  const typed = member.edited ?? []
  return typed.includes('skillUses') ||
    typed.includes('skillMode') ||
    typed.includes('secondaryUses') ||
    typed.includes('secondaryMode')
    ? undefined
    : member.turretParticles
}

/** Starting assumptions are visible and editable; skill uses are casts, not damage hits. */
export function defaultEnergyCalculator(
  keys: readonly CharacterKey[],
  rotationTime = 20,
  onField = keys[0],
  /** Per member; absent: KQM's default (`kqmConstellation`) */
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
  /** Nightsoul Bursts a rotation */
  nightsoulBursts?: number
  members: Partial<
    Record<
      CharacterKey,
      Partial<
        Pick<
          TeamOptEnergyMember,
          TeamOptEnergyRotationField | 'weaponEnergyTriggers'
        >
      >
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

/** What a rotation trigger rule sees besides the hit */
interface TriggerContext {
  keys: readonly CharacterKey[]
  /** Each member's Burst casts (frames) */
  bursts: Partial<Record<CharacterKey, number[]>>
  hits: readonly SimHit[]
}
/** An energy weapon the simulation marks when it restores Energy (its module applies its rules) */
const marked = (weapon: WeaponKey) => (h: SimHit, key: CharacterKey) =>
  h.characterKey === key &&
  h.path[0] === '_marker' &&
  h.path[1] === 'weaponEnergy' &&
  h.path[2] === weapon
/** A damage hit (not a marker or a reaction's own damage) */
const isDamageHit = (h: SimHit) =>
  !h.path[0].startsWith('_') && h.path[0] !== 'reaction'
/** The member's own Stellar Glimmer reactions or DMG */
const ownStellarGlimmer = (h: SimHit, key: CharacterKey) =>
  h.characterKey === key &&
  ((h.path[0] === '_reaction' &&
    (h.path[1] === 'stellarConduct' || h.path[1] === 'stellarSwirl')) ||
    (isDamageHit(h) &&
      (h.tag === 'directStellarConduct' || h.tag === 'directStellarSwirl')))

/**
 * What triggers each energy weapon the calculator takes from a played rotation (as kqmsim), for
 * wielder `key`, one hit of the simulation at a time; at most once per the weapon's cooldown
 * (`ENERGY_WEAPONS`), or per `cooldown` frames when given (0: each one counts)
 */
const ROTATION_TRIGGERS: Partial<
  Record<
    WeaponKey,
    {
      match: (h: SimHit, key: CharacterKey, ctx: TriggerContext) => boolean
      cooldown?: number
    }
  >
> = {
  // its own Cryo- or Hydro-related reactions
  Frostbreath: {
    match: (h, key) => h.characterKey === key && isFrostbreathReaction(h),
  },
  // a heal that reaches the wielder, off the field too (rightfulreward.go)
  RightfulReward: {
    match: (h, key, { keys }) =>
      h.path[0] === '_heal' &&
      healedBy(h, keys, h.onField ?? key).includes(key),
  },
  // a heal the wielder performs, off the field too (dialogues.go)
  DialoguesOfTheDesertSages: {
    match: (h, key) => h.path[0] === '_heal' && h.characterKey === key,
  },
  // any reaction the wielder triggers, off the field too (songofthevigil.go)
  SongOfTheVigil: {
    match: (h, key) => h.characterKey === key && isReactionEvent(h),
  },
  // its own Electro-Charged, Lunar-Charged, Bloom, Lunar-Bloom, Crystallize or Lunar-Crystallize
  // (flameforgedinsight.go)
  FlameForgedInsight: {
    match: (h, key) =>
      h.characterKey === key &&
      h.path[0] === '_reaction' &&
      [
        'electroCharged',
        'lunarCharged',
        'bloom',
        'lunarBloom',
        'crystallize',
        'lunarCrystallize',
      ].includes(h.path[1] ?? ''),
  },
  // any of the Traveler's hits, off the field too (exaiphanesblade.go)
  ExaiphanesBlade: {
    match: (h, key) =>
      key.startsWith('Traveler') &&
      h.characterKey === key &&
      !h.path[0].startsWith('_'),
  },
  // its own Skill hits (kitain.go, nagamasa.go: a 10 s cooldown)
  KitainCrossSpear: {
    match: (h, key) =>
      h.characterKey === key && h.tag === 'skill' && isDamageHit(h),
  },
  KatsuragikiriNagamasa: {
    match: (h, key) =>
      h.characterKey === key && h.tag === 'skill' && isDamageHit(h),
  },
  // each shield the wielder creates (its kit's shield markers, angelosheptades.go)
  AngelosHeptades: {
    match: (h, key) =>
      h.characterKey === key &&
      h.path[0] === '_marker' &&
      h.path[1] === 'shield',
  },
  // any party member's Plunging hit, the wielder's too, once per 0.7 s (cranesechoingcall.go)
  CranesEchoingCall: {
    match: (h) => h.tag === 'plunge' && isDamageHit(h),
  },
  // its own Lunar reactions or Lunar DMG (nocturnes.go)
  NocturnesCurtainCall: {
    match: (h, key) => h.characterKey === key && isLunarHit(h),
  },
  // its HP changing while it is on the field (eternalflow.go)
  TomeOfTheEternalFlow: {
    match: (h, key) =>
      h.characterKey === key &&
      h.onField === key &&
      h.path[0] === '_marker' &&
      h.path[1] === 'hpChange',
  },
  // its own Stellar Glimmer reactions or DMG (the game's text)
  Silverdawn: { match: ownStellarGlimmer },
  // its Normal Attack hits within 12 s of its Burst, once per 0.1 s (moonglow.go)
  EverlastingMoonglow: {
    match: (h, key, { bursts }) =>
      h.characterKey === key &&
      h.tag === 'normal' &&
      isDamageHit(h) &&
      (bursts[key] ?? []).some((b) => b <= h.t && h.t < b + 720),
    cooldown: 6,
  },
  // marked by their modules (rotation/weapons), which apply their own rules
  JadefallsSplendor: { match: marked('JadefallsSplendor'), cooldown: 0 },
  BeyondTheChrysalis: { match: marked('BeyondTheChrysalis') },
  TheDockhandsAssistant: {
    match: marked('TheDockhandsAssistant'),
    cooldown: 0,
  },
  PortablePowerSaw: { match: marked('PortablePowerSaw'), cooldown: 0 },
  // its own Stellar Glimmer reactions or DMG with 3 Lake-Hued Laments (Skill hits 0.1 s apart in
  // the last 8 s)
  WhitelakeFrostfeather: {
    match: (h, key, { hits }) => {
      if (!ownStellarGlimmer(h, key)) return false
      let laments = 0
      let last = Number.NEGATIVE_INFINITY
      for (const k of hits)
        if (
          k.characterKey === key &&
          k.tag === 'skill' &&
          isDamageHit(k) &&
          k.t > h.t - 480 &&
          k.t <= h.t &&
          k.t >= last + 6
        ) {
          laments++
          last = k.t
        }
      return laments >= 3
    },
  },
  BloodsoakedRuins: { match: marked('BloodsoakedRuins'), cooldown: 0 },
  LumidouceElegy: { match: marked('LumidouceElegy'), cooldown: 0 },
  AmenomaKageuchi: { match: marked('AmenomaKageuchi'), cooldown: 0 },
}

/**
 * Each member's energy weapon triggers a rotation if it held the weapon, as the played rotation
 * has them (the weapons in `ROTATION_TRIGGERS`), at most once per the weapon's cooldown (which
 * runs from before the counted span: the earlier rotations' triggers)
 */
export function weaponTriggersFromRotation(
  sim: Pick<SimulationResult, 'start' | 'frames' | 'hits'> &
    Partial<Pick<SimulationResult, 'actions'>>,
  keys: readonly CharacterKey[],
  rotations = 1
): Partial<Record<CharacterKey, Partial<Record<WeaponKey, number>>>> {
  const start = sim.start
  const end = sim.start + sim.frames
  const bursts: TriggerContext['bursts'] = {}
  for (const a of sim.actions ?? [])
    if (a.text === 'Q' || /burst/i.test(a.text))
      (bursts[a.characterKey] ??= []).push(a.start)
  const ctx: TriggerContext = { keys, bursts, hits: sim.hits }
  const out: Partial<Record<CharacterKey, Partial<Record<WeaponKey, number>>>> =
    {}
  for (const key of keys) {
    const triggers: Partial<Record<WeaponKey, number>> = {}
    for (const [weapon, rule] of Object.entries(ROTATION_TRIGGERS) as [
      WeaponKey,
      NonNullable<(typeof ROTATION_TRIGGERS)[WeaponKey]>,
    ][]) {
      const cooldown =
        rule.cooldown ?? (ENERGY_WEAPONS[weapon]?.cooldown ?? 0) * 60
      const times = sim.hits
        .filter((h) => h.t < end && rule.match(h, key, ctx))
        .map((h) => h.t)
        .sort((a, b) => a - b)
      let ready = Number.NEGATIVE_INFINITY
      let n = 0
      for (const t of times) {
        if (t < ready) continue
        ready = t + cooldown
        if (t >= start) n++
      }
      if (n)
        triggers[weapon] = Math.round((n / Math.max(1, rotations)) * 10) / 10
    }
    out[key] = triggers
  }
  return out
}

/**
 * The triggers the prefill puts in a member's energy weapon triggers field: the rotation's for the
 * one energy weapon of its type it would trigger (the Traveler's Exaiphanes Blade), which the
 * calculator then counts for the weapon its build holds; 0 when none or several have triggers
 * (each build then counts its own weapon's, `weaponTriggers`)
 */
function filledWeaponTriggers(
  key: CharacterKey,
  triggers: Partial<Record<WeaponKey, number>> | undefined
): number {
  const type = getCharStat(key).weaponType
  const counted = (
    Object.entries(triggers ?? {}) as [WeaponKey, number][]
  ).filter(
    ([weapon, n]) =>
      n > 0 &&
      isCalcEnergyWeapon(weapon) &&
      getWeaponStat(weapon)?.weaponType === type
  )
  return counted.length === 1 ? counted[0][1] : 0
}

const FAVONIUS_ASSUMED = { cooldown: 360, crit: 0.5 }
const FAVONIUS_RUNS = 400

/**
 * Each member's expected Favonius triggers a rotation if it held a Favonius weapon (its own CRIT
 * hits in the played rotation, as `FAVONIUS_ASSUMED`), who is on the field when the particles
 * of most of them arrive, and each member's share of them (`catchSharesOf`)
 */
/** Particles caught by member as each one's share of them, % to a tenth (none caught: undefined) */
export function catchSharesOf(
  caught: ReadonlyMap<CharacterKey, number>
): Partial<Record<CharacterKey, number>> | undefined {
  const total = [...caught.values()].reduce((n, c) => n + c, 0)
  if (!(total > 0)) return undefined
  return Object.fromEntries(
    [...caught]
      .filter(([, c]) => c > 0)
      .map(([k, c]) => [k, Math.round((c / total) * 1000) / 10])
  )
}

export function favoniusFromRotation(
  sim: Pick<SimulationResult, 'start' | 'frames' | 'hits'>,
  keys: readonly CharacterKey[],
  rotations = 1,
  onFieldAt: (t: number) => CharacterKey = (t) => keys[0] ?? ('' as never)
): Partial<
  Record<
    CharacterKey,
    {
      procs: number
      catchBy: CharacterKey | undefined
      shares: Partial<Record<CharacterKey, number>> | undefined
    }
  >
> {
  const start = sim.start
  const end = sim.start + sim.frames
  const out: Partial<
    Record<
      CharacterKey,
      {
        procs: number
        catchBy: CharacterKey | undefined
        shares: Partial<Record<CharacterKey, number>> | undefined
      }
    >
  > = {}
  for (const key of keys) {
    // (its own hits that can CRIT, while it is on the field: kqmsim favonius.go counts only the
    // active character's; not the simulation's markers, not the reactions that cannot CRIT)
    const hits = sim.hits
      .filter(
        (h) =>
          h.characterKey === key &&
          h.onField === key &&
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
    out[key] = {
      procs: Math.round((procs / per) * 10) / 10,
      catchBy,
      shares: catchSharesOf(caught),
    }
  }
  return out
}

/**
 * The ER calculator's inputs as a played rotation has them, per written rotation (`rotations` of
 * them in the simulation's kept span):
 * - field time: how long each member is on the field;
 * - skill uses: each particle drop its kit marks (`particleMarker`, with the sheet option when the
 *   kit knows it), else each time its Skill's cooldown starts; the option as played
 *   (`USE_OPTIONS`), else pressed or held; a "Burst" option (Emilie's case, replaced by her Burst)
 *   counts the Bursts;
 * - the particle catcher: who is on the field when a Skill's particles arrive (they give energy
 *   on arrival, `particleDelay` after the hit that makes them; past the end, as the rotation
 *   loops), and the share they catch; and every catcher's share (`catchShares`), the same for
 *   marked turret particles and Favonius triggers;
 * - Burst cadence: unused without a Burst, otherwise once per its Bursts in a rotation;
 * - bonus energy a Skill use restores directly (`SKILL_FLAT_ENERGY`), or a constellation on the
 *   party's reactions (`REACTION_ENERGY`);
 * - energy weapon triggers: what each weapon would trigger, and in the triggers field those of the
 *   one energy weapon of its type that has some (`filledWeaponTriggers`).
 * Turrets the kits don't mark keep the catcher: the calculator shares them out by field time.
 */
export function energyFromRotation(
  sim: Pick<
    SimulationResult,
    | 'start'
    | 'frames'
    | 'hits'
    | 'swaps'
    | 'skillUses'
    | 'actions'
    | 'rotationStarts'
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
  // Who catches particles arriving at `t`: past the end, the rotation loops, so the next one plays
  // as the last kept one did from its start (its swap in included)
  const lastStart = sim.rotationStarts?.at(-1) ?? start
  const arrivalAt = (t: number) =>
    onFieldAt(t < end ? t : lastStart + (t - end))
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
  const favonius = favoniusFromRotation(sim, keys, per, arrivalAt)
  // (energy weapons: what each member would trigger with one, counted only if it holds one)
  const weaponTriggers = weaponTriggersFromRotation(sim, keys, per)
  // (members whose constellations give flat Energy as the rotation plays them)
  const kitEnergy: Partial<Record<CharacterKey, number>> = {}
  for (const [owner, count] of Object.entries(KIT_ENERGY) as [
    CharacterKey,
    KitEnergy,
  ][])
    if (keys.includes(owner))
      for (const [k, v] of Object.entries(
        count(owner, sim, keys, per, constellations)
      ) as [CharacterKey, number][])
        kitEnergy[k] = (kitEnergy[k] ?? 0) + v
  // (flat Energy the kits mark where it is restored, `flatEnergy`: the marker's member's, else
  // the members its recipient names; one that grows with the giver's ER kept by giver)
  const scaledEnergy: Partial<
    Record<CharacterKey, Partial<Record<CharacterKey, number>>>
  > = {}
  for (const h of sim.hits)
    if (
      h.path[0] === '_marker' &&
      h.path[1] === 'flatEnergy' &&
      keys.includes(h.characterKey) &&
      h.t >= sim.start &&
      h.t < sim.start + sim.frames
    )
      for (const k of flatEnergyRecipients(h, keys)) {
        const amount = (Number(h.path[2]) || 0) / per
        if (h.path[4] === 'scaled') {
          const by = (scaledEnergy[k] ??= {})
          by[h.characterKey] =
            Math.round(((by[h.characterKey] ?? 0) + amount) * 100) / 100
        } else kitEnergy[k] = (kitEnergy[k] ?? 0) + amount
      }
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
    // (the sheet option a marker names: the kit's, or the one its markers count as: Flins)
    const uses: {
      t: number
      hold: boolean
      particlesAt?: number
      option?: string
    }[] = markers.length
      ? markers.map((m) => ({
          t: m.t,
          hold: /^h/i.test(actionAt(m.t)?.text ?? ''),
          particlesAt: m.t,
          option: m.path[2] || MARKER_OPTIONS[key],
        }))
      : (sim.skillUses ?? []).filter(
          (u) => u.characterKey === key && u.t >= start && u.t < end
        )
    uses.sort((a, b) => a.t - b.t)
    // each use's first Skill hit (its particles' for most kits) before the next use
    const firstHits = uses.map((u, i) => {
      const until = uses[i + 1]?.t ?? u.t + 20 * 60
      return sim.hits.find(
        (h) =>
          h.characterKey === key &&
          h.t >= u.t &&
          h.t < until &&
          !h.path[0].startsWith('_') &&
          (h.tag === 'skill' || h.path[0] === 'skill')
      )
    })
    // (the rotation loops: the last use lasts to the first one's next loop, its hits past the end
    // are the first ones of the kept span)
    const useHits = (i: number) => {
      const from = uses[i].t
      const to = uses[i + 1]?.t ?? uses[0].t + sim.frames
      return sim.hits
        .filter((h) => h.characterKey === key)
        .flatMap((h) =>
          h.t >= from && h.t < to
            ? [h]
            : h.t >= start && h.t < to - sim.frames
              ? [{ ...h, t: h.t + sim.frames }]
              : []
        )
        .sort((a, b) => a.t - b.t)
    }
    const optionIndex = (label: string | undefined) =>
      label
        ? data.skills.findIndex((s, i) => s.label === label && usable(i))
        : -1
    const modeOf = uses.map((u, i) => {
      const found = optionIndex(
        u.option ??
          USE_OPTIONS[key]?.({
            hold: u.hold,
            hit: firstHits[i],
            hits: () => useHits(i),
            all: sim.hits,
          })
      )
      return found >= 0 ? found : modeFor(u.hold)
    })
    const byMode = new Map<number, number>()
    for (const mode of modeOf) byMode.set(mode, (byMode.get(mode) ?? 0) + 1)
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
    // the particles its turret made, as its kit marks them (`turretParticles`): a turret that needs
    // the party's hits, ends early, or is replaced by its Burst's counts what it made
    // (and who is on the field as each lot arrives, `particleDelay` after its hit)
    member.turretCatchShares = undefined
    if (TURRET_MARKED.has(key)) {
      let made = 0
      const caught = new Map<CharacterKey, number>()
      for (const h of sim.hits)
        if (
          h.characterKey === key &&
          h.t >= start &&
          h.t < end &&
          h.path[0] === '_marker' &&
          h.path[1] === 'turretParticles'
        ) {
          const count = Number(h.path[2]) || 0
          made += count
          const who = arrivalAt(h.t + particleDelay(key))
          caught.set(who, (caught.get(who) ?? 0) + count)
        }
      member.turretParticles = Math.round((made / per) * 100) / 100
      member.turretCatchShares = catchSharesOf(caught)
    }
    // (every field it fills is set, none left out: a rotation without, after one with, clears it)
    member.flatEnergy =
      SKILL_FLAT_ENERGY[key] !== undefined
        ? (SKILL_FLAT_ENERGY[key]! * uses.length) / per
        : 0
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
    // flat Energy from members' constellations, as the rotation plays them (KIT_ENERGY)
    if (kitEnergy[key])
      member.flatEnergy =
        Math.round(((member.flatEnergy ?? 0) + kitEnergy[key]!) * 100) / 100
    member.scaledEnergy = scaledEnergy[key] ?? {}
    member.weaponTriggers = weaponTriggers[key] ?? {}
    member.weaponEnergyTriggers = filledWeaponTriggers(key, weaponTriggers[key])
    member.favoniusProcs = favonius[key]?.procs ?? 0
    member.favoniusCatchBy = favonius[key]?.catchBy ?? key
    member.favoniusCatchShares = favonius[key]?.shares
    if (attackEnergy[key])
      member.flatEnergy =
        Math.round(((member.flatEnergy ?? 0) + attackEnergy[key]!) * 100) / 100
    // the catcher: who is on the field when each use's particles arrive (the first hit of the
    // member's Skill after the use, then the particles' travel); and each catcher's share, which
    // the calculator counts (one catcher and the share fed to it can't say two members caught them)
    const primary = data.skills[member.skillMode!]
    member.catchShares = undefined
    if (primary && !(primary.perSecond > 0) && uses.length) {
      const caught = new Map<CharacterKey, number>()
      uses.forEach((u, i) => {
        const made = u.particlesAt ?? firstHits[i]?.t
        if (made === undefined) return
        const who = arrivalAt(made + particleDelay(key))
        caught.set(who, (caught.get(who) ?? 0) + 1)
      })
      member.catchShares = catchSharesOf(caught)
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
  const nightsoulBursts =
    sim.hits.filter(
      (h) => h.path[0] === '_nightsoulBurst' && h.t >= start && h.t < end
    ).length / per
  return {
    members,
    ...(electroInterval !== undefined && { electroInterval }),
    ...(nightsoulBursts > 0 && { nightsoulBursts }),
  }
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
  const nightsoul = energy.nightsoulBursts
    ? { nightsoulBursts: energy.nightsoulBursts }
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
      TeamOptEnergyRotationField | 'weaponEnergyTriggers',
      never,
    ][])
      if (
        field !== 'fieldTime' &&
        field !== 'weaponEnergyTriggers' &&
        !member.edited?.includes(field) &&
        !(keepShort && (field === 'secondaryMode' || field === 'secondaryUses'))
      )
        next[field] = value
    // (the energy weapon triggers field has no `edited` mark: a value other than the one the
    // rotation filled in last time, from the saved `weaponTriggers`, was set by hand)
    const lastFilled = filledWeaponTriggers(key, member.weaponTriggers)
    if (
      filled.weaponEnergyTriggers !== undefined &&
      !(
        (member.weaponEnergyTriggers ?? 0) > 0 &&
        member.weaponEnergyTriggers !== lastFilled
      )
    )
      next.weaponEnergyTriggers = filled.weaponEnergyTriggers
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
    // (in tenths of a percent, rounded so they still add up to the rest: rounded one by one, three
    // equal shares made 99.9% and a run stopped on "Field time must add up to 100%")
    const tenths = auto.map(
      (k) =>
        (sum > 0
          ? (energy.members[k]!.fieldTime! / sum) * rest
          : rest / auto.length) * 10
    )
    const rounded = tenths.map((x) => Math.floor(x + 1e-9))
    let left = Math.round(rest * 10) - rounded.reduce((n, x) => n + x, 0)
    for (const i of tenths
      .map((_, i) => i)
      .sort((a, b) => tenths[b]! - rounded[b]! - (tenths[a]! - rounded[a]!))) {
      if (left <= 0) break
      rounded[i]!++
      left--
    }
    auto.forEach((k, i) => {
      members[k] = { ...members[k]!, fieldTime: rounded[i]! / 10 }
    })
  }
  return { ...settings, ...electro, ...nightsoul, members }
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
  Ineffa: { constellation: 4, reaction: 'lunarCharged', energy: 5, icd: 240 },
}
/** What a rule of `USE_OPTIONS` sees of a Skill use */
interface UseContext {
  hold: boolean
  /** Its first Skill hit (the one that makes its particles, for most kits) */
  hit?: SimHit
  /**
   * The member's hits from the use to the next one, in order (the rotation loops: the last use's
   * run on into the kept span's first hits, a loop later)
   */
  hits: () => SimHit[]
  /** The kept span's hits */
  all: readonly SimHit[]
}
/** How many of the hits make particles, at most once per `icd` frames (a kit's particle ICD) */
function particlesMade(
  hits: readonly SimHit[],
  match: (h: SimHit) => boolean,
  icd: number
) {
  let ready = Number.NEGATIVE_INFINITY
  let n = 0
  for (const h of hits)
    if (match(h) && h.t >= ready) {
      n++
      ready = h.t + icd
    }
  return n
}
/**
 * The ER sheet's option a Skill use is, where its particles depend on how the rotation played it
 * (gcsim's particle callbacks); otherwise Press or Hold as played
 */
const USE_OPTIONS: Partial<
  Record<CharacterKey, (use: UseContext) => string | undefined>
> = {
  // a particle more a Polaris stack held for: 2 stacks are the sheet's "Perfect"
  Beidou: (u) =>
    u.hit?.path[1] === 'dmgTwoHits'
      ? 'Perfect'
      : u.hit?.path[1] === 'dmgOneHit'
        ? '1 stack'
        : '0 stacks',
  // A4: an enemy Frozen by Frostgnaw drops 1 more particle (one enemy: 1 freeze at most)
  Kaeya: (u) =>
    u.hit &&
    u.all.some(
      (h) =>
        h.characterKey === 'Kaeya' &&
        h.t === u.hit!.t &&
        h.path[0] === '_reaction' &&
        h.path[1] === 'frozen'
    )
      ? '1 freeze'
      : '0 freezes',
  // Declension stacks at the release: 2–3 make 2.5 particles, 4 make 3
  ShikanoinHeizou: (u) => {
    const stacks =
      Number(
        u.hit?.states?.find((s) => s.path[1] === 'declensionStacks')?.value
      ) || 0
    return stacks >= 4
      ? 'Full stacks'
      : stacks >= 2
        ? '2-3 stacks'
        : '0-1 stacks'
  },
  // the Shooting Star volleys while the Curtain lasts (their particles: once per 3.5 s)
  Layla: (u) => {
    const volleys = particlesMade(
      u.hits(),
      (h) => h.path.join('.') === 'skill.starDmg',
      210
    )
    return ['1 volley', '2 volleys', '3 volleys'][
      Math.min(3, Math.max(1, volleys)) - 1
    ]
  },
  // the hold is Charge Level 1
  YunJin: (u) => (u.hit?.path[1] === 'dmg1' ? 'Level 1' : 'Press'),
  // a stance's particles: its Riptide Slashes', once per 3 s (3 for "7-9s melee", 4 for "11s")
  Tartaglia: (u) =>
    particlesMade(
      u.hits(),
      (h) => h.path.join('.') === 'skill.riptideSlash',
      180
    ) >= 4
      ? '11s melee'
      : '7-9s melee',
  // Windfavored's particles: its Kuugo hits', once per 2 s (3 for "6-8s", 4 for "8-10s")
  Wanderer: (u) =>
    particlesMade(
      u.hits(),
      (h) =>
        (h.tag === 'normal' || h.tag === 'charged') &&
        !!h.states?.some(
          (s) => s.path.join('.') === 'Wanderer.afterSkill' && s.value === 'on'
        ),
      120
    ) >= 4
      ? '8-10s uptime'
      : '6-8s uptime',
}
/**
 * Danica's flat Energy a rotation, per member (dump ConfigTalent_Danica, Avatar_Danica_ElementalArt_E2):
 * - C1: 20 to herself on each Will to Protect (her automatic Entry) or Will to Purge, once per
 *   14 s (UNIQUE_Danica_C1_EnergyRecover_CD);
 * - C4: 3 to each other member when the member on the field, protected by her Royal Aegis (her
 *   kit's shield markers, a later one ending an earlier one), deals Stellar-Conduct DMG, once per
 *   3.5 s (UNIQUE_Danica_C4_EnergyRecover_CD).
 */
function maidEnergyFromRotation(
  owner: CharacterKey,
  sim: Pick<SimulationResult, 'start' | 'frames' | 'hits' | 'actions'>,
  keys: readonly CharacterKey[],
  per: number,
  constellations?: Partial<Record<CharacterKey, number>>
): Partial<Record<CharacterKey, number>> {
  const cons = constellations?.[owner] ?? 0
  if (!keys.includes(owner) || cons < 1) return {}
  const start = sim.start
  const end = sim.start + sim.frames
  const out: Partial<Record<CharacterKey, number>> = {}
  let last = Number.NEGATIVE_INFINITY
  let c1 = 0
  for (const a of [...sim.actions].sort((x, y) => x.start - y.start))
    if (
      a.characterKey === owner &&
      a.start >= start &&
      a.start < end &&
      (a.text === 'Entry' || a.variant?.key === 'battleMaid') &&
      a.start >= last + 840
    ) {
      c1++
      last = a.start
    }
  if (c1) out[owner] = (20 * c1) / per
  if (cons < 4) return out
  const aegis: [number, number][] = []
  for (const h of [...sim.hits].sort((x, y) => x.t - y.t))
    if (
      h.characterKey === owner &&
      h.path[0] === '_marker' &&
      h.path[1] === 'shield'
    ) {
      const open = aegis[aegis.length - 1]
      if (open && open[1] > h.t) open[1] = h.t
      aegis.push([h.t, h.t + +h.path[2]])
    }
  last = Number.NEGATIVE_INFINITY
  let c4 = 0
  for (const h of [...sim.hits].sort((x, y) => x.t - y.t))
    if (
      h.t >= start &&
      h.t < end &&
      h.tag === 'directStellarConduct' &&
      h.characterKey === h.onField &&
      h.t >= last + 210 &&
      aegis.some(([from, to]) => from <= h.t && h.t < to)
    ) {
      c4++
      last = h.t
    }
  if (c4)
    for (const k of keys)
      if (k !== owner) out[k] = (out[k] ?? 0) + (3 * c4) / per
  return out
}
/** Who a flat Energy marker (`flatEnergy`) restores Energy to */
function flatEnergyRecipients(
  h: SimHit,
  keys: readonly CharacterKey[]
): CharacterKey[] {
  const to = h.path[3]
  if (!to) return [h.characterKey]
  if (to === 'active')
    return h.onField && keys.includes(h.onField) ? [h.onField] : []
  if (to === 'others') return keys.filter((k) => k !== h.characterKey)
  if (to === 'team') return [...keys]
  return keys.filter((k) => k === to)
}
/** Barbara's C1: 1 Energy every 10 s, the whole rotation */
function barbaraEnergyFromRotation(
  owner: CharacterKey,
  sim: Pick<SimulationResult, 'start' | 'frames' | 'hits' | 'actions'>,
  _keys: readonly CharacterKey[],
  per: number,
  constellations?: Partial<Record<CharacterKey, number>>
): Partial<Record<CharacterKey, number>> {
  const cons =
    constellations?.[owner] ?? (getCharStat(owner).rarity === 4 ? 6 : 0)
  return cons >= 1 ? { [owner]: sim.frames / 600 / per } : {}
}
type KitEnergy = typeof maidEnergyFromRotation
/**
 * Flat Energy from a member's constellations, counted from the rotation (one entry per line: the
 * released-only build drops unreleased characters' lines)
 */
const KIT_ENERGY: Partial<Record<CharacterKey, KitEnergy>> = {
  Barbara: barbaraEnergyFromRotation,
  Danica: maidEnergyFromRotation,
}
/**
 * The turrets whose kits mark the particles they make (`turretParticles`, kqmsim's particle
 * callbacks): counted as made in the rotation (one entry per line)
 */
const TURRET_MARKED = new Set<CharacterKey>([
  'Albedo',
  'Chiori',
  'Columbina',
  'Dehya',
  'Emilie',
  'Fischl',
  'Furina',
  'Ineffa',
  'KukiShinobu',
  'Lauma',
  'Layla',
  'Linnea',
  'Nahida',
  'Qiqi',
  'RaidenShogun',
  'SangonomiyaKokomi',
  'Vodyanitsa',
  'Xiangling',
  'YaeMiko',
  'Yaoyao',
  'Zhongli',
])
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
/**
 * A member's special Burst that spends part of the Energy (Flins' Thunderous Symphony, Varesa's
 * Kablam): its name and its sheet option (the calculator's second skill), when it has one
 */
export function shortBurstOf(key: CharacterKey) {
  const short = SHORT_BURSTS[key]
  const index = short
    ? (energyCalcData[key]?.skills.findIndex((s) => s.label === short.label) ??
      -1)
    : -1
  return short && index >= 0 ? { label: short.label, index } : undefined
}
