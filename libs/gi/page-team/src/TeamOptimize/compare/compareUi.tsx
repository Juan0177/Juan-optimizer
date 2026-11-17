import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import { Box } from '@mui/material'
import type { ReactNode } from 'react'

/* KQM Compare's small shared pieces */

/**
 * Read by screen readers only: the standard visually-hidden recipe. Sizes are strings, since
 * MUI's sx reads `width: 1` as 100%.
 */
export const srOnly = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: 0,
  margin: '-1px',
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
