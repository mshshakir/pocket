import 'dart:async';

import 'package:pocket_domain/domain.dart';

/// In-memory [AccountRepository] — a real implementation of the port, used for
/// the runnable app slice and for tests until the Drift/Supabase backing lands.
/// New listeners receive the current snapshot immediately, then live updates.
class InMemoryAccountRepository implements AccountRepository {
  final List<LedgerAccount> _items;
  final _controller = StreamController<List<LedgerAccount>>.broadcast();

  InMemoryAccountRepository([List<LedgerAccount> seed = const []])
      : _items = [...seed];

  @override
  Stream<List<LedgerAccount>> watch() async* {
    yield List.unmodifiable(_items);
    yield* _controller.stream;
  }

  @override
  Future<void> upsert(LedgerAccount account) async {
    final i = _items.indexWhere((a) => a.id == account.id);
    if (i >= 0) {
      _items[i] = account;
    } else {
      _items.add(account);
    }
    _emit();
  }

  @override
  Future<void> remove(String id) async {
    _items.removeWhere((a) => a.id == id);
    _emit();
  }

  void _emit() => _controller.add(List.unmodifiable(_items));
  void dispose() => _controller.close();
}

/// In-memory [CategoryRepository].
class InMemoryCategoryRepository implements CategoryRepository {
  final List<CategoryNode> _items;
  final _controller = StreamController<List<CategoryNode>>.broadcast();

  InMemoryCategoryRepository([List<CategoryNode> seed = const []])
      : _items = [...seed];

  @override
  Stream<List<CategoryNode>> watch() async* {
    yield List.unmodifiable(_items);
    yield* _controller.stream;
  }

  @override
  Future<void> upsert(CategoryNode category) async {
    final i = _items.indexWhere((c) => c.id == category.id);
    if (i >= 0) {
      _items[i] = category;
    } else {
      _items.add(category);
    }
    _emit();
  }

  @override
  Future<void> remove(String id) async {
    _items.removeWhere((c) => c.id == id);
    _emit();
  }

  void _emit() => _controller.add(List.unmodifiable(_items));
  void dispose() => _controller.close();
}

/// In-memory [BudgetRepository].
class InMemoryBudgetRepository implements BudgetRepository {
  final List<Budget> _items;
  final _controller = StreamController<List<Budget>>.broadcast();

  InMemoryBudgetRepository([List<Budget> seed = const []]) : _items = [...seed];

  @override
  Stream<List<Budget>> watch() async* {
    yield List.unmodifiable(_items);
    yield* _controller.stream;
  }

  @override
  Future<void> upsert(Budget budget) async {
    final i = _items.indexWhere((b) => b.id == budget.id);
    if (i >= 0) {
      _items[i] = budget;
    } else {
      _items.add(budget);
    }
    _emit();
  }

  @override
  Future<void> remove(String id) async {
    _items.removeWhere((b) => b.id == id);
    _emit();
  }

  void _emit() => _controller.add(List.unmodifiable(_items));
  void dispose() => _controller.close();
}

/// In-memory [DebtRepository].
class InMemoryDebtRepository implements DebtRepository {
  final List<Debt> _items;
  final _controller = StreamController<List<Debt>>.broadcast();

  InMemoryDebtRepository([List<Debt> seed = const []]) : _items = [...seed];

  @override
  Stream<List<Debt>> watch() async* {
    yield List.unmodifiable(_items);
    yield* _controller.stream;
  }

  @override
  Future<void> upsert(Debt debt) async {
    final i = _items.indexWhere((d) => d.id == debt.id);
    if (i >= 0) {
      _items[i] = debt;
    } else {
      _items.add(debt);
    }
    _emit();
  }

  @override
  Future<void> remove(String id) async {
    _items.removeWhere((d) => d.id == id);
    _emit();
  }

  void _emit() => _controller.add(List.unmodifiable(_items));
  void dispose() => _controller.close();
}

/// In-memory [RegularItemRepository].
class InMemoryRegularItemRepository implements RegularItemRepository {
  final List<RegularItem> _items;
  final _controller = StreamController<List<RegularItem>>.broadcast();

  InMemoryRegularItemRepository([List<RegularItem> seed = const []])
      : _items = [...seed];

  @override
  Stream<List<RegularItem>> watch() async* {
    yield List.unmodifiable(_items);
    yield* _controller.stream;
  }

  @override
  Future<void> upsert(RegularItem item) async {
    final i = _items.indexWhere((x) => x.id == item.id);
    if (i >= 0) {
      _items[i] = item;
    } else {
      _items.add(item);
    }
    _emit();
  }

  @override
  Future<void> remove(String id) async {
    _items.removeWhere((x) => x.id == id);
    _emit();
  }

  void _emit() => _controller.add(List.unmodifiable(_items));
  void dispose() => _controller.close();
}

/// In-memory [SettingsRepository] — a single mutable value.
class InMemorySettingsRepository implements SettingsRepository {
  UserSettings _value;
  final _controller = StreamController<UserSettings>.broadcast();

  InMemorySettingsRepository([this._value = const UserSettings()]);

  @override
  Stream<UserSettings> watch() async* {
    yield _value;
    yield* _controller.stream;
  }

  @override
  Future<void> save(UserSettings settings) async {
    _value = settings;
    _controller.add(_value);
  }

  void dispose() => _controller.close();
}

/// In-memory [ShareRepository] (sample mode: no inbound shares).
class InMemoryShareRepository implements ShareRepository {
  final List<AccountShare> _items;
  final _controller = StreamController<List<AccountShare>>.broadcast();

  InMemoryShareRepository([List<AccountShare> seed = const []])
      : _items = [...seed];

  @override
  Stream<List<AccountShare>> watchOutbound() async* {
    yield List.unmodifiable(_items);
    yield* _controller.stream;
  }

  @override
  Stream<List<InboundShare>> watchInbound() async* {
    yield const <InboundShare>[];
  }

  @override
  Future<void> upsert(AccountShare share) async {
    final i = _items.indexWhere((s) => s.id == share.id);
    if (i >= 0) {
      _items[i] = share;
    } else {
      _items.add(share);
    }
    _emit();
  }

  @override
  Future<void> remove(String id) async {
    _items.removeWhere((s) => s.id == id);
    _emit();
  }

  void _emit() => _controller.add(List.unmodifiable(_items));
  void dispose() => _controller.close();
}

/// In-memory [TransactionRepository].
class InMemoryTransactionRepository implements TransactionRepository {
  final List<LedgerTransaction> _items;
  final _controller = StreamController<List<LedgerTransaction>>.broadcast();

  InMemoryTransactionRepository([List<LedgerTransaction> seed = const []])
      : _items = [...seed];

  @override
  Stream<List<LedgerTransaction>> watch() async* {
    yield List.unmodifiable(_items);
    yield* _controller.stream;
  }

  @override
  Future<void> upsert(LedgerTransaction transaction) async {
    final i = _items.indexWhere((t) => t.id == transaction.id);
    if (i >= 0) {
      _items[i] = transaction;
    } else {
      _items.add(transaction);
    }
    _emit();
  }

  @override
  Future<void> remove(String id) async {
    _items.removeWhere((t) => t.id == id);
    _emit();
  }

  void _emit() => _controller.add(List.unmodifiable(_items));
  void dispose() => _controller.close();
}
