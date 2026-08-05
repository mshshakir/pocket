import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

/// One default category template (icon/colour use the same lucide names the
/// pickers and legacy app store, so both apps read identical data).
class SeedCategory {
  final String name;
  final String type; // 'expense' | 'income'
  final String icon;
  final String color;
  const SeedCategory(this.name, this.type, this.icon, this.color);
}

/// First-run seed data — the Dart port of legacy `seed.js` categories. Pure and
/// side-effect free: it only builds value objects, the controller persists them.
class OnboardingService {
  final Uuid _uuid;
  OnboardingService({Uuid uuid = const Uuid()}) : _uuid = uuid;

  /// Default expense + income categories offered to a brand-new user.
  static const List<SeedCategory> defaults = [
    // Expenses
    SeedCategory('Food & Drink', 'expense', 'utensils', '#f97316'),
    SeedCategory('Transport', 'expense', 'car', '#3b82f6'),
    SeedCategory('Shopping', 'expense', 'shopping-bag', '#ec4899'),
    SeedCategory('Health', 'expense', 'heart-pulse', '#ef4444'),
    SeedCategory('Housing', 'expense', 'home', '#10b981'),
    SeedCategory('Entertainment', 'expense', 'film', '#8b5cf6'),
    SeedCategory('Bills & Utilities', 'expense', 'receipt', '#f59e0b'),
    SeedCategory('Education', 'expense', 'graduation-cap', '#06b6d4'),
    SeedCategory('Travel', 'expense', 'plane', '#0ea5e9'),
    SeedCategory('Other', 'expense', 'tag', '#71717a'),
    // Income
    SeedCategory('Salary', 'income', 'banknote', '#10b981'),
    SeedCategory('Business', 'income', 'briefcase', '#6366f1'),
    SeedCategory('Gifts', 'income', 'gift', '#ec4899'),
    SeedCategory('Other Income', 'income', 'landmark', '#84cc16'),
  ];

  /// Materialises the defaults into [CategoryNode]s with fresh ids.
  List<CategoryNode> seedCategories() => [
        for (final s in defaults)
          CategoryNode(
            id: _uuid.v4(),
            name: s.name,
            type: s.type,
            icon: s.icon,
            color: s.color,
          ),
      ];
}
