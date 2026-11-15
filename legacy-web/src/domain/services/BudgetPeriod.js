/**
 * BudgetPeriod — the window of days a budget covers right now.
 *
 * Kinds (budget.period):
 *   gregorian  the calendar month (default, and for anything unknown)
 *   hijri      the Hijri month (today's Hijri day decides where it starts)
 *   week       Monday to Sunday
 *   year       1 January to 31 December
 *   range      fixed dates: budget.startDate … budget.endDate
 *
 * Gives the window as YYYY-MM-DD dates, where today sits in it, the window
 * before it (for rollover) and a short label. Hijri membership of an entry is
 * still decided by BudgetService (it compares frozen Hijri snapshots); the
 * window here is what pace and "still to come" use.
 *
 * Pure: no Store, no DOM.
 */
import { DateService }          from './DateService.js';
import { HijriCalendarService } from './HijriCalendarService.js';

export class BudgetPeriod {
  static KINDS = Object.freeze(['gregorian', 'hijri', 'week', 'year', 'range']);
  static #MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  static #LONG   = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
                                  'September', 'October', 'November', 'December']);

  /** @type {string} */ #kind;
  /** @type {string} */ #today;
  /** @type {string} */ #from;
  /** @type {string} */ #to;
  /** @type {HijriCalendarService} */ #hijri;
  /** @type {{year:number, month:number}|null} */ #hijriMonth = null;

  /**
   * @param {object} budget
   * @param {{today?: string, hijri?: HijriCalendarService}} [opts]
   */
  constructor(budget, { today = DateService.todayIso(), hijri = null } = {}) {
    this.#kind  = BudgetPeriod.normalize(budget?.period, budget);
    this.#today = today;
    this.#hijri = hijri;
    [this.#from, this.#to] = this.#window(budget, today);
  }

  /**
   * A known kind, else 'gregorian'. A range without valid dates (start ≤ end)
   * also falls back, so a half-filled budget still works as a month.
   * @param {string} kind
   * @param {object} [budget]
   */
  static normalize(kind, budget = null) {
    if (!BudgetPeriod.KINDS.includes(kind)) return 'gregorian';
    if (kind === 'range' && budget && !BudgetPeriod.validRange(budget.startDate, budget.endDate)) return 'gregorian';
    return kind;
  }

  /** @param {string} from @param {string} to */
  static validRange(from, to) {
    return BudgetPeriod.isIso(from) && BudgetPeriod.isIso(to) && from <= to;
  }

  static isIso(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

  // ── The window ──────────────────────────────────────────────────────

  get kind()  { return this.#kind; }
  get from()  { return this.#from; }
  get to()    { return this.#to; }
  get today() { return this.#today; }

  /** Days in the window. */
  get days() { return BudgetPeriod.#diff(this.#from, this.#to) + 1; }

  /** 'upcoming' (dated budget not started) | 'active' | 'ended' (dated budget over). */
  get status() {
    if (this.#today < this.#from) return 'upcoming';
    if (this.#today > this.#to)   return 'ended';
    return 'active';
  }

  /** Days gone, today included (0 before it starts, all of them once it ends). */
  get elapsed() {
    if (this.status === 'upcoming') return 0;
    if (this.status === 'ended') return this.days;
    return BudgetPeriod.#diff(this.#from, this.#today) + 1;
  }

  /** Days still to go, today included. */
  get remaining() { return this.days - this.elapsed + (this.status === 'active' ? 1 : 0); }

  /** Days left after today — the count the cards have always shown. */
  get daysAfterToday() { return this.status === 'active' ? BudgetPeriod.#diff(this.#today, this.#to) : 0; }

  /** Rollover makes sense only for a window that repeats. */
  get repeats() { return this.#kind !== 'range'; }

  /** @param {string} iso */
  contains(iso) { return BudgetPeriod.isIso(iso) && iso >= this.#from && iso <= this.#to; }

  /**
   * The window just before this one (null for a range). For Hijri it is the
   * day-count of the month before, ending the day before this one starts.
   * @returns {{from:string, to:string}|null}
   */
  previous() {
    switch (this.#kind) {
      case 'range': return null;
      case 'week':  return { from: BudgetPeriod.addDays(this.#from, -7), to: BudgetPeriod.addDays(this.#from, -1) };
      case 'year': {
        const y = Number(this.#from.slice(0, 4)) - 1;
        return { from: `${y}-01-01`, to: `${y}-12-31` };
      }
      case 'hijri': {
        const { year, month } = this.#hijriMonth;
        const py = month === 0 ? year - 1 : year, pm = month === 0 ? 11 : month - 1;
        const len = this.#hijriSvc().daysInMonth(py, pm);
        return { from: BudgetPeriod.addDays(this.#from, -len), to: BudgetPeriod.addDays(this.#from, -1) };
      }
      default: {
        const [y, m] = this.#from.split('-').map(Number);
        const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
        return { from: BudgetPeriod.#ym(py, pm, 1), to: BudgetPeriod.#ym(py, pm, BudgetPeriod.#monthLen(py, pm)) };
      }
    }
  }

  // ── Words ───────────────────────────────────────────────────────────

  /** e.g. "November", "Jumada I 1448 H", "10–16 Nov", "2026", "1–10 Dec 2026" */
  get label() {
    switch (this.#kind) {
      case 'hijri': {
        const { year, month } = this.#hijriMonth;
        return `${this.#hijriSvc().monthsShort[month]} ${year} H`;
      }
      case 'week':  return BudgetPeriod.rangeLabel(this.#from, this.#to, false);
      case 'year':  return this.#from.slice(0, 4);
      case 'range': return BudgetPeriod.rangeLabel(this.#from, this.#to, true);
      default:      return BudgetPeriod.#LONG[Number(this.#from.slice(5, 7)) - 1];
    }
  }

  /** The word for one period, for "roll over to next …". */
  get unit() {
    return ({ week: 'week', year: 'year', range: 'period' })[this.#kind] || 'month';
  }

  /** Icon name for the kind. */
  get icon() {
    return ({ hijri: 'moon-star', week: 'calendar-days', year: 'calendar-range', range: 'calendar-clock' })[this.#kind] || 'calendar';
  }

  /** "1–10 Dec 2026", "28 Nov – 4 Dec", "30 Dec 2026 – 2 Jan 2027" */
  static rangeLabel(from, to, withYear) {
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    const M = BudgetPeriod.#MONTHS;
    const yr = (y) => (withYear ? ` ${y}` : '');
    if (fy !== ty) return `${fd} ${M[fm - 1]} ${fy} – ${td} ${M[tm - 1]} ${ty}`;
    if (fm !== tm) return `${fd} ${M[fm - 1]} – ${td} ${M[tm - 1]}${yr(ty)}`;
    if (fd === td) return `${fd} ${M[fm - 1]}${yr(ty)}`;
    return `${fd}–${td} ${M[tm - 1]}${yr(ty)}`;
  }

  /** "1 Dec" */
  static shortDate(iso) {
    const [, m, d] = iso.split('-').map(Number);
    return `${d} ${BudgetPeriod.#MONTHS[m - 1]}`;
  }

  // ── Date maths (calendar days, timezone-free) ───────────────────────

  static addDays(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  static #diff(a, b) {
    const t = (iso) => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((t(b) - t(a)) / 86_400_000);
  }

  static #ym(y, m, d) { return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
  static #monthLen(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  // ── Private ─────────────────────────────────────────────────────────

  #hijriSvc() { return this.#hijri || (this.#hijri = new HijriCalendarService()); }

  #window(budget, today) {
    switch (this.#kind) {
      case 'range': return [budget.startDate, budget.endDate];
      case 'week': {
        const [y, m, d] = today.split('-').map(Number);
        const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
        const from = BudgetPeriod.addDays(today, -back);
        return [from, BudgetPeriod.addDays(from, 6)];
      }
      case 'year': return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
      case 'hijri': {
        const h = this.#hijriSvc().toHijri(today);
        this.#hijriMonth = { year: h.year, month: h.month };
        const from = BudgetPeriod.addDays(today, -(h.day - 1));
        return [from, BudgetPeriod.addDays(from, this.#hijriSvc().daysInMonth(h.year, h.month) - 1)];
      }
      default: {
        const [y, m] = today.split('-').map(Number);
        return [BudgetPeriod.#ym(y, m, 1), BudgetPeriod.#ym(y, m, BudgetPeriod.#monthLen(y, m))];
      }
    }
  }
}
