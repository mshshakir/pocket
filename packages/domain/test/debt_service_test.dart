import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

void main() {
  const fx = CurrencyService({'USD': 1.0, 'INR': 80.0});
  const svc = DebtService(fx);

  const debt = Debt(
    id: 'd1',
    type: DebtType.borrowed,
    counterparty: 'Ali',
    principal: 10000, // USD 100.00
    currency: 'USD',
    accountId: 'cash',
    initialTxId: 'tx-init',
  );

  LedgerTransaction pay(String id, int amount,
          {String currency = 'USD', String? debtId = 'd1'}) =>
      LedgerTransaction(
        id: id,
        type: TxType.expense,
        accountId: 'cash',
        currency: currency,
        amount: amount,
        debtId: debtId,
        debtRole: 'payment',
      );

  group('DebtService', () {
    test('excludes the initial transaction from payments (legacy bug 14)', () {
      final txs = [
        pay('tx-init', 10000), // the principal posting — must not count
        pay('p1', 2500),
      ];
      expect(svc.paidAmount(debt, txs), 2500);
      expect(svc.remaining(debt, txs), 7500);
      expect(svc.percentRepaid(debt, txs), 25);
    });

    test('ignores unrelated transactions', () {
      final txs = [pay('x', 9999, debtId: null), pay('p1', 1000)];
      expect(svc.paidAmount(debt, txs), 1000);
    });

    test('converts cross-currency payments into the debt currency (bug 11)',
        () {
      // INR 4,000.00 at 80/USD = USD 50.00
      final txs = [pay('p1', 400000, currency: 'INR')];
      expect(svc.paidAmount(debt, txs), 5000);
      expect(svc.remaining(debt, txs), 5000);
      expect(svc.isSettled(debt, txs), isFalse);
    });

    test('floors remaining at zero and caps percent at 100', () {
      final txs = [pay('p1', 12000)];
      expect(svc.remaining(debt, txs), 0);
      expect(svc.percentRepaid(debt, txs), 100);
      expect(svc.isSettled(debt, txs), isTrue);
    });

    test('zero-principal debt counts as fully repaid', () {
      const zero = Debt(
          id: 'd0',
          type: DebtType.lent,
          counterparty: 'X',
          principal: 0,
          currency: 'USD');
      expect(svc.percentRepaid(zero, const []), 100);
    });

    test('initial transaction: borrow = income, lend = expense, tagged', () {
      final tx = svc.buildInitialTransaction(
          debt: debt, txId: 't1', accountCurrency: 'INR');
      expect(tx.type, TxType.income);
      expect(tx.debtId, 'd1');
      expect(tx.debtRole, 'initial');
      expect(tx.tags, ['debt']);
      // USD 100 → INR 8,000.00 frozen into the account currency
      expect(tx.acctMinor, 800000);

      final lent = svc.buildInitialTransaction(
        debt: const Debt(
            id: 'd2',
            type: DebtType.lent,
            counterparty: 'B',
            principal: 500,
            currency: 'USD',
            accountId: 'cash'),
        txId: 't2',
        accountCurrency: 'USD',
      );
      expect(lent.type, TxType.expense);
      expect(lent.acctMinor, 500);
    });

    test('payment transaction: borrow = expense, lend = income', () {
      final tx = svc.buildPaymentTransaction(
        debt: debt,
        txId: 'p1',
        accountId: 'cash',
        accountCurrency: 'USD',
        amount: 2500,
      );
      expect(tx.type, TxType.expense);
      expect(tx.debtRole, 'payment');
      expect(tx.tags, ['debt-payment']);
    });
  });
}
