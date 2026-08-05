import 'package:flutter/foundation.dart';

/// Observable record of upload problems the [SupabaseConnector] had to skip.
///
/// When PostgREST rejects a row (bad type, constraint, RLS) the connector
/// logs-and-skips so one bad row can't jam the upload queue forever — but that
/// row then diverges from the server with no UI signal. This counter makes
/// that visible (see the sync-status tile / audit B3 + C6).
class SyncIssues extends ChangeNotifier {
  int _skippedCount = 0;
  String? _lastError;

  int get skippedCount => _skippedCount;
  String? get lastError => _lastError;
  bool get hasIssues => _skippedCount > 0;

  void recordSkip(String message) {
    _skippedCount++;
    _lastError = message;
    notifyListeners();
  }

  void reset() {
    if (_skippedCount == 0 && _lastError == null) return;
    _skippedCount = 0;
    _lastError = null;
    notifyListeners();
  }
}
