import type {
  ArtifactSlotKey,
  MainSubStatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  allSubstatKeys,
} from '@genshin-optimizer/gi/consts'
import type { ICachedArtifact } from '@genshin-optimizer/gi/db'
import {
  KQM_FIXED_ROLLS,
  KQM_FOUR_STAR_ROLLS_LESS,
  KQM_FOUR_STAR_SCALE,
  KQM_PIECE_CAP,
  KQM_ROLLS,
  KQM_SUBSTAT_ROLLS,
  KQM_TIERS,
} from '@genshin-optimizer/gi/solver'

type ArtifactForBenchmark = Pick<ICachedArtifact, 'mainStatKey' | 'rarity'> & {
  substats: readonly Pick<
    ICachedArtifact['substats'][number],
    'key' | 'accurateValue'
  >[]
}

/** Equipped values and benchmark budgets in equivalent average 5★ substat rolls. */
export function artifactBenchmarks(
  artifacts: Record<ArtifactSlotKey, ArtifactForBenchmark | undefined>,
  scalesWith: ReadonlySet<MainSubStatKey>
) {
  const useful = allSubstatKeys.filter((key) => scalesWith.has(key))
  const pieces = allArtifactSlotKeys.map((slot) => artifacts[slot])
  const equipped = pieces.filter(Boolean).length
  const rolls = pieces.reduce(
    (total, art) =>
      total +
      (art?.substats.reduce(
        (sum, { key, accurateValue }) =>
          key && scalesWith.has(key)
            ? sum +
              accurateValue /
                (KQM_SUBSTAT_ROLLS[key] * (key.endsWith('_') ? 100 : 1))
            : sum,
        0
      ) ?? 0),
    0
  )
  const slots = pieces.map((art, i) => ({
    eligible: useful.filter(
      (key) =>
        key !==
        (art?.mainStatKey ?? (i === 0 ? 'hp' : i === 1 ? 'atk' : undefined))
    ).length,
    fourStar: art?.rarity === 4,
  }))
  const four = slots.filter((slot) => slot.fourStar).length
  const subScale =
    (slots.length - four * (1 - KQM_FOUR_STAR_SCALE)) / slots.length
  const capacity = slots.reduce(
    (sum, { eligible }) => sum + eligible * KQM_PIECE_CAP,
    0
  )
  const kqms =
    (useful.length * KQM_FIXED_ROLLS +
      Math.min(capacity, KQM_ROLLS - four * KQM_FOUR_STAR_ROLLS_LESS)) *
    subScale
  const benchmarks = (['kqms', 'good', 'great'] as const).map((standard) => {
    if (standard === 'kqms') return { standard, baseline: kqms }
    const tier = KQM_TIERS[standard]
    const baseline = slots.reduce((sum, { eligible, fourStar }) => {
      if (!eligible) return sum
      const upgrades =
        tier.pieceRolls - 4 - (fourStar ? KQM_FOUR_STAR_ROLLS_LESS : 0)
      const usefulRolls =
        Math.min(eligible, tier.lines) + Math.min(upgrades, tier.ups)
      return sum + usefulRolls * (fourStar ? KQM_FOUR_STAR_SCALE : 1)
    }, 0)
    return { standard, baseline }
  })
  return { equipped, useful, rolls, benchmarks }
}
