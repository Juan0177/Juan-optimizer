// @vitest-environment jsdom

import { initTeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamOptResult } from '@genshin-optimizer/gi/ui'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { setAutoRankEquipment } from './autoRankEquipment'
import { useTeamOptRun } from './useTeamOptRun'

const capturedJobs: Array<{
  job: Record<string, unknown>
  updates: {
    onResult: (result: TeamOptResult) => void
    onOptions: (ck: string, ranked: unknown) => void
    onSetOptions?: (ck: string, ranked: unknown) => void
    onGearComparisons?: (comparisons: unknown[]) => void
  }
}> = []

const savedRuns: Record<string, unknown> = {}

const mockDatabase = {
  teams: {
    get: () => ({
      loadoutData: [],
      teamOpt: initTeamOpt(),
    }),
    follow: () => () => {},
  },
  teamChars: { get: () => undefined },
  optConfigs: {
    get: () => undefined,
    followAny: () => () => {},
  },
  arts: { get: () => undefined },
  weapons: { get: () => undefined },
  teamOptResults: {
    get: () => ({ runs: savedRuns }),
    setRun: (id: string, value: unknown) => {
      if (value === undefined) delete savedRuns[id]
      else savedRuns[id] = value
    },
  },
}

vi.mock('@genshin-optimizer/gi/db-ui', () => ({
  useDatabase: () => mockDatabase,
  useDBMeta: () => ({ gender: 'F' }),
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({ i18n: {} }),
}))

vi.mock('./RotationWriter', () => ({
  teamRunRotation: () => undefined,
  playedRotationKey: () => 'rot_key',
}))

vi.mock('./runScope', () => ({
  sameBuildRoster: () => true,
  teamRoster: () => 'Furina,Yelan',
  teamRunKey: (_db: unknown, teamId: string) => `run:${teamId}`,
}))

vi.mock('./useTeamOpt', () => ({
  inventoryRequirementsKey: () => 'req_key',
}))

vi.mock('@genshin-optimizer/gi/solver', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  nextPaint: () => Promise.resolve(),
}))

const sampleResult = (): TeamOptResult => ({
  builds: { Furina: {}, Yelan: {} },
  weapons: { Furina: 'w1', Yelan: 'w2' },
  before: {
    total: 100,
    members: { Furina: 50, Yelan: 50 },
    attacks: {},
    unmet: {},
  },
  after: {
    total: 120,
    members: { Furina: 60, Yelan: 60 },
    attacks: {},
    unmet: {},
  },
  rounds: 2,
  optimized: ['Furina', 'Yelan'],
})

vi.mock('@genshin-optimizer/gi/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNumWorkers: () => [2, vi.fn()],
  runEnemyOf: () => undefined,
  teamOptMembers: () => [],
  startTeamOptWorker: (
    _db: unknown,
    job: Record<string, unknown>,
    updates: (typeof capturedJobs)[number]['updates']
  ) => {
    capturedJobs.push({ job, updates })
    const done = Promise.resolve().then(() => {
      updates.onResult(sampleResult())
      if (job['ranking']) {
        updates.onOptions('Furina', { best: 120, weapons: [], sets: [] })
        updates.onOptions('Yelan', { best: 120, weapons: [], sets: [] })
      }
    })
    return { done, stop: vi.fn() }
  },
}))

afterEach(() => {
  capturedJobs.length = 0
  for (const k of Object.keys(savedRuns)) delete savedRuns[k]
  setAutoRankEquipment(false)
})

describe('useTeamOptRun auto-rank equipment preference', () => {
  it('skips equipment ranking by default when Auto-rank equipment is off', async () => {
    setAutoRankEquipment(false)
    const { result } = renderHook(() => useTeamOptRun('team_manual'))
    await act(async () => {
      await result.current.run()
    })

    expect(capturedJobs).toHaveLength(1)
    expect(capturedJobs[0].job['ranking']).toBe(false)
    await waitFor(() => {
      expect(result.current.state.type).toBe('done')
    })
    if (result.current.state.type === 'done') {
      expect(result.current.state.optionsRunning).toBeUndefined()
      expect(result.current.state.result.rankingsComplete).toBeUndefined()
    }
  })

  it('automatically ranks equipment in the same run when Auto-rank equipment is enabled', async () => {
    setAutoRankEquipment(true)
    const { result } = renderHook(() => useTeamOptRun('team_auto'))
    await act(async () => {
      await result.current.run()
    })

    expect(capturedJobs).toHaveLength(1)
    expect(capturedJobs[0].job['ranking']).toBe(true)
    await waitFor(() => {
      expect(result.current.state.type).toBe('done')
      if (result.current.state.type === 'done') {
        expect(result.current.state.optionsRunning).toBeUndefined()
        expect(result.current.state.result.rankingsComplete).toBe(true)
        expect(result.current.state.result.rankedMembers).toEqual([
          'Furina',
          'Yelan',
        ])
      }
    })
  })
})
