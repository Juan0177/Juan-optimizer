import { timeStringMs } from '@genshin-optimizer/common/util'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { Alert, Grid, LinearProgress, styled, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CharacterName } from './Trans'
export type BuildStatus = {
  type: 'active' | 'inactive'
  tested: number // tested, including `failed`
  failed: number // tested but fail the filter criteria, e.g., not enough EM
  skipped: number
  total: number
  startTime?: number
  finishTime?: number
}

export function initialBuildStatus(): BuildStatus {
  return {
    type: 'inactive',
    tested: 0,
    failed: 0,
    skipped: 0,
    total: 0,
  }
}

const Monospace = styled('strong')({
  fontFamily: 'monospace',
})

const BorderLinearProgress = styled(LinearProgress)(() => ({
  height: 10,
  borderRadius: 5,
}))
export function BuildAlert({
  status: { type, tested, failed: _, skipped, total, startTime, finishTime },
  characterKey,
  gender,
}: {
  status: BuildStatus
  characterKey: CharacterKey
  gender: GenderKey
}) {
  const { t, i18n } = useTranslation('ui')
  const lang = i18n.language
  const hasTotal = Number.isFinite(total)

  const generatingBuilds = type !== 'inactive'
  const unskipped = total - skipped

  const testedString = <Monospace>{tested.toLocaleString(lang)}</Monospace>
  const unskippedString = (
    <Monospace>{unskipped.toLocaleString(lang)}</Monospace>
  )
  const skippedText = !!skipped && (
    <span>
      (<b>{<Monospace>{skipped.toLocaleString(lang)}</Monospace>}</b>{' '}
      {t('buildAlert.skipped', 'skipped')})
    </span>
  )

  const durationString = (
    <Monospace>
      {timeStringMs(
        Math.round(
          (finishTime ?? performance.now()) - (startTime ?? Number.NaN)
        ),
        {
          minutes: t('tools.minutes', 'Minutes'),
          hours: t('tools.hours', 'Hours'),
        }
      )}
    </Monospace>
  )

  const color = 'success' as 'success' | 'warning' | 'error'
  let title = '' as ReactNode
  let subtitle = '' as ReactNode
  let progress = undefined as undefined | number

  if (generatingBuilds) {
    progress = ((tested + skipped) / total) * 100
    title = (
      <Typography>
        {t('buildAlert.generating', 'Generating and testing')} {testedString}
        {hasTotal ? <>/{unskippedString}</> : undefined}{' '}
        {t(
          'buildAlert.generatingFor',
          'build configurations against the criteria for'
        )}{' '}
        <b>
          <CharacterName characterKey={characterKey} gender={gender} />
        </b>
        . {skippedText}
      </Typography>
    )
    subtitle = (
      <Typography>
        {t('buildAlert.elapsed', 'Time elapsed:')} {durationString}
      </Typography>
    )
  } else if (tested + skipped) {
    progress = 100
    title = (
      <Typography>
        {t('buildAlert.generated', 'Generated and tested')} {testedString}{' '}
        {t(
          'buildAlert.generatedFor',
          'Build configurations against the criteria for'
        )}{' '}
        <b>
          <CharacterName characterKey={characterKey} gender={gender} />
        </b>
        . {skippedText}
      </Typography>
    )
    subtitle = (
      <Typography>
        {t('buildAlert.total', 'Total duration:')} {durationString}
      </Typography>
    )
  } else {
    return null
  }

  return (
    <Alert
      severity={color}
      variant="filled"
      sx={{
        '& .MuiAlert-message': {
          flexGrow: 1,
        },
      }}
    >
      {title}
      {subtitle}
      {progress !== undefined && (
        <Grid container spacing={1} alignItems="center">
          {hasTotal && (
            <Grid item>
              <Typography>{`${progress.toFixed(1)}%`}</Typography>
            </Grid>
          )}
          <Grid item flexGrow={1}>
            <BorderLinearProgress
              variant={hasTotal ? 'determinate' : 'indeterminate'}
              value={progress}
              color="primary"
            />
          </Grid>
        </Grid>
      )}
    </Alert>
  )
}
