/**
 * DashboardView — Overview screen: balance, income/expense summary,
 * top-spending donut chart, recent transactions, today's Hijri date.
 */
import { BaseView }         from './BaseView.js';
import { ReportService }    from '../../domain/services/ReportService.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';
import { TransactionRowRenderer } from './TransactionRowRenderer.js';
import { DateService }            from '../../domain/services/DateService.js';

export class DashboardView extends BaseView {
  /** @type {ReportService} */          #reports;
  /** @type {HijriCalendarService} */   #hijri;
  /** @type {TransactionRowRenderer} */ #rowRenderer;
  /** @type {object|null} */            #chart = null;

  constructor() {
    super();
    this.#reports     = new ReportService();
    this.#hijri       = new HijriCalendarService();
    this.#rowRenderer = new TransactionRowRenderer();
  }

  render() {
    const { state, homeCurrency: home } = this;
    const monthStart = this.#reports.startOfMonth();
    const monthTx    = state.transactions.filter((t) => new Date(t.date + 'T12:00:00') >= monthStart);
    const income     = monthTx.filter((t) => t.type === 'income')
      .reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
    const expense    = monthTx.filter((t) => t.type === 'expense')
      .reduce((s, t) => s + this.convert(t.amount, t.currency, home), 0);
    const total      = state.accounts
      .filter((a) => !a.archived)
      .reduce((s, a) => s + this.convert(a.balance, a.currency, home), 0);
    const recent     = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);

    const todayIso    = DateService.todayIso();
    const todayH      = this.#hijri.toHijri(todayIso);
    const todayMiq    = this.#hijri.miqaatsFor(todayH);

    return `
      <div class="flex items-center justify-between mb-6">
        <div>
          <div class="text-xs uppercase tracking-wider text-zinc-500">Overview</div>
          <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <button class="btn btn-primary hidden md:inline-flex"
                onclick="window.__app.openModal('transaction')">
          <i data-lucide="plus"></i> New transaction
        </button>
      </div>

      ${state.user.showHijri ? this.#hijriCard(todayH, todayMiq) : ''}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="card p-5 md:col-span-1">
          <div class="text-xs text-zinc-500 mb-1">Total balance</div>
          <div class="text-3xl font-semibold tracking-tight">${this.formatMoney(total, home)}</div>
          <div class="text-xs text-zinc-500 mt-2">
            ${state.accounts.filter((a) => !a.archived).length} accounts · ${home}
          </div>
        </div>
        <div class="card p-5">
          <div class="flex items-center gap-2 text-xs text-zinc-500 mb-1">
            <i data-lucide="arrow-down-left" class="text-emerald-500"></i> Income this month
          </div>
          <div class="text-2xl font-semibold text-emerald-500">${this.formatMoney(income, home)}</div>
        </div>
        <div class="card p-5">
          <div class="flex items-center gap-2 text-xs text-zinc-500 mb-1">
            <i data-lucide="arrow-up-right" class="text-rose-500"></i> Expenses this month
          </div>
          <div class="text-2xl font-semibold text-rose-500">${this.formatMoney(expense, home)}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div class="card p-5 md:col-span-2">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-semibold">Recent transactions</h3>
            <button class="btn btn-ghost text-xs" onclick="window.__app.navigate('transactions')">
              View all <i data-lucide="chevron-right"></i>
            </button>
          </div>
          <div class="divide-y divide-zinc-100 dark:divide-zinc-800">
            ${recent.length
              ? recent.map((t) => this.#rowRenderer.render(t)).join('')
              : this.emptyState('No transactions yet', 'Tap + to add one.')}
          </div>
        </div>
        <div class="card p-5">
          <h3 class="font-semibold mb-1">Top spending</h3>
          <div class="text-xs text-zinc-500 mb-3">This month</div>
          <div class="relative" style="height:200px"><canvas id="dashChart"></canvas></div>
          <div id="dashLegend" class="mt-4 space-y-2 text-sm"></div>
        </div>
      </div>`;
  }

  onAfterRender() {
    this.#drawChart();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  #hijriCard(todayH, miqaats) {
    const months = this.#hijri.monthsLong;
    return `
      <div class="card p-4 mb-4 flex items-start gap-3">
        <div class="icon-pill" style="background:#0ea5e922;color:#0ea5e9">
          <i data-lucide="moon-star"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-xs text-zinc-500">Today</div>
          <div class="font-semibold">${todayH.day} ${months[todayH.month]} ${todayH.year} H</div>
          <div class="text-xs text-zinc-500">
            ${new Date().toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' })}
          </div>
          ${miqaats.length ? `
            <div class="mt-2 flex flex-wrap gap-1.5">
              ${miqaats.slice(0, 4).map((m) => `
                <span class="chip" style="${m.p===1?'background:#fef3c7;color:#92400e;':m.p===2?'background:#ede9fe;color:#6d28d9;':''}">
                  ${this.escapeHtml(m.t)}
                </span>`).join('')}
              ${miqaats.length > 4 ? `<span class="chip">+${miqaats.length - 4} more</span>` : ''}
            </div>` : ''}
        </div>
      </div>`;
  }

  #drawChart() {
    const { state, homeCurrency: home } = this;
    const spending   = this.#reports.spendingByCategory('month');

    const ctx = document.getElementById('dashChart');
    if (!ctx) return;

    // Destroy previous chart instance if it exists
    if (this.#chart) { this.#chart.destroy(); this.#chart = null; }

    // Get items enriched with category objects
    const items = spending
      .map(({ categoryId, amount }) => {
        const cat = state.categories.find((c) => c.id === categoryId);
        return cat ? { cat, amount } : null;
      })
      .filter(Boolean)
      // spendingByCategory already restricts to this month and returns positive
      // sums per category; the old global check was all-or-nothing (#9).
      .filter(({ amount }) => amount > 0)
      .slice(0, 6);

    if (!items.length) {
      ctx.parentElement.innerHTML = `
        <div class="text-center text-sm text-zinc-500 py-12">No spending yet this month.</div>`;
      return;
    }

    const labels = items.map((i) => i.cat.name);
    const data   = items.map((i) => this.fromMinor(i.amount, home));
    const colors = items.map((i) => i.cat.color);

    this.#chart = new Chart(ctx, { // eslint-disable-line no-undef
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] },
      options: { cutout: '70%', plugins: { legend: { display: false } } },
    });

    const total = items.reduce((s, i) => s + i.amount, 0);
    document.getElementById('dashLegend').innerHTML = items.map((i) => `
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${i.cat.color}"></span>
          <span class="text-zinc-700 dark:text-zinc-300">${i.cat.name}</span>
        </div>
        <div class="text-zinc-500">${Math.round((100 * i.amount) / total)}%</div>
      </div>`).join('');
  }
}
