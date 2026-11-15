/**
 * HabitService — small repeated spending followed across all entries, however
 * they were added (app, shortcut, Telegram, receipt scan).
 *
 * A habit is { id, name, icon, color, words[], categoryIds[], itemIds[],
 * limitCount?, limitAmount? (minor, home currency) }. An expense counts when
 * it was logged from one of its shortcuts (regularItemId), is in one of its
 * categories, or its payee / note / description contains one of its words.
 *
 * Habits are kept in state.habits. Every shortcut is also a habit by itself
 * (matching that shortcut and its name) until a saved habit takes it over, so
 * the old per-item totals carry on without setting anything up.
 */
export class HabitService {
  static ICONS = Object.freeze(['coffee', 'utensils', 'bus', 'car', 'cigarette', 'shopping-bag', 'pizza', 'beer', 'gamepad-2', 'film', 'zap', 'tag']);
  static COLORS = Object.freeze(['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#06b6d4', '#6366f1']);

  /** @type {(minor: number, from: string, to: string) => number} */ #convert;

  /** @param {{convert: (minor: number, from: string, to: string) => number}} deps */
  constructor({ convert }) {
    this.#convert = convert;
  }

  /** Saved habits plus one for each shortcut no saved habit covers. */
  all(state) {
    const saved = (Array.isArray(state.habits) ? state.habits : []).filter((h) => h && h.id && h.name);
    const covered = new Set(saved.flatMap((h) => h.itemIds || []));
    const fromShortcuts = (state.regularItems || [])
      .filter((i) => i.payLater !== true && !covered.has(i.id))
      .map((i) => ({ id: `item:${i.id}`, name: i.name, icon: i.icon || 'zap', color: i.color || '#6366f1', words: [i.name], categoryIds: [], itemIds: [i.id], implicit: true }));
    return [...saved, ...fromShortcuts];
  }

  /** Does this entry count towards the habit? */
  static matches(h, t) {
    if (!t || t.type !== 'expense') return false;
    if (t.regularItemId && (h.itemIds || []).includes(t.regularItemId)) return true;
    if (t.categoryId && (h.categoryIds || []).includes(t.categoryId)) return true;
    const text = ` ${[t.payee, t.note, t.description].filter(Boolean).join(' ').toLowerCase()} `;
    return (h.words || []).some((w) => {
      const word = String(w || '').trim().toLowerCase();
      if (word.length < 2) return false;
      const re = new RegExp(`(^|[^\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}\\p{N}]|$)`, 'u');
      return re.test(text);
    });
  }

  /** The habit's entries between two days (inclusive). */
  entries(h, state, from, to) {
    return (state.transactions || []).filter((t) => t.date >= from && t.date <= to && HabitService.matches(h, t));
  }

  /**
   * One month of a habit (the month holding `today`), compared with the one
   * before, with six months of trend, the days it happened, the weekdays,
   * and the yearly pace (last 90 days × 365/90).
   */
  stats(h, state, today, home) {
    const month = today.slice(0, 7);
    const start = `${month}-01`;
    const prevStart = HabitService.#monthStart(start, -1);
    const prevEnd = HabitService.#addDays(start, -1);
    const sum = (list) => list.reduce((s, t) => s + this.#convert(t.amount, t.currency, home), 0);
    const now = this.entries(h, state, start, today);
    // compare with the same part of last month (1st to the same day), so it's fair mid-month
    const dayOfMonth = Number(today.slice(8, 10));
    const prevSameDay = HabitService.#addDays(prevStart, Math.min(dayOfMonth, HabitService.#daysIn(prevStart)) - 1);
    const prevPart = this.entries(h, state, prevStart, prevSameDay);
    const prevAll = this.entries(h, state, prevStart, prevEnd);
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const s = HabitService.#monthStart(start, -i);
      const e = i === 0 ? today : HabitService.#addDays(HabitService.#monthStart(start, -i + 1), -1);
      const list = this.entries(h, state, s, e);
      trend.push({ month: s.slice(0, 7), count: list.length, amount: sum(list) });
    }
    const last90 = this.entries(h, state, HabitService.#addDays(today, -89), today);
    const weekdays = [0, 0, 0, 0, 0, 0, 0];
    for (const t of this.entries(h, state, HabitService.#addDays(today, -89), today)) weekdays[new Date(`${t.date}T00:00:00Z`).getUTCDay()]++;
    const amount = sum(now), prev = sum(prevPart);
    return {
      count: now.length, amount, average: now.length ? Math.round(amount / now.length) : 0,
      prevCount: prevPart.length, prevAmount: prev, prevMonthCount: prevAll.length, prevMonthAmount: sum(prevAll),
      change: prev > 0 ? Math.round(((amount - prev) / prev) * 100) : null,
      days: [...new Set(now.map((t) => t.date))].sort(),
      trend, weekdays,
      yearly: Math.round(sum(last90) * 365 / 90),
      limit: this.#limit(h, now.length, amount),
    };
  }

  /** null, or { state: 'ok'|'near'|'over', countLeft, amountLeft, text }. */
  #limit(h, count, amount) {
    const lc = Number(h.limitCount) || 0, la = Number(h.limitAmount) || 0;
    if (!lc && !la) return null;
    const countUse = lc ? count / lc : 0, amountUse = la ? amount / la : 0;
    const use = Math.max(countUse, amountUse);
    return {
      state: use > 1 ? 'over' : use >= 0.8 ? 'near' : 'ok',
      countLeft: lc ? lc - count : null,
      amountLeft: la ? la - amount : null,
      use,
    };
  }

  /**
   * After an entry is saved: a short note for each habit with a limit that
   * this entry brings near or over its limit, e.g. "7th Swiggy this month · 1 left".
   * @returns {string|null}
   */
  noteFor(t, state, today, home, money) {
    for (const h of this.all(state)) {
      if (!(Number(h.limitCount) || Number(h.limitAmount)) || !HabitService.matches(h, t)) continue;
      const st = this.stats(h, state, today, home);
      if (!st.limit || st.limit.state === 'ok') continue;
      const nth = HabitService.ordinal(st.count);
      const left = st.limit.countLeft != null
        ? (st.limit.countLeft > 0 ? `${st.limit.countLeft} left` : st.limit.countLeft === 0 ? 'that\'s your limit' : `${-st.limit.countLeft} over your limit`)
        : (st.limit.amountLeft > 0 ? `${money(st.limit.amountLeft)} left` : `${money(-st.limit.amountLeft)} over your limit`);
      return `${nth} ${h.name} this month · ${left}`;
    }
    return null;
  }

  /**
   * Payees logged often (5+ times in 60 days) that no habit covers: suggestions.
   * @returns {{payee: string, count: number, amount: number}[]}
   */
  suggestions(state, today, home) {
    const since = HabitService.#addDays(today, -59);
    const habits = this.all(state);
    const dismissed = new Set((state.user?.dismissedHabitSuggestions || []).map((s) => String(s).toLowerCase()));
    const groups = new Map();
    for (const t of state.transactions || []) {
      if (t.type !== 'expense' || !t.payee || t.date < since || t.date > today || t.recurring || t.recurringSourceId) continue;
      if (habits.some((h) => HabitService.matches(h, t))) continue;
      const key = t.payee.trim().toLowerCase();
      if (!key || dismissed.has(key)) continue;
      const g = groups.get(key) || { payee: t.payee.trim(), count: 0, amount: 0 };
      g.count++; g.amount += this.#convert(t.amount, t.currency, home);
      groups.set(key, g);
    }
    return [...groups.values()].filter((g) => g.count >= 5).sort((a, b) => b.count - a.count).slice(0, 3);
  }

  static ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
  }

  static #addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  static #monthStart(iso, deltaMonths) {
    const [y, m] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1 + deltaMonths, 1)).toISOString().slice(0, 10);
  }

  static #daysIn(iso) {
    const [y, m] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
}
