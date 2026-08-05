import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:powersync/powersync.dart';

import 'powersync_schema.dart';
import 'supabase_connector.dart';
import 'sync_issues.dart';

/// Opens the local PowerSync database and connects it to Supabase for syncing.
///
/// On web there is no filesystem path — PowerSync persists via its WASM/OPFS
/// workers (added by `dart run powersync:setup_web`), and `path_provider`
/// would THROW, silently dropping the app into sample mode. Use a bare
/// filename on web; a real support-dir path elsewhere.
Future<PowerSyncDatabase> openPowerSyncDatabase(
    String powerSyncUrl, SyncIssues issues) async {
  final String path;
  if (kIsWeb) {
    path = 'pocket.db';
  } else {
    final dir = await getApplicationSupportDirectory();
    path = p.join(dir.path, 'pocket.db');
  }
  final db = PowerSyncDatabase(schema: powerSyncSchema, path: path);
  await db.initialize();
  await db.connect(connector: SupabaseConnector(powerSyncUrl, issues));
  return db;
}
