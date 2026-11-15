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

  /** Lists that SeedFactory (SampleBook) fills with sample records. */
  static #SAMPLE_LISTS = Object.freeze([
    'transactions', 'budgets', 'accounts', 'debts', 'regularItems', 'holdings', 'claims', 'habits', 'accountGroups', 'categories',
  ]);

  /** Sample lists removed outright (accounts, groups and categories follow their own rules). */
  static #PLAIN_LISTS = Object.freeze(['transactions', 'budgets', 'debts', 'regularItems', 'holdings', 'claims', 'habits']);

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
   * Remove every sample record — entries, budgets, debts, regulars,
   * investments, claims and habits — plus each sample account, group and
   * category that nothing of the user's own still uses (so none of their
   * entries is orphaned). Payee suggestions pointing at a removed category go too.
   * @returns {Record<string, number>} counts removed per list
   */
  static removeSample(state) {
    const removed = {};
    for (const list of BookCleaner.#PLAIN_LISTS) removed[list] = BookCleaner.#drop(state, list, BookCleaner.isSample);

    const txs = BookCleaner.#list(state, 'transactions');
    const accountsInUse = new Set([
      ...txs.map((t) => t.accountId),
      ...BookCleaner.#list(state, 'regularItems').map((i) => i.accountId),
      ...BookCleaner.#list(state, 'holdings').map((h) => h.accountId),
    ]);
    removed.accounts = BookCleaner.#drop(state, 'accounts', (a) => BookCleaner.isSample(a) && !accountsInUse.has(a.id));

    const groupsInUse = new Set(BookCleaner.#list(state, 'accounts').map((a) => a.groupId).filter(Boolean));
    removed.accountGroups = BookCleaner.#drop(state, 'accountGroups', (g) => BookCleaner.isSample(g) && !groupsInUse.has(g.id));

    const catsInUse = new Set([
      ...txs.flatMap((t) => [t.categoryId, ...(Array.isArray(t.splits) ? t.splits.map((x) => x.categoryId) : [])]),
      ...BookCleaner.#list(state, 'budgets').flatMap((b) => [b.categoryId, ...(b.categoryIds || [])]),
      ...BookCleaner.#list(state, 'regularItems').map((i) => i.categoryId),
      ...BookCleaner.#list(state, 'habits').flatMap((h) => h.categoryIds || []),
      ...BookCleaner.#list(state, 'categories').filter((c) => !BookCleaner.isSample(c)).map((c) => c.parentId),
    ].filter(Boolean));
    removed.categories = BookCleaner.#drop(state, 'categories', (c) => BookCleaner.isSample(c) && !catsInUse.has(c.id));

    const cats = new Set(BookCleaner.#list(state, 'categories').map((c) => c.id));
    if (state.merchantCategories && typeof state.merchantCategories === 'object') {
      for (const [k, id] of Object.entries(state.merchantCategories)) if (!cats.has(id)) delete state.merchantCategories[k];
    }
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
