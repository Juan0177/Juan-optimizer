// @vitest-environment jsdom

import type { TeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { KqmPool } from './KqmChoosers'
import type { TeamOptUpdate } from './useTeamOpt'

vi.mock('react-i18next', () => ({
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

// A small weapon list: two free, two Battle Pass, three 4★ event wish, one 5★ standard wish, one
// 5★ event wish
const weapons = vi.hoisted(() => ({
  free: ['FreeA', 'FreeB'],
  bp: ['PassA', 'PassB'],
  wish4: ['WishA', 'WishB', 'WishC'],
  standard5: ['SkyA'],
  wish5: ['FiveA'],
}))
vi.mock('@genshin-optimizer/gi/ui', () => {
  const groupOf = (key: string) =>
    (['bp', 'wish4', 'standard5', 'wish5'] as const).find((g) =>
      (weapons[g] as string[]).includes(key)
    )
  const all = Object.values(weapons).flat()
  return {
    KQM_WEAPON_LIST: 2,
    kqmWeapons: () => all.map((key) => ({ key, refinement: 1 })),
    kqmWeaponGroup: groupOf,
    kqmExcludedWeapons: (kqm: { excludedWeapons?: string[] }) =>
      new Set(
        kqm.excludedWeapons ?? [
          ...weapons.wish4,
          ...weapons.standard5,
          ...weapons.wish5,
        ]
      ),
    kqmGroupRefinementKey: {
      bp: 'refinementBp',
      wish4: 'refinement4',
      standard5: 'refinementStandard5',
      wish5: 'refinement5',
    },
    kqmSets: () => ['SetA', 'SetB'],
    kqmDefaultExcludedWeapons: () => [
      ...weapons.wish4,
      ...weapons.standard5,
      ...weapons.wish5,
    ],
  }
})
vi.mock('@genshin-optimizer/gi/db', () => ({
  defaultTeamOptKqm: { refinement4: 5, refinement5: 1 },
}))
vi.mock('@genshin-optimizer/gi/db-ui', () => ({ useDatabase: () => ({}) }))
vi.mock('@genshin-optimizer/gi/sheets', () => ({
  getArtSheet: () => undefined,
}))
vi.mock('@genshin-optimizer/gi/assets', () => ({ artifactAsset: () => '' }))
vi.mock('@genshin-optimizer/gi/stats', () => ({
  getCharWeaponType: () => 'catalyst',
  getWeaponStat: () => ({ rarity: 4 }),
}))
vi.mock('@genshin-optimizer/gi/theme', () => ({
  giCtaSx: {},
  giTokens: {
    hairline: 'rgba(236, 229, 216, 0.08)',
    hairlineStrong: 'rgba(236, 229, 216, 0.16)',
    panel: '#19191c',
    panelDark: '#141416',
    panelRaised: '#212124',
    panelHover: '#2a2a2e',
    parchment: '#ece5d8',
    gold: '#d3bc8e',
  },
}))
vi.mock('@genshin-optimizer/common/ui', () => ({
  CardThemed: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ModalWrapper: () => null,
  InfoTooltipInline: () => <span role="img" aria-label="Info" />,
}))
vi.mock('./WeaponChooser', () => ({
  isConditional: () => false,
  PassiveLines: () => null,
  PassiveStoreContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
  WeaponGroup: () => null,
}))
vi.mock('./MemberAvatar', () => ({ MemberAvatar: () => null }))

afterEach(cleanup)

const members = [
  { characterKey: 'Mitya' },
  { characterKey: 'Odette' },
] as TeamOptMember[]

/** The section with its settings kept as the page keeps them */
function Pool({
  onWeapons = () => {},
  onSets = () => {},
}: {
  onWeapons?: () => void
  onSets?: () => void
}) {
  const [teamOpt, set] = useState<TeamOpt>({
    kqm: { refinement4: 5, refinement5: 1 },
  } as TeamOpt)
  const setTeamOpt = (update: TeamOptUpdate) =>
    set((previous) => {
      const draft = structuredClone(previous)
      return update(draft) ?? draft
    })
  return (
    <KqmPool
      members={members}
      teamOpt={teamOpt}
      setTeamOpt={setTeamOpt}
      onWeapons={onWeapons}
      onSets={onSets}
    />
  )
}

const pill = (name: string) => screen.getByRole('button', { name })
const weaponCount = () =>
  screen.getAllByText(/ of \d+ on$/)[0].textContent ?? ''

describe('KQM Setup’s weapons and artifact sets', () => {
  it('switches a weapon group on and off from the setup, with the refinement it counts at', () => {
    render(<Pool />)
    const before = weaponCount()
    expect(pill('Battle Pass weapons').getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(pill('Battle Pass weapons').textContent).toContain('R1')
    const wish4 = pill('4★ event wish weapons')
    expect(wish4.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(wish4)
    expect(pill('4★ event wish weapons').getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(pill('4★ event wish weapons').textContent).toContain('R5')
    expect(before).toBe('4 of 9 on')
    expect(weaponCount()).toBe('7 of 9 on')
    fireEvent.click(pill('4★ event wish weapons'))
    expect(weaponCount()).toBe(before)
  })

  it('keeps the 5★ standard and event wish groups apart, and marks the list as current', () => {
    let saved: TeamOpt | undefined
    function Spy() {
      const [teamOpt, set] = useState<TeamOpt>({
        kqm: { refinement4: 5, refinement5: 1 },
      } as TeamOpt)
      saved = teamOpt
      return (
        <KqmPool
          members={members}
          teamOpt={teamOpt}
          setTeamOpt={(update) =>
            set((previous) => {
              const draft = structuredClone(previous)
              return update(draft) ?? draft
            })
          }
          onWeapons={() => {}}
          onSets={() => {}}
        />
      )
    }
    render(<Spy />)
    fireEvent.click(pill('5★ standard wish weapons'))
    expect(pill('5★ standard wish weapons').getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(pill('5★ event wish weapons').getAttribute('aria-pressed')).toBe(
      'false'
    )
    expect(saved?.kqm?.excludedWeapons).not.toContain('SkyA')
    expect(saved?.kqm?.excludedWeapons).toContain('FiveA')
    // (written for the current weapon list, so the user's own exclusions are kept as they are)
    expect(saved?.kqm?.weaponList).toBe(2)
  })

  it('opens the weapon and set choosers', () => {
    const onWeapons = vi.fn()
    const onSets = vi.fn()
    render(<Pool onWeapons={onWeapons} onSets={onSets} />)
    fireEvent.click(screen.getByRole('button', { name: 'Choose weapons' }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose sets' }))
    expect(onWeapons).toHaveBeenCalledOnce()
    expect(onSets).toHaveBeenCalledOnce()
  })
})
