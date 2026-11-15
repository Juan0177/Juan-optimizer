/*
 * A saved KQM run, packed for the browser's storage (~5 MB for the whole database).
 *
 * A run that played a written rotation holds every attack of it, each with the state of every
 * buff the simulation follows (`states`: {owner, path, value}; `limits`: {owner, path, hits}), in
 * the result and again in the settings it ran with: megabytes of the same few strings. Packed,
 * each buff and each value is written once (`refs`, `values`), every list of states or limits
 * once (`lists`: numbers), and the settings' attacks that are the played ones are not repeated.
 * Unpacking gives the run back exactly.
 */

/** A packed run (`packKqmRun`) */
export interface PackedKqmRun {
  $packed: 1
  /** Each buff: its owner and path */
  refs: string[]
  /** Each state value */
  values: string[]
  /** Each distinct list: pairs of a buff's index and a value's index (states) or a hit count (limits) */
  lists: number[][]
  /** The run, its lists replaced by `{ $s: list }` (states) or `{ $l: list }` (limits) */
  data: unknown
}

const SEP = '\u0000'
const PATH_SEP = '\u0001'
/** The settings' attacks are the result's played ones */
const PLAYED = '$played'

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export const isPackedKqmRun = (v: unknown): v is PackedKqmRun =>
  isObject(v) && v['$packed'] === 1 && Array.isArray(v['lists'])

/** An entry of a states or limits list: a buff with exactly one more field */
function refEntry(v: unknown, field: 'value' | 'hits') {
  if (!isObject(v)) return false
  const keys = Object.keys(v)
  return (
    keys.length === 3 &&
    typeof v['owner'] === 'string' &&
    Array.isArray(v['path']) &&
    v['path'].every((p) => typeof p === 'string') &&
    typeof v[field] === (field === 'value' ? 'string' : 'number')
  )
}

export function packKqmRun(run: Record<string, unknown>): PackedKqmRun {
  const refs: string[] = []
  const refIndex = new Map<string, number>()
  const values: string[] = []
  const valueIndex = new Map<string, number>()
  const lists: number[][] = []
  const listIndex = new Map<string, number>()
  const intern = (table: string[], index: Map<string, number>, key: string) => {
    let i = index.get(key)
    if (i === undefined) {
      i = table.length
      table.push(key)
      index.set(key, i)
    }
    return i
  }
  const list = (numbers: number[]) => {
    const key = numbers.join()
    let i = listIndex.get(key)
    if (i === undefined) {
      i = lists.length
      lists.push(numbers)
      listIndex.set(key, i)
    }
    return i
  }
  const refOf = (e: Record<string, unknown>) =>
    intern(
      refs,
      refIndex,
      `${e['owner']}${SEP}${(e['path'] as string[]).join(PATH_SEP)}`
    )
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      if (v.length && v.every((e) => refEntry(e, 'value')))
        return {
          $s: list(
            v.flatMap((e) => [
              refOf(e),
              intern(values, valueIndex, e['value'] as string),
            ])
          ),
        }
      if (v.length && v.every((e) => refEntry(e, 'hits')))
        return { $l: list(v.flatMap((e) => [refOf(e), e['hits'] as number])) }
      return v.map(walk)
    }
    if (isObject(v))
      return Object.fromEntries(
        Object.entries(v).map(([k, child]) => [k, walk(child)])
      )
    return v
  }
  // the settings it ran with usually carry the very attacks it played: once is enough
  let source = run
  const result = run['result']
  const settings = run['runTeamOpt']
  const played =
    isObject(result) && isObject(result['played'])
      ? result['played']['attacks']
      : undefined
  if (
    played !== undefined &&
    isObject(settings) &&
    JSON.stringify(settings['attacks']) === JSON.stringify(played)
  )
    source = { ...run, runTeamOpt: { ...settings, attacks: PLAYED } }
  return { $packed: 1, refs, values, lists, data: walk(source) }
}

export function unpackKqmRun(packed: PackedKqmRun): Record<string, unknown> {
  const refs = packed.refs.map((ref) => {
    const [owner, path] = ref.split(SEP)
    return { owner, path: path ? path.split(PATH_SEP) : [] }
  })
  const pairs = <T>(i: unknown, make: (ref: number, second: number) => T) => {
    const numbers = packed.lists[i as number] ?? []
    const out: T[] = []
    for (let j = 0; j + 1 < numbers.length; j += 2)
      out.push(make(numbers[j], numbers[j + 1]))
    return out
  }
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk)
    if (!isObject(v)) return v
    const keys = Object.keys(v)
    if (keys.length === 1 && keys[0] === '$s')
      return pairs(v['$s'], (ref, value) => ({
        owner: refs[ref].owner,
        path: [...refs[ref].path],
        value: packed.values[value],
      }))
    if (keys.length === 1 && keys[0] === '$l')
      return pairs(v['$l'], (ref, hits) => ({
        owner: refs[ref].owner,
        path: [...refs[ref].path],
        hits,
      }))
    return Object.fromEntries(keys.map((k) => [k, walk(v[k])]))
  }
  const run = walk(packed.data) as Record<string, unknown>
  const settings = run['runTeamOpt']
  if (isObject(settings) && settings['attacks'] === PLAYED) {
    const result = run['result']
    const played =
      isObject(result) && isObject(result['played'])
        ? result['played']['attacks']
        : {}
    run['runTeamOpt'] = { ...settings, attacks: structuredClone(played) }
  }
  return run
}
