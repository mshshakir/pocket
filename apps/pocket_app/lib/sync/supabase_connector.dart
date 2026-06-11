import 'package:powersync/powersync.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Bridges PowerSync to Supabase: provides the auth token PowerSync uses, and
/// uploads local changes back to Supabase (where RLS enforces access).
class SupabaseConnector extends PowerSyncBackendConnector {
  /// Your PowerSync instance URL, e.g.
  /// https://<id>.powersync.journeyapps.com
  final String powerSyncUrl;

  SupabaseConnector(this.powerSyncUrl);

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
      switch (op.op) {
        case UpdateType.put:
          await table.upsert({'id': op.id, ...?op.opData});
        case UpdateType.patch:
          await table.update(op.opData!).eq('id', op.id);
        case UpdateType.delete:
          await table.delete().eq('id', op.id);
      }
    }
    await batch.complete();
  }
}
