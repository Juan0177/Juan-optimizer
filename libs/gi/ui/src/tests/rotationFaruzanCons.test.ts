import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, kitModels[m]!.element])
    ) as never,
    constellations,
    repeats: 1,
    keep: 'all',
  })
const state = (
  hit: { states?: { path: string[]; value: string }[] },
  path: string
) => hit.states?.find((s) => s.path.join('.') === path)?.value ?? ''

it("Faruzan's A4 adds Hurricane Guard to an Anemo hit at most once every 0.8 s", () => {
  const sim = run('Faruzan Q E CA N4 N4 W1', ['Faruzan'])
  const guarded = sim.hits
    .filter((h) => state(h, 'Faruzan.a4Active') === 'on')
    .map((h) => h.t)
  expect(guarded.length).toBeGreaterThan(1)
  for (let i = 1; i < guarded.length; i++)
    expect(guarded[i] - guarded[i - 1]).toBeGreaterThanOrEqual(49)
})

it("Faruzan's Whirlwind Pulses shred only from the spot that reaches the enemy", () => {
  const sim = run('Faruzan Q W14', ['Faruzan'])
  const shreds = sim.buffWindows.filter((w) => w.path[1] === 'burstHit')
  // the burst hit, and every third pulse (1.5 ahead): 43 + 377 and 43 + 737
  expect(shreds.map((w) => w.start).sort((a, b) => a - b)).toEqual([
    54, 420, 780,
  ])
})

it('Faruzan A1: the Hurricane Arrow vortex shreds Anemo RES', () => {
  const sim = run('Faruzan E CA W5', ['Faruzan'])
  const vortex = sim.hits.find((h) => h.label === 'Pressurized Collapse')!
  const shred = sim.buffWindows.find((w) => w.path[1] === 'burstHit')!
  expect(shred.start).toBe(vortex.t)
  expect(state(vortex, 'Faruzan.burstHit')).toBe('')
})

it('Faruzan particles: Pressurized Collapse drops 2 particles with a shared 5.5 s ICD across Hurricane Arrow and C6', () => {
  // E without CA at C0 produces no Pressurized Collapse and no particle markers
  const noCa = run('Faruzan E Q W3', ['Faruzan'], { Faruzan: 0 })
  expect(
    noCa.hits.filter(
      (h) => h.path.slice(0, 2).join('.') === '_marker.particles'
    )
  ).toHaveLength(0)

  // E CA Q + continuous attacks at C6: Hurricane Arrow collapse + C6 collapses share the 5.5 s (331 f) ICD
  const c6 = run('Faruzan E CA Q -> Xiao E E Q 12[J P]', ['Faruzan', 'Xiao'], {
    Faruzan: 6,
  })
  const collapses = c6.hits
    .filter(
      (h) =>
        h.characterKey === 'Faruzan' && h.path.join('.') === 'skill.vortexDmg'
    )
    .map((h) => h.t)
  const particles = c6.hits
    .filter(
      (h) =>
        h.characterKey === 'Faruzan' &&
        h.path.slice(0, 2).join('.') === '_marker.particles'
    )
    .map((h) => h.t)
  // Multiple collapses occur every ~3 s, while particles trigger only every >= 5.5 s (331 frames)
  expect(collapses.length).toBeGreaterThan(particles.length)
  expect(particles.length).toBeGreaterThanOrEqual(3)
  expect(particles[0]).toBe(collapses[0])
  for (let i = 1; i < particles.length; i++)
    expect(particles[i] - particles[i - 1]).toBeGreaterThanOrEqual(331)
})
