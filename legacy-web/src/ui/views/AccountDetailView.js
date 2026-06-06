/**
 * AccountDetailView — Drill-in view for a single account.
 *
 * Shows account header, stats, tx list with search/filter, optional
 * monthly-balance sub-view, and reconcile banner for owned accounts.
 * Also handles shared accounts (family sharing) in read/edit mode.
 */
import { BaseView }               from './BaseView.js';
import { TransactionRowRenderer } from './TransactionRowRenderer.js';
import { TransactionService }     from '../../domain/services/TransactionService.js';
import { AccountService }         from '../../domain/services/AccountService.js';
import { ReportService }          from '../../domain/services/ReportService.js';
import { TX_SORT_OPTIONS }        from '../../data/constants.js';
import { DateService }            from '../../domain/services/DateService.js';

export class AccountDetailView extends BaseView {
  /** @type {TransactionRowRenderer} */ #rowRenderer;
  /** @type {TransactionService} */     #txService;
  /** @type {AccountService} */         #accountService;
  /** @type {ReportService} */          #reports;

  // ── Per-view state ────────────────────────────────────────────────────
  #accountId    = null;
  #sharedMeta   = null;   // { shareIndex } or null
  #viewMode     = 'transactions'; // 'transactions' | 'monthly'
  #filter       = { search: '', range: 'all', sort: 'date-desc' };
  #multiSelect  = false;
  #selectedIds  = new Set();
  #visibleIds   = [];

  constructor() {
    super();
    this.#rowRenderer   = new TransactionRowRenderer();
    this.#txService     = new TransactionService();
    this.#accountService = new AccountService();
    this.#reports       = new ReportService();
  }

  // ── Public setters ────────────────────────────────────────────────────

  setAccount(id, sharedMeta = null) {
    this.#accountId  = id;
    this.#sharedMeta = sharedMeta;
    this.#multiSelect = false;
    this.#selectedIds.clear();
    this.#viewMode = 'transactions';
  }

  setViewMode(mode)    { this.#viewMode = mode; }
  setFilter(key, val)  { this.#filter[key] = val; }
  toggleMultiSelect()  { this.#multiSelect = !this.#multiSelect; this.#selectedIds.clear(); }
  toggleSelection(id)  { this.#selectedIds.has(id) ? this.#selectedIds.delete(id) : this.#selectedIds.add(id); }
  selectAll()          { this.#visibleIds.forEach((id) => this.#selectedIds.add(id)); }
  deselectAll()        { this.#selectedIds.clear(); }
  clearMultiSelect()   { this.#multiSelect = false; this.#selectedIds.clear(); }
  get visibleIds()     { return this.#visibleIds; }
  get selectedIds()    { return this.#selectedIds; }
  get multiSelect()    { return this.#multiSelect; }
  get accountId()      { return this.#accountId; }

  // ── BaseView contract ─────────────────────────────────────────────────

  render() {
    if (!this.#accountId) return '';
    const state = this.state;

    // Resolve account — owned or shared
    const isShared   = !!this.#sharedMeta;
    const shareIndex = this.#sharedMeta?.shareIndex ?? null;
    const share      = shareIndex !== null ? (state._sharedData || [])[shareIndex] : null;
    const a = isShared
      ? (share?.accounts || []).find((x) => x.id === this.#accountId)
      : state.accounts.find((x) => x.id === this.#accountId);

    if (!a) return '';

    const perm     = isShared ? ((share?.permission || {})[a.id] || 'view') : 'owner';
    const canAdd    = perm === 'edit' || perm === 'full' || perm === 'owner';
    const canDelete = perm === 'full' || perm === 'owner';
    const canManage = perm === 'owner';
    const home      = this.homeCurrency;

    const allTxs = isShared
      ? (share?.transactions || []).filter((t) => this.#txTouchesAccount(t, a.id))
      : state.transactions.filter((t) => this.#txTouchesAccount(t, a.id));

    // ── Stats ──────────────────────────────────────────────────────────
    const ms = this.#reports.startOfMonth();
    let mthIn = 0, mthOut = 0, lifetimeIn = 0, lifetimeOut = 0;
    for (const t of allTxs) {
      const imp = this.#txService.impactOnAccount(t, a);
      if (imp.dir === '+') { lifetimeIn  += imp.minorInAcc; if (new Date(t.date + 'T12:00:00') >= ms) mthIn  += imp.minorInAcc; }
      if (imp.dir === '-') { lifetimeOut += imp.minorInAcc; if (new Date(t.date + 'T12:00:00') >= ms) mthOut += imp.minorInAcc; }
    }

    // ── Reconcile (owner only) ─────────────────────────────────────────
    const ledgerSum = canManage ? this.#ledgerSum(a, state.transactions) : 0;
    const residual  = canManage ? (a.balance - ledgerSum) : 0;

    // ── Filter + sort ──────────────────────────────────────────────────
    const f = this.#filter;
    const fSearch = f.search.toLowerCase();
    const filtered = this.#txService.sort(
      allTxs
        .filter((t) => this.#withinRange(t.date, f.range))
        .filter((t) => !fSearch ||
          (t.payee || '').toLowerCase().includes(fSearch) ||
          (t.note  || '').toLowerCase().includes(fSearch)),
      f.sort,
      (t) => this.#txService.impactOnAccount(t, a).minorInAcc,
    );

    this.#visibleIds   = filtered.map((t) => t.id);
    const sortKey      = f.sort || 'date-desc';
    const groupByDate  = sortKey.startsWith('date-');
    const dayGroups    = {};
    const monthlyInOut = {};
    if (groupByDate) {
      filtered.forEach((t) => {
        (dayGroups[t.date] = dayGroups[t.date] || []).push(t);
      });
    }
    // Build monthlyInOut + running end-of-month balance.
    // opening = legacy residual not covered by any transaction (reuses already-computed ledgerSum).
    // opening balance = legacy residual not covered by any transaction (only meaningful for owners).
    const opening = canManage ? (a.balance - ledgerSum) : null;
    const sortedAll = allTxs.slice().sort((x, y) => x.date.localeCompare(y.date));
    let running = opening ?? 0;
    sortedAll.forEach((t) => {
      const ym = t.date.slice(0, 7);
      // endBalance starts null — only populated when canManage so dividers don't show
      // a meaningless cumulative sum for shared accounts.
      if (!monthlyInOut[ym]) monthlyInOut[ym] = { income: 0, expense: 0, endBalance: null };
      const imp = this.#txService.impactOnAccount(t, a);
      if (imp.dir === '+') { running += imp.minorInAcc; monthlyInOut[ym].income  += imp.minorInAcc; }
      else if (imp.dir === '-') { running -= imp.minorInAcc; monthlyInOut[ym].expense += imp.minorInAcc; }
      if (canManage) monthlyInOut[ym].endBalance = running;
    });

    // ── New-tx prefill ─────────────────────────────────────────────────
    const newTxPrefill = JSON.stringify({
      type: 'expense', accountId: a.id, currency: a.currency,
      date: DateService.todayIso(), paymentType: 'card',
    }).replace(/'/g, '&#39;');

    // "New transaction" button removed from header — use the FAB (bottom-right ＋) instead
    const newTxBtn = '';

    const permLabel = this.#accessLabel(perm);
    const backFn    = isShared
      ? `window.__app.navigate('accounts')`
      : `window.__app.navigate('accounts')`;

    return `
      <div class="flex items-center gap-2 mb-4">
        <button class="btn btn-ghost" onclick="${backFn}" title="Back to Accounts">
          <i data-lucide="arrow-left"></i><span class="hidden md:inline ml-1">Accounts</span>
        </button>
        <div class="flex-1"></div>
        ${isShared ? `<span class="chip" style="background:#818cf822;color:#818cf8">${permLabel} · Shared by ${this.escapeHtml(share?.sharedBy || '')}</span>` : ''}
        ${canManage && Math.abs(residual) >= 1 ? `<button class="btn btn-outline text-amber-600" onclick="window.__app.reconcileAccount('${a.id}')" title="Balance out of sync"><i data-lucide="scale"></i><span class="hidden md:inline ml-1">Reconcile</span></button>` : ''}
        ${isShared ? `<button class="btn btn-outline" onclick="window.__app.refreshSharedAccount(${shareIndex})" title="Refresh"><i data-lucide="refresh-cw"></i><span class="hidden md:inline ml-1">Refresh</span></button>` : ''}
        ${(canManage || canDelete) ? `<button class="btn ${this.#multiSelect ? 'btn-primary' : 'btn-outline'}" onclick="window.__app.toggleAccountMultiSelect()" title="Select multiple"><i data-lucide="check-square"></i></button>` : ''}
        ${canManage ? `<button class="btn btn-outline" onclick="window.__app.openModal('account',{id:'${a.id}'})"><i data-lucide="pencil"></i><span class="hidden md:inline ml-1">Edit</span></button>` : ''}
        ${newTxBtn}
      </div>

      ${this.#bulkBar(isShared, shareIndex)}

      ${canManage && Math.abs(residual) >= 1 ? `
        <div class="card-muted p-3 mb-4" style="border-color:#fcd34d">
          <div class="font-medium text-amber-600 text-sm mb-1 flex items-center gap-1.5">
            <i data-lucide="alert-triangle" style="width:14px;height:14px"></i> Balance is out of sync with transactions
          </div>
          <div class="text-xs text-zinc-600 dark:text-zinc-400">
            Account balance: <b>${this.formatMoney(a.balance, a.currency)}</b> · transactions sum to <b>${this.formatMoney(ledgerSum, a.currency)}</b> · residual <b>${residual >= 0 ? '+' : '-'}${this.formatMoney(Math.abs(residual), a.currency)}</b>. Click <b>Reconcile</b> to log the residual as an opening-balance entry.
          </div>
        </div>` : ''}

      <div class="card p-5 mb-4 relative overflow-hidden ${a.archived ? 'opacity-70' : ''}">
        <div class="absolute -right-10 -top-10 w-40 h-40 rounded-full" style="background:${a.color || '#818cf8'}22"></div>
        <div class="flex items-start gap-3 relative">
          <div class="icon-pill" style="background:${a.color || '#818cf8'};color:white;width:44px;height:44px">
            <i data-lucide="${a.icon || 'wallet'}" style="width:22px;height:22px"></i>
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2">
              <div class="text-xl font-semibold">${this.escapeHtml(a.name)}</div>
              ${a.archived ? '<span class="chip">Archived</span>' : ''}
            </div>
            <div class="text-xs text-zinc-500 capitalize">${a.type || ''} · ${a.currency}</div>
          </div>
          <div class="text-right">
            <div class="text-xs text-zinc-500">Balance</div>
            <div class="text-2xl font-semibold ${a.balance < 0 ? 'text-rose-500' : ''}">${this.formatMoney(a.balance, a.currency)}</div>
            ${a.currency !== home ? `<div class="text-xs text-zinc-500">${this.formatMoney(this.convert(a.balance, a.currency, home), home)} in ${home}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div class="card-muted p-3"><div class="text-xs text-zinc-500">This month in</div><div class="text-lg font-semibold text-emerald-500">+${this.formatMoney(mthIn, a.currency)}</div></div>
        <div class="card-muted p-3"><div class="text-xs text-zinc-500">This month out</div><div class="text-lg font-semibold text-rose-500">-${this.formatMoney(mthOut, a.currency)}</div></div>
        <div class="card-muted p-3"><div class="text-xs text-zinc-500">Lifetime in</div><div class="text-lg font-semibold">+${this.formatMoney(lifetimeIn, a.currency)}</div></div>
        <div class="card-muted p-3"><div class="text-xs text-zinc-500">Lifetime out</div><div class="text-lg font-semibold">-${this.formatMoney(lifetimeOut, a.currency)}</div></div>
      </div>

      ${canManage ? `
        <div class="flex items-center gap-2 mb-4">
          <button class="btn ${this.#viewMode === 'transactions' ? 'btn-primary' : 'btn-outline'}"
                  onclick="window.__app.setAccountViewMode('transactions')">
            <i data-lucide="list"></i><span class="hidden sm:inline ml-1">Transactions</span>
          </button>
          <button class="btn ${this.#viewMode === 'monthly' ? 'btn-primary' : 'btn-outline'}"
                  onclick="window.__app.setAccountViewMode('monthly')">
            <i data-lucide="calendar-range"></i><span class="hidden sm:inline ml-1">Monthly balances</span>
          </button>
        </div>` : ''}

      ${canManage && this.#viewMode === 'monthly'
        ? this.#monthlyView(a, state.transactions)
        : this.#txListSection(a, filtered, dayGroups, monthlyInOut, sortKey, groupByDate, isShared, shareIndex, share)}
    `;
  }

  // ── Private ───────────────────────────────────────────────────────────

  #txListSection(a, filtered, dayGroups, monthlyInOut, sortKey, groupByDate, isShared, shareIndex, share) {
    const f = this.#filter;
    const searchBar = `
      <div class="card p-3 mb-4">
        <div class="flex flex-col md:flex-row gap-2">
          <div class="relative flex-1">
            <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"></i>
            <input class="input pl-9" placeholder="Search payee or note..."
                   value="${this.escapeHtml(f.search)}"
                   data-focus-key="accDetailSearch"
                   oninput="window.__app.setAccDetailFilter('search',this.value)">
          </div>
          <select class="select md:w-36" onchange="window.__app.setAccDetailFilter('range',this.value)">
            ${[['7','Last 7d'],['30','Last 30d'],['90','Last 90d'],['all','All time']]
              .map(([v,l]) => `<option value="${v}" ${f.range===v?'selected':''}>${l}</option>`).join('')}
          </select>
          <select class="select md:w-44" onchange="window.__app.setAccDetailFilter('sort',this.value)">
            ${TX_SORT_OPTIONS.map(([v,l]) => `<option value="${v}" ${f.sort===v?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>`;

    const cats  = isShared && share ? share.categories   : this.state.categories;
    const txArr = isShared && share ? share.transactions : this.state.transactions;
    const opts  = {
      account: a, isShared, shareIndex,
      share, categories: cats, transactions: txArr,
      multiSelect: this.#multiSelect, selectedIds: this.#selectedIds,
    };

    let txListHtml;
    if (filtered.length === 0) {
      txListHtml = `<div class="card p-10 text-center">${this.emptyState('No transactions', 'Try a wider date range or add an entry for this account.')}</div>`;
    } else if (groupByDate) {
      let prevMonth = null;
      txListHtml = Object.keys(dayGroups).map((date) => {
        const ym     = date.slice(0, 7);
        const header = ym !== prevMonth ? this.#monthDivider(ym, monthlyInOut[ym], a) : '';
        prevMonth    = ym;
        return `${header}
          <div class="mb-2">
            <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1 px-1">${this.dateLabel(date)}</div>
            <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
              ${dayGroups[date].map((t) => this.#rowRenderer.render(t, opts)).join('')}
            </div>
          </div>`;
      }).join('');
    } else {
      const sortLabel = TX_SORT_OPTIONS.find(([v]) => v === sortKey)?.[1] || 'Sorted';
      txListHtml = `
        <div class="mb-4">
          <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2 px-1">${sortLabel} · ${filtered.length} result${filtered.length === 1 ? '' : 's'}</div>
          <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
            ${filtered.map((t) => this.#rowRenderer.render(t, opts)).join('')}
          </div>
        </div>`;
    }

    return `${searchBar}${txListHtml}`;
  }

  #monthDivider(ym, tot, a) {
    if (!tot) return '';
    const [y, m] = ym.split('-').map(Number);
    const label  = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return `
      <div class="flex items-center gap-2 my-3 px-1">
        <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 shrink-0">${this.escapeHtml(label)}</span>
        <div class="flex-1 border-t border-zinc-200 dark:border-zinc-700"></div>
        ${tot.income  ? `<span class="text-xs text-emerald-600 dark:text-emerald-400 shrink-0">+${this.formatMoney(tot.income, a.currency)}</span>` : ''}
        ${tot.expense ? `<span class="text-xs text-rose-500 shrink-0">-${this.formatMoney(tot.expense, a.currency)}</span>` : ''}
        ${tot.endBalance != null ? `<span class="text-xs text-zinc-500 shrink-0">bal ${this.formatMoney(tot.endBalance, a.currency)}</span>` : ''}
      </div>`;
  }

  /**
   * Full year × month grid — one row per year, 12 monthly columns, year-end column.
   * Each cell shows end-of-month balance (top) and net change (bottom, color-coded).
   */
  #monthlyView(a, transactions) {
    const all    = transactions.filter((t) => this.#txTouchesAccount(t, a.id));
    if (!all.length) return `<div class="card p-8 text-center">${this.emptyState('No transactions yet', '')}</div>`;

    const ledger  = this.#ledgerSum(a, transactions);
    const opening = a.balance - ledger;
    const sorted  = all.slice().sort((x, y) => x.date.localeCompare(y.date));

    // Build month-data map
    const monthData = {}; // 'YYYY-MM' → { income, expense, net, balance, hasActivity }
    let running = opening;
    sorted.forEach((t) => {
      const ym  = t.date.slice(0, 7);
      const imp = this.#txService.impactOnAccount(t, a);
      if (!monthData[ym]) monthData[ym] = { income: 0, expense: 0, net: 0, balance: 0, hasActivity: false };
      monthData[ym].hasActivity = true;
      if (imp.dir === '+') { running += imp.minorInAcc; monthData[ym].income += imp.minorInAcc; }
      else if (imp.dir === '-') { running -= imp.minorInAcc; monthData[ym].expense += imp.minorInAcc; }
      monthData[ym].net     = monthData[ym].income - monthData[ym].expense;
      monthData[ym].balance = running;
    });

    const firstYM  = sorted[0].date.slice(0, 7);
    const now      = new Date();
    const lastYM   = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const firstYear = +firstYM.slice(0, 4);
    const lastYear  = +lastYM.slice(0, 4);
    const years = [];
    for (let yr = lastYear; yr >= firstYear; yr--) years.push(yr);

    // Plain number formatter — currency stated once in header.
    // toMinor(1, ccy) gives the minor-unit factor (100 for USD, 1 for JPY, 1000 for BHD).
    const factor   = this.toMinor(1, a.currency);
    const digits   = factor === 1 ? 0 : factor === 1000 ? 3 : 2;
    const fmtPlain = new Intl.NumberFormat(undefined, { style: 'decimal', minimumFractionDigits: digits, maximumFractionDigits: digits });
    const fp       = (minor) => fmtPlain.format(this.fromMinor(minor, a.currency));
    const monthShort = Array.from({ length: 12 }, (_, i) => new Date(2000, i, 1).toLocaleDateString(undefined, { month: 'short' }));

    return `
      <p class="text-xs text-zinc-500 mb-2">All figures in <span class="font-medium text-zinc-700 dark:text-zinc-300">${a.currency}</span> · End-of-month balance (top) · monthly net (bottom)</p>
      <div class="card overflow-auto mb-4">
        <table class="w-full text-sm" style="min-width:820px">
          <thead>
            <tr class="text-zinc-500 text-xs uppercase tracking-wider border-b border-zinc-200 dark:border-zinc-800">
              <th class="text-left py-2 px-3 sticky left-0 bg-white dark:bg-zinc-950">Year</th>
              ${monthShort.map((m) => `<th class="text-right py-2 px-2">${m}</th>`).join('')}
              <th class="text-right py-2 px-3">Year-end</th>
            </tr>
          </thead>
          <tbody>
            ${years.map((yr) => {
              let eoy = null;
              const cells = [];
              for (let mm = 1; mm <= 12; mm++) {
                const ym = `${yr}-${String(mm).padStart(2, '0')}`;
                const d  = monthData[ym];
                if (!d) { cells.push(`<td class="text-right py-2 px-2 text-zinc-400">—</td>`); continue; }
                eoy = d.balance;
                const dim      = d.hasActivity ? '' : 'opacity-50';
                const netSign  = d.net >= 0 ? '+' : '-';
                const netColor = d.net > 0 ? 'text-emerald-500' : d.net < 0 ? 'text-rose-500' : 'text-zinc-400';
                const balColor = d.balance < 0 ? 'text-rose-500' : '';
                cells.push(`
                  <td class="text-right py-2 px-2 ${dim}">
                    <div class="font-medium tabular-nums ${balColor}">${fp(d.balance)}</div>
                    ${d.hasActivity ? `<div class="text-[10px] tabular-nums ${netColor}">${netSign}${fp(Math.abs(d.net))}</div>` : ''}
                  </td>`);
              }
              return `
                <tr class="border-b border-zinc-100 dark:border-zinc-900">
                  <td class="font-semibold py-2 px-3 sticky left-0 bg-white dark:bg-zinc-950">${yr}</td>
                  ${cells.join('')}
                  <td class="text-right py-2 px-3 font-semibold tabular-nums">${eoy != null ? fp(eoy) : '—'}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  #bulkBar(isShared = false, shareIndex = null) {
    if (!this.#multiSelect) return '';
    const n           = this.#selectedIds.size;
    const allSelected = this.#visibleIds.length > 0 && this.#visibleIds.every((id) => this.#selectedIds.has(id));
    const deleteAction = isShared && shareIndex !== null
      ? `window.__app.bulkDeleteSharedAccTx(${shareIndex})`
      : `window.__app.bulkDeleteAccTx()`;
    return `
      <div class="fixed bottom-20 md:bottom-6 left-0 right-0 flex justify-center z-40 px-4">
        <div class="card flex items-center gap-2 px-3 py-3 shadow-2xl" style="max-width:520px;width:100%">
          <span class="text-sm font-medium">${n} selected</span>
          <button class="btn btn-ghost text-sm px-2"
                  onclick="${allSelected ? 'window.__app.deselectAllAccTx()' : 'window.__app.selectAllAccTx()'}">
            <i data-lucide="${allSelected ? 'square' : 'check-square'}"></i>
            <span class="hidden md:inline ml-1">${allSelected ? 'Deselect all' : 'Select all'}</span>
          </button>
          <div class="flex-1"></div>
          <button class="btn btn-ghost text-sm" onclick="window.__app.toggleAccountMultiSelect()">Cancel</button>
          ${n > 0 ? `<button class="btn btn-outline text-rose-500 text-sm" onclick="${deleteAction}"><i data-lucide="trash-2"></i> Delete</button>` : ''}
        </div>
      </div>`;
  }

  #txTouchesAccount(t, accountId) {
    if (t.accountId === accountId) return true;
    if (Array.isArray(t.splits)) return t.splits.some((s) => (s.accountId || t.accountId) === accountId);
    return false;
  }

  /** Delegates to AccountService — single source of truth for ledger computation. */
  #ledgerSum(account, transactions) {
    return this.#accountService.ledgerSum(account, transactions);
  }

  #withinRange(iso, range) {
    if (range === 'all') return true;
    const days   = parseInt(range, 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return new Date(iso + 'T12:00:00') >= cutoff;
  }

  #accessLabel(perm) {
    const MAP = { owner: 'Owner', full: 'Full access', edit: 'Can edit', view: 'View only' };
    return MAP[perm] || perm;
  }
}
