import { giCtaSx } from '@genshin-optimizer/gi/theme'
import CloudDownloadOutlinedIcon from '@mui/icons-material/CloudDownloadOutlined'
import type { ButtonProps } from '@mui/material'
import { Button } from '@mui/material'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import EnkaImportDialog from './EnkaImportDialog'

/**
 * Import from Enka: a UID's in-game Character Showcase (each character with the weapon and
 * artifacts it wears) into the database. `cta`: the page's gold main action.
 */
export function EnkaImportButton({
  cta = false,
  label,
  sx,
  ...props
}: Omit<ButtonProps, 'onClick'> & { cta?: boolean; label?: string }) {
  const { t } = useTranslation('ui')
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        startIcon={<CloudDownloadOutlinedIcon />}
        {...props}
        sx={[cta && giCtaSx, ...(Array.isArray(sx) ? sx : [sx])]}
        onClick={() => setOpen(true)}
      >
        {label ?? t('enka.button', 'Import from Enka')}
      </Button>
      {open && <EnkaImportDialog onClose={() => setOpen(false)} />}
    </>
  )
}
