import 'dart:developer' as developer;

import 'package:powersync/powersync.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'sync_issues.dart';

/// Bridges PowerSync to Supabase: provides the auth token PowerSync uses, and
/// uploads local changes back to Supabase (where RLS enforces access).
class SupabaseConnector extends PowerSyncBackendConnector {
  /// Your PowerSync instance URL, e.g.
  /// https://<id>.powersync.journeyapps.com
  final String powerSyncUrl;

  /// Records rows the connector had to skip so the UI can surface them.
  final SyncIssues issues;

  final _transformer = const RowUploadTransformer();

  SupabaseConnector(this.powerSyncUrl, this.issues);

  @override
  Future<PowerSyncCredentials?> fetchCredentials() async {
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) return null;
    return PowerSyncCredentials(
      endpoint: powerSyncUrl,
      token: session.accessToken,
    );
  }

  @override
  Future<void> uploadData(PowerSyncDatabase database) async {
    final batch = await database.getCrudBatch();
    if (batch == null) return;

    final rest = Supabase.instance.client;
    for (final op in batch.crud) {
      final table = rest.from(op.table);
      try {
        switch (op.op) {
          case UpdateType.put:
            await table.upsert(
                _transformer.transform(op.table, {'id': op.id, ...?op.opData}));
          case UpdateType.patch:
            await table
                .update(_transformer.transform(op.table, op.opData!))
                .eq('id', op.id);
          case UpdateType.delete:
            await table.delete().eq('id', op.id);
        }
      } on PostgrestException catch (e) {
        // Unrecoverable (bad type, constraint, RLS): log + skip so one bad
        // row can't jam the queue forever. Anything else (e.g. network)
        // rethrows below so PowerSync retries the batch.
        developer.log(
          'Upload rejected for ${op.table}/${op.id} (${op.op}): '
          '${e.code} ${e.message}',
          name: 'SupabaseConnector',
        );
        issues.recordSkip('${op.table}/${op.id}: ${e.code} ${e.message}');
      }
    }
    await batch.complete();
  }
}

/// Converts SQLite-shaped local rows into what PostgREST expects, per table.
/// SQLite has no booleans (0/1) or arrays (we store tags as CSV), but the
/// Postgres schema uses `boolean` and `text[]` — uploading raw values gets a
/// 22P02/22023 rejection and stalls the upload queue.
class RowUploadTransformer {
  const RowUploadTransformer();

  /// Columns that are `boolean` in Postgres, per table.
  static const Map<String, Set<String>> _boolColumns = {
    'accounts': {'archived'},
    'budgets': {'rollover'},
    'profiles': {'show_hijri'},
  };

  /// Columns that are `text[]` in Postgres but CSV text locally.
  static const Map<String, Set<String>> _csvArrayColumns = {
    'transactions': {'tags'},
    'profiles': {'custom_payment_types'},
  };

  /// Columns that are uuid in Postgres: empty strings must become null.
  static const Set<String> _uuidLikeSuffixes = {'_id'};

  Map<String, dynamic> transform(String table, Map<String, dynamic> row) {
    final bools = _boolColumns[table] ?? const <String>{};
    final csvs = _csvArrayColumns[table] ?? const <String>{};
    final out = <String, dynamic>{};

    row.forEach((key, value) {
      if (bools.contains(key)) {
        out[key] = value == 1 || value == '1' || value == true;
      } else if (csvs.contains(key)) {
        out[key] = switch (value) {
          null => <String>[],
          List l => l.cast<String>(),
          String s when s.isEmpty => <String>[],
          String s => s.split(','),
          _ => <String>[],
        };
      } else if (value is String &&
          value.isEmpty &&
          _uuidLikeSuffixes.any(key.endsWith)) {
        out[key] = null; // '' is not a valid uuid
      } else {
        out[key] = value;
      }
    });
    return out;
  }
}
