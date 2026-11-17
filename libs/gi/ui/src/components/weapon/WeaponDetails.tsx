import { ImgIcon, StarsDisplay } from '@genshin-optimizer/common/ui'
import { imgAssets, weaponAsset } from '@genshin-optimizer/gi/assets'
import { getLevelString } from '@genshin-optimizer/gi/consts'
import type { ICachedWeapon } from '@genshin-optimizer/gi/db'
import { getWeaponSheet } from '@genshin-optimizer/gi/sheets'
import { getWeaponStat, weaponHasRefinement } from '@genshin-optimizer/gi/stats'
import { giTokens } from '@genshin-optimizer/gi/theme'
import { computeUIData } from '@genshin-optimizer/gi/uidata'
import { dataObjForWeapon, uiInput as input } from '@genshin-optimizer/gi/wr'
import { Box, Typography } from '@mui/material'
import { useMemo } from 'react'
import { GetCalcDisplay } from '../../util/getCalcDisplay'
import { resolveInfo } from '../../util/resolveInfo'
import { WeaponName, WeaponPassiveDesc, WeaponPassiveName } from './WeaponTrans'

const numSx = { fontVariantNumeric: 'tabular-nums' } as const
const hairline = `1px solid ${giTokens.hairline}`

/**
 * A weapon at a glance (its tooltip): art and name, rarity, type, level and refinement, its two
 * stats, then its passive at that refinement
 */
export function WeaponDetails({ weapon }: { weapon: ICachedWeapon }) {
  const sheet = getWeaponSheet(weapon.key)
  const uiData = useMemo(
    () => sheet && computeUIData([sheet.data, dataObjForWeapon(weapon)]),
    [sheet, weapon]
  )
  const { rarity, weaponType } = getWeaponStat(weapon.key)
  const stats = uiData
    ? [uiData.get(input.weapon.main), uiData.get(input.weapon.sub)].filter(
        (node) => !node.isEmpty && !!node.value
      )
    : []
  return (
    <Box
      sx={{
        width: 320,
        maxWidth: '100%',
        py: 0.5,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <Box
          className={`grad-${rarity}star`}
          sx={{
            width: 52,
            height: 52,
            flexShrink: 0,
            borderRadius: 1.5,
            overflow: 'hidden',
          }}
        >
          <Box
            component="img"
            src={weaponAsset(weapon.key, weapon.ascension >= 2)}
            alt=""
            sx={{ width: '100%', height: '100%', display: 'block' }}
          />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={{ fontSize: '0.9375rem', fontWeight: 600, lineHeight: 1.3 }}
          >
            <WeaponName weaponKey={weapon.key} />
          </Typography>
          <Box
            sx={{
              mt: 0.375,
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              color: 'text.secondary',
              fontSize: '0.75rem',
              ...numSx,
            }}
          >
            <StarsDisplay stars={rarity} colored />
            <ImgIcon src={imgAssets.weaponTypes[weaponType]} size={1.1} />
            <span>
              Lv. {getLevelString(weapon.level, weapon.ascension)}
              {weaponHasRefinement(weapon.key) && ` · R${weapon.refinement}`}
            </span>
          </Box>
        </Box>
      </Box>
      {!!stats.length && (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))`,
            gap: 1.5,
          }}
        >
          {stats.map((node, i) => {
            const { name, icon } = resolveInfo(node.info)
            return (
              <Box key={i} sx={{ minWidth: 0 }}>
                <Typography
                  component="div"
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    fontSize: '0.75rem',
                    color: 'text.secondary',
                    '& svg': { fontSize: '1.05em' },
                  }}
                >
                  {icon}
                  <Box
                    component="span"
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {name}
                  </Box>
                </Typography>
                <Typography
                  sx={{ fontSize: '0.9375rem', fontWeight: 600, ...numSx }}
                >
                  {GetCalcDisplay(node).valueString}
                </Typography>
              </Box>
            )
          })}
        </Box>
      )}
      {weaponHasRefinement(weapon.key) && (
        <Box sx={{ pt: 1.25, borderTop: hairline }}>
          <Typography
            component="div"
            sx={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'primary.light',
            }}
          >
            <WeaponPassiveName weaponKey={weapon.key} />
          </Typography>
          <Typography
            component="div"
            sx={{
              mt: 0.375,
              fontSize: '0.8125rem',
              lineHeight: 1.55,
              // (the translated text's own Typography would reset it to the body size)
              '& .MuiTypography-root': {
                fontSize: 'inherit',
                lineHeight: 'inherit',
              },
            }}
          >
            <WeaponPassiveDesc
              weaponKey={weapon.key}
              refineIndex={weapon.refinement - 1}
            />
          </Typography>
        </Box>
      )}
    </Box>
  )
}
