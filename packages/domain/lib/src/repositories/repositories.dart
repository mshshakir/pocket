import '../budget/budget_service.dart';
import '../category/category_tree.dart';
import '../debt/debt.dart';
import '../ledger/ledger_entities.dart';
import '../regular/regular_item.dart';
import '../settings/user_settings.dart';
import '../sharing/account_share.dart';

/// Repository ports (interfaces) the data layer implements. Defined in the
/// domain so dependencies point inward (Dependency Inversion): the app and
/// domain depend on these abstractions, while `packages/data` provides the
/// concrete Drift/Supabase/PowerSync — and, for now, in-memory — backings.
///
/// Reads are reactive [Stream]s so the UI updates automatically when data
/// changes (locally or via sync). Writes are [Future]s.

abstract interface class AccountRepository {
  Stream<List<LedgerAccount>> watch();
  Future<void> upsert(LedgerAccount account);
  Future<void> remove(String id);
}

abstract interface class TransactionRepository {
  Stream<List<LedgerTransaction>> watch();
  Future<void> upsert(LedgerTransaction transaction);
  Future<void> remove(String id);
}

abstract interface class CategoryRepository {
  Stream<List<CategoryNode>> watch();
  Future<void> upsert(CategoryNode category);
  Future<void> remove(String id);
}

abstract interface class BudgetRepository {
  Stream<List<Budget>> watch();
  Future<void> upsert(Budget budget);
  Future<void> remove(String id);
}

abstract interface class DebtRepository {
  Stream<List<Debt>> watch();
  Future<void> upsert(Debt debt);
  Future<void> remove(String id);
}

abstract interface class RegularItemRepository {
  Stream<List<RegularItem>> watch();
  Future<void> upsert(RegularItem item);
  Future<void> remove(String id);
}

/// One settings row per signed-in user. [watch] emits defaults until the
/// profile row arrives, then live updates.
abstract interface class SettingsRepository {
  Stream<UserSettings> watch();
  Future<void> save(UserSettings settings);
}

/// Family sharing. Outbound = accounts the user shared; inbound = accounts
/// shared with the user (read-only here; RLS enforces real access).
abstract interface class ShareRepository {
  Stream<List<AccountShare>> watchOutbound();
  Stream<List<InboundShare>> watchInbound();
  Future<void> upsert(AccountShare share);
  Future<void> remove(String id);
}
