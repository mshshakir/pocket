/**
 * BaseView — Abstract base class for all page views.
 *
 * Enforces the contract that every view must implement:
 *   render() → string (HTML)
 *   onAfterRender() → void  (called after innerHTML is set; used for charts)
 *
 * Provides shared helpers available to all subclasses:
 *   escapeHtml, emptyState, formatMoney, formatDate, hijriBadge, etc.
 *
 * Every view receives the same service dependencies via constructor injection
 * rather than accessing global singletons directly — this keeps views testable.
 */
import { Store }               from '../../core/Store.js';
import { Html }                from '../../core/Html.js';
import { CurrencyService }     from '../../domain/services/CurrencyService.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';

export class BaseView {
  /** @type {Store} */               #store;
  /** @type {CurrencyService} */     #fx;
  /** @type {HijriCalendarService} */ #hijri;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
    this.#hijri = new HijriCalendarService();
  }

  // ── Contract ─────────────────────────────────────────────────────────

  /**
   * Render the view to an HTML string.
   * Must be overridden by subclasses.
   * @returns {string}
   */
  render() {
    throw new Error(`${this.constructor.name} must implement render()`);
  }

  /**
   * Hook called after the rendered HTML has been injected into the DOM.
   * Override to draw charts, attach custom event listeners, etc.
   */
  onAfterRender() {}

  // ── Shared state accessors ───────────────────────────────────────────

  /**
   * State, scoped to the ACTIVE SPACE.
   *
   * This one getter re-points the entire view layer. In the home space it
   * returns the real state object unchanged; in a guest space it returns a
   * shallow projection whose `accounts`, `categories` and `transactions` come
   * from the owner's snapshot instead.
   *
   * Views must treat this as READ-ONLY — they always did, but it matters more
   * now: a write through the guest projection would land on an object the next
   * pull throws away. Anything that mutates goes through the services, which
   * deliberately keep reading the real `Store.getState()`.
   * @returns {object}
   */
  get state() {
    const raw = this.#store.getState();
    const space = window.__app?.spaces?.active?.();
    return space ? space.project() : raw;
  }

  /** The unscoped local book. For the rare view that genuinely needs both. */
  get localState() {
    return this.#store.getState();
  }

  /** @returns {import('../../domain/services/Space.js').Space|null} */
  get space() {
    return window.__app?.spaces?.active?.() ?? null;
  }

  /** @returns {boolean} true when viewing someone else's book */
  get inGuestSpace() {
    const s = this.space;
    return !!s && !s.isHome;
  }

  /**
   * How much of a budget is spent.
   *
   * At home, compute it. In a guest space, use the figure the OWNER computed
   * and published — recomputing there reads `Store.getState()`, i.e. the
   * MEMBER's own transactions measured against the OWNER's budget categories,
   * which is not a smaller number, it is a meaningless one.
   *
   * @param {object} budget
   * @param {() => number} compute  the local calculation, for the home space
   * @returns {number} minor units
   */
  spendFor(budget, compute) {
    if (this.inGuestSpace) return Number(budget?.spent) || 0;
    return compute();
  }

  /**
   * Totals convert to the OWNER's home currency inside their space — showing
   * their balances in the member's currency would misrepresent their book.
   */
  get homeCurrency() {
    return this.state.user.homeCurrency;
  }

  // ── Formatting helpers ───────────────────────────────────────────────

  /**
   * @param {number} minor
   * @param {string} currency
   * @returns {string}
   */
  formatMoney(minor, currency) {
    return this.#fx.formatMoney(minor, currency);
  }

  /**
   * @param {number} minor   source currency minor units
   * @param {string} from
   * @param {string} to
   * @returns {number}
   */
  convert(minor, from, to) {
    return this.#fx.convert(minor, from, to);
  }

  /** @param {number} minor @param {string} currency @returns {number} */
  fromMinor(minor, currency) {
    return this.#fx.fromMinor(minor, currency);
  }

  /** @param {number|string} amount @param {string} currency @returns {number} */
  toMinor(amount, currency) {
    return this.#fx.toMinor(amount, currency);
  }

  /**
   * Human-readable date label respecting user preferences.
   * @param {string} iso  YYYY-MM-DD
   * @returns {string}
   */
  dateLabel(iso) {
    const d    = new Date(iso + 'T12:00:00');
    const now  = new Date();
    const yest = new Date(now);
    yest.setDate(yest.getDate() - 1);

    let label;
    if (d.toDateString() === now.toDateString())  label = 'Today';
    else if (d.toDateString() === yest.toDateString()) label = 'Yesterday';
    else label = this.#formatDateUser(iso);

    if (this.state.user?.showHijri) {
      const h = this.#hijri.toHijri(iso);
      label  += ` · ${h.day} ${this.#hijri.monthsShort[h.month]}`;
    }
    return label;
  }

  /**
   * Hijri date + miqaat badge HTML for a Gregorian date.
   * @param {string} iso
   * @returns {string}
   */
  hijriBadge(iso) {
    if (!this.state.user?.showHijri) return '';
    const top   = this.#hijri.topMiqaat(this.#hijri.miqaatsForGregorian(iso));
    if (!top) return '';
    const color = top.p === 1 ? '#f59e0b' : top.p === 2 ? '#a855f7' : '#94a3b8';
    return `<span title="${this.escapeHtml(top.t)}" class="inline-flex items-center" style="color:${color}">
      <i data-lucide="moon-star" style="width:13px;height:13px"></i>
    </span>`;
  }

  /**
   * Escape HTML special characters — safe for text and quoted attribute values.
   * NOT safe for values interpolated into an inline event handler; use jsArg().
   * @param {string|any} s
   * @returns {string}
   */
  escapeHtml(s) {
    return Html.escape(s);
  }

  /**
   * Escape a value that lands inside a single-quoted JS string in an inline
   * handler, e.g. onclick="fn('${this.jsArg(id)}')".
   *
   * escapeHtml() is not sufficient here: the HTML parser decodes character
   * references in attribute values BEFORE the value becomes the handler body,
   * so an escaped &#39; turns back into a real quote and ends the string early.
   * @param {string|any} s
   * @returns {string}
   */
  jsArg(s) {
    return Html.js(s);
  }

  /**
   * Validate a CSS hex colour, falling back to a neutral grey. Use for any
   * colour that came from outside this device — notably family-share snapshots,
   * which are another user's data interpolated into a style attribute.
   * @param {string|any} c
   * @param {string} [fallback]
   * @returns {string}
   */
  safeColor(c, fallback = '#71717a') {
    return Html.color(c, fallback);
  }

  /**
   * Validate a Lucide icon slug, falling back to a safe default.
   * @param {string|any} name
   * @param {string} [fallback]
   * @returns {string}
   */
  safeIcon(name, fallback = 'circle') {
    return Html.icon(name, fallback);
  }

  /**
   * `step` for a money <input type="number">, derived from the currency's minor
   * unit. A hard-coded 0.01 makes the third decimal unreachable in KWD, BHD,
   * OMR, TND, JOD, IQD and LYD — the browser rejects 1.234 with a step mismatch
   * and refuses to submit — and needlessly allows fractions of a yen.
   * @param {string} currency
   * @returns {string} e.g. '1' (JPY), '0.01' (USD), '0.001' (KWD)
   */
  amountStep(currency) {
    return CurrencyService.stepFor(currency);
  }

  /**
   * Empty-state card HTML.
   * @param {string} title
   * @param {string} subtitle
   * @returns {string}
   */
  emptyState(title, subtitle) {
    return `
      <div class="text-center py-8">
        <div class="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 grid place-items-center mb-3">
          <i data-lucide="inbox"></i>
        </div>
        <div class="font-semibold">${this.escapeHtml(title)}</div>
        <div class="text-sm text-zinc-500 mt-1">${this.escapeHtml(subtitle)}</div>
      </div>`;
  }

  // ── Private helpers ──────────────────────────────────────────────────

  #formatDateUser(iso) {
    const fmt = this.state.user.dateFormat || 'auto';
    if (fmt === 'auto') {
      const d   = new Date(iso + 'T12:00:00');
      const now = new Date();
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day:   'numeric',
        year:  d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
      });
    }
    const [y, m, d] = iso.split('-');
    if (fmt === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
    if (fmt === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
    if (fmt === 'DD/MM/YYYY') return `${d}/${m}/${y}`;
    return iso;
  }
}
