import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_data/pocket_data.dart';
import 'package:pocket_domain/domain.dart';
import 'package:powersync/powersync.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show Supabase;

import '../../../sync/powersync_database.dart';
import '../../../sync/powersync_repositories.dart';
import '../../../sync/supabase_share_repository.dart';
import '../../../sync/sync_config.dart';

/// Seed FX snapshot (units per 1 USD) — used in sample mode and merged under
/// whatever the synced `fx_rates` table provides, so USD/the basics always
/// resolve even before the first sync.
const Map<String, double> kSeedFxRates = {
  'USD': 1.0,
  'EUR': 0.9,
  'KES': 130.0,
  'INR': 83.0,
};

/// Live FX rates from the synced global `fx_rates` table (when cloud is
/// configured), else the seed snapshot. Numeric arrives as text from SQLite,
/// so parse defensively.
final fxRatesProvider = StreamProvider<Map<String, double>>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db == null) return Stream.value(kSeedFxRates);
  return db.watch('SELECT code, rate FROM fx_rates').map((rs) => {
        for (final r in rs)
          if (double.tryParse('${r['rate']}') != null)
            (r['code'] as String): double.parse('${r['rate']}'),
      });
});

final fxProvider = Provider<CurrencyService>((ref) {
  final synced = ref.watch(fxRatesProvider).valueOrNull ?? const {};
  return CurrencyService({...kSeedFxRates, ...synced});
});

/// User settings (profile row): PowerSync-backed when configured, in-memory
/// otherwise. Defaults flow until the row arrives.
final settingsRepositoryProvider = Provider<SettingsRepository>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db != null) return PowerSyncSettingsRepository(db);
  final repo = InMemorySettingsRepository();
  ref.onDispose(repo.dispose);
  return repo;
});

final settingsProvider = StreamProvider<UserSettings>(
  (ref) => ref.watch(settingsRepositoryProvider).watch(),
);

final homeCurrencyProvider = Provider<String>((ref) =>
    ref.watch(settingsProvider).valueOrNull?.homeCurrency ?? 'INR');

final defaultCurrencyProvider = Provider<String>((ref) =>
    ref.watch(settingsProvider).valueOrNull?.defaultCurrency ??
    ref.watch(homeCurrencyProvider));

/// Opens the PowerSync database when the cloud is configured; null otherwise
/// (the app then falls back to the in-memory sample data below). When the DB
/// finishes opening, the repository providers rebuild and the UI switches to
/// real synced data with no widget changes.
final dbProvider = FutureProvider<PowerSyncDatabase?>((ref) async {
  if (!syncConfigured) return null;
  return openPowerSyncDatabase(powerSyncUrl);
});

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
    LedgerTransaction(
      id: 't1', type: TxType.income, accountId: 'cash', currency: 'USD',
      amount: 200000, categoryId: 'salary', date: DateTime(2026, 6, 1),
    ),
    LedgerTransaction(
      id: 't2', type: TxType.expense, accountId: 'cash', currency: 'USD',
      amount: 4250, categoryId: 'food', date: DateTime(2026, 6, 10),
    ),
    LedgerTransaction(
      id: 't3', type: TxType.expense, accountId: 'mpesa', currency: 'KES',
      amount: 350000, categoryId: 'transport', date: DateTime(2026, 6, 5),
    ),
  ]);
  ref.onDispose(repo.dispose);
  return repo;
});

/// Reactive reads — the UI rebuilds automatically when the repositories change.
final accountsProvider = StreamProvider<List<LedgerAccount>>(
  (ref) => ref.watch(accountRepositoryProvider).watch(),
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
  final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
  final balances = ref.watch(balancesProvider);
  var total = 0;
  for (final a in accounts) {
    total += fx.convert(balances[a.id] ?? 0, a.currency, home);
  }
  return total;
});
