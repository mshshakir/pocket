/**
 * ShortcutService — one-tap starts for things bought often.
 *
 *   shortcuts    regular items that aren't deliveries (coffee ₹20, bus ₹30):
 *                tapping one fills a new entry — amount, category, account,
 *                payee — and links it to the item (regularItemId), so the
 *                calendar and Habits count it.
 *   suggestions  payees logged often lately (4+ times in 60 days) with no
 *                shortcut yet, with their usual amount and category: offered
 *                in a lighter style, and can be saved as shortcuts.
 */
export class ShortcutService {
  static SUGGEST_DAYS = 60;
  static SUGGEST_MIN = 4;
  static SUGGEST_MAX = 3;

  /** Shortcuts of this book (regular items that aren't deliveries, on your own accounts). */
  static list(state) {
    return (state.regularItems || []).filter((i) => i.payLater !== true && !i.sharedOwnerId);
  }

  /**
   * Payees logged often lately without a shortcut: [{ payee, amount, currency, categoryId, accountId, count }].
   * @param {object} state
   * @param {string} today YYYY-MM-DD
   */
  static suggestions(state, today) {
    const since = ShortcutService.#addDays(today, -ShortcutService.SUGGEST_DAYS);
    const have = new Set(ShortcutService.list(state).map((i) => String(i.name).trim().toLowerCase()));
    const groups = new Map();
    for (const t of state.transactions || []) {
      if (t.type !== 'expense' || !t.payee || t.date < since || t.date > today || t.recurringSourceId || t.recurring || t.regularItemId) continue;
      const key = String(t.payee).trim().toLowerCase();
      if (!key || have.has(key)) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    return [...groups.values()]
      .filter((list) => list.length >= ShortcutService.SUGGEST_MIN)
      .map((list) => ({
        payee: list[list.length - 1].payee.trim(),
        amount: ShortcutService.#mode(list.map((t) => t.amount)),
        currency: ShortcutService.#mode(list.map((t) => t.currency)),
        categoryId: ShortcutService.#mode(list.map((t) => t.categoryId).filter(Boolean)) ?? null,
        accountId: ShortcutService.#mode(list.map((t) => t.accountId)),
        count: list.length,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, ShortcutService.SUGGEST_MAX);
  }

  /** What a shortcut fills into a new entry. */
  static prefill(item, accounts) {
    const own = (accounts || []).some((a) => a.id === item.accountId);
    return {
      payee: item.name,
      amount: item.defaultAmount || 0,
      currency: item.currency,
      categoryId: item.categoryId || '',
      ...(own ? { accountId: item.accountId } : {}),
      regularItemId: item.id,
    };
  }

  /** The most common value (ties: the latest). */
  static #mode(values) {
    const counts = new Map();
    let best = null, bestN = 0;
    for (const v of values) {
      const n = (counts.get(v) || 0) + 1;
      counts.set(v, n);
      if (n >= bestN) { best = v; bestN = n; }
    }
    return best;
  }

  static #addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
}
