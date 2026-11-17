import {
  getAppStorage,
  getAppStorageKind,
} from '@genshin-optimizer/common/database'
import { CardThemed } from '@genshin-optimizer/common/ui'
import { objMap } from '@genshin-optimizer/common/util'
import { SdStorage } from '@mui/icons-material'
import {
  Alert,
  Box,
  CardContent,
  CircularProgress,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  tableCellClasses,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const MAX_LOCAL_STORAGE_MB = 5
const COLORS = {
  activeGo: '#55aaff',
  goDb1: '#5577ff',
  goDb2: '#22ff55',
  goDb3: '#ffaa55',
  goDb4: '#ff6655',
}
const DISPLAY_PERCENT_THRESH = 1
const WARNING_PERCENT_THRESH = 75
const ERROR_PERCENT_THRESH = 90
/** What the data take: in IndexedDB (of what the browser allows this site), or in localStorage (of 5 MB) */
export function LocalStorageUsageCard() {
  const { t } = useTranslation('common')
  const indexedDb = getAppStorageKind() === 'indexeddb'
  // (IndexedDB: the browser's allowance for the site, a share of the disk)
  const [quotaMB, setQuotaMB] = useState<number>()
  useEffect(() => {
    if (!indexedDb) return
    navigator.storage
      ?.estimate?.()
      .then(({ quota }) => quota && setQuotaMB(quota / 1024 / 1024))
      .catch(() => undefined)
  }, [indexedDb])
  const limitMB = indexedDb ? (quotaMB ?? 0) : MAX_LOCAL_STORAGE_MB
  const entries: [string, string][] = indexedDb
    ? getAppStorage().entries
    : Object.keys(localStorage).map((key) => [
        key,
        localStorage.getItem(key) ?? '',
      ])
  let totalBytes = 0
  const bytesByCategory = {
    activeGo: 0,
    goDb1: 0,
    goDb2: 0,
    goDb3: 0,
    goDb4: 0,
  }

  for (const [key, value] of entries) {
    // Calculate bytes for both the key and the value
    const size = new Blob(value ? [key, value] : [key]).size
    totalBytes += size
    if (key.startsWith('extraDatabase')) {
      switch (key[key.length - 1]) {
        case '1':
          bytesByCategory.goDb1 += size
          continue
        case '2':
          bytesByCategory.goDb2 += size
          continue
        case '3':
          bytesByCategory.goDb3 += size
          continue
        case '4':
          bytesByCategory.goDb4 += size
          continue
      }
    } else {
      bytesByCategory.activeGo += size
    }
  }
  const MBByCategory = objMap(bytesByCategory, (v) => v / 1024 / 1024)
  const percentByCategory = objMap(MBByCategory, (v) =>
    limitMB ? (v / limitMB) * 100 : 0
  )

  const totalMB = totalBytes / 1024 / 1024
  const percent = limitMB ? (totalMB / limitMB) * 100 : 0
  let currentPercent = percent

  return (
    <CardThemed bgt="light">
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <SdStorage sx={{ fontSize: '40px' }} />
        <Typography variant="h5">{t('storage.title')}</Typography>
      </CardContent>
      <Divider />
      <CardContent
        sx={{
          display: 'flex',
          alignItems: 'start',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        {percent > WARNING_PERCENT_THRESH && (
          <Alert
            sx={{ width: '100%' }}
            severity={percent > ERROR_PERCENT_THRESH ? 'error' : 'warning'}
          >
            {t('storage.warning')}
          </Alert>
        )}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexWrap: 'wrap',
            flexBasis: 250,
            flexGrow: 1,
            gap: 2,
          }}
        >
          <Typography pb={4}>
            {indexedDb
              ? t('storage.infoIndexedDb', "Saved in this browser's database")
              : t('storage.info')}
          </Typography>
          {/* Stack a bunch of circle bars together */}
          {/* juanlab: anelli decorativi, i numeri sono nel testo accanto (WCAG 4.1.2) */}
          <CircularProgress
            aria-hidden
            size={100}
            thickness={5}
            variant="determinate"
            value={100}
            sx={{
              color: 'contentNormal.main',
            }}
          />
          {Object.entries(percentByCategory)
            .sort((a, b) => a[1] - b[1])
            .filter(([, percent]) => percent > DISPLAY_PERCENT_THRESH)
            .map(([key, percent]) => {
              const prog = (
                <CircularProgress
                  aria-hidden
                  key={key}
                  size={100}
                  thickness={5}
                  variant="determinate"
                  value={currentPercent}
                  sx={{ ml: '-116px', color: COLORS[key] }}
                />
              )
              currentPercent -= percent
              return prog
            })}
          {/* Text next to circle bars */}
          <Typography variant="h6">
            <Box
              component="span"
              color={
                percent > ERROR_PERCENT_THRESH
                  ? 'error.main'
                  : percent > WARNING_PERCENT_THRESH
                    ? 'warning.main'
                    : undefined
              }
            >
              {totalMB.toFixed(2)}MB
            </Box>{' '}
            {!!limitMB && (
              <Box component="span" color="text.secondary">
                /{' '}
                {limitMB >= 1024
                  ? `${(limitMB / 1024).toFixed(0)}GB`
                  : `${limitMB.toFixed(0)}MB`}
              </Box>
            )}{' '}
            <br />
            <Box
              component="span"
              color={
                percent > ERROR_PERCENT_THRESH
                  ? 'error.main'
                  : percent > WARNING_PERCENT_THRESH
                    ? 'warning.main'
                    : undefined
              }
            >
              {percent.toFixed(2)}%
            </Box>
          </Typography>
        </Box>
        {/* Table */}
        <Box display="flex">
          <TableContainer sx={{ width: 'max-content' }}>
            <Table
              size="small"
              sx={{
                width: 'max-content',
                [`& .${tableCellClasses.root}`]: {
                  borderBottom: 'none',
                },
              }}
            >
              <TableHead>
                <TableRow>
                  <TableCell sx={{ pl: 6 }}>{t('storage.category')}</TableCell>
                  <TableCell>{t('storage.size')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {Object.entries(MBByCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, megabytes]) => (
                    <TableRow
                      key={key}
                      sx={{
                        opacity:
                          percentByCategory[key] > DISPLAY_PERCENT_THRESH
                            ? undefined
                            : 0.5,
                      }}
                    >
                      <TableCell>
                        <Box
                          display="inline-block"
                          width="16px"
                          height="16px"
                          mr={2}
                          sx={{
                            backgroundColor:
                              percentByCategory[key] > DISPLAY_PERCENT_THRESH
                                ? COLORS[key]
                                : undefined,
                          }}
                        />
                        {t(`storage.${key}`)}
                      </TableCell>
                      <TableCell>
                        {megabytes.toFixed(2)}MB (
                        {percentByCategory[key].toFixed(2)}%)
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      </CardContent>
    </CardThemed>
  )
}
