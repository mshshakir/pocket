/**
 * TransactionsView — Full transaction list with search, filtering, sorting,
 * month-group headers, multi-select mode, and swipe-to-delete.
 *
 * Filter state lives on the view instance rather than as globals so multiple
 * view objects could theoretically coexist without side-effects.
 */
import { BaseView }               from './BaseView.js';
import { TransactionRowRenderer } from './TransactionRowRenderer.js';
import { TransactionService }     from '../../domain/services/TransactionService.js';
import { TX_SORT_OPTIONS }        from '../../data/constants.js';

export class TransactionsView extends BaseView {
  /** @type {TransactionRowRenderer} */ #rowRenderer;
  /** @type {TransactionService} */     #txService;

  // ── Filter state (persists across re-renders while view is mounted) ──
  #filter = {
    search:      '',
    range:       '30',
    dateFrom:    '',
    dateTo:      '',
    accountIds:  [],
    categoryIds: [],
    types:       [],
    paymentTypes:[],
    amountMin:   '',
    amountMax:   '',
    sort:        'date-desc',
  };
  #filterOpen   = false;
  #multiSelect  = false;
  #selectedIds  = new Set();
  #visibleIds   = [];

  constructor() {
    super();
    this.#rowRenderer = new TransactionRowRenderer();
    this.#txService   = new TransactionService();
  }

  // ── Public state ─────────────────────────────────────────────────────

  /** Expose filter and selection state to the Application layer. */
  get filter()       { return this.#filter; }
  get multiSelect()  { return this.#multiSelect; }
  get selectedIds()  { return this.#selectedIds; }
  get visibleIds()   { return this.#visibleIds; }

  toggleMultiSelect() {
    this.#multiSelect = !this.#multiSelect;
    this.#selectedIds.clear();
  }

  toggleSelection(id) {
    if (this.#selectedIds.has(id)) this.#selectedIds.delete(id);
    else this.#selectedIds.add(id);
  }

  selectAll()   { this.#visibleIds.forEach((id) => this.#selectedIds.add(id)); }
  deselectAll() { this.#selectedIds.clear(); }
  clearMultiSelect() { this.#multiSelect = false; this.#selectedIds.clear(); }

  setFilter(key, value) { this.#filter[key] = value; }
  toggleFilterItem(field, value) {
    const arr = this.#filter[field];
    const i = arr.indexOf(value);
    if (i >= 0) arr.splice(i, 1); else arr.push(value);
  }
  clearFilters() {
    Object.assign(this.#filter, {
      search: '', range: '30', dateFrom: '', dateTo: '',
      accountIds: [], categoryIds: [], types: [], paymentTypes: [],
      amountMin: '', amountMax: '',
    });
  }

  // ── BaseView contract ────────────────────────────────────────────────

  render() {
    const { state, homeCurrency: home } = this;
    const f = this.#filter;

    // ── Apply filters ─────────────────────────────────────────────────
    const fSearch  = f.search.toLowerCase();
    const fAmtMin  = f.amountMin !== '' ? this.toMinor(parseFloat(f.amountMin), home) : null;
    const fAmtMax  = f.amountMax !== '' ? this.toMinor(parseFloat(f.amountMax), home) : null;

    const filtered = this.#txService.sort(
      state.transactions.filter((t) => {
        if (f.dateFrom && t.date < f.dateFrom) return false;
        if (f.dateTo   && t.date > f.dateTo)   return false;
        if (!f.dateFrom && !f.dateTo && !this.#withinRange(t.date, f.range)) return false;
        if (f.accountIds.length   && !f.accountIds.includes(t.accountId))   return false;
        if (f.categoryIds.length  && !f.categoryIds.includes(t.categoryId)) return false;
        if (f.types.length        && !f.types.includes(t.type))             return false;
        if (f.paymentTypes.length && !f.paymentTypes.includes(t.paymentType)) return false;
        if (fSearch && !(
          (t.payee || '').toLowerCase().includes(fSearch) ||
          (t.note  || '').toLowerCase().includes(fSearch) ||
          (state.categories.find((c) => c.id === t.categoryId)?.name || '').toLowerCase().includes(fSearch)
        )) return false;
        if (fAmtMin !== null || fAmtMax !== null) {
          const amtH = Math.abs(this.convert(t.amount, t.currency, home));
          if (fAmtMin !== null && amtH < fAmtMin) return false;
          if (fAmtMax !== null && amtH > fAmtMax) return false;
        }
        return true;
      }),
      f.sort,
    );

    this.#visibleIds = filtered.map((t) => t.id);
    const sortKey     = f.sort || 'date-desc';
    const groupByDate = sortKey.startsWith('date-');

    // ── Day groups ────────────────────────────────────────────────────
    const dayGroups  = {};
    const monthTotals = {};
    if (groupByDate) {
      filtered.forEach((t) => {
        (dayGroups[t.date] = dayGroups[t.date] || []).push(t);
        const ym = t.date.slice(0, 7);
        if (!monthTotals[ym]) monthTotals[ym] = { income: 0, expense: 0 };
        const inHome = this.convert(t.amount, t.currency, home);
        if (t.type === 'income')  monthTotals[ym].income  += inHome;
        if (t.type === 'expense') monthTotals[ym].expense += inHome;
      });
    }

    // ── Active filter count ───────────────────────────────────────────
    const activeCount =
      f.accountIds.length + f.categoryIds.length +
      f.types.length + f.paymentTypes.length +
      (f.dateFrom ? 1 : 0) + (f.dateTo ? 1 : 0) +
      (f.amountMin ? 1 : 0) + (f.amountMax ? 1 : 0) +
      (f.range !== '30' && !f.dateFrom && !f.dateTo ? 1 : 0);

    return `
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl md:text-3xl font-semibold tracking-tight">Transactions</h1>
        <div class="flex gap-2">
          <button class="btn ${this.#multiSelect ? 'btn-primary' : 'btn-outline'}"
                  onclick="window.__app.toggleMultiSelect()" title="Select multiple">
            <i data-lucide="check-square"></i>
            <span class="hidden md:inline ml-1">Select</span>
          </button>
          <button class="btn btn-primary" onclick="window.__app.openModal('tx')">
            <i data-lucide="plus"></i> Add
          </button>
        </div>
      </div>

      ${this.#bulkBar()}
      ${this.#filterBar(f, activeCount, home)}
      ${this.#txList(filtered, dayGroups, monthTotals, groupByDate, sortKey)}
    `;
  }

  // ── Private render helpers ───────────────────────────────────────────

  #filterBar(f, activeCount, cur) {
    const accountOpts  = this.state.accounts.map((a)  => ({ value: a.id, label: a.name }));
    const categoryOpts = this.state.categories.map((c) => ({ value: c.id, label: c.name }));
    const typeOpts     = [
      { value: 'expense',  label: 'Expense' },
      { value: 'income',   label: 'Income'  },
      { value: 'transfer', label: 'Transfer'},
    ];
    const paymentTypes = [...new Set(this.state.transactions.map((t) => t.paymentType).filter(Boolean))];
    const paymentOpts  = paymentTypes.map((p) => ({
      value: p, label: p.charAt(0).toUpperCase() + p.slice(1),
    }));

    const allActiveChips = [
      ...f.accountIds.map((v)  => `<span class="chip">${this.escapeHtml(accountOpts.find((o)=>o.value===v)?.label||v)} <button onclick="window.__app.txFilterToggle('accountIds','${v}')">×</button></span>`),
      ...f.categoryIds.map((v) => `<span class="chip">${this.escapeHtml(categoryOpts.find((o)=>o.value===v)?.label||v)} <button onclick="window.__app.txFilterToggle('categoryIds','${v}')">×</button></span>`),
      ...f.types.map((v)       => `<span class="chip">${v.charAt(0).toUpperCase()+v.slice(1)} <button onclick="window.__app.txFilterToggle('types','${v}')">×</button></span>`),
      ...f.paymentTypes.map((v)=> `<span class="chip">${v.charAt(0).toUpperCase()+v.slice(1)} <button onclick="window.__app.txFilterToggle('paymentTypes','${v}')">×</button></span>`),
      f.dateFrom||f.dateTo ? `<span class="chip">${f.dateFrom||'…'} → ${f.dateTo||'…'} <button onclick="window.__app.txFilterClear('dates')">×</button></span>` : '',
      f.range!=='30'&&!f.dateFrom&&!f.dateTo ? `<span class="chip">${f.range==='all'?'All time':'Last '+f.range+'d'} <button onclick="window.__app.txFilterSet('range','30')">×</button></span>` : '',
      f.amountMin||f.amountMax ? `<span class="chip">${f.amountMin||'0'}–${f.amountMax||'∞'} ${cur} <button onclick="window.__app.txFilterClear('amounts')">×</button></span>` : '',
    ].filter(Boolean).join('');

    return `
      <div class="card mb-4">
        <div class="flex items-center gap-2 p-3">
          <div class="relative flex-1">
            <i data-lucide="search" class="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" style="width:15px;height:15px"></i>
            <input class="input pl-9" placeholder="Search payee, note or category…"
                   value="${this.escapeHtml(f.search)}"
                   oninput="window.__app.txFilterSet('search',this.value)" />
          </div>
          <button class="btn ${this.#filterOpen ? 'btn-primary' : 'btn-outline'} relative shrink-0"
                  onclick="window.__app.toggleTxFilterPanel()" title="Advanced filters">
            <i data-lucide="sliders-horizontal"></i>
            <span class="hidden md:inline ml-1">Filters</span>
            ${activeCount ? `<span class="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">${activeCount}</span>` : ''}
          </button>
          <select class="select w-auto shrink-0"
                  onchange="window.__app.txFilterSet('sort',this.value)" title="Sort">
            ${TX_SORT_OPTIONS.map(([v, l]) => `<option value="${v}" ${f.sort===v?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>

        ${this.#filterOpen ? this.#advancedFilterPanel(f, accountOpts, categoryOpts, typeOpts, paymentOpts, activeCount, cur) : ''}

        ${activeCount && !this.#filterOpen ? `
          <div class="border-t border-zinc-100 dark:border-zinc-800 px-3 py-1.5 flex flex-wrap gap-1.5 items-center">
            ${allActiveChips}
            <button class="text-xs text-zinc-400 hover:text-rose-500 ml-auto"
                    onclick="window.__app.clearTxFilters()">Clear all</button>
          </div>` : ''}
      </div>`;
  }

  #advancedFilterPanel(f, accountOpts, categoryOpts, typeOpts, paymentOpts, activeCount, cur) {
    return `
      <div class="border-t border-zinc-100 dark:border-zinc-800 p-3 grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Account <span class="font-normal opacity-60">(multi)</span></label>
          ${this.#multiChips('accountIds', accountOpts, f.accountIds, '＋ Add account…')}
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Category <span class="font-normal opacity-60">(multi)</span></label>
          ${this.#multiChips('categoryIds', categoryOpts, f.categoryIds, '＋ Add category…')}
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Type <span class="font-normal opacity-60">(multi)</span></label>
          ${this.#multiChips('types', typeOpts, f.types, '＋ Add type…')}
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Payment method <span class="font-normal opacity-60">(multi)</span></label>
          ${this.#multiChips('paymentTypes', paymentOpts, f.paymentTypes, '＋ Add method…')}
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Period</label>
          <select class="select" onchange="window.__app.txFilterSetRange(this.value)">
            ${[['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],['365','Last 12 months'],['all','All time']]
              .map(([v,l]) => `<option value="${v}" ${f.range===v?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Custom date range</label>
          <div class="flex gap-1 items-center">
            <input class="input flex-1" type="date" value="${f.dateFrom}" onchange="window.__app.txFilterSet('dateFrom',this.value)" title="From">
            <span class="text-zinc-400 text-xs">–</span>
            <input class="input flex-1" type="date" value="${f.dateTo}"   onchange="window.__app.txFilterSet('dateTo',this.value)"   title="To">
          </div>
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Min amount (${cur})</label>
          <input class="input" type="number" min="0" step="0.01" placeholder="0.00" value="${f.amountMin}" oninput="window.__app.txFilterSet('amountMin',this.value)">
        </div>
        <div>
          <label class="text-xs font-medium text-zinc-500 mb-1 block">Max amount (${cur})</label>
          <input class="input" type="number" min="0" step="0.01" placeholder="No limit" value="${f.amountMax}" oninput="window.__app.txFilterSet('amountMax',this.value)">
        </div>
        ${activeCount ? `
          <div class="md:col-span-2 pt-1 border-t border-zinc-100 dark:border-zinc-800">
            <button class="btn btn-outline text-rose-500 text-sm" onclick="window.__app.clearTxFilters()">
              <i data-lucide="x"></i> Clear all filters
            </button>
          </div>` : ''}
      </div>`;
  }

  #multiChips(field, options, selected, placeholder) {
    const remaining = options.filter((o) => !selected.includes(o.value));
    const chips = selected.map((v) => {
      const lbl = options.find((o) => o.value === v)?.label || v;
      return `<span class="chip" style="background:#f4f4f5">${this.escapeHtml(lbl)}<button type="button" onclick="window.__app.txFilterToggle('${field}','${v}')" style="margin-left:4px;opacity:.6" title="Remove">×</button></span>`;
    }).join('');
    const dropdown = remaining.length
      ? `<select class="select text-sm mt-1" onchange="if(this.value){window.__app.txFilterToggle('${field}',this.value);this.value=''}">
           <option value="">${placeholder}</option>
           ${remaining.map((o) => `<option value="${this.escapeHtml(o.value)}">${this.escapeHtml(o.label)}</option>`).join('')}
         </select>`
      : (selected.length ? `<div class="text-xs text-zinc-400 mt-1">All selected</div>` : '');
    return `<div class="flex flex-wrap gap-1 mb-0.5">${chips}</div>${dropdown}`;
  }

  #txList(filtered, dayGroups, monthTotals, groupByDate, sortKey) {
    if (filtered.length === 0) {
      return `
        <div class="card p-10 text-center">
          ${this.emptyState('No transactions found', 'Adjust filters or add a new one.')}
          <button class="btn btn-primary mt-4" onclick="window.__app.openModal('tx')">
            <i data-lucide="plus"></i> Add transaction
          </button>
        </div>`;
    }

    if (groupByDate) {
      const dateKeys = Object.keys(dayGroups);
      let prevMonth = null;
      return dateKeys.map((date) => {
        const ym     = date.slice(0, 7);
        const header = ym !== prevMonth ? this.#monthHeader(ym, monthTotals[ym]) : '';
        prevMonth    = ym;
        return `${header}
          <div class="mb-2">
            <div class="text-xs uppercase tracking-wider text-zinc-500 mb-1 px-1">${this.dateLabel(date)}</div>
            <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
              ${dayGroups[date].map((t) => this.#rowRenderer.render(t, {
                multiSelect: this.#multiSelect,
                selectedIds: this.#selectedIds,
              })).join('')}
            </div>
          </div>`;
      }).join('');
    }

    const sortLabel = TX_SORT_OPTIONS.find(([v]) => v === sortKey)?.[1] || 'Sorted';
    return `
      <div class="mb-4">
        <div class="text-xs uppercase tracking-wider text-zinc-500 mb-2 px-1">
          ${sortLabel} · ${filtered.length} result${filtered.length === 1 ? '' : 's'}
        </div>
        <div class="card divide-y divide-zinc-100 dark:divide-zinc-800">
          ${filtered.map((t) => this.#rowRenderer.render(t, {
            multiSelect: this.#multiSelect,
            selectedIds: this.#selectedIds,
          })).join('')}
        </div>
      </div>`;
  }

  #monthHeader(ym, tot) {
    if (!tot) return '';
    const [y, m] = ym.split('-').map(Number);
    const label  = new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const net    = tot.income - tot.expense;
    const home   = this.homeCurrency;
    return `
      <div class="month-divider flex items-center gap-2 my-3 px-1">
        <span class="text-xs font-semibold text-zinc-700 dark:text-zinc-300 shrink-0">${this.escapeHtml(label)}</span>
        <div class="flex-1 border-t border-zinc-200 dark:border-zinc-700"></div>
        ${tot.income  ? `<span class="text-xs text-emerald-600 dark:text-emerald-400 shrink-0">+${this.formatMoney(tot.income,  home)}</span>` : ''}
        ${tot.expense ? `<span class="text-xs text-rose-500 shrink-0">-${this.formatMoney(tot.expense, home)}</span>` : ''}
        <span class="text-xs ${net >= 0 ? 'text-zinc-500' : 'text-rose-500'} shrink-0">${net >= 0 ? 'net +' : 'net '}${this.formatMoney(Math.abs(net), home)}</span>
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
          <button class="btn btn-ghost text-sm px-2"
                  onclick="${allSelected ? 'window.__app.deselectAllTx()' : 'window.__app.selectAllTx()'}"
                  title="${allSelected ? 'Deselect all' : 'Select all'}">
            <i data-lucide="${allSelected ? 'square' : 'check-square'}"></i>
            <span class="hidden md:inline ml-1">${allSelected ? 'Deselect all' : 'Select all'}</span>
          </button>
          <div class="flex-1"></div>
          <button class="btn btn-ghost text-sm" onclick="window.__app.toggleMultiSelect()">Cancel</button>
          ${n > 0 ? `<button class="btn btn-outline text-rose-500 text-sm" onclick="window.__app.bulkDeleteTx()">
            <i data-lucide="trash-2"></i> Delete
          </button>` : ''}
        </div>
      </div>`;
  }

  #withinRange(iso, range) {
    if (range === 'all') return true;
    const days  = parseInt(range, 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return new Date(iso + 'T12:00:00') >= cutoff;
  }

  // ── Filter panel open/close toggled by Application ───────────────────
  toggleFilterPanel() { this.#filterOpen = !this.#filterOpen; }
  get filterOpen()    { return this.#filterOpen; }
}
