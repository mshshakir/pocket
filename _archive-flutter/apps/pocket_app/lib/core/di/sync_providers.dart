import 'dart:developer' as developer;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:powersync/powersync.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show Supabase;

import '../../sync/fx_refresh_service.dart';
import '../../sync/powersync_database.dart';
import '../../sync/sync_config.dart';
import '../../sync/sync_issues.dart';

/// Sync infrastructure DI: the PowerSync database handle, its derived status
/// providers, and the FX refresh service. Kept separate from the feature
/// repositories so the data layer's wiring stays readable (audit C1).

/// Connector-reported upload problems (skipped-row count + last error),
/// surfaced under the sync status tile.
final syncIssuesProvider =
    ChangeNotifierProvider<SyncIssues>((ref) => SyncIssues());

/// Opens the PowerSync database when the cloud is configured; null otherwise
/// (the app then falls back to in-memory sample data). When the DB finishes
/// opening, the repository providers rebuild and the UI switches to real synced
/// data with no widget changes. Failures are logged AND rethrown so
/// [syncStatusProvider] can show the app fell back to sample mode.
final dbProvider = FutureProvider<PowerSyncDatabase?>((ref) async {
  if (!syncConfigured) return null;
  try {
    return await openPowerSyncDatabase(
        powerSyncUrl, ref.read(syncIssuesProvider));
  } catch (e, st) {
    developer.log('PowerSync failed to open — running on sample data',
        name: 'dbProvider', error: e, stackTrace: st);
    rethrow;
  }
});

/// Human-readable sync state for the sidebar/settings.
enum SyncStatus { sampleMode, connecting, syncing, error }

final syncStatusProvider = Provider<SyncStatus>((ref) {
  if (!syncConfigured) return SyncStatus.sampleMode;
  final db = ref.watch(dbProvider);
  if (db.hasError) return SyncStatus.error;
  if (db.valueOrNull == null) return SyncStatus.connecting;
  return SyncStatus.syncing;
});

/// True once PowerSync has completed an initial sync (always true in sample
/// mode, where there is nothing to wait for). Gates recurring generation so
/// devices don't briefly race to backfill the same instances before the
/// ledger has fully arrived (audit B2).
final syncedProvider = StreamProvider<bool>((ref) {
  final db = ref.watch(dbProvider).valueOrNull;
  if (db == null) return Stream.value(true);
  return db.statusStream.map((s) => s.hasSynced ?? false).distinct();
});

/// One per session; AppShell fires `refreshIfStale()` after the DB opens.
final fxRefreshServiceProvider = Provider<FxRefreshService>(
    (ref) => FxRefreshService(Supabase.instance.client));
