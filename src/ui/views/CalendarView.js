/**
 * CalendarView — Regular purchases calendar with three sub-tabs:
 *   • grid     — calendar grid with dots/icons per day
 *   • summary  — monthly spend breakdown table
 *   • items    — list of configured regular-purchase items
 *
 * Supports Gregorian, Hijri, and "both" display modes.
 */
import { BaseView }          from './BaseView.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';
import { DateService }          from '../../domain/services/DateService.js';

export class CalendarView extends BaseView {
  /** @type {HijriCalendarService} */  #hijri;
  /** @type {string|null} */           #focus = null;   // ISO date of focused month
  /** @type {string} */                #tab   = 'grid'; // 'grid' | 'summary' | 'items'

  constructor() {
    super();
    this.#hijri = new HijriCalendarService();
  }

  // ── Public API ────────────────────────────────────────────────────────

  setTab(tab)   { this.#tab   = tab; }
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
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Regular Purchases</h1>
          <div class="text-xs text-zinc-500 mt-0.5">${items.length} item${items.length === 1 ? '' : 's'} · entries flow into your ledger</div>
        </div>
        <div class="flex gap-2 flex-shrink-0">
          <div class="hidden md:flex card p-1 gap-0.5 text-xs">
            ${[['gregorian','Greg'],['both','Both'],['hijri','Hijri']].map(([k,l]) =>
              `<button onclick="window.__app.setCalendarMode('${k}')"
                       class="px-2 py-1 rounded ${mode===k?'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900':'text-zinc-500'}">${l}</button>`
            ).join('')}
          </div>
          <button class="btn btn-outline" onclick="window.__app.openModal('regularItem')">
            <i data-lucide="plus"></i> <span class="hidden sm:inline">Item</span>
          </button>
        </div>
      </div>

      <div class="md:hidden flex gap-1 mb-3 card p-1 text-xs">
        ${[['gregorian','Gregorian only'],['both','Show both'],['hijri','Hijri only']].map(([k,l]) =>
          `<button onclick="window.__app.setCalendarMode('${k}')"
                   class="flex-1 px-2 py-1.5 rounded ${mode===k?'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900':'text-zinc-500'}">${l}</button>`
        ).join('')}
      </div>

      <div class="flex gap-2 mb-4 border-b border-zinc-200 dark:border-zinc-800">
        <button onclick="window.__app.setCalTab('grid')"
                class="px-3 py-2 text-sm ${this.#tab==='grid'?'border-b-2 border-zinc-900 dark:border-white font-medium':'text-zinc-500'}">Calendar</button>
        <button onclick="window.__app.setCalTab('summary')"
                class="px-3 py-2 text-sm ${this.#tab==='summary'?'border-b-2 border-zinc-900 dark:border-white font-medium':'text-zinc-500'}">Monthly summary</button>
        <button onclick="window.__app.setCalTab('items')"
                class="px-3 py-2 text-sm ${this.#tab==='items'?'border-b-2 border-zinc-900 dark:border-white font-medium':'text-zinc-500'}">Items</button>
      </div>

      ${this.#tab === 'grid'    ? this.#renderGrid(state)    :
        this.#tab === 'summary' ? this.#renderSummary(state) :
                                  this.#renderItems(state)}
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
        <div class="text-sm text-zinc-500 hidden sm:block">${this.formatMoney(monthSpent, home)} this ${isHijri ? 'Hijri month' : 'month'}</div>
      </div>

      <div class="card p-2 md:p-3">
        <div class="grid grid-cols-7 gap-0.5 md:gap-1 mb-1">
          ${dayNames.map((n) => `<div class="text-xs text-zinc-500 text-center font-medium py-1">${n}</div>`).join('')}
        </div>
        <div class="grid grid-cols-7 gap-0.5 md:gap-1">
          ${cells.map((c) => {
            if (!c) return `<div></div>`;
            const logs      = this.#logsForDate(c.iso, state);
            const total     = logs.reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
            const isToday   = c.iso === todayStr;
            const firstItem = logs[0] ? (state.regularItems || []).find((i) => i.id === logs[0].regularItemId) : null;
            const moreCount = Math.max(0, logs.length - 1);
            const dots      = logs.slice(0, 4).map((t) => {
              const it = (state.regularItems || []).find((i) => i.id === t.regularItemId);
              return it ? `<span title="${this.escapeHtml(it.name)}" class="inline-block rounded-full border border-white/60 dark:border-zinc-900" style="width:10px;height:10px;background:${it.color}"></span>` : '';
            }).join('');
            const primaryColor = firstItem ? firstItem.color : '';
            return `
              <button onclick="window.__app.openModal('dayLogs',{date:'${c.iso}'})"
                      class="aspect-square rounded-lg flex flex-col items-stretch p-1 md:p-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 transition border ${isToday ? 'border-zinc-900 dark:border-white' : 'border-transparent'} ${logs.length ? 'bg-zinc-50 dark:bg-zinc-900' : ''}"
                      style="${logs.length && primaryColor ? `box-shadow: inset 0 -3px 0 0 ${primaryColor}` : ''}">
                <div class="flex items-center justify-between leading-none">
                  <span class="${isToday ? 'font-semibold' : ''} ${logs.length ? 'font-medium' : ''}">${c.primary}</span>
                  ${showBoth ? `<span class="text-[9px] text-zinc-500 truncate ml-1">${this.escapeHtml(c.secondary)}</span>` : ''}
                </div>
                ${firstItem ? `
                  <div class="flex-1 flex items-center justify-center min-h-0">
                    <span class="icon-pill md:hidden" style="background:${firstItem.color}22;color:${firstItem.color};width:20px;height:20px">
                      <i data-lucide="${firstItem.icon}" style="width:11px;height:11px"></i>
                    </span>
                    <div class="hidden md:flex gap-0.5 flex-wrap justify-center items-center">${dots}${moreCount > 4 ? `<span class="text-[9px] text-zinc-500">+${logs.length-4}</span>` : ''}</div>
                  </div>
                  ${moreCount > 0 ? `<div class="text-[9px] text-zinc-500 text-center md:hidden">+${moreCount}</div>` : ''}
                ` : '<div class="flex-1"></div>'}
                ${total > 0 ? `<div class="text-[9px] text-zinc-500 truncate text-center">${this.formatMoney(total, home)}</div>` : ''}
              </button>`;
          }).join('')}
        </div>
      </div>

      ${(state.regularItems || []).length === 0 ? `
        <div class="card p-6 mt-4 text-center">
          ${this.emptyState('No regular items yet', 'Define an item like "Morning coffee" or "Bus pass" and start logging.')}
          <button class="btn btn-primary mt-3" onclick="window.__app.openModal('regularItem')">
            <i data-lucide="plus"></i> Add item
          </button>
        </div>` : ''}
    `;
  }

  #renderSummary(state) {
    const home    = this.homeCurrency;
    const isHijri = this.#calMode() === 'hijri';
    let logs, headerLabel;

    if (isHijri) {
      const h   = this.#hijri.toHijri(this.#focus);
      logs       = this.#logsForHijriMonth(h.year, h.month, state);
      headerLabel= `${this.#hijri.monthsLong[h.month]} ${h.year} H`;
    } else {
      const focus = new Date(this.#focus + 'T12:00:00');
      logs        = this.#logsForMonth(focus.getFullYear(), focus.getMonth(), state);
      headerLabel = focus.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    }

    const byItem = {};
    logs.forEach((t) => {
      const it = (state.regularItems || []).find((i) => i.id === t.regularItemId);
      if (!it) return;
      byItem[t.regularItemId] = byItem[t.regularItemId] || { item: it, count: 0, qty: 0, total: 0 };
      byItem[t.regularItemId].count += 1;
      byItem[t.regularItemId].qty   += Number(t.quantity || 1);
      byItem[t.regularItemId].total += this.convert(t.amount, t.currency, home);
    });
    const rows       = Object.values(byItem).sort((a, b) => b.total - a.total);
    const totalSpent = rows.reduce((s, r) => s + r.total, 0);
    const totalCount = logs.length;

    return `
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-1">
          <button class="btn btn-ghost" onclick="window.__app.shiftCalMonth(-1)"><i data-lucide="chevron-left"></i></button>
          <div class="font-semibold px-1">${this.escapeHtml(headerLabel)}</div>
          <button class="btn btn-ghost" onclick="window.__app.shiftCalMonth(1)"><i data-lucide="chevron-right"></i></button>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 md:gap-3 mb-4">
        <div class="card p-3 md:p-4"><div class="text-xs text-zinc-500">Total spent</div><div class="text-lg md:text-xl font-semibold">${this.formatMoney(totalSpent, home)}</div></div>
        <div class="card p-3 md:p-4"><div class="text-xs text-zinc-500">Purchases</div><div class="text-lg md:text-xl font-semibold">${totalCount}</div></div>
        <div class="card p-3 md:p-4"><div class="text-xs text-zinc-500">Avg / purchase</div><div class="text-lg md:text-xl font-semibold">${this.formatMoney(totalCount > 0 ? totalSpent / totalCount : 0, home)}</div></div>
      </div>

      ${rows.length === 0
        ? `<div class="card p-6 text-center">${this.emptyState('No purchases this month', 'Pick a date on the calendar and log items.')}</div>`
        : `<div class="card p-5">
             <h3 class="font-semibold mb-3">Item breakdown</h3>
             <div class="overflow-x-auto">
               <table class="w-full text-sm min-w-[420px]">
                 <thead class="text-zinc-500 text-xs uppercase tracking-wider">
                   <tr><th class="text-left py-2">Item</th><th class="text-right py-2">Count</th><th class="text-right py-2">Qty</th><th class="text-right py-2">Total</th><th class="text-right py-2">Avg</th></tr>
                 </thead>
                 <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
                   ${rows.map((r) => `
                     <tr>
                       <td class="py-2">
                         <div class="flex items-center gap-2">
                           <span class="icon-pill" style="background:${r.item.color}22;color:${r.item.color};width:24px;height:24px">
                             <i data-lucide="${r.item.icon}" style="width:13px;height:13px"></i>
                           </span>
                           <span class="truncate">${this.escapeHtml(r.item.name)}</span>
                         </div>
                       </td>
                       <td class="text-right py-2">${r.count}</td>
                       <td class="text-right py-2">${r.qty}</td>
                       <td class="text-right py-2 font-medium">${this.formatMoney(r.total, home)}</td>
                       <td class="text-right py-2 text-zinc-500">${this.formatMoney(r.total / r.count, home)}</td>
                     </tr>`).join('')}
                 </tbody>
               </table>
             </div>
           </div>`}
    `;
  }

  #renderItems(state) {
    const items = state.regularItems || [];
    if (!items.length) {
      return `
        <div class="card p-10 text-center">
          ${this.emptyState('No items yet', 'Define your regular purchases here.')}
          <button class="btn btn-primary mt-3" onclick="window.__app.openModal('regularItem')">
            <i data-lucide="plus"></i> Add item
          </button>
        </div>`;
    }
    return `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        ${items.map((it) => `
          <button class="card p-4 flex items-center gap-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  onclick="window.__app.openModal('regularItem',{id:'${it.id}'})">
            <div class="icon-pill" style="background:${it.color}22;color:${it.color}">
              <i data-lucide="${it.icon}"></i>
            </div>
            <div class="flex-1 min-w-0">
              <div class="font-medium truncate">${this.escapeHtml(it.name)}</div>
              <div class="text-xs text-zinc-500 truncate">${this.formatMoney(it.defaultAmount || 0, it.currency || this.homeCurrency)} default · ${it.currency || this.homeCurrency}</div>
            </div>
            <i data-lucide="chevron-right" class="text-zinc-400 flex-shrink-0"></i>
          </button>`).join('')}
      </div>`;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  #calMode()  { return this.state.user.calendarMode || 'both'; }
  #ensureFocus() { if (!this.#focus) this.#focus = this.#isoDate(new Date()); }
  // Local-component ISO (B1): toISOString() is UTC and shifted the calendar grid
  // by a day in non-UTC timezones, mismatching stored local 'YYYY-MM-DD' dates.
  #isoDate(d) { return DateService.toIso(d); }

  #logsForDate(iso, state) {
    return (state.transactions || []).filter((t) => t.regularItemId && t.date === iso);
  }

  #logsForMonth(year, monthIdx, state) {
    return (state.transactions || []).filter((t) => {
      if (!t.regularItemId) return false;
      const d = new Date(t.date + 'T12:00:00');
      return d.getFullYear() === year && d.getMonth() === monthIdx;
    });
  }

  #logsForHijriMonth(year, monthIdx, state) {
    return (state.transactions || []).filter((t) => {
      if (!t.regularItemId) return false;
      const h = this.#hijri.toHijri(t.date);
      return h.year === year && h.month === monthIdx;
    });
  }
}
