import type { ActionResult, KitModel, SimContext, SimHit } from '../types'
import { KQMSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/anastasya (Tsaritsa).
 * The pinned source has only the Blessing of Love; the Blessing of Honor (hold Skill, Blessed
 * Spear, The Evernight Yields to Dawn, Palestar Edict: Doom), the Palestar Crown freeze, C2's
 * own timers and the C6 triggers are implemented from the game text and the ability dump
 * (YuanShenResources 7.2.51 ConfigAbility_Avatar_Anastasya), with the frame estimates marked
 * ESTIMATE below. */
// Hitmarks include the 10-frame arrow travel. gcsim's InitNormalCancelSlice lets aim (and every
// ability) cancel at the last release frame, so toCharged equals toAbil.
const normals: NormalHit[] = [
  { hitmarks: [27], toNormal: 35, toCharged: 17, toAbil: 17, frames: 35 },
  { hitmarks: [35], toNormal: 26, toCharged: 25, toAbil: 25, frames: 26 },
  { hitmarks: [21, 36], toNormal: 39, toCharged: 26, toAbil: 26, frames: 39 },
  {
    hitmarks: [25, 34, 45],
    toNormal: 44,
    toCharged: 35,
    toAbil: 35,
    frames: 44,
  },
  { hitmarks: [27], toNormal: 52, toCharged: 17, toAbil: 17, frames: 52 },
]
/**
 * The Blessing of Honor's frames follow a measured on-field turn, hE Q N5 D N5 E E E: 12.1 s
 * (hE Q 3.4 s, N5 D 2.9 s, N5 into Doom 2.5 s, Doom's three stages 3.3 s) plus 0.3 s of buffer,
 * 12.4 s in all.
 *
 * The Blessed Spear string (1 / 2 / 1 / 3 / 3 instances): 154 frames into the Skill after N5. No
 * hitlag is modelled.
 */
const spear: NormalHit[] = [
  { hitmarks: [16], toNormal: 26, toCharged: 26, toAbil: 16, frames: 26 },
  { hitmarks: [13, 19], toNormal: 33, toCharged: 33, toAbil: 19, frames: 33 },
  // (N3 is dash-, Skill- and swap-cancelled almost at once; its thrust still lands at 21: N3 D
  // spam in footage takes 80 f a round at best, here 82 with 2 f of buffer: 26 + 33 + 2 + 21)
  { hitmarks: [21], toNormal: 36, toCharged: 37, toAbil: 2, frames: 37 },
  {
    hitmarks: [16, 20, 25],
    toNormal: 30,
    toCharged: 30,
    toAbil: 25,
    frames: 30,
  },
  {
    hitmarks: [20, 25, 29],
    toNormal: 55,
    toCharged: 55,
    toAbil: 29,
    frames: 55,
  },
]
/** Hold Skill, then The Evernight Yields to Dawn: 212 frames together (see `spear`). */
const HOLD_HITMARK = 43
const HOLD_FRAMES = 67
const BURST_HITMARK = 140
const BURST_FRAMES = 145
/** Blessing of Honor 15 s; The Evernight Yields to Dawn (and its Sealing) 14 s; Love burst 20 s. */
const HONOR_DURATION = 900
const EVERNIGHT_DURATION = 840
const LOVE_DURATION = 1200
/**
 * The others' (Honor) Sealing, as the dump's ElementalBurst_Descender: it ends when
 * `_ABILITY_Anastasya_Descender_Value` reaches `_ABILITY_Anastasya_Descender_ValueMax` (120).
 * Descender_TimeGrow adds 0.5 every 0.1 s (1 point every 12 frames) and each Blessed Spear attack
 * adds `Descender_NormalAttack_0X_Add` (10/20/20/30/30) at 10% of its state (N5's through
 * NormalAttack_05_AddValue_Delay, 0.65 s later): one N5 string ends it. Time alone gets 70 in the
 * 14 s Descender_Handler, which then runs out: the others unseal without Doom.
 */
const HONOR_SEAL_POINTS = 120
const SPEAR_SEAL_ADD = [10, 20, 20, 30, 30]
/** Frames into each Blessed Spear attack its value lands */
const SPEAR_SEAL_AT = [3, 3, 4, 3, 44]

interface State {
  skillEnd: number
  skillId: number
  burstEnd: number
  a1End: number
  sealArmed: boolean
  sealed: boolean
  sealPoints: number
  sealId: number
  shareUntil: number
  triumphUntil: number
  /** Blessing of Honor */
  honorEnd: number
  /** Evernight freezes the Blessing until this frame; `honorLeft` is what remains after it */
  freezeEnd: number
  honorLeft: number
  /** The other members are Sealed by The Evernight Yields to Dawn */
  othersSealed: boolean
  othersSealPoints: number
  othersSealId: number
  othersShareUntil: number
  /** Palestar Edict: Doom: the next stage (1-3) and until when it can be used */
  doomStage: number
  doomUntil: number
  c2LoveEnd: number
  c2HonorEnd: number
  c6Ready: number
  c6LoveEnd: number
  c6LoveArmed: boolean
  c6HonorEnd: number
  c6HonorArmed: boolean
}
const set = (c: SimContext, name: string, value: string) =>
  c.state('Anastasya', ['Anastasya', name], value)
const honorActive = (c: SimContext, s: State) => c.now < s.honorEnd
function sync(c: SimContext, s: State) {
  // She always holds the Blessing of Love unless she holds the Blessing of Honor.
  set(c, 'blessing', honorActive(c, s) ? 'honor' : 'love')
  set(c, 'burstActive', c.now < s.burstEnd ? 'on' : '')
  set(
    c,
    'accolades',
    c.now < s.a1End
      ? s.othersSealed || c.now < s.othersShareUntil
        ? 'honorSeal'
        : s.sealed || c.now < s.shareUntil
          ? 'loveSeal'
          : 'on'
      : ''
  )
  set(
    c,
    'a0StellarRadianceSc',
    c.radiance === 'conduct' ? 'on' : c.radiance === 'swirl' ? 'ss' : ''
  )
  if (c.constellation('Anastasya') >= 2) {
    set(c, 'c2LoveWindow', c.now < s.c2LoveEnd ? 'on' : 'off')
    set(c, 'c2HonorWindow', c.now < s.c2HonorEnd ? 'on' : 'off')
  }
  if (c.constellation('Anastasya') >= 6) {
    set(c, 'c6LoveWindow', c.now < s.c6LoveEnd ? 'on' : 'off')
    set(c, 'c6HonorWindow', c.now < s.c6HonorEnd ? 'on' : 'off')
  }
}
/** Re-evaluate the conditions when a timer ends */
const syncAt = (c: SimContext, s: State, frame: number) =>
  c.at(Math.max(0, frame - c.now), (c2) => sync(c2, s))
function hit(
  c: SimContext,
  delay: number,
  path: string[],
  label: string,
  tag: SimHit['tag'] = 'other',
  applies = false
) {
  c.hit(delay, { path, label, tag, element: 'cryo', applies, icd: 'none' })
}
function stellar(
  c: SimContext,
  section: string,
  name: string,
  label: string,
  states?: SimHit['states']
) {
  const swirl = c.radiance === 'swirl'
  c.hit(0, {
    path: [section, `${name}${swirl ? 'Ss' : 'Sc'}`],
    label: `${label} (${swirl ? 'Stellar Swirl' : 'Stellar-Conduct'})`,
    tag: swirl ? 'directStellarSwirl' : 'directStellarConduct',
    element: 'cryo',
    applies: false,
    icd: 'none',
    states,
  })
}
function sealPoints(c: SimContext, s: State, points: number) {
  if (!s.sealed) return
  s.sealPoints = Math.max(0, s.sealPoints - points)
  if (!s.sealPoints) {
    s.sealed = false
    s.shareUntil = c.now + 480
    s.triumphUntil = c.now + 1200
    sync(c, s)
    c.at(480, (c2) => sync(c2, s))
  }
}
function sealTick(c: SimContext, s: State, id: number) {
  if (id !== s.sealId || !s.sealed) return
  sealPoints(c, s, 1)
  c.at(12, (c2) => sealTick(c2, s, id))
}
/**
 * The other members' (Honor) Sealing ends: Doom becomes available for as long as the
 * Descender_Handler lasts (the freeze). Frozen_SwitchSkill_Prepare also removes
 * Constellation_6_Descender_Ready: an unused C6 Honor strike is lost.
 */
function othersSealPoints(c: SimContext, s: State, points: number) {
  if (!s.othersSealed) return
  s.othersSealPoints = Math.max(0, s.othersSealPoints - points)
  if (s.othersSealPoints) return
  s.othersSealed = false
  s.othersShareUntil = c.now + 480
  s.doomStage = 1
  s.doomUntil = s.freezeEnd
  c6HonorLost(c, s)
  sync(c, s)
  syncAt(c, s, s.othersShareUntil)
}
/**
 * The Descender_Handler is removed before the Sealing ends (it ran out, or the Blessing ended): the
 * others unseal without Doom, and the C6 Honor strike goes with it.
 */
function othersUnseal(c: SimContext, s: State) {
  if (s.othersSealed) {
    s.othersSealed = false
    s.othersShareUntil = c.now + 480
    syncAt(c, s, s.othersShareUntil)
  }
  s.doomStage = 0
  c6HonorLost(c, s)
  sync(c, s)
}
/** The C6 Honor strike, unused, goes with the others' Sealing */
function c6HonorLost(c: SimContext, s: State) {
  if (s.c6HonorArmed && c.now < s.c6HonorEnd)
    c.note(
      'Anastasya C6: her Honor strike went unused: the others’ Sealing ended before her Skill was tapped. Tap E before her Normal Attacks end the Sealing (e.g. hE Q E N5).'
    )
  s.c6HonorArmed = false
}
function othersSealTick(c: SimContext, s: State, id: number) {
  if (id !== s.othersSealId || !s.othersSealed) return
  othersSealPoints(c, s, 1)
  c.at(12, (c2) => othersSealTick(c2, s, id))
}
function crown(c: SimContext, s: State, id: number) {
  if (s.skillId !== id || c.now >= s.skillEnd) return
  sync(c, s)
  c.hit(0, {
    path: ['skill', 'crownDmg'],
    label: 'Palestar Crown (Cryo)',
    tag: 'skill',
    element: 'cryo',
    applies: true,
    icd: 'skill',
    icdGroup: 'AnastasyaSkill',
  })
  c.at(4, (c2) => {
    sync(c2, s)
    if (c2.radiance) stellar(c2, 'skill', 'crown', 'Palestar Crown')
    else
      c2.hit(0, {
        path: ['skill', 'crownDmg'],
        label: 'Palestar Crown (Cryo)',
        tag: 'skill',
        element: 'cryo',
        applies: true,
        icd: 'skill',
        icdGroup: 'AnastasyaSkill',
      })
    if (c2.now < s.burstEnd) stellar(c2, 'burst', 'crown', 'Burst Crown')
  })
  c.at(118, (c2) => crown(c2, s, id))
}
function triumph(c: SimContext, s: State): ActionResult {
  s.triumphUntil = -1
  c.at(28, (c2) => {
    sync(c2, s)
    stellar(c2, 'burst', 'triumph', 'Triumph')
  })
  return { frames: 26 }
}
/**
 * C6 arms on a Skill use (30 s; once every 15 s) according to the Blessing it grants. Out of its
 * TriggerCD the dump's Constellation_6 first removes both Mercy_Ready and Descender_Ready.
 */
function c6OnSkill(c: SimContext, s: State, blessing: 'love' | 'honor') {
  if (c.constellation('Anastasya') < 6 || c.now < s.c6Ready) return
  s.c6Ready = c.now + 900
  s.c6LoveArmed = blessing === 'love'
  s.c6HonorArmed = blessing === 'honor'
  if (blessing === 'love') s.c6LoveEnd = c.now + 1800
  else s.c6HonorEnd = c.now + 1800
  syncAt(c, s, c.now + 1800)
}
/**
 * Palestar Edict: Doom, stage by stage (selecting a just-unsealed member or pressing the Skill;
 * only the Skill press is modelled). Frames, 203 for the three (see `spear`): stage 1's slashes
 * from 23 to 65 and its Stellar finisher at 86 (104 frames); stage 2's leap slash at 39 (65
 * frames); stage 3's thrown spear lands at 36 (34 frames). Stage 3 ends the Evernight freeze.
 */
function doom(c: SimContext, s: State): ActionResult {
  const stage = s.doomStage
  s.doomStage = stage < 3 ? stage + 1 : 0
  if (stage === 1) {
    for (const d of [23, 34, 44, 55, 65])
      c.hit(d, {
        path: ['burst', 'doom1Dmg'],
        label: 'Palestar Edict: Doom 1-Hit (Cryo)',
        tag: 'skill',
        element: 'cryo',
        applies: true,
        icd: 'skill',
      })
    c.at(86, (c2) => {
      sync(c2, s)
      stellar(c2, 'burst', 'doom0', 'Palestar Edict: Doom 1-Hit')
    })
    return { frames: 104 }
  }
  if (stage === 2) {
    c.at(39, (c2) => {
      sync(c2, s)
      stellar(c2, 'burst', 'doom1', 'Palestar Edict: Doom 2-Hit')
    })
    return { frames: 65 }
  }
  // (after the Sealing, Frozen_SwitchSkill_Prepare has removed C6 Honor: always its own DMG)
  c.at(36, (c2) => {
    sync(c2, s)
    stellar(c2, 'burst', 'doom2', 'Palestar Edict: Doom 3-Hit')
  })
  if (c.now < s.freezeEnd) {
    s.freezeEnd = c.now
    s.honorEnd = c.now + s.honorLeft
    syncAt(c, s, s.honorEnd)
  }
  return { frames: 34 }
}
const doomReady = (c: SimContext, s: State) =>
  s.doomStage > 0 && c.now < s.doomUntil
/**
 * C6 Honor: from the hold Skill until the others' Sealing ends (or the Blessing does),
 * Constellation_6_Descender_Ready makes the Skill button Doom's third attack (11498, no cooldown).
 */
const c6StrikeAt = (s: State, now: number) =>
  s.c6HonorArmed &&
  now < s.c6HonorEnd &&
  now < s.honorEnd &&
  !(s.doomStage > 0 && now < s.doomUntil)
/**
 * The C6 Honor strike, an extra attack: Doom's third stage animation with FreeCount 3, so
 * Breaking_Descender03_C6_Damage at 250% (C6_Descender_DamageRatio, times C2's ratio) with every
 * member's Accolades (C6_VirtualSealed_Bonus, or the real share while they are Sealed). Its
 * Breaking_Descender03_AS keeps the Descender_Handler (FreeCount 3): no freeze end, and Doom's own
 * stages are untouched.
 */
function c6Strike(c: SimContext, s: State): ActionResult {
  s.c6HonorArmed = false
  c.at(36, (c2) => {
    sync(c2, s)
    stellar(c2, 'constellation6', 'doom3', 'Palestar Edict: Doom 3-Hit (C6)', [
      {
        owner: 'Anastasya',
        path: ['Anastasya', 'blessing'],
        value: 'honor',
      },
      {
        owner: 'Anastasya',
        path: ['Anastasya', 'accolades'],
        value: 'honorSeal',
      },
    ])
  })
  return { frames: 34 }
}

export const kit: KitModel = {
  characterKey: 'Anastasya',
  element: 'cryo',
  source: `${KQMSIM}/anastasya`,
  init: (): State => ({
    skillEnd: -1,
    skillId: 0,
    burstEnd: -1,
    a1End: -1,
    sealArmed: false,
    sealed: false,
    sealPoints: 0,
    sealId: 0,
    shareUntil: -1,
    triumphUntil: -1,
    honorEnd: -1,
    freezeEnd: -1,
    honorLeft: 0,
    othersSealed: false,
    othersSealPoints: 0,
    othersSealId: 0,
    othersShareUntil: -1,
    doomStage: 0,
    doomUntil: -1,
    c2LoveEnd: -1,
    c2HonorEnd: -1,
    c6Ready: -1,
    c6LoveEnd: -1,
    c6LoveArmed: false,
    c6HonorEnd: -1,
    c6HonorArmed: false,
  }),
  onStart(c, s: State) {
    sync(c, s)
    if (c.constellation('Anastasya') >= 6)
      c.note(
        'Anastasya C6: the Love Triumph on the next switch and the Honor strike (her Skill before the others’ Sealing ends) follow the game’s logic (the reference never triggers them).'
      )
  },
  // Her E is Triumph after the Love Sealing, Palestar Edict: Doom's next attack after the Honor
  // Sealing, or C6 Honor's strike before it ends; with the Blessing of Honor her normal attacks are
  // the Blessed Spear and her Q is The Evernight Yields to Dawn (each with frames of its own,
  // estimates)
  variant(ctx, s: State, action) {
    if (action.kind === 'skill') {
      if (ctx.now < s.triumphUntil) return { key: 'triumph', label: 'Triumph' }
      if (doomReady(ctx, s))
        return {
          key: `doom${s.doomStage}`,
          label: `Palestar Edict: Doom ${s.doomStage}-Hit`,
        }
      if (c6StrikeAt(s, ctx.now))
        return { key: 'c6doom', label: 'Palestar Edict: Doom 3-Hit (C6)' }
      return undefined
    }
    if (!honorActive(ctx, s)) return undefined
    const mode = 'Blessing of Honor'
    if (action.kind === 'normal')
      return { key: 'honor', label: 'Blessed Spear', mode }
    if (action.kind === 'burst')
      return { key: 'honor', label: 'The Evernight Yields to Dawn', mode }
    return undefined
  },
  act(ctx, s: State, action, previous) {
    sync(ctx, s)
    switch (action.kind) {
      case 'normal':
        if (honorActive(ctx, s))
          // Radiance: the final instance of each Blessed Spear attack is Stellar Glimmer DMG.
          return normalString(
            spear,
            action.count ?? 1,
            (i, t, j) => {
              // Descender_NormalAttack_0X_AddValue: each attack brings the Sealing's end closer
              if (j === 0)
                ctx.at(t - spear[i].hitmarks[0] + SPEAR_SEAL_AT[i], (c2) =>
                  othersSealPoints(c2, s, SPEAR_SEAL_ADD[i])
                )
              ctx.at(t, (c2) => {
                const label = `Blessed Spear N${i + 1}`
                if (j === spear[i].hitmarks.length - 1 && c2.radiance)
                  stellar(c2, 'skill', `honor${i}`, label, [
                    {
                      owner: 'Anastasya',
                      path: ['Anastasya', 'a0StellarRadianceSc'],
                      value: c2.radiance === 'swirl' ? 'ss' : 'on',
                    },
                  ])
                else
                  c2.hit(0, {
                    path: ['skill', `honor${i}`],
                    tag: 'normal',
                    element: 'cryo',
                    applies: true,
                    icd: 'normal',
                    label,
                  })
              })
            },
            ctx
          )
        return normalString(
          normals,
          action.count ?? 1,
          (i, t) =>
            ctx.hit(t, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        if (honorActive(ctx, s))
          return {
            frames: 0,
            failed:
              'Anastasya: she cannot use Charged Attacks with the Blessing of Honor.',
          }
        hit(
          ctx,
          96,
          ['charged', 'fullyCharged'],
          'Fully-Charged Aimed Shot',
          'charged',
          true
        )
        return { frames: 96, framesInto: { dash: 86, jump: 86 } }
      case 'skill': {
        if (ctx.now < s.triumphUntil) return triumph(ctx, s)
        if (doomReady(ctx, s)) return doom(ctx, s)
        if (c6StrikeAt(s, ctx.now)) return c6Strike(ctx, s)
        const cons = ctx.constellation('Anastasya')
        s.a1End = ctx.now + 1200
        syncAt(ctx, s, s.a1End)
        if (action.hold) {
          // ESTIMATE frames (see HOLD_*). Blessing of Honor for 15 s; C2 Honor 130% for 15 s (125% before beta 7.2.54).
          hit(
            ctx,
            HOLD_HITMARK,
            ['skill', 'holdDmg'],
            'Skill (Hold)',
            'skill',
            true
          )
          s.honorEnd = ctx.now + HONOR_DURATION
          s.freezeEnd = -1
          syncAt(ctx, s, s.honorEnd)
          // ElementalArt_Hold removes the Palestar Crown (Click_Handler) and To the New World
          // (Mercy_Handler, Mercy_StarReact_DamageUp); Constellation_2 removes C2 Love's handler
          s.skillEnd = -1
          s.burstEnd = Math.min(s.burstEnd, ctx.now)
          s.sealArmed = false
          s.c2LoveEnd = Math.min(s.c2LoveEnd, ctx.now)
          if (cons >= 2) {
            s.c2HonorEnd = ctx.now + 900
            syncAt(ctx, s, s.c2HonorEnd)
          }
          c6OnSkill(ctx, s, 'honor')
          sync(ctx, s)
          ctx.note(
            'Anastasya: the Blessing of Honor (hold Skill, Blessed Spear, Evernight, Doom) is not in the reference; its frames are estimates.'
          )
          return {
            frames: HOLD_FRAMES,
            cooldown: { key: 'skill', frames: 900, delay: 30 },
          }
        }
        hit(ctx, 17, ['skill', 'tapDmg'], 'Skill (Tap)', 'skill', true)
        // ElementalArt_Click removes the Hold_Handler and Descender_Handler (the Blessing of
        // Honor, its Sealing and Doom); Constellation_2 removes C2 Honor's handler
        if (s.othersSealed || s.doomStage) othersUnseal(ctx, s)
        s.honorEnd = -1
        s.freezeEnd = -1
        s.c2HonorEnd = Math.min(s.c2HonorEnd, ctx.now)
        // The Love burst freezes the Palestar Crown while it lasts.
        s.skillEnd = ctx.now + 1200 + Math.max(0, s.burstEnd - ctx.now)
        if (cons >= 2) {
          s.c2LoveEnd = ctx.now + 1800
          syncAt(ctx, s, s.c2LoveEnd)
        }
        c6OnSkill(ctx, s, 'love')
        const id = ++s.skillId
        sync(ctx, s)
        ctx.at(139, (c) => crown(c, s, id))
        return {
          frames: 35,
          cooldown: { key: 'skill', frames: 900, delay: 14 },
        }
      }
      case 'burst':
        if (honorActive(ctx, s)) {
          // The Evernight Yields to Dawn (ESTIMATE frames): Stellar-Conduct (Swirl) DMG, freezes
          // the Blessing for 14 s and Seals the other members until their Sealing runs out.
          ctx.at(BURST_HITMARK, (c) => {
            sync(c, s)
            stellar(c, 'burst', 'evernight', 'The Evernight Yields to Dawn')
            s.honorLeft = Math.max(0, s.honorEnd - c.now)
            s.freezeEnd = c.now + EVERNIGHT_DURATION
            s.honorEnd = s.freezeEnd + s.honorLeft
            syncAt(c, s, s.honorEnd)
            s.othersSealed = true
            s.othersSealPoints = HONOR_SEAL_POINTS
            s.doomStage = 0
            const id = ++s.othersSealId
            sync(c, s)
            c.at(12, (c2) => othersSealTick(c2, s, id))
            // the 14 s Descender_Handler runs out before the Sealing ends: no Doom
            c.at(EVERNIGHT_DURATION, (c2) => {
              if (id === s.othersSealId && s.othersSealed) othersUnseal(c2, s)
            })
          })
          return {
            frames: BURST_FRAMES,
            cooldown: { key: 'burst', frames: 1080 },
          }
        }
        ctx.at(105, (c) => {
          hit(c, 0, ['burst', 'loveDmg'], 'To the New World', 'burst', true)
          s.burstEnd = c.now + LOVE_DURATION
          // It freezes the Palestar Crown's duration while it lasts.
          if (c.now < s.skillEnd) {
            s.skillEnd += LOVE_DURATION
            c.note(
              "Anastasya: To the New World freezes the Palestar Crown's duration (game text; the reference lets the crown expire after 20 s)."
            )
          }
          s.sealArmed = true
          sync(c, s)
          c.at(LOVE_DURATION, (c2) => sync(c2, s))
        })
        return { frames: 109, cooldown: { key: 'burst', frames: 1080 } }
      case 'dash':
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        return templateJump('lady', 'bow', previous, ctx)
      default:
        return {
          frames: 0,
          failed: `Anastasya: ${action.text} is not implemented in kqmsim.`,
        }
    }
  },
  onSwapOut(ctx, s: State) {
    // Avatar_Anastasya_AvatarOut_Handler: leaving the field removes the Hold_Handler (the Blessing
    // of Honor, its freeze, C6 Honor) and the Descender_Handler (the others' Sealing and Doom)
    if (honorActive(ctx, s)) {
      if (s.othersSealed)
        ctx.warn(
          'Anastasya: the other members are Sealed by The Evernight Yields to Dawn and could not be switched in yet.'
        )
      s.honorEnd = ctx.now
      s.freezeEnd = -1
      othersUnseal(ctx, s)
    }
    if (!s.sealArmed) return
    s.sealArmed = false
    s.sealed = true
    s.sealPoints = 100
    sync(ctx, s)
    const id = ++s.sealId
    ctx.at(12, (c) => sealTick(c, s, id))
  },
  onPartySwap(ctx, s: State, _from, to) {
    if (to === 'Anastasya') return
    // C6 Love: the next switch to another member triggers Triumph at 200%.
    if (s.c6LoveArmed && ctx.now < s.c6LoveEnd) {
      s.c6LoveArmed = false
      ctx.at(28, (c2) => {
        sync(c2, s)
        stellar(c2, 'constellation6', 'triumph', 'Triumph (C6)', [
          {
            owner: 'Anastasya',
            path: ['Anastasya', 'blessing'],
            value: 'love',
          },
        ])
      })
    }
  },
  swapReadyAt: (s: State, now) => (s.sealed ? now + s.sealPoints * 12 : now),
  onSwapIn(ctx, s: State) {
    if (ctx.now < s.triumphUntil) return triumph(ctx, s)
    return undefined
  },
  cooldownKey: (s: State, action, now) =>
    action.kind === 'skill' &&
    (now < s.triumphUntil ||
      (s.doomStage > 0 && now < s.doomUntil) ||
      c6StrikeAt(s, now))
      ? undefined
      : action.kind === 'skill' || action.kind === 'burst'
        ? action.kind
        : undefined,
  onHit(ctx, s: State, h) {
    if (h.path[0] === '_reaction' || h.characterKey === 'Anastasya')
      sync(ctx, s)
    if (
      !h.path[0].startsWith('_') &&
      (/Stellar-Conduct|Stellar Swirl/.test(h.label) ||
        (h.path[0] === 'reaction' && h.path[1].startsWith('stellar')))
    )
      sealPoints(ctx, s, 2)
  },
}
