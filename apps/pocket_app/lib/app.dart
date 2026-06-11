import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/router.dart';
import 'core/theme.dart';
import 'features/settings/application/settings_controller.dart';

/// Root widget. Wires routing + theming; state/DI is provided by the
/// ProviderScope in main.dart.
class PocketApp extends ConsumerWidget {
  const PocketApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'Pocket Budget',
      debugShowCheckedModeBanner: false,
      theme: PocketTheme.light(),
      darkTheme: PocketTheme.dark(),
      themeMode: ref.watch(themeModeFromSettingsProvider),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
