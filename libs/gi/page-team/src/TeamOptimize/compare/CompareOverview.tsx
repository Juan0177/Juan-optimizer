import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDamage, formatGain } from '../format'
import { hairline, insetSx, numSx, type } from '../ui'
import type { Side, SideMember } from './compareSwapKqm'
import { srOnly } from './compareUi'

/** A against B, with the change */
export function Overview({
  a,
  b,
  out,
  inKey,
  nameOf,
  language,
}: {
  a: Side
  b: Side
  out: CharacterKey
  inKey: CharacterKey
  nameOf: (key: CharacterKey) => string
  language: string
}) {
  const { t } = useTranslation('juanlab')
  const fmt = (digits: number) => {
    try {
      return new Intl.NumberFormat(language, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    } catch {
      return new Intl.NumberFormat('en', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    }
  }
  const oneDigit = fmt(1)
  const whole = fmt(0)
  const seconds = (s: number) => (s > 0 ? `${oneDigit.format(s)} s` : '–')
  const pct = (v: number) => `${whole.format(v)}%`
  const gain = (from: number, to: number) =>
    from > 0 ? to / from - 1 : Number.NaN
  const pairs = a.members.map((m) => ({
    a: m,
    b: b.members.find((x) => x.key === (m.key === out ? inKey : m.key)),
  }))
  const head = {
    ...type.label,
    fontWeight: 600,
    borderBottom: hairline,
    whiteSpace: 'nowrap',
  } as const
  const cell = {
    borderBottom: hairline,
    py: 0.75,
    px: 1.25,
    fontSize: 13.5,
  } as const
  const num = { ...cell, ...numSx, textAlign: 'right' } as const
  return (
    <Box sx={{ ...insetSx, overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 520 }}>
        <Box component="caption" sx={srOnly}>
          {t('kqmCompare.table.title')}
        </Box>
        <TableHead>
          <TableRow>
            <TableCell sx={{ ...cell, ...head }}>
              <Box component="span" sx={srOnly}>
                {t('kqmCompare.table.figure')}
              </Box>
            </TableCell>
            <TableCell sx={{ ...num, ...head }}>
              {t('kqmCompare.table.a', { name: nameOf(out) })}
            </TableCell>
            <TableCell sx={{ ...num, ...head }}>
              {t('kqmCompare.table.b', { name: nameOf(inKey) })}
            </TableCell>
            <TableCell sx={{ ...num, ...head }}>
              {t('kqmCompare.table.delta')}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          <FigureRow
            label={t('kqmCompare.table.dpr')}
            a={formatDamage(a.dpr)}
            b={formatDamage(b.dpr)}
            delta={gain(a.dpr, b.dpr)}
            cell={cell}
            num={num}
          />
          <FigureRow
            label={t('kqmCompare.table.dps')}
            a={formatDamage(a.dps)}
            b={formatDamage(b.dps)}
            delta={gain(a.dps, b.dps)}
            cell={cell}
            num={num}
          />
          <FigureRow
            label={t('kqmCompare.table.time')}
            a={seconds(a.rotationTime)}
            b={seconds(b.rotationTime)}
            cell={cell}
            num={num}
          />
          {pairs.map(({ a: ma, b: mb }) => {
            const swapped = ma.key === out
            const name = swapped
              ? `${nameOf(ma.key)} → ${nameOf(inKey)}`
              : nameOf(ma.key)
            return (
              <MemberRows
                key={ma.key}
                name={name}
                fixed={!swapped}
                lockedLabel={t('kqmCompare.locked')}
                a={ma}
                b={mb}
                pct={pct}
                delta={mb ? gain(ma.damage, mb.damage) : Number.NaN}
                cell={cell}
                num={num}
              />
            )
          })}
        </TableBody>
      </Table>
    </Box>
  )
}

type CellSx = Record<string, unknown>

function Delta({ value }: { value: number | undefined }) {
  if (value === undefined) return null
  const color = !Number.isFinite(value)
    ? 'text.secondary'
    : value > 0.0005
      ? 'success.main'
      : value < -0.0005
        ? 'error.main'
        : 'text.secondary'
  return (
    <Box component="span" sx={{ color, fontWeight: 600 }}>
      {formatGain(value)}
    </Box>
  )
}

function FigureRow({
  label,
  a,
  b,
  delta,
  cell,
  num,
}: {
  label: string
  a: ReactNode
  b: ReactNode
  delta?: number
  cell: CellSx
  num: CellSx
}) {
  return (
    <TableRow>
      <TableCell component="th" scope="row" sx={{ ...cell, fontWeight: 600 }}>
        {label}
      </TableCell>
      <TableCell sx={num}>{a}</TableCell>
      <TableCell sx={num}>{b}</TableCell>
      <TableCell sx={num}>
        <Delta value={delta} />
      </TableCell>
    </TableRow>
  )
}

function MemberRows({
  name,
  fixed,
  lockedLabel,
  a,
  b,
  pct,
  delta,
  cell,
  num,
}: {
  name: string
  fixed: boolean
  lockedLabel: string
  a: SideMember
  b: SideMember | undefined
  pct: (v: number) => string
  delta: number
  cell: CellSx
  num: CellSx
}) {
  const { t } = useTranslation('juanlab')
  const short = !!b && fixed && b.erValue < b.er - 0.05
  const label = (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
    >
      {name}
      {fixed && (
        <>
          <LockOutlinedIcon
            aria-hidden
            sx={{ fontSize: 14, color: 'text.secondary' }}
          />
          <Box component="span" sx={srOnly}>
            {lockedLabel}
          </Box>
        </>
      )}
    </Box>
  )
  return (
    <>
      <TableRow>
        <TableCell
          component="th"
          scope="row"
          sx={{ ...cell, fontWeight: 600, borderBottom: 0 }}
        >
          {label}
          <Box component="span" sx={{ ...type.label, ml: 0.75 }}>
            {t('kqmCompare.table.damage')}
          </Box>
        </TableCell>
        <TableCell sx={{ ...num, borderBottom: 0 }}>
          {formatDamage(a.damage)}{' '}
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {pct(a.share * 100)}
          </Box>
        </TableCell>
        <TableCell sx={{ ...num, borderBottom: 0 }}>
          {b ? (
            <>
              {formatDamage(b.damage)}{' '}
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {pct(b.share * 100)}
              </Box>
            </>
          ) : (
            '–'
          )}
        </TableCell>
        <TableCell sx={{ ...num, borderBottom: 0 }}>
          <Delta value={delta} />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell component="th" scope="row" sx={cell}>
          <Box component="span" sx={srOnly}>
            {name}{' '}
          </Box>
          <Box component="span" sx={{ ...type.label, pl: 0.25 }}>
            {t('kqmCompare.table.er')}
          </Box>
        </TableCell>
        <TableCell sx={num}>{a.er ? pct(a.er) : '–'}</TableCell>
        <TableCell sx={{ ...num, ...(short && { color: 'warning.main' }) }}>
          {b?.er ? (
            <Box
              component="span"
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                columnGap: 0.5,
              }}
            >
              {short && (
                <WarningAmberRoundedIcon aria-hidden sx={{ fontSize: 15 }} />
              )}
              {pct(b.er)}
              {/* (in words, not only in colour: what its build reaches) */}
              {short && (
                <Box
                  component="span"
                  sx={{ fontSize: 12.5, width: '100%', textAlign: 'right' }}
                >
                  {t('kqmCompare.table.erShort', {
                    value: Math.round(b.erValue),
                    target: Math.round(b.er),
                  })}
                </Box>
              )}
            </Box>
          ) : (
            '–'
          )}
        </TableCell>
        <TableCell sx={num} />
      </TableRow>
    </>
  )
}
