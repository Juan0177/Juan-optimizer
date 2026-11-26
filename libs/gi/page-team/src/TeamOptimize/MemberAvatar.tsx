import { characterAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { giTokens } from '@genshin-optimizer/gi/theme'
import { alpha, Box } from '@mui/material'

/**
 * A member's portrait in a fixed rounded box: sits inside a card's header (the side icons of the
 * team pills poke out above their row).
 */
export function MemberAvatar({
  characterKey,
  size = 32,
}: {
  characterKey: CharacterKey
  size?: number
}) {
  const { gender } = useDBMeta()
  return (
    <Box
      component="img"
      src={characterAsset(characterKey, 'icon', gender)}
      alt=""
      aria-hidden
      sx={(theme) => ({
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: '50%',
        objectFit: 'cover',
        backgroundColor: theme.palette.contentLight.main,
      })}
    />
  )
}

/**
 * Modern rounded-square character portrait with an embedded constellation badge (`C0`–`C6`) and
 * optional signature refinement tag (`R1`–`R5` / `–`) directly on the portrait for instant
 * scanning in Versions and Combinations lists.
 */
export function VersionPortrait({
  characterKey,
  size = 44,
  constellation,
  ownConstellation = false,
  signature,
  highlighted = false,
}: {
  characterKey: CharacterKey
  size?: number
  /** Effective constellation to show on the portrait corner (C0–C6) */
  constellation?: number
  /** True when this version overrides the character's constellation from the family default */
  ownConstellation?: boolean
  /** Optional signature refinement override (0 = no sig, 1–5 = R1–R5) */
  signature?: number
  /** True when this member is swapped in or modified compared to the original team */
  highlighted?: boolean
}) {
  const { gender } = useDBMeta()
  const ele = getCharEle(characterKey)
  const radius = size >= 40 ? '10px' : '8px'
  const compact = size < 40
  return (
    <Box
      sx={(theme) => {
        const eleColor = theme.palette[ele]?.main ?? giTokens.parchment
        return {
          position: 'relative',
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: radius,
          overflow: 'hidden',
          background: `linear-gradient(180deg, ${alpha(eleColor, 0.22)} 0%, ${alpha(eleColor, 0.08)} 100%)`,
          backgroundColor: theme.palette.contentLight.main,
          boxShadow: highlighted
            ? `inset 0 0 0 1.5px ${alpha(giTokens.gold, 0.85)}`
            : `inset 0 0 0 1px ${alpha(giTokens.parchment, 0.14)}`,
          transition: 'box-shadow 140ms ease',
        }
      }}
    >
      <Box
        component="img"
        src={characterAsset(characterKey, 'icon', gender)}
        alt=""
        aria-hidden
        sx={{
          width: '100%',
          height: '100%',
          display: 'block',
          objectFit: 'cover',
        }}
      />
      {signature !== undefined && (
        <Box
          component="span"
          sx={{
            position: 'absolute',
            top: 2,
            right: 2,
            px: compact ? '3px' : '4px',
            py: '1px',
            borderRadius: '4px',
            fontSize: compact ? 8.5 : 9.5,
            fontWeight: 750,
            lineHeight: 1.15,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.01em',
            bgcolor: alpha('#14151c', 0.88),
            color: signature > 0 ? giTokens.goldLight : 'text.secondary',
            boxShadow: `0 0 0 1px ${alpha(giTokens.gold, 0.45)}`,
          }}
        >
          {signature > 0 ? `R${signature}` : 'No sig'}
        </Box>
      )}
      {constellation !== undefined && (
        <Box
          component="span"
          sx={{
            position: 'absolute',
            bottom: 2,
            right: 2,
            px: compact ? '3.5px' : '4.5px',
            py: compact ? '1px' : '1.5px',
            borderRadius: '5px',
            fontSize: compact ? 9.5 : 10.5,
            fontWeight: ownConstellation ? 800 : 700,
            lineHeight: 1.1,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.01em',
            ...(ownConstellation
              ? {
                  bgcolor: giTokens.gold,
                  color: '#14151c',
                  boxShadow: `0 1px 4px ${alpha('#000', 0.55)}`,
                }
              : {
                  bgcolor: alpha('#12131a', 0.84),
                  color: alpha(giTokens.parchment, 0.88),
                  boxShadow: `inset 0 0 0 1px ${alpha(giTokens.parchment, 0.14)}`,
                }),
          }}
        >
          C{constellation}
        </Box>
      )}
    </Box>
  )
}
