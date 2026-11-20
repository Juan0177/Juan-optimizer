import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { useTranslation } from 'react-i18next'
import { CharacterName } from './Trans'

/**
 * The number of a loadout still named as the app named it (`RaidenShogun Loadout`: 0,
 * `RaidenShogun Loadout 2`: 2); undefined once the user renamed it
 */
export function defaultLoadoutNumber(name: string, characterKey: CharacterKey) {
  const prefix = `${characterKey} Loadout`
  if (name === prefix) return 0
  const rest = name.startsWith(`${prefix} `)
    ? name.slice(prefix.length + 1)
    : ''
  return /^\d+$/.test(rest) ? Number(rest) : undefined
}

/** A loadout's name: one the app gave it reads with the character's name, not its key */
export function LoadoutName({
  name,
  characterKey,
}: {
  name: string
  characterKey: CharacterKey
}) {
  const { t } = useTranslation('page_teams')
  const { gender } = useDBMeta()
  const number = defaultLoadoutNumber(name, characterKey)
  if (number === undefined) return name
  return (
    <>
      <CharacterName characterKey={characterKey} gender={gender} />{' '}
      {t('card.loadout', 'Loadout')}
      {number ? ` ${number}` : ''}
    </>
  )
}
