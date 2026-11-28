import { CardThemed, InfoTooltipInline } from '@genshin-optimizer/common/ui'
import {
  TeamCharacterContext,
  useLoadoutArtifacts,
} from '@genshin-optimizer/gi/db-ui'
import { OptTargetContext, statName } from '@genshin-optimizer/gi/ui'
import { Box, LinearProgress, Typography } from '@mui/material'
import { useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { kqmStandardName } from '../../../TeamOptimize/KqmStandard'
import { artifactBenchmarks } from './artifactBenchmarkRolls'

export default function ArtifactBenchmarks() {
  const { t, i18n } = useTranslation('page_team')
  const { loadoutDatum } = useContext(TeamCharacterContext)
  const { target, scalesWith } = useContext(OptTargetContext)
  const artifacts = useLoadoutArtifacts(loadoutDatum)
  const { equipped, useful, rolls, benchmarks } = useMemo(
    () => artifactBenchmarks(artifacts, scalesWith),
    [artifacts, scalesWith]
  )
  if (loadoutDatum.buildType === 'tc') return null

  const decimals = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 1,
  })
  const percent = new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 1,
  })
  return (
    <CardThemed bgt="light" sx={{ px: 1.5, py: 1.25 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          columnGap: 1,
          rowGap: 0.25,
        }}
      >
        <Typography component="h3" variant="body2" sx={{ fontWeight: 600 }}>
          {t('artifactBenchmarks.title')}
          <InfoTooltipInline
            title={
              <>
                {t('artifactBenchmarks.method')}
                {!!useful.length && (
                  <Box sx={{ mt: 0.5 }}>
                    {t('artifactBenchmarks.stats', {
                      stats: useful.map((key) => statName(key)).join(', '),
                    })}
                  </Box>
                )}
              </>
            }
          />
        </Typography>
        {!!target && !!useful.length && equipped > 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {t('artifactBenchmarks.rolls', {
              count: Number(rolls.toFixed(1)),
              rolls: decimals.format(rolls),
            })}
            {equipped < 5 &&
              ` · ${t('artifactBenchmarks.pieces', { equipped })}`}
          </Typography>
        )}
      </Box>
      {!target || !useful.length || !equipped ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          {t(
            !equipped
              ? 'artifactBenchmarks.noArtifacts'
              : !target
                ? 'artifactBenchmarks.noTarget'
                : 'artifactBenchmarks.noUsefulStats'
          )}
        </Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: { xs: 0.75, sm: 1 },
            mt: 0.75,
          }}
        >
          {benchmarks.map(({ standard, baseline }) => {
            const label = kqmStandardName(t, standard)
            const ratio = rolls / baseline
            const delta = rolls - baseline
            const tied = Math.abs(delta) < 1e-9
            const reached = tied || delta > 0
            const difference =
              Math.abs(delta) < 0.05
                ? `<${decimals.format(0.1)}`
                : decimals.format(Math.abs(delta))
            return (
              <Box
                key={standard}
                sx={{
                  p: 0.75,
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: 1,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: { xs: 'column', sm: 'row' },
                    justifyContent: { sm: 'space-between' },
                    flexWrap: 'wrap',
                    columnGap: 0.5,
                    alignItems: 'baseline',
                    mb: 0.5,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {standard === 'kqms' ? (
                      <>
                        <Box
                          component="span"
                          sx={{ display: { xs: 'inline', sm: 'none' } }}
                        >
                          {t('teamOpt.kqm.standard20Short', 'KQMS')}
                        </Box>
                        <Box
                          component="span"
                          sx={{ display: { xs: 'none', sm: 'inline' } }}
                        >
                          {label}
                        </Box>
                      </>
                    ) : (
                      label
                    )}
                  </Typography>
                  <Typography
                    variant="body2"
                    color={reached ? 'success.main' : 'text.primary'}
                    sx={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
                  >
                    {percent.format(ratio)}
                  </Typography>
                </Box>
                <LinearProgress
                  aria-label={label}
                  aria-valuetext={percent.format(ratio)}
                  variant="determinate"
                  value={Math.min(100, 100 * ratio)}
                  color={reached ? 'success' : 'primary'}
                  sx={{ height: 3, borderRadius: 2 }}
                />
                <Typography
                  component="div"
                  variant="caption"
                  color="text.secondary"
                  sx={{ mt: 0.25 }}
                >
                  {tied
                    ? t('artifactBenchmarks.met')
                    : t(
                        delta > 0
                          ? 'artifactBenchmarks.above'
                          : 'artifactBenchmarks.short',
                        {
                          count: Number(Math.abs(delta).toFixed(1)),
                          rolls: difference,
                        }
                      )}
                </Typography>
              </Box>
            )
          })}
        </Box>
      )}
    </CardThemed>
  )
}
