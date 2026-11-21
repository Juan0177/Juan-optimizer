import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import {
  getCharEle,
  getCharWeaponType,
  getWeaponStat,
} from '@genshin-optimizer/gi/stats'
import { energyCalcData, isFrostbreathReaction } from '../energyCalc'
import type { RotationAction } from './parse'
import type {
  NormalStateStart,
  SimBuffOwner,
  SimContext,
  SimGear,
  SimHit,
} from './types'
import { weaponEffects } from './weaponEffects'
import { WEAPON_MODULES } from './weapons'

/*
 * Artifact set effects the simulation plays from what happens in the rotation (gcsim's
 * internal/artifacts), for the sets the members wear in the build being simulated. Each one turns
 * the set's own conditional on (on the wearer's sheet, as the user would) for the hits it covers.
 * Kits supply Bond of Life, HP-change and shield markers and Nightsoul windows. HP and healing
 * effects that have no model remain user-controlled.
 */

/** The elements a reaction involves (for "a reaction involving its element") */
const REACTION_ELEMENTS: Record<string, string[]> = {
  vaporize: ['pyro', 'hydro'],
  melt: ['pyro', 'cryo'],
  overloaded: ['pyro', 'electro'],
  superconduct: ['cryo', 'electro'],
  stellarConduct: ['cryo', 'electro'],
  electroCharged: ['electro', 'hydro'],
  lunarCharged: ['electro', 'hydro'],
  frozen: ['cryo', 'hydro'],
  burning: ['pyro', 'dendro'],
  bloom: ['dendro', 'hydro'],
  lunarBloom: ['dendro', 'hydro'],
  quicken: ['dendro', 'electro'],
  aggravate: ['dendro', 'electro'],
  spread: ['dendro', 'electro'],
  pyroSwirl: ['anemo', 'pyro'],
  hydroSwirl: ['anemo', 'hydro'],
  electroSwirl: ['anemo', 'electro'],
  cryoSwirl: ['anemo', 'cryo'],
  stellarSwirl: ['anemo', 'cryo'],
  lunarCrystallize: ['geo', 'hydro'],
}
const SWIRLED = ['pyro', 'hydro', 'electro', 'cryo']
/**
 * Weapons whose Leaf (Sapwood Blade's and Forest Regalia's of Consciousness, Moonpiercer's of
 * Revival) comes from the wielder's Dendro reactions, one per 20 s, its buff for 12 s (gcsim)
 */
const LEAF_WEAPONS = ['SapwoodBlade', 'ForestRegalia', 'Moonpiercer']
const LEAF_REACTIONS = [
  'burning',
  'quicken',
  'aggravate',
  'spread',
  'bloom',
  'lunarBloom',
  'hyperbloom',
  'burgeon',
]

/** Heretic's Molten Blade's Gleam of First Light at its most (the sheet's 18 steps above its least) */
const GLEAM_STATE = '18'

/**
 * Sets whose Starsparks (Epochal Advent) give their conditional while one is held, each with that
 * conditional (one per line: the released build drops the unreleased ones)
 */
const STARSPARK_SETS: Record<string, string> = {
  LegacyOfTheFirstChronicle: 'undyingRadiance',
}

/** Weapons whose conditional ('afterHeal') is on for 8 s after the wielder is healed */
/** The weapons with Golden Majesty's stacks (kqmsim common/goldenmajesty.go) */
const GOLDEN_MAJESTY = [
  'TheUnforged',
  'SummitShaper',
  'MemoryOfDust',
  'VortexVanquisher',
] as const
const HEALED_WEAPONS = ['TidalShadow', 'SongOfStillness']

/** Weapons whose conditional comes from the wielder creating a shield: item, conditional, state */
const SHIELD_CREATED: [string, string, string][] = [
  ['AngelosHeptades', 'shield', 'on'],
  ['StarcallersWatch', 'shield', 'on'],
  ['FracturedHalo', 'afterShield', 'on'],
]
/**
 * Effects while the wearer is protected by a shield (kqmsim's CharacterIsShielded): item,
 * conditional, state, whether a set (4-piece). Beacon of the Reed Sea's is while it is not.
 */
const SHIELDED: [string, string, string, boolean?][] = [
  ['TheBell', 'WithShield', 'protected'],
  ['TheUnforged', 'WithShield', 'protected'],
  ['SummitShaper', 'WithShield', 'protected'],
  ['MemoryOfDust', 'WithShield', 'protected'],
  ['VortexVanquisher', 'WithShield', 'protected'],
  ['CalamityOfEshu', 'passive', 'on'],
  ['BeaconOfTheReedSea', 'noShield', 'on'],
  ['RetracingBolide', 'state', 'on', true],
]

export interface GearEffects {
  /** Every hit and reaction marker that lands, in time order */
  onHit(ctx: SimContext, hit: SimHit): void
  /**
   * A member is about to act, before its action's hits are queued: the weapon modules' action
   * triggers (kqmsim emits OnSkill/OnBurst before the ability), so hits that take their stats at
   * the cast count them
   */
  beforeAction(
    ctx: SimContext,
    actor: CharacterKey,
    action: RotationAction
  ): void
  /** A member acts */
  onAction(
    ctx: SimContext,
    actor: CharacterKey,
    action: RotationAction,
    /** A Normal Attack string's individual Normals (their offsets from the action's start) */
    normalStarts?: readonly NormalStateStart[]
  ): void
  /** The member on the field changes */
  onSwap(
    t: number,
    from: CharacterKey,
    to: CharacterKey,
    ctx?: SimContext
  ): void
  /** The run ends at `t` (open windows close) */
  end(t: number): void
  /** Whether `k` is protected by a shield at `t` (a party shield while on the field, or its own) */
  shieldedAt(k: CharacterKey, t: number): boolean
  /**
   * The Crystallize shards there now that can be picked up when they arrive `arrive` frames from
   * now (Navia's Skill pulls them): picked up then, with their shield; how many
   */
  takeShards(ctx: SimContext, who: CharacterKey, arrive: number): number
}

export function gearEffects({
  members,
  gear,
  inNightsoul,
  onField,
  cooldown,
  window,
  reduceCooldown,
  onShield,
}: {
  /** A shield is created (Geo resonance is checked again) */
  onShield?: (t: number) => void
  members: CharacterKey[]
  gear: Partial<Record<CharacterKey, SimGear>>
  cooldown: (characterKey: CharacterKey, key: string, t: number) => number
  /** Whether a member is in a Nightsoul state at `t` (a Nightsoul conditional of its kit is on) */
  inNightsoul: (characterKey: CharacterKey, t: number) => boolean
  /** Who starts on the field */
  onField: CharacterKey
  /** Add a buff window [start, end) directly (for windows that start in the past) */
  window: (
    owner: SimBuffOwner,
    path: string[],
    value: string,
    start: number,
    end: number,
    offOnly?: boolean
  ) => void
  reduceCooldown: (
    characterKey: CharacterKey,
    key: string,
    frames: number,
    t: number
  ) => void
}): GearEffects {
  const wears = (k: CharacterKey, set: string, n = 4) =>
    (gear[k]?.sets?.[set] ?? 0) >= n
  // For the effects that only open the set's or weapon's own buff windows: worn, or one of the
  // member's candidates (`SimGear.candidates`; its sheet counts a window only when it is on).
  // Effects that change the play (cooldowns, attack speed, heals, extra hits) use the gear worn.
  const opens = (k: CharacterKey, set: string) =>
    wears(k, set) || !!gear[k]?.candidates?.sets?.includes(set)
  const holds = (k: CharacterKey, weapon: string) =>
    gear[k]?.weapon === weapon ||
    !!gear[k]?.candidates?.weapons?.includes(weapon)
  // Being protected by a shield is the member's own: those effects are timed for any set and any
  // weapon of its type too, so one a build tries (Team optimize) never counts a saved switch
  // without a shield; not held, they count only where a switch is saved (`SimBuffWindow.offOnly`)
  const shieldGear = (k: CharacterKey, item: string, set?: boolean) =>
    (set ? opens(k, item) : holds(k, item))
      ? 'held'
      : set ||
          getWeaponStat(item as WeaponKey)?.weaponType === getCharWeaponType(k)
        ? 'unheld'
        : undefined
  const icd = new Map<string, number>()
  /** Once per `frames` per key */
  const ready = (key: string, t: number, frames: number) => {
    if (t < (icd.get(key) ?? Number.NEGATIVE_INFINITY)) return false
    icd.set(key, t + frames)
    return true
  }
  // Golden Troupe: off the field (until 2 s after taking it), from the start for the others
  const offSince = new Map<CharacterKey, number>()
  for (const m of members)
    if (opens(m, 'GoldenTroupe') && m !== onField) offSince.set(m, 0)
  // Aubade's Lunar bonus applies off field and persists for 3 s after taking the field.
  const aubadeOff = new Map<CharacterKey, number>()
  for (const m of members)
    if (opens(m, 'AubadeOfMorningstarAndMoon') && m !== onField)
      aubadeOff.set(m, 0)
  // These effects refresh the duration of the whole stack count, rather than expiring each
  // stack separately. Close each old interval when it is refreshed to avoid overlapping values.
  const stacks = new Map<
    string,
    {
      owner: CharacterKey
      path: string[]
      count: number
      start: number
      end: number
    }
  >()
  const stack = (
    owner: CharacterKey,
    path: string[],
    t: number,
    duration: number,
    max: number
  ) => {
    const key = `${owner}.${path.join('.')}`
    const old = stacks.get(key)
    if (old)
      window(owner, path, `${old.count}`, old.start, Math.min(t, old.end))
    stacks.set(key, {
      owner,
      path,
      start: t,
      end: t + duration,
      count: Math.min(max, (old && old.end > t ? old.count : 0) + 1),
    })
  }
  // Sacrificial Jade: after 5 s off the field, until 10 s on it
  const jade = (k: CharacterKey) => holds(k, 'SacrificialJade')
  const jadeStates = new Map<
    CharacterKey,
    { offSince?: number; onSince?: number; activeSince?: number }
  >()
  for (const m of members)
    if (jade(m))
      jadeStates.set(m, m === onField ? { onSince: 0 } : { offSince: 0 })
  const closeJade = (
    k: CharacterKey,
    s: { activeSince?: number },
    end: number
  ) => {
    if (s.activeSince !== undefined)
      window(k, ['SacrificialJade', 'offField'], 'on', s.activeSince, end)
    s.activeSince = undefined
  }
  let bubble:
    | {
        owner: CharacterKey
        end: number
        healing: { path: string[]; count: number }[]
      }
    | undefined
  const clamReady = new Map<CharacterKey, number>()
  const marechaussee = new Map<CharacterKey, number>()
  const paleFlame = new Map<
    CharacterKey,
    { count: number; end: number; ready: number }
  >()
  const sacCredit = new Map<CharacterKey, number>()
  const sacReady = new Map<CharacterKey, number>()
  const vermillion = new Map<
    CharacterKey,
    { start: number; end: number; count: number }
  >()
  const hakushin = (ctx: SimContext, hit: SimHit, reaction: string) => {
    const k = hit.characterKey
    if (!holds(k, 'HakushinRing') || hit.onField !== k) return
    const other =
      reaction === 'crystallize' && hit.element === 'electro'
        ? 'geo'
        : reaction === 'hyperbloom'
          ? 'dendro'
          : reaction !== 'spread' &&
              REACTION_ELEMENTS[reaction]?.includes('electro')
            ? REACTION_ELEMENTS[reaction].find((e) => e !== 'electro')
            : undefined
    // (kqmsim hakushin.go: the 1 s cooldown and the 6 s buff on the wielder's clock)
    if (other && ready(`hakushin.${k}.${other}`, ctx.characterFrame(k), 60))
      ctx.buff(k, ['HakushinRing', 'SakuraSaiguu'], other, 0, 360, {
        hitlag: 'recipient',
      })
  }
  // Declare the conditional even if no eligible reaction happens, so a saved manual state
  // cannot make the effect active throughout an ineligible rotation.
  for (const k of members)
    if (holds(k, 'HakushinRing'))
      window(k, ['HakushinRing', 'SakuraSaiguu'], 'dendro', 0, 0)
  // Sapwood Blade / Forest Regalia / Moonpiercer: declared off, on only from the wielder's own
  // reactions
  for (const k of members)
    for (const weapon of LEAF_WEAPONS)
      if (holds(k, weapon)) window(k, [weapon, 'passive'], 'on', 0, 0)
  // Frostbreath: declared off, on only from the wielder's own Cryo- or Hydro-related reactions
  // A Thousand Blazing Suns: its Nightsoul boost declared off, on for the wielder's hits in
  // Nightsoul's Blessing
  for (const k of members)
    if (holds(k, 'AThousandBlazingSuns'))
      window(k, ['AThousandBlazingSuns', 'nightsoul'], 'on', 0, 0)
  for (const k of members)
    if (holds(k, 'Frostbreath')) window(k, ['Frostbreath', 'react'], 'on', 0, 0)
  // Heretic's Molten Blade: declared off, on only after the wielder's Skill while on the field
  for (const k of members)
    if (holds(k, 'HereticsMoltenBlade'))
      window(k, ['HereticsMoltenBlade', 'passive'], GLEAM_STATE, 0, 0)
  /** Its Gleam of First Light now on, per wielder (the activation's frame) */
  const gleam = new Map<CharacterKey, number>()
  // Tidal Shadow, Song of Stillness: declared off, on only after the wielder is healed
  for (const k of members)
    for (const weapon of HEALED_WEAPONS)
      if (holds(k, weapon)) window(k, [weapon, 'afterHeal'], 'on', 0, 0)
  // Rainbow Serpent's Rainbow: declared off, on only after the wielder's hits off the field
  for (const k of members)
    if (holds(k, 'RainbowSerpentsRainBow'))
      window(k, ['RainbowSerpentsRainBow', 'passive'], 'on', 0, 0)
  // The Widsith: declared off, on only after the wielder takes the field
  for (const k of members)
    if (holds(k, 'TheWidsith')) window(k, ['TheWidsith', 'Debut'], 'avg', 0, 0)
  // Thrilling Tales of Dragon Slayers: declared off, on only for the member taking the field when
  // the wielder leaves it (below), so a saved switch never adds uptime the swaps don't give
  for (const k of members)
    if (holds(k, 'ThrillingTalesOfDragonSlayers'))
      window(k, ['ThrillingTalesOfDragonSlayers', 'Heritage'], 'on', 0, 0)
  for (const k of members)
    if (opens(k, 'DesertPavilionChronicle'))
      window(k, ['DesertPavilionChronicle', 'set4'], 'on', 0, 0)
  for (const k of members)
    if (opens(k, 'PaleFlame')) window(k, ['PaleFlame', 'stacks'], '1', 0, 0)
  // Beacon of the Reed Sea: its after-Skill ATK declared off, on after the wielder's Skill hits
  for (const k of members)
    if (holds(k, 'BeaconOfTheReedSea'))
      window(k, ['BeaconOfTheReedSea', 'afterSkill'], 'on', 0, 0)
  // Golden Majesty (The Unforged, Summit Shaper, Memory of Dust, Vortex Vanquisher): declared
  // off, its stacks from the wielder's hits on the field (below)
  for (const k of members)
    for (const weapon of GOLDEN_MAJESTY)
      if (holds(k, weapon)) window(k, [weapon, 'GoldenMajesty'], '1', 0, 0)
  /** Golden Majesty per wielder: its stack count and its generation (for the expiry) */
  const majesty = new Map<CharacterKey, { count: number; end: number }>()
  // Clash of Kings: declared off, on only after the wielder's Skill (below)
  for (const k of members)
    if (holds(k, 'ClashOfKings'))
      window(k, ['ClashOfKings', 'skill'], 'on', 0, 0)
  /**
   * Clash of Kings' Laws of the Board, per wielder (gcsim): `end` its buff's end, `extendUntil`
   * the 12 s within which one Charged Attack hit may extend it; both on the wielder's own clock
   */
  const clash = new Map<
    CharacterKey,
    { end: number; extendUntil: number; extended: boolean }
  >()
  // Instructor, Heart of the Furnace: declared off, on only from the wearer's own triggers (a
  // saved manual state must not make them active throughout)
  for (const k of members) {
    if (opens(k, 'Instructor')) window(k, ['Instructor', 'set4'], 'on', 0, 0)
    if (opens(k, 'HeartOfTheFurnace'))
      window(k, ['HeartOfTheFurnace', '4Stellar'], 'on', 0, 0)
  }
  // Shields (kqmsim's Shields.Add): the kits mark each one they create (shieldMarker). The
  // effects of creating one and of being protected by one are declared off, on only from those
  const shields: {
    owner: CharacterKey
    target?: CharacterKey
    kind: string
    start: number
    end: number
  }[] = []
  /** Who is on the field from when, in turn */
  const fieldLog: [number, CharacterKey][] = [[0, onField]]
  /** Fractured Halo: until when its wielder's ATK bonus from a Skill or Burst is up */
  const haloUntil = new Map<CharacterKey, number>()
  for (const k of members) {
    for (const [item, path, value] of SHIELD_CREATED)
      if (holds(k, item)) window(k, [item, path], value, 0, 0)
    for (const [item, path, value, set] of SHIELDED) {
      const how = shieldGear(k, item, set)
      if (how) window(k, [item, path], value, 0, 0, how === 'unheld')
    }
  }
  /** A shield marker lands: it replaces its creator's earlier one of the same kind and target */
  const shieldCreated = (ctx: SimContext, hit: SimHit) => {
    const [, , frames, target, kind = ''] = hit.path
    const owner = hit.characterKey
    const t = hit.t
    const to = (target || undefined) as CharacterKey | undefined
    for (const s of shields)
      if (s.owner === owner && s.target === to && s.kind === kind && s.end > t)
        s.end = t
    shields.push({ owner, target: to, kind, start: t, end: t + +frames })
    onShield?.(t)
    // Angelos Heptades: Pathfinder's Light for 20 s after the wielder creates a shield (off the
    // field too), DMG for the member on the field
    if (holds(owner, 'AngelosHeptades'))
      ctx.buff(owner, ['AngelosHeptades', 'shield'], 'on', 0, 1200)
    // Starcaller's Watch: once per 14 s, when the wielder creates a shield on the field, DMG for
    // the member on the field for 15 s
    if (
      holds(owner, 'StarcallersWatch') &&
      hit.onField === owner &&
      ready(`starcaller.${owner}`, t, 840)
    )
      ctx.buff(owner, ['StarcallersWatch', 'shield'], 'on', 0, 900)
    // Fractured Halo: a shield while its Skill-or-Burst ATK bonus is up gives the party
    // Lunar-Charged DMG for 20 s
    if (holds(owner, 'FracturedHalo') && t < (haloUntil.get(owner) ?? -1))
      ctx.buff(owner, ['FracturedHalo', 'afterShield'], 'on', 0, 1200)
  }
  /**
   * When `k` is protected by a shield up to `end` (kqmsim's CharacterIsShielded): a party shield
   * protects the member on the field, a targeted one its target
   */
  const protectedSpans = (k: CharacterKey, end: number) => {
    const fields = fieldLog.map(([from, member], i) => ({
      member,
      from,
      to: Math.min(end, fieldLog[i + 1]?.[0] ?? end),
    }))
    const spans: [number, number][] = []
    for (const s of shields) {
      const until = Math.min(s.end, end)
      if (s.target) {
        if (s.target === k && s.start < until) spans.push([s.start, until])
        continue
      }
      for (const f of fields) {
        if (f.member !== k) continue
        const from = Math.max(s.start, f.from)
        const to = Math.min(until, f.to)
        if (from < to) spans.push([from, to])
      }
    }
    spans.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const [from, to] of spans) {
      const last = merged[merged.length - 1]
      if (last && from <= last[1]) last[1] = Math.max(last[1], to)
      else merged.push([from, to])
    }
    return merged
  }
  // The sets whose every trigger the simulation plays (set audit 2026-11-15, as gcsim): declared
  // off, so neither the rule nor a saved switch keeps them on where no trigger happened
  for (const k of members) {
    if (opens(k, 'ShimenawasReminiscence'))
      window(k, ['ShimenawasReminiscence', 'usedEnergy'], 'used', 0, 0)
    if (opens(k, 'GildedDreams'))
      window(k, ['GildedDreams', 'passive'], 'on', 0, 0)
    if (opens(k, 'DisenchantmentInDeepShadow'))
      window(k, ['DisenchantmentInDeepShadow', 'state'], 'on', 0, 0)
    if (opens(k, 'FinaleOfTheDeepGalleries')) {
      window(k, ['FinaleOfTheDeepGalleries', '0EnergyNoBurst'], 'on', 0, 0)
      window(k, ['FinaleOfTheDeepGalleries', '0EnergyNoNormal'], 'on', 0, 0)
    }
    if (opens(k, 'ADayCarvedFromRisingWinds'))
      window(k, ['ADayCarvedFromRisingWinds', 'set4'], 'on', 0, 0)
    if (opens(k, 'CrimsonWitchOfFlames'))
      window(k, ['CrimsonWitchOfFlames', 'stack'], '1', 0, 0)
    if (opens(k, 'DeepwoodMemories'))
      window(k, ['DeepwoodMemories', 'set4'], 'on', 0, 0)
    if (opens(k, 'TenacityOfTheMillelith'))
      window(k, ['TenacityOfTheMillelith', 'skill'], 'cast', 0, 0)
    if (opens(k, 'NoblesseOblige'))
      window(k, ['NoblesseOblige', 'set4'], 'on', 0, 0)
    if (opens(k, 'NymphsDream')) window(k, ['NymphsDream', 'set4'], '1', 0, 0)
    if (opens(k, 'LongNightsOath'))
      window(k, ['LongNightsOath', 'stacks'], '1', 0, 0)
    if (opens(k, 'NightOfTheSkysUnveiling'))
      window(k, ['NightOfTheSkysUnveiling', '4GleamingMoon'], 'on', 0, 0)
    if (opens(k, 'SilkenMoonsSerenade'))
      window(k, ['SilkenMoonsSerenade', '4GleamingMoon'], 'on', 0, 0)
    if (opens(k, 'GoldenTroupe'))
      window(k, ['GoldenTroupe', 'set4'], 'on', 0, 0)
    if (opens(k, 'CelestialGift'))
      window(k, ['CelestialGift', 'set4'], 'on', 0, 0)
    if (opens(k, 'ScarletProof')) window(k, ['ScarletProof', '4Ss'], 'on', 0, 0)
    if (opens(k, 'ArchaicPetra'))
      window(k, ['ArchaicPetra', 'element'], 'pyro', 0, 0)
    if (opens(k, 'ViridescentVenerer'))
      for (const e of SWIRLED)
        window(k, ['ViridescentVenerer', `swirl${e}`], e, 0, 0)
    // (not modelled: enemies defeated, DMG taken: never on)
    if (opens(k, 'BloodstainedChivalry'))
      window(k, ['BloodstainedChivalry', 'defeat'], 'on', 0, 0)
    if (opens(k, 'VourukashasGlow'))
      window(k, ['VourukashasGlow', 'set4'], '1', 0, 0)
    if (opens(k, 'MartialArtist'))
      window(k, ['MartialArtist', 'state'], 'on', 0, 0)
    if (opens(k, 'MaidenBeloved'))
      window(k, ['MaidenBeloved', 'state'], 'on', 0, 0)
  }
  /**
   * Stacks kept as intervals, one per status or slot (Nymph's Dream: one per attack kind; Long
   * Night's Oath: five slots): at the end, windows of how many are up (at most `cap`)
   */
  const intervals = new Map<
    string,
    {
      owner: CharacterKey
      path: string[]
      cap: number
      list: [number, number][]
    }
  >()
  const intervalsOf = (owner: CharacterKey, path: string[], cap: number) => {
    const key = `${owner}.${path.join('.')}`
    let entry = intervals.get(key)
    if (!entry) intervals.set(key, (entry = { owner, path, cap, list: [] }))
    return entry
  }
  /** Nymph's Dream (gcsim): each attack kind's status, refreshed by its own hits only */
  const nymphLast = new Map<string, [number, number]>()
  const nymphHit = (k: CharacterKey, kind: string, t: number) => {
    const key = `${k}.${kind}`
    const last = nymphLast.get(key)
    if (last && last[1] > t + 1) {
      last[1] = t + 1 + 480
      return
    }
    const status: [number, number] = [t + 1, t + 1 + 480]
    intervalsOf(k, ['NymphsDream', 'set4'], 3).list.push(status)
    nymphLast.set(key, status)
  }
  /** Long Night's Oath (gcsim): five slots of 6 s; a new stack past five replaces the oldest */
  const oathSlots = new Map<CharacterKey, [number, number][]>()
  const oathAdd = (k: CharacterKey, n: number, t: number) => {
    const slots = (oathSlots.get(k) ?? []).filter((slot) => slot[1] > t + 1)
    for (let i = 0; i < n; i++) {
      if (slots.length >= 5) {
        slots.sort((a, b) => a[1] - b[1])
        slots.shift()![1] = t + 1
      }
      const slot: [number, number] = [t + 1, t + 1 + 360]
      intervalsOf(k, ['LongNightsOath', 'stacks'], 5).list.push(slot)
      slots.push(slot)
    }
    oathSlots.set(k, slots)
  }
  /**
   * Scroll of the Hero of Cinder City (gcsim): after the wearer triggers a reaction involving its
   * element (off the field too), the party's DMG of the reaction's elements +12% for 15 s, and
   * +28% for 20 s more when the wearer is in Nightsoul's Blessing
   */
  const cinderCity = (
    ctx: SimContext,
    k: CharacterKey,
    t: number,
    elements: string[]
  ) => {
    if (!elements.includes(getCharEle(k))) return
    const nightsoul = inNightsoul(k, t)
    for (const e of new Set(elements)) {
      if (e === 'physical') continue
      ctx.buff(k, ['ScrollOfTheHeroOfCinderCity', `react_${e}`], e, 0, 900, {
        hitlag: 'recipient',
      })
      if (nightsoul)
        ctx.buff(
          k,
          ['ScrollOfTheHeroOfCinderCity', `nightsoul_${e}`],
          e,
          0,
          1200,
          { hitlag: 'recipient' }
        )
    }
  }
  /** Finale of the Deep Galleries: each wearer's last Normal Attack and Burst DMG (its frame) */
  const finaleLast = new Map<CharacterKey, { normal: number; burst: number }>()
  const desert = new Map<CharacterKey, { end: number }>()

  let initialized = false

  // Dendro resonance (gcsim): EM +30 for 6 s after Burning, Bloom, Lunar-Bloom or Quicken, and
  // +20 for 6 s after Aggravate or Spread (a 4-member team with 2+ Dendro members)
  const dendroResonance =
    members.length === 4 &&
    members.filter((m) => getCharEle(m) === 'dendro').length >= 2

  // Crystallize shards (gcsim): spawn 23 frames after the reaction, can be picked up 31 frames
  // later, last 15 s. A pickup gives the party its Crystallize shield (906 frames, gcsim's
  // shard.go; the reaction's trigger's) and, to an Archaic Petra 4 holder, 35% DMG of the shard's
  // element for the party for 10 s. They are picked up on a dash (KQM's pick_up_crystallize
  // before one), in the Petra holder's turn, and by Navia's hold (`takeShards`).
  let active = onField
  const petra = members.filter((m) => opens(m, 'ArchaicPetra'))
  const shards: {
    element: string
    owner: CharacterKey
    pickable: number
    expiry: number
  }[] = []
  const petraProc = (ctx: SimContext, holder: CharacterKey, element: string) =>
    ctx.buff(holder, ['ArchaicPetra', 'element'], element, 0, 600)
  const collect = (
    ctx: SimContext,
    who: CharacterKey,
    shard: (typeof shards)[number]
  ) => {
    ctx.hit(0, {
      characterKey: shard.owner,
      path: ['_marker', 'shield', '906', '', 'crystallize'],
      tag: 'other',
      element: 'physical',
      label: 'Crystallize shield',
    })
    if (petra.includes(who)) petraProc(ctx, who, shard.element)
  }
  const takeOne = (ctx: SimContext, who: CharacterKey) => {
    const t = ctx.now
    const i = shards.findIndex((x) => x.pickable <= t && t < x.expiry)
    if (i < 0) return
    const [shard] = shards.splice(i, 1)
    collect(ctx, who, shard)
  }
  const pickUp = (ctx: SimContext) => {
    if (petra.includes(active)) takeOne(ctx, active)
  }

  // Epochal Advent: a Starspark (2 at most) when the wearer uses a Skill or Burst or performs a
  // Normal Attack, one lost every 3 s the wearer is on the field (its clock waits off it), and
  // Undying Radiance (the set's conditional) while one is held
  const SPARK_LOSS = 180
  const sparks = new Map<
    CharacterKey,
    /**
     * the set's conditional; held; Radiance from; on-field frames to the next loss, counted from
     * `at`
     */
    { path: string[]; n: number; since: number; left: number; at: number }
  >()
  for (const m of members)
    for (const [set, conditional] of Object.entries(STARSPARK_SETS))
      if (opens(m, set) && !sparks.has(m)) {
        const path = [set, conditional]
        sparks.set(m, { path, n: 0, since: 0, left: SPARK_LOSS, at: 0 })
        // (declared: without a Starspark no Radiance, whatever the conditional's own state)
        window(m, path, 'on', 0, 0)
      }
  /** The wearer's Starsparks up to `t`: lost while it is on the field */
  const settleSparks = (k: CharacterKey, t: number) => {
    const s = sparks.get(k)
    if (!s) return
    if (active === k) {
      while (s.n > 0 && s.at + s.left <= t) {
        s.at += s.left
        s.left = SPARK_LOSS
        s.n--
        if (!s.n) window(k, s.path, 'on', s.since, s.at)
      }
      if (s.n > 0) s.left -= t - s.at
    }
    s.at = t
  }
  const gainSpark = (k: CharacterKey, t: number) => {
    const s = sparks.get(k)
    if (!s) return
    settleSparks(k, t)
    if (!s.n) {
      s.since = t
      s.left = SPARK_LOSS
    }
    s.n = Math.min(2, s.n + 1)
  }

  // The weapon effects played from descriptions (rotation/weapons): declared off, on from their
  // own triggers
  const weapons = weaponEffects(WEAPON_MODULES, {
    members,
    gear,
    onField,
    window,
    stack,
    ready,
  })
  weapons.declare()

  return {
    onHit(ctx, hit) {
      weapons.onHit(ctx, hit)
      const k = hit.characterKey
      const t = hit.t
      if (hit.path[0] === '_marker' && hit.path[1] === 'shield') {
        shieldCreated(ctx, hit)
        return
      }
      // Golden Majesty (kqmsim goldenmajesty.go): each damage instance of the wielder's on the
      // field, once per 0.3 s of its clock, a stack for 8 s (its clock), every stack refreshed,
      // up to 5; the hit itself counts the stacks from before it
      if (
        !hit.path[0].startsWith('_') &&
        hit.onField === k &&
        GOLDEN_MAJESTY.some((w) => holds(k, w))
      ) {
        const frame = ctx.characterFrame(k)
        if (ready(`goldenMajesty.${k}`, frame, 18)) {
          const old = majesty.get(k)
          const previous = old && frame < old.end ? old.count : 0
          const next = { count: Math.min(5, previous + 1), end: frame + 480 }
          majesty.set(k, next)
          for (const weapon of GOLDEN_MAJESTY)
            if (holds(k, weapon)) {
              hit.states = [
                ...(hit.states ?? []),
                {
                  owner: k,
                  path: [weapon, 'GoldenMajesty'],
                  value: previous ? `${previous}` : '',
                },
              ]
              ctx.state(k, [weapon, 'GoldenMajesty'], `${next.count}`)
            }
          ctx.atCharacter(k, 480, (at) => {
            if (majesty.get(k) !== next) return
            for (const weapon of GOLDEN_MAJESTY)
              if (holds(k, weapon)) at.state(k, [weapon, 'GoldenMajesty'], '')
          })
        }
      }
      // A Thousand Blazing Suns (gcsim): Scorching Brilliance's ATK and CRIT DMG x1.75 while the
      // wielder is in Nightsoul's Blessing, as each of its hits lands
      if (
        holds(k, 'AThousandBlazingSuns') &&
        !hit.path[0].startsWith('_') &&
        inNightsoul(k, t)
      )
        ctx.buff(k, ['AThousandBlazingSuns', 'nightsoul'], 'on', 0, 1, {
          recipient: k,
        })
      // (a Normal Attack performed: a Starspark)
      // (a Starspark per Normal Attack performed: in onAction, not from its hits)
      if (
        opens(k, 'PaleFlame') &&
        hit.tag === 'skill' &&
        !hit.path[0].startsWith('_') &&
        hit.onField === k
      ) {
        const frame = ctx.characterFrame(k)
        const old = paleFlame.get(k)
        if (!old || frame >= old.ready) {
          const previous = old && frame < old.end ? old.count : 0
          // Damage occurs before OnEnemyDamage grants the new stack.
          hit.states = [
            ...(hit.states ?? []),
            {
              owner: k,
              path: ['PaleFlame', 'stacks'],
              value: previous ? `${previous}` : '',
            },
          ]
          const next = {
            count: Math.min(2, previous + 1),
            end: frame + 420,
            ready: frame + 18,
          }
          paleFlame.set(k, next)
          ctx.state(k, ['PaleFlame', 'stacks'], `${next.count}`)
          ctx.atCharacter(k, 420, (at) => {
            if (paleFlame.get(k) === next)
              at.state(k, ['PaleFlame', 'stacks'], '')
          })
        }
      }
      // Heart of the Furnace (gcsim): the wearer's ATK +12% and the party's Stellar Glimmer
      // reaction DMG +50% for 12 s when the wearer deals Stellar Glimmer DMG (off the field too)
      if (
        (hit.tag === 'directStellarConduct' ||
          hit.tag === 'directStellarSwirl') &&
        opens(k, 'HeartOfTheFurnace')
      )
        ctx.buff(k, ['HeartOfTheFurnace', '4Stellar'], 'on', 0, 720)
      if (dendroResonance && hit.path[0] === '_reaction') {
        if (['burning', 'bloom', 'lunarBloom', 'quicken'].includes(hit.path[1]))
          ctx.buff('team', ['resonance', 'SprawlingCanopy2ele'], 'on', 0, 360)
        else if (['aggravate', 'spread'].includes(hit.path[1]))
          ctx.buff('team', ['resonance', 'SprawlingCanopy3ele'], 'on', 0, 360)
      }
      if (hit.path[0] === '_reaction') {
        if (hit.path[1] === 'crystallize' && hit.element !== 'geo') {
          shards.push({
            element: hit.element,
            owner: k,
            pickable: t + 54,
            expiry: t + 23 + 900,
          })
          if (petra.length) ctx.at(54, (c) => pickUp(c))
        } else if (hit.path[1] === 'lunarCrystallize' && petra.includes(active))
          petraProc(ctx, active, 'hydro')
      }
      if (
        hit.path.join('.') === '_marker.hpLoss' &&
        opens(k, 'VermillionHereafter')
      ) {
        const active = vermillion.get(k)
        if (active && t < active.end && ready(`vermillion.${k}`, t, 48)) {
          active.count = Math.min(4, active.count + 1)
          ctx.state(k, ['VermillionHereafter', 'stacks'], `${active.count}`)
        }
      }
      if (hit.path[0] === '_heal') {
        // Tidal Shadow, Song of Stillness (kqmsim): 8 s (hitlag-extended) after a heal reaches
        // the wielder, off the field too; the heal's targets as the simulation heals them
        const healed =
          hit.healTargets ??
          ((hit.weight ?? 1) === members.length
            ? members
            : [hit.onField ?? active])
        for (const target of healed)
          for (const weapon of HEALED_WEAPONS)
            if (holds(target, weapon))
              ctx.buff(target, [weapon, 'afterHeal'], 'on', 0, 480, {
                hitlag: 'recipient',
              })
        if (!wears(k, 'OceanHuedClam') || (bubble && bubble.owner !== k)) return
        if (!bubble) {
          if (t < (clamReady.get(k) ?? 0)) return
          const next = {
            owner: k,
            end: t + 180,
            healing: [] as { path: string[]; count: number }[],
          }
          bubble = next
          clamReady.set(k, t + 210)
          ctx.at(180, (c) => {
            if (bubble !== next) return
            bubble = undefined
            c.hit(1, {
              characterKey: k,
              path: ['artifact:OceanHuedClam', 'heal'],
              tag: 'other',
              element: 'physical',
              label: 'Sea-Dyed Foam',
              healing: next.healing,
            })
          })
        }
        // (a heal by Max HP %, `healPercent`, has no node to sum)
        if (t < bubble.end && hit.path[1] !== '_percent') {
          const path = hit.path.slice(1)
          const prev = bubble.healing.find(
            (h) => h.path.join('.') === path.join('.')
          )
          if (prev) prev.count += hit.weight ?? 1
          else bubble.healing.push({ path, count: hit.weight ?? 1 })
        }
        return
      }
      if (hit.path[0] === '_reaction') {
        const reaction = hit.path[1]
        if (
          ['lunarCharged', 'lunarBloom', 'lunarCrystallize'].includes(reaction)
        )
          for (const wearer of members)
            if (
              wearer === hit.onField &&
              opens(wearer, 'NightOfTheSkysUnveiling')
            )
              ctx.buff(
                wearer,
                ['NightOfTheSkysUnveiling', '4GleamingMoon'],
                'on',
                1,
                240
              )
        hakushin(ctx, hit, reaction)
        // Sapwood Blade / Forest Regalia (gcsim): the wielder's own Burning, Quicken, Aggravate,
        // Spread, Bloom, Lunar-Bloom, Hyperbloom or Burgeon (off the field too) makes a Leaf of
        // Consciousness, one per 20 s; picked up at once by whoever is on the field: EM for 12 s
        if (LEAF_REACTIONS.includes(reaction))
          for (const weapon of LEAF_WEAPONS)
            if (
              holds(k, weapon) &&
              ready(`leaf.${k}.${weapon}`, ctx.characterFrame(k), 1200)
            )
              ctx.buff(k, [weapon, 'passive'], 'on', 0, 720)
        // Frostbreath (gcsim): the wielder's own Cryo- or Hydro-related reaction (off the field
        // too) gives it ATK for 15 s, once per 16 s; both are hitlag statuses (its own clock)
        if (
          holds(k, 'Frostbreath') &&
          isFrostbreathReaction(hit) &&
          ready(`frostbreath.${k}`, ctx.characterFrame(k), 960)
        )
          ctx.buff(k, ['Frostbreath', 'react'], 'on', 0, 900, {
            recipient: k,
            hitlag: 'recipient',
          })
        if (reaction === 'moondrift' || reaction === 'moondriftHarmony') return
        // Viridescent Venerer: the swirled element's RES -40% for 10 s
        if (opens(k, 'ViridescentVenerer') && hit.onField === k) {
          const e =
            reaction === 'stellarSwirl'
              ? 'cryo'
              : reaction.endsWith('Swirl')
                ? reaction.slice(0, -5)
                : ''
          if (SWIRLED.includes(e))
            ctx.buff(k, ['ViridescentVenerer', `swirl${e}`], e, 0, 600, {
              hitlag: 'enemy',
            })
        }
        // Heart of the Furnace: also when the wearer triggers a Stellar-Conduct or Stellar Swirl
        if (
          (reaction === 'stellarConduct' || reaction === 'stellarSwirl') &&
          opens(k, 'HeartOfTheFurnace')
        )
          ctx.buff(k, ['HeartOfTheFurnace', '4Stellar'], 'on', 0, 720)
        // Scarlet Proof: the wearer's CRIT Rate +16% and Stellar Swirl DMG +40% for 10 s after it
        // triggers a Stellar Swirl
        if (reaction === 'stellarSwirl' && opens(k, 'ScarletProof'))
          ctx.buff(k, ['ScarletProof', '4Ss'], 'on', 0, 600)
        // Instructor: the party's EM +120 for 8 s after the wearer triggers a reaction while it is
        // on the field (gcsim: its off-field reactions do not count). (gcsim extends the 8 s by
        // each member's hitlag: a few frames, not modelled.)
        if (opens(k, 'Instructor') && hit.onField === k)
          ctx.buff(k, ['Instructor', 'set4'], 'on', 0, 480)
        // Gilded Dreams (gcsim): the wearer's own reactions, off the field too, 8 s, once per 8 s
        if (opens(k, 'GildedDreams') && ready(`gilded.${k}`, t, 480))
          ctx.buff(k, ['GildedDreams', 'passive'], 'on', 0, 480)
        // Scroll of the Hero of Cinder City: the elements of the reaction (gcsim: Spread is
        // Dendro's only; Crystallize the Geo and the crystallized element)
        if (opens(k, 'ScrollOfTheHeroOfCinderCity'))
          cinderCity(
            ctx,
            k,
            t,
            reaction === 'crystallize'
              ? ['geo', hit.element]
              : reaction === 'spread'
                ? ['dendro']
                : (REACTION_ELEMENTS[reaction] ?? [])
          )
        // Flower of Paradise Lost: a stack per Bloom (1 s ICD), 10 s, up to 4
        if (
          opens(k, 'FlowerOfParadiseLost') &&
          (reaction === 'bloom' || reaction === 'lunarBloom') &&
          ready(`fopl.${k}`, t, 60)
        )
          ctx.buff(k, ['FlowerOfParadiseLost', 'stacks'], '1', 0, 600, 4)
        // Thundering Fury: the wearer's Elemental Skill CD -1 s (0.8 s ICD), on the field
        if (
          wears(k, 'ThunderingFury') &&
          hit.onField === k &&
          [
            'overloaded',
            'electroCharged',
            'lunarCharged',
            'superconduct',
            'stellarConduct',
            'quicken',
            'aggravate',
          ].includes(reaction) &&
          ready(`tf.${k}`, t, 48)
        )
          reduceCooldown(k, 'skill', 60, t)
        return
      }
      if (hit.path[0] === 'reaction') {
        const node = hit.path[1]
        if (node === 'hyperbloom' || node === 'burgeon') {
          // Sapwood Blade / Forest Regalia / Moonpiercer: a Leaf from the wielder's own Hyperbloom
          // or Burgeon too (they have no reaction marker: their damage)
          for (const weapon of LEAF_WEAPONS)
            if (
              holds(k, weapon) &&
              ready(`leaf.${k}.${weapon}`, ctx.characterFrame(k), 1200)
            )
              ctx.buff(k, [weapon, 'passive'], 'on', 0, 720)
          if (opens(k, 'ScrollOfTheHeroOfCinderCity'))
            cinderCity(
              ctx,
              k,
              t,
              node === 'hyperbloom' ? ['dendro', 'electro'] : ['dendro', 'pyro']
            )
          if (opens(k, 'Instructor') && hit.onField === k)
            ctx.buff(k, ['Instructor', 'set4'], 'on', 0, 480)
          if (opens(k, 'GildedDreams') && ready(`gilded.${k}`, t, 480))
            ctx.buff(k, ['GildedDreams', 'passive'], 'on', 0, 480)
        }
        if (node === 'hyperbloom') hakushin(ctx, hit, node)
        if (
          opens(k, 'FlowerOfParadiseLost') &&
          (node === 'hyperbloom' || node === 'burgeon') &&
          ready(`fopl.${k}`, t, 60)
        )
          ctx.buff(k, ['FlowerOfParadiseLost', 'stacks'], '1', 0, 600, 4)
        if (
          wears(k, 'ThunderingFury') &&
          node === 'hyperbloom' &&
          hit.onField === k &&
          ready(`tf.${k}`, t, 48)
        )
          reduceCooldown(k, 'skill', 60, t)
        return
      }
      // Clash of Kings (gcsim): the wielder's Charged Attack hit on the field while Laws of the
      // Board is up extends it by 6 s, once per trigger (within its 12 s)
      if (
        hit.tag === 'charged' &&
        !hit.path[0].startsWith('_') &&
        hit.onField === k &&
        holds(k, 'ClashOfKings')
      ) {
        const own = ctx.characterFrame(k)
        const laws = clash.get(k)
        if (
          laws &&
          !laws.extended &&
          own < laws.end &&
          own < laws.extendUntil
        ) {
          laws.extended = true
          laws.end += 360
          ctx.buff(k, ['ClashOfKings', 'skill'], 'on', 0, laws.end - own, {
            recipient: k,
            hitlag: 'recipient',
          })
        }
      }
      if (
        hit.tag === 'charged' &&
        !hit.path[0].startsWith('_') &&
        opens(k, 'DesertPavilionChronicle')
      ) {
        const path = ['DesertPavilionChronicle', 'set4']
        const frame = ctx.characterFrame(k)
        // Native grants the effect after damage: the triggering instance retains its old state.
        hit.states = [
          ...(hit.states ?? []),
          {
            owner: k,
            path,
            value: frame < (desert.get(k)?.end ?? -1) ? 'on' : '',
          },
        ]
        const entry = { end: frame + 900 }
        desert.set(k, entry)
        ctx.buff(k, path, 'on', 0, 900, { recipient: k, hitlag: 'recipient' })
        // (its attack speed changes the play: only when worn)
        if (wears(k, 'DesertPavilionChronicle')) {
          ctx.state(k, ['DesertPavilionChronicle', '_selfAttackSpeed'], '0.1')
          ctx.atCharacter(k, 900, (at) => {
            if (desert.get(k) !== entry) return
            at.state(k, ['DesertPavilionChronicle', '_selfAttackSpeed'], '')
          })
        }
      }
      // Fragment of Harmonic Whimsy: +18% DMG per Bond of Life change (6 s, up to 3); kits mark
      // the changes with ['_marker', 'bondOfLife']
      if (
        hit.path[0] === '_marker' &&
        hit.path[1] === 'bondOfLife' &&
        opens(k, 'FragmentOfHarmonicWhimsy')
      )
        stack(k, ['FragmentOfHarmonicWhimsy', 'stacks'], t, 360, 3)
      if (
        hit.path[0] === '_marker' &&
        hit.path[1] === 'hpChange' &&
        hit.onField === k &&
        opens(k, 'MarechausseeHunter')
      ) {
        // Native MH refreshes the whole stack count, rather than expiring each gain separately.
        const count = Math.min(
          3,
          (ctx.hasBuff(k, ['MarechausseeHunter', 'set4'])
            ? (marechaussee.get(k) ?? 0)
            : 0) + 1
        )
        marechaussee.set(k, count)
        ctx.buff(k, ['MarechausseeHunter', 'set4'], String(count), 0, 300, {
          hitlag: 'recipient',
        })
      }
      // Silken Moon's Serenade: on the wearer's elemental attacks landing, zero-damage ones that
      // apply an element too (Nilou's Tranquility Aura, Xingqiu's Rain Sword orbitals)
      if (
        ctx.moonsign >= 1 &&
        opens(k, 'SilkenMoonsSerenade') &&
        hit.element !== 'physical' &&
        (!hit.path[0].startsWith('_') ||
          (hit.path[0] === '_marker' && hit.applies))
      )
        ctx.buff(k, ['SilkenMoonsSerenade', '4GleamingMoon'], 'on', 1, 480)
      if (hit.path[0].startsWith('_')) return
      // Beacon of the Reed Sea (kqmsim beacon.go): ATK for 8 s (hitlag-extended) after each of the
      // wielder's Skill hits, off the field too, from the next hit on
      if (holds(k, 'BeaconOfTheReedSea') && hit.tag === 'skill')
        ctx.buff(k, ['BeaconOfTheReedSea', 'afterSkill'], 'on', 1, 480, {
          recipient: k,
          hitlag: 'recipient',
        })
      // Rainbow Serpent's Rainbow (kqmsim): ATK for 8 s (hitlag-extended) after the wielder's
      // attack hits while it is off the field, from the next hit on
      if (holds(k, 'RainbowSerpentsRainBow') && hit.onField !== k)
        ctx.buff(k, ['RainbowSerpentsRainBow', 'passive'], 'on', 1, 480, {
          hitlag: 'recipient',
        })
      // Sacrificial procs are random in game. Use accumulated proc probability as a stable
      // expected-timing estimate, with the refinement's real ICD and on-field restriction.
      if (
        [
          'SacrificialFragments',
          'SacrificialSword',
          'SacrificialGreatsword',
          'SacrificialBow',
        ].includes(gear[k]?.weapon ?? '') &&
        hit.tag === 'skill' &&
        hit.onField === k &&
        t >= (sacReady.get(k) ?? 0) &&
        cooldown(k, 'skill', t) > 0
      ) {
        const refinement = Math.min(5, Math.max(1, gear[k]?.refinement ?? 1))
        const credit = (sacCredit.get(k) ?? 0) + 0.3 + 0.1 * refinement
        ctx.note(
          `${gear[k]!.weapon}: proc timing is estimated from refinement and eligible Skill hits; actual random procs can change rotation length.`
        )
        if (credit >= 1 - 1e-9) {
          reduceCooldown(k, 'skill', Number.MAX_SAFE_INTEGER, t)
          sacReady.set(
            k,
            t +
              (refinement >= 4
                ? 19 - (refinement - 4) * 3
                : 34 - refinement * 4) *
                60
          )
          sacCredit.set(k, credit - 1)
        } else sacCredit.set(k, credit)
      }
      // Deepwood Memories: Dendro RES -30% for 8 s after the wearer's Skill or Burst hits (any
      // element: gcsim deepwood.go)
      if (
        opens(k, 'DeepwoodMemories') &&
        (hit.tag === 'skill' || hit.tag === 'burst')
      )
        ctx.buff(k, ['DeepwoodMemories', 'set4'], 'on', 0, 480)
      // A Day Carved From Rising Winds (gcsim): 6 s after the wearer's own Normal, Charged, Skill
      // or Burst hit (off the field too); granted after the hit's damage
      if (
        opens(k, 'ADayCarvedFromRisingWinds') &&
        ['normal', 'charged', 'skill', 'burst'].includes(hit.tag)
      )
        ctx.buff(k, ['ADayCarvedFromRisingWinds', 'set4'], 'on', 1, 360)
      // Nymph's Dream (gcsim): the wearer's own hits on the field, a status per attack kind (8 s)
      if (
        opens(k, 'NymphsDream') &&
        hit.onField === k &&
        ['normal', 'charged', 'plunge', 'skill', 'burst'].includes(hit.tag)
      )
        nymphHit(k, hit.tag, t)
      // Long Night's Oath (gcsim): the wearer's own Plunging (1), Charged (2) and Skill (2) hits on
      // the field, each kind once per second, 6 s stacks, up to 5
      if (
        opens(k, 'LongNightsOath') &&
        hit.onField === k &&
        (hit.tag === 'plunge' ||
          hit.tag === 'charged' ||
          hit.tag === 'skill') &&
        ready(`oath.${k}.${hit.tag}`, ctx.characterFrame(k), 60)
      )
        oathAdd(k, hit.tag === 'plunge' ? 1 : 2, t)
      // Disenchantment in Deep Shadow (gcsim): the wearer's attacks on an enemy under
      // Superconduct or in the Polestar field (Stellar-Conduct) get its CRIT Rate
      if (opens(k, 'DisenchantmentInDeepShadow'))
        hit.states = [
          ...(hit.states ?? []),
          {
            owner: k,
            path: ['DisenchantmentInDeepShadow', 'state'],
            value:
              ctx.hasBuff('team', ['reaction', 'superconduct']) ||
              ctx.hasBuff('team', ['reaction', 'oppInsidePole'])
                ? 'on'
                : '',
          },
        ]
      // Finale of the Deep Galleries (gcsim): only at 0 Energy (the characters without Energy:
      // Skirk, Mavuika); Normal Attack DMG +60% unless the wearer dealt Burst DMG in the last 6 s,
      // Burst DMG +60% unless it dealt Normal Attack DMG in the last 6 s
      if (
        opens(k, 'FinaleOfTheDeepGalleries') &&
        (hit.tag === 'normal' || hit.tag === 'burst')
      ) {
        const zero = energyCalcData[k]?.burstCost === 0
        const frame = ctx.characterFrame(k)
        const last = finaleLast.get(k) ?? {
          normal: Number.NEGATIVE_INFINITY,
          burst: Number.NEGATIVE_INFINITY,
        }
        hit.states = [
          ...(hit.states ?? []),
          {
            owner: k,
            path: ['FinaleOfTheDeepGalleries', '0EnergyNoBurst'],
            value: zero && frame >= last.burst + 360 ? 'on' : '',
          },
          {
            owner: k,
            path: ['FinaleOfTheDeepGalleries', '0EnergyNoNormal'],
            value: zero && frame >= last.normal + 360 ? 'on' : '',
          },
        ]
        finaleLast.set(k, { ...last, [hit.tag]: frame })
      }
      // Tenacity of the Millelith: the party's ATK +20% for 3 s after a skill hit (0.5 s ICD)
      if (
        opens(k, 'TenacityOfTheMillelith') &&
        hit.tag === 'skill' &&
        ready(`totm.${k}`, t, 30)
      )
        ctx.buff(k, ['TenacityOfTheMillelith', 'skill'], 'cast', 0, 180)
    },
    beforeAction(ctx, actor, action) {
      weapons.onAction(ctx, actor, action)
      if (action.kind === 'dash' && actor === active) takeOne(ctx, actor)
    },
    onAction(ctx, actor, action, normalStarts) {
      if (actor === active) pickUp(ctx)
      // Clash of Kings (gcsim): the wielder's Skill on the field grants Laws of the Board (ATK, EM)
      // for 6 s (hitlag-extended), once per 12 s on its own clock
      if (
        action.kind === 'skill' &&
        actor === active &&
        holds(actor, 'ClashOfKings')
      ) {
        const own = ctx.characterFrame(actor)
        // (gcsim's 12 s ICD status is still active on its expiry frame)
        if (ready(`clash.${actor}`, own, 721)) {
          clash.set(actor, {
            end: own + 360,
            extendUntil: own + 720,
            extended: false,
          })
          ctx.buff(actor, ['ClashOfKings', 'skill'], 'on', 0, 360, {
            recipient: actor,
            hitlag: 'recipient',
          })
        }
      }
      // Fractured Halo: its ATK bonus for 20 s after the wielder's Skill or Burst on the field
      if (
        (action.kind === 'skill' || action.kind === 'burst') &&
        actor === active &&
        holds(actor, 'FracturedHalo')
      )
        haloUntil.set(actor, ctx.now + 1200)
      // Heretic's Molten Blade: Gleam of First Light after the wielder's Skill while it is on the
      // field, for 14 s, once per 14 s, removed when it leaves the field (gcsim). Its ATK bonus
      // follows the distance travelled each second, which is not modelled: counted at its most.
      if (
        action.kind === 'skill' &&
        actor === active &&
        holds(actor, 'HereticsMoltenBlade') &&
        ready(`gleam.${actor}`, ctx.now, 840)
      ) {
        const started = ctx.now
        gleam.set(actor, started)
        ctx.state(actor, ['HereticsMoltenBlade', 'passive'], GLEAM_STATE)
        ctx.at(840, (c) => {
          if (gleam.get(actor) !== started) return
          gleam.delete(actor)
          c.state(actor, ['HereticsMoltenBlade', 'passive'], '')
        })
      }
      // a Starspark per Skill, Burst and Normal Attack performed (each Normal of a string)
      if (action.kind === 'normal' && normalStarts?.length)
        for (const start of normalStarts)
          if (start.offset > 0)
            ctx.at(start.offset, (c) => gainSpark(actor, c.now))
          else gainSpark(actor, ctx.now)
      else if (
        action.kind === 'skill' ||
        action.kind === 'burst' ||
        action.kind === 'normal'
      )
        gainSpark(actor, ctx.now)
      if (action.kind === 'burst' && gear[actor]?.weapon === 'PrototypeAmber') {
        const refinement = Math.max(
          1,
          Math.min(5, gear[actor]?.refinement ?? 1)
        )
        const fraction = (3.5 + 0.5 * refinement) / 100
        for (const recipient of members)
          for (const delay of [120, 240, 360])
            ctx.atCharacter(recipient, delay, (at) =>
              at.healPercent(actor, fraction, [recipient])
            )
      }
      if (!initialized) {
        initialized = true
        for (const member of members) {
          if (!opens(member, 'UnfinishedReverie')) continue
          let count = 5
          let lastBurning = -1
          let readyAt = -1
          ctx.state(member, ['UnfinishedReverie', 'stacks'], '5')
          const check = (c: SimContext) => {
            if (c.isBurning) lastBurning = c.now
            const old = count
            // The reference checks every 30f, with a strict >60f stack-change ICD.
            if (c.now > readyAt) {
              if (c.now - lastBurning > 360 && count > 0) count--
              else if (c.now === lastBurning && count < 5) count++
            }
            if (old !== count) {
              readyAt = c.now + 60
              c.state(
                member,
                ['UnfinishedReverie', 'stacks'],
                count ? String(count) : ''
              )
            }
            c.at(30, check)
          }
          ctx.at(30, check)
        }
      }

      if (action.kind === 'burst' && opens(actor, 'VermillionHereafter')) {
        const entry = { start: ctx.now, end: ctx.now + 960, count: 0 }
        vermillion.set(actor, entry)
        ctx.state(actor, ['VermillionHereafter', 'afterBurst'], 'on')
        ctx.state(actor, ['VermillionHereafter', 'stacks'], '')
        ctx.at(960, (c) => {
          if (vermillion.get(actor) !== entry) return
          c.state(actor, ['VermillionHereafter', 'afterBurst'], '')
          c.state(actor, ['VermillionHereafter', 'stacks'], '')
        })
      }
      // Noblesse Oblige: the party's ATK +20% for 12 s after the burst
      if (action.kind === 'burst' && opens(actor, 'NoblesseOblige'))
        ctx.buff(actor, ['NoblesseOblige', 'set4'], 'on', 0, 720)
      // Celestial Gift: after the wearer's skill on the field, 20 s (the sheet applies the
      // Hexerei Secret Rite part and the elements)
      if (
        action.kind === 'skill' &&
        opens(actor, 'CelestialGift') &&
        ctx.onField === actor
      )
        ctx.buff(actor, ['CelestialGift', 'set4'], 'on', 0, 1200)
      // Crimson Witch of Flames (gcsim): a stack per skill, up to 3, all of them 10 s from the
      // last skill
      if (action.kind === 'skill' && opens(actor, 'CrimsonWitchOfFlames'))
        stack(actor, ['CrimsonWitchOfFlames', 'stack'], ctx.now, 600, 3)
      // Shimenawa's Reminiscence (gcsim): the wearer's Skill on the field (with 15 Energy to
      // spend: not modelled, assumed) gives Normal, Charged and Plunging DMG +50% for 10 s; not
      // again while it lasts
      if (
        action.kind === 'skill' &&
        opens(actor, 'ShimenawasReminiscence') &&
        ctx.onField === actor &&
        ready(`shimenawa.${actor}`, ctx.now, 600)
      )
        ctx.buff(
          actor,
          ['ShimenawasReminiscence', 'usedEnergy'],
          'used',
          0,
          600
        )
      // Martial Artist (gcsim): Normal and Charged Attack DMG +25% for 8 s after the Skill
      if (action.kind === 'skill' && opens(actor, 'MartialArtist'))
        ctx.buff(actor, ['MartialArtist', 'state'], 'on', 0, 480)
      // Maiden Beloved: the party's healing received +20% for 10 s after the Skill or Burst
      if (
        (action.kind === 'skill' || action.kind === 'burst') &&
        opens(actor, 'MaidenBeloved')
      )
        ctx.buff(actor, ['MaidenBeloved', 'state'], 'on', 0, 600)
      // Nighttime Whispers in the Echoing Woods: Geo DMG +20% for 10 s after the skill
      if (
        action.kind === 'skill' &&
        opens(actor, 'NighttimeWhispersInTheEchoingWoods')
      )
        ctx.buff(
          actor,
          ['NighttimeWhispersInTheEchoingWoods', 'afterSkill'],
          'on',
          0,
          600
        )
    },
    onSwap(t, from, to, ctx) {
      weapons.onSwap(t, from, to, ctx)
      // (Starsparks lost on the field up to the swap, and none off it for the incoming member:
      // both settled before it takes the field)
      settleSparks(from, t)
      settleSparks(to, t)
      active = to
      fieldLog.push([t, to])
      if (ctx) pickUp(ctx)
      // Thrilling Tales of Dragon Slayers: the wielder's swap-out gives the incoming member
      // its ATK for 10 s (hitlag-extended), once per 20 s (gcsim)
      if (
        ctx &&
        holds(from, 'ThrillingTalesOfDragonSlayers') &&
        ready(`ttds.${from}`, t, 1200)
      )
        ctx.buff(
          from,
          ['ThrillingTalesOfDragonSlayers', 'Heritage'],
          'on',
          0,
          600,
          {
            recipient: to,
            hitlag: 'recipient',
          }
        )
      if (gleam.delete(from))
        ctx?.state(from, ['HereticsMoltenBlade', 'passive'], '')
      // The Widsith: taking the field plays one of its three songs at random for 10 s
      // (hitlag-extended), once per 30 s (gcsim): their average
      if (
        ctx &&
        holds(to, 'TheWidsith') &&
        // (its 30 s cooldown on the wielder's clock, as kqmsim widsith.go)
        ready(`widsith.${to}`, ctx.characterFrame(to), 1800)
      )
        ctx.buff(to, ['TheWidsith', 'Debut'], 'avg', 0, 600, {
          hitlag: 'recipient',
        })
      const vermillionState = vermillion.get(from)
      if (vermillionState) {
        // Close the live intervals on departure, including when no more damage is dealt.
        ctx?.state(from, ['VermillionHereafter', 'afterBurst'], '')
        ctx?.state(from, ['VermillionHereafter', 'stacks'], '')
        vermillionState.end = t
      }
      const outgoing = jadeStates.get(from)
      if (outgoing) {
        if (outgoing.onSince !== undefined && t >= outgoing.onSince + 600)
          closeJade(from, outgoing, outgoing.onSince + 600)
        outgoing.onSince = undefined
        outgoing.offSince = t
      }
      const incoming = jadeStates.get(to)
      if (incoming) {
        if (
          incoming.activeSince === undefined &&
          incoming.offSince !== undefined &&
          t >= incoming.offSince + 300
        )
          incoming.activeSince = incoming.offSince + 300
        incoming.offSince = undefined
        incoming.onSince = t
      }
      if (opens(from, 'GoldenTroupe')) offSince.set(from, t)
      if (opens(from, 'AubadeOfMorningstarAndMoon')) aubadeOff.set(from, t)
      const aubadeSince = aubadeOff.get(to)
      if (aubadeSince !== undefined) {
        window(
          to,
          ['AubadeOfMorningstarAndMoon', 'set4'],
          'on',
          aubadeSince,
          t + 180
        )
        aubadeOff.delete(to)
      }
      const since = offSince.get(to)
      if (since !== undefined) {
        // Golden Troupe's off-field bonus lasts until 2 s after taking the field
        window(to, ['GoldenTroupe', 'set4'], 'on', since, t + 120)
        offSince.delete(to)
      }
    },
    shieldedAt(k, t) {
      let field = fieldLog[0][1]
      for (const [from, member] of fieldLog) {
        if (from > t) break
        field = member
      }
      return shields.some(
        (s) =>
          s.start <= t && t < s.end && (s.target ? s.target === k : field === k)
      )
    },
    takeShards(ctx, who, arrive) {
      const at = ctx.now + arrive
      const taken = shards.filter(
        (x) => x.pickable - 31 <= ctx.now && x.pickable <= at && at < x.expiry
      )
      for (const shard of taken) {
        shards.splice(shards.indexOf(shard), 1)
        ctx.at(arrive, (c) => collect(c, who, shard))
      }
      return taken.length
    },
    end(t) {
      weapons.end(t)
      for (const k of members)
        for (const [item, path, value, set] of SHIELDED) {
          const how = shieldGear(k, item, set)
          if (!how) continue
          const offOnly = how === 'unheld'
          const spans = protectedSpans(k, t)
          if (item !== 'BeaconOfTheReedSea') {
            for (const [from, to] of spans)
              window(k, [item, path], value, from, to, offOnly)
            continue
          }
          // (Beacon of the Reed Sea: while not protected)
          let from = 0
          for (const [start, to] of spans) {
            if (start > from)
              window(k, [item, path], value, from, start, offOnly)
            from = to
          }
          if (t > from) window(k, [item, path], value, from, t, offOnly)
        }
      shields.length = 0
      for (const [k, s] of sparks) {
        settleSparks(k, t)
        if (s.n) window(k, s.path, 'on', s.since, t)
      }
      sparks.clear()
      for (const s of stacks.values())
        window(s.owner, s.path, `${s.count}`, s.start, Math.min(t, s.end))
      stacks.clear()
      for (const { owner, path, cap, list } of intervals.values()) {
        const edges = list
          .filter(([start]) => start < t)
          .flatMap(([start, end]): [number, number][] => [
            [start, 1],
            [Math.min(end, t), -1],
          ])
          .sort((a, b) => a[0] - b[0] || a[1] - b[1])
        let count = 0
        let from = 0
        for (const [at, change] of edges) {
          if (count > 0 && at > from)
            window(owner, path, `${Math.min(cap, count)}`, from, at)
          count += change
          from = at
        }
      }
      intervals.clear()
      for (const [k, since] of aubadeOff)
        window(k, ['AubadeOfMorningstarAndMoon', 'set4'], 'on', since, t)
      aubadeOff.clear()
      for (const [k, s] of jadeStates) {
        if (
          s.activeSince === undefined &&
          s.offSince !== undefined &&
          t >= s.offSince + 300
        )
          s.activeSince = s.offSince + 300
        closeJade(
          k,
          s,
          s.onSince === undefined ? t : Math.min(t, s.onSince + 600)
        )
      }
      jadeStates.clear()
      for (const [k, since] of offSince)
        window(k, ['GoldenTroupe', 'set4'], 'on', since, t)
      offSince.clear()
    },
  }
}

/**
 * Hexerei characters (their sheets' `lockHomework` conditional: Witch's Homework done, which
 * gcsim takes by default, hexerei=1). The rotation writer turns it on for each of them: their
 * Witch's Homework bonuses apply alone, the Secret Rite effects only with two or more in the party
 * (the sheets' tally).
 */
export const HEXEREI_CHARACTERS: CharacterKey[] = [
  'Albedo',
  'Durin',
  'Fischl',
  'Klee',
  'Lohen',
  'Mona',
  'Nicole',
  'Prune',
  'Razor',
  'Sucrose',
  'Varka',
  'Venti',
]
