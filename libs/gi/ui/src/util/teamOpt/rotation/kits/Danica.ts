import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ActionResult, KitModel, SimContext, SimHit } from '../types'
import {
  KQMSIM,
  type NormalHit,
  normalString,
  particleMarker,
  shieldMarker,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/danica.
 * The pinned source has no Anchor Normal Attacks, On-Field Skill E2 / Battle Maid or C2 Toast;
 * those follow the game text (and the Excitement tooltip), with the frames marked ESTIMATE. */
/**
 * Her N3 is "×2" in the game data; kqmsim queues one instance. The second instance is added on
 * the same hitmark (ESTIMATE: no timing data), without extra hitlag, so the verified cancels hold.
 */
const normals: NormalHit[] = [
  {
    hitmarks: [27],
    hitlag: [10],
    toNormal: 38,
    toCharged: 41,
    toAbil: 27,
    frames: 54,
  },
  {
    hitmarks: [24],
    hitlag: [10],
    toNormal: 46,
    toCharged: 48,
    toAbil: 24,
    frames: 66,
  },
  {
    hitmarks: [19, 19],
    hitlag: [9, 0],
    // both instances land together (the second is not pushed back by the first's hitlag)
    worldTimeHits: true,
    toNormal: 31,
    toCharged: 40,
    toAbil: 19,
    frames: 72,
  },
  {
    hitmarks: [41],
    hitlag: [13],
    toNormal: 106,
    toCharged: 109,
    toAbil: 41,
    frames: 112,
  },
]
/**
 * The Anchor's Normal Attacks, from a game recording: hit to next hit N1→N2 34, N2→N3 46 (an upper
 * bound), N3→N4 25 frames, N3's second hit 5 after its first (hitlag included, so none is added);
 * N1 lands 21 frames into its swing (E → first Anchor N1 hit 65 with E's 44 into a Normal Attack).
 * ESTIMATE: N2–N4 land as late into theirs; N4's recovery and its cancel into the next round keep
 * her normal string's.
 */
const anchorNormals: NormalHit[] = [
  { hitmarks: [21], toNormal: 34, toCharged: 34, toAbil: 21, frames: 48 },
  { hitmarks: [21], toNormal: 46, toCharged: 46, toAbil: 21, frames: 63 },
  {
    hitmarks: [21, 26],
    worldTimeHits: true,
    toNormal: 25,
    toCharged: 25,
    toAbil: 21,
    frames: 74,
  },
  { hitmarks: [21], toNormal: 86, toCharged: 86, toAbil: 21, frames: 92 },
]
/**
 * Will to Purge (On-Field Skill E2), from a game recording: the hit at 33, the Burst usable at 59,
 * a Normal Attack at 78 (Purge → N4 hit 99 at 3 A4 stacks, its hit 21 into the swing)
 */
const ON_FIELD_HITMARK = 33
const ON_FIELD_FRAMES = 59
const ON_FIELD_INTO_NORMAL = 78
const ANCHOR_DURATION = 1500
/** Her E's Anchor lands this long after the press (game recording) */
const ANCHOR_HITMARK = 50
/** Entry Skill E2 (Will to Protect) cooldown: 16 s */
const ENTRY_CD = 960
/** Noted when her E is cast with a Storm Anchor out: it keeps its time (beta 7.2.53) */
const E_KEEPS_ANCHOR_TIME =
  "Danica: her E with the Storm Anchor still out didn't refresh it, as the 7.2.53 beta text says: the Anchor runs out 25 s after it was summoned or refreshed by Will to Protect, so a swap-in after that gets no Will to Protect."
/** C2 Toast: 10 stacks per member; Danica consumes up to 2 of hers in Battle Maid */
const TOAST_STACKS = 10
const TOAST_SELF_MAX = 2
/** Noted when her E ends Royal Guard: the in-game behaviour players don't expect */
const E_ENDS_ROYAL_GUARD =
  "Danica: her E ended Maid: Royal Guard and with it her Burst's party ATK bonus, as in the game (her E ends either Maid form and the Burst's form effects, and doesn't refresh a Storm Anchor already out). To keep the bonus, skip her E on later turns: with Will to Cleanse full, a swap-in enters Royal Guard again (Will to Protect) and refreshes the Anchor, so \"Danica Q\" is enough."

type Maid = '' | 'defense' | 'battle'
interface State {
  anchorEnd: number
  anchorId: number
  excite: number
  exciteReady: number
  coordReady: number
  entryReady: number
  maid: Maid
  /** On-Field Skill E2 uses in the current Battle Maid (5 end it) */
  battleUses: number
  /** A4 Battle Maid stacks (max 3) */
  a4: number
  /** Battle Maid combo: the next stage within the current round */
  comboNext: number
  /** Burst enhancement of the current Maid Form (lit by `syncMaid`) */
  enhanced: boolean
  /** End of the Burst's FormalDress_State (20 s from the cast; -1: none) */
  burstEnd: number
  /** End of the open Royal Aegis shield marker (-1: none) */
  aegisEnd: number
  /** C2 Toast stacks per member */
  toast: Partial<Record<CharacterKey, number>>
  /** The enemy can drop her particles again from this frame (16 s after the last drop) */
  ballReady: number
  /** Why her last swap-in with the Anchor out gave no Will to Protect (none: it did) */
  lastBlock?: string
  /** The Anchor whose running out a note already explained */
  expiryNoted: number
  /** When the Anchor her E threw lands: her Normal Attacks are the Anchor's from the press */
  anchorLands: number
  /** C2: her next swap-in plays Will to Protect (once per fight) */
  c2Entry: boolean
}
const hit = (
  c: SimContext,
  delay: number,
  path: string[],
  label: string,
  applies = false,
  tag: SimHit['tag'] = 'directStellarConduct'
) =>
  c.hit(delay, {
    path,
    label,
    tag,
    element: tag === 'normal' ? 'physical' : 'electro',
    applies,
    icd: 'none',
  })
const set = (c: SimContext, name: string, value: string) =>
  c.state('Danica', ['Danica', name], value)
const radiance = (c: SimContext) =>
  set(c, 'a0StellarRadianceSc', c.radiance === 'conduct' ? 'on' : '')
/**
 * The form's conditionals. The Burst's enhancement is live (dump UNIQUE_Danica_FormalDress_State,
 * 20 s from the cast in any form): while Danica is in a form and in Radiance (its StarMode_State,
 * checked every 0.1 s), the form's Guard_State or Combat_State is on, and Combat_State's onAdded
 * fills Will to Cleanse.
 */
function syncMaid(c: SimContext, s: State) {
  const lit = !!s.maid && c.now < s.burstEnd && c.radiance === 'conduct'
  if (lit && !s.enhanced && s.maid === 'battle') s.excite = 100
  s.enhanced = lit
  set(c, 'maidForm', s.maid)
  set(c, 'burstEnhanced', lit ? 'on' : '')
  set(c, 'a4Stacks', s.maid === 'battle' && s.a4 ? String(s.a4) : '')
}
/** The Royal Aegis (UNIQUE_Danica_GuardMaid_Shield_Main, a party shield) until the Anchor ends */
function aegisOn(c: SimContext, s: State, label: string) {
  const frames = Math.max(0, s.anchorEnd - c.now)
  shieldMarker(c, 0, frames, label)
  s.aegisEnd = c.now + frames
}
/** The Royal Aegis removed early: a 0-frame shield of the same kind ends the open one */
function aegisOff(c: SimContext, s: State) {
  if (c.now < s.aegisEnd) shieldMarker(c, 0, 0, 'Royal Aegis ends')
  s.aegisEnd = -1
}
function endMaid(c: SimContext, s: State) {
  if (s.maid === 'battle') c.modifyAttackSpeed('DanicaA4', 0, 1, 'Danica')
  // (the shield goes with the form: the Anchor handler's removal, or C4's attached one)
  if (s.maid) aegisOff(c, s)
  // (a form's onRemoved also removes the Burst's FormalDress_State)
  if (s.maid) s.burstEnd = -1
  s.maid = ''
  s.enhanced = false
  s.a4 = 0
  s.battleUses = 0
  syncMaid(c, s)
}
function anchor(c: SimContext, s: State, duration: number) {
  const id = ++s.anchorId
  s.anchorEnd = c.now + duration
  set(c, 'anchor', 'on')
  // C2: (re)summoning or refreshing the Anchor resets everyone's Toast to 10 stacks.
  if (c.constellation('Danica') >= 2)
    s.toast = Object.fromEntries(c.members.map((m) => [m, TOAST_STACKS]))
  const tick = (c: SimContext) => {
    if (id !== s.anchorId) return
    radiance(c)
    syncMaid(c, s)
    if (c.now >= s.anchorEnd) {
      set(c, 'anchor', '')
      s.toast = {}
      endMaid(c, s)
      return
    }
    c.at(Math.min(30, s.anchorEnd - c.now), tick)
  }
  tick(c)
}
const addExcite = (s: State, amount: number) => {
  s.excite = Math.min(100, s.excite + amount)
}
/**
 * Her particles (dump Avatar_Danica_ElementalArt_DropBall_Handler): a hit with the
 * Danica_ElementalArt_DropBall tag, the Anchor Skill's (InsertClaymore) or the Entry Skill's
 * (E2_Enter_Attack), gives the enemy the Unique Avatar_Danica_ElementalArt_DropBall, whose
 * onAdded drops 15 Energy of Electro particles (5, the ER sheet's "Press"): once per 16 s from
 * either Skill (14 s before beta 7.2.53)
 */
function dropBall(c: SimContext, s: State, delay: number, skill: string) {
  c.at(delay, (c2) => {
    if (c2.now < s.ballReady) {
      c2.note(
        `Danica: her ${skill} dropped no particles: either Skill's particles drop once per 16 s, as in the game, and the last drop was ${((c2.now - s.ballReady + 960) / 60).toFixed(1)} s before.`
      )
      return
    }
    s.ballReady = c2.now + 960
    particleMarker(c2, 0, 'Danica particles', undefined, 'Danica')
  })
}

/** On-Field Skill E2: consumes all Excitement, enters (or continues) Battle Maid. */
function onFieldE2(c: SimContext, s: State): ActionResult {
  s.excite = 0
  if (s.maid !== 'battle') {
    s.maid = 'battle'
    s.a4 = 0
    s.battleUses = 0
    s.comboNext = 0
    // C4: entering Cleaner also creates a Royal Aegis (UNIQUE_Danica_CombatMaid_Form's onAdded),
    // until she leaves the form or the field
    if (c.constellation('Danica') >= 4) aegisOn(c, s, 'Royal Aegis (C4)')
  }
  s.battleUses++
  // A4: +20% ATK SPD per On-Field Skill E2 (max 3) until Battle Maid ends.
  s.a4 = Math.min(3, s.a4 + 1)
  c.modifyAttackSpeed(
    'DanicaA4',
    0.2 * s.a4,
    Math.max(1, s.anchorEnd - c.now),
    'Danica'
  )
  // (entering Cleaner inside a lit Burst window fills Will to Cleanse again: Combat_State)
  syncMaid(c, s)
  c.at(ON_FIELD_HITMARK, (c2) => {
    radiance(c2)
    // the DMG increase is read at the hit (E2_Field_Attack checks FormalDress_StarMode_State)
    syncMaid(c2, s)
    hit(c2, 0, ['skill', 'onFieldDmg'], 'On-Field Skill E2 (Stellar-Conduct)')
  })
  // After 5 uses Danica leaves Battle Maid and the Anchor is destroyed.
  if (s.battleUses >= 5)
    c.at(ON_FIELD_HITMARK, (c2) => {
      s.anchorEnd = c2.now
      ++s.anchorId
      // (destroyed by her 5th Purge, not run out: nothing for a swap-in to explain)
      s.expiryNoted = s.anchorId
      set(c2, 'anchor', '')
      s.toast = {}
      endMaid(c2, s)
    })
  return {
    frames: ON_FIELD_FRAMES,
    framesInto: { normal: ON_FIELD_INTO_NORMAL },
  }
}
/** Entry Skill E2 (Will to Protect) at a swap-in */
function willToProtect(ctx: SimContext, s: State): ActionResult {
  s.excite = 0
  s.entryReady = ctx.now + ENTRY_CD
  // Entry Skill E2: Defense Maid and a refreshed Anchor; a Burst window still open lights it
  // (Guard_State)
  anchor(ctx, s, ANCHOR_DURATION)
  s.maid = 'defense'
  s.a4 = 0
  syncMaid(ctx, s)
  // Defense Maid's party shield (kqmsim newShield), until the form ends: 25 s from the Entry
  // Skill's refreshed Anchor at most
  aegisOn(ctx, s, 'Defense Maid shield')
  hit(ctx, 42, ['skill', 'entryDmg'], 'Entry Skill (Stellar-Conduct)')
  dropBall(ctx, s, 42, 'Entry Skill')
  // (the Burst pressed 63 frames after the swap-in: footage and Lunaris runs)
  return { frames: 63 }
}
/** Her Normal Attacks are the Anchor's while it is out, or thrown by her E and still landing */
const anchorNormal = (s: State, now: number) =>
  now < s.anchorEnd || now < s.anchorLands
const onFieldReady = (s: State, now: number) =>
  now < s.anchorEnd && s.excite >= 100 && s.maid !== 'defense'
/** The anchor string with Battle Maid skips: each new round starts at stage min(uses, 3). */
function anchorString(c: SimContext, s: State, count: number, from?: number) {
  const engineFirst = c.normalSequence(4, count)
  const skip = s.maid === 'battle' ? Math.min(3, s.battleUses) : 0
  // ("N3-4": written to carry on from its 3rd hit)
  let stage = from
    ? (from - 1) % 4
    : s.maid === 'battle'
      ? engineFirst === 0 || s.comboNext === 0
        ? skip
        : s.comboNext
      : engineFirst
  const stages: number[] = []
  for (let i = 0; i < count; i++) {
    stages.push(stage)
    stage = (stage + 1) % 4
    if (stage === 0 && s.maid === 'battle') stage = skip
  }
  s.comboNext = stage === skip ? 0 : stage
  const ordered = new Proxy(c, {
    get: (target, prop) =>
      prop === 'normalSequence' ? () => 0 : Reflect.get(target, prop),
  })
  return normalString(
    stages.map((i) => anchorNormals[i]),
    count,
    (step, t, j) => {
      const i = stages[step]
      c.hit(t, {
        path: ['skill', `anchor${i}`],
        tag: 'normal',
        element: 'electro',
        applies: true,
        icd: 'normal',
        label: `Anchor N${i + 1}`,
      })
      // Excitement: 25 per anchor attack (once per attack), +25 per A4 stack in Battle Maid;
      // in Defense Maid only the active-member Electro/Cryo rule applies.
      if (j === 0)
        c.at(t, (c2) => {
          if (s.maid === 'defense' || c2.now >= s.anchorEnd) return
          addExcite(s, 25 * (1 + (s.maid === 'battle' ? s.a4 : 0)))
        })
    },
    ordered
  )
}

export const kit: KitModel = {
  characterKey: 'Danica',
  element: 'electro',
  source: `${KQMSIM}/danica`,
  init: (): State => ({
    anchorEnd: -1,
    anchorId: 0,
    excite: 0,
    exciteReady: -1,
    coordReady: -1,
    entryReady: -1,
    maid: '',
    battleUses: 0,
    a4: 0,
    comboNext: 0,
    enhanced: false,
    burstEnd: -1,
    aegisEnd: -1,
    toast: {},
    ballReady: -1,
    expiryNoted: 0,
    anchorLands: -1,
    c2Entry: false,
  }),
  onStart(c, s: State) {
    for (const name of ['c2Toast', 'c2SelfToast']) set(c, name, '')
    // Dump Avatar_Danica_Constellation_2: entering combat removes Will to Protect's cooldown and
    // adds UNIQUE_Danica_C2_EntryReady, whose switch-in listener plays Will to Protect whatever her
    // Anchor, Will to Cleanse or form; its Cleansing Edict window removes it
    s.c2Entry = c.constellation('Danica') >= 2
    if (s.c2Entry)
      c.note(
        'Danica C2: her first swap-in of the fight plays Will to Protect (Maid: Royal Guard and a Storm Anchor) without a full Will to Cleanse or an Anchor out. The Cleansing Edict after it (hold Normal Attack within 6 s for a Will to Purge at 150% DMG) is not modelled; Raise a Chorus stacks are.'
      )
  },
  // With the Anchor out her normal attacks are the Anchor's (estimated frames of their own), and
  // at full Excitement her E is On-Field Skill E2 (Battle Maid; estimated frames of its own)
  variant(ctx, s: State, action) {
    if (action.kind === 'skill')
      return onFieldReady(s, ctx.now)
        ? { key: 'battleMaid', label: 'On-Field Skill E2', mode: 'Battle Maid' }
        : undefined
    if (action.kind === 'normal' && anchorNormal(s, ctx.now))
      return { key: 'anchor', label: 'Anchor Normal Attack', mode: 'Anchor' }
    return undefined
  },
  act(ctx, s: State, action, previous) {
    radiance(ctx)
    switch (action.kind) {
      case 'skill':
        if (onFieldReady(s, ctx.now)) return onFieldE2(ctx, s)
        // (the Anchor lands 50 frames after the press, from a game recording; kqmsim has 22)
        hit(
          ctx,
          ANCHOR_HITMARK,
          ['skill', 'dmg'],
          'Anchor Skill',
          true,
          'skill'
        )
        dropBall(ctx, s, ANCHOR_HITMARK, 'Anchor Skill')
        s.anchorLands = ctx.now + ANCHOR_HITMARK
        // Dump Avatar_Danica_ElementalArt_InsertClaymore: Will to Cleanse to 0, Will to Protect's
        // cooldown (UNIQUE_Danica_E2_GuardMaid_CD) removed, and the Anchor handler removed and
        // re-added; its removal ends either form (and with it the Burst window) and the Royal Aegis
        // (kqmsim keeps the forms). Since beta 7.2.53 a Storm Anchor already out keeps its time
        // (the skill text: casting it again doesn't refresh its duration)
        ctx.at(ANCHOR_HITMARK, (c) => {
          if (s.maid === 'defense') c.note(E_ENDS_ROYAL_GUARD)
          endMaid(c, s)
          s.excite = 0
          s.entryReady = -1
          if (c.now < s.anchorEnd) {
            set(c, 'anchor', 'on')
            c.note(E_KEEPS_ANCHOR_TIME)
          } else anchor(c, s, ANCHOR_DURATION)
        })
        return withHitlag(
          {
            frames: 44,
            // (the Burst usable at 33, from a game recording)
            framesInto: { burst: 33, dash: 34, jump: 34 },
            cooldown: { key: 'skill', frames: 1080, delay: 20 },
          },
          { hitmarks: [ANCHOR_HITMARK], hitlag: [6] }
        )
      case 'burst':
        // (the first hit 102 frames after the press, then +10/18/32/67: game recording and Lunaris
        // runs' logs)
        ;[102, 112, 120, 134, 169].forEach((delay, i) =>
          ctx.at(delay, (c) => {
            radiance(c)
            hit(
              c,
              0,
              [
                'burst',
                i === 0 ? 'hit1Dmg' : i === 4 ? 'hit5Dmg' : 'hit234Dmg',
              ],
              'Burst',
              [0, 2, 4].includes(i),
              'burst'
            )
            if ((i === 0 || i === 4) && c.radiance === 'conduct')
              hit(
                c,
                1,
                ['burst', i === 0 ? 'hit1ScDmg' : 'hit5ScDmg'],
                'Burst (Stellar-Conduct)'
              )
          })
        )
        // FormalDress_State: added at the cast for 20 s, whatever the form (dump
        // Avatar_Danica_ElementalBurst_Initialize); `syncMaid` lights the form's part in Radiance
        s.burstEnd = ctx.now + 1200
        syncMaid(ctx, s)
        ctx.at(1200, (c) => syncMaid(c, s))
        // (the 18 s cooldown starts 0.4 s into the cast: 18.4 s from press to press, tested in game)
        // (the cutscene ends 99 frames after the press)
        return {
          frames: 99,
          cooldown: { key: 'burst', frames: 1080, delay: 24 },
        }
      case 'normal':
        if (anchorNormal(s, ctx.now))
          return anchorString(ctx, s, action.count ?? 1, action.from)
        return normalString(
          normals,
          action.count ?? 1,
          (i, t) =>
            hit(ctx, t, ['normal', `${i}`], `N${i + 1}`, true, 'normal'),
          ctx
        )
      case 'dash':
        return { frames: 22, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('lady', 'claymore', previous, ctx)
      default:
        return {
          frames: 0,
          failed: `Danica: ${action.text} is not implemented in kqmsim.`,
        }
    }
  },
  cooldownKey: (s: State, action, now) =>
    action.kind === 'skill'
      ? onFieldReady(s, now)
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  onHit(ctx, s: State, h) {
    if (h.path[0].startsWith('_')) return
    // C2 Toast: each Stellar-Conduct DMG instance a member deals consumes one of their stacks
    // (+80% of Danica's ATK). In Battle Maid Danica's own Stellar-Conduct DMG consumes up to 2 of
    // hers (+350% ATK each).
    if (
      ctx.constellation('Danica') >= 2 &&
      h.tag === 'directStellarConduct' &&
      ctx.now < s.anchorEnd
    ) {
      const stacks = s.toast[h.characterKey] ?? 0
      const self = h.characterKey === 'Danica' && s.maid === 'battle'
      const used = Math.min(self ? TOAST_SELF_MAX : 1, stacks)
      h.states = [
        ...(h.states ?? []),
        {
          owner: 'Danica',
          path: ['Danica', 'c2Toast'],
          value: used && !self ? 'on' : '',
        },
        {
          owner: 'Danica',
          path: ['Danica', 'c2SelfToast'],
          value: used && self ? String(used) : '',
        },
      ]
      if (used) s.toast[h.characterKey] = stacks - used
    }
    if (
      ctx.now >= s.anchorEnd ||
      h.onField === 'Danica' ||
      h.characterKey !== h.onField ||
      !['cryo', 'electro'].includes(h.element)
    )
      return
    // Off-field Excitement (not in Battle Maid, where only anchor attacks count)
    if (ctx.now >= s.exciteReady && s.maid !== 'battle') {
      addExcite(s, 50)
      s.exciteReady = ctx.now + 6
    }
    if (ctx.now >= s.coordReady) {
      s.coordReady = ctx.now + 90
      hit(
        ctx,
        5,
        ['skill', 'coordDmg'],
        'Anchor Coordinated Attack',
        true,
        'skill'
      )
    }
  },
  // C4's Cleaner Royal Aegis ends when she leaves the field (CombatMaid_Form's switch-out)
  onSwapOut(ctx, s: State) {
    if (s.maid === 'battle') aegisOff(ctx, s)
  },
  noEntryReason: (s: State, now) =>
    now >= s.anchorEnd
      ? 'her Anchor was not out (her E summons it for 25 s)'
      : s.maid === 'battle'
        ? 'she was still in Maid: Cleaner'
        : s.excite < 100
          ? "Will to Cleanse was not full (the on-field member's Electro or Cryo hits fill it while her Anchor is out, 50 each)"
          : now < s.entryReady
            ? `Will to Protect was on its 16 s cooldown (${((s.entryReady - now) / 60).toFixed(1)} s left)`
            : undefined,
  onSwapIn(ctx, s: State) {
    if (s.c2Entry) {
      s.c2Entry = false
      s.lastBlock = undefined
      // (E2_Initialize removes UNIQUE_Danica_CombatMaid_Form before adding Royal Guard)
      if (s.maid === 'battle') endMaid(ctx, s)
      return willToProtect(ctx, s)
    }
    if (ctx.now >= s.anchorEnd) {
      // an Anchor she had ran out: say why her swap-ins didn't refresh it (once per Anchor)
      if (s.anchorId && s.expiryNoted !== s.anchorId) {
        s.expiryNoted = s.anchorId
        ctx.note(
          `Danica: her Storm Anchor ran out before a swap-in, so Will to Protect couldn't refresh it${
            s.lastBlock
              ? ` (at her swap-in before, ${s.lastBlock})`
              : ' (she wasn’t swapped in while it was out)'
          }. Her E summons it again.`
        )
      }
      return
    }
    const block =
      s.maid === 'battle'
        ? 'she was in Maid: Cleaner'
        : s.excite < 100
          ? 'Will to Cleanse wasn’t full'
          : ctx.now < s.entryReady
            ? 'Will to Protect was on its 16 s cooldown'
            : undefined
    s.lastBlock = block
    if (block) return
    return willToProtect(ctx, s)
  },
}
