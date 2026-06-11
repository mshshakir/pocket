import 'package:intl/intl.dart';

/// Renders dates according to the user's Settings → Date format preference
/// ('auto' = system locale). Pure; construct with the preference string.
class DateFormatService {
  final String preference;

  const DateFormatService([this.preference = 'auto']);

  String format(DateTime date) => switch (preference) {
        'YYYY-MM-DD' => DateFormat('yyyy-MM-dd').format(date),
        'MM/DD/YYYY' => DateFormat('MM/dd/yyyy').format(date),
        'DD/MM/YYYY' => DateFormat('dd/MM/yyyy').format(date),
        _ => DateFormat.yMd().format(date),
      };

  /// Long form for headers (e.g. "Thursday, June 11, 2026") — locale-driven,
  /// independent of the short-format preference.
  String formatLong(DateTime date) => DateFormat('EEEE, MMMM d, y').format(date);
}
