/**
 * BaseReport — what every report shares: the filtered entries, the title,
 * the subtitle describing the period and filters, and the file name.
 * Subclasses lay the entries out as a ReportTable.
 */
import { HijriCalendarService } from '../../services/HijriCalendarService.js';

export class BaseReport {
  /** @type {import('../LedgerEntries.js').LedgerEntries} */ ledger;
  /** @type {import('../ExportFilter.js').ExportFilter} */   filter;
  /** @type {import('../ExportFormat.js').ExportFormat} */   format;
  state;
  today;
  hijri;

  constructor({ ledger, filter, format, state, today = new Date(), hijri = new HijriCalendarService() }) {
    this.ledger = ledger;
    this.filter = filter;
    this.format = format;
    this.state = state;
    this.today = today;
    this.hijri = hijri;
  }

  get home() {
    return this.ledger.homeCurrency;
  }

  /** @returns {import('../ReportTable.js').ReportTable} */
  build() {
    throw new Error('build() not implemented');
  }

  /** The entries this report covers. */
  entries() {
    const match = this.filter.matcher(this.state.categories || [], this.today);
    return this.ledger.all().filter(match);
  }

  title(fallback) {
    return this.format.title.trim() || fallback;
  }

  /** "1 Nov 2026 – 14 Nov 2026 · Accounts: BOI, Cash · Types: Expense". */
  subtitle() {
    const { from, to } = this.filter.range(this.today);
    const d = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const period = from && to ? `${d(from)} – ${d(to)}` : from ? `From ${d(from)}` : to ? `Until ${d(to)}` : 'All time';
    const names = (ids, find) => {
      const list = ids.map(find).filter(Boolean);
      return list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3} more` : list.join(', ');
    };
    const parts = [period];
    const f = this.filter;
    if (f.accountIds.length) parts.push(`Accounts: ${names(f.accountIds, (id) => this.ledger.account(id)?.name)}`);
    if (f.categoryIds.length) parts.push(`Categories: ${names(f.categoryIds, (id) => this.ledger.categoryPath(id))}`);
    if (f.types.length) parts.push(`Types: ${f.types.map((t) => t[0].toUpperCase() + t.slice(1)).join(', ')}`);
    if (f.paymentTypes.length) parts.push(`Payment: ${f.paymentTypes.join(', ')}`);
    if (f.search.trim()) parts.push(`Search: “${f.search.trim()}”`);
    return parts.join(' · ');
  }

  /** "pocket-transactions-2026-11-01-to-2026-11-14". */
  fileStem(slug) {
    const { from, to } = this.filter.range(this.today);
    const span = from || to ? `-${from || 'start'}-to-${to || 'today'}` : '-all-time';
    return `pocket-${slug}${span}`;
  }

  /** Month label and sort key for an entry, in the format's calendar. */
  monthOf(e) {
    if (this.format.calendar === 'hijri' && e.hijri?.year) {
      const name = this.hijri.monthsLong[e.hijri.month] || '';
      return { key: `${String(e.hijri.year).padStart(4, '0')}-${String(e.hijri.month).padStart(2, '0')}`, label: `${name} ${e.hijri.year}` };
    }
    const [y, m] = e.date.split('-').map(Number);
    return { key: e.date.slice(0, 7), label: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
  }

  /** A money column in the home currency. */
  money(key, label, extra = {}) {
    return { key, label, kind: 'money', align: 'right', weight: 1.1, currency: this.home, ...extra };
  }

  static sum(rows, key) {
    return rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);
  }
}
