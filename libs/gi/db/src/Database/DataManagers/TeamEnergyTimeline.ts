import {
  allCharacterKeys,
  allElementKeys,
  allWeaponKeys,
} from '@genshin-optimizer/gi/consts'
import { z } from 'zod'

const character = z.enum(allCharacterKeys)
const frame = z.number().nonnegative()
const amount = z.number()
const event = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('particle'),
    frame,
    amount: amount.nonnegative(),
    catcher: character,
    element: z.enum(allElementKeys).optional(),
    variance: amount.min(0).max(1).optional(),
  }),
  z.object({
    kind: z.literal('flat'),
    frame,
    amount,
    character,
    giver: character.optional(),
  }),
  z.object({
    kind: z.literal('burst'),
    frame,
    amount: amount.nonnegative(),
    character,
    drainDelay: frame.optional(),
  }),
  z.object({ kind: z.literal('favonius'), frame, character }),
  z.object({
    kind: z.literal('weapon'),
    frame,
    character,
    weapon: z.enum(allWeaponKeys),
  }),
  z.object({ kind: z.literal('resonance'), frame, catcher: character }),
  z.object({ kind: z.literal('nightsoul'), frame }),
])
export const energyTraceSchema = z.object({
  members: z.array(character),
  frames: frame.positive(),
  repeat: z.boolean(),
  active: z.array(z.object({ frame, character })),
  events: z.array(event),
  /** Optional casts whose default cadence has yet to be replayed. */
  pendingOptional: z.array(character).optional(),
  /** Burst cadence used to play the repeating rotation. */
  cadence: z.partialRecord(character, z.number().nonnegative()).optional(),
  /** A whole steady run: the frame its counted rotations start (late arrivals kept past the end). */
  countedFrom: frame.optional(),
})
export const energyTimelineSchema = z.object({
  rotation: energyTraceSchema.optional(),
  opening: energyTraceSchema.optional(),
})
export type TeamEnergyEvent = z.infer<typeof event>
export type TeamEnergyTrace = z.infer<typeof energyTraceSchema>
export type TeamEnergyTimeline = z.infer<typeof energyTimelineSchema>
