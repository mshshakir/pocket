/// Ledger value objects used by [LedgerMath]. Immutable by design — mutations
/// produce new instances, and the durable "frozen" account-currency amount
/// ([acctMinor]) is computed once at write time by the data layer.
import '../calendar/hijri_calendar.dart';
import '../recurring/recurrence.dart';

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

  /// Copy with selected fields replaced. Nullable fields ([color], [icon],
  /// [groupId]) use the [_undefined] sentinel so they can be explicitly
  /// cleared (e.g. `copyWith(groupId: null)` to ungroup).
  LedgerAccount copyWith({
    String? id,
    String? currency,
    int? openingBalance,
    String? name,
    String? type,
    Object? color = _undefined,
    Object? icon = _undefined,
    bool? archived,
    Object? groupId = _undefined,
  }) =>
      LedgerAccount(
        id: id ?? this.id,
        currency: currency ?? this.currency,
        openingBalance: openingBalance ?? this.openingBalance,
        name: name ?? this.name,
        type: type ?? this.type,
        color: color == _undefined ? this.color : color as String?,
        icon: icon == _undefined ? this.icon : icon as String?,
        archived: archived ?? this.archived,
        groupId: groupId == _undefined ? this.groupId : groupId as String?,
      );
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

  /// Non-null marks this transaction as a recurring TEMPLATE.
  final RecurringSpec? recurring;

  /// Set on generated instances; points at the template.
  final String? recurringSourceId;

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
    this.recurring,
    this.recurringSourceId,
  });

  /// Returns a copy with the given fields replaced. Nullable fields use the
  /// [_undefined] sentinel so they can be *explicitly cleared* (e.g.
  /// `copyWith(transferPairId: null)`) — a plain `null` default could not tell
  /// "leave unchanged" apart from "set to null". This replaces the hand-rolled
  /// field-for-field copies the controllers used to carry.
  LedgerTransaction copyWith({
    String? id,
    TxType? type,
    String? accountId,
    String? currency,
    int? amount,
    Object? acctMinor = _undefined,
    Object? transferDir = _undefined,
    Object? splits = _undefined,
    Object? categoryId = _undefined,
    Object? date = _undefined,
    Object? hijriDate = _undefined,
    String? payee,
    String? note,
    String? paymentType,
    String? recordState,
    Object? transferPairId = _undefined,
    Object? transferRate = _undefined,
    Object? exchangeRate = _undefined,
    Object? refAmountMinor = _undefined,
    List<String>? tags,
    Object? addedBy = _undefined,
    Object? debtId = _undefined,
    Object? debtRole = _undefined,
    Object? regularItemId = _undefined,
    Object? recurring = _undefined,
    Object? recurringSourceId = _undefined,
  }) =>
      LedgerTransaction(
        id: id ?? this.id,
        type: type ?? this.type,
        accountId: accountId ?? this.accountId,
        currency: currency ?? this.currency,
        amount: amount ?? this.amount,
        acctMinor: acctMinor == _undefined ? this.acctMinor : acctMinor as int?,
        transferDir: transferDir == _undefined
            ? this.transferDir
            : transferDir as TransferDir?,
        splits:
            splits == _undefined ? this.splits : splits as List<LedgerSplit>?,
        categoryId:
            categoryId == _undefined ? this.categoryId : categoryId as String?,
        date: date == _undefined ? this.date : date as DateTime?,
        hijriDate:
            hijriDate == _undefined ? this.hijriDate : hijriDate as HijriDate?,
        payee: payee ?? this.payee,
        note: note ?? this.note,
        paymentType: paymentType ?? this.paymentType,
        recordState: recordState ?? this.recordState,
        transferPairId: transferPairId == _undefined
            ? this.transferPairId
            : transferPairId as String?,
        transferRate: transferRate == _undefined
            ? this.transferRate
            : transferRate as num?,
        exchangeRate: exchangeRate == _undefined
            ? this.exchangeRate
            : exchangeRate as num?,
        refAmountMinor: refAmountMinor == _undefined
            ? this.refAmountMinor
            : refAmountMinor as int?,
        tags: tags ?? this.tags,
        addedBy: addedBy == _undefined ? this.addedBy : addedBy as String?,
        debtId: debtId == _undefined ? this.debtId : debtId as String?,
        debtRole: debtRole == _undefined ? this.debtRole : debtRole as String?,
        regularItemId: regularItemId == _undefined
            ? this.regularItemId
            : regularItemId as String?,
        recurring: recurring == _undefined
            ? this.recurring
            : recurring as RecurringSpec?,
        recurringSourceId: recurringSourceId == _undefined
            ? this.recurringSourceId
            : recurringSourceId as String?,
      );
}

/// Sentinel marking "argument not supplied" in [LedgerTransaction.copyWith],
/// so callers can pass an explicit `null` to clear a nullable field.
const Object _undefined = Object();

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
