// @vitest-environment jsdom

import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type {
  ICachedWeapon,
  TeamOptEnergyCalculator,
} from '@genshin-optimizer/gi/db'
import type { TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  defaultEnergyCalculator,
  updateEnergyCalcMember,
} from '@genshin-optimizer/gi/ui'
import { createTheme, ThemeProvider } from '@mui/material'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeaponCalcEnergyConfig } from './WeaponChooser'
import { isDefaultVisibleWeapon, WeaponGroup } from './WeaponChooser'

vi.mock('@genshin-optimizer/gi/db-ui', () => ({
  useDatabase: () => ({}),
  useDBMeta: () => ({ gender: 'F' }),
  useOptConfig: () => undefined,
  useTeamChar: () => undefined,
}))
vi.mock('@genshin-optimizer/gi/sheets', () => ({
  getWeaponSheet: () => undefined,
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      let text =
        typeof options === 'string'
          ? options
          : String(
              options?.['defaultValue'] ??
                options?.['defaultValue_other'] ??
                key.split('.').at(-1)
            )
      if (typeof options === 'object') {
        if (options['count'] === 1 && options['defaultValue_one'])
          text = String(options['defaultValue_one'])
        for (const [k, v] of Object.entries(options))
          text = text.replaceAll(`{{${k}}}`, String(v))
      }
      return text
    },
  }),
}))
vi.mock('./MemberAvatar', () => ({
  MemberAvatar: ({ characterKey }: { characterKey: string }) => (
    <span data-avatar={characterKey} />
  ),
}))
vi.mock('@genshin-optimizer/gi/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  CharacterName: ({ characterKey }: { characterKey: string }) => (
    <>{characterKey}</>
  ),
  WeaponName: ({ weaponKey }: { weaponKey: string }) => <>{weaponKey}</>,
}))

afterEach(cleanup)

const theme = createTheme({ palette: { mode: 'dark' } })

const memberOf = (characterKey: CharacterKey) =>
  ({
    characterKey,
    teamCharId: `tc_${characterKey}`,
    teamChar: { optConfigId: `opt_${characterKey}` },
  }) as unknown as TeamOptMember

const swordMembers = [memberOf('Skirk'), memberOf('Furina')]
const allMembers = [...swordMembers, memberOf('Escoffier'), memberOf('Shenhe')]

const sword = (id: string, key: WeaponKey, refinement = 1): ICachedWeapon => ({
  id,
  key,
  level: 90,
  ascension: 6,
  refinement: refinement as ICachedWeapon['refinement'],
  location: '',
  lock: false,
})

const swords = [
  sword('w_azure', 'Azurelight', 1),
  sword('w_pjc', 'PrimordialJadeCutter', 1),
  sword('w_fav', 'FavoniusSword', 5),
]

function Harness({
  initialExcluded = [] as string[],
  initialExcludedMembers = {} as Record<string, CharacterKey[]>,
  calculatorMode = false,
  initialFavProcs = 1,
  onOpenCalculator,
  members = swordMembers,
  teamMembers = allMembers,
}: {
  initialExcluded?: string[]
  initialExcludedMembers?: Record<string, CharacterKey[]>
  calculatorMode?: boolean
  initialFavProcs?: number
  onOpenCalculator?: () => void
  members?: TeamOptMember[]
  teamMembers?: TeamOptMember[]
}) {
  const [excluded, setExcluded] = useState<string[]>(initialExcluded)
  const [excludedMembers, setExcludedMembers] = useState<
    Record<string, CharacterKey[]>
  >(initialExcludedMembers)
  const [weaponEnergy, setWeaponEnergy] = useState<
    Record<string, Partial<Record<CharacterKey, number>>>
  >({})
  const keys = teamMembers.map((m) => m.characterKey)
  const [calc, setCalc] = useState<TeamOptEnergyCalculator>(() => {
    const base = defaultEnergyCalculator(keys, 20, 'Skirk')
    base.members.Furina!.favoniusProcs = initialFavProcs
    base.members.Furina!.edited = ['favoniusProcs']
    base.members.Skirk!.favoniusProcs = 0
    return base
  })

  const onToggle = (weapon: ICachedWeapon) => {
    const exclSet = new Set(excluded)
    const blocked = excludedMembers[weapon.id]
    const ticked =
      !exclSet.has(weapon.id) &&
      (!blocked?.length ||
        members.some((m) => !blocked.includes(m.characterKey)))
    setExcluded(
      ticked
        ? [...new Set([...excluded, weapon.id])]
        : excluded.filter((id) => id !== weapon.id)
    )
    setExcludedMembers((prev) => {
      const next = { ...prev }
      delete next[weapon.id]
      return next
    })
  }

  const onToggleMember = (weapon: ICachedWeapon, ck: CharacterKey) => {
    const exclSet = new Set(excluded)
    const blocked = excludedMembers[weapon.id]
    const ticked =
      !exclSet.has(weapon.id) &&
      (!blocked?.length ||
        members.some((m) => !blocked.includes(m.characterKey)))
    if (!ticked) {
      setExcluded((prev) => prev.filter((id) => id !== weapon.id))
      const others = members.map((m) => m.characterKey).filter((k) => k !== ck)
      setExcludedMembers((prev) => ({ ...prev, [weapon.id]: others }))
      return
    }
    const nextSet = new Set(blocked ?? [])
    if (nextSet.has(ck)) nextSet.delete(ck)
    else nextSet.add(ck)
    if (!members.some((m) => !nextSet.has(m.characterKey))) {
      setExcluded((prev) => [...new Set([...prev, weapon.id])])
      setExcludedMembers((prev) => {
        const next = { ...prev }
        delete next[weapon.id]
        return next
      })
    } else {
      setExcludedMembers((prev) => {
        const next = { ...prev }
        if (nextSet.size) next[weapon.id] = [...nextSet]
        else delete next[weapon.id]
        return next
      })
    }
  }

  const calcEnergy: WeaponCalcEnergyConfig | undefined = calculatorMode
    ? {
        calculator: calc,
        updateMember: (ck, values) =>
          setCalc((prev) => updateEnergyCalcMember(prev, keys, ck, values)),
        onOpenCalculator,
      }
    : undefined

  return (
    <ThemeProvider theme={theme}>
      <WeaponGroup
        type="sword"
        typeName="Sword"
        members={members}
        teamMembers={teamMembers}
        weapons={swords}
        teamData={undefined}
        excluded={new Set(excluded)}
        excludedMembers={excludedMembers}
        onToggle={onToggle}
        onToggleMember={onToggleMember}
        weaponEnergy={weaponEnergy}
        setWeaponEnergy={(id, ck, val) =>
          setWeaponEnergy((prev) => ({
            ...prev,
            [id]: { ...prev[id], [ck]: val },
          }))
        }
        memberMinEr={{ Furina: 180, Escoffier: 170 }}
        calcEnergy={calcEnergy}
        onOpenCalculator={onOpenCalculator}
        virtual
      />
    </ThemeProvider>
  )
}

describe('WeaponGroup per-member weapon restrictions', () => {
  it('shows Usable by toggles when 2+ members share a weapon type and lets you exclude Skirk from Favonius', () => {
    render(<Harness />)
    const favCard = document.querySelector('[data-weapon-id="w_fav"]')!
    expect(within(favCard as HTMLElement).getByText('Usable by')).toBeTruthy()
    const skirkBtn = within(favCard as HTMLElement).getByRole('button', {
      name: 'Allow Skirk to use FavoniusSword',
    })
    const furinaBtn = within(favCard as HTMLElement).getByRole('button', {
      name: 'Allow Furina to use FavoniusSword',
    })
    expect(skirkBtn.getAttribute('aria-pressed')).toBe('true')
    expect(furinaBtn.getAttribute('aria-pressed')).toBe('true')
    // Exclude Skirk: Favonius stays ticked, allowed only for Furina
    fireEvent.click(skirkBtn)
    expect(skirkBtn.getAttribute('aria-pressed')).toBe('false')
    expect(furinaBtn.getAttribute('aria-pressed')).toBe('true')
    expect(
      (within(favCard as HTMLElement).getByRole('checkbox') as HTMLInputElement)
        .checked
    ).toBe(true)
    // Excluding the last allowed member unticks the weapon
    fireEvent.click(furinaBtn)
    expect(
      (within(favCard as HTMLElement).getByRole('checkbox') as HTMLInputElement)
        .checked
    ).toBe(false)
  })

  it('ticks an unticked weapon for one member in a single click and warns if a member has none', () => {
    render(<Harness initialExcluded={['w_azure', 'w_pjc', 'w_fav']} />)
    const favCard = document.querySelector('[data-weapon-id="w_fav"]')!
    const furinaBtn = within(favCard as HTMLElement).getByRole('button', {
      name: 'Allow Furina to use FavoniusSword',
    })
    // 1 click enables Favonius for Furina ONLY
    fireEvent.click(furinaBtn)
    expect(furinaBtn.getAttribute('aria-pressed')).toBe('true')
    expect(
      within(favCard as HTMLElement)
        .getByRole('button', { name: 'Allow Skirk to use FavoniusSword' })
        .getAttribute('aria-pressed')
    ).toBe('false')
    // Warns specifically that Skirk has no weapons ticked
    expect(screen.getByText(/Skirk/)).toBeTruthy()
    expect(screen.getByText(/select at least one weapon/)).toBeTruthy()
  })

  it('hides Usable by when only one member wields the weapon type', () => {
    render(<Harness members={[memberOf('Skirk')]} />)
    expect(screen.queryByText('Usable by')).toBeNull()
  })
})

describe('WeaponGroup ER & Favonius energy UX', () => {
  it('in ER calculator mode, shows live Favonius savings and lets you edit triggers right on the card', () => {
    const onOpenCalculator = vi.fn()
    render(
      <Harness
        calculatorMode
        initialExcludedMembers={{ w_fav: ['Skirk'] }}
        initialFavProcs={1}
        onOpenCalculator={onOpenCalculator}
      />
    )
    const favCard = document.querySelector('[data-weapon-id="w_fav"]')!
    // Shows live calculated −X savings right on the pill for Furina-only Favonius
    const energyBtn = within(favCard as HTMLElement).getByRole('button', {
      name: /−\d/,
    })
    fireEvent.click(energyBtn)
    // Opens ER calculator panel (NOT dead manual "ER needed" inputs)
    expect(
      within(favCard as HTMLElement).getByText('ER calculator (per build)')
    ).toBeTruthy()
    expect(within(favCard as HTMLElement).queryByText('Less ER')).toBeNull()
    expect(
      within(favCard as HTMLElement).getAllByText(/→/).length
    ).toBeGreaterThan(0)
    // Stepping triggers to 0 updates the card immediately to warn about 0 triggers
    fireEvent.click(
      within(favCard as HTMLElement).getByRole('button', {
        name: 'Furina triggers per rotation −1',
      })
    )
    expect(
      within(favCard as HTMLElement).getByText(
        /Set triggers above 0 to count this weapon’s energy/
      )
    ).toBeTruthy()
    // Shortcut opens the full ER calculator
    fireEvent.click(
      within(favCard as HTMLElement).getByRole('button', {
        name: 'ER calculator',
      })
    )
    expect(onOpenCalculator).toHaveBeenCalledOnce()
  })

  it('in manual ER mode, shows Less ER with positive −% input, live resulting Min ER and Calculate ER shortcut', () => {
    const onOpenCalculator = vi.fn()
    render(
      <Harness calculatorMode={false} onOpenCalculator={onOpenCalculator} />
    )
    const favCard = document.querySelector('[data-weapon-id="w_fav"]')!
    fireEvent.click(within(favCard as HTMLElement).getByText('Energy'))
    expect(within(favCard as HTMLElement).getByText('Less ER')).toBeTruthy()
    // Shows current Min ER for Furina (180%) and "No min ER" for Skirk
    expect(within(favCard as HTMLElement).getByText('180%')).toBeTruthy()
    expect(
      within(favCard as HTMLElement).getAllByText('No min ER').length
    ).toBeGreaterThan(0)
    // Typing 26 shows → 154% live
    const furinaInput = within(favCard as HTMLElement).getByLabelText(
      'Furina ER reduction (%)'
    )
    fireEvent.change(furinaInput, { target: { value: '26' } })
    fireEvent.blur(furinaInput)
    expect(within(favCard as HTMLElement).getByText('→ 154%')).toBeTruthy()
    // Shortcut to ER calculator
    fireEvent.click(within(favCard as HTMLElement).getByText('Calculate ER'))
    expect(onOpenCalculator).toHaveBeenCalledOnce()
  })
})

describe('isDefaultVisibleWeapon', () => {
  it('shows only 3★–5★ weapons at level 70 and above by default', () => {
    expect(isDefaultVisibleWeapon({ key: 'DullBlade', level: 70 })).toBe(false)
    expect(isDefaultVisibleWeapon({ key: 'SilverSword', level: 70 })).toBe(
      false
    )
    expect(isDefaultVisibleWeapon({ key: 'HarbingerOfDawn', level: 69 })).toBe(
      false
    )
    expect(isDefaultVisibleWeapon({ key: 'HarbingerOfDawn', level: 70 })).toBe(
      true
    )
    expect(isDefaultVisibleWeapon({ key: 'FavoniusSword', level: 60 })).toBe(
      false
    )
    expect(isDefaultVisibleWeapon({ key: 'FavoniusSword', level: 70 })).toBe(
      true
    )
    expect(
      isDefaultVisibleWeapon({ key: 'PrimordialJadeCutter', level: 1 })
    ).toBe(false)
    expect(
      isDefaultVisibleWeapon({ key: 'PrimordialJadeCutter', level: 90 })
    ).toBe(true)
  })
})
