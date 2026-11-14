/**
 * KeyValueStore — somewhere to keep large records between visits.
 *
 * localStorage holds about 5 MB per site and the app already keeps its
 * working copy of the book there. The sync records (the copy the cloud last
 * confirmed, the shared books) are as big again, so they live in IndexedDB,
 * which has room for far more. Where IndexedDB isn't available (some private
 * modes, test runners) the same interface falls back to localStorage.
 *
 * Values are plain data. Writes are applied in the order they are made; a
 * failed write is reported in the console and otherwise ignored — the caller
 * keeps its in-memory copy, exactly as when localStorage is full.
 */
export class KeyValueStore {
  /** The store for this browser: IndexedDB when it exists, else localStorage. */
  static default() {
    try {
      if (typeof indexedDB !== 'undefined' && indexedDB) return new IndexedDbStore();
    } catch (_) { /* some privacy modes throw on access */ }
    return new LocalStorageStore();
  }

  /** @returns {Promise<any>} the value, or undefined */
  async get(_key) { throw new Error('not implemented'); }
  /** @returns {Promise<boolean>} whether it was written */
  async set(_key, _value) { throw new Error('not implemented'); }
  async remove(_key) { throw new Error('not implemented'); }
}

/** One object store ("kv") in the "pocket" database. */
export class IndexedDbStore extends KeyValueStore {
  static #DB = 'pocket';
  static #STORE = 'kv';
  static #VERSION = 1;

  /** @type {Promise<IDBDatabase>|null} */
  #db = null;

  async get(key) {
    try {
      return await this.#request('readonly', (s) => s.get(key));
    } catch (e) {
      console.warn('[KeyValueStore] read failed:', e);
      return undefined;
    }
  }

  async set(key, value) {
    try {
      await this.#request('readwrite', (s) => s.put(value, key));
      return true;
    } catch (e) {
      console.warn('[KeyValueStore] write failed:', e);
      return false;
    }
  }

  async remove(key) {
    try { await this.#request('readwrite', (s) => s.delete(key)); } catch (_) { /* nothing to remove */ }
  }

  #open() {
    if (!this.#db) {
      this.#db = new Promise((resolve, reject) => {
        const req = indexedDB.open(IndexedDbStore.#DB, IndexedDbStore.#VERSION);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(IndexedDbStore.#STORE)) {
            req.result.createObjectStore(IndexedDbStore.#STORE);
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB is blocked'));
      });
      this.#db.catch(() => { this.#db = null; }); // let a later call try again
    }
    return this.#db;
  }

  /** Run one request in its own transaction; resolves once the transaction commits. */
  async #request(mode, make) {
    const db = await this.#open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IndexedDbStore.#STORE, mode);
      const req = make(tx.objectStore(IndexedDbStore.#STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error || req.error);
      tx.onabort = () => reject(tx.error || new Error('aborted'));
    });
  }
}

/** The fallback: JSON in localStorage. */
export class LocalStorageStore extends KeyValueStore {
  async get(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? undefined : JSON.parse(raw);
    } catch (_) {
      return undefined;
    }
  }

  async set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false; // quota or private mode
    }
  }

  async remove(key) {
    try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
  }
}
