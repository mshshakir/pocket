import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../sync/sync_config.dart';
import '../../dashboard/application/dashboard_providers.dart';
import 'onboarding_service.dart';

/// True only for a signed-in cloud user whose data is genuinely empty (no
/// accounts AND no categories), and only once both streams have loaded so we
/// never flash onboarding during the first sync. Sample mode is never treated
/// as first-run (it ships with demo data).
final isFirstRunProvider = Provider<bool>((ref) {
  if (!syncConfigured) return false;
  final cats = ref.watch(categoriesProvider);
  final accounts = ref.watch(accountsProvider);
  if (cats.isLoading || accounts.isLoading) return false;
  final noCategories = (cats.valueOrNull ?? const <CategoryNode>[]).isEmpty;
  final noAccounts = (accounts.valueOrNull ?? const <LedgerAccount>[]).isEmpty;
  return noCategories && noAccounts;
});

/// Commits first-run setup: persists the chosen home/default currency and
/// seeds the default categories. User-initiated (not auto-run), so it is
/// sync-safe — no two devices race to seed, and the act of seeding flips
/// [isFirstRunProvider] to false.
class OnboardingController {
  final CategoryRepository _categories;
  final SettingsRepository _settings;
  final UserSettings Function() _current;
  final OnboardingService _service;

  OnboardingController(
    this._categories,
    this._settings,
    this._current,
    this._service,
  );

  Future<void> complete({required String homeCurrency}) async {
    await _settings.save(_current().copyWith(
      homeCurrency: homeCurrency,
      defaultCurrency: homeCurrency,
    ));
    for (final category in _service.seedCategories()) {
      await _categories.upsert(category);
    }
  }
}

final onboardingServiceProvider =
    Provider<OnboardingService>((ref) => OnboardingService());

final onboardingControllerProvider = Provider<OnboardingController>(
  (ref) => OnboardingController(
    ref.watch(categoryRepositoryProvider),
    ref.watch(settingsRepositoryProvider),
    () => ref.read(settingsProvider).valueOrNull ?? const UserSettings(),
    ref.watch(onboardingServiceProvider),
  ),
);
