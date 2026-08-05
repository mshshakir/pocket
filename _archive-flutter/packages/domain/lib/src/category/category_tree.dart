/// Category hierarchy queries — the pure part of the JS `CategoryService`.
/// CRUD (create/update/delete) belongs in the data layer; these are the
/// side-effect-free tree helpers the budget logic depends on.

class CategoryNode {
  final String id;
  final String name;
  final String? parentId;
  final String type; // expense|income|transfer
  final String? color;
  final String? icon;

  const CategoryNode({
    required this.id,
    required this.name,
    this.parentId,
    this.type = 'expense',
    this.color,
    this.icon,
  });
}

class CategoryTree {
  final List<CategoryNode> categories;
  late final Map<String, CategoryNode> _byId = {
    for (final c in categories) c.id: c,
  };

  CategoryTree(this.categories);

  CategoryNode? find(String id) => _byId[id];

  /// Full hierarchical name, e.g. "Food & Drink / Dining out".
  String fullName(String id) {
    final c = _byId[id];
    if (c == null) return '';
    final parentId = c.parentId;
    if (parentId != null) {
      final p = _byId[parentId];
      if (p != null) return '${p.name} / ${c.name}';
    }
    return c.name;
  }

  /// `catId` plus its FULL subtree (children, grandchildren, …), cycle-safe.
  /// Budgets rely on this being the transitive closure so spend in a nested
  /// category still rolls up to an ancestor budget.
  List<String> descendants(String catId) {
    final childrenOf = <String?, List<String>>{};
    for (final c in categories) {
      (childrenOf[c.parentId] ??= []).add(c.id);
    }
    final out = <String>[];
    final seen = <String>{};
    final stack = <String>[catId];
    while (stack.isNotEmpty) {
      final id = stack.removeLast();
      if (!seen.add(id)) continue; // cycle guard
      out.add(id);
      for (final childId in (childrenOf[id] ?? const [])) {
        stack.add(childId);
      }
    }
    return out;
  }

  /// Root categories (no parent), optionally filtered by [type].
  List<CategoryNode> roots([String? type]) => categories
      .where((c) => c.parentId == null && (type == null || c.type == type))
      .toList();

  List<CategoryNode> children(String parentId) =>
      categories.where((c) => c.parentId == parentId).toList();
}
