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
      : BookDelta.#replay(previous, meta);
    if (!transactions || transactions.length !== Number(meta.count)) return null;

    return { book: { ...BookDiff.clone(head), transactions }, cursor: meta.cursor ?? null };
  }

  /** The previous copy's transactions with the changed ones swapped in and the deleted ones dropped. */
  static #replay(previous, meta) {
    if (!Array.isArray(previous?.transactions)) return null;
    const transactions = BookDiff.clone(previous.transactions);
    const at = new Map(transactions.map((t, i) => [t?.id, i]));
    for (const tx of BookDiff.clone(meta.put || [])) {
      if (at.has(tx.id)) transactions[at.get(tx.id)] = tx;
      else { at.set(tx.id, transactions.length); transactions.push(tx); }
    }
    const gone = new Set(meta.remove || []);
    return gone.size ? transactions.filter((t) => !gone.has(t?.id)) : transactions;
  }
}
