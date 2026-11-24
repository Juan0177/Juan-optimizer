// @vitest-environment jsdom

import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOptEnergyCalculator,
  TeamOptEnergyMember,
} from '@genshin-optimizer/gi/db'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import { defaultEnergyCalculator } from '@genshin-optimizer/gi/ui'
import { createTheme, ThemeProvider } from '@mui/material'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EnergyGear } from './KqmEnergyCalculator'
import { KqmEnergyCalculator } from './KqmEnergyCalculator'

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
// (Bennett may hold a Favonius: its row shows)
const gear: EnergyGear = {
  constellation: () => 6,
  weapons: (k) =>
    k === 'Bennett' ? [{ key: 'FavoniusSword', refinement: 5 }] : [],
}
const theme = createTheme({ palette: { mode: 'dark' } })
/** The calculator with Bennett (shown first) as given */
function Calculator({ bennett }: { bennett: Partial<TeamOptEnergyMember> }) {
  const [settings, setSettings] = useState<TeamOptEnergyCalculator>(() => {
    const base = defaultEnergyCalculator(keys, 20, 'Bennett', constellations)
    return {
      ...base,
      members: {
        ...base.members,
        Bennett: { ...base.members.Bennett!, ...bennett },
      },
    }
  })
  return (
    <ThemeProvider theme={theme}>
      <KqmEnergyCalculator
        members={members}
        kqm={undefined}
        gear={gear}
        settings={settings}
        setSettings={(update) => setSettings(update)}
        fromRotation
      />
    </ThemeProvider>
  )
}
const SPLIT = 'As played: Xingqiu 50% · Xiangling 50%'

describe('who caught a member’s particles, as the rotation played them', () => {
  it('lists each catcher’s share when they went to several members', () => {
    render(
      <Calculator
        bennett={{
          catchBy: 'Xingqiu',
          funnelShare: 50,
          catchShares: { Xingqiu: 50, Xiangling: 50 },
        }}
      />
    )
    expect(screen.getByText(SPLIT)).toBeTruthy()
  })

  it('says nothing more when one catcher and its share say it all', () => {
    for (const catchShares of [
      { Xingqiu: 100 },
      { Bennett: 40, Xingqiu: 60 },
      { Xingqiu: 50, Nahida: 50 } as never,
    ]) {
      render(<Calculator bennett={{ catchShares }} />)
      expect(screen.queryByText(/As played/)).toBeNull()
      cleanup()
    }
  })

  it('a share set by hand replaces it; Use rotation brings it back', () => {
    render(
      <Calculator
        bennett={{
          catchBy: 'Xingqiu',
          funnelShare: 50,
          catchShares: { Xingqiu: 50, Xiangling: 50 },
        }}
      />
    )
    const fed = screen.getByRole('textbox', { name: /Fed to catcher/ })
    fireEvent.change(fed, { target: { value: '80' } })
    fireEvent.blur(fed)
    expect(screen.queryByText(SPLIT)).toBeNull()
    fireEvent.click(screen.getByText('Use rotation'))
    expect(screen.getByText(SPLIT)).toBeTruthy()
  })
})

describe('Favonius particles', () => {
  it('lists each catcher’s share, unless a catcher is set by hand', () => {
    const favonius = {
      favoniusProcs: 1,
      favoniusCatchBy: 'Bennett' as const,
      favoniusCatchShares: { Bennett: 70, Xiangling: 30 },
    }
    render(<Calculator bennett={favonius} />)
    expect(screen.getByText('Favonius triggers')).toBeTruthy()
    expect(
      screen.getByText('As played: Bennett 70% · Xiangling 30%')
    ).toBeTruthy()
    cleanup()
    render(
      <Calculator bennett={{ ...favonius, edited: ['favoniusCatchBy'] }} />
    )
    expect(
      screen.queryByText('As played: Bennett 70% · Xiangling 30%')
    ).toBeNull()
  })

  it('shows the live ER impact of Favonius and a hint when triggers are 0', () => {
    render(<Calculator bennett={{ favoniusProcs: 1 }} />)
    expect(screen.getByText(/With Favonius \(R5\):/)).toBeTruthy()
    expect(screen.getByText(/−\d+(\.\d)?%/)).toBeTruthy()
    cleanup()
    render(<Calculator bennett={{ favoniusProcs: 0 }} />)
    expect(
      screen.getByText(
        /Set triggers above 0 to count Favonius particles when this member holds one\./
      )
    ).toBeTruthy()
  })
})
