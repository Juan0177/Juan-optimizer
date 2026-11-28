import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { yieldTask } from '@genshin-optimizer/gi/solver'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import type {
  FrameData,
  HitElement,
  RotationMember,
  RotationTimingSettings,
  RotationWordStep,
} from './rotation'
import {
  actionVariants,
  FPS,
  kitModels,
  parseRotation,
  rotationWords,
  simulateRotation,
  wordsRotationText,
} from './rotation'
import type { RotationScore } from './rotationSearch'
import { energyFits, rotationEdits, rotationVocabulary } from './rotationSearch'
import type { ErPrice } from './rotationSearchEr'
import { erCostOf } from './rotationSearchEr'

/**
 * Sentinel stored in `ConsRotationTexts[cons]` when the user explicitly pins a constellation to
 * the team's base rotation (disabling auto-adaptation for that constellation and above).
 */
export const KEEP_BASE_ROTATION = '__base__'

export type ConsRotationHintKind =
  | 'extraSkill'
  | 'burstResetSkill'
  | 'chargeBeams'
  | 'combo'

export interface ConsRotationHint {
  characterKey: CharacterKey
  cons: number
  kind: ConsRotationHintKind
  /** Short plain-English explanation of what this constellation unlocks */
  summary: string
  /** Concise action cue (e.g. "Add an extra E", "Use CA[beams=6]") */
  cue: string
  /** Target condensed beam count when `kind === 'chargeBeams'` */
  beams?: number
}

export const isAutoAdaptableHint = (hint: ConsRotationHint) =>
  hint.kind !== 'combo'

type CuratedHint = Omit<ConsRotationHint, 'characterKey' | 'cons'>

/**
 * Curated kit metadata for constellations whose rotation changes cannot be inferred purely from
 * `kit.charges()` or `actionVariants()`. Auto-derived kit charges & beam counts merge on top.
 */
const CURATED_CONS_HINTS: Partial<
  Record<CharacterKey, Partial<Record<number, CuratedHint>>>
> = {
  Vesna: {
    1: {
      kind: 'extraSkill',
      summary: 'First Lv. 3 Windborne Blade is free & up to 4 max-level uses',
      cue: 'Add an extra E in Armed for Action',
    },
    6: {
      kind: 'combo',
      summary: 'Unlocks Windborne Sword: Transpose tap after each Lv. 3 E',
      cue: 'Weave E or N1 Transpose after Lv. 3 E',
    },
  },
  Shenhe: {
    1: {
      kind: 'extraSkill',
      summary: 'Adds a 2nd Elemental Skill charge',
      cue: 'Add an extra E or hE',
    },
  },
  Baizhu: {
    1: {
      kind: 'extraSkill',
      summary: 'Adds a 2nd Elemental Skill charge',
      cue: 'Add an extra E',
    },
  },
  Amber: {
    4: {
      kind: 'extraSkill',
      summary: 'Adds a 2nd Baron Bunny charge & shorter Skill CD',
      cue: 'Add an extra E',
    },
  },
  KaedeharaKazuha: {
    1: {
      kind: 'burstResetSkill',
      summary: 'Elemental Burst resets Skill cooldown',
      cue: 'Add E after Q (E Q E)',
    },
  },
  Tartaglia: {
    6: {
      kind: 'burstResetSkill',
      summary: 'Melee Burst resets Skill cooldown on exit',
      cue: 'Re-enter Skill or extend melee after Q',
    },
  },
  Flins: {
    1: {
      kind: 'combo',
      summary: 'Spearstorm CD drops from 6 s to 4 s',
      cue: 'Fit an extra E Q mini-burst',
    },
  },
  Varka: {
    1: {
      kind: 'combo',
      summary: 'Grants an extra Four Winds / Azure Devour charge (+200% DMG)',
      cue: 'Add an extra E or CA in Sturm',
    },
    6: {
      kind: 'combo',
      summary: 'Free Windbound Skill / CA follow-up window for 3 s',
      cue: 'Chain E and CA follow-ups',
    },
  },
  Wriothesley: {
    1: {
      kind: 'combo',
      summary: 'N5 triggers enhanced Rebuke CA & extends Skill by 4 s',
      cue: 'Play N5 CA strings during Chilling Penalty',
    },
  },
  Yelan: {
    6: {
      kind: 'combo',
      summary: 'Unlocks 5 Breakthrough Barb shots after Burst',
      cue: 'Weave N3–N5 after Q',
    },
  },
  Xianyun: {
    6: {
      kind: 'combo',
      summary: 'Up to 8 free Skill-Plunge cycles after Burst',
      cue: 'Chain on-field E P casts after Q',
    },
  },
  Furina: {
    6: {
      kind: 'combo',
      summary: '6 Hydro-infused attacks after Skill',
      cue: 'Weave Normal Attacks after E',
    },
  },
  Ganyu: {
    6: {
      kind: 'combo',
      summary: 'Instant Charged Attack after Skill',
      cue: 'Add an instant CA right after E',
    },
  },
  HuTao: {
    1: {
      kind: 'combo',
      summary: 'Zero-stamina Charged Attacks allow faster dash cancels',
      cue: 'Switch jump cancels (J) to dash cancels (D)',
    },
  },
  Mavuika: {
    1: {
      kind: 'combo',
      summary: 'Higher Nightsoul cap extends Flamestrider field time',
      cue: 'Add extra Charged Attack spins',
    },
  },
  Neuvillette: {
    6: {
      kind: 'combo',
      summary: 'Absorbs droplets during CA to extend beam duration',
      cue: 'Extend Charged Attack duration',
    },
  },
  Xilonen: {
    6: {
      kind: 'combo',
      summary: '5 s Nightsoul Blessing immunity after sprint or NA',
      cue: 'Stay on-field for extra NAs',
    },
  },
  // biome-ignore format: single-line entry so vite-plugin-released strips it in GO_RELEASED=1
  Anastasya: { 6: { kind: 'combo', summary: 'Unlocks Love Triumph / Honor C6 follow-up trigger', cue: 'Trigger extra E or swap window' } },
  Emilie: {
    6: {
      kind: 'combo',
      summary: 'Grants Dendro infusion & extra Clear Dewdrops after E/Q',
      cue: 'Weave NAs/CAs after E or Q',
    },
  },
  Mualani: {
    2: {
      kind: 'combo',
      summary: 'Starts Nightsoul with 2 Wave Momentum stacks',
      cue: 'Faster Sharky Bites — fit extra bites or shorter field time',
    },
  },
}

const maxBeamsAt = (ck: CharacterKey, cons: number) => {
  let max = 0
  for (const w of actionVariants(ck, cons)) {
    const m = /^CA\[beams=(\d+)\]$/i.exec(w)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return max
}

/** Look up rotation-changing metadata for one member at one exact constellation (`1..6`). */
export function constellationHintOf(
  characterKey: CharacterKey,
  cons: number
): ConsRotationHint | undefined {
  if (cons < 1 || cons > 6) return undefined
  const curated = CURATED_CONS_HINTS[characterKey]?.[cons]
  if (curated) return { characterKey, cons, ...curated }

  // Auto-detect extra Skill charge unlocks directly from the rotation kit model
  const kit = kitModels[characterKey]
  if (kit?.charges) {
    const prev = kit.charges(cons - 1)?.['skill'] ?? 1
    const next = kit.charges(cons)?.['skill'] ?? 1
    if (next > prev) {
      return {
        characterKey,
        cons,
        kind: 'extraSkill',
        summary: `Adds ${next === 2 ? 'a 2nd' : `a ${next}rd`} Elemental Skill charge`,
        cue: 'Add an extra E',
      }
    }
  }

  // Auto-detect higher condensed beam limits (e.g. Sandrone C1 -> CA[beams=6])
  const prevBeams = maxBeamsAt(characterKey, cons - 1)
  const nextBeams = maxBeamsAt(characterKey, cons)
  if (nextBeams > prevBeams && nextBeams > 0) {
    return {
      characterKey,
      cons,
      kind: 'chargeBeams',
      beams: nextBeams,
      summary: `Unlocks up to ${nextBeams} condensed beams per Charged Attack`,
      cue: `Use CA[beams=${nextBeams}]`,
    }
  }

  return undefined
}

/** All rotation-changing constellations for `characterKey` in `(baseCons, maxCons]`. */
export function constellationRotationHints(
  characterKey: CharacterKey,
  baseCons: number,
  maxCons = 6
): ConsRotationHint[] {
  const out: ConsRotationHint[] = []
  for (let c = Math.max(1, baseCons + 1); c <= Math.min(6, maxCons); c++) {
    const hint = constellationHintOf(characterKey, c)
    if (hint) out.push(hint)
  }
  return out
}

const isSkillToken = (w: string) => /^[th]?E(?![a-z])/i.test(w)
const isBurstToken = (w: string) => /^Q(?![a-z])/i.test(w)
const isChargeToken = (w: string) => /^CA(?:\[beams=\d+\])?$/i.test(w)

/** Compact human-readable diff of changed steps between `baseText` and `altText`. */
export function stepDiffSummary(
  baseText: string,
  altText: string,
  names: readonly RotationMember[],
  focusCk?: CharacterKey
): string {
  const baseSteps = rotationWords(baseText, names)
  const altSteps = rotationWords(altText, names)
  if (baseSteps.length === altSteps.length) {
    const diffs: string[] = []
    for (let i = 0; i < baseSteps.length; i++) {
      const b = baseSteps[i]
      const a = altSteps[i]
      if (focusCk && b.characterKey !== focusCk && a.characterKey !== focusCk)
        continue
      const bStr = b.words.join(' ')
      const aStr = a.words.join(' ')
      if (bStr === aStr) continue
      diffs.push(`${a.name}: ${bStr || '—'} → ${aStr || '—'}`)
    }
    if (diffs.length) return diffs.slice(0, 2).join(' · ')
  }
  return altText.trim()
}

export interface ConsRotationSuggestion {
  text: string
  /** Compact diff label (e.g. "Vesna: E E E Q E N6 E N6 E → E E E Q E E N6 E N6 E") */
  diff: string
  /** Short action tag (e.g. "+E", "CA[beams=6]", "+E after Q") */
  tag: string
  rotationTime?: number
  extraHits?: number
}

export interface SuggestSimContext {
  members: readonly CharacterKey[]
  constellations: Partial<Record<CharacterKey, number>>
  opener?: string
  timing?: RotationTimingSettings
  frameData?: FrameData
}

function generateRawCandidates(
  baseSteps: readonly RotationWordStep[],
  hint: ConsRotationHint
): { text: string; tag: string }[] {
  const { characterKey: ck } = hint
  const seen = new Set<string>([wordsRotationText(baseSteps)])
  const out: { text: string; tag: string }[] = []
  const push = (nextSteps: RotationWordStep[], tag: string) => {
    const text = wordsRotationText(nextSteps)
    if (!seen.has(text)) {
      seen.add(text)
      out.push({ text, tag })
    }
  }
  const replaceStep = (idx: number, words: string[]) =>
    baseSteps.map((s, i) => (i === idx ? { ...s, words } : s))

  const memberStepIdxs = baseSteps
    .map((s, i) => (s.characterKey === ck && s.words.length > 0 ? i : -1))
    .filter((i) => i >= 0)
  if (!memberStepIdxs.length) return []

  if (hint.kind === 'chargeBeams' && hint.beams) {
    const target = `CA[beams=${hint.beams}]`
    // Replace all CA / CA[beams<target] across all of ck's steps
    let changed = false
    const allReplaced = baseSteps.map((s) => {
      if (s.characterKey !== ck || !s.words.length) return s
      const nextWords = s.words.map((w) => {
        if (!isChargeToken(w)) return w
        const m = /^CA\[beams=(\d+)\]$/i.exec(w)
        if (m && Number(m[1]) >= hint.beams!) return w
        changed = true
        return target
      })
      return { ...s, words: nextWords }
    })
    if (changed) push(allReplaced, target)
    // Also try replacing only the longest step's CAs if member has multiple visits
    if (memberStepIdxs.length > 1) {
      const longestIdx = memberStepIdxs.reduce((best, i) =>
        baseSteps[i].words.length > baseSteps[best].words.length ? i : best
      )
      const step = baseSteps[longestIdx]
      let stepChanged = false
      const nextWords = step.words.map((w) => {
        if (!isChargeToken(w)) return w
        const m = /^CA\[beams=(\d+)\]$/i.exec(w)
        if (m && Number(m[1]) >= hint.beams!) return w
        stepChanged = true
        return target
      })
      if (stepChanged) push(replaceStep(longestIdx, nextWords), target)
    }
    return out
  }

  if (hint.kind === 'burstResetSkill') {
    for (const idx of memberStepIdxs) {
      const words = baseSteps[idx].words
      const qIdx = words.findIndex(isBurstToken)
      if (qIdx < 0) continue
      const existingSkill = words.find(isSkillToken)
      const skillTok = existingSkill && /^tE$/i.test(existingSkill) ? 'tE' : 'E'
      // Insert right after Q (E Q -> E Q E)
      if (!isSkillToken(words[qIdx + 1] ?? '')) {
        const next = [
          ...words.slice(0, qIdx + 1),
          skillTok,
          ...words.slice(qIdx + 1),
        ]
        push(replaceStep(idx, next), `+${skillTok} after Q`)
      }
      // Also try appending at end of step (e.g. Kazuha tE P Q -> tE P Q tE P)
      if (ck === 'KaedeharaKazuha' && words.some((w) => /^[HL]?P$/i.test(w))) {
        const next = [...words, skillTok, 'P']
        push(replaceStep(idx, next), `+${skillTok} P`)
      }
    }
    return out
  }

  if (hint.kind === 'extraSkill') {
    // Prefer the step that already has the most skills (or first step with a skill)
    const skillSteps = memberStepIdxs.filter((i) =>
      baseSteps[i].words.some(isSkillToken)
    )
    const targetIdxs = skillSteps.length ? skillSteps : [memberStepIdxs[0]]
    for (const idx of targetIdxs) {
      const words = baseSteps[idx].words
      const skillIndices = words
        .map((w, j) => (isSkillToken(w) ? j : -1))
        .filter((j) => j >= 0)
      const skillTok = skillIndices.length ? words[skillIndices[0]] : 'E'

      if (ck === 'Vesna' && skillIndices.length >= 3) {
        // Vesna Armed for Action: C1 makes the first Lv. 3 E free and lifts cap from 3 -> 4.
        // Try inserting E after the 1st E after Q (e.g. E E E Q E -> E E E Q E E),
        // after the 3rd E (Lv. 3 entry), and after the last E.
        const qIdx = words.findIndex(isBurstToken)
        const postQSkill = skillIndices.find((j) => qIdx >= 0 && j > qIdx)
        const spots = [
          ...(postQSkill !== undefined ? [postQSkill + 1] : []),
          skillIndices[2] + 1,
          skillIndices[skillIndices.length - 1] + 1,
          ...(skillIndices.length >= 4 ? [skillIndices[3] + 1] : []),
        ]
        for (const pos of spots) {
          const next = [...words.slice(0, pos), 'E', ...words.slice(pos)]
          push(replaceStep(idx, next), '+E')
        }
        continue
      }

      if (ck === 'Xianyun' && skillIndices.length > 0) {
        const s0 = skillIndices[0]
        const nextWord = words[s0 + 1]
        if (nextWord && /^[HL]?P$/i.test(nextWord)) {
          // E P -> E P E P (and E E P)
          push(
            replaceStep(idx, [
              ...words.slice(0, s0 + 2),
              skillTok,
              nextWord,
              ...words.slice(s0 + 2),
            ]),
            `+${skillTok} ${nextWord}`
          )
        }
      }

      if (skillIndices.length > 0) {
        const s0 = skillIndices[0]
        // Insert immediately after first E: E Q -> E E Q
        push(
          replaceStep(idx, [
            ...words.slice(0, s0 + 1),
            skillTok,
            ...words.slice(s0 + 1),
          ]),
          `+${skillTok}`
        )
        // Also try inserting after Q if Q exists (E Q -> E Q E)
        const qIdx = words.findIndex(isBurstToken)
        if (qIdx >= 0 && qIdx + 1 !== s0 + 1) {
          push(
            replaceStep(idx, [
              ...words.slice(0, qIdx + 1),
              skillTok,
              ...words.slice(qIdx + 1),
            ]),
            `+${skillTok} after Q`
          )
        }
        // Also try inserting after the last E if there are multiple E casts
        const sLast = skillIndices[skillIndices.length - 1]
        if (sLast !== s0) {
          push(
            replaceStep(idx, [
              ...words.slice(0, sLast + 1),
              skillTok,
              ...words.slice(sLast + 1),
            ]),
            `+${skillTok}`
          )
        }
      } else {
        push(replaceStep(idx, [skillTok, ...words]), `+${skillTok}`)
      }
    }
  }

  return out.slice(0, 6)
}

/**
 * Generate (and optionally simulate-verify) deterministic candidate rotations for a
 * rotation-changing constellation (e.g. Vesna C1 +E, Yelan/Shenhe/Xianyun/Xiao C1 +E,
 * Kazuha C1 E Q E, Sandrone C1 CA[beams=6]).
 */
export function suggestConstellationRotations(
  baseText: string,
  names: readonly RotationMember[],
  characterKey: CharacterKey,
  cons: number,
  simContext?: SuggestSimContext
): ConsRotationSuggestion[] {
  if (!baseText.trim()) return []
  const hint = constellationHintOf(characterKey, cons)
  if (!hint || !isAutoAdaptableHint(hint)) return []
  const baseSteps = rotationWords(baseText, names)
  if (!baseSteps.length) return []

  const raw = generateRawCandidates(baseSteps, hint)
  if (!raw.length) return []

  if (!simContext) {
    return raw.slice(0, 3).map(({ text, tag }) => ({
      text,
      tag,
      diff: stepDiffSummary(baseText, text, names, characterKey),
    }))
  }

  const elements = Object.fromEntries(
    simContext.members.map((m) => [m, getCharEle(m) as HitElement])
  ) as Partial<Record<CharacterKey, HitElement>>
  const constellations = {
    ...simContext.constellations,
    [characterKey]: cons,
  }
  const simOf = (text: string) => {
    const parsed = parseRotation(text, names)
    if (!parsed?.steps?.length || parsed.warnings?.length) return undefined
    return simulateRotation({
      rotation: parsed,
      members: [...simContext.members],
      elements,
      constellations,
      repeats: 2,
      keep: 'middle',
      swapFrames: simContext.timing?.swapFrames,
      frameData: simContext.frameData,
    })
  }

  let baseSim: ReturnType<typeof simOf>
  try {
    baseSim = simOf(baseText)
  } catch {
    baseSim = undefined
  }
  if (!baseSim?.frames) {
    return raw.slice(0, 3).map(({ text, tag }) => ({
      text,
      tag,
      diff: stepDiffSummary(baseText, text, names, characterKey),
    }))
  }

  const baseWarns = new Set(baseSim.warnings)
  const baseHits = baseSim.hits.filter(
    (h) => h.characterKey === characterKey && !h.path[0].startsWith('_')
  ).length
  const baseStallFrames = Object.values(baseSim.stalls ?? {}).reduce(
    (sum, frames) => sum + frames,
    0
  )

  const verified: (ConsRotationSuggestion & { score: number })[] = []
  for (const cand of raw) {
    let sim: ReturnType<typeof simOf>
    try {
      sim = simOf(cand.text)
    } catch {
      continue
    }
    if (!sim?.frames) continue
    // Reject candidates that introduce new simulation errors/warnings
    const hasNewWarn = sim.warnings.some((w) => !baseWarns.has(w))
    if (hasNewWarn) continue
    const stallFrames = Object.values(sim.stalls ?? {}).reduce(
      (sum, frames) => sum + frames,
      0
    )
    // Reject if adding the extra action introduced a significant cooldown stall (> 1.5 s)
    if (stallFrames - baseStallFrames > 90) continue
    const ckHits = sim.hits.filter(
      (h) => h.characterKey === characterKey && !h.path[0].startsWith('_')
    ).length
    const extraHits = ckHits - baseHits
    if (extraHits <= 0) continue

    verified.push({
      text: cand.text,
      tag: cand.tag,
      diff: stepDiffSummary(baseText, cand.text, names, characterKey),
      rotationTime: Math.round((sim.frames / FPS) * 10) / 10,
      extraHits,
      score: extraHits / (sim.frames / FPS) - (stallFrames / FPS) * 0.5,
    })
  }

  verified.sort((a, b) => b.score - a.score)
  return verified.slice(0, 3).map(({ score: _s, ...rest }) => rest)
}

/**
 * Automatically compose independent per-member constellation rotations for a multi-member
 * investment path (e.g. Vesna C1 + Yelan C1): when each custom rotation only modified its own
 * member's step(s) while preserving the base step skeleton, all edits merge cleanly.
 */
export function mergeMemberRotations(
  baseText: string,
  edits: readonly {
    characterKey: CharacterKey
    text: string
    label: string
    isAuto?: boolean
  }[],
  names: readonly RotationMember[]
): { text: string; label: string; isAuto: boolean } | undefined {
  if (!edits.length) return undefined
  if (edits.length === 1)
    return {
      text: edits[0].text,
      label: edits[0].label,
      isAuto: !!edits[0].isAuto,
    }

  const baseSteps = rotationWords(baseText, names)
  if (!baseSteps.length)
    return {
      text: edits[0].text,
      label: edits[0].label,
      isAuto: !!edits[0].isAuto,
    }

  const sameSkeleton = (steps: readonly RotationWordStep[]) =>
    steps.length === baseSteps.length &&
    steps.every((s, i) => s.characterKey === baseSteps[i].characterKey)

  const disjoint: {
    characterKey: CharacterKey
    steps: RotationWordStep[]
    label: string
    isAuto: boolean
  }[] = []
  for (const edit of edits) {
    const steps = rotationWords(edit.text, names)
    if (!sameSkeleton(steps)) continue
    const onlyOwnChanged = steps.every(
      (s, i) =>
        s.characterKey === edit.characterKey ||
        s.words.join(' ') === baseSteps[i].words.join(' ')
    )
    if (onlyOwnChanged)
      disjoint.push({
        characterKey: edit.characterKey,
        steps,
        label: edit.label,
        isAuto: !!edit.isAuto,
      })
  }

  if (disjoint.length >= 2) {
    const merged = baseSteps.map((s) => ({ ...s, words: [...s.words] }))
    for (const d of disjoint) {
      for (let i = 0; i < merged.length; i++) {
        if (merged[i].characterKey === d.characterKey)
          merged[i].words = [...d.steps[i].words]
      }
    }
    const labels = disjoint.map((d) =>
      d.label.replace(/\s+rot$/i, '').replace(/^Auto\s+/i, '')
    )
    const allAuto = disjoint.every((d) => d.isAuto)
    return {
      text: wordsRotationText(merged),
      label: `${allAuto ? 'Auto ' : ''}${labels.join(' + ')} rot`,
      isAuto: allAuto,
    }
  }

  return {
    text: edits[0].text,
    label: edits[0].label,
    isAuto: !!edits[0].isAuto,
  }
}

export interface FoundConsRotation {
  text: string
  dps: number
  estimate: number
  gainPct: number
  time: number
  er: Partial<Record<CharacterKey, number>>
  diff: string
  warnings: string[]
}

/**
 * Fast, single-member 2-round rotation search at `targetCons`: mutates ONLY `characterKey`'s
 * steps (never reorders teammates or deletes their Bursts) using the team's real `rotationScorer`
 * and ER pricing so complex combo constellations (Flins C1, Varka C1/C6, Wriothesley C1,
 * Vesna C6, Furina C6, etc.) can discover an optimal rotation in ~1-2 s.
 */
export async function findBestConstellationRotations({
  baseText,
  names,
  characterKey,
  targetCons,
  baseConstellations,
  score,
  erPrices,
  funded,
  erSlack = 25,
  maxMs = 2400,
  isCancelled = () => false,
  onProgress,
}: {
  baseText: string
  names: readonly RotationMember[]
  characterKey: CharacterKey
  targetCons: number
  baseConstellations: Partial<Record<CharacterKey, number>>
  score: (text: string) => RotationScore | undefined
  erPrices?: Partial<Record<CharacterKey, ErPrice>>
  funded?: Partial<Record<CharacterKey, number>>
  erSlack?: number
  maxMs?: number
  isCancelled?: () => boolean
  onProgress?: (played: number, bestGainPct: number) => void
}): Promise<{
  baseScore?: RotationScore
  candidates: FoundConsRotation[]
}> {
  const seedSteps = rotationWords(baseText, names)
  if (!seedSteps.length) return { candidates: [] }
  const seedText = wordsRotationText(seedSteps)
  const baseScore = score(seedText)
  if (!baseScore || baseScore.dps <= 0) return { baseScore, candidates: [] }

  const consMap = { ...baseConstellations, [characterKey]: targetCons }
  const fullVocab = rotationVocabulary(seedSteps, consMap)
  // Restrict edits exclusively to `characterKey`'s own step(s)
  const memberOnlySteps = (steps: readonly RotationWordStep[]) => {
    const edits = rotationEdits(
      steps,
      { [characterKey]: fullVocab[characterKey] ?? [] },
      { order: false, visits: false, attacks: true, actions: true }
    )
    // Keep only edits that changed `characterKey` and left all other members untouched
    return edits.filter((e) => {
      if (e.length !== steps.length) return false
      let ckChanged = false
      for (let i = 0; i < steps.length; i++) {
        if (e[i].characterKey !== steps[i].characterKey) return false
        const same = e[i].words.join(' ') === steps[i].words.join(' ')
        if (steps[i].characterKey === characterKey) {
          if (!same) ckChanged = true
        } else if (!same) {
          return false
        }
      }
      return ckChanged
    })
  }

  const fits = energyFits(baseScore, erSlack, funded)
  const baseWarns = new Set(baseScore.warnings)
  const erCost = erPrices ? erCostOf(erPrices) : undefined
  const baseErCost = erCost ? erCost(baseScore, baseScore) : 0
  const estimateOf = (s: RotationScore) =>
    erCost ? s.dps - (erCost(s, baseScore) - baseErCost) : s.dps
  const baseEst = estimateOf(baseScore)

  const seen = new Set<string>([seedText])
  const winners: FoundConsRotation[] = []
  let played = 0
  let bestGainPct = 0
  const deadline = Date.now() + maxMs

  const evaluateBatch = async (texts: string[], limit: number) => {
    const batchWinners: { steps: RotationWordStep[]; estimate: number }[] = []
    let count = 0
    for (const text of texts) {
      if (count >= limit || isCancelled() || Date.now() > deadline) break
      if (seen.has(text)) continue
      seen.add(text)
      count++
      played++
      if (played % 2 === 0) {
        onProgress?.(played, bestGainPct)
        await yieldTask()
        if (isCancelled() || Date.now() > deadline) break
      }
      let s: RotationScore | undefined
      try {
        s = score(text)
      } catch {
        continue
      }
      if (!s || s.dps <= 0) continue
      if (s.warnings.some((w) => !baseWarns.has(w))) continue
      if (!fits(s)) continue
      const estimate = estimateOf(s)
      const gainPct = baseEst > 0 ? estimate / baseEst - 1 : 0
      if (gainPct > 0.002) {
        if (gainPct > bestGainPct) bestGainPct = gainPct
        winners.push({
          text,
          dps: s.dps,
          estimate,
          gainPct,
          time: s.time,
          er: s.er,
          diff: stepDiffSummary(baseText, text, names, characterKey),
          warnings: s.warnings,
        })
        batchWinners.push({ steps: rotationWords(text, names), estimate })
      }
    }
    onProgress?.(played, bestGainPct)
    batchWinners.sort((a, b) => b.estimate - a.estimate)
    return batchWinners
  }

  // Round 1: deterministic kit suggestions first + single-member mutations
  const detSuggestions = suggestConstellationRotations(
    baseText,
    names,
    characterKey,
    targetCons
  ).map((s) => s.text)
  const r1Edits = memberOnlySteps(seedSteps).map(wordsRotationText)
  const r1Pool = [...detSuggestions, ...r1Edits]
  const r1Best = await evaluateBatch(r1Pool, 36)

  // Round 2: expand top 3 winners by 1 more edit (discovers 2-token combos like Flins C1 `E Q`)
  if (!isCancelled() && Date.now() < deadline) {
    const seeds = r1Best.length
      ? r1Best.slice(0, 3)
      : [{ steps: seedSteps, estimate: baseEst }]
    const r2Pool: string[] = []
    for (const s of seeds) {
      for (const next of memberOnlySteps(s.steps))
        r2Pool.push(wordsRotationText(next))
    }
    await evaluateBatch(r2Pool, 28)
  }

  winners.sort((a, b) => b.estimate - a.estimate)
  return { baseScore, candidates: winners.slice(0, 3) }
}
