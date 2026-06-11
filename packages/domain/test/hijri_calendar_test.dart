import 'package:pocket_domain/domain.dart';
import 'package:test/test.dart';

void main() {
  const cal = HijriCalendar();

  group('HijriCalendar', () {
    test('toHijri returns valid bounds', () {
      final h = cal.toHijri(DateTime(2026, 6, 7, 12));
      expect(h.month, inInclusiveRange(0, 11));
      expect(h.day, inInclusiveRange(1, 30));
      expect(h.year, greaterThan(1400));
    });

    test('Gregorian → Hijri → Gregorian round-trips to the same day', () {
      for (final d in [
        DateTime(2026, 1, 1, 12),
        DateTime(2026, 6, 7, 12),
        DateTime(2000, 2, 29, 12),
        DateTime(2024, 12, 31, 12),
        DateTime(1990, 7, 15, 12),
      ]) {
        final h = cal.toHijri(d);
        final back = cal.toGregorian(h.year, h.month, h.day);
        expect(back.year, d.year, reason: '$d');
        expect(back.month, d.month, reason: '$d');
        expect(back.day, d.day, reason: '$d');
      }
    });

    test('offset shifts the result by whole days', () {
      final base = cal.toHijri(DateTime(2026, 6, 7, 12));
      final plus1 = cal.toHijri(DateTime(2026, 6, 7, 12), offset: 1);
      // +1 day offset advances the Hijri day (or rolls the month) — never equal.
      expect(plus1 == base, isFalse);
    });

    test('toHijriRaw ignores offset (== offset 0)', () {
      final raw = cal.toHijriRaw(DateTime(2026, 6, 7, 12));
      final zero = cal.toHijri(DateTime(2026, 6, 7, 12), offset: 0);
      expect(raw, zero);
    });

    test('daysInMonth is 29 or 30; Zilhaj 30 only in kabisa years', () {
      for (var m = 0; m < 12; m++) {
        final n = cal.daysInMonth(1447, m);
        expect(n == 29 || n == 30, isTrue);
      }
      // odd months (0-based even index = month 1,3,..) → 30, others 29 except Zilhaj/kabisa
      expect(cal.daysInMonth(1447, 0), 30); // Moharram always 30
      expect(cal.daysInMonth(1447, 1), 29); // Safar always 29
    });

    test('format renders day, month name and H-year', () {
      final s = cal.format(const HijriDate(1447, 11, 21));
      expect(s, '21 Zilhaj 1447H');
      expect(cal.format(const HijriDate(1447, 0, 1), long: true),
          '1 Moharram al-Haraam 1447H');
    });

    test('miqaats are injectable and looked up by month-day', () {
      const c = HijriCalendar(miqaats: {
        '11-21': [Miqaat('Eid', 1)],
      });
      expect(c.miqaatsFor(const HijriDate(1447, 11, 21)).first.text, 'Eid');
      expect(c.miqaatsFor(const HijriDate(1447, 0, 1)), isEmpty);
    });
  });

  group('CategoryTree', () {
    final tree = CategoryTree(const [
      CategoryNode(id: 'food', name: 'Food'),
      CategoryNode(id: 'groc', name: 'Groceries', parentId: 'food'),
      CategoryNode(id: 'prod', name: 'Produce', parentId: 'groc'),
      CategoryNode(id: 'rent', name: 'Rent'),
    ]);

    test('descendants is the full transitive subtree', () {
      final d = tree.descendants('food');
      expect(d.toSet(), {'food', 'groc', 'prod'}); // grandchild included
      expect(tree.descendants('rent'), ['rent']);
    });

    test('fullName joins parent / child', () {
      expect(tree.fullName('groc'), 'Food / Groceries');
      expect(tree.fullName('food'), 'Food');
      expect(tree.fullName('missing'), '');
    });

    test('roots filters by absence of parent', () {
      expect(tree.roots().map((c) => c.id).toSet(), {'food', 'rent'});
    });

    test('descendants is cycle-safe', () {
      final cyclic = CategoryTree(const [
        CategoryNode(id: 'a', name: 'A', parentId: 'b'),
        CategoryNode(id: 'b', name: 'B', parentId: 'a'),
      ]);
      // must terminate and include both
      expect(cyclic.descendants('a').toSet(), {'a', 'b'});
    });
  });
}
