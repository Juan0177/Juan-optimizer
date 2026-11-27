import { artifactDefIcon, weaponAsset } from '@genshin-optimizer/gi/assets'
import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import type { ICachedWeapon } from '@genshin-optimizer/gi/db'
import { getWeaponStat, weaponHasRefinement } from '@genshin-optimizer/gi/stats'
import { giTokens } from '@genshin-optimizer/gi/theme'
import { alpha, Box } from '@mui/material'
import type { ReactNode } from 'react'

/** The game's item-card backgrounds, by rarity */
export const rarityBg: Record<number, string> = {
  1: 'linear-gradient(160deg, #4f5864, #838f99)',
  2: 'linear-gradient(160deg, #48575c, #5e966c)',
  3: 'linear-gradient(160deg, #515474, #499fb3)',
  4: 'linear-gradient(160deg, #595482, #b886ca)',
  5: 'linear-gradient(160deg, #695453, #e6ac54)',
}
/** The item card's corners: small, except the large rounded top-right one */
export const tileRadius = '7px 26px 7px 7px'
/** The member card around the tile: the same corners, 6px further out */
export const cardRadius = '12px 32px 12px 12px'
export const strip = { bg: '#e9e5dc', text: '#495366', height: 24 }
export const darkChip = 'rgba(8, 8, 10, 0.6)'

/**
 * One member's card: the tile, name, gear and main stats on one raised panel, its base tinted with
 * the member's element, so each member's gear reads as theirs. Clicking anywhere opens the member;
 * the icons have their own tooltips.
 */
export const memberCardSx = (accent: string) =>
  ({
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    textAlign: 'left',
    minWidth: 0,
    p: '6px',
    pb: 1.25,
    borderRadius: cardRadius,
    border: `1px solid ${giTokens.hairline}`,
    background: `linear-gradient(to top, ${alpha(accent, 0.16)}, ${alpha(
      accent,
      0
    )} 62%), ${giTokens.panelRaised}`,
    boxShadow: '0 1px 0 rgba(255, 255, 255, 0.03) inset',
    transition:
      'border-color 120ms ease, transform 160ms ease, box-shadow 160ms ease',
    containerType: 'inline-size',
    '&:hover': {
      borderColor: alpha(accent, 0.55),
      transform: 'translateY(-2px)',
      boxShadow: `0 10px 24px rgba(0, 0, 0, 0.45), 0 0 0 1px ${alpha(accent, 0.12)}`,
    },
    '&.Mui-focusVisible': {
      outline: `2px solid ${giTokens.gold}`,
      outlineOffset: 2,
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      '&:hover': { transform: 'none' },
    },
    // a narrow card (phones): smaller gear so the weapon and a 2+2 pair still fit on one row
    '@container (max-width: 100px)': {
      '& .tm-weapon': { width: 28, height: 28 },
      '& .tm-set': { width: 22, height: 22 },
      '& .tm-sets > * + *': { ml: '-10px' },
      '& .tm-main': { width: 20, height: 20, fontSize: 13 },
      '& .tm-gear': { gap: '4px' },
      '& .tm-element': { width: 20, height: 20, fontSize: 13, top: 4, left: 4 },
      '& .tm-cons': { fontSize: '0.625rem', lineHeight: '16px', px: 0.5 },
    },
  }) as const

const weaponSize = 44
const setSize = 38
export function WeaponThumb({
  weapon,
}: {
  weapon: Pick<ICachedWeapon, 'key' | 'ascension' | 'refinement'>
}) {
  const rarity = getWeaponStat(weapon.key)?.rarity ?? 1
  return (
    <Box
      className="tm-weapon"
      sx={{
        position: 'relative',
        width: weaponSize,
        height: weaponSize,
        flexShrink: 0,
        borderRadius: '6px 14px 6px 6px',
        background: rarityBg[rarity] ?? rarityBg[1],
      }}
    >
      <Box
        component="img"
        loading="lazy"
        alt=""
        src={weaponAsset(weapon.key, weapon.ascension >= 2)}
        sx={{ width: '100%', height: '100%', display: 'block' }}
      />
      {weaponHasRefinement(weapon.key) && (
        <Badge>{`R${weapon.refinement}`}</Badge>
      )}
    </Box>
  )
}

/** A set's icon; `num` (4 or 2) when it is the member's only set (a 2+2 pair needs no count) */
export function SetThumb({ set, num }: { set: ArtifactSetKey; num?: number }) {
  return (
    <Box
      className="tm-set"
      sx={{
        position: 'relative',
        width: setSize,
        height: setSize,
        flexShrink: 0,
        borderRadius: '50%',
        bgcolor: giTokens.panelRaised,
        // a ring in the card's colour keeps an overlapping pair apart
        boxShadow: `0 0 0 2px ${giTokens.panel}`,
      }}
    >
      <Box
        component="img"
        loading="lazy"
        alt=""
        src={artifactDefIcon(set)}
        sx={{ width: '100%', height: '100%', display: 'block' }}
      />
      {num !== undefined && <Badge>{num}</Badge>}
    </Box>
  )
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{
        position: 'absolute',
        right: -5,
        bottom: -4,
        px: 0.5,
        minWidth: 16,
        textAlign: 'center',
        borderRadius: '8px',
        bgcolor: giTokens.inkDeep,
        boxShadow: `0 0 0 1px ${giTokens.hairlineStrong}`,
        color: giTokens.parchment,
        fontSize: '0.6875rem',
        fontWeight: 700,
        lineHeight: '16px',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </Box>
  )
}
