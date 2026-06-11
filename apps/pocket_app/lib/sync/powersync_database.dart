import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:powersync/powersync.dart';

import 'powersync_schema.dart';
import 'supabase_connector.dart';

/// Opens the local PowerSync database and connects it to Supabase for syncing.
Future<PowerSyncDatabase> openPowerSyncDatabase(String powerSyncUrl) async {
  final dir = await getApplicationSupportDirectory();
  final db = PowerSyncDatabase(
    schema: powerSyncSchema,
    path: p.join(dir.path, 'pocket.db'),
  );
  await db.initialize();
  await db.connect(connector: SupabaseConnector(powerSyncUrl));
  return db;
}
