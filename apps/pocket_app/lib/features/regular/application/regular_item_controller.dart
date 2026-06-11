import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../dashboard/application/dashboard_providers.dart';

/// Regular-purchase use-cases: manage the items and quick-log a purchase
/// (which creates a real expense transaction linked via `regularItemId`,
/// exactly like the legacy quick-log).
class RegularItemController {
  final RegularItemRepository _items;
  final TransactionRepository _txs;
  final CurrencyService _fx;
  final int hijriOffset;
  final Uuid _uuid;

  RegularItemController(this._items, this._txs, this._fx,
      {this.hijriOffset = 0, Uuid uuid = const Uuid()})
      : _uuid = uuid;

  Future<void> save(RegularItem item) => _items.upsert(item);

  Future<void> delete(String id) => _items.remove(id);

  /// Logs one purchase of [item] today (or [date]) for [amount] minor units —
  /// defaults to the item's default amount. Requires a resolvable account.
  Future<void> log({
    required RegularItem item,
    required LedgerAccount account,
    int? amount,
    DateTime? date,
  }) async {
    final when = date ?? DateTime.now();
    final minor = amount ?? item.defaultAmount;
    await _txs.upsert(LedgerTransaction(
      id: _uuid.v4(),
      type: TxType.expense,
      accountId: account.id,
      currency: item.currency,
      amount: minor,
      acctMinor: _fx.convert(minor, item.currency, account.currency),
      categoryId: item.categoryId,
      payee: item.name,
      date: DateTime(when.year, when.month, when.day),
      hijriDate: const HijriCalendar().toHijri(when, offset: hijriOffset),
      tags: const ['regular'],
      regularItemId: item.id,
    ));
  }

  String newId() => _uuid.v4();
}

final regularItemControllerProvider =
    Provider<RegularItemController>((ref) => RegularItemController(
          ref.watch(regularItemRepositoryProvider),
          ref.watch(transactionRepositoryProvider),
          ref.watch(fxProvider),
          hijriOffset:
              ref.watch(settingsProvider).valueOrNull?.hijriOffset ?? 0,
        ));
