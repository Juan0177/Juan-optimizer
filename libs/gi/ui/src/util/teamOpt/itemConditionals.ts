import {
  type ArtifactSetKey,
  allArtifactSetKeys,
  allWeaponKeys,
  type WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { getArtSheet, getWeaponSheet } from '@genshin-optimizer/gi/sheets'

/**
 * What a character does, to decide which weapon and set effects it triggers itself (used where
 * nobody chose a state: weapons and sets a build may get but the user never set up)
 */
export type ItemConditionalCtx = {
  /** Attack types it uses */
  attacks: Array<'normal' | 'charged' | 'plunging' | 'skill' | 'burst'>
  /** Elements / Stellar reactions on the enemy */
  auras: string[]
  /** Teammates of another element than its own (default 3) */
  otherElements?: number
  /** Its own element (unknown: effects that need its own reactions are counted) */
  element?: string
  /**
   * Whether it deals Stellar Glimmer DMG itself (unknown: any Stellar reaction in the team counts):
   * the effects of "when the equipping character triggers a Stellar Glimmer reaction or deals
   * Stellar Glimmer reaction DMG"
   */
  ownStellar?: boolean
  /** It has no Energy (its Burst costs none: Skirk, Mavuika): Finale of the Deep Galleries */
  zeroEnergy?: boolean
}

/** A display path of Stellar Glimmer DMG ("…StellarDmg", "crownSc", "beamSsDmg") */
export const isStellarAttackPath = (path: readonly string[]) => {
  const last = path[path.length - 1] ?? ''
  return /stellar/i.test(last) || /(?:Sc|Ss)(?:Dmg)?$/.test(last)
}

/**
 * Whether it can trigger a Dendro reaction itself (Burning, Quicken, Aggravate, Spread, Bloom,
 * Hyperbloom, Burgeon): Dendro with a Hydro, Electro or Pyro teammate, or one of those with a
 * Dendro teammate (`auras`: the team's elements)
 */
function dendroReactor(ctx: ItemConditionalCtx) {
  const partners = ['hydro', 'electro', 'pyro']
  if (!ctx.element) return true
  return ctx.element === 'dendro'
    ? partners.some((e) => ctx.auras.includes(e))
    : partners.includes(ctx.element) && ctx.auras.includes('dendro')
}

type Doc = {
  path?: string[]
  name?: unknown
  states?: Record<string, unknown>
}

/** i18n key of a conditional's label, e.g. "charOffField" or "hitOp.skill" */
function nameKey(name: unknown): string {
  const n = name as { props?: { key18?: string; i18nKey?: string } }
  return (
    n?.props?.key18 ??
    n?.props?.i18nKey ??
    (typeof name === 'string' ? name : '')
  )
}

/**
 * Effects that need something the character can't be counted on to do itself are left off: being
 * off-field, shields, healing, taking damage, HP changes, Bond of Life, defeating enemies, low-HP
 * enemies, party-wide energy or elements, reactions with teammates, nightsoul/Moondrift/Lunar/
 * Bloom/Burning/Stellar Swirl mechanics.
 */
const OFF =
  /offField|OffField|[sS]hield|takeDmg|afterHeal|hpChange|bond\.|afterDefeatEnemy|enemyLessPercentHP|^party$|team\.|moondrift|[lL]unar|[bB]loom|burgeon|nightsoul|swirlReaction|weakSpot|plunging|afterReaction|stellarswirl/

/**
 * Per-item choices the name alone can't decide: a state to use, `null` for off, or `undefined` to
 * fall through to the general rules.
 */
const OVERRIDES: Partial<
  Record<
    string,
    (ctx: ItemConditionalCtx, cond: string) => string | null | undefined
  >
> = {
  // The generic optimizer target is not a Slime. A roster cannot establish enemy species.
  BlackTassel: () => null,
  // needs a Geo teammate's Crystallize shard
  ArchaicPetra: () => null,
  // needs a healer
  SongOfDaysPast: () => null,
  // needs Burning enemies nearby
  UnfinishedReverie: () => null,
  // a Leaf only from the wielder's own Dendro reactions (gcsim)
  SapwoodBlade: (ctx) => (dendroReactor(ctx) ? undefined : null),
  ForestRegalia: (ctx) => (dendroReactor(ctx) ? undefined : null),
  Moonpiercer: (ctx) => (dendroReactor(ctx) ? undefined : null),
  // the 4-piece procs at random: use its average
  EchoesOfAnOffering: () => 'avg',
  BlizzardStrayer: (ctx) =>
    ctx.auras.includes('hydro') && ctx.auras.includes('cryo')
      ? 'frozen'
      : ctx.auras.includes('cryo')
        ? 'cryo'
        : null,
  // Gilded Dreams' team counts follow the team; its 4-piece after the wearer's own reactions
  // (off the field too): any team with another element to react with
  GildedDreams: (ctx, cond) =>
    cond.startsWith('override')
      ? null
      : (ctx.otherElements ?? 3) > 0
        ? 'on'
        : null,
  // its CRIT Rate on enemies under Superconduct or Stellar-Conduct: both need Cryo and Electro
  DisenchantmentInDeepShadow: (ctx) =>
    ctx.auras.includes('cryo') && ctx.auras.includes('electro') ? 'on' : null,
  // only at 0 Energy (characters without Energy); its Normal Attack and Burst halves lock each
  // other out for 6 s: a Normal Attack user gets the Normal Attack half
  FinaleOfTheDeepGalleries: (ctx, cond) =>
    !ctx.zeroEnergy
      ? null
      : cond === '0EnergyNoBurst'
        ? ctx.attacks.includes('normal')
          ? 'on'
          : null
        : ctx.attacks.includes('normal')
          ? null
          : 'on',
  // after the wearer's Skill (with Energy to spend)
  ShimenawasReminiscence: (ctx) =>
    ctx.attacks.includes('skill') ? 'used' : null,
  // after the wearer's own Normal, Charged, Skill or Burst hits
  ADayCarvedFromRisingWinds: (ctx) =>
    ['normal', 'charged', 'skill', 'burst'].some((a) =>
      ctx.attacks.includes(a as ItemConditionalCtx['attacks'][number])
    )
      ? undefined
      : null,
  // a stack per Skill, all lasting 10 s from the last: about one held
  CrimsonWitchOfFlames: (ctx) => (ctx.attacks.includes('skill') ? '1' : null),
  // a status per kind of the wearer's on-field hits (Normal, Charged, Plunging, Skill, Burst),
  // up to 3
  NymphsDream: (ctx) => {
    const kinds = ['normal', 'charged', 'plunging', 'skill', 'burst'].filter(
      (a) => ctx.attacks.includes(a as ItemConditionalCtx['attacks'][number])
    ).length
    return kinds ? String(Math.min(3, kinds)) : null
  },
  // stacks from the wearer's Plunging, Charged and Skill hits: a plunging attacker's
  LongNightsOath: (ctx) =>
    ctx.attacks.includes('plunging') ? undefined : null,
  // after the wearer's elemental hits
  SilkenMoonsSerenade: (ctx) => (ctx.attacks.length ? undefined : null),
  // while the wearer is off the field: a member that makes no Normal or Charged Attacks
  AubadeOfMorningstarAndMoon: (ctx) =>
    ctx.attacks.includes('normal') || ctx.attacks.includes('charged')
      ? null
      : 'on',
  // its stacks come from the wearer's Geo hits on the field (and its DEF when off it)
  HuskOfOpulentDreams: (ctx) =>
    ctx.element === undefined || ctx.element === 'geo' ? undefined : null,
  // low HP, the enemy's HP, Elemental DMG taken: not modelled
  Berserker: () => null,
  BraveHeart: () => null,
  TinyMiracle: () => null,
  // the 4 stacks need HP loss; the after-burst ATK stays
  VermillionHereafter: (_ctx, cond) => (cond === 'stacks' ? null : undefined),
  // Seals come from teammates' Crystallize shards
  Verdict: () => null,
  // both pieces need Nightsoul's Blessing / Nightsoul points
  ObsidianCodex: () => null,
  // counts teammates of other elements
  ChainBreaker: (ctx) => String(Math.min(3, ctx.otherElements ?? 3)),
  // needs a Hydro/Dendro Elemental Skill and Lunar-Bloom
  NightweaversLookingGlass: () => null,
  // one stack each from Normal, Charged, Skill and Burst hits
  PolarStar: (ctx) => (ctx.attacks.includes('charged') ? '4' : '3'),
  // its effects rotate every 10 s: none is on all the time
  ForgedByTheGoldenMelody: () => null,
  // one of its three songs at random on taking the field: their average
  TheWidsith: () => 'avg',
  // after the wielder's Elemental Skill (its on-field time is the rotation's to say)
  HereticsMoltenBlade: (ctx) =>
    ctx.attacks.includes('skill') ? undefined : null,
  // Royal stacks reset on every CRIT hit: about one stack on average
  RoyalBow: () => '1',
  RoyalGreatsword: () => '1',
  RoyalGrimoire: () => '1',
  RoyalLongsword: () => '1',
  RoyalSpear: () => '1',
}

function choose(
  itemKey: string,
  doc: Doc,
  ctx: ItemConditionalCtx
): [string[], string] | undefined {
  if (!doc.path || !doc.states) return undefined
  const states = Object.keys(doc.states)
  const cond = nameKey(doc.name)
  const condKey = doc.path[doc.path.length - 1]
  const override = OVERRIDES[itemKey]?.(ctx, condKey)
  if (override === null) return undefined
  if (typeof override === 'string')
    return states.includes(override) ? [doc.path, override] : undefined
  if (OFF.test(cond)) return undefined
  const has = (a: ItemConditionalCtx['attacks'][number]) =>
    ctx.attacks.includes(a)
  let on = true
  if (/hitOp\.normalChargedSkillBurst/.test(cond)) on = true
  else if (/hitOp\.normalOrCharged/.test(cond))
    on = has('normal') || has('charged')
  else if (/hitOp\.charged/.test(cond)) on = has('charged')
  else if (/hitOp\.normal/.test(cond)) on = has('normal')
  else if (/hitOp\.skillOrBurst|afterUse\.skillOrBurst/.test(cond))
    on = has('skill') || has('burst')
  else if (/hitOp\.skill|afterUse\.skill/.test(cond)) on = has('skill')
  else if (/afterUse\.burst/.test(cond)) on = has('burst')
  else if (/hitOp\.cryo/.test(cond)) on = ctx.auras.includes('cryo')
  else if (/enemyAffected\./.test(cond)) {
    const want = cond
      .split('.')[1]
      .split(/Or/)
      .map((s) => s.toLowerCase())
    on = want.some((w) => ctx.auras.includes(w))
  } else if (
    /elementalReaction\.stellar\.triggerOrHit|stellarglimmer/.test(cond)
  )
    // (the wearer's own Stellar Glimmer hits or reactions, not a teammate's)
    on = ctx.ownStellar ?? ctx.auras.some((a) => a.startsWith('stellar'))
  if (!on) return undefined
  // highest stack / last state
  return [doc.path, states[states.length - 1]]
}

function setPath(obj: Record<string, any>, path: string[], value: string) {
  let o = obj
  for (const p of path.slice(0, -1)) o = o[p] ??= {}
  o[path[path.length - 1]] = value
}

/**
 * Conditional values for every set and weapon, chosen by rule for a character that does `ctx`.
 * `picked` lists them as `path=value`.
 */
export function itemConditionals(
  ctx: ItemConditionalCtx,
  {
    sets = allArtifactSetKeys,
    weapons = allWeaponKeys,
  }: {
    sets?: readonly ArtifactSetKey[]
    weapons?: readonly WeaponKey[]
  } = {}
) {
  const conditional: Record<string, any> = {}
  const picked: { path: string[]; value: string }[] = []
  const add = (itemKey: string, docs: Doc[] | undefined) => {
    for (const d of docs ?? []) {
      const c = choose(itemKey, d, ctx)
      if (!c) continue
      setPath(conditional, c[0], c[1])
      picked.push({ path: c[0], value: c[1] })
    }
  }
  for (const k of sets) {
    const s = getArtSheet(k) as any
    add(k, s?.setEffectDocument?.(2))
    add(k, s?.setEffectDocument?.(4))
  }
  for (const w of weapons) {
    const s = getWeaponSheet(w) as any
    add(w, s?.document)
  }
  return { conditional, picked }
}
