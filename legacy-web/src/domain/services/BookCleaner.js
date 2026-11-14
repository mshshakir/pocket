/**
 * BookCleaner — removes sample data, or every entry, from a book in place.
 *
 * Sample records (the demo accounts, transactions and budgets SeedFactory
 * creates for a first-time visitor) carry `sample: true`. The flag is saved
 * with the record (the server keeps unknown fields in `extra`), so sample data
 * can be recognised and removed later — on any device — without touching
 * anything the user entered.
 *
 * Both operations mutate the state they are given; the caller persists it, and
 * the cloud sync turns the missing items into deletes.
 */
export class BookCleaner {
  static #FLAG = 'sample';

  /** Lists that SeedFactory fills with sample records. */
  static #SAMPLE_LISTS = Object.freeze(['transactions', 'budgets', 'accounts']);

  /** Lists that hold the user's entries; a reset empties all of them. */
  static #ENTRY_LISTS = Object.freeze([
    'transactions', 'accounts', 'budgets', 'debts', 'regularItems', 'accountGroups',
  ]);

  /**
   * Mark a record as sample data (used by SeedFactory).
   * @template T
   * @param {T} record
   * @returns {T}
   */
  static markSample(record) {
    return { ...record, [BookCleaner.#FLAG]: true };
  }

  /** @param {object} record */
  static isSample(record) {
    return record?.[BookCleaner.#FLAG] === true;
  }

  /** Whether the book still holds any sample record. */
  static hasSample(state) {
    return BookCleaner.#SAMPLE_LISTS.some((list) => BookCleaner.#list(state, list).some(BookCleaner.isSample));
  }

  /**
   * Remove every sample transaction and budget, and each sample account that
   * holds no entry of the user's own (an account the user has started using
   * is kept, so none of their transactions is orphaned).
   * @returns {{transactions:number, budgets:number, accounts:number}} counts removed
   */
  static removeSample(state) {
    const removed = {
      transactions: BookCleaner.#drop(state, 'transactions', BookCleaner.isSample),
      budgets:      BookCleaner.#drop(state, 'budgets', BookCleaner.isSample),
      accounts:     0,
    };
    const inUse = new Set(BookCleaner.#list(state, 'transactions').map((t) => t.accountId));
    removed.accounts = BookCleaner.#drop(state, 'accounts', (a) => BookCleaner.isSample(a) && !inUse.has(a.id));
    BookCleaner.#clearDanglingDefaults(state);
    return removed;
  }

  /**
   * Delete every entry: transactions, accounts, budgets, debts, regular items
   * and account groups, plus the payee → category suggestions learned from
   * them. Categories, settings and family sharing are kept.
   * @returns {number} how many records were removed
   */
  static wipe(state) {
    let removed = 0;
    for (const list of BookCleaner.#ENTRY_LISTS) {
      removed += BookCleaner.#list(state, list).length;
      state[list] = [];
    }
    state.merchantCategories = {};
    BookCleaner.#clearDanglingDefaults(state);
    return removed;
  }

  static #list(state, key) {
    return Array.isArray(state?.[key]) ? state[key] : [];
  }

  /** Remove the items matching `predicate`; returns how many were removed. */
  static #drop(state, key, predicate) {
    const before = BookCleaner.#list(state, key);
    const kept = before.filter((item) => !predicate(item));
    if (kept.length !== before.length) state[key] = kept;
    return before.length - kept.length;
  }

  /** The default account must not point at an account that no longer exists. */
  static #clearDanglingDefaults(state) {
    const user = state?.user;
    if (!user?.defaultAccountId) return;
    const exists = BookCleaner.#list(state, 'accounts').some((a) => a.id === user.defaultAccountId);
    if (!exists) user.defaultAccountId = '';
  }
}
