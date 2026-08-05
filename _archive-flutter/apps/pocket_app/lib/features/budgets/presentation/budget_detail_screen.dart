import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:pocket_domain/domain.dart';

import '../../../core/format.dart';
import '../../../core/icon_pill.dart';
import '../../dashboard/application/dashboard_providers.dart';
import '../../settings/application/settings_controller.dart';
import '../../transactions/presentation/add_transaction_dialog.dart';
import '../../transactions/presentation/transactions_screen.dart' show TransactionRow;
import 'add_budget_dialog.dart';

/// Pushes the per-budget detail page.
Future<void> showBudgetDetail(BuildContext context, Budget budget) =>
    Navigator.of(context).push(MaterialPageRoute<void>(
      builder: (_) => BudgetDetailScreen(budget: budget),
    ));

/// One budget in focus: effective limit/spend with rollover, the per-category
/// breakdown, and the current-period transactions counting toward it. All math
/// is delegated to the pure [BudgetService] (audit A1-3).
class BudgetDetailScreen extends ConsumerWidget {
  final Budget budget;
  const BudgetDetailScreen({super.key, required this.budget});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fx = ref.watch(fxProvider);
    final txs = ref.watch(transactionsProvider).valueOrNull ?? const [];
    final cats = ref.watch(categoriesProvider).valueOrNull ?? const [];
    final accounts = ref.watch(accountsProvider).valueOrNull ?? const [];
    final svc = ref.watch(budgetServiceProvider);
    final dates = ref.watch(dateFormatProvider);
    final offset = ref.watch(settingsProvider).valueOrNull?.hijriOffset ?? 0;
    final tree = CategoryTree(cats);
    final now = DateTime.now();
    final hint = Theme.of(context).hintColor;

    final title = svc
        .targetCategoryIds(budget)
        .map((id) => tree.find(id)?.name ?? 'Category')
        .join(', ');
    final effective = svc.effectiveLimit(budget, txs, now, hijriOffset: offset);
    final spent = svc.currentSpend(budget, txs, now, hijriOffset: offset);
    final byCategory =
        svc.spendByCategory(budget, txs, now, hijriOffset: offset);
    final periodTxs =
        svc.periodTransactions(budget, txs, now, hijriOffset: offset);

    final limit = effective.limit;
    final remaining = limit - spent;
    final over = spent > limit;

    final catById = {for (final c in cats) c.id: c};
    final accountById = {for (final a in accounts) a.id: a};

    return Scaffold(
      appBar: AppBar(
        title: Text(title.isEmpty ? 'Budget' : title),
        actions: [
          IconButton(
            tooltip: 'Edit budget',
            icon: const Icon(Icons.edit_outlined),
            onPressed: () => showBudgetDialog(context, existing: budget),
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _SummaryCard(
              period: budget.period == BudgetPeriod.hijri
                  ? 'Hijri month'
                  : 'Monthly',
              spent: spent,
              limit: limit,
              remaining: remaining,
              rollover: effective.rollover,
              currency: budget.currency,
              over: over,
              fx: fx,
            ),
            const SizedBox(height: 16),
            Text('BY CATEGORY',
                style: TextStyle(
                    fontSize: 11, letterSpacing: 1.2, color: hint)),
            const SizedBox(height: 8),
            if (byCategory.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Text('No categories on this budget.',
                    style: TextStyle(color: hint)),
              )
            else
              for (final cs in byCategory)
                _CategoryRow(spend: cs, limit: limit, currency: budget.currency, fx: fx),
            const SizedBox(height: 16),
            Text('TRANSACTIONS THIS PERIOD',
                style: TextStyle(
                    fontSize: 11, letterSpacing: 1.2, color: hint)),
            const SizedBox(height: 8),
            if (periodTxs.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Text('Nothing counted toward this budget yet.',
                    style: TextStyle(color: hint)),
              )
            else
              for (final t in periodTxs)
                TransactionRow(
                  transaction: t,
                  account: accountById[t.accountId],
                  category: t.categoryId == null ? null : catById[t.categoryId],
                  fx: fx,
                  dateText: t.date == null ? '' : dates.format(t.date!),
                  onTap: () => showTransactionDialog(context, existing: t),
                ),
          ],
        ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final String period;
  final int spent;
  final int limit;
  final int remaining;
  final int rollover;
  final String currency;
  final bool over;
  final CurrencyService fx;
  const _SummaryCard({
    required this.period,
    required this.spent,
    required this.limit,
    required this.remaining,
    required this.rollover,
    required this.currency,
    required this.over,
    required this.fx,
  });

  @override
  Widget build(BuildContext context) {
    final hint = Theme.of(context).hintColor;
    final frac = limit > 0 ? (spent / limit).clamp(0.0, 1.0) : 0.0;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(period, style: TextStyle(fontSize: 12, color: hint)),
                Text(
                  '${formatMoney(fx, spent, currency)} / ${formatMoney(fx, limit, currency)}',
                  style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: over ? const Color(0xFFEF4444) : null),
                ),
              ],
            ),
            const SizedBox(height: 10),
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: LinearProgressIndicator(
                value: frac,
                minHeight: 10,
                color: over ? const Color(0xFFEF4444) : null,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              over
                  ? 'Over by ${formatMoney(fx, -remaining, currency)}'
                  : '${formatMoney(fx, remaining, currency)} remaining',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: over ? const Color(0xFFEF4444) : const Color(0xFF10B981),
              ),
            ),
            if (rollover > 0)
              Padding(
                padding: const EdgeInsets.only(top: 4),
                child: Text(
                    'Includes ${formatMoney(fx, rollover, currency)} rolled over from last period',
                    style: TextStyle(fontSize: 12, color: hint)),
              ),
          ],
        ),
      ),
    );
  }
}

class _CategoryRow extends StatelessWidget {
  final CategorySpend spend;
  final int limit;
  final String currency;
  final CurrencyService fx;
  const _CategoryRow({
    required this.spend,
    required this.limit,
    required this.currency,
    required this.fx,
  });

  @override
  Widget build(BuildContext context) {
    final frac = limit > 0 ? (spend.spend / limit).clamp(0.0, 1.0) : 0.0;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          IconPill(iconName: spend.icon ?? 'tag', colorHex: spend.color, size: 34),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Text(spend.name,
                          maxLines: 1, overflow: TextOverflow.ellipsis),
                    ),
                    Text(formatMoney(fx, spend.spend, currency),
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                  ],
                ),
                const SizedBox(height: 4),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: frac,
                    minHeight: 6,
                    color: colorFromHex(spend.color),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
