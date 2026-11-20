import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import { Box, Button } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { DialogHead, floatSx } from '../TeamOptimize/OptionTile'
import { hairline } from '../TeamOptimize/ui'
import { EnemyPanel } from './EnemyPanel'

/** The team's enemy, in a window: set by hand, or a Stygian Onslaught boss from its catalogue */
export function EnemyDialog({
  teamId,
  open,
  onClose,
}: {
  teamId: string
  open: boolean
  onClose: () => void
}) {
  const { t } = useTranslation('page_team')
  if (!open) return null
  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'lg' }}
      aria-label={t('enemy.title', 'Enemy')}
    >
      <CardThemed sx={floatSx}>
        <DialogHead title={t('enemy.title', 'Enemy')} onClose={onClose} />
        <Box
          sx={{
            p: { xs: 1.5, sm: 2.5 },
            maxHeight: { xs: 'calc(100dvh - 120px)', sm: '78vh' },
            overflowY: 'auto',
          }}
        >
          <EnemyPanel teamId={teamId} />
        </Box>
        {/* (what is changed applies at once: done closes it) */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-end',
            px: { xs: 1.5, sm: 2.5 },
            py: 1.5,
            borderTop: hairline,
          }}
        >
          <Button
            variant="contained"
            onClick={onClose}
            sx={{ ...giCtaSx, px: 3 }}
          >
            {t('enemy.done', 'Done')}
          </Button>
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}
