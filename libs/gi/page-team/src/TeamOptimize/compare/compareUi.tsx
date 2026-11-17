import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Box } from '@mui/material'
import type { ReactNode } from 'react'

/* KQM Compare's small shared pieces */

/** Read by screen readers only */
export const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

/** A warning, its icon first */
export function WarningLine({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}
    >
      <WarningAmberRoundedIcon
        aria-hidden
        sx={{ fontSize: 16, mt: '1px', flexShrink: 0 }}
      />
      <span>{children}</span>
    </Box>
  )
}
