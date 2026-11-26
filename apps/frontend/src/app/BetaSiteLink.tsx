import { giTokens } from '@genshin-optimizer/gi/theme'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import { alpha, Box, Link, Tooltip } from '@mui/material'
import { useTranslation } from 'react-i18next'

declare const __GO_BETA_LABEL__: string

/**
 * The beta's name ("7.3 beta v5"), on the beta site (gi-beta73.github.io) and local builds only. The
 * released build (stellaroptimizer.com) has none, so these links are not in it at all: the released
 * site never points at the beta.
 */
const BETA =
  typeof __GO_BETA_LABEL__ === 'string' && __GO_BETA_LABEL__
    ? __GO_BETA_LABEL__
    : ''
/** The released site, for the beta's visitors */
const RELEASED_SITE = 'https://stellaroptimizer.com'

const { gold, goldLight, hairlineStrong } = giTokens

/** Beside the logo on the beta: a Beta tag that leads to the released site */
export function BetaBadge() {
  const { t } = useTranslation('ui')
  if (!BETA) return null
  return (
    <Tooltip
      title={t(
        'betaSite.tip',
        'This beta includes unreleased content. The released site is stellaroptimizer.com.'
      )}
    >
      <Link
        href={RELEASED_SITE}
        target="_blank"
        rel="noopener"
        underline="none"
        aria-label={t(
          'betaSite.label',
          'Beta site. Open the released site, stellaroptimizer.com'
        )}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          height: 26,
          pl: 0.5,
          pr: 1,
          ml: 0.5,
          flexShrink: 0,
          borderRadius: 999,
          border: `1px solid ${hairlineStrong}`,
          color: 'text.secondary',
          fontSize: '0.75rem',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          transition: 'color 120ms, border-color 120ms',
          '&:hover': { color: goldLight, borderColor: alpha(gold, 0.55) },
          '&:focus-visible': { outline: `2px solid ${gold}`, outlineOffset: 2 },
        }}
      >
        <Box
          component="span"
          sx={{
            px: 0.75,
            borderRadius: 999,
            bgcolor: alpha(gold, 0.16),
            color: gold,
            lineHeight: '18px',
            fontWeight: 700,
          }}
        >
          {t('betaSite.tag', 'Beta')}
        </Box>
        <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' } }}>
          stellaroptimizer.com
        </Box>
        <OpenInNewRoundedIcon sx={{ fontSize: 13, opacity: 0.8 }} />
      </Link>
    </Tooltip>
  )
}

/** In the footer on the beta: the released site */
export function ReleasedSiteLink() {
  const { t } = useTranslation('ui')
  if (!BETA) return null
  return (
    <Link
      href={RELEASED_SITE}
      target="_blank"
      rel="noopener"
      underline="none"
      variant="caption"
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        color: 'neutral400.main',
        transition: 'color 120ms',
        '&:hover': { color: 'neutral300.main' },
      }}
    >
      {t('betaSite.footer', 'Released site')}
      <OpenInNewRoundedIcon sx={{ fontSize: 12 }} />
    </Link>
  )
}
