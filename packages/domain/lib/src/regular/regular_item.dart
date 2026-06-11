/// Regular purchases — named recurring purchases the user can quick-log
/// (e.g. "Morning coffee"). Each log creates a real transaction linked back
/// via `regularItemId`. Ported from legacy-web `RegularItemModal`.
library;

enum RegularFrequency { daily, weekly, monthly }

/// Icon names the legacy picker offers (lucide names, mapped to Material
/// icons in the UI layer).
const List<String> kRegularItemIcons = [
  'coffee', 'shopping-basket', 'bus', 'dumbbell', 'utensils', 'heart-pulse',
  'book', 'music', 'film', 'gift', 'paw-print', 'baby', 'graduation-cap',
  'wifi', 'phone', 'home', 'car', 'plane', 'tag',
];

/// Color palette the legacy picker offers (hex strings).
const List<String> kRegularItemColors = [
  '#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899',
  '#ef4444', '#f59e0b', '#06b6d4', '#84cc16', '#6366f1',
];

class RegularItem {
  final String id;
  final String name;

  /// Default amount in minor units of [currency]; 0 means "ask each time".
  final int defaultAmount;
  final String currency;
  final String? accountId;
  final String? categoryId;
  final String icon;
  final String color;
  final RegularFrequency frequency;

  const RegularItem({
    required this.id,
    required this.name,
    this.defaultAmount = 0,
    required this.currency,
    this.accountId,
    this.categoryId,
    this.icon = 'coffee',
    this.color = '#f97316',
    this.frequency = RegularFrequency.monthly,
  });

  RegularItem copyWith({
    String? name,
    int? defaultAmount,
    String? currency,
    String? accountId,
    String? categoryId,
    String? icon,
    String? color,
    RegularFrequency? frequency,
  }) =>
      RegularItem(
        id: id,
        name: name ?? this.name,
        defaultAmount: defaultAmount ?? this.defaultAmount,
        currency: currency ?? this.currency,
        accountId: accountId ?? this.accountId,
        categoryId: categoryId ?? this.categoryId,
        icon: icon ?? this.icon,
        color: color ?? this.color,
        frequency: frequency ?? this.frequency,
      );
}
