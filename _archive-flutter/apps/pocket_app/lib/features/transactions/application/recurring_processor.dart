import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../dashboard/application/dashboard_providers.dart';

/// Runs the pure [RecurringGenerator] against the live ledger and persists
/// whatever instances are missing. Reentrancy-guarded: the repo writes
/// re-trigger the transactions stream, but the second run finds nothing to
/// add (deterministic ids), so it settles immediately.
class RecurringProcessor {
  final TransactionRepository _txs;
  final RecurringGenerator _generator;
  bool _running = false;

  RecurringProcessor(this._txs, this._generator);

  /// Deterministic UUIDv5 per (template, occurrence date): both devices
  /// backfilling the same occurrence produce the SAME id, so the second
  /// upsert collides instead of duplicating — ports the legacy
  /// `${template.id}__${date}` trick into valid Postgres uuids.
  static String instanceId(String templateId, String dateIso) => const Uuid()
      .v5(Namespace.url.value, 'pocket:recurring:$templateId:$dateIso');

  Future<int> process(List<LedgerTransaction> all) async {
    if (_running) return 0;
    _running = true;
    try {
      final missing = _generator.generate(all, DateTime.now());
      for (final t in missing) {
        await _txs.upsert(t);
      }
      return missing.length;
    } finally {
      _running = false;
    }
  }
}

final recurringProcessorProvider = Provider<RecurringProcessor>((ref) {
  final offset = ref.watch(settingsProvider).valueOrNull?.hijriOffset ?? 0;
  return RecurringProcessor(
    ref.watch(transactionRepositoryProvider),
    RecurringGenerator(
        instanceId: RecurringProcessor.instanceId, hijriOffset: offset),
  );
});
