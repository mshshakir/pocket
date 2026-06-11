import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// App-wide theme mode (toggled from the UI). Defaults to system.
final themeModeProvider = StateProvider<ThemeMode>((ref) => ThemeMode.system);

/// Material 3 theming tuned to match the web app: clean surfaces, rounded
/// low-elevation cards, sky-blue accent.
class PocketTheme {
  static const seed = Color(0xFF0EA5E9);

  static ThemeData light() => ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        colorSchemeSeed: seed,
        scaffoldBackgroundColor: const Color(0xFFF6F7F9),
        cardTheme: _card(Colors.white, const Color(0x14000000)),
      );

  static ThemeData dark() => ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorSchemeSeed: seed,
        cardTheme: _card(const Color(0xFF161A20), const Color(0x1FFFFFFF)),
      );

  static CardThemeData _card(Color color, Color border) => CardThemeData(
        elevation: 0,
        color: color,
        margin: const EdgeInsets.symmetric(vertical: 6),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: border),
        ),
      );
}
