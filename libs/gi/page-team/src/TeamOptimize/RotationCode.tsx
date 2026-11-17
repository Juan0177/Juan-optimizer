import {
  type RotationMember,
  type RotationSpan,
  rotationSpans,
} from '@genshin-optimizer/gi/ui'
import { alpha, Box, type Theme } from '@mui/material'
import { type ChangeEvent, type ReactNode, type Ref, useMemo } from 'react'
import { laneColor } from './RotationTimeline'
import { tokens } from './ui'

/** The rotation's type: one monospace face, roomy lines (the text and its colours must match) */
const CODE = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 14.5,
  lineHeight: 1.8,
  letterSpacing: 0,
  padding: '10px 14px',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'break-word',
  wordBreak: 'normal',
  tabSize: 2,
} as const

/** A piece's colour: names in their member's colour, the rest quieter around the actions */
function spanSx(theme: Theme, span: RotationSpan) {
  switch (span.kind) {
    case 'member':
      return {
        color: span.characterKey
          ? laneColor(theme, span.characterKey)
          : theme.palette.text.primary,
      }
    case 'separator':
      return { color: alpha(theme.palette.text.primary, 0.32) }
    case 'wait':
      return { color: alpha(theme.palette.text.primary, 0.55) }
    case 'note':
      return {
        color: alpha(theme.palette.text.primary, 0.4),
        fontStyle: 'italic',
      }
    case 'unknown':
      return {
        color: theme.palette.warning.main,
        textDecoration: 'underline wavy',
        textDecorationColor: alpha(theme.palette.warning.main, 0.7),
        textUnderlineOffset: '4px',
      }
    default:
      return { color: theme.palette.text.primary }
  }
}

/**
 * The rotation as code: a plain text area over a copy of its text in colour (the area's own text
 * is transparent, so the caret, selection, undo and typing are the browser's). Both share one
 * box model, so the colours sit exactly under the letters.
 */
export function RotationCode({
  value,
  onChange,
  names,
  placeholder,
  label,
  minRows = 2,
  autoFocus,
  active,
  inputRef,
  onFocus,
}: {
  value: string
  onChange: (value: string) => void
  names: readonly RotationMember[]
  placeholder?: string
  label: string
  minRows?: number
  autoFocus?: boolean
  /** Where the quick row inserts: marked even when the focus is on a chip */
  active?: boolean
  inputRef?: Ref<HTMLTextAreaElement>
  onFocus?: () => void
}) {
  const spans = useMemo(() => rotationSpans(value, names), [value, names])
  const painted = useMemo(() => {
    const out: ReactNode[] = []
    let at = 0
    for (const span of spans) {
      if (span.from > at) out.push(value.slice(at, span.from))
      out.push(
        <Box
          key={span.from}
          component="span"
          sx={(theme) => spanSx(theme, span)}
        >
          {value.slice(span.from, span.to)}
        </Box>
      )
      at = span.to
    }
    if (at < value.length) out.push(value.slice(at))
    // (a last empty line still takes its height)
    out.push('​')
    return out
  }, [spans, value])
  return (
    <Box
      sx={(theme) => ({
        position: 'relative',
        borderRadius: tokens.radius.inset,
        bgcolor: alpha(theme.palette.common.black, 0.22),
        boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, active ? 0.16 : 0.08)}`,
        transition: 'box-shadow .15s',
        '&:hover': {
          boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.2)}`,
        },
        '&:focus-within': {
          boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.7)}, 0 0 0 3px ${alpha(theme.palette.primary.main, 0.16)}`,
        },
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      })}
    >
      <Box
        aria-hidden
        sx={{
          ...CODE,
          minHeight: `calc(${minRows} * ${CODE.lineHeight}em + 20px)`,
          color: 'text.primary',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        {painted}
      </Box>
      <Box
        component="textarea"
        ref={inputRef}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label={label}
        onFocus={onFocus}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
          onChange(e.target.value)
        }
        sx={(theme) => ({
          ...CODE,
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          m: 0,
          border: 0,
          outline: 0,
          resize: 'none',
          overflow: 'hidden',
          background: 'transparent',
          color: 'transparent',
          caretColor: theme.palette.text.primary,
          '&::placeholder': {
            color: theme.palette.text.secondary,
            opacity: 0.5,
          },
          '&::selection': {
            background: alpha(theme.palette.primary.main, 0.28),
          },
        })}
      />
    </Box>
  )
}
