import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/format.dart';
import '../../dashboard/application/dashboard_providers.dart';
import 'add_account_dialog.dart';

class AccountsScreen extends ConsumerWidget {
  const AccountsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fx = ref.watch(fxProvider);
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final balances = ref.watch(balancesProvider);

    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => showAddAccountDialog(context),
        child: const Icon(Icons.add),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Accounts',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (accounts.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: Text('No accounts yet. Tap + to add one.')),
              )
            else
              for (final a in accounts)
                Card(
                  child: ListTile(
                    onTap: () => showAccountDialog(context, existing: a),
                    leading: const CircleAvatar(
                        child: Icon(Icons.account_balance_wallet_outlined)),
                    title: Text(a.name.isEmpty ? 'Account' : a.name),
                    subtitle: Text(a.currency),
                    trailing: Text(
                      formatMoney(fx, balances[a.id] ?? 0, a.currency),
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 16),
                    ),
                  ),
                ),
          ],
        ),
      ),
    );
  }
}
