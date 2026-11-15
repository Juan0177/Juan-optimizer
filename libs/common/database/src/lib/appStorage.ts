import {
  DBCachedStorage,
  type KVBackend,
  type KVBatch,
} from './DBCachedStorage'
import { DBLocalStorage } from './DBLocalStorage'
import type { DBStorage, StorageType } from './DBStorage'
import { SandboxStorage } from './SandboxStorage'

/*
 * The app's storage: the active database's entries and the other databases' copies
 * (`extraDatabase_N`). Kept in IndexedDB (the browser's database: no 5 MB limit as localStorage
 * has), held in memory while the app runs (`DBCachedStorage`).
 *
 * The first start with IndexedDB moves the data out of localStorage: every entry is copied in
 * one transaction (all or nothing), with a backup of exactly what localStorage held, then read
 * back and compared value for value; only when every value matches are the entries removed from
 * localStorage. Anything short of that leaves localStorage as it was and the app runs on it as
 * before (the move is tried again next start). This device's settings (`keepLocal`) stay in
 * localStorage, where the app reads them directly.
 *
 * Changes are saved as they are made. A browser can drop a write still under way when the page
 * closes, so then (and when the page is hidden) what is not confirmed saved also goes to a small
 * journal in localStorage (written at once), put into IndexedDB first thing at the next start.
 * Only the newest tab keeps a journal: an older tab's changes never come after a newer tab's.
 */

/** IndexedDB stores: the entries; facts about the move ("moved"); the backup taken by the move */
const KV = 'kv'
const META = 'meta'
const BACKUP = 'backup'
/**
 * Set in localStorage once the data is in IndexedDB. From then on, an IndexedDB that will not open
 * is an error (the app would otherwise start on an empty localStorage and look like the data
 * were lost).
 */
export const MOVED_KEY = 'go_storage'
const MOVED = 'indexeddb'
/** In localStorage: the changes a page had not confirmed saved when it closed (or was hidden) */
const JOURNAL_KEY = 'go_storage_journal'
/** In localStorage: the newest tab (its id): only it keeps a journal */
const TAB_KEY = 'go_storage_tab'
/** localStorage keys of the storage itself: never moved */
const OWN_KEYS = [MOVED_KEY, JOURNAL_KEY, TAB_KEY]
/** How long opening IndexedDB may take before the app gives up on it */
const OPEN_TIMEOUT_MS = 10000
/** When moving, how long an older tab (told this one opened) has to stop writing to localStorage */
const OLDER_TAB_MS = 100

export type AppStorageKind = 'indexeddb' | 'localStorage'

let appStorage: DBStorage | undefined
let appKind: AppStorageKind = 'localStorage'
let backend: IdbBackend | undefined

/** The app's storage (before `openAppStorage`, and in tests: localStorage, as before) */
export function getAppStorage(): DBStorage {
  if (!appStorage)
    appStorage =
      typeof localStorage === 'undefined'
        ? new SandboxStorage()
        : new DBLocalStorage(localStorage)
  return appStorage
}
/** Where the app's data are kept */
export function getAppStorageKind(): AppStorageKind {
  return appKind
}
/** Saves the changes not saved yet (they are saved within moments anyway) */
export function flushAppStorage(): Promise<void> {
  return appStorage instanceof DBCachedStorage
    ? appStorage.flush()
    : Promise.resolve()
}
/** Another tab took over: saves this one's changes so far, and none after */
export function stopAppStorage(): Promise<void> {
  return appStorage instanceof DBCachedStorage
    ? appStorage.stop()
    : Promise.resolve()
}
/** Removes all the app's data (and the backup the move took), and waits until it is saved */
export async function clearAppStorage(): Promise<void> {
  getAppStorage().clear()
  await flushAppStorage()
  await backend?.clearBackup().catch(() => undefined)
}

/** IndexedDB holds the data but would not open */
export class StorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `The browser's database (IndexedDB) would not open: ${cause instanceof Error ? cause.message : String(cause)}`
    )
    this.name = 'StorageUnavailableError'
  }
}

export interface OpenAppStorageOptions {
  /** The IndexedDB database's name */
  name: string
  /** localStorage keys that stay there: this device's settings, which the app reads directly */
  keepLocal: (key: string) => boolean
  /** The localStorage key other tabs watch to stop when a new tab opens */
  newTabKey?: string
  storageType?: StorageType
}
export interface OpenedAppStorage {
  storage: DBStorage
  kind: AppStorageKind
  /** How many entries this start moved out of localStorage */
  moved: number
}

/**
 * Opens the app's storage, moving the data out of localStorage the first time (see above).
 * Throws `StorageUnavailableError` only when the data are in IndexedDB and it will not open.
 */
export async function openAppStorage({
  name,
  keepLocal,
  newTabKey,
  storageType,
}: OpenAppStorageOptions): Promise<OpenedAppStorage> {
  // older tabs stop now: none of them may write while the data move
  if (newTabKey)
    try {
      localStorage.removeItem(newTabKey)
      localStorage.setItem(newTabKey, 'debug')
    } catch {
      // (the tab check is best effort)
    }
  const moved = readLocal(MOVED_KEY) === MOVED
  const onLocalStorage = (): OpenedAppStorage => {
    appStorage = new DBLocalStorage(localStorage, storageType)
    appKind = 'localStorage'
    return { storage: appStorage, kind: appKind, moved: 0 }
  }

  let db: IDBDatabase
  try {
    db = await openDatabase(name)
  } catch (e) {
    if (moved) throw new StorageUnavailableError(e)
    console.error(e)
    return onLocalStorage()
  }

  let count = 0
  try {
    const meta = await getMeta(db)
    if (!meta) {
      await new Promise((resolve) => setTimeout(resolve, OLDER_TAB_MS))
      const result = await moveIn(db, keepLocal)
      if (result) {
        removeLocal(result)
        count = result.length
      }
    } else {
      // (moved before: localStorage is never read for them again. Any still there, left by a
      // start that stopped before tidying, or written since by an older version, go)
      const left = meta.keys.filter((key) => readLocal(key) !== null)
      if (left.length || !moved) removeLocal(left.map((key) => [key, '']))
    }
  } catch (e) {
    console.error(e)
    db.close()
    if (moved) throw new StorageUnavailableError(e)
    return onLocalStorage()
  }

  let entries: [string, string][]
  try {
    // (a journal left by a page that closed with changes not confirmed saved: they go in first)
    await replayJournal(db)
    entries = await readAll(db)
  } catch (e) {
    db.close()
    throw new StorageUnavailableError(e)
  }
  backend = new IdbBackend(name, db)
  const storage = new DBCachedStorage(entries, backend, storageType)
  appStorage = storage
  appKind = 'indexeddb'
  keepFromEviction()
  if (typeof window !== 'undefined') keepJournal(storage)
  return { storage, kind: appKind, moved: count }
}

interface Journal {
  tab: string
  at: number
  clear: boolean
  entries: [string, string | null][]
}

/**
 * Keeps this tab's journal: when the page closes or is hidden, what is not confirmed saved goes to
 * localStorage (written at once: a write to IndexedDB started as the page closes is dropped); as
 * saves are confirmed, it shrinks, and goes when everything is saved
 */
function keepJournal(storage: DBCachedStorage) {
  const tab = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  try {
    localStorage.setItem(TAB_KEY, tab)
  } catch {
    // (no journal without it)
  }
  let kept = false
  const own = () => {
    try {
      return (
        (
          JSON.parse(
            localStorage.getItem(JOURNAL_KEY) ?? 'null'
          ) as Journal | null
        )?.tab === tab
      )
    } catch {
      return false
    }
  }
  const update = () => {
    // (a tab that another one took over, or an older one: never)
    if (storage.stopped || readLocal(TAB_KEY) !== tab) return
    const unsaved = storage.unsavedChanges()
    try {
      if (unsaved) {
        localStorage.setItem(
          JOURNAL_KEY,
          JSON.stringify({ tab, at: Date.now(), ...unsaved } satisfies Journal)
        )
        kept = true
      } else if (kept) {
        if (own()) localStorage.removeItem(JOURNAL_KEY)
        kept = false
      }
    } catch (e) {
      console.error(e)
    }
  }
  const leave = () => {
    void storage.flush()
    update()
  }
  window.addEventListener('pagehide', leave)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave()
  })
  storage.follow(() => {
    if (kept) update()
  })
}

/** Puts a journal's changes into IndexedDB (in one transaction), then removes it */
async function replayJournal(db: IDBDatabase) {
  const raw = readLocal(JOURNAL_KEY)
  if (!raw) return
  let journal: Journal | undefined
  try {
    const parsed = JSON.parse(raw) as Journal
    if (
      Array.isArray(parsed.entries) &&
      parsed.entries.every(
        (e) =>
          Array.isArray(e) &&
          typeof e[0] === 'string' &&
          (typeof e[1] === 'string' || e[1] === null)
      )
    )
      journal = parsed
  } catch {
    // (unreadable: nothing to put in)
  }
  if (journal) {
    const tx = db.transaction(KV, 'readwrite')
    const kv = tx.objectStore(KV)
    if (journal.clear) kv.clear()
    for (const [key, value] of journal.entries)
      if (value === null) kv.delete(key)
      else kv.put(value, key)
    await completion(tx)
  }
  try {
    localStorage.removeItem(JOURNAL_KEY)
  } catch {
    // (put in again next start: the same values)
  }
}

/**
 * Asks the browser not to clear the site's data when the disk runs low. Only where it is decided
 * without asking (Chromium browsers: by how the site is used); Firefox would show a prompt.
 */
function keepFromEviction() {
  try {
    if (!('userAgentData' in navigator)) return
    void navigator.storage
      ?.persisted?.()
      .then((persisted) => persisted || navigator.storage.persist())
      .catch(() => undefined)
  } catch {
    // (best effort)
  }
}

/** Removes the moved entries from localStorage, then marks the data as in IndexedDB */
function removeLocal(entries: [string, string][]) {
  for (const [key] of entries)
    try {
      localStorage.removeItem(key)
    } catch {
      // (left in localStorage: the data in IndexedDB are used either way)
    }
  // (set last: with localStorage full, it fits only once the entries are gone)
  try {
    localStorage.setItem(MOVED_KEY, MOVED)
  } catch (e) {
    console.error(e)
  }
}

function readLocal(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

interface Meta {
  at: number
  keys: string[]
}

/**
 * Copies localStorage's entries (all but `keepLocal`'s) into IndexedDB in one transaction, with a
 * backup of them, then reads them back. Resolves to the entries moved, or `undefined` when another
 * tab moved them first. Throws (and leaves IndexedDB as it was) unless every value read back is
 * the same as localStorage's.
 */
async function moveIn(
  db: IDBDatabase,
  keepLocal: (key: string) => boolean
): Promise<[string, string][] | undefined> {
  const entries: [string, string][] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key === null || OWN_KEYS.includes(key) || keepLocal(key)) continue
    const value = localStorage.getItem(key)
    if (value !== null) entries.push([key, value])
  }
  const at = Date.now()
  const tx = db.transaction([KV, META, BACKUP], 'readwrite')
  let wrote = false
  // (the check and the writes in one transaction: two tabs starting at once cannot both move)
  const check = tx.objectStore(META).get('moved')
  check.onsuccess = () => {
    if (check.result) return
    wrote = true
    const kv = tx.objectStore(KV)
    kv.clear()
    for (const [key, value] of entries) kv.put(value, key)
    tx.objectStore(BACKUP).put({ at, from: 'localStorage', entries }, 'move')
    tx.objectStore(META).put(
      { at, keys: entries.map(([key]) => key) } satisfies Meta,
      'moved'
    )
  }
  await completion(tx)
  if (!wrote) return undefined

  const saved = new Map(await readAll(db))
  if (
    saved.size !== entries.length ||
    entries.some(([key, value]) => saved.get(key) !== value)
  ) {
    const undo = db.transaction([KV, META, BACKUP], 'readwrite')
    undo.objectStore(KV).clear()
    undo.objectStore(META).delete('moved')
    undo.objectStore(BACKUP).delete('move')
    await completion(undo)
    throw new Error(
      "The data copied to the browser's database did not match: they stay in localStorage"
    )
  }
  return entries
}

async function getMeta(db: IDBDatabase): Promise<Meta | undefined> {
  const tx = db.transaction(META, 'readonly')
  const meta = (await request(tx.objectStore(META).get('moved'))) as
    | Meta
    | undefined
  return meta && Array.isArray(meta.keys) ? meta : undefined
}

async function readAll(db: IDBDatabase): Promise<[string, string][]> {
  const tx = db.transaction(KV, 'readonly')
  const store = tx.objectStore(KV)
  const [keys, values] = await Promise.all([
    request(store.getAllKeys()),
    request(store.getAll()),
  ])
  return keys.map((key, i) => [String(key), String(values[i])])
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Opening took too long')),
      OPEN_TIMEOUT_MS
    )
    const fail = (e: unknown) => {
      clearTimeout(timer)
      reject(e)
    }
    let open: IDBOpenDBRequest
    try {
      if (typeof indexedDB === 'undefined')
        throw new Error('IndexedDB is not available')
      open = indexedDB.open(name, 1)
    } catch (e) {
      fail(e)
      return
    }
    open.onupgradeneeded = () => {
      const db = open.result
      for (const store of [KV, META, BACKUP])
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
    }
    open.onsuccess = () => {
      clearTimeout(timer)
      resolve(open.result)
    }
    open.onerror = () => fail(open.error)
  })
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function completion(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () =>
      reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'))
  })
}

/** Saves batches to IndexedDB, opening it again if the browser closed it */
class IdbBackend implements KVBackend {
  private db: IDBDatabase | undefined
  constructor(
    private name: string,
    db: IDBDatabase
  ) {
    this.watch(db)
  }
  async write({ clear, entries }: KVBatch): Promise<void> {
    const db = await this.connection()
    let tx: IDBTransaction
    try {
      tx = db.transaction(KV, 'readwrite')
    } catch (e) {
      // (closed under us: opened again on the next try)
      this.db = undefined
      throw e
    }
    const kv = tx.objectStore(KV)
    if (clear) kv.clear()
    for (const [key, value] of entries)
      if (value === null) kv.delete(key)
      else kv.put(value, key)
    await completion(tx)
  }
  async clearBackup() {
    const db = await this.connection()
    const tx = db.transaction(BACKUP, 'readwrite')
    tx.objectStore(BACKUP).clear()
    await completion(tx)
  }
  private async connection() {
    if (!this.db) this.watch(await openDatabase(this.name))
    return this.db as IDBDatabase
  }
  private watch(db: IDBDatabase) {
    this.db = db
    db.onclose = () => {
      if (this.db === db) this.db = undefined
    }
    db.onversionchange = () => {
      db.close()
      if (this.db === db) this.db = undefined
    }
  }
}
