// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompareCandidate } from './CompareCardButton'
import { VersionCompareButton } from './CompareCardButton'

const mocks = vi.hoisted(() => ({
  dialogs: [] as Record<string, unknown>[],
  compared: [] as string[][],
}))
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) =>
      o?.['team'] ? `${key}(${o['team']})` : key,
    i18n: { language: 'it' },
  }),
}))
vi.mock('@genshin-optimizer/gi/db-ui', () => ({
  useDatabase: () => ({ teams: { get: () => ({ name: 'Mavuika' }) } }),
  useDBMeta: () => ({ gender: 'F' }),
}))
vi.mock('@genshin-optimizer/gi/ui', () => ({
  CardImageDialog: (props: Record<string, unknown>) => {
    mocks.dialogs.push(props)
    return <div data-testid="card-dialog" />
  },
  KQM_COMPARE_CARD_HEIGHT: 1,
  KQM_COMPARE_CARD_WIDTH: 1,
  KQM_TALENT_DEFAULT: 9,
  kqmCompareCardHeight: () => 1,
  renderKqmCompareCard: () => Promise.resolve(),
  safeName: (s: string) => s,
}))
vi.mock('./versionCompare', () => ({
  versionComparison: (_db: unknown, rootId: string, teamId: string) => {
    mocks.compared.push([rootId, teamId])
    return { a: 'A', b: 'B', pairs: [{ out: 'Nicole', in: 'Bennett' }] }
  },
}))
vi.mock('./compareCardData', () => ({
  compareCardData: (a: string, b: string, ctx: { teamName: string }) => ({
    name: `${ctx.teamName} ${a}/${b}`,
  }),
  compareCardRecord: () => ({}),
}))
vi.mock('../kqmTeamCard', () => ({
  kqmCardFileName: (s: string) => s,
  kqmMembersStats: () => ({}),
  readKqmCardView: () => 'normal',
  writeKqmCardView: () => undefined,
}))
vi.mock('../ui', () => ({ Segmented: () => null }))

const team = (id: string, over: Partial<CompareCandidate> = {}) => ({
  id,
  name: id,
  fresh: true,
  hasRun: true,
  ...over,
})
const button = () => screen.getByRole('button', { name: 'kqmCompare.card.create' })

describe('the comparison card in the versions panel', () => {
  afterEach(() => {
    cleanup()
    mocks.dialogs.length = 0
    mocks.compared.length = 0
  })

  it('on a version: the original against it, at once', () => {
    render(
      <VersionCompareButton
        rootId="root"
        teamId="v1"
        original={team('root')}
        versions={[team('v1'), team('v2')]}
      />
    )
    fireEvent.click(button())
    expect(mocks.compared).toEqual([['root', 'v1']])
    expect(screen.getByTestId('card-dialog')).toBeTruthy()
    expect(mocks.dialogs.at(-1)?.['alt']).toBe('kqmCompare.card.alt(Mavuika A/B)')
  })

  it('on the original: a version picked from its versions, those not run or out of date disabled', () => {
    render(
      <VersionCompareButton
        rootId="root"
        teamId="root"
        original={team('root')}
        versions={[
          team('v1'),
          team('v2', { fresh: false }),
          team('v3', { hasRun: false, fresh: false }),
        ]}
      />
    )
    fireEvent.click(button())
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([
      'v1',
      'v2versionsCompare.stale',
      'v3versionsCompare.notRun',
    ])
    expect(items[1].getAttribute('aria-disabled')).toBe('true')
    expect(items[2].getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(items[0])
    expect(mocks.compared).toEqual([['root', 'v1']])
  })

  it('off, saying why, when a result is missing or out of date', () => {
    const { rerender } = render(
      <VersionCompareButton
        rootId="root"
        teamId="v1"
        original={team('root', { fresh: false })}
        versions={[team('v1')]}
      />
    )
    expect(button()).toHaveProperty('disabled', true)
    rerender(
      <VersionCompareButton
        rootId="root"
        teamId="v1"
        original={team('root')}
        versions={[team('v1', { hasRun: false, fresh: false })]}
      />
    )
    expect(button()).toHaveProperty('disabled', true)
    rerender(
      <VersionCompareButton
        rootId="root"
        teamId="v1"
        original={team('root')}
        versions={[team('v1')]}
      />
    )
    expect(button()).toHaveProperty('disabled', false)
  })
})
