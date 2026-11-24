import { describe, expect, it } from 'vitest'
import { KQM_CARD_DETAILS_H, KQM_CARD_NOTE_LINE } from './renderKqmCard'
import type { VersionsCardData, VersionsCardMember } from './renderVersionsCard'
import { versionsCardHeight } from './renderVersionsCard'

const member = (over: Partial<VersionsCardMember> = {}): VersionsCardMember => ({
  name: 'Mitya',
  constellation: 0,
  element: 'electro',
  elementColor: '#b37ee6',
  face: '',
  weapon: { name: 'Sacrificial Jade', refinement: 1 },
  sets: [],
  share: '20%',
  ...over,
})
const details = {
  mainsTitle: 'Main stats',
  statsTitle: 'Stats (out of combat)',
  mains: [],
  stats: [],
}
const sheet = (
  members: VersionsCardMember[],
  notes = 'KQM Standards · Talents 10/10/10'
): Pick<VersionsCardData, 'teams' | 'notes'> => ({
  teams: [
    { original: true, members, dps: '1', rotation: [] },
    { original: false, members, dps: '1', rotation: [] },
  ],
  notes,
})

describe('versionsCardHeight (juanlab: the detailed sheet)', () => {
  it('as before without details, and without the data', () => {
    expect(versionsCardHeight(2, sheet([member()]))).toBe(versionsCardHeight(2))
  })
  it('each card taller by the detailed block when a member has one', () => {
    // (two teams: one row of cards)
    expect(versionsCardHeight(2, sheet([member({ details }), member()]))).toBe(
      versionsCardHeight(2) + KQM_CARD_DETAILS_H
    )
    // (five teams: two rows, each taller)
    const five = sheet([member({ details })])
    five.teams = [...five.teams, ...five.teams, five.teams[0]]
    expect(versionsCardHeight(5, five)).toBe(
      versionsCardHeight(5) + 2 * KQM_CARD_DETAILS_H
    )
  })
  it('a line more of notes for each line after the first', () => {
    expect(versionsCardHeight(2, sheet([member()], 'a\nb'))).toBe(
      versionsCardHeight(2) + KQM_CARD_NOTE_LINE
    )
  })
})
