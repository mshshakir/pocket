import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../dashboard/application/dashboard_providers.dart';

/// Opens the "Add account" dialog.
Future<void> showAddAccountDialog(BuildContext context) =>
    showAccountDialog(context);

Future<void> showAccountDialog(BuildContext context,
        {LedgerAccount? existing}) =>
    showDialog<void>(
        context: context, builder: (_) => AccountDialog(existing: existing));

/// Add / edit an account. On edit the currency is frozen (changing it would
/// re-denominate history); archive hides it from pickers, delete is allowed
/// only when no transactions reference it.
class AccountDialog extends ConsumerStatefulWidget {
  final LedgerAccount? existing;
  const AccountDialog({super.key, this.existing});

  @override
  ConsumerState<AccountDialog> createState() => _AccountDialogState();
}

class _AccountDialogState extends ConsumerState<AccountDialog> {
  final _name = TextEditingController();
  final _opening = TextEditingController(text: '0');
  String? _currency;
  String _type = 'bank';
  bool _archived = false;
  bool _busy = false;

  LedgerAccount? get _editing => widget.existing;

  static const _types = {
    'bank': 'Bank',
    'cash': 'Cash',
    'card': 'Card',
    'savings': 'Savings',
    'invest': 'Investment',
  };

  @override
  void initState() {
    super.initState();
    final a = _editing;
    if (a != null) {
      _name.text = a.name;
      _currency = a.currency;
      _type = _types.containsKey(a.type) ? a.type : 'bank';
      _archived = a.archived;
      final fx = CurrencyService(const {});
      _opening.text = fx
          .fromMinor(a.openingBalance, a.currency)
          .toStringAsFixed(fx.minorDigits(a.currency));
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _opening.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _name.text.trim();
    final currency = _currency;
    if (name.isEmpty || currency == null) return;
    setState(() => _busy = true);
    final fx = ref.read(fxProvider);
    final account = LedgerAccount(
      id: _editing?.id ?? const Uuid().v4(),
      name: name,
      type: _type,
      currency: currency,
      openingBalance:
          fx.toMinor(double.tryParse(_opening.text) ?? 0, currency),
      color: _editing?.color,
      icon: _editing?.icon,
      archived: _archived,
      groupId: _editing?.groupId,
    );
    await ref.read(accountRepositoryProvider).upsert(account);
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _delete() async {
    final a = _editing!;
    final txs = ref.read(transactionsProvider).valueOrNull ?? const [];
    final used = txs.any((t) =>
        t.accountId == a.id ||
        (t.splits?.any((s) => s.accountId == a.id) ?? false));
    if (used) {
      // Legacy refuses to delete accounts with history — archive instead.
      await showDialog<void>(
        context: context,
        builder: (c) => AlertDialog(
          title: const Text('Account has transactions'),
          content: const Text(
              'This account still has transactions. Archive it instead, or '
              'delete its transactions first.'),
          actions: [
            FilledButton(
                onPressed: () => Navigator.of(c).pop(),
                child: const Text('OK')),
          ],
        ),
      );
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete account?'),
        content: Text('Delete "${a.name}"? This cannot be undone.'),
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
    await ref.read(accountRepositoryProvider).remove(a.id);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final currencies = ref.read(fxProvider).rates.keys.toList()..sort();
    _currency ??= ref.read(defaultCurrencyProvider);
    final editing = _editing;

    return AlertDialog(
      title: Text(editing != null ? 'Edit account' : 'Add account'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _name,
              autofocus: editing == null,
              decoration: const InputDecoration(labelText: 'Name'),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _type,
              decoration: const InputDecoration(labelText: 'Type'),
              items: [
                for (final e in _types.entries)
                  DropdownMenuItem(value: e.key, child: Text(e.value)),
              ],
              onChanged: (v) => setState(() => _type = v ?? _type),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: currencies.contains(_currency) ? _currency : null,
              decoration: const InputDecoration(labelText: 'Currency'),
              items: [
                for (final c in currencies)
                  DropdownMenuItem(value: c, child: Text(c)),
              ],
              onChanged: editing != null
                  ? null // frozen on edit
                  : (v) => setState(() => _currency = v ?? _currency),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _opening,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Opening balance'),
            ),
            if (editing != null) ...[
              const SizedBox(height: 8),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Archived'),
                subtitle: const Text(
                    'Hidden from pickers and balances; history is kept'),
                value: _archived,
                onChanged: (v) => setState(() => _archived = v ?? false),
              ),
            ],
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
        FilledButton(
          onPressed: _busy ? null : _save,
          child: const Text('Save'),
        ),
      ],
    );
  }
}
