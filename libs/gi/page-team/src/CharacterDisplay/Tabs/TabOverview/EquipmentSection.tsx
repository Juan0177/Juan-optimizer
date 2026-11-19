import { CardThemed } from '@genshin-optimizer/common/ui'
import { objKeyMap } from '@genshin-optimizer/common/util'
import {
  allArtifactSlotKeys,
  charKeyToLocCharKey,
} from '@genshin-optimizer/gi/consts'
import {
  CharacterContext,
  TeamCharacterContext,
  useDatabase,
} from '@genshin-optimizer/gi/db-ui'
import { dataSetEffects } from '@genshin-optimizer/gi/sheets'
import { getCharStat } from '@genshin-optimizer/gi/stats'
import {
  BuildEditContext,
  DataContext,
  DocumentDisplay,
  EquippedGrid,
  SetEffectDisplay,
} from '@genshin-optimizer/gi/ui'
import { uiInput as input } from '@genshin-optimizer/gi/wr'
import {
  Box,
  Button,
  Grid,
  Stack,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

export default function EquipmentSection() {
  const database = useDatabase()
  const {
    character: { key: characterKey },
  } = useContext(CharacterContext)
  const {
    loadoutDatum: { buildType, buildId },
  } = useContext(TeamCharacterContext)
  const loadoutEquip = buildId && buildType === 'real'
  const { teamData, data } = useContext(DataContext)
  const weaponSheet = teamData[characterKey]?.weaponSheet

  const theme = useTheme()
  const breakpoint = useMediaQuery(theme.breakpoints.up('lg'))

  const weaponDoc = useMemo(
    () =>
      weaponSheet &&
      weaponSheet.document.length > 0 && (
        // (no frame when the weapon has nothing to show, as a weapon without a passive)
        <CardThemed
          bgt="light"
          sx={{ '&:has(> .weapon-doc:empty)': { display: 'none' } }}
        >
          <Box className="weapon-doc" p={1}>
            <DocumentDisplay sections={weaponSheet.document} />
          </Box>
        </CardThemed>
      ),
    [weaponSheet]
  )

  const weaponTypeKey = getCharStat(characterKey).weaponType
  const weaponId = data.get(input.weapon.id).value
  const artifactIds = useMemo(
    () =>
      objKeyMap(
        allArtifactSlotKeys,
        (slotKey) => data.get(input.art[slotKey].id).value
      ),
    [data]
  )

  const editBuildId = buildType === 'equipped' ? 'equipped' : buildId

  return (
    <Box>
      <Grid container spacing={1}>
        {breakpoint && (
          <Grid
            item
            xs={12}
            md={12}
            lg={3}
            xl={3}
            sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
          >
            {weaponDoc && weaponDoc}
            <ArtifactSectionCard />
          </Grid>
        )}
        <Grid item xs={12} md={12} lg={9} xl={9}>
          <BuildEditContext.Provider value={editBuildId}>
            <EquippedGrid
              weaponTypeKey={weaponTypeKey}
              weaponId={weaponId}
              artifactIds={artifactIds}
              setWeapon={(id) => {
                if (loadoutEquip) database.builds.set(buildId, { weaponId: id })
                else
                  database.weapons.set(id, {
                    location: charKeyToLocCharKey(characterKey),
                  })
              }}
              setArtifact={(slotKey, id) => {
                if (loadoutEquip)
                  database.builds.set(buildId, (build) => {
                    build.artifactIds[slotKey] = id ? id : undefined
                  })
                else
                  id
                    ? database.arts.set(id, {
                        location: charKeyToLocCharKey(characterKey),
                      })
                    : artifactIds[slotKey] &&
                      database.arts.set(artifactIds[slotKey], { location: '' })
              }}
            />
          </BuildEditContext.Provider>
        </Grid>
        {!breakpoint && (
          <Grid item xs={12} md={12} xl={3} container spacing={1}>
            {weaponDoc && (
              <Grid item xs={12} md={6} lg={4}>
                {weaponDoc}
              </Grid>
            )}
            <Grid
              item
              xs={12}
              md={6}
              lg={4}
              sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}
            >
              <ArtifactSectionCard />
            </Grid>
          </Grid>
        )}
      </Grid>
    </Box>
  )
}
function ArtifactSectionCard() {
  const { t } = useTranslation(['page_character', 'artifact'])
  const database = useDatabase()
  const {
    character: { equippedArtifacts },
  } = useContext(CharacterContext)
  const {
    loadoutDatum: { buildType, buildId },
  } = useContext(TeamCharacterContext)
  const { data } = useContext(DataContext)
  const hasEquipped = !!Object.values(equippedArtifacts).filter((i) => i).length

  const buildEquip = buildId && buildType === 'real'
  const unequipArts = () => {
    const confirmMsg = buildEquip
      ? 'Do you want to unequip all artifacts in this build?'
      : 'Do you want to move all currently equipped artifacts to inventory?'
    if (!window.confirm(confirmMsg)) return

    if (buildEquip)
      database.builds.set(buildId, {
        artifactIds: objKeyMap(allArtifactSlotKeys, () => undefined),
      })
    else
      Object.values(equippedArtifacts).forEach((aid) =>
        database.arts.set(aid, { location: '' })
      )
  }

  const setEffects = useMemo(() => dataSetEffects(data), [data])
  const effects = Object.entries(setEffects ?? {}).flatMap(
    ([setKey, setNumKeyArr]) =>
      setNumKeyArr.map((setNumKey) => (
        <SetEffectDisplay
          key={setKey + setNumKey}
          setKey={setKey}
          setNumKey={setNumKey}
        />
      ))
  )
  // (nothing equipped and no set effects: no empty card)
  if (!hasEquipped && !effects.length) return null

  return (
    <CardThemed bgt="light">
      {hasEquipped && (
        <Button
          color="error"
          onClick={unequipArts}
          fullWidth
          sx={{ borderBottomRightRadius: 0, borderBottomLeftRadius: 0 }}
        >
          {t('tabEquip.unequipArts')}
        </Button>
      )}
      {!!effects.length && (
        <Box p={1}>
          <Stack spacing={1}>{effects}</Stack>
        </Box>
      )}
    </CardThemed>
  )
}
