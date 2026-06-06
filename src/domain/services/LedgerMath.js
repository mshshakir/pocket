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
    const byId = new Map(accounts