import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { expect, it, vi } from 'vitest'
import { PassiveTag, playedWeaponPassiveUptime } from './CountedPassives'

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | { defaultValue?: string; [k: string]: unknown }
    ) => {
      if (typeof fallback === 'string') return fallback
      let out = fallback?.defaultValue ?? key
      for (const [k, v] of Object.entries(fallback ?? {}))
        if (k !== 'defaultValue') out = out.replaceAll(`{{${k}}}`, String(v))
      return out
    },
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

it('measures TTDS hit uptime across the recipient’s on-field hits and shows partial share', () => {
  const path = ['ThrillingTalesOfDragonSlayers', 'Heritage']
  const uptime = playedWeaponPassiveUptime(
    {
      Mona: [
        {
          path: ['skill', 'dmg'],
          hits: 1,
          hitMode: 'avgHit',
          onField: 'Mona',
          limits: [{ owner: 'Mona', path, hits: 0 }],
        },
      ],
      Vesna: [
        {
          path: ['skill', 'sword3SpiritDmg'],
          hits: 5,
          hitMode: 'avgHit',
          onField: 'Vesna',
        },
        {
          path: ['skill', 'sword3SpiritDmg'],
          hits: 5,
          hitMode: 'avgHit',
          onField: 'Vesna',
          limits: [{ owner: 'Mona', path, hits: 0 }],
        },
      ],
    },
    'Mona',
    path,
    'on',
    true
  )
  expect(uptime).toBeCloseTo(0.5, 4)

  const zero = playedWeaponPassiveUptime(
    {
      Vesna: [
        {
          path: ['skill', 'sword3SpiritDmg'],
          hits: 5,
          hitMode: 'avgHit',
          onField: 'Vesna',
          limits: [{ owner: 'Mona', path, hits: 0 }],
        },
      ],
    },
    'Mona',
    path,
    'on',
    true
  )
  expect(zero).toBe(0)

  render(
    <PassiveTag
      passives={[
        {
          path: path.join('.'),
          label: 'Heritage',
          rotation: 0.5,
          rotationSource: 'played',
          source: 'rule',
        },
      ]}
    />
  )
  expect(screen.getByText('Passive 50%')).toBeTruthy()
})
