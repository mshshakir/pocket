/**
 * DebtModal — New / edit debt form.
 * Also handles the DebtPayment modal variant (opts.mode === 'payment').
 */
import { Store }           from '../../core/Store.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';
import { CURRENCIES }      from '../../data/constants.js';

export class DebtModal {
  /** @type {Store} */           #store;
  /** @type {CurrencyService} */ #fx;

  constructor() {
    this.#store = Store.getInstance();
    this.#fx    = new CurrencyService();
  }

  /** Entry point registered in the Modal system.
   *  opts.mode === 'payment' renders the payment modal instead. */
  render(opts = {}) {
    return opts.mode === 'payment'
      ? this.#renderPayment(opts)
      : this.#renderDebt(opts);
  }

  // ── New / edit debt ──────────────────────────────────────────────────

  #renderDebt({ id } = {}) {
    const state   = this.#store.getState();
    const editing = id ? state.debts.find((x) => x.id === id) : null;
    const d       = editing || {
      type:         'borrowed',
      counterparty: '',
      principal:    0,
      currency:     state.user.defaultCurrency || state.user.homeCurrency,
      accountId:    state.accounts[0]?.id,
      dateTaken:    new Date().toISOString().slice(0, 10),
      dueDate:      '',
      note:         '',
      status:       'active',
    };
    const principalDisp = editing ? this.#fx.fromMinor(d.principal, d.currency) : '';

    const paymentCount = editing
      ? state.transactions.filter((t) => t.debtId === editing.id && t.id !== editing.initialTxId).length
      : 0;

    return `
      <form onsubmit="window.__app.submitDebt(event,'${editing?.id || ''}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">${editing ? 'Edit debt' : 'New debt'}</h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <!-- Type: borrowed / lent -->
        <div class="grid grid-cols-2 gap-2 mb-4">
          <label class="cursor-pointer">
            <input type="radio" name="type" value="borrowed"
                   ${d.type === 'borrowed' ? 'checked' : ''}
                   class="peer sr-only" ${editing ? 'disabled' : ''}>
            <div class="btn btn-outline justify-center
                        peer-checked:bg-rose-50 peer-checked:text-rose-600 peer-checked:border-rose-200
                        dark:peer-checked:bg-rose-950 dark:peer-checked:text-rose-300 w-full">
              <i data-lucide="arrow-down-left"></i> I borrowed
            </div>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="type" value="lent"
                   ${d.type === 'lent' ? 'checked' : ''}
                   class="peer sr-only" ${editing ? 'disabled' : ''}>
            <div class="btn btn-outline justify-center
                        peer-checked:bg-emerald-50 peer-checked:text-emerald-600 peer-checked:border-emerald-200
                        dark:peer-checked:bg-emerald-950 dark:peer-checked:text-emerald-300 w-full">
              <i data-lucide="arrow-up-right"></i> I lent
            </div>
          </label>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Counterparty</label>
          <input class="input" name="counterparty" required
                 value="${this.#esc(d.counterparty)}"
                 placeholder="Name of person or entity" autofocus>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Principal</label>
            <input class="input" name="principal" type="number" step="0.01" required
                   value="${principalDisp}" ${editing ? 'readonly' : ''}>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Currency</label>
            <select class="select" name="currency" ${editing ? 'disabled' : ''}>
              ${CURRENCIES.map((c) => `<option value="${c}" ${d.currency === c ? 'selected' : ''}>${this.#fx.label(c)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">Linked account</label>
          <select class="select" name="accountId" required ${editing ? 'disabled' : ''}>
            ${state.accounts.map((a) => `<option value="${a.id}" ${d.accountId === a.id ? 'selected' : ''}>${this.#esc(a.name)}</option>`).join('')}
          </select>
          <div class="text-xs text-zinc-500 mt-1">
            ${d.type === 'borrowed'
              ? 'Money will be added to this account on the date taken'
              : 'Money will be deducted from this account on the date taken'}
          </div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Date taken</label>
            <input class="input" type="date" name="dateTaken"
                   value="${d.dateTaken}" ${editing ? 'readonly' : ''}>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Due date (optional)</label>
            <input class="input" type="date" name="dueDate" value="${d.dueDate || ''}">
          </div>
        </div>

        <div class="mb-4">
          <label class="text-xs text-zinc-500">Note</label>
          <textarea class="textarea" name="note" rows="2"
                    placeholder="optional...">${this.#esc(d.note || '')}</textarea>
        </div>

        ${editing ? `
          <div class="card-muted p-3 mb-4 space-y-2">
            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" name="markPaid" ${editing.status === 'paid' ? 'checked' : ''}>
              <span>Mark as fully paid off</span>
            </label>
            ${paymentCount > 0 ? `
              <label class="flex items-start gap-2 text-sm">
                <input type="checkbox" id="destroyPayments" class="mt-0.5">
                <span>
                  <span class="text-rose-600 font-medium">Also destroy ${paymentCount} linked payment transaction${paymentCount === 1 ? '' : 's'}</span>
                  when deleting. Account balances will be restored.
                </span>
              </label>` : ''}
          </div>` : ''}

        <div class="flex items-center gap-2">
          ${editing ? `
            <button type="button" class="btn btn-outline text-rose-500"
                    onclick="window.__app.deleteDebt('${editing.id}', document.getElementById('destroyPayments')?.checked)">
              <i data-lucide="trash-2"></i> Delete
            </button>` : ''}
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i data-lucide="check"></i> ${editing ? 'Save' : 'Record debt'}
          </button>
        </div>
      </form>`;
  }

  // ── Record a debt payment ────────────────────────────────────────────

  #renderPayment({ id } = {}) {
    const state = this.#store.getState();
    const debt  = state.debts?.find((d) => d.id === id);
    if (!debt) return `<div class="p-5">Debt not found</div>`;

    const isBorrowed = debt.type === 'borrowed';
    const rem        = this.#debtRemaining(debt, state);
    const remDisp    = this.#fx.fromMinor(rem, debt.currency);

    return `
      <form onsubmit="window.__app.submitDebtPayment(event,'${id}')" class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">
            ${isBorrowed ? 'Pay' : 'Receive payment from'} ${this.#esc(debt.counterparty)}
          </h3>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div class="card-muted p-3 mb-3">
          <div class="text-xs text-zinc-500">Remaining</div>
          <div class="text-2xl font-semibold">${this.#fx.formatMoney(rem, debt.currency)}</div>
          <div class="text-xs text-zinc-500">of ${this.#fx.formatMoney(debt.principal, debt.currency)} total</div>
        </div>

        <div class="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label class="text-xs text-zinc-500">Amount</label>
            <input class="input" name="amount" type="number" step="0.01" required
                   value="${remDisp}" max="${remDisp}" autofocus>
          </div>
          <div>
            <label class="text-xs text-zinc-500">Date</label>
            <input class="input" type="date" name="date"
                   value="${new Date().toISOString().slice(0, 10)}">
          </div>
        </div>

        <div class="mb-3">
          <label class="text-xs text-zinc-500">From account</label>
          <select class="select" name="accountId" required>
            ${state.accounts.map((a) => `<option value="${a.id}" ${debt.accountId === a.id ? 'selected' : ''}>${this.#esc(a.name)}</option>`).join('')}
          </select>
        </div>

        <div class="mb-4">
          <label class="text-xs text-zinc-500">Note</label>
          <textarea class="textarea" name="note" rows="2" placeholder="optional..."></textarea>
        </div>

        <div class="flex items-center gap-2">
          <div class="flex-1"></div>
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">
            <i data-lucide="check"></i> Record payment
          </button>
        </div>
      </form>`;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Compute remaining balance of a debt (principal minus sum of payments). */
  #debtRemaining(debt, state) {
    const payments = state.transactions
      .filter((t) => t.debtId === debt.id && t.id !== debt.initialTxId);
    const paid = payments.reduce((s, t) => s + (t.amount || 0), 0);
    return Math.max(0, debt.principal - paid);
  }

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
