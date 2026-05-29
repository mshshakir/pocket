/**
 * TransactionModal — New / edit transaction form.
 *
 * Handles expense, income and transfer types; splits; recurring rules;
 * receipt scanning; shared-account context; and FX-rate panel for
 * cross-currency transfers.
 *
 * The modal follows the Strategy pattern: it is registered in Modal under
 * the name 'tx' and called via modal.open('tx', { id?, prefill? }).
 * All DOM interaction after render is handled through window.__app.* handlers.
 */
import { Store }               from '../../core/Store.js';
import { CurrencyService }     from '../../domain/services/CurrencyService.js';
import { HijriCalendarService } from '../../domain/services/HijriCalendarService.js';
import { CURRENCIES, ACCOUNT_TYPES } from '../../data/constants.js';

/** Payment methods available by default. */
const DEFAULT_PAYMENT_TYPES = ['card', 'cash', 'bank-transfer', 'cheque', 'crypto', 'other'];

/** Category icons available in the picker. */
const CATEGORY_ICONS = [
  'tag','utensils','car','shopping-bag','heart-pulse','home','film',
  'receipt','graduation-cap','banknote','briefcase','landmark','plane',
  'dumbbell','gift','baby','paw-print','wifi',
];

export class TransactionModal {
  /** @type {Store} */               #store;
  /** @type {CurrencyService} */     #fx;
  /** @type {HijriCalendarService} */ #hijri;

  // Per-open instance state
  #splits        = [];
  #splitsEnabled = false;
  #sharedTxMode  = null; // { shareIndex, accountId, editTxId? } | null
  #currentType   = null; // overrides data.type when user switches tabs
  #splitsSeeded  = false; // true after initial seed; prevents re-seed on refresh
  #scanData      = null; // { amount, categoryId, note } populated by applyScanResult for single-item scans

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
    this.#hijri = new HijriCalendarService();
  }

  // ── Public API (called by app.js) ────────────────────────────────────

  /** @returns {Array} current split rows */
  get splits()        { return this.#splits; }
  /** @returns {boolean} */
  get splitsEnabled() { return this.#splitsEnabled; }

  setType(type) { this.#currentType = type; }

  /** @returns {{shareIndex:number, accountId:string, editTxId?:string}|null} */
  get sharedTxMode() { return this.#sharedTxMode; }

  toggleSplits() {
    this.#splitsEnabled = !this.#splitsEnabled;
    if (this.#splitsEnabled && this.#splits.length === 0) {
      this.#splits.push({ categoryId: null, accountId: null, amount: 0 });
    }
  }

  addSplit(defaultAccountId = null) {
    this.#splits.push({ categoryId: null, accountId: defaultAccountId, amount: 0 });
  }

  removeSplit(i) {
    this.#splits.splice(i, 1);
    if (this.#splits.length === 0) this.#splitsEnabled = false;
  }

  setSplitField(i, field, val) {
    if (this.#splits[i]) this.#splits[i][field] = val;
  }

  setSplitAmount(i, val, currency) {
    if (this.#splits[i]) {
      this.#splits[i].amount = this.#fx.toMinor(Number(val) || 0, currency);
    }
  }

  /**
   * Apply AI receipt-scan results to the modal.
   * items: [{ description, amount, currency, categoryName, quantity, unit, note }]
   * amounts are expected in MAJOR decimal units (e.g. 4.99 not 499).
   */
  applyScanResult(items) {
    const state    = this.#store.getState();
    const homeCcy  = state.user.homeCurrency || 'USD';
    const expCats  = state.categories.filter((c) => c.type === 'expense' || !c.type);

    const parsed = items.map((item) => {
      const currency = item.currency || homeCcy;
      // amount from AI is in major units (e.g. 4.99); convert to minor (499)
      const amount   = this.#fx.toMinor(Number(item.amount) || 0, currency);

      // Match categoryName to a local category (case-insensitive partial match)
      const nameHint  = (item.categoryName || '').toLowerCase();
      const cat = nameHint
        ? expCats.find((c) => c.name.toLowerCase() === nameHint)
          || expCats.find((c) => c.name.toLowerCase().includes(nameHint) || nameHint.includes(c.name.toLowerCase()))
        : null;

      // Build note: description + quantity/unit details
      const noteParts = [item.description || ''];
      if (item.quantity) noteParts.push(item.quantity);
      if (item.unit && item.unit !== item.quantity) noteParts.push(item.unit);
      if (item.note)     noteParts.push(item.note);
      const note = [...new Set(noteParts.filter(Boolean))].join(' · ');

      return { categoryId: cat?.id || null, amount, note, currency };
    });

    if (parsed.length === 1) {
      // Single item: fill the main form fields, no splits needed
      this.#scanData      = parsed[0];
      this.#splitsEnabled = false;
      this.#splits        = [];
    } else {
      // Multiple items: enable splits
      this.#scanData      = null;
      this.#splitsEnabled = true;
      this.#splits        = parsed.map((p) => ({ categoryId: p.categoryId, amount: p.amount }));
    }
  }

  // ── Modal strategy contract ───────────────────────────────────────────

  render(opts = {}) {
    const { id, prefill, sharedTxMode } = opts;
    const state = this.#store.getState();

    this.#sharedTxMode = sharedTxMode || null;

    // For shared-mode edits, look up the tx in the shared snapshot
    const sharedEditTx = sharedTxMode?.editTxId
      ? (state._sharedData?.[sharedTxMode.shareIndex]?.transactions || [])
          .find((t) => t.id === sharedTxMode.editTxId)
      : null;

    const editing = id ? state.transactions.find((t) => t.id === id) : null;

    const data    = editing
      ? { ...editing }
      : sharedEditTx
        ? { ...sharedEditTx }
        : (prefill || {
            type:               'expense',
            amount:             0,
            currency:           state.user.defaultCurrency || state.user.homeCurrency,
            accountId:          state.accounts[0]?.id,
            categoryId:         '',
            payee:              '',
            note:               '',
            date:               new Date().toISOString().slice(0, 10),
            paymentType:        'card',
            transferToAccountId:'',
          });

    // Enrich transfer-edit: surface pair account
    if (editing?.type === 'transfer' && editing.transferPairId) {
      const pair = state.transactions.find((t) => t.id === editing.transferPairId);
      if (pair) data.transferToAccountId = pair.accountId;
    }

    // Seed splits only once per open session; subsequent refreshes keep in-memory state
    if (!this.#splitsSeeded) {
      this.#splits        = editing && Array.isArray(editing.splits)   ? editing.splits.map((s) => ({ ...s }))
                          : prefill && Array.isArray(prefill?.splits)  ? prefill.splits.map((s) => ({ ...s }))
                          : [];
      this.#splitsEnabled = this.#splits.length > 0;
      this.#splitsSeeded  = true;
    }

    // Overlay single-item scan data onto a new transaction's default fields
    if (this.#scanData && !editing) {
      if (this.#scanData.amount)     data.amount     = this.#scanData.amount;
      if (this.#scanData.categoryId) data.categoryId = this.#scanData.categoryId;
      if (this.#scanData.note)       data.note       = this.#scanData.note;
      if (this.#scanData.currency)   data.currency   = this.#scanData.currency;
    }

    const type        = this.#currentType || data.type || 'expense';
    const amountValue = (editing || sharedEditTx)
      ? this.#fx.fromMinor(data.amount, data.currency)
      : (data.amount ? this.#fx.fromMinor(data.amount, data.currency) : 0);
    const cats        = state.categories;
    const isSharedMode= !!this.#sharedTxMode;

    // Resolve the shared account object so we can show its name
    const sharedAccObj = isSharedMode
      ? (state._sharedData?.[this.#sharedTxMode.shareIndex]?.accounts || [])
          .find((a) => a.id === this.#sharedTxMode.accountId)
      : null;

    // Determine delete eligibility for shared-mode edit
    const sharedPerm   = isSharedMode
      ? (state._sharedData?.[this.#sharedTxMode.shareIndex]?.permission || {})[this.#sharedTxMode.accountId]
      : null;
    const canDeleteShared = isSharedMode && sharedEditTx && ['full', 'edit', 'owner'].includes(sharedPerm);
    const todayH      = this.#hijri.toHijri(data.date);
    const miqaat      = this.#hijri.topMiqaat(this.#hijri.miqaatsForGregorian(data.date));
    const hijriLabel  = this.#hijri.format(data.date, { long: true });
    const hijriPreview= `${hijriLabel}${miqaat ? ` · <span class="text-amber-600">${this.#esc(miqaat.t)}</span>` : ''}`;

    const paymentTypes = [
      ...DEFAULT_PAYMENT_TYPES,
      ...new Set(state.transactions.map((t) => t.paymentType).filter((p) => p && !DEFAULT_PAYMENT_TYPES.includes(p))),
    ];

    return `
      <form id="txForm" onsubmit="window.__app.submitTx(event,'${editing?.id || ''}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing || sharedEditTx ? 'Edit transaction' : 'New transaction'}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div class="grid grid-cols-3 gap-2 mb-4">
          ${['expense', 'income', 'transfer'].map((t) => `
            <button type="button" onclick="window.__app.setTxType('${t}')"
                    class="btn ${type === t ? 'btn-primary' : 'btn-outline'} justify-center">
              ${t.charAt(0).toUpperCase() + t.slice(1)}
            </button>`).join('')}
        </div>
        <input type="hidden" name="type" value="${type}">

        <div class="card-muted p-3 mb-3">
          <div class="text-xs text-zinc-500 mb-1">Amount</div>
          <div class="flex gap-2 items-center">
            <input class="input text-2xl font-semibold border-0 bg-transparent p-0 focus:ring-0"
                   style="border:none" name="amount" type="number" step="0.01" required
                   value="${amountValue || ''}" placeholder="0.00" autofocus
                   oninput="window.__app.updateTransferFxPanel(false)">
            <select class="select w-24" name="currency" onchange="window.__app.updateTransferFxPanel(false)">
              ${CURRENCIES.map((c) => `<option value="${c}" ${data.currency===c?'selected':''}>${this.#fx.label(c).split('—')[0].trim()}</option>`).join('')}
            </select>
          </div>
        </div>

        ${type === 'transfer' ? this.#transferFields(data, state) : ''}
        ${type !== 'transfer' && this.#splitsEnabled ? this.#splitsArea(data, cats, type, state.accounts, amountValue) : ''}
        ${type !== 'transfer' && !this.#splitsEnabled ? this.#accountCategoryFields(data, state, cats, type, isSharedMode) : ''}

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Date</label>
            <input class="input" type="date" name="date" value="${data.date}"
                   oninput="window.__app.updateHijriPreview(this.value)">
            <div id="hijriPreview" class="text-xs text-zinc-500 mt-1">${hijriPreview}</div>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Payment</label>
            <select class="select" name="paymentType">
              ${paymentTypes.map((p) => `<option value="${p}" ${data.paymentType===p?'selected':''}>${p.charAt(0).toUpperCase()+p.slice(1)}</option>`).join('')}
              <option value="__add_payment__">＋ Add custom…</option>
            </select>
          </div>
        </div>

        ${type !== 'transfer' ? this.#recurringSection(data) : ''}

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Payee / merchant</label>
          <input class="input" name="payee" value="${this.#esc(data.payee || '')}"
                 oninput="window.__app.suggestCategory(this.value)"
                 placeholder="e.g. Whole Foods">
          <div id="catSuggest" class="text-xs text-emerald-600 mt-1"></div>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Note</label>
          <textarea class="textarea" name="note" rows="2" placeholder="optional...">${this.#esc(data.note || '')}</textarea>
        </div>

        <div class="mb-4">
          <label class="text-xs text-zinc-500">Receipt (optional)</label>
          <label class="card-muted flex items-center gap-3 p-3 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl">
            <div class="icon-pill" style="background:#8b5cf622;color:#8b5cf6;flex-shrink:0"><i data-lucide="scan-line"></i></div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium">${state.user.geminiApiKey ? 'Scan receipt with Gemini AI' : 'Scan receipt with AI'}</div>
              <div class="text-xs text-zinc-500">${state.user.geminiApiKey ? 'Reads items · assigns your categories · pre-fills splits' : 'Add free Google AI key in Settings to enable'}</div>
            </div>
            <input type="file" accept="image/*,application/pdf" class="hidden" onchange="window.__app.scanReceipt(this)">
            <i data-lucide="chevron-right" class="text-zinc-400" style="flex-shrink:0"></i>
          </label>
        </div>

        ${editing?.createdAt ? `<div class="text-xs text-zinc-400 mb-3">Entered ${new Date(editing.createdAt).toLocaleString()}${editing.addedBy ? ` by ${this.#esc(editing.addedBy)}` : ''}</div>` : ''}

        <div class="flex items-center gap-2">
          ${editing
            ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteTx('${editing.id}')"><i data-lucide="trash-2"></i> Delete</button>`
            : canDeleteShared
              ? `<button type="button" class="btn btn-outline text-rose-500"
                         onclick="window.__app.deleteSharedTxContrib(${this.#sharedTxMode.shareIndex},'${sharedEditTx.id}')">
                   <i data-lucide="trash-2"></i> Delete
                 </button>`
              : ''}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary"><i data-lucide="check"></i> Save</button>
        </div>
      </form>`;
  }

  onOpen(opts, card) {
    // Reset type override so fresh opens start from data.type / 'expense'
    this.#currentType   = null;
    this.#splits        = [];
    this.#splitsEnabled = false;
    this.#splitsSeeded  = false;
    this.#scanData      = null;
    // Initialize FX panel if transfer
    const data = opts?.prefill || {};
    if (data.type === 'transfer') {
      setTimeout(() => window.__app?.updateTransferFxPanel?.(false), 0);
    }
  }

  // ── Private render helpers ────────────────────────────────────────────

  #transferFields(data, state) {
    return `
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="text-xs text-zinc-500">Account</label>
          <select class="select" name="accountId" onchange="window.__app.updateTransferFxPanel(false)">
            ${state.accounts.map((a) => `<option value="${a.id}" ${data.accountId===a.id?'selected':''}>${this.#esc(a.name)} · ${a.currency}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-zinc-500">To account</label>
          <select class="select" name="transferToAccountId" onchange="window.__app.updateTransferFxPanel(false)">
            ${state.accounts.map((a) => `<option value="${a.id}" ${data.transferToAccountId===a.id?'selected':''}>${this.#esc(a.name)} · ${a.currency}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="fxPanel" class="card-muted p-3 mb-3" style="display:none">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs text-zinc-500 uppercase tracking-wider">Exchange rate</div>
          <button type="button" class="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  onclick="window.__app.resetTransferFx()" title="Reset to auto rate">
            <i data-lucide="refresh-cw" style="width:11px;height:11px;display:inline"></i> Use auto
          </button>
        </div>
        <div class="flex items-center gap-2 mb-2 text-sm">
          <span>1 <span id="fxFromCcy" class="font-medium"></span> =</span>
          <input class="input flex-1 max-w-[140px]" type="number" step="any" min="0"
                 name="transferRate" id="fxRate"
                 oninput="window.__app.updateTransferFxPanel(true)" placeholder="0.00">
          <span class="font-medium" id="fxToCcy"></span>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs text-zinc-500">You'll receive</div>
            <div class="text-lg font-semibold" id="fxToAmount">—</div>
          </div>
          <div class="text-xs text-zinc-400 text-right max-w-[55%]" id="fxRateNote"></div>
        </div>
      </div>`;
  }

  #accountCategoryFields(data, state, cats, type, isSharedMode) {
    const sharedOpts = (state._sharedData || []).flatMap((share) =>
      (share.accounts || [])
        .filter((a) => (share.permission || {})[a.id] !== 'view')
        .map((a) => `<option value="${a.id}" ${data.accountId===a.id?'selected':''}>${this.#esc(a.name)} (shared)</option>`),
    ).join('');

    const sharedAccName = isSharedMode
      ? (state._sharedData?.[this.#sharedTxMode.shareIndex]?.accounts || [])
          .find((a) => a.id === this.#sharedTxMode.accountId)?.name || 'Shared account'
      : null;

    const accountSelect = isSharedMode
      ? `<input type="hidden" name="accountId" value="${this.#sharedTxMode.accountId}">
         <div class="select flex items-center gap-2 text-zinc-500" style="cursor:default">
           <i data-lucide="lock" style="width:13px;height:13px;flex-shrink:0"></i>
           <span class="truncate">${this.#esc(sharedAccName)}</span>
         </div>`
      : `<select class="select" name="accountId" onchange="window.__app.onTxAccountChange(this.value)">
           <optgroup label="My accounts">
             ${state.accounts.map((a) => `<option value="${a.id}" ${data.accountId===a.id?'selected':''}>${this.#esc(a.name)}</option>`).join('')}
           </optgroup>
           ${sharedOpts ? `<optgroup label="Shared with me">${sharedOpts}</optgroup>` : ''}
         </select>`;

    const filteredCats = cats.filter((c) => c.type === type);

    return `
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div><label class="text-xs text-zinc-500">Account</label>${accountSelect}</div>
        <div>
          <div class="flex items-center justify-between">
            <label class="text-xs text-zinc-500">Category</label>
            <button type="button" onclick="window.__app.toggleSplits()"
                    class="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
              <i data-lucide="split" style="width:11px;height:11px;display:inline"></i> Split
            </button>
          </div>
          <select class="select" name="categoryId">
            <option value="">— Uncategorised —</option>
            ${this.#categoryOptions(cats, data.categoryId, type)}
          </select>
        </div>
      </div>`;
  }

  #splitsArea(data, cats, type, accounts = [], totalMajor = 0) {
    const filteredCats = cats.filter((c) => c.type === type);
    const currency     = data.currency || 'USD';

    // Compute running sum of splits in major units
    const splitSum = this.#splits.reduce((s, sp) => s + this.#fx.fromMinor(sp.amount || 0, currency), 0);
    const diff     = totalMajor - splitSum;
    const diffAbs  = Math.abs(diff);
    const diffFmt  = this.#fx.formatMoney(this.#fx.toMinor(diffAbs, currency), currency);

    let diffHtml = '';
    if (Math.abs(diff) >= 0.005) {
      const over  = diff < 0;
      const color = over ? 'text-rose-500' : 'text-amber-500';
      const label = over
        ? `<span class="${color} font-medium">${diffFmt} over</span>`
        : `<span class="${color} font-medium">${diffFmt} remaining</span>`;
      diffHtml = `<div class="flex items-center gap-1 text-xs mt-1">${label}</div>`;
    } else {
      diffHtml = `<div class="flex items-center gap-1 text-xs mt-1 text-emerald-500"><i data-lucide="check" style="width:11px;height:11px"></i> Splits match total</div>`;
    }

    const sumFmt   = this.#fx.formatMoney(this.#fx.toMinor(splitSum, currency), currency);
    const totalFmt = this.#fx.formatMoney(this.#fx.toMinor(totalMajor, currency), currency);

    return `
      <input type="hidden" name="accountId" value="${data.accountId || ''}">
      <div class="mb-3">
        <div class="flex items-center justify-between mb-1">
          <label class="text-xs text-zinc-500 uppercase tracking-wider">Split entries</label>
          <button type="button" onclick="window.__app.toggleSplits()"
                  class="text-xs text-rose-500 hover:text-rose-700">
            <i data-lucide="x" style="width:11px;height:11px;display:inline"></i> Remove splits
          </button>
        </div>

        <!-- Total vs split sum tracker -->
        <div class="card-muted rounded-xl px-3 py-2 mb-2 flex items-center justify-between">
          <div class="text-xs text-zinc-500">Split total</div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold">${sumFmt}</span>
            <span class="text-xs text-zinc-400">of</span>
            <span class="text-sm font-semibold">${totalFmt}</span>
          </div>
        </div>
        ${diffHtml}

        <div id="splitsContainer" class="space-y-2 mt-2">
          ${this.#splits.map((s, i) => this.#splitRow(s, i, filteredCats, currency, accounts, data.accountId)).join('')}
        </div>
        <button type="button" onclick="window.__app.addSplit('${this.#esc(data.accountId || '')}')"
                class="btn btn-ghost text-xs mt-2 w-full border border-dashed border-zinc-300 dark:border-zinc-700">
          <i data-lucide="plus" style="width:13px;height:13px"></i> Add split
        </button>
      </div>`;
  }

  #splitRow(s, i, cats, currency, accounts = [], defaultAccountId = null) {
    const accId = s.accountId || defaultAccountId || '';
    return `
      <div class="card-muted rounded-xl p-2 space-y-1.5">
        <div class="flex gap-2">
          <select class="select text-sm flex-1" name="split_cat_${i}"
                  onchange="window.__app.setSplitField(${i},'categoryId',this.value)">
            <option value="">— Uncategorised —</option>
            ${cats.map((c) => `<option value="${c.id}" ${s.categoryId===c.id?'selected':''}>${this.#esc(c.name)}</option>`).join('')}
          </select>
          <button type="button" onclick="window.__app.removeSplit(${i})"
                  class="btn btn-ghost text-rose-500 flex-shrink-0 px-2">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i>
          </button>
        </div>
        <div class="flex gap-2">
          <select class="select text-sm flex-1" name="split_acc_${i}"
                  onchange="window.__app.setSplitField(${i},'accountId',this.value)">
            ${accounts.map((a) => `<option value="${a.id}" ${accId===a.id?'selected':''}>${this.#esc(a.name)}</option>`).join('')}
          </select>
          <input class="input text-sm w-28 flex-shrink-0" type="number" step="0.01" placeholder="0.00"
                 name="split_amt_${i}"
                 value="${s.amount ? this.#fx.fromMinor(s.amount, currency) : ''}"
                 oninput="window.__app.setSplitAmount(${i},this.value,'${currency}')">
        </div>
      </div>`;
  }

  #recurringSection(data) {
    const hasRecurring = !!data.recurring;
    return `
      <div class="card-muted p-3 mb-3">
        <label class="flex items-center gap-2 text-sm cursor-pointer ${hasRecurring ? 'mb-2' : ''}">
          <input type="checkbox" name="recurringEnabled" ${hasRecurring ? 'checked' : ''}
                 onchange="window.__app.toggleRecurringFields(this.checked)">
          <i data-lucide="repeat" style="width:13px;height:13px"></i>
          <span class="font-medium">Repeat automatically</span>
        </label>
        <div id="recurringFields" class="${hasRecurring ? '' : 'hidden'}">
          <div class="grid grid-cols-3 gap-2 mb-1">
            <select class="select" name="recurringRule">
              ${['daily','weekly','monthly','yearly'].map((r) => `<option value="${r}" ${data.recurring?.rule===r?'selected':''}>${r}</option>`).join('')}
            </select>
            <input class="input" type="number" name="recurringInterval" min="1" step="1"
                   value="${data.recurring?.interval || 1}" title="Every N units">
            <input class="input" type="date" name="recurringUntil"
                   value="${data.recurring?.until || ''}" title="Until (optional)">
          </div>
          <div class="text-xs text-zinc-500">Interval + optional end date. Instances are generated on each app load.</div>
        </div>
      </div>`;
  }

  #categoryOptions(allCats, selectedId, typeFilter) {
    const matchType = (c) => !typeFilter || c.type === typeFilter;
    const roots     = allCats.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name));
    let out = '';
    for (const root of roots) {
      const children = allCats.filter((c) => c.parentId === root.id && matchType(c));
      if (children.length > 0) {
        out += `<optgroup label="${this.#esc(root.name)}">`;
        children.forEach((c) => { out += `<option value="${c.id}" ${c.id===selectedId?'selected':''}>${this.#esc(c.name)}</option>`; });
        out += `</optgroup>`;
      } else if (matchType(root)) {
        out += `<option value="${root.id}" ${root.id===selectedId?'selected':''}>${this.#esc(root.name)}</option>`;
      }
    }
    return out;
  }

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
