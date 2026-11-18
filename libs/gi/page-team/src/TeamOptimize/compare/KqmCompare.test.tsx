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
import { Overview } from './CompareOverview'
import { CompareSwapFailure } from './compareError'
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
    /** A KQM Theorycrafting run of the team in progress */
    kqmRunning: boolean
    /** The saved results as the database entry gives them (a new object on each save) */
    results: object
  } = { saved: undefined, members: [], kqmRunning: false, results: {} }
  const listeners = new Set<() => void>()
  const resultListeners = new Set<(reason: string) => void>()
  return {
    state,
    compare: vi.fn(),
    /** The comparison card's data, as asked for (its context: the stats given) */
    cardData: vi.fn((_a: unknown, _b: unknown, ctx: { teamName: string }) => ({
      name: ctx.teamName,
      a: { card: { members: [] }, marks: {} },
      b: { card: { members: [] }, marks: {} },
    })),
    /** A member's stats out of combat: what it was asked with */
    outOfCombat: vi.fn(
      (db: { name?: string }, key: string, build: unknown, opts: object) => ({
        db: db.name ?? 'user',
        key,
        build,
        ...opts,
      })
    ),
    /** The card dialogs' hidden records */
    records: [] as Record<string, unknown>[],
    /** The props B's KQM results were last shown with */
    results: [] as Record<string, unknown>[],
    settings: vi.fn((_args: unknown): unknown => ({ error: 'unsupported' })),
    replay: vi.fn((..._args: unknown[]): unknown => undefined),
    listeners,
    /** KQM Theorycrafting's run starts or ends */
    setKqmRunning(running: boolean) {
      state.kqmRunning = running
      for (const l of listeners) l()
    },
    /** KQM Theorycrafting saves a result */
    saveResult(saved: Record<string, unknown> | undefined) {
      state.saved = saved
      state.results = {}
      for (const l of resultListeners) l('update')
    },
    database: {
      teamKqmResults: {
        getRun: () => state.saved && structuredClone(state.saved),
        get: () => state.results,
        follow: (callback: (reason: string) => void) => {
          resultListeners.add(callback)
          return () => resultListeners.delete(callback)
        },
      },
      teams: { get: () => ({ name: 'Tsaritsa' }) },
    },
  }
})
vi.mock('../useKqmRun', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useKqmRunning: () =>
      useSyncExternalStore(
        (onChange: () => void) => {
          mocks.listeners.add(onChange)
          return () => mocks.listeners.delete(onChange)
        },
        () => mocks.state.kqmRunning
      ),
    kqmReplayOf: mocks.replay,
  }
})
vi.mock('../RotationWriter', () => ({
  storageKey: (teamId: string) => `teamOptRotationText_${teamId}`,
  openerKey: (teamId: string) => `teamOptRotationOpener_${teamId}`,
}))
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
    matchMember: parse.matchMember,
    CharacterName: ({ characterKey }: { characterKey: string }) => (
      <>{NAMES[characterKey] ?? characterKey}</>
    ),
    WeaponName: ({ weaponKey }: { weaponKey: string }) => <>{weaponKey}</>,
    ArtifactSetName: ({ setKey }: { setKey: string }) => <>{setKey}</>,
    statName: (key: string) => key,
    // (a team B sandbox lists its own members)
    teamOptMembers: (db?: { members?: string[] }) =>
      (db?.members ?? mocks.state.members).map((characterKey) => ({
        characterKey,
      })),
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
    kqmSimGear: (build: unknown) => build,
    isEnergyWeapon: (key: string) => key === 'WintersHeavyHeart',
    TeamOptCancelled: class extends Error {},
    // (the comparison card's dialog: its header, its height, its hidden record)
    CardImageDialog: ({
      title,
      aspectRatio,
      header,
      watermark,
    }: {
      title: string
      aspectRatio: string
      header?: React.ReactNode
      watermark: () => Record<string, unknown>
    }) => (
      <div role="dialog" aria-label={title} data-aspect={aspectRatio}>
        {header}
        <button type="button" onClick={() => mocks.records.push(watermark())}>
          record
        </button>
      </div>
    ),
    KQM_COMPARE_CARD_WIDTH: 1760,
    KQM_COMPARE_CARD_HEIGHT: 1208,
    kqmCompareCardHeight: () => 1700,
    renderKqmCompareCard: vi.fn(),
    safeName: (s: string) => s,
    KQM_TALENT_DEFAULT: 9,
    // (the card's hidden record)
    currentRelease: { version: 'test' },
    BETA_KEYS: new Set(),
    kqmOutOfCombatStats: mocks.outOfCombat,
  }
})
vi.mock('./compareCardData', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./compareCardData')>()),
  compareCardData: mocks.cardData,
}))
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
vi.mock('../KqmMode', () => ({
  KqmResults: (props: Record<string, unknown>) => {
    mocks.results.push(props)
    return <div data-testid="kqm-results" />
  },
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
  mocks.replay.mockReset()
  mocks.results.length = 0
  mocks.records.length = 0
  mocks.cardData.mockClear()
  mocks.outOfCombat.mockClear()
  mocks.state.saved = undefined
  mocks.state.members = []
  mocks.state.kqmRunning = false
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
const confirmBox = () =>
  screen.getByRole('checkbox', {
    name: /kqmCompare\.confirm/,
  }) as HTMLInputElement
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
    // (the columns: the two members, by name only)
    expect(
      within(table).getByRole('columnheader', {
        name: 'kqmCompare.table.a name=Yae Miko',
      })
    ).toBeTruthy()
    expect(
      within(table).getByRole('columnheader', {
        name: 'kqmCompare.table.b name=Mitya',
      })
    ).toBeTruthy()
    expect(within(table).getAllByText(/^−10(,0)?%$/).length).toBeGreaterThan(0)
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

describe('KqmCompare: A kept current', () => {
  it('blocks Confronta while KQM Theorycrafting runs, and reads A again when it ends', async () => {
    withRun()
    mocks.state.kqmRunning = true
    show()
    chooseSwap()
    fireEvent.click(confirmBox())
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('kqmCompare.kqmRunning')).toBeTruthy()
    const first = screen.getByText(/kqmCompare\.resultOf/).textContent
    // (the run ends and saves its result a moment later)
    act(() => mocks.setKqmRunning(false))
    act(() =>
      mocks.saveResult({
        ...savedRun(),
        savedAt: Date.UTC(2026, 10, 17, 15, 5),
      })
    )
    expect(screen.queryByText('kqmCompare.kqmRunning')).toBeNull()
    expect(screen.getByText(/kqmCompare\.resultOf/).textContent).not.toBe(first)
    // (the confirmation was for the result before)
    expect(confirmBox().checked).toBe(false)
    expect(screen.getByText('kqmCompare.error.resultChanged')).toBeTruthy()
    expect((runButton() as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirmBox())
    expect((runButton() as HTMLButtonElement).disabled).toBe(false)
  })

  it('refuses to start when A changed after it was confirmed', async () => {
    withRun()
    mocks.compare.mockReturnValue(new Promise(() => {}))
    show()
    chooseSwap()
    fireEvent.click(confirmBox())
    // (saved meanwhile, not announced yet)
    mocks.state.saved = {
      ...savedRun(),
      savedAt: Date.UTC(2026, 10, 17, 15, 5),
    }
    await act(async () => {
      fireEvent.click(runButton())
    })
    expect(mocks.compare).not.toHaveBeenCalled()
    expect(confirmBox().checked).toBe(false)
    expect(screen.getByText('kqmCompare.error.resultChanged')).toBeTruthy()
  })
})

describe('KqmCompare: the result', () => {
  const side = (dpr: number) => ({
    dpr,
    dps: dpr / 20,
    rotationTime: 20,
    rotation: TEXT,
    members: [],
  })
  async function runOnce() {
    show()
    chooseSwap()
    fireEvent.click(confirmBox())
    await act(async () => {
      fireEvent.click(runButton())
    })
  }

  it('says when it is for settings changed since, and holds the card until run again', async () => {
    withRun()
    mocks.compare.mockResolvedValue({ a: side(1000), b: side(900) })
    await runOnce()
    await screen.findByRole('table')
    const card = () =>
      screen.getByRole('button', {
        name: 'kqmCompare.card.create',
      }) as HTMLButtonElement
    expect(screen.queryByText('kqmCompare.staleResult')).toBeNull()
    expect(card().disabled).toBe(false)
    fireEvent.change(
      screen.getByRole('textbox', { name: /kqmCompare\.fragment/ }),
      { target: { value: 'E E Q' } }
    )
    expect(screen.getByText('kqmCompare.staleResult')).toBeTruthy()
    expect(card().disabled).toBe(true)
    // (back to the settings it was run with: current again)
    fireEvent.change(
      screen.getByRole('textbox', { name: /kqmCompare\.fragment/ }),
      { target: { value: 'E Q' } }
    )
    expect(screen.queryByText('kqmCompare.staleResult')).toBeNull()
    expect(card().disabled).toBe(false)
  })

  it('says a known failure in the user’s language', async () => {
    withRun()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.compare.mockRejectedValue(
      new CompareSwapFailure(
        'otherMembers',
        'The saved KQM result is for other team members.'
      )
    )
    await runOnce()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('kqmCompare.error.otherMembers')
    expect(alert.textContent).not.toContain('other team members')
    quiet.mockRestore()
  })

  it('says how many times the leaving member appears', async () => {
    withRun()
    mocks.compare.mockResolvedValue({ error: 'repeated', count: 3 })
    await runOnce()
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('count=3')
  })
})

describe('KqmCompare: the card’s view (Normal | Detailed)', () => {
  const member = (key: string, constellation: number, fixed: boolean) => ({
    key,
    damage: 500,
    share: 0.5,
    er: 120,
    erValue: 121,
    constellation,
    fixed,
    build: build(`${key}Weapon`),
  })
  const side = (members: ReturnType<typeof member>[]) => ({
    dpr: 1000,
    dps: 50,
    rotationTime: 20,
    rotation: TEXT,
    talents: 10,
    members,
  })
  const sandbox = { name: 'sandbox', members: [...MEMBERS] }
  async function openCard() {
    withRun()
    mocks.compare.mockResolvedValue({
      a: side([member('Danica', 2, true), member('YaeMiko', 0, false)]),
      b: side([member('Danica', 2, true), member('Mitya', 1, false)]),
      resultB: { builds: {}, after: { total: 1000, members: {} } },
      sandbox,
      teamOptB: { attacks: {}, keep: [], rotationTime: 20, kqm: {} },
      rotationB: {},
    })
    show()
    chooseSwap()
    fireEvent.click(confirmBox())
    await act(async () => {
      fireEvent.click(runButton())
    })
    fireEvent.click(
      await screen.findByRole('button', { name: 'kqmCompare.card.create' })
    )
    return screen.getByRole('dialog', { name: 'kqmCompare.card.title' })
  }
  const lastCtx = () =>
    mocks.cardData.mock.calls.at(-1)![2] as unknown as Record<string, unknown>

  it('is Normal at first: no stats worked out, the usual height', async () => {
    const dialog = await openCard()
    const group = within(dialog).getByRole('radiogroup', {
      name: 'teamOpt.card.view.label',
    })
    expect(
      within(group)
        .getByRole('radio', { name: 'teamOpt.card.view.normal' })
        .getAttribute('aria-checked')
    ).toBe('true')
    expect(lastCtx()['statsA']).toBeUndefined()
    expect(lastCtx()['statsB']).toBeUndefined()
    expect(mocks.outOfCombat).not.toHaveBeenCalled()
    expect(dialog.getAttribute('data-aspect')).toBe('1760 / 1208')
  })
  it('Detailed: A’s stats on the user’s database, B’s on its sandbox, remembered', async () => {
    const dialog = await openCard()
    fireEvent.click(
      within(dialog).getByRole('radio', { name: 'teamOpt.card.view.detailed' })
    )
    // (each side's builds and constellations, the run's KQM talents for both)
    expect(lastCtx()['statsA']).toEqual({
      Danica: {
        db: 'user',
        key: 'Danica',
        build: build('DanicaWeapon'),
        constellation: 2,
        talent: 10,
      },
      YaeMiko: {
        db: 'user',
        key: 'YaeMiko',
        build: build('YaeMikoWeapon'),
        constellation: 0,
        talent: 10,
      },
    })
    expect(lastCtx()['statsB']).toEqual({
      Danica: {
        db: 'sandbox',
        key: 'Danica',
        build: build('DanicaWeapon'),
        constellation: 2,
        talent: 10,
      },
      Mitya: {
        db: 'sandbox',
        key: 'Mitya',
        build: build('MityaWeapon'),
        constellation: 1,
        talent: 10,
      },
    })
    expect(dialog.getAttribute('data-aspect')).toBe('1760 / 1700')
    expect(stored.get('juanlab-kqmCardView')).toBe('detailed')
    fireEvent.click(within(dialog).getByRole('button', { name: 'record' }))
    expect(mocks.records.at(-1)).toMatchObject({ view: 'detailed' })
  })
  it('opens on the view last picked', async () => {
    stored.set('juanlab-kqmCardView', 'detailed')
    const dialog = await openCard()
    expect(
      within(dialog)
        .getByRole('radio', { name: 'teamOpt.card.view.detailed' })
        .getAttribute('aria-checked')
    ).toBe('true')
    expect(lastCtx()['statsB']).toBeDefined()
  })
})

describe('KqmCompare: B’s KQM results', () => {
  const side = (dpr: number) => ({
    dpr,
    dps: dpr / 20,
    rotationTime: 20,
    rotation: TEXT,
    members: [],
  })
  const MEMBERS_B = ['Anastasya', 'Mitya', 'Odette', 'Danica']
  /** What compareSwapKqm gives: B's headline, its KQM result and its sandbox */
  function outcome(ranked = true) {
    return {
      a: side(1000),
      b: side(900),
      resultB: {
        builds: Object.fromEntries(
          MEMBERS_B.map((k) => [k, build(`${k}Weapon`)])
        ),
        constellations: {},
        energyRecharge: {},
        after: { total: 900, members: {} },
        optimized: ['Mitya'],
        rankings: ranked ? { Mitya: { weapons: [], sets: [] } } : {},
        played: { rotationTime: 20, attacks: {}, stalls: [] },
      },
      // (team B's throwaway copy of the database: never the page's)
      sandbox: { members: MEMBERS_B, sandbox: true },
      teamOptB: { attacks: {}, keep: [], rotationTime: 20, kqm: {} },
      rotationB: { text: TEXT, opener: '', timing: { edits: {} } },
    }
  }
  /** B's results as last shown, or none */
  const shown = () =>
    screen.queryByTestId('kqm-results') ? mocks.results.at(-1) : undefined
  async function runOnce() {
    show()
    chooseSwap()
    fireEvent.click(confirmBox())
    await act(async () => {
      fireEvent.click(runButton())
    })
  }
  type Args = {
    onPreview: (p: object) => void
    onStep: (s: object) => void
    isCancelled: () => boolean
  }
  /** A run that gives its headline, then ranks until told to end */
  function ranking() {
    const run: {
      args?: Args
      resolve?: (v: unknown) => void
      reject?: (e: unknown) => void
    } = {}
    mocks.compare.mockImplementation((args: Args) => {
      run.args = args
      const { sandbox, ...preview } = outcome(false)
      args.onPreview({ ...preview, sandbox })
      return new Promise((resolve, reject) => {
        run.resolve = resolve
        run.reject = reject
      })
    })
    return run
  }

  it('shows B’s KQM results after a run: on its sandbox, read only, B’s members and settings', async () => {
    withRun()
    const out = outcome()
    mocks.compare.mockResolvedValue(out)
    await runOnce()
    await screen.findByRole('table')
    expect(
      screen.getByRole('heading', { name: /kqmCompare\.results\.title/ })
    ).toBeTruthy()
    const props = shown()!
    expect(props['database']).toBe(out.sandbox)
    expect(props['database']).not.toBe(mocks.database)
    expect(props['readOnly']).toBe(true)
    expect(props['result']).toBe(out.resultB)
    expect(props['runSettings']).toBe(out.teamOptB)
    expect(props['setup']).toBe(out.teamOptB)
    expect(props['replayRotation']).toEqual(out.rotationB)
    expect(props['teamId']).toBe('t1')
    expect(props['rotation']).toBe('played')
    expect(props['rotationTime']).toBe(20)
    expect(
      (props['members'] as { characterKey: string }[]).map(
        (m) => m.characterKey
      )
    ).toEqual(MEMBERS_B)
    expect(props['running']).toBe(false)
    expect(props['improving']).toBe(false)
    expect(props['stale']).toBe(false)
    expect(props['onDiscard']).toBeUndefined()
    // (its locked members and its inspector's note in the user's language)
    expect(props['heldLabel']).toBe('kqmCompare.results.locked')
    expect(props['inspectorNote']).toEqual({
      label: 'kqmCompare.results.retune',
      tip: 'kqmCompare.results.retuneTip name=Mitya',
    })
    // (its progress said once, by the page's status line; its headings below the section's h3)
    expect(props['preliminary']).toBe('quiet')
    expect(props['preliminaryLabel']).toBe('kqmCompare.results.rankingLabel')
    expect(props['headingLevel']).toBe(4)
    expect(props['unfinished']).toBe(false)
    expect(props['preliminaryFinalLabel']).toBe('kqmCompare.results.readyLabel')
  })

  it('announces the rankings’ end in the same status region that said their progress', async () => {
    withRun()
    const run = ranking()
    await runOnce()
    await screen.findByRole('table')
    const status = screen.getByText('kqmCompare.ranking percent=0')
    expect(status.getAttribute('role')).toBe('status')
    await act(async () => run.resolve!(outcome()))
    // (the same element, still mounted: its new words are announced)
    expect(status.isConnected).toBe(true)
    expect(status.getAttribute('role')).toBe('status')
    expect(status.textContent).toBe('kqmCompare.results.ready')
  })

  it('says a cancel in the same status region, and keeps the focus in B’s section', async () => {
    withRun()
    ranking()
    await runOnce()
    await screen.findByRole('table')
    const status = screen.getByText('kqmCompare.ranking percent=0')
    const cancel = screen.getByRole('button', { name: 'kqmCompare.cancel' })
    cancel.focus()
    fireEvent.click(cancel)
    expect(status.isConnected).toBe(true)
    expect(status.textContent).toBe('kqmCompare.results.cancelled')
    // (the button is gone: the focus on B's section title, not lost)
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe(
        'kqmCompare.results.title'
      )
    )
    expect(
      screen
        .getByRole('heading', { name: /kqmCompare\.results\.title/ })
        .contains(document.activeElement)
    ).toBe(true)
  })

  it('a cancel before the summary puts the focus back on Confronta', async () => {
    withRun()
    mocks.compare.mockImplementation(() => new Promise(() => {}))
    await runOnce()
    const cancel = await screen.findByRole('button', {
      name: 'kqmCompare.cancel',
    })
    cancel.focus()
    fireEvent.click(cancel)
    await waitFor(() => expect(document.activeElement).toBe(runButton()))
  })

  it('keeps B’s rotation the same object while shown (the inspector follows it)', async () => {
    withRun()
    mocks.compare.mockResolvedValue(outcome())
    await runOnce()
    await screen.findByTestId('kqm-results')
    const first = shown()!['replayRotation']
    const members = shown()!['members']
    // (any re-render: a change elsewhere on the page)
    fireEvent.click(confirmBox())
    fireEvent.click(confirmBox())
    expect(mocks.results.length).toBeGreaterThan(1)
    expect(shown()!['replayRotation']).toBe(first)
    expect(shown()!['members']).toBe(members)
  })

  it('while its rankings are worked out: the summary, their progress and a working Cancel', async () => {
    withRun()
    const run = ranking()
    await runOnce()
    await screen.findByRole('table')
    expect(shown()!['improving']).toBe(true)
    expect(shown()!['running']).toBe(true)
    act(() => run.args!.onStep({ progress: 0.42 }))
    await waitFor(() => expect(shown()!['progress']).toBe(0.42))
    expect(screen.getByText('kqmCompare.ranking percent=42')).toBeTruthy()
    const cancel = screen.getByRole('button', { name: 'kqmCompare.cancel' })
    expect(run.args!.isCancelled()).toBe(false)
    fireEvent.click(cancel)
    expect(run.args!.isCancelled()).toBe(true)
    // (the summary and B's builds stay; the rankings are said cancelled)
    expect(screen.getByRole('table')).toBeTruthy()
    expect(shown()!['improving']).toBe(false)
    expect(shown()!['running']).toBe(false)
    // (not said final: its rankings did not finish)
    expect(shown()!['unfinished']).toBe(true)
    // (said in B's section, and announced by the status region)
    expect(screen.getAllByText('kqmCompare.results.cancelled')).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: 'kqmCompare.cancel' })
    ).toBeNull()
    // (the run ends with its headline: nothing changes)
    await act(async () => run.resolve!(outcome(false)))
    expect(screen.getAllByText('kqmCompare.results.cancelled')).toHaveLength(2)
  })

  it('gives the rankings’ own progress: from the summary (0%) to their end (100%)', async () => {
    withRun()
    const run: { args?: Args } = {}
    mocks.compare.mockImplementation((args: Args) => {
      run.args = args
      // (the run is 60% done when B's summary is known)
      args.onStep({ progress: 0.6 })
      const { sandbox, ...preview } = outcome(false)
      args.onPreview({ ...preview, sandbox })
      return new Promise(() => {})
    })
    await runOnce()
    await screen.findByRole('table')
    act(() => run.args!.onStep({ progress: 0.8 }))
    await waitFor(() =>
      expect(screen.getByText('kqmCompare.ranking percent=50')).toBeTruthy()
    )
    expect(shown()!['progress']).toBeCloseTo(0.5, 6)
  })

  it('shows the rankings once worked out: no longer improving', async () => {
    withRun()
    const run = ranking()
    await runOnce()
    await screen.findByRole('table')
    const done = outcome()
    await act(async () => run.resolve!(done))
    expect(shown()!['improving']).toBe(false)
    expect(shown()!['unfinished']).toBe(false)
    expect(shown()!['result']).toBe(done.resultB)
    expect(
      screen.queryByRole('button', { name: 'kqmCompare.cancel' })
    ).toBeNull()
  })

  it('a failure of the rankings keeps the summary and says the rankings failed', async () => {
    withRun()
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const run = ranking()
    await runOnce()
    await screen.findByRole('table')
    await act(async () =>
      run.reject!(new CompareSwapFailure('noResult', 'KQM could not…'))
    )
    expect(screen.getByRole('table')).toBeTruthy()
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('kqmCompare.results.rankingFailed')
    expect(alert.textContent).toContain('kqmCompare.error.noResult')
    expect(shown()!['improving']).toBe(false)
    expect(shown()!['unfinished']).toBe(true)
    quiet.mockRestore()
  })

  it('marks B’s results stale when the settings change', async () => {
    withRun()
    mocks.compare.mockResolvedValue(outcome())
    await runOnce()
    await screen.findByTestId('kqm-results')
    expect(shown()!['stale']).toBe(false)
    fireEvent.change(
      screen.getByRole('textbox', { name: /kqmCompare\.fragment/ }),
      { target: { value: 'E E Q' } }
    )
    expect(shown()!['stale']).toBe(true)
  })

  it('drops B’s sandbox when a new run starts, and when a run is cancelled', async () => {
    withRun()
    mocks.compare.mockResolvedValueOnce(outcome())
    await runOnce()
    await screen.findByTestId('kqm-results')
    let isCancelled: (() => boolean) | undefined
    mocks.compare.mockImplementation((args: Args) => {
      isCancelled = args.isCancelled
      return new Promise(() => {})
    })
    await act(async () => {
      fireEvent.click(runButton())
    })
    await waitFor(() => expect(mocks.compare).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('kqm-results')).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'kqmCompare.cancel' }))
    expect(isCancelled?.()).toBe(true)
    expect(screen.queryByTestId('kqm-results')).toBeNull()
  })

  it('a new run while ranking cancels the ranking', async () => {
    withRun()
    const run = ranking()
    await runOnce()
    await screen.findByTestId('kqm-results')
    const first = run.args!
    await act(async () => {
      fireEvent.click(runButton())
    })
    expect(first.isCancelled()).toBe(true)
  })

  it('leaving the tab while ranking cancels it', async () => {
    withRun()
    const run = ranking()
    show()
    chooseSwap()
    fireEvent.click(confirmBox())
    await act(async () => {
      fireEvent.click(runButton())
    })
    await screen.findByTestId('kqm-results')
    cleanup()
    expect(run.args!.isCancelled()).toBe(true)
  })

  it('without B’s result (a run that gave only the headline): no section', async () => {
    withRun()
    mocks.compare.mockResolvedValue({ a: side(1000), b: side(900) })
    await runOnce()
    await screen.findByRole('table')
    expect(screen.queryByTestId('kqm-results')).toBeNull()
  })
})

describe('KqmCompare: rotation changed since A', () => {
  const played = {
    attacks: {
      Danica: [{ path: ['skill', 'dmg'], hits: 2, hitMode: 'avgHit' }],
    },
    rotationTime: 19.4,
  }
  const withPlayed = () => {
    withRun()
    const run = (
      mocks.state.saved as { run: { result: Record<string, unknown> } }
    ).run
    run.result['played'] = played
  }

  it('does not warn when the written rotation plays as A played it', async () => {
    withPlayed()
    mocks.replay.mockReturnValue(() => structuredClone(played))
    show()
    await waitFor(() => expect(mocks.replay).toHaveBeenCalled())
    expect(screen.queryByText('kqmCompare.rotationChanged')).toBeNull()
  })

  it('warns when the written rotation plays differently from A', async () => {
    withPlayed()
    mocks.replay.mockReturnValue(() => ({
      ...structuredClone(played),
      rotationTime: 21.2,
    }))
    show()
    expect(await screen.findByText('kqmCompare.rotationChanged')).toBeTruthy()
  })
})

describe('KqmCompare: the same member re-entering', () => {
  const character = () =>
    screen.getByRole('combobox', { name: /kqmCompare\.character/ })
  const fragment = () =>
    screen.getByRole('textbox', {
      name: /kqmCompare\.fragment/,
    }) as HTMLInputElement
  const pickIn = (typed: string, name: string) => {
    fireEvent.change(character(), { target: { value: typed } })
    fireEvent.click(screen.getByRole('option', { name }))
  }
  /** The list as it opens: every member that can enter */
  const options = () => {
    fireEvent.keyDown(character(), { key: 'ArrowDown' })
    return screen.queryAllByRole('option').map((o) => o.textContent)
  }

  it('offers the leaving member in Entra, and none of the others', () => {
    withRun()
    show()
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    // (Furina and Mitya are not in the team; of its members, only the one leaving)
    expect(options()).toEqual(['Furina', 'Mitya', 'Yae Miko'])
  })

  it('fills the fragment with the leaving member’s actions in A’s rotation, still editable', () => {
    withRun()
    show()
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    pickIn('Yae', 'Yae Miko')
    expect(fragment().value).toBe('E E E')
    const preview = screen.getByLabelText(/kqmCompare\.preview/)
    expect(preview.querySelector('mark')?.textContent).toBe('Yae Miko E E E')
    fireEvent.change(fragment(), { target: { value: 'E E' } })
    expect(fragment().value).toBe('E E')
  })

  it('clears the prefill when another member is picked, keeps what was typed', () => {
    withRun()
    show()
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    pickIn('Yae', 'Yae Miko')
    expect(fragment().value).toBe('E E E')
    pickIn('Mit', 'Mitya')
    expect(fragment().value).toBe('')
    // (typed by the user: re-picking the leaving member does not overwrite it)
    fireEvent.change(fragment(), { target: { value: 'E Q' } })
    pickIn('Yae', 'Yae Miko')
    expect(fragment().value).toBe('E Q')
    pickIn('Mit', 'Mitya')
    expect(fragment().value).toBe('E Q')
  })

  it('keeps a fragment typed before the leaving member is picked', () => {
    withRun()
    show()
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    pickIn('Mit', 'Mitya')
    fireEvent.change(fragment(), { target: { value: 'E Q' } })
    pickIn('Yae', 'Yae Miko')
    expect(fragment().value).toBe('E Q')
  })

  it('drops the pick when the leaving member changes and it is a teammate again', () => {
    withRun()
    show()
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    pickIn('Yae', 'Yae Miko')
    fireEvent.click(screen.getByRole('radio', { name: /Danica/ }))
    expect((character() as HTMLInputElement).value).toBe('')
    expect(fragment().value).toBe('')
  })

  it('starts from A’s settings for it: its constellation, ER target, effects and energy weapons', async () => {
    withRun()
    const saved = mocks.state.saved as {
      run: { teamOpt: { kqm: object } }
    }
    saved.run.teamOpt.kqm = {
      energyRecharge: { YaeMiko: 130, Danica: 160 },
      passives: { YaeMiko: { YaeMikoWeapon: { effect: 'on' } } },
      weaponEnergy: { WintersHeavyHeart: { YaeMiko: 20, Danica: 10 } },
    }
    mocks.compare.mockReturnValue(new Promise(() => {}))
    show()
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    pickIn('Yae', 'Yae Miko')
    // (A's result: C1)
    expect(
      screen.getByRole('combobox', { name: /kqmCompare\.constellation/ })
        .textContent
    ).toBe('C1')
    fireEvent.click(
      screen.getByRole('button', { name: /kqmCompare\.settings/ })
    )
    expect(
      (
        screen.getByRole('textbox', {
          name: /kqmCompare\.erTarget/,
        }) as HTMLInputElement
      ).value
    ).toBe('130')
    // (another member: as today, nothing of A's)
    pickIn('Mit', 'Mitya')
    expect(
      (
        screen.getByRole('textbox', {
          name: /kqmCompare\.erTarget/,
        }) as HTMLInputElement
      ).value
    ).toBe('')
    pickIn('Yae', 'Yae Miko')
    fireEvent.click(confirmBox())
    await act(async () => {
      fireEvent.click(runButton())
    })
    await waitFor(() => expect(mocks.compare).toHaveBeenCalledTimes(1))
    const { out, swapIn, fragment: sent } = mocks.compare.mock.calls[0][0]
    expect(out).toBe('YaeMiko')
    expect(sent).toBe('E E E')
    expect(swapIn).toMatchObject({ key: 'YaeMiko', constellation: 1 })
    expect(swapIn.kqm).toEqual({
      energyRecharge: { YaeMiko: 130 },
      passives: { YaeMiko: { YaeMikoWeapon: { effect: 'on' } } },
      weaponEnergy: { WintersHeavyHeart: { YaeMiko: 20 } },
    })
  })

  it('starts from A’s ER calculator inputs for it', async () => {
    withRun()
    const saved = mocks.state.saved as {
      run: { teamOpt: { kqm: object } }
    }
    const yae = {
      fieldTime: 10,
      skillUses: 3,
      favoniusProcs: 1,
      edited: ['favoniusProcs'],
    }
    saved.run.teamOpt.kqm = {
      energySource: 'calculator',
      energyCalculator: {
        rotationTime: 20,
        members: { YaeMiko: yae, Danica: { fieldTime: 30 } },
      },
    }
    mocks.compare.mockReturnValue(new Promise(() => {}))
    show()
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    pickIn('Yae', 'Yae Miko')
    fireEvent.click(confirmBox())
    await act(async () => {
      fireEvent.click(runButton())
    })
    await waitFor(() => expect(mocks.compare).toHaveBeenCalledTimes(1))
    const { swapIn } = mocks.compare.mock.calls[0][0]
    expect(swapIn.kqm.energyCalculator.members).toEqual({ YaeMiko: yae })
  })

  it('names the swapped row with the constellation change', async () => {
    withRun()
    const member = (key: string, constellation: number) => ({
      key,
      damage: 250,
      share: 0.25,
      er: 120,
      erValue: 125,
      constellation,
      fixed: key !== 'YaeMiko',
    })
    const side = (yae: number) => ({
      dpr: 1000,
      dps: 50,
      rotationTime: 20,
      rotation: TEXT,
      members: [
        member('Anastasya', 0),
        member('YaeMiko', yae),
        member('Odette', 6),
        member('Danica', 6),
      ],
    })
    mocks.compare.mockResolvedValue({ a: side(1), b: side(2) })
    show()
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    pickIn('Yae', 'Yae Miko')
    fireEvent.click(confirmBox())
    await act(async () => {
      fireEvent.click(runButton())
    })
    const table = await screen.findByRole('table')
    expect(
      within(table).getAllByText(/Yae Miko C1 → C2/).length
    ).toBeGreaterThan(0)
    // (the columns: the member at each constellation)
    expect(
      within(table).getByRole('columnheader', {
        name: 'kqmCompare.table.a name=Yae Miko C1',
      })
    ).toBeTruthy()
    expect(
      within(table).getByRole('columnheader', {
        name: 'kqmCompare.table.b name=Yae Miko C2',
      })
    ).toBeTruthy()
  })

  it('starts from A’s result constellation when A’s run has no KQM settings (older saves)', () => {
    withRun()
    // (a run without `teamOpt` at all is not offered as A: `savedRunFor`)
    const saved = mocks.state.saved as { run: { teamOpt: { kqm?: object } } }
    delete saved.run.teamOpt.kqm
    show()
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    pickIn('Yae', 'Yae Miko')
    expect(
      screen.getByRole('combobox', { name: /kqmCompare\.constellation/ })
        .textContent
    ).toBe('C1')
  })

  it.each([
    [
      'repeated',
      `${TEXT} -> Yae Miko E`,
      'kqmCompare.error.repeated name=Yae Miko count=2',
    ],
    [
      'notFound',
      'Danica E -> Odette E E -> Danica Q',
      'kqmCompare.error.notFound name=Yae Miko',
    ],
  ])('leaves the fragment empty and says why when the leaving member is %s in A’s rotation', (_, rotation, refusal) => {
    withRun()
    stored.set('teamOptRotationText_t1', rotation)
    show()
    fireEvent.click(screen.getByRole('radio', { name: /Yae Miko/ }))
    pickIn('Yae', 'Yae Miko')
    expect(fragment().value).toBe('')
    // (the refusal, under the fragment, describing Confronta; not "write its actions")
    expect(screen.getByText(refusal)).toBeTruthy()
    expect(screen.queryByText(/kqmCompare\.need\.fragment/)).toBeNull()
    expect(runButton().getAttribute('aria-describedby')).toMatch(/-refusal$/)
  })
})

describe('Overview: two members sharing a name (Travelers)', () => {
  it('names the swap and the columns as two members, without constellations', () => {
    const member = (key: string, constellation: number) => ({
      key,
      damage: 250,
      share: 0.5,
      er: 120,
      erValue: 125,
      constellation,
      fixed: key === 'Danica',
    })
    const side = (traveler: string, cons: number) => ({
      dpr: 1000,
      dps: 50,
      rotationTime: 20,
      rotation: TEXT,
      members: [member('Danica', 6), member(traveler, cons)],
    })
    render(
      <ThemeProvider theme={theme}>
        <Overview
          a={side('TravelerAnemo', 0) as never}
          b={side('TravelerDendro', 6) as never}
          out={'TravelerAnemo' as never}
          inKey={'TravelerDendro' as never}
          nameOf={(k) => (k.startsWith('Traveler') ? 'Lumine' : k)}
          language="it"
        />
      </ThemeProvider>
    )
    const table = screen.getByRole('table')
    expect(
      within(table).getAllByText('Lumine → Lumine').length
    ).toBeGreaterThan(0)
    expect(within(table).queryByText(/C0|C6/)).toBeNull()
    expect(
      within(table).getByRole('columnheader', {
        name: 'kqmCompare.table.a name=Lumine',
      })
    ).toBeTruthy()
    expect(
      within(table).getByRole('columnheader', {
        name: 'kqmCompare.table.b name=Lumine',
      })
    ).toBeTruthy()
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
