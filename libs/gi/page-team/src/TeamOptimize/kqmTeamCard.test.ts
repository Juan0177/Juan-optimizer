import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import en from '../../../localization/assets/locales/en/page_team.json'
import it_ from '../../../localization/assets/locales/it/page_team.json'
import { formatGain, formatRateFull } from './format'
import { kqmStandardNote, kqmTeamCardData, shareStamp } from './kqmTeamCard'

const tIn = async (lng: 'en' | 'it') => {
  const i = i18next.createInstance()
  await i.init({
    lng,
    fallbackLng: 'en',
    ns: ['page_team'],
    resources: { en: { page_team: en }, it: { page_team: it_ } },
    interpolation: { escapeValue: false },
  })
  return i.t.bind(i) as never
}

const card = async (lng: 'en' | 'it') =>
  kqmTeamCardData({
    t: await tIn(lng),
    gender: 'F',
    name: 'Team X',
    members: [
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
    ],
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
