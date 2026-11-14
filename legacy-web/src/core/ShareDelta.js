/**
 * ShareDelta — turns a `pocket_get_shared_changes` response into the shares
 * (books shared with this user) as the server holds them.
 *
 *   { cursor, shares: [ { …head…, _delta: { full, count, put: [tx…], remove: [id…] } } ] }
 *
 * Each share's head (accounts, categories, budgets, permissions …) comes in
 * full; its entries come as a delta onto the previous copy of that share,
 * found by owner and space. Entries are kept newest-first, as the server
 * sends them. If any share can't be trusted — its entry count doesn't add up
 * (an account was shared or unshared, which shows or hides old entries
 * without changing them), or there is no previous copy to apply a delta to —
 * merge() returns null and the caller asks for every share in full.
 */
import { BookDiff } from './BookDiff.js';
import { BookDelta } from './BookDelta.js';

export class ShareDelta {
  static #KEY = '_delta';

  /** Identifies a share across loads. */
  static key(share) {
    return `${share?._ownerId}|${share?._spaceId}`;
  }

  /**
   * @param {object[]|null} previous  the shares as last merged (null on a first load)
   * @param {object} response          what pocket_get_shared_changes returned
   * @returns {{shares: object[], cursor: string|null}|null}  null when it can't be trusted
   */
  static merge(previous, response) {
    if (!response || !Array.isArray(response.shares)) return null;
    const before = new Map((previous || []).map((s) => [ShareDelta.key(s), s]));
    const shares = [];
    for (const raw of response.shares) {
      const meta = raw?.[ShareDelta.#KEY];
      if (!meta || typeof meta !== 'object') return null;
      const head = { ...raw };
      delete head[ShareDelta.#KEY];

      const prev = before.get(ShareDelta.key(raw));
      const transactions = meta.full
        ? BookDiff.clone(meta.put || [])
        : (Array.isArray(prev?.transactions) ? ShareDelta.#newestFirst(BookDelta.replay(prev.transactions, meta, { newFirst: true })) : null);
      if (!transactions || transactions.length !== Number(meta.count)) return null;
      shares.push({ ...BookDiff.clone(head), transactions });
    }
    return { shares, cursor: response.cursor ?? null };
  }

  /** Newest date first; entries on the same date keep their order (new ones were placed first). */
  static #newestFirst(list) {
    return list
      .map((t, i) => [t, i])
      .sort(([a, i], [b, j]) => (String(b?.date || '').localeCompare(String(a?.date || ''))) || (i - j))
      .map(([t]) => t);
  }
}
