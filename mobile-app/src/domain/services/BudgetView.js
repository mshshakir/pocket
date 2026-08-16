/**
 * BudgetView — the numbers a budget screen draws, from whichever book it is on.
 *
 * `BudgetService` reads the local store by construction: `currentSpend` scans
 * `store.getState().transactions` and expands the budget's categories through
 * the local `CategoryService`. That is correct for the member's own budgets and
 * quietly wrong for a budget shown inside a guest space, where the budget and
 * its category ids belong to the owner and the transactions being scanned
 * belong to the member. In practice the owner's category ids resolved to
 * nothing locally, so every shared budget rendered a spend of exactly **0** —
 * a number that looks like data rather than like an error, on a screen whose
 * whole job is to say how much is left.
 *
 * The owner already computes the right figure: `#sharedBudgets` runs
 * `currentSpend` against their own ledger at push time and ships it as
 * `budget.spent`. Nothing read it. This class is what reads it.
 *
 * One interface, two implementations, chosen once by `BudgetView.for()` — so
 * the screen asks `view.spend(b)` and never learns which book answered.
 */

/** Shared shape. Not exported: callers go through `BudgetView.for`. */
class BudgetViewBase {
  /** @returns {boolean} true when the figures are the owner's, not yours */
  get isGuest() { return false; }

  /**
   * Whether `limit()` can account for rollover.
   *
   * A rollover limit needs the PREVIOUS period's spend, which needs
   * transactions the member was never given. Rather than silently presenting a
   * flat limit as a rollover one, the screen asks and says so.
   * @returns {boolean}
   */
  get limitIsExact() { return true; }
}

/** The member's own budgets — straight through to the service. */
class LocalBudgetView extends BudgetViewBase {
  #svc; #cats;

  constructor({ budgets, categories }) {
    super();
    this.#svc  = budgets;
    this.#cats = categories;
  }

  spend(b)        { return this.#svc.currentSpend(b); }
  limit(b)        { return this.#svc.effectiveLimit(b).limit; }
  rollover(b)     { return this.#svc.effectiveLimit(b); }
  categoryIds(b)  { return this.#svc.targetCategoryIds(b); }
  splitByCategory(b) { return this.#svc.spendByCategory(b); }
  transactions(b) { return this.#svc.periodTransactions(b); }
  categoryName(id) { return this.#cats.fullName(id); }
  category(id)     { return this.#cats.find(id); }
  hasChildren(id)  { return this.#cats.hasChildren(id); }
}

/**
 * A budget inside someone else's space.
 *
 * Everything here comes out of the snapshot. Nothing is recomputed against the
 * local store, because the local store is a different person's money.
 */
class GuestBudgetView extends BudgetViewBase {
  #state; #fx;

  /** @param {object} state a Space projection @param {object} fx CurrencyService */
  constructor({ state, fx }) {
    super();
    this.#state = state;
    this.#fx    = fx;
  }

  get isGuest() { return true; }
  get limitIsExact() { return false; }

  /** The figure the OWNER computed over their whole ledger at push time. */
  spend(b) { return b?.spent || 0; }

  /** Face value: rollover needs periods the member does not hold. */
  limit(b) { return b?.amount || 0; }

  rollover(b) { return { limit: this.limit(b), carried: 0 }; }

  categoryIds(b) {
    const ids = Array.isArray(b?.categoryIds) && b.categoryIds.length
      ? b.categoryIds
      : (b?.categoryId ? [b.categoryId] : []);
    // Descendants too, matching BudgetService — a budget on "Food" covers
    // "Food › Coffee", and the snapshot carries the owner's whole tree.
    const out = [];
    const walk = (id) => {
      if (out.includes(id)) return;
      out.push(id);
      for (const c of this.#state.categories || []) if (c.parentId === id) walk(c.id);
    };
    ids.forEach(walk);
    return out;
  }

  /**
   * Per-category spend for a multi-category budget.
   *
   * Computed from the snapshot's transactions, which is a SUBSET of the
   * owner's: only the accounts shared with this member. The parts will not sum
   * to `spend()` above, and that is not a bug to be smoothed over — the total
   * is the owner's real figure and the breakdown is what the member can see.
   * The screen labels it.
   */
  splitByCategory(b) {
    const ids = new Set(this.categoryIds(b));
    const home = this.#state.user?.homeCurrency || 'USD';
    const totals = new Map();
    for (const t of this.transactions(b)) {
      const legs = Array.isArray(t.splits) && t.splits.length
        ? t.splits.map((s) => [s.categoryId, s.amount])
        : [[t.categoryId, t.amount]];
      for (const [cid, amt] of legs) {
        if (!ids.has(cid)) continue;
        totals.set(cid, (totals.get(cid) || 0) + this.#fx.convert(amt || 0, t.currency, home));
      }
    }
    return [...totals.entries()]
      .map(([categoryId, amount]) => ({ categoryId, name: this.categoryName(categoryId), amount }))
      .sort((a, b2) => b2.amount - a.amount);
  }

  /** Transactions in the current period, from the shared accounts only. */
  transactions(b) {
    const ids = new Set(this.categoryIds(b));
    const from = this.#periodStart(b);
    return (this.#state.transactions || []).filter((t) => {
      if (t.type !== 'expense' || !t.date || t.date < from) return false;
      if (ids.has(t.categoryId)) return true;
      return Array.isArray(t.splits) && t.splits.some((s) => ids.has(s.categoryId));
    });
  }

  categoryName(id) {
    const byId = new Map((this.#state.categories || []).map((c) => [c.id, c]));
    const parts = [];
    let c = byId.get(id);
    let hops = 0;
    while (c && hops++ < 8) { parts.unshift(c.name); c = c.parentId ? byId.get(c.parentId) : null; }
    return parts.join(' › ');
  }

  category(id) { return (this.#state.categories || []).find((c) => c.id === id) || null; }

  hasChildren(id) { return (this.#state.categories || []).some((c) => c.parentId === id); }

  /**
   * Start of the budget's current period.
   *
   * Gregorian only. A Hijri budget needs the owner's `hijriOffset`, which the
   * snapshot does not carry, and guessing it would shift the window by up to a
   * day in either direction — so those fall back to the month, and the total
   * shown above the list stays the owner's exact figure regardless.
   * @returns {string} ISO date
   */
  #periodStart(b) {
    const now = new Date();
    if (b?.period === 'weekly') {
      const d = new Date(now);
      d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      return d.toISOString().slice(0, 10);
    }
    if (b?.period === 'yearly') return `${now.getFullYear()}-01-01`;
    return `${now.toISOString().slice(0, 7)}-01`;
  }
}

/** Factory — the only thing screens call. */
export class BudgetView {
  /**
   * @param {object} deps
   * @param {boolean} deps.inGuestSpace
   * @param {object} deps.state     the projection currently on screen
   * @param {object} deps.services
   * @returns {LocalBudgetView|GuestBudgetView}
   */
  static for({ inGuestSpace, state, services }) {
    return inGuestSpace
      ? new GuestBudgetView({ state, fx: services.fx })
      : new LocalBudgetView({ budgets: services.budgets, categories: services.categories });
  }
}
