import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../dashboard/application/dashboard_providers.dart';
import 'debt_dialogs.dart';

/// Debts — matches legacy `DebtsView`: "You owe" / "Owed to you" summary
/// cards, then Active and Paid-off debt cards with progress bars.
class DebtsScreen extends ConsumerWidget {
  const DebtsScreen({super.key});

  static const borrowedColor = Color(0xFFEF4444); // rose
  static const lentColor = Color(0xFF10B981); // emerald

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fx = ref.watch(fxProvider);
    final home = ref.watch(homeCurrencyProvider);
    final svc = ref.watch(debtServiceProvider);
    final debts = ref.watch(debtsProvider).valueOrNull ?? const [];
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];

    final active = [for (final d in debts) if (!d.isPaid) d];
    final paid = [for (final d in debts) if (d.isPaid) d];

    int totalFor(DebtType type) {
      var sum = 0;
      for (final d in active) {
        if (d.type != type) continue;
        sum += fx.convert(svc.remaining(d, txs), d.currency, home);
      }
      return sum;
    }

    final youOwe = totalFor(DebtType.borrowed);
    final owedToYou = totalFor(DebtType.lent);
    final borrowedCount =
        active.where((d) => d.type == DebtType.borrowed).length;
    final lentCount = active.where((d) => d.type == DebtType.lent).length;

    return Scaffold(
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => showDebtDialog(context),
        icon: const Icon(Icons.add),
        label: const Text('New debt'),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Debts',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            Text('Track loans, repayments and IOUs · all linked to your accounts',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: Theme.of(context).hintColor)),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: _SummaryCard(
                    label: 'You owe',
                    icon: Icons.south_west,
                    color: borrowedColor,
                    amount: formatMoney(fx, youOwe, home),
                    caption: '$borrowedCount active',
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _SummaryCard(
                    label: 'Owed to you',
                    icon: Icons.north_east,
                    color: lentColor,
                    amount: formatMoney(fx, owedToYou, home),
                    caption: '$lentCount active',
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            if (active.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 40),
                child: Center(
                  child: Text(
                    'No active debts.\nRecord money you have borrowed or lent — '
                    'the amount syncs straight to the linked account.',
                    textAlign: TextAlign.center,
                  ),
                ),
              )
            else ...[
              _SectionLabel('ACTIVE'),
              for (final d in active)
                _DebtCard(debt: d, txs: txs, accounts: accounts, svc: svc, fx: fx),
            ],
            if (paid.isNotEmpty) ...[
              const SizedBox(height: 12),
              _SectionLabel('PAID OFF'),
              for (final d in paid)
                Opacity(
                  opacity: 0.6,
                  child: _DebtCard(
                      debt: d, txs: txs, accounts: accounts, svc: svc, fx: fx),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 6),
        child: Text(text,
            style: TextStyle(
                fontSize: 11,
                letterSpacing: 1.2,
                color: Theme.of(context).hintColor)),
      );
}

class _SummaryCard extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color color;
  final String amount;
  final String caption;
  const _SummaryCard({
    required this.label,
    required this.icon,
    required this.color,
    required this.amount,
    required this.caption,
  });

  @override
  Widget build(BuildContext context) {
    final hint = Theme.of(context).hintColor;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(children: [
              Icon(icon, size: 14, color: color),
              const SizedBox(width: 6),
              Text(label, style: TextStyle(fontSize: 12, color: hint)),
            ]),
            const SizedBox(height: 4),
            Text(amount,
                style: TextStyle(
                    fontSize: 22, fontWeight: FontWeight.w600, color: color)),
            const SizedBox(height: 2),
            Text(caption, style: TextStyle(fontSize: 12, color: hint)),
          ],
        ),
      ),
    );
  }
}

class _DebtCard extends ConsumerWidget {
  final Debt debt;
  final List<LedgerTransaction> txs;
  final List<LedgerAccount> accounts;
  final DebtService svc;
  final CurrencyService fx;
  const _DebtCard({
    required this.debt,
    required this.txs,
    required this.accounts,
    required this.svc,
    required this.fx,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final color = debt.isBorrowed
        ? DebtsScreen.borrowedColor
        : DebtsScreen.lentColor;
    final hint = Theme.of(context).hintColor;
    final remaining = svc.remaining(debt, txs);
    final pct = svc.percentRepaid(debt, txs);
    final paymentCount = svc.paymentsOf(debt, txs).length;
    String? accountName;
    for (final a in accounts) {
      if (a.id == debt.accountId) {
        accountName = a.name;
        break;
      }
    }

    String dueLabel() {
      if (debt.isPaid) return 'Paid off';
      final due = debt.dueDate;
      if (due == null) return 'No due date';
      final today = DateTime.now();
      final days = DateTime(due.year, due.month, due.day)
          .difference(DateTime(today.year, today.month, today.day))
          .inDays;
      return days < 0 ? 'Overdue ${-days}d' : 'Due in ${days}d';
    }

    final overdue = !debt.isPaid &&
        debt.dueDate != null &&
        debt.dueDate!.isBefore(DateTime.now());

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 38,
                  height: 38,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.13),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                      debt.isBorrowed ? Icons.south_west : Icons.north_east,
                      size: 18,
                      color: color),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(debt.counterparty,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                          overflow: TextOverflow.ellipsis),
                      Text(
                        '${debt.isBorrowed ? 'You owe' : 'Owed to you'}'
                        '${accountName == null ? '' : ' · $accountName'}',
                        style: TextStyle(fontSize: 12, color: hint),
                      ),
                    ],
                  ),
                ),
                if (!debt.isPaid)
                  IconButton(
                    tooltip: 'Record payment',
                    icon: const Icon(Icons.handshake_outlined, size: 18),
                    onPressed: () => showDebtPaymentDialog(context, debt),
                  ),
                IconButton(
                  tooltip: 'Edit',
                  icon: const Icon(Icons.edit_outlined, size: 18),
                  onPressed: () => showDebtDialog(context, existing: debt),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatMoney(fx, remaining, debt.currency),
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: debt.isPaid ? hint : null,
                    decoration: debt.isPaid ? TextDecoration.lineThrough : null,
                  ),
                ),
                const Spacer(),
                Text('/ ${formatMoney(fx, debt.principal, debt.currency)}',
                    style: TextStyle(fontSize: 13, color: hint)),
              ],
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: pct / 100,
                minHeight: 7,
                color: color,
                backgroundColor: color.withValues(alpha: 0.12),
              ),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Text(
                  '$pct% repaid · $paymentCount payment${paymentCount == 1 ? '' : 's'}',
                  style: TextStyle(fontSize: 12, color: hint),
                ),
                const Spacer(),
                if (debt.isPaid)
                  Row(children: [
                    Icon(Icons.check_circle_outline,
                        size: 13, color: DebtsScreen.lentColor),
                    const SizedBox(width: 4),
                    Text('Paid off',
                        style: TextStyle(
                            fontSize: 12, color: DebtsScreen.lentColor)),
                  ])
                else
                  Text(dueLabel(),
                      style: TextStyle(
                          fontSize: 12,
                          color: overdue ? DebtsScreen.borrowedColor : hint)),
              ],
            ),
            if (debt.note.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(debt.note, style: TextStyle(fontSize: 12, color: hint)),
            ],
          ],
        ),
      ),
    );
  }
}
