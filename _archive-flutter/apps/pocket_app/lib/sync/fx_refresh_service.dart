import 'dart:convert';
import 'dart:developer' as developer;

import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';

/// Ports the legacy `ExchangeRateService`: pulls USD-based rates from
/// open.er-api.com (no API key) and upserts them into the global `fx_rates`
/// table, from which every device syncs them via PowerSync.
///
/// Refreshes at most every [maxAge] (legacy used 6 hours), based on the
/// newest `updated_at` already in the table — so a family of devices doesn't
/// hammer the API; whoever opens the app first refreshes for everyone.
class FxRefreshService {
  static const String endpoint = 'https://open.er-api.com/v6/latest/USD';

  final SupabaseClient client;
  final Duration maxAge;
  bool _ranThisSession = false;

  FxRefreshService(this.client, {this.maxAge = const Duration(hours: 6)});

  Future<void> refreshIfStale() async {
    if (_ranThisSession) return;
    _ranThisSession = true;
    try {
      final newest = await client
          .from('fx_rates')
          .select('updated_at')
          .order('updated_at', ascending: false)
          .limit(1);
      if (newest.isNotEmpty) {
        final ts = DateTime.tryParse('${newest.first['updated_at']}');
        if (ts != null && DateTime.now().toUtc().difference(ts) < maxAge) {
          return; // fresh enough
        }
      }

      final res = await http.get(Uri.parse(endpoint));
      if (res.statusCode != 200) {
        throw Exception('HTTP ${res.statusCode}');
      }
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      if (body['result'] != 'success' || body['rates'] is! Map) {
        throw Exception('unexpected payload');
      }
      final rates = (body['rates'] as Map).cast<String, num>();
      final rows = [
        for (final e in rates.entries)
          {'code': e.key, 'rate': e.value.toDouble()},
      ];
      await client.from('fx_rates').upsert(rows);
      developer.log('Refreshed ${rows.length} FX rates',
          name: 'FxRefreshService');
    } catch (e) {
      // Non-fatal: the app keeps using the last synced/seeded rates.
      developer.log('FX refresh skipped: $e', name: 'FxRefreshService');
    }
  }
}
