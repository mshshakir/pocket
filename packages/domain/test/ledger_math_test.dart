import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

void main() {
  // units per 1 USD
  final fx = CurrencyService(const {
    'USD': 1.0,
    'EUR': 0.9,
    'INR': 83.0,
    'KES': 130.0,
    'JPY': 150.0, // zero-decimal
  });

  group('CurrencyService', () {
    test('same currency is identity', () {
      expect(fx.convertStrict(1000, 'USD', 'USD'), 1000);
    });

    test('minor factors honour ISO decimals', () {
      expect(fx.minorFactor('USD'), 100);
      expect(fx.minorFactor('JPY'), 1); // zero-decimal
      expect(fx.minorFactor('BHD'), 1000); // three-decimal
    });

    test('round-trips minor <-> major', () {
      expect(fx.toMinor(12.50, 'USD'), 1250);
      expect(fx.fromMinor(1250, 'USD'), 12.5);
      expect(fx.toMinor(1000, 'JPY'), 1000); // ¥1000 == 1000 minor
    });

    test('convertStrict throws on unknown currency', () {
      expect(() => fx.convertStrict(100, 'USD', 'ZZZ'),
          throwsA(isA<CurrencyException>()));
    });

    test('convert returns 0 (not 1:1) on unknown currency', () {
      expect(fx.convert(100, 'USD', 'ZZZ'), 0);
    });
  });

  group('LedgerMath', () {
    const usd = LedgerAccount(id: 'a1', currency: 'USD', openingBalance: 10000);
    const kes = LedgerAccount(id: 'a2', currency: 'KES', openingBalance: 0);

    test('expense subtracts, income adds', () {
      const expense = LedgerTransaction(
          id: 't1', type: TxType.expense, accountId: 'a1', currency: 'USD', amount: 2500);
      const income = LedgerTransaction(
          id: 't2', type: TxType.income, accountId: 'a1', currency: 'USD', amount: 4000);
      expect(LedgerMath.accountDelta(expense, usd, fx), -2500);
      expect(LedgerMath.accountDelta(income, usd, fx), 4000);
    });

    test('transfer honours direction', () {
      const out = LedgerTransaction(
          id: 't3', type: TxType.transfer, accountId: 'a1', currency: 'USD',
          amount: 1000, transferDir: TransferDir.outbound);
      const inn = LedgerTransaction(
          id: 't4', type: TxType.transfer, accountId: 'a1', currency: 'USD',
          amount: 1000, transferDir: TransferDir.inbound);
      expect(LedgerMath.accountDelta(out, usd, fx), -1000);
      expect(LedgerMath.accountDelta(inn, usd, fx), 1000);
    });

    test('frozen acctMinor is preferred over the live rate', () {
      // A EUR expense on a USD account, frozen at $11.00 when booked.
      const tx = LedgerTransaction(
          id: 't5', type: TxType.expense, accountId: 'a1', currency: 'EUR',
          amount: 1000, acctMinor: 1100);
      // Must use the frozen 1100, NOT a live EUR->USD reconversion.
      expect(LedgerMath.accountDelta(tx, usd, fx), -1100);
    });

    test('legacy row without acctMinor falls back to live conversion', () {
      // 1000 KES minor on a USD account, no frozen amount.
      // live: 10.00 KES /130 *1 = 0.0769 USD -> 8 minor (rounded).
      const tx = LedgerTransaction(
          id: 't6', type: TxType.expense, accountId: 'a1', currency: 'KES', amount: 1000);
      expect(LedgerMath.accountDelta(tx, usd, fx), -8);
    });

    test('splits post per account', () {
      const tx = LedgerTransaction(
        id: 't7', type: TxType.expense, accountId: 'a1', currency: 'USD', amount: 3000,
        splits: [
          LedgerSplit(accountId: 'a1', amount: 1000),
          LedgerSplit(accountId: 'a2', amount: 2000, acctMinor: 5000), // booked to KES acct
        ],
      );
      expect(LedgerMath.accountDelta(tx, usd, fx), -1000);
      expect(LedgerMath.accountDelta(tx, kes, fx), -5000);
    });

    test('balances = opening + sum, deleted-account postings dropped', () {
      const txs = [
        LedgerTransaction(id: 't8', type: TxType.expense, accountId: 'a1', currency: 'USD', amount: 2500),
        LedgerTransaction(id: 't9', type: TxType.income, accountId: 'a1', currency: 'USD', amount: 1000),
        LedgerTransaction(id: 't10', type: TxType.expense, accountId: 'ghost', currency: 'USD', amount: 9999),
      ];
      final b = LedgerMath.balances(const [usd, kes], txs, fx);
      expect(b['a1'], 10000 - 2500 + 1000); // 8500
      expect(b['a2'], 0);
      expect(b.containsKey('ghost'), isFalse);
    });
  });
}
