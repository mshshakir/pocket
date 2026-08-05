/// Data layer — repository implementations of the domain ports.
///
/// Today: an in-memory backing (runnable app slice + tests). Next: Drift (local
/// cache) + Supabase repositories + PowerSync offline sync, backed by the schema
/// in `supabase/migrations/0001_init.sql`.
library pocket_data;

export 'src/mappers/row_mappers.dart';
export 'src/memory/in_memory_repositories.dart';
