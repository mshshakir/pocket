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

  get state() {
    return this.#store.getState();
  }

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
   * Escape HTML special characters.
   * @param {string|any} s
   * @returns {string}
   */
  escapeHtml(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
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
