// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BuildTc from './BuildTc'

const mocks = vi.hoisted(() => {
  const buildTc = {
    name: 'Furina TC',
    description: '',
    weapon: { key: 'SplendorOfTranquilWaters', level: 90, refinement: 1 },
    artifact: {
      slots: {},
      substats: { type: 'max', stats: {}, rarity: 5 },
      sets: { GoldenTroupe: 4 },
    },
  }
  return {
    buildTc,
    gcweb: [] as Record<string, unknown>[],
    // (every write the card could make: none is expected from the gc-web button)
    writes: vi.fn(),
  }
})

vi.mock('@genshin-optimizer/gi/db-ui', async () => {
  const { createContext } = await import('react')
  return {
    TeamCharacterContext: createContext({
      teamId: 'team',
      teamCharId: 'teamChar',
      teamChar: { key: 'Furina' },
    }),
    useBuildTc: () => mocks.buildTc,
    useDatabase: () => ({
      teams: { setLoadoutDatum: mocks.writes },
      buildTcs: { remove: mocks.writes, new: mocks.writes, set: mocks.writes },
    }),
    useDBMeta: () => ({ gender: 'F' }),
    useTeamChar: () => undefined,
  }
})
vi.mock('@genshin-optimizer/gi/ui', () => ({
  BuildCard: ({
    children,
    actions,
  }: {
    children: ReactNode
    actions?: ReactNode
  }) => (
    <div>
      {children}
      <footer>{actions}</footer>
    </div>
  ),
  genInputFromTc: (build: object) => ({ fromTc: build }),
  GcwebBuildButton: ({
    input,
    ...props
  }: { input: () => unknown } & Record<string, unknown>) => (
    <button
      type="button"
      onClick={() => mocks.gcweb.push({ ...props, input: input() })}
    >
      Artifacts for gc-web
    </button>
  ),
  ArtifactSetName: ({ setKey }: { setKey: string }) => <>{setKey}</>,
  StatWithUnit: ({ statKey }: { statKey: string }) => <>{statKey}</>,
  WeaponCardNanoObj: () => null,
  levelShort: () => 'Lv.',
}))
vi.mock('@genshin-optimizer/gi/sheets', () => ({ getWeaponSheet: () => ({}) }))
vi.mock('@genshin-optimizer/gi/assets', () => ({ artifactAsset: () => '' }))
vi.mock('@genshin-optimizer/gi/svgicons', () => ({ SlotIcon: () => null }))
vi.mock('@genshin-optimizer/common/ui', () => ({
  CardThemed: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ImgIcon: () => null,
  ModalWrapper: () => null,
  SqBadge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  TextFieldLazy: () => null,
}))
vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(cleanup)

describe('BuildTc', () => {
  it('offers the TC build’s 5 artifacts for gc-web, writing nothing', () => {
    render(<BuildTc buildTcId="tc1" />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Artifacts for gc-web' })
    )
    expect(mocks.gcweb).toEqual([
      {
        compact: true,
        characterKey: 'Furina',
        gender: 'F',
        name: 'Furina TC',
        input: { fromTc: mocks.buildTc },
      },
    ])
    expect(mocks.writes).not.toHaveBeenCalled()
  })
})
