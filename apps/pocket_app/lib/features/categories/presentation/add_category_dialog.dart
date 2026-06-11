import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';

Future<void> showAddCategoryDialog(BuildContext context) =>
    showCategoryDialog(context);

Future<void> showCategoryDialog(BuildContext context,
        {CategoryNode? existing}) =>
    showDialog<void>(
        context: context, builder: (_) => CategoryDialog(existing: existing));

/// Add / edit a category. Deleting reparents its children to top level;
/// transactions that pointed at it simply become uncategorised.
class CategoryDialog extends ConsumerStatefulWidget {
  final CategoryNode? existing;
  const CategoryDialog({super.key, this.existing});

  @override
  ConsumerState<CategoryDialog> createState() => _CategoryDialogState();
}

class _CategoryDialogState extends ConsumerState<CategoryDialog> {
  final _name = TextEditingController();
  String _type = 'expense';
  String? _parentId;
  String _icon = 'tag';
  String _color = '#3b82f6'; // legacy default
  bool _busy = false;

  CategoryNode? get _editing => widget.existing;

  @override
  void initState() {
    super.initState();
    final c = _editing;
    if (c != null) {
      _name.text = c.name;
      _type = c.type;
      _parentId = c.parentId;
      _icon = c.icon ?? 'tag';
      _color = c.color ?? '#3b82f6';
    }
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    if (name.isEmpty) return;
    setState(() => _busy = true);
    final category = CategoryNode(
      id: _editing?.id ?? const Uuid().v4(),
      name: name,
      type: _type,
      parentId: _parentId,
      color: _color,
      icon: _icon,
    );
    await ref.read(categoryRepositoryProvider).upsert(category);
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _delete() async {
    final c = _editing!;
    final cats = ref.read(categoriesProvider).valueOrNull ?? const [];
    final children = [for (final x in cats) if (x.parentId == c.id) x];
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Delete category?'),
        content: Text(children.isEmpty
            ? 'Transactions in "${c.name}" become uncategorised.'
            : '${children.length} subcategor${children.length == 1 ? 'y' : 'ies'} '
                'move to top level; transactions in "${c.name}" become uncategorised.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(d).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(d).pop(true),
              child: const Text('Delete')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    final repo = ref.read(categoryRepositoryProvider);
    for (final child in children) {
      await repo.upsert(CategoryNode(
        id: child.id,
        name: child.name,
        type: child.type,
        parentId: null,
        color: child.color,
        icon: child.icon,
      ));
    }
    await repo.remove(c.id);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final editing = _editing;
    final parents = cats
        .where((c) =>
            c.parentId == null && c.type == _type && c.id != editing?.id)
        .toList();

    return AlertDialog(
      title: Text(editing != null ? 'Edit category' : 'Add category'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _name,
              autofocus: editing == null,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'expense', label: Text('Expense')),
                ButtonSegment(value: 'income', label: Text('Income')),
              ],
              selected: {_type},
              onSelectionChanged: editing != null
                  ? null // type frozen on edit (budgets/reports depend on it)
                  : (s) => setState(() {
                        _type = s.first;
                        _parentId = null; // parent list depends on type
                      }),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue: _parentId,
              decoration: const InputDecoration(labelText: 'Parent (optional)'),
              items: [
                const DropdownMenuItem(
                    value: null, child: Text('— Top level —')),
                for (final c in parents)
                  DropdownMenuItem(value: c.id, child: Text(c.name)),
              ],
              onChanged: (v) => setState(() => _parentId = v),
            ),
            const SizedBox(height: 16),
            Text('Icon',
                style: TextStyle(
                    fontSize: 12, color: Theme.of(context).hintColor)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final name in kCategoryIcons)
                  InkWell(
                    borderRadius: BorderRadius.circular(10),
                    onTap: () => setState(() => _icon = name),
                    child: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          width: 2,
                          color: _icon == name
                              ? Theme.of(context).colorScheme.primary
                              : Colors.transparent,
                        ),
                        color: _icon == name
                            ? colorFromHex(_color).withValues(alpha: 0.13)
                            : null,
                      ),
                      child: Icon(PocketIcons.of(name),
                          size: 17,
                          color: _icon == name ? colorFromHex(_color) : null),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            Text('Colour',
                style: TextStyle(
                    fontSize: 12, color: Theme.of(context).hintColor)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final hex in kPocketColors)
                  InkWell(
                    borderRadius: BorderRadius.circular(99),
                    onTap: () => setState(() => _color = hex),
                    child: Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: colorFromHex(hex),
                        border: Border.all(
                          width: 2,
                          color: _color == hex
                              ? Theme.of(context).colorScheme.onSurface
                              : Colors.transparent,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
      actions: [
        if (editing != null)
          TextButton(
            onPressed: _busy ? null : _delete,
            style:
                TextButton.styleFrom(foregroundColor: const Color(0xFFEF4444)),
            child: const Text('Delete'),
          ),
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(onPressed: _busy ? null : _save, child: const Text('Save')),
      ],
    );
  }
}
