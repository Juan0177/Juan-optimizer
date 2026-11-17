import { DBCachedStorage, type KVBatch } from './DBCachedStorage'

/** A backend that records batches; each write waits for `release()` (or fails with `fail()`) */
function backend() {
  const batches: KVBatch[] = []
  const saved = new Map<string, string>()
  let waiting: { resolve: () => void; reject: (e: unknown) => void }[] = []
  return {
    batches,
    saved,
    get waiting() {
      return waiting.length
    },
    write(batch: KVBatch) {
      batches.push(structuredClone(batch))
      return new Promise<void>((resolve, reject) =>
        waiting.push({
          resolve: () => {
            if (batch.clear) saved.clear()
            for (const [k, v] of batch.entries)
              if (v === null) saved.delete(k)
              else saved.set(k, v)
            resolve()
          },
          reject,
        })
      )
    },
    async release() {
      const now = waiting
      waiting = []
      now.forEach((w) => w.resolve())
      await vi.advanceTimersByTimeAsync(0)
    },
    async fail() {
      const now = waiting
      waiting = []
      now.forEach((w) =>
        w.reject(new DOMException('full', 'QuotaExceededError'))
      )
      await vi.advanceTimersByTimeAsync(0)
    },
  }
}

describe('DBCachedStorage (the data in memory, saved in the background)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reads and writes at once, and saves a moment’s writes together', async () => {
    const b = backend()
    const storage = new DBCachedStorage([['a', '1']], b)
    storage.set('b', { x: 2 })
    storage.setString('c', 'three')
    storage.remove('a')
    expect(storage.get('b')).toEqual({ x: 2 })
    expect(storage.keys).toEqual(['b', 'c'])
    expect(b.batches).toEqual([])
    await vi.advanceTimersByTimeAsync(0)
    expect(b.batches).toEqual([
      {
        clear: false,
        entries: [
          ['b', '{"x":2}'],
          ['c', 'three'],
          ['a', null],
        ],
      },
    ])
    await b.release()
    expect(storage.unsaved).toBe(false)
  })

  it('does not write a value again that it already holds (loading re-saves every entry)', async () => {
    const b = backend()
    const storage = new DBCachedStorage([['a', '{"x":1}']], b)
    storage.set('a', { x: 1 })
    storage.remove('missing')
    await vi.advanceTimersByTimeAsync(0)
    expect(b.batches).toEqual([])
  })

  it('saves one batch at a time, in order', async () => {
    const b = backend()
    const storage = new DBCachedStorage([], b)
    storage.setString('a', '1')
    await vi.advanceTimersByTimeAsync(0)
    storage.setString('a', '2')
    await vi.advanceTimersByTimeAsync(0)
    expect(b.batches.length).toBe(1)
    await b.release()
    expect(b.batches.map((x) => x.entries)).toEqual([
      [['a', '1']],
      [['a', '2']],
    ])
    await b.release()
    expect(b.saved.get('a')).toBe('2')
  })

  it('after a failed save, tries again without putting back an older value over a newer one', async () => {
    const b = backend()
    const storage = new DBCachedStorage([], b)
    const errors: unknown[] = []
    storage.follow(() => errors.push(storage.error))
    storage.setString('a', '1')
    storage.setString('b', '1')
    await vi.advanceTimersByTimeAsync(0)
    storage.setString('a', '2') // while the first save is out
    await b.fail()
    expect(storage.error).toBeInstanceOf(DOMException)
    await vi.advanceTimersByTimeAsync(1000)
    expect(b.batches.at(-1)?.entries).toEqual([
      ['a', '2'],
      ['b', '1'],
    ])
    await b.release()
    expect([...b.saved]).toEqual([
      ['a', '2'],
      ['b', '1'],
    ])
    expect(storage.error).toBeUndefined()
    expect(errors.length).toBe(2)
  })

  it('clears, then saves what was written after', async () => {
    const b = backend()
    const storage = new DBCachedStorage(
      [
        ['a', '1'],
        ['b', '1'],
      ],
      b
    )
    storage.setString('a', '2')
    storage.clear()
    storage.setString('c', '1')
    expect(storage.keys).toEqual(['c'])
    await vi.advanceTimersByTimeAsync(0)
    expect(b.batches).toEqual([{ clear: true, entries: [['c', '1']] }])
  })

  it('flush saves what waits now; stop saves what changed so far and nothing after', async () => {
    const b = backend()
    const storage = new DBCachedStorage([], b)
    storage.setString('a', '1')
    const flushed = storage.flush()
    expect(b.batches.length).toBe(1)
    await b.release()
    await flushed
    storage.setString('b', '1')
    const stopped = storage.stop()
    storage.setString('c', '1') // (another tab has the data now)
    await b.release()
    await stopped
    await vi.advanceTimersByTimeAsync(5000)
    expect([...b.saved.keys()]).toEqual(['a', 'b'])
    expect(storage.getString('c')).toBe('1')
  })

  it('starts saving at the end of the task that changed something (before the page can reload)', async () => {
    const b = backend()
    const storage = new DBCachedStorage([], b)
    storage.setString('a', '1')
    expect(b.batches.length).toBe(0)
    await Promise.resolve()
    expect(b.batches.length).toBe(1)
  })

  it('tells what is not confirmed saved: being written, and waiting', async () => {
    const b = backend()
    const storage = new DBCachedStorage([['x', '0']], b)
    expect(storage.unsavedChanges()).toBeUndefined()
    storage.setString('a', '1')
    storage.setString('b', '1')
    await Promise.resolve() // (a and b are being written)
    storage.setString('b', '2')
    storage.remove('x')
    expect(storage.unsavedChanges()).toEqual({
      clear: false,
      entries: [
        ['a', '1'],
        ['b', '2'],
        ['x', null],
      ],
    })
    await b.release()
    expect(storage.unsavedChanges()?.entries).toEqual([
      ['b', '2'],
      ['x', null],
    ])
    await b.release()
    expect(storage.unsavedChanges()).toBeUndefined()
    // a clear since the batch being written: only what came after it
    storage.setString('c', '1')
    await Promise.resolve()
    storage.clear()
    storage.setString('d', '1')
    expect(storage.unsavedChanges()).toEqual({
      clear: true,
      entries: [['d', '1']],
    })
  })
})
