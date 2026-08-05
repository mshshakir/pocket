import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_data/pocket_data.dart';
import 'package:pocket_domain/domain.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show Supabase;

import '../../../core/di/money_providers.dart';
import '../../../core/di/sync_providers.dart';
import '../../../sync/powersync_repositories.dart';
import '../../../sync/supabase_share_repository.dart';
import '../../../sync/sync_config.dart';

// Re-export the infrastructure DI so the many `import dashboard_providers.dart`
// sites keep resolving every provider (fx/db/settings live in core/di now —
// audit C1). This file remains the feature-repository + derived-state hub.
export '../../../core/di/money_providers.dart';
export '../../../core/di/sync_providers.dart';

/// Repository ports: PowerSync-backed once the DB is open, in-memory sample data
/// until then.
final accountRepositoryProvider = Provider<AccountRepository>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db != null) return PowerSyncAccountRepository(db);

  final repo = InMemoryAccountRepository(const [
    LedgerAccount(id: 'cash', currency: 'USD', openingBalance: 50000),
    LedgerAccount(id: 'mpesa', currency: 'KES', openingBalance: 1000000),
  ]);
  ref.onDispose(repo.dispose);
  return repo;
});

final transactionRepositoryProvider = Provider<TransactionRepository>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db != null) return PowerSyncTransactionRepository(db);

  final repo = InMemoryTransactionRepository([
    // NOTE: category ids must match the sample categories below — a
    // dangling id crashes DropdownButton when editing (assertion: exactly
    // one item with the dropdown's value).
    LedgerTransaction(
      id: 't1', type: TxType.income, accountId: 'cash', currency: 'USD',
      amount: 200000, categoryId: 'cat-salary', date: DateTime(2026, 6, 1),
    ),
    LedgerTransaction(
      id: 't2', type: TxType.expense, accountId: 'cash', currency: 'USD',
      amount: 4250, categoryId: 'cat-food', date: DateTime(2026, 6, 10),
    ),
    LedgerTransaction(
      id: 't3', type: TxType.expense, accountId: 'mpesa', currency: 'KES',
      amount: 350000, categoryId: 'cat-transport', date: DateTime(2026, 6, 5),
    ),
  ]);
  ref.onDispose(repo.dispose);
  return repo;
});

/// Reactive reads — the UI rebuilds automatically when the repositories change.
/// Includes archived accounts (for history lookups and the Archived section).
final accountsProvider = StreamProvider<List<LedgerAccount>>(
  (ref) => ref.watch(accountRepositoryProvider).watch(),
);

/// Accounts usable in pickers and totals (archived hidden).
final activeAccountsProvider = Provider<List<LedgerAccount>>((ref) => [
      for (final a in ref.watch(accountsProvider).valueOrNull ?? const [])
        if (!a.archived) a,
    ]);

/// Account groups: PowerSync-backed once the DB is open, in-memory otherwise.
final accountGroupRepositoryProvider = Provider<AccountGroupRepository>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db != null) return PowerSyncAccountGroupRepository(db);
  final repo = InMemoryAccountGroupRepository(const []);
  ref.onDispose(repo.dispose);
  return repo;
});

final accountGroupsProvider = StreamProvider<List<AccountGroup>>(
  (ref) => ref.watch(accountGroupRepositoryProvider).watch(),
);

final transactionsProvider = StreamProvider<List<LedgerTransaction>>(
  (ref) => ref.watch(transactionRepositoryProvider).watch(),
);

final categoryRepositoryProvider = Provider<CategoryRepository>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db != null) return PowerSyncCategoryRepository(db);

  final repo = InMemoryCategoryRepository(const [
    CategoryNode(id: 'cat-food', name: 'Food', type: 'expense'),
    CategoryNode(id: 'cat-transport', name: 'Transport', type: 'expense'),
    CategoryNode(id: 'cat-bills', name: 'Bills', type: 'expense'),
    CategoryNode(id: 'cat-salary', name: 'Salary', type: 'income'),
  ]);
  ref.onDispose(repo.dispose);
  return repo;
});

final categoriesProvider = StreamProvider<List<CategoryNode>>(
  (ref) => ref.watch(categoryRepositoryProvider).watch(),
);

final budgetRepositoryProvider = Provider<BudgetRepository>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db != null) return PowerSyncBudgetRepository(db);
  final repo = InMemoryBudgetRepository(const []);
  ref.onDispose(repo.dispose);
  return repo;
});

final budgetsProvider = StreamProvider<List<Budget>>(
  (ref) => ref.watch(budgetRepositoryProvider).watch(),
);

/// Budget spend/limit calculator wired to the live categories + FX.
final budgetServiceProvider = Provider<BudgetService>((ref) {
  final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
  return BudgetService(
    categories: CategoryTree(cats),
    fx: ref.watch(fxProvider),
    hijri: const HijriCalendar(),
  );
});

/// Debts.
final debtRepositoryProvider = Provider<DebtRepository>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db != null) return PowerSyncDebtRepository(db);
  final repo = InMemoryDebtRepository(const []);
  ref.onDispose(repo.dispose);
  return repo;
});

final debtsProvider = StreamProvider<List<Debt>>(
  (ref) => ref.watch(debtRepositoryProvider).watch(),
);

final debtServiceProvider =
    Provider<DebtService>((ref) => DebtService(ref.watch(fxProvider)));

/// Regular purchase items.
final regularItemRepositoryProvider = Provider<RegularItemRepository>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db != null) return PowerSyncRegularItemRepository(db);
  final repo = InMemoryRegularItemRepository(const []);
  ref.onDispose(repo.dispose);
  return repo;
});

final regularItemsProvider = StreamProvider<List<RegularItem>>(
  (ref) => ref.watch(regularItemRepositoryProvider).watch(),
);

/// Remembered payee→category mappings (auto-categorisation): PowerSync-backed
/// once the DB is open, in-memory otherwise.
final merchantCategoryRepositoryProvider =
    Provider<MerchantCategoryRepository>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db != null) return PowerSyncMerchantCategoryRepository(db);
  final repo = InMemoryMerchantCategoryRepository(const []);
  ref.onDispose(repo.dispose);
  return repo;
});

final merchantCategoriesProvider = StreamProvider<List<MerchantCategory>>(
  (ref) => ref.watch(merchantCategoryRepositoryProvider).watch(),
);

/// Pure lookup over the remembered mappings, rebuilt as they change.
final merchantMemoryProvider = Provider<MerchantMemory>((ref) => MerchantMemory(
    ref.watch(merchantCategoriesProvider).valueOrNull ?? const []));

/// Family sharing (online-only: direct Supabase; in-memory sample otherwise).
final shareRepositoryProvider = Provider<ShareRepository>((ref) {
  if (syncConfigured) {
    final repo = SupabaseShareRepository(Supabase.instance.client);
    ref.onDispose(repo.dispose);
    return repo;
  }
  final repo = InMemoryShareRepository();
  ref.onDispose(repo.dispose);
  return repo;
});

final outboundSharesProvider = StreamProvider<List<AccountShare>>(
  (ref) => ref.watch(shareRepositoryProvider).watchOutbound(),
);

final inboundSharesProvider = StreamProvider<List<InboundShare>>(
  (ref) => ref.watch(shareRepositoryProvider).watchInbound(),
);

/// Derived balances via the shared domain logic. Falls back to empty while the
/// first stream snapshot is loading.
final balancesProvider = Provider<Map<String, int>>((ref) {
  final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
  final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
  return LedgerMath.balances(accounts, txs, ref.watch(fxProvider));
});

final netWorthProvider = Provider<int>((ref) {
  final fx = ref.watch(fxProvider);
  final home = ref.watch(homeCurrencyProvider);
  final balances = ref.watch(balancesProvider);
  var total = 0;
  for (final a in ref.watch(activeAccountsProvider)) {
    total += fx.convert(balances[a.id] ?? 0, a.currency, home);
  }
  return total;
});
