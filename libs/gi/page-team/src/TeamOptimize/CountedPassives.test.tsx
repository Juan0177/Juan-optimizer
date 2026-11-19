import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { expect, it, vi } from 'vitest'
import { PassiveTag } from './CountedPassives'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

it('keeps the team page visible while a hovered passive loads its translation', async () => {
  let finish!: () => void
  const loading = new Promise<void>((resolve) => {
    finish = resolve
  })
  const PassiveName = lazy(async () => {
    await loading
    return { default: () => <>Adventure's Blessings</> }
  })
  render(
    <Suspense fallback={<p>Loading team</p>}>
      <h1>Team builds</h1>
      <PassiveTag
        passives={[
          { path: 'weapon.passive', label: <PassiveName />, source: 'rule' },
        ]}
      />
    </Suspense>
  )

  fireEvent.mouseOver(screen.getByText('Passive on'))
  const tooltip = await screen.findByRole('tooltip')
  expect(screen.getByRole('heading', { name: 'Team builds' })).toBeTruthy()
  expect(screen.queryByText('Loading team')).toBeNull()

  await act(async () => finish())
  expect(within(tooltip).getByText("Adventure's Blessings")).toBeTruthy()
})
