import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/debt_controller.dart';

Future<void> showDebtDialog(BuildContext context, {Debt? existing}) =>
    showDialog<void>(
        context: context, builder: (_) => DebtDialog(existing: existing));

Future<void> showDebtPaymentDialog(BuildContext context, Debt debt) =>
    showDialog<void>(
        context: context, builder: (_) => DebtPaymentDialog(debt: debt));

/// New / edit debt — mirrors legacy `DebtModal`. When editing, the financial
/// identity of the debt (type, principal, currency, account, date taken) is
/// frozen; only counterparty, due date, note and paid-status can change.
class DebtDialog extends ConsumerStatefulWidget {
  final Debt? existing;
  const DebtDialog({super.key, this.existing});

  @override
  ConsumerState<DebtDialog> createState() => _DebtDialogState();
}

class _DebtDialogState extends ConsumerState<DebtDialog> {
  final _counterparty = TextEditingController();
  final _principal = TextEditingController();
  final _note = TextEditingController();
  DebtType _type = DebtType.borrowed;
  String? _currency;
  String? _accountId;
  DateTime _dateTaken = DateTime.now();
  DateTime? _dueDate;
  bool _markPaid = false;
  bool _destroyPayments = false;
  bool _busy = false;

  Debt? get _editing => widget.existing;

  @override
  void initState() {
    super.initState();
    final d = _editing;
    if (d != null) {
      _type = d.type;
      _counterparty.text = d.counterparty;
      _currency = d.currency;
      _accountId = d.accountId;
      _dateTaken = d.dateTaken ?? DateTime.now();
      _dueDate = d.dueDate;
      _note.text = d.note;
      _markPaid = d.isPaid;
    }
  }

  @override
  void dispose() {
    _counterparty.dispose();
    _principal.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save(List<LedgerAccount> accounts) async {
    final controller = ref.read(debtControllerProvider);
    final name = _counterparty.text.trim();
    if (name.isEmpty) return;

    setState(() => _busy = true);
    final editing = _editing;
    if (editing != null) {
      await controller.updateDebt(editing.copyWith(
        counterparty: name,
        dueDate: _dueDate,
        clearDueDate: _dueDate == null,
        note: _note.text.trim(),
        status: _markPaid ? DebtStatus.paid : DebtStatus.active,
      ));
    } else {
      final fx = ref.read(fxProvider);
      final currency = _currency!;
      final amount = double.tryParse(_principal.text);
      final accId = _accountId;
      if (amount == null || amount <= 0 || accId == null) {
        setState(() => _busy = false);
        return;
      }
      final account = accounts.firstWhere((a) => a.id == accId);
      await controller.recordDebt(
        type: _type,
        counterparty: name,
        principal: fx.toMinor(amount, currency),
        currency: currency,
        account: account,
        dateTaken: DateTime(_dateTaken.year, _dateTaken.month, _dateTaken.day),
        dueDate: _dueDate,
        note: _note.text.trim(),
      );
    }
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _delete() async {
    final editing = _editing!;
    final txs = ref.read(transactionsProvider).valueOrNull ?? const [];
    final payments =
        ref.read(debtServiceProvider).paymentsOf(editing, txs).length;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Delete debt?'),
        content: Text(_destroyPayments
            ? 'Delete this debt AND destroy $payments linked payment '
                'transaction${payments == 1 ? '' : 's'}? '
                'Account balances will be restored.'
            : 'The initial transaction is reverted; existing payment '
                'transactions are kept but unlinked.'),
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
    await ref.read(debtControllerProvider).deleteDebt(
          debt: editing,
          allTransactions: txs,
          destroyPayments: _destroyPayments,
        );
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final currencies = ref.read(fxProvider).rates.keys.toList()..sort();
    final editing = _editing;
    _currency ??= ref.read(defaultCurrencyProvider);
    _accountId ??= accounts.isNotEmpty ? accounts.first.id : null;

    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final paymentCount = editing == null
        ? 0
        : ref.read(debtServiceProvider).paymentsOf(editing, txs).length;

    return AlertDialog(
      title: Text(editing != null ? 'Edit debt' : 'New debt'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SegmentedButton<DebtType>(
              segments: const [
                ButtonSegment(
                    value: DebtType.borrowed,
                    icon: Icon(Icons.south_west, size: 16),
                    label: Text('I borrowed')),
                ButtonSegment(
                    value: DebtType.lent,
                    icon: Icon(Icons.north_east, size: 16),
                    label: Text('I lent')),
              ],
              selected: {_type},
              onSelectionChanged: editing != null
                  ? null
                  : (s) => setState(() => _type = s.first),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _counterparty,
              autofocus: editing == null,
              decoration: const InputDecoration(
                  labelText: 'Counterparty',
                  hintText: 'Name of person or entity'),
            ),
            const SizedBox(height: 12),
            if (editing == null) ...[
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _principal,
                      keyboardType: const TextInputType.numberWithOptions(
                          decimal: true),
                      decoration:
                          const InputDecoration(labelText: 'Principal'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _currency,
                      decoration:
                          const InputDecoration(labelText: 'Currency'),
                      items: [
                        for (final c in currencies)
                          DropdownMenuItem(value: c, child: Text(c)),
                      ],
                      onChanged: (v) =>
                          setState(() => _currency = v ?? _currency),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              if (accounts.isEmpty)
                const Text('Add an account first.')
              else
                DropdownButtonFormField<String>(
                  initialValue: _accountId,
                  decoration:
                      const InputDecoration(labelText: 'Linked account'),
                  items: [
                    for (final a in accounts)
                      DropdownMenuItem(
                          value: a.id,
                          child: Text('${a.name} (${a.currency})')),
                  ],
                  onChanged: (v) => setState(() => _accountId = v),
                ),
              const SizedBox(height: 4),
              Text(
                _type == DebtType.borrowed
                    ? 'Money will be added to this account on the date taken'
                    : 'Money will be deducted from this account on the date taken',
                style: TextStyle(
                    fontSize: 12, color: Theme.of(context).hintColor),
              ),
              const SizedBox(height: 12),
              _DateRow(
                label: 'Date taken',
                date: _dateTaken,
                onPick: (d) => setState(() => _dateTaken = d),
              ),
            ],
            _DateRow(
              label: 'Due date (optional)',
              date: _dueDate,
              onPick: (d) => setState(() => _dueDate = d),
              onClear: _dueDate == null
                  ? null
                  : () => setState(() => _dueDate = null),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _note,
              maxLines: 2,
              decoration: const InputDecoration(
                  labelText: 'Note', hintText: 'optional...'),
            ),
            if (editing != null) ...[
              const SizedBox(height: 8),
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Mark as fully paid off'),
                value: _markPaid,
                onChanged: (v) => setState(() => _markPaid = v ?? false),
              ),
              if (paymentCount > 0)
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(
                    'Also destroy $paymentCount linked payment '
                    'transaction${paymentCount == 1 ? '' : 's'} when deleting',
                    style: const TextStyle(color: Color(0xFFEF4444)),
                  ),
                  value: _destroyPayments,
                  onChanged: (v) =>
                      setState(() => _destroyPayments = v ?? false),
                ),
            ],
          ],
        ),
      ),
      actions: [
        if (editing != null)
          TextButton(
            onPressed: _busy ? null : _delete,
            style: TextButton.styleFrom(
                foregroundColor: const Color(0xFFEF4444)),
            child: const Text('Delete'),
          ),
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed:
              _busy || (editing == null && accounts.isEmpty)
                  ? null
                  : () => _save(accounts),
          child: Text(editing != null ? 'Save' : 'Record debt'),
        ),
      ],
    );
  }
}

/// Record a payment against a debt — mirrors the legacy payment modal:
/// remaining summary, amount prefilled with the remaining balance, date,
/// account, note.
class DebtPaymentDialog extends ConsumerStatefulWidget {
  final Debt debt;
  const DebtPaymentDialog({super.key, required this.debt});

  @override
  ConsumerState<DebtPaymentDialog> createState() => _DebtPaymentDialogState();
}

class _DebtPaymentDialogState extends ConsumerState<DebtPaymentDialog> {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  DateTime _date = DateTime.now();
  String? _accountId;
  bool _busy = false;
  bool _prefilled = false;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save(List<LedgerAccount> accounts, int remaining) async {
    final fx = ref.read(fxProvider);
    final debt = widget.debt;
    final value = double.tryParse(_amount.text);
    final accId = _accountId;
    if (value == null || value <= 0 || accId == null) return;
    var minor = fx.toMinor(value, debt.currency);
    if (minor > remaining) minor = remaining; // cap at remaining, like max=
    setState(() => _busy = true);
    await ref.read(debtControllerProvider).recordPayment(
          debt: debt,
          account: accounts.firstWhere((a) => a.id == accId),
          amount: minor,
          allTransactions:
              ref.read(transactionsProvider).valueOrNull ?? const [],
          date: _date,
          note: _note.text.trim(),
        );
    if (mounted) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final fx = ref.watch(fxProvider);
    final debt = widget.debt;
    final svc = ref.watch(debtServiceProvider);
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final remaining = svc.remaining(debt, txs);
    final hint = Theme.of(context).hintColor;

    _accountId ??= debt.accountId ??
        (accounts.isNotEmpty ? accounts.first.id : null);
    if (!_prefilled) {
      _prefilled = true;
      _amount.text = fx
          .fromMinor(remaining, debt.currency)
          .toStringAsFixed(fx.minorDigits(debt.currency));
    }

    return AlertDialog(
      title: Text(debt.isBorrowed
          ? 'Pay ${debt.counterparty}'
          : 'Receive payment from ${debt.counterparty}'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Remaining',
                      style: TextStyle(fontSize: 12, color: hint)),
                  Text(formatMoney(fx, remaining, debt.currency),
                      style: const TextStyle(
                          fontSize: 22, fontWeight: FontWeight.w600)),
                  Text(
                      'of ${formatMoney(fx, debt.principal, debt.currency)} total',
                      style: TextStyle(fontSize: 12, color: hint)),
                ],
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _amount,
              autofocus: true,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              decoration:
                  InputDecoration(labelText: 'Amount (${debt.currency})'),
            ),
            const SizedBox(height: 12),
            _DateRow(
              label: 'Date',
              date: _date,
              onPick: (d) => setState(() => _date = d),
            ),
            const SizedBox(height: 12),
            if (accounts.isNotEmpty)
              DropdownButtonFormField<String>(
                initialValue: _accountId,
                decoration: InputDecoration(
                    labelText:
                        debt.isBorrowed ? 'From account' : 'Into account'),
                items: [
                  for (final a in accounts)
                    DropdownMenuItem(
                        value: a.id, child: Text('${a.name} (${a.currency})')),
                ],
                onChanged: (v) => setState(() => _accountId = v),
              ),
            const SizedBox(height: 12),
            TextField(
              controller: _note,
              maxLines: 2,
              decoration: const InputDecoration(
                  labelText: 'Note', hintText: 'optional...'),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy || accounts.isEmpty || remaining == 0
              ? null
              : () => _save(accounts, remaining),
          child: const Text('Record payment'),
        ),
      ],
    );
  }
}

/// Small shared "label + pick a date" row used by both dialogs.
class _DateRow extends StatelessWidget {
  final String label;
  final DateTime? date;
  final ValueChanged<DateTime> onPick;
  final VoidCallback? onClear;
  const _DateRow({
    required this.label,
    required this.date,
    required this.onPick,
    this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final text = date == null
        ? '—'
        : '${date!.year.toString().padLeft(4, '0')}-'
            '${date!.month.toString().padLeft(2, '0')}-'
            '${date!.day.toString().padLeft(2, '0')}';
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label,
                  style: TextStyle(
                      fontSize: 12, color: Theme.of(context).hintColor)),
              Text(text),
            ],
          ),
        ),
        if (onClear != null)
          TextButton(onPressed: onClear, child: const Text('Clear')),
        TextButton(
          onPressed: () async {
            final picked = await showDatePicker(
              context: context,
              initialDate: date ?? DateTime.now(),
              firstDate: DateTime(2000),
              lastDate: DateTime(2100),
            );
            if (picked != null) onPick(picked);
          },
          child: const Text('Pick'),
        ),
      ],
    );
  }
}
