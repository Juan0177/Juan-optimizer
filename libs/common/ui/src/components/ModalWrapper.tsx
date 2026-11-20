import type { ContainerProps, ModalProps } from '@mui/material'
import { Container, Modal, styled } from '@mui/material'

const ModalContainer = styled(Container)(() => ({
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  minHeight: '100vh',
  // (the visible screen: on phones 100vh runs under the browser's bottom bar)
  '@supports (height: 100dvh)': { minHeight: '100dvh' },
  ':focus': {
    outline: 'None',
  },
  // Allow clicking on the Container to exit modal
  pointerEvents: 'none',
  '& > *': {
    pointerEvents: 'auto',
  },
}))

type ModalWrapperProps = ModalProps & {
  containerProps?: ContainerProps
}
export function ModalWrapper({
  children,
  containerProps,
  'aria-label': label,
  'aria-labelledby': labelledBy,
  ...props
}: ModalWrapperProps) {
  return (
    <Modal
      sx={{
        overflow: 'auto',
      }}
      {...props}
    >
      <ModalContainer
        role="dialog"
        aria-modal
        aria-label={label}
        aria-labelledby={labelledBy}
        sx={{ p: { xs: 1 } }}
        {...containerProps}
      >
        {children}
      </ModalContainer>
    </Modal>
  )
}
