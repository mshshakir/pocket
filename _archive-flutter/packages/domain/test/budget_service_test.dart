import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

void main() {
  final tree = CategoryTree(const [
    CategoryNode(id: 'food', name: 'Food'),
    CategoryNode(id: 'groc', name: 'Groceries', parentId: 'food'),
    CategoryNode(id: 'prod', name: 'Produce', parentId: 'groc'),
    CategoryNode(id: 'rent', name: 'Rent'),
  ]);
  final fx = CurrencyService(const {'USD': 1.0, 'EUR': 0.9});
  final svc = BudgetService(categories: tree, fx: fx, hijri: const HijriCalendar());
  final now = DateTime(2026, 6, 15, 12);

  LedgerTransaction tx(String id, TxType type, String? cat, int amt, DateTime d,
          {List<LedgerSplit>? splits}) =>
      LedgerTransaction(
        id: id, type: type, accountId: 'a', currency: 'USD',
        amount: amt, categoryId: cat, date: d, splits: splits,
      );

  final txs = [
    tx('t1', TxType.expense, 'prod', 1000, DateTime(2026, 6, 10, 12)), // grandchild → counts
    tx('t2', TxType.expense, 'groc', 500, DateTime(2026, 6, 1, 12)),   // child → counts
    tx('t3', TxType.expense, 'rent', 2000, DateTime(2026, 6, 5, 12)),  // unrelated → no
    tx('t4', TxType.expense, 'food', 300, DateTime(2026, 5, 20, 12)),  // last month → no
    tx('t5', TxType.income, 'food', 999, DateTime(2026, 6, 12, 12)),   // income → no
  ];

  const budget = Budget(id: 'b1', categoryIds: ['food'], amount: 5000, currency: 'USD');

  group('BudgetService', () {
    test('currentSpend rolls up the whole subtree, expenses only, this period', () {
      expect(svc.currentSpend(budget, txs, now), 1500); // prod 1000 + groc 500
    });

    test('spendByCategory reports per target with the category name', () {
      final byCat = svc.spendByCategory(budget, txs, now);
      expect(byCat, hasLength(1));
      expect(byCat.first.categoryId, 'food');
      expect(byCat.first.name, 'Food');
      expect(byCat.first.spend, 1500);
    });

    test('periodTransactions returns matching expenses newest-first', () {
      final p = svc.periodTransactions(budget, txs, now);
      expect(p.map((t) => t.id), ['t1', 't2']); // 06-10 before 06-01
    });

    test('split rows are attributed per-category', () {
      final split = tx('t6', TxType.expense, null, 0, DateTime(2026, 6, 9, 12), splits: const [
        LedgerSplit(categoryId: 'prod', amount: 700),
        LedgerSplit(categoryId: 'rent', amount: 300),
      ]);
      expect(svc.currentSpend(budget, [split], now), 700); // only the 'prod' leg counts
    });

    test('foreign-currency spend converts into the budget currency', () {
      final eur = LedgerTransaction(
          id: 't7', type: TxType.expense, accountId: 'a', currency: 'EUR',
          amount: 900, categoryId: 'groc', date: DateTime(2026, 6, 3, 12));
      // 9.00 EUR / 0.9 * 1 = 10.00 USD = 1000 minor
      expect(svc.currentSpend(budget, [eur], now), 1000);
    });

    test('no rollover → limit is the raw amount', () {
      expect(svc.effectiveLimit(budget, txs, now).limit, 5000);
      expect(svc.effectiveLimit(budget, txs, now).rollover, 0);
    });

    test('rollover adds last period leftover', () {
      const rollBudget = Budget(
          id: 'b2', categoryIds: ['food'], amount: 5000, currency: 'USD', rollover: true);
      // previous (May) spend under food = t4 (300). leftover = 4700.
      final lim = svc.effectiveLimit(rollBudget, txs, now);
      expect(lim.rollover, 4700);
      expect(lim.limit, 9700);
    });
  });

  group('Recurrence.stepDate', () {
    test('daily / weekly', () {
      expect(Recurrence.stepDate('2026-06-10', RecurrenceRule.daily), '2026-06-11');
      expect(Recurrence.stepDate('2026-06-10', RecurrenceRule.daily, interval: 3), '2026-06-13');
      expect(Recurrence.stepDate('2026-06-10', RecurrenceRule.weekly), '2026-06-17');
    });

    test('monthly normal + year rollover', () {
      expect(Recurrence.stepDate('2026-06-15', RecurrenceRule.monthly), '2026-07-15');
      expect(Recurrence.stepDate('2026-12-15', RecurrenceRule.monthly), '2027-01-15');
    });

    test('monthly clamps to short month but does NOT drift (anchor restored)', () {
      final feb = Recurrence.stepDate('2026-01-31', RecurrenceRule.monthly, anchorDay: 31);
      expect(feb, '2026-02-28'); // 2026 is not a leap year
      final mar = Recurrence.stepDate(feb, RecurrenceRule.monthly, anchorDay: 31);
      expect(mar, '2026-03-31'); // restored to the 31st, no permanent drift
    });

    test('yearly clamps Feb 29 to Feb 28 on a non-leap year', () {
      expect(Recurrence.stepDate('2024-02-29', RecurrenceRule.yearly), '2025-02-28');
      expect(Recurrence.stepDate('2026-06-15', RecurrenceRule.yearly), '2027-06-15');
    });
  });
}
