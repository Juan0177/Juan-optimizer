import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

it('runs Fischl’s A4 ICD on the reaction triggerer’s clock, including their hitlag', () => {
  const members: CharacterKey[] = ['Fischl', 'Keqing']
  const probe: KitModel = {
    characterKey: 'Keqing',
    element: 'electro',
    source: 'test',
    act(c) {
      // (gcsim's 0.5 s ICD status is active through its expiry: 31 frames of Keqing's clock)
      for (const delay of [0, 30, 41])
        c.hit(delay, {
          path: ['_reaction', 'electroCharged'],
          tag: 'other',
          element: 'electro',
          label: 'Reaction probe',
        })
      c.hit(10, {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        element: 'physical',
        animationPause: 10,
        label: 'Keqing hitlag',
      })
      return { frames: 100 }
    },
  }
  const sim = simulateRotation({
    rotation: parseRotation(
      'Fischl E -> Keqing E W1',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Fischl: 'electro', Keqing: 'electro' },
    constellations: { Fischl: 6 },
    repeats: 1,
    keep: 'all',
    kits: { Fischl: kitModels.Fischl, Keqing: probe },
    reactions: { onHit() {} },
  })
  const entry = sim.actions[1].start
  expect(
    sim.hits
      .filter((h) => h.label === 'Thundering Retribution (A4)')
      .map((h) => h.t - entry)
  ).toEqual([4, 45])
})

it('summons a new Oz with the skill ready even while the Burst’s Oz is out; recalls it only on cooldown', () => {
  const members: CharacterKey[] = ['Fischl', 'Keqing']
  const play = (text: string) =>
    simulateRotation({
      rotation: parseRotation(
        text,
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      elements: { Fischl: 'electro', Keqing: 'electro' },
      constellations: {},
      repeats: 1,
      keep: 'all',
      kits: { Fischl: kitModels.Fischl },
      reactions: { onHit() {} },
    })
  // (Keqing only fills the party: no actions)
  const summons = (sim: ReturnType<typeof play>) =>
    sim.hits.filter((h) => h.label === 'Oz (Summon)').length
  // E, then the Burst 15 s later (its Oz lasts 10 s), then E once the skill is ready (25 s):
  // the Burst's Oz is still out, and gcsim/kqmsim summon a new one (summon hit, fresh 10 s)
  const ready = play('Fischl E W900f Q W630f E W60f')
  expect(ready.stalls ?? {}).toEqual({})
  expect(summons(ready)).toBe(2)
  // E again 5 s after the first (skill on cooldown, Oz out): the recall, no summon hit, no wait
  const recall = play('Fischl E W300f E W60f')
  expect(summons(recall)).toBe(1)
  expect(recall.stalls ?? {}).toEqual({})
})
