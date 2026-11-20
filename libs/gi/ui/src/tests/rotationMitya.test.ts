import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type LoadoutDatum } from '@genshin-optimizer/gi/db'
import { getCharSheet } from '@genshin-optimizer/gi/sheets'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { type UIData, uiDataForTeam } from '@genshin-optimizer/gi/uidata'
import type { NumNode } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import { getTeamDataWith } from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

function run(
  text: string,
  members: CharacterKey[],
  cons: Partial<Record<CharacterKey, number>> = {}
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: cons,
    repeats: 1,
    keep: 'all',
  })
}

/** Mitya's sheet values (display, average hits) at a constellation and Detection Core state */
function sheet(constellation: number, detectionCore: string) {
  return mitya(constellation, { detectionCore }).getDisplay()
}

/** Mitya's UI data (his Talent tab in a team) with his own switches */
function mitya(constellation: number, conditional: Record<string, string>) {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set('Mitya', {
    key: 'Mitya',
    level: 90,
    ascension: 6,
    talent: { auto: 10, skill: 10, burst: 10 },
    constellation,
  })
  db.weapons.new({
    key: 'ApprenticesNotes',
    level: 90,
    ascension: 6,
    refinement: 1,
    location: 'Mitya',
    lock: false,
  })
  const id = db.teamChars.new('Mitya', {
    conditional: { Mitya: conditional },
  })
  const teamId = db.teams.new({
    loadoutData: [{ teamCharId: id }] as LoadoutDatum[],
  })
  return uiDataForTeam(getTeamDataWith(db, teamId, {})! as never, 'F', 'Mitya')
    .Mitya!.target
}

describe('Mitya’s Talent tab', () => {
  it('shows Gradient Detonation for all the Beacons he has, with an Overloaded core only (a player report)', () => {
    const fields = getCharSheet('Mitya', 'F')
      .getTalentOfKey('auto')!
      .sections.flatMap((s) => s.fields ?? [])
    const total = fields.find(
      (f) => 'node' in f && f.canShow !== undefined
    ) as unknown as { node: NumNode; canShow: (data: UIData) => boolean }
    const at = (core: string, beacons: string) => {
      const ui = mitya(0, { detectionCore: core, gradientBeacons: beacons })
      const d = ui.getDisplay()
      return {
        shown: total.canShow(ui),
        value: ui.get(total.node).value,
        main: d['charged']['gradientDmg'].value,
        each: d['charged']['gradientStellarDmg'].value,
      }
    }
    const four = at('overloaded', '4')
    expect(four.shown).toBe(true)
    expect(four.value).toBeCloseTo(four.main + 4 * four.each, 6)
    const one = at('overloaded', '1')
    expect(one.value).toBeCloseTo(one.main + one.each, 6)
    // (Gradient Detonation needs an Overloaded core and a Beacon)
    expect(at('steady', '4').shown).toBe(false)
    expect(at('overloaded', '').shown).toBe(false)
  })
})

describe('Mitya constellations', () => {
  const c4 = (text: string) =>
    run(text, ['Mitya'], { Mitya: 4 }).hits.filter(
      (h) => h.label === 'Mitya C4 (Stellar-Conduct)'
    ).length

  it('C4 counts Gradient Beacons consumed by the core, not Beacons gained', () => {
    // hold: C1's 1 Beacon (the hold makes none of its own), Q: 3 -> four gained, none consumed
    expect(c4('Mitya hE Q W1')).toBe(0)
    // Gradient Detonation consumes the four: one short of five
    expect(c4('Mitya hE Q CA W1')).toBe(0)
  })

  it('C4 carries its count of consumed Beacons over to the next Detection Core', () => {
    // four consumed under the first core, then the next hold E's C1 Beacon is the fifth. (The
    // game's _ABILITY_Mitya_C4_ConsumeCount is reset only when the ability starts; kqmsim, which
    // counts Beacons gained, and our earlier per-core count differ from it.)
    expect(c4('Mitya hE Q CA hE CA W1')).toBe(1)
  })

  it('C6 makes the C4 strike deal 115% like the rest of a Steady core, but not an Overloaded one', () => {
    // (the C4 strike and the Steady consume hit scale alike on Mitya's EM: their ratio isolates
    // the multipliers; the game's C4 formula reads AS_Constellation_6_StableDamageUp)
    const ratio = (constellation: number, core: string) => {
      const d = sheet(constellation, core)
      return (
        d['constellation4']['dmg'].value / d['skill']['steadyConsumeDmg'].value
      )
    }
    const c5 = ratio(5, 'steady')
    // at C6 both hits of a Steady core deal 115%
    expect(ratio(6, 'steady') / c5).toBeCloseTo(1, 6)
    // with an Overloaded core (Gradient Detonation's count) the C4 strike has no 115%
    expect(ratio(6, 'steady') / ratio(6, 'overloaded')).toBeCloseTo(1.15, 6)
  })
})
