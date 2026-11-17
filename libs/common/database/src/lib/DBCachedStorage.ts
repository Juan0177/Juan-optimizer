import type {
  DBStorage,
  DbIndexKey,
  DbVersionKey,
  StorageType,
} from './DBStorage'

/** A batch of changes to save: everything removed first when `clear`, then each entry (a value, or `null`: removed) */
export interface KVBatch {
  clear: boolean
  entries: [key: string, value: string | null][]
}

/** Where a `DBCachedStorage` saves its data (IndexedDB in the browser) */
export interface KVBackend {
  write(batch: KVBatch): Promise<void>
}

/** Waits before saving again after a failed save: doubles each time, up to the last */
const RETRY_MS = [1000, 2000, 5000, 10000, 30000]

/**
 * The database's storage, held in memory and saved to a slower store (IndexedDB) in the
 * background. Reads and writes stay synchronous, as they were with localStorage: the data
 * managers read everything while they are constructed, and write on every change.
 *
 * Saving: the changes of a task go out together at its end (so a change is on its way before the
 * page can reload: the browser keeps a write already started, not one started as the page closes),
 * one batch at a time and in order (a batch is only taken once the one before it is saved, so a
 * failed batch can be put back under any newer change without overwriting it). A value the same as
 * the one already held is not written again: loading the database re-saves every entry.
 * `unsavedChanges` is what is not confirmed saved yet (kept elsewhere as the page closes).
 */
export class DBCachedStorage implements DBStorage {
  private map: Map<string, string>
  private backend: KVBackend
  private pending = new Map<string, string | null>()
  private cleared = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private soon = false
  private writing: Promise<void> | undefined
  /** The batch being written now */
  private sending: KVBatch | undefined
  private failures = 0
  private stopped_ = false
  private listeners = new Set<() => void>()
  /** The last save's error, until a save succeeds */
  error: unknown = undefined
  dbVersionKey: DbVersionKey
  dbIndexKey: DbIndexKey

  constructor(
    entries: Iterable<[string, string]>,
    backend: KVBackend,
    storageType: StorageType = 'go'
  ) {
    this.map = new Map(entries)
    this.backend = backend
    switch (storageType) {
      case 'go':
        this.dbVersionKey = 'db_ver'
        this.dbIndexKey = 'dbIndex'
        break
    }
  }

  get keys(): string[] {
    return [...this.map.keys()]
  }
  get entries(): [key: string, value: string][] {
    return [...this.map.entries()]
  }

  get(key: string) {
    const string = this.map.get(key)
    if (!string) return undefined
    try {
      return JSON.parse(string)
    } catch {
      this.remove(key)
      return undefined
    }
  }
  set(key: string, value: any): void {
    // (as localStorage keeps it: `undefined` is stored as the text "undefined")
    this.setString(key, String(JSON.stringify(value)))
  }
  getString(key: string): string | undefined {
    return this.map.get(key)
  }
  setString(key: string, value: string): void {
    if (this.map.get(key) === value) return
    this.map.set(key, value)
    this.queue(key, value)
  }
  remove(key: string): void {
    if (!this.map.has(key)) return
    this.map.delete(key)
    this.queue(key, null)
  }
  removeForKeys(shouldRemove: (key: string) => boolean): void {
    for (const key of this.keys) if (shouldRemove(key)) this.remove(key)
  }
  copyFrom(other: DBStorage): void {
    for (const [key, value] of other.entries) this.setString(key, value)
  }
  clear(): void {
    if (this.stopped_) {
      this.map.clear()
      return
    }
    this.map.clear()
    this.pending.clear()
    this.cleared = true
    this.schedule(0)
  }
  getDBVersion(): number {
    return Number.parseInt(this.getString(this.dbVersionKey) ?? '0')
  }
  setDBVersion(version: number): void {
    this.setString(this.dbVersionKey, version.toString())
  }
  getDBIndex(): 1 | 2 | 3 | 4 {
    return Number.parseInt(this.getString(this.dbIndexKey) ?? '1') as
      | 1
      | 2
      | 3
      | 4
  }
  setDBIndex(ind: 1 | 2 | 3 | 4): void {
    this.setString(this.dbIndexKey, ind.toString())
  }

  /** Whether changes are waiting to be saved */
  get unsaved() {
    return this.cleared || this.pending.size > 0 || !!this.writing
  }
  /** Whether another tab took over (`stop`) */
  get stopped() {
    return this.stopped_
  }
  /**
   * The changes not confirmed saved yet (being written, or waiting), as one batch; `undefined`
   * when everything is saved
   */
  unsavedChanges(): KVBatch | undefined {
    const sending = this.sending
    if (!sending && !this.cleared && !this.pending.size) return undefined
    // (a clear since the batch being written drops that batch's entries)
    const entries = new Map(this.cleared || !sending ? [] : sending.entries)
    for (const [key, value] of this.pending) entries.set(key, value)
    return {
      clear: this.cleared || !!sending?.clear,
      entries: [...entries],
    }
  }
  /** Calls `listener` after each save, and when a save fails (`error`) */
  follow(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Saves everything changed so far; resolves once it is saved (or the save failed) */
  flush(): Promise<void> {
    this.soon = false
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    if (this.writing) return this.writing.then(() => this.flush())
    if (!this.cleared && !this.pending.size) return Promise.resolve()
    const batch: KVBatch = { clear: this.cleared, entries: [...this.pending] }
    this.pending = new Map()
    this.cleared = false
    this.sending = batch
    const writing = this.backend.write(batch).then(
      () => {
        this.sending = undefined
        this.failures = 0
        this.error = undefined
        this.notify()
      },
      (error: unknown) => {
        this.sending = undefined
        // put the batch back under what changed since (only newer changes are waiting)
        if (!this.cleared) {
          this.cleared = batch.clear
          const newer = this.pending
          this.pending = new Map(batch.entries)
          for (const [key, value] of newer) this.pending.set(key, value)
        }
        this.error = error
        this.notify()
        this.schedule(RETRY_MS[Math.min(this.failures++, RETRY_MS.length - 1)])
      }
    )
    this.writing = writing.finally(() => {
      this.writing = undefined
    })
    return this.writing
  }
  /**
   * Saves what changed so far and takes no more changes to save: another tab took over the
   * data, and this one's later changes must not overwrite its
   */
  stop(): Promise<void> {
    this.stopped_ = true
    return this.flush()
  }

  private queue(key: string, value: string | null) {
    if (this.stopped_) return
    this.pending.set(key, value)
    this.schedule(0)
  }
  /** Saves at the end of this task (`0`), or after `ms` (to try again after a failure) */
  private schedule(ms: number) {
    if (ms === 0) {
      if (this.soon) return
      this.soon = true
      queueMicrotask(() => {
        if (this.soon) void this.flush()
      })
      return
    }
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush()
    }, ms)
  }
  private notify() {
    for (const listener of this.listeners) listener()
  }
}
