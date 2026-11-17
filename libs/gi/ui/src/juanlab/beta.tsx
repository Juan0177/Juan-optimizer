// juanlab-beta: avviso "dati provvisori" sulle schede dei personaggi della beta. I contenuti della beta vengono da
// Stellar Optimizer (apps/frontend/beta-content.json, dal dump della beta): l'elenco dei personaggi si legge da li.
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { Alert } from '@mui/material'
import { useTranslation } from 'react-i18next'

export const juanlabBeta = {
  label: '7.3',
  source: 'Stellar Optimizer',
  characters: ['Danica', 'Anastasya'] as CharacterKey[],
  weapons: ['TorrentsOfSpring', 'Silverdawn'] as WeaponKey[],
  artifacts: [
    'LegacyOfTheFirstChronicle',
    'PreludeOfTheKingfisherCanopy',
  ] as ArtifactSetKey[],
}

export const isBetaCharacter = (key: CharacterKey) =>
  juanlabBeta.characters.includes(key)

/** Avviso sulle schede dei personaggi della beta. */
export function BetaNotice({ characterKey }: { characterKey: CharacterKey }) {
  const { t } = useTranslation('juanlab')
  if (!isBetaCharacter(characterKey)) return null
  return (
    <Alert severity="warning" variant="outlined" sx={{ my: 1 }}>
      {t('beta.notice', {
        label: juanlabBeta.label,
        source: juanlabBeta.source,
      })}
    </Alert>
  )
}
