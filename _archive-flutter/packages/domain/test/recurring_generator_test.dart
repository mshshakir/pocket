import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

void main() {
  const gen = RecurringGenerator(instanceId: _id);

  LedgerTransaction template({
    String id = 'tpl',
    RecurringSpec? spec,
    DateTime? date,
    TxType type = TxType.expense,
  }) =>
      LedgerTransaction(
        id: id,
        type: type,
        accountId: 'acc',
        currency: 'USD',
        amount: 1000,
        date: date ?? DateTime(2026, 1, 31),
        recurring: spec ?? const RecurringSpec(rule: RecurrenceRule.monthly),
      );

  group('RecurringGenerator', () {
    test('backfills monthly instances up to today with day anchoring', () {
      final out = gen.generate([template()], DateTime(2026, 4, 15));
      expect(out.map((t) => _iso(t.date!)).toList(),
          ['2026-02-28', '2026-03-31']); // Feb clamps, Mar returns to the 31st
      expect(out.first.recurringSourceId, 'tpl');
      expect(out.first.recurring, isNull);
      expect(out.first.id, 'tpl__2026-02-28');
    });

    test('continues from the latest existing instance, no duplicates', () {
      final existing = gen.generate([template()], DateTime(2026, 3, 15));
      final all = [template(), ...existing];
      final out = gen.generate(all, DateTime(2026, 4, 15));
      expect(out.map((t) => _iso(t.date!)).toList(), ['2026-03-31']);
    });

    test('is idempotent once instances exist', () {
      final all = [template(), ...gen.generate([template()], DateTime(2026, 4, 15))];
      expect(gen.generate(all, DateTime(2026, 4, 15)), isEmpty);
    });

    test('respects until and skips transfers', () {
      final until = template(
          id: 'a',
          spec: RecurringSpec(
              rule: RecurrenceRule.monthly, until: DateTime(2026, 2, 28)));
      final transfer = template(id: 'b', type: TxType.transfer);
      final out = gen.generate([until, transfer], DateTime(2026, 6, 1));
      expect(out.map((t) => t.recurringSourceId), everyElement('a'));
      expect(out.map((t) => _iso(t.date!)).toList(), ['2026-02-28']);
    });

    test('weekly with interval', () {
      final t = template(
          id: 'w',
          spec: const RecurringSpec(rule: RecurrenceRule.weekly, interval: 2),
          date: DateTime(2026, 6, 1));
      final out = gen.generate([t], DateTime(2026, 6, 30));
      expect(out.map((x) => _iso(x.date!)).toList(),
          ['2026-06-15', '2026-06-29']);
    });
  });
}

String _id(String templateId, String dateIso) => '${templateId}__$dateIso';

String _iso(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-'
    '${d.month.toString().padLeft(2, '0')}-'
    '${d.day.toString().padLeft(2, '0')}';
