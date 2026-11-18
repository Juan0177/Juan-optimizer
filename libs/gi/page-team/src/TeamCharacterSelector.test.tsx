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
      <TeamCharacterSelector teamId="t1" teamBuildMode="kqm-compare" />
    </MemoryRouter>
  )

describe('the team’s tabs', () => {
  afterEach(cleanup)

  it('name KQM and KQM Compare in full on wide screens', () => {
    screenSize.phone = false
    renderTabs()
    expect(
      screen.getByRole('tab', { name: 'KQM Theorycrafting (beta)' }).textContent
    ).toContain('KQM Theorycrafting')
    expect(
      screen.getByRole('tab', { name: 'juanlab:kqmCompare.tabAlpha' })
        .textContent
    ).toContain('juanlab:kqmCompare.tab')
  })

  it('name them short on phones, each with its badge', () => {
    screenSize.phone = true
    renderTabs()
    const kqm = screen.getByRole('tab', { name: 'KQM Theorycrafting (beta)' })
    expect(kqm.textContent).toBe('KQMBeta')
    const compare = screen.getByRole('tab', {
      name: 'juanlab:kqmCompare.tabAlpha',
    })
    expect(compare.textContent).toBe(
      'juanlab:kqmCompare.shortTabjuanlab:kqmCompare.alpha'
    )
  })
})
