// The particle energy each member got per loop in loops 3 and 4 of kqmsim samples (a config here,
// 6 loops, each starting with print("loop")), the mean of the samples given, and who was on the
// field as each source's particles arrived:
//   kqmsim -c quick.txt -sample run-1.sample -nb   (20 times)
//   node steady-energy.mjs run-*.sample
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
const energy = {}
const caught = {}
for (const file of files) {
  const sample = JSON.parse(readFileSync(file, 'utf8'))
  const names = sample.character_details.map((c) => c.name)
  const loops = sample.logs
    .filter((l) => l.event === 'user' && /loop/.test(l.msg))
    .map((l) => l.frame)
  const [from, to] = [loops[2], loops[4]]
  const arrivals = new Map()
  for (const l of sample.logs) {
    if (l.event !== 'energy' || l.msg !== 'particle') continue
    if (l.frame < from || l.frame >= to) continue
    const name = names[l.char_index]
    energy[name] =
      (energy[name] ?? 0) + l.logs.amt / l.logs.ER / 2 / files.length
    const key = `${l.frame}|${l.logs.source}`
    const arrival = arrivals.get(key) ?? {
      source: l.logs.source,
      count: l.logs.count,
    }
    if (l.logs.is_active) arrival.active = name
    arrivals.set(key, arrival)
  }
  for (const { source, count, active } of arrivals.values()) {
    const by = (caught[source] ??= {})
    by[active] = (by[active] ?? 0) + count / 2 / files.length
  }
}
const round = (o) =>
  Object.fromEntries(
    Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100])
  )
console.log('energy per loop', round(energy))
for (const [source, by] of Object.entries(caught))
  console.log(
    `${source}'s particles per loop, by who was on the field`,
    round(by)
  )
