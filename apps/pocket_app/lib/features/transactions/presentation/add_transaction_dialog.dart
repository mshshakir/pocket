import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../dashboard/application/dashboard_providers.dart';
import '../application/transaction_controller.dart';

Future<void> showAddTransactionDialog(BuildContext context) =>
    showTransactionDialog(context);

Future<void> showTransactionDialog(BuildContext context,
        {LedgerTransaction? existing}) =>
    showDialog<void>(
        context: context,
        builder: (_) => TransactionDialog(existing: existing));

/// Add / edit a transaction. Expense, income and two-leg transfers; editing
/// shows a Delete action (deleting one transfer leg removes both).
class TransactionDialog extends ConsumerStatefulWidget {
  final LedgerTransaction? existing;
  const TransactionDialog({super.key, this.existing});

  @override
  ConsumerState<TransactionDialog> createState() => _TransactionDialogState();
}

class _TransactionDialogState extends ConsumerState<TransactionDialog> {
  final _amount = TextEditingController();
  final _payee = TextEditingController();
  final _note = TextEditingController();
  TxType _type = TxType.expense;
  String? _accountId;
  String? _toAccountId; // transfers
  String? _categoryId;
  DateTime _date = DateTime.now();
  bool _busy = false;
  bool _prefilled = false;

  LedgerTransaction? get _editing => widget.existing;

  /// Transfers are edited as delete + recreate; in the dialog we only allow
  /// changing simple fields of non-transfer transactions, like legacy.
  bool get _isTransferEdit =>
      _editing != null && _editing!.type == TxType.transfer;

  @override
  void dispose() {
    _amount.dispose();
    _payee.dispose();
    _note.dispose();
    super.dispose();
  }

  void _prefill(CurrencyService fx) {
    if (_prefilled) return;
    _prefilled = true;
    final t = _editing;
    if (t == null) return;
    _type = t.type;
    _accountId = t.accountId;
    _categoryId = t.categoryId;
    _date = t.date ?? DateTime.now();
    _payee.text = t.payee;
    _note.text = t.note;
    _amount.text = fx
        .fromMinor(t.amount, t.currency)
        .toStringAsFixed(fx.minorDigits(t.currency));
  }

  Future<void> _save(List<LedgerAccount> accounts) async {
    final fx = ref.read(fxProvider);
    final controller = ref.read(transactionControllerProvider);
    final amount = double.tryParse(_amount.text);
    final accId = _accountId;
    if (accId == null || amount == null || amount <= 0) return;
    final account = accounts.firstWhere((a) => a.id == accId);

    setState(() => _busy = true);
    if (_type == TxType.transfer) {
      final toId = _toAccountId;
      if (toId == null || toId == accId) {
        setState(() => _busy = false);
        return;
      }
      await controller.saveTransfer(
        from: account,
        to: accounts.firstWhere((a) => a.id == toId),
        amount: fx.toMinor(amount, account.currency),
        date: _date,
        note: _note.text.trim(),
      );
    } else {
      await controller.save(
        id: _editing?.id,
        type: _type,
        account: account,
        amount: fx.toMinor(amount, account.currency),
        categoryId: _categoryId,
        date: _date,
        payee: _payee.text.trim(),
        note: _note.text.trim(),
      );
    }
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _delete() async {
    final t = _editing!;
    final isTransfer = t.type == TxType.transfer;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete transaction?'),
        content: Text(isTransfer
            ? 'This is one leg of a transfer — both legs will be deleted.'
            : 'The account balance is restored.'),
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
    await ref.read(transactionControllerProvider).delete(
        t, ref.read(transactionsProvider).valueOrNull ?? const []);
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final fx = ref.watch(fxProvider);
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    _prefill(fx);
    _accountId ??= accounts.isNotEmpty ? accounts.first.id : null;

    final editing = _editing;
    final selectedAccount = accounts.isEmpty
        ? null
        : accounts.firstWhere((a) => a.id == _accountId,
            orElse: () => accounts.first);

    return AlertDialog(
      title: Text(editing != null ? 'Edit transaction' : 'Add transaction'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_isTransferEdit)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Text(
                    'Transfer legs can be deleted here; to change a transfer, '
                    'delete it and create a new one.',
                    style: TextStyle(fontSize: 12)),
              )
            else
              SegmentedButton<TxType>(
                segments: const [
                  ButtonSegment(value: TxType.expense, label: Text('Expense')),
                  ButtonSegment(value: TxType.income, label: Text('Income')),
                  ButtonSegment(value: TxType.transfer, label: Text('Transfer')),
                ],
                selected: {_type},
                onSelectionChanged: editing != null
                    ? null // type frozen on edit, like legacy
                    : (s) => setState(() {
                          _type = s.first;
                          _categoryId = null;
                        }),
              ),
            const SizedBox(height: 12),
            if (accounts.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text('Add an account first.'),
              )
            else ...[
              DropdownButtonFormField<String>(
                initialValue: _accountId,
                decoration: InputDecoration(
                    labelText:
                        _type == TxType.transfer ? 'From account' : 'Account'),
                items: [
                  for (final a in accounts)
                    DropdownMenuItem(
                      value: a.id,
                      child: Text('${a.name} (${a.currency})'),
                    ),
                ],
                onChanged: _isTransferEdit
                    ? null
                    : (v) => setState(() => _accountId = v),
              ),
              if (_type == TxType.transfer && !_isTransferEdit) ...[
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: _toAccountId,
                  decoration: const InputDecoration(labelText: 'To account'),
                  items: [
                    for (final a in accounts)
                      if (a.id != _accountId)
                        DropdownMenuItem(
                          value: a.id,
                          child: Text('${a.name} (${a.currency})'),
                        ),
                  ],
                  onChanged: (v) => setState(() => _toAccountId = v),
                ),
              ],
            ],
            if (_type != TxType.transfer) ...[
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                initialValue: _categoryId,
                decoration:
                    const InputDecoration(labelText: 'Category (optional)'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('— None —')),
                  for (final c in cats.where((c) =>
                      c.type ==
                      (_type == TxType.income ? 'income' : 'expense')))
                    DropdownMenuItem(value: c.id, child: Text(c.name)),
                ],
                onChanged: (v) => setState(() => _categoryId = v),
              ),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: _amount,
              enabled: !_isTransferEdit,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                labelText: selectedAccount == null
                    ? 'Amount'
                    : 'Amount (${selectedAccount.currency})',
              ),
            ),
            if (_type != TxType.transfer) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _payee,
                decoration:
                    const InputDecoration(labelText: 'Payee / description'),
              ),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: _note,
              enabled: !_isTransferEdit,
              decoration: const InputDecoration(labelText: 'Note (optional)'),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: Text('${_date.toLocal()}'.split(' ')[0])),
                TextButton(
                  onPressed: _isTransferEdit
                      ? null
                      : () async {
                          final picked = await showDatePicker(
                            context: context,
                            initialDate: _date,
                            firstDate: DateTime(2000),
                            lastDate: DateTime(2100),
                          );
                          if (picked != null) setState(() => _date = picked);
                        },
                  child: const Text('Pick date'),
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
        FilledButton(
          onPressed: _busy || accounts.isEmpty || _isTransferEdit
              ? null
              : () => _save(accounts),
          child: const Text('Save'),
        ),
      ],
    );
  }
}
