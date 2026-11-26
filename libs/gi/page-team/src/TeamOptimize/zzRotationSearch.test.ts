// @vitest-environment jsdom
// TEMPORARY rotation search harness (not to be committed). Driven by env:
//   PHASE=base     SEED=<file with {text, opener}>      → OUT: KQM result (builds) for screening
//   PHASE=screen   CANDS=<file [{id,text,opener}]> BASE=<base out> → OUT: scores with fixed builds
//   PHASE=confirm  CANDS=<file>                          → OUT: full KQM run per candidate
//   TIMING=<json RotationTimingSettings> (absent: Steady DPS)
import { readFileSync, writeFileSync } from 'node:fs'
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import {
  ArtCharDatabase,
  defaultTeamOptKqm,
  initTeamOpt,
} from '@genshin-optimizer/gi/db'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  evaluateTeamNodes,
  kqmSimGear,
  kqmTeamOverrides,
  optimizeTeamKqm,
  parseRotation,
  teamOptMembers,
  teamRotationNodes,
  withRotationEnergy,
} from '@genshin-optimizer/gi/ui'
import { beforeAll, describe, expect, it } from 'vitest'
import { kqmRotationReplay } from './RotationWriter'

const MEMBERS: CharacterKey[] = ['Mitya', 'Anastasya', 'Danica', 'Odette']
const env = process.env
const stored = new Map<string, string>()
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, String(v)),
      removeItem: (k: string) => stored.delete(k),
      clear: () => stored.clear(),
      key: (i: number) => [...stored.keys()][i] ?? null,
      get length() {
        return stored.size
      },
    },
  })
})

function setup() {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const key of MEMBERS)
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 0,
    })
  const ids = MEMBERS.map((k) => database.teamChars.new(k))
  const teamId = database.teams.new({
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
  })
  const teamOpt = initTeamOpt()
  teamOpt.kqm = {
    ...defaultTeamOptKqm,
    ...(env['CONS'] && { constellations: JSON.parse(env['CONS']) }),
  }
  const members = teamOptMembers(database, teamId)
  const names = members.map(({ characterKey }) => ({
    characterKey,
    name: characterKey,
  }))
  return { database, teamId, teamOpt, members, names }
}
type Setup = ReturnType<typeof setup>
const write = (
  { database, teamId }: Setup,
  { text, opener }: { text: string; opener?: string }
) => {
  database.teams.setRotationField(`${teamId}_kqm`, 'Text', text)
  database.teams.setRotationField(`${teamId}_kqm`, 'Opener', opener || null)
  database.teams.setRotationField(
    `${teamId}_kqm`,
    'Timing',
    env['TIMING'] || null
  )
}
const replayOf = (s: Setup) =>
  kqmRotationReplay({
    database: s.database as never,
    teamId: s.teamId,
    members: s.members,
    gender: 'F',
    names: s.names,
    teamOpt: s.teamOpt,
  })!
async function runKqm(s: Setup) {
  const t0 = performance.now()
  const result = await optimizeTeamKqm({
    database: s.database,
    teamId: s.teamId,
    gender: 'F',
    teamOpt: s.teamOpt,
    replay: replayOf(s),
  })
  if (!result) return undefined
  const time = result.played?.rotationTime ?? 0
  return {
    result,
    dps: time ? result.after.total / time : 0,
    time,
    stalls: result.played?.stalls ?? [],
    er: Object.fromEntries(
      Object.entries(result.energyRecharge).map(([k, v]) => [
        k,
        Math.round(v!.value),
      ])
    ),
    builds: Object.fromEntries(
      Object.entries(result.builds).map(([k, b]) => [
        k,
        `${b!.weapon.key} R${b!.weapon.refinement} | ${Object.entries(b!.sets)
          .map(([set, n]) => `${n}${set}`)
          .join('+')}`,
      ])
    ),
    seconds: (performance.now() - t0) / 1000,
  }
}

describe('rotation search', () => {
  it(`phase ${env['PHASE']}`, async () => {
    const s = setup()
    const phase = env['PHASE']
    if (phase === 'base') {
      write(s, JSON.parse(readFileSync(env['SEED']!, 'utf8')))
      const run = await runKqm(s)
      writeFileSync(
        env['OUT']!,
        JSON.stringify({
          builds: run!.result.builds,
          constellations: run!.result.constellations,
          played: run!.result.played,
          summary: { ...run, result: undefined },
        })
      )
      console.log('base', run?.dps, run?.time, run?.seconds, run?.builds)
    } else if (phase === 'screen') {
      const base = JSON.parse(readFileSync(env['BASE']!, 'utf8'))
      const cands = JSON.parse(readFileSync(env['CANDS']!, 'utf8')) as {
        id: string
        text: string
        opener?: string
      }[]
      const overrides = kqmTeamOverrides(s.database, s.teamId, s.teamOpt, base)
      const gear = Object.fromEntries(
        MEMBERS.flatMap((k) =>
          base.builds[k] ? [[k, kqmSimGear(base.builds[k])]] : []
        )
      )
      const out = []
      for (const c of cands) {
        try {
          const warnings = parseRotation(c.text, s.names).warnings
          write(s, c)
          const played = replayOf(s)({
            constellations: base.constellations,
            gear,
            overrides,
          })
          const nodes = teamRotationNodes(s.database, s.teamId, 'F', {
            ...overrides,
            arts: overrides.arts ?? {},
            attacks: played.attacks,
          })
          const total = nodes
            ? evaluateTeamNodes(s.database, s.teamId, played.attacks, nodes)
                .total
            : 0
          const time = played.rotationTime ?? 0
          const er = played.energy
            ? calculateEnergyRecharge(
                MEMBERS,
                withRotationEnergy(
                  defaultEnergyCalculator(MEMBERS, time),
                  MEMBERS,
                  played.energy
                )
              ).targets
            : {}
          out.push({
            ...c,
            dps: time ? total / time : 0,
            time,
            waits: played.stalls,
            er: Object.fromEntries(
              Object.entries(er).map(([k, v]) => [k, Math.round(v as number)])
            ),
            warnings,
          })
        } catch (e) {
          out.push({ ...c, error: String(e) })
        }
      }
      writeFileSync(env['OUT']!, JSON.stringify(out, null, 1))
      console.log('screened', out.length)
    } else if (phase === 'confirm') {
      const cands = JSON.parse(readFileSync(env['CANDS']!, 'utf8')) as {
        id: string
        text: string
        opener?: string
      }[]
      const out = []
      for (const c of cands) {
        const t = setup()
        write(t, c)
        const run = await runKqm(t)
        out.push({ ...c, ...run, result: undefined })
        console.log('confirmed', c.id, run?.dps, run?.time, run?.seconds)
        writeFileSync(env['OUT']!, JSON.stringify(out, null, 1))
      }
    }
    expect(true).toBe(true)
  }, 7_200_000)
})
