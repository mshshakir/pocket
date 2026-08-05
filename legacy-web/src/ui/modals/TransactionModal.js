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
import { Store }                    from '../../core/Store.js';
import { CurrencyService }          from '../../domain/services/CurrencyService.js';
import { HijriCalendarService }     from '../../domain/services/HijriCalendarService.js';
import { CategoryField }            from '../components/CategoryField.js';
import { CURRENCIES, ACCOUNT_TYPES } from '../../data/constants.js';
import { DateService }              from '../../domain/services/DateService.js';
import { Html }                     from '../../core/Html.js';

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

  /**
   * Live form values captured immediately before a re-render, merged over the
   * modal's source data by render(). Anything that re-renders the modal
   * mid-edit (toggling splits, switching type, adding a payment method,
   * nudging the Hijri offset) would otherwise reset the form to its opening
   * state and silently discard whatever the user had typed.
   * @type {object}
   */
  #draft = {};

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

  setType(type) {
    this.#currentType = type;
    // A category belongs to exactly one type, so a leftover expense category
    // must not survive a switch to income (and vice versa).
    const cat = this.#draft.categoryId
      ? this.#store.getState().categories.find((c) => c.id === this.#draft.categoryId)
      : null;
    if (cat && cat.type !== type) this.#draft.categoryId = '';
  }

  /** @returns {{shareIndex:number, accountId:string, editTxId?:string}|null} */
  get sharedTxMode() { return this.#sharedTxMode; }

  /**
   * Snapshot the live #txForm into the draft. Call this immediately before any
   * re-render of the modal; render() then merges the draft back over the
   * underlying transaction so the user's in-progress edits survive.
   *
   * Split rows are NOT captured here — their category, account and amount are
   * already pushed into #splits by their own change handlers.
   */
  captureForm() {
    const form = document.getElementById('txForm');
    if (!form) return;

    const fd  = new FormData(form);
    const has = (k) => fd.get(k) !== null;
    const str = (k) => (fd.get(k) ?? '').toString();

    const currency = has('currency') ? str('currency') : this.#draft.currency;
    if (currency) this.#draft.currency = currency;

    // The form holds major units; the model holds minor units.
    if (has('amount')) {
      const raw = str('amount').trim();
      this.#draft.amount = raw === '' ? 0 : this.#fx.toMinor(Number(raw) || 0, currency || 'USD');
      this.#draft.amountRaw = raw; // preserves a half-typed "12." exactly as shown
    }

    for (const key of ['accountId', 'categoryId', 'payee', 'note', 'date',
                       'paymentType', 'transferToAccountId']) {
      if (has(key)) this.#draft[key] = str(key);
    }

    // FX rates are only meaningful when the user actually entered one.
    for (const key of ['transferRate', 'txFxRate']) {
      if (has(key)) {
        const n = parseFloat(str(key));
        if (n > 0) this.#draft[key] = n;
        else delete this.#draft[key];
      }
    }

    this.#draft.recurring = form.elements?.recurringEnabled?.checked
      ? {
          rule:     form.elements.recurringRule?.value            || 'monthly',
          interval: Number(form.elements.recurringInterval?.value) || 1,
          until:    form.elements.recurringUntil?.value           || null,
        }
      : null;
  }

  /** Discard the captured draft (used when the modal opens fresh). */
  clearDraft() { this.#draft = {}; }

  /**
   * Force the payment method in the draft — used after the manage sheet renames
   * or deletes the method the form had selected, so the next render shows the
   * surviving name instead of falling back to the default.
   * @param {string} name
   */
  setPaymentType(name) {
    if (name) this.#draft.paymentType = name;
  }

  toggleSplits() {
    this.#splitsEnabled = !this.#splitsEnabled;
    if (this.#splitsEnabled && this.#splits.length === 0) {
      // Seed two rows matching the reference — both default to the current account
      const accId = document.querySelector('[name=accountId]')?.value ||
                    this.#store.getState().accounts[0]?.id || null;
      this.#splits.push(
        { categoryId: null, accountId: accId, amount: 0 },
        { categoryId: null, accountId: accId, amount: 0 },
      );
    }
    if (!this.#splitsEnabled) this.#splits = [];
  }

  addSplit(defaultAccountId = null) {
    // Prefer the last split's account, then the passed default, then the first account
    const accId = this.#splits[this.#splits.length - 1]?.accountId ||
                  defaultAccountId ||
                  this.#store.getState().accounts[0]?.id || null;
    this.#splits.push({ categoryId: null, accountId: accId, amount: 0 });
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

    let editing = id ? state.transactions.find((t) => t.id === id) : null;

    // A transfer is two legs; always edit from the OUT leg so the From/To
    // accounts and rate map correctly and saving can't reverse the flow.
    // Opening the IN leg would otherwise show source/destination swapped.
    if (editing && editing.type === 'transfer' && editing.transferDir === 'in' && editing.transferPairId) {
      const outLeg = state.transactions.find((t) => t.id === editing.transferPairId);
      if (outLeg) editing = outLeg;
    }

    const data    = editing
      ? { ...editing }
      : sharedEditTx
        ? { ...sharedEditTx }
        : (prefill ? { ...prefill } : {
            type:               'expense',
            amount:             0,
            currency:           state.user.defaultCurrency || state.user.homeCurrency,
            accountId:          state.accounts[0]?.id,
            categoryId:         '',
            payee:              '',
            note:               '',
            date:               DateService.todayIso(),
            paymentType:        'card',
            transferToAccountId:'',
          });

    // Enrich transfer-edit: surface pair account and stored exchange rate
    if (editing?.type === 'transfer' && editing.transferPairId) {
      const pair = state.transactions.find((t) => t.id === editing.transferPairId);
      if (pair) {
        data.transferToAccountId = pair.accountId;
        // Preserve the rate the user manually set when originally saving
        if (!data.transferRate && editing.currency !== pair.currency && editing.amount && pair.amount) {
          const storedRate = this.#fx.fromMinor(pair.amount, pair.currency) /
                             this.#fx.fromMinor(editing.amount, editing.currency);
          data.transferRate = storedRate;
        }
      }
    }

    // Enrich foreign-currency single-account edit: derive the rate that was
    // actually booked (from the frozen acctMinor) so the FX panel shows it
    // rather than snapping back to the live auto rate.
    if (editing && editing.type !== 'transfer' && !data.txFxRate && Number.isFinite(editing.acctMinor) && editing.amount) {
      const acc = state.accounts.find((a) => a.id === editing.accountId);
      if (acc && acc.currency !== editing.currency) {
        data.txFxRate = this.#fx.fromMinor(editing.acctMinor, acc.currency) /
                        this.#fx.fromMinor(editing.amount, editing.currency);
      }
    }

    // Merge the in-progress edits captured before the last re-render. This runs
    // AFTER the transfer/FX enrichment above so a rate the user actually typed
    // beats the one derived from the stored transaction.
    Object.assign(data, this.#draft);

    // Seed splits only once per open session; subsequent refreshes keep in-memory state
    if (!this.#splitsSeeded) {
      this.#splits        = editing && Array.isArray(editing.splits)   ? editing.splits.map((s) => ({ ...s }))
                          : prefill && Array.isArray(prefill?.splits)  ? prefill.splits.map((s) => ({ ...s }))
                          : [];
      this.#splitsEnabled = this.#splits.length > 0;
      this.#splitsSeeded  = true;
    }

    const type = this.#currentType || data.type || 'expense';
    // A captured draft wins and is echoed back verbatim, so a half-typed
    // "12." or "0.5" reappears exactly as the user left it.
    const amountValue = this.#draft.amountRaw !== undefined
      ? this.#draft.amountRaw
      // A stored transaction holds amount in MINOR units → convert to major for
      // the input. A prefill (receipt scan / voice) or the empty default already
      // carries amount in MAJOR units, so it must NOT be divided again — doing so
      // turned "200" into "2.00".
      : (editing || sharedEditTx)
        ? this.#fx.fromMinor(data.amount, data.currency)
        : (data.amount || 0);
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

    // Pre-compute payment type options to avoid triple-nested template literals
    // which cause a parse error in some V8/Node versions (Bug #Bug).
    const current      = data.paymentType || 'card';
    const offeredTypes = window.__app?.paymentTypeService?.allTypes() || DEFAULT_PAYMENT_TYPES;
    // A transaction may carry a method that is no longer offered — imported from
    // CSV, or deleted since. Keep it in the list so simply opening the record
    // doesn't silently re-assign it to something else.
    const paymentTypes = offeredTypes.includes(current) ? offeredTypes : [current, ...offeredTypes];
    // Mobile-style tappable chips (replaces the native <select>). A hidden input
    // named "paymentType" carries the value into FormData; captureForm() reads it
    // so a selection survives modal re-renders. Add/Manage reuse the sheet flow.
    const payChipCls = (on) => 'px-3 py-1.5 rounded-full border text-sm ' + (on
      ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-white dark:text-zinc-900'
      : 'border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800');
    const paymentChips = paymentTypes.map((p) => {
      const label = p.charAt(0).toUpperCase() + p.slice(1);
      return `<button type="button" data-pay-chip="${this.#esc(p)}"`
        + ` onclick="window.__app.pickPaymentType('${Html.js(p)}')"`
        + ` class="${payChipCls(current === p)}">${this.#esc(label)}</button>`;
    }).join('');

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
                   style="border:none" name="amount" type="number" step="${CurrencyService.stepFor(data.currency)}" required
                   value="${amountValue || ''}" placeholder="0.00" autofocus
                   oninput="window.__app.onTxFormChange()">
            ${this.#currencyControl(data, state, type, isSharedMode)}
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
            <div id="hijriDatePreview" class="text-xs text-zinc-500 mt-1">${hijriPreview}</div>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Payment</label>
            <input type="hidden" name="paymentType" id="paymentTypeInput" value="${this.#esc(current)}">
            <div class="flex flex-wrap gap-2 mt-1">
              ${paymentChips}
              <button type="button" onclick="window.__app.pickPaymentType('__add_payment__')"
                class="px-3 py-1.5 rounded-full border border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500">＋ Add</button>
              <button type="button" onclick="window.__app.pickPaymentType('__manage_payment__')"
                class="px-3 py-1.5 rounded-full border border-dashed border-zinc-300 dark:border-zinc-700 text-sm text-zinc-500">⚙ Manage</button>
            </div>
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
              <div class="text-sm font-medium scan-label-text">${state.user.geminiApiKey ? 'Scan receipt with Gemini AI' : 'Scan receipt with AI'}</div>
              <div class="text-xs text-zinc-500">${state.user.geminiApiKey ? 'Reads items · assigns your categories · pre-fills splits' : 'Add free Google AI key in Settings to enable'}</div>
            </div>
            <input type="file" accept="image/*,application/pdf" class="hidden" onchange="window.__app.scanReceipt(this)">
            <i data-lucide="chevron-right" class="text-zinc-400" style="flex-shrink:0"></i>
          </label>
        </div>

        <div class="mb-4">
          <label class="text-xs text-zinc-500">Voice (optional)</label>
          <button type="button" onclick="window.__app.voiceEntry(this)"
                  class="card-muted flex items-center gap-3 p-3 cursor-pointer hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl w-full text-left">
            <div class="icon-pill" style="background:#10b98122;color:#10b981;flex-shrink:0"><i data-lucide="mic"></i></div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium voice-label-text">🎤 Speak the transaction</div>
              <div class="text-xs text-zinc-500">${state.user.geminiApiKey ? 'e.g. “spent 40 dirhams on groceries at Carrefour yesterday”' : 'Add free Google AI key in Settings to enable'}</div>
            </div>
            <i data-lucide="chevron-right" class="text-zinc-400" style="flex-shrink:0"></i>
          </button>
        </div>

        ${editing?.createdAt ? `<div class="text-xs text-zinc-400 mb-3">Entered ${new Date(editing.createdAt).toLocaleString()}${editing.addedBy ? ` by ${this.#esc(editing.addedBy)}` : ''}</div>` : ''}

        <div class="flex items-center gap-2">
          ${editing
            ? `<button type="button" class="btn btn-outline text-rose-500" onclick="window.__app.deleteTx('${editing.id}')"><i data-lucide="trash-2"></i> Delete</button>`
            : canDeleteShared
              ? `<button type="button" class="btn btn-outline text-rose-500"
                         onclick="window.__app.deleteSharedTxContrib(${Number(this.#sharedTxMode.shareIndex) || 0},'${Html.js(sharedEditTx.id)}')">
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
    // A fresh open must not inherit the previous transaction's half-typed form.
    this.#draft         = {};
    // Initialize FX panels after the DOM is in place: the transfer panel for
    // transfers, and the single-account panel whenever tx currency != account
    // currency (e.g. editing a USD tx on a KES account).
    const data = opts?.prefill || {};
    if (data.type === 'transfer') {
      setTimeout(() => window.__app?.updateTransferFxPanel?.(false), 0);
    }
    setTimeout(() => window.__app?.updateTxFxPanel?.(false), 0);
  }

  // ── Private render helpers ────────────────────────────────────────────

  /**
   * The currency control beside the amount.
   *
   * For a TRANSFER it is locked to the source account's currency: money leaves
   * that account, so the amount can only be denominated in it. Letting the two
   * disagree is what made the FX panel quote a source→destination rate while
   * the amount was read in the user's default currency, booking legs that were
   * thousands apart. Shared mode is locked for the same reason — the row lives
   * in the owner's book.
   *
   * @param {object}  data
   * @param {object}  state
   * @param {string}  type
   * @param {boolean} isSharedMode
   * @returns {string} HTML
   */
  #currencyControl(data, state, type, isSharedMode) {
    if (isSharedMode) {
      return `<input type="hidden" name="currency" value="${this.#esc(data.currency)}">
              <span class="text-sm font-medium text-zinc-600 dark:text-zinc-400 px-2">${this.#esc(data.currency)}</span>`;
    }

    if (type === 'transfer') {
      const src = state.accounts.find((a) => a.id === data.accountId) || state.accounts[0];
      const ccy = src?.currency || data.currency;
      return `<input type="hidden" name="currency" id="txCurrencyLocked" value="${this.#esc(ccy)}">
              <span id="txCurrencyLabel"
                    class="text-sm font-medium text-zinc-600 dark:text-zinc-400 px-2 flex items-center gap-1"
                    title="A transfer is always in the source account's currency">
                <i data-lucide="lock" style="width:11px;height:11px"></i>${this.#esc(ccy)}
              </span>`;
    }

    return `<select class="select w-24" name="currency" onchange="window.__app.onTxCurrencyChange()">
              ${CURRENCIES.map((c) => `<option value="${this.#esc(c)}" ${data.currency === c ? 'selected' : ''}>${this.#esc(this.#fx.label(c).split('—')[0].trim())}</option>`).join('')}
            </select>`;
  }

  #transferFields(data, state) {
    return `
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label class="text-xs text-zinc-500">Account</label>
          <select class="select" name="accountId" onchange="window.__app.onTransferSourceChange(this.value)">
            ${state.accounts.map((a) => `<option value="${this.#esc(a.id)}" ${data.accountId===a.id?'selected':''}>${this.#esc(a.name)} · ${this.#esc(a.currency)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-zinc-500">To account</label>
          <select class="select" name="transferToAccountId" onchange="window.__app.resetTransferFx()">
            ${state.accounts.map((a) => `<option value="${this.#esc(a.id)}" ${data.transferToAccountId===a.id?'selected':''}>${this.#esc(a.name)} · ${this.#esc(a.currency)}</option>`).join('')}
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
                 value="${data.transferRate ? Number(data.transferRate).toFixed(6) : ''}"
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
        .map((a) => `<option value="${this.#esc(a.id)}" ${data.accountId===a.id?'selected':''}>${this.#esc(a.name)} (shared)</option>`),
    ).join('');

    const sharedAccName = isSharedMode
      ? (state._sharedData?.[this.#sharedTxMode.shareIndex]?.accounts || [])
          .find((a) => a.id === this.#sharedTxMode.accountId)?.name || 'Shared account'
      : null;

    const accountSelect = isSharedMode
      ? `<input type="hidden" name="accountId" value="${this.#esc(this.#sharedTxMode.accountId)}">
         <div class="select flex items-center gap-2 text-zinc-500" style="cursor:default">
           <i data-lucide="lock" style="width:13px;height:13px;flex-shrink:0"></i>
           <span class="truncate">${this.#esc(sharedAccName)}</span>
         </div>`
      : `<select class="select" name="accountId" onchange="window.__app.onTxAccountChange(this.value)">
           <optgroup label="My accounts">
             ${state.accounts.map((a) => `<option value="${this.#esc(a.id)}" ${data.accountId===a.id?'selected':''}>${this.#esc(a.name)}</option>`).join('')}
           </optgroup>
           ${sharedOpts ? `<optgroup label="Shared with me">${sharedOpts}</optgroup>` : ''}
         </select>`;

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
          ${CategoryField.render({
            id:         'txCategory',
            name:       'categoryId',
            value:      data.categoryId,
            type,
            title:      'Choose category',
            categories: cats,
          })}
        </div>
      </div>

      <!-- FX panel: shown only when the transaction currency differs from the
           account currency (e.g. a USD expense on a KES account). Mirrors the
           transfer FX panel. -->
      <div id="fxTxPanel" class="card-muted p-3 mb-3" style="display:none">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs text-zinc-500 uppercase tracking-wider">Exchange rate</div>
          <button type="button" class="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                  onclick="window.__app.resetTxFx()" title="Reset to auto rate">
            <i data-lucide="refresh-cw" style="width:11px;height:11px;display:inline"></i> Use auto
          </button>
        </div>
        <div class="flex items-center gap-2 mb-2 text-sm">
          <span>1 <span id="fxTxFromCcy" class="font-medium"></span> =</span>
          <input class="input flex-1 max-w-[140px]" type="number" step="any" min="0"
                 name="txFxRate" id="fxTxRate"
                 value="${data.txFxRate ? Number(data.txFxRate).toFixed(6) : ''}"
                 oninput="window.__app.updateTxFxPanel(true)" placeholder="0.00">
          <span class="font-medium" id="fxTxToCcy"></span>
        </div>
        <div class="flex items-center justify-between">
          <div>
            <div class="text-xs text-zinc-500">Booked to account</div>
            <div class="text-lg font-semibold" id="fxTxToAmount">—</div>
          </div>
          <div class="text-xs text-zinc-400 text-right max-w-[55%]" id="fxTxRateNote"></div>
        </div>
      </div>`;
  }

  #splitsArea(data, cats, type, accounts = [], totalMajor = 0) {
    const currency = data.currency || 'USD';

    // Compare in MINOR units — the same rule submitTx enforces. Comparing
    // majors against a fixed 0.005 said "Splits match total" for a 3-fils KWD
    // mismatch that submit then rejected.
    const totalMinor = this.#fx.toMinor(totalMajor, currency);
    const sumMinor   = this.#splits.reduce((s, sp) => s + (sp.amount || 0), 0);
    const diffMinor  = totalMinor - sumMinor;
    const splitSum   = this.#fx.fromMinor(sumMinor, currency);
    const diff       = diffMinor;
    const diffFmt    = this.#fx.formatMoney(Math.abs(diffMinor), currency);

    let diffHtml = '';
    if (diffMinor !== 0) {
      const over  = diff < 0;
      const color = over ? 'text-rose-500' : 'text-amber-500';
      const label = over
        ? `<span class="${color} font-medium">${diffFmt} over</span>`
        : `<span class="${color} font-medium">${diffFmt} remaining</span>`;
      diffHtml = `<div class="flex items-center gap-1 text-xs mt-1">${label}</div>`;
    } else {
      diffHtml = `<div class="flex items-center gap-1 text-xs mt-1 text-emerald-500"><i data-lucide="check" style="width:11px;height:11px"></i> Splits match total</div>`;
    }

    const sumFmt   = this.#fx.formatMoney(sumMinor, currency);
    const totalFmt = this.#fx.formatMoney(totalMinor, currency);

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

        <!-- Total vs split sum tracker — id="splitTotalBar" patched by updateSplitTotal() -->
        <div id="splitTotalBar" class="card-muted rounded-xl px-3 py-2 mb-2 flex items-center justify-between">
          <div class="text-xs text-zinc-500">Split total</div>
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold">${sumFmt}</span>
            <span class="text-xs text-zinc-400">of</span>
            <span class="text-sm font-semibold">${totalFmt}</span>
          </div>
        </div>
        <div id="splitDiffLine">${diffHtml}</div>

        <div id="splitsContainer" class="space-y-2 mt-2">
          ${this.#splits.map((s, i) => this.#splitRow(s, i, cats, type, currency, accounts, data.accountId)).join('')}
        </div>
        <button type="button" onclick="window.__app.addSplit('${Html.js(data.accountId || '')}')"
                class="btn btn-ghost text-xs mt-2 w-full border border-dashed border-zinc-300 dark:border-zinc-700">
          <i data-lucide="plus" style="width:13px;height:13px"></i> Add split
        </button>
      </div>`;
  }

  /**
   * Render one split row.
   * The category control is a CategoryField, so each row opens the same
   * two-step picker instead of a long dropdown; onPick mirrors the choice back
   * into the in-memory split model via onSplitCategoryPicked().
   * The oninput on the amount field calls updateSplitTotal() — a lightweight
   * DOM patch — instead of a full modal refresh, so focus is never lost.
   */
  #splitRow(s, i, cats, type, currency, accounts = [], defaultAccountId = null) {
    const accId = s.accountId || defaultAccountId || '';
    return `
      <div class="card-muted rounded-xl p-2 space-y-1.5">
        <div class="flex gap-2">
          <div class="flex-1 min-w-0">
            ${CategoryField.render({
              id:         `splitCat_${i}`,
              name:       `split_cat_${i}`,
              value:      s.categoryId,
              type,
              title:      `Split ${i + 1} category`,
              onPick:     'onSplitCategoryPicked',
              categories: cats,
            })}
          </div>
          <button type="button" onclick="window.__app.removeSplit(${i})"
                  class="btn btn-ghost text-rose-500 flex-shrink-0 px-2">
            <i data-lucide="trash-2" style="width:13px;height:13px"></i>
          </button>
        </div>
        <div class="flex gap-2">
          <select class="select text-sm flex-1" name="split_acc_${i}"
                  onchange="window.__app.setSplitField(${i},'accountId',this.value)">
            ${accounts.map((a) => `<option value="${this.#esc(a.id)}" ${accId===a.id?'selected':''}>${this.#esc(a.name)}</option>`).join('')}
          </select>
          <input class="input text-sm w-28 flex-shrink-0" type="number" step="${CurrencyService.stepFor(currency)}" placeholder="0.00"
                 name="split_amt_${i}"
                 value="${s.amount ? this.#fx.fromMinor(s.amount, currency) : ''}"
                 oninput="window.__app.setSplitAmount(${i},this.value,'${currency}');window.__app.updateSplitTotal()">
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

  // Category selection is handled by CategoryField + CategoryPickerSheet:
  // a two-step parent → subcategory sheet rather than one long dropdown.

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
