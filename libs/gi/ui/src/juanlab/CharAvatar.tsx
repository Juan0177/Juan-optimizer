// juanlab: icona laterale del personaggio che sta dentro schede e pulsanti (quella di GO sporge di quasi due righe
// verso l'alto e nelle schede basse di Stellar Optimizer veniva tagliata). Sporge solo un poco in alto, come in GO,
// dentro lo spazio lasciato dal contenitore.
import { characterAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { Box } from '@mui/material'

export function CharAvatarSide({
  characterKey,
  size = 36,
}: {
  characterKey: CharacterKey
  size?: number
}) {
  const { gender } = useDBMeta()
  return (
    <Box
      component="img"
      src={characterAsset(characterKey, 'iconSide', gender)}
      alt=""
      sx={{
        width: size,
        height: size,
        mt: `${-Math.round(size * 0.3)}px`,
        mb: `${-Math.round(size * 0.05)}px`,
        flexShrink: 0,
        objectFit: 'contain',
        display: 'block',
      }}
    />
  )
}
