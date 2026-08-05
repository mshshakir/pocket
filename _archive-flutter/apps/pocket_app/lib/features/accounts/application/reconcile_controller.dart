import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../dashboard/application/dashboard_providers.dart';

/// Reconciliation for the normalized model: balances are always derived from
/// the ledger, so "reconcile" means the user enters the account's REAL
/// balance (from their bank) and we book the difference as an adjustment
/// transaction tagged `adjustment` (the spiritual port of the legacy
/// ReconcileModal's "add compensating entry" path — its "overwrite stored
/// balance" path no longer exists because there is no stored balance).
class ReconcileController {
  final TransactionRepository _txs;
  final int hijriOffset;
  final Uuid _uuid;

  ReconcileController(this._txs, {this.hijriOffset = 0, Uuid uuid = const Uuid()})
      : _uuid = uuid;

  /// Returns the signed difference booked (0 = already balanced).
  Future<int> reconcile({
    required LedgerAccount account,
    required int actualBalance,
    required int derivedBalance,
  }) async {
    final diff = actualBalance - derivedBalance;
    if (diff == 0) return 0;
    final now = DateTime.now();
    final day = DateTime(now.year, now.month, now.day);
    await _txs.upsert(LedgerTransaction(
      id: _uuid.v4(),
      type: diff > 0 ? TxType.income : TxType.expense,
      accountId: account.id,
      currency: account.currency,
      amount: diff.abs(),
      acctMinor: diff.abs(),
      payee: 'Balance adjustment',
      note: 'Reconciled to actual balance',
      date: day,
      hijriDate: const HijriCalendar().toHijri(day, offset: hijriOffset),
      tags: const ['adjustment'],
    ));
    return diff;
  }
}

final reconcileControllerProvider =
    Provider<ReconcileController>((ref) => ReconcileController(
          ref.watch(transactionRepositoryProvider),
          hijriOffset:
              ref.watch(settingsProvider).valueOrNull?.hijriOffset ?? 0,
        ));
