import {
  ChangelogDialog,
  currentRelease,
  DISCORD_INVITE,
  DiscordIcon,
} from '@genshin-optimizer/gi/ui'
import GitHubIcon from '@mui/icons-material/GitHub'
import { AppBar, Box, Link, Skeleton, Typography } from '@mui/material'
import { Suspense, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { openFeedback } from './Feedback'

// juanlab: il sorgente del fork (AGPL: deve essere raggiungibile dal sito) e il progetto su cui si basa
const GITHUB_URL = 'https://github.com/Juan0177/Juan-optimizer'
const STELLAR_URL = 'https://github.com/s-naveen/stellar-optimizer'

export default function Footer() {
  return (
    <Suspense fallback={<Skeleton variant="rectangular" height={64} />}>
      <FooterContent />
    </Suspense>
  )
}
function FooterContent() {
  const { t } = useTranslation('ui')
  const [changelogOpen, setChangelogOpen] = useState(false)
  return (
    <AppBar
      component="footer"
      position="static"
      sx={{ bgcolor: 'neutral800.main' }}
      elevation={0}
    >
      <Box
        sx={{
          pl: 2,
          // (the floating Feedback button sits over the footer's right end on larger screens)
          pr: { xs: 2, sm: 19 },
          py: 1,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          columnGap: 2,
          rowGap: 1,
        }}
      >
        <Typography variant="caption" sx={{ color: 'neutral400.main' }}>
          <Trans t={t} i18nKey="ui:rightsDisclaimer">
            Juan-optimizer is not affiliated with or endorsed by HoYoverse.
          </Trans>
        </Typography>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 1.5,
            rowGap: 0.5,
          }}
        >
          <Typography variant="caption" sx={{ color: 'neutral400.main' }}>
            {/* plain links (not hash routes) to the static pages made for search engines */}
            <Link href="optimizers/" color="inherit" underline="hover">
              {t('characterOptimizers')}
            </Link>
            {' · '}
            <Link href="faq/" color="inherit" underline="hover">
              {t('faq')}
            </Link>
          </Typography>
          {/* (phones have no floating Feedback button: it is here) */}
          <Link
            component="button"
            type="button"
            onClick={openFeedback}
            color="inherit"
            underline="hover"
            variant="caption"
            sx={{
              display: { xs: 'inline', sm: 'none' },
              color: 'text.secondary',
            }}
          >
            {t('feedback.button', 'Feedback')}
          </Link>
          <Link
            href={DISCORD_INVITE}
            target="_blank"
            rel="noopener noreferrer"
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
            <DiscordIcon sx={{ fontSize: 14 }} />
            Discord
          </Link>
          <Link
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
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
            <GitHubIcon sx={{ fontSize: 14 }} />
            {t('github', 'GitHub')}
          </Link>
          {/* this build's version: opens the changelog */}
          <Link
            component="button"
            type="button"
            onClick={() => setChangelogOpen(true)}
            underline="none"
            variant="caption"
            title={t('changelog.open', 'Changelog')}
            sx={{
              color: 'neutral400.main',
              fontVariantNumeric: 'tabular-nums',
              transition: 'color 120ms',
              '&:hover': { color: 'neutral300.main' },
            }}
          >
            v{currentRelease.version}
          </Link>
          <Link
            href={STELLAR_URL}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            variant="caption"
            sx={{ color: 'neutral400.main' }}
          >
            {t('basedOnStellar', 'Based on Stellar Optimizer')}
          </Link>
        </Box>
      </Box>
      <ChangelogDialog
        open={changelogOpen}
        onClose={() => setChangelogOpen(false)}
      />
    </AppBar>
  )
}
