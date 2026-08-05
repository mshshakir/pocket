import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

/// Loads the Mumineen-calendar miqaat table (bundled asset, ported from
/// legacy `source/data/miqaats.json`) into the shape [HijriCalendar] expects:
/// `'$month-$day'` (0-based Hijri month) → list of [Miqaat].
/// Year-specific entries (`year != null`) are skipped — the domain key has
/// no year dimension (legacy showed them only for the matching year).
final miqaatsProvider = FutureProvider<Map<String, List<Miqaat>>>((ref) async {
  final raw = await rootBundle.loadString('assets/miqaats.json');
  final list = jsonDecode(raw) as List;
  final out = <String, List<Miqaat>>{};
  for (final entry in list) {
    final m = entry as Map<String, dynamic>;
    final key = '${m['month']}-${m['date']}';
    for (final item in (m['miqaats'] as List? ?? const [])) {
      final mq = item as Map<String, dynamic>;
      if (mq['year'] != null) continue;
      final title = mq['title'] as String? ?? '';
      if (title.isEmpty) continue;
      out
          .putIfAbsent(key, () => [])
          .add(Miqaat(title, (mq['priority'] as num?)?.toInt() ?? 3));
    }
  }
  return out;
});

/// The app-wide Hijri calendar, miqaat-aware once the asset loads.
final hijriCalendarProvider = Provider<HijriCalendar>((ref) =>
    HijriCalendar(miqaats: ref.watch(miqaatsProvider).valueOrNull ?? const {}));
