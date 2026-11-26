// @vitest-environment jsdom

import { initTeamOpt } from '@genshin-optimizer/gi/db'
import type { RotationScenario, TeamOptResult } from '@genshin-optimizer/gi/ui'
import { createTheme, ThemeProvider } from '@mui/material'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RotationCompareButton } from './RotationCompare'
import type { RotationSearchBase } from './RotationSearch'
import type {
  ScenarioCompareMode,
  ScenarioLiveStep,
  ScenarioPreview,
  ScenarioRunContext,
  ScenarioRunResult,
} from './rotationScenarioRun'

const mockPreview =
  vi.fn<(ctx: ScenarioRunContext, sc: RotationScenario) => ScenarioPreview>()
const mockBaseline =
  vi.fn<
    (
      ctx: ScenarioRunContext,
      sc: RotationScenario
    ) => ScenarioRunResult | undefined
  >()
const mockRun =
  vi.fn<
    (
      ctx: ScenarioRunContext,
      sc: RotationScenario,
      isCancelled: () => boolean,
      options?: {
        mode?: ScenarioCompareMode
        onStep?: (step: ScenarioLiveStep) => void
        fromTeam?: ScenarioRunResult['teamSeed']
        fromKqm?: ScenarioRunResult['kqmSeed']
        keepKqmWorkers?: boolean
      }
    ) => Promise<ScenarioRunResult>
  >()
const mockApply = vi.fn<(args: { scenario: RotationScenario }) => boolean>()

vi.mock('./rotationScenarioRun', () => ({
  previewRotationScenario: (ctx: ScenarioRunContext, sc: RotationScenario) =>
    mockPreview(ctx, sc),
  baselineScenarioResult: (ctx: ScenarioRunContext, sc: RotationScenario) =>
    mockBaseline(ctx, sc),
  runRotationScenario: (
    ctx: ScenarioRunContext,
    sc: RotationScenario,
    isCancelled: () => boolean,
    options?: {
      mode?: ScenarioCompareMode
      onStep?: (step: ScenarioLiveStep) => void
      fromTeam?: ScenarioRunResult['teamSeed']
      fromKqm?: ScenarioRunResult['kqmSeed']
      keepKqmWorkers?: boolean
    }
  ) => mockRun(ctx, sc, isCancelled, options),
  applyRotationScenario: (args: { scenario: RotationScenario }) =>
    mockApply(args),
}))
vi.mock('@genshin-optimizer/gi/db-ui', () => ({
  useDatabase: () => ({}),
  useDBMeta: () => ({ gender: 'F' }),
}))
vi.mock('./MemberAvatar', () => ({
  MemberAvatar: ({ characterKey }: { characterKey: string }) => (
    <span data-avatar={characterKey} />
  ),
}))
vi.mock('./RotationWriter', () => ({
  kqmRotationId: (id: string) => `${id}_kqm`,
  playedRotationKey: (text: string) => text,
  useRotationSettings: () => ({
    opener: '',
    timing: { edits: {} },
    frameData: {},
  }),
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    i18n: { language: 'en' },
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
        for (const [k, v] of Object.entries(options))
          text = text.replaceAll(`{{${k}}}`, String(v))
      }
      return text
    },
  }),
}))
vi.mock('@genshin-optimizer/gi/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNumWorkers: () => [2],
  WeaponName: ({ weaponKey }: { weaponKey: string }) => <>{weaponKey}</>,
  ArtifactSetName: ({ setKey }: { setKey: string }) => <>{setKey}</>,
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const theme = createTheme({ palette: { mode: 'dark' } })
const names = [
  { characterKey: 'Columbina' as const, name: 'Columbina' },
  { characterKey: 'Illuga' as const, name: 'Illuga' },
  { characterKey: 'Linnea' as const, name: 'Linnea' },
  { characterKey: 'Zibai' as const, name: 'Zibai' },
]
const example =
  'Columbina E Q -> Illuga E Q -> Linnea E -> Zibai E N1 Q N4 E N4 E N4 E N4 E'

const teamBase: RotationSearchBase = {
  tab: 'team',
  teamOpt: initTeamOpt(),
  result: {
    builds: {},
    weapons: {},
    after: { total: 2_160_000, members: {}, attacks: {}, unmet: {} },
  } as unknown as TeamOptResult,
}

describe('RotationCompare', () => {
  it('disables Compare until the user has run optimization at least once', () => {
    render(
      <ThemeProvider theme={theme}>
        <RotationCompareButton
          compact
          tab="team"
          teamId="team_1"
          text={example}
          names={names}
          teamOpt={initTeamOpt()}
          setTeamOpt={vi.fn()}
          base={undefined}
        />
      </ThemeProvider>
    )

    const btn = screen.getByRole('button', {
      name: /Burst scenarios/i,
    }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('detects bursting members, reuses fresh baseline, runs remaining scenarios, ranks, and applies winner', async () => {
    mockPreview.mockImplementation((_ctx, sc) => ({
      scenarioId: sc.id,
      rotationTime: sc.burstEvery.Columbina === 2 ? 18.1 : 18.6,
      erTargets: {
        Columbina: sc.burstEvery.Columbina === 2 ? 112 : 182,
        Illuga: 156,
        Zibai: sc.burstEvery.Zibai === 2 ? 100 : 128,
      },
      stalls: [],
      warnings: [],
    }))

    // Baseline scenario is reused immediately from the active tab's existing optimization run
    mockBaseline.mockImplementation((_ctx, sc) =>
      sc.isBaseline
        ? {
            scenario: sc,
            dps: 120000,
            total: 2_232_000,
            rotationTime: 18.6,
            memberDps: {
              Columbina: 22000,
              Illuga: 12000,
              Linnea: 8000,
              Zibai: 78000,
            },
            erTargets: { Columbina: 182, Illuga: 156, Zibai: 128 },
            erAchieved: { Columbina: 185, Illuga: 160, Zibai: 130 },
            weapons: {},
            sets: {},
            unmetCount: 0,
            stalls: [],
            warnings: [],
            reused: true,
            teamSeed: { builds: {}, weapons: {} },
          }
        : undefined
    )

    mockRun.mockImplementation(async (_ctx, sc) => {
      const col2 = sc.burstEvery.Columbina === 2
      const zib2 = sc.burstEvery.Zibai === 2
      const dps = col2 && zib2 ? 132000 : col2 ? 128000 : zib2 ? 124000 : 120000
      return {
        scenario: sc,
        dps,
        total: dps * 18,
        rotationTime: col2 ? 18.1 : 18.6,
        memberDps: {
          Columbina: 22000,
          Illuga: 12000,
          Linnea: 8000,
          Zibai: dps - 42000,
        },
        erTargets: {
          Columbina: col2 ? 112 : 182,
          Illuga: 156,
          Zibai: zib2 ? 100 : 128,
        },
        erAchieved: {
          Columbina: col2 ? 118 : 185,
          Illuga: 160,
          Zibai: zib2 ? 105 : 130,
        },
        weapons: {},
        sets: {},
        unmetCount: 0,
        stalls: [],
        warnings: [],
      }
    })
    mockApply.mockReturnValue(true)

    const onApplied = vi.fn()
    render(
      <ThemeProvider theme={theme}>
        <RotationCompareButton
          compact
          tab="team"
          teamId="team_1"
          text={example}
          names={names}
          teamOpt={initTeamOpt()}
          setTeamOpt={vi.fn()}
          base={teamBase}
          onApplied={onApplied}
        />
      </ThemeProvider>
    )

    // Open dialog
    fireEvent.click(screen.getByRole('button', { name: /Burst scenarios/i }))
    expect(
      screen.getByRole('heading', { name: 'Burst scenarios' })
    ).toBeTruthy()
    expect(screen.getAllByText('Columbina').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Illuga').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Zibai').length).toBeGreaterThan(0)
    // Linnea does not burst in the rotation so she does not clutter the matrix
    expect(screen.queryByText('Linnea')).toBeNull()

    // Select Every 2nd for Columbina (row 0) and Zibai (row 2)
    const every2Buttons = screen.getAllByRole('checkbox', {
      name: 'Every 2nd',
    })
    fireEvent.click(every2Buttons[0]) // Columbina Every 2nd
    fireEvent.click(every2Buttons[2]) // Zibai Every 2nd

    // Type N4 into Zibai's "Instead of Q" input
    const zibaiInstead = screen.getByLabelText('Zibai Instead of Q')
    fireEvent.change(zibaiInstead, { target: { value: 'N4' } })

    // Should now generate 4 scenarios and enable Compare 4 scenarios CTA
    const runBtn = screen.getByRole('button', { name: 'Compare 4 scenarios' })
    expect((runBtn as HTMLButtonElement).disabled).toBe(false)

    // Run comparison: baseline reused immediately, so only 3 remaining scenarios invoke runRotationScenario
    fireEvent.click(runBtn)

    await waitFor(() => {
      expect(mockRun).toHaveBeenCalledTimes(3)
    })

    // Winner (132,000 DPS, +10% vs 120,000 baseline) should be ranked #1 with Apply button
    await waitFor(() => {
      expect(screen.getByText('132,000')).toBeTruthy()
      expect(screen.getByText('+10%')).toBeTruthy()
    })

    // Apply #1 winner
    const applyButtons = screen.getAllByRole('button', { name: 'Apply' })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(applyButtons[0])
    confirm.mockRestore()

    expect(mockApply).toHaveBeenCalledTimes(1)
    const appliedScenario = mockApply.mock.calls[0][0].scenario
    expect(appliedScenario.burstEvery).toEqual({
      Columbina: 2,
      Illuga: 1,
      Zibai: 2,
    })
    expect(appliedScenario.text).toContain('Zibai E N1 Q/N4 N4 E')
    expect(onApplied).toHaveBeenCalledWith(appliedScenario.text)
  })

  it('streams live sub-step progress, marks pending rows Queued, and warm-starts from base run', async () => {
    mockPreview.mockImplementation((_ctx, sc) => ({
      scenarioId: sc.id,
      rotationTime: 18.3,
      erTargets: { Columbina: 182, Illuga: 148, Zibai: 106 },
      stalls: [],
      warnings: [],
    }))
    // Simulate stale base so both scenarios run, still warm-started from base.result
    mockBaseline.mockReturnValue(undefined)

    const resolvers: Array<() => void> = []
    mockRun.mockImplementation(async (_ctx, sc, _isCancelled, options) => {
      options?.onStep?.({
        fraction: 0.62,
        detail: 'Round 1 · Zibai · weapon 2/3 · 62%',
      })
      await new Promise<void>((resolve) => resolvers.push(resolve))
      return {
        scenario: sc,
        dps: 300000,
        total: 5490000,
        rotationTime: 18.3,
        memberDps: { Zibai: 200000 },
        erTargets: { Columbina: 182, Illuga: 148, Zibai: 106 },
        erAchieved: { Columbina: 185, Illuga: 150, Zibai: 110 },
        weapons: {},
        sets: {},
        unmetCount: 0,
        stalls: [],
        warnings: [],
      }
    })

    render(
      <ThemeProvider theme={theme}>
        <RotationCompareButton
          compact
          tab="team"
          teamId="team_1"
          text={example}
          names={names}
          teamOpt={initTeamOpt()}
          setTeamOpt={vi.fn()}
          base={teamBase}
          baseStale
        />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /Burst scenarios/i }))
    const every2Buttons = screen.getAllByRole('checkbox', {
      name: 'Every 2nd',
    })
    fireEvent.click(every2Buttons[0]) // 2 scenarios

    fireEvent.click(screen.getByRole('button', { name: 'Compare 2 scenarios' }))

    // While scenario 1 is running: live step detail, percentage, and Queued label appear
    await waitFor(() => {
      expect(
        screen.getAllByText(/Round 1 · Zibai · weapon 2\/3 · 62%/).length
      ).toBeGreaterThan(0)
      expect(screen.getByText('62%')).toBeTruthy()
      expect(screen.getByText('Queued')).toBeTruthy()
    })

    // Scenario 1 defaults to fast refit mode and receives base.result's builds/weapons as warm-start seed
    expect(mockRun.mock.calls[0][3]?.mode).toBe('fast')
    expect(mockRun.mock.calls[0][3]?.fromTeam).toEqual({
      builds: {},
      weapons: {},
    })

    resolvers[0]()
    await waitFor(() => {
      expect(mockRun).toHaveBeenCalledTimes(2)
    })

    resolvers[1]()
    await waitFor(() => {
      expect(screen.getAllByText('300,000').length).toBe(2)
    })
  })

  it('never lets scenario or overall progress percentage move backwards', async () => {
    mockPreview.mockImplementation((_ctx, sc) => ({
      scenarioId: sc.id,
      rotationTime: 18.3,
      erTargets: { Columbina: 182, Illuga: 148, Zibai: 106 },
      stalls: [],
      warnings: [],
    }))
    mockBaseline.mockReturnValue(undefined)

    let emitStep: ((step: ScenarioLiveStep) => void) | undefined
    const resolvers: Array<() => void> = []
    mockRun.mockImplementation(async (_ctx, sc, _isCancelled, options) => {
      emitStep = options?.onStep
      options?.onStep?.({
        fraction: 0.64,
        detail: 'Round 1 · Zibai · weapon 2/3 · 64%',
      })
      await new Promise<void>((resolve) => resolvers.push(resolve))
      return {
        scenario: sc,
        dps: 300000,
        total: 5490000,
        rotationTime: 18.3,
        memberDps: { Zibai: 200000 },
        erTargets: { Columbina: 182, Illuga: 148, Zibai: 106 },
        erAchieved: { Columbina: 185, Illuga: 150, Zibai: 110 },
        weapons: {},
        sets: {},
        unmetCount: 0,
        stalls: [],
        warnings: [],
      }
    })

    render(
      <ThemeProvider theme={theme}>
        <RotationCompareButton
          compact
          tab="team"
          teamId="team_1"
          text={example}
          names={names}
          teamOpt={initTeamOpt()}
          setTeamOpt={vi.fn()}
          base={teamBase}
          baseStale
        />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /Burst scenarios/i }))
    const every2Buttons = screen.getAllByRole('checkbox', {
      name: 'Every 2nd',
    })
    fireEvent.click(every2Buttons[0])
    fireEvent.click(screen.getByRole('button', { name: 'Compare 2 scenarios' }))

    await waitFor(() => {
      expect(screen.getByText('64%')).toBeTruthy()
      expect(screen.getByText('32%')).toBeTruthy() // overall: 0.64 / 2
    })

    // Simulate a regressive step update: UI must keep 64% (and overall 32%) instead of dropping
    act(() => {
      emitStep?.({
        fraction: 0.25,
        detail: 'Round 1 · Zibai · weapon 3/3 · 10%',
      })
    })
    await waitFor(() => {
      expect(
        screen.getAllByText(/Round 1 · Zibai · weapon 3\/3 · 10%/).length
      ).toBeGreaterThan(0)
    })
    expect(screen.getByText('64%')).toBeTruthy()
    expect(screen.getByText('32%')).toBeTruthy()
    expect(screen.queryByText('25%')).toBeNull()

    resolvers[0]()
    await waitFor(() => {
      expect(mockRun).toHaveBeenCalledTimes(2)
    })
    resolvers[1]()
    await waitFor(() => {
      expect(screen.getAllByText('300,000').length).toBe(2)
    })
  })
})
