/**
 * SuggestionService — spots entries that look like a regular and offers to
 * set them up, once, with "No thanks" remembered.
 *
 *   bills       the same payee paid about once a month (3+ months running,
 *               25–35 days apart) with no repeat set up: "make it a monthly
 *               bill?" — from its last payment, asking first when the amount
 *               changes.
 *   deliveries  the same payee on most days lately (8+ days of the last 14):
 *               "delivered daily? track it as a delivery and pay later."
 *
 * Habit suggestions live in HabitService, shortcut ones in ShortcutService.
 * Dismissals are kept in state.user.dismissedSuggestions as "<kind>:<payee>".
 */
export class SuggestionService {
  static BILL_MIN = 3;
  static BILL_GAP = Object.freeze([25, 35]);
  static BILL_LOOKBACK = 130;
  static DAILY_WINDOW = 14;
  static DAILY_MIN = 8;

  /**
   * @param {object} state
   * @param {string} today YYYY-MM-DD
   * @returns {{kind:'bill', payee:string, last:object, amount:number, changes:boolean, count:number}[]}
   */
  static bills(state, today) {
    const since = SuggestionService.#addDays(today, -SuggestionService.BILL_LOOKBACK);
    const repeating = SuggestionService.#repeatingPayees(state);
    const out = [];
    for (const [key, list] of SuggestionService.#byPayee(state, since, today)) {
      if (repeating.has(key) || SuggestionService.#dismissed(state, 'bill', key)) continue;
      const months = SuggestionService.#monthlyRun(list);
      if (months.length < SuggestionService.BILL_MIN) continue;
      const last = months[months.length - 1];
      // only while it's still going: the last one within ~5 weeks
      if (SuggestionService.#daysBetween(last.date, today) > SuggestionService.BILL_GAP[1] + 5) continue;
      out.push({
        kind: 'bill', payee: last.payee.trim(), last, amount: last.amount, count: months.length,
        changes: new Set(months.map((t) => t.amount)).size > 1,
      });
    }
    return out.sort((a, b) => b.count - a.count).slice(0, 2);
  }

  /**
   * @param {object} state
   * @param {string} today YYYY-MM-DD
   * @returns {{kind:'delivery', payee:string, amount:number, currency:string, accountId:string, categoryId:string|null, days:number}[]}
   */
  static deliveries(state, today) {
    const since = SuggestionService.#addDays(today, -(SuggestionService.DAILY_WINDOW - 1));
    const have = new Set((state.regularItems || []).filter((i) => i.payLater === true).map((i) => SuggestionService.#key(i.name)));
    const out = [];
    for (const [key, list] of SuggestionService.#byPayee(state, since, today)) {
      if (have.has(key) || SuggestionService.#dismissed(state, 'delivery', key)) continue;
      const days = new Set(list.map((t) => t.date)).size;
      if (days < SuggestionService.DAILY_MIN) continue;
      const last = list[list.length - 1];
      out.push({
        kind: 'delivery', payee: last.payee.trim(), days,
        amount: SuggestionService.#mode(list.map((t) => t.amount)),
        currency: SuggestionService.#mode(list.map((t) => t.currency)),
        accountId: SuggestionService.#mode(list.map((t) => t.accountId)),
        categoryId: SuggestionService.#mode(list.map((t) => t.categoryId).filter(Boolean)) ?? null,
      });
    }
    return out.sort((a, b) => b.days - a.days).slice(0, 2);
  }

  /** The dismissal key for a suggestion. */
  static dismissKey(kind, payee) {
    return `${kind}:${SuggestionService.#key(payee)}`;
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  /** Plain expenses (not repeats, not from shortcuts or vendor payments), by payee, oldest first. */
  static #byPayee(state, since, today) {
    const groups = new Map();
    for (const t of state.transactions || []) {
      if (t.type !== 'expense' || !t.payee || t.date < since || t.date > today) continue;
      if (t.recurring || t.recurringSourceId || t.regularItemId || t.settles || t.billOf) continue;
      const key = SuggestionService.#key(t.payee);
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(t);
    }
    for (const list of groups.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return groups;
  }

  /** Payees that already repeat (a template, or a copy of one). */
  static #repeatingPayees(state) {
    return new Set((state.transactions || [])
      .filter((t) => t.payee && (t.recurring || t.recurringSourceId))
      .map((t) => SuggestionService.#key(t.payee)));
  }

  /** The longest run ending at the latest entry where each is 25–35 days after the one before (one per month). */
  static #monthlyRun(list) {
    const [lo, hi] = SuggestionService.BILL_GAP;
    const run = [list[list.length - 1]];
    for (let i = list.length - 2; i >= 0; i--) {
      const gap = SuggestionService.#daysBetween(list[i].date, run[0].date);
      if (gap < lo) continue; // a second one in the same month: not a monthly bill pattern, but don't break the run
      if (gap > hi) break;
      run.unshift(list[i]);
    }
    return run;
  }

  static #dismissed(state, kind, key) {
    return (state.user?.dismissedSuggestions || []).includes(`${kind}:${key}`);
  }

  static #key(s) { return String(s || '').trim().toLowerCase(); }

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

  static #daysBetween(a, b) {
    return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  }

  static #addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
}
