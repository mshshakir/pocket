/**
 * CalendarView — "Regulars": everything that repeats, in three tabs:
 *   • bills       — repeating entries (rent, subscriptions; "ask me" bills like
 *                   electricity): next date, amount or last time's, Pay / Edit / Stop
 *   • deliveries  — pay-later items (milk, newspaper): what's owed to each
 *                   vendor (Pay, Bill, Undo), and the items with Pause / Edit
 *   • grid        — the calendar: deliveries and logged items per day
 * Quick items live as shortcuts in the Add form; their spending is in
 * Reports → Habits.
 *
 * Supports Gregorian, Hijri, and "both" display modes.
 */
import { RepeatPause } from '../../domain/services/RepeatPause.js';
import { BillService } from '../../domain/services/BillService.js';
import { BaseView }          from './BaseView.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';
import { DateService }          from '../../domain/services/DateService.js';
import { DeliveryPlan }         from '../../domain/services/DeliveryPlan.js';
import { Html }                 from '../../core/Html.js';
import { SuggestionService }    from '../../domain/services/SuggestionService.js';

export class CalendarView extends BaseView {
  /** @type {HijriCalendarService} */  #hijri;
  /** @type {string|null} */           #focus = null;   // ISO date of focused month
  /** @type {string} */                #tab   = 'grid';  // 'grid' = Calendar (opens first) | 'bills' | 'deliveries' | 'shortcuts'

  constructor() {
    super();
    this.#hijri = new HijriCalendarService();
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** Old tab names still work: dues/items → deliveries, summary → calendar. */
  static #DELIVERY_WORD = Object.freeze({ paid: 'delivered and paid', owed: 'delivered, not paid yet', unconfirmed: 'not confirmed yet', skipped: 'not delivered' });
  static #BILL_WORD = Object.freeze({ paid: 'paid', overdue: 'not paid yet', due: 'due today', upcoming: 'coming up', skipped: 'skipped', paused: 'paused' });

  setTab(tab)   { this.#tab = ({ dues: 'deliveries', items: 'deliveries', summary: 'grid' })[tab] ?? tab; }
  shiftMonth(delta) {
    this.#ensureFocus();
    const mode = this.#calMode();
    if (mode === 'hijri') {
      const h = this.#hijri.toHijri(this.#focus);
      let m = h.month + delta, y = h.year;
      while (m < 0)  { m += 12; y -= 1; }
      while (m > 11) { m -= 12; y += 1; }
      this.#focus = this.#isoDate(this.#hijri.toGregorian(y, m, 1));
    } else {
      const d = new Date(this.#focus + 'T12:00:00');
      d.setDate(1);
      d.setMonth(d.getMonth() + delta);
      this.#focus = this.#isoDate(d);
    }
  }
  resetFocus() { this.#focus = null; }

  // ── BaseView contract ─────────────────────────────────────────────────

  render() {
    this.#ensureFocus();
    const state = this.state;
    const items = state.regularItems || [];
    const mode  = this.#calMode();

    return `
      <div class="flex items-center justify-between mb-4 gap-2">
        <div class="min-w-0">
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Regulars${this.helpButton('calendar')}</h1>${this.helpHint('calendar')}
          <div class="text-xs text-zinc-500 mt-0.5">Bills, deliveries and what you buy often</div>
        </div>
        <div class="flex gap-2 flex-shrink-0">
          <div class="${this.#tab === 'grid' ? 'hidden md:flex' : 'hidden'} card p-1 gap-0.5 text-xs">
            ${[['gregorian','Greg'],['both','Both'],['hijri','Hijri']].map(([k,l]) =>
              `<button onclick="window.__app.setCalendarMode('${k}')"
                       class="px-2 py-1 rounded ${mode===k?'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900':'text-zinc-500'}">${l}</button>`
            ).join('')}
          </div>
          ${this.inGuestSpace ? '' : `
          <button class="btn btn-primary" onclick="window.__app.openModal('addRegular')">
            <i data-lucide="plus"></i> <span class="hidden sm:inline">Add</span>
          </button>`}
        </div>
      </div>

      <div class="${this.#tab === 'grid' ? 'md:hidden flex' : 'hidden'} gap-1 mb-3 card p-1 text-xs">
        ${[['gregorian','Gregorian only'],['both','Show both'],['hijri','Hijri only']].map(([k,l]) =>
          `<button onclick="window.__app.setCalendarMode('${k}')"
                   class="flex-1 px-2 py-1.5 rounded ${mode===k?'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900':'text-zinc-500'}">${l}</button>`
        ).join('')}
      </div>

      <div class="flex gap-1 sm:gap-2 mb-4 border-b border-zinc-200 dark:border-zinc-800 overflow-x-auto">
        ${[['grid', 'Calendar'], ['bills', 'Bills'], ['deliveries', 'Deliveries'], ['shortcuts', 'Shortcuts']].map(([k, l]) => `
        <button onclick="window.__app.setCalTab('${k}')"
                class="px-3 py-2 text-sm ${this.#tab === k ? 'border-b-2 border-zinc-900 dark:border-white font-medium' : 'text-zinc-500'}">${l}</button>`).join('')}
      </div>

      ${this.#tab === 'grid' ? this.#renderGrid(state)
        : this.#tab === 'shortcuts' ? this.#renderShortcuts(state)
        : this.#tab === 'deliveries' ? this.#suggest(state, 'delivery') + this.#renderDeliveries(state)
        : this.#suggest(state, 'bill') + this.#renderBills(state)}
    `;
  }

  // ── Sub-views ─────────────────────────────────────────────────────────

  #renderGrid(state) {
    const home     = this.homeCurrency;
    const mode     = this.#calMode();
    const isHijri  = mode === 'hijri';
    const showBoth = mode === 'both';
    const today    = new Date();
    const todayStr = this.#isoDate(today);
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    let header, cells, monthSpent;

    if (isHijri) {
      const h          = this.#hijri.toHijri(this.#focus);
      const daysInMonth= this.#hijri.daysInMonth(h.year, h.month);
      const day1       = this.#hijri.toGregorian(h.year, h.month, 1);
      const startWD    = day1.getDay();
      header           = `${this.#hijri.monthsLong[h.month]} ${h.year} H`;
      cells            = [];
      for (let i = 0; i < startWD; i++) cells.push(null);
      for (let d = 1; d <= daysInMonth; d++) {
        const g = this.#hijri.toGregorian(h.year, h.month, d);
        cells.push({ primary: d, secondary: g.getDate() + ' ' + g.toLocaleDateString(undefined,{month:'short'}), iso: this.#isoDate(g) });
      }
      monthSpent = this.#logsForHijriMonth(h.year, h.month, state)
        .reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
    } else {
      const focus     = new Date(this.#focus + 'T12:00:00');
      const year      = focus.getFullYear();
      const monthIdx  = focus.getMonth();
      const daysInMonth= new Date(year, monthIdx + 1, 0).getDate();
      const startWD   = new Date(year, monthIdx, 1).getDay();
      header = focus.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      cells  = [];
      for (let i = 0; i < startWD; i++) cells.push(null);
      for (let d = 1; d <= daysInMonth; d++) {
        const dt  = new Date(year, monthIdx, d, 12);
        const iso = this.#isoDate(dt);
        const h   = this.#hijri.toHijri(iso);
        cells.push({ primary: d, secondary: h.day + ' ' + this.#hijri.monthsShort[h.month], iso });
      }
      monthSpent = this.#logsForMonth(year, monthIdx, state)
        .reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    const days = cells.filter(Boolean);
    const billSvc = window.__app?.bills;
    const billDays = new Map();
    if (billSvc && days.length) {
      for (const o of billSvc.occurrences(days[0].iso, days[days.length - 1].iso, todayStr, state)) {
        if (o.status === 'skipped' || o.status === 'paused') continue;
        if (!billDays.has(o.date)) billDays.set(o.date, []);
        billDays.get(o.date).push(o);
      }
    }
    const dues = window.__app?.vendorDues;
    const tracked = this.#tracked(state);
    const unpaid = [...billDays.values()].flat().filter((o) => o.status === 'overdue' || o.status === 'due').length;
    const plans = this.#tracked(state).map((it) => new DeliveryPlan(it));
    const deliveryCost = plans.length ? cells.filter((c) => c && c.iso <= todayStr)
      .reduce((sum, c) => sum + plans.reduce((t, p) => t + this.convert(Math.round(p.qtyOn(c.iso) * p.priceOn(c.iso)), p.item.currency || home, home), 0), 0) : 0;

    return `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-1">
          <button class="btn btn-ghost" onclick="window.__app.shiftCalMonth(-1)" aria-label="Previous">
            <i data-lucide="chevron-left"></i>
          </button>
          <div class="font-semibold px-1 min-w-0">${this.escapeHtml(header)}</div>
          <button class="btn btn-ghost" onclick="window.__app.shiftCalMonth(1)" aria-label="Next">
            <i data-lucide="chevron-right"></i>
          </button>
          <button class="btn btn-ghost text-xs" onclick="window.__app.resetCalFocus()">Today</button>
        </div>
        <div class="text-sm text-zinc-500 hidden sm:block">${unpaid ? `<span class="text-rose-600 font-medium">${unpaid} bill${unpaid === 1 ? '' : 's'} to pay</span> · ` : ''}${this.formatMoney(monthSpent, home)} this ${isHijri ? 'Hijri month' : 'month'}${plans.length ? ` · ${this.formatMoney(deliveryCost, home)} delivered` : ''}</div>
      </div>

      ${unpaid ? `<div class="sm:hidden text-sm text-rose-600 font-medium mb-2">${unpaid} bill${unpaid === 1 ? '' : 's'} to pay — tap a red dot</div>` : ''}
      <div class="card p-2 md:p-3">
        <div class="grid grid-cols-7 gap-0.5 md:gap-1 mb-1">
          ${dayNames.map((n) => `<div class="text-xs text-zinc-500 text-center font-medium py-1">${n}</div>`).join('')}
        </div>
        <div class="grid grid-cols-7 gap-0.5 md:gap-1">
          ${cells.map((c) => {
            if (!c) return `<div></div>`;
            // a vendor payment is shown by its days turning green, not as an entry icon
            const logs      = this.#logsForDate(c.iso, state).filter((t) => !t.settles);
            const total     = logs.reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
            const isToday   = c.iso === todayStr;
            const firstItem = logs[0] ? (state.regularItems || []).find((i) => i.id === logs[0].regularItemId) : null;
            const dots      = logs.slice(0, 4).map((t) => {
              const it = (state.regularItems || []).find((i) => i.id === t.regularItemId);
              return it ? `<span title="${this.escapeHtml(it.name)}" class="inline-block rounded-full" style="width:7px;height:7px;background:${Html.color(it.color)}"></span>` : '';
            }).join('');
            // Desktop: each item's icon (up to three); phones: a coloured dot each (up to four).
            const icons = logs.slice(0, 3).map((t) => {
              const it = (state.regularItems || []).find((i) => i.id === t.regularItemId);
              return it ? `<span class="icon-pill" title="${this.escapeHtml(it.name)}" style="background:${Html.color(it.color)}22;color:${Html.color(it.color)};width:28px;height:28px"><i data-lucide="${Html.icon(it.icon)}" style="width:15px;height:15px"></i></span>` : '';
            }).join('');
            const primaryColor = firstItem ? firstItem.color : '';
            const bills = billDays.get(c.iso) || [];
            // Deliveries: grey outline until confirmed, red once delivered, green once paid.
            const delivered = dues ? tracked.map((it) => ({ it, status: dues.statusOn(it, c.iso, todayStr) })).filter((x) => x.status) : [];
            const deliveryTags = delivered.slice(0, 3).map(({ it, status }) =>
              `<span class="cal-bill ${status}" title="${this.escapeHtml(it.name)} · ${CalendarView.#DELIVERY_WORD[status]}"><i data-lucide="${Html.icon(it.icon)}"></i></span>`).join('');
            // Desktop: the bill's category icon, green when paid, red when not; phones: a dot.
            const billTags = bills.slice(0, 3).map((o) => {
              const title = `${this.escapeHtml(BillService.nameOf(o.template, state))} · ${CalendarView.#BILL_WORD[o.status]}`;
              const cat = (state.categories || []).find((c) => c.id === o.template.categoryId);
              return `<span class="cal-bill ${o.status}" title="${title}"><i data-lucide="${Html.icon(cat?.icon, 'receipt')}"></i></span>`;
            }).join('') + (bills.length > 3 ? `<span class="text-[9px] text-zinc-500">+${bills.length - 3}</span>` : '');
            const changed = plans.some((p) => p.stateOn(c.iso) === 'changed');
            const paused  = !changed && plans.some((p) => p.stateOn(c.iso) === 'paused');
            return `
              <button onclick="window.__app.openModal('dayLogs',{date:'${c.iso}'})"
                      class="aspect-square rounded-lg flex flex-col items-stretch p-1 md:p-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition border ${isToday ? 'border-zinc-900 dark:border-white' : 'border-transparent'} ${logs.length ? 'bg-zinc-50 dark:bg-zinc-900' : ''}"
                      style="${logs.length && primaryColor ? `box-shadow: inset 0 -3px 0 0 ${primaryColor}` : ''}">
                <div class="flex items-center justify-between leading-none">
                  <span class="${isToday ? 'font-semibold' : ''} ${logs.length ? 'font-medium' : ''}">${c.primary}${changed ? '<span class="cal-mark" title="A delivery was different"></span>' : paused ? '<span class="cal-mark cal-mark-paused" title="Deliveries paused"></span>' : ''}</span>
                  ${showBoth ? `<span class="text-[9px] text-zinc-500 truncate ml-1">${this.escapeHtml(c.secondary)}</span>` : ''}
                </div>
                ${firstItem ? `
                  <div class="flex-1 flex items-center justify-center min-h-0">
                    <div class="flex md:hidden gap-0.5 flex-wrap justify-center items-center">${dots}${logs.length > 4 ? `<span class="text-[9px] text-zinc-500">+${logs.length - 4}</span>` : ''}</div>
                    <div class="hidden md:flex gap-1 flex-wrap justify-center items-center">${icons}${logs.length > 3 ? `<span class="text-[10px] text-zinc-500">+${logs.length - 3}</span>` : ''}</div>
                  </div>
                ` : '<div class="flex-1"></div>'}
                ${bills.length || delivered.length ? `<div class="cal-bills">${deliveryTags}${billTags}</div>` : ''}
                ${total > 0 ? `<div class="text-[9px] text-zinc-500 truncate text-center">${this.formatMoney(total, home)}</div>` : ''}
              </button>`;
          }).join('')}
        </div>
      </div>

      ${billDays.size || tracked.length ? `
      <div class="flex flex-wrap gap-3 mt-2 text-[11px] text-zinc-500">
        <span><span class="cal-key paid"></span>Paid</span>
        <span><span class="cal-key overdue"></span>Not paid yet</span>
        <span><span class="cal-key upcoming"></span>${tracked.length ? 'Not confirmed / coming up' : 'Coming up'}</span>
      </div>` : ''}

      ${(state.regularItems || []).length === 0 && !billDays.size ? `
        <div class="card p-6 mt-4 text-center">
          ${this.inGuestSpace
             ? this.emptyState('Nothing shared with you here', 'Deliveries and shortcuts follow the accounts they\u2019re on.')
             : this.emptyState('Nothing on the calendar yet', 'Deliveries (milk, paper) and things you log with shortcuts show here day by day.')}
          ${this.inGuestSpace ? '' : `
          <button class="btn btn-primary mt-3" onclick="window.__app.openModal('regularItem')">
            <i data-lucide="plus"></i> Add item
          </button>`}
        </div>` : ''}
    `;
  }

  /**
   * Every repeating entry: what it is, how often, when next, and the amount
   * (or "asks each time" with last time's). Due "ask me" bills come first
   * with Pay; each has Edit and Stop.
   */
  /** Shortcuts (coffee ₹20): what they fill, how often this month, Edit (and Delete inside). */
  #renderShortcuts(state) {
    const items = (state.regularItems || []).filter((i) => i.payLater !== true);
    const add = this.inGuestSpace ? '' : `<button class="btn btn-primary mt-4" onclick="window.__app.openModal('regularItem',{payLater:false})"><i data-lucide="plus"></i> Add a shortcut</button>`;
    if (!items.length) {
      return `
        <div class="card p-8 text-center">
          ${this.emptyState('No shortcuts yet', 'Things you buy often — coffee, the bus, an auto. One tap in Add fills the amount and category.')}
          <div class="regular-example mt-4"><i data-lucide="coffee"></i> Coffee · ₹20 · one tap</div>
          ${add}
        </div>`;
    }
    const month = DateService.todayIso().slice(0, 7);
    const logs = window.__app?.regularLogs?.all?.() || state.transactions || [];
    const rows = items.map((it) => {
      const color = Html.color(it.color);
      const n = logs.filter((t) => t.regularItemId === it.id && String(t.date || '').startsWith(month)).length;
      const shared = !!it.sharedOwnerId;
      return `
        <div class="flex items-center gap-3 p-3">
          <span class="icon-pill" style="background:${color}22;color:${color};width:32px;height:32px"><i data-lucide="${Html.icon(it.icon)}" style="width:15px;height:15px"></i></span>
          <div class="flex-1 min-w-0">
            <div class="font-medium truncate">${this.escapeHtml(it.name)}</div>
            <div class="text-xs text-zinc-500">${this.formatMoney(it.defaultAmount || 0, it.currency)} · ${n} time${n === 1 ? '' : 's'} this month${shared ? ' · on a shared account' : ''}</div>
          </div>
          ${this.inGuestSpace ? '' : `<button class="btn btn-ghost btn-sm" onclick="window.__app.openModal('regularItem',{id:'${Html.js(it.id)}'})">Edit</button>`}
        </div>`;
    }).join('');
    return `
      <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">${rows}</div>
      <p class="text-xs text-zinc-500 mt-3">Shortcuts appear at the top of a new expense. Edit one to change or delete it; entries already logged stay. A bill that comes once a month is better added as a bill.</p>
      ${add}`;
  }

  /** "Looks like a monthly bill — make it one?" / "Delivered most days? Track it." */
  #suggest(state, kind) {
    if (this.inGuestSpace) return '';
    const today = DateService.todayIso();
    const list = kind === 'bill' ? SuggestionService.bills(state, today) : SuggestionService.deliveries(state, today);
    return list.map((g) => {
      const payee = Html.escape(JSON.stringify(g.payee));
      const text = kind === 'bill'
        ? `You've paid <b>${this.escapeHtml(g.payee)}</b> once a month for ${g.count} months${g.changes ? ' (the amount changes)' : ` (${this.formatMoney(g.amount, g.last.currency)})`}. Make it a monthly bill?`
        : `<b>${this.escapeHtml(g.payee)}</b> on ${g.days} of the last 14 days. Delivered most days? Track it and pay once a month.`;
      return `
        <div class="habit-suggest">
          <i data-lucide="sparkles"></i>
          <div class="flex-1 min-w-0 text-sm">${text}</div>
          <button class="btn btn-primary btn-sm" onclick="window.__app.acceptSuggestion('${kind}',${payee})">${kind === 'bill' ? 'Make it a bill' : 'Track it'}</button>
          <button class="btn btn-ghost btn-sm" onclick="window.__app.dismissSuggestion('${kind}',${payee})">No thanks</button>
        </div>`;
    }).join('');
  }

  #renderBills(state) {
    const bills = window.__app?.bills;
    const today = DateService.todayIso();
    const repeats = bills ? bills.allRepeats(state) : [];
    const due = !this.inGuestSpace && bills ? bills.due(today) : [];
    if (!repeats.length) {
      return `
        <div class="card p-8 text-center">
          ${this.emptyState('No bills yet', 'Rent on the 1st, school fees each term, the electricity bill — add them once and Pocket keeps track.')}
          <div class="regular-example mt-4"><i data-lucide="repeat"></i> Rent · ₹20,000 · every month on the 1st</div>
          ${this.inGuestSpace ? '' : `<button class="btn btn-primary mt-4" onclick="window.__app.openModal('addRegular')"><i data-lucide="plus"></i> Add your first bill</button>`}
        </div>`;
    }
    const rows = repeats.map((t) => {
      const next = bills.nextDate(t, today, state);
      const ask = t.askFirst === true;
      const open = due.filter((d) => d.template.id === t.id);
      const paused = RepeatPause.label(t, today, (d) => this.#short(d));
      return { t, next, ask, open, paused, sort: open.length ? '0' + open[0].date : next ? '1' + next : paused ? '15' : '2' };
    }).sort((a, b) => a.sort.localeCompare(b.sort));
    const id = (t) => this.escapeHtml(t.id);
    return `
      <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
        ${rows.map(({ t, next, ask, open, paused }) => {
          const name = this.escapeHtml(BillService.nameOf(t, state));
          const every = this.#every(t.recurring);
          const amount = ask ? `asks each time · last ${this.formatMoney(bills.lastAmount(t), t.currency)}` : this.formatMoney(t.amount, t.currency);
          const pausedNow = RepeatPause.active(t, today);
          const ended = !next && !pausedNow; // paused until you resume has no next date
          const pauseTag = paused ? `<span class="bill-tag bill-paused" style="background:#e0e7ff;color:#4338ca">${this.escapeHtml(paused)}</span>` : '';
          const status = open.length
            ? `<span class="bill-tag ${open[0].overdue ? 'bill-late' : 'bill-today'}">${open[0].overdue ? 'overdue' : open[0].today ? 'due today' : `due ${this.#short(open[0].date)}`}</span>`
            : ended ? `<span class="bill-tag" style="background:#f4f4f5;color:#71717a">ended ${t.recurring.until ? this.#short(t.recurring.until) : ''}</span>`
            : pausedNow ? ''
            : `<span class="text-xs text-zinc-500">next ${this.#short(next)}</span>`;
          return `
            <div class="flex items-center gap-3 p-3">
              <span class="icon-pill" style="width:34px;height:34px;background:#f4f4f5"><i data-lucide="${ask ? 'receipt' : 'repeat'}" style="width:16px;height:16px"></i></span>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">${name}</div>
                <div class="text-xs text-zinc-500">${every} · ${amount}</div>
                <div class="mt-1 flex items-center gap-3 flex-wrap text-xs">
                  ${status}${pauseTag}
                  ${this.inGuestSpace ? '' : `
                  <button class="underline text-zinc-500" onclick="window.__app.openModal('transaction',{id:'${id(t)}'})">Edit</button>
                  ${ended ? '' : pausedNow
                    ? `<button class="underline text-indigo-600 repeat-resume" onclick="window.__app.resumeRepeat('${id(t)}')">Resume</button>`
                    : `<button class="underline text-zinc-500 repeat-pause" onclick="window.__app.openModal('pauseRepeat',{id:'${id(t)}'})">Pause</button>`}
                  ${ended ? '' : `<button class="underline text-zinc-500" onclick="window.__app.stopRepeating('${id(t)}')">Stop</button>`}`}
                </div>
              </div>
              ${!this.inGuestSpace && open.length ? `<button class="btn btn-primary btn-sm" onclick="window.__app.openModal('payBill',{templateId:'${id(t)}',date:'${open[0].date}'})">Pay</button>` : ''}
            </div>`;
        }).join('')}
      </div>
      <p class="text-xs text-zinc-500 mt-3">Same amount each time: added on its date. "Asks each time": waits until you enter what you paid. Editing a bill changes it from then on. Pause skips the dates in between — nothing is added or reminded, and paused dates aren't filled in later.</p>`;
  }

  /** Pay-later items: what's owed to each vendor, then the items themselves. */
  #renderDeliveries(state) {
    const items = this.#tracked(state);
    if (!items.length) {
      return `
        <div class="card p-8 text-center">
          ${this.emptyState('No deliveries yet', 'Milk, the newspaper, a maid — things that come most days and you pay for once a month.')}
          <div class="regular-example mt-4"><i data-lucide="coffee"></i> Milk · 1 L every day · pay Doodhwala monthly</div>
          ${this.inGuestSpace ? '' : `<button class="btn btn-primary mt-4" onclick="window.__app.openModal('regularItem',{payLater:true})"><i data-lucide="plus"></i> Add your first delivery</button>`}
        </div>`;
    }
    const today = DateService.todayIso();
    const dues = window.__app?.vendorDues;
    const ctx = window.__app?.deliveryContext?.();
    const list = items.map((it) => {
      const p = new DeliveryPlan(it);
      const color = Html.color(it.color);
      const can = !ctx || ctx.canChange(it);
      // the last 7 days: tap a day to mark it delivered, or take that back
      const week = Array.from({ length: 7 }, (_, i) => DeliveryPlan.addDays(today, i - 6)).map((d) => {
        const st = dues ? dues.statusOn(it, d, today) : null;
        const word = st ? CalendarView.#DELIVERY_WORD[st] : (p.trackFrom && d < p.trackFrom ? 'not counted yet' : 'no delivery');
        const click = can && (st || (!p.trackFrom || d >= p.trackFrom))
          ? (st ? `window.__app.toggleDeliveryDay('${Html.js(it.id)}','${d}')` : `window.__app.openModal('dayLogs',{date:'${d}'})`)
          : '';
        return `<button type="button" ${click ? `onclick="${click}"` : 'disabled'} title="${DeliveryPlan.shortDate(d)} · ${word}">
            <span class="cal-bill ${st || 'none'}">${st ? `<i data-lucide="${Html.icon(it.icon)}"></i>` : ''}</span>
            ${d === today ? '<b>Today</b>' : DeliveryPlan.DAY_NAMES[DeliveryPlan.weekday(d)]}
          </button>`;
      }).join('');
      const waiting = p.unconfirmedDays(dues ? dues.openFrom(it) : today, DeliveryPlan.addDays(today, -1)).length;
      return `
        <div class="p-3">
        <div class="flex items-center gap-3">
          <span class="icon-pill" style="background:${color}22;color:${color};width:32px;height:32px"><i data-lucide="${Html.icon(it.icon)}" style="width:15px;height:15px"></i></span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${this.escapeHtml(it.name)}</div>
            <div class="text-xs text-zinc-500 truncate">${this.escapeHtml(p.qtyLabel(p.usualQty))} · ${p.daysLabel} · ${this.formatMoney(it.defaultAmount || 0, it.currency || this.homeCurrency)} each · ${this.escapeHtml(p.vendor)}</div>
          </div>
          ${this.inGuestSpace ? '' : `
          <button class="btn btn-ghost btn-sm" onclick="window.__app.openModal('pauseDeliveries',{itemId:'${this.escapeHtml(it.id)}'})">Pause</button>
          <button class="btn btn-outline btn-sm" onclick="window.__app.openModal('regularItem',{id:'${this.escapeHtml(it.id)}'})">Edit</button>`}
        </div>
        <div class="week-strip">${week}</div>
        ${waiting ? `<div class="text-[11px] text-rose-600 mt-1">${waiting} day${waiting === 1 ? '' : 's'} before today not confirmed — tap a day to mark it delivered.</div>` : ''}
        </div>`;
    }).join('');
    return `
      ${this.inGuestSpace ? '' : this.#renderDues(state)}
      <h3 class="font-semibold mt-5 mb-2 text-sm">Items</h3>
      <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">${list}</div>
      <p class="text-xs text-zinc-500 mt-3">Tap a day: once for <b>delivered</b> (red until you pay, then green), again for <b>not delivered</b> (not counted), again to go back. Days not confirmed still count in what you owe; change a quantity from the Calendar tab.</p>`;
  }

  /** "every month", "every 2 weeks". */
  #every(r) {
    const n = Math.max(1, Number(r?.interval) || 1);
    const u = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r?.rule] || 'month';
    return n === 1 ? `every ${u}` : `every ${n} ${u}s`;
  }

  #short(iso) {
    if (!iso) return '';
    const [, m, d] = iso.split('-').map(Number);
    return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
  }

  /** What's owed to each vendor, with Pay, Bill and Pause. */
  #renderDues(state) {
    const dues = window.__app?.vendorDues;
    const groups = dues ? dues.byVendor() : [];
    if (!groups.length) {
      return '';
    }
    const home = this.homeCurrency;
    const owed = groups.reduce((t, g) => t + this.convert(g.amount, g.currency || home, home), 0);
    const owing = groups.filter((g) => g.amount > 0).length;
    return `
      <div class="card p-4 mb-3 flex items-center justify-between">
        <div><div class="text-xs text-zinc-500">Owed today</div><div class="text-2xl font-semibold">${this.formatMoney(owed, home)}</div></div>
        <div class="text-xs text-zinc-500 text-right">${owing} vendor${owing === 1 ? '' : 's'} to pay<br>nothing is spent until you pay</div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${groups.map((g) => this.#vendorCard(g)).join('')}
      </div>`;
  }

  #vendorCard(g) {
    const vendorArg = Html.escape(JSON.stringify(g.vendor));
    const cur = g.currency || this.homeCurrency;
    const lines = g.lines.map((l) => {
      const it = l.item;
      const color = Html.color(it.color);
      const pattern = `${l.plan.qtyLabel(l.plan.usualQty)} · ${l.plan.daysLabel}`;
      return `
        <div class="flex items-center gap-3 py-2">
          <span class="icon-pill" style="background:${color}22;color:${color};width:28px;height:28px"><i data-lucide="${Html.icon(it.icon)}" style="width:14px;height:14px"></i></span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${Html.escape(it.name)}</div>
            <div class="text-xs text-zinc-500 truncate">${l.from && l.lines.length ? `${DeliveryPlan.rangeLabel(l.from, l.to)} · ${Html.escape(l.plan.qtyLabel(l.qty))} on ${l.days} day${l.days === 1 ? '' : 's'}` : `Paid up · ${Html.escape(pattern)}`}</div>
            ${(l.adjustments || []).map((a) => `<div class="text-[11px] text-amber-700 dark:text-amber-400">Adjustment ${DeliveryPlan.shortDate(a.date)}: ${a.now ? Html.escape(l.plan.qtyLabel(a.now)) : 'none'} instead of ${a.was ? Html.escape(l.plan.qtyLabel(a.was)) : 'none'} · ${a.amount < 0 ? '−' : '+'}${this.formatMoney(Math.abs(a.amount), it.currency || cur)}</div>`).join('')}
          </div>
          <div class="text-right">
            <div class="text-sm font-medium">${this.formatMoney(l.amount, it.currency || cur)}</div>
            ${this.inGuestSpace ? '' : `<button class="text-[11px] text-zinc-500 underline" onclick="window.__app.openModal('pauseDeliveries',{itemId:'${Html.escape(it.id)}'})">Pause</button>`}
          </div>
        </div>`;
    }).join('');
    return `
      <div class="card p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="font-semibold truncate">${Html.escape(g.vendor)}</div>
            <div class="text-xs text-zinc-500">${(() => {
              const last = window.__app?.vendorDues?.lastPayment(g.vendor);
              if (!last) return 'Not paid yet';
              return `Last paid ${this.formatMoney(last.amount, last.currency || cur)} on ${DeliveryPlan.shortDate(last.date, true)}`
                + (this.inGuestSpace ? '' : ` · <button class="underline" onclick="window.__app.undoPayment(${vendorArg})">Undo</button>`);
            })()}</div>
          </div>
          <div class="text-right"><div class="text-xs text-zinc-500">${g.amount < 0 ? 'In your favour' : 'Due'}</div><div class="text-lg font-semibold">${this.formatMoney(Math.abs(g.amount), cur)}</div></div>
        </div>
        <div class="divide-y divide-zinc-100 dark:divide-zinc-800 mt-2">${lines}</div>
        ${this.inGuestSpace ? '' : `
        <div class="flex gap-2 mt-3">
          <button class="btn btn-primary flex-1 justify-center" ${g.amount > 0 ? '' : 'disabled'} onclick="window.__app.openModal('settle',{vendor:${vendorArg}})"><i data-lucide="check"></i> Pay</button>
          <button class="btn btn-outline" ${g.amount > 0 ? '' : 'disabled'} onclick="window.__app.shareStatement(${vendorArg})"><i data-lucide="share-2"></i> Bill</button>
        </div>`}
      </div>`;
  }

  /** Pay-later items of the book on screen. */
  #tracked(state) { return (state.regularItems || []).filter((i) => i.payLater === true); }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Hijri off in Settings means a plain Gregorian calendar, whatever mode was chosen before. */
  #calMode()  { return this.state.user.showHijri ? (this.state.user.calendarMode || 'both') : 'gregorian'; }
  #ensureFocus() { if (!this.#focus) this.#focus = this.#isoDate(new Date()); }
  // Local-component ISO (B1): toISOString() is UTC and shifted the calendar grid
  // by a day in non-UTC timezones, mismatching stored local 'YYYY-MM-DD' dates.
  #isoDate(d) { return DateService.toIso(d); }

  /**
   * Every regular-item log the user can see, in BOTH books.
   *
   * An item whose default account was shared by a family member logs into that
   * owner's book, so it is absent from `state.transactions` and only comes back
   * inside the share snapshot. Reading `state` alone made those entries — and
   * the money they represent — invisible on the calendar.
   * @returns {object[]}
   */
  #allLogs(state) {
    const svc = window.__app?.regularLogs;
    if (svc) return svc.all();
    return (state.transactions || []).filter((t) => t.regularItemId);
  }

  #logsForDate(iso, state) {
    return this.#allLogs(state).filter((t) => t.date === iso);
  }

  #logsForMonth(year, monthIdx, state) {
    return this.#allLogs(state).filter((t) => {
      const d = new Date(t.date + 'T12:00:00');
      return d.getFullYear() === year && d.getMonth() === monthIdx;
    });
  }

  #logsForHijriMonth(year, monthIdx, state) {
    return this.#allLogs(state).filter((t) => {
      const h = this.#hijri.toHijri(t.date);
      return h.year === year && h.month === monthIdx;
    });
  }
}
