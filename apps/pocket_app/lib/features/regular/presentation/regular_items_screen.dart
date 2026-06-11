import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../application/regular_item_controller.dart';
import 'regular_item_dialog.dart';

/// Regular Purchases — item cards with a one-tap "Log" that books a real
/// expense transaction, mirroring the legacy quick-log.
class RegularItemsScreen extends ConsumerWidget {
  const RegularItemsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fx = ref.watch(fxProvider);
    final items = ref.watch(regularItemsProvider).valueOrNull ?? const [];
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];

    String? categoryName(String? id) {
      for (final c in cats) {
        if (c.id == id) return c.name;
      }
      return null;
    }

    int logsThisMonth(RegularItem item) {
      final now = DateTime.now();
      var n = 0;
      for (final t in txs) {
        if (t.regularItemId == item.id &&
            t.date != null &&
            t.date!.year == now.year &&
            t.date!.month == now.month) {
          n++;
        }
      }
      return n;
    }

    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => showRegularItemDialog(context),
        icon: const Icon(Icons.add),
        label: const Text('New item'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Regular Purchases',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            Text('Quick-log the things you buy often — each log books a real transaction',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: Theme.of(context).hintColor)),
            const SizedBox(height: 12),
            if (items.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(
                  child: Text(
                      'No regular items yet.\nCreate one (e.g. "Morning coffee") and log it with one tap.',
                      textAlign: TextAlign.center),
                ),
              ),
            for (final item in items)
              _RegularItemCard(
                item: item,
                fx: fx,
                accounts: accounts,
                categoryName: categoryName(item.categoryId),
                logsThisMonth: logsThisMonth(item),
              ),
          ],
        ),
      ),
    );
  }
}

class _RegularItemCard extends ConsumerWidget {
  final RegularItem item;
  final CurrencyService fx;
  final List<LedgerAccount> accounts;
  final String? categoryName;
  final int logsThisMonth;
  const _RegularItemCard({
    required this.item,
    required this.fx,
    required this.accounts,
    required this.categoryName,
    required this.logsThisMonth,
  });

  LedgerAccount? get _account {
    for (final a in accounts) {
      if (a.id == item.accountId) return a;
    }
    return accounts.isNotEmpty ? accounts.first : null;
  }

  Future<void> _log(BuildContext context, WidgetRef ref) async {
    final account = _account;
    if (account == null) {
      ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Add an account first.')));
      return;
    }
    final controller = ref.read(regularItemControllerProvider);
    if (item.defaultAmount > 0) {
      await controller.log(item: item, account: account);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text(
                'Logged ${item.name} · ${formatMoney(fx, item.defaultAmount, item.currency)}')));
      }
    } else {
      // No default amount: ask for one.
      final amount = await _askAmount(context);
      if (amount == null || amount <= 0) return;
      await controller.log(
          item: item,
          account: account,
          amount: fx.toMinor(amount, item.currency));
    }
  }

  Future<double?> _askAmount(BuildContext context) {
    final controller = TextEditingController();
    return showDialog<double>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('Log ${item.name}'),
        content: TextField(
          controller: controller,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: 'Amount (${item.currency})'),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(c).pop(),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () =>
                  Navigator.of(c).pop(double.tryParse(controller.text)),
              child: const Text('Log')),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hint = Theme.of(context).hintColor;
    final freq = switch (item.frequency) {
      RegularFrequency.daily => 'Daily',
      RegularFrequency.weekly => 'Weekly',
      RegularFrequency.monthly => 'Monthly',
    };

    return Card(
      child: ListTile(
        contentPadding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
        leading: IconPill(
            iconName: item.icon, colorHex: item.color, size: 40,
            fallbackIcon: Icons.coffee_outlined),
        title: Text(item.name,
            style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(
          [
            if (item.defaultAmount > 0)
              formatMoney(fx, item.defaultAmount, item.currency),
            freq,
            if (categoryName != null) categoryName!,
            '$logsThisMonth this month',
          ].join(' · '),
          style: TextStyle(fontSize: 12, color: hint),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            FilledButton.tonalIcon(
              icon: const Icon(Icons.flash_on, size: 16),
              label: const Text('Log'),
              onPressed: () => _log(context, ref),
            ),
            IconButton(
              tooltip: 'Edit',
              icon: const Icon(Icons.edit_outlined, size: 18),
              onPressed: () => showRegularItemDialog(context, existing: item),
            ),
          ],
        ),
      ),
    );
  }
}
