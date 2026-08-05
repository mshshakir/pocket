/// Generates missing recurring-transaction instances — pure port of the
/// legacy `RecurringService.process()` with its hardening intact:
///  * transfers are skipped (cloning one leg would orphan its pair, B5);
///  * monthly/yearly stepping anchors to the template's day-of-month (I4);
///  * instance ids are DETERMINISTIC per (template, date) so two devices
///    backfilling the same occurrence collide instead of duplicating;
///  * safety cap of 500 instances per template per run.
library;

import '../calendar/hijri_calendar.dart';
import '../ledger/ledger_entities.dart';
import 'recurrence.dart';

class RecurringGenerator {
  final HijriCalendar hijri;
  final int hijriOffset;

  /// Maps (templateId, 'YYYY-MM-DD') to a stable instance id. Injected so the
  /// app can use UUIDv5 (Postgres ids are uuids) while tests use plain strings.
  final String Function(String templateId, String dateIso) instanceId;

  const RecurringGenerator({
    required this.instanceId,
    this.hijri = const HijriCalendar(),
    this.hijriOffset = 0,
  });

  /// Returns the instances missing as of [today] (does not mutate input).
  List<LedgerTransaction> generate(
      List<LedgerTransaction> all, DateTime today) {
    final todayIso = _iso(today);
    final out = <LedgerTransaction>[];

    for (final template in all) {
      final spec = template.recurring;
      if (spec == null || template.recurringSourceId != null) continue;
      if (template.type == TxType.transfer) continue;
      final templateDate = template.date;
      if (templateDate == null) continue;

      final anchorDay = templateDate.day;
      final untilIso = spec.until == null ? null : _iso(spec.until!);

      // Latest existing occurrence = max(template date, instance dates).
      var latest = _iso(templateDate);
      final existingIds = <String>{};
      for (final t in all) {
        if (t.recurringSourceId != template.id) continue;
        existingIds.add(t.id);
        if (t.date != null) {
          final d = _iso(t.date!);
          if (d.compareTo(latest) > 0) latest = d;
        }
      }

      var next = Recurrence.stepDate(latest, spec.rule,
          interval: spec.interval, anchorDay: anchorDay);
      var safety = 0;

      while (next.compareTo(todayIso) <= 0 &&
          (untilIso == null || next.compareTo(untilIso) <= 0) &&
          safety++ < 500) {
        final id = instanceId(template.id, next);
        if (!existingIds.contains(id)) {
          out.add(_clone(template, id, _date(next)));
        }
        next = Recurrence.stepDate(next, spec.rule,
            interval: spec.interval, anchorDay: anchorDay);
      }
    }
    return out;
  }

  LedgerTransaction _clone(
          LedgerTransaction t, String id, DateTime date) =>
      LedgerTransaction(
        id: id,
        type: t.type,
        accountId: t.accountId,
        currency: t.currency,
        amount: t.amount,
        acctMinor: t.acctMinor,
        splits: t.splits == null
            ? null
            : [
                for (final s in t.splits!)
                  LedgerSplit(
                      accountId: s.accountId,
                      categoryId: s.categoryId,
                      amount: s.amount,
                      acctMinor: s.acctMinor),
              ],
        categoryId: t.categoryId,
        date: date,
        // Snapshot with the CURRENT offset — the instance is "new" today.
        hijriDate: hijri.toHijri(date, offset: hijriOffset),
        payee: t.payee,
        note: t.note,
        paymentType: t.paymentType,
        recordState: t.recordState,
        tags: [...t.tags],
        regularItemId: t.regularItemId,
        recurringSourceId: t.id,
        // recurring intentionally null: instances are not templates.
      );

  static String _iso(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';

  static DateTime _date(String iso) {
    final p = iso.split('-');
    return DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]));
  }
}
