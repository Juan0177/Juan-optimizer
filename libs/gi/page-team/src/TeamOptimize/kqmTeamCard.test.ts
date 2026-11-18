import type { KqmMemberStats } from '@genshin-optimizer/gi/ui'
import i18next from 'i18next'
import { beforeEach, describe, expect, it } from 'vitest'
import enKeymap from '../../../localization/assets/locales/en/keymap.json'
import en from '../../../localization/assets/locales/en/page_team.json'
import itKeymap from '../../../localization/assets/locales/it/keymap.json'
import it_ from '../../../localization/assets/locales/it/page_team.json'
import { formatGain, formatRateFull } from './format'
import {
  KQM_CARD_VIEW_KEY,
  type KqmTeamCardMember,
  kqmCardDetails,
  kqmStandardNote,
  kqmTeamCardData,
  readKqmCardView,
  shareStamp,
  writeKqmCardView,
} from './kqmTeamCard'

const tIn = async (lng: 'en' | 'it') => {
  const i = i18next.createInstance()
  await i.init({
    lng,
    fallbackLng: 'en',
    ns: ['page_team', 'keymap'],
    resources: {
      en: { page_team: en, keymap: enKeymap },
      it: { page_team: it_, keymap: itKeymap },
    },
    interpolation: { escapeValue: false },
  })
  return i.t.bind(i) as never
}

const card = async (lng: 'en' | 'it', stats?: (KqmMemberStats | undefined)[]) =>
  kqmTeamCardData({
    t: await tIn(lng),
    gender: 'F',
    name: 'Team X',
    members: (
      [
        {
          key: 'Danica' as never,
          constellation: 0,
          damage: 1234567,
          er: 120,
          fieldTime: 50,
        },
        {
          key: 'Mitya' as never,
          constellation: 1,
          damage: 638373,
          er: 100,
          fieldTime: 30,
        },
      ] as KqmTeamCardMember[]
    ).map((m, i) => (stats?.[i] ? { ...m, stats: stats[i] } : m)),
    total: 1872940,
    rotationTime: 19.4,
    rotation: [],
    notes: kqmStandardNote(await tIn(lng), 9),
    beta: false,
    siteName: 'stamp',
    locale: lng,
  })

describe('KQM share card language', () => {
  it('writes the Italian labels and figures when the site is in Italian', async () => {
    const d = await card('it')
    expect(d.labels).toMatchObject({
      team: 'Squadra',
      damage: 'Danno',
      dist: 'Quota',
      field: 'In campo',
      total: 'Totale',
      rotation: 'Rotazione',
      notes: 'Note',
    })
    expect(d.total).toBe('1.872.940')
    expect(d.members[0].damage).toBe('1.234.567')
    expect(d.seconds).toBe('rotazione da 19,4 s')
    expect(d.members[0].field).toBe('9,7 s')
    expect(d.notes).toBe('Standard KQM · Talenti 9/9/9')
    expect(d.locale).toBe('it')
    expect(formatGain(0.096, 'it')).toBe('+9,6%')
    expect(shareStamp('it')).toMatch(/\d{1,2} \w{3,4}\.? 20\d\d$/)
  })
  it('keeps English exactly as it was', async () => {
    const d = await card('en')
    expect(d.labels).toMatchObject({
      team: 'Team',
      damage: 'Damage',
      dist: 'Share',
      field: 'Field',
      total: 'Total',
      rotation: 'Rotation',
      notes: 'Notes',
    })
    expect(d.total).toBe('1,872,940')
    expect(d.total).toBe(formatRateFull(1872940, undefined))
    expect(d.seconds).toBe('19.4s rotation')
    expect(d.members[0].field).toBe('9.7s')
    expect(d.notes).toBe('KQM Standards · Talents 9/9/9')
    expect(formatGain(0.096)).toBe('+9.6%')
  })
})

/** An Electro member's build out of combat (as `kqmOutOfCombatStats` returns it) */
const stats: KqmMemberStats = {
  mains: { sands: 'atk_', goblet: 'electro_dmg_', circlet: 'critRate_' },
  stats: [
    { key: 'hp', value: 18420.4 },
    { key: 'atk', value: 2315.3 },
    { key: 'def', value: 812 },
    { key: 'eleMas', value: 80 },
    { key: 'critRate_', value: 0.705 },
    { key: 'critDMG_', value: 1.72 },
    { key: 'enerRech_', value: 1.28 },
    { key: 'electro_dmg_', value: 0.466 },
  ],
}

describe('KQM card details (the detailed view)', () => {
  it('writes the official Italian names and Italian figures', async () => {
    const d = kqmCardDetails(await tIn('it'), stats, 'it')
    expect(d).toStrictEqual({
      mainsTitle: 'Statistiche principali',
      statsTitle: 'Statistiche (fuori combattimento)',
      mains: [
        { slot: 'Sabbie', stat: 'ATT%' },
        { slot: 'Calice', stat: 'Bonus DAN da Electro' },
        { slot: 'Corona', stat: 'Tasso di CRIT' },
      ],
      stats: [
        { label: 'PS', value: '18.420' },
        { label: 'ATT', value: '2.315' },
        { label: 'DIF', value: '812' },
        { label: 'Maestria elementale', value: '80' },
        { label: 'Tasso di CRIT', value: '70,5%' },
        { label: 'DAN da CRIT', value: '172,0%' },
        { label: 'Ricarica di energia', value: '128,0%' },
        { label: 'Bonus DAN da Electro', value: '46,6%' },
      ],
    })
  })
  it('writes the English names and figures', async () => {
    const d = kqmCardDetails(await tIn('en'), stats, 'en')
    expect(d.mainsTitle).toBe('Main stats')
    expect(d.statsTitle).toBe('Stats (out of combat)')
    expect(d.mains).toStrictEqual([
      { slot: 'Sands', stat: 'ATK%' },
      { slot: 'Goblet', stat: 'Electro DMG Bonus' },
      { slot: 'Circlet', stat: 'Crit Rate' },
    ])
    expect(d.stats.map((s) => [s.label, s.value])).toStrictEqual([
      ['HP', '18,420'],
      ['ATK', '2,315'],
      ['DEF', '812'],
      ['Elemental Mastery', '80'],
      ['Crit Rate', '70.5%'],
      ['Crit DMG', '172.0%'],
      ['Energy Recharge', '128.0%'],
      ['Electro DMG Bonus', '46.6%'],
    ])
  })
  it('marks only the rows whose written value differs from before', async () => {
    const was: KqmMemberStats = {
      ...stats,
      stats: stats.stats.map((s) =>
        s.key === 'atk'
          ? { ...s, value: 2100 }
          : s.key === 'enerRech_'
            ? { ...s, value: 1.111 }
            : // (differs, but not as written: no mark)
              s.key === 'def'
              ? { ...s, value: 812.2 }
              : s
      ),
    }
    const d = kqmCardDetails(await tIn('it'), stats, 'it', was)
    expect(d.stats.filter((s) => 'was' in s)).toStrictEqual([
      { label: 'ATT', value: '2.315', was: '2.100' },
      { label: 'Ricarica di energia', value: '128,0%', was: '111,1%' },
    ])
  })
})

describe('KQM team card data with details', () => {
  it('keeps the normal card exactly as it was without stats', async () => {
    const d = await card('en')
    expect(d).toStrictEqual({
      name: 'Team X',
      locale: 'en',
      members: [
        {
          element: 'electro',
          elementColor: '#af8ec1',
          face: expect.stringContaining('UI_AvatarIcon_Danica'),
          name: 'Danica',
          constellation: 0,
          weapon: { name: '–', refinement: 0 },
          sets: [],
          damage: '1,234,567',
          share: 1234567 / 1872940,
          field: '9.7s',
          er: '120%',
        },
        {
          element: 'electro',
          elementColor: '#af8ec1',
          face: expect.stringContaining('UI_AvatarIcon_Mitya'),
          name: 'Mitya',
          constellation: 1,
          weapon: { name: '–', refinement: 0 },
          sets: [],
          damage: '638,373',
          share: 638373 / 1872940,
          field: '5.8s',
          er: '100%',
        },
      ],
      total: '1,872,940',
      dps: '96,543',
      seconds: '19.4s rotation',
      rotation: [],
      notes: 'KQM Standards · Talents 9/9/9',
      beta: undefined,
      labels: {
        team: 'Team',
        damage: 'Damage',
        dist: 'Share',
        field: 'Field',
        er: 'ER',
        total: 'Total',
        dpr: 'DPR',
        dps: 'DPS',
        rotation: 'Rotation',
        notes: 'Notes',
        siteName: 'stamp',
      },
    })
  })
  it('adds each member’s details from its stats, and nothing else', async () => {
    const plain = await card('it')
    // (its ER out of combat as the table's: no note)
    const same = withEr(stats, 1.2)
    const detailed = await card('it', [same, undefined])
    expect(detailed.members[0].details).toStrictEqual(
      kqmCardDetails(await tIn('it'), same, 'it')
    )
    expect('details' in detailed.members[1]).toBe(false)
    const { details: _, ...rest } = detailed.members[0]
    expect({ ...detailed, members: [rest, detailed.members[1]] }).toStrictEqual(
      plain
    )
  })
})

/** `s` with its Energy Recharge out of combat at `er` (a fraction) */
const withEr = (s: KqmMemberStats, er: number): KqmMemberStats => ({
  ...s,
  stats: s.stats.map((x) => (x.key === 'enerRech_' ? { ...x, value: er } : x)),
})

describe('KQM team card: the ER note (detailed view)', () => {
  const NOTE = {
    it: "Statistiche fuori combattimento: senza effetti condizionali né compagni. L'ER nella tabella è quello della rotazione.",
    en: "Out-of-combat stats: no conditional effects or teammates. The ER in the table is the rotation's.",
  }
  it('says so on a line of its own when a member’s ER out of combat is not the table’s', async () => {
    // (Danica: 128% out of combat, 120% in the table; Mitya: as the table, 100%)
    const it = await card('it', [stats, withEr(stats, 1)])
    expect(it.notes).toBe(`Standard KQM · Talenti 9/9/9\n${NOTE.it}`)
    const en = await card('en', [stats, withEr(stats, 1)])
    expect(en.notes).toBe(`KQM Standards · Talents 9/9/9\n${NOTE.en}`)
  })
  it('compares them as the table writes ER: whole percent', async () => {
    // (120.4% out of combat: "120%", as the table)
    const d = await card('en', [withEr(stats, 1.204), withEr(stats, 0.996)])
    expect(d.notes).toBe('KQM Standards · Talents 9/9/9')
  })
  it('has no note in the normal view', async () => {
    expect((await card('it')).notes).toBe('Standard KQM · Talenti 9/9/9')
  })
})

describe('KQM card view (remembered in the browser)', () => {
  beforeEach(() => globalThis.localStorage?.removeItem(KQM_CARD_VIEW_KEY))
  it('is Normal until Detailed is picked, and remembers it', () => {
    expect(KQM_CARD_VIEW_KEY).toBe('juanlab-kqmCardView')
    expect(readKqmCardView()).toBe('normal')
    writeKqmCardView('detailed')
    expect(globalThis.localStorage.getItem(KQM_CARD_VIEW_KEY)).toBe('detailed')
    expect(readKqmCardView()).toBe('detailed')
    globalThis.localStorage.setItem(KQM_CARD_VIEW_KEY, 'other')
    expect(readKqmCardView()).toBe('normal')
  })
})
