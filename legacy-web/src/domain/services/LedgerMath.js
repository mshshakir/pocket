/**
 * LedgerMath — the single source of truth for how a transaction affects
 * account balances.
 *
 * Previously this logic was duplicated in at least four places
 * (AccountService.applyBalances/revertBalances, AccountService.ledgerSum,
 * ReportService.#apply/#revert, SyncService.#sharedApplyBalance). Each copy
 * had to be fixed independently and they drifted apart. This class is now the
 * ONLY place that encodes the rule:
 *
 *   - expense  → subtracts from the touched account(s)
 *   - income   → adds to the touched account(s)
 *   - transfer → honours transferDir ('out' subtracts, 'in' adds)
 *   - splits   → each split row posts to its own account (falling back to the
 *                transaction's account)
 *
 * It is pure: no Store, no DOM, no side effects. Amounts are returned in the
 * transaction's OWN currency; currency conversion to a target account is the
 * caller's responsibility (via CurrencyService), keeping FX concerns separate
 * from posting rules.
 */
export class LedgerMath {
  /**
   * Sign multiplier for a non-transfer transaction type.
   * @param {string} type
   * @returns {number} -1 | 0 | 1
   */
  static #sign(type) {
    if (type === 'expense') return -1;
    if (type === 'income')  return 1;
    return 0;
  }

  /**
   * Break a transaction into the signed contributions it makes to each account,
   * expressed in the transaction's own currency (minor units).
   *
   * @param {object} tx
   * @returns {{ accountId: string, currency: string, minor: number }[]}
   */
  static contributions(tx) {
    if (!tx) return [];

    if (tx.type === 'transfer') {
      const s = tx.transferDir === 'out' ? -1 : tx.transferDir === 'in' ? 1 : 0;
      return [{
        accountId: tx.accountId,
        currency:  tx.currency,
        minor:     s * Number(tx.amount || 0),
        // Rate-frozen impact in the account's currency (see stampAccountAmounts).
        acctMinor: Number.isFinite(tx.acctMinor) ? s * Number(tx.acctMinor) : undefined,
      }];
    }

    const sign = LedgerMath.#sign(tx.type);
    if (sign === 0) return [];

    if (Array.isArray(tx.splits) && tx.splits.length) {
      return tx.splits.map((sp) => ({
        accountId: sp.accountId || tx.accountId,
        currency:  tx.currency,
        minor:     sign * Number(sp.amount || 0),
        acctMinor: Number.isFinite(sp.acctMinor) ? sign * Number(sp.acctMinor) : undefined,
      }));
    }

    return [{
      accountId: tx.accountId,
      currency:  tx.currency,
      minor:     sign * Number(tx.amount || 0),
      acctMinor: Number.isFinite(tx.acctMinor) ? sign * Number(tx.acctMinor) : undefined,
    }];
  }

  /**
   * The amount a single contribution posts to an account, expressed in the
   * account's currency. Prefers the rate-frozen `acctMinor` captured at posting
   * time; only falls back to a LIVE FX conversion for legacy rows that never
   * froze one. If that live conversion is impossible (unknown currency), the
   * contribution is dropped with a warning rather than silently corrupting the
   * running total with an unconverted 1:1 figure.
   * @param {{currency:string, minor:number, acctMinor?:number}} c
   * @param {string} accountCurrency
   * @param {import('./CurrencyService.js').CurrencyService} fx
   * @returns {number} signed minor units in the account's currency
   */
  static #postedAmount(c, accountCurrency, fx) {
    if (Number.isFinite(c.acctMinor)) return c.acctMinor;
    const m = Number.isFinite(c.minor) ? c.minor : 0;
    try {
      return fx.convertStrict(m, c.currency, accountCurrency);
    } catch (e) {
      console.warn(`[LedgerMath] dropping unconvertible contribution ${c.currency}→${accountCurrency}:`, e?.message || e);
      return 0;
    }
  }

  /**
   * Freeze each transaction's effect on its target account(s) into that
   * account's currency at the CURRENT rate — but only for rows not already
   * frozen. Once stamped, a row's contribution to a balance no longer drifts
   * when the live FX table refreshes; a transaction's historical impact is
   * immutable, exactly like a real bank ledger.
   *
   * Invoked from AccountService.recompute() (the single persist-time derive
   * choke point), so a freshly-created row freezes at creation time and a
   * legacy row freezes once on first load.
   *
   * @param {object[]} transactions
   * @param {object[]} accounts
   * @param {import('./CurrencyService.js').CurrencyService} fx
   */
  static stampAccountAmounts(transactions, accounts, fx) {
    if (!Array.isArray(transactions) || !Array.isArray(accounts)) return;
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const freeze = (rawMinor, fromCcy, acc) => {
      try { return fx.convertStrict(Number(rawMinor || 0), fromCcy, acc.currency); }
      catch { return undefined; } // unknown currency → leave unfrozen, retried next pass
    };

    for (const tx of transactions) {
      if (!tx) continue;

      if (tx.type === 'transfer') {
        if (!Number.isFinite(tx.acctMinor)) {
          const acc = byId.get(tx.accountId);
          if (acc) { const v = freeze(tx.amount, tx.currency, acc); if (v !== undefined) tx.acctMinor = v; }
        }
        continue;
      }

      if (LedgerMath.#sign(tx.type) === 0) continue; // not income/expense

      if (Array.isArray(tx.splits) && tx.splits.length) {
        for (const sp of tx.splits) {
          if (Number.isFinite(sp.acctMinor)) continue;
          const acc = byId.get(sp.accountId || tx.accountId);
          if (acc) { const v = freeze(sp.amount, tx.currency, acc); if (v !== undefined) sp.acctMinor = v; }
        }
      } else if (!Number.isFinite(tx.acctMinor)) {
        const acc = byId.get(tx.accountId);
        if (acc) { const v = freeze(tx.amount, tx.currency, acc); if (v !== undefined) tx.acctMinor = v; }
      }
    }
  }

  /**
   * The signed delta a single transaction applies to one specific account,
   * converted into that account's currency.
   *
   * @param {object} tx
   * @param {object} account            { id, currency }
   * @param {import('./CurrencyService.js').CurrencyService} fx
   * @returns {number} signed minor units in the account's currency
   */
  static accountDelta(tx, account, fx) {
    if (!account) return 0;
    let delta = 0;
    for (const c of LedgerMath.contributions(tx)) {
      if (c.accountId !== account.id) continue;
      delta += LedgerMath.#postedAmount(c, account.currency, fx);
    }
    return delta;
  }

  /**
   * Sum the impact of a transaction list on a single account (its currency).
   * @param {object} account
   * @param {object[]} transactions
   * @param {import('./CurrencyService.js').CurrencyService} fx
   * @returns {number} minor units (rounded)
   */
  static ledgerSum(account, transactions, fx) {
    let sum = 0;
    for (const t of transactions) sum += LedgerMath.accountDelta(t, account, fx);
    return Math.round(sum);
  }

  /**
   * Compute derived balances for every account in one pass:
   *   balance = openingBalance + Σ ledger impact (converted per account).
   *
   * Returns a Map(accountId → balance minor) so callers can read or write the
   * cached `balance` field as they see fit.
   *
   * @param {object[]} accounts      each may carry openingBalance (defaults 0)
   * @param {object[]} transactions
   * @param {import('./CurrencyService.js').CurrencyService} fx
   * @returns {Map<string, number>}
   */
  static balances(accounts, transactions, fx) {
    const byId    = new Map(accounts.map((a) => [a.id, a]));
    const totals  = new Map(accounts.map((a) => [a.id, 0]));

    for (const t of transactions) {
      for (const c of LedgerMath.contributions(t)) {
        const acc = byId.get(c.accountId);
        if (!acc) continue; // contribution to a deleted account is dropped
        totals.set(acc.id, totals.get(acc.id) + LedgerMath.#postedAmount(c, acc.currency, fx));
      }
    }

    const out = new Map();
    for (const a of accounts) {
      const opening = Number(a.openingBalance ?? 0) || 0;
      out.set(a.id, Math.round(opening + (totals.get(a.id) || 0)));
    }
    return out;
  }
}
