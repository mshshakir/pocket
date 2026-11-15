/**
 * DashboardView — Overview screen: balance, income/expense summary,
 * top-spending donut chart, recent transactions, today's Hijri date.
 */
import { AccountService } from '../../domain/services/AccountService.js';
import { BillService } from '../../domain/services/BillService.js';
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
    const counted    = state.accounts.filter((a) => AccountService.inTotals(a));
    // Investment accounts count at today's value (holdings at the latest price).
    const total      = counted
      .reduce((s, a) => s + this.convert(window.__app?.accountWorth?.(a) ?? a.balance, a.currency, home), 0);
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
      ${this.#investmentAlerts()}
      ${this.#lowBalanceCard()}
      ${this.#billsCard(todayIso)}

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="card p-5 md:col-span-1">
          <div class="text-xs text-zinc-500 mb-1">Total balance</div>
          <div class="text-3xl font-semibold tracking-tight">${this.formatMoney(total, home)}</div>
          <div class="text-xs text-zinc-500 mt-2">
            ${counted.length} accounts · ${home}
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
          <span class="text-zinc-700 dark:text-zinc-300">${this.escapeHtml(i.cat.name)}</span>
        </div>
        <div class="text-zinc-500">${Math.round((100 * i.amount) / total)}%</div>
      </div>`).join('');
  }

  /**
   * Bills waiting to be paid (overdue, today, the next 7 days) and what's owed
   * to vendors for pay-later items — only when there is something.
   */
  /** Gold or silver that has reached its gain alert. */
  #investmentAlerts() {
    if (this.inGuestSpace) return '';
    const hits = window.__app?.holdings?.alerts?.() ?? [];
    if (!hits.length) return '';
    return `
      <div class="card p-4 mb-4 inv-dash-alert" style="border-color:#34d399">
        <h3 class="font-semibold flex items-center gap-2 mb-1 text-emerald-600"><i data-lucide="trending-up" style="width:16px;height:16px"></i> Investment alert</h3>
        ${hits.map(({ h, st }) => `
          <div class="flex items-center gap-3 py-2 border-t border-zinc-100 dark:border-zinc-800 first:border-0">
            <button class="flex-1 text-left text-sm" onclick="window.__app.navigate('investments')"><b>${this.escapeHtml(h.name)}</b> is up ${st.gainPct}% · worth ${this.formatMoney(st.worth, h.currency)}</button>
            <button class="btn btn-ghost btn-sm" onclick="window.__app.ackInvestmentAlert('${this.escapeHtml(h.id)}')">Got it</button>
          </div>`).join('')}
      </div>`;
  }

  /** Accounts that have dropped below the floor their owner set. */
  #lowBalanceCard() {
    if (this.inGuestSpace) return '';
    const low = window.__app?.accountService?.lowAccounts?.() ?? [];
    if (!low.length) return '';
    return `
      <div class="card p-4 mb-4 low-balance-card" style="border-color:#fcd34d">
        <h3 class="font-semibold flex items-center gap-2 mb-1 text-amber-600"><i data-lucide="alert-triangle" style="width:16px;height:16px"></i> Low balance</h3>
        ${low.map(({ account: a, balance, floor }) => `
          <button class="w-full flex items-center justify-between py-2 border-t border-zinc-100 dark:border-zinc-800 first:border-0 text-left"
                  onclick="window.__app.openAccountDetail('${this.escapeHtml(a.id)}')">
            <span class="text-sm">${this.escapeHtml(a.name)} <span class="text-xs text-zinc-500">· below ${this.formatMoney(floor, a.currency)}</span></span>
            <span class="text-sm font-semibold ${balance < 0 ? 'text-rose-500' : 'text-amber-600'}">${this.formatMoney(balance, a.currency)}</span>
          </button>`).join('')}
      </div>`;
  }

  #billsCard(today) {
    if (this.inGuestSpace) return '';
    const bills = window.__app?.bills?.due(today) ?? [];
    const owed = window.__app?.vendorDues?.totalOwed?.() ?? {};
    const owedRows = Object.entries(owed).filter(([, v]) => v > 0);
    const unconfirmed = window.__app?.vendorDues?.unconfirmed?.(today) ?? [];
    // Card bills and loan instalments overdue or due within a few days.
    const reminders = window.__app?.owed?.reminders?.(today) ?? [];
    if (!bills.length && !owedRows.length && !unconfirmed.length && !reminders.length) return '';
    const when = (b) => b.overdue ? '<span class="bill-tag bill-late">overdue</span>'
      : b.today ? '<span class="bill-tag bill-today">today</span>'
      : `<span class="text-xs text-zinc-500">${this.escapeHtml(this.#short(b.date))}</span>`;
    return `
      <div class="card p-4 mb-4">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-semibold flex items-center gap-2"><i data-lucide="receipt" style="width:16px;height:16px"></i> Bills &amp; dues</h3>
        </div>
        ${unconfirmed.length ? `
          <button class="unconfirmed-alert" onclick="window.__app.navigate('calendar');window.__app.setCalTab('deliveries')">
            <i data-lucide="alert-circle"></i>
            <span class="flex-1 text-left">${unconfirmed.map((u) => `${this.escapeHtml(u.item.name)}: ${u.days.length} day${u.days.length === 1 ? '' : 's'}`).join(' · ')} not confirmed — check Regulars</span>
            <i data-lucide="chevron-right"></i>
          </button>` : ''}
        ${reminders.map((r) => `
          <div class="flex items-center gap-3 py-2 border-t border-zinc-100 dark:border-zinc-800 first:border-0 owe-reminder">
            <i data-lucide="${r.kind === 'card' ? 'credit-card' : 'calendar-clock'}" class="text-zinc-400" style="width:16px;height:16px"></i>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">${this.escapeHtml(r.name)}${r.kind === 'card' ? ' bill' : ' instalment'}</div>
              <div class="flex items-center gap-2">${r.overdue ? '<span class="bill-tag bill-late">overdue</span>' : `<span class="text-xs text-zinc-500">due ${this.escapeHtml(this.#short(r.date))}</span>`}<span class="text-xs text-zinc-500">${this.formatMoney(r.amount, r.currency)}</span></div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="${r.kind === 'card' ? `window.__app.payCardBill('${this.escapeHtml(r.id)}')` : `window.__app.payLoanInstalment('${this.escapeHtml(r.id)}')`}">Pay</button>
          </div>`).join('')}
        ${bills.slice(0, 6).map((b) => `
          <div class="flex items-center gap-3 py-2 border-t border-zinc-100 dark:border-zinc-800 first:border-0">
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">${this.escapeHtml(BillService.nameOf(b.template, this.state))}</div>
              <div class="flex items-center gap-2">${when(b)}<span class="text-xs text-zinc-500">last ${this.formatMoney(b.lastAmount, b.currency)}</span></div>
            </div>
            <button class="btn btn-outline btn-sm" onclick="window.__app.openModal('payBill',{templateId:'${this.escapeHtml(b.template.id)}',date:'${b.date}'})">Pay</button>
          </div>`).join('')}
        ${owedRows.length ? `
          <button class="w-full flex items-center justify-between py-2 border-t border-zinc-100 dark:border-zinc-800 text-left"
                  onclick="window.__app.navigate('calendar');window.__app.setCalTab('dues')">
            <span class="text-sm">Owed to vendors</span>
            <span class="text-sm font-semibold">${owedRows.map(([c, v]) => this.formatMoney(v, c)).join(' + ')} <i data-lucide="chevron-right" style="width:14px;height:14px;display:inline"></i></span>
          </button>` : ''}
      </div>`;
  }

  #short(iso) {
    const [, m, d] = iso.split('-').map(Number);
    return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
  }
}
