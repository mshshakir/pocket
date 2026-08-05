import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shorebird_code_push/shorebird_code_push.dart';

/// Thin OOP wrapper over Shorebird's over-the-air code push. In a normal debug
/// build (or any non-Shorebird build) [isAvailable] is false and every call is
/// a safe no-op, so this can be wired unconditionally.
///
/// Flow: [isOutdated] checks the server for a newer Dart patch; [downloadUpdate]
/// fetches it. The patch is applied the next time the app launches.
class UpdateService {
  final ShorebirdUpdater _updater;

  UpdateService([ShorebirdUpdater? updater])
      : _updater = updater ?? ShorebirdUpdater();

  /// True only in a Shorebird-built release where code push is active.
  bool get isAvailable => _updater.isAvailable;

  /// Whether a newer patch is available on the server. Makes a network call,
  /// so never gate app startup on it — call it after first frame.
  Future<bool> isOutdated() async {
    if (!isAvailable) return false;
    try {
      final status = await _updater.checkForUpdate();
      return status == UpdateStatus.outdated;
    } catch (_) {
      return false; // offline / transient — try again next launch
    }
  }

  /// Downloads the latest patch; it takes effect on the next app launch.
  /// Throws [UpdateException] on failure (surface it to the user).
  Future<void> downloadUpdate() => _updater.update();
}

final updateServiceProvider = Provider<UpdateService>((ref) => UpdateService());
