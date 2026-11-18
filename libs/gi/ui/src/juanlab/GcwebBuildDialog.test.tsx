// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { statName } from '../util/statName'
import type { KqmBuild } from '../util/teamOpt/kqm'
import { GcwebBuildButton, GcwebBuildPreview } from './GcwebBuildDialog'
import { decodePayload, gcwebLink, genResultToPayload } from './gcweb'
import type { GenInput, GenResult } from './gcwebArtifacts'
import { generateArtifacts } from './gcwebArtifacts'
import { genInputFromKqm } from './gcwebBuildInput'

// (English defaults, as the page shows them before the locale loads; the namespace prefix dropped)
vi.mock('react-i18next', async (importOriginal) => {
  const t = (key: string, options?: string | Record<string, unknown>) => {
    const opts = typeof options === 'object' ? options : {}
    let text =
      typeof options === 'string'
        ? options
        : String(
            (opts['count'] === 1 && opts['defaultValue_one']) ||
              opts['defaultValue'] ||
              key
                .replace(/^[^:]*:/, '')
                .split('.')
                .at(-1)
          )
    for (const [k, v] of Object.entries(opts))
      text = text.replaceAll(`{{${k}}}`, String(v))
    return text
  }
  return {
    ...(await importOriginal<typeof import('react-i18next')>()),
    useTranslation: () => ({ t, i18n: { language: 'en' } }),
  }
})

const RAIDEN: KqmBuild = {
  weapon: { key: 'EngulfingLightning', refinement: 1 },
  sets: { EmblemOfSeveredFate: 4 },
  mains: { sands: 'enerRech_', goblet: 'electro_dmg_', circlet: 'critRate_' },
  rolls: { critDMG_: 8, critRate_: 6, enerRech_: 4, atk_: 2 },
}
const STORAGE_KEY = 'juanlab-gcweb'
const URL = 'http://192.168.1.5:8090/'

const setLink = (enabled: boolean) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled, url: URL }))
const snapshot = () => JSON.stringify({ ...localStorage })

const renderButton = (
  input: () => GenInput = () => genInputFromKqm(RAIDEN, {})
) =>
  render(
    <GcwebBuildButton
      input={input}
      characterKey="RaidenShogun"
      gender="F"
      name="KQM Raiden"
    />
  )
/** The piece cards, by their slot heading (the li has no name of its own: its h3 names it) */
const pieceCards = (scope: HTMLElement = document.body) =>
  within(scope)
    .getAllByRole('heading', { level: 3 })
    .map((h) => h.closest('li'))
    .filter((li): li is HTMLLIElement => !!li)
const pieceCard = (slot: string) =>
  screen.getByRole('heading', { level: 3, name: slot }).closest('li')!
const open = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Artifacts for gc-web' }))

beforeEach(() => {
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('GcwebBuildButton', () => {
  it('previews the 5 pieces: slot, set, main stat, level, 4 substats with value and rolls', async () => {
    setLink(true)
    renderButton()
    open()
    const dialog = await screen.findByRole('dialog', {
      name: '5 artifacts for gc-web',
    })
    const pieces = pieceCards(dialog)
    expect(
      pieces.map((p) => within(p).getByRole('heading').textContent)
    ).toEqual(['flower', 'plume', 'sands', 'goblet', 'circlet'])
    // (no aria-label repeating the heading)
    for (const piece of pieces)
      expect(piece.hasAttribute('aria-label')).toBe(false)
    const result = generateArtifacts(genInputFromKqm(RAIDEN, {}))
    result.pieces.forEach((piece, i) => {
      const card = within(pieces[i])
      expect(card.getByText(piece.setKey)).toBeTruthy()
      expect(card.getByText(`5★ +${piece.level}`)).toBeTruthy()
      // the main stat (KeyMap's English name: i18n is not initialized here)
      expect(card.getByTestId('main').textContent).not.toBe('')
      const subs = card.getAllByRole('listitem')
      expect(subs).toHaveLength(4)
      piece.substats.forEach((sub, j) => {
        const shown = sub.key.endsWith('_')
          ? `${sub.value.toFixed(1)}%`
          : `${Math.round(sub.value)}`
        expect(subs[j].textContent).toContain(shown)
        expect(subs[j].textContent).toContain(
          `${sub.rolls.length} roll${sub.rolls.length === 1 ? '' : 's'}`
        )
      })
    })
  })
  it('compares target and generated totals for the used substats only', async () => {
    setLink(true)
    renderButton()
    open()
    const table = await screen.findByRole('table', {
      name: 'Compared with the build',
    })
    const input = genInputFromKqm(RAIDEN, {})
    const result = generateArtifacts(input)
    const rows = within(table).getAllByRole('row')
    const heads = within(rows[0]).getAllByRole('columnheader')
    expect(heads.map((c) => c.textContent)).toEqual([
      'Substat',
      'Target',
      'Generated',
      'ΔDifference',
    ])
    // Δ is seen, "Difference" is read (the Δ sign itself hidden from screen readers)
    expect(
      within(rows[0]).getByRole('columnheader', { name: 'Difference' })
    ).toBeTruthy()
    expect(within(heads[3]).getByText('Δ').getAttribute('aria-hidden')).toBe(
      'true'
    )
    // (used substats only: no filler row)
    expect(rows).toHaveLength(1 + Object.keys(result.gaps).length)
    expect(rows.length - 1).toBe(input.used.length)
    const crit = rows.find(
      (r) =>
        within(r).queryByRole('rowheader')?.textContent === statName('critDMG_')
    )!
    const cells = within(crit).getAllByRole('cell')
    expect(cells[0].textContent).toBe(`${input.targets.critDMG_!.toFixed(1)}%`)
    expect(cells[1].textContent).toBe(`${result.totals.critDMG_!.toFixed(1)}%`)
    // the extra rolls explained in one ⓘ
    expect(screen.getByRole('button', { name: 'About the rolls' })).toBeTruthy()
  })
  it('“Send to gc-web” opens gc-web with the 5 pieces', async () => {
    setLink(true)
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
    renderButton()
    open()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Send to gc-web' })
    )
    // (the build's name, and the character's: charNames_gen's, the key with the test's t)
    const payload = genResultToPayload(
      'RaidenShogun',
      'F',
      { build: 'KQM Raiden', character: 'RaidenShogun' },
      generateArtifacts(genInputFromKqm(RAIDEN, {}))
    )
    expect(openSpy).toHaveBeenCalledWith(
      gcwebLink(URL, payload),
      '_blank',
      'noopener'
    )
    const sent = decodePayload(
      String(openSpy.mock.calls[0][0]).split('#juanlab=')[1]
    )
    expect(sent.name).toBe('KQM Raiden')
    expect(sent.character?.name).toBe('RaidenShogun')
  })
  it('“Copy link” copies the same link', async () => {
    setLink(true)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    renderButton()
    open()
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Copy link' }))
    })
    // (the build's name, and the character's: charNames_gen's, the key with the test's t)
    const payload = genResultToPayload(
      'RaidenShogun',
      'F',
      { build: 'KQM Raiden', character: 'RaidenShogun' },
      generateArtifacts(genInputFromKqm(RAIDEN, {}))
    )
    expect(writeText).toHaveBeenCalledWith(gcwebLink(URL, payload))
    await waitFor(() => expect(screen.getByText('Link copied')).toBeTruthy())
  })
  it('with the gc-web link off: shown, disabled, pointing to Settings; nothing opens', () => {
    setLink(false)
    const input = vi.fn(() => genInputFromKqm(RAIDEN, {}))
    renderButton(input)
    const button = screen.getByRole('button', { name: 'Artifacts for gc-web' })
    expect(button.getAttribute('aria-disabled')).toBe('true')
    const hint = document.getElementById(
      button.getAttribute('aria-describedby') ?? ''
    )
    expect(hint?.textContent).toContain('Settings → Database → Upload')
    open()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(input).not.toHaveBeenCalled()
  })
  it('writes nothing: the browser storage is the same before and after', async () => {
    setLink(true)
    vi.spyOn(window, 'open').mockReturnValue(null)
    const before = snapshot()
    renderButton()
    open()
    fireEvent.click(
      await screen.findByRole('button', { name: 'Send to gc-web' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(snapshot()).toBe(before)
  })
})

describe('GcwebBuildPreview', () => {
  it('names percent stats as percent: an ATK% sands, ATK% substats, ATK and ATK% rows apart', () => {
    const input = genInputFromKqm(
      {
        ...RAIDEN,
        mains: { sands: 'atk_', goblet: 'electro_dmg_', circlet: 'critRate_' },
      },
      {}
    )
    const result: GenResult = {
      ...generateArtifacts(input),
      fillerRaised: [{ slotKey: 'plume', key: 'def_' }],
    }
    render(<GcwebBuildPreview input={input} result={result} />)
    // (KeyMap's English names: i18n is not initialized here; "ATK" for both atk and atk_)
    const sands = pieceCard('sands')
    expect(within(sands).getByTestId('main').textContent).toBe('ATK%')
    const plume = pieceCard('plume')
    expect(plume.textContent).toContain('Rolls above the minimum: DEF%')
    // every substat line: percent stats with %, flat ones without
    const pieceAtk = result.pieces.flatMap((p, i) =>
      p.substats
        .map((sub, j) => ({ sub, i, j }))
        .filter(({ sub }) => sub.key === 'atk_' || sub.key === 'atk')
    )
    expect(pieceAtk.length).toBeGreaterThan(0)
    const cards = pieceCards()
    for (const { sub, i, j } of pieceAtk) {
      const line = within(cards[i]).getAllByRole('listitem')[j]
      expect(line.firstElementChild?.textContent).toBe(
        sub.key === 'atk_' ? 'ATK%' : 'ATK'
      )
    }
    const table = screen.getByRole('table', { name: 'Compared with the build' })
    const heads = within(table)
      .getAllByRole('rowheader')
      .map((h) => h.textContent)
    expect(heads).toContain('ATK%')
    expect(heads).toContain('ATK')
    expect(new Set(heads).size).toBe(heads.length)
  })

  it('notes the filler substats rolled above the minimum on their piece', () => {
    const input = genInputFromKqm(RAIDEN, {})
    const result: GenResult = {
      ...generateArtifacts(input),
      fillerRaised: [{ slotKey: 'plume', key: 'def' }],
    }
    render(<GcwebBuildPreview input={input} result={result} />)
    const plume = pieceCard('plume')
    expect(plume.textContent).toContain(
      `Rolls above the minimum: ${statName('def')}`
    )
    const flower = pieceCard('flower')
    expect(flower.textContent).not.toContain('Rolls above the minimum')
  })
})
