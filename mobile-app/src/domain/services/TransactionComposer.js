/**
 * TransactionComposer — create/edit transactions with the invariants the web
 * app's submitTx() enforces after the July 2026 audit.
 *
 * The web keeps this logic inside its Application class; the mobile app keeps
 * it here, framework-free, so the SAME rules run on both platforms and this
 * file can be tested under plain node. Invariants carried over (audit ids):
 *
 *   C3/C4  a transfer is exactly two paired rows — converting a transfer to an
 *          expense deletes the counter-leg; converting an expense to a
 *          transfer builds both legs. No orphans, no one-legged rows.
 *   H4     a transfer's amount is denominated in the SOURCE account's
 *          currency, full stop.
 *   H5     an FX rate is only trusted when it is a real positive number the
 *          caller actually chose; otherwise the live table rate is used at
 *          full precision.
 *   L1     splits must sum EXACTLY to the parent amount, in minor units.
 *
 * @typedef {object} TxDraft
 * @property {'expense'|'income'|'transfer'} type
 * @property {number}  amount        major units, as typed
 * @property {string}  [currency]    ignored for transfers (H4)
 * @property {string}  accountId
 * @property {string}  [transferToAccountId]
 * @property {string}  [categoryId]
 * @property {string}  [payee]
 * @property {string}  [note]
 * @property {string}  date          ISO YYYY-MM-DD
 * @property {string}  [paymentType]
 * @property {number}  [transferRate]  manual FX override
 * @property {Array<{categoryId:string|null, accountId:string, amount:number}>} [splits] minor units
 * @property {object|null} [recurring]
 */
import { Store }                from '../../core/Store.js';
import { CurrencyService }      from './CurrencyService.js';
import { HijriCalendarService } from './HijriCalendarService.js';
import { TransactionService }   from './TransactionService.js';
import { RecurringService }     from './RecurringService.js';
import { IdGenerator }          from './IdGenerator.js';
import { RATES }                from './FxRates.js';

export class TransactionComposer {
  /** @type {Store} */                #store;
  /** @type {CurrencyService} */      #fx;
  /** @type {HijriCalendarService} */ #hijri;
  /** @type {TransactionService} */   #transactions;

  constructor() {
    this.#store        = Store.getInstance();
    this.#fx           = new CurrencyService();
    this.#hijri        = new HijriCalendarService();
    this.#transactions = new TransactionService();
  }

  /**
   * Create a transaction (or transfer pair) from a form draft.
   * @param {TxDraft} draft
   * @returns {{ok:true, ids:string[]}|{ok:false, reason:string}}
   */
  create(draft) {
    const prep = this.#prepare(draft, null);
    if (!prep.ok) return prep;
    const { minor, currency, exchRate, refAmt, xfer, splits, acctMinor } = prep;
    const state = this.#store.getState();

    if (draft.type === 'transfer') {
      const legs = this.#buildTransferPair(draft, { minor, currency, exchRate, refAmt, xfer });
      state.transactions.push(...legs);
      this.#afterWrite(draft);
      return { ok: true, ids: legs.map((t) => t.id) };
    }

    const tx = this.#transactions.create({
      accountId: draft.accountId,
      categoryId: splits ? null : (draft.categoryId || null),
      amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
      payee: draft.payee || '', note: draft.note || '', date: draft.date,
      paymentType: draft.paymentType || 'card', type: draft.type,
      splits, recurring: draft.recurring || null, acctMinor,
    });
    this.#learnMerchant(draft, splits);
    this.#afterWrite(draft);
    return { ok: true, ids: [tx.id] };
  }

  /**
   * Edit an existing transaction, handling every type-cross case.
   * @param {string} id
   * @param {TxDraft} draft
   * @returns {{ok:true, ids:string[]}|{ok:false, reason:string}}
   */
  update(id, draft) {
    const state = this.#store.getState();
    const tx    = state.transactions.find((t) => t.id === id);
    if (!tx) return { ok: false, reason: 'Transaction not found' };

    const prep = this.#prepare(draft, tx);
    if (!prep.ok) return prep;
    const { minor, currency, exchRate, refAmt, xfer, splits } = prep;

    const wasTransfer = tx.type === 'transfer';
    const nowTransfer = draft.type === 'transfer';

    if (nowTransfer && !wasTransfer) {
      // Became a transfer → replace the single row with a proper pair (C4).
      state.transactions = state.transactions.filter((t) => t.id !== tx.id);
      const legs = this.#buildTransferPair(draft, { minor, currency, exchRate, refAmt, xfer });
      state.transactions.push(...legs);
      this.#store.flush();
      return { ok: true, ids: legs.map((t) => t.id) };
    }

    if (!nowTransfer && wasTransfer) {
      // No longer a transfer → delete the counter-leg first (C3).
      if (tx.transferPairId) {
        state.transactions = state.transactions.filter((t) => t.id !== tx.transferPairId);
      }
      this.#transactions.update(id, {
        accountId: draft.accountId,
        categoryId: splits ? null : (draft.categoryId || null),
        amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
        payee: draft.payee || '', note: draft.note || '', date: draft.date,
        hijriDate: this.#hijri.toHijri(draft.date),
        paymentType: draft.paymentType || 'card', type: draft.type,
        splits, recurring: draft.recurring || null,
        transferPairId: null, transferDir: null, transferRate: null,
      });
      return { ok: true, ids: [id] };
    }

    if (nowTransfer && wasTransfer && tx.transferPairId) {
      // Transfer → transfer: re-normalise both legs in place.
      const pair = state.transactions.find((t) => t.id === tx.transferPairId);
      Object.assign(tx, {
        accountId: draft.accountId, categoryId: null,
        amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
        payee: draft.payee || 'Transfer', note: draft.note || '', date: draft.date,
        hijriDate: this.#hijri.toHijri(draft.date),
        paymentType: 'transfer', type: 'transfer', splits: null,
        transferRate: xfer?.rate ?? null, transferDir: 'out',
        acctMinor: undefined,
      });
      if (pair) {
        Object.assign(pair, {
          accountId: draft.transferToAccountId, categoryId: null,
          amount: xfer ? xfer.dstMinor : minor,
          currency: xfer ? xfer.toCcy : currency,
          exchangeRate: (RATES[xfer?.toCcy || currency] || 1) /
                        (RATES[this.#store.getState().user.homeCurrency] || 1),
          refAmount: this.#fx.convert(
            xfer ? xfer.dstMinor : minor, xfer ? xfer.toCcy : currency,
            this.#store.getState().user.homeCurrency),
          payee: draft.payee || 'Transfer', note: draft.note || '', date: draft.date,
          hijriDate: this.#hijri.toHijri(draft.date),
          paymentType: 'transfer', type: 'transfer', splits: null,
          transferRate: xfer?.rate ?? null, transferDir: 'in',
          acctMinor: undefined,
        });
      }
      this.#store.flush();
      return { ok: true, ids: [tx.id, pair?.id].filter(Boolean) };
    }

    // Plain edit. acctMinor is set from the manual rate (or cleared to undefined
    // so recompute re-freezes it at the live rate).
    this.#transactions.update(id, {
      accountId: draft.accountId,
      categoryId: splits ? null : (draft.categoryId || null),
      amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
      payee: draft.payee || '', note: draft.note || '', date: draft.date,
      hijriDate: this.#hijri.toHijri(draft.date),
      paymentType: draft.paymentType || 'card', type: draft.type,
      splits, recurring: draft.recurring || null, acctMinor: prep.acctMinor,
    });
    return { ok: true, ids: [id] };
  }

  /** Delete — TransactionService already removes the pair and records skips. */
  remove(id) {
    this.#transactions.delete(id);
  }

  // ── Private ───────────────────────────────────────────────────────────

  /**
   * Validate and normalise a draft: currency lock, FX, split sums.
   * @param {TxDraft} draft
   * @param {object|null} _editing
   */
  #prepare(draft, _editing) {
    const state = this.#store.getState();

    if (!draft.date || !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
      return { ok: false, reason: 'Pick a date' };
    }

    // H4: transfers are denominated in the SOURCE account's currency.
    const srcAcc = draft.type === 'transfer'
      ? state.accounts.find((a) => a.id === draft.accountId)
      : null;
    if (draft.type === 'transfer' && !srcAcc) return { ok: false, reason: 'Pick a source account' };

    const currency = srcAcc ? srcAcc.currency
      : (draft.currency || state.user.defaultCurrency || state.user.homeCurrency);
    const minor = this.#fx.toMinor(Number(draft.amount) || 0, currency);
    if (!(minor > 0)) return { ok: false, reason: 'Enter an amount' };

    const home     = state.user.homeCurrency;
    const exchRate = (RATES[currency] || 1) / (RATES[home] || 1);
    const refAmt   = this.#fx.convert(minor, currency, home);

    let xfer = null;
    if (draft.type === 'transfer') {
      if (!draft.transferToAccountId || draft.transferToAccountId === draft.accountId) {
        return { ok: false, reason: 'Pick two different accounts' };
      }
      const toAcc = state.accounts.find((a) => a.id === draft.transferToAccountId);
      if (!toAcc) return { ok: false, reason: 'Pick a destination account' };
      const toCcy = toAcc.currency;
      // H5: a manual rate wins; anything else books the live rate untruncated.
      let rate = Number(draft.transferRate);
      if (!isFinite(rate) || rate <= 0) rate = (RATES[toCcy] || 1) / (RATES[currency] || 1);
      const dstMinor = currency === toCcy ? minor
        : this.#fx.toMinor(this.#fx.fromMinor(minor, currency) * rate, toCcy);
      xfer = { rate, toCcy, dstMinor };
    }

    // L1: splits must sum exactly, reference live accounts, and never ride on
    // a transfer.
    let splits = null;
    if (draft.type !== 'transfer' && Array.isArray(draft.splits) && draft.splits.length) {
      const cleaned = draft.splits
        .map((s) => ({
          categoryId: s.categoryId || null,
          accountId: s.accountId || draft.accountId,
          amount: Math.round(Number(s.amount) || 0),
        }))
        .filter((s) => s.amount > 0);
      if (!cleaned.length) return { ok: false, reason: 'Add at least one split with an amount' };
      const missing = cleaned.find((s) => !state.accounts.some((a) => a.id === s.accountId));
      if (missing) return { ok: false, reason: 'Pick an account for every split' };
      const sum = cleaned.reduce((s, x) => s + x.amount, 0);
      if (sum !== minor) {
        return {
          ok: false,
          reason: `Splits must add up to ${this.#fx.formatMoney(minor, currency)} `
                + `(currently ${this.#fx.formatMoney(sum, currency)})`,
        };
      }
      splits = cleaned;
    }

    // Manual FX for a NON-transfer, single-account entry whose currency differs
    // from its account's — pin the amount that actually hit the account
    // (acctMinor), which LedgerMath prefers over the live rate. Web parity
    // (txFxRate → acctMinor). Undefined → LedgerMath freezes at the live rate.
    let acctMinor;
    if (draft.type !== 'transfer' && !splits) {
      const acc = state.accounts.find((a) => a.id === draft.accountId);
      const rate = Number(draft.txFxRate);
      if (acc && acc.currency !== currency && isFinite(rate) && rate > 0) {
        acctMinor = this.#fx.toMinor(this.#fx.fromMinor(minor, currency) * rate, acc.currency);
      }
    }

    return { ok: true, minor, currency, exchRate, refAmt, xfer, splits, acctMinor };
  }

  /** Both legs of a transfer — always created together (C3/C4). */
  #buildTransferPair(draft, { minor, currency, exchRate, refAmt, xfer }) {
    const state  = this.#store.getState();
    const fromId = IdGenerator.generate('tx');
    const toId   = IdGenerator.generate('tx');
    const toCcy  = xfer?.toCcy ?? currency;
    const dst    = xfer?.dstMinor ?? minor;
    const now    = new Date().toISOString();
    const shared = {
      categoryId: null,
      payee: draft.payee || 'Transfer', note: draft.note || '', date: draft.date,
      hijriDate: this.#hijri.toHijri(draft.date),
      paymentType: 'transfer', recordState: 'cleared', type: 'transfer',
      transferRate: xfer?.rate ?? null, tags: [],
      createdAt: now, addedBy: null,
    };
    return [
      { ...shared, id: fromId, accountId: draft.accountId,
        amount: minor, currency, exchangeRate: exchRate, refAmount: refAmt,
        transferPairId: toId, transferDir: 'out' },
      { ...shared, id: toId, accountId: draft.transferToAccountId,
        amount: dst, currency: toCcy,
        exchangeRate: (RATES[toCcy] || 1) / (RATES[state.user.homeCurrency] || 1),
        refAmount: this.#fx.convert(dst, toCcy, state.user.homeCurrency),
        transferPairId: fromId, transferDir: 'in' },
    ];
  }

  /**
   * Build a normalised transaction row for a SHARED-account contribution — one
   * that will live in the OWNER's book, submitted via the sync API rather than
   * written locally. Centralises the FX/refAmount formula and default fields
   * (tags, recordState, hijriDate) so the shared path can't drift from the
   * local ledger rules.
   * @param {object} p
   * @returns {object}
   */
  buildContributionTx(p) {
    const minor = this.#fx.toMinor(Number(p.amountMajor) || 0, p.currency);
    const ownerHome = p.ownerHome || this.#store.getState().user.homeCurrency;
    return {
      id: p.id || IdGenerator.generate('tx'),
      accountId: p.accountId, categoryId: p.categoryId || null,
      amount: minor, currency: p.currency,
      exchangeRate: (RATES[p.currency] || 1) / (RATES[ownerHome] || 1),
      refAmount: this.#fx.convert(minor, p.currency, ownerHome),
      payee: p.payee || '', note: p.note || '', date: p.date,
      hijriDate: this.#hijri.toHijri(p.date),
      type: p.type, paymentType: p.paymentType || 'card', recordState: 'cleared',
      transferPairId: null, transferDir: null, splits: null, tags: [],
      createdAt: new Date().toISOString(), addedBy: p.addedBy || null,
    };
  }

  /** Remember payee → category so future entries can suggest it (web parity). */
  #learnMerchant(draft, splits) {
    if (!draft.payee || splits || !draft.categoryId) return;
    const state = this.#store.getState();
    if (!state.merchantCategories) state.merchantCategories = {};
    state.merchantCategories[draft.payee.toLowerCase()] = draft.categoryId;
  }

  #afterWrite(draft) {
    if (draft.recurring) new RecurringService().process();
    this.#store.flush();
  }
}
