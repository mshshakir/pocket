import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../dashboard/application/dashboard_providers.dart';

/// Transaction use-cases: plain income/expense, two-leg transfers, edits and
/// deletes. Transfers follow the legacy model — two paired rows (`out` from
/// the source, `in` to the destination) linked via `transferPairId`.
///
/// Insert order is FK-safe for the Postgres upload: the source leg is first
/// inserted with a null pair id, then the destination leg (pointing at the
/// source), then the source leg is updated to point back.
class TransactionController {
  final TransactionRepository _txs;
  final CurrencyService _fx;
  final int hijriOffset;
  final Uuid _uuid;

  TransactionController(this._txs, this._fx,
      {this.hijriOffset = 0, Uuid uuid = const Uuid()})
      : _uuid = uuid;

  HijriDate _hijriFor(DateTime date) =>
      const HijriCalendar().toHijri(date, offset: hijriOffset);

  /// Saves (creates or updates) a non-transfer transaction.
  Future<void> save({
    String? id,
    required TxType type,
    required LedgerAccount account,
    required int amount,
    String? categoryId,
    required DateTime date,
    String payee = '',
    String note = '',
  }) async {
    final day = DateTime(date.year, date.month, date.day);
    await _txs.upsert(LedgerTransaction(
      id: id ?? _uuid.v4(),
      type: type,
      accountId: account.id,
      currency: account.currency,
      amount: amount,
      acctMinor: amount, // entered in the account's currency
      categoryId: categoryId,
      payee: payee,
      note: note,
      date: day,
      hijriDate: _hijriFor(day),
    ));
  }

  /// Creates a transfer: [amount] leaves [from] (in from-currency); the
  /// destination leg is converted at today's rate and rate-frozen.
  Future<void> saveTransfer({
    required LedgerAccount from,
    required LedgerAccount to,
    required int amount,
    required DateTime date,
    String note = '',
  }) async {
    final day = DateTime(date.year, date.month, date.day);
    final hijri = _hijriFor(day);
    final outId = _uuid.v4();
    final inId = _uuid.v4();
    final inAmount = _fx.convert(amount, from.currency, to.currency);
    final rate = amount == 0 ? null : inAmount / amount;

    final outLeg = LedgerTransaction(
      id: outId,
      type: TxType.transfer,
      transferDir: TransferDir.outbound,
      accountId: from.id,
      currency: from.currency,
      amount: amount,
      acctMinor: amount,
      payee: 'Transfer to ${to.name}',
      note: note,
      paymentType: 'transfer',
      date: day,
      hijriDate: hijri,
      transferRate: rate,
    );
    final inLeg = LedgerTransaction(
      id: inId,
      type: TxType.transfer,
      transferDir: TransferDir.inbound,
      accountId: to.id,
      currency: to.currency,
      amount: inAmount,
      acctMinor: inAmount,
      payee: 'Transfer from ${from.name}',
      note: note,
      paymentType: 'transfer',
      date: day,
      hijriDate: hijri,
      transferPairId: outId,
      transferRate: rate,
    );

    // FK-safe order: out (pair null) → in (pair=out) → out again (pair=in).
    await _txs.upsert(outLeg);
    await _txs.upsert(inLeg);
    await _txs.upsert(_withPair(outLeg, inId));
  }

  /// Deletes a transaction; if it is one leg of a transfer, the pair leg goes
  /// with it (legacy behavior).
  Future<void> delete(
      LedgerTransaction tx, List<LedgerTransaction> all) async {
    final pair = _pairOf(tx, all);
    // Unlink first so the FK doesn't block the delete order on upload.
    if (pair != null) {
      await _txs.upsert(_withPair(pair, null));
      await _txs.upsert(_withPair(tx, null));
      await _txs.remove(pair.id);
    }
    await _txs.remove(tx.id);
  }

  LedgerTransaction? _pairOf(
      LedgerTransaction tx, List<LedgerTransaction> all) {
    if (tx.type != TxType.transfer) return null;
    for (final t in all) {
      if (t.id != tx.id &&
          (t.transferPairId == tx.id || tx.transferPairId == t.id)) {
        return t;
      }
    }
    return null;
  }

  LedgerTransaction _withPair(LedgerTransaction t, String? pairId) =>
      LedgerTransaction(
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
        transferPairId: pairId,
        transferRate: t.transferRate,
        exchangeRate: t.exchangeRate,
        refAmountMinor: t.refAmountMinor,
        tags: t.tags,
        addedBy: t.addedBy,
        debtId: t.debtId,
        debtRole: t.debtRole,
        regularItemId: t.regularItemId,
      );
}

final transactionControllerProvider =
    Provider<TransactionController>((ref) => TransactionController(
          ref.watch(transactionRepositoryProvider),
          ref.watch(fxProvider),
          hijriOffset:
              ref.watch(settingsProvider).valueOrNull?.hijriOffset ?? 0,
        ));
