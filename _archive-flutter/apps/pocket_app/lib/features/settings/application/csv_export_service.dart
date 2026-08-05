import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../dashboard/application/dashboard_providers.dart';

/// CSV export — a faithful port of legacy `app.js exportCsv`:
///  * identical column set (mirrors the import template);
///  * transfers emit ONE row from the out-leg (ToAccount/ToAmount/ToCurrency,
///    cross-currency only fills To* when currencies differ);
///  * debt rows carry the debt type (borrowed/lent) for the initial posting,
///    DueDate and DebtRef; payments carry DebtRef only;
///  * split transactions emit one row per split, linked by SplitOf;
///  * RFC-4180 quoting for cells containing commas/quotes/newlines.
class CsvExportService {
  final CurrencyService fx;

  const CsvExportService(this.fx);

  static const List<String> headers = [
    'Date', 'Type', 'Account', 'ToAccount', 'ToAmount', 'ToCurrency',
    'Category', 'Subcategory', 'Payee', 'Note', 'Amount', 'Currency',
    'PaymentType', 'Tags', 'DueDate', 'DebtRef', 'SplitOf',
    'CreatedAt', 'AddedBy',
  ];

  /// [rangeDays] null = all time. [rangeStart]/[rangeEnd] (inclusive) take
  /// precedence when supplied — used by the "current range" export that mirrors
  /// the Transactions screen's date filter.
  String export({
    required List<LedgerTransaction> transactions,
    required List<LedgerAccount> accounts,
    required List<CategoryNode> categories,
    required List<Debt> debts,
    int? rangeDays,
    DateTime? rangeStart,
    DateTime? rangeEnd,
    DateTime? now,
  }) {
    final today = now ?? DateTime.now();
    final cutoff = rangeDays == null
        ? null
        : DateTime(today.year, today.month, today.day)
            .subtract(Duration(days: rangeDays));
    final start = rangeStart == null
        ? null
        : DateTime(rangeStart.year, rangeStart.month, rangeStart.day);
    final end = rangeEnd == null
        ? null
        : DateTime(rangeEnd.year, rangeEnd.month, rangeEnd.day);

    final accountById = {for (final a in accounts) a.id: a};
    final catById = {for (final c in categories) c.id: c};
    final debtById = {for (final d in debts) d.id: d};
    final txById = {for (final t in transactions) t.id: t};

    final txs = [
      for (final t in transactions)
        if (t.date != null &&
            (cutoff == null || !t.date!.isBefore(cutoff)) &&
            (start == null || !t.date!.isBefore(start)) &&
            (end == null || !t.date!.isAfter(end)))
          t,
    ]..sort((a, b) => a.date!.compareTo(b.date!));

    final rows = <List<String>>[headers];
    final emitted = <String>{};

    (String, String) catPair(String? id) {
      final cat = id == null ? null : catById[id];
      if (cat == null) return ('', '');
      if (cat.parentId != null) {
        return (catById[cat.parentId]?.name ?? '', cat.name);
      }
      return (cat.name, '');
    }

    String money(int minor, String currency) =>
        fx.fromMinor(minor, currency).toStringAsFixed(fx.minorDigits(currency));

    String iso(DateTime d) =>
        '${d.year.toString().padLeft(4, '0')}-'
        '${d.month.toString().padLeft(2, '0')}-'
        '${d.day.toString().padLeft(2, '0')}';

    String clean(String s) => s.replaceAll(RegExp(r'[\r\n]+'), ' ');

    void emit(Map<String, String> cells) {
      rows.add([for (final h in headers) cells[h] ?? '']);
    }

    for (final t in txs) {
      if (emitted.contains(t.id)) continue;
      final acc = accountById[t.accountId];

      // Transfers: one row from the out-leg.
      if (t.type == TxType.transfer) {
        if (t.transferDir == TransferDir.inbound) continue;
        LedgerTransaction? pair;
        if (t.transferPairId != null) pair = txById[t.transferPairId];
        pair ??= () {
          for (final x in transactions) {
            if (x.id != t.id && x.transferPairId == t.id) return x;
          }
          return null;
        }();
        final accTo = pair == null ? null : accountById[pair.accountId];
        final crossCcy = pair != null && pair.currency != t.currency;
        emit({
          'Date': iso(t.date!),
          'Type': 'transfer',
          'Account': acc?.name ?? '',
          'ToAccount': accTo?.name ?? '',
          'ToAmount': crossCcy ? money(pair.amount, pair.currency) : '',
          'ToCurrency': crossCcy ? pair.currency : '',
          'Payee': t.payee,
          'Note': clean(t.note),
          'Amount': money(t.amount, t.currency),
          'Currency': t.currency,
          'PaymentType': t.paymentType,
          'Tags': t.tags.join(','),
          'AddedBy': t.addedBy ?? '',
        });
        emitted.add(t.id);
        if (pair != null) emitted.add(pair.id);
        continue;
      }

      // Debt-linked rows.
      final debt = t.debtId == null ? null : debtById[t.debtId];
      if (debt != null) {
        final isInitial = t.debtRole == 'initial';
        emit({
          'Date': iso(t.date!),
          'Type': isInitial
              ? (debt.type == DebtType.lent ? 'lent' : 'borrowed')
              : t.type.name,
          'Account': acc?.name ?? '',
          'Payee': isInitial ? debt.counterparty : t.payee,
          'Note': clean(t.note.isEmpty && isInitial ? debt.note : t.note),
          'Amount': money(t.amount, t.currency),
          'Currency': t.currency,
          'PaymentType': t.paymentType,
          'Tags': t.tags.join(','),
          'DueDate':
              isInitial && debt.dueDate != null ? iso(debt.dueDate!) : '',
          'DebtRef': debt.id,
          'AddedBy': t.addedBy ?? '',
        });
        emitted.add(t.id);
        continue;
      }

      // Splits: one row per split, linked by SplitOf.
      if (t.splits != null && t.splits!.isNotEmpty) {
        for (final s in t.splits!) {
          final sAcc = accountById[s.accountId ?? t.accountId];
          final (cn, sn) = catPair(s.categoryId);
          emit({
            'Date': iso(t.date!),
            'Type': t.type.name,
            'Account': sAcc?.name ?? '',
            'Category': cn,
            'Subcategory': sn,
            'Payee': t.payee,
            'Note': clean(t.note),
            'Amount': money(s.amount, t.currency),
            'Currency': t.currency,
            'PaymentType': t.paymentType,
            'Tags': t.tags.join(','),
            'SplitOf': t.id,
            'AddedBy': t.addedBy ?? '',
          });
        }
        emitted.add(t.id);
        continue;
      }

      // Plain rows.
      final (cn, sn) = catPair(t.categoryId);
      emit({
        'Date': iso(t.date!),
        'Type': t.type.name,
        'Account': acc?.name ?? '',
        'Category': cn,
        'Subcategory': sn,
        'Payee': t.payee,
        'Note': clean(t.note),
        'Amount': money(t.amount, t.currency),
        'Currency': t.currency,
        'PaymentType': t.paymentType,
        'Tags': t.tags.join(','),
        'AddedBy': t.addedBy ?? '',
      });
      emitted.add(t.id);
    }

    return rows.map((r) => r.map(_cell).join(',')).join('\n');
  }

  /// RFC-4180: quote cells containing commas, quotes or newlines.
  static String _cell(String s) =>
      RegExp(r'[",\n]').hasMatch(s) ? '"${s.replaceAll('"', '""')}"' : s;
}

final csvExportServiceProvider =
    Provider<CsvExportService>((ref) => CsvExportService(ref.watch(fxProvider)));
