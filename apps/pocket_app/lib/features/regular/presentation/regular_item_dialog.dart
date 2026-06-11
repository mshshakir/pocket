import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/regular_item_controller.dart';

Future<void> showRegularItemDialog(BuildContext context,
        {RegularItem? existing}) =>
    showDialog<void>(
        context: context,
        builder: (_) => RegularItemDialog(existing: existing));

/// New / edit regular item — mirrors legacy `RegularItemModal`: name, default
/// amount + currency, account, expense category, frequency, icon and color
/// pickers, delete.
class RegularItemDialog extends ConsumerStatefulWidget {
  final RegularItem? existing;
  const RegularItemDialog({super.key, this.existing});

  @override
  ConsumerState<RegularItemDialog> createState() => _RegularItemDialogState();
}

class _RegularItemDialogState extends ConsumerState<RegularItemDialog> {
  final _name = TextEditingController();
  final _amount = TextEditingController();
  String? _currency;
  String? _accountId;
  String? _categoryId;
  String _icon = kRegularItemIcons.first;
  String _color = kRegularItemColors.first;
  RegularFrequency _frequency = RegularFrequency.monthly;
  bool _busy = false;

  RegularItem? get _editing => widget.existing;

  @override
  void initState() {
    super.initState();
    final e = _editing;
    if (e != null) {
      _name.text = e.name;
      _currency = e.currency;
      _accountId = e.accountId;
      _categoryId = e.categoryId;
      _icon = e.icon;
      _color = e.color;
      _frequency = e.frequency;
      if (e.defaultAmount > 0) {
        final fx = CurrencyService(const {});
        _amount.text = fx
            .fromMinor(e.defaultAmount, e.currency)
            .toStringAsFixed(fx.minorDigits(e.currency));
      }
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final currency = _currency;
    if (name.isEmpty || currency == null) return;
    setState(() => _busy = true);
    final fx = ref.read(fxProvider);
    final controller = ref.read(regularItemControllerProvider);
    final amount = double.tryParse(_amount.text) ?? 0;
    final item = RegularItem(
      id: _editing?.id ?? controller.newId(),
      name: name,
      defaultAmount: amount > 0 ? fx.toMinor(amount, currency) : 0,
      currency: currency,
      accountId: _accountId,
      categoryId: _categoryId,
      icon: _icon,
      color: _color,
      frequency: _frequency,
    );
    await controller.save(item);
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete item?'),
        content: const Text(
            'Past logged transactions are kept; only the quick-log item is removed.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(c).pop(true),
              child: const Text('Delete')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _busy = true);
    await ref.read(regularItemControllerProvider).delete(_editing!.id);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final currencies = ref.read(fxProvider).rates.keys.toList()..sort();
    _currency ??= ref.read(defaultCurrencyProvider);
    final expenseCats = [for (final c in cats) if (c.type != 'income') c];

    return AlertDialog(
      title: Text(_editing != null ? 'Edit item' : 'New regular item'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _name,
              autofocus: _editing == null,
              decoration: const InputDecoration(
                  labelText: 'Name', hintText: 'e.g. Morning coffee'),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _amount,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(
                        labelText: 'Default amount', hintText: '0.00'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: DropdownButtonFormField<String>(
                    initialValue:
                        currencies.contains(_currency) ? _currency : null,
                    decoration: const InputDecoration(labelText: 'Currency'),
                    items: [
                      for (final c in currencies)
                        DropdownMenuItem(value: c, child: Text(c)),
                    ],
                    onChanged: (v) => setState(() => _currency = v),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue: _accountId,
              decoration: const InputDecoration(labelText: 'Default account'),
              items: [
                const DropdownMenuItem(value: null, child: Text('— None —')),
                for (final a in accounts)
                  DropdownMenuItem(value: a.id, child: Text(a.name)),
              ],
              onChanged: (v) => setState(() => _accountId = v),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue: _categoryId,
              decoration: const InputDecoration(labelText: 'Default category'),
              items: [
                const DropdownMenuItem(
                    value: null, child: Text('— Uncategorised —')),
                for (final c in expenseCats)
                  DropdownMenuItem(value: c.id, child: Text(c.name)),
              ],
              onChanged: (v) => setState(() => _categoryId = v),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<RegularFrequency>(
              initialValue: _frequency,
              decoration: const InputDecoration(labelText: 'Frequency'),
              items: const [
                DropdownMenuItem(
                    value: RegularFrequency.daily, child: Text('Daily')),
                DropdownMenuItem(
                    value: RegularFrequency.weekly, child: Text('Weekly')),
                DropdownMenuItem(
                    value: RegularFrequency.monthly, child: Text('Monthly')),
              ],
              onChanged: (v) =>
                  setState(() => _frequency = v ?? RegularFrequency.monthly),
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
                for (final name in kRegularItemIcons)
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
                            ? Theme.of(context)
                                .colorScheme
                                .primary
                                .withValues(alpha: 0.08)
                            : null,
                      ),
                      child: Icon(PocketIcons.of(name), size: 17),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 16),
            Text('Color',
                style: TextStyle(
                    fontSize: 12, color: Theme.of(context).hintColor)),
            const SizedBox(height: 6),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final hex in kRegularItemColors)
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
        if (_editing != null)
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
        FilledButton(
          onPressed: _busy ? null : _save,
          child: const Text('Save'),
        ),
      ],
    );
  }
}
