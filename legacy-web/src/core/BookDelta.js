/**
 * BookDelta — turns a `pocket_get_changes` response into the cloud's book.
 *
 * The response carries the book's "head" in full (settings, FX rates and
 * every list except transactions — small, and always complete so their order
 * is exact) and, under `_delta`, only the transactions changed or deleted
 * since the cursor the app sent, plus how many live transactions the cloud
 * holds:
 *
 *   { …head…, _delta: { cursor, full, count, put: [tx…], remove: [id…] } }
 *
 * With `full` the transactions are all there. Otherwise they are replayed
 * onto the previous cloud copy (the sync baseline). If the result does not
 * hold exactly `count` transactions, it can't be trusted — rows were removed
 * in a way a delta can't see (e.g. a re-import) — and merge() returns null so
 * the caller loads the whole book instead.
 */
import { BookDiff } from './BookDiff.js';

export class BookDelta {
  static #KEY = '_delta';

  /**
   * @param {object|null} previous  the last cloud copy (needed unless the response is full)
   * @param {object} response       what pocket_get_changes returned (not null)
   * @returns {{book: object, cursor: string|null}|null}  null when it can't be trusted
   */
  static merge(previous, response) {
    const meta = response?.[BookDelta.#KEY];
    if (!meta || typeof meta !== 'object') return null;

    const head = { ...response };
    delete head[BookDelta.#KEY];

    const transactions = meta.full
      ? BookDiff.clone(meta.put || [])
      : (Array.isArray(previous?.transactions) ? BookDelta.replay(previous.transactions, meta) : null);
    if (!transactions || transactions.length !== Number(meta.count)) return null;

    return { book: { ...BookDiff.clone(head), transactions }, cursor: meta.cursor ?? null };
  }

  /**
   * A copy of `list` with the changed items swapped in (new ones added) and
   * the removed ones dropped. The input is not modified.
   * @param {object[]} list
   * @param {{put?: object[], remove?: string[]}} meta
   * @param {{newFirst?: boolean}} [opts]  put new items ahead of the old ones
   *        (lists kept newest-first) instead of after them
   * @returns {object[]}
   */
  static replay(list, meta, { newFirst = false } = {}) {
    const items = BookDiff.clone(list);
    const at = new Map(items.map((t, i) => [t?.id, i]));
    const added = [];
    for (const item of BookDiff.clone(meta.put || [])) {
      if (at.has(item.id)) items[at.get(item.id)] = item;
      else added.push(item);
    }
    const merged = newFirst ? [...added, ...items] : [...items, ...added];
    const gone = new Set(meta.remove || []);
    return gone.size ? merged.filter((t) => !gone.has(t?.id)) : merged;
  }
}
