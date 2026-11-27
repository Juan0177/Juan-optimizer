import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { lazy, Suspense } from 'react'
import { expect, it, vi } from 'vitest'
import {
  PassiveTag,
  passiveApplies,
  playedWeaponPassiveUptime,
} from './CountedPassives'

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
    'on'
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
    'on'
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

it('measures a passive over the hits it can buff, not every member’s', () => {
  const attack = (
    onField: 'Xiangling' | 'Bennett',
    hits: number,
    on: boolean,
    owner = 'Xiangling'
  ) => ({
    path: ['skill', 'dmg'],
    hits,
    hitMode: 'avgHit' as const,
    onField,
    states: [
      { owner, path: ['Deathmatch', 'stack'], value: on ? 'moreThanOne' : '' },
    ],
  })
  // (Deathmatch's switch is on the team's side, but it buffs its holder only)
  const self = playedWeaponPassiveUptime(
    {
      Xiangling: [attack('Bennett', 2, true), attack('Bennett', 2, false)],
      Bennett: [attack('Bennett', 16, true)],
    } as never,
    'Xiangling',
    ['Deathmatch', 'stack'],
    'moreThanOne'
  )
  expect(self).toBeCloseTo(0.5, 4)
  // (Moonpiercer's leaf buffs whoever is on the field)
  const path = ['Moonpiercer', 'passive']
  const active = playedWeaponPassiveUptime(
    {
      Xiangling: [
        {
          path: ['burst', 'dmg'],
          hits: 10,
          hitMode: 'avgHit',
          onField: 'Bennett',
          states: [{ owner: 'Xiangling', path, value: 'on' }],
        },
      ],
      Bennett: [
        {
          path: ['normal', 'dmg'],
          hits: 3,
          hitMode: 'avgHit',
          onField: 'Bennett',
          states: [{ owner: 'Xiangling', path, value: 'on' }],
        },
        {
          path: ['normal', 'dmg'],
          hits: 1,
          hitMode: 'avgHit',
          onField: 'Bennett',
          states: [{ owner: 'Xiangling', path, value: '' }],
        },
      ],
    } as never,
    'Xiangling',
    path,
    'on'
  )
  expect(active).toBeCloseTo(0.75, 4)
})

it('counts Exaiphanes Blade only on the Traveler', () => {
  expect(passiveApplies(['ExaiphanesBlade', 'passive'], 'Odette')).toBe(false)
  expect(passiveApplies(['ExaiphanesBlade', 'passive'], 'TravelerAnemo')).toBe(
    true
  )
  expect(
    passiveApplies(['MistsplitterReforged', 'MistsplittersEmblem'], 'Odette')
  ).toBe(true)
})

it('weighs a passive’s share by damage when the run gives each attack’s', () => {
  const path = ['Azurelight', 'afterSkill']
  const attacks = {
    Odette: [
      {
        path: ['skill', 'coda'],
        hits: 2,
        hitMode: 'avgHit' as const,
        onField: 'Odette' as const,
        states: [{ owner: 'Odette', path, value: 'on' }],
      },
      {
        path: ['skill', 'dance'],
        hits: 22,
        hitMode: 'avgHit' as const,
        onField: 'Odette' as const,
        states: [{ owner: 'Odette', path, value: '' }],
      },
    ],
  }
  // (2 big hits buffed of 24: 8% of the hits, 80% of the damage)
  expect(
    playedWeaponPassiveUptime(attacks as never, 'Odette', path, 'on')
  ).toBeCloseTo(2 / 24, 4)
  expect(
    playedWeaponPassiveUptime(attacks as never, 'Odette', path, 'on', {
      Odette: [80_000, 20_000],
    })
  ).toBeCloseTo(0.8, 4)
})
