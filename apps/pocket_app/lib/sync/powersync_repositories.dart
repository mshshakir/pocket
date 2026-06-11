import 'package:powersync/powersync.dart';
import 'package:pocket_data/pocket_data.dart'; // row mappers
import 'package:pocket_domain/domain.dart'; // ports + entities
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:uuid/uuid.dart';

/// Account/Transaction repositories backed by the PowerSync local DB. They
/// implement the same domain ports the in-memory repos do, reusing the tested
/// row mappers — so the app's providers/widgets don't change when we swap to
/// these.

Map<String, dynamic> _asMap(Row row) => {for (final k in row.keys) k: row[k]};

/// Current signed-in user's id — written to each row so Supabase's RLS accepts
/// the upload (rows must belong to auth.uid()).
String? _currentUserId() => Supabase.instance.client.auth.currentUser?.id;

class PowerSyncAccountRepository implements AccountRepository {
  final PowerSyncDatabase db;
  PowerSyncAccountRepository(this.db);

  @override
  Stream<List<LedgerAccount>> watch() => db
      .watch('SELECT * FROM accounts WHERE archived = 0')
      .map((rs) => rs.map((r) => accountFromRow(_asMap(r))).toList());

  @override
  Future<void> upsert(LedgerAccount a) async {
    await db.execute(
      '''INSERT OR REPLACE INTO accounts
         (id, user_id, name, type, currency, opening_balance, color, icon, archived, group_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
      [a.id, _currentUserId(), a.name, a.type, a.currency, a.openingBalance,
       a.color, a.icon, a.archived ? 1 : 0, a.groupId],
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
        final out = <LedgerTransaction>[];
        for (final r in rs) {
          final row = _asMap(r);
          final splits = await db.getAll(
            'SELECT * FROM transaction_splits WHERE transaction_id = ?',
            [row['id']],
          );
          out.add(transactionFromRow(
            row,
            splitRows: splits.map(_asMap).toList(),
          ));
        }
        return out;
      });

  @override
  Future<void> upsert(LedgerTransaction t) async {
    final r = transactionToRow(t);
    await db.execute(
      '''INSERT OR REPLACE INTO transactions
         (id, user_id, account_id, category_id, type, amount_minor, currency,
          exchange_rate, ref_amount_minor, acct_minor, payee, note, date,
          hijri_year, hijri_month, hijri_day, payment_type, record_state,
          transfer_pair_id, transfer_dir, transfer_rate, tags, added_by,
          debt_id, debt_role, regular_item_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
      [
        r['id'], _currentUserId(), r['account_id'], r['category_id'], r['type'],
        r['amount_minor'], r['currency'], r['exchange_rate'], r['ref_amount_minor'],
        r['acct_minor'], r['payee'], r['note'], r['date'], r['hijri_year'],
        r['hijri_month'], r['hijri_day'], r['payment_type'], r['record_state'],
        r['transfer_pair_id'], r['transfer_dir'], r['transfer_rate'],
        (r['tags'] as List).join(','), r['added_by'],
        r['debt_id'], r['debt_role'], r['regular_item_id'],
      ],
    );

    await db.execute(
        'DELETE FROM transaction_splits WHERE transaction_id = ?', [t.id]);
    for (final s in t.splits ?? const []) {
      final sr = splitToRow(s, t.id);
      await db.execute(
        '''INSERT OR REPLACE INTO transaction_splits
           (id, transaction_id, account_id, category_id, amount_minor, acct_minor)
           VALUES (?,?,?,?,?,?)''',
        [sr['id'], sr['transaction_id'], sr['account_id'], sr['category_id'],
         sr['amount_minor'], sr['acct_minor']],
      );
    }
  }

  @override
  Future<void> remove(String id) =>
      db.execute('DELETE FROM transactions WHERE id = ?', [id]);
}

class PowerSyncCategoryRepository implements CategoryRepository {
  final PowerSyncDatabase db;
  PowerSyncCategoryRepository(this.db);

  @override
  Stream<List<CategoryNode>> watch() => db
      .watch('SELECT * FROM categories')
      .map((rs) => rs.map((r) => categoryFromRow(_asMap(r))).toList());

  @override
  Future<void> upsert(CategoryNode c) async {
    final r = categoryToRow(c);
    await db.execute(
      '''INSERT OR REPLACE INTO categories
         (id, user_id, parent_id, name, type, color, icon)
         VALUES (?, ?, ?, ?, ?, ?, ?)''',
      [r['id'], _currentUserId(), r['parent_id'], r['name'], r['type'],
       r['color'], r['icon']],
    );
  }

  @override
  Future<void> remove(String id) =>
      db.execute('DELETE FROM categories WHERE id = ?', [id]);
}

class PowerSyncBudgetRepository implements BudgetRepository {
  final PowerSyncDatabase db;
  PowerSyncBudgetRepository(this.db);

  @override
  Stream<List<Budget>> watch() =>
      db.watch('SELECT * FROM budgets').asyncMap((rs) async {
        final out = <Budget>[];
        for (final r in rs) {
          final row = _asMap(r);
          final joins = await db.getAll(
            'SELECT category_id FROM budget_categories WHERE budget_id = ?',
            [row['id']],
          );
          out.add(budgetFromRow(
            row,
            categoryIds: [for (final j in joins) j['category_id'] as String],
          ));
        }
        return out;
      });

  @override
  Future<void> upsert(Budget b) async {
    final r = budgetToRow(b);
    await db.execute(
      '''INSERT OR REPLACE INTO budgets
         (id, user_id, amount_minor, currency, period, rollover)
         VALUES (?, ?, ?, ?, ?, ?)''',
      [r['id'], _currentUserId(), r['amount_minor'], r['currency'], r['period'],
       (r['rollover'] as bool) ? 1 : 0],
    );
    await db.execute(
        'DELETE FROM budget_categories WHERE budget_id = ?', [b.id]);
    for (final cid in b.categoryIds) {
      await db.execute(
        '''INSERT OR REPLACE INTO budget_categories (id, budget_id, category_id)
           VALUES (?, ?, ?)''',
        [const Uuid().v4(), b.id, cid],
      );
    }
  }

  @override
  Future<void> remove(String id) async {
    await db.execute('DELETE FROM budget_categories WHERE budget_id = ?', [id]);
    await db.execute('DELETE FROM budgets WHERE id = ?', [id]);
  }
}

class PowerSyncDebtRepository implements DebtRepository {
  final PowerSyncDatabase db;
  PowerSyncDebtRepository(this.db);

  @override
  Stream<List<Debt>> watch() => db
      .watch('SELECT * FROM debts ORDER BY date_taken DESC')
      .map((rs) => rs.map((r) => debtFromRow(_asMap(r))).toList());

  @override
  Future<void> upsert(Debt d) async {
    final r = debtToRow(d);
    await db.execute(
      '''INSERT OR REPLACE INTO debts
         (id, user_id, type, counterparty, principal_minor, currency,
          account_id, date_taken, due_date, note, status, initial_tx_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',
      [
        r['id'], _currentUserId(), r['type'], r['counterparty'],
        r['principal_minor'], r['currency'], r['account_id'], r['date_taken'],
        r['due_date'], r['note'], r['status'], r['initial_tx_id'],
      ],
    );
  }

  @override
  Future<void> remove(String id) =>
      db.execute('DELETE FROM debts WHERE id = ?', [id]);
}

class PowerSyncRegularItemRepository implements RegularItemRepository {
  final PowerSyncDatabase db;
  PowerSyncRegularItemRepository(this.db);

  @override
  Stream<List<RegularItem>> watch() => db
      .watch('SELECT * FROM regular_items ORDER BY name')
      .map((rs) => rs.map((r) => regularItemFromRow(_asMap(r))).toList());

  @override
  Future<void> upsert(RegularItem i) async {
    final r = regularItemToRow(i);
    await db.execute(
      '''INSERT OR REPLACE INTO regular_items
         (id, user_id, name, default_amount_minor, currency, account_id,
          category_id, icon, color, frequency)
         VALUES (?,?,?,?,?,?,?,?,?,?)''',
      [
        r['id'], _currentUserId(), r['name'], r['default_amount_minor'],
        r['currency'], r['account_id'], r['category_id'], r['icon'],
        r['color'], r['frequency'],
      ],
    );
  }

  @override
  Future<void> remove(String id) =>
      db.execute('DELETE FROM regular_items WHERE id = ?', [id]);
}

/// Settings live in the `profiles` table — exactly one row per user, keyed by
/// the auth user id. Emits defaults until the row syncs in.
class PowerSyncSettingsRepository implements SettingsRepository {
  final PowerSyncDatabase db;
  PowerSyncSettingsRepository(this.db);

  @override
  Stream<UserSettings> watch() =>
      db.watch('SELECT * FROM profiles LIMIT 1').map((rs) =>
          rs.isEmpty ? const UserSettings() : settingsFromRow(_asMap(rs.first)));

  @override
  Future<void> save(UserSettings s) async {
    final uid = _currentUserId();
    if (uid == null) return;
    final r = settingsToRow(s);
    await db.execute(
      '''INSERT OR REPLACE INTO profiles
         (id, home_currency, default_currency, theme, show_hijri,
          calendar_mode, date_format, hijri_offset)
         VALUES (?,?,?,?,?,?,?,?)''',
      [
        uid, r['home_currency'], r['default_currency'], r['theme'],
        (r['show_hijri'] as bool) ? 1 : 0, r['calendar_mode'],
        r['date_format'], r['hijri_offset'],
      ],
    );
  }
}
