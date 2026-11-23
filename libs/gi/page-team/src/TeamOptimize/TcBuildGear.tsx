import { artifactAsset } from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type {
  BuildTc,
  ICachedArtifact,
  ICachedWeapon,
} from '@genshin-optimizer/gi/db'
import {
  ArtifactCardPico,
  ArtifactSetName,
  ArtifactSetTooltip,
  WeaponName,
} from '@genshin-optimizer/gi/ui'
import { Box, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { WeaponThumb } from './TeamOptResults'
import { numSx, type } from './ui'

/**
 * A theorycraft build's pieces as artifacts to show: each slot's rarity, level and main stat, its
 * set from the build's sets in slot order (4 + the off-piece, or 2 + 2 + the off-piece, which
 * shows the first set)
 */
export function tcPieces(
  artifact: BuildTc['artifact']
): Record<ArtifactSlotKey, ICachedArtifact> {
  const order = (Object.entries(artifact.sets) as [ArtifactSetKey, number][])
    .sort(([, a], [, b]) => b - a)
    .flatMap(([key, n]) => Array<ArtifactSetKey>(n).fill(key))
  return Object.fromEntries(
    allArtifactSlotKeys.map((slotKey, i) => {
      const { rarity, level, statKey } = artifact.slots[slotKey]
      return [
        slotKey,
        {
          id: `tc:${slotKey}`,
          setKey: order[i] ?? order[0],
          slotKey,
          rarity,
          level,
          mainStatKey: statKey,
          substats: [],
          unactivatedSubstats: [],
          location: '',
          lock: false,
        } as unknown as ICachedArtifact,
      ]
    })
  ) as Record<ArtifactSlotKey, ICachedArtifact>
}

/**
 * A theorycraft build laid out as Team optimize's result cards show a member's gear: its five
 * pieces (set, level, main stat), its weapon, its sets. Pieces without a set show none.
 */
export function TcBuildGear({
  buildTc,
}: {
  buildTc: Pick<BuildTc, 'artifact' | 'weapon'>
}) {
  const { t } = useTranslation('page_team')
  const sets = (
    Object.entries(buildTc.artifact.sets) as [ArtifactSetKey, number][]
  ).filter(([, n]) => n >= 2)
  const pieces = sets.length ? tcPieces(buildTc.artifact) : undefined
  const weapon = {
    id: 'tc:weapon',
    ...buildTc.weapon,
    location: '',
    lock: false,
  } as ICachedWeapon
  return (
    <>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
          gap: 0.5,
        }}
      >
        {allArtifactSlotKeys.map((slotKey) => (
          <ArtifactCardPico
            key={slotKey}
            artifactObj={pieces?.[slotKey]}
            slotKey={slotKey}
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}
        >
          <WeaponThumb weapon={weapon} highlight={false} />
          <Box sx={{ minWidth: 0 }}>
            <Typography
              sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35 }}
              noWrap
            >
              <WeaponName weaponKey={weapon.key} />
            </Typography>
            <Typography
              sx={{
                ...type.label,
                ...numSx,
                fontWeight: 400,
                lineHeight: 1.35,
              }}
            >
              {t('teamOpt.weapons.levelRef', {
                defaultValue: 'Lv. {{level}} · R{{refinement}}',
                level: weapon.level,
                refinement: weapon.refinement,
              })}
            </Typography>
          </Box>
        </Box>
        {sets.map(([setKey, n]) => (
          <ArtifactSetTooltip key={setKey} setKey={setKey} numInSet={n}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                alignSelf: 'flex-start',
                maxWidth: '100%',
                cursor: 'default',
              }}
            >
              <Box
                component="img"
                src={artifactAsset(setKey, 'flower')}
                alt=""
                sx={{ width: 18, height: 18, flexShrink: 0 }}
              />
              <Typography
                sx={{ ...type.label, fontWeight: 400, ...numSx }}
                noWrap
              >
                {n >= 4 ? 4 : 2}× <ArtifactSetName setKey={setKey} />
              </Typography>
            </Box>
          </ArtifactSetTooltip>
        ))}
      </Box>
    </>
  )
}
