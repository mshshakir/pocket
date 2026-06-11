import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../dashboard/application/dashboard_providers.dart';
import 'add_budget_dialog.dart';

class BudgetsScreen extends ConsumerWidget {
  const BudgetsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fx = ref.watch(fxProvider);
    final budgets = ref.watch(budgetsProvider).valueOrNull ?? const [];
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final svc = ref.watch(budgetServiceProvider);
    final tree = CategoryTree(cats);
    final now = DateTime.now();

    String namesFor(Budget b) => svc
        .targetCategoryIds(b)
        .map((id) => tree.find(id)?.name ?? 'Category')
        .join(', ');

    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => showAddBudgetDialog(context),
        child: const Icon(Icons.add),
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Budgets',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 12),
            if (budgets.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: Text('No budgets yet. Tap + to add one.')),
              ),
            for (final b in budgets)
              InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: () => showBudgetDialog(context, existing: b),
                child: _BudgetCard(
                  title: namesFor(b),
                  period:
                      b.period == BudgetPeriod.hijri ? 'Hijri month' : 'Monthly',
                  spent: svc.currentSpend(b, txs, now),
                  limit: svc.effectiveLimit(b, txs, now).limit,
                  currency: b.currency,
                  fx: fx,
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _BudgetCard extends StatelessWidget {
  final String title;
  final String period;
  final int spent;
  final int limit;
  final String currency;
  final CurrencyService fx;
  const _BudgetCard({
    required this.title,
    required this.period,
    required this.spent,
    required this.limit,
    required this.currency,
    required this.fx,
  });

  @override
  Widget build(BuildContext context) {
    final frac = limit > 0 ? (spent / limit).clamp(0.0, 1.0) : 0.0;
    final over = spent > limit;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(title.isEmpty ? 'Budget' : title,
                      style: const TextStyle(fontWeight: FontWeight.w600)),
                ),
                Text(
                  '${formatMoney(fx, spent, currency)} / ${formatMoney(fx, limit, currency)}',
                  style: TextStyle(
                      color: over ? Colors.red.shade400 : null,
                      fontWeight: FontWeight.w600),
                ),
              ],
            ),
            const SizedBox(height: 8),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: frac,
                minHeight: 8,
                color: over ? Colors.red.shade400 : null,
              ),
            ),
            const SizedBox(height: 6),
            Text(period,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: Theme.of(context).hintColor)),
          ],
        ),
      ),
    );
  }
}
