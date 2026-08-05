import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/reconcile_controller.dart';

Future<void> showReconcileDialog(BuildContext context, LedgerAccount account) =>
    showDialog<void>(
        context: context, builder: (_) => ReconcileDialog(account: account));

/// Enter the account's actual balance; the difference vs the ledger-derived
/// balance is booked as an "adjustment" transaction.
class ReconcileDialog extends ConsumerStatefulWidget {
  final LedgerAccount account;
  const ReconcileDialog({super.key, required this.account});

  @override
  ConsumerState<ReconcileDialog> createState() => _ReconcileDialogState();
}

class _ReconcileDialogState extends ConsumerState<ReconcileDialog> {
  final _actual = TextEditingController();
  bool _busy = false;
  bool _prefilled = false;

  @override
  void dispose() {
    _actual.dispose();
    super.dispose();
  }

  Future<void> _save(int derived) async {
    final fx = ref.read(fxProvider);
    final value = double.tryParse(_actual.text);
    if (value == null) return;
    setState(() => _busy = true);
    final diff = await ref.read(reconcileControllerProvider).reconcile(
          account: widget.account,
          actualBalance: fx.toMinor(value, widget.account.currency),
          derivedBalance: derived,
        );
    if (!mounted) return;
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
        content: Text(diff == 0
            ? 'Already balanced — nothing to adjust.'
            : 'Adjustment of ${formatMoney(fx, diff.abs(), widget.account.currency)} recorded.')));
  }

  @override
  Widget build(BuildContext context) {
    final fx = ref.watch(fxProvider);
    final account = widget.account;
    final derived = ref.watch(balancesProvider)[account.id] ?? 0;
    final hint = Theme.of(context).hintColor;

    if (!_prefilled) {
      _prefilled = true;
      _actual.text = fx
          .fromMinor(derived, account.currency)
          .toStringAsFixed(fx.minorDigits(account.currency));
    }

    return AlertDialog(
      title: Text('Reconcile ${account.name}'),
      content: Column(
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
                Text('Balance from transactions',
                    style: TextStyle(fontSize: 12, color: hint)),
                Text(formatMoney(fx, derived, account.currency),
                    style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.w600)),
              ],
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _actual,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(
                decimal: true, signed: true),
            decoration: InputDecoration(
                labelText: 'Actual balance (${account.currency})',
                helperText:
                    'From your bank/wallet. Any difference is booked as an adjustment transaction.'),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy ? null : () => _save(derived),
          child: const Text('Reconcile'),
        ),
      ],
    );
  }
}
