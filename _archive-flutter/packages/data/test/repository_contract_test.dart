import 'package:pocket_data/pocket_data.dart';
import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

/// One behavioural contract every reactive repository must satisfy, so the
/// in-memory backing (and, wired with a temp DB, the PowerSync one) stay
/// identical: a new listener gets the current snapshot, upsert adds then
/// updates in place, and remove deletes — each pushing a fresh snapshot
/// (audit C3). Parameterised via [RepoHarness] so one suite covers every
/// entity type.
abstract class RepoHarness<T> {
  Stream<List<T>> watch();
  Future<void> upsertNew(String id);
  Future<void> upsertChanged(String id);
  Future<void> remove(String id);
  String idOf(T item);
  bool isChanged(T item);
  void dispose();
}

void runRepositoryContract<T>(String name, RepoHarness<T> Function() make) {
  group(name, () {
    test('streams snapshots: empty → add → update → remove', () async {
      final h = make();
      final seen = <List<T>>[];
      final sub = h.watch().listen(seen.add);
      await Future<void>.delayed(Duration.zero);

      await h.upsertNew('x');
      await h.upsertChanged('x');
      await h.remove('x');
      await Future<void>.delayed(Duration.zero);

      expect(seen.first, isEmpty, reason: 'first snapshot should be empty');
      expect(
        seen.any((s) =>
            s.length == 1 && h.idOf(s.single) == 'x' && !h.isChanged(s.single)),
        isTrue,
        reason: 'a snapshot with the freshly-added item',
      );
      expect(
        seen.any((s) => s.length == 1 && h.isChanged(s.single)),
        isTrue,
        reason: 'upsert updates in place, not appends',
      );
      expect(seen.last, isEmpty, reason: 'remove clears it');

      await sub.cancel();
      h.dispose();
    });

    test('a new listener receives the current snapshot immediately', () async {
      final h = make();
      await h.upsertNew('y');
      final first = await h.watch().first;
      expect(first.map(h.idOf), contains('y'));
      h.dispose();
    });
  });
}

class _AccountHarness extends RepoHarness<LedgerAccount> {
  final repo = InMemoryAccountRepository();
  @override
  Stream<List<LedgerAccount>> watch() => repo.watch();
  @override
  Future<void> upsertNew(String id) =>
      repo.upsert(LedgerAccount(id: id, currency: 'USD', name: 'A'));
  @override
  Future<void> upsertChanged(String id) =>
      repo.upsert(LedgerAccount(id: id, currency: 'USD', name: 'CHANGED'));
  @override
  Future<void> remove(String id) => repo.remove(id);
  @override
  String idOf(LedgerAccount a) => a.id;
  @override
  bool isChanged(LedgerAccount a) => a.name == 'CHANGED';
  @override
  void dispose() => repo.dispose();
}

class _CategoryHarness extends RepoHarness<CategoryNode> {
  final repo = InMemoryCategoryRepository();
  @override
  Stream<List<CategoryNode>> watch() => repo.watch();
  @override
  Future<void> upsertNew(String id) =>
      repo.upsert(CategoryNode(id: id, name: 'A'));
  @override
  Future<void> upsertChanged(String id) =>
      repo.upsert(CategoryNode(id: id, name: 'CHANGED'));
  @override
  Future<void> remove(String id) => repo.remove(id);
  @override
  String idOf(CategoryNode c) => c.id;
  @override
  bool isChanged(CategoryNode c) => c.name == 'CHANGED';
  @override
  void dispose() => repo.dispose();
}

class _MerchantHarness extends RepoHarness<MerchantCategory> {
  final repo = InMemoryMerchantCategoryRepository();
  @override
  Stream<List<MerchantCategory>> watch() => repo.watch();
  @override
  Future<void> upsertNew(String id) =>
      repo.upsert(MerchantCategory(merchant: id, categoryId: 'c'));
  @override
  Future<void> upsertChanged(String id) =>
      repo.upsert(MerchantCategory(merchant: id, categoryId: 'CHANGED'));
  @override
  Future<void> remove(String id) => repo.remove(id);
  @override
  String idOf(MerchantCategory m) => m.merchant;
  @override
  bool isChanged(MerchantCategory m) => m.categoryId == 'CHANGED';
  @override
  void dispose() => repo.dispose();
}

class _GroupHarness extends RepoHarness<AccountGroup> {
  final repo = InMemoryAccountGroupRepository();
  @override
  Stream<List<AccountGroup>> watch() => repo.watch();
  @override
  Future<void> upsertNew(String id) =>
      repo.upsert(AccountGroup(id: id, name: 'A'));
  @override
  Future<void> upsertChanged(String id) =>
      repo.upsert(AccountGroup(id: id, name: 'CHANGED'));
  @override
  Future<void> remove(String id) => repo.remove(id);
  @override
  String idOf(AccountGroup g) => g.id;
  @override
  bool isChanged(AccountGroup g) => g.name == 'CHANGED';
  @override
  void dispose() => repo.dispose();
}

void main() {
  runRepositoryContract('InMemoryAccountRepository', () => _AccountHarness());
  runRepositoryContract('InMemoryCategoryRepository', () => _CategoryHarness());
  runRepositoryContract(
      'InMemoryMerchantCategoryRepository', () => _MerchantHarness());
  runRepositoryContract(
      'InMemoryAccountGroupRepository', () => _GroupHarness());
}
