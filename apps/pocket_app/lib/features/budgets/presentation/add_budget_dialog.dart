import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../dashboard/application/dashboard_providers.dart';

Future<void> showAddBudgetDialog(BuildContext context) =>
    showBudgetDialog(context);

Future<void> showBudgetDialog(BuildContext context, {Budget? existing}) =>
    showDialog<void>(
        context: context, builder: (_) => BudgetDialog(existing: existing));

/// Add / edit a budget: limit, Gregorian/Hijri period, rollover, target
/// categories. Editing also offers Delete.
class BudgetDialog extends ConsumerStatefulWidget {
  final Budget? existing;
  const BudgetDialog({super.key, this.existing});

  @override
  ConsumerState<BudgetDialog> createState() => _BudgetDialogState();
}

class _BudgetDialogState extends ConsumerState<BudgetDialog> {
  final _amount = TextEditingController();
  String? _currency;
  BudgetPeriod _period = BudgetPeriod.gregorian;
  bool _rollover = false;
  final _selected = <String>{};
  bool _busy = false;

  Budget? get _editing => widget.existing;

  @override
  void initState() {
    super.initState();
    final b = _editing;
    if (b != null) {
      _currency = b.currency;
      _period = b.period;
      _rollover = b.rollover;
      _selected.addAll(b.categoryIds);
      final fx = CurrencyService(const {});
      _amount.text = fx
          .fromMinor(b.amount, b.currency)
          .toStringAsFixed(fx.minorDigits(b.currency));
    }
  }

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final amount = double.tryParse(_amount.text);
    final currency = _currency;
    if (amount == null || amount <= 0 || _selected.isEmpty || currency == null) {
      return;
    }
    setState(() => _busy = true);
    final fx = ref.read(fxProvider);
    final budget = Budget(
      id: _editing?.id ?? const Uuid().v4(),
      categoryIds: _selected.toList(),
      amount: fx.toMinor(amount, currency),
      currency: currency,
      period: _period,
      rollover: _rollover,
    );
    await ref.read(budgetRepositoryProvider).upsert(budget);
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete budget?'),
        content: const Text('Transactions are not affected.'),
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
    await ref.read(budgetRepositoryProvider).remove(_editing!.id);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final cats = (ref.watch(categoriesProvider).valueOrNull ?? const [])
        .where((c) => c.type == 'expense')
        .toList();
    _currency ??= ref.read(homeCurrencyProvider);

    return AlertDialog(
      title: Text(_editing != null ? 'Edit budget' : 'Add budget'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _amount,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: 'Limit ($_currency)'),
            ),
            const SizedBox(height: 12),
            SegmentedButton<BudgetPeriod>(
              segments: const [
                ButtonSegment(
                    value: BudgetPeriod.gregorian, label: Text('Monthly')),
                ButtonSegment(value: BudgetPeriod.hijri, label: Text('Hijri')),
              ],
              selected: {_period},
              onSelectionChanged: (s) => setState(() => _period = s.first),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Roll over unspent'),
              value: _rollover,
              onChanged: (v) => setState(() => _rollover = v),
            ),
            const SizedBox(height: 8),
            const Text('Categories'),
            const SizedBox(height: 6),
            if (cats.isEmpty)
              const Text('Add expense categories first.')
            else
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final c in cats)
                    FilterChip(
                      label: Text(c.name),
                      selected: _selected.contains(c.id),
                      onSelected: (on) => setState(() =>
                          on ? _selected.add(c.id) : _selected.remove(c.id)),
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
        FilledButton(onPressed: _busy ? null : _save, child: const Text('Save')),
      ],
    );
  }
}
