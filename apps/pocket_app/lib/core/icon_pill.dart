import 'package:flutter/material.dart';

/// Single lucide-name → Material icon mapping shared by categories, regular
/// items and transaction rows (the legacy app stores lucide icon names; we
/// keep storing the same names so both apps read the same data).
abstract final class PocketIcons {
  static const Map<String, IconData> byName = {
    // category set (legacy CategoryModal ICONS)
    'tag': Icons.sell_outlined,
    'utensils': Icons.restaurant_outlined,
    'car': Icons.directions_car_outlined,
    'shopping-bag': Icons.shopping_bag_outlined,
    'heart-pulse': Icons.monitor_heart_outlined,
    'home': Icons.home_outlined,
    'film': Icons.movie_outlined,
    'receipt': Icons.receipt_long_outlined,
    'graduation-cap': Icons.school_outlined,
    'banknote': Icons.payments_outlined,
    'briefcase': Icons.work_outline,
    'landmark': Icons.account_balance_outlined,
    'plane': Icons.flight_outlined,
    'dumbbell': Icons.fitness_center,
    'gift': Icons.card_giftcard_outlined,
    'baby': Icons.child_friendly_outlined,
    'paw-print': Icons.pets_outlined,
    'wifi': Icons.wifi,
    // regular-item extras (legacy RegularItemModal ITEM_ICONS)
    'coffee': Icons.coffee_outlined,
    'shopping-basket': Icons.shopping_basket_outlined,
    'bus': Icons.directions_bus_outlined,
    'book': Icons.menu_book_outlined,
    'music': Icons.music_note_outlined,
    'phone': Icons.phone_outlined,
    // misc used by rows
    'arrow-left-right': Icons.swap_horiz,
    'wallet': Icons.account_balance_wallet_outlined,
    'hand-coins': Icons.handshake_outlined,
  };

  static IconData of(String? name, {IconData fallback = Icons.sell_outlined}) =>
      byName[name ?? ''] ?? fallback;
}

/// Icon names offered by the category picker — legacy `CategoryModal.ICONS`.
const List<String> kCategoryIcons = [
  'tag', 'utensils', 'car', 'shopping-bag', 'heart-pulse', 'home', 'film',
  'receipt', 'graduation-cap', 'banknote', 'briefcase', 'landmark', 'plane',
  'dumbbell', 'gift', 'baby', 'paw-print', 'wifi',
];

/// Color palette for category/account pickers (superset of the legacy
/// regular-item palette; legacy categories used a free color input).
const List<String> kPocketColors = [
  '#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899',
  '#ef4444', '#f59e0b', '#06b6d4', '#84cc16', '#6366f1',
  '#0ea5e9', '#71717a',
];

/// Parses '#rrggbb'; falls back to the app accent on bad input.
Color colorFromHex(String? hex) {
  if (hex == null) return const Color(0xFF0EA5E9);
  final cleaned = hex.replaceFirst('#', '');
  final value = int.tryParse(cleaned, radix: 16);
  if (value == null || cleaned.length != 6) return const Color(0xFF0EA5E9);
  return Color(0xFF000000 | value);
}

/// The legacy "icon pill": a rounded square tinted with the entity's color
/// at low alpha, icon in the full color.
class IconPill extends StatelessWidget {
  final String? iconName;
  final String? colorHex;
  final double size;
  final IconData fallbackIcon;

  const IconPill({
    super.key,
    required this.iconName,
    required this.colorHex,
    this.size = 38,
    this.fallbackIcon = Icons.sell_outlined,
  });

  @override
  Widget build(BuildContext context) {
    final color = colorFromHex(colorHex);
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(size * 0.32),
      ),
      child: Icon(PocketIcons.of(iconName, fallback: fallbackIcon),
          size: size * 0.48, color: color),
    );
  }
}
