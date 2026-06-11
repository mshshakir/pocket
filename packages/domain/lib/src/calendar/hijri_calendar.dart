/// Hijri ⇄ Gregorian calendar conversions — a faithful Dart port of the JS
/// `HijriCalendarService` (itself ported from mumineen_calendar, MIT).
///
/// Pure: no I/O, no globals. The user's day offset is passed in per call rather
/// than read from a store. Month index is 0-based (0 = Moharram … 11 = Zilhaj).

class HijriDate {
  final int year;
  final int month; // 0-based
  final int day;
  const HijriDate(this.year, this.month, this.day);

  @override
  bool operator ==(Object o) =>
      o is HijriDate && o.year == year && o.month == month && o.day == day;
  @override
  int get hashCode => Object.hash(year, month, day);
  @override
  String toString() => 'HijriDate($year, $month, $day)';
}

class Miqaat {
  final String text;
  final int priority;
  const Miqaat(this.text, this.priority);
}

class HijriCalendar {
  /// Miqaat lookup keyed by '"month-day"' (0-based month). Injected so the big
  /// table lives as data, keeping this class pure. Defaults to empty.
  final Map<String, List<Miqaat>> miqaats;

  const HijriCalendar({this.miqaats = const {}});

  static const List<String> monthsLong = [
    'Moharram al-Haraam', 'Safar al-Muzaffar', 'Rabi al-Awwal', 'Rabi al-Aakhar',
    'Jumada al-Ula', 'Jumada al-Ukhra', 'Rajab al-Asab', 'Shabaan al-Karim',
    'Ramadaan al-Moazzam', 'Shawwal al-Mukarram', 'Zilqadah al-Haraam', 'Zilhaj al-Haraam',
  ];

  static const List<String> monthsShort = [
    'Moharram', 'Safar', 'Rabi I', 'Rabi II', 'Jumada I', 'Jumada II',
    'Rajab', 'Shabaan', 'Ramadaan', 'Shawwal', 'Zilqadah', 'Zilhaj',
  ];

  static const List<int> _kabisaRem = [2, 5, 8, 10, 13, 16, 19, 21, 24, 27, 29];
  static const List<int> _daysInYear = [30, 59, 89, 118, 148, 177, 207, 236, 266, 295, 325];
  static const List<int> _daysIn30 = [
    354, 708, 1063, 1417, 1771, 2126, 2480, 2834, 3189, 3543, 3898, 4252, 4606, 4961,
    5315, 5669, 6024, 6378, 6732, 7087, 7441, 7796, 8150, 8504, 8859, 9213, 9567, 9922, 10276, 10631,
  ];

  // ── Julian / Gregorian helpers ──────────────────────────────────────

  bool _isJulian(DateTime d) {
    final monthIdx = d.month - 1; // JS getMonth() is 0-based
    if (d.year < 1582) return true;
    if (d.year == 1582) {
      if (monthIdx < 9) return true;
      if (monthIdx == 9 && d.day < 5) return true;
    }
    return false;
  }

  double _gregorianToAjd(DateTime d) {
    int y = d.year;
    int m = d.month; // already 1-based (JS used getMonth()+1)
    final day = d.day +
        d.hour / 24 +
        d.minute / 1440 +
        d.second / 86400 +
        d.millisecond / 86400000;
    if (m < 3) {
      y--;
      m += 12;
    }
    final a = (y / 100).floor();
    final b = _isJulian(d) ? 0 : 2 - a + (a / 4).floor();
    return (365.25 * (y + 4716)).floor() +
        (30.6001 * (m + 1)).floor() +
        day +
        b -
        1524.5;
  }

  HijriDate _ajdToHijri(double ajd) {
    int i = 0;
    int left = (ajd - 1948083.5).floor();
    final y30 = (left / 10631).floor();
    left -= y30 * 10631;

    while (i < _daysIn30.length && left > _daysIn30[i]) {
      i++;
    }
    final year = y30 * 30 + i;
    if (i > 0) left -= _daysIn30[i - 1];

    i = 0;
    while (i < _daysInYear.length && left > _daysInYear[i]) {
      i++;
    }
    final month = i;
    final day = i > 0 ? left - _daysInYear[i - 1] : left;
    return HijriDate(year, month, day);
  }

  bool _isKabisa(int year) => _kabisaRem.contains(year % 30);

  /// Number of days in a Hijri month (0-based month).
  int daysInMonth(int year, int month) =>
      (month == 11 && _isKabisa(year)) || month % 2 == 0 ? 30 : 29;

  // ── Hijri → AJD → Gregorian ─────────────────────────────────────────

  double _hijriToAjd(int year, int month, int day) {
    final y30 = (year / 30).floor();
    double ajd = 1948083.5 + y30 * 10631;
    final doy = month == 0 ? day : _daysInYear[month - 1] + day;
    ajd += doy;
    if (year % 30 != 0) ajd += _daysIn30[year - y30 * 30 - 1];
    return ajd;
  }

  DateTime _ajdToGregorian(double ajd) {
    final z = (ajd + 0.5).floor();
    final f = ajd + 0.5 - z;
    int a;
    if (z < 2299161) {
      a = z;
    } else {
      final alpha = ((z - 1867216.25) / 36524.25).floor();
      a = z + 1 + alpha - (alpha / 4).floor();
    }
    final b = a + 1524;
    final c = ((b - 122.1) / 365.25).floor();
    final dd = (365.25 * c).floor();
    final e = ((b - dd) / 30.6001).floor();

    final day = (b - dd - (30.6001 * e).floor() + f).floor();
    // `month` here is 0-based (matching the JS Date constructor the original
    // used); the year cutoff also tests the 0-based value. Dart's DateTime is
    // 1-based, so add 1 only when constructing it.
    final month = e < 14 ? e - 2 : e - 14;
    final year = month < 2 ? c - 4715 : c - 4716;
    return DateTime(year, month + 1, day, 12);
  }

  // ── Public API ──────────────────────────────────────────────────────

  /// Convert a Gregorian [date] to Hijri, applying a day [offset] (−7…+7).
  HijriDate toHijri(DateTime date, {int offset = 0}) {
    final shifted =
        offset != 0 ? date.add(Duration(days: offset)) : date;
    return _ajdToHijri(_gregorianToAjd(shifted));
  }

  /// Parse an ISO 'YYYY-MM-DD' string at local noon, then convert.
  HijriDate toHijriIso(String iso, {int offset = 0}) =>
      toHijri(_isoNoon(iso), offset: offset);

  /// Convert WITHOUT the offset (back-fill of pre-offset transactions).
  HijriDate toHijriRaw(DateTime date) =>
      _ajdToHijri(_gregorianToAjd(date));

  DateTime toGregorian(int year, int month, int day) =>
      _ajdToGregorian(_hijriToAjd(year, month, day));

  String format(
    HijriDate h, {
    bool long = false,
    bool withYear = true,
    bool ah = false,
  }) {
    final names = long ? monthsLong : monthsShort;
    final suffix = withYear ? ' ${h.year}${ah ? ' AH' : 'H'}' : '';
    return '${h.day} ${names[h.month]}$suffix';
  }

  // ── Miqaat helpers ──────────────────────────────────────────────────

  List<Miqaat> miqaatsFor(HijriDate h) => miqaats['${h.month}-${h.day}'] ?? const [];

  List<Miqaat> miqaatsForGregorian(DateTime date, {int offset = 0}) =>
      miqaatsFor(toHijri(date, offset: offset));

  /// Highest-priority miqaat (lowest priority number wins).
  Miqaat? topMiqaat(List<Miqaat> list) {
    if (list.isEmpty) return null;
    final sorted = [...list]..sort((a, b) => a.priority - b.priority);
    return sorted.first;
  }

  static DateTime _isoNoon(String iso) {
    final p = iso.split('-');
    return DateTime(int.parse(p[0]), int.parse(p[1]), int.parse(p[2]), 12);
  }
}
