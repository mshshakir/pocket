import 'package:pocket_data/pocket_data.dart';
import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

void main() {
  group('InMemoryAccountRepository', () {
    test('emits the seed snapshot to a new listener', () async {
      final repo = InMemoryAccountRepository(const [
        LedgerAccount(id: 'a', currency: 'USD', openingBalance: 100),
      ]);
      final first = await repo.watch().first;
      expect(first.map((a) => a.id), ['a']);
      repo.dispose();
    });

    test('upsert adds, then updates, and pushes new snapshots', () async {
      final repo = InMemoryAccountRepository();
      final seen = <List<LedgerAccount>>[];
      final sub = repo.watch().listen(seen.add);
      await Future<void>.delayed(Duration.zero);

      await repo.upsert(const LedgerAccount(id: 'a', currency: 'USD'));
      await repo.upsert(const LedgerAccount(id: 'a', currency: 'EUR')); // update
      await Future<void>.delayed(Duration.zero);

      expect(seen.first, isEmpty);
      expect(seen.last.single.id, 'a');
      expect(seen.last.single.currency, 'EUR');
      await sub.cancel();
      repo.dispose();
    });

    test('remove deletes by id', () async {
      final repo = InMemoryAccountRepository(const [
        LedgerAccount(id: 'a', currency: 'USD'),
        LedgerAccount(id: 'b', currency: 'EUR'),
      ]);
      final seen = <List<LedgerAccount>>[];
      final sub = repo.watch().listen(seen.add);
      await Future<void>.delayed(Duration.zero);
      await repo.remove('a');
      await Future<void>.delayed(Duration.zero);
      expect(seen.last.map((a) => a.id), ['b']);
      await sub.cancel();
      repo.dispose();
    });
  });

  group('InMemoryTransactionRepository drives LedgerMath', () {
    test('balances reflect repository contents reactively', () async {
      final txRepo = InMemoryTransactionRepository(const []);
      final fx = CurrencyService(const {'USD': 1.0});
      const accounts = [LedgerAccount(id: 'a', currency: 'USD', openingBalance: 1000)];

      await txRepo.upsert(const LedgerTransaction(
        id: 't1', type: TxType.expense, accountId: 'a', currency: 'USD', amount: 250,
      ));
      final txs = await txRepo.watch().first;
      final balances = LedgerMath.balances(accounts, txs, fx);
      expect(balances['a'], 750); // 1000 opening − 250
      txRepo.dispose();
    });
  });
}
