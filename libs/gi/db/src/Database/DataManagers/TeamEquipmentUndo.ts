import {
  allArtifactSlotKeys,
  allLocationCharacterKeys,
} from '@genshin-optimizer/gi/consts'
import { z } from 'zod'

const location = z.union([z.literal(''), z.enum(allLocationCharacterKeys)])
const gearChange = z.object({ before: location, after: location })
const buildGear = z.object({
  artifactIds: z.record(z.enum(allArtifactSlotKeys), z.string().optional()),
  weaponId: z.string().optional(),
})

export const teamEquipmentUndoSchema = z.object({
  artifacts: z.record(z.string(), gearChange),
  weapons: z.record(z.string(), gearChange),
  builds: z.record(
    z.string(),
    z.object({ before: buildGear, after: buildGear })
  ),
  /** The saved build each member was on before Equip switched it to its equipped build */
  loadouts: z.record(z.string(), z.string()).optional(),
})
export type TeamEquipmentUndo = z.infer<typeof teamEquipmentUndoSchema>
