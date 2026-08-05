import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_data/pocket_data.dart';
import 'package:pocket_domain/domain.dart';

import '../../sync/powersync_repositories.dart';
import 'sync_providers.dart';

/// Currency + user-settings DI: FX rates and the profile row that drives home/
/// default currency. Depends only on [dbProvider]; kept out of the feature
/// repository hub for cohesion (audit C1).

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
