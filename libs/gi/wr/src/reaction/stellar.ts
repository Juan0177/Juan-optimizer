import type {
  MainStatKey,
  StellarReactionKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { input } from '../formula'
import type { Data, NumNode } from '../type'
import { infoMut, one, sum } from '../utils'
import { transMulti1 } from './multi'
import { specialReactionDmgNode } from './special'

export type StellarVariants = {
  stellarconduct: 'electro' | 'cryo'
  stellarswirl: 'anemo' | 'cryo'
}
export function stellarDmgNode<Variant extends StellarReactionKey>(
  multiplier: NumNode,
  base: 'reaction' | MainStatKey | SubstatKey,
  variant: Variant,
  eleVariant: StellarVariants[Variant],
  additional: Data = {},
  specialMultiplier?: NumNode
) {
  // Stellar Swirl's base reaction multiplier is raised by points (Anastasya A4: 300% + 10%, the
  // game's `StarSwirlDamageFactorDelta`), and it scales flat additions too
  const swirlReaction = base === 'reaction' && variant === 'stellarswirl'
  const coefficient = swirlReaction
    ? sum(multiplier, input.total.stellarswirl_mult_)
    : multiplier
  const node = specialReactionDmgNode(
    coefficient,
    base,
    variant,
    additional,
    stellarDmgMultiplier(base, variant),
    specialMultiplier,
    eleVariant,
    swirlReaction ? coefficient : one
  )
  if (eleVariant === 'cryo') {
    return infoMut(node, { subVariant: 'cryo' })
  } else return node
}

function stellarDmgMultiplier(
  base: 'reaction' | MainStatKey | SubstatKey,
  variant: StellarReactionKey
) {
  if (base === 'reaction') return transMulti1
  // (a direct hit's multiplier is 100%: the same points are added to it)
  switch (variant) {
    case 'stellarconduct':
      return sum(one, input.total[`${variant}_mult_`])
    case 'stellarswirl':
      return sum(one, input.total[`${variant}_mult_`])
  }
}
