/// User preferences — mirrors the legacy Settings modal and the `profiles`
/// table (one row per user).
library;

class UserSettings {
  final String homeCurrency;
  final String defaultCurrency;

  /// 'light' | 'dark' | 'system'
  final String theme;
  final bool showHijri;

  /// 'gregorian' | 'both' | 'hijri'
  final String calendarMode;

  /// 'auto' | 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY'
  final String dateFormat;

  /// Local moon-sighting correction in days, clamped to −7…+7.
  final int hijriOffset;

  const UserSettings({
    this.homeCurrency = 'INR',
    this.defaultCurrency = 'INR',
    this.theme = 'system',
    this.showHijri = true,
    this.calendarMode = 'both',
    this.dateFormat = 'auto',
    this.hijriOffset = 0,
  });

  static const int minHijriOffset = -7;
  static const int maxHijriOffset = 7;

  UserSettings copyWith({
    String? homeCurrency,
    String? defaultCurrency,
    String? theme,
    bool? showHijri,
    String? calendarMode,
    String? dateFormat,
    int? hijriOffset,
  }) {
    final off = hijriOffset ?? this.hijriOffset;
    return UserSettings(
      homeCurrency: homeCurrency ?? this.homeCurrency,
      defaultCurrency: defaultCurrency ?? this.defaultCurrency,
      theme: theme ?? this.theme,
      showHijri: showHijri ?? this.showHijri,
      calendarMode: calendarMode ?? this.calendarMode,
      dateFormat: dateFormat ?? this.dateFormat,
      hijriOffset: off < minHijriOffset
          ? minHijriOffset
          : (off > maxHijriOffset ? maxHijriOffset : off),
    );
  }
}
