// @vitest-environment jsdom

import type { TeamOpt } from '@genshin-optimizer/gi/db'
import type {
  KqmBuild,
  KqmResult,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  createTheme,
  ThemeProvider,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material'
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { KqmCompare } from './KqmComparison'
import { KqmResults, KqmSettings } from './KqmMode'
import { useKqmRun } from './useKqmRun'

const mocks = vi.hoisted(() => {
  // the saved last runs (`database.teamKqmResults`), as the browser's storage keeps them
  const saved: { runs: Record<string, any> } = { runs: {} }
  return {
    compare: vi.fn(),
    optimize: vi.fn(),
    // (the "Artifacts for gc-web" buttons: what each was given, its input read on click)
    gcweb: [] as Record<string, unknown>[],
    saved,
    database: {
      weapons: { get: () => ({ key: 'AmenomaKageuchi', refinement: 5 }) },
      chars: { get: () => ({ constellation: 0 }) },
      buildTcs: { get: () => undefined },
      // (no team: a run keeps no enemy)
      teams: { get: () => undefined },
      teamKqmResults: {
        get: () => saved,
        getRun: (teamId: string) =>
          saved.runs[teamId] && JSON.parse(JSON.stringify(saved.runs[teamId])),
        setRun: (teamId: string, run: unknown) => {
          if (run) saved.runs[teamId] = JSON.parse(JSON.stringify(run))
          else delete saved.runs[teamId]
        },
      },
    },
  }
})
vi.mock('@genshin-optimizer/gi/db-ui', async () => {
  // (as the page's: the database from the context, the page's own when none is provided)
  const { createContext, useContext } = await import('react')
  const DatabaseContext = createContext({
    database: mocks.database,
  } as { database: unknown })
  return {
    DatabaseContext,
    useDatabase: () => useContext(DatabaseContext).database,
    useDBMeta: () => ({ gender: 'F' }),
    // (no team: the setup's enemy shows nothing)
    useTeam: () => undefined,
  }
})
vi.mock('@genshin-optimizer/gi/db', () => ({
  defaultTeamOptKqm: { refinement4: 5, refinement5: 1 },
}))
vi.mock('@genshin-optimizer/gi/theme', () => ({
  giCtaSx: {},
  // (the shared building blocks in ./ui read the surface tokens)
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
vi.mock('@genshin-optimizer/gi/assets', () => ({
  artifactAsset: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  artifactDefIcon: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  characterAsset: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
  weaponAsset: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
}))
vi.mock('@genshin-optimizer/gi/util', () => ({ getMainStatValue: () => 0.466 }))
vi.mock('@genshin-optimizer/gi/i18n', () => ({
  preloadNamespaces: () => {},
  Translate: () => null,
}))
vi.mock('@genshin-optimizer/common/ui', () => ({
  ModalWrapper: ({
    open,
    children,
  }: {
    open: boolean
    children: React.ReactNode
  }) => (open ? <div>{children}</div> : null),
  CardThemed: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  InfoTooltipInline: () => <span role="img" aria-label="Info" />,
  SolidToggleButtonGroup: (props: object) => <ToggleButtonGroup {...props} />,
  BootstrapTooltip: (props: object) => <Tooltip {...props} />,
}))
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
vi.mock('@genshin-optimizer/gi/ui', () => ({
  CharacterName: ({ characterKey }: { characterKey: string }) => (
    <>{characterKey}</>
  ),
  WeaponName: ({ weaponKey }: { weaponKey: string }) => <>{weaponKey}</>,
  ArtifactSetName: ({ setKey }: { setKey: string }) => <>{setKey}</>,
  ArtifactSetTooltip: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  statName: (key: string) => key,
  quickTooltipProps: {},
  weaponSheetNs: (key: string) => `weapon_${key}_gen`,
  kqmConstellation: (key: string) => (key === 'Bennett' ? 6 : 0),
  KQM_TALENT_DEFAULT: 10,
  kqmBuildThreads: () => undefined,
  kqmBuildThreadsAuto: () => 4,
  kqmBuildThreadsMax: () => 7,
  setKqmBuildThreads: () => undefined,
  teamOptMembers: () => [],
  kqmTalentLevel: (kqm?: { talents?: 9 | 10 }) => kqm?.talents ?? 10,
  kqmMemberConstellation: (
    key: string,
    kqm?: { constellations?: Record<string, number> }
  ) => kqm?.constellations?.[key] ?? (key === 'Bennett' ? 6 : 0),
  kqmHasEnergyRequirement: (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && value >= 100,
  KQM_ER_DEFAULT: 100,
  KQM_FIXED_ROLLS: 2,
  kqmEnergyRequirement: (
    kqm: { energyRecharge?: Record<string, number> } | undefined,
    key: string
  ) => {
    const value = kqm?.energyRecharge?.[key]
    return typeof value === 'number' && Number.isFinite(value) && value >= 100
      ? value
      : 100
  },
  kqmWeapons: () => [{ key: 'AmenomaKageuchi', refinement: 5 }],
  // (the run's weapons as KQM mode picks them: the default list, nothing left out by hand)
  kqmExcludedWeapons: () => new Set<string>(),
  kqmDefaultExcludedWeapons: () => [],
  kqmSetsId: (sets: object) =>
    Object.entries(sets)
      .map(([key, n]) => `${key}:${n}`)
      .sort()
      .join('+'),
  kqmWeaponData: (weapon: object) => weapon,
  kqmBuildRarity: () => ({ four: 0, subScale: 1, rolls: 20 }),
  kqmArtifactStats: () => [
    {
      key: 'critRate_',
      main: 0.311,
      fixed: 0.0662,
      distributed: 0.1,
      rolls: 3,
      total: 0.4772,
    },
    {
      key: 'critDMG_',
      main: 0,
      fixed: 0.1324,
      distributed: 0.6,
      rolls: 9,
      total: 0.7324,
    },
  ],
  KQM_SUBSTAT_ROLLS: { critRate_: 0.0331, critDMG_: 0.0662, atk_: 0.0496 },
  syncEnergyCalculator: (
    keys: string[],
    saved: object | undefined,
    rotationTime: number
  ) =>
    saved ?? {
      rotationTime,
      members: Object.fromEntries(keys.map((key) => [key, { fieldTime: 25 }])),
    },
  // (no written rotation here: nothing filled in)
  withRotationEnergy: (settings: object) => settings,
  kqmTopTeams: (result: {
    builds: Record<string, { weapon: object; sets: object }>
    after: { total: number }
    rankings: Record<
      string,
      { weapons: { weapon: object; sets: object; total: number }[] }
    >
  }) => [
    { builds: result.builds, total: result.after.total },
    ...Object.entries(result.rankings).flatMap(([ck, r]) =>
      r.weapons.slice(1).map((o) => ({
        changed: ck,
        builds: { ...result.builds, [ck]: { weapon: o.weapon, sets: o.sets } },
        total: o.total,
      }))
    ),
  ],
  compareTeamKqm: mocks.compare,
  optimizeTeamKqm: mocks.optimize,
  genInputFromKqm: (build: object, opts: object) => ({ fromKqm: build, opts }),
  GcwebBuildButton: ({
    input,
    ...props
  }: {
    input: () => unknown
  } & Record<string, unknown>) => (
    <button
      type="button"
      onClick={() => mocks.gcweb.push({ ...props, input: input() })}
    >
      Artifacts for gc-web
    </button>
  ),
  TeamOptCancelled: class extends Error {},
}))
// (the timeline names its tracks from the sheets: not needed here)
vi.mock('./buffs', () => ({
  describe: () => ({ name: '', teamBuff: false }),
  useTeamBuffs: () => [],
  useKqmTeamBuffs: () => [],
  buffsForAttacker: () => [],
  buffEffects: () => [],
  useAttackTeamData: () => undefined,
  teamBuffsOf: () => [],
}))
// (the writer's timeline figures bring the attack editor's whole module graph)
vi.mock('./TimelineFigures', () => ({
  useTimelineFigures: () => ({}),
  useMomentFigures: () => ({}),
  TimelineHitStats: () => null,
}))
vi.mock('./KqmChoosers', () => ({
  kqmChooserCounts: () => ({ weapons: { allowed: 3 }, sets: { allowed: 3 } }),
  KqmWeaponChooser: () => <div>Weapon options</div>,
  KqmPool: ({
    onWeapons,
    onSets,
  }: {
    onWeapons: () => void
    onSets: () => void
  }) => (
    <>
      <button type="button" onClick={onWeapons}>
        Choose weapons
      </button>
      <button type="button" onClick={onSets}>
        Choose sets
      </button>
    </>
  ),
  KqmSetChooser: () => <div>Set options</div>,
}))
vi.mock('./KqmEnergyCalculator', () => ({
  KqmEnergyCalculator: () => <div>Team ER calculator</div>,
  kqmEnergyEstimate: () => ({
    targets: {
      KamisatoAyaka: 135,
      Shenhe: 140,
      KaedeharaKazuha: 150,
      Bennett: 160,
    },
    errors: [],
  }),
}))
vi.mock('./MemberAvatar', () => ({
  MemberAvatar: ({ characterKey }: { characterKey: string }) => (
    <span>{characterKey} portrait</span>
  ),
}))
vi.mock('./TeamOptResults', () => ({
  WeaponThumb: () => <span />,
  WeaponDetails: () => <span />,
  elementColor: () => '#888',
}))

const keys = ['KamisatoAyaka', 'Shenhe', 'KaedeharaKazuha', 'Bennett'] as const
const members = keys.map((characterKey) => ({
  characterKey,
  weaponId: characterKey,
})) as TeamOptMember[]
const initial = () =>
  ({
    attacks: {},
    keep: [],
    weaponEnergy: {},
    rotationTime: 20,
    kqm: { refinement4: 5, refinement5: 1 },
  }) as TeamOpt
const build: KqmBuild = {
  weapon: { key: 'AmenomaKageuchi', refinement: 5 },
  sets: { BlizzardStrayer: 4 },
  mains: { sands: 'atk_', goblet: 'cryo_dmg_', circlet: 'critRate_' },
  rolls: { critRate_: 3, critDMG_: 10, enerRech_: 7 },
}
function sampleResult(): KqmResult {
  const option = { ...build, total: 1000, unmet: false }
  return {
    builds: { KamisatoAyaka: build },
    optimized: ['KamisatoAyaka'],
    after: { total: 1000, members: { KamisatoAyaka: 1000 }, unmet: {} },
    rankings: {
      KamisatoAyaka: {
        weapons: [
          option,
          {
            ...option,
            weapon: { key: 'TheBlackSword', refinement: 1 },
            total: 900,
            behind: {
              status: 'matched',
              count: 1.5,
              target: 1000,
              total: 1000,
              rolls: { critDMG_: 1.5 },
            },
          },
        ],
        sets: [
          option,
          { ...option, sets: { GladiatorsFinale: 4 }, total: 800 },
        ],
      },
    },
    constellations: { KamisatoAyaka: 0 },
    energyRecharge: {
      KamisatoAyaka: { value: 138.6, target: 135, minimum: 135 },
    },
    assumed: {},
    rounds: 1,
  } as KqmResult
}
const theme = createTheme({ palette: { mode: 'dark' } })
const wrap = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider theme={theme}>{children}</ThemeProvider>
)
function Setup({
  active = true,
  start = vi.fn(),
}: {
  active?: boolean
  start?: (settings: TeamOpt) => void
}) {
  const [settings, setSettings] = useState(initial)
  return (
    <KqmSettings
      active={active}
      canRun
      onStart={start}
      teamId="ui"
      members={members}
      teamData={undefined}
      teamOpt={settings}
      setTeamOpt={(update) =>
        setSettings((previous) => {
          const next = structuredClone(previous)
          return update(next) ?? next
        })
      }
    />
  )
}
beforeAll(() => {
  window.matchMedia = vi.fn().mockImplementation(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  window.requestAnimationFrame = (cb) => window.setTimeout(cb, 0)
})
afterEach(() => {
  cleanup()
  mocks.compare.mockReset()
  mocks.optimize.mockReset()
})

describe('KQM first-time setup', () => {
  it('starts every ER target at 100%, blocks one typed below it, and runs with the targets typed', () => {
    const start = vi.fn()
    render(<Setup start={start} />, { wrapper: wrap })
    const generate = screen.getByRole('button', {
      name: 'Generate builds',
    }) as HTMLButtonElement
    const input = (key: string) =>
      screen.getByLabelText(`${key} minimum ER (%)`) as HTMLInputElement
    for (const key of keys) expect(input(key).value).toBe('100')
    expect(generate.disabled).toBe(false)
    expect(screen.queryByRole('tab')).toBeNull()
    fireEvent.change(input(keys[0]), { target: { value: '90' } })
    expect(generate.disabled).toBe(true)
    for (const key of keys)
      fireEvent.change(input(key), { target: { value: '140' } })
    expect(generate.disabled).toBe(false)
    fireEvent.click(generate)
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        kqm: expect.objectContaining({
          energyRecharge: Object.fromEntries(keys.map((key) => [key, 140])),
        }),
      })
    )
  })
  it('opens the calculator directly and applies targets without a save step', async () => {
    render(<Setup />, { wrapper: wrap })
    fireEvent.click(screen.getByRole('button', { name: 'Calculate ER' }))
    expect(
      await screen.findByRole('dialog', { name: 'ER calculator' })
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Apply ER targets' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(
      (
        screen.getByLabelText(
          'KamisatoAyaka minimum ER (%)'
        ) as HTMLInputElement
      ).value
    ).toBe('135')
    expect(
      (
        screen.getByRole('button', {
          name: 'Generate builds',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  })
  it('puts optional filters in a labelled panel and hides them when this page becomes inactive', async () => {
    const ui = render(<Setup />, { wrapper: wrap })
    fireEvent.click(screen.getByRole('button', { name: 'Choose weapons' }))
    expect(await screen.findByRole('dialog', { name: 'Weapons' })).toBeTruthy()
    expect(screen.getByText('Weapon options')).toBeTruthy()
    ui.rerender(<Setup active={false} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('KQM focused results', () => {
  it('shows one inspector and switches the visible ranking with one click', async () => {
    const result = sampleResult()
    mocks.compare.mockImplementation(async ({ weapon, sets }) => ({
      ...result,
      builds: { KamisatoAyaka: { ...build, weapon, sets } },
    }))
    render(
      <KqmCompare
        teamId="ui"
        runSettings={initial()}
        result={result}
        characterKey="KamisatoAyaka"
        rotationTime={20}
      />,
      { wrapper: wrap }
    )
    expect(
      screen.getAllByRole('region', { name: 'Artifact totals' })
    ).toHaveLength(1)
    expect(
      screen.getByRole('tab', { name: 'Weapons' }).getAttribute('aria-selected')
    ).toBe('true')
    expect(
      screen.queryByRole('button', { name: /GladiatorsFinale/ })
    ).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Artifact sets' }))
    fireEvent.click(screen.getByRole('button', { name: /GladiatorsFinale/ }))
    await waitFor(() =>
      expect(mocks.compare).toHaveBeenCalledWith(
        expect.objectContaining({
          sets: { GladiatorsFinale: 4 },
          weapon: build.weapon,
        })
      )
    )
    expect(
      screen
        .getByRole('tab', { name: 'Artifact sets' })
        .getAttribute('aria-selected')
    ).toBe('true')
  })
  it('offers the shown build’s 5 artifacts for gc-web, as the picks change it', async () => {
    const result = sampleResult()
    mocks.gcweb.length = 0
    mocks.compare.mockImplementation(async ({ weapon, sets }) => ({
      ...result,
      builds: { KamisatoAyaka: { ...build, weapon, sets } },
    }))
    render(
      <KqmCompare
        teamId="ui-gcweb"
        runSettings={initial()}
        result={result}
        characterKey="KamisatoAyaka"
        rotationTime={20}
      />,
      { wrapper: wrap }
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Artifacts for gc-web' })
    )
    expect(mocks.gcweb).toEqual([
      {
        characterKey: 'KamisatoAyaka',
        gender: 'F',
        name: 'KQM',
        // (no scales: judged from the build)
        input: { fromKqm: build, opts: {} },
      },
    ])
    fireEvent.click(screen.getByRole('tab', { name: 'Artifact sets' }))
    fireEvent.click(screen.getByRole('button', { name: /GladiatorsFinale/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy()
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Artifacts for gc-web' })
    )
    expect(mocks.gcweb[1]?.['input']).toEqual({
      fromKqm: { ...build, sets: { GladiatorsFinale: 4 } },
      opts: {},
    })
  })
  it('measures each ranked option against the best, on one line', () => {
    const result = sampleResult()
    render(
      <KqmCompare
        teamId="ui-behind"
        runSettings={initial()}
        result={result}
        characterKey="KamisatoAyaka"
        rotationTime={20}
      />,
      { wrapper: wrap }
    )
    expect(screen.getByText('vs best')).toBeTruthy()
    expect(screen.getByText('Best')).toBeTruthy()
    // (1.5 rolls behind #1, the stat mix in its tooltip)
    expect(screen.getByText('1.5 rolls behind')).toBeTruthy()
    expect(screen.queryByText('To rank above')).toBeNull()
  })
  it('remembers the selected weapon when the member inspector is reopened', async () => {
    const result = sampleResult()
    mocks.compare.mockImplementation(async ({ weapon, sets }) => ({
      ...result,
      builds: { KamisatoAyaka: { ...build, weapon, sets } },
    }))
    const props = {
      teamId: 'ui',
      runSettings: initial(),
      result,
      characterKey: 'KamisatoAyaka' as const,
      rotationTime: 20,
    }
    const ui = render(<KqmCompare {...props} />, { wrapper: wrap })
    fireEvent.click(screen.getByRole('button', { name: /TheBlackSword/ }))
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Weapon' }).textContent
      ).toContain('TheBlackSword')
    )
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reset' })).toBeTruthy()
    )
    ui.unmount()
    render(<KqmCompare {...props} />, { wrapper: wrap })
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Weapon' }).textContent
      ).toContain('TheBlackSword')
    )
  })
  it('shows a pick’s team before its rankings, and takes another pick meanwhile', async () => {
    const result = sampleResult()
    let finish: (() => void) | undefined
    mocks.compare.mockImplementation(
      ({ weapon, sets, onPreview, isCancelled }) => {
        const team = {
          ...result,
          builds: { KamisatoAyaka: { ...build, weapon, sets } },
          after: { ...result.after, total: 950 },
        }
        onPreview?.({ ...team, rankings: {} })
        return new Promise((resolve, reject) => {
          finish = () =>
            isCancelled() ? reject(new Error('cancelled')) : resolve(team)
        })
      }
    )
    const onView = vi.fn()
    render(
      <KqmCompare
        teamId="ui"
        runSettings={initial()}
        result={result}
        characterKey="KamisatoAyaka"
        rotationTime={20}
        onView={onView}
      />,
      { wrapper: wrap }
    )
    fireEvent.click(screen.getByRole('button', { name: /TheBlackSword/ }))
    // the team's figures first, the rankings still being worked out (the ones before shown)
    await waitFor(() =>
      expect(onView).toHaveBeenLastCalledWith(
        expect.objectContaining({
          after: expect.objectContaining({ total: 950 }),
        })
      )
    )
    expect(
      screen.getByRole('progressbar', { name: 'Updating rankings' })
    ).toBeTruthy()
    const original = screen.getByRole('button', { name: /AmenomaKageuchi/ })
    expect(original.hasAttribute('disabled')).toBe(false)
    // another pick meanwhile replaces it (back to the run's: its own figures)
    fireEvent.click(original)
    await waitFor(() => expect(onView).toHaveBeenLastCalledWith(undefined))
    finish?.()
    await waitFor(() =>
      expect(
        screen.queryByRole('progressbar', { name: 'Updating rankings' })
      ).toBeNull()
    )
    expect(onView).toHaveBeenLastCalledWith(undefined)
  })
  it('replaces four repeated stat cards with compact member selection and one artifact view', () => {
    const result = sampleResult()
    render(
      <KqmResults
        teamId="ui"
        runSettings={initial()}
        members={members}
        result={result}
        seconds={1}
        rotationTime={20}
        onDiscard={vi.fn()}
      />,
      { wrapper: wrap }
    )
    expect(screen.getByRole('tablist', { name: 'Team builds' })).toBeTruthy()
    expect(
      screen.getAllByRole('region', { name: 'Artifact totals' })
    ).toHaveLength(1)
    // (the setup above runs again: the results only offer to discard them)
    expect(screen.queryByRole('button', { name: 'Run again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
  })
  it('marks preliminary results as not final, then says once that they are', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const result = sampleResult()
      const props = {
        teamId: 'ui-prelim',
        runSettings: initial(),
        members,
        result,
        seconds: 1,
        rotationTime: 20,
        onDiscard: vi.fn(),
      }
      const view = render(<KqmResults {...props} running improving />, {
        wrapper: wrap,
      })
      expect(screen.getByText('Preliminary builds')).toBeTruthy()
      expect(screen.getByText('still improving')).toBeTruthy()
      expect(screen.getByText('team DPS so far')).toBeTruthy()
      // the run's result replaces them: final, for a moment
      view.rerender(<KqmResults {...props} />)
      expect(screen.queryByText('Preliminary builds')).toBeNull()
      expect(screen.getByText('Final builds')).toBeTruthy()
      expect(screen.queryByText('team DPS so far')).toBeNull()
      await act(async () => {
        vi.advanceTimersByTime(4500)
      })
      expect(screen.queryByText('Final builds')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
  it('lists the top teams, and picking one shows that team', async () => {
    const result = sampleResult()
    mocks.compare.mockImplementation(async ({ weapon, sets }) => ({
      ...result,
      builds: { KamisatoAyaka: { ...build, weapon, sets } },
      after: { ...result.after, total: 900 },
    }))
    render(
      <KqmResults
        teamId="ui-top"
        runSettings={initial()}
        members={members}
        result={result}
        seconds={1}
        rotationTime={20}
        onDiscard={vi.fn()}
      />,
      { wrapper: wrap }
    )
    const list = screen.getByRole('region', { name: 'Top builds' })
    const rows = within(list).getAllByRole('button', { name: /^Rank \d/ })
    expect(rows).toHaveLength(2)
    // the run's own team first, and shown now
    expect(rows[0].getAttribute('aria-pressed')).toBe('true')
    expect(rows[1].textContent).toContain('−10.0%')
    fireEvent.click(rows[1])
    await waitFor(() =>
      expect(mocks.compare).toHaveBeenCalledWith(
        expect.objectContaining({
          characterKey: 'KamisatoAyaka',
          weapon: { key: 'TheBlackSword', refinement: 1 },
        })
      )
    )
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Top builds' }))
          .getAllByRole('button', { name: /^Rank \d/ })[1]
          .getAttribute('aria-pressed')
      ).toBe('true')
    )
    // (the inspector follows: the picked weapon)
    expect(
      screen.getByRole('combobox', { name: 'Weapon' }).textContent
    ).toContain('TheBlackSword')
    // back to the best team
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Top builds' })).getAllByRole(
        'button',
        { name: /^Rank \d/ }
      )[0]
    )
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Weapon' }).textContent
      ).toContain('AmenomaKageuchi')
    )
  })
  it('shows the first top teams on the page and all of them in a window', async () => {
    const result = sampleResult()
    // (8 weapons ranked: the run's team and 7 one-member changes)
    const ranking = result.rankings.KamisatoAyaka!
    ranking.weapons = [
      ranking.weapons[0],
      ...[
        'TheBlackSword',
        'FinaleOfTheDeep',
        'FavoniusSword',
        'SacrificialSword',
        'TheFlute',
        'IronSting',
        'PrototypeRancour',
      ].map((key, i) => ({
        ...ranking.weapons[0],
        weapon: { key, refinement: 5 } as KqmBuild['weapon'],
        total: 990 - i * 10,
      })),
    ]
    mocks.compare.mockImplementation(async ({ weapon, sets }) => ({
      ...result,
      builds: { KamisatoAyaka: { ...build, weapon, sets } },
      after: { ...result.after, total: 930 },
    }))
    render(
      <KqmResults
        teamId="ui-top50"
        runSettings={initial()}
        members={members}
        result={result}
        seconds={1}
        rotationTime={20}
        onDiscard={vi.fn()}
      />,
      { wrapper: wrap }
    )
    const list = screen.getByRole('region', { name: 'Top builds' })
    expect(
      within(list).getAllByRole('button', { name: /^Rank \d/ })
    ).toHaveLength(5)
    fireEvent.click(within(list).getByRole('button', { name: 'Show top 8' }))
    const dialog = screen.getByRole('dialog', { name: 'Top builds' })
    const rows = within(dialog).getAllByRole('button', { name: /^Rank \d/ })
    expect(rows).toHaveLength(8)
    // a team picked in the window: shown on the page, the window closed
    fireEvent.click(rows[7])
    expect(screen.queryByRole('dialog', { name: 'Top builds' })).toBeNull()
    await waitFor(() =>
      expect(mocks.compare).toHaveBeenCalledWith(
        expect.objectContaining({
          weapon: { key: 'PrototypeRancour', refinement: 5 },
        })
      )
    )
  })
  it('keeps the previous result available while recalculating and clears it on discard', async () => {
    const first = sampleResult()
    mocks.optimize.mockResolvedValueOnce(first)
    const hook = renderHook(() => useKqmRun('ui-rerun'))
    await act(async () => {
      await hook.result.current.run(initial())
    })
    expect(hook.result.current.lastResult?.result).toBe(first)
    let finish!: (value: KqmResult) => void
    mocks.optimize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    act(() => {
      void hook.result.current.run(initial())
    })
    expect(hook.result.current.state.type).toBe('running')
    expect(hook.result.current.lastResult?.result).toBe(first)
    // (the run starts after a frame, so the running state paints first)
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    await act(async () => {
      finish(sampleResult())
    })
    await waitFor(() => expect(hook.result.current.state.type).toBe('done'))
    act(() => hook.result.current.clear())
    expect(hook.result.current.lastResult).toBeUndefined()
  })

  it('saves the last result for after a reload, and forgets it on discard', async () => {
    const first = sampleResult()
    mocks.optimize.mockResolvedValueOnce(first)
    const hook = renderHook(() => useKqmRun('ui-saved'))
    await act(async () => {
      await hook.result.current.run(initial())
    })
    // (saved once the page shows it)
    await waitFor(() => expect(mocks.saved.runs['ui-saved']).toBeDefined())
    const saved = mocks.saved.runs['ui-saved']
    expect(saved.savedAt).toBe(hook.result.current.lastResult?.savedAt)
    expect(saved.run.result).toEqual(JSON.parse(JSON.stringify(first)))
    // a reload: nothing in the page's memory for the team, the saved run comes back
    mocks.saved.runs['ui-reloaded'] = saved
    const reloaded = renderHook(() => useKqmRun('ui-reloaded'))
    expect(reloaded.result.current.state.type).toBe('done')
    expect(reloaded.result.current.lastResult?.result).toEqual(saved.run.result)
    // (shown again, not saved again)
    expect(reloaded.result.current.lastResult?.savedAt).toBe(saved.savedAt)
    act(() => reloaded.result.current.clear())
    expect(mocks.saved.runs['ui-reloaded']).toBeUndefined()
    expect(reloaded.result.current.lastResult).toBeUndefined()
  })

  it('goes on when the page is left, and shows the result when it comes back', async () => {
    const first = sampleResult()
    let finish!: (value: KqmResult) => void
    mocks.optimize.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const page = renderHook(() => useKqmRun('ui-background'))
    act(() => {
      void page.result.current.run(initial())
    })
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    // another page (or tab) is shown: the run is not cancelled
    page.unmount()
    const elsewhere = renderHook(() => useKqmRun('ui-background'))
    expect(elsewhere.result.current.state.type).toBe('running')
    elsewhere.unmount()
    await act(async () => {
      finish(first)
    })
    const back = renderHook(() => useKqmRun('ui-background'))
    await waitFor(() => expect(back.result.current.state.type).toBe('done'))
    expect(back.result.current.lastResult?.result).toBe(first)
  })

  it('does not bring back a saved result for other members', () => {
    mocks.saved.runs['ui-other'] = {
      savedAt: 1,
      members: ['Bennett'],
      run: { type: 'done', result: sampleResult(), teamOpt: initial() },
    }
    const hook = renderHook(() => useKqmRun('ui-other'))
    expect(hook.result.current.state.type).toBe('idle')
    expect(mocks.saved.runs['ui-other']).toBeUndefined()
  })
})

describe('KQM results on another database (KQM Compare’s team B)', () => {
  /** Team B's throwaway copy of the database (never the page's) */
  const sandbox = () => ({
    ...mocks.database,
    teamKqmResults: {
      ...mocks.database.teamKqmResults,
      setRun: vi.fn(),
    },
  })
  /** B as KQM Compare has it: every member's build, the entering member alone ranked */
  function resultB(): KqmResult {
    const result = sampleResult()
    const held = (key: string): KqmBuild => ({
      ...build,
      weapon: { key, refinement: 5 } as KqmBuild['weapon'],
    })
    return {
      ...result,
      builds: {
        KamisatoAyaka: build,
        Shenhe: held('CalamityQueller'),
        KaedeharaKazuha: held('FreedomSworn'),
        Bennett: held('MistsplitterReforged'),
      },
      after: {
        total: 1000,
        members: {
          KamisatoAyaka: 700,
          Shenhe: 100,
          KaedeharaKazuha: 100,
          Bennett: 100,
        },
        unmet: {},
      },
      constellations: {
        KamisatoAyaka: 0,
        Shenhe: 0,
        KaedeharaKazuha: 0,
        Bennett: 6,
      },
    } as KqmResult
  }
  const rotationB = {
    text: 'Ayaka E Q',
    opener: '',
    timing: { edits: {} },
  }
  const props = (teamId: string) => ({
    teamId,
    runSettings: initial(),
    members,
    result: resultB(),
    seconds: 1,
    rotationTime: 20,
  })

  it('compares the inspector’s picks on its database, writing nothing to the page’s', async () => {
    const db = sandbox()
    const setRun = vi.spyOn(mocks.database.teamKqmResults, 'setRun')
    const runsBefore = JSON.stringify(mocks.saved.runs)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    mocks.compare.mockImplementation(async ({ weapon, sets }) => ({
      ...resultB(),
      builds: {
        ...resultB().builds,
        KamisatoAyaka: { ...build, weapon, sets },
      },
      after: { ...resultB().after, total: 900 },
    }))
    try {
      render(
        <KqmResults
          {...props('ui-b')}
          database={db as never}
          readOnly
          replayRotation={rotationB}
        />,
        { wrapper: wrap }
      )
      fireEvent.click(screen.getByRole('button', { name: /TheBlackSword/ }))
      await waitFor(() => expect(mocks.compare).toHaveBeenCalled())
      for (const [args] of mocks.compare.mock.calls)
        expect(args.database).toBe(db)
      await waitFor(() =>
        expect(screen.getByText('−10.0% vs best')).toBeTruthy()
      )
      expect(setRun).not.toHaveBeenCalled()
      expect(db.teamKqmResults.setRun).not.toHaveBeenCalled()
      expect(JSON.stringify(mocks.saved.runs)).toBe(runsBefore)
      // (nothing kept for the team in the browser's storage either)
      expect(
        setItem.mock.calls.filter(([key]) => String(key).includes('ui-b'))
      ).toEqual([])
    } finally {
      setRun.mockRestore()
      setItem.mockRestore()
    }
  })

  it('plays B’s own rotation in the inspector, not the team’s written one', async () => {
    localStorage.setItem('teamOptRotationText_ui-b-rot', 'the team’s own')
    const getItem = vi.spyOn(Storage.prototype, 'getItem')
    mocks.compare.mockImplementation(async () => resultB())
    try {
      render(
        <KqmResults
          {...props('ui-b-rot')}
          database={sandbox() as never}
          readOnly
          replayRotation={rotationB}
        />,
        { wrapper: wrap }
      )
      fireEvent.click(screen.getByRole('button', { name: /TheBlackSword/ }))
      await waitFor(() => expect(mocks.compare).toHaveBeenCalled())
      // (B's rotation played: a replay, though nothing of the team's was read)
      expect(mocks.compare.mock.calls[0][0].replay).toBeTypeOf('function')
      const read = getItem.mock.calls.map(([key]) => String(key))
      expect(read.filter((key) => key.endsWith('_ui-b-rot'))).toEqual([])
    } finally {
      getItem.mockRestore()
      localStorage.removeItem('teamOptRotationText_ui-b-rot')
    }
  })

  it('offers B’s build for gc-web too (only the build is read, not B’s database)', () => {
    mocks.gcweb.length = 0
    render(
      <KqmResults
        {...props('ui-b-gcweb')}
        database={sandbox() as never}
        readOnly
        replayRotation={rotationB}
      />,
      { wrapper: wrap }
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Artifacts for gc-web' })
    )
    expect(mocks.gcweb[0]).toMatchObject({
      characterKey: 'KamisatoAyaka',
      input: { fromKqm: build },
    })
  })

  it('read only: no discard and no share of B as the team', () => {
    render(
      <KqmResults
        {...props('ui-b-ro')}
        database={sandbox() as never}
        readOnly
        replayRotation={rotationB}
      />,
      { wrapper: wrap }
    )
    expect(screen.getByRole('tablist', { name: 'Team builds' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
  })

  it('shows every member, and the inspector only for the one ranked', () => {
    render(
      <KqmResults
        {...props('ui-b-tiles')}
        database={sandbox() as never}
        readOnly
        replayRotation={rotationB}
      />,
      { wrapper: wrap }
    )
    const tiles = within(
      screen.getByRole('tablist', { name: 'Team builds' })
    ).getAllByRole('tab')
    expect(tiles).toHaveLength(4)
    const tile = (key: string) =>
      tiles.find((t) => t.textContent?.includes(key))!
    expect(tile('KamisatoAyaka').getAttribute('aria-selected')).toBe('true')
    // (a held build: its tile shows it, there is nothing of its to rank)
    for (const key of ['Shenhe', 'KaedeharaKazuha', 'Bennett']) {
      expect(tile(key).hasAttribute('disabled')).toBe(true)
      expect(tile(key).getAttribute('aria-selected')).toBe('false')
    }
    expect(
      screen.getAllByRole('region', { name: 'Compare equipment' })
    ).toHaveLength(1)
  })

  it('is read only by default on another database', () => {
    render(
      <KqmResults
        {...props('ui-b-default')}
        database={sandbox() as never}
        replayRotation={rotationB}
        onDiscard={vi.fn()}
      />,
      { wrapper: wrap }
    )
    expect(screen.queryByRole('button', { name: 'Discard' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share' })).toBeNull()
  })

  it('says on each held tile that it is locked, in words and not on hover only', () => {
    render(
      <KqmResults
        {...props('ui-b-held')}
        database={sandbox() as never}
        replayRotation={rotationB}
        heldLabel="Locked: A’s build"
      />,
      { wrapper: wrap }
    )
    const tiles = within(
      screen.getByRole('tablist', { name: 'Team builds' })
    ).getAllByRole('tab')
    const tile = (key: string) =>
      tiles.find((t) => t.textContent?.includes(key))!
    for (const key of ['Shenhe', 'KaedeharaKazuha', 'Bennett']) {
      const described = tile(key).getAttribute('aria-describedby')
      expect(described).toBeTruthy()
      const label = document.getElementById(described!)
      expect(label?.textContent).toBe('Locked: A’s build')
      // (shown in the tile, with its lock)
      expect(tile(key).contains(label)).toBe(true)
      expect(
        within(tile(key))
          .getByTestId('LockOutlinedIcon')
          .getAttribute('aria-hidden')
      ).toBe('true')
    }
    // (the entering member is not locked)
    expect(tile('KamisatoAyaka').getAttribute('aria-describedby')).toBeNull()
    expect(
      within(tile('KamisatoAyaka')).queryByText('Locked: A’s build')
    ).toBeNull()
  })

  it('shows a note by the inspector when one is given', () => {
    const { unmount } = render(
      <KqmResults
        {...props('ui-b-note')}
        database={sandbox() as never}
        replayRotation={rotationB}
        inspectorNote={{
          label: 'Picks can re-tune teammates',
          tip: 'As in KQM Theorycrafting.',
        }}
      />,
      { wrapper: wrap }
    )
    const note = screen.getByText('Picks can re-tune teammates')
    const inspector = screen.getByRole('region', { name: 'Compare equipment' })
    // (right before the inspector)
    expect(
      note.compareDocumentPosition(inspector) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    unmount()
    render(
      <KqmResults
        {...props('ui-b-nonote')}
        database={sandbox() as never}
        replayRotation={rotationB}
      />,
      { wrapper: wrap }
    )
    expect(screen.queryByText('Picks can re-tune teammates')).toBeNull()
  })

  it('shows its own run’s progress on its preliminary builds', () => {
    render(
      <KqmResults
        {...props('ui-b-progress')}
        database={sandbox() as never}
        readOnly
        replayRotation={rotationB}
        running
        improving
        progress={0.42}
      />,
      { wrapper: wrap }
    )
    expect(screen.getByText('Preliminary builds')).toBeTruthy()
    expect(screen.getByText('42%')).toBeTruthy()
    // (by default the banner announces itself)
    expect(
      screen.getByText('Preliminary builds').closest('[role="status"]')
    ).toBeTruthy()
  })

  it('a quiet banner: its host’s words, no “still improving”, no live region (the host announces)', () => {
    render(
      <KqmResults
        {...props('ui-b-quiet')}
        database={sandbox() as never}
        readOnly
        replayRotation={rotationB}
        running
        improving
        progress={0.42}
        preliminary="quiet"
        preliminaryLabel="Ranking weapons and sets"
      />,
      { wrapper: wrap }
    )
    const label = screen.getByText('Ranking weapons and sets')
    expect(screen.queryByText('Preliminary builds')).toBeNull()
    expect(screen.queryByText('still improving')).toBeNull()
    expect(screen.getByText('42%')).toBeTruthy()
    expect(label.closest('[role="status"]')).toBeNull()
    expect(label.closest('[aria-live]')).toBeNull()
  })

  it('a quiet banner ends with its host’s words, not “Final builds”', () => {
    const base = {
      ...props('ui-b-quiet-end'),
      database: sandbox() as never,
      replayRotation: rotationB,
      preliminary: 'quiet' as const,
      preliminaryLabel: 'Ranking weapons and sets',
      preliminaryFinalLabel: 'Rankings ready',
    }
    const view = render(<KqmResults {...base} running improving />, {
      wrapper: wrap,
    })
    view.rerender(<KqmResults {...base} />)
    expect(screen.getByText('Rankings ready')).toBeTruthy()
    expect(screen.queryByText('Final builds')).toBeNull()
  })

  it('puts its headings at the level it is given, below its host’s', () => {
    const { unmount } = render(
      <KqmResults
        {...props('ui-b-headings')}
        database={sandbox() as never}
        replayRotation={rotationB}
        headingLevel={4}
      />,
      { wrapper: wrap }
    )
    expect(
      screen.getByRole('heading', { name: 'Team builds', level: 4 })
    ).toBeTruthy()
    // (the inspector's member, a level below)
    expect(
      screen.getByRole('heading', { name: 'KamisatoAyaka', level: 5 })
    ).toBeTruthy()
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0)
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0)
    unmount()
    // (by default: as on KQM Theorycrafting)
    render(
      <KqmResults
        {...props('ui-b-headings-default')}
        database={sandbox() as never}
        replayRotation={rotationB}
      />,
      { wrapper: wrap }
    )
    expect(
      screen.getByRole('heading', { name: 'Team builds', level: 2 })
    ).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: 'KamisatoAyaka', level: 3 })
    ).toBeTruthy()
  })

  it('does not say “Final builds” when its host says the run did not finish', () => {
    const base = {
      ...props('ui-b-unfinished'),
      database: sandbox() as never,
      replayRotation: rotationB,
    }
    const view = render(<KqmResults {...base} running improving />, {
      wrapper: wrap,
    })
    expect(screen.getByText('Preliminary builds')).toBeTruthy()
    view.rerender(<KqmResults {...base} unfinished />)
    expect(screen.queryByText('Preliminary builds')).toBeNull()
    expect(screen.queryByText('Final builds')).toBeNull()
  })

  it('without them: the page’s database, discard and share, as before', async () => {
    mocks.compare.mockImplementation(async () => sampleResult())
    render(
      <KqmResults
        teamId="ui-page"
        runSettings={initial()}
        members={members}
        result={sampleResult()}
        seconds={1}
        rotationTime={20}
        onDiscard={vi.fn()}
      />,
      { wrapper: wrap }
    )
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Share' })).toBeTruthy()
    expect(document.getElementById('kqm-results-ui-page')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /TheBlackSword/ }))
    await waitFor(() => expect(mocks.compare).toHaveBeenCalled())
    expect(mocks.compare.mock.calls[0][0].database).toBe(mocks.database)
  })
})
