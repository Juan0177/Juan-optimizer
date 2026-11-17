import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TFunction } from 'i18next'

/** What can go wrong in a comparison once its checks passed (each has a `kqmCompare.error.*` text) */
export type CompareFailureCode =
  | 'noTeam'
  | 'otherMembers'
  | 'noSettings'
  | 'notPlayable'
  | 'noResult'
  | 'buildChanged'

/**
 * A comparison that could not be worked out, for a known reason: its `code` says it in the user's
 * language (`compareFailureText`); the message is for the console
 */
export class CompareSwapFailure extends Error {
  constructor(
    readonly code: CompareFailureCode,
    message: string,
    /** The member it is about, if any */
    readonly characterKey?: CharacterKey
  ) {
    super(message)
    this.name = 'CompareSwapFailure'
  }
}

/** A thrown error as the page says it: a known failure in the user's language */
export function compareFailureText(
  e: unknown,
  t: TFunction,
  nameOf: (key: CharacterKey) => string
): string {
  if (e instanceof CompareSwapFailure)
    return t(`kqmCompare.error.${e.code}`, {
      name: e.characterKey ? nameOf(e.characterKey) : '',
    })
  return t('kqmCompare.error.failed', {
    message: String((e as Error)?.message ?? e),
  })
}
