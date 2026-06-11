import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../dashboard/application/dashboard_providers.dart';

/// Debt use-cases — the only write path for debts. Keeps the debt row and its
/// linked ledger transactions consistent, mirroring legacy `app.js`:
///  * recording a debt posts the principal to the linked account;
///  * a payment posts the opposite type and auto-marks the debt paid when the
///    converted payments cover the principal (legacy bug 11);
///  * deleting reverts the initial transaction and either destroys or unlinks
///    the payment transactions.
class DebtController {
  final DebtRepository _debts;
  final TransactionRepository _txs;
  final DebtService _svc;

  /// User's moon-sighting correction, applied to Hijri snapshots at write time
  /// (snapshots are immutable afterwards, like the legacy app).
  final int hijriOffset;
  final Uuid _uuid;

  DebtController(this._debts, this._txs, this._svc,
      {this.hijriOffset = 0, Uuid uuid = const Uuid()})
      : _uuid = uuid;

  Future<void> recordDebt({
    required DebtType type,
    required String counterparty,
    required int principal,
    required String currency,
    required LedgerAccount account,
    required DateTime dateTaken,
    DateTime? dueDate,
    String note = '',
  }) async {
    final debt = Debt(
      id: _uuid.v4(),
      type: type,
      counterparty: counterparty,
      principal: principal,
      currency: currency,
      accountId: account.id,
      dateTaken: dateTaken,
      dueDate: dueDate,
      note: note,
      initialTxId: _uuid.v4(),
    );
    final tx = _svc.buildInitialTransaction(
      debt: debt,
      txId: debt.initialTxId!,
      accountCurrency: account.currency,
      hijriDate: const HijriCalendar().toHijri(dateTaken, offset: hijriOffset),
    );
    await _txs.upsert(tx);
    await _debts.upsert(debt);
  }

  /// Editing only touches the mutable fields (counterparty, due date, note,
  /// status) — principal/account/currency are frozen, like the legacy modal.
  Future<void> updateDebt(Debt updated) => _debts.upsert(updated);

  Future<void> recordPayment({
    required Debt debt,
    required LedgerAccount account,
    required int amount,
    required List<LedgerTransaction> allTransactions,
    DateTime? date,
    String note = '',
  }) async {
    final when = date ?? DateTime.now();
    final tx = _svc.buildPaymentTransaction(
      debt: debt,
      txId: _uuid.v4(),
      accountId: account.id,
      accountCurrency: account.currency,
      amount: amount,
      date: DateTime(when.year, when.month, when.day),
      note: note,
      hijriDate: const HijriCalendar().toHijri(when, offset: hijriOffset),
    );
    await _txs.upsert(tx);

    // Auto-mark paid once payments (converted into the debt currency) cover
    // the principal.
    final settled = _svc.isSettled(debt, [...allTransactions, tx]);
    if (settled && !debt.isPaid) {
      await _debts.upsert(debt.copyWith(status: DebtStatus.paid));
    }
  }

  Future<void> deleteDebt({
    required Debt debt,
    required List<LedgerTransaction> allTransactions,
    bool destroyPayments = false,
  }) async {
    if (debt.initialTxId != null) {
      await _txs.remove(debt.initialTxId!);
    }
    for (final p in _svc.paymentsOf(debt, allTransactions)) {
      if (destroyPayments) {
        await _txs.remove(p.id);
      } else {
        await _txs.upsert(_withoutDebtLink(p));
      }
    }
    await _debts.remove(debt.id);
  }

  /// A field-for-field copy with the debt link cleared (kept here, not on the
  /// entity, so the domain stays free of feature-specific copy helpers).
  LedgerTransaction _withoutDebtLink(LedgerTransaction t) => LedgerTransaction(
        id: t.id,
        type: t.type,
        accountId: t.accountId,
        currency: t.currency,
        amount: t.amount,
        acctMinor: t.acctMinor,
        transferDir: t.transferDir,
        splits: t.splits,
        categoryId: t.categoryId,
        date: t.date,
        hijriDate: t.hijriDate,
        payee: t.payee,
        note: t.note,
        paymentType: t.paymentType,
        recordState: t.recordState,
        transferPairId: t.transferPairId,
        transferRate: t.transferRate,
        exchangeRate: t.exchangeRate,
        refAmountMinor: t.refAmountMinor,
        tags: t.tags,
        addedBy: t.addedBy,
        // debtId / debtRole intentionally omitted (null).
        regularItemId: t.regularItemId,
      );
}

final debtControllerProvider = Provider<DebtController>((ref) => DebtController(
      ref.watch(debtRepositoryProvider),
      ref.watch(transactionRepositoryProvider),
      ref.watch(debtServiceProvider),
      hijriOffset: ref.watch(settingsProvider).valueOrNull?.hijriOffset ?? 0,
    ));
