// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TeamCharacterSelector from './TeamCharacterSelector'

const screenSize = vi.hoisted(() => ({ phone: false }))
vi.mock('@mui/material', async (original) => ({
  ...(await original<typeof import('@mui/material')>()),
  useMediaQuery: () => screenSize.phone,
}))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) =>
      typeof options === 'string'
        ? options
        : String(options?.['defaultValue'] ?? key),
  }),
}))
vi.mock('./featureFlags', () => ({ kqmTheorycraftingEnabled: true }))
vi.mock('./TeamActions', () => ({ TeamActions: () => null }))
vi.mock('@genshin-optimizer/gi/db-ui', () => ({
  useDatabase: () => ({ teamChars: { get: () => undefined } }),
  useDBMeta: () => ({ gender: 'F' }),
  useTeam: () => ({ name: 'Team', loadoutData: [{ teamCharId: 'x' }] }),
}))

const renderTabs = () =>
  render(
    <MemoryRouter>
      <TeamCharacterSelector teamId="t1" teamBuildMode="kqm" />
    </MemoryRouter>
  )

describe('the team’s tabs', () => {
  afterEach(cleanup)

  it('name KQM in full on wide screens, and have no KQM Compare tab (its card is in the versions panel)', () => {
    screenSize.phone = false
    renderTabs()
    expect(
      screen.getByRole('tab', { name: 'KQM Theorycrafting (beta)' }).textContent
    ).toContain('KQM Theorycrafting')
    expect(
      screen.queryByRole('tab', { name: 'juanlab:kqmCompare.tabAlpha' })
    ).toBeNull()
    expect(screen.queryByText(/kqmCompare/)).toBeNull()
  })

  it('name KQM short on phones, with its badge', () => {
    screenSize.phone = true
    renderTabs()
    const kqm = screen.getByRole('tab', { name: 'KQM Theorycrafting (beta)' })
    expect(kqm.textContent).toBe('KQMBeta')
  })
})
