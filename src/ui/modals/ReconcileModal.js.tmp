/**
 * ReconcileModal — Two-choice reconciliation dialog.
 *
 * Presents the user with the numeric discrepancy between their stored account
 * balance and the sum derived from the transaction ledger, then offers two
 * resolution paths:
 *
 *   A) Add opening balance entry (recommended) — logs a compensating
 *      income/expense transaction tagged "opening-balance", dated one day
 *      before the account's earliest transaction.  The displayed balance
 *      stays unchanged; the ledger gains the missing entry.
 *
 *   B) Recalculate balance from transactions — silently overwrites
 *      account.balance with the ledger sum.  No new transaction is created.
 *
 * Rendered amounts and the chosen accountId are stored as per-open instance
 * fields so app.js can read them without repeating the ledger computation.
 */
import { Store }          from '../../core/Store.js';
import { AccountService } from '../../domain/services/AccountService.js';
import { CurrencyService } from '../../domain/services/CurrencyService.js';

export class ReconcileModal {
  /** @type {Store}          */ #store;
  /** @type {AccountService} */ #accounts;
  /** @type {CurrencyService}*/ #fx;

  // Per-open state (readable by app.js via getters)
  #accountId  = null;
  #ledgerSum  = 0;
  #residual   = 0;

  constructor() {
    this.#store    = Store.getInstance();
    this.#accounts = new AccountService();
    this.#fx       = new CurrencyService();
  }

  // ── Public accessors (read by app.js action handlers) ────────────────

  get accountId() { return this.#accountId; }
  get ledgerSum() { return this.#ledgerSum; }
  get residual()  { return this.#residual; }

  // ── Modal strategy contract ───────────────────────────────────────────

  onOpen(opts) {
    const { id } = opts || {};
    this.#accountId = id || null;
    const state = this.#store.getState();
    const a     = state.accounts.find((x) => x.id === id);
    this.#ledgerSum = a ? this.#accounts.ledgerSum(a, state.transactions) : 0;
    this.#residual  = a ? (a.balance - this.#ledgerSum) : 0;
  }

  render(opts = {}) {
    const { id } = opts;
    const state   = this.#store.getState();
    const a       = state.accounts.find((x) => x.id === id);
    if (!a) return '';

    const residual = this.#residual;
    const ledger   = this.#ledgerSum;
    const sign     = residual >= 0 ? '+' : '-';
    const fmtRes   = this.#fx.formatMoney(Math.abs(residual), a.currency);
    const fmtLed   = this.#fx.formatMoney(ledger, a.currency);
    const fmtBal   = this.#fx.formatMoney(a.balance, a.currency);

    return `
      <div class="p-5">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold">Reconcile ${this.#esc(a.name)}</h3>
          <button class="btn btn-ghost" onclick="window.__app.closeModal()">
            <i data-lucide="x"></i>
          </button>
        </div>

        <div class="card-muted p-3 mb-4">
          <div class="grid grid-cols-3 gap-2 text-center">
            <div>
              <div class="text-xs text-zinc-500">Account balance</div>
              <div class="text-base font-semibold">${fmtBal}</div>
            </div>
            <div>
              <div class="text-xs text-zinc-500">Transactions sum</div>
              <div class="text-base font-semibold">${fmtLed}</div>
            </div>
            <div>
              <div class="text-xs text-zinc-500">Residual</div>
              <div class="text-base font-semibold text-amber-600">${sign}${fmtRes}</div>
            </div>
          </div>
        </div>

        <div class="text-sm text-zinc-700 dark:text-zinc-300 mb-3">How would you like to reconcile?</div>

        <!-- Option A: add opening balance entry -->
        <button type="button"
                class="card w-full p-4 mb-3 text-left hover:shadow-md transition"
                onclick="window.__app.reconcileAddEntry('${id}')">
          <div class="flex items-start gap-3">
            <div class="icon-pill" style="background:#10b98122;color:#10b981">
              <i data-lucide="plus-square"></i>
            </div>
            <div class="flex-1">
              <div class="font-semibold flex items-center gap-2">
                Add opening balance entry
                <span class="chip" style="background:#10b98122;color:#10b981">Recommended</span>
              </div>
              <div class="text-xs text-zinc-500 mt-1">
                Logs a <code>${sign}${fmtRes}</code> transaction tagged <em>opening-balance</em>,
                dated before your earliest entry. The displayed balance stays at
                <b>${fmtBal}</b>. Best when the legacy balance was real money.
              </div>
            </div>
            <i data-lucide="chevron-right" class="text-zinc-400"></i>
          </div>
        </button>

        <!-- Option B: recalculate balance -->
        <button type="button"
                class="card w-full p-4 mb-3 text-left hover:shadow-md transition"
                onclick="window.__app.reconcileRecalculate('${id}')">
          <div class="flex items-start gap-3">
            <div class="icon-pill" style="background:#f59e0b22;color:#f59e0b">
              <i data-lucide="calculator"></i>
            </div>
            <div class="flex-1">
              <div class="font-semibold">Recalculate balance from transactions</div>
              <div class="text-xs text-zinc-500 mt-1">
                No new entry. Balance becomes <b>${fmtLed}</b>.
                Best when transactions are the source of truth.
              </div>
            </div>
            <i data-lucide="chevron-right" class="text-zinc-400"></i>
          </div>
        </button>

        <div class="flex justify-end gap-2 mt-2">
          <button type="button" class="btn btn-ghost" onclick="window.__app.closeModal()">Cancel</button>
        </div>
      </div>`;
  }

  // ── Private ───────────────────────────────────────────────────────────

  #esc(s) {
    return (s || '').toString().replace(
      /[&<>"']/g,
      (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]),
    );
  }
}
