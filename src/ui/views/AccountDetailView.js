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
import { ReportService }          from '../../domain/services/ReportService.js';
import { TX_SORT_OPTIONS }        from '../../data/constants.js';

export class AccountDetailView extends BaseView {
  /** @type {TransactionRowRenderer} */ #rowRenderer;
  /** @type {TransactionService} */     #txService;
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
    this.#rowRenderer = new TransactionRowRenderer();
    this.#txService   = new TransactionService();
    this.#reports     = new ReportService();
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
      if (imp.dir === '+') { lifetimeIn  += imp.minorInAcc; if (new Date(t.date) >= ms) mthIn  += imp.minorInAcc; }
      if (imp.dir === '-') { lifetimeOut += imp.minorInAcc; if (new Date(t.date) >= ms) mthOut += imp.minorInAcc; }
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
    allTxs.forEach((t) => {
      const ym = t.date.slice(0, 7);
      if (!monthlyInOut[ym]) monthlyInOut[ym] = { income: 0, expense: 0 };
      const imp = this.#txService.impactOnAccount(t, a);
      if (imp.dir === '+') monthlyInOut[ym].income  += imp.minorInAcc;
      else if (imp.dir === '-') monthlyInOut[ym].expense += imp.minorInAcc;
    });

    // ── New-tx prefill ─────────────────────────────────────────────────
    const newTxPrefill = JSON.stringify({
      type: 'expense', accountId: a.id, currency: a.currency,
      date: new Date().toISOString().slice(0, 10), paymentType: 'card',
    }).replace(/'/g, '&#39;');

    const newTxBtn = canAdd
      ? (isShared
          ? `<button class="btn btn-primary" onclick="window.__app.openSharedTxModal(${shareIndex},'${a.id}')"><i data-lucide="plus"></i><span class="hidden md:inline ml-1">New</span></button>`
          : `<button class="btn btn-primary" onclick="window.__app.openModal('tx',{prefill:${newTxPrefill}})"><i data-lucide="plus"></i><span class="hidden md:inline ml-1">New</span></button>`)
      : '';

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
        ${isShared ? `<button class="btn btn-outline" onclick="window.__app.refreshSharedAccount(this)" title="Refresh"><i data-lucide="refresh-cw"></i><span class="hidden md:inline ml-1">Refresh</span></button>` : ''}
        ${(canManage || canDelete) ? `<button class="btn ${this.#multiSelect ? 'btn-primary' : 'btn-outline'}" onclick="window.__app.toggleAccountMultiSelect()" title="Select multiple"><i data-lucide="check-square"></i></button>` : ''}
        ${canManage ? `<button class="btn btn-outline" onclick="window.__app.openModal('account',{id:'${a.id}'})"><i data-lucide="pencil"></i><span class="hidden md:inline ml-1">Edit</span></button>` : ''}
        ${newTxBtn}
      </div>

      ${this.#bulkBar()}

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
        ${tot.income  ? `<span class="text-xs text-emerald-600 dark:text-emerald-400 shrink-0">+${this.formatMoney(tot.income,  a.currency)}</span>` : ''}
        ${tot.expense ? `<span class="text-xs text-rose-500 shrink-0">-${this.formatMoney(tot.expense, a.currency)}</span>` : ''}
      </div>`;
  }

  #monthlyView(a, transactions) {
    const all     = transactions.filter((t) => this.#txTouchesAccount(t, a.id));
    const home    = this.homeCurrency;
    const byMonth = {};
    let running   = 0;
    const sorted  = all.slice().sort((x, y) => x.date.localeCompare(y.date));
    sorted.forEach((t) => {
      const ym  = t.date.slice(0, 7);
      const imp = this.#txService.impactOnAccount(t, a);
      if (!byMonth[ym]) byMonth[ym] = { income: 0, expense: 0, endBalance: 0 };
      if (imp.dir === '+') { running += imp.minorInAcc; byMonth[ym].income  += imp.minorInAcc; }
      if (imp.dir === '-') { running -= imp.minorInAcc; byMonth[ym].expense += imp.minorInAcc; }
      byMonth[ym].endBalance = running;
    });
    const months = Object.keys(byMonth).sort().reverse();
    if (!months.length) return `<div class="card p-8 text-center">${this.emptyState('No transactions yet', '')}</div>`;
    return `
      <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
        ${months.map((ym) => {
          const r = byMonth[ym];
          const [y, m] = ym.split('-').map(Number);
          const label  = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
          return `
            <div class="flex items-center gap-3 px-4 py-3">
              <div class="flex-1">
                <div class="font-medium text-sm">${this.escapeHtml(label)}</div>
                <div class="text-xs text-zinc-500">
                  <span class="text-emerald-500">+${this.formatMoney(r.income, a.currency)}</span> in
                  · <span class="text-rose-500">-${this.formatMoney(r.expense, a.currency)}</span> out
                </div>
              </div>
              <div class="text-right">
                <div class="text-sm font-semibold ${r.endBalance < 0 ? 'text-rose-500' : ''}">${this.formatMoney(r.endBalance, a.currency)}</div>
                <div class="text-xs text-zinc-500">end balance</div>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  #bulkBar() {
    if (!this.#multiSelect) return '';
    const n          = this.#selectedIds.size;
    const allSelected = this.#visibleIds.length > 0 && this.#visibleIds.every((id) => this.#selectedIds.has(id));
    return `
      <div class="fixed bottom-20 md:bottom-6 left-0 right-0 flex justify-center z-40 px-4">
        <div class="card flex items-center gap-2 px-3 py-3 shadow-2xl" style="max-width:520px;width:100%">
          <span class="text-sm font-medium">${n} selected</span>
          <button class="btn btn-ghost text-sm px-2" onclick="${allSelected ? 'window.__app.deselectAllAccTx()' : 'window.__app.selectAllAccTx()'}">
            <i data-lucide="${allSelected ? 'square' : 'check-square'}"></i>
            <span class="hidden md:inline ml-1">${allSelected ? 'Deselect all' : 'Select all'}</span>
          </button>
          <div class="flex-1"></div>
          <button class="btn btn-ghost text-sm" onclick="window.__app.toggleAccountMultiSelect()">Cancel</button>
          ${n > 0 ? `<button class="btn btn-outline text-rose-500 text-sm" onclick="window.__app.bulkDeleteAccTx()"><i data-lucide="trash-2"></i> Delete</button>` : ''}
        </div>
      </div>`;
  }

  #txTouchesAccount(t, accountId) {
    if (t.accountId === accountId) return true;
    if (Array.isArray(t.splits)) return t.splits.some((s) => (s.accountId || t.accountId) === accountId);
    return false;
  }

  #ledgerSum(account, transactions) {
    let sum = 0;
    for (const t of transactions) {
      if (!this.#txTouchesAccount(t, account.id)) continue;
      const imp = this.#txService.impactOnAccount(t, account);
      if (imp.dir === '+') sum += imp.minorInAcc;
      else if (imp.dir === '-') sum -= imp.minorInAcc;
    }
    return sum;
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
