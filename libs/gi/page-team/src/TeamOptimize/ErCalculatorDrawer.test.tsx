// @vitest-environment jsdom

import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptEnergyCalculator } from '@genshin-optimizer/gi/db'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import { defaultEnergyCalculator } from '@genshin-optimizer/gi/ui'
import { createTheme, Drawer, ThemeProvider } from '@mui/material'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EnergyGear } from './KqmEnergyCalculator'
import { calculatorDrawerZ, KqmEnergyCalculator } from './KqmEnergyCalculator'

vi.mock('@genshin-optimizer/gi/db-ui', () => ({
  useDBMeta: () => ({ gender: 'F' }),
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      let text =
        typeof options === 'string'
          ? options
          : String(options?.['defaultValue'] ?? key.split('.').at(-1))
      if (typeof options === 'object')
        for (const [k, v] of Object.entries(options))
          text = text.replaceAll(`{{${k}}}`, String(v))
      return text
    },
  }),
}))
vi.mock('./MemberAvatar', () => ({ MemberAvatar: () => null }))
vi.mock('@genshin-optimizer/gi/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  CharacterName: ({ characterKey }: { characterKey: string }) => (
    <>{characterKey}</>
  ),
}))

afterEach(cleanup)

const keys: CharacterKey[] = ['Bennett', 'Xingqiu', 'Xiangling', 'Sucrose']
const members = keys.map((characterKey) => ({ characterKey }) as TeamOptMember)
const constellations = { Bennett: 6, Xingqiu: 6, Xiangling: 6, Sucrose: 6 }
// (Bennett may hold a Favonius: its catcher's select shows)
const gear: EnergyGear = {
  constellation: () => 6,
  weapons: (k) =>
    k === 'Bennett' ? [{ key: 'FavoniusSword', refinement: 5 }] : [],
}
const theme = createTheme({ palette: { mode: 'dark' } })
/** The calculator in its drawer, over a run window, as Team optimize opens it */
function InDrawer({ written = false }: { written?: boolean }) {
  const [settings, setSettings] = useState<TeamOptEnergyCalculator>(() => {
    const settings = defaultEnergyCalculator(
      keys,
      20,
      'Bennett',
      constellations
    )
    settings.enemyParticles = 0
    if (written)
      settings.timeline = {
        rotation: {
          members: keys,
          frames: 1200,
          repeat: true,
          active: [{ frame: 0, character: 'Bennett' }],
          events: [
            { kind: 'burst', frame: 50, character: 'Bennett', amount: 60 },
            {
              kind: 'particle',
              frame: 400,
              catcher: 'Bennett',
              element: 'pyro',
              amount: 10,
            },
          ],
        },
      }
    return settings
  })
  return (
    <ThemeProvider theme={theme}>
      <Drawer
        anchor="right"
        open
        sx={(t) => ({ zIndex: calculatorDrawerZ(t) })}
        data-testid="drawer"
      >
        <KqmEnergyCalculator
          members={members}
          kqm={undefined}
          gear={gear}
          settings={settings}
          setSettings={(update) => setSettings(update)}
          fromRotation
        />
      </Drawer>
    </ThemeProvider>
  )
}
const zIndex = (el: Element) => Number(getComputedStyle(el).zIndex)

describe('the ER calculator in its drawer', () => {
  it('keeps the average and input controls available while switching to a written trace', () => {
    render(<InDrawer written />)
    const method = within(
      screen.getByRole('radiogroup', { name: 'Calculation method' })
    )
    expect(method.getByRole('radio', { checked: true }).textContent).toBe(
      'Rotation average'
    )
    const timed = method.getByRole('radio', { name: 'Timed rotation' })
    fireEvent.click(timed)
    expect(timed.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText(/Timed rotation · 200% ER/)).toBeTruthy()
    const field = screen.getByRole('textbox', { name: /Bennett.*skill uses/i })
    fireEvent.change(field, { target: { value: '9' } })
    fireEvent.blur(field)
    expect(
      screen.getByText('Using rotation average with your edited energy inputs.')
    ).toBeTruthy()
    fireEvent.click(method.getByRole('radio', { name: 'Rotation average' }))
    expect((field as HTMLInputElement).value).toBe('9')
    fireEvent.click(timed)
    fireEvent.click(screen.getByRole('button', { name: 'Use rotation inputs' }))
    expect(screen.getByText(/Timed rotation · 200% ER/)).toBeTruthy()
  })

  it('explains how to unlock timed calculation without a written rotation', () => {
    render(<InDrawer />)
    expect(
      (
        screen.getByRole('radio', {
          name: 'Timed rotation',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    expect(
      screen.getByText('Write a playable rotation to use timed tracking.')
    ).toBeTruthy()
  })

  it('opens every select’s menu over the drawer, and a choice is taken', () => {
    render(<InDrawer />)
    const drawer = screen.getByTestId('drawer')
    const selects = within(drawer).getAllByRole('combobox')
    expect(selects.length).toBeGreaterThanOrEqual(3)
    selects.forEach((_, i) => {
      const select = within(drawer).getAllByRole('combobox')[i]
      const before = select.textContent
      fireEvent.mouseDown(select)
      const list = screen.getByRole('listbox')
      const menu = list.closest('.MuiPopover-root, .MuiMenu-root')!
      expect(zIndex(menu)).toBeGreaterThan(zIndex(drawer))
      const options = within(list).getAllByRole('option')
      const other = options.find(
        (o) =>
          o.getAttribute('aria-selected') !== 'true' &&
          o.getAttribute('aria-disabled') !== 'true'
      )
      if (!other) return fireEvent.keyDown(list, { key: 'Escape' })
      fireEvent.click(other)
      expect(within(drawer).getAllByRole('combobox')[i].textContent).not.toBe(
        before
      )
    })
  })
})
