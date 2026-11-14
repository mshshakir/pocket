/**
 * BookDiff — what changed in a book between two snapshots, item by item.
 *
 * The cloud stores a book as rows (one per transaction, account, category …),
 * so a save sends only the items that differ from the last synced copy instead
 * of the whole book. The same change set can be replayed onto a newer cloud
 * copy, which is how edits made offline (or before a reload) survive without
 * overwriting what other devices saved in the meantime.
 *
 * Change set shape (what `pocket_apply_changes` accepts):
 *   {
 *     put:    { transactions: [item + _pos], accounts: [...], ... },
 *     remove: { transactions: [id], ... },
 *     user, fxRatesUpdatedAt, _transferDirBackfilled,   // settings, sent together
 *     fxRates, merchantCategories,                       // small maps, sent whole
 *     bookExtra,                                         // any other top-level data
 *   }
 */
export class BookDiff {
  /** Lists of items with an `id`, in the order the server applies them. */
  static LISTS = Object.freeze([
    'accountGroups', 'accounts', 'categories', 'budgets', 'debts',
    'regularItems', 'family', 'spaces', 'transactions',
  ]);

  /** Top-level keys the server stores in their own tables or columns. */
  static #KNOWN_TOP = new Set([
    ...BookDiff.LISTS, 'user', 'fxRates', 'merchantCategories', 'fxRatesUpdatedAt', '_transferDirBackfilled',
  ]);

  /**
   * Changes that turn `base` into `cur`.
   * @param {object|null} base  last synced snapshot (null → everything is new)
   * @param {object} cur        current state (transient keys already stripped)
   * @returns {object|null}     a change set, or null when nothing changed
   */
  static changes(base, cur) {
    const b = base || {};
    const out = { put: {}, remove: {} };
    let any = false;

    for (const list of BookDiff.LISTS) {
      const before = new Map((Array.isArray(b[list]) ? b[list] : []).filter(BookDiff.#hasId)
        .map((it) => [it.id, BookDiff.#key(it)]));
      const nowItems = (Array.isArray(cur[list]) ? cur[list] : []).filter(BookDiff.#hasId);
      const seen = new Set();
      const puts = [];
      nowItems.forEach((it, i) => {
        seen.add(it.id);
        if (before.get(it.id) !== BookDiff.#key(it)) puts.push({ ...it, _pos: i + 1 });
      });
      const removes = [...before.keys()].filter((id) => !seen.has(id));
      if (puts.length) { out.put[list] = puts; any = true; }
      if (removes.length) { out.remove[list] = removes; any = true; }
    }

    const settingsChanged = ['user', 'fxRatesUpdatedAt', '_transferDirBackfilled']
      .some((k) => BookDiff.#key(b[k]) !== BookDiff.#key(cur[k]));
    if (settingsChanged) {
      out.user = cur.user || {};
      out.fxRatesUpdatedAt = cur.fxRatesUpdatedAt ?? null;
      out._transferDirBackfilled = cur._transferDirBackfilled ?? null;
      any = true;
    }
    for (const map of ['fxRates', 'merchantCategories']) {
      if (BookDiff.#key(b[map]) !== BookDiff.#key(cur[map])) { out[map] = cur[map] || {}; any = true; }
    }
    const extraBefore = BookDiff.#extra(b);
    const extraNow = BookDiff.#extra(cur);
    if (BookDiff.#key(extraBefore) !== BookDiff.#key(extraNow)) { out.bookExtra = extraNow; any = true; }

    if (!Object.keys(out.put).length) delete out.put;
    if (!Object.keys(out.remove).length) delete out.remove;
    return any ? out : null;
  }

  /**
   * Replay a change set onto a state (mutates and returns it). Used to carry
   * this device's unsynced edits over onto a newer cloud copy.
   * @param {object} state
   * @param {object|null} changes
   * @returns {object}
   */
  static apply(state, changes) {
    if (!changes) return state;
    for (const list of BookDiff.LISTS) {
      if (!Array.isArray(state[list])) state[list] = [];
      for (const raw of changes.put?.[list] || []) {
        const { _pos, ...item } = raw;
        const at = state[list].findIndex((x) => x?.id === item.id);
        if (at >= 0) state[list][at] = item; else state[list].push(item);
      }
      const gone = new Set(changes.remove?.[list] || []);
      if (gone.size) state[list] = state[list].filter((x) => !gone.has(x?.id));
    }
    if ('user' in changes) {
      state.user = changes.user;
      state.fxRatesUpdatedAt = changes.fxRatesUpdatedAt ?? undefined;
      state._transferDirBackfilled = changes._transferDirBackfilled ?? undefined;
    }
    if ('fxRates' in changes) state.fxRates = changes.fxRates;
    if ('merchantCategories' in changes) state.merchantCategories = changes.merchantCategories;
    if ('bookExtra' in changes) {
      for (const k of Object.keys(BookDiff.#extra(state))) delete state[k];
      Object.assign(state, changes.bookExtra || {});
    }
    return state;
  }

  /**
   * A deep copy of book data (plain JSON), safe to mutate. JSON rather than
   * structuredClone so it also works on older browsers.
   */
  static clone(v) {
    return v == null ? v : JSON.parse(JSON.stringify(v));
  }

  /** Row keys (table + id) a change set writes, for spotting our own echoes. */
  static touchedKeys(changes) {
    const keys = new Set();
    if (!changes) return keys;
    for (const list of BookDiff.LISTS) {
      for (const it of changes.put?.[list] || []) keys.add(`${list}:${it.id}`);
      for (const id of changes.remove?.[list] || []) keys.add(`${list}:${id}`);
    }
    return keys;
  }

  /** Top-level data with no table of its own (e.g. legacy `regularLogs`). */
  static #extra(state) {
    const out = {};
    for (const [k, v] of Object.entries(state || {})) {
      if (!BookDiff.#KNOWN_TOP.has(k) && !k.startsWith('_') && v !== undefined) out[k] = v;
    }
    return out;
  }

  static #hasId(it) {
    return it && typeof it === 'object' && it.id != null;
  }

  /** Order-independent fingerprint, so a re-ordered key list isn't a change. */
  static #key(v) {
    return JSON.stringify(BookDiff.#sorted(v));
  }

  static #sorted(v) {
    if (Array.isArray(v)) return v.map((x) => BookDiff.#sorted(x));
    if (v && typeof v === 'object') {
      const o = {};
      for (const k of Object.keys(v).sort()) if (v[k] !== undefined) o[k] = BookDiff.#sorted(v[k]);
      return o;
    }
    return v ?? null;
  }
}
