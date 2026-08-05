import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';
import 'add_category_dialog.dart';

class CategoriesScreen extends ConsumerWidget {
  const CategoriesScreen({super.key});

  static const _types = ['expense', 'income', 'transfer'];
  static const _labels = {
    'expense': 'Expense',
    'income': 'Income',
    'transfer': 'Transfer',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final tree = CategoryTree(cats);

    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => showAddCategoryDialog(context),
        child: const Icon(Icons.add),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Categories',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (cats.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child:
                    Center(child: Text('No categories yet. Tap + to add one.')),
              ),
            for (final type in _types)
              if (tree.roots(type).isNotEmpty) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(4, 12, 4, 4),
                  child: Text(_labels[type]!,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          color: Theme.of(context).hintColor)),
                ),
                Card(
                  child: Column(
                    children: [
                      for (final root in tree.roots(type)) ...[
                        ListTile(
                          onTap: () =>
                              showCategoryDialog(context, existing: root),
                          leading: IconPill(
                              iconName: root.icon,
                              colorHex: root.color,
                              size: 34),
                          title: Text(root.name),
                        ),
                        for (final child in tree.children(root.id))
                          ListTile(
                            onTap: () =>
                                showCategoryDialog(context, existing: child),
                            contentPadding:
                                const EdgeInsets.only(left: 48, right: 16),
                            dense: true,
                            leading: IconPill(
                                iconName: child.icon,
                                colorHex: child.color,
                                size: 26),
                            title: Text(child.name),
                          ),
                      ],
                    ],
                  ),
                ),
              ],
          ],
        ),
      ),
    );
  }
}
