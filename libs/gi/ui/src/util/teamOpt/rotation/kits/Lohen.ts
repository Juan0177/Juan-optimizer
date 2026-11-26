import type { InputPremodKey } from '@genshin-optimizer/gi/wr-types'
import { HEXEREI_CHARACTERS } from '../gearEffects'
import type { DamageOutcome, KitModel, SimContext, SimHit } from '../types'
import {
  flatEnergy,
  KQMSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), pinned by KQMSIM below.
 * See priority-coverage/reference-audits/lohen.md for unresolved source differences. */

const normals: NormalHit[] = [
  {
    hitmarks: [8],
    hitlag: [6],
    toNormal: 12,
    toCharged: 12,
    toAbil: 8,
    frames: 26,
  },
  {
    hitmarks: [16],
    hitlag: [6],
    toNormal: 23,
    toCharged: 18,
    toAbil: 16,
    frames: 39,
  },
  {
    hitmarks: [13, 24, 35],
    hitlag: [4, 4, 6],
    toNormal: 37,
    toCharged: 36,
    toAbil: 35,
    frames: 55,
  },
  {
    hitmarks: [10],
    hitlag: [6],
    toNormal: 30,
    toCharged: 16,
    toAbil: 10,
    frames: 46,
  },
  {
    hitmarks: [18, 38],
    hitlag: [4, 9],
    toNormal: 69,
    toCharged: 73,
    toAbil: 38,
    frames: 73,
  },
]
const nodes = [['0'], ['1'], ['2', '2', '2'], ['3'], ['4', '5']]
interface State {
  end: number
  joy: number
  joyReady: number
  /** Frame of the last Joy gain: that hit's own hitlag doesn't extend the 0.1 s gap (kqmsim
   * starts the gap after it), so both hits of a charged attack gain Joy */
  joyAt: number
  skills: number
  /** Etches allowed in this Masterstroke (3; C6 adds 2) */
  maxSkills: number
  c2Until: number
  c2Ready: number
  c6Mark: boolean
  c6Ready: number
  will: Map<number, number>
  highSpiritsReady: number
  willReady: Partial<Record<SimHit['characterKey'], number>>
  hex: { end: number; probability: number }[]
}
const active = (c: SimContext, s: State) =>
  c.onField === 'Lohen' && c.now < s.end

/** Preserve the distribution: clipping E[Will] at 100 gives the wrong expectation. */
export function lohenWillAfterHit(
  previous: ReadonlyMap<number, number>,
  outcomes: readonly DamageOutcome[],
  baseAtk: number,
  c1 = false
): Map<number, number> {
  const next = new Map<number, number>()
  for (const [will, p] of previous)
    for (const roll of outcomes) {
      const gain =
        ((roll.damage >= 10 * baseAtk ? 20 : 1) +
          (roll.damage >= 30 * baseAtk ? 60 : 0)) *
        (c1 ? 5 : 1)
      const value = Math.min(c1 ? 300 : 100, will + gain)
      next.set(value, (next.get(value) ?? 0) + p * roll.probability)
    }
  return next
}

function finish(c: SimContext, s: State) {
  s.end = c.now
  s.joy = 0
  s.c2Until = -1
  s.c6Mark = false
  s.will = new Map([[0, 1]])
}
function consume(c: SimContext, s: State, burst: boolean) {
  const cons = c.constellation('Lohen')
  const inMaster = active(c, s)
  if (burst && cons >= 4 && inMaster)
    s.will = new Map([[cons >= 1 ? 300 : 100, 1]])
  const distribution = inMaster ? s.will : new Map([[0, 1]])
  const mean = [...distribution].reduce((sum, [will, p]) => sum + will * p, 0)
  const halfMax = cons >= 1 ? 150 : 50
  const probability = [...distribution].reduce(
    (sum, [will, p]) => sum + (will >= halfMax ? p : 0),
    0
  )
  if (
    c.members.filter((m) => HEXEREI_CHARACTERS.includes(m)).length >= 2 &&
    probability > 0
  )
    s.hex.push({ end: c.now + 360, probability })
  const c6 = cons >= 6 && inMaster
  let keep = false
  let refilledJoy = false
  if (c6 && c.now >= s.c6Ready) {
    keep = true
    s.c6Ready = c.now + 420
    if ((burst ? s.skills : s.skills + 1) < s.maxSkills) {
      s.joy = 100
      s.c6Mark = true
      refilledJoy = true
    }
  }
  if (!keep) s.will = new Map([[0, 1]])
  if (cons >= 2 && inMaster && c.now >= s.c2Ready) {
    s.c2Until = c.now + 240
    s.c2Ready = c.now + 240
  }
  return { talentMultiplier: 1 + mean * 0.004, c6, refilledJoy }
}
const snapshots = (c: SimContext) =>
  (
    [
      'atk',
      'critRate_',
      'critDMG_',
      'cryo_dmg_',
      'all_dmg_',
      'skill_dmg_',
      'burst_dmg_',
      'eleMas',
    ] as const
  ).map((stat) => ({
    stat: stat as InputPremodKey,
    path: ['total', stat],
    t: c.now,
    onField: c.onField,
  }))
function resourceAttack(c: SimContext, s: State, burst: boolean) {
  const first = burst ? 101 : 28
  if (!burst && c.constellation('Lohen') >= 6 && s.c6Mark) {
    s.c6Mark = false
    s.end += 75
  }
  let refilledJoy = false
  c.at(first - 1, (at) => {
    const res = consume(at, s, burst)
    refilledJoy = res.refilledJoy
    const statSnapshots = snapshots(at)
    for (const delay of burst
      ? [101, 125, 131, 137, 143, 167]
      : [28, 35, 45, 52])
      at.hit(delay - first + 1, {
        path: burst ? ['burst', 'burstDmg'] : ['skill', 'etchDmg'],
        tag: burst ? 'burst' : 'skill',
        element: 'cryo',
        applies: true,
        icd: burst ? 'burst' : 'skill',
        talentMultiplier: res.talentMultiplier,
        statSnapshots,
        ...(burst
          ? {
              states: [
                {
                  owner: 'Lohen' as const,
                  path: ['Lohen', 'c6BurstMaster'],
                  value: res.c6 ? 'on' : '',
                },
              ],
            }
          : {}),
        label: burst ? 'Manifest Judgment' : 'Etched Into Bone and Soul',
      })
  })
  if (!burst)
    c.at(first, () => {
      if (!refilledJoy) s.joy = 0
      s.skills++
    })
}

export const kit: KitModel = {
  characterKey: 'Lohen',
  element: 'cryo',
  source: `${KQMSIM}/lohen`,
  init: (): State => ({
    end: -1,
    joy: 0,
    joyReady: -1,
    joyAt: -1,
    skills: 0,
    maxSkills: 3,
    c2Until: -1,
    c2Ready: -1,
    c6Mark: false,
    c6Ready: -1,
    will: new Map([[0, 1]]),
    highSpiritsReady: -1,
    willReady: {},
    hex: [],
  }),
  onStart(c) {
    for (const condition of [
      'willConsumed',
      'lockBuff',
      'a4MasterCryo',
      'a0HighSpirits',
      'c2Blade',
      'c6BurstMaster',
    ])
      c.state('Lohen', ['Lohen', condition], '')
    c.note(
      'Lohen: Burst follows the six-hit timeline; N3, Joy consumption, the use limit and the per-member Will gain ICD follow the skill descriptions, correcting omissions in the pinned source.'
    )
  },
  simOnlyBuffs: () => [
    ['Lohen', 'willConsumed'],
    ['Lohen', 'lockBuff'],
    ['Lohen', 'a4MasterCryo'],
    ['Lohen', 'a0HighSpirits'],
    ['Lohen', 'c2Blade'],
    ['Lohen', 'c6BurstMaster'],
  ],
  cooldownKey(s: State, action, now) {
    return action.kind === 'skill'
      ? now < s.end
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined
  },
  // In Masterstroke his E is Etched Into Bone and Soul (its own frames)
  variant(c, s: State, action) {
    return action.kind === 'skill' && active(c, s)
      ? {
          key: 'etch',
          label: 'Etched Into Bone and Soul',
          mode: 'Masterstroke',
        }
      : undefined
  },
  act(c, s: State, action, previous) {
    switch (action.kind) {
      case 'skill':
        if (active(c, s)) {
          if (s.joy < 100 || s.skills >= s.maxSkills)
            return {
              frames: 0,
              failed:
                'Lohen: Etched Into Bone and Soul needs 100 Joy and has three uses per Masterstroke.',
            }
          resourceAttack(c, s, false)
          return {
            frames: 80,
            framesInto: { normal: 78, dash: 79, jump: 79, swap: 79 },
          }
        }
        if (!c.damageTracked)
          return {
            frames: 0,
            failed:
              'Lohen: teammate damage evaluation is required to calculate Will to Win.',
          }
        s.end = c.now + 799
        s.joy = 0
        s.skills = 0
        s.maxSkills = 3
        s.will = new Map([[0, 1]])
        if (c.now >= s.highSpiritsReady) {
          const own = c.calculate('Lohen', ['total', 'skillIndex'])
          const extended = c.members.some(
            (m) =>
              m !== 'Lohen' &&
              ['autoIndex', 'skillIndex', 'burstIndex'].some(
                (k) => (c.calculate(m, ['total', k]) ?? -1) >= (own ?? 0)
              )
          )
          c.buff(
            'Lohen',
            ['Lohen', 'a0HighSpirits'],
            'on',
            0,
            extended ? 900 : 540,
            { hitlag: 'recipient' }
          )
          s.highSpiritsReady = c.now + 1080
        }
        c.hit(19, {
          path: ['skill', 'castDmg'],
          tag: 'other',
          element: 'physical',
          label: 'Strategem (0 DMG)',
        })
        return {
          frames: 24,
          framesInto: {
            normal: 20,
            skill: 22,
            burst: 22,
            dash: 24,
            jump: 23,
            swap: 21,
            wait: 20,
          },
          cooldown: { key: 'skill', delay: 19, frames: 1080 },
        }
      case 'normal': {
        const masterstroke = active(c, s)
        return normalString(
          normals,
          action.count ?? 1,
          (i, delay, j) =>
            c.hit(delay, {
              path: [masterstroke ? 'skill' : 'normal', nodes[i][j]],
              tag: 'normal',
              element: masterstroke ? 'cryo' : 'physical',
              applies: true,
              icd: 'normal',
              label: `Normal ${i + 1}${masterstroke ? ' (Masterstroke)' : ''}`,
            }),
          c
        )
      }
      case 'charged': {
        // two hits on the world clock (gcsim QueueAttack at 18 and 26), each with 4 frames of
        // defense hitlag
        const masterstroke = active(c, s)
        for (const delay of [18, 26]) {
          c.hit(delay, {
            path: masterstroke ? ['skill', 'chargedDmg'] : ['charged', 'dmg'],
            tag: 'charged',
            element: masterstroke ? 'cryo' : 'physical',
            applies: true,
            icd: 'charged',
            label: 'Charged Attack',
          })
          c.hit(delay, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 4,
            label: 'Melee hitlag',
          })
        }
        return withHitlag(
          {
            frames: 40,
            framesInto: {
              normal: 32,
              skill: 27,
              burst: 27,
              dash: 26,
              jump: 26,
              swap: 30,
              wait: 26,
            },
          },
          { hitmarks: [18, 26], hitlag: [4, 4], worldTimeHits: true }
        )
      }
      case 'burst':
        if (active(c, s)) s.end += 99
        resourceAttack(c, s, true)
        return {
          frames: 130,
          framesInto: { normal: 129, skill: 129, swap: 129, wait: 129 },
          cooldown: { key: 'burst', frames: 900 },
        }
      case 'dash':
        // gcsim's template dash for his body: 21 frames, 2 into a jump
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        return templateJump('boy', 'polearm', previous, c)
      default:
        return {
          frames: 0,
          failed: `Lohen: ${action.text} is not implemented.`,
        }
    }
  },
  onSwapOut: finish,
  onHitlag(c, s: State, frames) {
    if (active(c, s)) s.end += frames
    for (const k of ['c2Until', 'c2Ready', 'c6Ready'] as const)
      if (s[k] > c.now) s[k] += frames
    if (s.joyReady > c.now && c.now > s.joyAt) s.joyReady += frames
    if (s.highSpiritsReady > c.now) s.highSpiritsReady += frames
    for (const buff of s.hex) if (c.now < buff.end) buff.end += frames
  },
  onHit(c, s: State, hit) {
    if (hit.characterKey === 'Lohen') {
      if (hit.tag !== 'normal' && hit.tag !== 'charged') return
      if (
        active(c, s) &&
        hit.element === 'cryo' &&
        c.now >= s.joyReady &&
        s.skills < s.maxSkills
      ) {
        s.joy = Math.min(100, s.joy + 17)
        s.joyReady = c.now + 6
        s.joyAt = c.now
      }
      // C2: Evilsbane Blade follows up a Masterstroke normal or charged hit (5 frames later)
      if (active(c, s) && hit.element === 'cryo' && c.now < s.c2Until) {
        s.c2Until = -1
        c.hit(5, {
          path: ['constellation2', 'dmg'],
          tag: 'normal',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Evilsbane Blade (C2)',
        })
        c.buff('Lohen', ['Lohen', 'c2Blade'], 'on', 0, 480, {
          hitlag: 'recipient',
        })
      }
      const probability =
        1 -
        s.hex
          .filter((b) => c.now < b.end)
          .reduce((p, b) => p * (1 - b.probability), 1)
      if (probability > 0)
        hit.bonusStats = {
          ...hit.bonusStats,
          [`${hit.tag}_dmg_`]: 40 * probability,
        }
      return
    }
    if (!active(c, s)) return
    const reaction = hit.path[1]
    if (
      hit.path[0] === '_reaction' &&
      [
        'cryoSwirl',
        'crystallizeCryo',
        'superconduct',
        'frozen',
        'melt',
        'stellarSwirl',
        'stellarConduct',
      ].includes(reaction)
    )
      for (const recipient of ['Lohen', hit.characterKey] as const)
        c.buff('Lohen', ['Lohen', 'a4MasterCryo'], 'on', 0, 480, {
          recipient,
          hitlag: 'recipient',
        })
  },
  observesDamage: (c, s: State, hit) =>
    active(c, s) &&
    hit.characterKey !== 'Lohen' &&
    c.now >= (s.willReady[hit.characterKey] ?? -1),
  onDamage(c, s: State, hit, outcomes) {
    if ((hit.weight ?? 1) !== 1)
      c.warn(
        'Lohen: fractional teammate hit counts are not verified for Will to Win.'
      )
    const baseAtk = c.calculate('Lohen', ['base', 'atk'])
    if (!outcomes || !baseAtk) {
      c.warn(
        'Lohen: could not evaluate a teammate damage roll for Will to Win.'
      )
      return
    }
    s.willReady[hit.characterKey] = c.now + 6
    s.will = lohenWillAfterHit(
      s.will,
      outcomes,
      baseAtk,
      c.constellation('Lohen') >= 1
    )
  },
}
