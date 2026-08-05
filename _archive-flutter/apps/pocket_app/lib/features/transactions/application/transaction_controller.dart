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

  /// Saves (creates or updates) a non-transfer transaction. When [splits] is
  /// non-empty their amounts must sum to [amount] (validated by the caller;
  /// re-checked here) and the per-row category drives budgets/reports.
  ///
  /// [currency] may differ from the account's (legacy FX panel): the
  /// account-currency impact is rate-FROZEN into `acctMinor` at write time,
  /// and `exchangeRate`/`refAmountMinor` snapshot the tx→home conversion, so
  /// history never drifts when FX rates change.
  Future<void> save({
    String? id,
    required TxType type,
    required LedgerAccount account,
    required int amount,
    String? currency,
    String? homeCurrency,
    String? categoryId,
    required DateTime date,
    String payee = '',
    String note = '',
    String paymentType = 'card',
    String recordState = 'cleared',
    List<LedgerSplit>? splits,
    RecurringSpec? recurring,
  }) async {
    if (splits != null && splits.isNotEmpty) {
      final sum = splits.fold<int>(0, (s, x) => s + x.amount);
      if (sum != amount) {
        throw ArgumentError(
            'Split amounts ($sum) must equal the transaction total ($amount)');
      }
    }
    final txCurrency = currency ?? account.currency;
    final sameCcy = txCurrency == account.currency;
    final home = homeCurrency ?? txCurrency;
    final homeRate = _fx.rates[home];
    final txRate = _fx.rates[txCurrency];
    final day = DateTime(date.year, date.month, date.day);
    await _txs.upsert(LedgerTransaction(
      id: id ?? _uuid.v4(),
      type: type,
      accountId: account.id,
      currency: txCurrency,
      amount: amount,
      acctMinor:
          sameCcy ? amount : _fx.convert(amount, txCurrency, account.currency),
      exchangeRate: (homeRate == null || txRate == null || homeRate == 0)
          ? null
          : txRate / homeRate,
      refAmountMinor: _fx.convert(amount, txCurrency, home),
      categoryId: (splits != null && splits.isNotEmpty) ? null : categoryId,
      splits: (splits == null || splits.isEmpty) ? null : splits,
      payee: payee,
      note: note,
      paymentType: paymentType,
      recordState: recordState,
      date: day,
      hijriDate: _hijriFor(day),
      recurring: recurring,
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
    await _txs.upsert(outLeg.copyWith(transferPairId: inId));
  }

  /// Edits an existing transfer in place (both legs). [amount] is in the
  /// source account's currency; the destination leg is re-converted at today's
  /// rate and re-frozen, and date/note apply to both legs. The accounts and
  /// pairing are preserved — only the mutable fields change (legacy parity).
  Future<void> updateTransfer({
    required LedgerTransaction outLeg,
    required LedgerTransaction inLeg,
    required LedgerAccount from,
    required LedgerAccount to,
    required int amount,
    required DateTime date,
    String note = '',
  }) async {
    final day = DateTime(date.year, date.month, date.day);
    final hijri = _hijriFor(day);
    final inAmount = _fx.convert(amount, from.currency, to.currency);
    final rate = amount == 0 ? null : inAmount / amount;

    await _txs.upsert(outLeg.copyWith(
      amount: amount,
      acctMinor: amount,
      date: day,
      hijriDate: hijri,
      note: note,
      transferRate: rate,
    ));
    await _txs.upsert(inLeg.copyWith(
      amount: inAmount,
      acctMinor: inAmount,
      date: day,
      hijriDate: hijri,
      note: note,
      transferRate: rate,
    ));
  }

  /// Deletes a transaction; if it is one leg of a transfer, the pair leg goes
  /// with it (legacy behavior).
  Future<void> delete(
      LedgerTransaction tx, List<LedgerTransaction> all) async {
    final pair = _pairOf(tx, all);
    // Unlink first so the FK doesn't block the delete order on upload.
    if (pair != null) {
      await _txs.upsert(pair.copyWith(transferPairId: null));
      await _txs.upsert(tx.copyWith(transferPairId: null));
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
}

final transactionControllerProvider =
    Provider<TransactionController>((ref) => TransactionController(
          ref.watch(transactionRepositoryProvider),
          ref.watch(fxProvider),
          hijriOffset:
              ref.watch(settingsProvider).valueOrNull?.hijriOffset ?? 0,
        ));
