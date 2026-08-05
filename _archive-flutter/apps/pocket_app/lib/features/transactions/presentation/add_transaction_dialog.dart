import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/file_saver/receipt_picker.dart';
import '../../../core/payment_types.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../../receipts/application/gemini_key_store.dart';
import '../../receipts/application/receipt_scan_service.dart';
import '../application/merchant_memory_controller.dart';
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

/// One editable split row: category + amount controller.
class _SplitEntry {
  String? categoryId;
  final TextEditingController amount;
  _SplitEntry({this.categoryId, String initialAmount = ''})
      : amount = TextEditingController(text: initialAmount);
  void dispose() => amount.dispose();
}

class _TransactionDialogState extends ConsumerState<TransactionDialog> {
  final _amount = TextEditingController();
  final _payee = TextEditingController();
  final _note = TextEditingController();
  TxType _type = TxType.expense;
  String? _accountId;
  String? _toAccountId; // transfers
  String? _currency; // null = account currency (FX panel)
  String? _categoryId;
  bool _categoryTouched = false; // suppress merchant auto-fill once user picks
  String _paymentType = 'card';
  bool _pending = false; // record_state: pending vs cleared
  DateTime _date = DateTime.now();
  final List<_SplitEntry> _splits = [];
  String? _splitError;
  RecurrenceRule? _repeat; // null = does not repeat
  LedgerTransaction? _outLeg; // transfer edit: the two existing legs
  LedgerTransaction? _inLeg;
  bool _busy = false;
  bool _scanning = false;
  bool _prefilled = false;

  bool get _splitMode => _splits.isNotEmpty;

  static const _addCustomSentinel = '__add_payment_type__';

  /// Prompts for a new payment-type name and selects it. It is "remembered"
  /// automatically once the transaction is saved (the next dialog derives
  /// custom types from existing transactions).
  Future<void> _addCustomType() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('New payment type'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
              labelText: 'Name', hintText: 'e.g. PayPal, gift card'),
          onSubmitted: (v) => Navigator.of(c).pop(v),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(c).pop(controller.text),
              child: const Text('Add')),
        ],
      ),
    );
    controller.dispose();
    if (name == null) return;
    final normalized = PaymentTypes.normalize(name);
    if (normalized.isEmpty) return;
    setState(() => _paymentType = normalized);
  }

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
    for (final s in _splits) {
      s.dispose();
    }
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
    _categoryTouched = true; // keep the saved category; don't auto-override
    _date = t.date ?? DateTime.now();
    _payee.text = t.payee;
    _note.text = t.note;
    _amount.text = fx
        .fromMinor(t.amount, t.currency)
        .toStringAsFixed(fx.minorDigits(t.currency));
    _repeat = t.recurring?.rule;
    _currency = t.currency;
    _paymentType = t.paymentType;
    _pending = t.recordState == 'pending';

    // Transfer edit: locate both legs and present the source (out) side, which
    // is the leg the user edits (amount in the from-account's currency).
    if (t.type == TxType.transfer) {
      final all =
          ref.read(transactionsProvider).valueOrNull ?? const <LedgerTransaction>[];
      LedgerTransaction? pair;
      for (final x in all) {
        if (x.id != t.id &&
            (x.transferPairId == t.id || t.transferPairId == x.id)) {
          pair = x;
          break;
        }
      }
      final out = t.transferDir == TransferDir.outbound ? t : pair;
      final inn = t.transferDir == TransferDir.outbound ? pair : t;
      _outLeg = out;
      _inLeg = inn;
      if (out != null) {
        _accountId = out.accountId;
        _amount.text = fx
            .fromMinor(out.amount, out.currency)
            .toStringAsFixed(fx.minorDigits(out.currency));
        _note.text = out.note;
        _date = out.date ?? DateTime.now();
      }
      _toAccountId = inn?.accountId;
    }

    for (final s in t.splits ?? const <LedgerSplit>[]) {
      _splits.add(_SplitEntry(
        categoryId: s.categoryId,
        initialAmount: fx
            .fromMinor(s.amount, t.currency)
            .toStringAsFixed(fx.minorDigits(t.currency)),
      ));
    }
  }

  Future<void> _save(List<LedgerAccount> accounts) async {
    final fx = ref.read(fxProvider);
    final controller = ref.read(transactionControllerProvider);
    final amount = double.tryParse(_amount.text);
    final accId = _accountId;
    if (accId == null || amount == null || amount <= 0) return;
    // Resolve against ALL accounts (incl. archived) so editing a transfer that
    // touches an archived account still works.
    final allAccounts = ref.read(accountsProvider).valueOrNull ?? accounts;
    final matches = allAccounts.where((a) => a.id == accId);
    if (matches.isEmpty) return; // account deleted meanwhile
    final account = matches.first;

    // Transfers are always entered in the source account's currency; the
    // FX picker only applies to expense/income.
    final txCurrency = _type == TxType.transfer
        ? account.currency
        : (_currency ?? account.currency);
    final totalMinor = fx.toMinor(amount, txCurrency);

    // Build + validate splits before flipping into busy state. Split amounts
    // are entered in the TX currency; their account-currency impact is
    // rate-frozen here, like legacy.
    List<LedgerSplit>? splits;
    if (_type == TxType.expense && _splitMode) {
      splits = [];
      var sum = 0;
      for (final s in _splits) {
        final v = double.tryParse(s.amount.text);
        if (v == null || v <= 0) {
          setState(() => _splitError = 'Every split needs a positive amount.');
          return;
        }
        final minor = fx.toMinor(v, txCurrency);
        sum += minor;
        splits.add(LedgerSplit(
            categoryId: s.categoryId,
            amount: minor,
            acctMinor: txCurrency == account.currency
                ? minor
                : fx.convert(minor, txCurrency, account.currency)));
      }
      if (sum != totalMinor) {
        setState(() => _splitError =
            'Splits must add up to the total (off by ${fx.fromMinor((totalMinor - sum).abs(), txCurrency).toStringAsFixed(fx.minorDigits(txCurrency))}).');
        return;
      }
      _splitError = null;
    }

    setState(() => _busy = true);
    if (_type == TxType.transfer) {
      if (_isTransferEdit) {
        final out = _outLeg;
        final inn = _inLeg;
        if (out == null || inn == null) {
          setState(() => _busy = false);
          return;
        }
        LedgerAccount? from, to;
        for (final a in allAccounts) {
          if (a.id == out.accountId) from = a;
          if (a.id == inn.accountId) to = a;
        }
        if (from == null || to == null) {
          setState(() => _busy = false);
          return;
        }
        await controller.updateTransfer(
          outLeg: out,
          inLeg: inn,
          from: from,
          to: to,
          amount: totalMinor,
          date: _date,
          note: _note.text.trim(),
        );
      } else {
        final toId = _toAccountId;
        if (toId == null || toId == accId) {
          setState(() => _busy = false);
          return;
        }
        await controller.saveTransfer(
          from: account,
          to: allAccounts.firstWhere((a) => a.id == toId),
          amount: totalMinor,
          date: _date,
          note: _note.text.trim(),
        );
      }
    } else {
      await controller.save(
        id: _editing?.id,
        type: _type,
        account: account,
        amount: totalMinor,
        currency: txCurrency,
        homeCurrency: ref.read(homeCurrencyProvider),
        categoryId: _categoryId,
        date: _date,
        payee: _payee.text.trim(),
        note: _note.text.trim(),
        paymentType: _paymentType,
        recordState: _pending ? 'pending' : 'cleared',
        splits: splits,
        recurring:
            _repeat == null ? null : RecurringSpec(rule: _repeat!),
      );
      // Remember payee→category for next time (no-op for splits/blank payee).
      if (!_splitMode) {
        await ref.read(merchantMemoryControllerProvider).remember(
              payee: _payee.text.trim(),
              categoryId: _categoryId,
            );
      }
    }
    if (mounted) Navigator.of(context).pop();
  }

  /// Scan a receipt with Gemini and prefill the form (legacy parity: payee,
  /// date, note with line items, amount, splits per category).
  Future<void> _scanReceipt(List<CategoryNode> cats) async {
    final store = ref.read(geminiKeyStoreProvider).valueOrNull;
    if (store == null || !store.hasKey) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text(
              'Add your Gemini API key in Settings → AI Receipt Scanner first.')));
      return;
    }
    final PickedReceipt? picked;
    try {
      picked = await pickReceiptFile();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('$e')));
      }
      return;
    }
    if (picked == null) return; // user cancelled the picker
    if (!mounted) return;
    setState(() => _scanning = true);
    try {
      final prefill = await ReceiptScanService(store.key).scan(
        bytes: picked.bytes,
        mimeType: picked.mimeType,
        categories: cats,
        defaultCurrency: ref.read(defaultCurrencyProvider),
      );
      if (!mounted) return;
      setState(() {
        _type = TxType.expense;
        // Activate the FX panel with the receipt's detected currency when we
        // have a rate for it (audit A2-12).
        if (ref.read(fxProvider).rates.containsKey(prefill.currency)) {
          _currency = prefill.currency;
        }
        _amount.text = prefill.amount.toStringAsFixed(2);
        _payee.text = prefill.payee;
        _note.text = prefill.note;
        _date = prefill.date;
        for (final s in _splits) {
          s.dispose();
        }
        _splits.clear();
        _splitError = null;
        if (prefill.splits.length > 1) {
          for (final s in prefill.splits) {
            _splits.add(_SplitEntry(
                categoryId: s.categoryId,
                initialAmount: s.amount.toStringAsFixed(2)));
          }
          _categoryId = null;
        } else {
          _categoryId = prefill.categoryId;
        }
      });
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
              'Receipt scanned — review the amounts, then save. (${prefill.currency})')));
    } on ReceiptScanException catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(e.message == ReceiptScanException.noApiKey
              ? 'Add your Gemini API key in Settings first.'
              : e.message)));
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
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
    final accounts = ref.watch(activeAccountsProvider);
    final allAccounts =
        ref.watch(accountsProvider).valueOrNull ?? const <LedgerAccount>[];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    _prefill(fx);
    _accountId ??= accounts.isNotEmpty ? accounts.first.id : null;

    // Payment-type options: built-ins plus any custom types already used.
    final allTxs =
        ref.watch(transactionsProvider).valueOrNull ?? const <LedgerTransaction>[];
    final usedPaymentTypes = <String>{for (final t in allTxs) t.paymentType};
    final paymentOptions = PaymentTypes.options(usedPaymentTypes);
    if (!paymentOptions.contains(_paymentType)) paymentOptions.add(_paymentType);

    final editing = _editing;
    final selectedAccount = accounts.isEmpty
        ? null
        : accounts.firstWhere((a) => a.id == _accountId,
            orElse: () => accounts.first);

    // A Dropdown's value MUST exist among its items or Flutter asserts —
    // guard against archived accounts and deleted/mistyped categories.
    final accountIds = {for (final a in accounts) a.id};
    final accountValue = accountIds.contains(_accountId) ? _accountId : null;
    final visibleCats = [
      for (final c in cats)
        if (c.type == (_type == TxType.income ? 'income' : 'expense')) c,
    ];
    final categoryValue =
        visibleCats.any((c) => c.id == _categoryId) ? _categoryId : null;

    return AlertDialog(
      title: Row(
        children: [
          Expanded(
            child:
                Text(editing != null ? 'Edit transaction' : 'Add transaction'),
          ),
          if (editing == null)
            _scanning
                ? const Padding(
                    padding: EdgeInsets.all(8),
                    child: SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2)),
                  )
                : IconButton(
                    tooltip: 'Scan receipt (AI)',
                    icon: const Icon(Icons.document_scanner_outlined),
                    onPressed: _busy ? null : () => _scanReceipt(cats),
                  ),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (_isTransferEdit)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Text(
                    'Editing a transfer updates the amount, date and note on '
                    'both legs. The accounts can’t be changed here.',
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
                          _splitError = null;
                          for (final sp in _splits) {
                            sp.dispose();
                          }
                          _splits.clear();
                        }),
              ),
            const SizedBox(height: 12),
            if (accounts.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: Text('Add an account first.'),
              )
            else if (_isTransferEdit)
              Builder(builder: (_) {
                String nameOf(String? id) {
                  for (final a in allAccounts) {
                    if (a.id == id) {
                      return a.name.isEmpty
                          ? a.currency
                          : '${a.name} (${a.currency})';
                    }
                  }
                  return '—';
                }

                return InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Transfer',
                    helperText:
                        'Accounts are fixed; edit amount, date and note.',
                  ),
                  child: Text('${nameOf(_accountId)}  →  ${nameOf(_toAccountId)}'),
                );
              })
            else ...[
              DropdownButtonFormField<String>(
                initialValue: accountValue,
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
                onChanged: (v) => setState(() => _accountId = v),
              ),
              if (_type == TxType.transfer) ...[
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
            if (_type != TxType.transfer && !_splitMode) ...[
              const SizedBox(height: 12),
              DropdownButtonFormField<String?>(
                initialValue: categoryValue,
                decoration:
                    const InputDecoration(labelText: 'Category (optional)'),
                items: [
                  const DropdownMenuItem(value: null, child: Text('— None —')),
                  for (final c in visibleCats)
                    DropdownMenuItem(value: c.id, child: Text(c.name)),
                ],
                onChanged: (v) => setState(() {
                  _categoryId = v;
                  _categoryTouched = true;
                }),
              ),
              if (_type == TxType.expense)
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    icon: const Icon(Icons.call_split, size: 16),
                    label: const Text('Split into categories'),
                    onPressed: () => setState(() {
                      _categoryId = null;
                      _splits
                        ..add(_SplitEntry())
                        ..add(_SplitEntry());
                    }),
                  ),
                ),
            ],
            if (_type == TxType.expense && _splitMode) ...[
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerLeft,
                child: Text('Splits — must add up to the total',
                    style: TextStyle(
                        fontSize: 12, color: Theme.of(context).hintColor)),
              ),
              for (var i = 0; i < _splits.length; i++)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Row(
                    children: [
                      Expanded(
                        flex: 3,
                        child: DropdownButtonFormField<String?>(
                          initialValue: visibleCats
                                  .any((c) => c.id == _splits[i].categoryId)
                              ? _splits[i].categoryId
                              : null,
                          isDense: true,
                          decoration:
                              const InputDecoration(labelText: 'Category'),
                          items: [
                            const DropdownMenuItem(
                                value: null, child: Text('— None —')),
                            for (final c in visibleCats)
                              DropdownMenuItem(
                                  value: c.id, child: Text(c.name)),
                          ],
                          onChanged: (v) =>
                              setState(() => _splits[i].categoryId = v),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        flex: 2,
                        child: TextField(
                          controller: _splits[i].amount,
                          keyboardType: const TextInputType.numberWithOptions(
                              decimal: true),
                          decoration:
                              const InputDecoration(labelText: 'Amount'),
                        ),
                      ),
                      IconButton(
                        tooltip: 'Remove split',
                        icon: const Icon(Icons.close, size: 16),
                        onPressed: () => setState(() {
                          _splits.removeAt(i).dispose();
                        }),
                      ),
                    ],
                  ),
                ),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  icon: const Icon(Icons.add, size: 16),
                  label: const Text('Add split'),
                  onPressed: () =>
                      setState(() => _splits.add(_SplitEntry())),
                ),
              ),
              if (_splitError != null)
                Align(
                  alignment: Alignment.centerLeft,
                  child: Text(_splitError!,
                      style: const TextStyle(
                          fontSize: 12, color: Color(0xFFEF4444))),
                ),
            ],
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  flex: 3,
                  child: TextField(
                    controller: _amount,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    decoration: const InputDecoration(labelText: 'Amount'),
                    onChanged: (_) => setState(() {}), // refresh FX hint
                  ),
                ),
                if (_type != TxType.transfer) ...[
                  const SizedBox(width: 8),
                  Expanded(
                    flex: 2,
                    child: DropdownButtonFormField<String>(
                      initialValue: () {
                        final currencies = fx.rates.keys.toList()..sort();
                        final v = _currency ?? selectedAccount?.currency;
                        return currencies.contains(v) ? v : null;
                      }(),
                      decoration:
                          const InputDecoration(labelText: 'Currency'),
                      items: [
                        for (final c in fx.rates.keys.toList()..sort())
                          DropdownMenuItem(value: c, child: Text(c)),
                      ],
                      onChanged: _isTransferEdit
                          ? null
                          : (v) => setState(() => _currency = v),
                    ),
                  ),
                ],
              ],
            ),
            // FX hint when the entry currency differs from the account's —
            // shows the rate-frozen account impact (legacy FX panel).
            if (_type != TxType.transfer &&
                selectedAccount != null &&
                (_currency ?? selectedAccount.currency) !=
                    selectedAccount.currency)
              Builder(builder: (context) {
                final txCcy = _currency!;
                final v = double.tryParse(_amount.text);
                final converted = v == null
                    ? null
                    : fx.convert(fx.toMinor(v, txCcy), txCcy,
                        selectedAccount.currency);
                return Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      converted == null
                          ? 'Entered in $txCcy — converted to ${selectedAccount.currency} at today\'s rate when saved.'
                          : '≈ ${fx.fromMinor(converted, selectedAccount.currency).toStringAsFixed(fx.minorDigits(selectedAccount.currency))} ${selectedAccount.currency} at today\'s rate (frozen on save)',
                      style: TextStyle(
                          fontSize: 12, color: Theme.of(context).hintColor),
                    ),
                  ),
                );
              }),
            if (_type != TxType.transfer) ...[
              const SizedBox(height: 12),
              TextField(
                controller: _payee,
                decoration:
                    const InputDecoration(labelText: 'Payee / description'),
                // Auto-categorise a known payee until the user picks a
                // category themselves (and never in split mode).
                onChanged: (v) {
                  if (_categoryTouched || _splitMode) return;
                  final remembered =
                      ref.read(merchantMemoryProvider).categoryFor(v);
                  if (remembered != null && remembered != _categoryId) {
                    setState(() => _categoryId = remembered);
                  }
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _paymentType,
                decoration:
                    const InputDecoration(labelText: 'Payment type'),
                items: [
                  for (final p in paymentOptions)
                    DropdownMenuItem(
                        value: p, child: Text(PaymentTypes.label(p))),
                  const DropdownMenuItem(
                    value: _addCustomSentinel,
                    child: Text('Add custom type…'),
                  ),
                ],
                onChanged: (v) {
                  if (v == null) return;
                  if (v == _addCustomSentinel) {
                    _addCustomType();
                  } else {
                    setState(() => _paymentType = v);
                  }
                },
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<RecurrenceRule?>(
                initialValue: _repeat,
                decoration: const InputDecoration(
                    labelText: 'Repeat',
                    helperText:
                        'Future occurrences are added automatically'),
                items: const [
                  DropdownMenuItem(
                      value: null, child: Text('Does not repeat')),
                  DropdownMenuItem(
                      value: RecurrenceRule.daily, child: Text('Daily')),
                  DropdownMenuItem(
                      value: RecurrenceRule.weekly, child: Text('Weekly')),
                  DropdownMenuItem(
                      value: RecurrenceRule.monthly, child: Text('Monthly')),
                  DropdownMenuItem(
                      value: RecurrenceRule.yearly, child: Text('Yearly')),
                ],
                onChanged: (v) => setState(() => _repeat = v),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Pending'),
                subtitle: const Text("Not yet cleared by the bank"),
                value: _pending,
                onChanged: (v) => setState(() => _pending = v),
              ),
            ],
            const SizedBox(height: 12),
            TextField(
              controller: _note,
              decoration: const InputDecoration(labelText: 'Note (optional)'),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(child: Text('${_date.toLocal()}'.split(' ')[0])),
                TextButton(
                  onPressed: () async {
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
          onPressed:
              _busy || accounts.isEmpty ? null : () => _save(accounts),
          child: const Text('Save'),
        ),
      ],
    );
  }
}
