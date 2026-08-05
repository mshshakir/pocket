import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';
import 'package:uuid/uuid.dart';

import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/account_group_controller.dart';
import 'reconcile_dialog.dart';

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
  String _icon = 'wallet';
  String _color = '#0ea5e9';
  String? _groupId;
  bool _archived = false;
  bool _busy = false;

  static const _newGroupSentinel = '__new_group__';

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
      _icon = a.icon ?? 'wallet';
      _color = a.color ?? '#0ea5e9';
      _groupId = a.groupId;
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

  Future<void> _createGroup() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('New group'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
              labelText: 'Group name', hintText: 'e.g. Cash, Savings'),
          onSubmitted: (v) => Navigator.of(c).pop(v),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(c).pop(controller.text),
              child: const Text('Create')),
        ],
      ),
    );
    controller.dispose();
    if (name == null || name.trim().isEmpty) return;
    final group =
        await ref.read(accountGroupControllerProvider).create(name.trim());
    if (mounted) setState(() => _groupId = group.id);
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
      color: _color,
      icon: _icon,
      archived: _archived,
      groupId: _groupId,
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
    final groups =
        ref.watch(accountGroupsProvider).valueOrNull ?? const <AccountGroup>[];

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
            const SizedBox(height: 12),
            DropdownButtonFormField<String?>(
              initialValue:
                  groups.any((g) => g.id == _groupId) ? _groupId : null,
              decoration: const InputDecoration(labelText: 'Group (optional)'),
              items: [
                const DropdownMenuItem(value: null, child: Text('— None —')),
                for (final g in groups)
                  DropdownMenuItem(value: g.id, child: Text(g.name)),
                const DropdownMenuItem(
                    value: _newGroupSentinel, child: Text('New group…')),
              ],
              onChanged: (v) {
                if (v == _newGroupSentinel) {
                  _createGroup();
                } else {
                  setState(() => _groupId = v);
                }
              },
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
                for (final name in kAccountIcons)
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
            if (editing != null) ...[
              const SizedBox(height: 8),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Archived'),
                subtitle: const Text(
                    'Hidden from pickers and totals; history is kept'),
                value: _archived,
                onChanged: (v) => setState(() => _archived = v ?? false),
              ),
              const SizedBox(height: 4),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.balance, size: 16),
                  label: const Text('Reconcile balance…'),
                  // Opens on top of this dialog (popping first would orphan
                  // the context before showDialog runs).
                  onPressed:
                      _busy ? null : () => showReconcileDialog(context, editing),
                ),
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
