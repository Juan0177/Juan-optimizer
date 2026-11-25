// @vitest-environment jsdom
import { createTheme, ThemeProvider } from '@mui/material'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RotationsDropdown,
  type RotationTimingSettings,
} from './RotationTiming'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (
        _key: string,
        opts?: string | { defaultValue?: string; [k: string]: unknown }
      ) => {
        if (typeof opts === 'string') return opts
        let out = opts?.defaultValue ?? _key
        if (opts)
          for (const [k, v] of Object.entries(opts))
            if (k !== 'defaultValue')
              out = out.replaceAll(`{{${k}}}`, String(v))
        return out
      },
    }),
  }
})

const theme = createTheme({ palette: { mode: 'dark' } })
const wrap = (node: ReactNode) => (
  <ThemeProvider theme={theme}>{node}</ThemeProvider>
)

afterEach(cleanup)

describe('RotationsDropdown', () => {
  it('shows Steady DPS by default and lets the user pick First N rotations while preserving other timing fields', () => {
    const onChange = vi.fn()
    const timing: RotationTimingSettings = { edits: {}, swapFrames: 8 }
    render(
      wrap(
        <RotationsDropdown
          timing={timing}
          hasOpener={false}
          onChange={onChange}
          variant="outlined"
        />
      )
    )
    const trigger = screen.getByRole('button', {
      name: /Counted: Steady DPS/i,
    })
    fireEvent.click(trigger)
    fireEvent.click(
      screen.getByRole('menuitem', { name: /First 2 rotations/i })
    )
    expect(onChange).toHaveBeenCalledWith({
      edits: {},
      swapFrames: 8,
      rotations: 2,
    })
  })

  it('returns to Steady DPS by clearing rotations', () => {
    const onChange = vi.fn()
    const timing: RotationTimingSettings = { edits: {}, rotations: 3 }
    render(
      wrap(
        <RotationsDropdown
          timing={timing}
          hasOpener={false}
          onChange={onChange}
          variant="outlined"
        />
      )
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Counted: First 3 rotations/i })
    )
    fireEvent.click(screen.getByRole('menuitem', { name: /Steady DPS/i }))
    expect(onChange).toHaveBeenCalledWith({ edits: {} })
  })

  it('shows and toggles Opener counted only when First N is active and an opener is written', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      wrap(
        <RotationsDropdown
          timing={{ edits: {}, rotations: 2 }}
          hasOpener={false}
          onChange={onChange}
          variant="outlined"
        />
      )
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Counted: First 2 rotations/i })
    )
    expect(
      screen.queryByRole('menuitem', { name: /Opener counted/i })
    ).toBeNull()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    rerender(
      wrap(
        <RotationsDropdown
          timing={{ edits: {}, rotations: 2 }}
          hasOpener={true}
          onChange={onChange}
          variant="outlined"
        />
      )
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Counted: First 2 rotations/i })
    )
    fireEvent.click(screen.getByRole('menuitem', { name: /Opener counted/i }))
    expect(onChange).toHaveBeenCalledWith({
      edits: {},
      rotations: 2,
      countOpener: true,
    })
  })
})
