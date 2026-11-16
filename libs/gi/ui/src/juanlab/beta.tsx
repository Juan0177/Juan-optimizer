// juanlab-beta: contenuti della beta aggiunti dal fork (dati generati da libs/gi/dm/juanlab-beta), con l'avviso
// "dati provvisori" mostrato sulle loro schede. Quando l'originale li aggiunge, si tolgono da qui e dal resto.
import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { Alert } from '@mui/material'
import { useTranslation } from 'react-i18next'

export const juanlabBeta = {
  label: '7.3',
  source: 'Nanoka 7.2.52',
  characters: ['Danica', 'Anastasya'] as CharacterKey[],
  weapons: ['TorrentsOfSpring', 'Silverdawn', 'BlazingLionfang'] as WeaponKey[],
  artifacts: ['EpochalAdvent', 'EmpyreanSojourn'] as ArtifactSetKey[],
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
