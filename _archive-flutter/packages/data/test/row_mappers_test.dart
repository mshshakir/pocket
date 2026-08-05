import 'package:pocket_data/pocket_data.dart';
import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

void main() {
  group('account row mapping', () {
    test('round-trips all fields', () {
      const a = LedgerAccount(
        id: 'acc1', currency: 'KES', openingBalance: 125000,
        name: 'M-Pesa', type: 'cash', color: '#0EA5E9', icon: 'wallet',
        archived: true, groupId: 'g1',
      );
      final b = accountFromRow(accountToRow(a));
      expect(b.id, a.id);
      expect(b.currency, a.currency);
      expect(b.openingBalance, a.openingBalance);
      expect(b.name, a.name);
      expect(b.type, a.type);
      expect(b.color, a.color);
      expect(b.icon, a.icon);
      expect(b.archived, a.archived);
      expect(b.groupId, a.groupId);
    });

    test('column names match the SQL schema', () {
      final row = accountToRow(const LedgerAccount(id: 'x', currency: 'USD'));
      expect(row.keys, containsAll(
          ['id', 'name', 'type', 'currency', 'opening_balance', 'archived', 'group_id']));
    });
  });

  group('transaction row mapping', () {
    test('round-trips a foreign-currency expense with frozen acct_minor + hijri', () {
      final t = LedgerTransaction(
        id: 't1', type: TxType.expense, accountId: 'acc1', currency: 'EUR',
        amount: 1000, acctMinor: 1100, categoryId: 'food',
        date: DateTime(2026, 6, 7), hijriDate: const HijriDate(1447, 11, 21),
        payee: 'Cafe', note: 'lunch', paymentType: 'card',
        exchangeRate: 0.9, refAmountMinor: 1100, tags: const ['work', 'reimbursable'],
        addedBy: 'me@example.com',
      );
      final row = transactionToRow(t);
      final back = transactionFromRow(row);

      expect(back.id, t.id);
      expect(back.type, TxType.expense);
      expect(back.accountId, t.accountId);
      expect(back.currency, 'EUR');
      expect(back.amount, 1000);
      expect(back.acctMinor, 1100);
      expect(back.categoryId, 'food');
      expect(back.date, DateTime(2026, 6, 7));
      expect(back.hijriDate, const HijriDate(1447, 11, 21));
      expect(back.payee, 'Cafe');
      expect(back.note, 'lunch');
      expect(back.exchangeRate, 0.9);
      expect(back.refAmountMinor, 1100);
      expect(back.tags, ['work', 'reimbursable']);
      expect(back.addedBy, 'me@example.com');
    });

    test('round-trips a transfer leg (direction preserved)', () {
      const t = LedgerTransaction(
        id: 'to', type: TxType.transfer, accountId: 'acc1', currency: 'USD',
        amount: 5000, transferDir: TransferDir.outbound, transferPairId: 'ti',
      );
      final back = transactionFromRow(transactionToRow(t));
      expect(back.type, TxType.transfer);
      expect(back.transferDir, TransferDir.outbound);
      expect(back.transferPairId, 'ti');
    });

    test('round-trips splits via the split rows', () {
      const t = LedgerTransaction(
        id: 'ts', type: TxType.expense, accountId: 'acc1', currency: 'USD', amount: 3000,
        splits: [
          LedgerSplit(id: 's1', accountId: 'acc1', categoryId: 'food', amount: 1000),
          LedgerSplit(id: 's2', accountId: 'acc2', categoryId: 'fuel', amount: 2000, acctMinor: 5000),
        ],
      );
      final txRow = transactionToRow(t);
      final splitRows = t.splits!.map((s) => splitToRow(s, t.id)).toList();
      final back = transactionFromRow(txRow, splitRows: splitRows);

      expect(back.splits, hasLength(2));
      expect(back.splits![0].categoryId, 'food');
      expect(back.splits![1].accountId, 'acc2');
      expect(back.splits![1].acctMinor, 5000);
      expect(splitRows.first['transaction_id'], 'ts');
    });

    test('a row with no hijri/splits maps to null cleanly', () {
      final back = transactionFromRow(transactionToRow(const LedgerTransaction(
        id: 't0', type: TxType.income, accountId: 'a', currency: 'USD', amount: 100,
      )));
      expect(back.hijriDate, isNull);
      expect(back.splits, isNull);
      expect(back.tags, isEmpty);
    });
  });

  group('category row mapping', () {
    test('round-trips, including a nested parent', () {
      const c = CategoryNode(
        id: 'groc', name: 'Groceries', parentId: 'food',
        type: 'expense', color: '#22c55e', icon: 'cart',
      );
      final back = categoryFromRow(categoryToRow(c));
      expect(back.id, 'groc');
      expect(back.name, 'Groceries');
      expect(back.parentId, 'food');
      expect(back.type, 'expense');
      expect(back.color, '#22c55e');
      expect(back.icon, 'cart');
    });
  });

  group('budget row mapping', () {
    test('round-trips with target categories via the join table', () {
      const b = Budget(
        id: 'b1', categoryIds: ['food', 'transport'],
        amount: 50000, currency: 'USD',
        period: BudgetPeriod.hijri, rollover: true,
      );
      final row = budgetToRow(b);
      final joinRows = budgetCategoryRows(b);
      final back = budgetFromRow(
        row,
        categoryIds: joinRows.map((r) => r['category_id'] as String).toList(),
      );
      expect(back.id, 'b1');
      expect(back.amount, 50000);
      expect(back.currency, 'USD');
      expect(back.period, BudgetPeriod.hijri);
      expect(back.rollover, isTrue);
      expect(back.categoryIds, ['food', 'transport']);
      expect(joinRows, hasLength(2));
      expect(joinRows.first['budget_id'], 'b1');
    });

    test('period defaults to gregorian on an unknown value', () {
      final back = budgetFromRow(const {
        'id': 'b2', 'amount_minor': 100, 'currency': 'USD', 'period': null, 'rollover': false,
      });
      expect(back.period, BudgetPeriod.gregorian);
    });
  });
}
