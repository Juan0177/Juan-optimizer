import type { ArtifactSlotKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type { ArtSetExclusion, ICachedArtifact } from '@genshin-optimizer/gi/db'
import { meetsSetRules } from '@genshin-optimizer/gi/ui'

/** Whether replacing one slot keeps the equipped build within its set rules. */
export function setRulesPredicate(
  equippedArts: Record<ArtifactSlotKey, ICachedArtifact | undefined>,
  exclusion: ArtSetExclusion
) {
  return (replacement: Pick<ICachedArtifact, 'slotKey' | 'setKey'>) =>
    meetsSetRules(
      allArtifactSlotKeys.flatMap((slotKey) => {
        const art =
          slotKey === replacement.slotKey ? replacement : equippedArts[slotKey]
        return art ? [art] : []
      }),
      exclusion
    )
}
