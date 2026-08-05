import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/date_format_service.dart';
import '../../dashboard/application/dashboard_providers.dart';

/// Date renderer bound to the persisted preference.
final dateFormatProvider = Provider<DateFormatService>((ref) =>
    DateFormatService(
        ref.watch(settingsProvider).valueOrNull?.dateFormat ?? 'auto'));

/// Maps the persisted theme string to Flutter's [ThemeMode]. The app watches
/// this so the choice survives restarts (and syncs across devices via the
/// profiles table).
final themeModeFromSettingsProvider = Provider<ThemeMode>((ref) {
  final theme = ref.watch(settingsProvider).valueOrNull?.theme ?? 'system';
  return switch (theme) {
    'light' => ThemeMode.light,
    'dark' => ThemeMode.dark,
    _ => ThemeMode.system,
  };
});

/// The single write path for user preferences: every mutation reads the
/// latest settings snapshot and persists a copy with one field changed.
class SettingsController {
  final SettingsRepository _repo;
  final UserSettings Function() _current;

  SettingsController(this._repo, this._current);

  UserSettings get settings => _current();

  Future<void> setHomeCurrency(String code) =>
      _repo.save(settings.copyWith(homeCurrency: code));

  Future<void> setDefaultCurrency(String code) =>
      _repo.save(settings.copyWith(defaultCurrency: code));

  Future<void> setDateFormat(String format) =>
      _repo.save(settings.copyWith(dateFormat: format));

  Future<void> setTheme(String theme) =>
      _repo.save(settings.copyWith(theme: theme));

  /// Sidebar quick toggle: dark ↔ light (resolving 'system' by [isDarkNow]).
  Future<void> toggleTheme({required bool isDarkNow}) =>
      setTheme(isDarkNow ? 'light' : 'dark');

  Future<void> toggleHijri() =>
      _repo.save(settings.copyWith(showHijri: !settings.showHijri));

  Future<void> setCalendarMode(String mode) =>
      _repo.save(settings.copyWith(calendarMode: mode));

  Future<void> setHijriOffset(int offset) =>
      _repo.save(settings.copyWith(hijriOffset: offset));

  Future<void> adjustHijriOffset(int delta) =>
      setHijriOffset(settings.hijriOffset + delta);
}

final settingsControllerProvider = Provider<SettingsController>((ref) {
  return SettingsController(
    ref.watch(settingsRepositoryProvider),
    () => ref.read(settingsProvider).valueOrNull ?? const UserSettings(),
  );
});
