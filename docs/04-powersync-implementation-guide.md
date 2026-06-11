# PowerSync + Supabase data layer — implementation guide

This is the concrete code for the final layer: an offline-first PowerSync local
database that syncs with Supabase, exposed through the repository **ports**
already defined in `packages/domain`, using the row **mappers** already built and
tested in `packages/data`.

> **Why this is a guide, not committed source:** it needs the Flutter SDK + a
> live Supabase + a PowerSync instance to compile/run, and it pulls Flutter-bound
> deps. We apply it on your machine and fix any version-specific API details from
> real compiler/runtime errors. APIs below target **powersync ^1.x** and
> **supabase_flutter ^2.x** — verify against the versions `flutter pub get`
> resolves.

PowerSync raw-SQL queries return rows that behave as `Map<String, dynamic>`, so
they pass directly into the existing `row_mappers.dart` — no Drift code-gen
needed.

## 1. One-time service setup (no code)

1. Create a **new Supabase project** and run `supabase/migrations/0001_init.sql`.
2. Create a **PowerSync instance** (cloud free tier) connected to that Supabase
   Postgres (connection string from Supabase → Database settings).
3. In PowerSync, add **Sync Streams** (the current format — `config: edition: 3`)
   that mirror the RLS. `auto_subscribe: true` syncs everything for the user
   upfront (offline-first, like the old app). Every synced table must have a
   text `id` column, so `budget_categories`/`merchant_categories` get an `id`
   added in `0001_init.sql`.

```yaml
config:
  edition: 3

streams:
  accounts:
    auto_subscribe: true
    query: SELECT * FROM accounts WHERE user_id = auth.user_id()
  account_groups:
    auto_subscribe: true
    query: SELECT * FROM account_groups WHERE user_id = auth.user_id()
  categories:
    auto_subscribe: true
    query: SELECT * FROM categories WHERE user_id = auth.user_id()
  transactions:
    auto_subscribe: true
    query: SELECT * FROM transactions WHERE user_id = auth.user_id()
  transaction_splits:
    auto_subscribe: true
    query: SELECT * FROM transaction_splits WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id = auth.user_id())
  budgets:
    auto_subscribe: true
    query: SELECT * FROM budgets WHERE user_id = auth.user_id()
  budget_categories:
    auto_subscribe: true
    query: SELECT * FROM budget_categories WHERE budget_id IN (SELECT id FROM budgets WHERE user_id = auth.user_id())
  debts:
    auto_subscribe: true
    query: SELECT * FROM debts WHERE user_id = auth.user_id()
  regular_items:
    auto_subscribe: true
    query: SELECT * FROM regular_items WHERE user_id = auth.user_id()
  merchant_categories:
    auto_subscribe: true
    query: SELECT * FROM merchant_categories WHERE user_id = auth.user_id()
# A shared-accounts stream (keyed on the member's email) is added once the
# owner-side sharing flow is in place.
```

## 2. Dependencies

Add to the package that will own the DB (recommended: a new Flutter package
`packages/data_sync`, or `apps/pocket_app` directly — keep the pure
`packages/data` free of Flutter deps so its `dart test` stays fast):

```yaml
dependencies:
  powersync: ^1.9.0
  supabase_flutter: ^2.5.0
  path_provider: ^2.1.0
  path: ^1.9.0
  pocket_domain:
    path: ../domain
  pocket_data:
    path: ../data        # reuse the row mappers
```

## 3. PowerSync schema (`schema.dart`)

PowerSync auto-adds the `id` text column; declare only the other columns.

```dart
import 'package:powersync/powersync.dart';

final schema = Schema([
  Table('accounts', [
    Column.text('name'), Column.text('type'), Column.text('currency'),
    Column.integer('opening_balance'), Column.text('color'), Column.text('icon'),
    Column.integer('archived'), Column.text('group_id'), Column.text('user_id'),
  ]),
  Table('categories', [
    Column.text('parent_id'), Column.text('name'), Column.text('type'),
    Column.text('color'), Column.text('icon'), Column.text('user_id'),
  ]),
  Table('transactions', [
    Column.text('account_id'), Column.text('category_id'), Column.text('type'),
    Column.integer('amount_minor'), Column.text('currency'),
    Column.real('exchange_rate'), Column.integer('ref_amount_minor'),
    Column.integer('acct_minor'), Column.text('payee'), Column.text('note'),
    Column.text('date'), Column.integer('hijri_year'), Column.integer('hijri_month'),
    Column.integer('hijri_day'), Column.text('payment_type'),
    Column.text('record_state'), Column.text('transfer_pair_id'),
    Column.text('transfer_dir'), Column.real('transfer_rate'),
    Column.text('tags'), Column.text('added_by'), Column.text('user_id'),
  ]),
  Table('transaction_splits', [
    Column.text('transaction_id'), Column.text('account_id'),
    Column.text('category_id'), Column.integer('amount_minor'),
    Column.integer('acct_minor'),
  ]),
  Table('budgets', [
    Column.integer('amount_minor'), Column.text('currency'), Column.text('period'),
    Column.integer('rollover'), Column.text('user_id'),
  ]),
  Table('budget_categories', [Column.text('budget_id'), Column.text('category_id')]),
]);
```

> Note: `tags` is stored as text here (JSON-encode the `List<String>` on write,
> decode on read) since PowerSync columns are scalar; adjust `row_mappers` for
> tags accordingly in the sync path, or keep tags in a child table.

## 4. Supabase connector (`supabase_connector.dart`)

```dart
import 'package:powersync/powersync.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseConnector extends PowerSyncBackendConnector {
  final String powerSyncUrl; // PowerSync instance URL
  SupabaseConnector(this.powerSyncUrl);

  @override
  Future<PowerSyncCredentials?> fetchCredentials() async {
    final session = Supabase.instance.client.auth.currentSession;
    if (session == null) return null;
    return PowerSyncCredentials(endpoint: powerSyncUrl, token: session.accessToken);
  }

  @override
  Future<void> uploadData(PowerSyncDatabase database) async {
    final batch = await database.getCrudBatch();
    if (batch == null) return;
    final rest = Supabase.instance.client;
    try {
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
    } catch (e) {
      // Transient errors: leave the batch for the next sync cycle.
      rethrow;
    }
  }
}
```

## 5. Open + connect (`database.dart`)

```dart
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:powersync/powersync.dart';
import 'schema.dart';
import 'supabase_connector.dart';

Future<PowerSyncDatabase> openDatabase(String powerSyncUrl) async {
  final dir = await getApplicationSupportDirectory();
  final db = PowerSyncDatabase(schema: schema, path: p.join(dir.path, 'pocket.db'));
  await db.initialize();
  await db.connect(connector: SupabaseConnector(powerSyncUrl));
  return db;
}
```

## 6. Repositories over PowerSync (`powersync_repositories.dart`)

These implement the existing ports and reuse `row_mappers.dart`.

```dart
import 'package:powersync/powersync.dart';
import 'package:pocket_data/pocket_data.dart';   // row mappers
import 'package:pocket_domain/domain.dart';      // ports + entities

class PowerSyncAccountRepository implements AccountRepository {
  final PowerSyncDatabase db;
  PowerSyncAccountRepository(this.db);

  @override
  Stream<List<LedgerAccount>> watch() => db
      .watch('SELECT * FROM accounts WHERE archived = 0')
      .map((rs) => rs.map((row) => accountFromRow(row)).toList());

  @override
  Future<void> upsert(LedgerAccount a) async {
    final r = accountToRow(a)..['archived'] = a.archived ? 1 : 0;
    await db.execute(
      '''INSERT OR REPLACE INTO accounts
         (id, name, type, currency, opening_balance, color, icon, archived, group_id)
         VALUES (?,?,?,?,?,?,?,?,?)''',
      [r['id'], r['name'], r['type'], r['currency'], r['opening_balance'],
       r['color'], r['icon'], r['archived'], r['group_id']],
    );
  }

  @override
  Future<void> remove(String id) =>
      db.execute('DELETE FROM accounts WHERE id = ?', [id]);
}

class PowerSyncTransactionRepository implements TransactionRepository {
  final PowerSyncDatabase db;
  PowerSyncTransactionRepository(this.db);

  @override
  Stream<List<LedgerTransaction>> watch() => db
      .watch('SELECT * FROM transactions ORDER BY date DESC')
      .asyncMap((rs) async {
        // Load splits per tx (or join) and rebuild via the mapper.
        final out = <LedgerTransaction>[];
        for (final row in rs) {
          final splits = await db.getAll(
            'SELECT * FROM transaction_splits WHERE transaction_id = ?', [row['id']]);
          out.add(transactionFromRow(row, splitRows: splits.toList()));
        }
        return out;
      });

  @override
  Future<void> upsert(LedgerTransaction t) async {
    final r = transactionToRow(t);
    // tags: store JSON text in the sync column
    // r['tags'] = jsonEncode(t.tags);
    await db.execute(/* INSERT OR REPLACE INTO transactions (...) VALUES (...) */, [/* r[...] */]);
    if (t.splits != null) {
      await db.execute('DELETE FROM transaction_splits WHERE transaction_id = ?', [t.id]);
      for (final s in t.splits!) {
        final sr = splitToRow(s, t.id);
        await db.execute(
          '''INSERT OR REPLACE INTO transaction_splits
             (id, transaction_id, account_id, category_id, amount_minor, acct_minor)
             VALUES (?,?,?,?,?,?)''',
          [sr['id'], sr['transaction_id'], sr['account_id'], sr['category_id'],
           sr['amount_minor'], sr['acct_minor']]);
      }
    }
  }

  @override
  Future<void> remove(String id) =>
      db.execute('DELETE FROM transactions WHERE id = ?', [id]);
}
```

(Categories + budgets repos follow the identical pattern; budgets also
write/read the `budget_categories` rows via `budgetCategoryRows`.)

## 7. Wire into the app

Swap the in-memory providers in
`apps/pocket_app/lib/features/dashboard/application/dashboard_providers.dart`:

```dart
final dbProvider = FutureProvider<PowerSyncDatabase>((ref) =>
    openDatabase(const String.fromEnvironment('POWERSYNC_URL')));

final accountRepositoryProvider = Provider<AccountRepository>((ref) {
  final db = ref.watch(dbProvider).requireValue;     // gate the UI on dbProvider
  return PowerSyncAccountRepository(db);
});
// transactions analogous — the StreamProviders + widgets stay unchanged.
```

Initialise Supabase in `main()` before `runApp` (`Supabase.initialize(url:…, anonKey:…)`).

## 8. Run

```
cd apps\pocket_app
flutter pub get
flutter run -d chrome --dart-define=POWERSYNC_URL=https://<your-instance>.powersync.journeyapps.com
```

## Known things to verify on first compile

- Exact `PowerSyncDatabase` constructor + `Column` factory names for the resolved
  powersync version.
- `CrudEntry.op` enum values (`UpdateType.put/patch/delete`).
- `ResultSet`/`Row` indexing returns map access (it does in current versions).
- Web needs the PowerSync WASM/worker assets — follow the powersync web setup.
- `tags` storage (JSON-text column vs child table) — pick one and align the mapper.

Once it compiles and syncs, swap the remaining features off the in-memory data
and delete the temporary providers.
