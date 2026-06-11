/// Ledger value objects used by [LedgerMath]. Immutable by design — mutations
/// produce new instances, and the durable "frozen" account-currency amount
/// ([acctMinor]) is computed once at write time by the data layer.
import '../calendar/hijri_calendar.dart';

enum TxType { expense, income, transfer }

/// 'in' adds to the account, 'out' subtracts (transfers only).
enum TransferDir { inbound, outbound }

class LedgerAccount {
  final String id;
  final String currency;

  /// Opening balance in this account's minor units. The full balance is
  /// `openingBalance + Σ posted contributions` (see [LedgerMath.balances]).
  final int openingBalance;

  // ── Display / organisation fields ─────────────────────────────────────
  final String name;
  final String type; // bank|cash|card|…
  final String? color;
  final String? icon;
  final bool archived;
  final String? groupId;

  const LedgerAccount({
    required this.id,
    required this.currency,
    this.openingBalance = 0,
    this.name = '',
    this.type = 'bank',
    this.color,
    this.icon,
    this.archived = false,
    this.groupId,
  });
}

class LedgerSplit {
  /// Row id (assigned by the data layer; null for freshly-built splits).
  final String? id;

  /// Falls back to the transaction's account when null.
  final String? accountId;

  /// Category this split row counts toward (budgets read this).
  final String? categoryId;

  /// Amount in the transaction's currency (minor units).
  final int amount;

  /// Rate-frozen amount in the split account's currency (minor units). When
  /// null, the balance engine converts live via [CurrencyService].
  final int? acctMinor;

  const LedgerSplit({
    this.id,
    this.accountId,
    this.categoryId,
    required this.amount,
    this.acctMinor,
  });
}

class LedgerTransaction {
  final String id;
  final TxType type;
  final String accountId;
  final String currency;

  /// Amount in [currency] (minor units), always unsigned; sign comes from type.
  final int amount;

  /// Rate-frozen amount in the *account's* currency (minor units). Preferred by
  /// the balance engine so historical impact never drifts when FX changes.
  final int? acctMinor;

  /// Transfers only.
  final TransferDir? transferDir;

  /// Non-null + non-empty marks a split transaction.
  final List<LedgerSplit>? splits;

  // ── Fields used by budgeting/reporting (not by balance math) ──────────
  /// Category for a non-split transaction.
  final String? categoryId;

  /// Posting date.
  final DateTime? date;

  /// Hijri date snapshot taken at creation time (immutable; budgets read this
  /// instead of recomputing, so a later offset change never reclassifies a
  /// past transaction).
  final HijriDate? hijriDate;

  // ── Display / meta fields (snapshots + bookkeeping) ───────────────────
  final String payee;
  final String note;
  final String paymentType;
  final String recordState;
  final String? transferPairId;
  final num? transferRate;
  final num? exchangeRate;   // tx→home snapshot
  final int? refAmountMinor; // amount in home currency snapshot
  final List<String> tags;
  final String? addedBy;     // member email for shared contributions

  // ── Feature links ──────────────────────────────────────────────────────
  /// Debt this transaction belongs to, when it is a debt principal/payment.
  final String? debtId;

  /// 'initial' | 'payment' | null.
  final String? debtRole;

  /// Regular-purchase item this transaction was quick-logged from.
  final String? regularItemId;

  const LedgerTransaction({
    required this.id,
    required this.type,
    required this.accountId,
    required this.currency,
    required this.amount,
    this.acctMinor,
    this.transferDir,
    this.splits,
    this.categoryId,
    this.date,
    this.hijriDate,
    this.payee = '',
    this.note = '',
    this.paymentType = 'card',
    this.recordState = 'cleared',
    this.transferPairId,
    this.transferRate,
    this.exchangeRate,
    this.refAmountMinor,
    this.tags = const [],
    this.addedBy,
    this.debtId,
    this.debtRole,
    this.regularItemId,
  });
}

/// One signed posting a transaction makes to a single account.
class Contribution {
  final String accountId;
  final String currency;

  /// Signed amount in the transaction's currency.
  final int minor;

  /// Signed rate-frozen amount in the account's currency, when available.
  final int? acctMinor;

  const Contribution({
    required this.accountId,
    required this.currency,
    required this.minor,
    this.acctMinor,
  });
}
