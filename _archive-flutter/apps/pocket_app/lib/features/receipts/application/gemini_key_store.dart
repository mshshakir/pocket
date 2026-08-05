import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The Gemini API key stays DEVICE-LOCAL (shared_preferences = localStorage
/// on web), exactly like the legacy app — it is never written to the synced
/// profile, so the secret never leaves the user's browser/device.
class GeminiKeyStore {
  static const _prefKey = 'gemini_api_key';
  final SharedPreferences _prefs;

  GeminiKeyStore(this._prefs);

  String get key => _prefs.getString(_prefKey) ?? '';
  bool get hasKey => key.trim().isNotEmpty;

  Future<void> save(String value) => _prefs.setString(_prefKey, value.trim());
}

final geminiKeyStoreProvider = FutureProvider<GeminiKeyStore>(
    (ref) async => GeminiKeyStore(await SharedPreferences.getInstance()));
