import { giTokens } from '@genshin-optimizer/gi/theme'
import {
  alpha,
  Box,
  FormControlLabel,
  Switch,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import { useAutoRankEquipment } from './autoRankEquipment'
import { quickSx, tokens, type } from './ui'

const goldSwitchSx = {
  width: 34,
  height: 20,
  p: 0,
  mr: 0.875,
  '& .MuiSwitch-switchBase': {
    p: 0,
    m: '2px',
    transitionDuration: '160ms',
    '&.Mui-checked': {
      transform: 'translateX(14px)',
      color: '#1b1a17',
      '& + .MuiSwitch-track': {
        bgcolor: tokens.gold,
        opacity: 1,
        border: `1px solid ${alpha(giTokens.goldLight, 0.7)}`,
      },
    },
  },
  '& .MuiSwitch-thumb': {
    width: 16,
    height: 16,
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
  },
  '& .MuiSwitch-track': {
    borderRadius: 999,
    bgcolor: alpha(giTokens.parchment, 0.14),
    border: `1px solid ${tokens.hairlineStrong}`,
    opacity: 1,
    transition: 'background-color 160ms ease, border-color 160ms ease',
  },
} as const

/**
 * Consistent warm-gold switch for the global "Auto-rank equipment" preference.
 * Compact variant fits cleanly on a single line inside narrow banners.
 */
export function AutoRankToggle({
  label,
  compact = false,
}: {
  label?: string
  compact?: boolean
}) {
  const { t } = useTranslation('page_team')
  const [autoRank, setAutoRank] = useAutoRankEquipment()
  const text =
    label ??
    (compact
      ? t('teamOpt.result.autoRankShort', 'Auto-rank')
      : t('teamOpt.result.autoRankAfter', 'Auto-rank after optimize'))
  const tip = t(
    'teamOpt.run.autoRankTip',
    'Automatically compare alternative weapons and artifact sets right after team optimization finishes.'
  )

  return (
    <Tooltip arrow describeChild enterDelay={350} title={tip}>
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          px: compact ? 0.875 : 1.125,
          py: compact ? 0.375 : 0.5,
          borderRadius: 999,
          border: `1px solid ${
            autoRank ? alpha(tokens.gold, 0.34) : tokens.hairline
          }`,
          bgcolor: autoRank
            ? alpha(tokens.gold, 0.08)
            : alpha(giTokens.parchment, 0.025),
          ...quickSx,
          '&:hover': {
            borderColor: autoRank
              ? alpha(tokens.gold, 0.55)
              : tokens.hairlineStrong,
            bgcolor: autoRank
              ? alpha(tokens.gold, 0.13)
              : alpha(giTokens.parchment, 0.055),
          },
        }}
      >
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={autoRank}
              onChange={(_, checked) => setAutoRank(checked)}
              sx={goldSwitchSx}
            />
          }
          label={
            <Typography
              sx={{
                ...type.label,
                fontSize: compact ? 12 : 12.5,
                fontWeight: autoRank ? 600 : 500,
                color: autoRank ? giTokens.goldLight : 'text.secondary',
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                userSelect: 'none',
                ...quickSx,
              }}
            >
              {text}
            </Typography>
          }
          sx={{ m: 0 }}
        />
      </Box>
    </Tooltip>
  )
}
