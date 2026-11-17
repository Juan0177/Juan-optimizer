// @vitest-environment jsdom

import { createTheme, ThemeProvider } from '@mui/material'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { srOnly } from './compareUi'
import KqmCompare, { savedRunFor } from './KqmCompare'

const { MEMBERS, NAMES } = vi.hoisted(() => ({
  MEMBERS: ['Anastasya', 'YaeMiko', 'Odette', 'Danica'] as const,
  NAMES: {
    Anastasya: 'Anastasya',
    YaeMiko: 'Yae Miko',
    Odette: 'Odette',
    Danica: 'Danica',
    Mitya: 'Mitya',
    Furina: 'Furina',
  } as Record<string, string>,
}))
const TEXT =
  'Danica E -> Odette E E -> Yae Miko E E E -> Danica Q -> Anastasya hE N2 Q N5 E E E N2'

const mocks = vi.hoisted(() => {
  const state: {
    saved: Record<string, unknown> | undefined
    members: string[]
  } = { saved: undefined, members: [] }
  return {
    state,
    compare: vi.fn(),
    settings: vi.fn((_args: unknown): unknown => ({ error: 'unsupported' })),
    database: {
      teamKqmResults: {
        getRun: () => state.saved && structuredClone(state.saved),
      },
      teams: { get: () => ({ name: 'Tsaritsa' }) },
    },
  }
})
vi.mock('@genshin-optimizer/gi/db-ui', () => ({
  useDatabase: () => mocks.database,
  useDBMeta: () => ({ gender: 'F' }),
}))
vi.mock('@genshin-optimizer/gi/db', () => ({
  defaultTeamOptKqm: { refinement4: 5, refinement5: 1 },
  teamOptEnergyRotationFields: ['fieldTime', 'skillUses', 'favoniusProcs'],
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
    goldLight: '#e8d5ac',
    ink: '#0e0e10',
  },
}))
vi.mock('@genshin-optimizer/common/ui', () => ({
  InfoTooltipInline: ({ title }: { title: string }) => (
    <span role="img" aria-label={title} />
  ),
}))
vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    const [ns, rest] = key.includes(':') ? key.split(':') : ['', key]
    if (ns === 'charNames_gen')
      return (
        Object.entries(NAMES).find(
          ([k]) => rest === k || rest === `${k}F`
        )?.[1] ?? rest
      )
    let text = rest
    for (const [k, v] of Object.entries(options ?? {}))
      if (typeof v !== 'object') text += ` ${k}=${v}`
    return text
  }
  return {
    useTranslation: () => ({ t, i18n: { t, language: 'it' } }),
  }
})
vi.mock('@genshin-optimizer/gi/ui', async () => {
  // (the real parser: the preview is the rotation as KQM reads it)
  const parse = await vi.importActual<
    typeof import('../../../../ui/src/util/teamOpt/rotation/parse')
  >('../../../../ui/src/util/teamOpt/rotation/parse')
  return {
    parseRotation: parse.parseRotation,
    splitOnNames: parse.splitOnNames,
    CharacterName: ({ characterKey }: { characterKey: string }) => (
      <>{NAMES[characterKey] ?? characterKey}</>
    ),
    WeaponName: ({ weaponKey }: { weaponKey: string }) => <>{weaponKey}</>,
    ArtifactSetName: ({ setKey }: { setKey: string }) => <>{setKey}</>,
    statName: (key: string) => key,
    teamOptMembers: () =>
      mocks.state.members.map((characterKey) => ({ characterKey })),
    kitModels: Object.fromEntries(
      [...MEMBERS, 'Mitya', 'Furina'].map((k) => [k, {}])
    ),
    kqmWeapons: () => [
      { key: 'WanderingEvenstar', refinement: 1 },
      { key: 'WintersHeavyHeart', refinement: 1 },
    ],
    kqmSets: () => ['GildedDreams', 'NoblesseOblige'],
    kqmMemberConstellation: (
      key: string,
      kqm?: { constellations?: Record<string, number> }
    ) => kqm?.constellations?.[key] ?? 0,
    kqmEnergyRequirement: () => 100,
    isEnergyWeapon: (key: string) => key === 'WintersHeavyHeart',
    TeamOptCancelled: class extends Error {},
  }
})
vi.mock('../KqmEnergyCalculator', () => ({
  // (what it is shown, and one input set by hand)
  MemberEnergy: ({
    characterKey,
    member,
    rotationTime,
    updateMember,
  }: {
    characterKey: string
    member: { skillUses: number; favoniusProcs: number }
    rotationTime: number
    updateMember: (key: string, values: object) => void
  }) => (
    <div>
      <span data-testid="member-energy">
        {`skillUses=${member.skillUses} favoniusProcs=${member.favoniusProcs} rotationTime=${rotationTime}`}
      </span>
      <button
        type="button"
        onClick={() => updateMember(characterKey, { favoniusProcs: 3 })}
      >
        Set Favonius procs
      </button>
    </div>
  ),
  kqmEnergyEstimate: () => ({ targets: {}, members: {}, errors: [] }),
}))
vi.mock('../WeaponChooser', async () => {
  const { createContext, useContext } = await import('react')
  const PassiveStoreContext = createContext<
    | {
        get: (m: unknown, path: string[]) => string | undefined
        set: (m: unknown, path: string[], next?: string) => void
      }
    | undefined
  >(undefined)
  return {
    PassiveStoreContext,
    isConditional: (s: unknown) =>
      !!s && typeof s === 'object' && 'states' in s,
    // (one effect per item: its state, and a switch)
    PassiveLines: ({
      weaponKey,
      wielders,
    }: {
      weaponKey: string
      wielders: { characterKey: string }[]
    }) => {
      const store = useContext(PassiveStoreContext)
      const value = store?.get(wielders[0], [weaponKey, 'effect'])
      return (
        <button
          type="button"
          onClick={() =>
            store?.set(
              wielders[0],
              [weaponKey, 'effect'],
              value ? undefined : 'on'
            )
          }
        >
          {`${weaponKey} effect=${value ?? 'off'}`}
        </button>
      )
    },
  }
})
vi.mock('@genshin-optimizer/gi/sheets', () => ({
  getWeaponSheet: (key: string) => ({
    document: key === 'WanderingEvenstar' ? [{ states: { on: {} } }] : [],
  }),
  getArtSheet: () => ({ setEffectDocument: () => [] }),
}))
vi.mock('../MemberAvatar', () => ({
  MemberAvatar: () => <span />,
}))
vi.mock('./compareSwapKqm', () => ({
  compareSwapKqm: mocks.compare,
  swapSettings: mocks.settings,
}))

const build = (weapon: string) => ({
  weapon: { key: weapon, refinement: 1 },
  sets: { GildedDreams: 4 },
  mains: { sands: 'atk_', goblet: 'atk_', circlet: 'critRate_' },
  rolls: {},
})
const savedRun = () => ({
  savedAt: Date.UTC(2026, 10, 17, 13, 32),
  members: [...MEMBERS],
  run: {
    type: 'done',
    result: {
      builds: Object.fromEntries(MEMBERS.map((k) => [k, build(`${k}Weapon`)])),
      constellations: { YaeMiko: 1 },
      after: { total: 1000, members: {} },
      energyRecharge: {},
    },
    teamOpt: { attacks: {}, keep: [], rotationTime: 20, kqm: {} },
    rotation: 'played',
  },
})

const stored = new Map<string, string>()
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, String(v)),
      removeItem: (k: string) => stored.delete(k),
    },
  })
})
afterEach(() => {
  cleanup()
  stored.clear()
  mocks.compare.mockReset()
  mocks.state.saved = undefined
  mocks.state.members = []
})

const theme = createTheme({ palette: { mode: 'dark' } })
function show() {
  return render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <KqmCompare teamId="t1" />
      </ThemeProvider>
    </MemoryRouter>
  )
}
function withRun() {
  mocks.state.members = [...MEMBERS]
  mocks.state.saved = savedRun()
  stored.set('teamOptRotationText_t1', TEXT)
  stored.set('teamOptRotationOpener_t1', '')
}
const runButton = () =>
  screen.getByRole('button', { name: /^kqmCompare\.run$/ })

/** Out Yae Miko, in Mitya, fragment `E Q` (not confirmed) */
function chooseSwap() {
  fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
  const character = screen.getByRole('combobox', {
    name: /kqmCompare\.character/,
  })
  fireEvent.change(character, { target: { value: 'Mit' } })
  fireEvent.click(screen.getByRole('option', { name: 'Mitya' }))
  fireEvent.change(
    screen.getByRole('textbox', { name: /kqmCompare\.fragment/ }),
    { target: { value: 'E Q' } }
  )
}

describe('savedRunFor', () => {
  it('is the saved run while the team has the same members', () => {
    withRun()
    expect(savedRunFor(mocks.database as never, 't1')?.savedAt).toBe(
      mocks.state.saved!['savedAt']
    )
    mocks.state.members = ['Anastasya', 'Furina', 'Odette', 'Danica']
    expect(savedRunFor(mocks.database as never, 't1')).toBeUndefined()
  })
})

describe('KqmCompare', () => {
  it('without a KQM result: says so and does not run', () => {
    mocks.state.members = [...MEMBERS]
    show()
    expect(screen.getByText(/kqmCompare\.noResult/)).toBeTruthy()
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
  })

  it('enables Confronta only once the swap is chosen and A is confirmed', () => {
    withRun()
    show()
    const disabled = () => (runButton() as HTMLButtonElement).disabled
    expect(disabled()).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    expect(disabled()).toBe(true)
    const character = screen.getByRole('combobox', {
      name: /kqmCompare\.character/,
    })
    fireEvent.change(character, { target: { value: 'Mit' } })
    fireEvent.click(screen.getByRole('option', { name: 'Mitya' }))
    expect(disabled()).toBe(true)
    const fragment = screen.getByRole('textbox', {
      name: /kqmCompare\.fragment/,
    })
    fireEvent.change(fragment, { target: { value: 'E Q' } })
    expect(disabled()).toBe(true)
    fireEvent.click(
      screen.getByRole('checkbox', { name: /kqmCompare\.confirm/ })
    )
    expect(disabled()).toBe(false)
    // (an empty fragment is not valid)
    fireEvent.change(fragment, { target: { value: '  ' } })
    expect(disabled()).toBe(true)
  })

  it('shows the fixed members locked and the entering member’s controls open', () => {
    withRun()
    show()
    chooseSwap()
    const fixed = screen.getByRole('list', { name: /kqmCompare\.fixed/ })
    const rows = within(fixed).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Anastasya'),
      expect.stringContaining('Odette'),
      expect.stringContaining('Danica'),
    ])
    for (const row of rows) {
      // (the lock is read out)
      expect(within(row).getByText(/kqmCompare\.locked/)).toBeTruthy()
      expect(within(row).queryAllByRole('button')).toHaveLength(0)
      expect(within(row).queryAllByRole('combobox')).toHaveLength(0)
      expect(within(row).queryAllByRole('textbox')).toHaveLength(0)
      expect(within(row).queryAllByRole('checkbox')).toHaveLength(0)
    }
    const enabled = (el: HTMLElement) =>
      el.getAttribute('aria-disabled') !== 'true' &&
      !(el as HTMLInputElement).disabled
    expect(
      enabled(
        screen.getByRole('combobox', { name: /kqmCompare\.constellation/ })
      )
    ).toBe(true)
    const auto = screen.getByRole('checkbox', { name: /kqmCompare\.auto/ })
    expect(enabled(auto)).toBe(true)
    // weapon and sets: chosen by hand once Auto is off
    if ((auto as HTMLInputElement).checked) fireEvent.click(auto)
    expect(
      enabled(screen.getByRole('combobox', { name: /kqmCompare\.weapon/ }))
    ).toBe(true)
    expect(
      enabled(screen.getByRole('combobox', { name: /kqmCompare\.refinement/ }))
    ).toBe(true)
    expect(
      enabled(screen.getByRole('combobox', { name: /kqmCompare\.sets/ }))
    ).toBe(true)
    expect(
      enabled(screen.getByRole('radio', { name: /kqmCompare\.buildKqm/ }))
    ).toBe(true)
    // (an existing build: shown, not available yet)
    expect(
      enabled(screen.getByRole('radio', { name: /kqmCompare\.buildExisting/ }))
    ).toBe(false)
  })

  it('previews B’s rotation with the replaced step marked', () => {
    withRun()
    show()
    chooseSwap()
    const preview = screen.getByLabelText(/kqmCompare\.preview/)
    expect(preview.textContent).toContain(
      'Danica E -> Odette E E -> Mitya E Q -> Danica Q -> Anastasya hE N2 Q N5 E E E N2'
    )
    const mark = preview.querySelector('mark')
    expect(mark?.textContent).toBe('Mitya E Q')
  })

  it('cancels the run when the tab is left', async () => {
    withRun()
    let isCancelled: (() => boolean) | undefined
    mocks.compare.mockImplementation((args: { isCancelled: () => boolean }) => {
      isCancelled = args.isCancelled
      return new Promise(() => {})
    })
    const { unmount } = show()
    chooseSwap()
    fireEvent.click(
      screen.getByRole('checkbox', { name: /kqmCompare\.confirm/ })
    )
    await act(async () => {
      fireEvent.click(runButton())
    })
    await waitFor(() => expect(mocks.compare).toHaveBeenCalledTimes(1))
    expect(isCancelled?.()).toBe(false)
    // (Cancel stays reachable while the form is disabled)
    const cancel = screen.getByRole('button', { name: 'kqmCompare.cancel' })
    expect((cancel as HTMLButtonElement).disabled).toBe(false)
    unmount()
    expect(isCancelled?.()).toBe(true)
  })

  it('shows A against B, the swapped member’s row named for both, a short ER flagged', async () => {
    withRun()
    const member = (
      key: string,
      damage: number,
      er: number,
      erValue: number
    ) => ({
      key,
      damage,
      share: damage / 1000,
      er,
      erValue,
      constellation: 0,
      fixed: key !== 'YaeMiko' && key !== 'Mitya',
    })
    mocks.compare.mockResolvedValue({
      a: {
        dpr: 1000,
        dps: 50,
        rotationTime: 20,
        rotation: TEXT,
        members: [
          member('Anastasya', 500, 135, 140),
          member('YaeMiko', 300, 120, 125),
          member('Odette', 100, 140, 141),
          member('Danica', 100, 160, 161),
        ],
      },
      b: {
        dpr: 900,
        dps: 45,
        rotationTime: 20,
        rotation: TEXT,
        members: [
          member('Anastasya', 520, 150, 140),
          member('Mitya', 180, 110, 112),
          member('Odette', 100, 140, 141),
          member('Danica', 100, 160, 161),
        ],
      },
    })
    show()
    chooseSwap()
    fireEvent.click(
      screen.getByRole('checkbox', { name: /kqmCompare\.confirm/ })
    )
    await act(async () => {
      fireEvent.click(runButton())
    })
    const table = await screen.findByRole('table')
    expect(
      within(table).getAllByText(/Yae Miko → Mitya/).length
    ).toBeGreaterThan(0)
    expect(within(table).getAllByText(/^−10(\.0)?%$/).length).toBeGreaterThan(0)
    // both ER figures, each with its own label: the target and what the build reaches
    expect(
      within(table).getAllByText('kqmCompare.table.erTarget')
    ).toHaveLength(4)
    expect(within(table).getAllByText('kqmCompare.table.erBuild')).toHaveLength(
      4
    )
    expect(within(table).getAllByText('150%').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('140%').length).toBeGreaterThan(0)
    // (Anastasya keeps A's build: 140% no longer reaches B's 150%)
    expect(within(table).getByText(/kqmCompare\.table\.erShort/)).toBeTruthy()
  })

  it('shows a message when the comparison fails, without leaving the tab', async () => {
    withRun()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.compare.mockRejectedValue(
      new Error('The saved KQM result is for other team members.')
    )
    show()
    chooseSwap()
    fireEvent.click(
      screen.getByRole('checkbox', { name: /kqmCompare\.confirm/ })
    )
    await act(async () => {
      fireEvent.click(runButton())
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('kqmCompare.error.failed')
    expect(runButton()).toBeTruthy()
    quiet.mockRestore()
  })

  it('keeps the ER calculator panel current when the fragment changes after an edit', async () => {
    withRun()
    const saved = mocks.state.saved as { run: { teamOpt: { kqm: object } } }
    saved.run.teamOpt.kqm = {
      energySource: 'calculator',
      energyCalculator: { rotationTime: 20, members: {} },
    }
    // B's settings as the comparison would run them: the rotation's counts, the inputs set by
    // hand kept, its calculator per B's played time
    mocks.settings.mockImplementation((args) => {
      const { fragment, swapIn } = args as {
        fragment: string
        swapIn: {
          kqm?: {
            energyCalculator?: {
              members: Record<
                string,
                { favoniusProcs: number; edited?: string[] }
              >
            }
          }
        }
      }
      const own = swapIn.kqm?.energyCalculator?.members['Mitya']
      const long = fragment === 'E E E Q'
      return {
        teamOpt: {
          kqm: {
            energySource: 'calculator',
            energyCalculator: {
              rotationTime: long ? 23 : 21,
              members: {
                Mitya: {
                  fieldTime: 12,
                  skillUses: long ? 3 : 1,
                  favoniusProcs: own?.edited?.includes('favoniusProcs')
                    ? own.favoniusProcs
                    : long
                      ? 2
                      : 1,
                },
              },
            },
          },
        },
        keys: ['Anastasya', 'Mitya', 'Odette', 'Danica'],
        rules: {},
      }
    })
    show()
    chooseSwap()
    fireEvent.click(
      screen.getByRole('button', { name: /kqmCompare\.settings/ })
    )
    const shown = () => screen.getByTestId('member-energy').textContent
    await waitFor(() =>
      expect(shown()).toBe('skillUses=1 favoniusProcs=1 rotationTime=21')
    )
    fireEvent.click(screen.getByRole('button', { name: 'Set Favonius procs' }))
    // (at once, while B's settings are worked out again)
    expect(shown()).toContain('favoniusProcs=3')
    fireEvent.change(
      screen.getByRole('textbox', { name: /kqmCompare\.fragment/ }),
      { target: { value: 'E E E Q' } }
    )
    // the rotation's counts and B's length follow the new fragment; the edit stays
    await waitFor(() =>
      expect(shown()).toBe('skillUses=3 favoniusProcs=3 rotationTime=23')
    )
    mocks.settings.mockReset()
  })

  it('passes the entering member’s effects, energy weapons and 2 + 2 sets to the comparison', async () => {
    withRun()
    // (a teammate holds the energy weapon)
    ;(
      mocks.state.saved as {
        run: { result: { builds: Record<string, { weapon: { key: string } }> } }
      }
    ).run.result.builds['Odette'].weapon.key = 'WintersHeavyHeart'
    mocks.settings.mockImplementation(() => ({
      teamOpt: { kqm: {} },
      keys: ['Anastasya', 'Mitya', 'Odette', 'Danica'],
      // (counted by rule: on)
      rules: { WanderingEvenstar: { effect: 'on' } },
    }))
    mocks.compare.mockReturnValue(new Promise(() => {}))
    show()
    chooseSwap()
    // weapon and 2 + 2 sets by hand
    fireEvent.click(screen.getByRole('checkbox', { name: /kqmCompare\.auto/ }))
    const pick = (name: RegExp, option: string) => {
      fireEvent.mouseDown(screen.getByRole('combobox', { name }))
      fireEvent.click(screen.getByRole('option', { name: option }))
    }
    pick(/kqmCompare\.weapon/, 'WanderingEvenstar')
    fireEvent.click(screen.getByRole('radio', { name: 'kqmCompare.sets22' }))
    pick(/^kqmCompare\.sets\b/, 'GildedDreams')
    pick(/kqmCompare\.sets2/, 'NoblesseOblige')
    fireEvent.click(
      screen.getByRole('button', { name: /kqmCompare\.settings/ })
    )
    // its weapon's effect: the rule's state until switched here
    const effect = await screen.findByRole('button', {
      name: 'WanderingEvenstar effect=on',
    })
    fireEvent.click(effect)
    expect(
      screen.getByRole('button', { name: 'WanderingEvenstar effect=off' })
    ).toBeTruthy()
    // a teammate's or its own energy weapon: how much less ER it needs
    fireEvent.change(
      screen.getByRole('textbox', {
        name: /kqmCompare\.weaponEnergyField/,
      }),
      { target: { value: '20' } }
    )
    fireEvent.click(
      screen.getByRole('checkbox', { name: /kqmCompare\.confirm/ })
    )
    await act(async () => {
      fireEvent.click(runButton())
    })
    await waitFor(() => expect(mocks.compare).toHaveBeenCalledTimes(1))
    const { swapIn } = mocks.compare.mock.calls[0][0]
    expect(swapIn.weapon).toEqual({ key: 'WanderingEvenstar', refinement: 1 })
    expect(swapIn.sets).toEqual({ GildedDreams: 2, NoblesseOblige: 2 })
    expect(swapIn.kqm.passives).toEqual({
      Mitya: { WanderingEvenstar: { effect: '' } },
    })
    // (Odette's Winter's Heavy Heart, the energy weapon here)
    expect(swapIn.kqm.weaponEnergy).toEqual({
      WintersHeavyHeart: { Mitya: 20 },
    })
    mocks.settings.mockReset()
  })

  it('while running: the form locked, the progress bar silent, A’s date in the confirmation', async () => {
    withRun()
    mocks.compare.mockReturnValue(new Promise(() => {}))
    show()
    chooseSwap()
    const confirm = screen.getByRole('checkbox', {
      name: /kqmCompare\.confirm/,
    })
    expect(confirm.closest('label')?.textContent).toMatch(/date=\S/)
    fireEvent.click(confirm)
    await act(async () => {
      fireEvent.click(runButton())
    })
    expect(
      screen
        .getByRole('combobox', { name: /kqmCompare\.constellation/ })
        .getAttribute('aria-disabled')
    ).toBe('true')
    expect(
      screen
        .getByRole('progressbar', { hidden: true })
        .getAttribute('aria-hidden')
    ).toBe('true')
  })

  it('warns when A was not played from the written rotation', () => {
    withRun()
    ;(mocks.state.saved as { run: { rotation: string } }).run.rotation =
      'entered'
    show()
    expect(screen.getByText('kqmCompare.notPlayed')).toBeTruthy()
  })

  it('says a refused fragment once, under the fragment, and points Confronta to it', () => {
    withRun()
    stored.set('teamOptRotationText_t1', `${TEXT} -> Yae Miko E`)
    show()
    chooseSwap()
    fireEvent.click(
      screen.getByRole('checkbox', { name: /kqmCompare\.confirm/ })
    )
    const message = screen.getAllByText(/kqmCompare\.error\.repeated/)
    expect(message).toHaveLength(1)
    const button = runButton() as HTMLButtonElement
    expect(button.disabled).toBe(true)
    const describedBy = button.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy!)?.textContent).toContain(
      'kqmCompare.error.repeated'
    )
  })
})

describe('srOnly', () => {
  // (MUI's sx reads 1 as 100%: the hidden text would widen the page)
  it('is the standard visually-hidden recipe, in pixels', () => {
    expect(srOnly).toMatchObject({
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: 0,
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0 0 0 0)',
      whiteSpace: 'nowrap',
      border: 0,
    })
  })
})
