import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../dashboard/application/dashboard_providers.dart';
import '../../debts/application/debt_controller.dart';
import '../../transactions/application/transaction_controller.dart';
import 'csv_import_service.dart';

class ImportSummary {
  final int transactions;
  final int accounts;
  final int categories;
  final int debts;
  final int skipped;
  const ImportSummary(
      {required this.transactions,
      required this.accounts,
      required this.categories,
      required this.debts,
      required this.skipped});
}

/// Commits an [ImportPlan] through the repositories/controllers, mirroring
/// legacy `commitImport`: accounts first (currency = most-used in their
/// rows), then categories (parents before children), then transactions
/// (transfers via the FK-safe controller path, splits as one transaction,
/// borrowed/lent via the debt controller so the principal posting and the
/// debt row stay consistent).
class CsvImportController {
  final AccountRepository _accounts;
  final CategoryRepository _categories;
  final TransactionRepository _txs;
  final TransactionController _txController;
  final DebtController _debtController;
  final CurrencyService _fx;
  final int hijriOffset;
  final Uuid _uuid;

  CsvImportController(
    this._accounts,
    this._categories,
    this._txs,
    this._txController,
    this._debtController,
    this._fx, {
    this.hijriOffset = 0,
    Uuid uuid = const Uuid(),
  }) : _uuid = uuid;

  Future<ImportSummary> commit({
    required ImportPlan plan,
    required List<LedgerAccount> existingAccounts,
    required List<CategoryNode> existingCategories,
    bool includeDuplicates = false,
  }) async {
    String norm(String? s) => (s ?? '').toLowerCase().trim();

    // ── accounts (currency by majority vote of their rows) ─────────────
    final currencyVotes = <String, Map<String, int>>{};
    for (final d in plan.txDrafts) {
      final v = currencyVotes.putIfAbsent(norm(d.accountName), () => {});
      v[d.currency] = (v[d.currency] ?? 0) + 1;
    }
    final accountByName = {
      for (final a in existingAccounts) norm(a.name): a,
    };
    var newAccountCount = 0;
    for (final draft in plan.newAccounts.values) {
      if (accountByName.containsKey(norm(draft.name))) continue;
      var currency = draft.currency;
      final votes = currencyVotes[norm(draft.name)];
      if (votes != null && votes.isNotEmpty) {
        currency = (votes.entries.toList()
              ..sort((a, b) => b.value.compareTo(a.value)))
            .first
            .key;
      }
      final account = LedgerAccount(
          id: _uuid.v4(),
          name: draft.name,
          type: draft.type,
          currency: currency,
          color: draft.color,
          icon: draft.icon);
      await _accounts.upsert(account);
      accountByName[norm(draft.name)] = account;
      newAccountCount++;
    }

    // ── categories (parents first) ─────────────────────────────────────
    final rootByKey = <String, CategoryNode>{
      for (final c in existingCategories)
        if (c.parentId == null) '${norm(c.name)}|${c.type}': c,
    };
    final subByKey = <String, CategoryNode>{};
    for (final c in existingCategories) {
      if (c.parentId == null) continue;
      for (final p in existingCategories) {
        if (p.id == c.parentId) {
          subByKey['${norm(p.name)}|${norm(c.name)}|${c.type}'] = c;
          break;
        }
      }
    }
    var newCategoryCount = 0;
    final drafts = plan.newCategories.values.toList()
      ..sort((a, b) =>
          (a.parentName == null ? 0 : 1) - (b.parentName == null ? 0 : 1));
    for (final d in drafts) {
      if (d.parentName == null) {
        final key = '${norm(d.name)}|${d.type}';
        if (rootByKey.containsKey(key)) continue;
        final c = CategoryNode(
            id: _uuid.v4(),
            name: d.name,
            type: d.type,
            color: d.color,
            icon: d.icon);
        await _categories.upsert(c);
        rootByKey[key] = c;
        newCategoryCount++;
      } else {
        final key = '${norm(d.parentName)}|${norm(d.name)}|${d.type}';
        if (subByKey.containsKey(key)) continue;
        final parent = rootByKey['${norm(d.parentName)}|${d.type}'];
        final c = CategoryNode(
            id: _uuid.v4(),
            name: d.name,
            type: d.type,
            parentId: parent?.id,
            color: d.color,
            icon: d.icon);
        await _categories.upsert(c);
        subByKey[key] = c;
        newCategoryCount++;
      }
    }

    String? resolveCategory(String? cat, String? sub, String type) {
      if (cat == null) return null;
      if (sub != null) {
        return subByKey['${norm(cat)}|${norm(sub)}|$type']?.id ??
            rootByKey['${norm(cat)}|$type']?.id;
      }
      return rootByKey['${norm(cat)}|$type']?.id;
    }

    DateTime parseIso(String iso) {
      final p = iso.split('-');
      return DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
    }

    // ── transactions ───────────────────────────────────────────────────
    var txCount = 0;
    for (final d in plan.txDrafts) {
      final account = accountByName[norm(d.accountName)];
      if (account == null) continue;
      final date = parseIso(d.date);
      final hijri = const HijriCalendar().toHijri(date, offset: hijriOffset);

      switch (d) {
        case PlainDraft p:
          if (!(p.isDuplicate && !includeDuplicates)) {
            await _txs.upsert(LedgerTransaction(
              id: _uuid.v4(),
              type: p.type,
              accountId: account.id,
              currency: p.currency,
              amount: p.amount,
              acctMinor: _fx.convert(p.amount, p.currency, account.currency),
              categoryId: resolveCategory(p.categoryName, p.subcategoryName,
                  p.type == TxType.income ? 'income' : 'expense'),
              payee: p.payee,
              note: p.note,
              paymentType: p.paymentType,
              date: date,
              hijriDate: hijri,
              tags: p.tags,
            ));
            txCount++;
          }
        case TransferDraft t:
          final to = accountByName[norm(t.toAccountName)];
          if (to != null) {
            await _txController.saveTransfer(
                from: account,
                to: to,
                amount: t.amount,
                date: date,
                note: t.note);
            txCount++;
          }
        case SplitGroupDraft g:
          await _txs.upsert(LedgerTransaction(
            id: _uuid.v4(),
            type: TxType.expense,
            accountId: account.id,
            currency: g.currency,
            amount: g.amount,
            acctMinor: _fx.convert(g.amount, g.currency, account.currency),
            payee: g.payee,
            note: g.note,
            paymentType: g.paymentType,
            date: date,
            hijriDate: hijri,
            tags: g.tags,
            splits: [
              for (final s in g.splits)
                LedgerSplit(
                    categoryId: resolveCategory(
                        s.categoryName, s.subcategoryName, 'expense'),
                    amount: s.amount,
                    acctMinor:
                        _fx.convert(s.amount, g.currency, account.currency)),
            ],
          ));
          txCount++;
      }
    }

    // ── debts (principal posting handled by the controller) ────────────
    var debtCount = 0;
    for (final d in plan.debtDrafts) {
      final account = accountByName[norm(d.accountName)];
      if (account == null) continue;
      await _debtController.recordDebt(
        type: d.type,
        counterparty: d.counterparty,
        principal: d.amount,
        currency: d.currency,
        account: account,
        dateTaken: parseIso(d.date),
        dueDate: d.dueDate == null ? null : parseIso(d.dueDate!),
        note: d.note,
      );
      debtCount++;
    }

    return ImportSummary(
        transactions: txCount,
        accounts: newAccountCount,
        categories: newCategoryCount,
        debts: debtCount,
        skipped: plan.skipped);
  }
}

final csvImportServiceProvider =
    Provider<CsvImportService>((ref) => CsvImportService(ref.watch(fxProvider)));

final csvImportControllerProvider =
    Provider<CsvImportController>((ref) => CsvImportController(
          ref.watch(accountRepositoryProvider),
          ref.watch(categoryRepositoryProvider),
          ref.watch(transactionRepositoryProvider),
          ref.watch(transactionControllerProvider),
          ref.watch(debtControllerProvider),
          ref.watch(fxProvider),
          hijriOffset:
              ref.watch(settingsProvider).valueOrNull?.hijriOffset ?? 0,
        ));
