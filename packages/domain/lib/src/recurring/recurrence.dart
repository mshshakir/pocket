/// Recurrence date math — the pure, bug-prone part of the JS `RecurringService`.
///
/// Monthly/yearly stepping is anchored to the template's original day-of-month
/// and clamped to the target month's length, so a recurrence that lands on a
/// short month (e.g. the 31st → February) never permanently drifts earlier.

enum RecurrenceRule { daily, weekly, monthly, yearly }

abstract final class Recurrence {
  /// Advance an ISO 'YYYY-MM-DD' date by one recurrence step.
  ///
  /// [anchorDay] is the template's preferred day-of-month (defaults to the
  /// input's day). [interval] is clamped to at least 1.
  static String stepDate(
    String iso,
    RecurrenceRule rule, {
    int interval = 1,
    int? anchorDay,
  }) {
    final base = _isoNoon(iso);
    final n = interval < 1 ? 1 : interval;
    final day = anchorDay ?? base.day;

    final DateTime d;
    switch (rule) {
      case RecurrenceRule.daily:
        d = base.add(Duration(days: n));
      case RecurrenceRule.weekly:
        d = base.add(Duration(days: 7 * n));
      case RecurrenceRule.monthly:
        final m0 = (base.month - 1) + n; // 0-based month + n
        final year = base.year + (m0 ~/ 12);
        final month = (m0 % 12) + 1; // back to 1-based
        final dim = _gregDaysInMonth(year, month);
        d = DateTime(year, month, day <= dim ? day : dim, 12);
      case RecurrenceRule.yearly:
        final year = base.year + n;
        final month = base.month;
        final dim = _gregDaysInMonth(year, month);
        d = DateTime(year, month, day <= dim ? day : dim, 12);
    }
    return _isoString(d);
  }

  /// Days in a Gregorian month (1-based month). `DateTime(y, m+1, 0)` is the
  /// last day of month `m`.
  static int _gregDaysInMonth(int year, int month) =>
      DateTime(year, month + 1, 0).day;

  static DateTime _isoNoon(String iso) {
    final p = iso.split('-');
    return DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]), 12);
  }

  static String _isoString(DateTime d) {
    final mm = d.month.toString().padLeft(2, '0');
    final dd = d.day.toString().padLeft(2, '0');
    return '${d.year}-$mm-$dd';
  }
}
