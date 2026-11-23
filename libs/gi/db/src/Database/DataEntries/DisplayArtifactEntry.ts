import {
  zodEnumWithDefault,
  zodFilteredArray,
  zodObjectSchema,
} from '@genshin-optimizer/common/database'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import type { IGOOD } from '@genshin-optimizer/gi/good'
import {
  artifactSortKeys,
  filterOptionSchema,
  initialFilterOption,
} from '@genshin-optimizer/gi/schema'
import { z } from 'zod'
import type { ArtCharDatabase } from '../ArtCharDatabase'
import { DataEntry } from '../DataEntry'
import type { IGO, ImportResult } from '../exim'

const displayArtifactSchema = z.object({
  filterOption: zodObjectSchema(filterOptionSchema),
  ascending: z.boolean().catch(false),
  sortType: zodEnumWithDefault(artifactSortKeys, 'rarity'),
  effFilter: zodFilteredArray(allSubstatKeys, [...allSubstatKeys]),
})
export type IDisplayArtifact = z.infer<typeof displayArtifactSchema>

export class DisplayArtifactEntry extends DataEntry<
  'display_artifact',
  'display_artifact',
  IDisplayArtifact,
  IDisplayArtifact
> {
  constructor(database: ArtCharDatabase) {
    super(
      database,
      'display_artifact',
      () => displayArtifactSchema.parse({}),
      'display_artifact'
    )
  }
  override validate(obj: unknown): IDisplayArtifact | undefined {
    const result = displayArtifactSchema.safeParse(obj)
    return result.success ? result.data : undefined
  }
  // An import keeps the sort but not the filters: a GO export carries its own, which could hide
  // the imported artifacts here
  override importGOOD(go: IGO & IGOOD, result: ImportResult) {
    super.importGOOD(go, result)
    this.set({ action: 'reset' })
  }
  override set(
    value:
      | Partial<IDisplayArtifact>
      | ((v: IDisplayArtifact) => Partial<IDisplayArtifact> | undefined)
      | { action: 'reset' }
  ): boolean {
    if ('action' in value) {
      if (value.action === 'reset')
        return super.set({ filterOption: initialFilterOption() })
      return false
    } else return super.set(value)
  }
}
