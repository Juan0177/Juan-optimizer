import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import {
  CardImageDialog,
  KQM_COMPARE_CARD_HEIGHT,
  KQM_COMPARE_CARD_WIDTH,
  renderKqmCompareCard,
  safeName,
} from '@genshin-optimizer/gi/ui'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import { Button } from '@mui/material'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { compareCardData } from './compareCardData'
import type { Side } from './compareSwapKqm'

type CardProps = {
  teamId: string
  a: Side
  b: Side
  out: CharacterKey
  inKey: CharacterKey
}

/** "Create card": the comparison as a picture to copy or download (writes nothing) */
export function CompareCardButton({
  disabled,
  ...props
}: CardProps & {
  /** Off while the result is for settings changed since */
  disabled?: boolean
}) {
  const { t } = useTranslation('juanlab')
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<ImageOutlinedIcon />}
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {t('kqmCompare.card.create')}
      </Button>
      {open && <CompareCardDialog {...props} onClose={() => setOpen(false)} />}
    </>
  )
}

function CompareCardDialog({
  teamId,
  a,
  b,
  out,
  inKey,
  onClose,
}: CardProps & { onClose: () => void }) {
  const { t } = useTranslation([
    'juanlab',
    'charNames_gen',
    'weaponNames_gen',
    'artifactNames_gen',
  ])
  const { gender } = useDBMeta()
  const database = useDatabase()
  const data = useMemo(() => {
    const nameOf = (k: CharacterKey) =>
      t(`charNames_gen:${charKeyToLocGenderedCharKey(k, gender)}`)
    return compareCardData(a, b, {
      teamName: database.teams.get(teamId)?.name ?? '',
      outName: nameOf(out),
      inName: nameOf(inKey),
      gender,
      t: t as unknown as TFunction,
    })
  }, [a, b, out, inKey, gender, t, database, teamId])
  const render = useMemo(() => () => renderKqmCompareCard(data), [data])
  return (
    <CardImageDialog
      title={t('kqmCompare.card.title')}
      alt={t('kqmCompare.card.alt', { team: data.name })}
      fileName={`KQM-Compare-${safeName(data.name)}`}
      aspectRatio={`${KQM_COMPARE_CARD_WIDTH} / ${KQM_COMPARE_CARD_HEIGHT}`}
      render={render}
      onClose={onClose}
    />
  )
}
