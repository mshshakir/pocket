import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

void main() {
  const base = LedgerTransaction(
    id: 't1',
    type: TxType.expense,
    accountId: 'acc',
    currency: 'USD',
    amount: 1000,
    categoryId: 'cat',
    payee: 'Shop',
    paymentType: 'card',
    transferPairId: 'pair',
    debtId: 'debt',
    debtRole: 'payment',
  );

  group('LedgerTransaction.copyWith', () {
    test('leaves untouched fields unchanged', () {
      final copy = base.copyWith(amount: 2000);
      expect(copy.amount, 2000);
      expect(copy.id, 't1');
      expect(copy.categoryId, 'cat');
      expect(copy.payee, 'Shop');
      expect(copy.transferPairId, 'pair');
      expect(copy.debtId, 'debt');
      expect(copy.debtRole, 'payment');
    });

    test('can explicitly clear a nullable field to null', () {
      final unlinked = base.copyWith(transferPairId: null);
      expect(unlinked.transferPairId, isNull);
      // other fields preserved
      expect(unlinked.debtId, 'debt');
      expect(unlinked.amount, 1000);
    });

    test('clears the debt link the way DebtController relies on', () {
      final cleared = base.copyWith(debtId: null, debtRole: null);
      expect(cleared.debtId, isNull);
      expect(cleared.debtRole, isNull);
      expect(cleared.categoryId, 'cat'); // unrelated fields kept
    });

    test('not passing a nullable arg keeps its existing (non-null) value', () {
      final copy = base.copyWith(payee: 'New');
      expect(copy.payee, 'New');
      expect(copy.transferPairId, 'pair'); // sentinel default = unchanged
      expect(copy.debtId, 'debt');
    });
  });
}
