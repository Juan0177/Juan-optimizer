// @vitest-environment jsdom

import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import { initTeamOpt } from '@genshin-optimizer/gi/db'
import type { TeamOptMember, TeamOptResult } from '@genshin-optimizer/gi/ui'
import { createTheme, ThemeProvider } from '@mui/material'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TeamInvestment } from './TeamInvestment'

const rotationFields = new Map<string, string>()

const mockDatabase = {
  chars: {
    get: (ck: CharacterKey) => ({
      constellation: ck === 'Bennett' ? 6 : 0,
    }),
  },
  weapons: {
    get: (id: string) =>
      id === 'w_fav'
        ? { id, key: 'FavoniusSword' as WeaponKey, refinement: 5 }
        : { id, key: 'SkywardBlade' as WeaponKey, refinement: 1 },
  },
  buildTcs: { get: () => undefined },
  teams: {
    get: () => ({
      name: 'Test Team',
      rotationDocuments: { inventory: { Text: 'Furina E Q -> Bennett E Q' } },
    }),
    getRotationField: (id: string, field: string) =>
      rotationFields.get(`${id}:${field}`) ?? null,
    setRotationField: (id: string, field: string, value: string | null) => {
      if (value === null) rotationFields.delete(`${id}:${field}`)
      else rotationFields.set(`${id}:${field}`, value)
    },
  },
}

vi.mock('@genshin-optimizer/gi/db-ui', () => ({
  useDatabase: () => mockDatabase,
  useDBMeta: () => ({ gender: 'F' }),
  useTeam: () => mockDatabase.teams.get(),
}))

vi.mock('./MemberAvatar', () => ({
  MemberAvatar: ({ characterKey }: { characterKey: string }) => (
    <span data-avatar={characterKey} />
  ),
}))

vi.mock('./RotationWriter', () => ({
  useMemberNames: (members: TeamOptMember[]) =>
    members.map((m) => ({
      characterKey: m.characterKey,
      name: m.characterKey,
    })),
  teamRunRotation: () => undefined,
  kqmRunRotation: () => ({
    text: '',
    opener: '',
    timing: { edits: {} },
    frameData: {},
    names: [],
  }),
  editorSx: {},
}))

vi.mock('./RotationInline', () => ({
  RotationReadout: ({ text }: { text: string }) => <span>{text}</span>,
}))

vi.mock('./consInvestment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./consInvestment')>()
  return {
    ...actual,
    evaluateInventoryInvestment: vi.fn(
      async ({
        cons,
        signatures,
        text,
        autoCandidates,
      }: {
        cons: Partial<Record<CharacterKey, number>>
        signatures?: Partial<Record<CharacterKey, number>>
        text?: string
        autoCandidates?: string[]
      }) => {
        const furinaC = cons.Furina ?? 0
        const yelanC = cons.Yelan ?? 0
        const flinsC = cons.Flins ?? 0
        const furinaSig = signatures?.Furina ? 1 : 0
        const yelanSig = signatures?.Yelan ? 1 : 0
        const autoRotation =
          !text && autoCandidates?.length ? autoCandidates[0] : undefined
        const rotBonus = text || autoRotation ? 1.05 : 1
        const mult =
          (1 + furinaC * 0.14 + (furinaC >= 2 ? 0.1 : 0)) *
          (1 + yelanC * 0.08) *
          (1 + flinsC * 0.1) *
          (1 + furinaSig * 0.12) *
          (1 + yelanSig * 0.16) *
          rotBonus
        const total = Math.round(2_000_000 * mult)
        return {
          team: total,
          members: {
            Furina: Math.round(total * 0.5),
            Yelan: Math.round(total * 0.4),
            Bennett: Math.round(total * 0.1),
          },
          seconds: 20,
          builds: {},
          ...(autoRotation ? { autoRotation } : {}),
        }
      }
    ),
  }
})

vi.mock('@genshin-optimizer/gi/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  CharacterName: ({ characterKey }: { characterKey: string }) => (
    <>{characterKey}</>
  ),
  WeaponName: ({ weaponKey }: { weaponKey: WeaponKey }) => <>{weaponKey}</>,
  parseRotation: () => ({ warnings: [] }),
}))

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTranslation: () => ({
    i18n: {},
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

const theme = createTheme({ palette: { mode: 'dark' } })

const makeMember = (characterKey: CharacterKey): TeamOptMember =>
  ({
    characterKey,
    weaponId: 'w_fav',
    isTc: false,
    artifactIds: {},
    teamCharId: `tc_${characterKey}`,
    teamChar: { optConfigId: `opt_${characterKey}` },
    loadoutDatum: {},
  }) as unknown as TeamOptMember

const makeResult = (): TeamOptResult => ({
  builds: {},
  weapons: { Furina: 'w_fav', Yelan: 'w_fav', Bennett: 'w_fav' },
  before: {
    total: 1_800_000,
    members: { Furina: 900_000, Yelan: 700_000, Bennett: 200_000 },
    attacks: {},
    unmet: {},
  },
  after: {
    total: 2_000_000,
    members: { Furina: 1_000_000, Yelan: 800_000, Bennett: 200_000 },
    attacks: {},
    unmet: {},
  },
  rounds: 2,
  optimized: ['Furina', 'Yelan', 'Bennett'],
})

beforeEach(() => {
  rotationFields.clear()
})

afterEach(() => {
  cleanup()
})

describe('TeamInvestment panel', () => {
  it('shows the unified overview (ladder, ranked paths, and per-member impact) with one-click budget switching', async () => {
    const members = [
      makeMember('Furina'),
      makeMember('Yelan'),
      makeMember('Bennett'),
    ]
    render(
      <ThemeProvider theme={theme}>
        <TeamInvestment
          teamId="team_invest_1"
          members={members}
          mode="inventory"
          setup={initTeamOpt()}
          result={makeResult()}
          rotationTime={20}
        />
      </ThemeProvider>
    )

    expect(screen.getByText('Investment comparison')).toBeTruthy()
    // Select +2 pulls and run once
    fireEvent.click(screen.getByRole('button', { name: '+2' }))
    fireEvent.click(screen.getByRole('button', { name: 'Compare investments' }))

    // Unified view shows ladder, top options for +2 pulls, and per-member cards all at once
    await waitFor(() => {
      expect(screen.getByText('Top options for +2 pulls')).toBeTruthy()
    })
    expect(screen.getByText('Best path by pull count')).toBeTruthy()
    expect(screen.getByText('Per-member upgrade value')).toBeTruthy()
    expect(screen.getAllByText(/\+38(\.0)?%/).length).toBeGreaterThan(0)

    // One-click switch to +1 pull via header pill (instant, no Re-run needed)
    fireEvent.click(screen.getByRole('button', { name: '+1' }))
    expect(screen.getByText('Top options for +1 pull')).toBeTruthy()
    expect(screen.getAllByText('R1').length).toBeGreaterThan(0)
    expect(screen.getByText('Best +1')).toBeTruthy()

    // Batched Options editing: toggling checkboxes inside popover applies once on Done
    fireEvent.click(screen.getByRole('button', { name: 'Options' }))
    fireEvent.click(screen.getByLabelText('R1 signatures (+1 pull)'))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(screen.queryAllByText('R1').length).toBe(0)
    })
  })

  it('opens Options popover and inline Cons rotations editor with constellation hints and direct row focus', async () => {
    const members = [makeMember('Flins'), makeMember('Furina')]
    render(
      <ThemeProvider theme={theme}>
        <TeamInvestment
          teamId="team_invest_2"
          members={members}
          mode="inventory"
          setup={initTeamOpt()}
          result={makeResult()}
          rotationTime={20}
        />
      </ThemeProvider>
    )

    // Idle callout highlights Flins C1 rotation hint with a 1-click button
    expect(screen.getByText(/Flins C1 alters rotation/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set C1 rotation' }))
    expect(
      screen.getByText('Conditional rotations for unlocked constellations')
    ).toBeTruthy()
    // Clicking Set C1 rotation jumps straight into Flins C1 edit mode with kit hint & Auto-find
    expect(screen.getByLabelText('Rotation at C1')).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Auto-find C1 rotation' })
    ).toBeTruthy()

    // Toggle editor closed via header button
    fireEvent.click(screen.getByRole('button', { name: 'Cons rotations' }))

    // Run +1 comparison and check clickable `Needs rot` pill on Flins C1 row
    fireEvent.click(screen.getByRole('button', { name: '+1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Compare investments' }))
    await waitFor(() => {
      expect(screen.getByText('Top options for +1 pull')).toBeTruthy()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Needs rot' }))
    expect(screen.getByLabelText('Rotation at C1')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save & update' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Options' }))
    expect(screen.getByText('Members to pull for')).toBeTruthy()
    expect(screen.getByLabelText(/Auto-adapt cons rotations/)).toBeTruthy()
  })
})
