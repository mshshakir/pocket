import '../money/currency_service.dart';
import 'ledger_entities.dart';

/// The single source of truth for how a transaction affects account balances —
/// a faithful Dart port of the JS `LedgerMath`.
///
/// Rules:
///  - expense  → subtracts from the touched account(s)
///  - income   → adds
///  - transfer → honours [TransferDir] ('out' subtracts, 'in' adds)
///  - splits   → each split row posts to its own account (falling back to the
///               transaction's account)
///
/// A posting prefers its rate-frozen [Contribution.acctMinor] (captured at
/// write time, in the account's currency) so a balance is a stable sum that
/// never drifts when live FX rates change. Only legacy rows without a frozen
/// amount fall back to a live [CurrencyService.convertStrict].
abstract final class LedgerMath {
  static int _sign(TxType t) => switch (t) {
        TxType.expense => -1,
        TxType.income => 1,
        TxType.transfer => 0,
      };

  /// Break a transaction into the signed contributions it makes to each account
  /// (amounts in the transaction's own currency, with the frozen account-amount
  /// carried through when present).
  static List<Contribution> contributions(LedgerTransaction tx) {
    if (tx.type == TxType.transfer) {
      final s = switch (tx.transferDir) {
        TransferDir.outbound => -1,
        TransferDir.inbound => 1,
        null => 0,
      };
      return [
        Contribution(
          accountId: tx.accountId,
          currency: tx.currency,
          minor: s * tx.amount,
          acctMinor: tx.acctMinor == null ? null : s * tx.acctMinor!,
        ),
      ];
    }

    final sign = _sign(tx.type);
    if (sign == 0) return const [];

    final splits = tx.splits;
    if (splits != null && splits.isNotEmpty) {
      return [
        for (final sp in splits)
          Contribution(
            accountId: sp.accountId ?? tx.accountId,
            currency: tx.currency,
            minor: sign * sp.amount,
            acctMinor: sp.acctMinor == null ? null : sign * sp.acctMinor!,
          ),
      ];
    }

    return [
      Contribution(
        accountId: tx.accountId,
        currency: tx.currency,
        minor: sign * tx.amount,
        acctMinor: tx.acctMinor == null ? null : sign * tx.acctMinor!,
      ),
    ];
  }

  /// Amount a contribution posts to an account, in the account's currency.
  /// Prefers the frozen value; falls back to live conversion; drops the row
  /// (0) on an unknown currency rather than corrupting the total.
  static int _postedAmount(
    Contribution c,
    String accountCurrency,
    CurrencyService fx,
  ) {
    final frozen = c.acctMinor;
    if (frozen != null) return frozen;
    try {
      return fx.convertStrict(c.minor, c.currency, accountCurrency);
    } on CurrencyException {
      return 0;
    }
  }

  /// Signed delta a single transaction applies to one account (its currency).
  static int accountDelta(
    LedgerTransaction tx,
    LedgerAccount account,
    CurrencyService fx,
  ) {
    var delta = 0;
    for (final c in contributions(tx)) {
      if (c.accountId != account.id) continue;
      delta += _postedAmount(c, account.currency, fx);
    }
    return delta;
  }

  /// Derived balance for every account: `openingBalance + Σ posted impact`.
  static Map<String, int> balances(
    List<LedgerAccount> accounts,
    List<LedgerTransaction> transactions,
    CurrencyService fx,
  ) {
    final byId = {for (final a in accounts) a.id: a};
    final totals = {for (final a in accounts) a.id: 0};

    for (final t in transactions) {
      for (final c in contributions(t)) {
        final acc = byId[c.accountId];
        if (acc == null) continue; // contribution to a deleted account is dropped
        totals[acc.id] = totals[acc.id]! + _postedAmount(c, acc.currency, fx);
      }
    }

    return {
      for (final a in accounts) a.id: a.openingBalance + (totals[a.id] ?? 0),
    };
  }

  /// Compute the account-currency amount to freeze for a raw posting, at the
  /// current rate. Used by the data layer when creating/editing a row (the Dart
  /// equivalent of the JS `stampAccountAmounts`, which mutated in place).
  /// Throws [CurrencyException] if the currency is unknown (caller leaves it
  /// unfrozen and retries later).
  static int freezeAmount(
    int rawMinor,
    String fromCurrency,
    LedgerAccount account,
    CurrencyService fx,
  ) =>
      fx.convertStrict(rawMinor, fromCurrency, account.currency);
}
