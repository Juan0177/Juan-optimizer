import type { TooltipProps } from '@mui/material'
import { Skeleton, styled, Tooltip, tooltipClasses } from '@mui/material'
import { forwardRef, Suspense } from 'react'

/** Keep lazily loaded tooltip content from suspending the page that owns the trigger. */
export const SuspenseTooltip = forwardRef<unknown, TooltipProps>(
  function SuspenseTooltip({ title, ...props }, ref) {
    return (
      <Tooltip
        {...props}
        ref={ref}
        title={
          title && typeof title === 'object' ? (
            <Suspense fallback={<Skeleton variant="text" width={160} />}>
              {title}
            </Suspense>
          ) : (
            title
          )
        }
      />
    )
  }
)

export const BootstrapTooltip = styled(
  ({ className, ...props }: TooltipProps) => (
    <SuspenseTooltip {...props} arrow classes={{ popper: className }} />
  )
)(({ theme }) => {
  // A theme that styles its tooltips (dark panel, hairline border, shadow) keeps that look;
  // a theme that doesn't keeps the plain black one.
  const themed = !!theme.components?.MuiTooltip?.styleOverrides?.tooltip
  return {
    [`& .${tooltipClasses.arrow}`]: themed
      ? {}
      : { color: theme.palette.common.black },
    [`& .${tooltipClasses.tooltip}`]: {
      ...(themed ? {} : { backgroundColor: theme.palette.common.black }),
      maxWidth: 500,
    },
  }
})
