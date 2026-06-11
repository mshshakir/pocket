/// Debt domain — entities + service.
///
/// Ported from legacy-web `DebtsView`/`DebtModal`/`app.js` debt CRUD. The
/// load-bearing rules preserved here:
///  * Payments of a debt are the transactions with `debtId == debt.id`
///    EXCLUDING the initial transaction (`initialTxId`) — and nothing else
///    (no broad type filters that double-count, legacy Bug 14).
///  * Cross-currency payments are converted into the DEBT's currency before
///    comparing against the principal (legacy Bug 11).
///  * Recording a debt creates a real ledger transaction on the linked
///    account (income when borrowed, expense when lent); payments create the
///    opposite type.
library;

import '../calendar/hijri_calendar.dart';
import '../ledger/ledger_entities.dart';
import '../money/currency_service.dart';

enum DebtType { borrowed, lent }

enum DebtStatus { active, paid }

/// A loan/IOU between the user and a counterparty, linked to an account.
/// Immutable; amounts are minor units of [currency].
class Debt {
  final String id;
  final DebtType type;
  final String counterparty;
  final int principal;
  final String currency;
  final String? accountId;
  final DateTime? dateTaken;
  final DateTime? dueDate;
  final String note;
  final DebtStatus status;

  /// The ledger transaction that moved the principal into/out of the linked
  /// account when the debt was recorded. Excluded from payment sums.
  final String? initialTxId;

  const Debt({
    required this.id,
    required this.type,
    required this.counterparty,
    required this.principal,
    required this.currency,
    this.accountId,
    this.dateTaken,
    this.dueDate,
    this.note = '',
    this.status = DebtStatus.active,
    this.initialTxId,
  });

  bool get isBorrowed => type == DebtType.borrowed;
  bool get isPaid => status == DebtStatus.paid;

  Debt copyWith({
    String? counterparty,
    DateTime? dueDate,
    bool clearDueDate = false,
    String? note,
    DebtStatus? status,
    String? initialTxId,
  }) =>
      Debt(
        id: id,
        type: type,
        counterparty: counterparty ?? this.counterparty,
        principal: principal,
        currency: currency,
        accountId: accountId,
        dateTaken: dateTaken,
        dueDate: clearDueDate ? null : (dueDate ?? this.dueDate),
        note: note ?? this.note,
        status: status ?? this.status,
        initialTxId: initialTxId ?? this.initialTxId,
      );
}

/// Pure debt arithmetic + the factory methods that keep debt-linked ledger
/// transactions consistent with the legacy app's behavior.
class DebtService {
  final CurrencyService fx;

  const DebtService(this.fx);

  /// Payment transactions of [debt]: linked via debtId, excluding the initial
  /// principal transaction.
  List<LedgerTransaction> paymentsOf(
          Debt debt, Iterable<LedgerTransaction> txs) =>
      [
        for (final t in txs)
          if (t.debtId == debt.id && t.id != debt.initialTxId) t,
      ];

  /// Total repaid so far, in the debt's currency (cross-currency aware).
  int paidAmount(Debt debt, Iterable<LedgerTransaction> txs) {
    var paid = 0;
    for (final t in paymentsOf(debt, txs)) {
      final from = t.currency.isEmpty ? debt.currency : t.currency;
      paid += fx.convert(t.amount, from, debt.currency);
    }
    return paid;
  }

  /// Remaining balance = principal − payments, floored at 0.
  int remaining(Debt debt, Iterable<LedgerTransaction> txs) {
    final rem = debt.principal - paidAmount(debt, txs);
    return rem < 0 ? 0 : rem;
  }

  /// Percentage repaid, 0–100. A zero-principal debt counts as fully repaid.
  int percentRepaid(Debt debt, Iterable<LedgerTransaction> txs) {
    if (debt.principal == 0) return 100;
    final pct = (100 * paidAmount(debt, txs) / debt.principal).round();
    return pct > 100 ? 100 : pct;
  }

  /// True when payments (converted into the debt currency) cover the
  /// principal — used to auto-mark a debt paid after a payment.
  bool isSettled(Debt debt, Iterable<LedgerTransaction> txs) =>
      remaining(debt, txs) == 0;

  /// The ledger transaction that posts the principal to the linked account:
  /// borrowing ADDS money (income), lending REMOVES it (expense).
  LedgerTransaction buildInitialTransaction({
    required Debt debt,
    required String txId,
    required String accountCurrency,
    HijriDate? hijriDate,
  }) {
    return LedgerTransaction(
      id: txId,
      type: debt.isBorrowed ? TxType.income : TxType.expense,
      accountId: debt.accountId!,
      currency: debt.currency,
      amount: debt.principal,
      acctMinor: fx.convert(debt.principal, debt.currency, accountCurrency),
      payee: debt.counterparty,
      note: debt.isBorrowed
          ? 'Borrowed from ${debt.counterparty}'
          : 'Lent to ${debt.counterparty}',
      paymentType: 'transfer',
      date: debt.dateTaken,
      hijriDate: hijriDate,
      tags: const ['debt'],
      debtId: debt.id,
      debtRole: 'initial',
    );
  }

  /// A repayment transaction: paying back a borrow is an expense; receiving
  /// a repayment of a loan is income.
  LedgerTransaction buildPaymentTransaction({
    required Debt debt,
    required String txId,
    required String accountId,
    required String accountCurrency,
    required int amount,
    DateTime? date,
    String note = '',
    HijriDate? hijriDate,
  }) {
    return LedgerTransaction(
      id: txId,
      type: debt.isBorrowed ? TxType.expense : TxType.income,
      accountId: accountId,
      currency: debt.currency,
      amount: amount,
      acctMinor: fx.convert(amount, debt.currency, accountCurrency),
      payee: debt.counterparty,
      note: note.isEmpty
          ? (debt.isBorrowed
              ? 'Debt payment to ${debt.counterparty}'
              : 'Repayment from ${debt.counterparty}')
          : note,
      paymentType: 'transfer',
      date: date,
      hijriDate: hijriDate,
      tags: const ['debt-payment'],
      debtId: debt.id,
      debtRole: 'payment',
    );
  }
}
