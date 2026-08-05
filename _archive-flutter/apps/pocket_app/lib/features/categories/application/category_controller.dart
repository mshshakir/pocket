import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../dashboard/application/dashboard_providers.dart';

/// Category write path. Delete does the full local cleanup the bare repository
/// remove() skips: reparent children, uncategorise affected transactions (and
/// split rows), and drop the category from any budgets — so the local DB never
/// keeps dangling `category_id`s or dead `budget_categories` rows after a
/// delete (audit B5). Postgres also cleans up server-side via `on delete set
/// null`, but doing it locally avoids stale rows until those records re-sync.
class CategoryController {
  final CategoryRepository _categories;
  final TransactionRepository _txs;
  final BudgetRepository _budgets;

  CategoryController(this._categories, this._txs, this._budgets);

  Future<void> upsert(CategoryNode category) => _categories.upsert(category);

  Future<void> delete({
    required CategoryNode category,
    required List<CategoryNode> allCategories,
    required List<LedgerTransaction> allTransactions,
    required List<Budget> allBudgets,
  }) async {
    final id = category.id;

    // 1. Reparent direct children to top level (legacy behaviour).
    for (final child in allCategories) {
      if (child.parentId == id) {
        await _categories.upsert(CategoryNode(
          id: child.id,
          name: child.name,
          type: child.type,
          parentId: null,
          color: child.color,
          icon: child.icon,
        ));
      }
    }

    // 2. Uncategorise transactions and split rows pointing at it.
    for (final t in allTransactions) {
      final splits = t.splits;
      if (splits != null && splits.any((s) => s.categoryId == id)) {
        await _txs.upsert(t.copyWith(splits: [
          for (final s in splits)
            LedgerSplit(
              id: s.id,
              accountId: s.accountId,
              categoryId: s.categoryId == id ? null : s.categoryId,
              amount: s.amount,
              acctMinor: s.acctMinor,
            ),
        ]));
      } else if (t.categoryId == id) {
        await _txs.upsert(t.copyWith(categoryId: null));
      }
    }

    // 3. Drop it from any budgets that target it.
    for (final b in allBudgets) {
      final inList = b.categoryIds.contains(id);
      final isLegacy = b.legacyCategoryId == id;
      if (inList || isLegacy) {
        await _budgets.upsert(b.copyWith(
          categoryIds: [for (final cid in b.categoryIds) if (cid != id) cid],
          legacyCategoryId: isLegacy ? null : b.legacyCategoryId,
        ));
      }
    }

    // 4. Finally remove the category itself.
    await _categories.remove(id);
  }
}

final categoryControllerProvider = Provider<CategoryController>(
  (ref) => CategoryController(
    ref.watch(categoryRepositoryProvider),
    ref.watch(transactionRepositoryProvider),
    ref.watch(budgetRepositoryProvider),
  ),
);
