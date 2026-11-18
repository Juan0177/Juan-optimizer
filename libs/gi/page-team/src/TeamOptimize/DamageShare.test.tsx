// @vitest-environment jsdom
import type { TeamOptEvaluation } from '@genshin-optimizer/gi/ui'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DamageShare } from './DamageShare'

const site = vi.hoisted(() => ({ language: 'en' }))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  Trans: () => null,
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) =>
      typeof options === 'string'
        ? options
        : String(options?.['defaultValue'] ?? key),
    i18n: site,
  }),
}))
vi.mock('./MemberAvatar', () => ({ MemberAvatar: () => null }))

// 63,592 DPS and 31,796 DPS over a 20 s rotation
const evaluation: TeamOptEvaluation = {
  total: 1_907_760,
  members: { Bennett: 1_271_840, Xiangling: 635_920 },
  attacks: {},
  unmet: {},
}
const renderShare = () =>
  render(
    <DamageShare
      members={['Bennett', 'Xiangling']}
      evaluation={evaluation}
      attacks={{}}
      teamData={undefined}
      rotationTime={20}
    />
  )

describe('DamageShare', () => {
  afterEach(cleanup)

  it('writes the damage as English does', () => {
    site.language = 'en'
    renderShare()
    expect(screen.getByText('95,388')).toBeTruthy()
    expect(screen.getByText('63,592')).toBeTruthy()
    expect(screen.getByLabelText('Damage share')).toBeTruthy()
  })

  it('writes the damage as the site’s language does', () => {
    site.language = 'it'
    renderShare()
    expect(screen.getByText('95.388')).toBeTruthy()
    expect(screen.getByText('63.592')).toBeTruthy()
  })
})
