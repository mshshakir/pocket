/**
 * ReportsView — Analytics dashboard: daily spending bar, category donut,
 * net-worth line, top transactions, breakdown table, and Hijri-month bars.
 *
 * Chart instances are owned by this view and destroyed on re-render to avoid
 * Canvas re-use warnings from Chart.js.
 */
import { BaseView }          from './BaseView.js';
import { ReportService }     from '../../domain/services/ReportService.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';
import { DateService }          from '../../domain/services/DateService.js';
import { HabitService }         from '../../domain/services/HabitService.js';
import { Html }                 from '../../core/Html.js';

export class ReportsView extends BaseView {
  /** @type {ReportService} */         #reports;
  /** @type {HijriCalendarService} */  #hijri;
  /** @type {string} */                #range = '30';
  /** @type {'overview'|'habits'} */    #tab = 'overview';

  // Chart instances — destroyed before each re-draw
  #charts = { bar: null, donut: null, nw: null };

  constructor() {
    super();
    this.#reports = new ReportService();
    this.#hijri   = new HijriCalendarService();
  }

  // ── Public API ────────────────────────────────────────────────────────

  setRange(r) { this.#range = r; }
  setTab(t)   { this.#tab = t === 'habits' ? 'habits' : 'overview'; }
  get range()  { return this.#range; }

  // ── BaseView contract ─────────────────────────────────────────────────

  render() {
    const showHijri = this.state.user?.showHijri;
    return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Reports</h1>
          ${this.inGuestSpace ? `<div class="text-xs text-zinc-500 mt-0.5">
            ${this.escapeHtml(this.space.label)} · ${this.escapeHtml(this.space.scopeNote)}
          </div>` : ''}
        </div>
        <div class="flex items-center gap-2">
          <select class="select" onchange="window.__app.setReportRange(this.value)">
            <option value="7"  ${this.#range==='7' ?'selected':''}>Last 7d</option>
            <option value="30" ${this.#range==='30'?'selected':''}>Last 30d</option>
            <option value="90" ${this.#range==='90'?'selected':''}>Last 90d</option>
          </select>
          <button class="btn btn-primary" onclick="window.__app.openModal('export')" title="PDF, Excel or CSV, with filters">
            <i data-lucide="download"></i> Export
          </button>
        </div>
      </div>

      <div class="flex gap-2 mb-4 border-b border-zinc-200 dark:border-zinc-800">
        ${[['overview', 'Overview'], ['habits', 'Habits']].map(([k, l]) => `
        <button onclick="window.__app.setReportTab('${k}')"
                class="px-3 py-2 text-sm ${this.#tab === k ? 'border-b-2 border-zinc-900 dark:border-white font-medium' : 'text-zinc-500'}">${l}</button>`).join('')}
      </div>
      ${this.#tab === 'habits' ? this.#renderHabits() : `
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="card p-5">
          <h3 class="font-semibold mb-3">Daily spending</h3>
          <div style="height:240px;position:relative"><canvas id="reportBar"></canvas></div>
        </div>
        <div class="card p-5">
          <h3 class="font-semibold mb-3">By category</h3>
          <div style="height:240px;position:relative"><canvas id="reportDonut"></canvas></div>
        </div>
      </div>

      <div class="card p-5 mt-4">
        <h3 class="font-semibold mb-3 flex items-center gap-2">
          <i data-lucide="trending-up"></i> Net worth over time
        </h3>
        <div style="height:240px;position:relative"><canvas id="reportNetWorth"></canvas></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div class="card p-5">
          <h3 class="font-semibold mb-3 flex items-center gap-2">
            <i data-lucide="flame"></i> Biggest transactions
          </h3>
          <div id="reportTopTx"></div>
        </div>
        <div class="card p-5">
          <h3 class="font-semibold mb-3">Breakdown</h3>
          <div id="reportTable"></div>
        </div>
      </div>

      ${showHijri ? `
        <div class="card p-5 mt-4">
          <h3 class="font-semibold mb-1 flex items-center gap-2">
            <i data-lucide="moon-star"></i> By Hijri month
          </h3>
          <div class="text-xs text-zinc-500 mb-3">Spending grouped by Hijri month over the selected range</div>
          <div id="hijriMonthBreakdown"></div>
        </div>` : ''}
      `}
    `;
  }

  onAfterRender() {
    if (this.#tab === 'overview') this.#drawCharts();
  }

  // ── Habits ────────────────────────────────────────────────────────────

  #renderHabits() {
    const svc = window.__app?.habits;
    if (!svc) return '';
    const state = this.state, home = this.homeCurrency, today = DateService.todayIso();
    const habits = svc.all(state);
    const suggestions = this.inGuestSpace ? [] : svc.suggestions(state, today, home);
    const sugg = suggestions.map((g) => `
      <div class="habit-suggest">
        <i data-lucide="sparkles"></i>
        <div class="flex-1 min-w-0 text-sm">You logged <b>${this.escapeHtml(g.payee)}</b> ${g.count} times in the last 60 days (${this.formatMoney(g.amount, home)}). Track it as a habit?</div>
        <button class="btn btn-primary btn-sm" onclick="window.__app.trackSuggestedHabit(${Html.escape(JSON.stringify(g.payee))})">Track</button>
        <button class="btn btn-ghost btn-sm" onclick="window.__app.dismissHabitSuggestion(${Html.escape(JSON.stringify(g.payee))})">No thanks</button>
      </div>`).join('');
    if (!habits.length) {
      return `${sugg}
        <div class="card p-8 text-center">
          ${this.emptyState('No habits yet', 'Follow one small, repeated spend — coffee, Swiggy, autos — across all your entries, however you logged them.')}
          <div class="regular-example mt-4"><i data-lucide="coffee"></i> Coffee · 26 times · ₹520 this month</div>
          ${this.inGuestSpace ? '' : `<button class="btn btn-primary mt-4" onclick="window.__app.openModal('habit')"><i data-lucide="plus"></i> Add a habit</button>`}
        </div>`;
    }
    return `
      ${sugg}
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        ${habits.map((h) => this.#habitCard(h, svc.stats(h, state, today, home), home, today)).join('')}
      </div>
      ${this.inGuestSpace ? '' : `<button class="btn btn-outline mt-4" onclick="window.__app.openModal('habit')"><i data-lucide="plus"></i> New habit</button>`}
      <p class="text-xs text-zinc-500 mt-3">Compared with the same days of last month. Each shortcut counts as a habit by itself until you set one up.</p>`;
  }

  #habitCard(h, st, home, today) {
    const color = Html.color(h.color, '#6366f1');
    const change = st.change == null ? '' : `<span class="habit-change ${st.change > 0 ? 'up' : 'down'}">${st.change > 0 ? '▲' : '▼'} ${Math.abs(st.change)}%</span>`;
    const maxTrend = Math.max(1, ...st.trend.map((m) => m.amount));
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const maxWd = Math.max(1, ...st.weekdays);
    const limit = st.limit;
    const limitBar = limit ? `
      <div class="habit-limit ${limit.state}">
        <div class="habit-limit-bar"><span style="width:${Math.min(100, Math.round(limit.use * 100))}%"></span></div>
        <div class="text-[11px] mt-1">${limit.countLeft != null ? `${st.count} of ${h.limitCount} times` : `${this.formatMoney(st.amount, home)} of ${this.formatMoney(h.limitAmount, home)}`}
          · ${limit.state === 'over' ? 'over the limit' : limit.countLeft != null ? `${Math.max(0, limit.countLeft)} left` : `${this.formatMoney(Math.max(0, limit.amountLeft), home)} left`}</div>
      </div>` : '';
    // the month's days as a small grid with a dot where it happened
    const [y, m] = today.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const happened = new Set(st.days);
    const cells = [...Array(first).fill(''), ...Array.from({ length: dim }, (_, i) => {
      const iso = `${today.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`;
      return `<span class="${happened.has(iso) ? 'on' : ''} ${iso === today ? 'today' : ''}" title="${i + 1}" style="${happened.has(iso) ? `background:${color}` : ''}"></span>`;
    })].map((c) => c || '<span class="blank"></span>').join('');
    return `
      <div class="card p-4">
        <div class="flex items-start gap-3">
          <span class="icon-pill" style="background:${color}22;color:${color};width:36px;height:36px"><i data-lucide="${Html.icon(h.icon, 'tag')}" style="width:17px;height:17px"></i></span>
          <div class="flex-1 min-w-0">
            <div class="font-semibold truncate">${this.escapeHtml(h.name)}</div>
            <div class="text-sm"><b>${st.count}</b> time${st.count === 1 ? '' : 's'} · <b>${this.formatMoney(st.amount, home)}</b>${st.count ? ` · about ${this.formatMoney(st.average, home)} each` : ''} ${change}</div>
            <div class="text-xs text-zinc-500">this month · last month ${st.prevMonthCount} times, ${this.formatMoney(st.prevMonthAmount, home)}</div>
          </div>
          ${this.inGuestSpace ? '' : `<button class="btn btn-ghost btn-sm" onclick="window.__app.openModal('habit',{id:${Html.escape(JSON.stringify(h.id))}})">Edit</button>`}
        </div>
        ${limitBar}
        <div class="grid grid-cols-2 gap-4 mt-3">
          <div>
            <div class="text-[11px] text-zinc-500 mb-1">Days this month</div>
            <div class="habit-days">${cells}</div>
          </div>
          <div>
            <div class="text-[11px] text-zinc-500 mb-1">Last 6 months</div>
            <div class="habit-trend">${st.trend.map((t) => `<div title="${t.count} times · ${this.formatMoney(t.amount, home)}"><span style="height:${Math.max(3, Math.round(t.amount / maxTrend * 44))}px;background:${color}"></span><small>${months[Number(t.month.slice(5)) - 1][0]}</small></div>`).join('')}</div>
            <div class="text-[11px] text-zinc-500 mt-2 mb-1">Which days (90 days)</div>
            <div class="habit-trend weekdays">${st.weekdays.map((n, i) => `<div title="${n}"><span style="height:${Math.max(2, Math.round(n / maxWd * 22))}px;background:${color}99"></span><small>${'SMTWTFS'[i]}</small></div>`).join('')}</div>
          </div>
        </div>
        ${st.yearly ? `<div class="text-xs text-zinc-500 mt-3"><i data-lucide="trending-up" style="width:12px;height:12px;display:inline"></i> At this rate, about <b>${this.formatMoney(st.yearly, home)}</b> a year.</div>` : ''}
      </div>`;
  }

  // ── Private ───────────────────────────────────────────────────────────

  #drawCharts() {
    const home    = this.homeCurrency;
    const state   = this.state;
    const days    = Number(this.#range);

    // ── Daily spending bar ────────────────────────────────────────────
    const dayKeys = [];
    const labels  = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = DateService.toIso(d);
      dayKeys.push(k);
      labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    }
    const expenseByDay = Object.fromEntries(dayKeys.map((k) => [k, 0]));
    state.transactions
      .filter((t) => t.type === 'expense' && dayKeys.includes(t.date))
      .forEach((t) => { expenseByDay[t.date] += this.fromMinor(this.convert(t.amount, t.currency, home), home); });

    const ctx1 = document.getElementById('reportBar');
    if (ctx1) {
      if (this.#charts.bar) { this.#charts.bar.destroy(); this.#charts.bar = null; }
      this.#charts.bar = new Chart(ctx1, { // eslint-disable-line no-undef
        type: 'bar',
        data: { labels, datasets: [{ data: dayKeys.map((k) => expenseByDay[k]), backgroundColor: '#09090b', borderRadius: 6 }] },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { maxTicksLimit: 7, color: '#a1a1aa' }, grid: { display: false } },
            y: { ticks: { color: '#a1a1aa' }, grid: { color: 'rgba(120,120,120,.1)' } },
          },
        },
      });
    }

    // ── Category donut ────────────────────────────────────────────────
    const spending = this.#reports.spendingByCategory(days);
    const items    = spending
      .map(({ categoryId, amount }) => {
        const cat = state.categories.find((c) => c.id === categoryId);
        return cat ? { cat, amount } : null;
      })
      .filter(Boolean);

    const ctx2 = document.getElementById('reportDonut');
    if (ctx2) {
      if (this.#charts.donut) { this.#charts.donut.destroy(); this.#charts.donut = null; }
      if (items.length) {
        this.#charts.donut = new Chart(ctx2, { // eslint-disable-line no-undef
          type: 'doughnut',
          data: {
            labels:   items.map((i) => i.cat.name),
            datasets: [{ data: items.map((i) => this.fromMinor(i.amount, home)), backgroundColor: items.map((i) => i.cat.color), borderWidth: 0 }],
          },
          options: { cutout: '65%', plugins: { legend: { position: 'bottom', labels: { color: '#a1a1aa', boxWidth: 10 } } } },
        });
      } else {
        ctx2.parentElement.innerHTML = `<div class="text-center text-sm text-zinc-500 py-12">No expenses in range.</div>`;
      }
    }

    // ── Breakdown table ───────────────────────────────────────────────
    const total   = items.reduce((s, i) => s + i.amount, 0);
    const tableEl = document.getElementById('reportTable');
    if (tableEl) {
      tableEl.innerHTML = items.length
        ? `<table class="w-full text-sm">
             <thead class="text-zinc-500 text-xs uppercase tracking-wider">
               <tr><th class="text-left py-2">Category</th><th class="text-right py-2">Amount</th><th class="text-right py-2 w-20">Share</th></tr>
             </thead>
             <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
               ${items.map((i) => `
                 <tr>
                   <td class="py-2"><span class="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle" style="background:${i.cat.color}"></span>${this.escapeHtml(i.cat.name)}</td>
                   <td class="text-right py-2">${this.formatMoney(i.amount, home)}</td>
                   <td class="text-right py-2 text-zinc-500">${Math.round(100 * i.amount / total)}%</td>
                 </tr>`).join('')}
             </tbody>
           </table>`
        : `<div class="text-sm text-zinc-500 text-center py-4">No data.</div>`;
    }

    // ── Net worth line ────────────────────────────────────────────────
    const nwSeries = this.#reports.netWorthSeries({ todayAdjust: window.__app?.holdingsAdjustmentHome?.() ?? 0 });
    const nwCtx    = document.getElementById('reportNetWorth');
    if (nwCtx) {
      if (this.#charts.nw) { this.#charts.nw.destroy(); this.#charts.nw = null; }
      this.#charts.nw = new Chart(nwCtx, { // eslint-disable-line no-undef
        type: 'line',
        data: {
          labels:   nwSeries.map((p) => p.date),
          datasets: [{
            data:            nwSeries.map((p) => this.fromMinor(p.netWorth, home)),
            fill:            true,
            borderColor:     '#0ea5e9',
            backgroundColor: 'rgba(14,165,233,0.12)',
            tension:         0.25,
            pointRadius:     0,
            borderWidth:     2,
          }],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: { ticks: { maxTicksLimit: 6, color: '#a1a1aa' }, grid: { display: false } },
            y: { ticks: { color: '#a1a1aa', callback: (v) => this.formatMoney(this.toMinor(v, home), home) }, grid: { color: 'rgba(120,120,120,.1)' } },
          },
        },
      });
    }

    // ── Top transactions ──────────────────────────────────────────────
    const topEl = document.getElementById('reportTopTx');
    if (topEl) {
      const tops = this.#reports.topTransactions(5, days);
      topEl.innerHTML = tops.length === 0
        ? `<div class="text-sm text-zinc-500 text-center py-4">No expenses in range.</div>`
        : `<div class="divide-y divide-zinc-100 dark:divide-zinc-800">
            ${tops.map(({ tx: t, value }) => {
              const cat = state.categories.find((c) => c.id === t.categoryId);
              return `
                <button onclick="window.__app.openModal('transaction',{id:'${t.id}'})"
                        class="w-full text-left flex items-center gap-3 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 rounded">
                  <div class="icon-pill" style="background:${(cat?.color||'#71717a')}22;color:${cat?.color||'#71717a'};width:30px;height:30px">
                    <i data-lucide="${cat?.icon||'circle'}" style="width:14px;height:14px"></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium truncate">${this.escapeHtml(t.payee || cat?.name || 'Transaction')}</div>
                    <div class="text-xs text-zinc-500 truncate">${this.escapeHtml(cat?.name || '')} · ${this.dateLabel(t.date).split(' · ')[0]}</div>
                  </div>
                  <div class="text-sm font-semibold text-rose-500">-${this.formatMoney(value, home)}</div>
                </button>`;
            }).join('')}
          </div>`;
    }

    // ── Hijri month breakdown ─────────────────────────────────────────
    if (state.user?.showHijri) {
      const byHijriMonth = this.#reports.spendingByHijriMonth(days);
      const el = document.getElementById('hijriMonthBreakdown');
      if (el) {
        const max = Math.max(1, ...byHijriMonth.map((x) => x.amount));
        el.innerHTML = byHijriMonth.length
          ? byHijriMonth.map((x) => `
              <div class="mb-2.5">
                <div class="flex justify-between text-sm mb-1">
                  <span>${this.#hijri.monthsLong[x.month]} <span class="text-zinc-500 text-xs">${x.year} H</span></span>
                  <span class="font-medium">${this.formatMoney(x.amount, home)}</span>
                </div>
                <div class="progress"><div style="width:${Math.round(100 * x.amount / max)}%; background:#0ea5e9"></div></div>
              </div>`).join('')
          : `<div class="text-sm text-zinc-500 text-center py-4">No data.</div>`;
      }
    }
  }
}
