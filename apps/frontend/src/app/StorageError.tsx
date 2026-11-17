import { CardThemed } from '@genshin-optimizer/common/ui'
import '@genshin-optimizer/gi/i18n'
import { theme } from '@genshin-optimizer/gi/theme'
import { Refresh } from '@mui/icons-material'
import {
  Box,
  Button,
  CardActions,
  CardContent,
  CssBaseline,
  StyledEngineProvider,
  ThemeProvider,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'

/**
 * The browser's database (IndexedDB), which holds the data, would not open. Shown instead of the
 * app, which would otherwise start empty, as if the data were gone.
 */
export default function StorageError({ error }: { error: unknown }) {
  const { t } = useTranslation('page_newTab')
  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        <Box
          display="flex"
          minWidth="100vw"
          minHeight="100vh"
          justifyContent="center"
          alignItems="center"
          p={2}
        >
          <CardThemed bgt="light" sx={{ maxWidth: 480 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                {t('storageError.title', 'Your data could not be opened')}
              </Typography>
              <Tooltip
                title={error instanceof Error ? error.message : String(error)}
                placement="bottom-start"
              >
                <Typography color="text.secondary">
                  {t(
                    'storageError.body',
                    "The browser's database did not open. Your data stay saved in this browser."
                  )}
                </Typography>
              </Tooltip>
            </CardContent>
            <CardActions sx={{ justifyContent: 'flex-end', px: 2, pb: 2 }}>
              <Button
                variant="contained"
                startIcon={<Refresh />}
                onClick={() => window.location.reload()}
              >
                {t('storageError.reload', 'Reload')}
              </Button>
            </CardActions>
          </CardThemed>
        </Box>
      </ThemeProvider>
    </StyledEngineProvider>
  )
}
