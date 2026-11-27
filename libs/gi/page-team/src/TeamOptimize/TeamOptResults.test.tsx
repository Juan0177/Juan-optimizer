// @vitest-environment jsdom

import type {
  ArtifactSetKey,
  CharacterKey,
  WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactSetKeys } from '@genshin-optimizer/gi/consts'
import type {
  ICachedWeapon,
  StatFilters,
  TeamOpt,
} from '@genshin-optimizer/gi/db'
import { initTeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamOptMember, TeamOptResult } from '@genshin-optimizer/gi/ui'
import { defaultEnergyCalculator } from '@genshin-optimizer/gi/ui'
import { createTheme, ThemeProvider } from '@mui/material'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readAutoRankEquipment,
  setAutoRankEquipment,
} from './autoRankEquipment'
import { TeamOptResults } from './TeamOptResults'
import { GearRankingControls, TeamOptTopBuilds } from './TeamOptTopBuilds'

const ER_FILTER = JSON.stringify(['basic', 'enerRech_'])

const weaponsById: Record<string, ICachedWeapon> = {
  w_wgs: {
    id: 'w_wgs',
    key: 'WolfsGravestone',
    level: 90,
    ascension: 6,
    refinement: 1,
    location: 'Sandrone',
    lock: false,
  },
  w_fav: {
    id: 'w_fav',
    key: 'FavoniusSword',
    level: 90,
    ascension: 6,
    refinement: 5,
    location: 'Furina',
    lock: false,
  },
  w_pjc: {
    id: 'w_pjc',
    key: 'PrimordialJadeCutter',
    level: 90,
    ascension: 6,
    refinement: 2,
    location: 'Furina',
    lock: false,
  },
}

let optConfigEntries: [string, { statFilters: StatFilters }][] = []

const mockDatabase = {
  arts: {
    get: (id: string) => {
      const key = id.split(':')[0] as ArtifactSetKey
      return allArtifactSetKeys.includes(key) ? { setKey: key } : undefined
    },
  },
  chars: {
    get: (ck: CharacterKey) => ({
      constellation: ck === 'Furina' ? 2 : 0,
    }),
  },
  weapons: {
    get: (id: string) => weaponsById[id],
  },
  buildTcs: { get: () => undefined },
  optConfigs: {
    get: (id: string) =>
      optConfigEntries.find(([k]) => k === id)?.[1] ?? undefined,
  },
  teams: { get: () => undefined },
  teamChars: { get: () => undefined },
}

vi.mock('@genshin-optimizer/common/database-ui', () => ({
  useDataManagerEntries: () => optConfigEntries,
}))
vi.mock('@genshin-optimizer/gi/db-ui', () => ({
  useDatabase: () => mockDatabase,
  useDBMeta: () => ({ gender: 'F' }),
  useTeam: () => ({ name: 'Abyss Team' }),
}))
vi.mock('./useTeamOpt', () => ({
  useTeamOpt: () => [initTeamOpt(), vi.fn()],
}))
const mockSaveTeamResult = vi.fn()
vi.mock('./apply', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  changedMembers: () => ['Sandrone'],
  equipChanges: () => [],
  equipTeamResult: vi.fn(),
  saveTeamResult: (...args: unknown[]) => mockSaveTeamResult(...args),
  undoTeamEquip: vi.fn(),
}))
vi.mock('./ResultDetails', () => ({
  MemberDetails: () => null,
  useResultDetails: () => undefined,
}))
vi.mock('./TeamCardButton', () => ({
  TeamCardButton: () => <button type="button">Team card</button>,
}))
vi.mock('./MemberAvatar', () => ({
  MemberAvatar: ({ characterKey }: { characterKey: string }) => (
    <span data-avatar={characterKey} />
  ),
}))
vi.mock('@genshin-optimizer/gi/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ArtifactCardPico: () => <span data-art="" />,
  ArtifactSetName: ({ setKey }: { setKey: string }) => <>{setKey}</>,
  ArtifactSetTooltip: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  CharacterName: ({ characterKey }: { characterKey: string }) => (
    <>{characterKey}</>
  ),
  WeaponDetails: () => null,
  WeaponName: ({ weaponKey }: { weaponKey: WeaponKey }) => <>{weaponKey}</>,
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      let text =
        typeof options === 'string'
          ? options
          : String(options?.['defaultValue'] ?? key.split('.').at(-1))
      if (typeof options === 'object') {
        for (const [k, v] of Object.entries(options))
          text = text.replaceAll(`{{${k}}}`, String(v))
      }
      return text
    },
  }),
}))

afterEach(() => {
  cleanup()
  optConfigEntries = []
  setAutoRankEquipment(false)
})

const theme = createTheme({ palette: { mode: 'dark' } })

const makeMember = (
  characterKey: CharacterKey,
  weaponId: string
): TeamOptMember =>
  ({
    characterKey,
    weaponId,
    isTc: false,
    artifactIds: {
      flower: undefined,
      plume: undefined,
      sands: undefined,
      goblet: undefined,
      circlet: undefined,
    },
    teamCharId: `tc_${characterKey}`,
    teamChar: { optConfigId: `opt_${characterKey}` },
    loadoutDatum: {},
  }) as unknown as TeamOptMember

const baseMembers = [
  makeMember('Sandrone', 'w_wgs'),
  makeMember('Furina', 'w_fav'),
]

const makeResult = (overrides: Partial<TeamOptResult> = {}): TeamOptResult => ({
  builds: {
    Sandrone: {
      flower: undefined,
      plume: undefined,
      sands: undefined,
      goblet: undefined,
      circlet: undefined,
    },
    Furina: {
      flower: undefined,
      plume: undefined,
      sands: undefined,
      goblet: undefined,
      circlet: undefined,
    },
  },
  weapons: { Sandrone: 'w_wgs', Furina: 'w_fav' },
  before: {
    total: 4_000_000,
    members: { Sandrone: 2_500_000, Furina: 1_500_000 },
    attacks: {},
    unmet: {},
  },
  after: {
    total: 5_000_000,
    members: { Sandrone: 3_500_000, Furina: 1_500_000 },
    attacks: {},
    unmet: {},
  },
  rounds: 3,
  optimized: ['Sandrone', 'Furina'],
  ...overrides,
})

it('adds coordinated rows to the existing 50 Top builds and ranks by replay DPS', () => {
  const baseline = makeResult()
  const coordinated = {
    changed: baseline.optimized,
    builds: baseline.builds,
    weapons: baseline.weapons,
    after: { ...baseline.after, total: 3_000_000 },
    rotationTime: 10,
  }
  const result = makeResult({
    gearComparisons: [coordinated],
    options: {
      Sandrone: {
        best: baseline.after.total,
        weapons: [],
        sets: allArtifactSetKeys.slice(0, 51).map((set, i) => ({
          set,
          value: baseline.after.total - (i + 1) * 1000,
          weaponId: 'w_wgs',
          artifactIds: { flower: `${set}:flower`, plume: `${set}:plume` },
        })),
      },
    },
  })
  const onCompare = vi.fn()
  render(
    <ThemeProvider theme={theme}>
      <TeamOptTopBuilds
        members={baseline.optimized}
        result={result}
        picks={{}}
        rotationTime={20}
        onPick={vi.fn()}
        onCompare={onCompare}
      />
    </ThemeProvider>
  )
  const list = within(screen.getByRole('region', { name: 'Top builds' }))
  expect(list.getByRole('button', { name: /^Rank 1.*300,000/ })).toBeTruthy()
  fireEvent.click(list.getByRole('button', { name: 'Show top 51' }))
  const rows = within(
    screen.getByRole('dialog', { name: 'Top builds' })
  ).getAllByRole('button', { name: /^Rank \d/ })
  expect(rows).toHaveLength(51)
  expect(rows[50].getAttribute('aria-label')).toMatch('247,550')
  fireEvent.click(rows[0])
  expect(onCompare).toHaveBeenCalledWith(coordinated)
})

describe('TeamOptResults ER requirement display', () => {
  it('shows each character’s calculated ER requirement (including 100% when burst is unused)', () => {
    const calc = defaultEnergyCalculator(['Sandrone', 'Furina'], 20)
    calc.members.Sandrone!.burstEvery = 0
    calc.members.Furina!.burstEvery = 1
    calc.members.Furina!.favoniusProcs = 1
    const runTeamOpt: TeamOpt = {
      ...initTeamOpt(),
      energySource: 'calculator',
      energyCalculator: calc,
    }
    render(
      <ThemeProvider theme={theme}>
        <TeamOptResults
          teamId="team_1"
          members={baseMembers}
          result={makeResult()}
          seconds={15}
          runTeamOpt={runTeamOpt}
          rotationTime={20}
          teamData={undefined}
          onDiscard={vi.fn()}
        />
      </ThemeProvider>
    )
    // Sandrone (burst unused) shows ER 100%
    expect(screen.getByText('ER 100%')).toBeTruthy()
    // Furina shows her calculated ER requirement above 100%
    expect(screen.getAllByText(/^ER \d+(\.\d)?%$/).length).toBe(2)
  })

  it('shows manual Min ER (with weapon energy relief applied) and "No ER" when unset', () => {
    optConfigEntries = [
      [
        'opt_Furina',
        { statFilters: { [ER_FILTER]: [{ value: 180, disabled: false }] } },
      ],
      ['opt_Sandrone', { statFilters: {} }],
    ]
    const runTeamOpt: TeamOpt = {
      ...initTeamOpt(),
      energySource: 'manual',
      weaponEnergy: { w_fav: { Furina: 26 } },
    }
    render(
      <ThemeProvider theme={theme}>
        <TeamOptResults
          teamId="team_1"
          members={baseMembers}
          result={makeResult({
            energy: { Furina: { relief: 26, weaponIds: ['w_fav'] } },
          })}
          seconds={12}
          runTeamOpt={runTeamOpt}
          rotationTime={20}
          teamData={undefined}
          onDiscard={vi.fn()}
        />
      </ThemeProvider>
    )
    // 180% - 26% Favonius relief = 154%
    expect(screen.getByText('ER 154%')).toBeTruthy()
    expect(screen.getByText('No ER')).toBeTruthy()
  })

  it('highlights an ER shortfall directly on the member ER pill', () => {
    optConfigEntries = [
      [
        'opt_Furina',
        { statFilters: { [ER_FILTER]: [{ value: 160, disabled: false }] } },
      ],
      ['opt_Sandrone', { statFilters: {} }],
    ]
    const runTeamOpt: TeamOpt = {
      ...initTeamOpt(),
      energySource: 'manual',
    }
    render(
      <ThemeProvider theme={theme}>
        <TeamOptResults
          teamId="team_1"
          members={baseMembers}
          result={makeResult({
            after: {
              total: 5_000_000,
              members: { Sandrone: 3_500_000, Furina: 1_500_000 },
              attacks: {},
              unmet: { Furina: [0] },
              shortfalls: {
                Furina: [
                  { path: ['basic', 'enerRech_'], value: 1.482, min: 1.6 },
                ],
              },
            },
          })}
          seconds={12}
          runTeamOpt={runTeamOpt}
          rotationTime={20}
          teamData={undefined}
          onDiscard={vi.fn()}
        />
      </ThemeProvider>
    )
    expect(screen.getByText('148.2% / 160%')).toBeTruthy()
  })

  it('explains in the Below current tooltip when current builds missed requirements (e.g. Min ER)', async () => {
    render(
      <ThemeProvider theme={theme}>
        <TeamOptResults
          teamId="team_1"
          members={baseMembers}
          result={makeResult({
            before: {
              total: 6_000_000,
              members: { Sandrone: 4_000_000, Furina: 2_000_000 },
              attacks: {},
              unmet: { Furina: [0] },
            },
            after: {
              total: 5_600_000,
              members: { Sandrone: 3_800_000, Furina: 1_800_000 },
              attacks: {},
              unmet: {},
            },
          })}
          seconds={12}
          runTeamOpt={initTeamOpt()}
          rotationTime={20}
          teamData={undefined}
          onDiscard={vi.fn()}
        />
      </ThemeProvider>
    )
    const pill = screen.getByText(/Below current/)
    fireEvent.mouseOver(pill)
    expect(
      await screen.findByText(/it misses their requirements/i)
    ).toBeTruthy()
  })

  it('persists the Auto-rank after optimize toggle in GearRankingControls', () => {
    setAutoRankEquipment(false)
    const onStart = vi.fn()
    render(
      <ThemeProvider theme={theme}>
        <GearRankingControls
          done={0}
          total={2}
          running={false}
          standalone
          onStart={onStart}
          onStop={vi.fn()}
        />
      </ThemeProvider>
    )
    const toggle = screen.getByRole('checkbox', {
      name: /Auto-rank after optimize/i,
    }) as HTMLInputElement
    expect(toggle.checked).toBe(false)
    expect(readAutoRankEquipment()).toBe(false)

    fireEvent.click(toggle)
    expect(toggle.checked).toBe(true)
    expect(readAutoRankEquipment()).toBe(true)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('lets the user customize or append the parenthesis label when saving builds for the team', () => {
    mockSaveTeamResult.mockClear()
    render(
      <ThemeProvider theme={theme}>
        <TeamOptResults
          teamId="team_1"
          members={baseMembers}
          result={makeResult()}
          seconds={12}
          runTeamOpt={initTeamOpt()}
          rotationTime={20}
          teamData={undefined}
          onDiscard={vi.fn()}
        />
      </ThemeProvider>
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Save and use on this team' })
    )
    const input = screen.getByLabelText(
      'Label in parentheses (optional)'
    ) as HTMLInputElement
    expect(input.value).toBe('team optimized')
    expect(screen.getByText('(team optimized)')).toBeTruthy()

    fireEvent.change(input, { target: { value: 'Stygian Fearless' } })
    expect(screen.getByText('(Stygian Fearless)')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockSaveTeamResult).toHaveBeenCalledTimes(1)
    expect(mockSaveTeamResult.mock.calls[0][3]).toBe(
      'Abyss Team (Stygian Fearless)'
    )

    // Clearing the label saves just the team name with no parentheses
    fireEvent.click(
      screen.getByRole('button', { name: 'Save and use on this team' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear label' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(mockSaveTeamResult).toHaveBeenCalledTimes(2)
    expect(mockSaveTeamResult.mock.calls[1][3]).toBe('Abyss Team')
  })
})
