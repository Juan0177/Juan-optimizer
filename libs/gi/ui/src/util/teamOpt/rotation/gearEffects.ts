import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type { RotationAction } from './parse'
import type { SimBuffOwner, SimContext, SimGear, SimHit } from './types'

/*
 * Artifact set effects the simulation plays from what happens in the rotation (gcsim's
 * internal/artifacts), for the sets the members wear in the build being simulated. Each one turns
 * the set's own conditional on (on the wearer's sheet, as the user would) for the hits it covers.
 * Kits supply Bond of Life markers and Nightsoul windows. HP, healing and shield effects that
 * have no model remain user-controlled.
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

export interface GearEffects {
  /** Every hit and reaction marker that lands, in time order */
  onHit(ctx: SimContext, hit: SimHit): void
  /** A member acts */
  onAction(ctx: SimContext, actor: CharacterKey, action: RotationAction): void
  /** The member on the field changes */
  onSwap(
    t: number,
    from: CharacterKey,
    to: CharacterKey,
    ctx?: SimContext
  ): void
  /** The run ends at `t` (open windows close) */
  end(t: number): void
}

export function gearEffects({
  members,
  gear,
  inNightsoul,
  onField,
  cooldown,
  window,
  reduceCooldown,
}: {
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
    end: number
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
    if (other && ready(`hakushin.${k}.${other}`, hit.t, 60))
      ctx.buff(k, ['HakushinRing', 'SakuraSaiguu'], other, 0, 360)
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
  // Heretic's Molten Blade: declared off, on only after the wielder's Skill while on the field
  for (const k of members)
    if (holds(k, 'HereticsMoltenBlade'))
      window(k, ['HereticsMoltenBlade', 'passive'], GLEAM_STATE, 0, 0)
  /** Its Gleam of First Light now on, per wielder (the activation's frame) */
  const gleam = new Map<CharacterKey, number>()
  // The Widsith: declared off, on only after the wielder takes the field
  for (const k of members)
    if (holds(k, 'TheWidsith')) window(k, ['TheWidsith', 'Debut'], 'avg', 0, 0)
  for (const k of members)
    if (wears(k, 'DesertPavilionChronicle'))
      window(k, ['DesertPavilionChronicle', 'set4'], 'on', 0, 0)
  for (const k of members)
    if (opens(k, 'PaleFlame')) window(k, ['PaleFlame', 'stacks'], '1', 0, 0)
  // Instructor, Heart of the Furnace: declared off, on only from the wearer's own triggers (a
  // saved manual state must not make them active throughout)
  for (const k of members) {
    if (opens(k, 'Instructor')) window(k, ['Instructor', 'set4'], 'on', 0, 0)
    if (opens(k, 'HeartOfTheFurnace'))
      window(k, ['HeartOfTheFurnace', '4Stellar'], 'on', 0, 0)
  }
  const desert = new Map<CharacterKey, { end: number }>()

  let initialized = false

  // Dendro resonance (gcsim): EM +30 for 6 s after Burning, Bloom, Lunar-Bloom or Quicken, and
  // +20 for 6 s after Aggravate or Spread (a 4-member team with 2+ Dendro members)
  const dendroResonance =
    members.length === 4 &&
    members.filter((m) => getCharEle(m) === 'dendro').length >= 2

  // Crystallize shards (gcsim): spawn 23 frames after the reaction, can be picked up 31 frames
  // later, last 15 s. Archaic Petra 4 procs when its holder is on the field at a pickup (the
  // holder picks them up, as gcsim's pick_up_crystallize in the holder's turn): 35% DMG of the
  // shard's element for the party, 10 s.
  let active = onField
  const petra = members.filter((m) => opens(m, 'ArchaicPetra'))
  const shards: { element: string; pickable: number; expiry: number }[] = []
  const petraProc = (ctx: SimContext, holder: CharacterKey, element: string) =>
    ctx.buff(holder, ['ArchaicPetra', 'element'], element, 0, 600)
  const pickUp = (ctx: SimContext) => {
    if (!petra.includes(active)) return
    const t = ctx.now
    const i = shards.findIndex((x) => x.pickable <= t && t < x.expiry)
    if (i < 0) return
    const [shard] = shards.splice(i, 1)
    petraProc(ctx, active, shard.element)
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

  return {
    onHit(ctx, hit) {
      const k = hit.characterKey
      const t = hit.t
      // (a Normal Attack performed: a Starspark)
      if (hit.tag === 'normal' && !hit.path[0].startsWith('_') && sparks.has(k))
        gainSpark(k, t)
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
      if (petra.length && hit.path[0] === '_reaction') {
        if (hit.path[1] === 'crystallize' && hit.element !== 'geo') {
          const shard = {
            element: hit.element,
            pickable: t + 54,
            expiry: t + 23 + 900,
          }
          shards.push(shard)
          ctx.at(54, (c) => pickUp(c))
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
        if (t < bubble.end) {
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
            if (holds(k, weapon) && ready(`leaf.${k}.${weapon}`, hit.t, 1200))
              ctx.buff(k, [weapon, 'passive'], 'on', 0, 720)
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
        // Scroll of the Hero of Cinder City: +12% DMG of the elements of a reaction involving the
        // wearer's element, for 15 s, plus an independent 20 s Nightsoul bonus
        if (opens(k, 'ScrollOfTheHeroOfCinderCity')) {
          const own = getCharEle(k)
          const elements =
            reaction === 'crystallize'
              ? ['geo', hit.element]
              : (REACTION_ELEMENTS[reaction] ?? [])
          if (elements.includes(own)) {
            const nightsoul = inNightsoul(k, t)
            for (const e of new Set(elements)) {
              if (e === 'physical') continue
              ctx.buff(
                k,
                ['ScrollOfTheHeroOfCinderCity', `react_${e}`],
                e,
                0,
                900
              )
              // +28% more when the wearer is in Nightsoul's Blessing
              if (nightsoul)
                ctx.buff(
                  k,
                  ['ScrollOfTheHeroOfCinderCity', `nightsoul_${e}`],
                  e,
                  0,
                  1200
                )
            }
          }
        }
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
      if (
        hit.tag === 'charged' &&
        !hit.path[0].startsWith('_') &&
        wears(k, 'DesertPavilionChronicle')
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
        ctx.state(k, ['DesertPavilionChronicle', '_selfAttackSpeed'], '0.1')
        ctx.atCharacter(k, 900, (at) => {
          if (desert.get(k) !== entry) return
          at.state(k, ['DesertPavilionChronicle', '_selfAttackSpeed'], '')
        })
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
      if (hit.path[0].startsWith('_')) return
      if (
        ctx.moonsign >= 1 &&
        opens(k, 'SilkenMoonsSerenade') &&
        hit.element !== 'physical'
      )
        ctx.buff(k, ['SilkenMoonsSerenade', '4GleamingMoon'], 'on', 1, 480)
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
      // Deepwood Memories: Dendro RES -30% for 8 s after the wearer's Dendro hit
      if (opens(k, 'DeepwoodMemories') && hit.element === 'dendro')
        ctx.buff(k, ['DeepwoodMemories', 'set4'], 'on', 0, 480)
      // Tenacity of the Millelith: the party's ATK +20% for 3 s after a skill hit (0.5 s ICD)
      if (
        opens(k, 'TenacityOfTheMillelith') &&
        hit.tag === 'skill' &&
        ready(`totm.${k}`, t, 30)
      )
        ctx.buff(k, ['TenacityOfTheMillelith', 'skill'], 'cast', 0, 180)
    },
    onAction(ctx, actor, action) {
      if (actor === active) pickUp(ctx)
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
      if (
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
      // Crimson Witch of Flames: a stack per skill, 10 s, up to 3
      if (action.kind === 'skill' && opens(actor, 'CrimsonWitchOfFlames'))
        ctx.buff(actor, ['CrimsonWitchOfFlames', 'stack'], '1', 0, 600, 3)
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
      // (Starsparks lost on the field up to the swap, and none off it for the incoming member:
      // both settled before it takes the field)
      settleSparks(from, t)
      settleSparks(to, t)
      active = to
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
      if (ctx && holds(to, 'TheWidsith') && ready(`widsith.${to}`, t, 1800))
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
    end(t) {
      for (const [k, s] of sparks) {
        settleSparks(k, t)
        if (s.n) window(k, s.path, 'on', s.since, t)
      }
      sparks.clear()
      for (const s of stacks.values())
        window(s.owner, s.path, `${s.count}`, s.start, Math.min(t, s.end))
      stacks.clear()
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
 * Hexerei characters (their sheets' `lockHomework` conditional). With two or more in the party,
 * the Hexerei Secret Rite effects apply; gcsim turns them on by default, so the rotation writer
 * does too when the team has two.
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
